/**
 * The balance sim's measures as plain data (Balance Simulation, Measures):
 * every rate with its count and a 90% interval, so a 3-point move on 100
 * runs isn't read as a change.
 */

/** z for a two-sided 90% interval. */
const Z90 = 1.6448536269514722;

export interface Rate {
	readonly count: number;
	/** What it's a share of; 0 leaves the rate and its interval null. */
	readonly of: number;
	readonly rate: number | null;
	/** The Wilson score interval at 90%. */
	readonly low: number | null;
	readonly high: number | null;
}

export function rate(count: number, of: number): Rate {
	if (of === 0) return { count, of, rate: null, low: null, high: null };
	const share = count / of;
	const z2 = Z90 * Z90;
	const centre = (share + z2 / (2 * of)) / (1 + z2 / of);
	const reach = (Z90 / (1 + z2 / of)) * Math.sqrt((share * (1 - share)) / of + z2 / (4 * of * of));
	// Exact at the ends, where the arithmetic lands a hair inside them
	return { count, of, rate: share, low: count === 0 ? 0 : centre - reach, high: count === of ? 1 : centre + reach };
}

/** The mean, or null with nothing to average. */
export function mean(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface Spread {
	readonly mean: number | null;
	readonly min: number | null;
	readonly max: number | null;
	/** How many of the values take each whole value, by value. */
	readonly counts: Readonly<Record<number, number>>;
}

/** Mean, range, and distribution of whole-number values. */
export function spread(values: readonly number[]): Spread {
	const counts: Record<number, number> = {};
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	return {
		mean: mean(values),
		min: values.length === 0 ? null : values.reduce((low, value) => Math.min(low, value)),
		max: values.length === 0 ? null : values.reduce((high, value) => Math.max(high, value)),
		counts,
	};
}
