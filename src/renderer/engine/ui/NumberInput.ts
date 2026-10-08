import { Component, ComponentOptions, Cursor, PointerEvents } from '../components/Component';
import { drawIcon } from '../components/Icon';
import type { DrawApi } from '../draw/DrawApi';
import type { AnyUiEvent, UiPointerEvent } from '../input/events';
import { CONTROL_SIZES, ControlSize } from '../style/variants';
import { tokens } from '../theme/tokens';
import { MAX_DECIMALS, decimalsOf } from './stepGrid';
import { TextInput, TextInputOptions } from './TextInput';

export interface NumberInputOptions extends Omit<ComponentOptions, 'style'> {
	value?: number;
	min?: number;
	max?: number;
	/** What an arrow, a stepper press, or a wheel notch adds; positive. */
	step?: number;
	/** Decimal places kept and shown, at most 100; defaults to the step's. */
	precision?: number;
	placeholder?: string;
	disabled?: boolean;
	/** R11.10: height (unless `height` is given), text size, and chevron size together. */
	size?: ControlSize;
	/** A user change, with the new value already applied. Never fired by setting `value`. */
	onChange?: ((value: number) => void) | null;
}

const DEFAULT_WIDTH = 120;

/** The stepper column: the size's icon with `space_1` either side. */
function stepperWidth(size: ControlSize): number {
	return CONTROL_SIZES[size].iconSize + tokens.space.space_1 * 2;
}

/** The text field inside a NumberInput: a TextInput that keeps room for the steppers. */
class NumberField extends TextInput {
	constructor({ stepperRoom, ...options }: TextInputOptions & { stepperRoom: number }) {
		super(options);
		this.reserveTrailing(stepperRoom);
	}
}

type StepDirection = 1 | -1;

/**
 * The increment and decrement buttons at the right end of the field: two
 * halves of one column, a chevron in each. A press steps once and keeps
 * focus in the field (R9.23's `preventFocus`, then the field focused as a
 * pointer would), so typing can go on after it.
 */
class NumberStepper extends Component {
	private readonly owner: NumberInput;
	private hoveredHalf: StepDirection | null = null;
	private pressedHalf: StepDirection | null = null;

	constructor({ owner }: { owner: NumberInput }) {
		super({});
		this.componentType = 'NumberStepper';
		this.owner = owner;
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	/** The hand over a half that can step; the arrow over one at its limit. */
	protected get defaultCursor(): Cursor | null {
		return this.hoveredHalf === null || this.owner.canStep(this.hoveredHalf) ? 'pointer' : 'default';
	}

	public get handlesPointer(): boolean {
		return true;
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'pointermove':
			case 'pointerenter':
				this.hoveredHalf = this.halfAt(event);
				return;
			case 'pointerleave':
				this.hoveredHalf = null;
				return;
			case 'pointerdown': {
				if (event.button !== 0 || !this.effectivelyEnabled) return;
				const half = this.halfAt(event);
				if (half === null) return;
				event.preventFocus();
				event.consume();
				event.capturePointer();
				this.pressedHalf = half;
				this.owner.stepFromUser(half);
				this.owner.focusField();
				return;
			}
			case 'pointerup':
			case 'pointercancel':
			case 'lostpointercapture':
				this.pressedHalf = null;
				return;
		}
	}

	public render(draw: DrawApi): void {
		const half = this.height / 2;
		const { color } = tokens;
		draw.drawRect({ rect: { x: 0, y: tokens.space.space_1, width: tokens.borderWidth.bw, height: this.height - tokens.space.space_1 * 2 }, fill: color.line_edge });
		for (const direction of [1, -1] as const) {
			const top = direction === 1 ? 0 : half;
			const box = { x: 0, y: top, width: this.width, height: half };
			const enabled = this.effectivelyEnabled && this.owner.canStep(direction);
			if (enabled && this.pressedHalf === direction) draw.drawRect({ rect: box, fill: color.bg_pressed });
			else if (enabled && this.hoveredHalf === direction && this.hovered) draw.drawRect({ rect: box, fill: color.bg_hover });
			drawIcon(draw, {
				glyph: direction === 1 ? 'expand_less' : 'expand_more',
				size: CONTROL_SIZES[this.owner.size].iconSize,
				tint: enabled ? (this.hoveredHalf === direction && this.hovered ? color.text : color.text_dim) : color.text_disabled,
				box,
			});
		}
	}

	private halfAt(event: UiPointerEvent): StepDirection | null {
		const local = event.local;
		if (!local) return null;
		return local.y < this.height / 2 ? 1 : -1;
	}
}

/**
 * R12.36's stepper: a number in a text field with increment and decrement
 * buttons. Up and Down step while the field is focused, and so does the
 * wheel over it; typed text is committed on blur or Enter, clamped to
 * `min` and `max` and rounded to `precision`, and text that is not a number
 * goes back to the value. The field accepts only what could become a number
 * (a sign when `min` is negative, a point when `precision` allows one).
 *
 * `value` set programmatically is clamped and rounded without `onChange`; a
 * user change fires it once with the value applied, and not at all when the
 * value did not move. The field is the focus target and a single Tab stop.
 */
export class NumberInput extends Component {
	public onChange: ((value: number) => void) | null;

	private readonly field: NumberField;
	private readonly stepper: NumberStepper;
	private current: number;
	private lower: number;
	private upper: number;
	private increment: number;
	private places: number;
	private readonly fieldSize: ControlSize;

