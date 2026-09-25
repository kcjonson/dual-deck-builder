/**
 * @jest-environment jsdom
 */
import { InputSystem, Interactive } from './InputSystem';

/**
 * R13.32's pause and R13.35's "injected input is ignored while paused".
 *
 * The gate has to sit inside the InputSystem rather than in a frame loop:
 * these handlers run from DOM listeners, so a loop that skipped its update
 * call would still deliver every click and keystroke. This file dispatches
 * real events at a real canvas, which is also the path DDB-60's injection
 * hook will take, so it needs the jsdom environment rather than the suite's
 * default node one.
 */

interface Target extends Interactive {
	overs: number;
	downs: number;
	keys: string[];
}

function makeTarget(): Target {
	return {
		containsPoint: () => true,
		overs: 0,
		downs: 0,
		keys: [],
	};
}

let canvas: HTMLCanvasElement;
let target: Target;

// setup() once for the file, not per test: InputSystem.unmount passes freshly
// bound handlers to removeEventListener, so nothing is ever removed and a
// second setup() leaves two window keydown listeners delivering every key
// twice. That is a pre-existing engine bug, not this feature's, and a test
// that re-set-up per case would be measuring it.
beforeAll(() => {
	canvas = document.createElement('canvas');
	document.body.appendChild(canvas);
	InputSystem.getInstance().setup(canvas);
});

beforeEach(() => {
	InputSystem.getInstance().paused = false;

	target = makeTarget();
	InputSystem.registerMouseOver(target, () => target.overs++);
	InputSystem.registerMouseDown(target, () => target.downs++);
	InputSystem.registerKeyDown(target, (key: string) => target.keys.push(key));
	InputSystem.setFocus(target);
});

afterEach(() => {
	InputSystem.unregisterComponent(target);
	InputSystem.getInstance().paused = false;
});

function moveAndClick(): void {
	canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
	canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10 }));
	canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 10, clientY: 10 }));
}

it('dispatches mouse and key events while running', () => {
	moveAndClick();
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

	expect(target.overs).toBe(1);
	expect(target.downs).toBe(1);
	expect(target.keys).toEqual(['a']);
});

it('ignores mouse and key events while paused', () => {
	InputSystem.getInstance().paused = true;

	moveAndClick();
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

	expect(target.overs).toBe(0);
	expect(target.downs).toBe(0);
	expect(target.keys).toEqual([]);
});

it('delivers again after resuming, with no queued backlog from the pause', () => {
	InputSystem.getInstance().paused = true;
	moveAndClick();
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

	InputSystem.getInstance().paused = false;
	moveAndClick();
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));

	expect(target.downs).toBe(1);
	expect(target.keys).toEqual(['b']);
});
