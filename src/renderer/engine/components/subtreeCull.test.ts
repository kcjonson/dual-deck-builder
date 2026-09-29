import { DrawApi, RecordingBackend } from '../draw';
import type { DrawCommand } from '../draw';
import type { DrawApi as DrawApiType } from '../draw/DrawApi';
import { ATLAS_ASSETS } from '../text/fontFaces';
import { MeasuringRecordingBackend, committedAtlas, createMeasuringDrawApi } from '../text/testing';
import { Button } from '../ui/Button';
import { ScrollContainer } from '../ui/ScrollContainer';
import { Circle } from './Circle';
import type { Component } from './Component';
import { Layer } from './Layer';
import { Rectangle } from './Rectangle';
import { Stack } from './Stack';
import { Text } from './Text';
import { renderTree } from './renderTree';
import { createTestContext } from './testing';

/**
 * DDB-184: the walk skips a subtree whose cached ink bound misses the clip,
 * and counts its groups as culled. Two properties matter. A skip never drops
 * a pixel, which these tests check as "the second frame, where skips can
 * happen, draws exactly the groups the first frame did", since the first
 * frame of any subtree is always walked. And `apiDraws + culled` is the same
 * with and without the skip (R4.2a).
 */

interface Frame {
	/** Drawn groups in submission order: `id:kind`, so a shadow and its owner are two entries. */
	drawn: string[];
	apiDraws: number;
	culled: number;
}

let backend: RecordingBackend;
let api: DrawApi;

beforeEach(() => {
	backend = new RecordingBackend({ maxFrames: 1 });
	api = new DrawApi({ backend, strict: true });
});

function frame(root: Component, draw: DrawApi = api, recording: RecordingBackend = backend): Frame {
	draw.beginFrame({ viewport: { width: 800, height: 600 }, ratio: 1 });
	renderTree(root, draw);
	draw.endFrame();
	const stats = draw.getStats();
	const commands: DrawCommand[] = [...recording.commands].sort((a, b) => a.sequence - b.sequence);
	return {
		drawn: commands.map((command) => `${command.id ?? '-'}:${command.kind}`),
		apiDraws: stats.apiDraws,
		culled: stats.culled,
	};
}

/** A clipping viewport at (100, 100), 200 square, the shape of a scroll panel. */
function viewport(): Layer {
	const root = new Layer({ id: 'root', width: 800, height: 600 });
	const clip = new Layer({ id: 'clip', x: 100, y: 100, width: 200, height: 200, overflow: 'hidden' });
	root.addChild(clip);
	return clip;
}

class Counting extends Rectangle {
	public renders = 0;

	public render(draw: DrawApiType): void {
		this.renders += 1;
		super.render(draw);
	}
}

/** A rect with a drop shadow reaching 26 px below it, declared through `inkExtent` (R8.8). */
class Shadowed extends Rectangle {
	public get inkExtent(): number {
		// shadowInk: 12 blur pads 18, the 8 px offset moves it: 26 past the box.
		return 26;
	}

	public render(draw: DrawApiType): void {
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: [1, 1, 1, 1],
			shadow: { color: [0, 0, 0, 0.5], blur: 12, offset: { x: 0, y: 8 } },
		});
	}
}

