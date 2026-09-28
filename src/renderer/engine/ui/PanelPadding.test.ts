/**
 * @jest-environment jsdom
 */
import { DrawApi, RecordingBackend, RectCommand } from '../draw';
import { Layer } from '../components/Layer';
import { Rectangle } from '../components/Rectangle';
import { RendererContext } from '../rendering/RendererContext';
import { treeSnapshot } from '../debug/treeSnapshot';
import { Panel } from './Panel';

/**
 * The `padding` option: children are placed against the content box, inset
 * from the border box on every side (R12.19), in drawing, hit testing and
 * the tree snapshot alike.
 */

let backend: RecordingBackend;
let api: DrawApi;

beforeEach(() => {
	backend = new RecordingBackend({ maxFrames: 1 });
	api = new DrawApi({ backend, strict: true });
	RendererContext.getInstance().draw = api;
});

function frame(root: Layer): void {
	api.beginFrame({ viewport: { width: 1440, height: 882 }, ratio: 1 });
	root.render();
	api.endFrame();
}

function rectById(id: string): RectCommand {
	const command = backend.commands.find((candidate) => candidate.id === id);
	if (!command || command.kind !== 'rect') throw new Error(`no rect '${id}' was drawn`);
	return command;
}

function padded(options: { scrollable?: boolean } = {}): { panel: Panel; child: Rectangle; root: Layer } {
	const root = new Layer({ id: 'root', width: 1440, height: 882 });
	const panel = new Panel({ id: 'panel', x: 10, y: 20, width: 200, height: 120, padding: 13, ...options });
	const child = new Rectangle({ id: 'child', x: 0, y: 0, width: 30, height: 10 });
	panel.addChild(child);
	root.addChild(panel);
	return { panel, child, root };
}

describe('Panel padding (R12.19)', () => {
	it('draws a child at (0, 0) at the content box origin, and the background at the border box', () => {
		const { root } = padded();
		frame(root);

		expect(rectById('child').rect).toMatchObject({ x: 23, y: 33 });
		const background = backend.commands.find((command) => command.kind === 'rect' && command.id === null);
		expect(background?.kind === 'rect' && background.rect).toMatchObject({ x: 10, y: 20, width: 200, height: 120 });
	});

	it('sizes the content box inside the border box, and keeps it there across setSize and layout', () => {
		const { panel } = padded();
		expect(panel.padding).toBe(13);
		expect(panel.innerWidth).toBe(174);
		expect(panel.getContentLayer().height).toBe(94);

		panel.setSize(300, 60);
		panel.layout();
		const content = panel.getContentLayer();
		expect([content.x, content.y, content.width, content.height]).toEqual([13, 13, 274, 34]);
	});

	it('hit tests a child where it is drawn', () => {
		const { child } = padded();
		expect(child.containsPoint(23 + 5, 33 + 5)).toBe(true);
		expect(child.containsPoint(10 + 5, 20 + 5)).toBe(false);
	});

	it('reports the child at the content box in the tree snapshot', () => {
		const { root } = padded();
		const [snapshotRoot] = treeSnapshot([root], { width: 1440, height: 882 }).roots;
		const panelNode = snapshotRoot.children[0];
		const contentNode = panelNode.parts?.find((part) => part.children.length > 0);
		expect(contentNode?.screenBounds).toEqual({ x: 23, y: 33, w: 174, h: 94 });
		expect(contentNode?.children[0].screenBounds).toEqual({ x: 23, y: 33, w: 30, h: 10 });
	});

	it('scrolls to the end of the content against the content box, not the border box', () => {
		const { panel } = padded({ scrollable: true });
		panel.setContentSize(174, 400);
		panel.scroll(0, 10000);
		expect(panel.getScrollOffset().y).toBe(400 - 94);
	});

	it('defaults to no inset', () => {
		const panel = new Panel({ width: 200, height: 120 });
		expect(panel.padding).toBe(0);
		expect(panel.innerWidth).toBe(200);
		const content = panel.getContentLayer();
		expect([content.x, content.y]).toEqual([0, 0]);
	});
});
