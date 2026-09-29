import type { TweenHandle } from '../animation/Animator';
import type { Ease } from '../animation/easing';
import { Component, PointerEvents, ResolvedColors } from '../components/Component';
import type { MountContext } from '../components/MountContext';
import { Stack, StackOptions } from '../components/Stack';
import { Text } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import type { OverlayDismissReason, OverlayHandle } from '../services/OverlayService';
import { shadowExtent } from '../style/look';
import { tokens } from '../theme/tokens';
import { Button } from './Button';
import { SHADOW_POP, rgba } from './surfaces';

export type DialogSize = 'sm' | 'md' | 'lg';

/** R12.21's lifecycle. */
export type DialogState = 'closed' | 'opening' | 'open' | 'closing';

/** The panel's width for each `size`; the height hugs the content. */
export const DIALOG_WIDTHS: Readonly<Record<DialogSize, number>> = { sm: 360, md: 480, lg: 640 };

/** R12.21's emphasised entrance: the panel grows from this scale and rises this far. */
export const DIALOG_ENTRANCE_SCALE = 0.96;
export const DIALOG_ENTRANCE_RISE = tokens.space.space_2;

export interface DialogOptions {
	id?: string;
	title?: string;
	/** A small line above the title: a category, a warning, a count. */
	kicker?: string;
	/** Default `md`. */
	size?: DialogSize;
	/**
	 * Default true: a scrim in the `modal` layer that takes every press from
	 * its first frame, a focus scope, and no hotkeys beneath it. A non-modal
	 * dialog lives in `overlay`, draws no scrim, and never consumes a press
	 * outside its panel.
	 */
	modal?: boolean;
	/** The body, authored in its own local coordinates and clipped to the content rect. */
	content?: Component;
	/** Actions laid out at the footer's right end, in order (R12.21's `footer` slot). */
	footer?: Component[];
	/** Default false: a stray click must not dismiss "Abandon run?". */
	dismissOnOutsidePress?: boolean;
	/** Default true; honoured only once the dialog is fully open. */
	closeOnEscape?: boolean;
	/** Focused on open; otherwise the first focusable in the content, then the footer, then the close button. */
	initialFocus?: Component;
	/** Heard once each time the dialog has finished closing, whatever closed it. */
	onClose?: () => void;
}

const { color } = tokens;
const EDGE = tokens.space.space_4;
const HEADER_PADDING = { top: tokens.space.space_3, right: tokens.space.space_3, bottom: tokens.space.space_3, left: EDGE };
const FOOTER_PADDING = { top: tokens.space.space_3, right: EDGE, bottom: tokens.space.space_3, left: EDGE };
const CLOSE_SIZE = tokens.control.control_h_sm;

/**
 * The dialog's surface: the popped panel with a hairline under the header
 * and over the footer. A column stack of three parts: header, body, footer.
 */
class DialogPanel extends Stack {
	public header: Component | null = null;
	public footer: Component | null = null;

	constructor(options: StackOptions) {
		super(options);
		this.componentType = 'DialogPanel';
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: color.bg_panel_raised, border: color.line_edge };
	}

	public get inkExtent(): number {
		return shadowExtent(SHADOW_POP);
	}

	public render(draw: DrawApi): void {
		if (this.width <= 0 || this.height <= 0) return;
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: color.bg_panel_raised,
			radius: tokens.radius.radius_panel,
			border: { color: color.line_edge, width: tokens.borderWidth.bw },
			shadow: SHADOW_POP,
		});
		const hairline = tokens.borderWidth.bw_hair;
		if (this.header) {
			draw.drawRect({ rect: { x: 0, y: this.header.y + this.header.height - hairline, width: this.width, height: hairline }, fill: color.line_hairline });
		}
		if (this.footer?.visible) {
			draw.drawRect({ rect: { x: 0, y: this.footer.y, width: this.width, height: hairline }, fill: color.line_hairline });
		}
	}
}

/**
 * R12.21's dialog, opened and closed through the overlay service (R8.21),
 * which owns it as a root for the whole animation.
 *
 * The dialog itself is the viewport-sized box the service sizes (`fill`): a
 * modal one draws the scrim there and, with `pointerEvents: auto`, takes
 * every press from its first frame (R3.29), whatever the fade has reached,
 * since the scrim's fade is its colour and not the component's opacity. The
 * panel, centred by anchor, is the service's `inside`, so a press on the
 * scrim is outside: it closes the dialog when `dismissOnOutsidePress`, and a
 * modal consumes it either way while a non-modal one never does.
 *
 * `closed`, `opening` (`dur` with the emphasised entrance: scale 0.96, 8 px
 * rise, fade), `open`, `closing` (`dur_fast` fade), through the animator.
 * `open()` is ignored unless closed, `close()` unless open or opening;
 * Escape closes only when fully open and `closeOnEscape`; the X always
 * closes. A modal pushes a focus scope on its root (R9.20), so Tab stays in
 * the dialog and focus returns to where it was when it closes.
 */
