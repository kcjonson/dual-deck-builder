import type { ComponentOptions, ResolvedColors } from '../components/Component';
import { drawIcon } from '../components/Icon';
import type { Axis, Size, SizeMode } from '../components/layoutTypes';
import { Text } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import type { Rect } from '../draw/geometry';
import type { UiActionEvent, UiPointerEvent } from '../input/events';
import { Look, LookLayers, glowShadow, layersInkExtent, resolveLook } from '../style/look';
import { LookTransition } from '../style/LookTransition';
import { CONTROL_SIZES, ControlSize, markLayers } from '../style/variants';
import { tokens } from '../theme/tokens';
import { Pressable } from './Pressable';

/** A user change: the new value, already applied, and the press or key that made it. */
export type CheckedChangeCallback = (checked: boolean, event: UiPointerEvent | UiActionEvent) => void;

export interface CheckableOptions extends Omit<ComponentOptions, 'style'> {
	label?: string;
	checked?: boolean;
	/** The constructor's form of `enabled: false`. */
	disabled?: boolean;
	/** R11.10: row height, label size, and mark size together. */
	size?: ControlSize;
	onChange?: CheckedChangeCallback;
}

export interface CheckboxOptions extends CheckableOptions {
	/** Neither checked nor unchecked (a parent of mixed children); a toggle makes it checked. */
	indeterminate?: boolean;
}

/** The gap between the mark and the label. */
const LABEL_GAP = tokens.space.space_2;

/**
 * What Checkbox, Toggle, and a radio item share (R12.9, R12.35): a mark and
 * a label in one row, the whole row a single hit area and focus target
 * (`Pressable`), `checked` kept apart from R11.11's `selected` (which a
 * focus group owns, so a checklist in a group is not corrupted by it) and
 * reported in the snapshot's state, and controlled-value semantics: setting `checked` never fires
 * `onChange`; a user change fires it once, with the value already applied.
 * `click` and `activate` from Space press it; Enter does not (it is left
 * for a dialog's default action).
 *
 * The row hugs its content unless given a width: the mark, a gap, and the
 * label's measured width. The ring is the render walk's, around the row.
 */
export abstract class Checkable extends Pressable {
	/** Fired by user changes only. */
	public onChange: CheckedChangeCallback | null = null;

	protected readonly label: Text;
	private isChecked: boolean;
	private controlSize: ControlSize;
	private layers: LookLayers;
	private readonly transition: LookTransition;

	constructor({ label = '', checked = false, disabled = false, size = 'md', onChange, ...options }: CheckableOptions) {
		super({
			focusable: true,
			...(disabled ? { enabled: false } : {}),
			...options,
			height: options.height ?? CONTROL_SIZES[size].height,
		});
		this.controlSize = size;
		this.isChecked = checked;
		this.layers = markLayers({ on: checked });
		if (onChange) this.onChange = onChange;

		this.label = new Text({
			text: label,
			style: { fontRole: 'body', fontSize: CONTROL_SIZES[size].fontSize },
			verticalAlign: 'middle',
			wrap: 'none',
		});
		this.addPart(this.label);
		if (!label) this.label.visible = false;

		this.transition = new LookTransition({ owner: this, look: this.targetLook, onChange: () => this.followState() });
		this.followState();
		this.placeLabel();
	}

