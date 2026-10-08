/**
 * The grid a stepped control's values sit on (R12.15, R12.36): Slider snaps
 * to it and NumberInput rounds to its decimals. Imports nothing, so code that
 * wants its numbers to read like a control's, such as the area map's rolled
 * parameters, can land on the same grid without the controls.
 */

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
	return clamp(Number(snapped.toFixed(decimalsOf(step) + 2)));
}

/** Decimal places in `step`'s shortest form: 0.25 has two, 5 none, 1e-7 seven. */
export function decimalsOf(step: number): number {
	const text = String(step);
	const exponent = /e-(\d+)$/.exec(text);
	if (exponent) return Number(exponent[1]);
	const point = text.indexOf('.');
	return point === -1 ? 0 : text.length - point - 1;
}
