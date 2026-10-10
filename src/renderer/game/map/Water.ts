import type { Rng } from '../core/Rng';
import { routeDrainage } from './Drainage';
import { RELIEF, moistureLevel, startRadii } from './Land';
import { GridSampler, LandGrid, cellCentre, landGridFor } from './LandGrid';
import { Lake, LakeCells, emptyLakeCells, lakeDepthField, naturalLakes, placeReservoirs, valleyDepth } from './Lakes';
import { clamp01, positiveQuantile, quantileAbove, smooth01 } from './MapMath';
import type { MapParams } from './MapParams';
import { SimplexNoise } from './Noise';
import { RiverCrossing, RiverIndex, RiverInfo, RiverLines, riverPolylines, riverThreshold, traceRivers } from './Rivers';
import { featureRoom, landValues } from './Terrain';
import type { Terrain, WaterKind, WaterLayer } from './Terrain';

/**
 * Stage 2 of area map generation, water (Area Map Generation, Pipeline, 2.
 * Water), on the `water` stream: rain-weighted drainage over the finished
 * land, rivers traced down it, reservoirs and natural lakes, and the
 * moisture, low ground, and canyons the biomes read, which all follow from
 * where the water runs.
 *
 * - Moisture before the rivers is the map's level by `aridity`, a broad noise
 *   layer, and drier with height. Rain is that, heavier in the ranges.
 * - The finished land is routed again for the rivers with noise of under a
 *   hundredth of grade added, so drainage stops crossing flat ground, the
 *   metro's filled water above all, in ruler-straight lines, and on gentle
 *   slopes it stops running eight ways only.
 * - Lakes: the land's pits where the country is wet, then `lakes`
 *   reservoirs dammed on rivers in valleys. `lakes` 0 is a map with no
 *   standing water at all.
 * - Rivers end at a confluence, in a lake, where drainage leaves the region,
 *   or at a closed basin's sink.
 * - Wetness spreads out from the rivers and lakes over low ground beside
 *   them, which is what moisture, mire, and the floodplains read.
 * - Canyons are the deepest river valleys, on dry maps.
 *
 * What it makes is plain data, `WaterSurface`, which crosses the worker
 * boundary as terrain.surface does; `Water` reads it. Everything is adds,
 * multiplies, divides, compares, square roots, and floors. Starting values
 * throughout are provisional calls for the Map Lab, listed in
 * docs/AI_TECHNICAL_DECISIONS/water-and-biomes.md.
 */

/** The water stage's output as plain data, frozen, its arrays never written again. */
export interface WaterSurface {
	readonly grid: LandGrid;
	/** Rain-weighted drainage area a cell needs to be river: `riverDensity`'s. */
	readonly threshold: number;
	/** The water stage's drainage: each cell's downstream neighbour, -1 where drainage leaves... */
	readonly receivers: Int32Array;
	/** ...and the rain that drains through it, its own included. */
	readonly area: Float64Array;
	/** Per cell, 0 dry to 1 wet: moisture before the rivers, wetter beside them. */
	readonly moisture: Float32Array;
	/** Per cell, 1 on ground barely above the river or lake it drains to, 0 well above it. */
	readonly lowland: Float32Array;
	/** Per cell, 0 to 1: deep in a river valley cut into dry country, 0.5 and up being canyons. */
	readonly canyons: Float32Array;
	/** Per cell, a lake's level less the land under it, and less than 0 away from lakes: its bilinear zero is the shore. */
	readonly lakeDepth: Float32Array;
	/** Per cell, the lake over it, an index into `lakes`, or -1. */
	readonly lakeOf: Int16Array;
	readonly rivers: readonly RiverInfo[];
	readonly lines: RiverLines;
	readonly lakes: readonly Lake[];
}

/**
 * Moisture before the rivers: the map's level, `spread` either way from a
 * noise layer `wavelength` world units across, less `height` a unit of
 * elevation.
 */
const MOISTURE = { wavelength: 650, octaves: 2, gain: 0.5, spread: 0.55, height: 0.6 } as const;
/** Rain per cell: `base` plus moisture before the rivers, times one plus `ranges` of the range mask. */
const RAIN = { base: 0.5, moisture: 1, ranges: 0.6 } as const;
/**
 * The routing's noise: `amplitude` of elevation over `wavelength` world
 * units, one octave. Its steepest grade is under a hundredth.
 */
