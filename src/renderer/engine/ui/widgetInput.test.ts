/**
 * @jest-environment jsdom
 */
import { Layer } from '../components/Layer';
import type { MountContext } from '../components/MountContext';
import { createTestContext, injectNow } from '../components/testing';
import { PointerAdapter } from '../input/PointerAdapter';
import { Button } from './Button';
import { Input } from './Input';

/**
 * The engine widgets on the dispatcher, driven the way R9.25 asks: injected
 * events on a mounted root, never a handler called directly.
 */

let canvas: HTMLCanvasElement;
let context: MountContext;
let adapter: PointerAdapter;
let root: Layer;

function inject(...commands: string[]): void {
	expect(injectNow({ canvas, dispatcher: context.dispatcher }, commands).ok).toBe(true);
}

beforeEach(() => {
	canvas = document.createElement('canvas');
	document.body.appendChild(canvas);
	context = createTestContext();
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

describe('Button', () => {
	function button(): { button: Button; clicks: number[] } {
		const clicks: number[] = [];
		const made = new Button('Go', { id: 'go', x: 100, y: 100, width: 120, height: 40 });
		made.onClick = () => clicks.push(1);
		root.addChild(made);
		return { button: made, clicks };
	}

	it('clicks once when pressed and released on it, over its label', () => {
		const { clicks } = button();
		// The label sits in the middle; the button is `unit`, so it is the target.
		inject('click,160,120');
		expect(clicks).toHaveLength(1);
	});

	it('is hovered while the pointer is over it, and not after it leaves', () => {
		const { button: made } = button();
		inject('move,160,120');
		expect(made.hovered).toBe(true);
		inject('move,10,10');
		expect(made.hovered).toBe(false);
	});

	it('does not click when released outside (R9.11)', () => {
		const { clicks } = button();
		inject('move,160,120', 'down,160,120');
		inject('move,400,400');
		inject('up,400,400');
		expect(clicks).toHaveLength(0);
	});

	it('does not click while disabled (R9.5)', () => {
		const { button: made, clicks } = button();
		made.setEnabled(false);
		inject('click,160,120');
		expect(clicks).toHaveLength(0);
	});

	it('takes the click over a button painted beneath it, once', () => {
		const under: number[] = [];
		const lower = new Button('Under', { id: 'under', x: 100, y: 100, width: 120, height: 40 });
		lower.onClick = () => under.push(1);
		root.addChild(lower);
		const { clicks } = button();
		inject('click,160,120');
		expect(clicks).toHaveLength(1);
		expect(under).toHaveLength(0);
	});
});

describe('Input', () => {
	function field(): Input {
		const made = new Input('type here', { id: 'field', x: 100, y: 200, width: 200, height: 40 });
		root.addChild(made);
		return made;
	}

	it('takes focus on a press and edits its value from keys', () => {
		const made = field();
		inject('click,150,220', 'keydown,h', 'keydown,i', 'keydown,Backspace', 'keydown,o');
		expect(made.focused).toBe(true);
		expect(made.getValue()).toBe('ho');
	});

	it('ignores keys until focused', () => {
		const made = field();
		inject('keydown,x');
		expect(made.getValue()).toBe('');
	});

	it('loses focus on a press elsewhere, and on Enter', () => {
		const made = field();
		inject('click,150,220');
		inject('click,600,500');
		expect(made.focused).toBe(false);
		expect(context.dispatcher.focused).toBeNull();

		inject('click,150,220', 'keydown,Enter');
		expect(made.focused).toBe(false);
	});

	it('moves focus from one field to another in one press', () => {
		const first = field();
		const second = new Input('', { id: 'second', x: 100, y: 300, width: 200, height: 40 });
		root.addChild(second);
		inject('click,150,220');
		inject('click,150,320', 'keydown,z');
		expect(first.focused).toBe(false);
		expect(second.focused).toBe(true);
		expect(second.getValue()).toBe('z');
		expect(first.getValue()).toBe('');
	});

	it('keeps a hotkey from firing for a key the field consumes (R9.15)', () => {
		const made = field();
		const fired: string[] = [];
		context.dispatcher.hotkeys.register('q', (stroke) => fired.push(stroke.key));
		context.dispatcher.hotkeys.register('F6', (stroke) => fired.push(stroke.key));
		inject('click,150,220', 'keydown,q', 'keydown,F6');
		expect(made.getValue()).toBe('q');
		expect(fired).toEqual(['F6']);
	});
});

describe('PointerAdapter', () => {
	it('turns off the browser\'s touch panning on the canvas, and restores it on detach', () => {
		expect(canvas.style.touchAction).toBe('none');
		adapter.detach();
		expect(canvas.style.touchAction).toBe('');
		adapter.attach(canvas);
	});

	it('keeps the page from scrolling under a wheel', () => {
		const event = new WheelEvent('wheel', { deltaY: 10, cancelable: true });
		canvas.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	});

	it('prevents a key\'s default only when a hotkey or a focused component will take it', () => {
		const free = new KeyboardEvent('keydown', { key: 'F6', cancelable: true });
		window.dispatchEvent(free);
		expect(free.defaultPrevented).toBe(false);

		context.dispatcher.hotkeys.register('F6', () => undefined);
		const bound = new KeyboardEvent('keydown', { key: 'F6', cancelable: true });
		window.dispatchEvent(bound);
		expect(bound.defaultPrevented).toBe(true);
	});

	it('queues a window blur, which cancels a press in progress', () => {
		const clicks: number[] = [];
		const made = new Button('Go', { x: 0, y: 0, width: 100, height: 40 });
		made.onClick = () => clicks.push(1);
		root.addChild(made);

		injectCommands(['move,50,20', 'down,50,20']);
		window.dispatchEvent(new FocusEvent('blur'));
		injectCommands(['up,50,20']);
		context.dispatcher.dispatchPending();
		expect(clicks).toHaveLength(0);
	});
});

function injectCommands(commands: string[]): void {
	injectNow({ canvas, dispatcher: context.dispatcher }, commands);
}
