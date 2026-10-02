import type { Animator, TweenHandle } from '../animation/Animator';
import type { Clock } from '../animation/Clock';
import type { Component } from '../components/Component';
import type { FrameTicker, UiFrame } from '../components/UiFrame';
import type { Rect, Vec2 } from '../draw/geometry';
import type { Dispatcher, InputObserver, PointerPosition, PointerPress } from '../input/Dispatcher';
import type { KeyStroke } from '../input/HotkeyTable';
import { tokens } from '../theme/tokens';
import { OverlayHandle, OverlayService, contains } from './OverlayService';
import { PlacementService, pointAnchor } from './Placement';
import type { TooltipSpec } from './tooltipSpec';

/** R12.22's states. `suppressed` holds after a press on the owner until the pointer leaves it. */
export type TooltipState = 'idle' | 'waiting' | 'showing' | 'visible' | 'hiding' | 'suppressed';

/** What brought the tooltip: the pointer resting, keyboard focus, or a call to `show`. */
export type TooltipTrigger = 'hover' | 'focus' | 'manual';

/**
 * Below-right of the pointer: far enough down that the arrow cursor's
 * roughly 16 px body does not cover the text.
 */
export const TOOLTIP_POINTER_OFFSET = tokens.space.space_4;
/** Below the owner when anchored to it (keyboard focus, `show`). */
export const TOOLTIP_ANCHOR_OFFSET = tokens.space.space_1_5;

export interface TooltipServiceOptions {
	overlays: OverlayService;
	placement: PlacementService;
	dispatcher: Dispatcher;
	clock: Clock;
	animator: Animator;
	frame: UiFrame;
	/** See `TooltipService.dragActive`. */
	dragActive?: () => boolean;
	/** Builds the surface for text content: the catalog's Tooltip (R12.22), which `createMountContext` passes. */
	surface: (spec: TooltipSpec) => Component;
}

/**
 * R12.22's tooltip service: drives the `tooltip` property declared on any
 * component from the dispatcher's hover (an input observer) and from keyboard
 * focus, through `idle`, `waiting` (`tooltip_delay` on the frame clock),
 * `showing` (a `dur_fast` fade), `visible`, `hiding` (`dur_tooltip_hide`),
 * and back to `idle`.
 *
 * The tooltip is an overlay root in the `tooltip` layer holding one surface
 * with `pointerEvents: none`, so it never takes input. The surface is the
 * spec's factory tree or, for text content, the service's `surface`; its
 * size is what it measured once mounted, and the placement service puts it
 * below-right of the pointer (or below the owner when there is no pointer,
 * or where the spec's `placement` asks, against the owner or the pointer)
 * with flip and clamp.
 *
 * Moving between two owners while one is showing swaps the content without
 * the delay; pointer movement within `hover_move_tolerance` while waiting
 * does not restart the delay; any `pointerdown` hides it and keeps it hidden
 * until the pointer leaves the owner; a captured pointer or an active drag
 * keeps it from showing at all.
 */
export class TooltipService implements InputObserver, FrameTicker {
	private readonly overlays: OverlayService;
	private readonly placementService: PlacementService;
	private readonly dispatcher: Dispatcher;
	private readonly clock: Clock;
	private readonly animator: Animator;
	private readonly frame: UiFrame;
	/**
	 * R9.12e: tooltips stay hidden while a drag is active. The seam for
	 * DDB-77's drag service, which `createMountContext` points here once it
	 * exists; until then no drag is ever active.
	 */
	public dragActive: () => boolean;
	private readonly createSurface: (spec: TooltipSpec) => Component;

	private stateValue: TooltipState = 'idle';
	private triggerValue: TooltipTrigger | null = null;
	private ownerValue: Component | null = null;
	/** Where the delay started, or the pointer's last position once shown. */
	private point: Vec2 | null = null;
	private waitStart = 0;
	private overlay: OverlayHandle | null = null;
	private surfaceValue: Component | null = null;
	private fade: TweenHandle<number> | null = null;

	constructor({ overlays, placement, dispatcher, clock, animator, frame, dragActive, surface }: TooltipServiceOptions) {
		this.overlays = overlays;
		this.placementService = placement;
		this.dispatcher = dispatcher;
		this.clock = clock;
		this.animator = animator;
		this.frame = frame;
		this.dragActive = dragActive ?? (() => false);
		this.createSurface = surface;
	}

	public get state(): TooltipState {
		return this.stateValue;
	}

