import { Rng } from '../core/Rng';
import { Drainage, DrainageRouter, routeDrainage } from './Drainage';
import { downsample, erode, upsample } from './Erosion';
import { unitVector } from './Geometry';
import { LandGrid, cellAt, cellCentre, coarseGrid, landGridFor } from './LandGrid';
import { lerp, smooth01 } from './MapMath';
import { MapParams } from './MapParams';
import { SimplexNoise } from './Noise';
import { buildUplift } from './Uplift';

/**
 * The land (Area Map Generation, Pipeline, 1. Terrain): an uplift field
 * eroded by the rivers that drain it, on the land grid. Mountains are where
 * the land is pushed up, and valleys are what drainage cuts into it, so the
 * ranges, their ridges and spurs, and a drainage network that runs downhill
 * everywhere come out of one process, and the water stage's rivers can't
 * disagree with the land they run in.
 *
 * - Outlets: `rivers` cells on the grid's edge, the only places drainage
 *   leaves, so the region's water gathers into that many main rivers. With
 *   none, it all drains to one sink inside the disc: a closed basin.
 * - Erosion runs coarse first, on a grid half the size, then finishes at
 *   full size from that land, for about a third of the time a full-size run
 *   takes (terrain-erosion.md has the measurements).
 * - Elevation is the eroded height over a fixed scale, easing toward 1 on
 *   the highest peaks, so a gentle map stays low and a rugged one stands tall.
 * - Dry maps weather into tablelands: below an `aridity` of 0.4 the
 *   elevation is pulled toward terraces, flat benches with steep risers.
 * - The metro is flattened, so the compound sits on flat ground.
 * - The drainage of the finished land is kept for the water stage.
 *
 * Everything is adds, multiplies, divides, compares, square roots, and
 * floors, which ECMAScript gives exactly, so a seed's land is the same to
 * the bit in every engine, and loading a campaign regrows it rather than
 * saving it. Starting values throughout are provisional calls for the Map
 * Lab, listed in docs/AI_TECHNICAL_DECISIONS/terrain-erosion.md.
 */

/** The eroded land, as plain data on the grid. */
export interface LandSurface {
	readonly grid: LandGrid;
	/** Finished elevation per cell, 0 to 1: outlets at 0, the highest peaks toward 1. */
	readonly elevation: Float64Array;
	/** Range country per cell, 0 to 1: the uplift's mask, 0.5 and up being `mountainCoverage` of the land past the relief radius. */
	readonly mountains: Float64Array;
	/** The finished elevation's drainage, routed from the outlets, one unit of rain a cell. */
	readonly drainage: Drainage;
	/** True when there are no outlets on the edge and everything drains to `drainage.outlets[0]`, inside the disc. */
	readonly closedBasin: boolean;
}

/** The start's radii: where the metro ends, where its fields blend into the land's, and where the land's relief is full. */
export interface StartRadii {
	readonly metroRadius: number;
	readonly blendRadius: number;
	readonly reliefRadius: number;
}

export function startRadii({ radius, metroSize }: Pick<MapParams, 'radius' | 'metroSize'>): StartRadii {
	const metroRadius = metroSize * radius;
	const blendRadius = metroRadius + Math.max(0.5 * metroRadius, 0.06 * radius);
	return { metroRadius, blendRadius, reliefRadius: blendRadius + 0.1 * radius };
}

/**
 * How wet the land runs on average, 0 to 1, from `aridity`. The spec defines
 * aridity as "dry desert to wet ground and mire" over 0 to 1, which this
 * follows as written; whether to rename it or flip it is open (DDB-405), and
 * either is a change here alone.
 */
export function moistureLevel(aridity: number): number {
	return aridity;
}

/** Erosion's constants: dt, K, the uplift's rate per unit of time, and the iterations at half size and then full size. */
export const EROSION = {
	timeStep: 1.2,
	erodibility: 0.11,
	upliftRate: 0.1,
	coarseIterations: 40,
	fineIterations: 10,
	/** Hillslope diffusion at ruggedness 0 and 1: rugged ranges keep sharper slopes. */
	diffusion: { min: 0.05, max: 0.025 },
} as const;
/** The surface erosion starts from: a little of the uplift, so ranges start as ridges, and low noise. */
const INITIAL = { lift: 0.05, relief: 0.02, wavelength: 120, octaves: 3, gain: 0.5 };
/**
 * Eroded height h becomes elevation h / sqrt(h^2 + HEIGHT_SCALE^2): close to
 * h / HEIGHT_SCALE in the lowlands and foothills, easing toward 1 on the
 * highest peaks, so no tuning of the uplift flattens the tops at a clamp.
 */
