import type { Dispatcher } from '../input/Dispatcher';
import type { InjectedStep } from './inputScript';
import { parseInputCommand } from './inputScript';

/**
 * Dispatch half of R13.35's injection hook: turns parsed steps into real DOM
 * events aimed at the listeners `PointerAdapter` registered, so injected
 * input travels the path real input travels (R9.25) and no component knows
 * the difference.
 *
 * ## The seam
 *
 * `PointerAdapter.attach` listens for `pointerdown`, `pointermove`,
 * `pointerup`, `pointercancel`, `pointerleave` and `wheel` on the canvas,
 * and `keydown`, `keyup` and `blur` on `window`. Pointer and wheel events
 * therefore go to the canvas, and key events go up a bubble path that
 * reaches `window`. The adapter queues them and the frame loop dispatches
 * the queue at the start of the next frame (R9.2), so an injected click
 * takes effect on the next frame, exactly as a real one does; a caller that
 * needs the effect synchronously (a unit test) calls the dispatcher's
 * `dispatchPending` itself.
 *
 * Pointer events are `PointerEvent`s with `pointerId` 1, `pointerType`
 * `mouse`, and `isPrimary`, where the runtime has the constructor. jsdom has
 * none, so there they are `MouseEvent`s carrying the pointer event's type
 * name, which reach the same listeners; the adapter reads the missing
 * pointer fields with those same defaults.
 *
 * ## Coordinates
 *
 * `x` and `y` are logical pixels, the space `window.__ui.tree()` reports
 * (R7.1, R7.15). The adapter computes `clientX - rect.left` against the
 * canvas's bounding rect, in CSS pixels, and divides by the UI scale (1
 * until R7.5's setting exists), which is the logical viewport
 * `CanvasViewport` defines. This adds `rect.left` and `rect.top` back for the
 * same reason the adapter subtracts them: the canvas sits at the origin
 * today, and a hook that assumed so would break the day it does not.
 *
 * Every pointer verb is dispatched at its own coordinates, and the
 * dispatcher hit-tests each at its own position, so `down,x,y` presses at
 * x, y whatever the last move said. `click` still expands to a move first
 * (R13.35), which is what gives the press a hover: a bare `down` delivers
 * `pointerenter` along with the press, as a real press without a preceding
 * move would.
 *
 * ## Scroll delta units
 *
 * `delta` is logical pixels of vertical scroll intent, per R9.3, and is
 * dispatched as `deltaY` with `deltaMode` DOM_DELTA_PIXEL. The dispatcher
 * uses pixel deltas as scroll distances directly, so `delta` 100 scrolls a
 * panel 100 pixels. The grammar carries one delta, so injected scrolls are
 * vertical only.
 *
 * ## Keys
 *
 * R13.36 covers engines that poll key state, where a down and an up landing
 * in the same frame collapse into a release. That hazard does not arise
 * here: the adapter queues both as events and the dispatcher delivers both,
 * in order, with no collapse and no need to split them across frames.
 *
 * Key events are dispatched at the focused element (`document.body` when
 * nothing else holds focus) and bubble, rather than being fired straight at
 * `window`. That is where a real key event starts, and it is the difference
 * between reaching only the adapter's window listener and also reaching the
 * game's F5/F12 handler on `document`.
 *
 * ## Pause
 *
 * R13.35's "injected input is ignored while paused" needs no code here: the
 * dispatcher drops everything offered to its queue while paused, so an
 * injected event that travels the real listener path is dropped exactly
 * like a real one. The result reports `swallowed` per event so a harness can
 * tell an ignored click from a missed one.
 */

export interface InjectedEventResult {
	/** The DOM event type dispatched: pointermove, pointerdown, pointerup, wheel, keydown, keyup. */
	type: string;
	/** False only when there was nowhere to dispatch it, e.g. no document body for a key. */
	dispatched: boolean;
	/**
	 * True when the dispatcher's pause gate dropped the event before any
	 * component saw it (R13.35). Listeners outside the adapter, such as the
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
	/** The dispatcher's pause state when the call started (R13.35). */
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

/**
 * A pointer event as the platform sends a mouse's: a real `PointerEvent`
 * where the runtime has one, otherwise a `MouseEvent` under the pointer
 * event's type name (see the module comment).
 */
function pointerEvent(
	canvas: HTMLCanvasElement,
	type: string,
	x: number,
	y: number,
	button: number,
	buttons: number,
): MouseEvent {
	const rect = canvas.getBoundingClientRect();
	const init = {
		bubbles: true,
		cancelable: true,
		clientX: rect.left + x,
		clientY: rect.top + y,
		button,
		buttons,
	};
	if (typeof PointerEvent === 'function') {
		return new PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true });
	}
	return new MouseEvent(type, init);
}

function dispatchStep({ canvas, dispatcher }: InjectionTarget, step: InjectedStep): InjectedEventResult {
	const swallowed = dispatcher.paused;

	switch (step.kind) {
		case 'move':
			canvas.dispatchEvent(pointerEvent(canvas, 'pointermove', step.x, step.y, -1, 0));
			return { type: 'pointermove', dispatched: true, swallowed };

		case 'down':
			canvas.dispatchEvent(
				pointerEvent(canvas, 'pointerdown', step.x, step.y, step.button, buttonsMask(step.button)),
			);
			return { type: 'pointerdown', dispatched: true, swallowed };

		case 'up':
			canvas.dispatchEvent(pointerEvent(canvas, 'pointerup', step.x, step.y, step.button, 0));
			return { type: 'pointerup', dispatched: true, swallowed };

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

/**
 * The canvas the pointer adapter listens on, and the dispatcher it feeds,
 * whose pause gate decides whether an injected event is swallowed (R13.35).
 */
export interface InjectionTarget {
	canvas: HTMLCanvasElement;
	dispatcher: Dispatcher;
}

export function injectInput(target: InjectionTarget, commands: string[]): InjectionResult {
	const paused = target.dispatcher.paused;
	const results: InjectedCommandResult[] = [];
	let ok = true;

	for (const command of commands) {
		const parsed = parseInputCommand(command);

		if (!parsed.ok) {
			ok = false;
			results.push({ command: String(command), ok: false, error: parsed.error, events: [] });
			continue;
		}

		const events = parsed.steps.map((step) => dispatchStep(target, step));
		const delivered = events.every((event) => event.dispatched);
		if (!delivered) ok = false;
		results.push({ command, ok: delivered, events });
	}

	return { ok, paused, commands: results };
}
