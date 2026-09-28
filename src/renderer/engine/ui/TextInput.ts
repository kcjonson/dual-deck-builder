import { Component, ComponentOptions, PointerEvents, ResolvedColors } from '../components/Component';
import type { MountContext } from '../components/MountContext';
import type { DrawApi } from '../draw/DrawApi';
import type { Rect } from '../draw/geometry';
import type { AnyUiEvent, UiKeyEvent, UiPointerEvent } from '../input/events';
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
import { drawControlBox } from './controlBox';

/**
 * R12.10's validator: whether an edit may happen, given the value it would
 * leave and the code point it inserts ('' for a deletion). A paste asks once
 * per code point, so a rejected character is dropped and the rest go in.
 */
export type TextValidator = (next: string, inserted: string) => boolean;

export interface TextInputOptions extends Omit<ComponentOptions, 'style'> {
	value?: string;
	placeholder?: string;
	/** Code points; unlimited when absent. */
	maxLength?: number;
	/** Draws a bullet per code point, and refuses to copy or cut. */
	password?: boolean;
	/** The constructor's form of `enabled: false`. */
	disabled?: boolean;
	/** Focus selects the whole value. */
	selectAllOnFocus?: boolean;
	validator?: TextValidator | null;
	/** A user edit, with the new value already applied. Never fired by setting `value`. */
	onChange?: ((value: string) => void) | null;
	/** Enter, with the current value. */
	onSubmit?: ((value: string) => void) | null;
	/** R11.10: height (unless `height` is given) and text size together. */
	size?: ControlSize;
	style?: StyleObject;
}

/** A selection as code point offsets, `start <= end`; equal when it is only the caret. */
export interface TextRange {
	start: number;
	end: number;
}

const DEFAULT_WIDTH = 200;
const MASK = '•';
const CARET_WIDTH = tokens.borderWidth.bw_thick;

