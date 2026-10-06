import type { ClickCallback, ComponentOptions, ResolvedColors } from '../components/Component';
import { Icon } from '../components/Icon';
import { Text, TextStyleObject } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import type { IconName } from '../text/icons';
import type { FontRole } from '../text/fontFaces';
import { resolveFontRole } from '../text/fontRoles';
import { tokens } from '../theme/tokens';
import { Look, LookLayers, glowShadow, layersInkExtent, resolveLook } from '../style/look';
import { LookTransition } from '../style/LookTransition';
import {
	Sides,
	StyleAcceptance,
	StyleObject,
	StyleProperty,
	fontRoleOfFamily,
	resolveLength,
	resolveLetterSpacing,
	resolvePadding,
	validateStyle,
} from '../style/styleObject';
import { CONTROL_SIZES, ControlSize, Tone, buttonLayers } from '../style/variants';
import { Pressable } from './Pressable';

/** R12.7: where the icon sits against the label; `only` draws the icon alone, centred. */
export type IconPosition = 'left' | 'right' | 'only';

export interface ButtonOptions extends Omit<ComponentOptions, 'style'> {
	/** The label. Default empty; with `iconPosition: 'only'` it names the button without being drawn. */
	label?: string;
	/** R12.7's icon, drawn beside the label as `iconPosition` says; the pair is centred together. */
	icon?: IconName;
	/** Default `left`. With `only` the label is kept (it names the button) but not drawn. */
	iconPosition?: IconPosition;
	/**
	 * R12.7's ghost variant: no fill and no border at rest, the tone's colour
	 * on the label, and the same hover, pressed, and focus layers as a filled
	 * button (R11.12). For toolbars and quiet actions.
	 */
	ghost?: boolean;
	/** R12.7's `block`: fills the parent stack's width (`widthMode: 'fill'`). */
	block?: boolean;
	/** R12.7's `disabled`: the constructor's form of `enabled: false`. */
	disabled?: boolean;
	onClick?: ClickCallback;
	/** R11.10. `default` is the neutral raised button; `accent` is the primary action. */
	tone?: Tone;
	/** R11.10: height (unless `height` is given), label size, and icon size together. */
	size?: ControlSize;
	style?: StyleObject;
}

/** A rect's fill defaults to white, so an outline-only or shadow-only draw says clear. */
const CLEAR: RGBA = [0, 0, 0, 0];

/** R11.14: what a button renders. */
const BUTTON_STYLE: StyleAcceptance = {
	component: 'Button',
	properties: new Set<StyleProperty>([
		'backgroundColor',
		'color',
		'borderColor',
		'borderWidth',
		'borderRadius',
		'opacity',
		'fontSize',
		'fontRole',
		'fontFamily',
		'fontWeight',
		'letterSpacing',
		'textTransform',
		'textAlign',
		'textDecoration',
		'padding',
		'shadow',
		'cursor',
	]),
	states: new Set(['hover', 'pressed', 'selected', 'active', 'disabled']),
	stateProperties: new Set<StyleProperty>(['backgroundColor', 'color', 'borderColor']),
};

/** The label's gap to a leading icon, as a multiple of the label size. */
const ICON_GAP = 0.375;

/**
 * R12.7's button, styled by R11: a tone and size pick the variant base from
 * tokens, the style object overrides it, and the R11.11 flags layer over
 * both through `resolveLook`, moving by R11.13's transitions. The box, its
 * glow, and the focus ring are this component's own draws; the label and
 * icon are parts that follow the look.
 */
export class Button extends Pressable {
	private text: Text;
	private icon: Icon | null = null;
	private iconSide: IconPosition;
	/** The icon and gap the label's box gives up on the icon's side. */
	private labelInset = 0;
	private isGhost: boolean;
	private buttonTone: Tone;
	private buttonSize: ControlSize;
	private styleObject: StyleObject;
	private layers: LookLayers;
	private padding: Sides;
	private readonly transition: LookTransition;
	/** Height comes from `size` until the caller gives one (R11.10). */
	private heightFollowsSize: boolean;

