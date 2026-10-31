import type { Dispatcher } from '../input/Dispatcher';
import type { InjectedPointerType, InjectedStep } from './inputScript';
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
 * Pointer events are `PointerEvent`s carrying the command's `pointerId` and
 * `pointerType` (1 and `mouse` unless it names others, R9.25) where the
 * runtime has the constructor. jsdom has none, so there they are
 * `MouseEvent`s carrying the pointer event's type name, with the pointer
 * fields defined on the instance, which reach the same listeners and read
 * the same way.
 *
 * ## isPrimary
 *
 * The grammar has no field for it because the platform derives it, and so
 * does this: a mouse is always primary, and a touch or pen pointer is
 * primary when it went down while no other pointer of its type was down, and
 * stays so until it lifts or cancels (Pointer Events, `isPrimary`). Only the
 * primary pointer synthesises `click` (R9.1), so a second finger's tap
 * clicks nothing, as on a real screen. That takes a little state per
 * dispatcher across calls, kept in `pointerStates`, which also remembers
 * where each pointer last was so `cancel` can be sent from there. The state
 * follows injected input only; a real blur cancelling a gesture mid-script
 * leaves a touch pointer counted as down until the script lifts it.
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
	/** The DOM event type dispatched: pointermove, pointerdown, pointerup, pointercancel, wheel, keydown, keyup. */
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

interface PointerIdentity {
	pointerId: number;
	pointerType: InjectedPointerType;
	isPrimary: boolean;
}

interface PointerEventFields extends PointerIdentity {
	x: number;
	y: number;
	button: number;
	buttons: number;
}

/**
 * A pointer event as the platform sends one: a real `PointerEvent` where the
 * runtime has one, otherwise a `MouseEvent` under the pointer event's type
 * name with the pointer fields defined on it (see the module comment).
 */
function pointerEvent(canvas: HTMLCanvasElement, type: string, fields: PointerEventFields): MouseEvent {
	const rect = canvas.getBoundingClientRect();
	const init = {
		bubbles: true,
		cancelable: true,
		clientX: rect.left + fields.x,
		clientY: rect.top + fields.y,
		button: fields.button,
		buttons: fields.buttons,
	};
	const identity = { pointerId: fields.pointerId, pointerType: fields.pointerType, isPrimary: fields.isPrimary };
	if (typeof PointerEvent === 'function') return new PointerEvent(type, { ...init, ...identity });

	const event = new MouseEvent(type, init);
	for (const [name, value] of Object.entries(identity)) {
		Object.defineProperty(event, name, { value, enumerable: true });
	}
	return event;
}

/** Where each injected pointer last was, and which pointer of each type is primary. */
class InjectedPointers {
	private readonly pressed = new Map<number, InjectedPointerType>();
	private readonly primaryByType = new Map<InjectedPointerType, number>();
	private readonly lastSeen = new Map<number, { x: number; y: number; pointerType: InjectedPointerType }>();

	/**
	 * Call before dispatching a `down`, so the press can claim primary. It
	 * claims it only with no other pointer of its type down: a second finger
	 * that lands after the first lifts, while a third is still down, is not
	 * primary either.
	 */
	public press(pointerId: number, pointerType: InjectedPointerType): void {
		if (this.pressed.has(pointerId)) return;
		const othersDown = [...this.pressed.values()].includes(pointerType);
		if (!othersDown) this.primaryByType.set(pointerType, pointerId);
		this.pressed.set(pointerId, pointerType);
	}

	/** Call after dispatching an `up` or `cancel`. */
	public lift(pointerId: number): void {
		this.pressed.delete(pointerId);
		for (const [type, primaryId] of this.primaryByType) {
			if (primaryId === pointerId) this.primaryByType.delete(type);
		}
	}

	/** A hovering pointer with nothing of its type down is the primary one, as a lone mouse is. */
	public isPrimary(pointerId: number, pointerType: InjectedPointerType): boolean {
		if (pointerType === 'mouse') return true;
		const primaryId = this.primaryByType.get(pointerType);
		return primaryId === undefined ? !this.pressed.has(pointerId) : primaryId === pointerId;
	}

	public identity(pointerId: number, pointerType: InjectedPointerType): PointerIdentity {
		return { pointerId, pointerType, isPrimary: this.isPrimary(pointerId, pointerType) };
	}

