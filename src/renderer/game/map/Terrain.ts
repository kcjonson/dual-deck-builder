import { Rng } from '../core/Rng';
import { BIOME_COSTS, Biome, BiomeFields, classifyBiome } from './Biome';
import { LandSurface, RELIEF, generateLand, moistureLevel, startRadii } from './Land';
import { GridSampler, cellCentre, landGridFor } from './LandGrid';
import { clamp01, lerp, quantileAbove, smooth01 } from './MapMath';
import { MapParams } from './MapParams';
import { SimplexNoise } from './Noise';
import { Hotspot, MAX_CRATER_RADIUS, Ruin, placeHotspots, placeTowns } from './TerrainSites';

/**
 * Stage 1 of area map generation, terrain (Area Map Generation, Pipeline,
 * 1. Terrain): the eroded land (Land.ts) read as fields over the disc, the
 * biomes read off them, the metro and towns, hotspots, what's impassable,
 * and what it costs to travel. Every query is a function of (x, y) in world
 * units, the compound at the origin, so later stages and the renderer
 * sample it at whatever resolution they need. Building one erodes the land
 * and precomputes the rest of the per-map parts (noise permutations,
 * calibrated thresholds, hotspots, towns); sampling allocates nothing.
 *
 * Elevation is the eroded grid sampled bicubic, plus a little fine noise in
 * range country for the picture, and carries its exact gradient, so slope
 * costs no extra samples. Moisture, contamination, hotspots, rough country,
 * and cost are the water and hazards stages' to rework (DDB-289); they're
 * kept here, adapted to the new land, so the stages after keep working.
 * Starting values throughout are for the Map Lab to tune; the land's are in
 * docs/AI_TECHNICAL_DECISIONS/terrain-erosion.md and the rest in
 * terrain-fields.md.
 */

/** Why ground is impassable. Water comes from the water stage, through `withWater`. */
export type Obstacle = 'crater' | 'cliff' | 'water';

/**
 * Rivers and lakes, from the water stage, which traces them over this
 * terrain's drainage and hands them back through `Terrain.withWater`. One
 * question for now; the water stage widens it to tell lakes from rivers and
 * give a river's flow, which square-on bridge crossings need.
 */
export interface WaterLayer {
	/** True where (x, y) is in a river or standing water. */
	isWater(x: number, y: number): boolean;
}

/** Everything about one point; `Terrain.sample` fills one in, so a caller can reuse it. */
export interface TerrainSample extends BiomeFields {
	elevation: number;
	lowland: number;
	moisture: number;
	contamination: number;
	mountains: number;
	canyons: number;
	badlands: number;
	/** Elevation's gradient: its change per world unit east... */
	slopeX: number;
	/** ...and north. Downhill is against it. */
	slopeY: number;
	/** Rise over run, elevation 1 standing `RELIEF` world units high. */
	grade: number;
	/** 1 in a ruin, fading to 0 at twice its radius. */
	ruin: number;
	biome: Biome;
	obstacle: Obstacle | null;
	/** `travelCost` here. */
	cost: number;
}

export function createTerrainSample(): TerrainSample {
	return {
		elevation: 0, lowland: 0, moisture: 0, contamination: 0, mountains: 0, canyons: 0, badlands: 0,
		slopeX: 0, slopeY: 0, grade: 0, ruin: 0, biome: 'scrub', obstacle: null, cost: 0,
	};
}

export interface TerrainOptions {
	/** Resolved and validated. */
	params: MapParams;
	/** The stage's stream: the pipeline's `terrain` fork. Terrain forks it by feature, never draws from it directly. */
	rng: Rng;
}

/** Stage 1: the terrain for validated params, from the `terrain` stream. */
export function generateTerrain({ params, rng }: TerrainOptions): Terrain {
	return terrainFromSurface({ params, rng, surface: generateLand({ params, rng }) });
}

/**
 * The terrain over land already grown for these params and this stream, by
 * `generateLand` here or in a worker: everything but the erosion, which is
 * most of the time. The surface has to be the land those params grow, on
 * their grid; the rest of the terrain is rebuilt from the stream.
 */
export function terrainFromSurface({ params, rng, surface }: TerrainFieldsOptions): Terrain {
	return new Terrain({ fields: new TerrainFields({ params, rng, surface }) });
}

export { RELIEF };
/** Rise over run at which ground in rough country is a cliff, impassable. */
export const CLIFF_GRADE = 1;
/** Travel cost added at the cliff grade, rising with the square of the grade. */
export const SLOPE_COST = 3;

/** Fine relief in range country, for the picture: as much as this, times the range mask. */
const DETAIL = { wavelength: 60, octaves: 3, gain: 0.5, amplitude: 0.006 };
const MOISTURE = {
	wavelength: 650, octaves: 2, gain: 0.5,
	/** How far moisture strays from the map's level. */
	spread: 0.55,
	/** Moisture gained per unit of elevation below the map's lowland level, lost above it. */
	lowland: 0.5,
};
/**
 * Low ground, a stand-in until the water stage reads wet lowland off its
 * rivers: the map's lowland level is the elevation `share` of the land
 * outside the ranges, past the relief radius and inside the disc, lies
 * under, and `lowland` goes from 1 to 0 over `ramp` of elevation across it.
 * Measured on each map's own land, so the share of low ground doesn't
 * follow how tall the land stands.
 */
const LOWLAND = { share: 0.55, ramp: 0.02 };
/**
 * Rough country: the only ground where a cliff can stand. Ruggedness sets
 * its share of the land past the metro's surroundings, kept well under half
 * so it breaks into islands and the land between connects across the map.
 * It's decided per cell of a `cell`-unit lattice, so a flood fill over the
 * cells that aren't rough is exact: no cliff stands in any of them.
 */