export const HEIGHT_SCALE = 6;
/** With no outlets, the sink sits this share of the radius from the compound. */
const BASIN_DISTANCE = 0.55;
/**
 * Dry maps' terraces: full at a moisture level of `full`, none from `below`;
 * benches per unit of elevation; where in each step the riser starts and
 * ends; how far elevation is pulled toward them at full dryness.
 */
export const TERRACES = { below: 0.4, full: 0.1, steps: 7, riserStart: 0.55, riserEnd: 0.92, strength: 0.8 } as const;
/** Vertical scale for slopes: elevation 1 stands this many world units high. */
export const RELIEF = 100;
/** The most of its relief the metro keeps when it's flattened... */
export const METRO_RELIEF = 0.15;
/** ...and less where that would leave a grade steeper than this, measured cell to cell. */
export const METRO_GRADE = 0.1;

// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;

export interface LandOptions {
	/** Resolved and validated. */
	params: MapParams;
	/** The terrain stream; the land forks it by feature and never draws from it directly. */
	rng: Rng;
}

/**
 * The land for validated params, from the `terrain` stream. What it returns
 * is frozen and its arrays are never written again, by contract: the stages
 * after read them, and they may be sent across a worker boundary.
 */
export function generateLand({ params, rng }: LandOptions): LandSurface {
	const grid = landGridFor(params.radius);
	const { metroRadius, blendRadius, reliefRadius } = startRadii(params);
	const { uplift, mountains } = buildUplift({
		grid,
		radius: params.radius,
		metroRadius,
		reliefRadius,
		mountainCoverage: params.mountainCoverage,
		ruggedness: params.ruggedness,
		rng,
	});
	const { outlets, closedBasin } = placeOutlets({ grid, count: params.rivers, radius: params.radius, rng: rng.fork('outlets') });
	const { height: elevation, router } = erodeCoarseToFine({ grid, uplift, outlets, ruggedness: params.ruggedness, rng });
	const scaleSquared = HEIGHT_SCALE * HEIGHT_SCALE;
	for (let cell = 0; cell < elevation.length; cell += 1) {
		const height = elevation[cell];
		elevation[cell] = height / sqrt(height * height + scaleSquared);
	}
	terrace({ elevation, wetness: moistureLevel(params.aridity) });
	// Where water leaves the metro, the level it flattens toward.
	router.route(elevation, outlets);
	flattenMetro({ grid, elevation, levels: router.levels, metroRadius, blendRadius });
	const drainage = routeDrainage({ size: grid.size, elevation, outlets, router });
	fillMetroWater({ grid, elevation, levels: drainage.levels, blendRadius });
	return Object.freeze({ grid: Object.freeze(grid), elevation, mountains, drainage: Object.freeze(drainage), closedBasin });
}

/**
 * The outlets: `count` cells spread round the grid's edge from a drawn start,
 * each jittered within its share of the perimeter, so no two come close.
 * With none, one sink inside the disc at `BASIN_DISTANCE` of the radius, in
 * a drawn direction.
 */
export function placeOutlets({ grid, count, radius, rng }: { grid: LandGrid; count: number; radius: number; rng: Rng }): { outlets: Int32Array; closedBasin: boolean } {
	if (count <= 0) {
		const direction = unitVector(rng.float() * 360, { x: 0, y: 0 });
		const distance = BASIN_DISTANCE * radius;
		return { outlets: Int32Array.of(cellAt(grid, direction.x * distance, direction.y * distance)), closedBasin: true };
	}
	const size = grid.size;
	const perimeter = 4 * (size - 1);
	const spacing = perimeter / count;
	const start = rng.float() * perimeter;
	const outlets = new Int32Array(count);
	for (let outlet = 0; outlet < count; outlet += 1) {
		const along = floor(start + (outlet + 0.25 + 0.5 * rng.float()) * spacing) % perimeter;
		outlets[outlet] = perimeterCell(size, along);
	}
	return { outlets, closedBasin: false };
}

/** The cell `along` steps round the edge, counterclockwise from the south-west corner. */
function perimeterCell(size: number, along: number): number {
	const side = size - 1;
	if (along < side) return along;
	if (along < 2 * side) return (along - side) * size + side;
	if (along < 3 * side) return side * size + side - (along - 2 * side);
	return (side - (along - 3 * side)) * size;
}

