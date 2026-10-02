/**
 * @jest-environment jsdom
 */
import { Clock } from '../animation/Clock';
import type { DrawCommand, RectCommand, ShadowCommand, TextCommand } from '../draw';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { renderTree } from '../components/renderTree';
import { Rectangle } from '../components/Rectangle';
import { createTestContext } from '../components/testing';
import { treeSnapshot } from '../debug/treeSnapshot';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../text/testing';
import { tokens } from '../theme/tokens';
import { Button } from './Button';
import { Panel, PanelOptions } from './Panel';

/**
 * R12.19's panel: the themed box and its variants, the content inset, the
 * header with its kicker, title, hairline, and actions, the corner ticks,
 * the glow, and the two content layouts, stacked and free. Laid out by the
 * frame and drawn into a recording backend with the committed font metrics.
 */

const { color } = tokens;

let backend: MeasuringRecordingBackend;
let context: MountContext;
let root: Container;

beforeEach(() => {
	const measuring = createMeasuringDrawApi();
	backend = measuring.backend;
	context = createTestContext({ draw: measuring.api, clock: new Clock() });
	root = new Container({ id: 'root', width: 1440, height: 882 });
	root.mount(context);
});

afterEach(() => root.unmount());

function mount(options: PanelOptions): Panel {
	const panel = new Panel({ id: 'panel', x: 10, y: 20, width: 200, height: 120, ...options });
	root.addChild(panel);
	context.frame.layout();
	return panel;
}

function frame(): readonly DrawCommand[] {
	const api = context.draw;
	api.beginFrame({ viewport: { width: 1440, height: 882 }, ratio: 1 });
	renderTree(root, api);
	api.endFrame();
	return backend.commands;
}

function same(a: readonly number[] | null, b: readonly number[]): boolean {
	return a !== null && a.length === b.length && a.every((value, index) => value === b[index]);
}

function rectById(id: string): RectCommand {
	const command = frame().find((candidate) => candidate.id === id);
	if (!command || command.kind !== 'rect') throw new Error(`no rect '${id}' was drawn`);
	return command;
}

describe('Panel box (R12.19)', () => {
	it('draws the panel variant from tokens by default', () => {
		mount({});
		expect(rectById('panel')).toMatchObject({
			fill: color.bg_panel,
			border: { color: color.line_edge, width: tokens.borderWidth.bw },
		});
	});

	it('draws raised with the raised shadow and inset as a well', () => {
		const raised = mount({ variant: 'raised' });
		const commands = frame();
		expect(commands.find((command) => command.kind === 'rect' && command.id === 'panel')).toMatchObject({ fill: color.bg_panel_raised });
		expect(commands.some((command) => command.kind === 'shadow')).toBe(true);
		expect(raised.inkExtent).toBeGreaterThan(0);
		root.removeChild(raised);
		mount({ variant: 'inset' });
		expect(rectById('panel').fill).toEqual(color.bg_inset);
	});

	it('glows in its accent colour', () => {
		const panel = mount({ glow: true, accent: 'data' });
		const shadow = frame().find((command): command is ShadowCommand => command.kind === 'shadow');
		expect(shadow?.shadow.color).toEqual(color.data_glow);
		expect(panel.inkExtent).toBeGreaterThan(0);
	});

	it('takes the closed style set and rejects the rest (R11.14)', () => {
		mount({ style: { backgroundColor: 'transparent', borderColor: '#4d4d4d', borderRadius: 5 } });
		expect(rectById('panel')).toMatchObject({ fill: [0, 0, 0, 0], radius: 5 });
		expect(() => new Panel({ style: { color: 'text' } })).toThrow(/does not render/);
		expect(() => new Panel({ style: { border: '1px solid red' } as never })).toThrow(/not a style property/);
	});

	it('draws four bracket ticks straddling the border in the accent colour, and none without an accent', () => {
		mount({ corners: true });
		const ticks = frame().filter((command): command is RectCommand => command.kind === 'rect' && command.id === null && same(command.fill, color.accent));
		expect(ticks).toHaveLength(8);
		const arms = ticks.map((tick) => [tick.rect.width, tick.rect.height].sort((a, b) => a - b));
		for (const arm of arms) expect(arm).toEqual([tokens.borderWidth.bw_thick, tokens.space.space_2]);
		root.clearChildren();
		mount({ corners: true, accent: 'none' });
		expect(frame().filter((command) => command.kind === 'rect' && command.id === null)).toHaveLength(0);
	});
});