	/** The component whose tooltip is waiting, showing, or suppressed. */
	public get owner(): Component | null {
		return this.ownerValue;
	}

	public get trigger(): TooltipTrigger | null {
		return this.triggerValue;
	}

	/** The mounted surface while one is shown. */
	public get surface(): Component | null {
		return this.surfaceValue;
	}

	/** Whether showing is blocked right now: a captured pointer or an active drag. */
	private get blocked(): boolean {
		return this.dispatcher.capturing || this.dragActive();
	}

	// -- programmatic ---------------------------------------------------------

	/**
	 * Shows `owner`'s tooltip at once, without the delay: below `at` when
	 * given, otherwise below the owner. The gallery uses it for a still
	 * picture; a game might for a tutorial hint.
	 */
	public show(owner: Component, { at, fade = true }: { at?: Vec2; fade?: boolean } = {}): void {
		if (!owner.tooltip || !owner.isMounted) return;
		this.triggerValue = 'manual';
		this.ownerValue = owner;
		this.point = at ?? null;
		this.present(fade);
	}

	/** Hides whatever is shown, with the hide fade. */
	public hide(): void {
		this.leave();
	}

	/**
	 * Keyboard focus reaches `component` (R12.22: a tooltip must be
	 * reachable without a pointer). DDB-76's focus manager calls this when
	 * focus becomes visible, which a pointer-driven focus is not; the
	 * dispatcher's focus seam carries no modality, so it is not wired from
	 * there.
	 */
	public focusVisibleChange(component: Component | null): void {
		const owner = ownerOf(component);
		if (owner) {
			const active = this.stateValue === 'waiting' || this.stateValue === 'showing' || this.stateValue === 'visible';
			if (owner === this.ownerValue && active) return;
			this.enter(owner, null, 'focus');
		} else if (this.triggerValue === 'focus') {
			this.leave();
		}
	}

	// -- input observer -------------------------------------------------------

	public hoverChange(target: Component | null): void {
		const owner = ownerOf(target);
		if (owner === this.ownerValue && this.stateValue !== 'idle' && this.stateValue !== 'hiding') return;
		if (!owner) {
			if (this.triggerValue === 'hover' || this.stateValue === 'suppressed') this.leave();
			return;
		}
		const position = this.dispatcher.hoverPoint;
		this.enter(owner, position, 'hover');
	}

	public pointerMove(position: PointerPosition): void {
		if (this.stateValue !== 'waiting' || this.triggerValue !== 'hover') return;
		const start = this.point;
		if (start && Math.hypot(position.x - start.x, position.y - start.y) <= tokens.control.hover_move_tolerance) return;
		// Moved on: the delay counts from where the pointer rests.
		this.point = { x: position.x, y: position.y };
		this.waitStart = this.clock.now;
	}

	/**
	 * Any press hides it; a press on the owner keeps it hidden while the
	 * pointer stays there. Never consumes.
	 */
	public pointerDown(press: PointerPress): boolean {
		if (this.stateValue === 'idle') return false;
		const owner = this.ownerValue;
		if (owner && press.target && contains(owner, press.target)) {
			this.removeSurface();
			this.stateValue = 'suppressed';
		} else {
			this.reset();
		}
		return false;
	}

	/** Escape hides a shown tooltip (WCAG's dismissable) without consuming the key. */
	public keyDown(stroke: KeyStroke): boolean {
		if (stroke.key === 'Escape' && (this.stateValue === 'showing' || this.stateValue === 'visible')) {
			this.removeSurface();
			this.stateValue = 'suppressed';
		}
		return false;
	}

	// -- frame ----------------------------------------------------------------

	/** The delay, on the frame clock; asked for only while waiting. */
	public tick(): void {
		if (this.stateValue !== 'waiting') return;
		const owner = this.ownerValue;
		if (!owner || !owner.isMounted) {
			this.reset();
			return;
		}
		if (this.blocked) {
			// Starts over once the capture or drag ends and the pointer rests again.
			this.waitStart = this.clock.now;
			this.frame.requestTick(this);
			return;
		}
		if (this.clock.now - this.waitStart >= tokens.control.tooltip_delay) {
			this.present(true);
			return;
		}
		this.frame.requestTick(this);
	}

	// -- transitions ----------------------------------------------------------