describe('subtree cull (DDB-184, R4.2a)', () => {
	it('walks a subtree once to count it, then skips it while its ink misses the clip', () => {
		const clip = viewport();
		const card = new Layer({ id: 'card', x: 0, y: 400, width: 100, height: 100 });
		const face = new Counting({ id: 'face', width: 100, height: 100 });
		card.addChild(face).addChild(new Rectangle({ id: 'badge', x: 10, y: 10, width: 10, height: 10 }));
		clip.addChild(card);
		const root = clip.parent as Layer;

		const first = frame(root);
		expect(face.renders).toBe(1);
		expect(first.drawn).toEqual([]);
		expect(first.culled).toBe(2);

		const second = frame(root);
		expect(face.renders).toBe(1);
		expect(second).toEqual(first);
		expect(card.walkedGroupCount).toBe(2);
	});

	it('draws the subtree again once it moves into the clip, and when the parent scrolls it in', () => {
		const clip = viewport();
		const card = new Counting({ id: 'card', x: 0, y: 400, width: 100, height: 100 });
		clip.addChild(card);
		const root = clip.parent as Layer;
		frame(root);
		frame(root);
		expect(card.renders).toBe(1);

		card.y = 50;
		expect(frame(root).drawn).toEqual(['card:rect']);

		const panel = new ScrollContainer({ id: 'panel', x: 100, y: 100, width: 200, height: 200, contentHeight: 400 });
		const content = new Layer({ width: 200, height: 400 });
		const row = new Counting({ id: 'row', x: 0, y: 300, width: 100, height: 40 });
		content.addChild(row);
		panel.addChild(content);
		const scrolled = new Layer({ width: 800, height: 600 });
		scrolled.addChild(panel);
		frame(scrolled);
		frame(scrolled);
		expect(row.renders).toBe(1);

		panel.scrollBy(150);
		expect(frame(scrolled).drawn).toContain('row:rect');
	});

	it('follows a transform: a rotated card whose corner swings into the clip is drawn', () => {
		const clip = viewport();
		// 20 wide and 200 tall, 10 px right of the clip; a quarter turn about
		// its centre (220, 100) spans x 120..320, half of it inside.
		const card = new Counting({ id: 'card', x: 210, y: 0, width: 20, height: 200 });
		clip.addChild(card);
		const root = clip.parent as Layer;
		frame(root);
		frame(root);
		expect(card.renders).toBe(1);

		card.transform = { rotate: Math.PI / 2 };
		expect(frame(root).drawn).toEqual(['card:rect']);
	});

	it('forgets the count when the subtree changes, so the next frame walks and recounts it', () => {
		const clip = viewport();
		const card = new Layer({ id: 'card', x: 0, y: 400, width: 100, height: 100 });
		card.addChild(new Rectangle({ id: 'a', width: 10, height: 10 }));
		clip.addChild(card);
		const root = clip.parent as Layer;
		frame(root);
		expect(frame(root).culled).toBe(1);

		card.addChild(new Rectangle({ id: 'b', width: 10, height: 10 }));
		expect(card.walkedGroupCount).toBe(-1);
		expect(frame(root).culled).toBe(2);
		expect(card.walkedGroupCount).toBe(2);
		expect(frame(root).culled).toBe(2);
	});

	it('skips everything under an empty clip, and counts it', () => {
		const root = new Layer({ width: 800, height: 600 });
		const outer = new Layer({ x: 0, y: 0, width: 100, height: 100, overflow: 'hidden' });
		const inner = new Layer({ x: 200, y: 200, width: 100, height: 100, overflow: 'hidden' });
		const leaf = new Counting({ id: 'leaf', width: 10, height: 10 });
		inner.addChild(leaf);
		outer.addChild(inner);
		root.addChild(outer);

		const first = frame(root);
		const second = frame(root);

		expect(leaf.renders).toBe(1);
		expect(second).toEqual(first);
		expect(second.culled).toBe(1);
	});

	it('never skips a subtree holding a layer, which may promote past the clip (R4.8)', () => {
		const clip = viewport();
		const card = new Layer({ id: 'card', x: 0, y: 400, width: 100, height: 100 });
		card.addChild(new Rectangle({ id: 'popup', width: 20, height: 20, layer: 'popup' }));
		clip.addChild(card);
		const root = clip.parent as Layer;

		frame(root);
		expect(card.subtreeInk).toBeNull();
		expect(frame(root).drawn).toEqual(['popup:rect']);
	});

	it('keeps apiDraws + culled equal to the groups requested, skip or no skip', () => {
		const clip = viewport();
		for (let index = 0; index < 12; index++) {
			const card = new Layer({ id: `card${index}`, x: 0, y: index * 60, width: 100, height: 50 });
			card.setBackgroundColor([0, 0, 0, 1]);
			card.addChild(new Shadowed({ id: `art${index}`, x: 10, y: 10, width: 30, height: 20 }));
			clip.addChild(card);
		}
		const root = clip.parent as Layer;

		const first = frame(root);
		const second = frame(root);

		expect(second.drawn).toEqual(first.drawn);
		expect(second.apiDraws + second.culled).toBe(first.apiDraws + first.culled);
		// Twelve cards of three groups each (a background, a shadow and its rect).
		expect(first.apiDraws + first.culled).toBe(36);
	});

	describe('never culls visible ink', () => {
		interface SweepOptions {
			draw?: DrawApi;
			recording?: RecordingBackend;
			mount?: boolean;
			/** The axis to slide along; `y` unless said. */
			axis?: 'x' | 'y';
		}

		/**
		 * Slides `build`'s component down (or right) across the clip, from well
		 * before its near edge to well past its far one, a pixel at a time, and
		 * at every step checks that the frame that may skip draws exactly what
		 * the counting frame drew. Returns how many steps drew anything beyond
		 * what the box alone would: a box `h` tall is drawn at `201 + h`
		 * offsets (R4.2a's one-pixel inflation included), so a larger count
		 * shows the ink reaching past the box was exercised.
		 */
		function sweep(build: () => Component, options: SweepOptions = {}): number {
			const axis = options.axis ?? 'y';
			const draw = options.draw ?? api;
			const recording = options.recording ?? backend;
			const clip = viewport();
			const root = clip.parent as Layer;
			const subject = build();
			clip.addChild(subject);
			if (options.mount) {
				const context = createTestContext({ draw });
				root.mount(context);
				context.frame.layout();
			}
			let drawnSteps = 0;
			for (let offset = -320; offset <= 580; offset += 1) {
				subject[axis] = offset;
				const counting = frame(root, draw, recording);
				const skipping = frame(root, draw, recording);
				expect({ offset, ...skipping }).toEqual({ offset, ...counting });
				if (counting.drawn.length > 0) drawnSteps++;
			}
			expect(draw.diagnostics.filter((diagnostic) => diagnostic.code === 'ink-outside-bound')).toEqual([]);
			return drawnSteps - (201 + (axis === 'y' ? subject.height : subject.width));
		}

		it('a drop shadow declared through inkExtent', () => {
			// The shadow reaches 10 px above the box and 26 below it.
			expect(sweep(() => new Shadowed({ id: 'shadowed', width: 50, height: 20 }))).toBeGreaterThanOrEqual(30);
		});

		it('the walk\'s focus ring', () => {
			const make = (): Component => {
				const box = new Rectangle({ id: 'box', width: 50, height: 20, focusable: true });
				box.setFocusState(true, true);
				return box;
			};
			// Offset 2 and width 1: 3 px each side.
			expect(sweep(make)).toBe(6);
		});

		it('a centred circle stroke', () => {
			expect(sweep(() => new Circle({ id: 'ring', style: { borderWidth: 6 } }).setRadius(10))).toBe(6);
		});

		it('a circle given a size its radius does not match', () => {
			// The default radius of 50 draws a 100 px disc from a 20 px box.
			expect(sweep(() => new Circle({ id: 'disc', width: 20, height: 20 }))).toBe(80);
		});

		it('an accent button\'s hover glow, focus ring and label', () => {
			const { api: measuring, backend: recording } = createMeasuringDrawApi();
			const make = (): Component => {
				const button = new Button('Go', { id: 'go', tone: 'accent', width: 100 });
				button.setHovered(true);
				return button;
			};
			// The glow's 26 px on each side.
			expect(sweep(make, { draw: measuring, recording, mount: true })).toBeGreaterThanOrEqual(50);
		});

		it('a text drop shadow offset well past the run (R12.4)', () => {
			const { api: measuring, backend: recording } = createMeasuringDrawApi();
			const make = (): Component => {
				const text = new Text('Shadowed', { id: 'shadowed_text', style: { fontSize: 16 } });
				text.shadow = { color: [0, 0, 0, 1], offset: { x: 0, y: 12 }, blur: 4 };
				return text;
			};
			// 12 down and 4 of blur below the run; 4 of blur above it.
			expect(sweep(make, { draw: measuring, recording, mount: true })).toBeGreaterThanOrEqual(12);
		});

		it('a text that runs past its box', () => {
			const { api: measuring, backend: recording } = createMeasuringDrawApi();
			const make = (): Component => new Text('Scrap the escort and the convoy keeps rolling on and on', {
				id: 'spill',
				width: 40,
				height: 10,
				style: { fontSize: 16, whiteSpace: 'nowrap' },
			});
			// A 20 px line in a 10 px box.
			expect(sweep(make, { draw: measuring, recording, mount: true })).toBeGreaterThanOrEqual(5);
		});

		// DDB-214: the bound is the run's measured ink, per side, so each of
		// these overruns on the side its alignment sends it to.
		describe('a text whose run overruns its box (DDB-214)', () => {
			function measuredSweep(make: () => Text, axis: 'x' | 'y'): { past: number; text: Text } {
				const { api: measuring, backend: recording } = createMeasuringDrawApi();
				let text: Text | null = null;
				const past = sweep(() => (text = make()), { draw: measuring, recording, mount: true, axis });
				return { past, text: text as unknown as Text };
			}

			it('a right-aligned nowrap run past the left of a narrow box', () => {
				const { past, text } = measuredSweep(() => new Text('Scrap the escort and keep rolling', {
					id: 'right',
					width: 40,
					height: 20,
					style: { fontSize: 16, whiteSpace: 'nowrap', textAlign: 'right' },
				}), 'x');
				const run = text.measured?.width ?? 0;
				expect(run).toBeGreaterThan(100);
				expect(text.inkRect.x).toBeLessThan(40 - run);
				expect(past).toBeGreaterThanOrEqual(Math.floor(text.inkRect.width - 40));
			});

			it('a centred nowrap run past both sides', () => {
				const { past, text } = measuredSweep(() => new Text('Scrap the escort and keep rolling', {
					id: 'centred',
					width: 40,
					height: 20,
					style: { fontSize: 16, whiteSpace: 'nowrap', textAlign: 'center' },
				}), 'x');
				expect(text.inkRect.x).toBeLessThan(0);
				expect(past).toBeGreaterThanOrEqual(Math.floor(text.inkRect.width - 40));
				expect(text.inkRect.x + text.inkRect.width).toBeGreaterThan(40);
			});

			it('wrapped lines taller than a fixed height, centred on it', () => {
				const { past, text } = measuredSweep(() => new Text('one two three four five six seven eight', {
					id: 'tall',
					width: 60,
					height: 16,
					style: { fontSize: 16, verticalAlign: 'middle' },
				}), 'y');
				expect(text.measured?.height ?? 0).toBeGreaterThan(60);
				expect(past).toBeGreaterThanOrEqual(Math.floor(text.inkRect.height - 16));
				expect(text.inkRect.y).toBeLessThan(0);
				expect(text.inkRect.y + text.inkRect.height).toBeGreaterThan(16);
			});

			it('wrapped lines bottom-aligned in a short box, past its top', () => {
				const { past, text } = measuredSweep(() => new Text('one two three four five six seven eight', {
					id: 'bottom',
					width: 60,
					height: 16,
					style: { fontSize: 16, verticalAlign: 'bottom' },
				}), 'y');
				expect(past).toBeGreaterThanOrEqual(Math.floor(text.inkRect.height - 16));
				// The last line's box ends on the box's bottom, so the block's glyphs start above it.
				expect(text.inkRect.y).toBeLessThan(16 - 60);
			});

			it('glyphs past a tight line height', () => {
				const { past, text } = measuredSweep(() => new Text('Tall Glyphs', {
					id: 'tight',
					style: { fontSize: 32, lineHeight: 0.4 },
				}), 'y');
				expect(text.height).toBeLessThan(16);
				expect(past).toBeGreaterThan(0);
				expect(text.inkExtent).toBeGreaterThan(0);
			});

			it('a run inside its box keeps an ink bound no larger than its glyphs need', () => {
				const text = new Text('Go', { width: 200, height: 40, style: { fontSize: 16 } });
				text.mount(createTestContext({ draw: createMeasuringDrawApi().api }));
				// The snap's pixel and the distance field's padding past the
				// first glyph's left edge, nowhere near the old em of slack.
				expect(text.inkExtent).toBeGreaterThan(0);
				expect(text.inkExtent).toBeLessThan(4);
				expect(text.inkRect).toEqual({ x: -text.inkExtent, y: 0, width: 200 + text.inkExtent, height: 40 });
			});
		});

		it('a text that gains a bound once it measures, at an unchanged size', () => {
			const { api: measuring, backend: recording } = createMeasuringDrawApi();
			const clip = viewport();
			const root = clip.parent as Layer;
			const text = new Text('Convoy', { id: 'late', y: 400, width: 60, height: 20, style: { fontSize: 16 } });
			clip.addChild(text);
			// Cached while unmeasured: no bound.
			expect(text.subtreeInk).toBeNull();

			const context = createTestContext({ draw: measuring });
			root.mount(context);
			context.frame.layout();

			expect(text.width).toBe(60);
			expect(text.subtreeInk).not.toBeNull();
			const counting = frame(root, measuring, recording);
			const skipping = frame(root, measuring, recording);
			expect(skipping).toEqual(counting);
			expect(counting.culled).toBe(1);
			expect(clip.walkedGroupCount).toBe(1);
		});

		it('a text in a stack that becomes measurable at an unchanged size (#104 review)', () => {
			// The atlases load after mount, as a page's can, and the stack's
			// `assignSize` measures without resizing the fixed box.
			const recording = new MeasuringRecordingBackend({ maxFrames: 1 });
			const draw = new DrawApi({ backend: recording, strict: true });
			const clip = viewport();
			const root = clip.parent as Layer;
			const row = new Stack({ id: 'row', x: 210, y: 50 });
			const text = new Text('Scrap the escort and keep rolling on', {
				id: 'late-stack',
				width: 40,
				height: 20,
				style: { fontSize: 16, whiteSpace: 'nowrap', textAlign: 'right' },
			});
			row.addChild(text);
			clip.addChild(row);
			const context = createTestContext({ draw });
			root.mount(context);
			context.frame.layout();
			// Read while unmeasured, as the snapshot would.
			expect(text.inkRect).toMatchObject({ width: 40, height: 20 });

			for (const asset of ATLAS_ASSETS) {
				const texture = draw.createTexture({ width: 1, height: 1, label: asset.role });
				draw.loadFontAtlas({ name: asset.role, atlas: committedAtlas(asset.role), texture });
			}
			row.invalidateLayout();
			context.frame.layout();

			expect(text.width).toBe(40);
			expect(text.currentMetrics?.width ?? 0).toBeGreaterThan(200);
			// The box sits past the clip's right edge; only the run's left overrun is visible.
			expect(text.inkRect.x).toBeLessThan(-150);
			const counting = frame(root, draw, recording);
			const skipping = frame(root, draw, recording);
			expect(counting.drawn).toEqual(['late-stack:text']);
			expect(skipping).toEqual(counting);
		});

		it('an unmeasured text, which has no bound and is never skipped', () => {
			// Not strict: a text drawn with no atlas loaded is reported (R2.18).
			const lenient = new DrawApi({ backend, development: false });
			const text = new Text('unmeasured', { id: 'unmeasured', width: 40, height: 10 });
			const clip = viewport();
			text.y = 1000;
			clip.addChild(text);
			frame(clip.parent as Layer, lenient);

			expect(text.subtreeInk).toBeNull();
			// Walked, not skipped: the run has no bound, so the draw API keeps it.
			expect(frame(clip.parent as Layer, lenient).drawn).toEqual(['unmeasured:text']);
			expect(text.walkedGroupCount).toBe(1);
		});
	});

	it('reports a component that draws past its declared ink (development builds)', () => {
		class Liar extends Rectangle {
			public render(draw: DrawApiType): void {
				draw.drawRect({ id: 'liar', rect: { x: 0, y: 0, width: this.width, height: this.height + 30 }, fill: [1, 1, 1, 1] });
			}
		}
		const clip = viewport();
		clip.addChild(new Liar({ width: 20, height: 20 }));

		expect(() => frame(clip.parent as Layer)).toThrow(/ink-outside-bound: liar draws at/);

		// A production build builds no bound and checks nothing.
		const production = new DrawApi({ backend, development: false, strict: true });
		expect(production.auditsInk).toBe(false);
		expect(() => frame(clip.parent as Layer, production)).not.toThrow();
	});
});