const ROUGHNESS = { wavelength: 360, octaves: 2, gain: 0.5, share: { min: 0.1, max: 0.35 }, cell: 16 };
/**
 * Canyons, until the water stage reads them off its rivers: the valleys cut
 * deepest into the land, measured across `reach` cells either side, `share`
 * of the land outside the ranges on dry maps. The map's dryness (1 - its
 * moisture level) where they begin, and over how much more they reach their
 * full share.
 */
const CANYONS = { reach: 3, share: 0.1, dryness: 0.45, drynessRange: 0.1 };
/**
 * Badlands, likewise: the most broken ground away from the ranges, the
 * curvature of the land averaged over `blur` cells; its share this times
 * ruggedness, weighted by contamination.
 */
const BADLANDS = { blur: 3, share: 0.7 };
/** Canyons and badlands go from none to full over a quarter of their threshold either side of it. */
const FEATURE_SHARPNESS = 2;
/** Canyons and badlands keep `reach` cells off any range lift, and off a range mask of `mask` entirely. */
const RANGE_CLEARANCE = { reach: 3, mask: 0.1 };
const CONTAMINATION = {
	wavelength: 450, octaves: 2, gain: 0.5,
	/** Contamination goes from none to full over 1 / this of noise around the calibrated threshold. */
	sharpness: 3,
};
/** Inside the metro moisture is scrub's middling level. */
const START_MOISTURE = 0.45;
/** Lattice spacing, as a share of the radius, for the samples thresholds are calibrated on. */
const CALIBRATION_SPACING = 0.05;

const DETAIL_FREQUENCY = 1 / DETAIL.wavelength;
const MOISTURE_FREQUENCY = 1 / MOISTURE.wavelength;
const CONTAMINATION_FREQUENCY = 1 / CONTAMINATION.wavelength;
const ROUGHNESS_FREQUENCY = 1 / ROUGHNESS.wavelength;
/** A slope's squared gradient at the cliff grade. */
const CLIFF_SLOPE_SQUARED = (CLIFF_GRADE / RELIEF) * (CLIFF_GRADE / RELIEF);

/** What `land`, `landFeatures`, and `landMoisture` leave behind for the callers that need more than elevation. */
interface LandFields {
	elevation: number;
	lowland: number;
	moisture: number;
	contamination: number;
	mountains: number;
	canyons: number;
	badlands: number;
	slopeX: number;
	slopeY: number;
}

export interface TerrainFieldsOptions extends TerrainOptions {
	/** The eroded land these fields read: `generateLand`'s for the same params, never written. */
	surface: LandSurface;
}

/**
 * The land: every field, the features, and the parts of impassability and
 * cost that don't need water. Built once per map by `generateTerrain`;
 * `Terrain` is what stages use.
 */
export class TerrainFields {
	public readonly radius: number;
	public readonly surface: LandSurface;
	/** The metro, around the compound; moisture is scrub's in it, the land is flat, and nothing is impassable. */
	public readonly metro: Ruin;
	public readonly towns: readonly Ruin[];
	public readonly hotspots: readonly Hotspot[];
	/** Out to this moisture and contamination blend from the metro's to their own. */
	public readonly blendRadius: number;
	/** Out to this the ranges rise to full, and no cliff stands inside it. */
	public readonly reliefRadius: number;

	private readonly elevationGrid: GridSampler;
	private readonly mountainGrid: GridSampler;
	private readonly canyonGrid: GridSampler;
	private readonly badlandsGrid: GridSampler;
	private readonly detailNoise: SimplexNoise;
	private readonly moistureNoise: SimplexNoise;
	private readonly roughNoise: SimplexNoise;
	private readonly contaminationNoise: SimplexNoise;

	/** Contamination noise above this is toxic: the `contamination` quantile. */
	private readonly contaminationThreshold: number;
	/** Where the contamination ramp bottoms out: values at or under this contribute nothing. */
	private readonly contaminationFloor: number;
	/** Roughness noise above this is rough country: the share `ruggedness` asks for. */
	private readonly roughFloor: number;
	/** Rough country by lattice cell, row by row from (-radius, -radius): 1 where a cliff can stand. */
	private readonly roughCells: Uint8Array;
	/** The cells a road from the metro reaches over ground no cliff or crater stands on: 1 where reached. */
	private readonly reachedCells: Uint8Array;
	private readonly cellColumns: number;

	private readonly wetness: number;
	/** The elevation `LOWLAND.share` of the land outside the ranges lies under. */
	private readonly lowlandLevel: number;
	private readonly startSquared: number;
	private readonly blendSquared: number;
	private readonly reliefSquared: number;
	/** Hotspots flattened for the per-sample loops: x, y, crater radius squared, plume radius squared, strength. */
	private readonly hotspotData: Float64Array;

	private readonly scratch: LandFields = {
		elevation: 0, lowland: 0, moisture: 0, contamination: 0, mountains: 0, canyons: 0, badlands: 0, slopeX: 0, slopeY: 0,
	};

