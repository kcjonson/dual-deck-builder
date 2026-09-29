/**
 * @jest-environment jsdom
 */
import { Clock } from '../animation/Clock';
import { Layer } from '../components/Layer';
import type { MountContext } from '../components/MountContext';
import { renderTree } from '../components/renderTree';
import { createTestContext, injectNow } from '../components/testing';
import type { DrawCommand, RectCommand, TextCommand } from '../draw';
import { NO_MODIFIERS } from '../input/events';
import { PointerAdapter } from '../input/PointerAdapter';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../text/testing';
import { tokens } from '../theme/tokens';
import { SegmentedControl } from './SegmentedControl';
import { Slider, SliderRange, positionToValue, snapToStep, valueToPosition } from './Slider';
import { TabBar } from './TabBar';

/**
 * R12.15 to R12.17 on the dispatcher, with the committed font metrics.
 * Worldsim's Slider suite is ported (the math, snapping, clamping, keys,
 * callbacks, re-entrancy, and the log fallback) with R12.15's controlled
 * semantics where the two differ: a programmatic `value` never fires.
 */

const { color, control } = tokens;

let canvas: HTMLCanvasElement;
let context: MountContext;
let adapter: PointerAdapter;
let backend: MeasuringRecordingBackend;
let root: Layer;

function inject(...commands: string[]): void {
	expect(injectNow({ canvas, dispatcher: context.dispatcher }, commands).ok).toBe(true);
}

function press(key: string): void {
	context.dispatcher.enqueue({ kind: 'key', phase: 'down', key, repeat: false, modifiers: NO_MODIFIERS });
	context.dispatcher.enqueue({ kind: 'key', phase: 'up', key, repeat: false, modifiers: NO_MODIFIERS });
	context.dispatcher.dispatchPending();
}

function draws(): readonly DrawCommand[] {
	const api = context.draw;
	api.beginFrame({ viewport: { width: 800, height: 600 } });
	renderTree(root, api);
	api.endFrame();
	return backend.commands;
}

function centre(component: { screenBounds: { x: number; y: number; width: number; height: number } }): string {
	const box = component.screenBounds;
	return `${Math.round(box.x + box.width / 2)},${Math.round(box.y + box.height / 2)}`;
}

beforeEach(() => {
	canvas = document.createElement('canvas');
	document.body.appendChild(canvas);
	const measuring = createMeasuringDrawApi();
	backend = measuring.backend;
	context = createTestContext({ draw: measuring.api, clock: new Clock() });
	adapter = new PointerAdapter({ dispatcher: context.dispatcher });
	adapter.attach(canvas);
	root = new Layer({ id: 'root', width: 800, height: 600 });
	root.mount(context);
});

afterEach(() => {
	root.unmount();
	adapter.detach();
	document.body.removeChild(canvas);
});

describe('Slider math (R12.15)', () => {
	const linear: SliderRange = { min: 0, max: 100, step: 0, logScale: false };
	const log: SliderRange = { min: 1, max: 1000, step: 0, logScale: true };

	it('maps linearly both ways and round-trips', () => {
		expect(valueToPosition(linear, 25)).toBe(0.25);
		expect(positionToValue(linear, 0.75)).toBe(75);
		for (const value of [0, 12.5, 50, 99]) expect(positionToValue(linear, valueToPosition(linear, value))).toBeCloseTo(value);
	});

	it('maps logarithmically, with the midpoint at the geometric mean', () => {
		expect(valueToPosition(log, 1)).toBe(0);
		expect(valueToPosition(log, 1000)).toBe(1);
		expect(positionToValue(log, 0)).toBe(1);
		expect(positionToValue(log, 1)).toBeCloseTo(1000);
		expect(positionToValue(log, 0.5)).toBeCloseTo(Math.sqrt(1000));
		for (const value of [1, 10, 316, 999]) expect(positionToValue(log, valueToPosition(log, value))).toBeCloseTo(value);
	});

	it('falls back to linear on invalid log bounds and never produces NaN', () => {
		const zero: SliderRange = { min: 0, max: 100, step: 0, logScale: true };
		expect(positionToValue(zero, 0.5)).toBe(50);
		expect(valueToPosition(zero, 50)).toBe(0.5);
		const negative: SliderRange = { min: -10, max: 10, step: 0, logScale: true };
		expect(positionToValue(negative, 0.5)).toBe(0);
		expect(Number.isNaN(valueToPosition(log, -5))).toBe(false);
		expect(valueToPosition(log, -5)).toBe(0);
		expect(valueToPosition({ min: 5, max: 5, step: 0, logScale: false }, 5)).toBe(0);
		expect(valueToPosition(linear, Number.NaN)).toBe(0);
	});

	it('snaps to the nearest step from min, clamped to the range', () => {
		const stepped: SliderRange = { min: 0, max: 1, step: 0.1, logScale: false };
		expect(snapToStep(stepped, 0.34)).toBe(0.3);
		expect(snapToStep(stepped, 0.36)).toBe(0.4);
		expect(snapToStep(stepped, 1.4)).toBe(1);
		expect(snapToStep(stepped, -0.2)).toBe(0);
		expect(snapToStep({ min: 5, max: 20, step: 5, logScale: false }, 12)).toBe(10);
		expect(snapToStep(linear, 150)).toBe(100);
	});
});