export const FLATS = { amplitude: 0.0015, wavelength: 80 } as const;
/**
 * Wetness beside a river or lake: `creek` at the stream threshold, growing
 * by `gain` a unit of the square root of the area's multiple of it, up to 1
 * on big rivers and lakes; fading to nothing `reach` world units along the
 * drainage from the water and `height` world units above it. Moisture gains
 * `moisture` of it.
 */
const WETNESS = { creek: 0.5, gain: 0.1, reach: 120, height: 12, moisture: 0.35 } as const;
/**
 * Low ground: 1 on the river or lake a cell drains to, 0.5 at the map's
 * lowland level above it, 0 at twice that. The level is the height above
 * its water `share` of the land outside the ranges lies under, past the
 * relief radius and inside the disc, so a rugged map has as much low ground
 * as a gentle one; never under `least` world units.
 */
const LOWLAND = { share: 0.45, least: 1 } as const;
/**
 * Canyons: river valleys at least `reach` cells deep across, spreading
 * `width` world units out from the river and up to the valley's rim,
 * `share` of the land outside the ranges on maps of dryness `dryness` and
 * more, none `drynessRange` short of it.
 */
const CANYONS = { reach: 3, width: 24, share: 0.1, dryness: 0.45, drynessRange: 0.1 } as const;
/** World units across the buckets rivers are filed in. */
const RIVER_BUCKET = 16;

// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const SQRT2 = Math.SQRT2;

export interface WaterOptions {
	/** Resolved and validated. */
	readonly params: MapParams;
	/** The terrain stage's land, without water. */
	readonly terrain: Terrain;
	/** The stage's stream, nested in terrain's winning one; water forks it by feature and never draws from it directly. */
	readonly rng: Rng;
}

/** Stage 2: the water for a terrain. */
export function generateWater({ params, terrain, rng }: WaterOptions): Water {
	const land = terrain.surface;
	const { grid, elevation, mountains, drainage, closedBasin } = land;
	const size = grid.size;
	const cells = size * size;

	const before = moistureBeforeRivers({ grid, elevation, wetness: moistureLevel(params.aridity), rng: rng.fork('moisture') });
	const rain = new Float64Array(cells);
	for (let cell = 0; cell < cells; cell += 1) rain[cell] = (RAIN.base + RAIN.moisture * before[cell]) * (1 + RAIN.ranges * mountains[cell]);
	const routed = routeDrainage({ size, elevation: roughened({ grid, elevation, rng: rng.fork('flats') }), outlets: drainage.outlets, rain });
	const { receivers, area, order } = routed;
	const threshold = riverThreshold(params.riverDensity);

	const lakes = emptyLakeCells(cells);
	if (params.lakes > 0) {
		const blocked = lakeBlocked({ grid, terrain });
		naturalLakes({ grid, elevation, levels: drainage.levels, moisture: before, relief: RELIEF, blocked, into: lakes });
		placeReservoirs({
			grid, elevation, receivers, area, threshold, count: params.lakes, radius: params.radius,
			inner: startRadii(params).reliefRadius, relief: RELIEF, blocked, rng: rng.fork('reservoirs'), into: lakes,
		});
	}

	const chains = traceRivers({ receivers, area, threshold, lakeOf: lakes.lakeOf, closedBasin });
	const lines = riverPolylines({
		grid, chains, area, threshold, elevation, meander: params.riverMeander, noise: new SimplexNoise({ rng: rng.fork('meander') }), relief: RELIEF,
	});
	// A river that joins another or a lake ends on a cell of that, so its size is its last cell before it.
	const rivers: RiverInfo[] = chains.map(({ cells: path, start, end, into }) => ({
		start, end, into, area: area[path[(end === 'confluence' || end === 'lake') && path.length > 1 ? path.length - 2 : path.length - 1]],
	}));

	const near = nearestWater({ grid, elevation, receivers, order, area, threshold, lakes });
	const { reliefRadius } = startRadii(params);
	const lowLevel = quantileAbove(landValues({ surface: land, radius: params.radius, reliefRadius, values: near.above, ranges: false }), 1 - LOWLAND.share);
	const twiceLow = 2 * (lowLevel > LOWLAND.least ? lowLevel : LOWLAND.least);
	const moisture = new Float32Array(cells);
	const lowland = new Float32Array(cells);
	for (let cell = 0; cell < cells; cell += 1) {
		const above = near.above[cell];
		const wetness = near.strength[cell] * (1 - smooth01(near.along[cell] / WETNESS.reach)) * (1 - smooth01(above / WETNESS.height));
		moisture[cell] = clamp01(before[cell] + WETNESS.moisture * wetness);
		lowland[cell] = 1 - smooth01(above / twiceLow);
	}
	const canyons = canyonField({ params, terrain, elevation, near, lakes, area, threshold });

	return new Water({
		terrain,
		surface: {
			grid, threshold, receivers, area,
			moisture, lowland, canyons, lakeDepth: lakeDepthField({ grid, elevation, lakes }), lakeOf: Int16Array.from(lakes.lakeOf), rivers, lines, lakes: lakes.lakes,
		},
	});
}

