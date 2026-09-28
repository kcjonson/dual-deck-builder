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
		containsScreenPoint: () => true,
		overs: 0,
		downs: 0,
		keys: [],
	};
}

let canvas: HTMLCanvasElement;
let input: InputSystem;
let target: Target;

beforeAll(() => {
	canvas = document.createElement('canvas');
	document.body.appendChild(canvas);
});

beforeEach(() => {
	input = new InputSystem();
	input.setup(canvas);

	target = makeTarget();
	input.registerMouseOver(target, () => target.overs++);
	input.registerMouseDown(target, () => target.downs++);
	input.registerKeyDown(target, (key: string) => target.keys.push(key));
	input.setFocus(target);
});

afterEach(() => {
	input.detach();
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
	input.paused = true;

	moveAndClick();
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

	expect(target.overs).toBe(0);
	expect(target.downs).toBe(0);
	expect(target.keys).toEqual([]);
});

it('delivers again after resuming, with no queued backlog from the pause', () => {
	input.paused = true;
	moveAndClick();
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

	input.paused = false;
	moveAndClick();
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));

	expect(target.downs).toBe(1);
	expect(target.keys).toEqual(['b']);
});

it('removes its listeners on detach, so setting up again delivers each key once', () => {
	input.detach();
	input.setup(canvas);
	input.registerKeyDown(target, (key: string) => target.keys.push(key));
	input.setFocus(target);

	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

	expect(target.keys).toEqual(['a']);
});
