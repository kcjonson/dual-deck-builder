/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../components/testing';
import type { MountContext } from '../components/MountContext';
import { PointerAdapter } from './PointerAdapter';

/** R15.39's canvas hygiene: no browser menu, no text selection, and a symmetric attach and detach. */

let canvas: HTMLCanvasElement;
let context: MountContext;
let adapter: PointerAdapter;

beforeEach(() => {
	canvas = document.createElement('canvas');
	document.body.appendChild(canvas);
	context = createTestContext();
	adapter = new PointerAdapter({ dispatcher: context.dispatcher });
});

afterEach(() => {
	adapter.detach();
	document.body.removeChild(canvas);
});

function contextMenu(): Event {
	const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
	canvas.dispatchEvent(event);
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

	it('removes the very listener it added on detach', () => {
		const added = jest.spyOn(canvas, 'addEventListener');
		const removed = jest.spyOn(canvas, 'removeEventListener');
		adapter.attach(canvas);
		adapter.detach();
		const listener = added.mock.calls.find(([type]) => type === 'contextmenu')?.[1];
		expect(listener).toBeDefined();
		expect(removed).toHaveBeenCalledWith('contextmenu', listener);
	});

	it('detaches cleanly when attach ran twice', () => {
		adapter.attach(canvas);
		adapter.attach(canvas);
		adapter.detach();
		expect(contextMenu().defaultPrevented).toBe(false);
	});
});

describe('canvas styles (R15.39)', () => {
	it('sets touch-action and user-select to none on attach', () => {
		adapter.attach(canvas);
		expect(canvas.style.touchAction).toBe('none');
		expect(canvas.style.userSelect).toBe('none');
	});

	it('restores what the canvas had before on detach', () => {
		canvas.style.touchAction = 'pan-y';
		canvas.style.userSelect = 'text';
		adapter.attach(canvas);
		adapter.detach();
		expect(canvas.style.touchAction).toBe('pan-y');
		expect(canvas.style.userSelect).toBe('text');
	});

	it('restores an unset canvas to unset', () => {
		adapter.attach(canvas);
		adapter.detach();
		expect(canvas.style.touchAction).toBe('');
		expect(canvas.style.userSelect).toBe('');
	});
});