/** The water over a terrain from a surface the water stage made, here or in a worker: rebuilds the river index, nothing else. */
export function waterFromSurface({ terrain, surface }: { terrain: Terrain; surface: WaterSurface }): Water {
	const expected = landGridFor(terrain.radius);
	const { grid } = surface;
	if (grid.size !== expected.size || grid.cellSize !== expected.cellSize || grid.halfExtent !== expected.halfExtent) {
		throw new RangeError(`waterFromSurface: the surface's grid (${grid.size} cells over ${grid.halfExtent}) isn't the terrain's (${expected.size} over ${expected.halfExtent})`);
	}
	const cells = grid.size * grid.size;
	[surface.receivers, surface.area, surface.moisture, surface.lowland, surface.canyons, surface.lakeDepth, surface.lakeOf].forEach((values) => {
		if (values.length !== cells) throw new RangeError(`waterFromSurface: a surface array holds ${values.length} values, not the grid's ${cells}`);
	});
	const { lines } = surface;
	if (lines.offsets.length !== surface.rivers.length + 1 || lines.points.length !== 2 * lines.widths.length || lines.widths.length !== lines.offsets[surface.rivers.length]) {
		throw new RangeError('waterFromSurface: the river lines don\'t match the rivers');
	}
	return new Water({ terrain, surface });
}

/** A water surface frozen, its arrays shared, not copied. Typed arrays can't be frozen, so they stay read-only by contract alone. */
export function freezeWaterSurface({ grid, lines, rivers, lakes, ...surface }: WaterSurface): WaterSurface {
	return Object.freeze({
		...surface,
		grid: Object.freeze({ ...grid }),
		lines: Object.freeze({ ...lines }),
		rivers: Object.freeze(rivers.map((river) => Object.freeze({ ...river }))),
		lakes: Object.freeze(lakes.map(({ dam, ...lake }) => Object.freeze({ ...lake, dam: dam ? Object.freeze({ ...dam }) : null }))),
	});
}

/**
 * The water stage's output, read as fields and places: where the water is,
 * the moisture, low ground, and canyons beside it, and the rivers a move
 * crosses. Sampling allocates nothing.
 */
export class Water implements WaterLayer {
	public readonly surface: WaterSurface;
	/** The land with this water: what everything after the water stage reads. */
	public readonly terrain: Terrain;
	private readonly moistureGrid: GridSampler;
	private readonly lowlandGrid: GridSampler;
	private readonly canyonGrid: GridSampler;
	private readonly lakeGrid: GridSampler;
	private readonly index: RiverIndex;

	constructor({ terrain, surface }: { terrain: Terrain; surface: WaterSurface }) {
		this.surface = freezeWaterSurface(surface);
		const { grid } = this.surface;
		this.moistureGrid = new GridSampler({ grid, values: this.surface.moisture });
		this.lowlandGrid = new GridSampler({ grid, values: this.surface.lowland });
		this.canyonGrid = new GridSampler({ grid, values: this.surface.canyons });
		this.lakeGrid = new GridSampler({ grid, values: this.surface.lakeDepth });
		this.index = new RiverIndex({ lines: this.surface.lines, extent: grid.halfExtent, bucket: RIVER_BUCKET });
		this.terrain = terrain.withWater(this);
	}

	public get rivers(): readonly RiverInfo[] {
		return this.surface.rivers;
	}