	constructor({
		label = '',
		icon,
		iconPosition = 'left',
		ghost = false,
		block = false,
		disabled = false,
		onClick,
		tone = 'default',
		size = 'md',
		style = {},
		...options
	}: ButtonOptions = {}) {
		// R12.7: focusable unless told otherwise.
		super({
			focusable: true,
			...(block ? { widthMode: 'fill' } : {}),
			...(disabled ? { enabled: false } : {}),
			...options,
			height: options.height ?? CONTROL_SIZES[size].height,
		});
		this.componentType = 'Button';
		this.heightFollowsSize = options.height === undefined;
		validateStyle(style, BUTTON_STYLE);
		if (iconPosition === 'only' && !icon) throw new Error('Button: iconPosition "only" needs an icon (R12.7)');
		this.iconSide = iconPosition;
		this.isGhost = ghost;
		this.buttonTone = tone;
		this.buttonSize = size;
		this.styleObject = style;
		this.layers = buttonLayers(tone, style, ghost);
		if (onClick) this.onClick = onClick;
		this.padding = this.resolvePadding();
		if (style.opacity !== undefined) this.opacity = style.opacity;
		if (style.cursor !== undefined) this.cursor = style.cursor;

		this.text = new Text({
			text: label,
			style: this.labelStyle(),
			verticalAlign: 'middle',
			wrap: 'none',
		});
		this.addPart(this.text);
		if (iconPosition === 'only') this.text.visible = false;

		if (icon) {
			this.icon = new Icon({ glyph: icon, size: CONTROL_SIZES[size].iconSize });
			this.addPart(this.icon);
		}

		this.transition = new LookTransition({
			owner: this,
			look: this.targetLook,
			onChange: (look) => this.followLook(look),
		});
		this.followLook(this.transition.look);
		this.placeLabel();
	}

	public get tone(): Tone {
		return this.buttonTone;
	}

	public set tone(tone: Tone) {
		if (tone === this.buttonTone) return;
		this.buttonTone = tone;
		this.restyle();
	}

	public get ghost(): boolean {
		return this.isGhost;
	}

	public set ghost(ghost: boolean) {
		if (ghost === this.isGhost) return;
		this.isGhost = ghost;
		this.restyle();
	}

	public get iconPosition(): IconPosition {
		return this.iconSide;
	}

	public get size(): ControlSize {
		return this.buttonSize;
	}

	/** Label size and icon size follow, and the height unless the caller has set one. */
	public set size(size: ControlSize) {
		if (size === this.buttonSize) return;
		this.buttonSize = size;
		if (this.icon) this.icon.size = CONTROL_SIZES[size].iconSize;
		if (this.heightFollowsSize) super.setSize(this.width, CONTROL_SIZES[size].height);
		this.restyle();
	}

	public get style(): StyleObject {
		return this.styleObject;
	}

	/** R11.16: the same path as construction, and the same validation. */
	public set style(style: StyleObject) {
		validateStyle(style, BUTTON_STYLE);
		const previous = this.styleObject;
		this.styleObject = style;
		if (style.opacity !== undefined) this.opacity = style.opacity;
		else if (previous.opacity !== undefined) this.opacity = 1;
		// A cursor the last style set goes back to the kind default; one set on the component since stays.
		if (style.cursor !== undefined) this.cursor = style.cursor;
		else if (previous.cursor !== undefined && this.cursor === previous.cursor) this.cursor = null;
		this.restyle();
	}

	/** The ring is layer 6 of this component's own look (R11.12), not the render walk's. */
	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	/** R8.8: the ring, any glow a state can raise, the style's shadow, and the press nudge. */
	public get inkExtent(): number {
		return layersInkExtent(this.layers);
	}

	/** The look drawn this frame, mid-transition included. */
	public get look(): Look {
		return this.transition.look;
	}

	/**
	 * The icon sits against the label's measured width, which exists from
	 * mount (R1.6); the layout phase places it before the first render, and a
	 * new label, font size, or size lays it out again (R8.18).
	 */
	protected layoutChildren(): void {
		this.placeLabel();
	}

	/** The look's colours as drawn now, mid-transition included (R13.22's `style`). */
	public get resolvedColors(): ResolvedColors {
		const look = this.transition.look;
		return { fill: look.fill, text: look.text, border: look.border };
	}

	/** Mounting shows the current state at once; transitions start from there. */
	protected onMount(): void {
		this.transition.moveTo(this.targetLook, null);
	}

	protected onUnmount(): void {
		super.onUnmount();
		this.transition.moveTo(this.targetLook, null);
	}

	protected onStateChange(): void {
		super.onStateChange();
		this.transition.moveTo(this.targetLook, this.context?.animator ?? null);
	}

	/** The button's label text. */
	public get label(): string {
		return this.text.text;
	}

	public set label(text: string) {
		this.text.text = text;
	}

	/** From here the height is the caller's, and a new `size` leaves it alone. */
	public setSize(width: number, height: number): this {
		this.heightFollowsSize = false;
		super.setSize(width, height);
		this.placeLabel();
		return this;
	}

