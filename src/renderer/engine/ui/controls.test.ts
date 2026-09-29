/**
 * @jest-environment jsdom
 */
import { Clock } from '../animation/Clock';
import type { Component } from '../components/Component';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { renderTree } from '../components/renderTree';
import { Stack } from '../components/Stack';
import type { Text } from '../components/Text';
import { createTestContext, injectNow } from '../components/testing';
import type { CircleCommand, DrawCommand, RectCommand, TextCommand } from '../draw';
import { NO_MODIFIERS } from '../input/events';
import { PointerAdapter } from '../input/PointerAdapter';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../text/testing';
import { ICON_CODE_POINTS } from '../text/icons';
import { tokens } from '../theme/tokens';
import { over } from '../style/look';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { treeSnapshot } from '../debug/treeSnapshot';
import { FocusGroup } from './FocusGroup';
import { ListRow } from './ListRow';
import { RadioGroup } from './RadioGroup';
import { Toggle } from './Toggle';

/**
 * R12.7 to R12.9, R12.34, and R12.35 on the dispatcher: every interaction
 * is injected at a mounted root (R9.25), never a handler called directly,
 * and every draw is read from a recording backend with the committed font
 * metrics, so hug sizes are the real ones.
 */

const { color } = tokens;

let canvas: HTMLCanvasElement;
let context: MountContext;
let adapter: PointerAdapter;
let backend: MeasuringRecordingBackend;
let root: Container;

function inject(...commands: string[]): void {
	expect(injectNow({ canvas, dispatcher: context.dispatcher }, commands).ok).toBe(true);
}

function key(name: string): void {
	context.dispatcher.enqueue({ kind: 'key', phase: 'down', key: name, repeat: false, modifiers: NO_MODIFIERS });
	context.dispatcher.enqueue({ kind: 'key', phase: 'up', key: name, repeat: false, modifiers: NO_MODIFIERS });
	context.dispatcher.dispatchPending();
}

function commands(): readonly DrawCommand[] {
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
	root = new Container({ id: 'root', width: 800, height: 600 });
	root.mount(context);
});

afterEach(() => {
	root.unmount();
	adapter.detach();
	document.body.removeChild(canvas);
});