describe('Slider (R12.15)', () => {
	function slider(options: ConstructorParameters<typeof Slider>[0] = {}): { made: Slider; changes: number[] } {
		const changes: number[] = [];
		const made = new Slider({ id: 'volume', x: 100, y: 100, width: 200, min: 0, max: 100, onChange: (value) => changes.push(value), ...options });
		root.addChild(made);
		context.frame.layout();
		return { made, changes };
	}

	/** The screen x of value `value` on the track. */
	function xOf(made: Slider, value: number): number {
		const { left, right } = made.track;
		return made.screenBounds.x + left + valueToPosition({ min: made.min, max: made.max, step: made.step, logScale: made.logScale }, value) * (right - left);
	}

	it('constructs with defaults, clamped and snapped', () => {
		const made = new Slider();
		expect(made.min).toBe(0);
		expect(made.max).toBe(1);
		expect(made.value).toBe(0);
		expect(new Slider({ min: 0, max: 10, value: 12 }).value).toBe(10);
		expect(new Slider({ min: 0, max: 10, step: 2, value: 5.1 }).value).toBe(6);
	});

	it('clamps and snaps a programmatic value silently', () => {
		const { made, changes } = slider({ step: 10 });
		made.value = 43;
		expect(made.value).toBe(40);
		made.value = 400;
		expect(made.value).toBe(100);
		expect(changes).toEqual([]);
	});

	it('jumps on a track press, then drags with capture past its ends', () => {
		const { made, changes } = slider();
		const y = Math.round(made.screenBounds.y + made.height / 2);
		inject(`down,${Math.round(xOf(made, 50))},${y}`);
		expect(made.value).toBeCloseTo(50, 0);
		expect(made.pressed).toBe(true);
		inject(`move,${Math.round(xOf(made, 75))},${y + 80}`);
		expect(made.value).toBeCloseTo(75, 0);
		inject('move,700,40');
		expect(made.value).toBe(100);
		inject('up,700,40');
		expect(made.pressed).toBe(false);
		inject(`move,${Math.round(xOf(made, 20))},${y}`);
		expect(made.value).toBe(100);
		expect(changes.length).toBe(3);
		expect(changes[changes.length - 1]).toBe(100);
	});

	it('grabs the thumb where it was pressed, so a press on it does not move the value', () => {
		const { made, changes } = slider({ value: 40 });
		const y = Math.round(made.screenBounds.y + made.height / 2);
		const thumb = xOf(made, 40);
		inject(`down,${Math.round(thumb + 4)},${y}`);
		expect(made.value).toBe(40);
		expect(changes).toEqual([]);
		inject(`move,${Math.round(thumb + 4 + (xOf(made, 60) - thumb))},${y}`);
		expect(made.value).toBeCloseTo(60, 0);
		inject('up,0,0');
	});

	it('steps with the arrows by step or 1% of the track, and goes to the ends with Home and End', () => {
		const { made, changes } = slider({ value: 50 });
		press('Tab');
		press('ArrowRight');
		expect(made.value).toBeCloseTo(51);
		press('ArrowDown');
		press('ArrowLeft');
		expect(made.value).toBeCloseTo(49);
		press('Home');
		expect(made.value).toBe(0);
		press('ArrowLeft');
		press('End');
		expect(made.value).toBe(100);
		expect(changes.length).toBe(5);
		made.setRange({ step: 5 });
		press('ArrowLeft');
		expect(made.value).toBe(95);
	});

	it('steps a log slider evenly along its track', () => {
		const { made } = slider({ min: 1, max: 1000, logScale: true, value: 10 });
		press('Tab');
		press('ArrowUp');
		expect(made.value).toBeCloseTo(10 * Math.pow(1000, 0.01));
	});

	it('does not fire for a change that does not move the value', () => {
		const { made, changes } = slider({ value: 100 });
		press('Tab');
		press('End');
		press('ArrowUp');
		expect(made.value).toBe(100);
		expect(changes).toEqual([]);
	});

	it('keeps a value set from inside onChange, without firing again (R8.25)', () => {
		const changes: number[] = [];
		const { made } = slider({ step: 1 });
		made.onChange = (value) => {
			changes.push(value);
			made.value = 10;
		};
		press('Tab');
		press('ArrowRight');
		expect(changes).toEqual([1]);
		expect(made.value).toBe(10);
	});

	it('ignores keys and presses while disabled, and cannot take focus', () => {
		const { made, changes } = slider({ disabled: true, value: 30 });
		inject(`click,${centre(made)}`);
		press('Tab');
		press('ArrowRight');
		expect(made.canReceiveFocus()).toBe(false);
		expect(made.value).toBe(30);
		expect(changes).toEqual([]);
	});

	it('draws a pill track, the fill to the thumb, a detent tick, a glowing thumb, and its label and value', () => {
		const { made } = slider({ value: 25, detent: 0.5, label: 'Volume', valueFormatter: (value) => `${Math.round(value)}%`, width: 360 });
		const commands = draws();
		const rects = commands.filter((command): command is RectCommand => command.kind === 'rect');
		const texts = commands.filter((command): command is TextCommand => command.kind === 'text');
		expect(rects[0]).toMatchObject({ id: 'volume', fill: color.bg_inset });
		const fill = rects.find((rect) => String(rect.fill) === String(color.accent));
		const { left, right } = made.track;
		expect(fill?.rect.x).toBeCloseTo(left - control.icon_sm / 2);
		expect(fill?.rect.width).toBeCloseTo(left + 0.25 * (right - left) - (left - control.icon_sm / 2));
		expect(rects.some((rect) => rect.rect.width === tokens.borderWidth.bw_thick)).toBe(true);
		expect(commands.some((command) => command.kind === 'shadow')).toBe(true);
		expect(texts.map((text) => text.text)).toEqual(['Volume', '25%']);
		expect(texts[0]).toMatchObject({ font: 'mono', textTransform: 'uppercase' });
		expect(made.drawnText).toEqual(['Volume', '25%']);
	});
});

