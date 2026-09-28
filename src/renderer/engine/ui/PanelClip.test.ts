/**
 * @jest-environment jsdom
 */
import { DrawApi, RecordingBackend, RectCommand } from '../draw';
import { Layer } from '../components/Layer';
import { renderTree } from '../components/renderTree';
import { Rectangle } from '../components/Rectangle';
import type { MountContext } from '../components/MountContext';
import { createTestContext, injectNow } from '../components/testing';
import { PointerAdapter } from '../input/PointerAdapter';
import { treeSnapshot } from '../debug/treeSnapshot';
import { Panel } from './Panel';

/**
 * Chapter 4.7's required component-level cases: offset before clip, the cull of
 * a long scrolled list, and the hit test. All through the real `Panel` and
 * `Layer` render paths into a recording backend, so what is asserted is what
 * the draw API was actually handed.
 */

let backend: RecordingBackend;
let api: DrawApi;

beforeEach(() => {
	backend = new RecordingBackend({ maxFrames: 1 });
	api = new DrawApi({ backend, strict: true });
});

function frame(root: Layer): void {
	api.beginFrame({ viewport: { width: 1440, height: 882 }, ratio: 1 });
	renderTree(root, api);
	api.endFrame();
}

function rectById(id: string): RectCommand {
	const command = backend.commands.find((candidate) => candidate.id === id);
	if (!command || command.kind !== 'rect') throw new Error(`no rect '${id}' was drawn`);
	return command;
}

/** A scrollable panel at (10, 20), 200 by 120, over `rows` rows 10 px tall on a 12 px pitch. */
function scroller(rows: number): { panel: Panel; root: Layer } {
	const root = new Layer({ id: 'root', width: 1440, height: 882 });
	const panel = new Panel({ id: 'list', x: 10, y: 20, width: 200, height: 120, scrollable: true });
	for (let index = 0; index < rows; index++) {
		panel.addChild(new Rectangle({ id: `row-${index}`, x: 0, y: index * 12, width: 180, height: 10 }));
	}
	panel.setContentSize(200, rows * 12);
	root.addChild(panel);
	return { panel, root };
}

describe('Panel content offset before clip (R4.9, R4.10)', () => {
	it('keeps the clip fixed while a child at local y 150 renders at panel y 50', () => {
		const root = new Layer({ id: 'root', width: 1440, height: 882 });
		const panel = new Panel({ id: 'panel', x: 10, y: 20, width: 200, height: 100, scrollable: true });
		panel.addChild(new Rectangle({ id: 'child', x: 0, y: 150, width: 50, height: 20 }));
		panel.setContentSize(200, 400);
		panel.scroll(0, 100);
		root.addChild(panel);

		frame(root);

		const child = rectById('child');
		// Drawn at its local origin; the walk's transform carries it to the screen.
		expect(child.rect.y).toBe(0);
		expect(child.transform[5]).toBe(20 + 50);
		expect(child.clip).toEqual({
			kind: 'rect',
			rect: { minX: 10, minY: 20, maxX: 210, maxY: 120 },
			rounded: null,
		});
	});
});

describe('Panel cull through the draw API (R4.2a)', () => {
	it('emits the rows in view and counts every other one culled', () => {
		const { panel, root } = scroller(500);
		panel.scroll(0, 1200);

		frame(root);

		const rows = backend.commands.filter((command) => command.id?.startsWith('row-')).map((command) => command.id);
		// Scrolled 1200 px: rows 100 to 109 are in the 120 px window, and row
		// 110 starts exactly on its bottom edge. It is kept, because a cull
		// bound grows one device pixel for R5.7's anti-aliasing ramp and a
		// cull is allowed to keep too much, never too little.
		expect(rows).toEqual(Array.from({ length: 11 }, (_unused, index) => `row-${100 + index}`));
		expect(api.getStats().culled).toBe(489);
	});

	it('leaves the panel background out of its own clip', () => {
		const { panel, root } = scroller(3);
		panel.scroll(0, 30);
		frame(root);

		const background = backend.commands.find((command) => command.kind === 'rect' && command.id === 'list');
		expect(background?.clip).toEqual({ kind: 'none' });
	});
});

