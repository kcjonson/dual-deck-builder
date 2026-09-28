import type { Vec2 } from '../draw/geometry';
import type { Clock } from '../animation/Clock';
import type { Component } from '../components/Component';
import type { UiFrame } from '../components/UiFrame';
import {
	AnyUiEvent,
	Modifiers,
	NO_MODIFIERS,
	PointerEventType,
	PointerType,
	UiKeyEvent,
	UiPointerEvent,
	UiWheelEvent,
} from './events';
import { HitTestOptions, hitTest } from './hitTest';
import { HotkeyTable, KeyStroke } from './HotkeyTable';

/** R9.12a's tokens: movement under which a press is still a candidate click. */
export const DRAG_THRESHOLD_MOUSE = 4;
export const DRAG_THRESHOLD_TOUCH = 10;
/** R9.32: a wheel event within this long of the last stays with the latched scroller. */
export const WHEEL_LATCH_MS = 150;
/** R9.30: a touch held this long under the drag threshold is a `contextmenu`. */
export const TOUCH_HOLD_MS = 500;
/** R9.3: one line of a line-mode wheel delta, in logical pixels. */
export const WHEEL_LINE_PX = 16;

const PRIMARY_BUTTON = 0;
const SECONDARY_BUTTON = 2;

/**
 * Where a root sits in paint order, which is hit order reversed (R3.15,
 * R3.28): the scene's own roots in the order they were mounted, then the
 * overlay service's roots in the order it keeps (open order, with
 * `bringToFront`), then diagnostic roots such as the F5 overlay, which draw
 * as their own domain after the UI's (R3.21).
 */
export type RootTier = 'scene' | 'overlay' | 'diagnostic';

const ROOT_TIER_RANK: Readonly<Record<RootTier, number>> = { scene: 0, overlay: 1, diagnostic: 2 };

/** A `pointerdown` about to be delivered, as an input observer sees it. */
export interface PointerPress {
	/** What the press landed on; null over nothing. */
	readonly target: Component | null;
	readonly x: number;
	readonly y: number;
	readonly pointerId: number;
	readonly pointerType: PointerType;
	readonly button: number;
}

/** A pointer's position after a move, with what it is over. */
export interface PointerPosition {
	readonly target: Component | null;
	readonly x: number;
	readonly y: number;
	readonly pointerId: number;
	readonly pointerType: PointerType;
}

/**
 * The services' view of the dispatcher (R12.30 to R12.32): the popup,
 * overlay, and tooltip services close, dismiss, and hide from what they are
 * told here, and never from listeners of their own. Observers run in the
 * order they were added; the mount context adds tooltips, then popups, then
 * overlays, so a tooltip hides on a press a popup swallows and a popup's
 * Escape wins over the dialog beneath it.
 */
export interface InputObserver {
	/**
	 * Before a `pointerdown` is delivered and before it moves focus. Returning
	 * true swallows the press: it is not delivered, focus stays, and it
	 * produces no click (R9.13's consumed outside press). Later observers
	 * still hear it; only the first true matters.
	 */
	pointerDown?(press: PointerPress, swallowed: boolean): boolean | void;
	/** After a move of the hovering pointer, hover already updated. */
	pointerMove?(position: PointerPosition): void;
	/** The hovered target changed (R9.8): the innermost hovered component, or null. */
	hoverChange?(target: Component | null): void;
	/**
	 * A `keydown` the focused chain did not consume, before the scene's
	 * hotkey table (R9.15). Returning true consumes it; later observers and
	 * the table do not hear it.
	 */
	keyDown?(stroke: KeyStroke): boolean | void;
	/** Key delivery moved (the focus seam; DDB-76's manager takes it over). */
	focusChange?(focused: Component | null): void;
}

/** `WheelEvent.deltaMode`: pixels, lines, pages. */
export type WheelDeltaMode = 0 | 1 | 2;

interface PointerFields {
	x: number;
	y: number;
	pointerId: number;
	pointerType: PointerType;
	isPrimary: boolean;
	button: number;
	buttons: number;
	pressure: number;
	modifiers: Modifiers;
}

/**
 * What a platform adapter hands the queue (R9.2): positions already in
 * viewport logical pixels, wheel deltas still in the platform's units, since
 * page mode can only be resolved against the scroller that takes them (R9.3).
 * No timestamps: events are stamped with the frame clock when dispatched, the
 * one time UI code reads (R8.28).
 */
