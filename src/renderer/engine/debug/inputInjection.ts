import { InputSystem } from '../input/InputSystem';
import type { InjectedStep } from './inputScript';
import { parseInputCommand } from './inputScript';

/**
 * Dispatch half of R13.35's injection hook: turns parsed steps into real DOM
 * events aimed at the very listeners the InputSystem registered, so injected
 * input travels the path real input travels and no component knows the
 * difference.
 *
 * ## The seam
 *
 * `InputSystem.setup` registers `mousemove`, `mousedown`, `mouseup`, `wheel`
 * and `mouseleave` on the canvas, and `keydown` on `window`. Mouse and wheel
 * events therefore go to the canvas, and key events go up a bubble path that
 * reaches `window`.
 *
 * These are plain `MouseEvent`s, not `PointerEvent`s. A `PointerEvent` reaches
 * a `mousemove` listener only when the browser synthesises the compatibility
 * mouse event, which is a behaviour the harness would then be built on top of;
 * a `MouseEvent` hits the registered listener directly, in every runtime, and
 * in jsdom.
 *
 * ## Coordinates
 *
 * `x` and `y` are logical pixels, the space `window.__ui.tree()` reports
 * (R7.1, R7.15). `handleMouseMove` computes `event.clientX - rect.left`
 * against the canvas's bounding rect, which is CSS pixels; `Renderer.resize`
 * builds the ortho projection from `window.innerWidth/innerHeight`, also CSS
 * pixels, and applies `devicePixelRatio` only to the backing store
 * (`canvas.width`) and `gl.viewport`. Input space and snapshot space are
 * therefore the same space and no conversion is needed (R7.2). This adds
 * `rect.left`/`rect.top` back for the same reason the handler subtracts them:
 * the canvas sits at the origin today, and a hook that assumed so would break
 * the day it does not.
 *
 * ## Pointer tracking, and why `click` is the primitive to reach for
 *
 * `handleMouseDown`, `handleMouseUp` and `handleWheel` ignore their event's
 * coordinates entirely and act on the position `handleMouseMove` last stored.
 * R13.35 expands only `click`, so a bare `down,x,y` or `scroll,x,y,delta`
 * presses or scrolls wherever the pointer already was, not at the x and y it
 * names. Send `move,x,y` first, or use `click`. Injecting a hidden move inside
 * those verbs would be worse than the hazard: it would fire mouseover and
 * mouseout handlers the harness never asked for, changing hover state
 * underneath an assertion about it.
 *
 * ## Scroll delta units
 *
 * `delta` is logical pixels of vertical scroll intent, per R9.3 ("wheel deltas
 * are normalised to logical pixels per axis ... no per-notch constant"), and
 * is dispatched as `deltaY` with `deltaMode` DOM_DELTA_PIXEL. So `delta` 100
 * means a hundred pixels, not one notch. The engine does not yet honour R9.3:
 * `handleWheel` passes the raw delta through and `Panel.onWheel` multiplies it
 * by 30, so 100 currently scrolls a panel 3000 pixels. That gap is deliberate
 * here. Compensating for it inside the injection hook would make injected
 * wheels behave differently from real ones, which is what R13.35's "same path
 * real input takes" forbids; the fix belongs in the wheel handler. The grammar
 * carries one delta, so injected scrolls are vertical only.
 *
 * ## Keys
 *
 * R13.36 covers engines that poll key state, where a down and an up landing in
 * the same frame collapse into a release. That hazard does not arise here: the
 * engine is event-driven, `handleKeyDown` calls the component's handler
 * synchronously from the DOM listener, and no frame boundary sits between the
 * two. A `keydown` and a `keyup` injected in the same call are both delivered,
 * in order, with no collapse and no need to split them across frames.
 *
 * `keyup` is dispatched faithfully but nothing in the engine listens for it
 * today; the InputSystem registers `keydown` only. The verb is in the grammar
 * and the event is real, so the day a keyup listener is added, injection
 * already feeds it.
 *
 * Key events are dispatched at the focused element (`document.body` when
 * nothing else holds focus) and bubble, rather than being fired straight at
 * `window`. That is where a real key event starts, and it is the difference
 * between reaching only the InputSystem's window listener and also reaching
 * the game's F5/F12 handler on `document`.
 *
 * ## Pause
 *
 * R13.35's "injected input is ignored while paused" needs no code here. Every
 * one of the InputSystem's six handlers opens with
 * `if (__DEV_TOOLS__ && this.inputPaused) return;`, so an injected event that
 * travels the real listener path is dropped exactly like a real one. The
 * result reports `swallowed` per event so a harness can tell an ignored click
 * from a missed one.
 */