	/** Hugs its content on an axis it was given no size on. */
	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'hug';
	}

	public get checked(): boolean {
		return this.isChecked;
	}

	/** Programmatic: never fires `onChange`. */
	public set checked(checked: boolean) {
		if (checked === this.isChecked) return;
		this.isChecked = checked;
		this.onStateChange();
	}

	/** The snapshot's `checked`: `mixed` for an indeterminate checkbox. */
	public get checkedState(): boolean | 'mixed' {
		return this.isChecked;
	}

	/** The value is the control's own; a focus group's selection leaves it alone (R12.34). */
	public get takesGroupSelection(): boolean {
		return false;
	}

	public get size(): ControlSize {
		return this.controlSize;
	}

	public get labelText(): string {
		return this.label.text;
	}

	public set labelText(text: string) {
		this.label.text = text;
		this.label.visible = text !== '';
	}

	public get look(): Look {
		return this.transition.look;
	}

	public get inkExtent(): number {
		return layersInkExtent(this.layers);
	}

	public get resolvedColors(): ResolvedColors {
		const look = this.transition.look;
		return { fill: look.fill, border: look.border, text: look.text };
	}

	/** The mark's box, before it is centred on the row's height. */
	protected abstract get markSize(): { width: number; height: number };

	/** Draws the mark in `rect` with `look`, whose `text` is the check, dot, or thumb colour. */
	protected abstract drawMark(draw: DrawApi, rect: Rect, look: Look): void;

	/** Whether the mark shows as on: `checked`, or a checkbox's indeterminate state. */
	protected get markOn(): boolean {
		return this.isChecked;
	}

	/** R12.9: Space toggles, Enter does not. */
	protected acceptsActivation(event: UiActionEvent): boolean {
		return event.key !== 'Enter';
	}

	/** The user's change: a checkbox or toggle flips; a radio item overrides this to only turn on. */
	protected onPressed(event: UiPointerEvent | UiActionEvent): void {
		this.commit(!this.isChecked, event);
	}

	/** Applies a user change and reports it once, after it is applied. */
	protected commit(checked: boolean, event: UiPointerEvent | UiActionEvent): void {
		this.applyUserChange(checked);
		this.onChange?.(checked, event);
	}

	/** Sets the value as a user change does, before `onChange` hears it. */
	protected applyUserChange(checked: boolean): void {
		this.checked = checked;
	}

	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
		const content = this.hugWidth();
		return {
			width: definite === 'width' ? availableWidth : this.widthMode === 'fixed' ? this.width : content,
			height: definite === 'height' ? availableHeight : this.height,
		};
	}

	/** A hugging row outside a stack sizes itself; inside one, the stack assigns it (R10.5). */
	protected layoutChildren(): void {
		if (this.widthMode === 'hug' && !this.parent?.sizesChildren) this.resizeInLayout(this.hugWidth(), this.height);
		this.placeLabel();
	}

	protected onMount(): void {
		this.transition.moveTo(this.targetLook, null);
	}

	protected onUnmount(): void {
		super.onUnmount();
		this.transition.moveTo(this.targetLook, null);
	}

	protected onStateChange(): void {
		super.onStateChange();
		// `checked` is set in the constructor before the transition exists.
		if (!this.transition) return;
		this.layers = markLayers({ on: this.markOn });
		this.transition.moveTo(this.targetLook, this.context?.animator ?? null);
		this.followState();
	}

	public render(draw: DrawApi): void {
		const { width, height } = this.markSize;
		this.drawMark(draw, { x: 0, y: Math.round((this.height - height) / 2), width, height }, this.transition.look);
	}

	/** The mark's box with the look's fill, border, and any hover glow. */
	protected drawMarkBox(draw: DrawApi, rect: Rect, look: Look, radius: number): void {
		draw.drawRect({
			id: this.id ?? undefined,
			rect,
			fill: look.fill,
			radius: radius > 0 ? radius : undefined,
			border: look.borderWidth > 0 ? { color: look.border, width: look.borderWidth } : undefined,
			shadow: look.glow[3] > 0 ? glowShadow(look.glow) : undefined,
		});
	}

	private get targetLook(): Look {
		return resolveLook(this.layers, { ...this.stateFlags, selected: this.markOn });
	}

	/** The label is the text colour, or the disabled one. */
	private followState(): void {
		const color = this.effectivelyEnabled ? tokens.color.text : tokens.color.text_disabled;
		this.label.color = [...color] as [number, number, number, number];
	}

	private hugWidth(): number {
		const mark = this.markSize.width;
		return this.label.visible ? mark + LABEL_GAP + this.label.width : mark;
	}

	private placeLabel(): void {
		this.label.height = this.height;
		this.label.setPosition(this.markSize.width + LABEL_GAP, 0);
	}
}

/**
 * R12.9's checkbox: a square well with a check when checked and a bar when
 * indeterminate. An indeterminate checkbox becomes checked on a toggle; a
 * programmatic `checked` clears `indeterminate`.
 */
export class Checkbox extends Checkable {
	private isIndeterminate: boolean;

	constructor({ indeterminate = false, ...options }: CheckboxOptions = {}) {
		super(options);
		this.componentType = 'Checkbox';
		this.isIndeterminate = indeterminate;
		this.onStateChange();
	}

	public get checked(): boolean {
		return super.checked;
	}

	public set checked(checked: boolean) {
		const changed = this.isIndeterminate;
		this.isIndeterminate = false;
		super.checked = checked;
		if (changed) this.onStateChange();
	}

	public get checkedState(): boolean | 'mixed' {
		return this.isIndeterminate ? 'mixed' : this.checked;
	}

	public get indeterminate(): boolean {
		return this.isIndeterminate;
	}

	/** Programmatic, like `checked`: never fires `onChange`. */
	public set indeterminate(indeterminate: boolean) {
		if (indeterminate === this.isIndeterminate) return;
		this.isIndeterminate = indeterminate;
		this.onStateChange();
	}

	protected get markSize(): { width: number; height: number } {
		const size = CONTROL_SIZES[this.size].iconSize;
		return { width: size, height: size };
	}

	protected get markOn(): boolean {
		return this.checked || this.isIndeterminate;
	}

	/** Indeterminate becomes checked; otherwise it flips (R12.9). */
	protected onPressed(event: UiPointerEvent | UiActionEvent): void {
		this.commit(this.isIndeterminate ? true : !this.checked, event);
	}

	protected applyUserChange(checked: boolean): void {
		this.isIndeterminate = false;
		super.applyUserChange(checked);
		this.onStateChange();
	}

	protected drawMark(draw: DrawApi, rect: Rect, look: Look): void {
		this.drawMarkBox(draw, rect, look, look.radius);
		if (!this.markOn) return;
		drawIcon(draw, { glyph: this.isIndeterminate ? 'remove' : 'check', size: rect.height, tint: look.text, box: rect });
	}
}
