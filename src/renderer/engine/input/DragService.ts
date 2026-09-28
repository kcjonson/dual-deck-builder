import type { Vec2 } from '../draw/geometry';
import type { LayerName } from '../draw/layers';
import type { Component, PointerEvents } from '../components/Component';
import type { ComponentTransform } from '../components/componentGeometry';
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
	/** The ghost's own values, put back when the drag ends. */
	restore: { layer: LayerName | null; pointerEvents: PointerEvents; transform: ComponentTransform } | null;
}

/**
 * R9.12's drag and drop, one per dispatcher and reached as `context.drag`.
 *
 * A component starts a drag from its `pointerdown` handler with
 * `context.drag.start({ event, source, data })`; the service captures the
 * pointer for the source unless something already has. Until the pointer
 * moves past the threshold the press is still a candidate click, so a card
 * can be clicked to select and dragged to target (R9.12a). Past it the drag
 * is active: the ghost (the source unless given) is promoted to the `drag`
 * layer with `pointerEvents: none` and follows the pointer by a transform
 * translation, so layout never sees it, and every move hit-tests with the
 * ghost excluded and synthesises `dragleave` on what the pointer left,
 * `dragenter` on what it entered, then `dragover`, all bubbling (R9.12b).
 *
 * A component accepts by calling `event.accept()` as a `dragenter` or
 * `dragover` passes through it; it keeps `dropActive` until the pointer
 * leaves the component the enter was for (R9.12c). Release over an
 * accepting target fires `drop` at the component under the pointer,
 * bubbling to the acceptor, then `dragend { dropped: true, dropTarget }` on
 * the source; any other release fires `dragleave` there and
 * `dragend { dropped: false }`, as HTML does. `pointercancel`, loss of
 * capture, unmount of the source or ghost, and `cancel()` end it with
 * `dragend { dropped: false }` (R9.12d). A drag that never went active ends
 * silently and the dispatcher's click decides.
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
	 * started, when the event is not a `pointerdown` or a drag is already in
	 * progress.
	 */
	public start({ event, source, data, ghost = source, threshold }: DragStartOptions): boolean {
		if (event.type !== 'pointerdown' || this.session) return false;
		if (!this.host.captorOf(event.pointerId)) this.host.capturePointer(source, event.pointerId);
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
			restore: null,
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

	/** After the `pointermove` is delivered: the threshold, the ghost, and targeting. */
	public pointerMove(pointerId: number, point: Vec2): void {
		const session = this.session;
		if (!session || session.pointerId !== pointerId) return;
		session.position = point;
		if (!session.active) {
			if (Math.hypot(point.x - session.press.x, point.y - session.press.y) <= session.threshold) return;
			this.activate(session);
		}
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
		this.session = null;
		if (!session.active) return false;
		session.position = point;
		this.retarget(session, false);
		this.restoreGhost(session);
		const { target, acceptor } = session;
		acceptor?.setDropActive(false);
		if (target && acceptor) {
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

	private activate(session: Session): void {
		session.active = true;
		const ghost = session.ghost;
		session.restore = { layer: ghost.layer, pointerEvents: ghost.pointerEvents, transform: ghost.transform };
		ghost.layer = 'drag';
		ghost.pointerEvents = 'none';
		this.notify(true);
	}

	/**
	 * R9.12b: the ghost keeps the offset between it and the pointer at the
	 * press. The pointer's travel is taken into the ghost's parent space and
	 * added to its own translation, which is the outermost part of its
	 * transform, so a rotated or scaled ghost moves without turning.
	 */
	private followPointer(session: Session): void {
		const restore = session.restore;
		if (!restore) return;
		const parent = session.ghost.parent;
		const from = parent ? parent.screenToLocal(session.press) : session.press;
		const to = parent ? parent.screenToLocal(session.position) : session.position;
		if (!from || !to) return;
		const base = restore.transform;
		session.ghost.transform = {
			...base,
			translate: [base.translate[0] + to.x - from.x, base.translate[1] + to.y - from.y],
		};
	}

	/**
	 * Hit-tests at the pointer with the ghost excluded. A change of target is
	 * `dragleave` on the old one and `dragenter` on the new; `over` adds the
	 * `dragover` a move delivers. Acceptance belongs to one target: it is
	 * collected afresh on each enter and kept while the target stays.
	 */
	private retarget(session: Session, over: boolean): void {
		const hit = this.host.hitTest(session.position, { exclude: session.ghost });
		let acceptor = session.acceptor;
		if (hit !== session.target) {
			const previous = session.target;
			session.target = hit;
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
			acceptor = acceptor ?? dragover.acceptedBy;
		}
		// A handler may have cancelled the drag while it ran.
		if (!session.active) return;
		this.setAcceptor(session, acceptor);
	}

	private setAcceptor(session: Session, acceptor: Component | null): void {
		if (acceptor === session.acceptor) return;
		session.acceptor?.setDropActive(false);
		session.acceptor = acceptor;
		acceptor?.setDropActive(true);
	}

	/** Ends a drag without a drop: `dragleave` on the target and `dragend { dropped: false }` if it was active. */
	private abandon(session: Session): void {
		if (this.session === session) this.session = null;
		if (!session.active) return;
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
		const restore = session.restore;
		if (!restore) return;
		session.restore = null;
		const ghost = session.ghost;
		ghost.layer = restore.layer;
		ghost.pointerEvents = restore.pointerEvents;
		ghost.transform = restore.transform;
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