describe('TabBar (R12.16)', () => {
	const TABS = [
		{ id: 'garage', label: 'Garage' },
		{ id: 'deck', label: 'Deck' },
		{ id: 'map', label: 'Map', disabled: true },
		{ id: 'crew', label: 'Crew' },
	];

	function tabBar(options: Partial<ConstructorParameters<typeof TabBar>[0]> = {}): { bar: TabBar; picks: string[] } {
		const picks: string[] = [];
		const bar = new TabBar({ id: 'tabs', x: 100, y: 100, tabs: TABS, onSelect: (id) => picks.push(id), ...options });
		root.addChild(bar);
		context.frame.layout();
		return { bar, picks };
	}

	it('starts at the first enabled tab when uncontrolled, and hugs its measured caps labels', () => {
		const { bar } = tabBar({ tabs: [{ id: 'a', label: 'A', disabled: true }, ...TABS] });
		expect(bar.isControlled).toBe(false);
		expect(bar.selectedId).toBe('garage');
		const garage = bar.tabs[1];
		const measured = context.draw.measureText({ text: 'Garage', font: 'display', size: control.control_fs_md, letterSpacing: tokens.letterSpacing.ls_wide, textTransform: 'uppercase', wrap: 'none' });
		expect(garage.width).toBe(Math.ceil(measured.width) + control.inset_field * 2);
		expect(garage.height).toBe(control.control_h_md);
		expect(garage.drawnText).toEqual(['Garage']);
	});

	it('shows no selection for an unknown or disabled id when controlled', () => {
		const { bar } = tabBar({ selectedId: 'nowhere' });
		expect(bar.isControlled).toBe(true);
		expect(bar.selectedId).toBeNull();
		bar.selectedId = 'map';
		expect(bar.selectedId).toBeNull();
		expect(bar.tabs.some((tab) => tab.selected)).toBe(false);
		bar.selectedId = 'deck';
		expect(bar.tabs[1].selected).toBe(true);
	});

	it('selects on a release over the pressed tab, and never refires for the selected tab', () => {
		const { bar, picks } = tabBar();
		inject(`click,${centre(bar.tabs[1])}`);
		expect(bar.selectedId).toBe('deck');
		inject(`click,${centre(bar.tabs[1])}`);
		inject(`down,${centre(bar.tabs[3])}`, `move,${centre(bar.tabs[0])}`, `up,${centre(bar.tabs[0])}`);
		expect(bar.selectedId).toBe('deck');
		inject(`click,${centre(bar.tabs[2])}`);
		expect(bar.selectedId).toBe('deck');
		expect(picks).toEqual(['deck']);
	});

	it('is one Tab stop entered at the selection; Left and Right move focus and selection, skipping disabled and wrapping', () => {
		const { bar, picks } = tabBar({ selectedId: 'deck' });
		press('Tab');
		expect(bar.tabs[1].focused).toBe(true);
		press('ArrowRight');
		expect(bar.selectedId).toBe('crew');
		expect(bar.tabs[3].focused).toBe(true);
		press('ArrowRight');
		expect(bar.selectedId).toBe('garage');
		press('ArrowLeft');
		press('Home');
		press('End');
		expect(picks).toEqual(['crew', 'garage', 'crew', 'garage', 'crew']);
		expect(context.focus.tabOrder).toEqual([bar.tabs[3]]);
	});

	it('draws the hairline and the selected tab\'s 2 px accent underline', () => {
		const { bar } = tabBar();
		const rects = draws().filter((command): command is RectCommand => command.kind === 'rect');
		const hairline = rects.find((rect) => rect.id === 'tabs');
		expect(hairline?.rect.height).toBe(tokens.borderWidth.bw_hair);
		expect(hairline?.fill).toEqual(color.line_hairline);
		const underline = rects.find((rect) => String(rect.fill) === String(color.accent));
		expect(underline?.rect).toEqual({ x: 0, y: bar.tabs[0].height - tokens.borderWidth.bw_thick, width: bar.tabs[0].width, height: tokens.borderWidth.bw_thick });
	});
});