export type PlatformInput =
	| (PointerFields & { kind: 'pointer'; phase: 'down' | 'move' | 'up' | 'cancel'; coalesced?: Vec2[] })
	| { kind: 'leave'; pointerId: number }
	| {
		kind: 'wheel';
		x: number;
		y: number;
		deltaX: number;
		deltaY: number;
		deltaMode: WheelDeltaMode;
		modifiers: Modifiers;
	}
	| { kind: 'key'; phase: 'down' | 'up'; key: string; repeat: boolean; modifiers: Modifiers }
	| { kind: 'blur' };

interface Press {
	/** Null when the press landed on nothing, or its target has since unmounted. */
	target: Component | null;
	x: number;
	y: number;
	button: number;
	pointerType: PointerType;
	/** Clock time of the press, for the touch hold (R9.30). */
	startTime: number;
	/** Moved past the drag threshold: no touch hold, and no click if the press is on a drag source. */
	moved: boolean;
	/** Cancelled or already a hold: no click (R9.31). */
	spent: boolean;
	/**
	 * An observer swallowed it (a popup's outside press, R9.13): its release
	 * is swallowed too, as a native menu eats the dismissing click whole.
	 */
	swallowed: boolean;
}

export interface DispatcherOptions {
	/**
	 * R8.16 and R9.2: laid out on demand before every hit test, so a pointer
	 * never lands on geometry from before a change, and watched for layout
	 * that moved content under a still pointer (R9.9).
	 */
	frame: UiFrame;
	/**
	 * R8.28's frame clock, for event timestamps, wheel latching, and the touch
	 * hold. The frame advances it; the dispatcher never reads a platform timer.
	 */
	clock: Clock;
	/** `dpr * uiScale` for clip snapping in the hit walk (R7.8a); 1 when absent. */
	pixelRatio?: () => number;
}

/**
 * Chapter 9's dispatcher: one per mount context, fed by a platform adapter
 * (`PointerAdapter` on the web) and by the injection hook through the same
 * adapter (R9.25, R13.35).
 *
 * Platform events queue as they arrive and are dispatched by
 * `dispatchPending`, which each frame loop calls first (R8.16, R9.2). A
 * pointer event starts with the hit-test walk over the mounted roots in
 * paint order (R9.4, `hitTest`), or at the captor when its pointer is
 * captured (R9.10), and bubbles through parents until consumed (R9.6).
 * `pointerenter`, `pointerleave` and `hovered` are derived here from
 * consecutive hit tests (R9.8, R9.9); `click` is synthesised on the nearest
 * common ancestor of the press and release targets (R9.31); wheel deltas are
 * normalised and latched to one scroller per gesture (R9.3, R9.32). Keys go
 * to the focused component, bubble, and fall through to the hotkey table
 * (R9.15).
 *
 * Focus is a seam here, not a manager: the focused component, set by
 * `focus()`, receives keys, and a press outside it clears it (R9.23's
 * fallback). DDB-76's focus manager takes the seam over; drag and drop
 * (DDB-77) builds on `capturePointer` and `hitTest({ exclude })`.
 */
export class Dispatcher {
	/** R9.15's scene hotkey table: keys nothing focused consumed. */
	public readonly hotkeys = new HotkeyTable();

	private readonly frame: UiFrame;
	private readonly clock: Clock;
	private readonly pixelRatio: () => number;
	private queue: PlatformInput[] = [];
	/** Paint order: grouped by tier, and in the order each tier supplies within it. */
	private readonly rootList: Component[] = [];
	private readonly rootTiers = new Map<Component, RootTier>();
	private readonly observers: InputObserver[] = [];
	/** The hovered chain, outermost first: the target and every ancestor (R9.8). */
	private hoverPath: Component[] = [];
	/** The hovering pointer's last position, or null while no hover-capable pointer is over the surface. */
	private hoverPosition: { pointerId: number; x: number; y: number } | null = null;
	private hoverStale = false;
	private layoutVersionSeen = -1;
	private readonly captures = new Map<number, Component>();
	private readonly presses = new Map<number, Press>();
	private focusedComponent: Component | null = null;
	private latch: { scroller: Component; lastTime: number } | null = null;
	private inputPaused = false;
	private dispatching = false;

	constructor({ frame, clock, pixelRatio = () => 1 }: DispatcherOptions) {
		this.frame = frame;
		this.clock = clock;
		this.pixelRatio = pixelRatio;
	}