/** R11.14: what a text field renders. Its text is left-aligned and unstyled beyond its face and size. */
const TEXT_INPUT_STYLE: StyleAcceptance = {
	component: 'TextInput',
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

/** C0 and C1 controls and DEL: what a paste strips (R12.10). */
function isControl(codePoint: number): boolean {
	return codePoint < 0x20 || (codePoint >= 0x7F && codePoint <= 0x9F);
}

/**
 * R12.10's single-line text field. The value is edited as code points; the
 * caret and selection are offsets into them, placed from the advances the
 * draw API's own layout reports (R2.14), so the caret sits where the glyphs
 * are drawn.
 *
 * - A press places the caret at the nearest glyph boundary and captures the
 *   pointer; dragging selects, Shift with a press extends.
 * - Arrows, Home and End move the caret, with Shift extending the selection;
 *   Backspace and Delete remove the selection first.
 * - Cmd or Ctrl with A, C, X and V select all, copy, cut and paste through
 *   the mount context's clipboard; a paste drops control characters.
 * - Enter fires `onSubmit`. Escape is left alone so a dialog around the
 *   field hears it, and so are Up and Down, which a NumberInput steps on;
 *   the dispatcher still keeps both from hotkeys (R9.15).
 * - The caret blinks every `caret_blink` from the context clock, restarting
 *   on every edit, caret move, and focus gain.
 * - The text scrolls horizontally to keep the caret in view, back to zero
 *   when it fits, and is clipped to the padded content box (R4.5).
 *
 * The field draws its text itself rather than through a Text part: it clips
 * and scrolls the run, and places the caret and selection from the same
 * measurement. Its editing state is R11.12 layer 4's `active` (the border
 * lifts to the accent) while it holds focus.
 */
export class TextInput extends Component {
	/** A user edit; never fired by setting `value`. */
	public onChange: ((value: string) => void) | null;
	public onSubmit: ((value: string) => void) | null;
	public validator: TextValidator | null;
	public selectAllOnFocus: boolean;

	private codePoints: string[];
	private placeholderText: string;
	private limit: number;
	private masked: boolean;
	private caret = 0;
	private selectionAnchor = 0;
	private scrollX = 0;
	/** The run's width as of the last scroll update, for `cullInk`. */
	private inkRunWidth = 0;
	private blinkEpoch = 0;
	/** A press is selecting: set on the press, cleared on its release. */
	private dragging = false;
	/** Where the press landed, and whether the drag has left it yet. */
	private pressIndex = 0;
	private pressMoved = false;
	private fieldSize: ControlSize;
	private styleObject: StyleObject;
	private layers: LookLayers;
	private padding: Sides;
	private readonly transition: LookTransition;
	private heightFollowsSize: boolean;
	private trailingRoom = 0;
	/** The last measurement, keyed by what was measured. */
	private measuredKey = '';
	private measuredAdvances: readonly number[] = [];
	private measuredLineHeight = 0;

	constructor({
		value = '',
		placeholder = '',
		maxLength,
		password = false,
		disabled = false,
		selectAllOnFocus = false,
		validator = null,
		onChange = null,
		onSubmit = null,
		size = 'md',
		style = {},
		...options
	}: TextInputOptions = {}) {
		super({
			focusable: true,
			...(disabled ? { enabled: false } : {}),
			...options,
			width: options.width ?? DEFAULT_WIDTH,
			height: options.height ?? CONTROL_SIZES[size].height,
		});
		this.componentType = 'TextInput';
		validateStyle(style, TEXT_INPUT_STYLE);
		this.heightFollowsSize = options.height === undefined;
		this.fieldSize = size;
		this.styleObject = style;
		this.layers = fieldLayers(style);
		this.padding = this.resolvePadding();
		if (style.opacity !== undefined) this.opacity = style.opacity;
		this.limit = maxLength !== undefined && maxLength >= 0 ? Math.floor(maxLength) : Number.POSITIVE_INFINITY;
		this.codePoints = [...value].slice(0, this.limit);
		this.caret = this.selectionAnchor = this.codePoints.length;
		this.placeholderText = placeholder;
		this.masked = password;
		this.selectAllOnFocus = selectAllOnFocus;
		this.validator = validator;
		this.onChange = onChange;
		this.onSubmit = onSubmit;
		this.transition = new LookTransition({ owner: this, look: this.targetLook });
	}

	/** R8.29: the field is one target; it draws everything inside it itself. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	/** Presses land here whether or not a caller set a callback (the lint's rules 6 and 7). */
	public get handlesPointer(): boolean {
		return true;
	}

	/** R9.15: while focused, printable keys are this field's, never a hotkey's. */
	public get acceptsText(): boolean {
		return true;
	}

	// -- value ----------------------------------------------------------------

	public get value(): string {
		return this.codePoints.join('');
	}

	/** Programmatic: truncated to `maxLength`, caret to the end, never fires `onChange`. */
	public set value(value: string) {
		const next = [...value].slice(0, this.limit);
		if (next.join('') === this.value) return;
		this.codePoints = next;
		this.caret = this.selectionAnchor = next.length;
		this.afterCaretMove();
	}

	/** What the field draws: the value, or a bullet per code point for a password. */
	public get displayText(): string {
		return this.masked ? MASK.repeat(this.codePoints.length) : this.value;
	}

	public get placeholder(): string {
		return this.placeholderText;
	}

	public set placeholder(placeholder: string) {
		this.placeholderText = placeholder;
	}

	public get maxLength(): number {
		return this.limit;
	}

	/** A shorter limit truncates the value without firing `onChange`. */
	public set maxLength(maxLength: number) {
		this.limit = maxLength >= 0 ? Math.floor(maxLength) : Number.POSITIVE_INFINITY;
		if (this.codePoints.length > this.limit) {
			this.codePoints = this.codePoints.slice(0, this.limit);
			this.caret = Math.min(this.caret, this.limit);
			this.selectionAnchor = Math.min(this.selectionAnchor, this.limit);
			this.afterCaretMove();
		}
	}

	public get password(): boolean {
		return this.masked;
	}

	public set password(password: boolean) {
		this.masked = password;
		this.afterCaretMove();
	}

	// -- caret and selection --------------------------------------------------

	/** The caret's code point offset: the moving end of the selection. */
	public get caretIndex(): number {
		return this.caret;
	}

	public get selection(): TextRange {
		return { start: Math.min(this.selectionAnchor, this.caret), end: Math.max(this.selectionAnchor, this.caret) };
	}

	/** Selects `start` to `end` with the caret at `end`, clamped to the value. */
	public select(start: number, end: number = start): void {
		const length = this.codePoints.length;
		this.selectionAnchor = clamp(Math.round(start), 0, length);
		this.caret = clamp(Math.round(end), 0, length);
		this.afterCaretMove();
	}

	public selectAll(): void {
		this.select(0, this.codePoints.length);
	}

	/** The selected text, or '' when the selection is only the caret. */
	public get selectedText(): string {
		const { start, end } = this.selection;
		return this.codePoints.slice(start, end).join('');
	}

	/** How far the text is scrolled left to keep the caret in view, in logical pixels. */
	public get scrollOffset(): number {
		return this.scrollX;
	}

	/** Whether the caret is drawn this frame: focused, enabled, and in the on half of its blink. */
	public get caretVisible(): boolean {
		if (!this.focused || !this.effectivelyEnabled) return false;
		const now = this.context?.clock.now ?? 0;
		return Math.floor((now - this.blinkEpoch) / tokens.control.caret_blink) % 2 === 0;
	}

	/** The caret's x in the field's box: the pen after the code point before it, less the scroll. */
	public get caretX(): number {
		return this.padding.left + this.boundaryX(this.caret) - this.scrollX;
	}

	/** The padded content box the text is drawn and clipped in. */
	public get contentBox(): Rect {
		const { top, right, bottom, left } = this.padding;
		return {
			x: left,
			y: top,
			width: Math.max(0, this.width - left - right),
			height: Math.max(0, this.height - top - bottom),
		};
	}

	// -- style ----------------------------------------------------------------

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
		validateStyle(style, TEXT_INPUT_STYLE);
		const previous = this.styleObject;
		this.styleObject = style;
		if (style.opacity !== undefined) this.opacity = style.opacity;
		else if (previous.opacity !== undefined) this.opacity = 1;
		this.restyle();
	}

	/** From here the height is the caller's, and a new `size` leaves it alone. */
	public setSize(width: number, height: number): this {
		this.heightFollowsSize = false;
		super.setSize(width, height);
		return this;
	}

	/** The ring is layer 6 of this component's own look (R11.12), not the render walk's. */
	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	/** R8.8: the focus ring and the style's shadow; the text never leaves the box. */
	public get inkExtent(): number {
		return layersInkExtent(this.layers);
	}

	public get look(): Look {
		return this.transition.look;
	}

	public get resolvedColors(): ResolvedColors {
		const look = this.transition.look;
		return { fill: look.fill, text: look.text, border: look.border };
	}

	// -- events ---------------------------------------------------------------

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'focus':
				this.active = true;
				if (this.selectAllOnFocus) this.selectAll();
				this.restartBlink();
				return;
			case 'blur':
				this.active = false;
				this.dragging = false;
				return;
			case 'pointerdown':
				this.pointerDown(event);
				return;
			case 'pointermove':
				if (this.dragging) this.dragTo(event);
				return;
			case 'pointerup':
			case 'pointercancel':
			case 'lostpointercapture':
				this.dragging = false;
				return;
			case 'keydown':
				if (this.focused && this.effectivelyEnabled && this.handleKey(event)) event.consume();
				return;
		}
	}

	protected onMount(_context: MountContext): void {
		this.transition.moveTo(this.targetLook, null);
		this.updateScroll();
	}

	/** Unmount drops focus without a `blur` (R9.21), so the editing state goes here. */
	protected onUnmount(): void {
		this.active = false;
		this.dragging = false;
		this.transition.moveTo(this.targetLook, null);
	}

	protected onStateChange(): void {
		this.transition.moveTo(this.targetLook, this.context?.animator ?? null);
	}

	protected onResized(): void {
		this.updateScroll();
	}

	/** Blinking asks for frames only while focused (R8.17). */
	public update(_dt: number): void {
		if (this.focused) this.requestUpdate();
	}

	private pointerDown(event: UiPointerEvent): void {
		if (event.button !== 0 || !this.effectivelyEnabled) return;
		const local = event.local;
		if (!local) return;
		const index = this.indexAt(local.x);
		this.dragging = true;
		this.pressIndex = index;
		this.pressMoved = false;
		event.capturePointer();
		if (event.modifiers.shift && this.focused) this.select(this.selectionAnchor, index);
		else this.select(index, index);
	}

	/** Once the drag leaves the pressed boundary it selects from there, replacing a select-all from focus. */
	private dragTo(event: UiPointerEvent): void {
		const local = event.local;
		if (!local) return;
		const index = this.indexAt(local.x);
		if (!this.pressMoved && index === this.pressIndex) return;
		this.pressMoved = true;
		this.select(this.pressIndex, index);
	}

	/** One key; true when the field used it. */
	private handleKey(event: UiKeyEvent): boolean {
		const { key, modifiers } = event;
		const command = modifiers.ctrl || modifiers.meta;
		const extend = modifiers.shift;
		if (command) {
			switch (key.toLowerCase()) {
				case 'a':
					this.selectAll();
					return true;
				case 'c':
					this.copy();
					return true;
				case 'x':
					this.cut();
					return true;
				case 'v':
					void this.paste();
					return true;
				case 'arrowleft':
					this.moveCaret(0, extend);
					return true;
				case 'arrowright':
					this.moveCaret(this.codePoints.length, extend);
					return true;
				default:
					return false;
			}
		}
		const { start, end } = this.selection;
		switch (key) {
			case 'ArrowLeft':
				this.moveCaret(extend || start === end ? this.caret - 1 : start, extend);
				return true;
			case 'ArrowRight':
				this.moveCaret(extend || start === end ? this.caret + 1 : end, extend);
				return true;
			case 'Home':
				this.moveCaret(0, extend);
				return true;
			case 'End':
				this.moveCaret(this.codePoints.length, extend);
				return true;
			case 'Backspace':
				if (start !== end) this.replace(start, end, '');
				else if (start > 0) this.replace(start - 1, start, '');
				return true;
			case 'Delete':
				if (start !== end) this.replace(start, end, '');
				else if (end < this.codePoints.length) this.replace(end, end + 1, '');
				return true;
			case 'Enter':
				this.onSubmit?.(this.value);
				return true;
			case 'Escape':
			case 'ArrowUp':
			case 'ArrowDown':
				return false;
		}
		if ([...key].length !== 1) return false;
		this.replace(start, end, key);
		return true;
	}

	private moveCaret(index: number, extend: boolean): void {
		const target = clamp(index, 0, this.codePoints.length);
		this.select(extend ? this.selectionAnchor : target, target);
	}

	// -- editing --------------------------------------------------------------

	/** Copies the selection; a password field copies nothing. */
	public copy(): void {
		const text = this.selectedText;
		if (this.masked || text === '') return;
		void this.context?.clipboard.writeText(text);
	}

	public cut(): void {
		const text = this.selectedText;
		if (this.masked || text === '') return;
		void this.context?.clipboard.writeText(text);
		const { start, end } = this.selection;
		this.replace(start, end, '');
	}

	/**
	 * Reads the clipboard and inserts it over the selection. The read is
	 * asynchronous; the text lands when it resolves, if the field is still
	 * mounted and enabled.
	 */
	public async paste(): Promise<void> {
		const clipboard = this.context?.clipboard;
		if (!clipboard) return;
		const text = await clipboard.readText();
		if (!this.isMounted || !this.effectivelyEnabled) return;
		const { start, end } = this.selection;
		this.replace(start, end, text);
	}

	/**
	 * Replaces `start` to `end` with `text` as a user edit: control characters
	 * go, the rest go in one code point at a time while `maxLength` has room
	 * and the validator agrees. Nothing changes when nothing would; a typed
	 * character the validator refuses leaves the selection where it was.
	 */
	private replace(start: number, end: number, text: string): void {
		const before = this.codePoints.slice(0, start);
		const after = this.codePoints.slice(end);
		const room = this.limit - before.length - after.length;
		const inserted: string[] = [];
		for (const codePoint of text) {
			if (inserted.length >= room) break;
			if (isControl(codePoint.codePointAt(0) ?? 0)) continue;
			const candidate = [...before, ...inserted, codePoint, ...after].join('');
			if (this.validator && !this.validator(candidate, codePoint)) continue;
			inserted.push(codePoint);
		}
		if (inserted.length === 0) {
			if (text !== '' || start === end) return;
			const candidate = [...before, ...after].join('');
			if (this.validator && !this.validator(candidate, '')) return;
		}
		this.codePoints = [...before, ...inserted, ...after];
		const caret = before.length + inserted.length;
		this.selectionAnchor = this.caret = caret;
		this.afterCaretMove();
		this.onChange?.(this.value);
	}

	// -- geometry -------------------------------------------------------------

	/** The pen x of the boundary before code point `index`, from the text's left edge. */
	private boundaryX(index: number): number {
		if (index <= 0) return 0;
		const advances = this.advances();
		if (advances.length === 0) return 0;
		return advances[Math.min(index, advances.length) - 1];
	}

	/** The boundary nearest to `localX` in the field's box. */
	private indexAt(localX: number): number {
		const x = localX - this.padding.left + this.scrollX;
		const count = this.codePoints.length;
		let best = 0;
		let bestDistance = Math.abs(x);
		for (let index = 1; index <= count; index++) {
			const distance = Math.abs(x - this.boundaryX(index));
			if (distance < bestDistance) {
				best = index;
				bestDistance = distance;
			}
		}
		return best;
	}

	/** Keeps the caret inside the content box; zero whenever the text fits. */
	private updateScroll(): void {
		const visible = this.contentBox.width;
		const textWidth = this.boundaryX(this.codePoints.length);
		let scroll = 0;
		if (textWidth + CARET_WIDTH > visible) {
			const caret = this.boundaryX(this.caret);
			scroll = this.scrollX;
			if (caret - scroll < 0) scroll = caret;
			else if (caret - scroll > visible - CARET_WIDTH) scroll = caret - visible + CARET_WIDTH;
			scroll = clamp(scroll, 0, textWidth + CARET_WIDTH - visible);
		}
		const runWidth = textWidth;
		if (scroll === this.scrollX && runWidth === this.inkRunWidth) return;
		this.scrollX = scroll;
		this.inkRunWidth = runWidth;
		// The run reaches past the box while scrolled; the cull bound follows it.
		this.invalidateInk();
	}

	/**
	 * R4.2a: what this field draws, clipped or not. The whole run is drawn,
	 * shifted left by the scroll and cut by the content box's clip, so the
	 * bound the subtree cull and the ink audit trust spans the run, with a
	 * glyph's slack for bearings either side.
	 */
	protected get cullInk(): Rect {
		const ink = this.inkRect;
		const slack = this.textStyle().fontSize;
		const left = Math.min(ink.x, this.padding.left - this.scrollX - slack);
		const right = Math.max(ink.x + ink.width, this.padding.left - this.scrollX + this.inkRunWidth + slack);
		return { x: left, y: ink.y, width: right - left, height: ink.height };
	}

	private afterCaretMove(): void {
		this.updateScroll();
		this.restartBlink();
	}

	private restartBlink(): void {
		this.blinkEpoch = this.context?.clock.now ?? 0;
		if (this.focused) this.requestUpdate();
	}

	/**
	 * The draw API's advances for the display text (R2.14), cached until the
	 * text or its face changes. Empty when nothing can measure (unmounted, or
	 * a backend without the face), which puts every boundary at the left edge.
	 */
	private advances(): readonly number[] {
		this.measureText();
		return this.measuredAdvances;
	}

	/** The line box's height, for the caret and the selection. */
	private get lineHeight(): number {
		this.measureText();
		return this.measuredLineHeight;
	}

	private measureText(): void {
		const draw = this.context?.draw;
		const { role, fontSize, letterSpacing } = this.textStyle();
		const text = this.displayText;
		const key = `${role}|${fontSize}|${letterSpacing}|${text}`;
		if (key === this.measuredKey) return;
		if (!draw || !draw.canMeasureText(role)) {
			this.measuredAdvances = [];
			this.measuredLineHeight = fontSize;
			return;
		}
		this.measuredKey = key;
		const metrics = draw.measureText({ text: text === '' ? ' ' : text, font: role, size: fontSize, letterSpacing, wrap: 'none' });
		this.measuredAdvances = text === '' ? [] : metrics.advances;
		this.measuredLineHeight = metrics.height / Math.max(1, metrics.lines);
	}

	// -- render ---------------------------------------------------------------

	public render(draw: DrawApi): void {
		const look = this.transition.look;
		drawControlBox(draw, { id: this.id ?? undefined, width: this.width, height: this.height, look });

		const box = this.contentBox;
		if (box.width <= 0 || box.height <= 0) return;
		const { role, fontSize, letterSpacing } = this.textStyle();
		const lineHeight = this.lineHeight;
		const lineTop = box.y + (box.height - lineHeight) / 2;
		const text = this.displayText;
		draw.pushClip(box);
		const { start, end } = this.selection;
		if (this.focused && start !== end) {
			const left = box.x + this.boundaryX(start) - this.scrollX;
			const right = box.x + this.boundaryX(end) - this.scrollX;
			draw.drawRect({ rect: { x: left, y: lineTop, width: right - left, height: lineHeight }, fill: tokens.color.bg_selection });
		}
		if (text === '') {
			if (this.placeholderText !== '') {
				draw.drawText({
					text: this.placeholderText,
					box,
					font: role,
					size: fontSize,
					letterSpacing,
					color: this.effectivelyEnabled ? tokens.color.text_faint : tokens.color.text_disabled,
					align: 'left',
					verticalAlign: 'middle',
					wrap: 'none',
				});
			}
		} else {
			const width = Math.max(box.width + this.scrollX, this.boundaryX(this.codePoints.length));
			draw.drawText({
				text,
				box: { x: box.x - this.scrollX, y: box.y, width, height: box.height },
				font: role,
				size: fontSize,
				letterSpacing,
				color: look.text,
				align: 'left',
				verticalAlign: 'middle',
				wrap: 'none',
			});
		}
		if (this.caretVisible) {
			draw.drawRect({ rect: { x: this.caretX, y: lineTop, width: CARET_WIDTH, height: lineHeight }, fill: look.text });
		}
		draw.popClip();
	}

	// -- internals ------------------------------------------------------------

	private get targetLook(): Look {
		return resolveLook(this.layers, this.stateFlags);
	}

	private restyle(): void {
		this.layers = fieldLayers(this.styleObject);
		this.padding = this.resolvePadding();
		this.measuredKey = '';
		this.onStateChange();
		this.updateScroll();
		this.invalidateLayout();
	}

	private textStyle(): { role: FontRole; fontSize: number; letterSpacing: number } {
		const style = this.styleObject;
		let role: FontRole = style.fontRole ?? (style.fontFamily !== undefined ? fontRoleOfFamily(style.fontFamily, 'TextInput') : 'body');
		if (style.fontWeight !== undefined) role = resolveFontRole({ family: role, weight: style.fontWeight });
		return {
			role,
			fontSize: style.fontSize !== undefined ? resolveLength(style.fontSize, 'fontSize') : CONTROL_SIZES[this.fieldSize].fontSize,
			letterSpacing: style.letterSpacing !== undefined ? resolveLetterSpacing(style.letterSpacing) : 0,
		};
	}

	/** R11.9: 12 px horizontal inset inside fields, plus `trailingInset` on the right. */
	private resolvePadding(): Sides {
		const inset = tokens.control.inset_field;
		const fallback = { top: 0, right: inset, bottom: 0, left: inset };
		const padding = this.styleObject.padding !== undefined ? resolvePadding(this.styleObject.padding, fallback) : fallback;
		return { ...padding, right: padding.right + this.trailingRoom };
	}

	/** Keeps `room` clear at the right end, beyond the padding, for a composite's own parts. */
	protected reserveTrailing(room: number): void {
		this.trailingRoom = room;
		this.padding = this.resolvePadding();
		this.updateScroll();
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