/**
 * Erodes the uplift from a low starting surface: `EROSION.coarseIterations`
 * on a grid half the size, then `EROSION.fineIterations` at full size from
 * that land, upsampled. Diffusion acts per cell, so on cells twice as wide
 * the coarse pass takes a quarter of it, to smooth as much per world unit.
 * Returns the eroded height per cell, and the full-size router, for the
 * final routing to reuse.
 */
function erodeCoarseToFine({ grid, uplift, outlets, ruggedness, rng }: { grid: LandGrid; uplift: Float64Array; outlets: Int32Array; ruggedness: number; rng: Rng }): { height: Float64Array; router: DrainageRouter } {
	const size = grid.size;
	const coarse = coarseGrid(grid);
	const half = coarse.size;
	const coarseUplift = downsample(uplift, size);
	const coarseOutlets = coarseCells(outlets, size);
	const diffusion = lerp(EROSION.diffusion, ruggedness);

	const noise = new SimplexNoise({ rng: rng.fork('initial') });
	const coarseHeight = new Float64Array(half * half);
	const coarseRate = new Float64Array(half * half);
	for (let row = 0; row < half; row += 1) {
		const y = cellCentre(coarse, row) / INITIAL.wavelength;
		for (let column = 0; column < half; column += 1) {
			const x = cellCentre(coarse, column) / INITIAL.wavelength;
			const cell = row * half + column;
			coarseHeight[cell] = INITIAL.lift * coarseUplift[cell] + INITIAL.relief * (1 + noise.fractal(x, y, INITIAL.octaves, INITIAL.gain));
			coarseRate[cell] = EROSION.upliftRate * coarseUplift[cell];
		}
	}
	for (let index = 0; index < coarseOutlets.length; index += 1) coarseHeight[coarseOutlets[index]] = 0;
	erode({
		size: half, elevation: coarseHeight, uplift: coarseRate, outlets: coarseOutlets, iterations: EROSION.coarseIterations,
		timeStep: EROSION.timeStep, erodibility: EROSION.erodibility, diffusion: diffusion / 4,
	});

	const height = upsample(coarseHeight, half);
	const rate = new Float64Array(size * size);
	for (let cell = 0; cell < rate.length; cell += 1) rate[cell] = EROSION.upliftRate * uplift[cell];
	for (let index = 0; index < outlets.length; index += 1) height[outlets[index]] = 0;
	const router = erode({
		size, elevation: height, uplift: rate, outlets, iterations: EROSION.fineIterations,
		timeStep: EROSION.timeStep, erodibility: EROSION.erodibility, diffusion,
	});
	return { height, router };
}

/** The coarse cells holding the given cells of a grid twice the size, in order, each once. */
function coarseCells(cells: Int32Array, size: number): Int32Array {
	const half = size / 2;
	const coarse: number[] = [];
	for (let index = 0; index < cells.length; index += 1) {
		const row = (cells[index] / size) | 0;
		const column = cells[index] - row * size;
		const cell = (row >> 1) * half + (column >> 1);
		if (!coarse.includes(cell)) coarse.push(cell);
	}
	return Int32Array.from(coarse);
}

/**
 * Pulls elevation toward terraces on dry maps: each of `TERRACES.steps`
 * benches a unit is flat for most of its height, then rises in a steep
 * riser, and elevation moves that way by the map's dryness. Nothing changes
 * at a moisture level of `TERRACES.below` or more. The pull is the same
 * everywhere on a map and never all the way, so a higher cell stays higher:
 * terracing reorders no heights, so it leaves no pits and water stands where
 * it stood, though squeezing some drops more than others can change which
 * way down is steepest on a bench.
 */
export function terrace({ elevation, wetness }: { elevation: Float64Array; wetness: number }): void {
	const dryness = smooth01((TERRACES.below - wetness) / (TERRACES.below - TERRACES.full));
	if (dryness <= 0) return;
	const steps = TERRACES.steps;
	const riser = TERRACES.riserEnd - TERRACES.riserStart;
	const pull = dryness * TERRACES.strength;
	for (let cell = 0; cell < elevation.length; cell += 1) {
		const height = elevation[cell];
		const scaled = height * steps;
		const bench = floor(scaled);
		const terraced = (bench + smooth01((scaled - bench - TERRACES.riserStart) / riser)) / steps;
		elevation[cell] = height + (terraced - height) * pull;
	}
}

