import { Component, ComponentOptions, PointerEvents, ResolvedColors } from '../components/Component';
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import type { AnyUiEvent } from '../input/events';
import type { RGBA } from '../draw/geometry';
import type { FontRole } from '../text/fontFaces';
import { resolveFontRole } from '../text/fontRoles';
import { tokens } from '../theme/tokens';
import { Look, LookLayers, layersInkExtent, resolveLook } from '../style/look';
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

/** A rect's fill defaults to white, so an outline-only or shadow-only draw says clear. */
const CLEAR: RGBA = [0, 0, 0, 0];

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
	/** Height comes from `size` until the caller gives one (R11.10). */
	private heightFollowsSize: boolean;

	/**
	 * @param placeholder Shown while the value is empty
	 */
	constructor(placeholder = '', { size = 'md', style = {}, ...options }: InputOptions = {}) {
		super({ ...options, height: options.height ?? CONTROL_SIZES[size].height });
		this.componentType = 'Input';
		this.heightFollowsSize = options.height === undefined;
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

	/** Text size follows, and the height unless the caller has set one. */
	public set size(size: ControlSize) {
		if (size === this.fieldSize) return;
		this.fieldSize = size;
		if (this.heightFollowsSize) super.setSize(this.width, CONTROL_SIZES[size].height);
		this.restyle();
	}

	public get style(): StyleObject {
		return this.styleObject;
	}

	/** R11.16: the same path as construction, and the same validation. */
	public set style(style: StyleObject) {
		validateStyle(style, INPUT_STYLE);
		const previous = this.styleObject;
		this.styleObject = style;
		if (style.opacity !== undefined) this.opacity = style.opacity;
		else if (previous.opacity !== undefined) this.opacity = 1;
		this.restyle();
	}

	/** The ring is layer 6 of this component's own look (R11.12), not the render walk's. */
	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	/** R8.8: the focus ring and the style's shadow. */
	public get inkExtent(): number {
		return layersInkExtent(this.layers);
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

	/** The field's colours as drawn now, mid-transition included (R13.22's `style`). */
	public get resolvedColors(): ResolvedColors {
		const look = this.transition.look;
		return { fill: look.fill, text: look.text, border: look.border };
	}

	/**
	 * A press focuses the field through the dispatcher's focus seam, and a
	 * press anywhere else blurs it (R9.23's fallback until DDB-76). Keys reach
	 * it only while focused; the ones it handles are consumed, so they never
	 * reach the hotkey table (R9.15).
	 */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'pointerdown':
				if (this.enabled) this.context?.dispatcher.focus(this);
				return;
			case 'keydown':
				// R9.15: bound modifier chords (copy, a menu shortcut) are not text.
				if (event.modifiers.ctrl || event.modifiers.meta) return;
				if (this.handleKey(event.key)) event.consume();
				return;
		}
	}

	/** Mounting shows the current state at once; transitions start from there. */
	protected onMount(): void {
		this.transition.moveTo(this.targetLook, null);
	}

	/**
	 * Unmount drops focus without `onBlur` (R9.21), so the editing state it
	 * set goes here, before the look settles.
	 */
	protected onUnmount(): void {
		this.active = false;
		this.cursor.setVisible(false);
		this.transition.moveTo(this.targetLook, null);
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

	/** From here the height is the caller's, and a new `size` leaves it alone. */
	public setSize(width: number, height: number): this {
		this.heightFollowsSize = false;
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
				fill: CLEAR,
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

	/** Edits the value for one key; false for a key the field does not use. */
	private handleKey(key: string): boolean {
		if (!this.focused || !this.enabled) return false;

		if (key === 'Backspace') {
			if (this.value.length > 0) {
				this.setValue(this.value.substring(0, this.value.length - 1));
			}
			return true;
		}
		if (key === 'Enter') {
			this.context?.dispatcher.focus(null);
			return true;
		}
		if (key.length === 1) {
			if (this.value.length < this.maxLength) {
				this.setValue(this.value + key);
			}
			return true;
		}
		return false;
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
