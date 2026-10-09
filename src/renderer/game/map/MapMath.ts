/**
 * Small shaping functions the map's stages share. All plain arithmetic, so
 * a value shaped here is the same in every engine and generation can branch
 * on it.
 */

/** Smoothstep of a value already scaled to [0, 1], clamped outside it. NaN gives 0. */
export function smooth01(value: number): number {
	if (!(value > 0)) return 0;
	if (value >= 1) return 1;
	return value * value * (3 - 2 * value);
}

/** The derivative of `smooth01`. */
export function smoothSlope(value: number): number {
	if (!(value > 0) || value >= 1) return 0;
	return 6 * value * (1 - value);
}

export function lerp({ min, max }: { readonly min: number; readonly max: number }, amount: number): number {
	return min + (max - min) * amount;
}

export function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The value `share` of `values` lies at or above: +Infinity for a share of 0
 * or less, or no values, so none does, and -Infinity for 1 or more.
 */
export function quantileAbove(values: ArrayLike<number>, share: number): number {
	if (share <= 0 || values.length === 0) return Infinity;
	if (share >= 1) return -Infinity;
	const sorted = Float64Array.from(values).sort();
	const index = Math.min(sorted.length - 1, Math.max(0, Math.round((1 - share) * sorted.length)));
	return sorted[index];
}
