import type { TweenHandle } from '../animation/Animator';
import type { ClickCallback, Component, PointerEvents, ResolvedColors } from '../components/Component';
import { Icon } from '../components/Icon';
import type { AnchorName } from '../components/layoutTypes';
import type { MountContext } from '../components/MountContext';
import { Stack } from '../components/Stack';
import { Text } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import type { AnyUiEvent } from '../input/events';
import type { OverlayHandle } from '../services/OverlayService';
import { contains } from '../services/OverlayService';
import { shadowExtent } from '../style/look';
import type { IconName } from '../text/icons';
import { tokens } from '../theme/tokens';
import { Button } from './Button';
import { SHADOW_RAISED, rgba } from './surfaces';

export type ToastSeverity = 'info' | 'warning' | 'critical';

/** R12.23's lifecycle. */
export type ToastState = 'appearing' | 'visible' | 'dismissing' | 'finished';

/** Why a toast went: its timer, its X, a click on it, the stack's capacity, or code. */
export type ToastDismissReason = 'timeout' | 'close' | 'click' | 'capacity' | 'programmatic';

export interface ToastOptions {
	id?: string;
	title: string;
	message?: string;
	/** Default `info`. */
	severity?: ToastSeverity;
	/** Seconds on screen once it has appeared, paused while hovered; 0 keeps it until dismissed. Default 5. */
	autoDismiss?: number;
	/** Heard once, when it has finished fading out. */
	onDismiss?: (reason: ToastDismissReason) => void;
	/** A click on the toast anywhere but its X; the toast then dismisses. */
	onClick?: ClickCallback;
}

export const TOAST_WIDTH = 320;
export const DEFAULT_AUTO_DISMISS = 5;
/** How far a toast slides in from, towards its corner's edge. */
export const TOAST_SLIDE = tokens.space.space_4;

const { color } = tokens;
const BAR_WIDTH = tokens.borderWidth.bw_thick + 1;

interface SeverityLook {
	color: RGBA;
	icon: IconName;
}

const SEVERITY: Readonly<Record<ToastSeverity, SeverityLook>> = {
	info: { color: color.status_info, icon: 'info' },
	warning: { color: color.status_warn, icon: 'warning' },
	critical: { color: color.status_crit, icon: 'error' },
};

/**
 * R12.23's toast: a raised card with the severity's bar and icon, a title,
 * a wrapped message, and an X. It lives in a ToastStack, which mounts it and
 * drops it once it has finished.
 *
 * `appearing` (a `dur` slide and fade from the stack's corner), `visible`
 * (the `autoDismiss` countdown runs on the frame clock, paused while the
 * pointer is over it), `dismissing` (a `dur_slow` fade), `finished`. The X
 * dismisses it; a click anywhere else on it fires `onClick`, then dismisses.
 */
export class Toast extends Stack {
	public onDismiss: ((reason: ToastDismissReason) => void) | null = null;
	/** @internal The stack's hook for a toast that has finished. */
	public onFinished: ((toast: Toast) => void) | null = null;

	private readonly severityValue: ToastSeverity;
	private readonly autoDismissMs: number;
	private readonly titleText: Text;
	private readonly messageText: Text | null;
	private readonly closeButton: Button;
	private stateValue: ToastState = 'appearing';
	private remainingMs: number;
	private reason: ToastDismissReason | null = null;
	private tween: TweenHandle<number> | null = null;
	/** Which way it slides in: +1 from the right, -1 from the left. */
	private slideDirection = 1;

