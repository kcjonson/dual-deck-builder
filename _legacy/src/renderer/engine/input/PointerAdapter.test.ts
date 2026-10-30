/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../components/testing';
import type { MountContext } from '../components/MountContext';
import type { PlatformInput } from './Dispatcher';
import { PointerAdapter } from './PointerAdapter';

/** R15.39's canvas hygiene: no browser menu, no text selection, and a symmetric attach and detach. */

let canvas: HTMLCanvasElement;
let context: MountContext;
let adapter: PointerAdapter;

beforeEach(() => {
	canvas = document.createElement('canvas');
	document.body.appendChild(canvas);
	context = createTestContext();
	adapter = new PointerAdapter({ dispatcher: context.dispatcher, ctrlClickIsSecondary: false });
});

afterEach(() => {
	adapter.detach();
	canvas.remove();
});

/** The WebKit-prefixed pair, which lib.dom does not type. */
function webkit(target: HTMLCanvasElement): { userSelect: string | undefined; touchCallout: string | undefined } {
	const style = target.style as unknown as { webkitUserSelect?: string; webkitTouchCallout?: string };
	return {
		get userSelect() {
			return style.webkitUserSelect;
		},
		set userSelect(value) {
			style.webkitUserSelect = value;
		},
		get touchCallout() {
			return style.webkitTouchCallout;
		},
		set touchCallout(value) {
			style.webkitTouchCallout = value;
		},
	};
}

function contextMenu(target: EventTarget = canvas): Event {
	const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
	target.dispatchEvent(event);
	return event;
}

describe('contextmenu (R15.39)', () => {
	it('prevents the browser default while attached', () => {
		adapter.attach(canvas);
		expect(contextMenu().defaultPrevented).toBe(true);
	});

	it('leaves the default alone before attach and after detach', () => {
		expect(contextMenu().defaultPrevented).toBe(false);
		adapter.attach(canvas);
		adapter.detach();
		expect(contextMenu().defaultPrevented).toBe(false);
	});

	it('prevents a keyboard-opened menu, which targets the focused element rather than the canvas', () => {
		adapter.attach(canvas);
		expect(contextMenu(document.body).defaultPrevented).toBe(true);
	});

	it('leaves a text field its own menu', () => {
		const field = document.createElement('input');
		document.body.appendChild(field);
		adapter.attach(canvas);
		expect(contextMenu(field).defaultPrevented).toBe(false);
		field.remove();
	});

	it('stops preventing on the document after detach', () => {
		adapter.attach(canvas);
		adapter.detach();
		expect(contextMenu(document.body).defaultPrevented).toBe(false);
	});

	it('detaches cleanly when attach ran twice', () => {
		adapter.attach(canvas);
		adapter.attach(canvas);
		adapter.detach();
		expect(contextMenu().defaultPrevented).toBe(false);
		expect(contextMenu(document.body).defaultPrevented).toBe(false);
	});

	it('detaches without having attached', () => {
		expect(() => adapter.detach()).not.toThrow();
	});

	it('works again when re-attached after a detach', () => {
		adapter.attach(canvas);
		adapter.detach();
		adapter.attach(canvas);
		expect(contextMenu().defaultPrevented).toBe(true);
		expect(canvas.style.userSelect).toBe('none');
	});
});

describe('canvas styles (R15.39)', () => {
	it('sets touch-action and user-select to none on attach', () => {
		adapter.attach(canvas);
		expect(canvas.style.touchAction).toBe('none');
		expect(canvas.style.userSelect).toBe('none');
	});

	it('sets the WebKit-prefixed properties Safari and iOS read', () => {
		adapter.attach(canvas);
		expect(webkit(canvas).userSelect).toBe('none');
		expect(webkit(canvas).touchCallout).toBe('none');
	});

	it('restores what the canvas had before on detach', () => {
		canvas.style.touchAction = 'pan-y';
		canvas.style.userSelect = 'text';
		webkit(canvas).userSelect = 'text';
		webkit(canvas).touchCallout = 'default';
		adapter.attach(canvas);
		adapter.detach();
		expect(canvas.style.touchAction).toBe('pan-y');
		expect(canvas.style.userSelect).toBe('text');
		expect(webkit(canvas).userSelect).toBe('text');
		expect(webkit(canvas).touchCallout).toBe('default');
	});

	it('restores an unset canvas to unset', () => {
		adapter.attach(canvas);
		adapter.detach();
		expect(canvas.style.touchAction).toBe('');
		expect(canvas.style.userSelect).toBe('');
		expect(webkit(canvas).userSelect).toBe('');
		expect(webkit(canvas).touchCallout).toBe('');
	});

	it('restores the originals, not its own values, when attach ran twice', () => {
		canvas.style.touchAction = 'pan-y';
		canvas.style.userSelect = 'text';
		adapter.attach(canvas);
		adapter.attach(canvas);
		adapter.detach();
		expect(canvas.style.touchAction).toBe('pan-y');
		expect(canvas.style.userSelect).toBe('text');
	});

	it('restores the first canvas when attached to a second', () => {
		const other = document.createElement('canvas');
		document.body.appendChild(other);
		canvas.style.touchAction = 'pan-y';
		canvas.style.userSelect = 'text';
		adapter.attach(canvas);
		adapter.attach(other);
		expect(canvas.style.touchAction).toBe('pan-y');
		expect(canvas.style.userSelect).toBe('text');
		expect(other.style.userSelect).toBe('none');
		adapter.detach();
		expect(other.style.userSelect).toBe('');
		other.remove();
	});
});