describe('Button press machine (R12.7)', () => {
	function button(options = {}): { button: Button; clicks: number[] } {
		const clicks: number[] = [];
		const made = new Button('Go', { id: 'go', x: 100, y: 100, width: 120, height: 40, onClick: () => clicks.push(1), ...options });
		root.addChild(made);
		context.frame.layout();
		return { button: made, clicks };
	}

	it('captures on press, so the release comes back to it and does not click outside', () => {
		const { button: made, clicks } = button();
		inject('move,160,120', 'down,160,120');
		expect(context.dispatcher.captorOf(1)).toBe(made);
		inject('move,400,400', 'up,400,400');
		expect(clicks).toHaveLength(0);
		expect(context.dispatcher.captorOf(1)).toBeNull();
	});

	it('shows pressed again when the pointer comes back, and clicks on a release there', () => {
		const { button: made, clicks } = button();
		inject('move,160,120', 'down,160,120', 'move,400,400');
		expect(made.pressed).toBe(false);
		inject('move,170,125');
		expect(made.pressed).toBe(true);
		inject('up,170,125');
		expect(clicks).toHaveLength(1);
		expect(made.pressed).toBe(false);
	});

	it('clicks after a wandering press that ends on it, as the dispatcher decided (R9.31 departure)', () => {
		const { clicks } = button();
		inject('move,105,105', 'down,105,105', 'move,215,135', 'up,215,135');
		expect(clicks).toHaveLength(1);
	});

	it('does not let a released-outside press click a button beneath the release', () => {
		const other: number[] = [];
		root.addChild(new Button('Other', { x: 300, y: 100, width: 120, height: 40, onClick: () => other.push(1) }));
		const { clicks } = button();
		inject('move,160,120', 'down,160,120', 'move,360,120', 'up,360,120');
		expect(clicks).toHaveLength(0);
		expect(other).toHaveLength(0);
	});

	it('stops showing pressed once its press becomes a drag with a separate ghost (R9.12)', () => {
		const ghost = new Container({ id: 'ghost', x: 0, y: 0, width: 10, height: 10 });
		root.addChild(ghost);
		const { button: made, clicks } = button();
		made.onPointerDown = (event) => {
			context.drag.start({ event, source: made, ghost, data: 'x' });
		};
		inject('move,160,120', 'down,160,120');
		expect(made.pressed).toBe(true);
		inject('move,200,160');
		expect(context.drag.isDragging).toBe(true);
		inject('move,165,122', 'move,160,120');
		expect(context.drag.isDragging).toBe(true);
		expect(made.pressed).toBe(false);
		inject('up,160,120');
		expect(clicks).toHaveLength(0);
		expect(context.dispatcher.captorOf(1)).toBeNull();
	});

	it('lets the innermost pressable take a press, and a click outside it still reach the outer one', () => {
		const outerClicks: number[] = [];
		const outer = new ListRow({ label: 'Row', x: 100, y: 300, width: 300, height: 40, pointerEvents: 'auto', onClick: () => outerClicks.push(1) });
		const innerClicks: number[] = [];
		const inner = new Button('Inner', { x: 200, y: 5, width: 80, height: 30, onClick: () => innerClicks.push(1) });
		outer.addChild(inner);
		root.addChild(outer);
		context.frame.layout();
		inject(`move,${centre(inner)}`, `down,${centre(inner)}`);
		expect(context.dispatcher.captorOf(1)).toBe(inner);
		expect(outer.pressed).toBe(false);
		inject(`up,${centre(inner)}`);
		expect(innerClicks).toHaveLength(1);
		expect(outerClicks).toHaveLength(0);
		inject('click,130,320');
		expect(outerClicks).toHaveLength(1);
		expect(innerClicks).toHaveLength(1);
	});

	it('bubbles a cancel from the captor, so an ancestor hears the gesture end (R9.10)', () => {
		const holder = new Container({ id: 'holder', width: 800, height: 600 });
		const heard: string[] = [];
		holder.onPointerDown = () => heard.push('down');
		holder.handleEvent = ((base) => function (this: Container, event) {
			if (event.type === 'pointercancel') heard.push('cancel');
			base.call(this, event);
		})(holder.handleEvent);
		root.addChild(holder);
		const made = new Button('Go', { x: 100, y: 100, width: 120, height: 40 });
		holder.addChild(made);
		context.frame.layout();
		inject('move,160,120', 'down,160,120');
		window.dispatchEvent(new FocusEvent('blur'));
		context.dispatcher.dispatchPending();
		expect(heard).toEqual(['down', 'cancel']);
		expect(made.pressed).toBe(false);
	});

	it('takes the R12.7 options: disabled, block, and onClick', () => {
		const { button: made, clicks } = button({ disabled: true });
		expect(made.enabled).toBe(false);
		inject('click,160,120');
		expect(clicks).toHaveLength(0);
		const stack = new Stack({ width: 300, crossAlign: 'start' });
		const block = new Button('Wide', { block: true });
		stack.addChild(block);
		root.addChild(stack);
		context.frame.layout();
		expect(block.widthMode).toBe('fill');
		expect(block.width).toBe(300);
	});

	it('places the icon after the label with iconPosition right, and alone, centred, with only', () => {
		const right = new Button('Next', { x: 0, y: 0, width: 160, icon: 'settings', iconPosition: 'right' });
		const only = new Button('Settings', { x: 0, y: 50, width: 40, icon: 'settings', iconPosition: 'only' });
		root.addChild(right);
		root.addChild(only);
		context.frame.layout();
		const [label, icon] = right.getChildren() as [Text, Component];
		const measured = label.measured?.width ?? 0;
		const glyphsEnd = label.x + label.width / 2 + measured / 2;
		expect(icon.x).toBeGreaterThanOrEqual(Math.floor(glyphsEnd));
		// Label, gap, and icon are centred as one group.
		const groupStart = label.x + label.width / 2 - measured / 2;
		expect(Math.abs((groupStart + icon.x + icon.width) / 2 - 80)).toBeLessThanOrEqual(1);
		expect(right.iconPosition).toBe('right');
		const texts = commands().filter((command): command is TextCommand => command.kind === 'text');
		expect(texts.some((text) => text.text === 'Settings')).toBe(false);
		const onlyIcon = only.getChildren()[1];
		expect(onlyIcon.x + onlyIcon.width / 2).toBe(20);
		expect(() => new Button('X', { iconPosition: 'only' })).toThrow(/needs an icon/);
	});

	it('draws a ghost clear with the tone colour on its label, and washes it on hover', () => {
		const ghost = new Button('Quiet', { id: 'ghost', x: 100, y: 100, width: 120, ghost: true, tone: 'accent' });
		root.addChild(ghost);
		context.frame.layout();
		let rect = commands().find((command): command is RectCommand => command.kind === 'rect' && command.id === 'ghost') as RectCommand;
		expect(rect.fill).toEqual([0, 0, 0, 0]);
		expect(rect.border).toBeFalsy();
		expect(ghost.look.text).toEqual(color.accent);
		inject('move,160,115');
		context.animator.settle();
		rect = commands().find((command): command is RectCommand => command.kind === 'rect' && command.id === 'ghost') as RectCommand;
		expect(rect.fill).toEqual(over([0, 0, 0, 0], color.bg_hover));
	});
});