describe('Panel content (R12.19)', () => {
	it('stacks its children in a column inside the default inset', () => {
		const panel = mount({ gap: 4 });
		const first = new Rectangle({ id: 'first', width: 30, height: 10 });
		const second = new Rectangle({ id: 'second', width: 30, height: 10 });
		panel.addChild(first);
		panel.addChild(second);
		context.frame.layout();
		const inset = tokens.space.space_4;
		expect(first.screenBounds).toMatchObject({ x: 10 + inset, y: 20 + inset });
		expect(second.screenBounds).toMatchObject({ x: 10 + inset, y: 20 + inset + 14 });
		expect(panel.contentInset).toEqual({ top: inset, right: inset, bottom: inset, left: inset });
		expect(panel.innerWidth).toBe(200 - inset * 2);
	});

	it('uses a smaller inset when compact, and when flush and not clipping only the border and corner radius (R12.19)', () => {
		expect(new Panel({ compact: true }).contentInset.left).toBe(tokens.space.space_2);
		const edge = Math.max(tokens.borderWidth.bw, tokens.radius.radius_panel);
		expect(new Panel({ flush: true }).contentInset).toEqual({ top: edge, right: edge, bottom: edge, left: edge });
		expect(new Panel({ style: { padding: 0, borderRadius: 8, borderWidth: 2 } }).contentInset.left).toBe(8);
		expect(new Panel({ style: { padding: 13 } }).contentInset).toEqual({ top: 13, right: 13, bottom: 13, left: 13 });
	});

	it('leaves children where they were put, inside the inset, with a free layout', () => {
		const panel = mount({ layout: 'free', style: { padding: 13 } });
		const child = new Rectangle({ id: 'child', x: 0, y: 0, width: 30, height: 10 });
		const moved = new Rectangle({ id: 'moved', x: 50, y: 40, width: 30, height: 10 });
		panel.addChild(child);
		panel.addChild(moved);
		context.frame.layout();
		expect(child.screenBounds).toMatchObject({ x: 23, y: 33 });
		expect(moved.screenBounds).toMatchObject({ x: 73, y: 73 });
		expect(child.containsScreenPoint(23 + 5, 33 + 5)).toBe(true);
		expect(child.containsScreenPoint(10 + 5, 20 + 5)).toBe(false);
		const [snapshotRoot] = treeSnapshot([root], { width: 1440, height: 882 }).roots;
		expect(snapshotRoot.children[0].children[0].screenBounds).toEqual({ x: 23, y: 33, w: 30, h: 10 });
	});

	it('clips at the border with a rounded clip concentric with the corner when its overflow is hidden (R4.14)', () => {
		const panel = mount({ layout: 'free', overflow: 'hidden', style: { padding: 13, borderRadius: 5 } });
		const child = new Rectangle({ id: 'child', x: -13, y: -13, width: 30, height: 10 });
		panel.addChild(child);
		context.frame.layout();
		expect(panel.clipRect).toEqual({ x: 1, y: 1, width: 198, height: 118 });
		expect(panel.clipRadius).toBe(4);
		const rect = { minX: 11, minY: 21, maxX: 209, maxY: 139 };
		expect(rectById('child').clip).toEqual({ kind: 'rect', rect, rounded: { rect, radius: 4 } });
		// Inside the rect but in the cut corner (R4.12), then just inside the arc.
		expect(child.containsScreenPoint(11.5, 21.5)).toBe(false);
		expect(child.containsScreenPoint(10.5, 25)).toBe(false);
		expect(child.containsScreenPoint(13, 23)).toBe(true);
		expect(child.containsScreenPoint(11.5, 29)).toBe(true);
		expect(new Panel({ width: 200, height: 120, style: { padding: 13, borderWidth: 8, borderRadius: 3 } }).clipRect)
			.toEqual({ x: 8, y: 8, width: 184, height: 104 });
		expect(new Panel({ width: 200, height: 120, style: { padding: 13, borderWidth: 8, borderRadius: 3 } }).clipRadius).toBe(0);
	});

	it('insets content to the border when it clips, and past the corner radius when it does not (R12.19)', () => {
		const bw = tokens.borderWidth.bw;
		const radius = tokens.radius.radius_panel;
		const clipping = new Panel({ width: 200, height: 120, flush: true, overflow: 'hidden' });
		expect(clipping.contentInset).toEqual({ top: bw, right: bw, bottom: bw, left: bw });
		expect(clipping.clipRect).toEqual({ x: bw, y: bw, width: 200 - bw * 2, height: 120 - bw * 2 });
		const open = new Panel({ width: 200, height: 120, flush: true });
		const edge = Math.max(bw, radius);
		expect(open.contentInset).toEqual({ top: edge, right: edge, bottom: edge, left: edge });
		open.overflow = 'hidden';
		expect(open.contentInset).toEqual({ top: bw, right: bw, bottom: bw, left: bw });
		expect(open.padding).toEqual({ top: bw, right: bw, bottom: bw, left: bw });
		open.overflow = 'visible';
		expect(open.contentInset.left).toBe(edge);
	});

	it('clips a zero-sized panel to nothing (DDB-234)', () => {
		const panel = mount({ layout: 'free', overflow: 'hidden', width: 0, height: 0, widthMode: 'fixed', heightMode: 'fixed' });
		expect(panel.width).toBe(0);
		panel.addChild(new Rectangle({ id: 'child', width: 30, height: 10 }));
		context.frame.layout();
		expect(frame().some((command) => command.id === 'child')).toBe(false);
	});

	it('occludes what is beneath it (pointerEvents auto)', () => {
		expect(new Panel().pointerEvents).toBe('auto');
	});
});