	constructor({ params, rng, surface }: TerrainFieldsOptions) {
		const { radius } = params;
		const expected = landGridFor(radius);
		const { grid } = surface;
		if (grid.size !== expected.size || grid.cellSize !== expected.cellSize || grid.halfExtent !== expected.halfExtent) {
			throw new RangeError(`TerrainFields: the surface's grid (${grid.size} cells over ${grid.halfExtent}) isn't radius ${radius}'s (${expected.size} over ${expected.halfExtent})`);
		}
		const cells = grid.size * grid.size;
		const { drainage } = surface;
		[surface.elevation, surface.mountains, drainage.receivers, drainage.levels, drainage.area, drainage.order].forEach((values) => {
			if (values.length !== cells) throw new RangeError(`TerrainFields: a surface array holds ${values.length} values, not the grid's ${cells}`);
		});
		const { metroRadius, blendRadius, reliefRadius } = startRadii(params);
		this.radius = radius;
		this.surface = surface;
		this.metro = { x: 0, y: 0, radius: metroRadius };
		this.blendRadius = blendRadius;
		this.reliefRadius = reliefRadius;
		this.startSquared = metroRadius * metroRadius;
		this.blendSquared = blendRadius * blendRadius;
		this.reliefSquared = reliefRadius * reliefRadius;
		this.wetness = moistureLevel(params.aridity);

		this.elevationGrid = new GridSampler({ grid, values: surface.elevation });
		this.mountainGrid = new GridSampler({ grid, values: surface.mountains });
		this.lowlandLevel = quantileAbove(outsideRanges({ surface, radius, reliefRadius, values: surface.elevation }), 1 - LOWLAND.share);
		const canyonShare = CANYONS.share * smooth01((1 - this.wetness - CANYONS.dryness) / CANYONS.drynessRange);
		const badlandsShare = BADLANDS.share * params.ruggedness * (0.3 + 0.7 * params.contamination);
		const clear = canyonShare > 0 || badlandsShare > 0 ? featureRoom({ surface, metroRadius, reliefRadius }) : null;
		this.canyonGrid = new GridSampler({ grid, values: canyonField({ surface, radius, reliefRadius, share: canyonShare, clear }) });
		this.badlandsGrid = new GridSampler({ grid, values: badlandsField({ surface, radius, reliefRadius, share: badlandsShare, clear }) });

		this.detailNoise = new SimplexNoise({ rng: rng.fork('detail') });
		this.moistureNoise = new SimplexNoise({ rng: rng.fork('moisture') });
		this.roughNoise = new SimplexNoise({ rng: rng.fork('roughness') });
		this.contaminationNoise = new SimplexNoise({ rng: rng.fork('contamination') });

		this.roughFloor = this.calibrate((x, y) => this.roughNoise.fractal(x * ROUGHNESS_FREQUENCY, y * ROUGHNESS_FREQUENCY, ROUGHNESS.octaves, ROUGHNESS.gain), lerp(ROUGHNESS.share, params.ruggedness), reliefRadius);
		this.contaminationThreshold = this.calibrate((x, y) => this.contaminationNoise.fractal(x * CONTAMINATION_FREQUENCY, y * CONTAMINATION_FREQUENCY, CONTAMINATION.octaves, CONTAMINATION.gain), params.contamination, blendRadius);
		this.contaminationFloor = this.contaminationThreshold - 0.5 / CONTAMINATION.sharpness;

		this.hotspots = placeHotspots({
			rng: rng.fork('hotspots'),
			count: params.hotspots,
			radius,
			ring: { inner: blendRadius + MAX_CRATER_RADIUS, outer: 0.9 * radius },
		});
		this.hotspotData = new Float64Array(this.hotspots.length * 5);
		this.hotspots.forEach((hotspot, index) => {
			this.hotspotData.set([hotspot.x, hotspot.y, hotspot.craterRadius * hotspot.craterRadius, hotspot.plumeRadius * hotspot.plumeRadius, hotspot.strength], index * 5);
		});

		this.cellColumns = Math.ceil(2 * radius / ROUGHNESS.cell);
		this.roughCells = this.markRoughCells();
		this.reachedCells = this.reachFromMetro();

		const townRing = { inner: blendRadius, outer: 0.9 * radius };
		this.towns = placeTowns({
			rng: rng.fork('towns'),
			count: params.towns,
			radius,
			metroRadius,
			ring: townRing,
			hotspots: this.hotspots,
			cells: params.towns > 0 ? this.reachedCellsIn(townRing) : [],
			cellSize: ROUGHNESS.cell,
			// Every point of a reached cell is ground a road can get to; towns prefer open country.
			suits: (x, y, strict) => !strict || (this.mountainGrid.bilinear(x, y) < 0.25 && this.canyonGrid.bilinear(x, y) < 0.25),
		});
	}

	/** The elevation the map's low ground lies under, for the Map Lab and tests. */
	public get lowland(): number {
		return this.lowlandLevel;
	}

	public elevation(x: number, y: number): number {
		return this.land(x, y);
	}

	public moisture(x: number, y: number): number {
		this.land(x, y);
		return this.landMoisture(x, y);
	}

	/** 0 clean to 1 toxic: the calibrated noise, hotspot plumes over it, and nothing in the metro. */
	public contamination(x: number, y: number): number {
		const distanceSquared = x * x + y * y;
		if (distanceSquared <= this.startSquared) return 0;
		let contamination = 0;
		if (this.contaminationThreshold !== Infinity) {
			const noise = this.contaminationNoise.fractal(x * CONTAMINATION_FREQUENCY, y * CONTAMINATION_FREQUENCY, CONTAMINATION.octaves, CONTAMINATION.gain, this.contaminationFloor, Infinity);
			contamination = smooth01((noise - this.contaminationThreshold) * CONTAMINATION.sharpness + 0.5);
		}
		const hotspots = this.hotspotData;
		for (let index = 0; index < hotspots.length; index += 5) {
			const dx = x - hotspots[index];
			const dy = y - hotspots[index + 1];
			const hotspotSquared = dx * dx + dy * dy;
			const plumeSquared = hotspots[index + 3];
			if (hotspotSquared < plumeSquared) {
				const falloff = 1 - hotspotSquared / plumeSquared;
				const plume = hotspots[index + 4] * falloff * falloff;
				contamination += plume - contamination * plume;
			}
		}
		if (distanceSquared < this.blendSquared) contamination *= 1 - this.startWeight(distanceSquared);
		return contamination;
	}

