import type { Vec2 } from '../draw/geometry';
import type { Clock } from '../animation/Clock';
import type { Component } from '../components/Component';
import type { UiFrame } from '../components/UiFrame';
import {
	ActionEventType,
	AnyUiEvent,
	Modifiers,
	NO_MODIFIERS,
	PointerEventType,
	PointerType,
	UiActionEvent,
	UiKeyEvent,
	UiPointerEvent,
	UiWheelEvent,
} from './events';
import { FocusDirection, FocusManager, GroupKey } from './FocusManager';
import { HitTestOptions, hitTest } from './hitTest';
import { HotkeyTable, KeyStroke } from './HotkeyTable';
import { DragService, dragThreshold } from './DragService';

/** R9.32: a wheel event within this long of the last stays with the latched scroller. */
export const WHEEL_LATCH_MS = 150;
/** R9.30: a touch held this long under the drag threshold is a `contextmenu`. */
export const TOUCH_HOLD_MS = 500;
/** R9.3: one line of a line-mode wheel delta, in logical pixels. */
export const WHEEL_LINE_PX = 16;

const PRIMARY_BUTTON = 0;
const SECONDARY_BUTTON = 2;

/** `WheelEvent.deltaMode`: pixels, lines, pages. */
export type WheelDeltaMode = 0 | 1 | 2;

/** R9.27: the last input source, so components may change affordances. */
export type InputMode = 'pointer' | 'keyboard' | 'controller';

const ARROW_DIRECTIONS: Readonly<Record<string, FocusDirection>> = {
	ArrowUp: 'up',
	ArrowDown: 'down',
	ArrowLeft: 'left',
	ArrowRight: 'right',
};