	public render(draw: DrawApi): void {
		const look = this.transition.look;
		const rect = { x: 0, y: look.offsetY, width: this.width, height: this.height };
		const radius = look.radius > 0 ? look.radius : undefined;
		const glow = look.glow[3] > 0 ? glowShadow(look.glow) : null;
		// One shadow per rect: the glow rides on the box unless the style
		// already gave it an elevation, in which case it gets its own.
		if (glow && look.shadow) draw.drawRect({ rect, fill: CLEAR, radius, shadow: glow });
		draw.drawRect({
			id: this.id ?? undefined,
			rect,
			fill: look.fill,
			radius,
			border: look.borderWidth > 0 ? { color: look.border, width: look.borderWidth } : undefined,
			shadow: look.shadow ?? glow ?? undefined,
		});
		if (look.focusRing) {
			const offset = tokens.control.focus_ring_offset;
			draw.drawRect({
				rect: { x: -offset, y: rect.y - offset, width: this.width + offset * 2, height: this.height + offset * 2 },
				fill: CLEAR,
				radius: radius !== undefined ? radius + offset : undefined,
				border: { color: look.focusRing, width: tokens.control.focus_ring_width, position: 'outside' },
			});
		}
	}

	private get targetLook(): Look {
		return resolveLook(this.layers, this.stateFlags);
	}

	/** Rebuilds everything the tone, size, and style decide, and moves the look there. */
	private restyle(): void {
		this.layers = buttonLayers(this.buttonTone, this.styleObject, this.isGhost);
		this.padding = this.resolvePadding();
		// A new style replaces the label's whole (R11.16), colour included, so
		// the look's colour goes back on before any transition moves it.
		this.text.style = this.labelStyle();
		this.followLook(this.transition.look);
		this.onStateChange();
		this.invalidateLayout();
	}

	private labelStyle(): TextStyleObject {
		const style = this.styleObject;
		let role: FontRole = style.fontRole ?? (style.fontFamily !== undefined ? fontRoleOfFamily(style.fontFamily, 'Button') : 'display');
		if (style.fontWeight !== undefined) role = resolveFontRole({ family: role, weight: style.fontWeight });
		return {
			fontRole: role,
			fontSize: style.fontSize !== undefined ? resolveLength(style.fontSize, 'fontSize') : CONTROL_SIZES[this.buttonSize].fontSize,
			letterSpacing: style.letterSpacing !== undefined ? resolveLetterSpacing(style.letterSpacing) : 0,
			textTransform: style.textTransform ?? 'none',
			textDecoration: style.textDecoration ?? 'none',
			textAlign: style.textAlign ?? 'center',
		};
	}

	/** R11.9: a control's horizontal inset is `inset_field` unless the style says otherwise. */
	private resolvePadding(): Sides {
		const inset = tokens.control.inset_field;
		const fallback = { top: 0, right: inset, bottom: 0, left: inset };
		return this.styleObject.padding !== undefined ? resolvePadding(this.styleObject.padding, fallback) : fallback;
	}

	/** The label and icon take the look's text colour and follow the pressed nudge. */
	private followLook(look: Look): void {
		this.text.color = [...look.text] as [number, number, number, number];
		if (this.icon) this.icon.tint = look.text;
		const nudge = look.offsetY;
		if (this.text.transform.translate[1] !== nudge) {
			this.text.transform = { translate: [0, nudge] };
			if (this.icon) this.icon.transform = { translate: [0, nudge] };
		}
	}

	/**
	 * The label fills the padded box. With an icon, icon, gap and label are
	 * centred as one group: the label's box gives up the icon and gap on the
	 * icon's side, which moves its centre away by half of them, and the icon
	 * sits just outside the label's edge on that side. The width is the
	 * label's own measure, so its tracking and transform count (R12.7); the
	 * icon waits while the label cannot be measured. An icon-only button
	 * centres the icon in the box.
	 */
	private placeLabel(): void {
		const { top, right, bottom, left } = this.padding;
		const icon = this.icon;
		const iconY = Math.round(top + (this.height - top - bottom - (icon?.size ?? 0)) / 2);
		if (icon && this.iconSide === 'only') {
			icon.setPosition(Math.round((this.width - icon.size) / 2), iconY);
			this.labelInset = 0;
		} else {
			const labelWidth = this.text.measured?.width;
			if (icon && labelWidth !== undefined) {
				const gap = Math.round(this.text.fontSize * ICON_GAP);
				const groupLeft = (this.width - (icon.size + gap + labelWidth)) / 2;
				const iconX = this.iconSide === 'left' ? groupLeft : groupLeft + labelWidth + gap;
				icon.setPosition(Math.round(iconX), iconY);
				this.labelInset = icon.size + gap;
			}
		}
		const labelX = this.iconSide === 'left' ? left + this.labelInset : left;
		this.text.setPosition(labelX, top);
		this.text.setSize(Math.max(0, this.width - left - right - this.labelInset), Math.max(0, this.height - top - bottom));
	}
}