export class Dialog extends Component {
	/** Fired once each time the dialog has finished closing. */
	public onClose: (() => void) | null = null;

	private readonly panel: DialogPanel;
	private readonly kickerText: Text | null;
	private readonly titleText: Text;
	private readonly closeButton: Button;
	private readonly body: Stack;
	private readonly footerRow: Stack;
	private readonly isModal: boolean;
	private readonly dismissOnOutsidePress: boolean;
	private readonly closeOnEscape: boolean;
	private readonly initialFocus: Component | null;
	private stateValue: DialogState = 'closed';
	private handle: OverlayHandle | null = null;
	private progressTween: TweenHandle<number> | null = null;
	/** 0 closed, 1 open: the scrim's alpha, the panel's opacity, and the entrance. */
	private progressValue = 0;

	constructor({
		id = 'dialog',
		title = '',
		kicker,
		size = 'md',
		modal = true,
		content,
		footer = [],
		dismissOnOutsidePress = false,
		closeOnEscape = true,
		initialFocus,
		onClose,
	}: DialogOptions = {}) {
		super({ id });
		this.componentType = 'Dialog';
		this.isModal = modal;
		this.pointerEvents = modal ? 'auto' : 'passthrough';
		this.dismissOnOutsidePress = dismissOnOutsidePress;
		this.closeOnEscape = closeOnEscape;
		this.initialFocus = initialFocus ?? null;
		if (onClose) this.onClose = onClose;

		this.panel = new DialogPanel({
			id: `${id}_panel`,
			width: DIALOG_WIDTHS[size],
			direction: 'vertical',
			crossAlign: 'stretch',
			anchor: 'center',
		});

		const heading = new Stack({ id: `${id}_heading`, direction: 'vertical', gap: tokens.space.space_0_5, widthMode: 'fill' });
		this.kickerText = kicker !== undefined
			? new Text(kicker, {
				id: `${id}_kicker`,
				style: {
					fontFamily: 'mono',
					fontSize: tokens.fontSize.fs_xs,
					color: rgba(color.accent),
					textTransform: 'uppercase',
					letterSpacing: tokens.letterSpacing.ls_wide,
					whiteSpace: 'nowrap',
					textOverflow: 'ellipsis',
				},
			})
			: null;
		this.titleText = new Text(title, {
			id: `${id}_title`,
			style: {
				fontFamily: 'display',
				fontSize: tokens.fontSize.fs_lg,
				color: rgba(color.text_bright),
				textTransform: 'uppercase',
				letterSpacing: tokens.letterSpacing.ls_wide,
				whiteSpace: 'nowrap',
				textOverflow: 'ellipsis',
			},
		});
		if (this.kickerText) heading.addPart(this.kickerText);
		heading.addPart(this.titleText);

		this.closeButton = new Button('Close', {
			id: `${id}_close`,
			icon: 'close',
			iconPosition: 'only',
			ghost: true,
			size: 'sm',
			width: CLOSE_SIZE,
			onClick: () => this.close(),
		});

		const header = new Stack({
			id: `${id}_header`,
			direction: 'horizontal',
			gap: tokens.space.space_3,
			crossAlign: 'center',
			padding: HEADER_PADDING,
		});
		header.addPart(heading);
		header.addPart(this.closeButton);

		this.body = new Stack({ id: `${id}_body`, direction: 'vertical', padding: EDGE, overflow: 'hidden' });
		if (content) this.body.addChild(content);

		this.footerRow = new Stack({
			id: `${id}_footer`,
			direction: 'horizontal',
			distribution: 'end',
			crossAlign: 'center',
			gap: tokens.space.space_2,
			padding: FOOTER_PADDING,
			visible: footer.length > 0,
		});
		for (const action of footer) this.footerRow.addChild(action);

		this.panel.header = header;
		this.panel.footer = this.footerRow;
		this.panel.addPart(header);
		this.panel.addPart(this.body);
		this.panel.addPart(this.footerRow);
		this.addPart(this.panel);
		this.applyProgress(0);
	}

