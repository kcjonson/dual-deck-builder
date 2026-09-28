import type { Vec2 } from '../draw/geometry';
import type { Component } from '../components/Component';
import { tokens } from '../theme/tokens';
import { DragEventType, PointerType, UiDragEvent, UiPointerEvent } from './events';
import type { HitTestOptions } from './hitTest';

/**
 * R9.12a: how far a press moves, in logical pixels, before it stops being a
 * candidate click. The `control` tokens: 4 for mouse, pen and the virtual
 * cursor, 10 for a finger.
 */
export function dragThreshold(pointerType: PointerType): number {
	return pointerType === 'touch' ? tokens.control.drag_threshold_touch : tokens.control.drag_threshold_mouse;
}

export interface DragStartOptions {
	/** The `pointerdown` the drag grows from; the drag follows its pointer. */
	event: UiPointerEvent;
	source: Component;
	/** Handed to every target on every drag event. */
	data: unknown;
	/** What follows the pointer, mounted somewhere; the source when absent (R9.12b). */
	ghost?: Component;
	/** Logical pixels before the drag is active; the pointer type's token when absent. */
	threshold?: number;
}

/** What a reader such as the tooltip service sees of the drag in progress. */
export interface ActiveDrag {
	readonly source: Component;
	readonly data: unknown;
	/** The component under the pointer, the ghost excluded. */
	readonly target: Component | null;
	/** The component that accepted, whose `dropActive` is set; null when nothing has. */
	readonly acceptor: Component | null;
}

/** The dispatcher's half: the parts of dispatch the drag service drives. */
export interface DragHost {
	hitTest(point: Vec2, options: HitTestOptions): Component | null;
	bubble(event: UiDragEvent): void;
	capturePointer(component: Component, pointerId: number): void;
	captorOf(pointerId: number): Component | null;
	/** The press on this pointer can no longer click (R9.31). */
	spendPress(pointerId: number): void;
	/** The pointer's press is down and can still click: not cancelled, not already a touch hold. */
	pressLive(pointerId: number): boolean;
	readonly now: number;
}

interface Session {
	readonly pointerId: number;
	readonly pointerType: PointerType;
	readonly source: Component;
	readonly ghost: Component;
	readonly data: unknown;
	readonly threshold: number;
	readonly press: Vec2;
	position: Vec2;
	active: boolean;
	target: Component | null;
	acceptor: Component | null;
	/** A `dragover` on the current target accepted, so acceptance follows each `dragover` from here on. */
	acceptsOnOver: boolean;
	/** The ghost's travel in its parent's space. */
	offset: Vec2;
}

/**
 * R9.12's drag and drop, one per dispatcher and reached as `context.drag`.
 *
 * A component starts a drag from its `pointerdown` handler with
 * `context.drag.start({ event, source, data })`, primary button only. Until
 * the pointer moves past the threshold the press is still a candidate click,
 * so a card can be clicked to select and dragged to target (R9.12a); the
 * pointer is not captured yet, so the click lands where it would have
 * without the drag, on a button inside the card as much as on the card.
 * Past the threshold the drag is active: the source captures the pointer
 * unless something already has, the ghost (the source unless given) draws
 * on the `drag` layer with `pointerEvents: none` and follows the pointer by
 * an offset outside its own transform (`Component.dragOffset`), so layout
 * never sees it and a transform tween keeps running under it, and every move
 * hit-tests with the ghost excluded and synthesises `dragleave` on what the
 * pointer left, `dragenter` on what it entered, then `dragover`, all
 * bubbling (R9.12b). A press that already fired a touch-hold `contextmenu`
 * never goes active.
 *
 * A component accepts by calling `event.accept()` as a `dragenter` or
 * `dragover` passes through it, the innermost caller winning (R9.12c).
 * Acceptance on enter lasts while the pointer stays on that target; once a
 * `dragover` on the target has accepted, acceptance follows each `dragover`,
 * so a target that accepts by position accepts in `dragover` and stops by
 * not calling it. The acceptor shows `dropActive`. Release over an acceptor
 * fires `drop` at the component under the pointer, bubbling to the
 * acceptor, then `dragend { dropped: true, dropTarget }` on the source; any
 * other release fires `dragleave` there and `dragend { dropped: false }`, as
 * HTML does. `pointercancel`, loss of capture, unmount of the source or
 * ghost, and `cancel()` end it with `dragend { dropped: false }` (R9.12d).
 * However it ends, an active drag's release is never a click. A drag that
 * never went active ends silently and the dispatcher's click decides.
 *
 * One drag at a time: a second `start` while one is in progress is refused.
 * Tooltips read `isDragging` and `onDraggingChange` (R9.12e).
 */
export class DragService {
	private readonly host: DragHost;
	private session: Session | null = null;
	private readonly listeners = new Set<(dragging: boolean) => void>();

	constructor({ host }: { host: DragHost }) {
		this.host = host;
	}

	// -- public API -----------------------------------------------------------

