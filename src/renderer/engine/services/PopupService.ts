import type { Component } from '../components/Component';
import type { Rect } from '../draw/geometry';
import type { InputObserver, PointerPress } from '../input/Dispatcher';
import type { KeyStroke } from '../input/HotkeyTable';
import { OverlayHandle, OverlayService, contains } from './OverlayService';
import type { Placement, PlacementAlign, PlacementService, PlacementSide } from './Placement';

export type PopupCloseReason = 'replaced' | 'outside-press' | 'escape' | 'focus-loss' | 'modal' | 'scroll' | 'closed';

const SECONDARY_BUTTON = 2;

export interface PopupOptions {
	/** The surface: a menu, a select's list, a context menu. */
	popup: Component;
	/**
	 * What opened it. A press on it is not an outside press (the trigger
	 * toggles itself), and focus on it is not focus loss (R9.14).
	 */
	trigger?: Component | null;
	/**
	 * Where to place a popup the service mounts: a component (its
	 * `screenBounds`) or a rect in viewport logical pixels, a zero-size one
	 * for a point. Ignored for a popup that is already mounted.
	 */
	anchor?: Component | Rect;
	side?: PlacementSide;
	align?: PlacementAlign;
	offset?: number;
	/** Heard once, whatever closed it, including `close()`. */
	onClose?: (reason: PopupCloseReason) => void;
}

/** One open popup. `close` is the owner's own close; the service's are the reasons in `PopupCloseReason`. */
export class PopupHandle {
	public readonly popup: Component;
	public readonly trigger: Component | null;
	/** The component it was placed against, when it was placed against one. */
	public readonly anchor: Component | null;
	/**
	 * Where the service placed it; null for a popup that was mounted already.
	 * Its size is the popup's: a `constrained` placement has shrunk the popup
	 * to the room there, and a menu scrolls what no longer fits (R12.11).
	 */
	public placement: Placement | null = null;
	/** The size the popup asked for when it opened; every placement starts from it, not from a shrunk size. */
	public readonly naturalSize: { width: number; height: number };
	/** The overlay root the service opened it in; null for one mounted inline. */
	public readonly overlay: OverlayHandle | null;
	private readonly service: PopupService;
	private readonly onClose: ((reason: PopupCloseReason) => void) | null;
	private open = true;

	constructor({ service, options, overlay }: { service: PopupService; options: PopupOptions; overlay: OverlayHandle | null }) {
		this.service = service;
		this.popup = options.popup;
		this.trigger = options.trigger ?? null;
		this.anchor = options.anchor && isComponent(options.anchor) ? options.anchor : null;
		this.onClose = options.onClose ?? null;
		this.overlay = overlay;
		this.naturalSize = { width: options.popup.width, height: options.popup.height };
	}

	public get isOpen(): boolean {
		return this.open;
	}

	public close(): void {
		this.service.closeHandle(this, 'closed');
	}

	/** Called by the service: once, whatever the reason. */
	public finish(reason: PopupCloseReason): void {
		if (!this.open) return;
		this.open = false;
		this.overlay?.close();
		this.onClose?.(reason);
	}
}

/**
 * R12.31's popup service: tracks the one open exclusive popup (menu, select,
 * context menu) and closes it when another opens, on a press outside it
 * (R9.13), on Escape, on focus moving elsewhere (R9.14), and when a modal
 * root opens so a popup never paints above a scrim (R3.6a).
 *
 * A popup that is not mounted yet is opened as an overlay root in the `popup`
 * layer and placed against its anchor by the placement service (R12.30); its
 * content box is the viewport, so the placement is used as is. A popup that
 * is already mounted, a promoted child of its trigger (R3.19), is tracked
 * only: its owner placed it and hides it from `onClose`.
 *
 * The outside press is consumed (native desktop behaviour) except when it
 * lands on a `popupTrigger`, so one press switches from one open select to
 * another, and except for a secondary press, so a right-click elsewhere
 * opens a new context menu where it landed (R9.13).
 */
export class PopupService implements InputObserver {
	private readonly overlays: OverlayService;
	private readonly placementService: PlacementService;
	private current: PopupHandle | null = null;

	constructor({ overlays, placement }: { overlays: OverlayService; placement: PlacementService }) {
		this.overlays = overlays;
		this.placementService = placement;
		overlays.addOpenListener((handle) => {
			if (handle.modal) this.closeCurrent('modal');
		});
	}