	/** 1 inside the metro or a town, fading to 0 at twice its radius. */
	public ruin(x: number, y: number): number {
		let ruin = ruinWeight(x, y, this.metro);
		const towns = this.towns;
		for (let index = 0; index < towns.length && ruin < 1; index += 1) {
			const weight = ruinWeight(x, y, towns[index]);
			if (weight > ruin) ruin = weight;
		}
		return ruin;
	}

	public biome(x: number, y: number): Biome {
		this.land(x, y);
		this.landMoisture(x, y);
		this.landFeatures(x, y);
		this.scratch.contamination = this.contamination(x, y);
		return classifyBiome(this.scratch);
	}

	/** True inside a hotspot's crater. */
	public crater(x: number, y: number): boolean {
		const hotspots = this.hotspotData;
		for (let index = 0; index < hotspots.length; index += 5) {
			const dx = x - hotspots[index];
			const dy = y - hotspots[index + 1];
			if (dx * dx + dy * dy < hotspots[index + 2]) return true;
		}
		return false;
	}

	/** True in rough country, where steep ground is a cliff; elsewhere it's only costly. */
	public rough(x: number, y: number): boolean {
		const cell = this.cellAt(x, y);
		return cell >= 0 && this.roughCells[cell] === 1;
	}

	/** True in a lattice cell the flood fill from the metro got to; false only means not proven. */
	public surelyReachable(x: number, y: number): boolean {
		const cell = this.cellAt(x, y);
		return cell >= 0 && this.reachedCells[cell] === 1;
	}

	/** True on a cliff: grade `CLIFF_GRADE` or more, in rough country. Outside it, no elevation is read. */
	public cliff(x: number, y: number): boolean {
		if (!this.rough(x, y)) return false;
		this.land(x, y);
		return this.slopeSquared() >= CLIFF_SLOPE_SQUARED;
	}

	/** Rise over run at (x, y). */
	public grade(x: number, y: number): number {
		this.land(x, y);
		return Math.sqrt(this.slopeSquared()) * RELIEF;
	}

	/** Elevation's gradient at (x, y) into `out`, per world unit. Returns `out`. */
	public slope<Out extends { x: number; y: number }>(x: number, y: number, out: Out): Out {
		this.land(x, y);
		out.x = this.scratch.slopeX;
		out.y = this.scratch.slopeY;
		return out;
	}

	/** Travel cost without water: Infinity in a crater or on a cliff, else the biome's cost plus the slope term. */
	public cost(x: number, y: number): number {
		if (this.crater(x, y)) return Infinity;
		this.land(x, y);
		const slopeSquared = this.slopeSquared();
		if (this.cliffAt(x, y, slopeSquared)) return Infinity;
		this.landMoisture(x, y);
		this.landFeatures(x, y);
		this.scratch.contamination = this.contamination(x, y);
		return slopeCost(classifyBiome(this.scratch), slopeSquared);
	}

	/** Everything at (x, y) into `out`, water aside: its obstacle is a crater, a cliff, or none. Returns `out`. */
	public sample(x: number, y: number, out: TerrainSample): TerrainSample {
		const scratch = this.scratch;
		out.elevation = this.land(x, y);
		out.moisture = this.landMoisture(x, y);
		this.landFeatures(x, y);
		out.lowland = scratch.lowland;
		out.mountains = scratch.mountains;
		out.canyons = scratch.canyons;
		out.badlands = scratch.badlands;
		out.slopeX = scratch.slopeX;
		out.slopeY = scratch.slopeY;
		out.contamination = this.contamination(x, y);
		out.ruin = this.ruin(x, y);
		out.biome = classifyBiome(out);
		const slopeSquared = this.slopeSquared();
		out.grade = Math.sqrt(slopeSquared) * RELIEF;
		if (this.crater(x, y)) out.obstacle = 'crater';
		else if (this.cliffAt(x, y, slopeSquared)) out.obstacle = 'cliff';
		else out.obstacle = null;
		out.cost = out.obstacle === null ? slopeCost(out.biome, slopeSquared) : Infinity;
		return out;
	}

	/** The squared gradient the last `land` call left. */
	private slopeSquared(): number {
		const scratch = this.scratch;
		return scratch.slopeX * scratch.slopeX + scratch.slopeY * scratch.slopeY;
	}

	/** Whether ground at (x, y) with this squared slope is a cliff: steep enough, in rough country. */
	private cliffAt(x: number, y: number, slopeSquared: number): boolean {
		return slopeSquared >= CLIFF_SLOPE_SQUARED && this.rough(x, y);
	}