describe('Panel header (R12.19)', () => {
	it('draws no header, and no hairline, without a title or kicker', () => {
		const panel = mount({});
		expect(panel.header).toBe(0);
		expect(frame().filter((command) => command.kind === 'rect')).toHaveLength(1);
	});

	it('draws the kicker over the title, a hairline under the band, and starts the content below it', () => {
		const panel = mount({ title: 'Garage', kicker: 'Wasteland outpost' });
		const content = new Rectangle({ id: 'content', width: 30, height: 10 });
		panel.addChild(content);
		context.frame.layout();
		const commands = frame();
		const texts = commands.filter((command): command is TextCommand => command.kind === 'text');
		const kicker = texts.find((text) => text.text === 'Wasteland outpost') as TextCommand;
		const title = texts.find((text) => text.text === 'Garage') as TextCommand;
		expect(kicker).toMatchObject({ font: 'mono', color: color.accent, textTransform: 'uppercase' });
		expect(title).toMatchObject({ font: 'display', color: color.text_bright });
		expect(title.transform[5]).toBeGreaterThan(kicker.transform[5]);
		const hairline = commands.find((command): command is RectCommand => command.kind === 'rect' && same(command.fill, color.line_hairline));
		expect(hairline?.rect.y).toBe(panel.header - tokens.borderWidth.bw_hair);
		expect(content.screenBounds.y).toBe(20 + panel.header + tokens.space.space_4);
		// The header's parts are the panel's own, not flowed content.
		expect(panel.children.filter((child) => child.isPart)).toHaveLength(2);
		expect(panel.flows(content)).toBe(true);
	});

	it('lays out actions right to left at the header\'s right end, out of the flow', () => {
		const close = new Button('Close', { id: 'close', width: 60, size: 'sm' });
		const pin = new Button('Pin', { id: 'pin', width: 40, size: 'sm' });
		const panel = mount({ title: 'Card', actions: [pin, close] });
		expect(close.screenBounds.x + close.width).toBe(10 + 200 - tokens.space.space_4);
		expect(pin.screenBounds.x + pin.width).toBe(close.screenBounds.x - tokens.space.space_2);
		expect(Math.abs(close.screenBounds.y + close.height / 2 - (20 + panel.header / 2))).toBeLessThanOrEqual(0.5);
		expect(panel.flows(close)).toBe(false);
		expect(panel.actions).toEqual([pin, close]);
		expect(() => new Panel({ actions: [new Button('x')] })).toThrow(/needs a title or kicker/);
	});

	it('updates its title in place', () => {
		const panel = mount({ title: 'Before' });
		panel.title = 'After';
		expect(frame().some((command) => command.kind === 'text' && command.text === 'After')).toBe(true);
		expect(() => {
			new Panel().title = 'x';
		}).toThrow(/no header/);
	});
});