	/** Lays out on demand, then walks the roots (R9.2, R9.4). */
	private hit(x: number, y: number, options?: HitTestOptions): Component | null {
		this.frame.layout();
		return hitTest(this.rootList, x, y, { ratio: this.pixelRatio(), ...options });
	}

	// -- roots ----------------------------------------------------------------

	/**
	 * The mounted roots in paint order, which the hit walk visits so a later
	 * root is hit over an earlier one in the same layer (R3.15, R3.28): scene
	 * roots in mount order, then overlay roots in the overlay service's
	 * order, then diagnostic roots. Across layers the walk's ordinal
	 * comparison already puts a higher layer first, whatever the root order.
	 */
	public get roots(): readonly Component[] {
		return this.rootList;
	}

	/** Called by `Component.mount` on a root, at the end of its tier. */
	public addRoot(root: Component, tier: RootTier = 'scene'): void {
		if (this.rootTiers.has(root)) return;
		this.rootTiers.set(root, tier);
		this.rootList.splice(this.tierEnd(tier), 0, root);
		this.hoverStale = true;
	}

	/** Moves a root to the end of its tier: painted and hit over the rest of it (R3.6a's `bringToFront`). */
	public raiseRoot(root: Component): void {
		const tier = this.rootTiers.get(root);
		if (tier === undefined) return;
		this.rootList.splice(this.rootList.indexOf(root), 1);
		this.rootList.splice(this.tierEnd(tier), 0, root);
		this.hoverStale = true;
	}

	private tierEnd(tier: RootTier): number {
		const rank = ROOT_TIER_RANK[tier];
		let index = 0;
		while (index < this.rootList.length && ROOT_TIER_RANK[this.rootTiers.get(this.rootList[index]) as RootTier] <= rank) index++;
		return index;
	}

	// -- observers (R12.30 to R12.32) -----------------------------------------

	/** Adds a service's observer; the returned function removes it. */
	public addObserver(observer: InputObserver): () => void {
		this.observers.push(observer);
		return () => {
			const index = this.observers.indexOf(observer);
			if (index !== -1) this.observers.splice(index, 1);
		};
	}

	/** The hovering pointer's last position, or null while none is over the surface. */
	public get hoverPoint(): Vec2 | null {
		const position = this.hoverPosition;
		return position ? { x: position.x, y: position.y } : null;
	}

	/** Whether any pointer is captured (R9.10); tooltips stay hidden while one is (R12.22). */
	public get capturing(): boolean {
		return this.captures.size > 0;
	}

	// -- pause (R13.32, R13.35) -----------------------------------------------

	/**
	 * While paused, platform input is dropped at the queue, injected input
	 * included, and whatever was queued is discarded. The one gate for both
	 * pages, reached through their pause controls.
	 */
	public get paused(): boolean {
		return this.inputPaused;
	}

	/**
	 * Pausing also abandons every gesture in progress, as a window blur does
	 * (R9.30): the release it would have needed is dropped at the queue, so a
	 * press held across a pause would otherwise stay pressed, captured, and
	 * able to click after resume. Resuming re-derives hover.
	 */
	public set paused(value: boolean) {
		if (value === this.inputPaused) return;
		this.inputPaused = value;
		if (value) {
			this.queue = [];
			for (const pointerId of new Set([...this.presses.keys(), ...this.captures.keys()])) {
				this.cancelPointer(pointerId);
			}
			this.latch = null;
		} else {
			this.hoverStale = true;
		}
	}

	// -- queue (R9.2) ---------------------------------------------------------

	/**
	 * Queues one platform event for the next `dispatchPending`. Consecutive
	 * moves of one pointer coalesce: the last position wins and the skipped
	 * ones ride along on the event as `coalesced`.
	 */
	public enqueue(input: PlatformInput): void {
		if (this.inputPaused) return;
		if (input.kind === 'pointer' && input.phase === 'move') {
			const last = this.queue[this.queue.length - 1];
			if (last && last.kind === 'pointer' && last.phase === 'move' && last.pointerId === input.pointerId) {
				const skipped = last.coalesced ?? [];
				skipped.push({ x: last.x, y: last.y });
				this.queue[this.queue.length - 1] = { ...input, coalesced: skipped };
				return;
			}
		}
		this.queue.push(input);
	}

	public get pendingCount(): number {
		return this.queue.length;
	}