/**
 * Flattens the metro, only ever lowering land, toward the lowest water level
 * in it, where its water leaves: inside the metro each cell keeps as much of
 * its height above that floor as holds the steepest grade there to
 * `METRO_GRADE`, and never more than `METRO_RELIEF` of it, easing back to
 * the land's own height at the blend radius. Little lifts the land round the
 * metro, but rivers crossing it still cut valleys, and ranges close round it
 * can leave it a basin with steep sides. Raising nothing means flattening
 * never dams a river, and flattening toward where water leaves rather than
 * the bottom of a pit means it doesn't sink the metro into a basin. Inside
 * the metro the change is the same for every cell, so drainage across it
 * runs the same way, but pits below the floor stay, and the blend ring
 * lowers its inner edge further than its outer, which can leave pits there:
 * `fillMetroWater` fills them.
 */
export function flattenMetro({ grid, elevation, levels, metroRadius, blendRadius }: { grid: LandGrid; elevation: Float64Array; levels: ArrayLike<number>; metroRadius: number; blendRadius: number }): void {
	const size = grid.size;
	const metroSquared = metroRadius * metroRadius;
	const blendSquared = blendRadius * blendRadius;
	const toGrade = RELIEF / (2 * grid.cellSize);
	let floorLevel = Infinity;
	let steepest = 0;
	for (let row = 1; row < size - 1; row += 1) {
		const y = cellCentre(grid, row);
		for (let column = 1; column < size - 1; column += 1) {
			const x = cellCentre(grid, column);
			if (x * x + y * y > metroSquared) continue;
			const cell = row * size + column;
			if (levels[cell] < floorLevel) floorLevel = levels[cell];
			const slopeX = (elevation[cell + 1] - elevation[cell - 1]) * toGrade;
			const slopeY = (elevation[cell + size] - elevation[cell - size]) * toGrade;
			const grade = sqrt(slopeX * slopeX + slopeY * slopeY);
			if (grade > steepest) steepest = grade;
		}
	}
	if (floorLevel === Infinity) return;
	const keep = steepest * METRO_RELIEF > METRO_GRADE ? METRO_GRADE / steepest : METRO_RELIEF;
	const pull = 1 - keep;
	for (let row = 0; row < size; row += 1) {
		const y = cellCentre(grid, row);
		for (let column = 0; column < size; column += 1) {
			const x = cellCentre(grid, column);
			const distanceSquared = x * x + y * y;
			if (distanceSquared >= blendSquared) continue;
			const cell = row * size + column;
			const above = elevation[cell] - floorLevel;
			if (!(above > 0)) continue;
			const weight = distanceSquared <= metroSquared ? 1 : smooth01((blendSquared - distanceSquared) / (blendSquared - metroSquared));
			elevation[cell] -= above * pull * weight;
		}
	}
}

/**
 * Raises standing water round the metro to dry land: every cell where water
 * stands inside the blend radius, and every cell of the same water reached
 * through its neighbours, goes up to its water level. A basin the ranges
 * close round the metro, or a pit the flattening left in the blend ring,
 * becomes flat land at the level it would fill to, all of it, so no step
 * stands where the blend radius cuts across it. Each level is above its
 * receiver's, so the routing stands as it was.
 */
export function fillMetroWater({ grid, elevation, levels, blendRadius }: { grid: LandGrid; elevation: Float64Array; levels: ArrayLike<number>; blendRadius: number }): void {
	const size = grid.size;
	const blendSquared = blendRadius * blendRadius;
	const queue: number[] = [];
	for (let row = 0; row < size; row += 1) {
		const y = cellCentre(grid, row);
		for (let column = 0; column < size; column += 1) {
			const x = cellCentre(grid, column);
			const cell = row * size + column;
			if (x * x + y * y < blendSquared && levels[cell] > elevation[cell]) {
				elevation[cell] = levels[cell];
				queue.push(cell);
			}
		}
	}
	while (queue.length > 0) {
		const cell = queue.pop() as number;
		const row = (cell / size) | 0;
		const column = cell - row * size;
		for (let rowStep = -1; rowStep <= 1; rowStep += 1) {
			for (let columnStep = -1; columnStep <= 1; columnStep += 1) {
				const nextRow = row + rowStep;
				const nextColumn = column + columnStep;
				if (nextRow < 0 || nextColumn < 0 || nextRow >= size || nextColumn >= size) continue;
				const next = nextRow * size + nextColumn;
				if (levels[next] > elevation[next]) {
					elevation[next] = levels[next];
					queue.push(next);
				}
			}
		}
	}
}