describe('ListRow (R12.8)', () => {
	function list(): { group: FocusGroup; rows: ListRow[]; clicks: string[] } {
		const clicks: string[] = [];
		const group = new FocusGroup({ id: 'list', x: 20, y: 20, width: 240, selection: 'single' });
		const rows = ['Alpha', 'Beta', 'Gamma'].map((label, index) => new ListRow({
			id: `row_${index}`,
			label,
			trailing: `${index + 1}`,
			onClick: () => clicks.push(label),
		}));
		rows.forEach((row) => group.addChild(row));
		root.addChild(group);
		context.frame.layout();
		return { group, rows, clicks };
	}

	it('spans its list at the small control height, label left, trailing mono text right', () => {
		const { rows } = list();
		expect(rows[0].width).toBe(240);
		expect(rows[0].height).toBe(tokens.control.control_h_sm);
		const texts = commands().filter((command): command is TextCommand => command.kind === 'text');
		expect(texts.find((text) => text.text === 'Alpha')).toMatchObject({ font: 'body', align: 'left' });
		expect(texts.find((text) => text.text === '1')).toMatchObject({ font: 'mono', color: color.text_dim });
		const [label, trailing] = rows[0].getChildren();
		expect(label.x).toBe(tokens.control.inset_row);
		expect(trailing.x + trailing.width).toBeCloseTo(240 - tokens.control.inset_row);
		expect(label.x + label.width).toBeLessThanOrEqual(trailing.x);
	});

	it('draws a hairline under every row, and the selected wash with a 2 px accent bar', () => {
		const { rows } = list();
		rows[1].selected = true;
		context.animator.settle();
		const rects = commands().filter((command): command is RectCommand => command.kind === 'rect');
		const hairlines = rects.filter((rect) => rect.rect.height === tokens.borderWidth.bw_hair && rect.rect.width === 240);
		expect(hairlines).toHaveLength(3);
		expect(rects.find((rect) => rect.id === 'row_1')?.fill).toEqual(color.bg_active);
		expect(rects.filter((rect) => rect.rect.width === tokens.borderWidth.bw_thick).map((rect) => rect.fill)).toEqual([color.accent]);
		expect(rows[1].look.text).toEqual(color.text_bright);
	});

	it('reports clicks and leaves selection to its list', () => {
		const { rows, clicks } = list();
		const alone = new ListRow({ label: 'Alone', x: 400, y: 20, width: 100 });
		root.addChild(alone);
		context.frame.layout();
		inject(`click,${centre(alone)}`);
		expect(alone.selected).toBe(false);
		inject(`click,${centre(rows[2])}`);
		expect(clicks).toEqual(['Gamma']);
		expect(rows[2].selected).toBe(true);
	});

	it('hovers with the wash and dims its text when dim', () => {
		const { rows } = list();
		inject(`move,${centre(rows[0])}`);
		context.animator.settle();
		expect(rows[0].look.fill).toEqual(over([0, 0, 0, 0], color.bg_hover));
		rows[0].dim = true;
		context.animator.settle();
		expect(rows[0].look.text).toEqual(color.text_dim);
	});

	it('draws its focus ring inside its box, so a list or a scroller never cuts it', () => {
		const { rows } = list();
		inject('keydown,Tab', 'keyup,Tab');
		expect(rows[0].focusVisible).toBe(true);
		const ring = commands().find((command): command is RectCommand => command.kind === 'rect' && command.border !== null && command.border !== undefined && command.border.width === tokens.control.focus_ring_width && command.border.color[0] === color.accent[0]);
		expect(ring?.border?.position).toBe('inside');
		expect(rows[0].inkExtent).toBe(0);
	});
});