	/**
	 * Dispatches everything queued since the last call, in arrival order: the
	 * frame's input phase (R8.16). Hover is re-derived first when layout,
	 * roots, a scroll, or a capture release moved content under a still
	 * pointer (R9.9), and again after the batch. A handler that throws is
	 * reported and the rest of the batch still dispatches, as separate DOM
	 * events would.
	 */
	public dispatchPending(): void {
		if (this.dispatching) return;
		this.dispatching = true;
		try {
			this.cancelInvalidCaptors();
			this.refreshHover();
			this.fireTouchHolds();
			const batch = this.queue;
			this.queue = [];
			for (const input of batch) {
				try {
					this.dispatchInput(input);
				} catch (error) {
					console.error('Dispatcher: a handler threw while dispatching', input, error);
				}
			}
			this.refreshHover();
		} finally {
			this.dispatching = false;
		}
	}

	// -- hit testing (R9.4) ---------------------------------------------------

	/**
	 * The topmost component under a viewport point, the one a pointer event
	 * there would target. Lays out first, like every dispatch-time hit test.
	 */
	public hitTest(point: Vec2, options?: HitTestOptions): Component | null {
		return this.hit(point.x, point.y, options);
	}

	// -- capture (R9.10) ------------------------------------------------------

	/** Routes every later event of `pointerId` to `component`, with no hit test. */
	public capturePointer(component: Component, pointerId: number): void {
		this.captures.set(pointerId, component);
	}

	/** Ends a capture: `lostpointercapture` on the captor, then hover from the current position. */
	public releasePointer(pointerId: number): void {
		const captor = this.captures.get(pointerId);
		if (!captor) return;
		this.captures.delete(pointerId);
		this.deliverTo(captor, this.pointerEvent('lostpointercapture', captor, this.lastPointerFields(pointerId)));
		this.hoverStale = true;
	}

	public captorOf(pointerId: number): Component | null {
		return this.captures.get(pointerId) ?? null;
	}

	// -- focus seam (DDB-76 replaces) -----------------------------------------

	public get focused(): Component | null {
		return this.focusedComponent;
	}

	/** Moves key delivery to `component`: `onBlur` on the previous, then `onFocus` (R9.22's order). */
	public focus(component: Component | null): void {
		const previous = this.focusedComponent;
		if (previous === component) return;
		this.focusedComponent = component;
		previous?.setFocused(false);
		component?.setFocused(true);
		for (const observer of [...this.observers]) observer.focusChange?.(component);
	}

	// -- unmount (R8.15, R9.10, R9.21) ----------------------------------------

	/**
	 * Drops everything the dispatcher holds on `component` as it unmounts:
	 * its root entry, its place in the hover chain, focus (without callbacks,
	 * since it may be mid-teardown), a press it is the target of, and the
	 * latch. A captor hears `pointercancel` first, then loses the capture.
	 */
	public forget(component: Component): void {
		const rootIndex = this.rootList.indexOf(component);
		if (rootIndex !== -1) {
			this.rootList.splice(rootIndex, 1);
			this.rootTiers.delete(component);
			this.hoverStale = true;
		}

		const hoverIndex = this.hoverPath.indexOf(component);
		if (hoverIndex !== -1) {
			// Everything below it in the chain is its descendant and unmounted
			// before it; the chain above it is still hovered until hover is
			// re-derived.
			this.hoverPath.length = hoverIndex;
			this.hoverStale = true;
		}

		if (this.focusedComponent === component) this.focusedComponent = null;

		for (const [pointerId, captor] of this.captures) {
			if (captor !== component) continue;
			this.cancelPointer(pointerId);
		}

		for (const press of this.presses.values()) {
			if (press.target === component) {
				press.target = null;
				press.spent = true;
			}
		}

		if (this.latch?.scroller === component) this.latch = null;
	}

	/** Detaches from everything: the shell's teardown. */
	public reset(): void {
		this.queue = [];
		this.rootList.length = 0;
		this.rootTiers.clear();
		this.hoverPath = [];
		this.hoverPosition = null;
		this.captures.clear();
		this.presses.clear();
		this.focusedComponent = null;
		this.latch = null;
		this.hotkeys.clear();
	}

	// -- dispatch -------------------------------------------------------------

