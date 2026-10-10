import { DrainageRouter } from './Drainage';

/**
 * Fluvial erosion on the land grid (Area Map Generation, Pipeline, 1.
 * Terrain): stream-power erosion solved implicitly, Braun and Willett's
 * method (2013), with m = 0.5 and n = 1, after a little hillslope
 * diffusion. Each iteration smooths hillslopes, routes drainage by priority
 * flood from the outlets, accumulates drainage area, and updates every cell
 * downstream first, so its receiver's new height is known:
 *
 *   h = (h + dt U + F h_receiver) / (1 + F),  F = dt K sqrt(area) / distance
 *
 * with area in cells and distance in cells (1, or the square root of 2 to a
 * diagonal neighbour). Measuring both in cells makes stream power's steady
 * state the same land at any cell size, since m / n = 0.5 balances the
 * square root of an area against a length. Diffusion doesn't scale that
 * way: it's a share of the Laplacian per cell, so on cells twice as wide the
 * same share smooths four times as much per world unit, and a caller
 * eroding a coarser grid passes a quarter of it. Outlets hold their height.
 * Every step is an add, multiply, divide, compare, or square root, which
 * ECMAScript rounds exactly, so the land erodes to the same bits in every
 * engine.
 *
 * The numbers are docs/AI_TECHNICAL_DECISIONS/terrain-erosion.md's.
 */

export interface ErosionOptions {
	/** Cells along each side of the square grid. */
	size: number;
	/** Height per cell, row by row; eroded in place. */
	elevation: Float64Array;
	/** Uplift per unit of time, per cell. */
	uplift: ArrayLike<number>;
	/** The cells drainage leaves by. They hold their height. */
	outlets: ArrayLike<number>;
	iterations: number;
	/** dt: time per iteration. */
	timeStep: number;
	/** K: how fast drainage cuts, per unit of time and of the square root of its area. */
	erodibility: number;
	/** Hillslope diffusion per iteration, a share of the four-neighbour Laplacian; 0.25 or under keeps it stable. */
	diffusion: number;
	/** A router for this size to reuse; one is made when left out. */
	router?: DrainageRouter;
}

/** Erodes `elevation` in place, `iterations` times. Returns the router, holding the last iteration's drainage. */
export function erode({ size, elevation, uplift, outlets, iterations, timeStep, erodibility, diffusion, router }: ErosionOptions): DrainageRouter {
	const cells = size * size;
	if (elevation.length !== cells || uplift.length !== cells) throw new RangeError(`erode: expected ${cells} elevations and uplifts, got ${elevation.length} and ${uplift.length}`);
	if (!(diffusion >= 0 && diffusion <= 0.25)) throw new RangeError(`erode: diffusion must be 0 to 0.25, got ${diffusion}`);
	const routing = router ?? new DrainageRouter({ size });
	if (routing.size !== size) throw new RangeError(`erode: the router is for size ${routing.size}, not ${size}`);
	const lift = new Float64Array(cells);
	for (let cell = 0; cell < cells; cell += 1) lift[cell] = timeStep * uplift[cell];
	const isOutlet = new Uint8Array(cells);
	for (let index = 0; index < outlets.length; index += 1) isOutlet[outlets[index]] = 1;
	const laplacian = new Float64Array(cells);
	const straight = timeStep * erodibility;
	const diagonal = straight / Math.SQRT2;
	const sqrt = Math.sqrt;
	const receivers = routing.receivers;
	const order = routing.order;
	const area = routing.area;

	for (let iteration = 0; iteration < iterations; iteration += 1) {
		// Diffusion first, so each iteration ends on stream power: smoothing
		// a channel's banks into it would leave pits along it for the next
		// iteration, and after the last there's no next.
		if (diffusion > 0) {
			for (let row = 1; row < size - 1; row += 1) {
				for (let column = 1; column < size - 1; column += 1) {
					const cell = row * size + column;
					laplacian[cell] = elevation[cell - 1] + elevation[cell + 1] + elevation[cell - size] + elevation[cell + size] - 4 * elevation[cell];
				}
			}
			for (let cell = 0; cell < cells; cell += 1) {
				if (isOutlet[cell] === 0) elevation[cell] += diffusion * laplacian[cell];
			}
		}
		routing.route(elevation, outlets);
		routing.accumulate();
		for (let index = 0; index < cells; index += 1) {
			const cell = order[index];
			const receiver = receivers[cell];
			if (receiver < 0) continue;
			const step = cell - receiver;
			const rate = step === 1 || step === -1 || step === size || step === -size ? straight : diagonal;
			const flow = rate * sqrt(area[cell]);
			elevation[cell] = (elevation[cell] + lift[cell] + flow * elevation[receiver]) / (1 + flow);
		}
	}
	return routing;
}

/** A grid half the size, each cell the mean of the two by two it covers. `size` must be even. */
export function downsample(values: ArrayLike<number>, size: number): Float64Array {
	if (size % 2 !== 0) throw new RangeError(`downsample: size must be even, got ${size}`);
	const half = size / 2;
	const coarse = new Float64Array(half * half);
	for (let row = 0; row < half; row += 1) {
		for (let column = 0; column < half; column += 1) {
			const at = 2 * row * size + 2 * column;
			coarse[row * half + column] = (values[at] + values[at + 1] + values[at + size] + values[at + size + 1]) / 4;
		}
	}
	return coarse;
}

/** A grid twice the size over the same square, bilinear between the coarse cell centres and held at the edges. */
export function upsample(values: ArrayLike<number>, coarseSize: number): Float64Array {
	const size = 2 * coarseSize;
	const fine = new Float64Array(size * size);
	const last = coarseSize - 1;
	for (let row = 0; row < size; row += 1) {
		// A fine centre sits a quarter of a coarse cell off a coarse centre.
		const along = row / 2 - 0.25;
		const south = along < 0 ? 0 : along >= last ? last : (along | 0);
		const north = south < last ? south + 1 : last;
		const ty = along <= 0 ? 0 : along >= last ? 0 : along - south;
		for (let column = 0; column < size; column += 1) {
			const across = column / 2 - 0.25;
			const west = across < 0 ? 0 : across >= last ? last : (across | 0);
			const east = west < last ? west + 1 : last;
			const tx = across <= 0 ? 0 : across >= last ? 0 : across - west;
			const southValue = values[south * coarseSize + west] + (values[south * coarseSize + east] - values[south * coarseSize + west]) * tx;
			const northValue = values[north * coarseSize + west] + (values[north * coarseSize + east] - values[north * coarseSize + west]) * tx;
			fine[row * size + column] = southValue + (northValue - southValue) * ty;
		}
	}
	return fine;
}