	/**
	 * Elevation at (x, y), with its gradient and the range mask left in
	 * `scratch`: the eroded grid, bicubic, plus fine relief as strong as the
	 * point is range country, held to 0 to 1.
	 */
	private land(x: number, y: number): number {
		const elevationGrid = this.elevationGrid;
		const mountainGrid = this.mountainGrid;
		let elevation = elevationGrid.bicubic(x, y);
		let slopeX = elevationGrid.gradientX;
		let slopeY = elevationGrid.gradientY;
		const mountains = mountainGrid.bicubic(x, y);
		// Bicubic mountains overshoot a little past a range's edge, which only
		// flips the detail's sign there; leaving it out instead would crease the
		// land where the mask crosses zero. Far from any range it's exactly 0.
		if (mountains !== 0) {
			const noise = this.detailNoise;
			const detail = noise.fractal(x * DETAIL_FREQUENCY, y * DETAIL_FREQUENCY, DETAIL.octaves, DETAIL.gain);
			const weight = DETAIL.amplitude * mountains;
			elevation += weight * detail;
			slopeX += DETAIL.amplitude * (mountainGrid.gradientX * detail + mountains * noise.derivativeX * DETAIL_FREQUENCY);
			slopeY += DETAIL.amplitude * (mountainGrid.gradientY * detail + mountains * noise.derivativeY * DETAIL_FREQUENCY);
		}
		if (elevation < 0 || elevation > 1) {
			elevation = elevation < 0 ? 0 : 1;
			slopeX = 0;
			slopeY = 0;
		}
		const scratch = this.scratch;
		scratch.elevation = elevation;
		scratch.mountains = clamp01(mountains);
		scratch.slopeX = slopeX;
		scratch.slopeY = slopeY;
		return elevation;
	}

	/**
	 * Moisture at (x, y), the point `land` was last called with, left in
	 * `scratch` too: the map's level, its own noise, wetter below the map's
	 * lowland level and drier above it, and scrub's in the metro.
	 */
	private landMoisture(x: number, y: number): number {
		const scratch = this.scratch;
		const noise = this.moistureNoise.fractal(x * MOISTURE_FREQUENCY, y * MOISTURE_FREQUENCY, MOISTURE.octaves, MOISTURE.gain);
		const moisture = clamp01(this.wetness + MOISTURE.spread * noise + MOISTURE.lowland * (this.lowlandLevel - scratch.elevation));
		scratch.moisture = moisture + (START_MOISTURE - moisture) * this.startWeight(x * x + y * y);
		return scratch.moisture;
	}

	/** Canyons, badlands, and low ground at (x, y), the point `land` was last called with, into `scratch`. */
	private landFeatures(x: number, y: number): void {
		const scratch = this.scratch;
		scratch.canyons = this.canyonGrid.bilinear(x, y);
		scratch.badlands = this.badlandsGrid.bilinear(x, y);
		scratch.lowland = smooth01((this.lowlandLevel - scratch.elevation) / LOWLAND.ramp + 0.5);
	}

	/** The lattice cell holding (x, y), or -1 off the lattice, which covers the disc's bounding square. */
	private cellAt(x: number, y: number): number {
		const column = (x + this.radius) / ROUGHNESS.cell;
		const row = (y + this.radius) / ROUGHNESS.cell;
		const columns = this.cellColumns;
		if (!(column >= 0 && row >= 0 && column < columns && row < columns)) return -1;
		return (row | 0) * columns + (column | 0);
	}

	/**
	 * Rough country by cell: a cell is rough when roughness noise at its
	 * centre is above the calibrated floor and the whole cell lies past the
	 * relief radius, so no cliff stands inside it.
	 */
	private markRoughCells(): Uint8Array {
		const columns = this.cellColumns;
		const cells = new Uint8Array(columns * columns);
		const noise = this.roughNoise;
		const floor = this.roughFloor;
		const half = ROUGHNESS.cell / 2;
		if (floor === Infinity) return cells;
		for (let row = 0; row < columns; row += 1) {
			const y = (row + 0.5) * ROUGHNESS.cell - this.radius;
			const nearY = Math.max(0, Math.abs(y) - half);
			for (let column = 0; column < columns; column += 1) {
				const x = (column + 0.5) * ROUGHNESS.cell - this.radius;
				// The cell's nearest point to the compound.
				const nearX = Math.max(0, Math.abs(x) - half);
				if (nearX * nearX + nearY * nearY < this.reliefSquared) continue;
				// Early out either way: only which side of the floor matters.
				const value = noise.fractal(x * ROUGHNESS_FREQUENCY, y * ROUGHNESS_FREQUENCY, ROUGHNESS.octaves, ROUGHNESS.gain, floor, floor);
				if (value > floor) cells[row * columns + column] = 1;
			}
		}
		return cells;
	}

	/**
	 * Which cells a road from the metro can reach: a flood fill from the
	 * metro's cell through cells wholly inside the disc, outside rough country
	 * (so no cliff stands in them), and clear of craters. 1 where reached.
	 * Exact for cliffs and craters by construction; water comes later.
	 */
	private reachFromMetro(): Uint8Array {
		const columns = this.cellColumns;
		const corner = ROUGHNESS.cell / 2 * Math.SQRT2;
		// Cells wholly inside the disc have their centres this close to the compound.
		const inside = this.radius - corner;
		const hotspots = this.hotspots;
		const open = new Uint8Array(columns * columns);
		for (let row = 0; row < columns; row += 1) {
			const y = (row + 0.5) * ROUGHNESS.cell - this.radius;
			for (let column = 0; column < columns; column += 1) {
				const index = row * columns + column;
				if (this.roughCells[index] === 1) continue;
				const x = (column + 0.5) * ROUGHNESS.cell - this.radius;
				if (inside <= 0 || x * x + y * y > inside * inside) continue;
				let touchesCrater = false;
				for (let hotspot = 0; hotspot < hotspots.length && !touchesCrater; hotspot += 1) {
					const reach = hotspots[hotspot].craterRadius + corner;
					const dx = x - hotspots[hotspot].x;
					const dy = y - hotspots[hotspot].y;
					touchesCrater = dx * dx + dy * dy < reach * reach;
				}
				if (!touchesCrater) open[index] = 1;
			}
		}
		const reached = new Uint8Array(columns * columns);
		const start = this.cellAt(0, 0);
		if (start < 0 || open[start] !== 1) return reached;
		const queue = [start];
		reached[start] = 1;
		const visit = (next: number) => {
			if (open[next] === 1 && reached[next] === 0) {
				reached[next] = 1;
				queue.push(next);
			}
		};
		while (queue.length > 0) {
			const index = queue.pop() as number;
			const column = index % columns;
			if (column > 0) visit(index - 1);
			if (column < columns - 1) visit(index + 1);
			if (index >= columns) visit(index - columns);
			if (index + columns < open.length) visit(index + columns);
		}
		return reached;
	}