describe('FocusGroup (R12.34)', () => {
	function group(options = {}): { group: FocusGroup; rows: ListRow[]; selections: string[][]; activations: string[] } {
		const selections: string[][] = [];
		const activations: string[] = [];
		const made = new FocusGroup({
			x: 20,
			y: 20,
			width: 200,
			selection: 'single',
			onSelect: (selected) => selections.push(selected.map((member) => (member as ListRow).labelText)),
			onActivate: (member) => activations.push((member as ListRow).labelText),
			...options,
		});
		const rows = ['One', 'Two', 'Three'].map((label) => new ListRow({ label }));
		rows.forEach((row) => made.addChild(row));
		// Level with the list's top, so no arrow from inside it can reach them directionally.
		root.addChild(new Button('Before', { x: 400, y: 0, width: 80 }));
		root.addChild(made);
		root.addChild(new Button('After', { x: 500, y: 0, width: 80 }));
		context.frame.layout();
		return { group: made, rows, selections, activations };
	}

	it('is one Tab stop, and arrows move between its members', () => {
		const { rows } = group();
		key('Tab');
		key('Tab');
		expect(rows[0].focused).toBe(true);
		key('ArrowDown');
		key('ArrowDown');
		expect(rows[2].focused).toBe(true);
		key('ArrowDown');
		expect(rows[2].focused).toBe(true);
		key('Tab');
		expect(context.focus.focused).not.toBe(rows[0]);
		expect(rows.some((row) => row.focused)).toBe(false);
	});

	it('comes back in at the member last focused', () => {
		const { rows } = group();
		key('Tab');
		key('Tab');
		key('ArrowDown');
		key('Tab');
		key('Tab');
		key('Tab');
		expect(rows[1].focused).toBe(true);
	});

	it('wraps when told to', () => {
		const { rows } = group({ wrap: true });
		key('Tab');
		key('Tab');
		key('ArrowUp');
		expect(rows[2].focused).toBe(true);
	});

	it('selects one member on click, firing onSelect only on a change', () => {
		const { rows, selections, group: made } = group();
		inject(`click,${centre(rows[1])}`);
		inject(`click,${centre(rows[1])}`);
		inject(`click,${centre(rows[2])}`);
		expect(selections).toEqual([['Two'], ['Three']]);
		expect(made.selectedMembers).toEqual([rows[2]]);
		expect(rows[1].selected).toBe(false);
	});

	it('toggles members in multiple mode', () => {
		const { rows, selections } = group({ selection: 'multiple' });
		inject(`click,${centre(rows[0])}`, `click,${centre(rows[2])}`, `click,${centre(rows[0])}`);
		expect(selections).toEqual([['One'], ['One', 'Three'], ['Three']]);
	});

	it('activates the focused member from Enter, selecting it too', () => {
		const { rows, selections, activations } = group();
		key('Tab');
		key('Tab');
		key('ArrowDown');
		key('Enter');
		expect(activations).toEqual(['Two']);
		expect(selections).toEqual([['Two']]);
		expect(rows[1].selected).toBe(true);
	});

	it('selects nothing by default or in none mode, and select() never fires onSelect', () => {
		expect(new FocusGroup().selection).toBe('none');
		const { rows, selections, group: made } = group({ selection: 'none' });
		inject(`click,${centre(rows[0])}`);
		expect(rows[0].selected).toBe(false);
		const single = new FocusGroup({ selection: 'single' });
		const a = new ListRow({ label: 'a' });
		const b = new ListRow({ label: 'b' });
		single.addChild(a);
		single.addChild(b);
		single.select([b, a]);
		expect(single.selectedMembers).toEqual([b]);
		expect(single.activeChild).toBe(b);
		expect(selections).toEqual([]);
		expect(made.selection).toBe('none');
	});

	it('leaves a toolbar button unselected after a click, by default', () => {
		const toolbar = new FocusGroup({ x: 20, y: 300, orientation: 'horizontal' });
		const tool = new Button('Tool', { width: 80 });
		toolbar.addChild(tool);
		root.addChild(toolbar);
		context.frame.layout();
		inject(`click,${centre(tool)}`);
		expect(tool.selected).toBe(false);
	});

	for (const selection of ['single', 'multiple', 'none'] as const) {
		it(`keeps checkboxes' values their own in ${selection} mode`, () => {
			const changes: string[] = [];
			const checklist = new FocusGroup({ x: 20, y: 300, selection });
			const a = new Checkbox({ label: 'A', checked: true, onChange: (checked) => changes.push(`A ${checked}`) });
			const b = new Checkbox({ label: 'B', onChange: (checked) => changes.push(`B ${checked}`) });
			checklist.addChild(a);
			checklist.addChild(b);
			root.addChild(checklist);
			context.frame.layout();
			inject(`click,${centre(b)}`);
			expect([a.checked, b.checked]).toEqual([true, true]);
			expect(changes).toEqual(['B true']);
			inject(`click,${centre(a)}`);
			expect([a.checked, b.checked]).toEqual([false, true]);
			expect(changes).toEqual(['B true', 'A false']);
			expect(checklist.selectedMembers).toEqual([]);
			expect(a.selected || b.selected).toBe(false);
		});
	}

	it('does not select on a press released outside the member', () => {
		const { rows, selections } = group();
		const [x, y] = centre(rows[0]).split(',');
		inject(`move,${x},${y}`, `down,${x},${y}`, 'move,600,500', 'up,600,500');
		expect(selections).toEqual([]);
	});
});