describe('wheel buttons (R9.1)', () => {
	it('forwards the held buttons', () => {
		const enqueue = jest.spyOn(context.dispatcher, 'enqueue');
		adapter.attach(canvas);
		canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, buttons: 4, cancelable: true }));
		expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'wheel', buttons: 4 }));
	});
});

describe('macOS Ctrl+click (R9.30)', () => {
	function pointerEvent(type: string, init: MouseEventInit): Event {
		return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
	}

	function pointers(enqueue: jest.SpyInstance): Array<{ phase: string; button: number; buttons: number }> {
		return enqueue.mock.calls
			.map(([input]) => input as PlatformInput)
			.filter((input): input is Extract<PlatformInput, { kind: 'pointer' }> => input.kind === 'pointer')
			.map(({ phase, button, buttons }) => ({ phase, button, buttons }));
	}

	function press(mac: boolean, ctrl: boolean, meta = false): Array<{ phase: string; button: number; buttons: number }> {
		const macAdapter = new PointerAdapter({ dispatcher: context.dispatcher, ctrlClickIsSecondary: mac });
		const enqueue = jest.spyOn(context.dispatcher, 'enqueue');
		macAdapter.attach(canvas);
		canvas.dispatchEvent(pointerEvent('pointerdown', { button: 0, buttons: 1, ctrlKey: ctrl, metaKey: meta }));
		// Ctrl released mid-press: the press is still the secondary one.
		canvas.dispatchEvent(pointerEvent('pointermove', { button: -1, buttons: 1 }));
		canvas.dispatchEvent(pointerEvent('pointerup', { button: 0, buttons: 0 }));
		macAdapter.detach();
		return pointers(enqueue);
	}

	it('turns a Ctrl+click into a secondary press for down, moves, and up', () => {
		expect(press(true, true)).toEqual([
			{ phase: 'down', button: 2, buttons: 2 },
			{ phase: 'move', button: -1, buttons: 2 },
			{ phase: 'up', button: 2, buttons: 0 },
		]);
	});

	it('leaves a plain click alone', () => {
		expect(press(true, false)).toEqual([
			{ phase: 'down', button: 0, buttons: 1 },
			{ phase: 'move', button: -1, buttons: 1 },
			{ phase: 'up', button: 0, buttons: 0 },
		]);
	});

	it('leaves Ctrl+click alone off macOS, where Ctrl is a modifier and the context button is 2', () => {
		expect(press(false, true)[0]).toEqual({ phase: 'down', button: 0, buttons: 1 });
	});

	it('leaves Cmd+Ctrl+click alone', () => {
		expect(press(true, true, true)[0]).toEqual({ phase: 'down', button: 0, buttons: 1 });
	});

	it('does not carry the remap into the next press', () => {
		const macAdapter = new PointerAdapter({ dispatcher: context.dispatcher, ctrlClickIsSecondary: true });
		const enqueue = jest.spyOn(context.dispatcher, 'enqueue');
		macAdapter.attach(canvas);
		canvas.dispatchEvent(pointerEvent('pointerdown', { button: 0, buttons: 1, ctrlKey: true }));
		canvas.dispatchEvent(pointerEvent('pointerup', { button: 0, buttons: 0 }));
		canvas.dispatchEvent(pointerEvent('pointerdown', { button: 0, buttons: 1 }));
		macAdapter.detach();
		expect(pointers(enqueue)[2]).toEqual({ phase: 'down', button: 0, buttons: 1 });
	});
});