	private dispatchInput(input: PlatformInput): void {
		switch (input.kind) {
			case 'pointer':
				switch (input.phase) {
					case 'down':
						this.pointerDown(input);
						return;
					case 'move':
						this.pointerMove(input);
						return;
					case 'up':
						this.pointerUp(input);
						return;
					case 'cancel':
						this.cancelPointer(input.pointerId);
						return;
				}
				return;
			case 'leave':
				if (this.hoverPosition?.pointerId === input.pointerId) {
					this.hoverPosition = null;
					this.setHoverTarget(null, input.pointerId);
				}
				return;
			case 'wheel':
				this.wheel(input);
				return;
			case 'key':
				this.key(input);
				return;
			case 'blur':
				// R9.10: window blur cancels every gesture in progress.
				for (const pointerId of new Set([...this.presses.keys(), ...this.captures.keys()])) {
					this.cancelPointer(pointerId);
				}
				return;
		}
	}

	/** Where a pointer event goes: the captor, or the hit test's answer. */
	private targetFor(fields: PointerFields): Component | null {
		const captor = this.captures.get(fields.pointerId);
		if (captor) return captor;
		return this.hit(fields.x, fields.y);
	}

	private pointerDown(fields: PointerFields): void {
		// R9.30: a second button on a pointer already down is a chord, which
		// arrives as a move with `button` set.
		if (this.presses.has(fields.pointerId)) {
			this.pointerMove(fields);
			return;
		}

		const target = this.targetFor(fields);
		this.trackHover(fields, target);

		if (this.observePress(fields, target)) {
			// Swallowed: a press that closed a popup (R9.13). It is still
			// tracked, spent, so its release is no click and no hold.
			this.presses.set(fields.pointerId, {
				target: null,
				x: fields.x,
				y: fields.y,
				button: fields.button,
				pointerType: fields.pointerType,
				startTime: this.clock.now,
				moved: false,
				spent: true,
				swallowed: true,
			});
			return;
		}

		// R9.23's fallback until the focus manager: a press outside the
		// focused component clears focus before the press is delivered, so the
		// component pressed can take it.
		const focused = this.focusedComponent;
		if (focused && !(target && isInclusiveAncestor(focused, target))) this.focus(null);

		this.presses.set(fields.pointerId, {
			target,
			x: fields.x,
			y: fields.y,
			button: fields.button,
			pointerType: fields.pointerType,
			startTime: this.clock.now,
			moved: false,
			spent: false,
			swallowed: false,
		});
		if (!target) return;

		this.bubble(this.pointerEvent('pointerdown', target, fields, true));

		// R9.10: a touch is captured by its press target unless a handler
		// captured it elsewhere.
		if (fields.pointerType === 'touch' && !this.captures.has(fields.pointerId) && target.isMounted) {
			this.captures.set(fields.pointerId, target);
		}
	}

	private pointerMove(fields: PointerFields & { coalesced?: Vec2[] }): void {
		const target = this.targetFor(fields);
		this.trackHover(fields, target);
		if (this.observers.length > 0 && fields.isPrimary && fields.pointerType !== 'touch') {
			const position: PointerPosition = {
				target,
				x: fields.x,
				y: fields.y,
				pointerId: fields.pointerId,
				pointerType: fields.pointerType,
			};
			for (const observer of [...this.observers]) observer.pointerMove?.(position);
		}

		const press = this.presses.get(fields.pointerId);
		if (press && !press.moved) {
			const threshold = press.pointerType === 'touch' ? DRAG_THRESHOLD_TOUCH : DRAG_THRESHOLD_MOUSE;
			if (Math.hypot(fields.x - press.x, fields.y - press.y) > threshold) press.moved = true;
		}

		if (target) this.bubble(this.pointerEvent('pointermove', target, fields, false, fields.coalesced));
	}

	private pointerUp(fields: PointerFields): void {
		const captor = this.captures.get(fields.pointerId) ?? null;
		const target = this.targetFor(fields);
		this.trackHover(fields, target);

		const press = this.presses.get(fields.pointerId);
		this.presses.delete(fields.pointerId);

		if (press?.swallowed) {
			if (captor) this.releasePointer(fields.pointerId);
			return;
		}
		if (target) this.bubble(this.pointerEvent('pointerup', target, fields));

		// Movement past the threshold cancels the click only for a press that
		// could have started a drag; anywhere else a press and release on the
		// same component is a click however far it wandered, as in a browser.
		const dragged = press ? press.moved && press.target !== null && withinDragSource(press.target) : false;
		if (press && !press.spent && !dragged && press.target && fields.isPrimary) {
			// R9.31: the captor, or the nearest common inclusive ancestor of
			// where the press and the release landed.
			const clickTarget = captor ?? (target ? commonAncestor(press.target, target) : null);
			if (clickTarget && clickTarget.isMounted) {
				if (press.button === PRIMARY_BUTTON) {
					// R9.5: a disabled component occludes but is not clicked.
					if (clickTarget.effectivelyEnabled) this.bubble(this.pointerEvent('click', clickTarget, fields));
				} else if (press.button === SECONDARY_BUTTON) {
					this.bubble(this.pointerEvent('contextmenu', clickTarget, fields));
				}
			}
		}

		if (captor) this.releasePointer(fields.pointerId);
	}

