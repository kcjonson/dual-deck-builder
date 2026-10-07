import { Rng } from '../core/Rng';

/**
 * Seeded 2D simplex noise for the area map's terrain fields (Area Map
 * Generation, Pipeline, 1. Terrain), written in the repo rather than taken
 * from a package; docs/AI_TECHNICAL_DECISIONS/terrain-fields.md has why.
 *
 * Sampling is plain arithmetic: adds, multiplies, comparisons, and integer
 * ops, with no `Math` call, so a seed gives bit-identical values in every JS
 * engine and terrain thresholds can branch on them safely. The permutation
 * comes from `Rng.shuffle`, whose draw count is pinned, so a noise layer is
 * fixed by its stream alone: 255 draws.
 */

/** (sqrt(3) - 1) / 2, written out so no engine's square root is involved. */
const SKEW = 0.3660254037844386;
/** (3 - sqrt(3)) / 6. */
const UNSKEW = 0.21132486540518713;
const UNSKEW_TWICE = 2 * UNSKEW;

/**
 * 81 * sqrt(6) / 2 is the reciprocal of the largest sum three corners can
 * reach with unit gradients, midway along a cell's long edge with both
 * gradients pointing at the sample. Just under it keeps samples inside (-1, 1).
 */
const SCALE = 99.2;

/** Sixteen unit gradients, 22.5 degrees apart. */
const GRADIENTS_X = [1, 0.9238795325112867, 0.7071067811865476, 0.3826834323650898, 0, -0.3826834323650898, -0.7071067811865476, -0.9238795325112867,
	-1, -0.9238795325112867, -0.7071067811865476, -0.3826834323650898, 0, 0.3826834323650898, 0.7071067811865476, 0.9238795325112867];
const GRADIENTS_Y = [0, 0.3826834323650898, 0.7071067811865476, 0.9238795325112867, 1, 0.9238795325112867, 0.7071067811865476, 0.3826834323650898,
	0, -0.3826834323650898, -0.7071067811865476, -0.9238795325112867, -1, -0.9238795325112867, -0.7071067811865476, -0.3826834323650898];

/**
 * Where each octave of a fractal sum samples from, in lattice units, so
 * octaves don't share lattice points (the origin above all, where every
 * unshifted octave is zero) and the sum doesn't show the lattice.
 */
const OCTAVE_OFFSETS_X = [17.31, 43.17, 87.71, 19.37, 61.93, 101.31, 7.73, 53.39];
const OCTAVE_OFFSETS_Y = [29.53, 71.29, 13.97, 97.11, 37.79, 5.37, 83.93, 29.11];

/** The most octaves `fractal` sums. */
export const MAX_OCTAVES = OCTAVE_OFFSETS_X.length;

export interface SimplexNoiseOptions {
	/** The layer's own stream; building the permutation takes 255 draws from it. */
	rng: Rng;
}

/**
 * One layer of 2D simplex noise: Perlin's simplex grid with Gustavson's
 * corner kernels, (0.5 - r^2)^4 per corner, and sixteen unit gradients
 * hashed through a seeded permutation of 0 to 255. Values lie in (-1, 1),
 * zero at every lattice point; features are about one lattice unit across,
 * and the pattern repeats every 256 units, which callers keep beyond the map
 * by scaling world units down.
 */
export class SimplexNoise {
	/** The shuffled 0 to 255, twice over, so corner hashes never wrap. */
	private readonly permutation = new Uint8Array(512);
	/** Each permutation entry's gradient, looked up once here rather than per corner. */
	private readonly gradientX = new Float64Array(512);
	private readonly gradientY = new Float64Array(512);

	constructor({ rng }: SimplexNoiseOptions) {
		const order: number[] = [];
		for (let value = 0; value < 256; value += 1) order.push(value);
		rng.shuffle(order);
		for (let index = 0; index < 512; index += 1) {
			const value = order[index & 255];
			this.permutation[index] = value;
			this.gradientX[index] = GRADIENTS_X[value & 15];
			this.gradientY[index] = GRADIENTS_Y[value & 15];
		}
	}

	/** The derivatives of the last `sample` or `fractal` along x and y, per unit of its input. */
	public derivativeX = 0;
	public derivativeY = 0;