export interface InjectedEventResult {
	/** The DOM event type dispatched: mousemove, mousedown, mouseup, wheel, keydown, keyup. */
	type: string;
	/** False only when there was nowhere to dispatch it, e.g. no document body for a key. */
	dispatched: boolean;
	/**
	 * True when the InputSystem's pause gate dropped the event before any
	 * component saw it (R13.35). Listeners outside the InputSystem, such as the
	 * game's F5/F12 handler on `document`, are not gated and still ran.
	 */
	swallowed: boolean;
}

export interface InjectedCommandResult {
	/** The command as it was given, so a failure names itself. */
	command: string;
	ok: boolean;
	/** Present only when ok is false. */
	error?: string;
	/** One entry per dispatched event; `click` produces three. Empty on a parse failure. */
	events: InjectedEventResult[];
}

export interface InjectionResult {
	/** True when every command parsed and every event reached a target. */
	ok: boolean;
	/** The InputSystem's pause state when the call started (R13.35). */
	paused: boolean;
	commands: InjectedCommandResult[];
}

/**
 * MouseEvent.buttons is a bitmask keyed by button, not a shift of the button
 * index: secondary is 2 and middle is 4, the reverse of the button numbering.
 *
 * Five entries, which is why the parser caps `button` at 4: a sixth button
 * would fall off the end and mask to 0, dispatching a mousedown whose buttons
 * field claims nothing is held during a press.
 */
const BUTTONS_BIT = [1, 4, 2, 8, 16];

function buttonsMask(button: number): number {
	return BUTTONS_BIT[button] ?? 0;
}

function mouseEvent(
	canvas: HTMLCanvasElement,
	type: string,
	x: number,
	y: number,
	button: number,
	buttons: number,
): MouseEvent {
	const rect = canvas.getBoundingClientRect();
	return new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX: rect.left + x,
		clientY: rect.top + y,
		button,
		buttons,
	});
}

function dispatchStep(canvas: HTMLCanvasElement, step: InjectedStep): InjectedEventResult {
	const swallowed = InputSystem.getInstance().paused;

	switch (step.kind) {
		case 'move':
			canvas.dispatchEvent(mouseEvent(canvas, 'mousemove', step.x, step.y, 0, 0));
			return { type: 'mousemove', dispatched: true, swallowed };

		case 'down':
			canvas.dispatchEvent(
				mouseEvent(canvas, 'mousedown', step.x, step.y, step.button, buttonsMask(step.button)),
			);
			return { type: 'mousedown', dispatched: true, swallowed };

		case 'up':
			canvas.dispatchEvent(mouseEvent(canvas, 'mouseup', step.x, step.y, step.button, 0));
			return { type: 'mouseup', dispatched: true, swallowed };

		case 'scroll': {
			const rect = canvas.getBoundingClientRect();
			canvas.dispatchEvent(
				new WheelEvent('wheel', {
					bubbles: true,
					cancelable: true,
					clientX: rect.left + step.x,
					clientY: rect.top + step.y,
					deltaX: 0,
					deltaY: step.delta,
					deltaMode: 0,
				}),
			);
			return { type: 'wheel', dispatched: true, swallowed };
		}

		case 'keydown':
		case 'keyup': {
			const focused = document.activeElement;
			const target = focused instanceof Element ? focused : document.body;
			if (!target) return { type: step.kind, dispatched: false, swallowed };

			target.dispatchEvent(
				new KeyboardEvent(step.kind, { bubbles: true, cancelable: true, key: step.key }),
			);
			return { type: step.kind, dispatched: true, swallowed };
		}
	}
}

export function injectInput(canvas: HTMLCanvasElement, commands: string[]): InjectionResult {
	const paused = InputSystem.getInstance().paused;
	const results: InjectedCommandResult[] = [];
	let ok = true;

	for (const command of commands) {
		const parsed = parseInputCommand(command);

		if (!parsed.ok) {
			ok = false;
			results.push({ command: String(command), ok: false, error: parsed.error, events: [] });
			continue;
		}

		const events = parsed.steps.map((step) => dispatchStep(canvas, step));
		const delivered = events.every((event) => event.dispatched);
		if (!delivered) ok = false;
		results.push({ command, ok: delivered, events });
	}

	return { ok, paused, commands: results };
}
