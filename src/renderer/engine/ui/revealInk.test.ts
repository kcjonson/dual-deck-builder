/**
 * @jest-environment jsdom
 */
import type { Component } from '../components/Component';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { checkReveal, createTestContext } from '../components/testing';
import type { DrawApi } from '../draw/DrawApi';
import { createMeasuringDrawApi } from '../text/testing';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { ListRow } from './ListRow';
import { Radio } from './RadioGroup';
import { SegmentedControl } from './SegmentedControl';
import { Select } from './Select';
import { Slider } from './Slider';
import { TabBar } from './TabBar';
import { TextInput } from './TextInput';
import { Toggle } from './Toggle';

/**
 * R12.20's contract across the catalog: each focusable, focused by keyboard
 * with the pointer away, reveals what it draws, its box and every draw but a
 * look's glow, no less and no more. Checked against the draw calls
 * themselves, so a bound that drifts from the drawing fails here whatever
 * the scroll tests cover. The game's focusables have their own (cards and
 * vehicles, `game/ui/revealInk.test.ts`).
 */

let context: MountContext;
let api: DrawApi;
let root: Container;

beforeEach(() => {
	api = createMeasuringDrawApi().api;
	context = createTestContext({ draw: api });
	root = new Container({ id: 'root', width: 1000, height: 800 });
	root.mount(context);
});

afterEach(() => {
	root.unmount();
});

function place<T extends Component>(component: T): T {
	component.setPosition(100, 100);
	root.addChild(component);
	return component;
}

const segments = (): SegmentedControl<number> => place(new SegmentedControl({ options: [{ label: 'One', value: 1 }, { label: 'Two', value: 2 }], selected: 1, tone: 'ok' }));
const tabs = (): TabBar => place(new TabBar({ tabs: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] }));

const catalog: [string, () => Component][] = [
	['a button', () => place(new Button({ label: 'Save', width: 100 }))],
	['an accent button, which glows only on hover', () => place(new Button({ label: 'Go', tone: 'accent', width: 100 }))],
	['a raised button, its shadow where it falls', () => place(new Button({ label: 'Raised', width: 120, style: { shadow: 'shadow_raised' } }))],
	['a select', () => place(new Select({ width: 160, options: [{ value: 'a', label: 'Alpha' }], value: 'a' }))],
	['a text input', () => place(new TextInput({ width: 160, value: 'Hello' }))],
	['an empty text input with a placeholder', () => place(new TextInput({ width: 160, placeholder: 'Name' }))],
	['a checked checkbox', () => place(new Checkbox({ label: 'Check', checked: true }))],
	['a toggle that is on', () => place(new Toggle({ label: 'Toggle', checked: true }))],
	['a selected radio', () => place(new Radio({ label: 'Radio', checked: true, value: 1 }))],
	['a selected segment, its chip glow left out', () => segments().items[0]],
	['a segment not selected', () => segments().items[1]],
	['a selected tab', () => tabs().tabs[0]],
	['a tab not selected', () => tabs().tabs[1]],
	['a list row', () => place(new ListRow({ label: 'Row', trailing: '12', width: 200, height: 40 }))],
	['a selected list row', () => place(new ListRow({ label: 'Row', selected: true, width: 200, height: 40 }))],
	['a slider with its label and value, its thumb glow left out', () => place(new Slider({ width: 300, label: 'Gain', valueFormatter: (value) => value.toFixed(2), value: 0 }))],
	['a slider at its top end', () => place(new Slider({ width: 200, value: 1 }))],
];

it.each(catalog)('reveals what it draws, no less and no more: %s', (_name, make) => {
	const control = make();
	context.frame.layout();
	context.focus.focus(control, 'keyboard');
	// Every look transition done
	context.frame.update(1);
	context.frame.layout();
	expect(control.focusVisible).toBe(true);
	expect(checkReveal(control, api)).toEqual({ outside: [], beyond: { top: 0, right: 0, bottom: 0, left: 0 }, audit: [] });
});