	/** The open popup, or null. */
	public get open(): PopupHandle | null {
		return this.current;
	}

	/** Opens `popup`, closing the one open before it (`replaced`). */
	public show(options: PopupOptions): PopupHandle {
		this.closeCurrent('replaced');
		const { popup } = options;
		let handle: PopupHandle | null = null;
		const overlay = popup.isMounted ? null : this.overlays.open(popup, {
			layer: 'popup',
			id: popup.id ? `popup_${popup.id}` : undefined,
			// Closed from outside (a scene change's closeAll): the popup is closed too.
			onClose: () => {
				if (handle) this.closeHandle(handle, 'closed');
			},
		});
		handle = new PopupHandle({ service: this, options, overlay });
		this.current = handle;
		if (overlay) this.reposition(handle, options);
		return handle;
	}

	/** Places an overlay-rooted popup against its anchor again, after the anchor moved. */
	public reposition(handle: PopupHandle, options: Pick<PopupOptions, 'anchor' | 'side' | 'align' | 'offset'>): void {
		if (!handle.overlay || !handle.isOpen || !options.anchor) return;
		const anchor = isComponent(options.anchor) ? options.anchor.screenBounds : options.anchor;
		const popup = handle.popup;
		const placement = this.placementService.place({
			anchor,
			size: handle.naturalSize,
			side: options.side,
			align: options.align,
			offset: options.offset,
		});
		handle.placement = placement;
		popup.x = placement.x;
		popup.y = placement.y;
		popup.setSize(placement.width, placement.height);
		popup.invalidateLayout();
	}

	/** Closes whatever is open. */
	public close(): void {
		this.closeCurrent('closed');
	}

	/** Called by `PopupHandle.close`. */
	public closeHandle(handle: PopupHandle, reason: PopupCloseReason): void {
		if (this.current === handle) this.current = null;
		handle.finish(reason);
	}

	private closeCurrent(reason: PopupCloseReason): void {
		const handle = this.current;
		if (!handle) return;
		this.current = null;
		handle.finish(reason);
	}

	private inside(handle: PopupHandle, component: Component): boolean {
		return contains(handle.popup, component) || (handle.trigger !== null && contains(handle.trigger, component));
	}

	/**
	 * R3.6a: `scroller` moved its content. A popup whose trigger or anchor is
	 * inside it was placed against where they were, and a promoted child
	 * keeps its host's offset, so the popup closes rather than float over
	 * the wrong row. A scroller inside the popup (a long menu) is the popup's
	 * own business.
	 */
	public scrolled(scroller: Component): void {
		const handle = this.current;
		if (!handle || contains(handle.popup, scroller)) return;
		const moved = (component: Component | null): boolean => component !== null && component !== scroller && contains(scroller, component);
		if (moved(handle.trigger) || moved(handle.anchor)) this.closeCurrent('scroll');
	}

	// -- input (R9.13, R9.14) -------------------------------------------------

	public pointerDown(press: PointerPress): boolean {
		const handle = this.current;
		if (!handle) return false;
		// A popup unmounted by its owner without closing is closed now.
		if (!handle.popup.isMounted) {
			this.closeCurrent('closed');
			return false;
		}
		if (press.target && this.inside(handle, press.target)) return false;
		this.closeCurrent('outside-press');
		if (press.button === SECONDARY_BUTTON) return false;
		return !(press.target && withinPopupTrigger(press.target));
	}

	public keyDown(stroke: KeyStroke): boolean {
		if (!this.current || stroke.key !== 'Escape') return false;
		this.closeCurrent('escape');
		return true;
	}

	/**
	 * The focus manager's change signal (`createMountContext` wires it):
	 * focus moving to something outside the popup and its trigger closes it
	 * (R9.14); focus cleared by a press is the press's business.
	 */
	public focusChange(focused: Component | null): void {
		const handle = this.current;
		if (!handle || !focused) return;
		if (!this.inside(handle, focused)) this.closeCurrent('focus-loss');
	}
}

function isComponent(anchor: Component | Rect): anchor is Component {
	return typeof (anchor as Component).localToScreen === 'function';
}

function withinPopupTrigger(component: Component): boolean {
	for (let node: Component | null = component; node; node = node.parent) {
		if (node.popupTrigger) return true;
	}
	return false;
}