	/** The centres of the reached cells whose centres lie in the ring, in lattice order. */
	private reachedCellsIn({ inner, outer }: { inner: number; outer: number }): { x: number; y: number }[] {
		const columns = this.cellColumns;
		const centres: { x: number; y: number }[] = [];
		for (let row = 0; row < columns; row += 1) {
			const y = (row + 0.5) * ROUGHNESS.cell - this.radius;
			for (let column = 0; column < columns; column += 1) {
				if (this.reachedCells[row * columns + column] !== 1) continue;
				const x = (column + 0.5) * ROUGHNESS.cell - this.radius;
				const distanceSquared = x * x + y * y;
				if (distanceSquared >= inner * inner && distanceSquared <= outer * outer) centres.push({ x, y });
			}
		}
		return centres;
	}

	/** 1 inside the metro, easing to 0 at the blend radius, on squared distance so no square root is taken. */
	private startWeight(distanceSquared: number): number {
		if (distanceSquared <= this.startSquared) return 1;
		if (distanceSquared >= this.blendSquared) return 0;
		return smooth01((this.blendSquared - distanceSquared) / (this.blendSquared - this.startSquared));
	}

	/**
	 * The value of `noise` above which `share` of the disc past `inner` lies,
	 * from a square lattice of samples over it. A share of 0 or less is
	 * +Infinity, so no value is above it, and 1 or more is -Infinity.
	 */
	private calibrate(noise: (x: number, y: number) => number, share: number, inner: number): number {
		if (share <= 0) return Infinity;
		if (share >= 1) return -Infinity;
		const step = CALIBRATION_SPACING * this.radius;
		const radiusSquared = this.radius * this.radius;
		const innerSquared = inner * inner;
		const samples: number[] = [];
		for (let row = 0; row * step < 2 * this.radius; row += 1) {
			const y = (row + 0.5) * step - this.radius;
			for (let column = 0; column * step < 2 * this.radius; column += 1) {
				const x = (column + 0.5) * step - this.radius;
				const distanceSquared = x * x + y * y;
				if (distanceSquared >= innerSquared && distanceSquared <= radiusSquared) samples.push(noise(x, y));
			}
		}
		return quantileAbove(samples, share);
	}
}

/**
 * The terrain stages read: the land's fields plus water, once the water
 * stage adds it, in what's impassable and what it costs to cross.
 */
export class Terrain {
	public readonly water: WaterLayer | null;
	private readonly land: TerrainFields;

	constructor({ fields, water = null }: { fields: TerrainFields; water?: WaterLayer | null }) {
		this.land = fields;
		this.water = water;
	}

	/** World units: the disc's radius, the compound at its centre. */
	public get radius(): number {
		return this.land.radius;
	}

	/**
	 * The eroded land on its grid, with the drainage of the finished land and
	 * its outlets, as plain typed arrays: what the water stage traces rivers
	 * and fills lakes from.
	 */
	public get surface(): LandSurface {
		return this.land.surface;
	}

	/** The metro's ruins around the compound, `metroSize` of the radius: the start, flat and never impassable. */
	public get metro(): Ruin {
		return this.land.metro;
	}

	/**
	 * Ruined towns out past the metro: up to `towns` of them, each where a road
	 * from the metro surely reaches it. A town is left out only when no reached
	 * cell's centre in the ring has room for it.
	 */
	public get towns(): readonly Ruin[] {
		return this.land.towns;
	}

	/** World units: out to this moisture and contamination blend from the metro's to their own. */
	public get blendRadius(): number {
		return this.land.blendRadius;
	}

	/** World units: out to this the ranges rise to full, and no cliff stands inside it. */
	public get reliefRadius(): number {
		return this.land.reliefRadius;
	}

	/** Blast sites and spills, `hotspots` of them. */
	public get hotspots(): readonly Hotspot[] {
		return this.land.hotspots;
	}

	/** The same land with water in what's impassable and what it costs. */
	public withWater(water: WaterLayer): Terrain {
		return new Terrain({ fields: this.land, water });
	}

	/** True inside the disc. */
	public contains(x: number, y: number): boolean {
		const radius = this.land.radius;
		return x * x + y * y <= radius * radius;
	}

	/** 0 to 1: outlets and valley floors to the highest peaks. */
	public elevation(x: number, y: number): number {
		return this.land.elevation(x, y);
	}

	/** Elevation's gradient at (x, y) into `out`, per world unit; downhill is against it. Returns `out`. */
	public slope<Out extends { x: number; y: number }>(x: number, y: number, out: Out): Out {
		return this.land.slope(x, y, out);
	}

	/** 0 dry to 1 wet. */
	public moisture(x: number, y: number): number {
		return this.land.moisture(x, y);
	}