describe('Checkbox (R12.9)', () => {
	function checkbox(options = {}): { box: Checkbox; changes: boolean[] } {
		const changes: boolean[] = [];
		const box = new Checkbox({ id: 'check', x: 50, y: 50, label: 'Show damage numbers', onChange: (checked) => changes.push(checked), ...options });
		root.addChild(box);
		context.frame.layout();
		return { box, changes };
	}

	it('hugs its mark, a gap, and the measured label, at the size height', () => {
		const { box } = checkbox();
		const label = commands().find((command): command is TextCommand => command.kind === 'text' && command.text === 'Show damage numbers') as TextCommand;
		expect(box.height).toBe(tokens.control.control_h_md);
		expect(box.width).toBeCloseTo(tokens.control.icon_md + tokens.space.space_2 + (label.box?.width ?? NaN));
		expect(label.font).toBe('body');
	});

	it('toggles on a click anywhere on the row, the label included, and reports it after applying it', () => {
		const { box, changes } = checkbox();
		const seen: boolean[] = [];
		box.onChange = (checked) => seen.push(box.checked === checked);
		inject(`click,${Math.round(box.screenBounds.x + box.width - 4)},${centre(box).split(',')[1]}`);
		expect(box.checked).toBe(true);
		expect(seen).toEqual([true]);
		expect(changes).toEqual([]);
	});

	it('toggles on Space and not on Enter', () => {
		const { box, changes } = checkbox();
		key('Tab');
		expect(box.focusVisible).toBe(true);
		key(' ');
		expect(changes).toEqual([true]);
		key('Enter');
		expect(changes).toEqual([true]);
		key(' ');
		expect(changes).toEqual([true, false]);
	});

	it('reports its value in the snapshot state, mixed when indeterminate', () => {
		const { box } = checkbox({ indeterminate: true });
		const stateOf = () => treeSnapshot([root], { width: 800, height: 600 }).roots[0].children[0].state;
		expect(stateOf()?.checked).toBe('mixed');
		box.checked = true;
		expect(stateOf()?.checked).toBe(true);
		expect(stateOf()?.selected).toBe(false);
	});

	it('never fires onChange for a programmatic value', () => {
		const { box, changes } = checkbox();
		box.checked = true;
		box.indeterminate = true;
		expect(changes).toEqual([]);
	});

	it('becomes checked from indeterminate, and a programmatic checked clears indeterminate', () => {
		const { box, changes } = checkbox({ indeterminate: true });
		inject(`click,${centre(box)}`);
		expect(changes).toEqual([true]);
		expect(box.indeterminate).toBe(false);
		box.indeterminate = true;
		box.checked = false;
		expect(box.indeterminate).toBe(false);
	});

	it('draws the accent box with a check, a bar when indeterminate, and the well when off', () => {
		const { box } = checkbox();
		const icons = () => commands().filter((command): command is TextCommand => command.kind === 'text' && command.font === 'icons');
		const mark = () => commands().find((command): command is RectCommand => command.kind === 'rect' && command.id === 'check') as RectCommand;
		expect(mark().fill).toEqual(color.bg_inset);
		expect(icons()).toHaveLength(0);
		box.checked = true;
		context.animator.settle();
		expect(mark().fill).toEqual(color.accent);
		expect(icons()[0]).toMatchObject({ text: String.fromCodePoint(ICON_CODE_POINTS.check), color: color.accent_contrast });
		box.indeterminate = true;
		expect(icons()[0].text).toBe(String.fromCodePoint(ICON_CODE_POINTS.remove));
	});

	it('does nothing while disabled, and greys its label', () => {
		const { box, changes } = checkbox({ disabled: true });
		inject(`click,${centre(box)}`);
		expect(changes).toEqual([]);
		const label = commands().find((command): command is TextCommand => command.kind === 'text' && command.text === 'Show damage numbers');
		expect(label?.color).toEqual(color.text_disabled);
	});
});

