import { DrawApi, RecordingBackend } from '../draw';
import type { DrawCommand } from '../draw';
import type { DrawApi as DrawApiType } from '../draw/DrawApi';
import { createMeasuringDrawApi } from '../text/testing';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { Circle } from './Circle';
import type { Component } from './Component';
import { Layer } from './Layer';
import { Rectangle } from './Rectangle';
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

		const panel = new Panel({ id: 'panel', x: 100, y: 100, width: 200, height: 200, scrollable: true });
		const row = new Counting({ id: 'row', x: 0, y: 300, width: 100, height: 40 });
		panel.setContentSize(200, 400);
		panel.addChild(row);
		const scrolled = new Layer({ width: 800, height: 600 });
		scrolled.addChild(panel);
		frame(scrolled);
		frame(scrolled);
		expect(row.renders).toBe(1);

		panel.scroll(0, 150);
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
		/**
		 * Slides `build`'s component down across the clip, from well above its
		 * top edge to well below its bottom, a pixel at a time, and at every
		 * step checks that the frame that may skip draws exactly what the
		 * counting frame drew. Returns how many steps drew anything beyond
		 * what the box alone would: a box `h` tall is drawn at `201 + h`
		 * offsets (R4.2a's one-pixel inflation included), so a larger count
		 * shows the ink reaching past the box was exercised.
		 */
		function sweep(build: () => Component, options: { draw?: DrawApi; recording?: RecordingBackend; mount?: boolean } = {}): number {
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
			for (let offset = -160; offset <= 260; offset += 1) {
				subject.y = offset;
				const counting = frame(root, draw, recording);
				const skipping = frame(root, draw, recording);
				expect({ offset, ...skipping }).toEqual({ offset, ...counting });
				if (counting.drawn.length > 0) drawnSteps++;
			}
			expect(draw.diagnostics.filter((diagnostic) => diagnostic.code === 'ink-outside-bound')).toEqual([]);
			return drawnSteps - (201 + subject.height);
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

	it('keeps one Panel content offset until the scroll moves', () => {
		const panel = new Panel({ width: 100, height: 100, scrollable: true, padding: 4 });
		panel.setContentSize(100, 400);
		const offset = panel.contentOffset;
		expect(panel.contentOffset).toBe(offset);
		expect(offset).toEqual({ x: -4, y: -4 });

		panel.scroll(0, 30);
		expect(panel.contentOffset).not.toBe(offset);
		expect(panel.contentOffset).toEqual({ x: -4, y: 26 });
	});
});