	/** Every observer hears the press; true when one of them swallowed it. */
	private observePress(fields: PointerFields, target: Component | null): boolean {
		if (this.observers.length === 0) return false;
		const press: PointerPress = {
			target,
			x: fields.x,
			y: fields.y,
			pointerId: fields.pointerId,
			pointerType: fields.pointerType,
			button: fields.button,
		};
		let swallowed = false;
		for (const observer of [...this.observers]) {
			if (observer.pointerDown?.(press, swallowed) === true) swallowed = true;
		}
		return swallowed;
	}

	/**
	 * R9.30: the gesture is abandoned. The captor, or else the press target,
	 * hears `pointercancel` so it can reset pressed state; no click follows.
	 */
	private cancelPointer(pointerId: number): void {
		const press = this.presses.get(pointerId);
		this.presses.delete(pointerId);
		const captor = this.captures.get(pointerId);
		const fields = this.lastPointerFields(pointerId, press);
		if (captor) {
			this.captures.delete(pointerId);
			if (captor.isMounted) {
				this.deliverTo(captor, this.pointerEvent('pointercancel', captor, fields));
			}
			this.deliverTo(captor, this.pointerEvent('lostpointercapture', captor, fields));
			this.hoverStale = true;
		} else if (press?.target?.isMounted) {
			this.bubble(this.pointerEvent('pointercancel', press.target, fields));
		}
	}

	/**
	 * R9.30: a primary touch still under the drag threshold after
	 * `TOUCH_HOLD_MS` is a `contextmenu` at its press target, and its release
	 * is no longer a click. Checked each frame, since a still finger sends
	 * nothing.
	 */
	private fireTouchHolds(): void {
		if (this.presses.size === 0) return;
		const now = this.clock.now;
		for (const [pointerId, press] of this.presses) {
			if (press.spent || press.moved || press.pointerType !== 'touch' || !press.target) continue;
			if (now - press.startTime < TOUCH_HOLD_MS) continue;
			press.spent = true;
			if (!press.target.isMounted || !press.target.effectivelyEnabled) continue;
			const fields = this.lastPointerFields(pointerId, press, press);
			this.bubble(this.pointerEvent('contextmenu', press.target, { ...fields, pointerType: 'touch', button: 0 }));
		}
	}

	/** R9.10: a captor that is hidden or disabled loses its capture with a cancel. */
	private cancelInvalidCaptors(): void {
		if (this.captures.size === 0) return;
		for (const [pointerId, captor] of [...this.captures]) {
			if (!captor.isMounted || !captor.effectivelyVisible || !captor.effectivelyEnabled) {
				this.cancelPointer(pointerId);
			}
		}
	}

	// -- hover (R9.8, R9.9) ---------------------------------------------------

	/** Records a hover-capable primary pointer's position and derives hover from its target. */
	private trackHover(fields: PointerFields, target: Component | null): void {
		if (!fields.isPrimary || fields.pointerType === 'touch') return;
		this.hoverPosition = { pointerId: fields.pointerId, x: fields.x, y: fields.y };
		this.setHoverTarget(this.hoverTargetFor(fields.pointerId, fields.x, fields.y, target), fields.pointerId);
	}

	/**
	 * Boundary events of a captured pointer are computed against the captor
	 * only (R9.10): it is hovered while the pointer is over it.
	 */
	private hoverTargetFor(pointerId: number, x: number, y: number, hit: Component | null): Component | null {
		const captor = this.captures.get(pointerId);
		if (!captor) return hit;
		return captor.containsScreenPoint(x, y) ? captor : null;
	}

