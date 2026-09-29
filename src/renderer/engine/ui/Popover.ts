import type { TweenHandle } from '../animation/Animator';
import type { Component, PointerEvents, ResolvedColors } from '../components/Component';
import type { MountContext } from '../components/MountContext';
import { Stack } from '../components/Stack';
import type { DrawApi } from '../draw/DrawApi';
import type { Rect, Vec2 } from '../draw/geometry';
import type { OverlayHandle } from '../services/OverlayService';
import { PlacementAlign, PlacementSide, pointAnchor } from '../services/Placement';
import { shadowExtent } from '../style/look';
import { tokens } from '../theme/tokens';
import { SHADOW_POP } from './surfaces';

export interface PopoverOptions {
	id?: string;
	/** What the popover shows: a card inspector, a stat breakdown. */
	content: Component;
	/** A component, placed against its screen bounds, or a screen point. */
	anchor: Component | Vec2;
	/** Tried first; the placement service flips and shifts it (R12.30). Default `bottom`. */
	preferredSide?: PlacementSide;
	/** Along the anchor's edge. Default `start`. */
	align?: PlacementAlign;
	/** `overlay` by default; `popup` when it must beat an open menu. */
	layer?: 'overlay' | 'popup';
	/** Default true, and the press is never consumed: it goes on to what it landed on (R12.33). */
	dismissOnOutsidePress?: boolean;
	/** Default true. */
	closeOnEscape?: boolean;
	/** Heard once each time it closes, whatever closed it. */
	onClose?: () => void;
}

const { color } = tokens;
const OFFSET = tokens.space.space_1_5;

/**
 * R12.33's popover: an anchored, interactive, non-modal floating surface,
 * opened as an overlay root and placed against its anchor by the placement
 * service. An outside press dismisses it and goes on to its target, so one
 * click both closes an inspector and selects the next card; Escape closes
 * it. It takes no focus scope: when its content has focusables the first
 * one takes focus on open, and Tab leaves the popover as it would any
 * other part of the screen.
 *
 * The surface is a padded column stack around the caller's content, sized
 * from it; fades in over `dur_fast` and closes at once. Tooltip is the
 * non-interactive special case (R12.22).
 *
 * Opened from inside a modal dialog it needs `layer: 'popup'`: `overlay` is
 * below `modal` (R3.5), so it would sit under the dialog's scrim.
 */
export class Popover extends Stack {
	public onClose: (() => void) | null = null;

	private anchorTarget: Component | Vec2;
	private readonly side: PlacementSide;
	private readonly alignment: PlacementAlign;
	private readonly layerName: 'overlay' | 'popup';
	private readonly dismissOnOutsidePress: boolean;
	private readonly closeOnEscape: boolean;
	private handle: OverlayHandle | null = null;
	private fade: TweenHandle<number> | null = null;
	private placedSide: PlacementSide | null = null;

	constructor({
		id = 'popover',
		content,
		anchor,
		preferredSide = 'bottom',
		align = 'start',
		layer = 'overlay',
		dismissOnOutsidePress = true,
		closeOnEscape = true,
		onClose,
	}: PopoverOptions) {
		super({ id, direction: 'vertical', padding: tokens.space.space_3 });
		this.componentType = 'Popover';
		this.anchorTarget = anchor;
		this.side = preferredSide;
		this.alignment = align;
		this.layerName = layer;
		this.dismissOnOutsidePress = dismissOnOutsidePress;
		this.closeOnEscape = closeOnEscape;
		if (onClose) this.onClose = onClose;
		this.addChild(content);
	}

	/** A surface under the pointer: it occludes the scene beneath it. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	public get isOpen(): boolean {
		return this.handle !== null;
	}

	public get overlay(): OverlayHandle | null {
		return this.handle;
	}

	/** The side the last placement chose, after any flip. */
	public get placement(): PlacementSide | null {
		return this.placedSide;
	}

	/**
	 * What it is placed against (the `anchor` option). Not `anchor`, which
	 * is R10.15's layout anchor on every component.
	 */
	public get anchoredTo(): Component | Vec2 {
		return this.anchorTarget;
	}

	/** A new anchor; an open popover moves to it at once. */
	public set anchoredTo(anchor: Component | Vec2) {
		this.anchorTarget = anchor;
		if (this.handle) this.reposition();
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: color.bg_panel_raised, border: color.line_strong };
	}

	public get inkExtent(): number {
		return shadowExtent(SHADOW_POP);
	}

	/** Opens it against its anchor. Ignored while open. */
	public show(context: MountContext): void {
		if (this.handle) return;
		this.handle = context.overlays.open(this, {
			id: `${this.id ?? 'popover'}_root`,
			layer: this.layerName,
			modal: false,
			dismissOnOutsidePress: this.dismissOnOutsidePress,
			consumeOutsidePress: false,
			closeOnEscape: this.closeOnEscape,
			onClose: () => this.closed(),
		});
		this.reposition();
		const first = context.focus.firstIn(this);
		if (first) context.focus.focus(first);
		this.opacity = 0;
		this.fade = context.animator.tween({
			from: 0,
			to: 1,
			duration: tokens.motion.dur_fast,
			owner: this,
			onUpdate: (value) => {
				this.opacity = value;
			},
			onComplete: () => {
				this.fade = null;
			},
		});
	}

	public close(): void {
		this.handle?.close();
	}

	/**
	 * Sizes to the content and places against the anchor again: after the
	 * anchor moved, or the content changed size. A placement too big for
	 * either side shrinks the surface to the room and clips it.
	 */
	public reposition(): void {
		const context = this.context;
		if (!this.handle || !context) return;
		// Back to hugging, so a surface constrained last time measures afresh.
		this.setSize(0, 0);
		this.overflow = 'visible';
		this.layoutSubtree();
		const placed = context.placement.place({
			anchor: this.anchorRect(),
			size: { width: this.width, height: this.height },
			side: this.side,
			align: this.alignment,
			offset: OFFSET,
		});
		this.placedSide = placed.side;
		this.setPosition(placed.x, placed.y);
		if (placed.constrained) {
			this.setSize(placed.width, placed.height);
			this.overflow = 'hidden';
		}
	}

	public render(draw: DrawApi): void {
		if (this.width <= 0 || this.height <= 0) return;
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: color.bg_panel_raised,
			radius: tokens.radius.radius_panel,
			border: { color: color.line_strong, width: tokens.borderWidth.bw },
			shadow: SHADOW_POP,
		});
	}

	private anchorRect(): Rect {
		const anchor = this.anchorTarget;
		return 'screenBounds' in anchor ? anchor.screenBounds : pointAnchor(anchor);
	}

	private closed(): void {
		this.fade?.cancel();
		this.fade = null;
		this.handle = null;
		this.opacity = 1;
		this.onClose?.();
	}
}
