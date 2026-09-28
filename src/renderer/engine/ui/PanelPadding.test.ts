/**
 * @jest-environment jsdom
 */
import { DrawApi, RecordingBackend, RectCommand } from '../draw';
import { Container } from '../components/Container';
import { renderTree } from '../components/renderTree';
import { Rectangle } from '../components/Rectangle';
import { treeSnapshot } from '../debug/treeSnapshot';
import { Panel } from './Panel';

/**
 * The `padding` option (R12.19): children are placed inside the border box by
 * the padding, through the one `contentOffset` the walk, the hit test and the
 * tree snapshot all read, and the padding scrolls with the content (R4.13).
 */

let backend: RecordingBackend;
let api: DrawApi;

beforeEach(() => {
	backend = new RecordingBackend({ maxFrames: 1 });
	api = new DrawApi({ backend, strict: true });
});

function frame(root: Container): void {
	api.beginFrame({ viewport: { width: 1440, height: 882 }, ratio: 1 });
	renderTree(root, api);
	api.endFrame();
}

function rectById(id: string): RectCommand {
	const command = backend.commands.find((candidate) => candidate.id === id);
	if (!command || command.kind !== 'rect') throw new Error(`no rect '${id}' was drawn`);
	return command;
}

/** A panel at (10, 20), 200 by 120, padding 13, with a 30 by 10 child at (0, 0). */
function padded(options: { scrollable?: boolean } = {}): { panel: Panel; child: Rectangle; root: Container } {
	const root = new Container({ id: 'root', width: 1440, height: 882 });
	const panel = new Panel({ id: 'panel', x: 10, y: 20, width: 200, height: 120, padding: 13, ...options });
	const child = new Rectangle({ id: 'child', x: 0, y: 0, width: 30, height: 10 });
	panel.addChild(child);
	root.addChild(panel);
	return { panel, child, root };
}

describe('Panel padding (R12.19)', () => {
	it('draws a child at (0, 0) at the padded origin, and the background at the border box', () => {
		const { root } = padded();
		frame(root);

		// Each draws at its local origin; the walk's transform carries it to the screen.
		const child = rectById('child');
		expect([child.transform[4], child.transform[5]]).toEqual([23, 33]);
		const background = rectById('panel');
		expect([background.transform[4], background.transform[5]]).toEqual([10, 20]);
		expect(background.rect).toMatchObject({ width: 200, height: 120 });
	});

	it('reports the padding and the width left for children', () => {
		const { panel } = padded();
		expect(panel.padding).toBe(13);
		expect(panel.innerWidth).toBe(174);
		panel.setSize(300, 60);
		expect(panel.innerWidth).toBe(274);
	});

	it('hit tests a child where it is drawn', () => {
		const { child } = padded();
		expect(child.containsScreenPoint(23 + 5, 33 + 5)).toBe(true);
		expect(child.containsScreenPoint(10 + 5, 20 + 5)).toBe(false);
	});

	it('reports the child at the padded origin in the tree snapshot', () => {
		const { root } = padded();
		const [snapshotRoot] = treeSnapshot([root], { width: 1440, height: 882 }).roots;
		const childNode = snapshotRoot.children[0].children[0];
		expect(childNode.id).toBe('child');
		expect(childNode.screenBounds).toEqual({ x: 23, y: 33, w: 30, h: 10 });
	});

	it('scrolls the padding with the content: the extent is content plus both paddings (R4.13)', () => {
		const { panel, root } = padded({ scrollable: true });
		panel.addChild(new Rectangle({ id: 'last', x: 0, y: 390, width: 30, height: 10 }));
		panel.setContentSize(174, 400);
		panel.scroll(0, 10000);
		expect(panel.getScrollOffset().y).toBe(400 + 26 - 120);

		frame(root);
		// Scrolled to the end, the last row's bottom sits one padding above the panel's bottom.
		expect(rectById('last').transform[5] + 10).toBe(20 + 120 - 13);
	});

	it('clips a padded scroller inside its corner radius, in the walk, the hit test and the snapshot', () => {
		// Panel's default radius is 5 and its default border 1, so the inset is 5.
		const { panel, child, root } = padded({ scrollable: true });
		expect(panel.clipRect).toEqual({ x: 5, y: 5, width: 190, height: 110 });

		frame(root);
		expect(rectById('child').clip).toEqual({
			kind: 'rect',
			rect: { minX: 15, minY: 25, maxX: 205, maxY: 135 },
			rounded: null,
		});

		child.setPosition(-13, -13);
		expect(child.containsScreenPoint(14, 24)).toBe(false);
		expect(child.containsScreenPoint(15, 25)).toBe(true);

		const [snapshotRoot] = treeSnapshot([root], { width: 1440, height: 882 }).roots;
		expect(snapshotRoot.children[0].children[0].clip).toEqual({ x: 15, y: 25, w: 190, h: 110 });
	});

	it('clips inside a border wider than the radius', () => {
		const panel = new Panel({ width: 200, height: 120, padding: 13, scrollable: true, style: { borderWidth: 8, borderRadius: 3 } });
		expect(panel.clipRect).toEqual({ x: 8, y: 8, width: 184, height: 104 });
	});

	it('clamps a horizontal padded scroll to the content plus both paddings (R4.13)', () => {
		const panel = new Panel({ width: 200, height: 120, padding: 13, scrollable: true, scrollDirection: 'horizontal' });
		panel.setContentSize(500, 94);
		panel.scroll(10000, 0);
		expect(panel.getScrollOffset()).toEqual({ x: 500 + 26 - 200, y: 0 });
		expect(panel.contentOffset).toEqual({ x: 500 + 26 - 200 - 13, y: -13 });
		panel.scroll(-10000, 0);
		expect(panel.getScrollOffset().x).toBe(0);
	});

	it('defaults to no inset and the border-box clip', () => {
		const panel = new Panel({ width: 200, height: 120, scrollable: true });
		expect(panel.padding).toBe(0);
		expect(panel.innerWidth).toBe(200);
		expect(panel.contentOffset).toEqual({ x: 0, y: 0 });
		expect(panel.clipRect).toEqual({ x: 0, y: 0, width: 200, height: 120 });
	});
});