describe('hit testing honours ancestor clips (R4.12)', () => {
	it('does not let a row scrolled out of view be hit, and still lets one in view be', () => {
		const { panel, root } = scroller(50);
		panel.scroll(0, 120);
		frame(root);

		const hidden = panel.getChildren()[0];
		const shown = panel.getChildren()[10];
		// Row 0 is still at panel-local (0, 0); scrolled, it sits 120 px above
		// the panel's top edge, where nothing is drawn. Row 10 has scrolled
		// into the top of the window.
		expect(hidden.containsScreenPoint(20, 20 - 120 + 5)).toBe(false);
		expect(shown.containsScreenPoint(20, 20 + 5)).toBe(true);
	});

	it('rejects the clip edge itself, which the fragment test does not keep (R4.4)', () => {
		const root = new Layer({ id: 'root', width: 400, height: 400 });
		const clipper = new Layer({ id: 'clipper', x: 0, y: 0, width: 100, height: 100, overflow: 'hidden' });
		const child = new Layer({ id: 'child', x: 50, y: 50, width: 100, height: 100 });
		clipper.addChild(child);
		root.addChild(clipper);

		expect(child.containsScreenPoint(99, 99)).toBe(true);
		expect(child.containsScreenPoint(100, 60)).toBe(false);
		expect(child.containsScreenPoint(120, 120)).toBe(false);
	});

	it('tests against the snapped clip edges the renderer applied, at its ratio (R7.8a)', () => {
		const clipper = new Layer({ id: 'clipper', x: 10.3, y: 0, width: 20.3, height: 20, overflow: 'hidden' });
		const child = new Layer({ id: 'child', x: -10, y: 0, width: 40, height: 20 });
		clipper.addChild(child);
		// The hit test reads the ratio the mounted tree's draw API last snapped at.
		clipper.mount(createTestContext({ draw: api }));

		// Ratio 1: the clip is x 10 to 31, so 10.1 hits and 30.8 hits although
		// both are outside the unsnapped 10.3 to 30.6.
		frame(clipper);
		expect(child.containsScreenPoint(10.1, 5)).toBe(true);
		expect(child.containsScreenPoint(30.8, 5)).toBe(true);
		expect(child.containsScreenPoint(31, 5)).toBe(false);

		// Ratio 2: 10.5 to 30.5.
		api.beginFrame({ viewport: { width: 1440, height: 882 }, ratio: 2 });
		renderTree(clipper, api);
		api.endFrame();
		expect(child.containsScreenPoint(10.4, 5)).toBe(false);
		expect(child.containsScreenPoint(10.5, 5)).toBe(true);
		expect(child.containsScreenPoint(30.5, 5)).toBe(false);
	});

	it('gives the dispatcher\'s hit walk the same snapped edges (R7.8a)', () => {
		const clipper = new Layer({ id: 'clipper', x: 10.3, y: 0, width: 20.3, height: 20, overflow: 'hidden' });
		const child = new Rectangle({ id: 'child', x: -10, y: 0, width: 40, height: 20 });
		clipper.addChild(child);
		const context = createTestContext({ draw: api });
		clipper.mount(context);
		const at = (x: number): string | null => context.dispatcher.hitTest({ x, y: 5 })?.id ?? null;

		frame(clipper);
		expect(at(10.1)).toBe('child');
		expect(at(30.8)).toBe('child');
		expect(at(31)).toBeNull();

		api.beginFrame({ viewport: { width: 1440, height: 882 }, ratio: 2 });
		renderTree(clipper, api);
		api.endFrame();
		expect(at(10.4)).toBeNull();
		expect(at(10.5)).toBe('child');
		expect(at(30.5)).toBeNull();
	});

	it('intersects nested clips', () => {
		const outer = new Layer({ id: 'outer', x: 0, y: 0, width: 100, height: 100, overflow: 'hidden' });
		const inner = new Layer({ id: 'inner', x: 50, y: 0, width: 100, height: 100, overflow: 'hidden' });
		const leaf = new Layer({ id: 'leaf', x: 0, y: 0, width: 100, height: 100 });
		inner.addChild(leaf);
		outer.addChild(inner);

		expect(leaf.containsScreenPoint(75, 10)).toBe(true);
		// Inside inner and leaf, outside outer.
		expect(leaf.containsScreenPoint(120, 10)).toBe(false);
	});

	it('clips under any component whose overflow is hidden, since the walk pushes the clip for all of them', () => {
		const shape = new Rectangle({ id: 'shape', x: 0, y: 0, width: 10, height: 10 });
		shape.setOverflow('hidden');
		const inside = new Layer({ id: 'inside', x: 50, y: 50, width: 10, height: 10 });
		shape.addChild(inside);

		expect(shape.clipsChildren).toBe(true);
		expect(inside.containsScreenPoint(55, 55)).toBe(false);
	});

	it('is not gated by an ancestor that does not clip', () => {
		const parent = new Layer({ id: 'parent', x: 0, y: 0, width: 10, height: 10 });
		const child = new Layer({ id: 'child', x: 50, y: 50, width: 20, height: 20 });
		parent.addChild(child);
		expect(child.containsScreenPoint(60, 60)).toBe(true);
	});
});