	/**
	 * Re-derives hover from the still pointer when something may have moved
	 * under it: a root came or went, a scroll, a capture release, an
	 * unmounted hovered component, or a layout pass (R9.9).
	 */
	private refreshHover(): void {
		const version = this.frame.layoutVersion;
		if (version !== this.layoutVersionSeen) {
			this.layoutVersionSeen = version;
			this.hoverStale = true;
		}
		if (!this.hoverStale) return;
		this.hoverStale = false;
		const position = this.hoverPosition;
		if (!position) {
			if (this.hoverPath.length > 0) this.setHoverTarget(null, 1);
			return;
		}
		const hit = this.captures.has(position.pointerId) ? null : this.hit(position.x, position.y);
		// The layout the hit test ran may itself have bumped the version.
		this.layoutVersionSeen = this.frame.layoutVersion;
		this.setHoverTarget(this.hoverTargetFor(position.pointerId, position.x, position.y, hit), position.pointerId);
	}

	/**
	 * Moves the hovered chain to `target` and its ancestors: `pointerleave`
	 * innermost first to what left it, then `pointerenter` outermost first to
	 * what joined it, neither bubbling (R9.8).
	 */
	private setHoverTarget(target: Component | null, pointerId: number): void {
		const next = target ? ancestorPath(target) : [];
		const previous = this.hoverPath;
		let shared = 0;
		while (shared < previous.length && shared < next.length && previous[shared] === next[shared]) shared++;
		if (shared === previous.length && shared === next.length) return;

		this.hoverPath = next;
		const position = this.hoverPosition;
		const fields = this.lastPointerFields(pointerId, undefined, position ?? undefined);
		for (let index = previous.length - 1; index >= shared; index--) {
			const left = previous[index];
			left.setHovered(false);
			if (left.isMounted) this.deliverTo(left, this.pointerEvent('pointerleave', left, fields));
		}
		for (let index = shared; index < next.length; index++) {
			const entered = next[index];
			entered.setHovered(true);
			this.deliverTo(entered, this.pointerEvent('pointerenter', entered, fields));
		}
		const hovered = next.length > 0 ? next[next.length - 1] : null;
		for (const observer of [...this.observers]) observer.hoverChange?.(hovered);
	}

	// -- wheel (R9.3, R9.32) --------------------------------------------------

	private wheel(input: Extract<PlatformInput, { kind: 'wheel' }>): void {
		const latch = this.latch;
		let scroller: Component | null = null;
		let hit: Component | null = null;
		const now = this.clock.now;
		if (latch && now - latch.lastTime <= WHEEL_LATCH_MS && latch.scroller.isMounted && latch.scroller.effectivelyVisible) {
			scroller = latch.scroller;
		} else {
			this.latch = null;
			hit = this.hit(input.x, input.y);
			for (let node = hit; node; node = node.parent) {
				const [dx, dy] = normaliseWheel(input, node);
				if (node.effectivelyEnabled && node.canScroll(dx, dy)) {
					scroller = node;
					break;
				}
			}
		}

		const target = scroller ?? hit;
		if (!target) return;
		const [deltaX, deltaY] = normaliseWheel(input, target);
		if (scroller) this.latch = { scroller, lastTime: now };

		this.bubble(new UiWheelEvent({
			timestamp: now,
			target,
			screen: { x: input.x, y: input.y },
			deltaX,
			deltaY,
			pointerId: this.hoverPosition?.pointerId ?? 1,
			pointerType: 'mouse',
			isPrimary: true,
			pressure: 0,
			button: -1,
			buttons: 0,
			modifiers: input.modifiers,
		}));
		// A scroll moves content under a pointer that did not move (R9.9).
		this.hoverStale = true;
		this.refreshHover();
	}

	// -- keys (R9.15) ---------------------------------------------------------

	/**
	 * The focused component first, bubbling to its root; then, for a keydown
	 * nothing consumed, the hotkey table.
	 */
	private key(input: Extract<PlatformInput, { kind: 'key' }>): void {
		const focused = this.focusedComponent;
		if (focused && focused.isMounted && focused.effectivelyVisible && focused.effectivelyEnabled) {
			const event = new UiKeyEvent({
				type: input.phase === 'down' ? 'keydown' : 'keyup',
				timestamp: this.clock.now,
				target: focused,
				key: input.key,
				repeat: input.repeat,
				modifiers: input.modifiers,
			});
			this.bubble(event);
			if (event.consumed) return;
		}
		if (input.phase !== 'down') return;
		const stroke: KeyStroke = { key: input.key, repeat: input.repeat, modifiers: input.modifiers };
		for (const observer of [...this.observers]) {
			if (observer.keyDown?.(stroke) === true) return;
		}
		this.hotkeys.handle(stroke);
	}