	/**
	 * The noise at (x, y) in lattice units, |x| and |y| under 2^30, with its
	 * exact derivatives left in `derivativeX` and `derivativeY`.
	 */
	public sample(x: number, y: number): number {
		const permutation = this.permutation;
		const gradientX = this.gradientX;
		const gradientY = this.gradientY;

		// Which skewed cell the point is in. `| 0` truncates, so step down for
		// negatives: a floor without a Math call.
		const skew = (x + y) * SKEW;
		const skewedX = x + skew;
		const skewedY = y + skew;
		let cellX = skewedX | 0;
		if (skewedX < cellX) cellX -= 1;
		let cellY = skewedY | 0;
		if (skewedY < cellY) cellY -= 1;

		const unskew = (cellX + cellY) * UNSKEW;
		const x0 = x - cellX + unskew;
		const y0 = y - cellY + unskew;
		// The middle corner of the cell's two triangles.
		const stepX = x0 > y0 ? 1 : 0;
		const stepY = 1 - stepX;
		const x1 = x0 - stepX + UNSKEW;
		const y1 = y0 - stepY + UNSKEW;
		const x2 = x0 - 1 + UNSKEW_TWICE;
		const y2 = y0 - 1 + UNSKEW_TWICE;

		// Each corner adds f^4 (g . d) for f = 0.5 - |d|^2, whose derivative is
		// f^4 g - 8 f^3 (g . d) d.
		const hashX = cellX & 255;
		const hashY = cellY & 255;
		let sum = 0;
		let sumX = 0;
		let sumY = 0;
		let falloff = 0.5 - x0 * x0 - y0 * y0;
		if (falloff > 0) {
			const corner = hashX + permutation[hashY];
			const gx = gradientX[corner];
			const gy = gradientY[corner];
			const dot = gx * x0 + gy * y0;
			const squared = falloff * falloff;
			const fourth = squared * squared;
			const bend = 8 * squared * falloff * dot;
			sum += fourth * dot;
			sumX += fourth * gx - bend * x0;
			sumY += fourth * gy - bend * y0;
		}
		falloff = 0.5 - x1 * x1 - y1 * y1;
		if (falloff > 0) {
			const corner = hashX + stepX + permutation[hashY + stepY];
			const gx = gradientX[corner];
			const gy = gradientY[corner];
			const dot = gx * x1 + gy * y1;
			const squared = falloff * falloff;
			const fourth = squared * squared;
			const bend = 8 * squared * falloff * dot;
			sum += fourth * dot;
			sumX += fourth * gx - bend * x1;
			sumY += fourth * gy - bend * y1;
		}
		falloff = 0.5 - x2 * x2 - y2 * y2;
		if (falloff > 0) {
			const corner = hashX + 1 + permutation[hashY + 1];
			const gx = gradientX[corner];
			const gy = gradientY[corner];
			const dot = gx * x2 + gy * y2;
			const squared = falloff * falloff;
			const fourth = squared * squared;
			const bend = 8 * squared * falloff * dot;
			sum += fourth * dot;
			sumX += fourth * gx - bend * x2;
			sumY += fourth * gy - bend * y2;
		}
		this.derivativeX = sumX * SCALE;
		this.derivativeY = sumY * SCALE;
		return sum * SCALE;
	}

	/**
	 * Fractal noise: `octaves` layers (1 to `MAX_OCTAVES`), each at twice the
	 * last one's frequency and `gain` times its amplitude, divided by the
	 * amplitudes' total so the result stays in (-1, 1), with its derivatives
	 * in `derivativeX` and `derivativeY`. (x, y) is in the first octave's
	 * lattice units: scale world units by the frequency first, and the
	 * derivatives by it after.
	 */
	public fractal(x: number, y: number, octaves: number, gain: number): number {
		let sum = 0;
		let sumX = 0;
		let sumY = 0;
		let total = 0;
		let amplitude = 1;
		let scale = 1;
		for (let octave = 0; octave < octaves; octave += 1) {
			sum += amplitude * this.sample(x * scale + OCTAVE_OFFSETS_X[octave], y * scale + OCTAVE_OFFSETS_Y[octave]);
			sumX += amplitude * scale * this.derivativeX;
			sumY += amplitude * scale * this.derivativeY;
			total += amplitude;
			amplitude *= gain;
			scale *= 2;
		}
		this.derivativeX = sumX / total;
		this.derivativeY = sumY / total;
		return sum / total;
	}

	/**
	 * `fractal`, for a caller that only cares whether the result lands
	 * strictly between `low` and `high`: it stops as soon as the octaves left
	 * can't bring it there, each sample being under 1 in size, and returns
	 * -Infinity when it's sure to be `low` or under, +Infinity when it's sure
	 * to be `high` or over, without derivatives either way. Otherwise it
	 * returns exactly what `fractal` would, derivatives included, even if
	 * that lands outside after all.
	 */
	public fractalWithin(x: number, y: number, octaves: number, gain: number, low: number, high: number): number {
		let total = 0;
		let amplitude = 1;
		for (let octave = 0; octave < octaves; octave += 1) {
			total += amplitude;
			amplitude *= gain;
		}
		const lowSum = low * total;
		const highSum = high * total;
		let rest = total;
		let sum = 0;
		let sumX = 0;
		let sumY = 0;
		amplitude = 1;
		let scale = 1;
		for (let octave = 0; octave < octaves; octave += 1) {
			sum += amplitude * this.sample(x * scale + OCTAVE_OFFSETS_X[octave], y * scale + OCTAVE_OFFSETS_Y[octave]);
			sumX += amplitude * scale * this.derivativeX;
			sumY += amplitude * scale * this.derivativeY;
			rest -= amplitude;
			if (sum + rest <= lowSum) return -Infinity;
			if (sum - rest >= highSum) return Infinity;
			amplitude *= gain;
			scale *= 2;
		}
		this.derivativeX = sumX / total;
		this.derivativeY = sumY / total;
		return sum / total;
	}
}