describe('tree snapshot clips from the clip stack arithmetic (R13.22)', () => {
	it('reports a clip intersected down to nothing as a zero-sized rect, not as no clip (R4.2)', () => {
		const outer = new Layer({ id: 'outer', x: 0, y: 0, width: 100, height: 100, overflow: 'hidden' });
		const inner = new Layer({ id: 'inner', x: 200, y: 0, width: 100, height: 100, overflow: 'hidden' });
		const leaf = new Layer({ id: 'leaf', width: 5, height: 5 });
		inner.addChild(leaf);
		outer.addChild(inner);

		const [root] = treeSnapshot([outer], { width: 1440, height: 882 }).roots;
		const leafNode = root.children[0].children[0];
		expect(leafNode.id).toBe('leaf');
		expect(leafNode.clip).toEqual({ x: 0, y: 0, w: 0, h: 0 });
	});

	it('reports the snapped clip the renderer applied at a fractional position and ratio 2 (R7.8a)', () => {
		const clipper = new Layer({ id: 'clipper', x: 10.3, y: 5.1, width: 20.3, height: 20.7, overflow: 'hidden' });
		clipper.addChild(new Rectangle({ id: 'fill', x: 0, y: 0, width: 40, height: 40 }));
		api.beginFrame({ viewport: { width: 1440, height: 882 }, ratio: 2 });
		renderTree(clipper, api);
		api.endFrame();

		const drawn = rectById('fill').clip;
		const reported = treeSnapshot([clipper], { width: 1440, height: 882, ratio: 2 }).roots[0].children[0].clip;
		if (drawn.kind !== 'rect') throw new Error('the fill should be clipped');
		expect(reported).toEqual({
			x: drawn.rect.minX,
			y: drawn.rect.minY,
			w: drawn.rect.maxX - drawn.rect.minX,
			h: drawn.rect.maxY - drawn.rect.minY,
		});
		expect(reported).toEqual({ x: 10.5, y: 5, w: 20, h: 21 });
	});

	it('reports the same clip the renderer applied to the same node', () => {
		const { panel, root } = scroller(20);
		panel.scroll(0, 24);
		frame(root);

		const drawn = rectById('row-3').clip;
		const [snapshotRoot] = treeSnapshot([root], { width: 1440, height: 882 }).roots;
		const find = (node: typeof snapshotRoot): typeof snapshotRoot | null => {
			if (node.id === 'row-3') return node;
			for (const child of [...node.children, ...(node.parts ?? [])]) {
				const found = find(child);
				if (found) return found;
			}
			return null;
		};
		const reported = find(snapshotRoot)?.clip;
		if (drawn.kind !== 'rect' || !reported) throw new Error('row 3 should be clipped in both');
		expect(reported).toEqual({
			x: drawn.rect.minX,
			y: drawn.rect.minY,
			w: drawn.rect.maxX - drawn.rect.minX,
			h: drawn.rect.maxY - drawn.rect.minY,
		});
	});
});

describe('a click right after a wheel scroll (R4.12 through the dispatcher)', () => {
	let canvas: HTMLCanvasElement;
	let context: MountContext;
	let adapter: PointerAdapter;

	beforeEach(() => {
		canvas = document.createElement('canvas');
		document.body.appendChild(canvas);
		context = createTestContext({ draw: api });
		adapter = new PointerAdapter({ dispatcher: context.dispatcher });
		adapter.attach(canvas);
	});

	afterEach(() => {
		adapter.detach();
		document.body.removeChild(canvas);
	});

	it('goes to the row now under the pointer, not the one hovered before the scroll', () => {
		// Rows 20 tall with no gap, in a 200x120 scrollable panel at the origin.
		const root = new Layer({ id: 'root', width: 1440, height: 882 });
		const panel = new Panel({ id: 'list', x: 0, y: 0, width: 200, height: 120, scrollable: true });
		const pressed: string[] = [];
		for (let index = 0; index < 20; index++) {
			const row = new Rectangle({ id: `row-${index}`, x: 0, y: index * 20, width: 180, height: 20 });
			row.onPointerDown = () => pressed.push(`row-${index}`);
			panel.addChild(row);
		}
		panel.setContentSize(200, 400);
		root.addChild(panel);
		root.mount(context);

		// Pixel deltas scroll by exactly that much (R9.3), so panel y 15 is now
		// content y 45: row 2. Row 0 has left the clip.
		injectNow({ canvas, dispatcher: context.dispatcher }, ['move,50,15', 'scroll,50,15,30', 'down,50,15']);

		expect(panel.getScrollOffset().y).toBe(30);
		expect(pressed).toEqual(['row-2']);
		expect(root.findById('row-2')?.hovered).toBe(true);
		expect(root.findById('row-0')?.hovered).toBe(false);
	});
});