	constructor({ id, title, message, severity = 'info', autoDismiss = DEFAULT_AUTO_DISMISS, onDismiss, onClick }: ToastOptions) {
		super({
			id,
			width: TOAST_WIDTH,
			direction: 'horizontal',
			gap: tokens.space.space_2,
			crossAlign: 'start',
			padding: { top: tokens.space.space_3, right: tokens.space.space_2, bottom: tokens.space.space_3, left: tokens.space.space_3 + BAR_WIDTH },
		});
		this.componentType = 'Toast';
		this.severityValue = severity;
		this.autoDismissMs = Math.max(0, autoDismiss) * 1000;
		this.remainingMs = this.autoDismissMs;
		if (onDismiss) this.onDismiss = onDismiss;
		if (onClick) this.onClick = onClick;

		const look = SEVERITY[severity];
		const iconSize = tokens.control.icon_md;
		const icon = new Icon({ id: id ? `${id}_icon` : undefined, glyph: look.icon, size: iconSize, tint: look.color, margin: { top: 1 } });

		const text = new Stack({ direction: 'vertical', gap: tokens.space.space_0_5, widthMode: 'fill' });
		this.titleText = new Text(title, {
			id: id ? `${id}_title` : undefined,
			style: { fontFamily: 'display', fontSize: tokens.fontSize.fs_md, color: rgba(color.text_bright), whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
		});
		text.addPart(this.titleText);
		this.messageText = message
			? new Text(message, { id: id ? `${id}_message` : undefined, style: { fontSize: tokens.fontSize.fs_sm, color: rgba(color.text_dim) } })
			: null;
		if (this.messageText) text.addPart(this.messageText);

		this.closeButton = new Button('Dismiss', {
			id: id ? `${id}_close` : undefined,
			icon: 'close',
			iconPosition: 'only',
			ghost: true,
			size: 'sm',
			width: tokens.control.control_h_sm,
			onClick: () => this.dismiss('close'),
		});

		this.addPart(icon);
		this.addPart(text);
		this.addPart(this.closeButton);
	}

	/** A card under the pointer: it takes the hit rather than the scene beneath. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	/** A click anywhere on it dismisses it, `onClick` or not. */
	public get handlesPointer(): boolean {
		return true;
	}

	public get state(): ToastState {
		return this.stateValue;
	}

	public get severity(): ToastSeverity {
		return this.severityValue;
	}

	public get title(): string {
		return this.titleText.getText();
	}

	public get message(): string | null {
		return this.messageText?.getText() ?? null;
	}

	/** Live: appearing or visible, not on its way out. */
	public get live(): boolean {
		return this.stateValue === 'appearing' || this.stateValue === 'visible';
	}

	/** Milliseconds left on the countdown; Infinity for a persistent toast. */
	public get remaining(): number {
		return this.autoDismissMs > 0 ? this.remainingMs : Infinity;
	}

	public get closeControl(): Button {
		return this.closeButton;
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: color.bg_panel_raised, border: color.line_edge };
	}

	public get inkExtent(): number {
		return shadowExtent(SHADOW_RAISED);
	}

	/** Starts its fade out. Ignored once dismissing. */
	public dismiss(reason: ToastDismissReason = 'programmatic'): void {
		if (!this.live) return;
		this.stateValue = 'dismissing';
		this.reason = reason;
		this.animate(0, tokens.motion.dur_slow, tokens.motion.ease_standard, () => this.finish());
	}

	public handleEvent(event: AnyUiEvent): void {
		// The X's click is the X's own: it dismisses without `onClick`.
		if (event.type === 'click' && event.target && contains(this.closeButton, event.target)) return;
		super.handleEvent(event);
		if (event.type === 'click') {
			event.consume();
			this.dismiss('click');
		}
	}

	/** The countdown, on the frame's dt, while visible and not hovered. */
	public update(dt: number): void {
		if (this.stateValue !== 'visible' || this.autoDismissMs <= 0) return;
		if (!this.hovered) this.remainingMs -= dt * 1000;
		if (this.remainingMs <= 0) {
			this.dismiss('timeout');
			return;
		}
		this.requestUpdate();
	}

	/** @internal The stack sets the side it slides in from before mounting it. */
	public set slideFrom(direction: 1 | -1) {
		this.slideDirection = direction;
	}

	protected onMount(context: MountContext): void {
		super.onMount(context);
		if (this.stateValue !== 'appearing') return;
		this.applyProgress(0);
		this.animate(1, tokens.motion.dur, tokens.motion.ease_emphasized, () => {
			this.stateValue = 'visible';
			this.requestUpdate();
		});
	}

	public render(draw: DrawApi): void {
		if (this.width <= 0 || this.height <= 0) return;
		const radius = tokens.radius.radius_panel;
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: color.bg_panel_raised,
			radius,
			border: { color: color.line_edge, width: tokens.borderWidth.bw_hair },
			shadow: SHADOW_RAISED,
		});
		draw.drawRect({
			rect: { x: 0, y: 0, width: BAR_WIDTH, height: this.height },
			fill: SEVERITY[this.severityValue].color,
			radius: [radius, 0, 0, radius],
		});
	}

	private finish(): void {
		this.stateValue = 'finished';
		this.onFinished?.(this);
		this.onDismiss?.(this.reason ?? 'programmatic');
	}

	private animate(target: number, duration: number, ease: readonly [number, number, number, number], done: () => void): void {
		this.tween?.cancel();
		const animator = this.context?.animator;
		if (!animator) {
			this.applyProgress(target);
			done();
			return;
		}
		this.tween = animator.tween({
			from: this.opacity,
			to: target,
			duration,
			ease,
			owner: this,
			onUpdate: (value) => this.applyProgress(value),
			onComplete: () => {
				this.tween = null;
				done();
			},
		});
	}

	/** Opacity, and while appearing the slide in from the corner's edge. */
	private applyProgress(progress: number): void {
		this.opacity = progress;
		const slide = this.stateValue === 'appearing' ? TOAST_SLIDE * (1 - progress) * this.slideDirection : 0;
		this.transform = { translate: [slide, 0] };
	}
}