describe('the walk allocates no geometry per frame (#85 review)', () => {
	it('keeps one clipRect until the size changes', () => {
		const layer = new Layer({ width: 100, height: 50, overflow: 'hidden' });
		const clip = layer.clipRect;
		expect(layer.clipRect).toBe(clip);
		expect(Object.isFrozen(clip)).toBe(true);

		layer.setSize(120, 50);
		expect(layer.clipRect).not.toBe(clip);
		expect(layer.clipRect).toEqual({ x: 0, y: 0, width: 120, height: 50 });
	});

	it('keeps one transform matrix until the transform, size or drag offset changes', () => {
		const card = new Rectangle({ width: 100, height: 20, transform: { rotate: Math.PI / 2 } });
		const matrix = card.transformMatrix;
		expect(card.transformMatrix).toBe(matrix);

		card.setSize(100, 40);
		const resized = card.transformMatrix;
		expect(resized).not.toBe(matrix);
		expect(resized?.[5]).toBeCloseTo(-30);

		card.setDragOffset({ x: 5, y: 0 });
		expect(card.transformMatrix?.[4]).toBeCloseTo((resized?.[4] ?? 0) + 5);

		card.setDragOffset(null);
		card.transform = {};
		expect(card.transformMatrix).toBeNull();
	});

	it('drops a drag ghost\'s offset from the cached matrix when the ghost unmounts', () => {
		const root = new Layer({ width: 400, height: 400 });
		const card = new Rectangle({ width: 100, height: 20 });
		root.addChild(card);
		root.mount(createTestContext());
		card.setDragOffset({ x: 30, y: 0 });
		expect(card.transformMatrix?.[4]).toBe(30);

		root.removeChild(card);
		root.addChild(card);

		expect(card.dragOffset).toBeNull();
		expect(card.transformMatrix).toBeNull();
		expect(card.subtreeInk).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 20 });
	});

	it('keeps one ScrollContainer content offset until the scroll moves', () => {
		const panel = new ScrollContainer({ width: 100, height: 100, contentHeight: 400, style: { padding: 4 } });
		const offset = panel.contentOffset;
		expect(panel.contentOffset).toBe(offset);
		expect(offset).toEqual({ x: 0, y: 0 });

		panel.scrollBy(30);
		expect(panel.contentOffset).not.toBe(offset);
		expect(panel.contentOffset).toEqual({ x: 0, y: 30 });
	});
});