describe('SegmentedControl (R12.17)', () => {
	const OPTIONS = [
		{ label: 'Easy', value: 'easy' },
		{ label: 'Normal', value: 'normal' },
		{ label: 'Brutal', value: 'brutal', disabled: true },
		{ label: 'Hard', value: 'hard' },
	];

	function segmented(options: Partial<ConstructorParameters<typeof SegmentedControl<string>>[0]> = {}): { control: SegmentedControl<string>; changes: string[] } {
		const changes: string[] = [];
		const made = new SegmentedControl<string>({ id: 'difficulty', x: 100, y: 100, options: OPTIONS, selected: 'normal', onChange: (value) => changes.push(value), ...options });
		root.addChild(made);
		context.frame.layout();
		return { control: made, changes };
	}

	it('gives every segment the widest label\'s width, or segmentWidth, and hugs them', () => {
		const { control: made } = segmented();
		const widths = made.items.map((segment) => segment.width);
		expect(new Set(widths).size).toBe(1);
		const widest = Math.max(...OPTIONS.map((option) => Math.ceil(context.draw.measureText({ text: option.label, font: 'display', size: control.control_fs_md, letterSpacing: tokens.letterSpacing.ls_wide, textTransform: 'uppercase', wrap: 'none' }).width)));
		expect(widths[0]).toBe(widest + control.inset_row * 2);
		expect(made.width).toBe(widths[0] * 4 + tokens.space.space_0_5 * 2);
		// Every segment is the size's full control height, so a small one still meets the target size.
		expect(made.items[0].height).toBe(control.control_h_md);
		expect(made.height).toBe(control.control_h_md + tokens.space.space_0_5 * 2);
		const { control: fixed } = segmented({ segmentWidth: 90, y: 200 });
		expect(fixed.items.map((segment) => segment.width)).toEqual([90, 90, 90, 90]);
	});

	it('selects on a click, fires onChange once, and ignores disabled segments and programmatic changes', () => {
		const { control: made, changes } = segmented();
		made.value = 'easy';
		inject(`click,${centre(made.items[3])}`);
		inject(`click,${centre(made.items[3])}`);
		inject(`click,${centre(made.items[2])}`);
		expect(made.value).toBe('hard');
		expect(made.items[3].selected).toBe(true);
		expect(changes).toEqual(['hard']);
	});

	it('is one Tab stop at the selection; arrows move focus and selection, wrapping and skipping disabled', () => {
		const { control: made, changes } = segmented();
		press('Tab');
		expect(made.items[1].focused).toBe(true);
		press('ArrowRight');
		expect(made.value).toBe('hard');
		press('ArrowRight');
		expect(made.value).toBe('easy');
		press('End');
		expect(changes).toEqual(['hard', 'easy', 'hard']);
	});

	it('draws the inset well and the selected chip in the tone with its glow', () => {
		const { control: made } = segmented({ tone: 'data' });
		const commands = draws();
		const rects = commands.filter((command): command is RectCommand => command.kind === 'rect');
		expect(rects.find((rect) => rect.id === 'difficulty')?.fill).toEqual(color.bg_inset);
		const chip = rects.find((rect) => String(rect.fill) === String(color.data));
		expect(chip?.rect.width).toBe(made.items[1].width);
		expect(commands.some((command) => command.kind === 'shadow')).toBe(true);
		const label = commands.find((command): command is TextCommand => command.kind === 'text' && command.text === 'Normal');
		expect(label?.color).toEqual(color.accent_contrast);
	});
});
