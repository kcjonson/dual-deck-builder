/**
 * The grid a stepped control's values sit on (R12.15, R12.36): Slider snaps
 * to it and NumberInput rounds to its decimals. Imports nothing, so code that
 * wants its numbers to read like a control's can land on the same grid
 * without the controls.
 */

/** The most decimal places `toFixed` writes. */
export const MAX_DECIMALS = 100;

export interface StepRange {
	readonly min: number;
	readonly max: number;
	/** 0 for continuous. */
	readonly step: number;
}

/** Clamped to the range, then to the nearest step from `min` when `step` is positive. */
export function snapToStep({ min, max, step }: StepRange, value: number): number {
	const clamp = (v: number): number => Math.min(Math.max(v, min), Math.max(min, max));
	if (!Number.isFinite(value)) return min;
	if (!(step > 0)) return clamp(value);
	const snapped = min + Math.round((value - min) / step) * step;
	// Strip the float noise the multiply leaves (0.1 * 3), at the step's own precision.
	return clamp(Number(snapped.toFixed(Math.min(MAX_DECIMALS, decimalsOf(step) + 2))));
}

/** Decimal places in `step`'s shortest form, exponent and all: 0.25 has two, 5 none, 1e-7 seven, 1.5e-7 eight. */
export function decimalsOf(step: number): number {
	const [mantissa, exponent = '0'] = String(step).split('e');
	const point = mantissa.indexOf('.');
	const fraction = point === -1 ? 0 : mantissa.length - point - 1;
	return Math.max(0, fraction - Number(exponent));
}