	/** 0 clean to 1 toxic. */
	public contamination(x: number, y: number): number {
		return this.land.contamination(x, y);
	}

	/** 1 in the metro or a town, fading to 0 at twice its radius. */
	public ruin(x: number, y: number): number {
		return this.land.ruin(x, y);
	}

	public biome(x: number, y: number): Biome {
		return this.land.biome(x, y);
	}

	/** Rise over run at (x, y); `CLIFF_GRADE` and up is a cliff in rough country. */
	public grade(x: number, y: number): number {
		return this.land.grade(x, y);
	}

	/**
	 * True in rough country, the only ground where a cliff can stand: islands
	 * covering at most about a third of the land past the metro's
	 * surroundings, decided per cell of a 16-unit lattice. Elsewhere steep
	 * ground is only costly.
	 */
	public rough(x: number, y: number): boolean {
		return this.land.rough(x, y);
	}

	/**
	 * True where a road from the metro surely reaches: a cell of the 16-unit
	 * lattice that a flood fill from the metro gets to through cells that
	 * aren't rough, lie wholly inside the disc, and keep clear of craters, so
	 * no cliff or crater stands between. It's the test towns are placed by,
	 * and it's sufficient only: false means not proven, not a pocket. It reads
	 * false on all rough ground, on open ground rough cells ring off, and in
	 * cells at the rim or touching a crater, though roads often find a way
	 * through, and it ignores water. How much a road can reach is a fine flood
	 * fill over `impassable`.
	 */
	public surelyReachable(x: number, y: number): boolean {
		return this.land.surelyReachable(x, y);
	}

	/** Why (x, y) is impassable, or null: a crater, water, then a cliff. */
	public obstacle(x: number, y: number): Obstacle | null {
		if (this.land.crater(x, y)) return 'crater';
		if (this.water !== null && this.water.isWater(x, y)) return 'water';
		if (this.land.cliff(x, y)) return 'cliff';
		return null;
	}

	public impassable(x: number, y: number): boolean {
		return this.obstacle(x, y) !== null;
	}

	/**
	 * What a world unit of travel at (x, y) costs: the biome's base cost plus
	 * `SLOPE_COST` times the grade's square over the cliff grade's, so 1 on
	 * flat scrub, and more than `SLOPE_COST` on top only for steep ground
	 * outside rough country. Infinity on impassable ground.
	 */
	public travelCost(x: number, y: number): number {
		if (this.water !== null && this.water.isWater(x, y)) return Infinity;
		return this.land.cost(x, y);
	}

	/** Everything at (x, y) into `out`, sharing the work between fields. Returns `out`. */
	public sample(x: number, y: number, out: TerrainSample): TerrainSample {
		this.land.sample(x, y, out);
		if (this.water !== null && out.obstacle !== 'crater' && this.water.isWater(x, y)) {
			out.obstacle = 'water';
			out.cost = Infinity;
		}
		return out;
	}
}

interface FeatureOptions {
	surface: LandSurface;
	/** World units: the disc's radius, and the relief radius; a feature's share is of the land between, outside the ranges. */
	radius: number;
	reliefRadius: number;
	share: number;
	/** Per cell, 1 where canyons and badlands have room, 0 where they have none (see `featureRoom`); null when neither has a share. */
	clear: Float64Array | null;
}

/**
 * Canyons per cell, 0 to 1: the valleys cut deepest into the land away from
 * the ranges, `share` of the land outside them. A cell's cut is how far it
 * sits below the lower of the two cells `CANYONS.reach` away on either
 * side, across whichever of four directions cuts deepest, so a valley
 * counts and a slope doesn't. A stand-in until the water stage reads
 * canyons off its rivers.
 */
function canyonField({ surface, radius, reliefRadius, share, clear }: FeatureOptions): Float32Array {
	const { grid, elevation } = surface;
	const size = grid.size;
	if (share <= 0 || clear === null) return new Float32Array(size * size);
	const reach = CANYONS.reach;
	const cut = new Float64Array(size * size);
	const steps = [reach, reach * size, reach * (size + 1), reach * (size - 1)];
	for (let row = reach; row < size - reach; row += 1) {
		for (let column = reach; column < size - reach; column += 1) {
			const cell = row * size + column;
			let deepest = 0;
			for (let direction = 0; direction < 4; direction += 1) {
				const ahead = elevation[cell + steps[direction]];
				const behind = elevation[cell - steps[direction]];
				const depth = (ahead < behind ? ahead : behind) - elevation[cell];
				if (depth > deepest) deepest = depth;
			}
			cut[cell] = deepest * clear[cell];
		}
	}
	return calibratedField({ surface, radius, reliefRadius, share, values: cut });
}

/**
 * Badlands per cell, 0 to 1: the most broken ground away from the ranges,
 * `share` of the land outside them, broken being the land's curvature
 * blurred over `BADLANDS.blur` cells. A stand-in until the hazards stage
 * decides what badlands are on eroded land.
 */
function badlandsField({ surface, radius, reliefRadius, share, clear }: FeatureOptions): Float32Array {
	const { grid, elevation } = surface;
	const size = grid.size;
	if (share <= 0 || clear === null) return new Float32Array(size * size);
	const curvature = new Float64Array(size * size);
	for (let row = 1; row < size - 1; row += 1) {
		for (let column = 1; column < size - 1; column += 1) {
			const cell = row * size + column;
			const bend = elevation[cell - 1] + elevation[cell + 1] + elevation[cell - size] + elevation[cell + size] - 4 * elevation[cell];
			curvature[cell] = bend < 0 ? -bend : bend;
		}
	}
	const broken = blur(curvature, size, BADLANDS.blur);
	for (let cell = 0; cell < broken.length; cell += 1) broken[cell] *= clear[cell];
	return calibratedField({ surface, radius, reliefRadius, share, values: broken });
}