	constructor({
		value = 0,
		min = Number.NEGATIVE_INFINITY,
		max = Number.POSITIVE_INFINITY,
		step = 1,
		precision,
		placeholder = '',
		disabled = false,
		size = 'md',
		onChange = null,
		...options
	}: NumberInputOptions = {}) {
		super({
			...(disabled ? { enabled: false } : {}),
			...options,
			width: options.width ?? DEFAULT_WIDTH,
			height: options.height ?? CONTROL_SIZES[size].height,
		});
		this.componentType = 'NumberInput';
		if (!(step > 0)) throw new Error(`NumberInput: step must be positive, got ${step}`);
		if (min > max) throw new Error(`NumberInput: min ${min} is above max ${max}`);
		this.fieldSize = size;
		this.lower = min;
		this.upper = max;
		this.increment = step;
		this.places = Math.min(MAX_DECIMALS, precision ?? decimalsOf(step));
		this.onChange = onChange;
		this.current = this.normalise(value);

		this.field = new NumberField({
			id: options.id ? `${options.id}_field` : undefined,
			value: this.format(this.current),
			placeholder,
			size,
			stepperRoom: stepperWidth(size),
			validator: (next) => this.accepts(next),
			onSubmit: () => this.commitText(),
		});
		this.field.onBlur = () => this.commitText();
		this.addPart(this.field);

		this.stepper = new NumberStepper({ owner: this });
		this.addPart(this.stepper);
		this.placeParts();
	}

	/** Presses go to the field or the steppers, never to the frame around them. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'passthrough';
	}

	public get value(): number {
		return this.current;
	}

	/** Programmatic: clamped and rounded, never fires `onChange`. */
	public set value(value: number) {
		this.current = this.normalise(value);
		this.field.value = this.format(this.current);
	}

	public get min(): number {
		return this.lower;
	}

	public set min(min: number) {
		this.lower = min;
		this.value = this.current;
	}

	public get max(): number {
		return this.upper;
	}

	public set max(max: number) {
		this.upper = max;
		this.value = this.current;
	}

	public get step(): number {
		return this.increment;
	}

	public set step(step: number) {
		if (!(step > 0)) throw new Error(`NumberInput: step must be positive, got ${step}`);
		this.increment = step;
	}

	public get precision(): number {
		return this.places;
	}

	public set precision(precision: number) {
		this.places = Math.min(MAX_DECIMALS, precision);
		this.value = this.current;
	}

	public get size(): ControlSize {
		return this.fieldSize;
	}

	/** The text field, which holds focus and the typed text. */
	public get input(): TextInput {
		return this.field;
	}

	/** Whether a step that way would change the value. */
	public canStep(direction: StepDirection): boolean {
		return direction === 1 ? this.current < this.upper : this.current > this.lower;
	}

	/** One step from what the field shows (typed text included), as a user change. */
	public stepFromUser(direction: StepDirection): void {
		const typed = this.parse(this.field.value);
		this.commit((typed ?? this.current) + direction * this.increment);
	}

	/** Focus the field as a press would: no ring, caret where it was. */
	public focusField(): void {
		if (!this.field.focused) this.context?.focus.focus(this.field, 'pointer');
	}

	/** R9.32: the wheel steps while the field is focused and the value can move that way. */
	public canScroll(_deltaX: number, deltaY: number): boolean {
		return this.field.focused && deltaY !== 0 && this.canStep(deltaY < 0 ? 1 : -1);
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'keydown':
				if (event.modifiers.ctrl || event.modifiers.meta || event.modifiers.alt) return;
				if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
				if (!this.field.focused || !this.effectivelyEnabled) return;
				this.stepFromUser(event.key === 'ArrowUp' ? 1 : -1);
				event.consume();
				return;
			case 'wheel':
				if (!this.field.focused || !this.effectivelyEnabled || event.deltaY === 0) return;
				this.stepFromUser(event.deltaY < 0 ? 1 : -1);
				event.consume();
				return;
		}
	}

	protected onResized(): void {
		this.placeParts();
	}

	private placeParts(): void {
		const width = stepperWidth(this.fieldSize);
		const border = tokens.borderWidth.bw;
		this.field.setPosition(0, 0);
		this.field.setSize(this.width, this.height);
		this.stepper.setPosition(this.width - width - border, border);
		this.stepper.setSize(width, Math.max(0, this.height - border * 2));
	}

	/** Parses the field's text; commits the result, or restores the value's text when it is not a number. */
	private commitText(): void {
		const typed = this.parse(this.field.value);
		if (typed === null) this.field.value = this.format(this.current);
		else this.commit(typed);
	}

	private commit(value: number): void {
		const next = this.normalise(value);
		this.field.value = this.format(next);
		if (next === this.current) return;
		this.current = next;
		this.onChange?.(next);
	}

	private parse(text: string): number | null {
		if (!/\d/.test(text)) return null;
		const parsed = Number(text);
		return Number.isFinite(parsed) ? parsed : null;
	}

	private normalise(value: number): number {
		const clamped = Math.min(Math.max(value, this.lower), this.upper);
		const rounded = Number(clamped.toFixed(this.places));
		// Rounding can step past a bound with more places than `precision`; -0 shows as 0.
		return Math.min(Math.max(rounded, this.lower), this.upper) + 0;
	}

	private format(value: number): string {
		return value.toFixed(this.places);
	}

	/** What the field may hold on the way to a number. */
	private accepts(text: string): boolean {
		const sign = this.lower < 0 ? '-?' : '';
		const fraction = this.places > 0 ? '(\\.\\d*)?' : '';
		return new RegExp(`^${sign}\\d*${fraction}$`).test(text);
	}
}