	public get state(): DialogState {
		return this.stateValue;
	}

	/** The surface a press has to land in to count as inside (the overlay's `inside`). */
	public get surface(): Component {
		return this.panel;
	}

	/** The close button, the X that always closes. */
	public get closeControl(): Button {
		return this.closeButton;
	}

	/** The overlay root while open, closing, or opening. */
	public get overlay(): OverlayHandle | null {
		return this.handle;
	}

	/** How far the entrance has run: 0 closed, 1 fully open. */
	public get progress(): number {
		return this.progressValue;
	}

	public get title(): string {
		return this.titleText.getText();
	}

	public set title(title: string) {
		this.titleText.setText(title);
	}

	public get resolvedColors(): ResolvedColors | null {
		return this.isModal ? { fill: this.scrimColor } : null;
	}

	/**
	 * R12.21's `open()`: opens it over everything in the `modal` layer
	 * (`overlay` when not modal), through the context of whatever asked (a
	 * screen, a button's handler). Ignored unless closed. Named `show`
	 * because `open` is R11.11's state flag on every component, which this
	 * sets while the dialog is anything but closed.
	 */
	public show(context: MountContext): void {
		if (this.stateValue !== 'closed') return;
		this.stateValue = 'opening';
		this.open = true;
		this.handle = context.overlays.open(this, {
			id: `${this.id ?? 'dialog'}_root`,
			layer: this.isModal ? 'modal' : 'overlay',
			modal: this.isModal,
			fill: true,
			inside: this.panel,
			dismissOnOutsidePress: this.dismissOnOutsidePress,
			closeOnEscape: this.closeOnEscape,
			onDismiss: (reason) => this.dismissed(reason),
			onClose: () => this.closed(),
		});
		this.moveFocusIn(context);
		this.animateTo(1, tokens.motion.dur, tokens.motion.ease_emphasized, () => {
			this.stateValue = 'open';
		});
	}

	/** Runs the closing fade and then gives the root back. Ignored unless open or opening. */
	public close(): void {
		if (this.stateValue !== 'open' && this.stateValue !== 'opening') return;
		this.stateValue = 'closing';
		this.animateTo(0, tokens.motion.dur_fast, tokens.motion.ease_standard, () => this.handle?.close());
	}

	public render(draw: DrawApi): void {
		if (!this.isModal || this.width <= 0 || this.height <= 0) return;
		draw.drawRect({ id: this.id ?? undefined, rect: { x: 0, y: 0, width: this.width, height: this.height }, fill: this.scrimColor });
	}

	private get scrimColor(): RGBA {
		const scrim = color.scrim;
		return [scrim[0], scrim[1], scrim[2], scrim[3] * this.progressValue];
	}

	/** Escape counts only once fully open (R12.21); an outside press whenever `close` would. */
	private dismissed(reason: OverlayDismissReason): void {
		if (reason === 'escape' && this.stateValue !== 'open') return;
		this.close();
	}

	/** The root is gone, by the closing fade or from outside (a scene change's `closeAll`). */
	private closed(): void {
		this.progressTween?.cancel();
		this.progressTween = null;
		this.handle = null;
		this.stateValue = 'closed';
		this.open = false;
		this.applyProgress(0);
		this.onClose?.();
	}

	private moveFocusIn(context: MountContext): void {
		const target = this.initialFocus
			?? context.focus.firstIn(this.body)
			?? (this.footerRow.visible ? context.focus.firstIn(this.footerRow) : null)
			?? this.closeButton;
		if (target.canReceiveFocus()) context.focus.focus(target);
	}

	private animateTo(target: number, duration: number, ease: Ease, done: () => void): void {
		const animator = this.context?.animator;
		this.progressTween?.cancel();
		if (!animator) {
			this.applyProgress(target);
			done();
			return;
		}
		this.progressTween = animator.tween({
			from: this.progressValue,
			to: target,
			duration,
			ease,
			owner: this,
			onUpdate: (value) => this.applyProgress(value),
			onComplete: () => {
				this.progressTween = null;
				done();
			},
		});
	}

	private applyProgress(progress: number): void {
		this.progressValue = progress;
		this.panel.opacity = progress;
		const entrance = 1 - progress;
		this.panel.transform = {
			scale: DIALOG_ENTRANCE_SCALE + (1 - DIALOG_ENTRANCE_SCALE) * progress,
			translate: [0, DIALOG_ENTRANCE_RISE * entrance],
		};
	}
}