/**
 * Per cell, the room canyons and badlands have: 1 where no cell within
 * `RANGE_CLEARANCE.reach` has any range lift, falling to 0 where one's range
 * mask reaches `RANGE_CLEARANCE.mask`, since a range's flanks run on past its
 * mask's middle and bend the land at their foot as hard as any gully; and,
 * like the ranges, none in the metro, rising to full at the relief radius.
 */
function featureRoom({ surface, metroRadius, reliefRadius }: { surface: LandSurface; metroRadius: number; reliefRadius: number }): Float64Array {
	const { grid, mountains } = surface;
	const size = grid.size;
	const metroSquared = metroRadius * metroRadius;
	const reliefSquared = reliefRadius * reliefRadius;
	const reach = RANGE_CLEARANCE.reach;
	const across = new Float64Array(size * size);
	const clear = new Float64Array(size * size);
	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) {
			const first = column - reach < 0 ? 0 : column - reach;
			const last = column + reach >= size ? size - 1 : column + reach;
			let most = 0;
			for (let at = first; at <= last; at += 1) {
				if (mountains[row * size + at] > most) most = mountains[row * size + at];
			}
			across[row * size + column] = most;
		}
	}
	for (let row = 0; row < size; row += 1) {
		const first = row - reach < 0 ? 0 : row - reach;
		const last = row + reach >= size ? size - 1 : row + reach;
		const y = cellCentre(grid, row);
		for (let column = 0; column < size; column += 1) {
			let most = 0;
			for (let at = first; at <= last; at += 1) {
				if (across[at * size + column] > most) most = across[at * size + column];
			}
			const x = cellCentre(grid, column);
			const distanceSquared = x * x + y * y;
			const start = distanceSquared >= reliefSquared ? 1 : smooth01((distanceSquared - metroSquared) / (reliefSquared - metroSquared));
			clear[row * size + column] = start * (1 - smooth01(most / RANGE_CLEARANCE.mask));
		}
	}
	return clear;
}

/**
 * Per cell, 0 to 1: 0.5 where `values` passes the quantile that `share` of
 * the land outside the ranges, past the relief radius and inside the disc,
 * lies above, ramping over a quarter of it either way.
 */
function calibratedField({ surface, radius, reliefRadius, share, values }: Omit<FeatureOptions, 'clear'> & { values: Float64Array }): Float32Array {
	const field = new Float32Array(values.length);
	const threshold = quantileAbove(outsideRanges({ surface, radius, reliefRadius, values }), share);
	if (!(threshold > 0) || threshold === Infinity) return field;
	for (let cell = 0; cell < field.length; cell += 1) field[cell] = smooth01((values[cell] / threshold - 1) * FEATURE_SHARPNESS + 0.5);
	return field;
}

/**
 * `values` at the cells outside the ranges, past `reliefRadius` and inside
 * the disc: the land the stand-ins' shares are of. Where the ranges cover
 * all of it, the cells past `reliefRadius`, ranges and all.
 */
function outsideRanges({ surface, radius, reliefRadius, values }: { surface: LandSurface; radius: number; reliefRadius: number; values: ArrayLike<number> }): number[] {
	const { grid, mountains } = surface;
	const innerSquared = reliefRadius * reliefRadius;
	const outerSquared = radius * radius;
	const outside: number[] = [];
	const all: number[] = [];
	for (let row = 0; row < grid.size; row += 1) {
		const y = cellCentre(grid, row);
		for (let column = 0; column < grid.size; column += 1) {
			const x = cellCentre(grid, column);
			const distanceSquared = x * x + y * y;
			if (distanceSquared < innerSquared || distanceSquared > outerSquared) continue;
			const cell = row * grid.size + column;
			all.push(values[cell]);
			if (mountains[cell] < 0.5) outside.push(values[cell]);
		}
	}
	return outside.length > 0 ? outside : all;
}

/** A box blur `reach` cells each way along rows, then columns, held at the edges. */
function blur(values: ArrayLike<number>, size: number, reach: number): Float64Array {
	const across = new Float64Array(size * size);
	const out = new Float64Array(size * size);
	const span = 2 * reach + 1;
	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) {
			let sum = 0;
			for (let offset = -reach; offset <= reach; offset += 1) {
				const at = column + offset < 0 ? 0 : column + offset >= size ? size - 1 : column + offset;
				sum += values[row * size + at];
			}
			across[row * size + column] = sum / span;
		}
	}
	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) {
			let sum = 0;
			for (let offset = -reach; offset <= reach; offset += 1) {
				const at = row + offset < 0 ? 0 : row + offset >= size ? size - 1 : row + offset;
				sum += across[at * size + column];
			}
			out[row * size + column] = sum / span;
		}
	}
	return out;
}

/** Travel cost per world unit on passable ground: the biome's base cost plus the slope term. */
function slopeCost(biome: Biome, slopeSquared: number): number {
	return BIOME_COSTS[biome] + SLOPE_COST * (slopeSquared / CLIFF_SLOPE_SQUARED);
}

function ruinWeight(x: number, y: number, ruin: Ruin): number {
	const dx = x - ruin.x;
	const dy = y - ruin.y;
	const ratio = (dx * dx + dy * dy) / (ruin.radius * ruin.radius);
	if (ratio <= 1) return 1;
	if (ratio >= 4) return 0;
	return (4 - ratio) / 3;
}
