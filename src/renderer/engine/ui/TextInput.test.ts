/**
 * @jest-environment jsdom
 */
import { Clock } from '../animation/Clock';
import { Layer } from '../components/Layer';
import type { MountContext } from '../components/MountContext';
import { renderTree } from '../components/renderTree';
import { createTestContext, injectNow } from '../components/testing';
import type { DrawCommand, RectCommand, TextCommand } from '../draw';
import { Modifiers, NO_MODIFIERS } from '../input/events';
import { PointerAdapter } from '../input/PointerAdapter';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../text/testing';
import { tokens } from '../theme/tokens';
import { NumberInput } from './NumberInput';
import { TextInput, TextInputOptions } from './TextInput';

/**
 * R12.10 and R12.36 on the dispatcher: every interaction is injected at a
 * mounted root (R9.25), and caret positions are checked against the draw
 * API's own advances with the committed font metrics.
 */

const { color, control } = tokens;
const FIELD_X = 100;
const FIELD_Y = 100;
const FIELD_WIDTH = 200;
const MIDDLE_Y = FIELD_Y + control.control_h_md / 2;
const TEXT_LEFT = FIELD_X + control.inset_field;

let canvas: HTMLCanvasElement;
let context: MountContext;
let adapter: PointerAdapter;
let backend: MeasuringRecordingBackend;
let clock: Clock;
let root: Layer;

function inject(...commands: string[]): void {
	expect(injectNow({ canvas, dispatcher: context.dispatcher }, commands).ok).toBe(true);
}

function press(key: string, modifiers: Partial<Modifiers> = {}): void {
	const mods = { ...NO_MODIFIERS, ...modifiers };
	context.dispatcher.enqueue({ kind: 'key', phase: 'down', key, repeat: false, modifiers: mods });
	context.dispatcher.enqueue({ kind: 'key', phase: 'up', key, repeat: false, modifiers: mods });
	context.dispatcher.dispatchPending();
}

function type(text: string): void {
	for (const character of text) press(character);
}

function wheel(x: number, y: number, deltaY: number): void {
	context.dispatcher.enqueue({ kind: 'wheel', x, y, deltaX: 0, deltaY, deltaMode: 0, modifiers: NO_MODIFIERS });
	context.dispatcher.dispatchPending();
}

/** Lets an asynchronous clipboard read land. */
async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function commands(): readonly DrawCommand[] {
	const api = context.draw;
	api.beginFrame({ viewport: { width: 800, height: 600 } });
	renderTree(root, api);
	api.endFrame();
	return backend.commands;
}

function field(options: TextInputOptions = {}): TextInput {
	const made = new TextInput({ id: 'field', x: FIELD_X, y: FIELD_Y, width: FIELD_WIDTH, ...options });
	root.addChild(made);
	context.frame.layout();
	return made;
}

/** The screen x of the boundary after `count` code points of `text`, unscrolled. */
function boundary(text: string, count: number): number {
	if (count === 0) return TEXT_LEFT;
	const { advances } = context.draw.measureText({ text, font: 'body', size: control.control_fs_md, wrap: 'none' });
	return TEXT_LEFT + advances[count - 1];
}