	public get lines(): RiverLines {
		return this.surface.lines;
	}

	public get lakes(): readonly Lake[] {
		return this.surface.lakes;
	}

	/** A lake, a river, or neither at (x, y); a lake where both are. */
	public waterAt(x: number, y: number): WaterKind | null {
		if (this.lakeGrid.bilinear(x, y) > 0) return 'lake';
		if (this.index.contains(x, y)) return 'river';
		return null;
	}

	/** True where a river's water lies within `reach` world units of (x, y). */
	public nearRiver(x: number, y: number, reach: number): boolean {
		return this.index.near(x, y, reach);
	}

	/** A lake's depth at (x, y) as elevation, less than 0 on land; 0 at the shore. */
	public lakeDepth(x: number, y: number): number {
		return this.lakeGrid.bilinear(x, y);
	}

	public moisture(x: number, y: number): number {
		return this.moistureGrid.bilinear(x, y);
	}

	public lowland(x: number, y: number): number {
		return this.lowlandGrid.bilinear(x, y);
	}

	public canyons(x: number, y: number): number {
		return this.canyonGrid.bilinear(x, y);
	}

	public riverCrossings(x0: number, y0: number, x1: number, y1: number): number {
		return this.index.crossings(x0, y0, x1, y1);
	}

	public riverCrossing(index: number): RiverCrossing {
		return this.index.crossing(index);
	}
}

/** Moisture per cell before the rivers: the map's level, a noise layer, and drier with height. */
function moistureBeforeRivers({ grid, elevation, wetness, rng }: { grid: LandGrid; elevation: Float64Array; wetness: number; rng: Rng }): Float64Array {
	const noise = new SimplexNoise({ rng });
	const size = grid.size;
	const moisture = new Float64Array(size * size);
	const frequency = 1 / MOISTURE.wavelength;
	for (let row = 0; row < size; row += 1) {
		const y = cellCentre(grid, row) * frequency;
		for (let column = 0; column < size; column += 1) {
			const cell = row * size + column;
			const spread = MOISTURE.spread * noise.fractal(cellCentre(grid, column) * frequency, y, MOISTURE.octaves, MOISTURE.gain);
			moisture[cell] = clamp01(wetness + spread - MOISTURE.height * elevation[cell]);
		}
	}
	return moisture;
}

/** The land with the routing's noise added: `FLATS`, under a hundredth of grade, which only flat ground notices. */
function roughened({ grid, elevation, rng }: { grid: LandGrid; elevation: Float64Array; rng: Rng }): Float64Array {
	const noise = new SimplexNoise({ rng });
	const size = grid.size;
	const out = new Float64Array(size * size);
	const frequency = 1 / FLATS.wavelength;
	for (let row = 0; row < size; row += 1) {
		const y = cellCentre(grid, row) * frequency;
		for (let column = 0; column < size; column += 1) {
			const cell = row * size + column;
			out[cell] = elevation[cell] + FLATS.amplitude * noise.sample(cellCentre(grid, column) * frequency, y);
		}
	}
	return out;
}

/**
 * Cells no lake may cover: inside the blend radius round the metro, and on
 * the grid's outer cells, where drainage leaves. 1 where blocked. Craters
 * and places come after the water and keep off the lakes themselves.
 */
function lakeBlocked({ grid, terrain }: { grid: LandGrid; terrain: Terrain }): Uint8Array {
	const size = grid.size;
	const blocked = new Uint8Array(size * size);
	const blendSquared = terrain.blendRadius * terrain.blendRadius;
	for (let row = 0; row < size; row += 1) {
		const y = cellCentre(grid, row);
		for (let column = 0; column < size; column += 1) {
			const x = cellCentre(grid, column);
			if (row === 0 || column === 0 || row === size - 1 || column === size - 1 || x * x + y * y < blendSquared) blocked[row * size + column] = 1;
		}
	}
	return blocked;
}

/** For each cell, the water its drainage reaches first: how far along the drainage, how high above it, which cell, and how wet it makes the land beside it. */
interface NearestWater {
	/** World units along the drainage to the river or lake. */
	readonly along: Float64Array;
	/** World units above its surface, never below 0. */
	readonly above: Float64Array;
	/** The river or lake cell reached. */
	readonly cell: Int32Array;
	/** 0 to 1: how much wetness that water spreads. */
	readonly strength: Float64Array;
}

