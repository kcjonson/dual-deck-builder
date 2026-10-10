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
 * The value `share` of `values` lies at or above, for a feature measured as
 * a value above 0, so never 0 itself: where fewer than that share are above
 * 0, the least of those above 0, so everything that qualifies at all does.
 * +Infinity when none is above 0 or the share is 0 or less.
 */
export function positiveQuantile(values: ArrayLike<number>, share: number): number {
	if (!(share > 0)) return Infinity;
	const positive: number[] = [];
	for (let index = 0; index < values.length; index += 1) if (values[index] > 0) positive.push(values[index]);
	if (positive.length === 0) return Infinity;
	const wanted = share * values.length;
	if (wanted >= positive.length) {
		let least = Infinity;
		for (const value of positive) if (value < least) least = value;
		return least;
	}
	return quantileAbove(positive, wanted / positive.length);
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
