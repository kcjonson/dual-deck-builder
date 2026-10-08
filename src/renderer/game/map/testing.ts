import type { ParamRange } from './MapParams';

/**
 * Checks the map's tests share. Nothing in the game imports this file.
 */

/** Whether `value` is in `range`, ends included. */
export function inside(value: number, range: ParamRange): boolean {
	return value >= range.min && value <= range.max;
}

/** Whether a value is a whole number of steps, allowing for float error (0.35 / 0.05 is 6.999...). */
export function onGrid(value: number, step: number): boolean {
	return Math.abs(value / step - Math.round(value / step)) < 1e-9;
}