	/**
	 * Whether a key would be handled if it were dispatched now, which the
	 * adapter needs synchronously to prevent the browser's default: the event
	 * itself is only dispatched at the next frame (R9.2).
	 */
	public claimsKey(key: string, modifiers: Modifiers = NO_MODIFIERS): boolean {
		if (this.hotkeys.has(key)) return true;
		// R9.15: a focused field lets Cmd and Ctrl chords through to the platform.
		return this.focusedComponent !== null && !modifiers.ctrl && !modifiers.meta;
	}

	// -- delivery -------------------------------------------------------------

	/**
	 * R9.6: target, then each ancestor, until consumed. An effectively
	 * disabled component is skipped (R8.3, R9.5), though what it occludes
	 * stays occluded; delivery stops at a component a handler unmounted.
	 */
	private bubble(event: AnyUiEvent): void {
		for (let node: Component | null = event.target; node; node = node.parent) {
			if (!node.isMounted) return;
			if (!node.effectivelyEnabled && event.type !== 'pointercancel') continue;
			event.currentTarget = node;
			node.handleEvent(event);
			if (event.consumed) return;
		}
	}

	/** One component, no bubble: boundary events and capture notices. */
	private deliverTo(component: Component, event: AnyUiEvent): void {
		event.currentTarget = component;
		component.handleEvent(event);
	}

	private pointerEvent(
		type: PointerEventType,
		target: Component,
		fields: PointerFields,
		canCapture = false,
		coalesced?: readonly Vec2[],
	): UiPointerEvent {
		return new UiPointerEvent({
			type,
			timestamp: this.clock.now,
			target,
			screen: { x: fields.x, y: fields.y },
			pointerId: fields.pointerId,
			pointerType: fields.pointerType,
			isPrimary: fields.isPrimary,
			pressure: fields.pressure,
			button: fields.button,
			buttons: fields.buttons,
			modifiers: fields.modifiers,
			coalesced,
			capture: canCapture ? (component) => this.capturePointer(component, fields.pointerId) : undefined,
		});
	}

	/** Synthetic fields for events that no platform event carries (cancel, leave, capture loss). */
	private lastPointerFields(pointerId: number, press?: Press, position?: { x: number; y: number }): PointerFields {
		const at = position ?? (this.hoverPosition?.pointerId === pointerId ? this.hoverPosition : press) ?? { x: 0, y: 0 };
		return {
			x: at.x,
			y: at.y,
			pointerId,
			pointerType: press?.pointerType ?? 'mouse',
			isPrimary: true,
			button: -1,
			buttons: 0,
			pressure: 0,
			modifiers: NO_MODIFIERS,
		};
	}
}

/**
 * R9.3: logical pixels per axis. Pixels as they are, lines at 16, pages at
 * the scroller's viewport; Shift with a vertical-only delta scrolls
 * horizontally.
 */
export function normaliseWheel(
	input: { deltaX: number; deltaY: number; deltaMode: WheelDeltaMode; modifiers: Modifiers },
	scroller: Component,
): [number, number] {
	let deltaX = input.deltaX;
	let deltaY = input.deltaY;
	if (input.deltaMode === 1) {
		deltaX *= WHEEL_LINE_PX;
		deltaY *= WHEEL_LINE_PX;
	} else if (input.deltaMode === 2) {
		deltaX *= scroller.width;
		deltaY *= scroller.height;
	}
	if (input.modifiers.shift && deltaX === 0) return [deltaY, 0];
	return [deltaX, deltaY];
}

/** Whether a press on `component` could start a drag: it or an ancestor is a drag source (R9.12a). */
function withinDragSource(component: Component): boolean {
	for (let node: Component | null = component; node; node = node.parent) {
		if (node.dragSource) return true;
	}
	return false;
}

/** Root first, `component` last. */
function ancestorPath(component: Component): Component[] {
	const path: Component[] = [];
	for (let node: Component | null = component; node; node = node.parent) path.push(node);
	return path.reverse();
}

function isInclusiveAncestor(ancestor: Component, node: Component): boolean {
	for (let current: Component | null = node; current; current = current.parent) {
		if (current === ancestor) return true;
	}
	return false;
}

function commonAncestor(a: Component, b: Component): Component | null {
	for (let node: Component | null = a; node; node = node.parent) {
		if (isInclusiveAncestor(node, b)) return node;
	}
	return null;
}