export type ToastCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export interface ToastStackOptions {
	id?: string;
	/** Default `topRight`. */
	corner?: ToastCorner;
	/** Live toasts at most; the oldest is dismissed to make room. Default 4. */
	capacity?: number;
	/** Distance from the viewport's edges. */
	margin?: number;
}

export type ToastCounts = Record<ToastSeverity, number>;

/**
 * R12.23's toast stack: an overlay root in the `toast` layer anchored to a
 * corner of the viewport, holding its toasts in a column that grows away from
 * the corner, the newest nearest it. Its bounds are the envelope of its
 * toasts (it hugs them) and it is invisible while empty.
 *
 * Children are in visual order; `zIndex` is each toast's age, so paint is
 * oldest first and hit testing newest first, whichever corner it sits in.
 * A new toast past `capacity` dismisses the oldest live one. A dismissed
 * toast keeps its place while it fades, then leaves, and the rest close up.
 */
export class ToastStack extends Stack {
	private cornerValue: ToastCorner;
	private readonly capacity: number;
	private handle: OverlayHandle | null = null;
	private sequence = 0;

	constructor({ id = 'toast_stack', corner = 'topRight', capacity = 4, margin = tokens.space.space_4 }: ToastStackOptions = {}) {
		super({ id, direction: 'vertical', gap: tokens.space.space_2, margin, visible: false });
		this.componentType = 'ToastStack';
		this.cornerValue = corner;
		this.capacity = Math.max(1, capacity);
		this.applyCorner();
	}

	/** Mounts the stack as its overlay root. Ignored while attached. */
	public attach(context: MountContext): void {
		if (this.handle) return;
		this.handle = context.overlays.open(this, {
			id: `${this.id ?? 'toast_stack'}_root`,
			layer: 'toast',
			onClose: () => {
				this.handle = null;
			},
		});
	}

	/** Unmounts it; toasts still shown go with it. */
	public detach(): void {
		this.handle?.close();
	}

	public get overlay(): OverlayHandle | null {
		return this.handle;
	}

	public get corner(): ToastCorner {
		return this.cornerValue;
	}

	/** Moves the stack and re-orders its toasts for the new corner. */
	public set corner(corner: ToastCorner) {
		if (corner === this.cornerValue) return;
		this.cornerValue = corner;
		this.applyCorner();
		const toasts = [...this.toastsByAge()];
		for (const toast of toasts) this.moveChild(toast, this.slotFor(toast, toasts));
	}

	/** Every toast still shown, fading ones included, oldest first. */
	public get toasts(): readonly Toast[] {
		return this.toastsByAge();
	}

	/** Live toasts by severity. */
	public get counts(): ToastCounts {
		const counts: ToastCounts = { info: 0, warning: 0, critical: 0 };
		for (const toast of this.toastsByAge()) {
			if (toast.live) counts[toast.severity] += 1;
		}
		return counts;
	}

	/** Shows a toast, the newest nearest the corner. */
	public push(input: Toast | ToastOptions): Toast {
		const toast = input instanceof Toast ? input : new Toast(input);
		const live = this.toastsByAge().filter((each) => each.live);
		for (let index = 0; index <= live.length - this.capacity; index += 1) live[index].dismiss('capacity');

		this.sequence += 1;
		toast.zIndex = this.sequence;
		toast.slideFrom = this.isLeft ? -1 : 1;
		toast.onFinished = (finished) => this.removeToast(finished);
		this.visible = true;
		this.insertChild(this.isTop ? 0 : this.getChildren().length, toast);
		return toast;
	}

	/** Dismisses every live toast. */
	public dismissAll(): void {
		for (const toast of this.toastsByAge()) toast.dismiss('programmatic');
	}

	private get isTop(): boolean {
		return this.cornerValue === 'topLeft' || this.cornerValue === 'topRight';
	}

	private get isLeft(): boolean {
		return this.cornerValue === 'topLeft' || this.cornerValue === 'bottomLeft';
	}

	private applyCorner(): void {
		const anchor: AnchorName = this.cornerValue;
		this.anchor = anchor;
		this.crossAlign = this.isLeft ? 'start' : 'end';
	}

	private toastsByAge(): Toast[] {
		const toasts = this.getChildren().filter((child): child is Toast => child instanceof Toast);
		return toasts.sort((a, b) => a.zIndex - b.zIndex);
	}

	/** Where a toast goes in the column: newest first from a top corner, last from a bottom one. */
	private slotFor(toast: Component, byAge: readonly Toast[]): number {
		const age = byAge.indexOf(toast as Toast);
		return this.isTop ? byAge.length - 1 - age : age;
	}

	private removeToast(toast: Toast): void {
		this.removeChild(toast);
		if (this.getChildren().length === 0) this.visible = false;
	}
}
