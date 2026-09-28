import { Component, ComponentOptions, PointerEvents } from '../components/Component';
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import type { MountContext } from '../components/MountContext';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import type { FontRole } from '../text/fontFaces';
import { resolveFontRole } from '../text/fontRoles';
import { tokens } from '../theme/tokens';
import { Look, LookLayers, resolveLook } from '../style/look';
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
import { CONTROL_SIZES, ControlSize, fieldLayers } from '../style/variants';

export interface InputOptions extends Omit<ComponentOptions, 'style'> {
	/** R11.10: height (unless `height` is given) and text size together. */
	size?: ControlSize;
	style?: StyleObject;
}

/** R11.14: what a text field renders. A field's text is left-aligned and unstyled beyond its face and size. */
const INPUT_STYLE: StyleAcceptance = {
	component: 'Input',
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
		'padding',
		'shadow',
	]),
	states: new Set(['hover', 'active', 'disabled']),
	stateProperties: new Set<StyleProperty>(['backgroundColor', 'color', 'borderColor']),
};

/** Seconds per caret phase. */
const CARET_BLINK = 0.5;

/**
 * A single-line text field, styled by R11 as a well: its editing state is
 * the component's own `active` flag (layer 4, the border lifts to the
 * accent), set while it holds focus. The box and focus ring are its own
 * draws; the value, placeholder, and caret are parts that follow the look.
 */
export class Input extends Component {
	private text: Text;
	private placeholder: Text;
	private cursor: Rectangle;
	private value = '';
	private maxLength = 100;
	private onChangeCallback: ((value: string) => void) | null = null;
	private cursorBlinkTimer = 0;
	private fieldSize: ControlSize;
	private styleObject: StyleObject;
	private layers: LookLayers;
	private padding: Sides;
	private readonly transition: LookTransition;

	/**
	 * @param placeholder Shown while the value is empty
	 */
	constructor(placeholder = '', { size = 'md', style = {}, ...options }: InputOptions = {}) {
		super({ ...options, height: options.height ?? CONTROL_SIZES[size].height });
		this.componentType = 'Input';
		validateStyle(style, INPUT_STYLE);
		this.fieldSize = size;
		this.styleObject = style;
		this.layers = fieldLayers(style);
		this.padding = this.resolvePadding();
		if (style.opacity !== undefined) this.opacity = style.opacity;

		const textStyle = { ...this.textStyle(), textAlign: 'left', verticalAlign: 'middle', whiteSpace: 'nowrap' } as const;
		this.text = new Text('', { style: textStyle });
		this.addPart(this.text);

		this.placeholder = new Text(placeholder, { style: textStyle });
		this.addPart(this.placeholder);

		// Placed and sized from the text's metrics by updateCursorPosition
		this.cursor = new Rectangle({
			width: tokens.borderWidth.bw_thick,
			style: { backgroundColor: [...tokens.color.text] as [number, number, number, number] },
		});
		this.cursor.setVisible(false);
		this.addPart(this.cursor);

		this.transition = new LookTransition({
			owner: this,
			look: this.targetLook,
			onChange: (look) => this.followLook(look),
		});
		this.followLook(this.transition.look);
		this.placeText();
	}

	/** R8.29: the text, placeholder and caret are internals, not targets. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	public get size(): ControlSize {
		return this.fieldSize;
	}

	public set size(size: ControlSize) {
		if (size === this.fieldSize) return;
		this.fieldSize = size;
		this.restyle();
	}

	public get style(): StyleObject {
		return this.styleObject;
	}

	/** R11.16: the same path as construction, and the same validation. */
	public set style(style: StyleObject) {
		validateStyle(style, INPUT_STYLE);
		this.styleObject = style;
		if (style.opacity !== undefined) this.opacity = style.opacity;
		this.restyle();
	}

	/** The look drawn this frame, mid-transition included. */
	public get look(): Look {
		return this.transition.look;
	}

	/**
	 * The caret follows the text's measured layout, which exists once the text
	 * has mounted and measured; its size change lays this out again (R8.18).
	 */
	protected layoutChildren(): void {
		this.placeText();
	}

	protected onMount(context: MountContext): void {
		this.transition.snap();
		const { input } = context;
		input.registerMouseOver(this, () => this.setHovered(true));
		input.registerMouseOut(this, () => this.setHovered(false));
		input.registerMouseDown(this, () => this.onMouseDown());
		input.registerKeyDown(this, (key: string) => this.onKeyPress(key));
	}

	protected onUnmount(): void {
		this.transition.snap();
	}

	protected onStateChange(): void {
		this.transition.moveTo(this.targetLook, this.context?.animator ?? null);
	}

	/**
	 * Set the input's value
	 * @param value Input value
	 */
	public setValue(value: string): this {
		this.value = value.substring(0, this.maxLength);
		this.text.setText(this.value);
		this.placeholder.setVisible(this.value.length === 0);
		this.updateCursorPosition();
		this.onChangeCallback?.(this.value);
		return this;
	}

	public getValue(): string {
		return this.value;
	}

	public setSize(width: number, height: number): this {
		super.setSize(width, height);
		this.placeText();
		return this;
	}

	/**
	 * Set the onChange callback
	 * @param callback Function to call when the input value changes
	 */
	public onChange(callback: (value: string) => void): this {
		this.onChangeCallback = callback;
		return this;
	}