/** Keys the focused component or the focus manager acts on, whose browser default (scrolling) must not run. */
const NAVIGATION_KEYS = new Set(['Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

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
	/** Moved past the drag threshold: no touch hold (R9.30). */
	moved: boolean;
	/** Cancelled or already a hold: no click (R9.31). */
	spent: boolean;
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
 * normalised and latched to one scroller per gesture (R9.3, R9.32).
 *
 * Keys go to the focused component and bubble (R9.15, R9.24); Tab moves
 * focus before anything sees it (R9.16); an unconsumed Enter, Space, or
 * Escape becomes `activate` or `cancel` at the focused component (R9.27);
 * unconsumed arrows move within a focus group or directionally (R9.29,
 * R9.26); what is left reaches the hotkey tables, the focused root's, then
 * the other roots' from the topmost down to a modal root, then the scene's
 * (R9.15). Focus itself is `focus`, the `FocusManager` this dispatcher
 * drives: a press focuses the nearest focusable ancestor of its target
 * (R9.23). Drag and drop is `drag` (R9.12), built on capture and
 * `hitTest({ exclude })` and fed from the pointer path here.
 */
export class Dispatcher {
	/** R9.15's scene hotkey table: the last one searched, and never while a modal root is mounted. */
	public readonly hotkeys = new HotkeyTable();
	/** Chapter 9's focus manager; the mount context exposes it as `focus`. */
	public readonly focus: FocusManager;
	/** R9.12's drag and drop, which the mount context hands out as `drag`. */
	public readonly drag: DragService;

	private readonly frame: UiFrame;
	private readonly clock: Clock;
	private readonly pixelRatio: () => number;
	private queue: PlatformInput[] = [];
	private readonly rootList: Component[] = [];
	/** The hovered chain, outermost first: the target and every ancestor (R9.8). */
	private hoverPath: Component[] = [];
	/** The hovering pointer's last position, or null while no hover-capable pointer is over the surface. */
	private hoverPosition: { pointerId: number; x: number; y: number } | null = null;
	private hoverStale = false;
	private layoutVersionSeen = -1;
	private readonly captures = new Map<number, Component>();
	private readonly presses = new Map<number, Press>();
	private mode: InputMode = 'pointer';
	private latch: { scroller: Component; lastTime: number } | null = null;
	private inputPaused = false;
	private dispatching = false;

	constructor({ frame, clock, pixelRatio = () => 1 }: DispatcherOptions) {
		this.frame = frame;
		this.clock = clock;
		this.pixelRatio = pixelRatio;
		this.focus = new FocusManager({ clock, roots: () => this.rootList });
		this.drag = new DragService({
			host: {
				hitTest: (point, options) => this.hit(point.x, point.y, options),
				bubble: (event) => this.bubble(event),
				capturePointer: (component, pointerId) => this.capturePointer(component, pointerId),
				captorOf: (pointerId) => this.captorOf(pointerId),
				spendPress: (pointerId) => {
					const press = this.presses.get(pointerId);
					if (press) press.spent = true;
				},
				pressLive: (pointerId) => {
					const press = this.presses.get(pointerId);
					return press !== undefined && !press.spent;
				},
				get now() {
					return clock.now;
				},
			},
		});
	}

	/**
	 * R9.27: `pointer` since the last press, `keyboard` since the last key,
	 * `controller` since the last virtual-pointer press.
	 */
	public get inputMode(): InputMode {
		return this.mode;
	}

	/** Lays out on demand, then walks the roots (R9.2, R9.4). */
	private hit(x: number, y: number, options?: HitTestOptions): Component | null {
		this.frame.layout();
		return hitTest(this.rootList, x, y, { ratio: this.pixelRatio(), ...options });
	}

	// -- roots ----------------------------------------------------------------

	/**
	 * The mounted roots in the order they were mounted, which is the order
	 * the hit walk visits them, a later root over an earlier one. That is not
	 * necessarily paint order: the game page mounts the F5 overlay before the
	 * first screen and paints it after, which is harmless only because the
	 * overlay is `pointerEvents: 'none'`. A root that paints over another and
	 * takes input has to be mounted after it until the overlay service
	 * (DDB-78) orders roots by layer.
	 */
	public get roots(): readonly Component[] {
		return this.rootList;
	}

	/** Called by `Component.mount` on a root. */
	public addRoot(root: Component): void {
		if (this.rootList.includes(root)) return;
		this.rootList.push(root);
		this.hoverStale = true;
		this.focus.invalidateOrder();
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
			this.drag.refresh();
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

	/**
	 * Ends a capture: `lostpointercapture` on the captor, then hover from the
	 * current position. A drag on the pointer ends with it (R9.12d).
	 */
	public releasePointer(pointerId: number): void {
		const captor = this.captures.get(pointerId);
		if (!captor) return;
		this.captures.delete(pointerId);
		this.drag.pointerLost(pointerId);
		this.deliverTo(captor, this.pointerEvent('lostpointercapture', captor, this.lastPointerFields(pointerId)));
		this.hoverStale = true;
	}

	public captorOf(pointerId: number): Component | null {
		return this.captures.get(pointerId) ?? null;
	}

	// -- unmount (R8.15, R9.10, R9.21) ----------------------------------------

	/**
	 * Drops everything the dispatcher holds on `component` as it unmounts:
	 * its root entry, its place in the hover chain, focus and any scope it
	 * roots (without callbacks on it, since it may be mid-teardown, R9.21), a
	 * press it is the target of, and the latch. A captor hears
	 * `pointercancel` first, then loses the capture.
	 */
	public forget(component: Component): void {
		const rootIndex = this.rootList.indexOf(component);
		if (rootIndex !== -1) {
			this.rootList.splice(rootIndex, 1);
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

		this.focus.forget(component);

		for (const [pointerId, captor] of this.captures) {
			if (captor !== component) continue;
			this.cancelPointer(pointerId);
		}
		this.drag.forget(component);

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
		this.drag.reset();
		this.queue = [];
		this.rootList.length = 0;
		this.hoverPath = [];
		this.hoverPosition = null;
		this.captures.clear();
		this.presses.clear();
		this.focus.reset();
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
		this.mode = fields.pointerType === 'virtual' ? 'controller' : 'pointer';

		this.presses.set(fields.pointerId, {
			target,
			x: fields.x,
			y: fields.y,
			button: fields.button,
			pointerType: fields.pointerType,
			startTime: this.clock.now,
			moved: false,
			spent: false,
		});
		if (!target) {
			this.focus.focusFromPointer(null);
			return;
		}

		const press = this.pointerEvent('pointerdown', target, fields, true);
		this.bubble(press);
		// R9.23: after the handlers, so one that owns the press can keep focus
		// where it is.
		if (!press.isFocusPrevented) this.focus.focusFromPointer(target);

		// R9.10: a touch is captured by its press target unless a handler
		// captured it elsewhere.
		if (fields.pointerType === 'touch' && !this.captures.has(fields.pointerId) && target.isMounted) {
			this.captures.set(fields.pointerId, target);
		}
	}

	private pointerMove(fields: PointerFields & { coalesced?: Vec2[] }): void {
		this.drag.pointerMoving(fields.pointerId, { x: fields.x, y: fields.y });
		const target = this.targetFor(fields);
		this.trackHover(fields, target);

		const press = this.presses.get(fields.pointerId);
		if (press && !press.moved) {
			if (Math.hypot(fields.x - press.x, fields.y - press.y) > dragThreshold(press.pointerType)) press.moved = true;
		}

		if (target) this.bubble(this.pointerEvent('pointermove', target, fields, false, fields.coalesced));
		this.drag.pointerMove(fields.pointerId, { x: fields.x, y: fields.y });
	}

	private pointerUp(fields: PointerFields): void {
		const captor = this.captures.get(fields.pointerId) ?? null;
		const target = this.targetFor(fields);
		this.trackHover(fields, target);

		const press = this.presses.get(fields.pointerId);
		this.presses.delete(fields.pointerId);

		if (target) this.bubble(this.pointerEvent('pointerup', target, fields));

		// A release that ends an active drag is its drop, never a click. A
		// press that started no drag is a click however far it wandered, as
		// in a browser; one whose drag never passed its threshold still is.
		const dragged = this.drag.pointerUp(fields.pointerId, { x: fields.x, y: fields.y });
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
			this.drag.pointerLost(pointerId);
			this.deliverTo(captor, this.pointerEvent('lostpointercapture', captor, fields));
			this.hoverStale = true;
		} else {
			if (press?.target?.isMounted) this.bubble(this.pointerEvent('pointercancel', press.target, fields));
			this.drag.pointerLost(pointerId);
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

	// -- keys (R9.15, R9.16, R9.24, R9.27) ------------------------------------

	/**
	 * A keydown, in order: Tab moves focus unless the focused component
	 * handles Tab (R9.16); the focused component, bubbling to its root
	 * (R9.24); a text field keeps what it did not consume (R9.15); `activate`
	 * or `cancel` at the focused component (R9.27); arrows, Home, and End
	 * within a focus group, then directionally (R9.29, R9.26); the hotkey
	 * tables (R9.15). A keyup goes to the focused component only.
	 */
	private key(input: Extract<PlatformInput, { kind: 'key' }>): void {
		this.mode = 'keyboard';
		const focused = this.keyTarget;
		const down = input.phase === 'down';
		const { modifiers } = input;
		const chord = modifiers.ctrl || modifiers.meta || modifiers.alt;

		if (down && input.key === 'Tab' && !chord && !focused?.handlesTab) {
			if (modifiers.shift) this.focus.focusPrevious();
			else this.focus.focusNext();
			return;
		}

		if (focused) {
			const event = new UiKeyEvent({
				type: down ? 'keydown' : 'keyup',
				timestamp: this.clock.now,
				target: focused,
				key: input.key,
				repeat: input.repeat,
				modifiers,
			});
			this.bubble(event);
			if (event.consumed || !down) return;
			if (focused.acceptsText && ownedByTextField(input.key, modifiers)) return;
		}
		if (!down) return;

		const action = actionFor(input);
		if (action && focused && focused.isMounted) {
			if (action === 'activate') this.focus.showFocusVisible();
			const event = new UiActionEvent({ type: action, timestamp: this.clock.now, target: focused, source: 'keyboard' });
			this.bubble(event);
			if (event.consumed) return;
		}

		if (!chord && !modifiers.shift && this.navigate(input.key)) return;

		const stroke: KeyStroke = { key: input.key, repeat: input.repeat, modifiers };
		for (const table of this.hotkeyTables(focused)) {
			if (table.handle(stroke)) return;
		}
	}

	/** Arrows, Home, and End that nothing consumed: the focused group first, then directional focus. */
	private navigate(key: string): boolean {
		const direction = ARROW_DIRECTIONS[key];
		if (!direction && key !== 'Home' && key !== 'End') return false;
		if (this.focus.moveWithinGroup(key as GroupKey)) return true;
		return direction !== undefined && this.focus.focusDirection(direction);
	}

	/** The focused component when keys can reach it (R9.15, R9.18). */
	private get keyTarget(): Component | null {
		const focused = this.focus.focused;
		return focused && focused.canReceiveFocus() ? focused : null;
	}

	/**
	 * R9.15's search order: the focused component's root, then every other
	 * root from the topmost down, stopping at a modal root (whose own table
	 * is searched), then the scene's table when no modal root is mounted.
	 * With nothing focused the search starts at the topmost root.
	 */
	private hotkeyTables(focused: Component | null): HotkeyTable[] {
		const roots = this.rootList;
		let floor = 0;
		let modal = false;
		for (let index = roots.length - 1; index >= 0; index--) {
			if (roots[index].modal) {
				floor = index;
				modal = true;
				break;
			}
		}
		const tables: HotkeyTable[] = [];
		const focusedRoot = focused?.root ?? null;
		if (focusedRoot && roots.indexOf(focusedRoot) >= floor && focusedRoot.ownHotkeys) tables.push(focusedRoot.ownHotkeys);
		for (let index = roots.length - 1; index >= floor; index--) {
			const root = roots[index];
			if (root !== focusedRoot && root.ownHotkeys) tables.push(root.ownHotkeys);
		}
		if (!modal) tables.push(this.hotkeys);
		return tables;
	}

	/**
	 * Whether a key would be handled if it were dispatched now, which the
	 * adapter needs synchronously to prevent the browser's default: the event
	 * itself is only dispatched at the next frame (R9.2). Tab always is, so
	 * focus never leaves the canvas for the browser's chrome; a text field
	 * claims what it owns (R9.15); navigation keys are claimed while
	 * something is focused, and arrows always, since they move focus from
	 * nothing (R9.26).
	 */
	public claimsKey(key: string, modifiers: Modifiers = NO_MODIFIERS): boolean {
		if (key === 'Tab') return true;
		const focused = this.keyTarget;
		if (focused?.acceptsText && ownedByTextField(key, modifiers)) return true;
		if (NAVIGATION_KEYS.has(key) && (focused || ARROW_DIRECTIONS[key])) return true;
		return this.hotkeyTables(focused).some((table) => table.has(key));
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

/**
 * R9.15: what a focused text field keeps from activation, navigation, and
 * the hotkey tables whether or not it consumed it: printable keys and the
 * editing and caret keys. Tab and Escape leave it, as do Cmd and Ctrl chords
 * (copy, a menu shortcut) and named keys such as F6, which are not text.
 */
function ownedByTextField(key: string, modifiers: Modifiers): boolean {
	if (modifiers.ctrl || modifiers.meta) return false;
	if (key === 'Escape') return false;
	return [...key].length === 1 || NAVIGATION_KEYS.has(key) || key === 'Backspace' || key === 'Delete';
}

/** R9.27: the first Enter or Space of a press activates, Escape cancels; chords are neither. */
function actionFor(input: { key: string; repeat: boolean; modifiers: Modifiers }): ActionEventType | null {
	const { ctrl, meta, alt } = input.modifiers;
	if (ctrl || meta || alt) return null;
	if (input.key === 'Escape') return 'cancel';
	if ((input.key === 'Enter' || input.key === ' ') && !input.repeat) return 'activate';
	return null;
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