	private enter(owner: Component, point: Vec2 | null, trigger: TooltipTrigger): void {
		const wasShown = this.stateValue === 'showing' || this.stateValue === 'visible';
		this.ownerValue = owner;
		this.triggerValue = trigger;
		this.point = point;
		if (wasShown && !this.blocked) {
			// R12.22: from one owner to the next while visible, no delay.
			this.present(false);
			return;
		}
		if (trigger === 'focus' && owner.tooltip?.immediateOnFocus && !this.blocked) {
			this.present(true);
			return;
		}
		this.removeSurface();
		if (this.blocked) {
			this.stateValue = 'suppressed';
			return;
		}
		this.stateValue = 'waiting';
		this.waitStart = this.clock.now;
		this.frame.requestTick(this);
	}

	/** The owner is gone from under the pointer (or focus): fade out what is shown, forget what is waiting. */
	private leave(): void {
		if (this.stateValue === 'showing' || this.stateValue === 'visible') {
			this.stateValue = 'hiding';
			this.ownerValue = null;
			this.triggerValue = null;
			this.fadeTo(0, tokens.motion.dur_tooltip_hide, () => this.reset());
			return;
		}
		if (this.stateValue !== 'hiding') this.reset();
	}

	private reset(): void {
		this.removeSurface();
		this.stateValue = 'idle';
		this.ownerValue = null;
		this.triggerValue = null;
		this.point = null;
	}

	/** Mounts and places the owner's surface, fading in or swapping in at full opacity. */
	private present(fade: boolean): void {
		const owner = this.ownerValue;
		const spec = owner?.tooltip;
		if (!owner || !spec) {
			this.reset();
			return;
		}
		this.removeSurface();

		const surface = spec.factory ? spec.factory() : this.createSurface(spec);
		surface.pointerEvents = 'none';
		const overlay = this.overlays.open(surface, {
			layer: 'tooltip',
			id: 'tooltip_root',
			// Closed from outside (a scene change's closeAll): forget it.
			onClose: () => {
				if (this.overlay === overlay) {
					this.overlay = null;
					this.reset();
				}
			},
		});
		this.overlay = overlay;
		this.surfaceValue = surface;
		// Mounted, so its text can measure: a hugging surface sizes itself now,
		// before it is placed, rather than at the frame's layout.
		surface.layoutSubtree();
		if (surface.width <= 0 || surface.height <= 0) sizeToChildren(surface);

		const point = spec.placement?.anchor === 'owner' ? null : this.point;
		const anchor: Rect = point ? pointAnchor(point) : spec.placement?.ownerRect?.() ?? owner.screenBounds;
		const placement = this.placementService.place({
			anchor,
			size: { width: surface.width, height: surface.height },
			side: spec.placement?.side ?? 'bottom',
			align: spec.placement?.align ?? 'start',
			offset: point ? TOOLTIP_POINTER_OFFSET : TOOLTIP_ANCHOR_OFFSET,
		});
		surface.x = placement.x;
		surface.y = placement.y;
		if (placement.constrained) {
			// Shrunk to the room there: clipped rather than spilling off-screen.
			surface.setSize(placement.width, placement.height);
			surface.overflow = 'hidden';
		}
		surface.invalidateLayout();

		if (fade) {
			this.stateValue = 'showing';
			surface.opacity = 0;
			this.fadeTo(1, tokens.motion.dur_fast, () => {
				this.stateValue = 'visible';
			});
		} else {
			this.stateValue = 'visible';
			surface.opacity = 1;
		}
	}

	private fadeTo(target: number, duration: number, done: () => void): void {
		const surface = this.surfaceValue;
		if (!surface) {
			done();
			return;
		}
		this.fade?.cancel();
		this.fade = this.animator.tween({
			from: surface.opacity,
			to: target,
			duration,
			owner: surface,
			onUpdate: (value) => {
				surface.opacity = value;
			},
			onComplete: () => {
				this.fade = null;
				done();
			},
		});
	}

	private removeSurface(): void {
		this.fade?.cancel();
		this.fade = null;
		const overlay = this.overlay;
		this.overlay = null;
		this.surfaceValue = null;
		overlay?.close();
	}
}

/** The nearest inclusive ancestor declaring a tooltip. */
function ownerOf(component: Component | null): Component | null {
	for (let node = component; node; node = node.parent) {
		if (node.tooltip) return node;
	}
	return null;
}

/** A factory tree with no size of its own takes its children's extent (R12.22: size from the mounted tree). */
function sizeToChildren(component: Component): void {
	let width = 0;
	let height = 0;
	for (const child of component.children) {
		const bounds = child.bounds;
		width = Math.max(width, bounds.x + bounds.width);
		height = Math.max(height, bounds.y + bounds.height);
	}
	component.setSize(width, height);
}