beforeEach(() => {
	canvas = document.createElement('canvas');
	document.body.appendChild(canvas);
	const measuring = createMeasuringDrawApi();
	backend = measuring.backend;
	clock = new Clock();
	context = createTestContext({ draw: measuring.api, clock });
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

describe('TextInput caret placement (R12.10)', () => {
	it('places the caret at the nearest glyph boundary under the press, and focuses', () => {
		const made = field({ value: 'Convoy' });
		const between = (boundary('Convoy', 2) + boundary('Convoy', 3)) / 2;
		inject(`click,${Math.round(between - 1)},${MIDDLE_Y}`);
		expect(made.focused).toBe(true);
		expect(made.caretIndex).toBe(2);
		inject(`click,${Math.round(between + 2)},${MIDDLE_Y}`);
		expect(made.caretIndex).toBe(3);
	});

	it('puts the caret at the start left of the text and at the end past it', () => {
		const made = field({ value: 'Rig' });
		inject(`click,${FIELD_X + 2},${MIDDLE_Y}`);
		expect(made.caretIndex).toBe(0);
		inject(`click,${FIELD_X + FIELD_WIDTH - 4},${MIDDLE_Y}`);
		expect(made.caretIndex).toBe(3);
	});

	it('draws the caret at the pen position of its boundary, spanning the line box, while focused', () => {
		const made = field({ value: 'Hello ' });
		inject(`click,${FIELD_X + FIELD_WIDTH - 4},${MIDDLE_Y}`);
		const caret = commands().filter((command): command is RectCommand => command.kind === 'rect').at(-1);
		// The trailing space counts: the caret is past it, not at the o.
		expect(made.caretX).toBeCloseTo(boundary('Hello ', 6) - FIELD_X);
		expect(caret?.rect.x).toBeCloseTo(boundary('Hello ', 6) - FIELD_X);
		expect(caret?.rect.y).toBeCloseTo(control.control_h_md / 2 - (caret?.rect.height ?? 0) / 2);
		expect(caret?.fill).toEqual(color.text);
	});
});

describe('TextInput selection (R12.10)', () => {
	it('selects by dragging with capture, past the field\'s edge', () => {
		const made = field({ value: 'Dustbowl' });
		inject(`move,${boundary('Dustbowl', 1)},${MIDDLE_Y}`, `down,${boundary('Dustbowl', 1)},${MIDDLE_Y}`);
		inject(`move,${boundary('Dustbowl', 4)},${MIDDLE_Y}`);
		expect(made.selection).toEqual({ start: 1, end: 4 });
		inject(`move,700,${MIDDLE_Y + 80}`);
		expect(made.selection).toEqual({ start: 1, end: 8 });
		inject(`up,700,${MIDDLE_Y + 80}`);
		expect(made.selectedText).toBe('ustbowl');
	});

	it('draws the selection wash under the text only while focused', () => {
		const made = field({ value: 'Dustbowl' });
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		press('ArrowRight', { shift: true });
		press('ArrowRight', { shift: true });
		const washes = () => commands().filter((command): command is RectCommand => command.kind === 'rect' && String(command.fill) === String(color.bg_selection));
		expect(washes()).toHaveLength(1);
		expect(washes()[0].rect.width).toBeCloseTo(boundary('Dustbowl', 2) - TEXT_LEFT);
		context.focus.blur();
		expect(washes()).toHaveLength(0);
		expect(made.selection).toEqual({ start: 0, end: 2 });
	});

	it('extends with Shift and the arrows, Home and End, and collapses on a bare arrow', () => {
		const made = field({ value: 'Scrap' });
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		press('ArrowRight');
		press('ArrowRight', { shift: true });
		press('ArrowRight', { shift: true });
		expect(made.selectedText).toBe('cr');
		press('End', { shift: true });
		expect(made.selectedText).toBe('crap');
		press('ArrowLeft');
		expect(made.selection).toEqual({ start: 1, end: 1 });
		press('Home', { shift: true });
		expect(made.selectedText).toBe('S');
		press('ArrowRight');
		expect(made.caretIndex).toBe(1);
		press('End');
		expect(made.caretIndex).toBe(5);
		press('ArrowLeft', { meta: true });
		expect(made.caretIndex).toBe(0);
	});

	it('extends from the caret with a Shift press', () => {
		const made = field({ value: 'Convoy' });
		inject(`click,${Math.round(boundary('Convoy', 1))},${MIDDLE_Y}`);
		const at = { x: Math.round(boundary('Convoy', 4)), y: MIDDLE_Y, pointerId: 1, pointerType: 'mouse' as const, isPrimary: true, button: 0, pressure: 0.5, modifiers: { ...NO_MODIFIERS, shift: true } };
		context.dispatcher.enqueue({ kind: 'pointer', phase: 'down', buttons: 1, ...at });
		context.dispatcher.enqueue({ kind: 'pointer', phase: 'up', buttons: 0, ...at });
		context.dispatcher.dispatchPending();
		expect(made.selection).toEqual({ start: 1, end: 4 });
	});

	it('selects everything on focus with selectAllOnFocus, and a drag replaces it', () => {
		const made = field({ value: 'Rust Runner', selectAllOnFocus: true });
		press('Tab');
		expect(made.selectedText).toBe('Rust Runner');
		context.focus.blur();
		inject(`move,${boundary('Rust Runner', 5)},${MIDDLE_Y}`, `down,${boundary('Rust Runner', 5)},${MIDDLE_Y}`);
		expect(made.selectedText).toBe('Rust Runner');
		inject(`move,${boundary('Rust Runner', 11)},${MIDDLE_Y}`, `up,${boundary('Rust Runner', 11)},${MIDDLE_Y}`);
		expect(made.selectedText).toBe('Runner');
	});
});

describe('TextInput editing (R12.10)', () => {
	it('inserts over the selection, and Backspace and Delete take the selection first', () => {
		const changes: string[] = [];
		const made = field({ value: 'Scrap', onChange: (value) => changes.push(value) });
		inject(`click,${FIELD_X + FIELD_WIDTH - 4},${MIDDLE_Y}`);
		press('ArrowLeft', { shift: true });
		press('ArrowLeft', { shift: true });
		type('ew');
		expect(made.value).toBe('Screw');
		press('Home');
		press('Delete');
		expect(made.value).toBe('crew');
		press('End');
		press('Backspace');
		expect(made.value).toBe('cre');
		press('Home', { shift: true });
		press('Backspace');
		expect(made.value).toBe('');
		press('Backspace');
		press('Delete');
		expect(changes).toEqual(['Scre', 'Screw', 'crew', 'cre', '']);
	});

	it('treats an astral code point as one caret step, one character of maxLength, and one Backspace', () => {
		const car = '\u{1F697}';
		const made = field({ value: `a${car}b`, maxLength: 4 });
		expect(made.caretIndex).toBe(3);
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		press('End');
		press('ArrowLeft');
		expect(made.caretIndex).toBe(2);
		press('ArrowLeft', { shift: true });
		expect(made.selectedText).toBe(car);
		press('ArrowRight');
		press('Backspace');
		expect(made.value).toBe('ab');
		type(`${car}${car}${car}`);
		expect(made.value).toBe(`a${car}${car}b`);
		expect(made.value).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
	});

	it('never fires onChange for a programmatic value, and keeps it within maxLength', () => {
		const changes: string[] = [];
		const made = field({ value: 'abc', maxLength: 4, onChange: (value) => changes.push(value) });
		made.value = 'abcdefg';
		expect(made.value).toBe('abcd');
		expect(made.caretIndex).toBe(4);
		expect(changes).toEqual([]);
	});

	it('stops typing at maxLength and truncates a paste', async () => {
		const made = field({ maxLength: 5 });
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		type('abcdefg');
		expect(made.value).toBe('abcde');
		press('Backspace');
		press('Backspace');
		await context.clipboard.writeText('xyz');
		press('v', { ctrl: true });
		await settle();
		expect(made.value).toBe('abcxy');
	});

	it('asks the validator per code point, dropping the characters it refuses', async () => {
		const seen: [string, string][] = [];
		const made = field({
			validator: (next, inserted) => {
				seen.push([next, inserted]);
				return /^\d*$/.test(next);
			},
		});
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		type('1a2');
		expect(made.value).toBe('12');
		expect(seen).toEqual([['1', '1'], ['1a', 'a'], ['12', '2']]);
		await context.clipboard.writeText('3b4');
		press('v', { meta: true });
		await settle();
		expect(made.value).toBe('1234');
	});

	it('refuses a deletion the validator refuses', () => {
		const made = field({ value: '7', validator: (next) => next !== '' });
		inject(`click,${FIELD_X + FIELD_WIDTH - 4},${MIDDLE_Y}`);
		press('Backspace');
		expect(made.value).toBe('7');
	});

	it('fires onSubmit on Enter and keeps focus', () => {
		const submitted: string[] = [];
		const made = field({ value: 'Go', onSubmit: (value) => submitted.push(value) });
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		press('Enter');
		expect(submitted).toEqual(['Go']);
		expect(made.focused).toBe(true);
	});

	it('leaves Escape unconsumed, so a dialog or hotkey around the field hears it', () => {
		const made = field({ value: 'Go' });
		const heard: string[] = [];
		context.dispatcher.hotkeys.register('Escape', () => heard.push('escape'));
		root.onKeyDown = (event) => heard.push(`bubbled ${event.key}`);
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		press('Escape');
		expect(heard).toEqual(['bubbled Escape', 'escape']);
		expect(made.value).toBe('Go');
	});

	it('consumes printable keys, so neither a parent nor a hotkey sees them', () => {
		field();
		const heard: string[] = [];
		root.onKeyDown = (event) => heard.push(event.key);
		context.dispatcher.hotkeys.register('q', () => heard.push('hotkey'));
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		type('q');
		press('Backspace');
		expect(heard).toEqual([]);
	});
});

describe('TextInput clipboard (R12.10, R9.17)', () => {
	it('selects all, copies, cuts, and pastes through the context clipboard', async () => {
		const made = field({ value: 'Rust Runner' });
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		press('a', { meta: true });
		expect(made.selectedText).toBe('Rust Runner');
		press('c', { meta: true });
		expect(await context.clipboard.readText()).toBe('Rust Runner');

		press('Home');
		press('End', { shift: true });
		press('x', { ctrl: true });
		expect(made.value).toBe('');
		press('v', { ctrl: true });
		await settle();
		press('v', { ctrl: true });
		await settle();
		expect(made.value).toBe('Rust RunnerRust Runner');
	});

	it('strips control characters from a paste', async () => {
		const made = field();
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		await context.clipboard.writeText('Dust\tbowl\nConvoy\u0007\u009B');
		press('v', { ctrl: true });
		await settle();
		expect(made.value).toBe('DustbowlConvoy');
	});

	it('masks a password and will not copy or cut it', async () => {
		const made = field({ value: 'hunter2', password: true });
		await context.clipboard.writeText('unchanged');
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		press('a', { ctrl: true });
		press('c', { ctrl: true });
		press('x', { ctrl: true });
		expect(await context.clipboard.readText()).toBe('unchanged');
		expect(made.value).toBe('hunter2');
		expect(made.displayText).toBe('•'.repeat(7));
		const texts = commands().filter((command): command is TextCommand => command.kind === 'text');
		expect(texts.map((text) => text.text)).toEqual(['•'.repeat(7)]);
	});

	it('pastes nothing and reports no error when the clipboard refuses', async () => {
		const made = field({ value: 'kept' });
		jest.spyOn(context.clipboard, 'readText').mockRejectedValue(new Error('denied'));
		jest.spyOn(context.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
		const unhandled = jest.fn();
		process.on('unhandledRejection', unhandled);
		try {
			inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
			press('a', { ctrl: true });
			press('c', { ctrl: true });
			press('v', { ctrl: true });
			await settle();
			await settle();
		} finally {
			process.off('unhandledRejection', unhandled);
		}
		expect(made.value).toBe('kept');
		expect(unhandled).not.toHaveBeenCalled();
	});

	it('types the character AltGr makes, which Windows reports as Ctrl+Alt, and keeps it from the hotkeys', () => {
		const made = field();
		const heard: string[] = [];
		context.dispatcher.hotkeys.register('@', () => heard.push('hotkey'));
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		press('@', { ctrl: true, alt: true });
		press('€', { ctrl: true, alt: true });
		expect(made.value).toBe('@€');
		expect(heard).toEqual([]);
		expect(context.dispatcher.claimsKey('@', { ...NO_MODIFIERS, ctrl: true, alt: true })).toBe(true);
		// Ctrl+Alt with a named key is still a chord: Ctrl+Left goes to the start.
		press('ArrowLeft', { ctrl: true, alt: true });
		expect(made.caretIndex).toBe(0);
		expect(made.value).toBe('@\u20AC');
	});

	it('lets other Cmd and Ctrl chords through to the hotkeys', () => {
		field();
		const heard: string[] = [];
		context.dispatcher.hotkeys.register('s', () => heard.push('save'));
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		press('s', { ctrl: true });
		expect(heard).toEqual(['save']);
	});

	it('claims select-all from the browser while focused, so the page is not selected', () => {
		field();
		expect(context.dispatcher.claimsKey('a', { ...NO_MODIFIERS, meta: true })).toBe(false);
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		expect(context.dispatcher.claimsKey('a', { ...NO_MODIFIERS, meta: true })).toBe(true);
		expect(context.dispatcher.claimsKey('c', { ...NO_MODIFIERS, meta: true })).toBe(false);
	});
});

describe('TextInput scrolling and clipping (R12.10, R4.5)', () => {
	const LONG = 'Scrap Hauler, Rust Runner and the Dustbowl Convoy';

	it('scrolls to keep the caret visible, and back to zero when the text fits', () => {
		const made = field({ value: LONG });
		const visible = made.contentBox.width;
		expect(made.scrollOffset).toBeGreaterThan(0);
		expect(made.caretX).toBeLessThanOrEqual(control.inset_field + visible);
		expect(made.caretX).toBeGreaterThan(control.inset_field + visible - 4);

		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		press('Home');
		expect(made.scrollOffset).toBe(0);
		press('End');
		expect(made.scrollOffset).toBeGreaterThan(0);

		made.value = 'Short';
		expect(made.scrollOffset).toBe(0);
	});

	it('bounds the scrolled run in its cull ink, so the ink audit stays quiet (R4.2a)', () => {
		const made = field({ value: LONG });
		expect(made.scrollOffset).toBeGreaterThan(0);
		commands();
		expect(context.draw.diagnostics.filter((diagnostic) => diagnostic.code === 'ink-outside-bound')).toEqual([]);
	});

	it('clips its text to the padded content box', () => {
		field({ value: LONG });
		const text = commands().find((command): command is TextCommand => command.kind === 'text' && command.text === LONG);
		expect(text?.clip).toEqual({
			kind: 'rect',
			rect: { minX: TEXT_LEFT, minY: FIELD_Y, maxX: FIELD_X + FIELD_WIDTH - control.inset_field, maxY: FIELD_Y + control.control_h_md },
			rounded: null,
		});
	});
});

describe('TextInput caret blink (R12.10)', () => {
	it('blinks every caret_blink from the context clock, restarting on an edit', () => {
		const made = field();
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		expect(made.caretVisible).toBe(true);
		clock.advance(control.caret_blink);
		expect(made.caretVisible).toBe(false);
		clock.advance(control.caret_blink);
		expect(made.caretVisible).toBe(true);
		clock.advance(control.caret_blink);
		expect(made.caretVisible).toBe(false);
		type('a');
		expect(made.caretVisible).toBe(true);
		context.focus.blur();
		expect(made.caretVisible).toBe(false);
	});

	it('shows the editing state as the accent border while focused', () => {
		const made = field();
		expect(made.look.border).toEqual(color.line_edge);
		inject(`click,${FIELD_X + 4},${MIDDLE_Y}`);
		expect(made.active).toBe(true);
		context.frame.update(tokens.motion.dur_fast / 1000);
		expect(made.look.border).toEqual(color.accent);
	});
});

describe('NumberInput (R12.36)', () => {
	const STEPPER_X = FIELD_X + 120 - 10;

	function stepper(options: ConstructorParameters<typeof NumberInput>[0] = {}): { input: NumberInput; changes: number[] } {
		const changes: number[] = [];
		const input = new NumberInput({ id: 'number', x: FIELD_X, y: FIELD_Y, width: 120, onChange: (value) => changes.push(value), ...options });
		root.addChild(input);
		context.frame.layout();
		return { input, changes };
	}

	it('clamps and rounds a programmatic value without onChange', () => {
		const { input, changes } = stepper({ value: 3, min: 0, max: 10, step: 0.25 });
		expect(input.precision).toBe(2);
		expect(input.input.value).toBe('3.00');
		input.value = 12;
		expect(input.value).toBe(10);
		input.value = 1.126;
		expect(input.value).toBe(1.13);
		expect(input.input.value).toBe('1.13');
		expect(changes).toEqual([]);
	});

	it('steps on Up and Down while focused, clamping, and fires only on a change', () => {
		const { input, changes } = stepper({ value: 9, min: 0, max: 10 });
		inject(`click,${FIELD_X + 10},${MIDDLE_Y}`);
		press('ArrowUp');
		press('ArrowUp');
		expect(input.value).toBe(10);
		press('ArrowDown');
		expect(changes).toEqual([10, 9]);
		expect(input.input.value).toBe('9');
	});

	it('steps from the chevrons, keeping focus in the field without a ring', () => {
		const { input, changes } = stepper({ value: 2 });
		inject(`click,${STEPPER_X},${FIELD_Y + 6}`);
		expect(input.value).toBe(3);
		expect(input.input.focused).toBe(true);
		expect(input.input.focusVisible).toBe(false);
		inject(`click,${STEPPER_X},${FIELD_Y + control.control_h_md - 6}`);
		inject(`click,${STEPPER_X},${FIELD_Y + control.control_h_md - 6}`);
		expect(changes).toEqual([3, 2, 1]);
	});

	it('commits typed text on Enter and on blur, clamped, and restores text that is not a number', () => {
		const { input, changes } = stepper({ value: 5, min: 0, max: 100 });
		inject(`click,${FIELD_X + 10},${MIDDLE_Y}`);
		press('a', { ctrl: true });
		type('250');
		expect(input.value).toBe(5);
		press('Enter');
		expect(input.value).toBe(100);
		press('a', { ctrl: true });
		type('4x2');
		expect(input.input.value).toBe('42');
		context.focus.blur();
		expect(input.value).toBe(42);
		inject(`click,${FIELD_X + 10},${MIDDLE_Y}`);
		press('a', { ctrl: true });
		press('Backspace');
		context.focus.blur();
		expect(input.value).toBe(42);
		expect(input.input.value).toBe('42');
		expect(changes).toEqual([100, 42]);
	});

	it('refuses a sign when min is not negative and a point when precision is 0', () => {
		const { input } = stepper({ value: 0, min: 0 });
		inject(`click,${FIELD_X + 10},${MIDDLE_Y}`);
		press('a', { ctrl: true });
		type('-1.5');
		expect(input.input.value).toBe('15');
	});

	it('steps on the wheel only while focused', () => {
		const { input, changes } = stepper({ value: 5 });
		wheel(FIELD_X + 10, MIDDLE_Y, -10);
		expect(input.value).toBe(5);
		inject(`click,${FIELD_X + 10},${MIDDLE_Y}`);
		wheel(FIELD_X + 10, MIDDLE_Y, -10);
		wheel(FIELD_X + 10, MIDDLE_Y, 10);
		wheel(FIELD_X + 10, MIDDLE_Y, 10);
		expect(changes).toEqual([6, 5, 4]);
	});

	it('is one Tab stop: the field', () => {
		const { input } = stepper();
		press('Tab');
		expect(context.focus.focused).toBe(input.input);
		expect(context.focus.tabOrder).toEqual([input.input]);
	});
});
