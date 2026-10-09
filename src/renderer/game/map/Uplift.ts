import { Rng } from '../core/Rng';
import { Vector, unitVector } from './Geometry';
import { LandGrid, cellCentre } from './LandGrid';
import { SimplexNoise } from './Noise';

/**
 * The uplift field (Area Map Generation, Pipeline, 1. Terrain): where the
 * land is pushed up before erosion cuts it down. A low, varied lift
 * everywhere makes rolling country; mountain ranges lift far more. Ranges
 * are belts of a broad noise layer stretched about three to one along one
 * grain per map, since a region's ranges run roughly parallel, bent by a
 * warp so they don't run ruler-straight. A second layer, added to the first,
 * breaks belts into stretches with gaps, where passes form. Range country is
 * where the sum passes a quantile of itself over the land past the relief
 * radius, so `mountainCoverage` is that share of the country on every map.
 * `ruggedness` scales how hard the land lifts. Round the metro the ranges
 * fade to nothing and the hills to half, so little stands near the compound
 * (Land.ts flattens the metro itself after erosion).
 *
 * Noise sampling is plain arithmetic (Noise.ts) and the grain is a unit
 * vector from a polynomial (Geometry.ts), so the field is the same to the
 * bit in every engine.
 */

export interface UpliftOptions {
	grid: LandGrid;
	/** World units: the disc's radius. Coverage is a share of the land inside it. */
	radius: number;
	/** World units: no range lifts inside this, and the hills lift at `HILLS.metroShare`... */
	metroRadius: number;
	/** ...and the lift is full from here out. Coverage is calibrated past it. */
	reliefRadius: number;
	mountainCoverage: number;
	ruggedness: number;
	/** The terrain stream. Uplift forks it by feature and never draws from it directly. */
	rng: Rng;
}

export interface UpliftField {
	/** How hard the land is pushed up, per cell. */
	readonly uplift: Float64Array;
	/** Range country per cell, 0 to 1, faded to nothing round the metro: 0.5 and up covers `mountainCoverage` of the land past the relief radius. */
	readonly mountains: Float64Array;
	/** The unit vector ranges run along. */
	readonly grain: Readonly<Vector>;
}

/**
 * Rolling country: every cell's lift, which varies this much either way,
 * rising with ruggedness. Round the metro it fades to `metroShare` of
 * itself rather than to nothing: ground with no lift at all erodes dead
 * flat, and drainage crosses a dead flat in ruler-straight lines.
 */
const HILLS = { wavelength: 450, octaves: 3, gain: 0.5, variation: 0.8, lift: { min: 0.04, max: 0.12 }, metroShare: 0.5 };
/** Mountain ranges: the belt layer's wavelength along the grain and across it, and the lift on top of the hills, rising with ruggedness. */
const RANGES = {
	alongWavelength: 1500, acrossWavelength: 520, octaves: 3, gain: 0.45,
	/** The mask goes from none to full over this much of the belt value, centred on the coverage threshold. */
	ramp: 0.26,
	lift: { min: 0.7, max: 1.8 },
};
/** Bends the belts: how far, in world units, and over what wavelength. */
const WARP = { wavelength: 800, amplitude: 160 };
/** Breaks belts into stretches: a finer layer added to the belt value at this weight. */
const BREAKS = { wavelength: 500, octaves: 2, gain: 0.5, weight: 0.25 };
/** Where the warp's second axis samples, away from its first. */
const WARP_OFFSET_X = 40.7;
const WARP_OFFSET_Y = -40.3;

export function buildUplift({ grid, radius, metroRadius, reliefRadius, mountainCoverage, ruggedness, rng }: UpliftOptions): UpliftField {
	const hillNoise = new SimplexNoise({ rng: rng.fork('hills') });
	const rangeNoise = new SimplexNoise({ rng: rng.fork('ranges') });
	const warpNoise = new SimplexNoise({ rng: rng.fork('rangeWarp') });
	const breakNoise = new SimplexNoise({ rng: rng.fork('rangeBreaks') });
	const grain = unitVector(rng.fork('grain').float() * 180, { x: 0, y: 0 });

	const size = grid.size;
	const cells = size * size;
	const belts = new Float64Array(cells);
	const radiusSquared = radius * radius;
	const reliefSquared = reliefRadius * reliefRadius;
	// The land past the relief radius, inside the disc, that coverage is a share of.
	const calibration: number[] = [];
	for (let row = 0; row < size; row += 1) {
		const y = cellCentre(grid, row);
		for (let column = 0; column < size; column += 1) {
			const x = cellCentre(grid, column);
			const warpedX = x + WARP.amplitude * warpNoise.sample(x / WARP.wavelength, y / WARP.wavelength);
			const warpedY = y + WARP.amplitude * warpNoise.sample(x / WARP.wavelength + WARP_OFFSET_X, y / WARP.wavelength + WARP_OFFSET_Y);
			const along = warpedX * grain.x + warpedY * grain.y;
			const across = warpedY * grain.x - warpedX * grain.y;
			const belt = rangeNoise.fractal(along / RANGES.alongWavelength, across / RANGES.acrossWavelength, RANGES.octaves, RANGES.gain)
				+ BREAKS.weight * breakNoise.fractal(x / BREAKS.wavelength, y / BREAKS.wavelength, BREAKS.octaves, BREAKS.gain);
			belts[row * size + column] = belt;
			const distanceSquared = x * x + y * y;
			if (distanceSquared >= reliefSquared && distanceSquared <= radiusSquared) calibration.push(belt);
		}
	}
	const threshold = quantileAbove(calibration, mountainCoverage);

	const hillLift = lerp(HILLS.lift, ruggedness);
	const rangeLift = lerp(RANGES.lift, ruggedness);
	const metroSquared = metroRadius * metroRadius;
	const uplift = new Float64Array(cells);
	const mountains = new Float64Array(cells);
	for (let row = 0; row < size; row += 1) {
		const y = cellCentre(grid, row);
		for (let column = 0; column < size; column += 1) {
			const x = cellCentre(grid, column);
			const cell = row * size + column;
			const distanceSquared = x * x + y * y;
			// On squared distance, as the rest of the start's blends are.
			const fade = distanceSquared >= reliefSquared ? 1 : smooth01((distanceSquared - metroSquared) / (reliefSquared - metroSquared));
			const mask = fade > 0 ? fade * smooth01((belts[cell] - threshold) / RANGES.ramp + 0.5) : 0;
			const hills = hillLift * (1 + HILLS.variation * hillNoise.fractal(x / HILLS.wavelength, y / HILLS.wavelength, HILLS.octaves, HILLS.gain));
			uplift[cell] = (HILLS.metroShare + (1 - HILLS.metroShare) * fade) * hills + rangeLift * mask;
			mountains[cell] = mask;
		}
	}
	return { uplift, mountains, grain };
}

/**
 * The value `share` of `values` lies at or above: +Infinity for a share of 0
 * or less, so none does, and -Infinity for 1 or more.
 */
export function quantileAbove(values: readonly number[], share: number): number {
	if (share <= 0 || values.length === 0) return Infinity;
	if (share >= 1) return -Infinity;
	const sorted = Float64Array.from(values).sort();
	const index = Math.min(sorted.length - 1, Math.max(0, Math.round((1 - share) * sorted.length)));
	return sorted[index];
}

function lerp({ min, max }: { min: number; max: number }, amount: number): number {
	return min + (max - min) * amount;
}

/** Smoothstep of a value already scaled to [0, 1], clamped outside it. */
function smooth01(value: number): number {
	if (value <= 0) return 0;
	if (value >= 1) return 1;
	return value * value * (3 - 2 * value);
}