	public moved(pointerId: number, x: number, y: number, pointerType: InjectedPointerType): void {
		this.lastSeen.set(pointerId, { x, y, pointerType });
	}

	/** Where a pointer last was and what type it was, or null for one never seen. */
	public last(pointerId: number): { x: number; y: number; pointerType: InjectedPointerType } | null {
		return this.lastSeen.get(pointerId) ?? null;
	}

	/** The command's type, else the one this pointer last had, else a mouse's. */
	public typeOf(pointerId: number, named: InjectedPointerType | undefined): InjectedPointerType {
		return named ?? this.lastSeen.get(pointerId)?.pointerType ?? 'mouse';
	}
}

/** Per dispatcher, so the state lives as long as the input path it describes. */
const pointerStates = new WeakMap<Dispatcher, InjectedPointers>();

function pointersFor(dispatcher: Dispatcher): InjectedPointers {
	let pointers = pointerStates.get(dispatcher);
	if (!pointers) {
		pointers = new InjectedPointers();
		pointerStates.set(dispatcher, pointers);
	}
	return pointers;
}

function dispatchStep({ canvas, dispatcher }: InjectionTarget, step: InjectedStep): InjectedEventResult {
	const swallowed = dispatcher.paused;
	const pointers = pointersFor(dispatcher);

	const pointerType = step.kind === 'move' || step.kind === 'down' || step.kind === 'up'
		? pointers.typeOf(step.pointerId, step.pointerType)
		: 'mouse';

	switch (step.kind) {
		case 'move': {
			const identity = pointers.identity(step.pointerId, pointerType);
			canvas.dispatchEvent(
				pointerEvent(canvas, 'pointermove', { x: step.x, y: step.y, button: -1, buttons: 0, ...identity }),
			);
			pointers.moved(step.pointerId, step.x, step.y, pointerType);
			return { type: 'pointermove', dispatched: true, swallowed };
		}

		case 'down': {
			pointers.press(step.pointerId, pointerType);
			const identity = pointers.identity(step.pointerId, pointerType);
			const buttons = buttonsMask(step.button);
			canvas.dispatchEvent(
				pointerEvent(canvas, 'pointerdown', { x: step.x, y: step.y, button: step.button, buttons, ...identity }),
			);
			pointers.moved(step.pointerId, step.x, step.y, pointerType);
			return { type: 'pointerdown', dispatched: true, swallowed };
		}

		case 'up': {
			const identity = pointers.identity(step.pointerId, pointerType);
			canvas.dispatchEvent(
				pointerEvent(canvas, 'pointerup', { x: step.x, y: step.y, button: step.button, buttons: 0, ...identity }),
			);
			pointers.moved(step.pointerId, step.x, step.y, pointerType);
			pointers.lift(step.pointerId);
			return { type: 'pointerup', dispatched: true, swallowed };
		}

		case 'cancel': {
			// injectInput refuses a cancel for a pointer never seen, so this is known.
			const { x, y, pointerType: lastType } = pointers.last(step.pointerId) ?? { x: 0, y: 0, pointerType: 'mouse' as const };
			const identity = pointers.identity(step.pointerId, lastType);
			canvas.dispatchEvent(pointerEvent(canvas, 'pointercancel', { x, y, button: -1, buttons: 0, ...identity }));
			pointers.lift(step.pointerId);
			return { type: 'pointercancel', dispatched: true, swallowed };
		}

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

		// A cancel says a gesture was abandoned, so there has to have been a
		// pointer to abandon. A mouse cancel at the origin for a mistyped id
		// would report success and prove nothing.
		const unknown = parsed.steps.find((step) => step.kind === 'cancel' && pointersFor(target.dispatcher).last(step.pointerId) === null);
		if (unknown && unknown.kind === 'cancel') {
			ok = false;
			results.push({ command, ok: false, error: `cancel: no pointer ${unknown.pointerId} has moved or pressed yet`, events: [] });
			continue;
		}

		const events = parsed.steps.map((step) => dispatchStep(target, step));
		const delivered = events.every((event) => event.dispatched);
		if (!delivered) ok = false;
		results.push({ command, ok: delivered, events });
	}

	return { ok, paused, commands: results };
}