	/**
	 * Begins a candidate drag on the press's pointer. False, with nothing
	 * started, when the event is not a primary-button `pointerdown` (a
	 * right-click stays a `contextmenu`) or a drag is already in progress.
	 */
	public start({ event, source, data, ghost = source, threshold }: DragStartOptions): boolean {
		if (event.type !== 'pointerdown' || event.button !== PRIMARY_BUTTON || this.session) return false;
		this.session = {
			pointerId: event.pointerId,
			pointerType: event.pointerType,
			source,
			ghost,
			data,
			threshold: threshold ?? dragThreshold(event.pointerType),
			press: event.screen,
			position: event.screen,
			active: false,
			target: null,
			acceptor: null,
			acceptsOnOver: false,
			offset: ORIGIN,
		};
		return true;
	}

	/** A drag is past its threshold and following the pointer (R9.12e's test). */
	public get isDragging(): boolean {
		return this.session?.active ?? false;
	}

	/** The active drag, or null while none is (a candidate is not one yet). */
	public get current(): ActiveDrag | null {
		const session = this.session;
		if (!session?.active) return null;
		return { source: session.source, data: session.data, target: session.target, acceptor: session.acceptor };
	}

	/** R9.12c's source-side `canDrop`: something under the pointer has accepted. */
	public get canDrop(): boolean {
		return this.session?.active === true && this.session.acceptor !== null;
	}