/**
 * Walks the routing downstream first, so each cell's receiver is done before
 * it: a river or lake cell, or an outlet, is its own water; anything else
 * takes its receiver's, one step further along.
 */
function nearestWater({ grid, elevation, receivers, order, area, threshold, lakes }: {
	grid: LandGrid; elevation: Float64Array; receivers: Int32Array; order: Int32Array; area: Float64Array; threshold: number; lakes: LakeCells;
}): NearestWater {
	const size = grid.size;
	const cells = size * size;
	const along = new Float64Array(cells);
	const above = new Float64Array(cells);
	const cellOf = new Int32Array(cells);
	const strength = new Float64Array(cells);
	const surface = new Float64Array(cells);
	const diagonal = grid.cellSize * SQRT2;
	for (let index = 0; index < cells; index += 1) {
		const cell = order[index];
		const receiver = receivers[cell];
		const inLake = lakes.lakeOf[cell] >= 0;
		if (inLake || receiver < 0 || area[cell] >= threshold) {
			cellOf[cell] = cell;
			surface[cell] = inLake ? lakes.level[cell] : elevation[cell];
			strength[cell] = inLake ? 1 : clamp01(WETNESS.creek + WETNESS.gain * (sqrt(area[cell] / threshold) - 1));
			continue;
		}
		const step = receiver - cell;
		along[cell] = along[receiver] + (step === 1 || step === -1 || step === size || step === -size ? grid.cellSize : diagonal);
		cellOf[cell] = cellOf[receiver];
		surface[cell] = surface[receiver];
		strength[cell] = strength[receiver];
	}
	for (let cell = 0; cell < cells; cell += 1) {
		const height = (elevation[cell] - surface[cell]) * RELIEF;
		above[cell] = height > 0 ? height : 0;
	}
	return { along, above, cell: cellOf, strength };
}

/**
 * Canyons per cell, 0 to 1: river valleys cut deepest into dry country. A
 * river cell's cut is how deep a valley it runs in (`valleyDepth`); the
 * cells draining to it within `CANYONS.width` along the drainage, and below
 * the valley's rim, share it. Calibrated like the other features: 0.5 where
 * the cut passes the quantile `share` of the land outside the ranges lies
 * above, past the relief radius and inside the disc, ramping over a quarter
 * of it either way. Only where badlands would have room (`featureRoom`): none
 * in the metro, easing in to the relief radius, and none at the foot of the
 * ranges, whose flanks cut as deep. None at all on a map wetter than the
 * canyons' dryness.
 */
function canyonField({ params, terrain, elevation, near, lakes, area, threshold }: {
	params: MapParams; terrain: Terrain; elevation: Float64Array; near: NearestWater; lakes: LakeCells; area: Float64Array; threshold: number;
}): Float32Array {
	const surface = terrain.surface;
	const size = surface.grid.size;
	const cells = size * size;
	const field = new Float32Array(cells);
	const dryness = 1 - moistureLevel(params.aridity);
	const share = CANYONS.share * smooth01((dryness - CANYONS.dryness) / CANYONS.drynessRange);
	if (!(share > 0)) return field;
	const cut = new Float64Array(cells);
	for (let cell = 0; cell < cells; cell += 1) {
		if (area[cell] >= threshold && lakes.lakeOf[cell] < 0) cut[cell] = valleyDepth(elevation, size, cell, CANYONS.reach);
	}
	const { metroRadius, reliefRadius } = startRadii(params);
	const room = featureRoom({ surface, metroRadius, reliefRadius });
	const values = new Float64Array(cells);
	for (let cell = 0; cell < cells; cell += 1) {
		const depth = cut[near.cell[cell]];
		if (depth > 0 && room[cell] > 0 && near.along[cell] <= CANYONS.width && near.above[cell] < depth * RELIEF) values[cell] = depth * room[cell];
	}
	const level = positiveQuantile(landValues({ surface, radius: params.radius, reliefRadius, values, ranges: false }), share);
	if (level === Infinity) return field;
	for (let cell = 0; cell < cells; cell += 1) field[cell] = smooth01((values[cell] / level - 1) * 2 + 0.5);
	return field;
}
