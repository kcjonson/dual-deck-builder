import type { Component } from '../components/Component';
import type { Direction } from '../components/layoutTypes';
import { Stack, StackOptions } from '../components/Stack';
import type { DrawApi } from '../draw/DrawApi';
import type { Rect } from '../draw/geometry';
import type { AnyUiEvent, UiActionEvent, UiKeyEvent, UiPointerEvent } from '../input/events';
import type { Look } from '../style/look';
import { CONTROL_SIZES, ControlSize } from '../style/variants';
import { tokens } from '../theme/tokens';
import { Checkable, CheckableOptions } from './Checkbox';

export interface RadioOption<T> {
	label: string;
	value: T;
	disabled?: boolean;
}

/** A user change: the new value, already applied, and the press or key that made it. */
export type RadioChangeCallback<T> = (value: T, event: UiPointerEvent | UiActionEvent | UiKeyEvent) => void;

export interface RadioGroupOptions<T> extends Omit<StackOptions, 'style'> {
	options: readonly RadioOption<T>[];
	/** The selected value; absent or unmatched selects nothing. */
	value?: T | null;
	onChange?: RadioChangeCallback<T>;
	size?: ControlSize;
	/** The constructor's form of `enabled: false`. */
	disabled?: boolean;
}

/**
 * One radio: a Checkable with a round mark that only ever turns on. The
 * group owns which one is on and hears the press through `memberPressed`.
 */
export class Radio<T = unknown> extends Checkable {
	public readonly value: T;

	constructor({ value, ...options }: CheckableOptions & { value: T }) {
		super(options);
		this.componentType = 'Radio';
		this.value = value;
	}

	protected get markSize(): { width: number; height: number } {
		const size = CONTROL_SIZES[this.size].iconSize;
		return { width: size, height: size };
	}

	/** Pressing a radio selects it; the group turns the others off. */
	protected onPressed(event: UiPointerEvent | UiActionEvent): void {
		if (!this.checked) this.commit(true, event);
	}

	protected drawMark(draw: DrawApi, rect: Rect, look: Look): void {
		this.drawMarkBox(draw, rect, look, rect.height / 2);
		if (!this.checked) return;
		draw.drawCircle({
			center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
			radius: rect.height / 4,
			fill: look.text,
		});
	}
}

/**
 * The arrows that move the selection back or forward: the group's own axis.
 * The other two go unconsumed to directional focus (R9.24, R9.26).
 */
const STEPS: Readonly<Record<Direction, Readonly<Record<string, -1 | 1>>>> = {
	vertical: { ArrowUp: -1, ArrowDown: 1 },
	horizontal: { ArrowLeft: -1, ArrowRight: 1 },
};

/**
 * R12.35's radio group: a focus group (R9.29, R12.34) of radios with one
 * `value`. It is one Tab stop, entered at the selected radio; the arrows
 * along its direction (Up and Down in the default column) move the
 * selection and focus together, wrapping and skipping disabled radios, the
 * two across it leave for directional focus, and Home and End go to the
 * ends; Space or a click selects. As everywhere, setting `value` never
 * fires `onChange`, and a user change fires it once, with the value
 * already applied.
 */
export class RadioGroup<T = string> extends Stack {
	public onChange: RadioChangeCallback<T> | null = null;
	private readonly radios: Radio<T>[] = [];
	private selectedValue: T | null;

	constructor({ options, value = null, onChange, size = 'md', disabled = false, ...stackOptions }: RadioGroupOptions<T>) {
		const direction = stackOptions.direction ?? 'vertical';
		super({ gap: tokens.space.space_1, ...(disabled ? { enabled: false } : {}), ...stackOptions, direction, focusGroup: { orientation: direction, wrap: true } });
		this.componentType = 'RadioGroup';
		this.selectedValue = null;
		for (const option of options) {
			const radio = new Radio<T>({ label: option.label, value: option.value, size, disabled: option.disabled });
			this.radios.push(radio);
			this.addChild(radio);
		}
		if (onChange) this.onChange = onChange;
		this.value = value;
	}

	public get direction(): Direction {
		return super.direction;
	}

	/** The group's arrows and its focus-group orientation follow the direction. */
	public set direction(value: Direction) {
		super.direction = value;
		this.focusGroup = { orientation: value, wrap: true };
	}

	public get value(): T | null {
		return this.selectedValue;
	}

	/** Programmatic: never fires `onChange`. A value no radio has selects nothing. */
	public set value(value: T | null) {
		const match = this.radios.find((radio) => radio.value === value) ?? null;
		this.selectedValue = match ? match.value : null;
		for (const radio of this.radios) radio.checked = radio === match;
		// Tab enters at the selection (R9.29).
		if (match) this.activeChild = match;
	}

	/** The radios, in order. */
	public get items(): readonly Radio<T>[] {
		return this.radios;
	}

	/** A radio was clicked or activated with Space: it is on already, so the rest go off. */
	public memberPressed(member: Component, event: UiPointerEvent | UiActionEvent): void {
		if (!(member instanceof Radio) || !this.radios.includes(member)) return;
		this.choose(member as Radio<T>, event);
	}

	/**
	 * The arrows along the group, Home, and End from a focused radio: the
	 * group consumes them, so the focus manager's own group movement (which
	 * moves focus without selecting) never runs.
	 */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (event.type !== 'keydown' || event.consumed) return;
		const { ctrl, meta, alt, shift } = event.modifiers;
		if (ctrl || meta || alt || shift) return;
		const current = this.radios.find((radio) => radio.focused);
		if (!current) return;
		const enabled = this.radios.filter((radio) => radio === current || radio.canReceiveFocus());
		let target: Radio<T> | undefined;
		if (event.key === 'Home') target = enabled[0];
		else if (event.key === 'End') target = enabled[enabled.length - 1];
		else {
			const step = STEPS[this.direction][event.key];
			if (step === undefined) return;
			const index = enabled.indexOf(current);
			target = enabled[(index + step + enabled.length) % enabled.length];
		}
		if (!target) return;
		event.consume();
		if (target === current) return;
		this.context?.focus.focus(target, 'keyboard');
		this.choose(target, event);
	}

	private choose(radio: Radio<T>, event: UiPointerEvent | UiActionEvent | UiKeyEvent): void {
		const changed = this.selectedValue !== radio.value || !radio.checked;
		this.value = radio.value;
		if (changed) this.onChange?.(radio.value, event);
	}
}