	/**
	 * Hears every change of `isDragging`; returns the unsubscribe. The
	 * tooltip service hides and holds its tooltips on `true` (R9.12e).
	 */
	public onDraggingChange(listener: (dragging: boolean) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Abandons the drag in progress as a cancel does (Escape, a right-click
	 * during the drag): `dragend { dropped: false }` if it was active. The
	 * press can no longer click, and the pointer stays captured until
	 * release so nothing under it hears the rest of the gesture.
	 */
	public cancel(): void {
		const session = this.session;
		if (!session) return;
		this.host.spendPress(session.pointerId);
		this.abandon(session);
	}

	// -- the dispatcher's hooks -----------------------------------------------

	/**
	 * Before the `pointermove` is delivered: the threshold. A move that
	 * crosses it activates the drag and captures the pointer first, so the
	 * move itself already goes to the captor and hovers nothing else.
	 */
	public pointerMoving(pointerId: number, point: Vec2): void {
		const session = this.session;
		if (!session || session.pointerId !== pointerId || session.active) return;
		if (Math.hypot(point.x - session.press.x, point.y - session.press.y) <= session.threshold) return;
		// R9.30: a touch hold already answered this press with a
		// `contextmenu`, or it was cancelled; it is not a drag.
		if (!this.host.pressLive(pointerId)) {
			this.session = null;
			return;
		}
		this.activate(session);
	}

	/** After the `pointermove` is delivered: the ghost, and targeting. */
	public pointerMove(pointerId: number, point: Vec2): void {
		const session = this.session;
		if (!session?.active || session.pointerId !== pointerId) return;
		session.position = point;
		this.followPointer(session);
		this.retarget(session, true);
	}

	/**
	 * After the `pointerup` is delivered. True when an active drag ended
	 * here, so the release is a drop and never a click (R9.31).
	 */
	public pointerUp(pointerId: number, point: Vec2): boolean {
		const session = this.session;
		if (!session || session.pointerId !== pointerId) return false;
		if (!session.active) {
			this.session = null;
			return false;
		}
		session.position = point;
		// The session stays current through the release's own enter and
		// leave, so a handler there can still cancel the drag or unmount its
		// target and be heard.
		this.retarget(session, false);
		if (this.session !== session) return true;
		this.session = null;
		this.restoreGhost(session);
		const { target, acceptor } = session;
		acceptor?.setDropActive(false);
		if (target?.isMounted && acceptor?.isMounted) {
			this.host.bubble(this.event('drop', target, session));
			this.end(session, true, acceptor);
		} else {
			if (target?.isMounted) this.host.bubble(this.event('dragleave', target, session));
			this.end(session, false, null);
		}
		return true;
	}

	/** `pointercancel` or loss of capture on the pointer (R9.12d). */
	public pointerLost(pointerId: number): void {
		const session = this.session;
		if (!session || session.pointerId !== pointerId) return;
		this.abandon(session);
	}

	/**
	 * Each frame's input phase, before the queue: content that moved or
	 * unmounted under a still pointer changes the target, as it does hover
	 * (R9.9). Enter and leave only; `dragover` is for moves.
	 */
	public refresh(): void {
		const session = this.session;
		if (session?.active) this.retarget(session, false);
	}

	/** A component is unmounting: the drag ends if it was the source or ghost, and forgets it as a target. */
	public forget(component: Component): void {
		const session = this.session;
		if (!session) return;
		if (component === session.source || component === session.ghost) {
			this.abandon(session);
			return;
		}
		if (session.acceptor === component) {
			component.setDropActive(false);
			session.acceptor = null;
		}
		// The next refresh re-derives the target from the pointer.
		if (session.target === component) session.target = null;
	}

	/** The shell's teardown: drops the drag without events. */
	public reset(): void {
		const session = this.session;
		this.session = null;
		if (!session?.active) return;
		session.acceptor?.setDropActive(false);
		this.restoreGhost(session);
		this.notify(false);
	}

	// -- internals ------------------------------------------------------------

	/**
	 * The drag goes active: the source takes the pointer so nothing under the
	 * ghost hears the rest of the gesture as pointer events (R9.10), unless
	 * something already holds it (a touch's implicit captor).
	 */
	private activate(session: Session): void {
		session.active = true;
		if (!this.host.captorOf(session.pointerId)) this.host.capturePointer(session.source, session.pointerId);
		session.ghost.setDragOffset(ORIGIN);
		this.notify(true);
	}

	/**
	 * R9.12b: the ghost keeps the offset between it and the pointer at the
	 * press. The pointer's travel is taken into the ghost's parent space and
	 * applied outside its transform, so a rotated or scaled ghost moves
	 * without turning.
	 */
	private followPointer(session: Session): void {
		const parent = session.ghost.parent;
		const from = parent ? parent.screenToLocal(session.press) : session.press;
		const to = parent ? parent.screenToLocal(session.position) : session.position;
		if (!from || !to) return;
		session.offset = { x: to.x - from.x, y: to.y - from.y };
		session.ghost.setDragOffset(session.offset);
	}

	/**
	 * Hit-tests at the pointer with the ghost excluded. A change of target is
	 * `dragleave` on the old one and `dragenter` on the new; `over` adds the
	 * `dragover` a move delivers. Acceptance belongs to one target: collected
	 * afresh on each enter, kept while the target stays, and re-derived on
	 * every `dragover` once one of them accepted.
	 */
	private retarget(session: Session, over: boolean): void {
		const hit = this.host.hitTest(session.position, { exclude: session.ghost });
		let acceptor = session.acceptor;
		if (hit !== session.target) {
			const previous = session.target;
			session.target = hit;
			session.acceptsOnOver = false;
			acceptor = null;
			if (previous?.isMounted) this.host.bubble(this.event('dragleave', previous, session));
			if (hit && session.active) {
				const enter = this.event('dragenter', hit, session);
				this.host.bubble(enter);
				acceptor = enter.acceptedBy;
			}
		}
		if (over && hit && session.active && session.target === hit) {
			const dragover = this.event('dragover', hit, session);
			this.host.bubble(dragover);
			if (dragover.acceptedBy) {
				session.acceptsOnOver = true;
				acceptor = dragover.acceptedBy;
			} else if (session.acceptsOnOver) {
				acceptor = null;
			}
		}
		// A handler may have cancelled the drag, or unmounted what accepted, while it ran.
		if (!session.active) return;
		this.setAcceptor(session, acceptor?.isMounted ? acceptor : null);
	}

	private setAcceptor(session: Session, acceptor: Component | null): void {
		if (acceptor === session.acceptor) return;
		session.acceptor?.setDropActive(false);
		session.acceptor = acceptor;
		acceptor?.setDropActive(true);
	}

	/**
	 * Ends a drag without a drop: `dragleave` on the target and
	 * `dragend { dropped: false }` if it was active, and the release that
	 * follows is not a click (R9.30).
	 */
	private abandon(session: Session): void {
		if (this.session === session) this.session = null;
		if (!session.active) return;
		this.host.spendPress(session.pointerId);
		this.restoreGhost(session);
		session.acceptor?.setDropActive(false);
		session.acceptor = null;
		const target = session.target;
		if (target?.isMounted) this.host.bubble(this.event('dragleave', target, session));
		this.end(session, false, null);
	}

	private end(session: Session, dropped: boolean, dropTarget: Component | null): void {
		session.active = false;
		if (session.source.isMounted) {
			this.host.bubble(this.event('dragend', session.source, session, { dropped, dropTarget }));
		}
		this.notify(false);
	}

	private restoreGhost(session: Session): void {
		session.ghost.setDragOffset(null);
	}

	private event(
		type: DragEventType,
		target: Component,
		session: Session,
		end?: { dropped: boolean; dropTarget: Component | null },
	): UiDragEvent {
		return new UiDragEvent({
			type,
			timestamp: this.host.now,
			target,
			screen: session.position,
			source: session.source,
			data: session.data,
			pointerId: session.pointerId,
			pointerType: session.pointerType,
			dropped: end?.dropped,
			dropTarget: end?.dropTarget,
			ghostOffset: end ? session.offset : undefined,
		});
	}

	private notify(dragging: boolean): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(dragging);
			} catch (error) {
				console.error('DragService: a dragging listener threw', error);
			}
		}
	}
}

const PRIMARY_BUTTON = 0;
const ORIGIN: Vec2 = Object.freeze({ x: 0, y: 0 });