	/** Holding focus is editing: layer 4's `active`, and a blinking caret. */
	protected onFocus(): void {
		this.active = true;
		this.cursor.setVisible(true);
		this.cursorBlinkTimer = 0;
		this.requestUpdate();
	}

	protected onBlur(): void {
		this.active = false;
		this.cursor.setVisible(false);
	}

	public render(draw: DrawApi): void {
		const look = this.transition.look;
		const radius = look.radius > 0 ? look.radius : undefined;
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: look.fill,
			radius,
			border: look.borderWidth > 0 ? { color: look.border, width: look.borderWidth } : undefined,
			shadow: look.shadow ?? undefined,
		});
		if (look.focusRing) {
			const offset = tokens.control.focus_ring_offset;
			draw.drawRect({
				rect: { x: -offset, y: -offset, width: this.width + offset * 2, height: this.height + offset * 2 },
				radius: radius !== undefined ? radius + offset : undefined,
				border: { color: look.focusRing, width: tokens.control.focus_ring_width, position: 'outside' },
			});
		}
	}

	/**
	 * Update the input component (for cursor blinking)
	 * @param dt Delta time since last update
	 */
	public update(dt: number): void {
		// Blink only while focused; an unfocused input stops asking (R8.17).
		if (this.focused) {
			this.cursorBlinkTimer += dt;
			this.cursor.setVisible(Math.floor(this.cursorBlinkTimer / CARET_BLINK) % 2 === 0);
			this.requestUpdate();
		}
	}

	private onMouseDown(): void {
		if (!this.enabled) return;
		// Blur whichever other field holds focus
		const input = this.context?.input;
		const currentFocus = input?.getFocus() ?? null;
		if (currentFocus && currentFocus !== this && currentFocus instanceof Input) {
			currentFocus.blur();
		}
		this.setFocused(true);
		input?.setFocus(this);
	}

	private blur(): void {
		if (!this.focused) return;
		this.setFocused(false);
		this.context?.input.setFocus(null);
	}

	private onKeyPress(key: string): void {
		if (!this.focused || !this.enabled) return;

		if (key === 'Backspace') {
			if (this.value.length > 0) {
				this.setValue(this.value.substring(0, this.value.length - 1));
			}
		} else if (key === 'Enter') {
			this.blur();
		} else if (key.length === 1) {
			if (this.value.length < this.maxLength) {
				this.setValue(this.value + key);
			}
		}
	}

	private get targetLook(): Look {
		return resolveLook(this.layers, this.stateFlags);
	}

	private restyle(): void {
		this.layers = fieldLayers(this.styleObject);
		this.padding = this.resolvePadding();
		const textStyle = this.textStyle();
		this.text.textStyle = textStyle;
		this.placeholder.textStyle = textStyle;
		this.onStateChange();
		this.invalidateLayout();
	}

	private textStyle() {
		const style = this.styleObject;
		let role: FontRole = style.fontRole ?? (style.fontFamily !== undefined ? fontRoleOfFamily(style.fontFamily, 'Input') : 'body');
		if (style.fontWeight !== undefined) role = resolveFontRole({ family: role, weight: style.fontWeight });
		return {
			fontFamily: role,
			fontSize: style.fontSize !== undefined ? resolveLength(style.fontSize, 'fontSize') : CONTROL_SIZES[this.fieldSize].fontSize,
			letterSpacing: style.letterSpacing !== undefined ? resolveLetterSpacing(style.letterSpacing) : 0,
		} as const;
	}

	/** R11.9: 12 px horizontal inset inside fields. */
	private resolvePadding(): Sides {
		const inset = tokens.control.inset_field;
		const fallback = { top: 0, right: inset, bottom: 0, left: inset };
		return this.styleObject.padding !== undefined ? resolvePadding(this.styleObject.padding, fallback) : fallback;
	}

	/** The value and caret take the look's text colour; the placeholder stays faint, or disabled with the rest. */
	private followLook(look: Look): void {
		const text = [...look.text] as [number, number, number, number];
		this.text.setColor(text);
		this.cursor.setFillColor(text);
		const placeholder: RGBA = this.effectivelyEnabled ? tokens.color.text_faint : tokens.color.text_disabled;
		this.placeholder.setColor([...placeholder] as [number, number, number, number]);
	}

	private placeText(): void {
		const { top, right, bottom, left } = this.padding;
		const width = Math.max(0, this.width - left - right);
		const height = Math.max(0, this.height - top - bottom);
		this.text.setPosition(left, top);
		this.text.setSize(width, height);
		this.placeholder.setPosition(left, top);
		this.placeholder.setSize(width, height);
		this.updateCursorPosition();
	}

	/**
	 * The caret sits after the last code point, at the pen position the text's
	 * own layout reports (R2.14), and spans the text's line box, which the
	 * text centres in the field.
	 */
	private updateCursorPosition(): void {
		const measured = this.text.measured;
		if (!measured) return;
		const advances = measured.advances;
		const lineHeight = measured.height / Math.max(1, measured.lines);
		this.cursor.setX(this.padding.left + (advances.length > 0 ? advances[advances.length - 1] : 0));
		this.cursor.setY(this.padding.top + (this.text.getHeight() - lineHeight) / 2);
		this.cursor.setHeight(lineHeight);
	}
}