describe('Toggle (R12.9)', () => {
	it('is a checkbox with a pill track, twice the mark wide, whose thumb slides over dur_fast', () => {
		const changes: boolean[] = [];
		const toggle = new Toggle({ id: 'toggle', x: 50, y: 50, label: 'Music', onChange: (checked) => changes.push(checked) });
		root.addChild(toggle);
		context.frame.layout();
		const track = () => commands().find((command): command is RectCommand => command.kind === 'rect' && command.id === 'toggle') as RectCommand;
		expect(track().rect).toMatchObject({ width: tokens.control.icon_md * 2, height: tokens.control.icon_md });
		inject(`click,${centre(toggle)}`);
		expect(changes).toEqual([true]);
		expect(toggle.thumb).toBe(0);
		context.frame.update(tokens.motion.dur_fast / 2000);
		expect(toggle.thumb).toBeGreaterThan(0);
		expect(toggle.thumb).toBeLessThan(1);
		context.frame.update(tokens.motion.dur_fast / 1000);
		expect(toggle.thumb).toBe(1);
		const thumb = commands().find((command): command is CircleCommand => command.kind === 'circle') as CircleCommand;
		expect(thumb.fill).toEqual(color.accent_contrast);
		expect(thumb.center.x).toBeCloseTo(tokens.control.icon_md * 2 - tokens.space.space_0_5 - thumb.radius);
	});

	it('jumps the thumb under reduced motion, and while unmounted', () => {
		const toggle = new Toggle({ label: 'Sound' });
		toggle.checked = true;
		expect(toggle.thumb).toBe(1);
		context.animator.reducedMotion = true;
		root.addChild(toggle);
		toggle.checked = false;
		context.frame.update(0);
		expect(toggle.thumb).toBe(0);
	});
});

describe('RadioGroup (R12.35)', () => {
	function radios(value: string | null = 'normal'): { group: RadioGroup; changes: string[] } {
		const changes: string[] = [];
		const group = new RadioGroup({
			id: 'difficulty',
			x: 40,
			y: 40,
			value,
			options: [
				{ label: 'Easy', value: 'easy' },
				{ label: 'Normal', value: 'normal' },
				{ label: 'Hard', value: 'hard', disabled: true },
				{ label: 'Brutal', value: 'brutal' },
			],
			onChange: (next) => changes.push(next),
		});
		root.addChild(new Button('Before', { x: 400, y: 20, width: 80 }));
		root.addChild(group);
		context.frame.layout();
		return { group, changes };
	}

	it('is one Tab stop entered at the selected radio', () => {
		const { group } = radios();
		key('Tab');
		key('Tab');
		expect(group.items[1].focused).toBe(true);
	});

	it('moves selection and focus together with the arrows, skipping disabled and wrapping', () => {
		const { group, changes } = radios();
		key('Tab');
		key('Tab');
		key('ArrowDown');
		expect(changes).toEqual(['brutal']);
		expect(group.items[3].focused).toBe(true);
		expect(group.value).toBe('brutal');
		key('ArrowRight');
		expect(changes).toEqual(['brutal', 'easy']);
		key('ArrowUp');
		expect(group.value).toBe('brutal');
		key('Home');
		expect(group.value).toBe('easy');
		expect(group.items.filter((radio) => radio.checked)).toEqual([group.items[0]]);
	});

	it('selects on a click and on Space, never deselecting, and fires only on change', () => {
		const { group, changes } = radios(null);
		inject(`click,${centre(group.items[0])}`);
		inject(`click,${centre(group.items[0])}`);
		expect(changes).toEqual(['easy']);
		key('ArrowDown');
		expect(group.value).toBe('normal');
		key(' ');
		expect(changes).toEqual(['easy', 'normal']);
	});

	it('never fires onChange for a programmatic value, and an unknown value selects nothing', () => {
		const { group, changes } = radios();
		group.value = 'easy';
		expect(group.items[0].checked).toBe(true);
		group.value = 'nightmare';
		expect(group.value).toBeNull();
		expect(group.items.some((radio) => radio.checked)).toBe(false);
		expect(changes).toEqual([]);
	});

	it('draws a round mark with a dot when checked', () => {
		radios();
		const circles = commands().filter((command): command is CircleCommand => command.kind === 'circle');
		expect(circles).toHaveLength(1);
		expect(circles[0].radius).toBe(tokens.control.icon_md / 4);
	});
});
