import { Rng } from '../core/Rng';
import { BIOME_COSTS, Biome, BiomeFields, classifyBiome } from './Biome';
import { MapParams } from './MapParams';
import { SimplexNoise } from './Noise';
import { Hotspot, MAX_CRATER_RADIUS, Ruin, placeHotspots, placeTowns } from './TerrainSites';

/**
 * Stage 1 of area map generation, terrain (Area Map Generation, Pipeline,
 * 1. Terrain): continuous fields over the disc, the biomes read off them,
 * the metro and towns, hotspots, what's impassable, and what it costs to
 * travel. Everything is a pure function of (x, y) in world units, the
 * compound at the origin, so later stages and the renderer sample it at
 * whatever resolution they need. Building one precomputes the per-map parts
 * (noise permutations, calibrated thresholds, hotspots, towns); sampling
 * allocates nothing.
 *
 * Elevation carries its exact gradient, worked through every term from the
 * noise's own derivatives, so slope costs no extra samples. Starting values
 * throughout are for the Map Lab to tune; the field model and its numbers are
 * in docs/AI_TECHNICAL_DECISIONS/terrain-fields.md.
 */

/** Why ground is impassable. Water comes from the water stage, through `withWater`. */
export type Obstacle = 'crater' | 'cliff' | 'water';

/**
 * Rivers and lakes, from the water stage, which traces them over this
 * terrain's elevation and hands them back through `Terrain.withWater`. One
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
		elevation: 0, moisture: 0, contamination: 0, mountains: 0, canyons: 0, badlands: 0,
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
	return new Terrain({ fields: new TerrainFields({ params, rng }) });
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

// Feature sizes are world units, not shares of the radius, so a bigger map
// has more of everything rather than bigger mountains, and roads, which step
// and keep clear in world units too, meet the same terrain on any map. A
// wavelength is roughly the size of one hill or patch; each octave of a
// fractal layer halves it.

/** Vertical scale for slopes: elevation 1 stands this many world units high. */
export const RELIEF = 150;
/** Rise over run at which ground in rough country is a cliff, impassable. */
export const CLIFF_GRADE = 1;
/** Travel cost added at the cliff grade, rising with the square of the grade. */
export const SLOPE_COST = 3;

/** Plains: rolling ground under everything. */
const BASE = { wavelength: 900, octaves: 3, gain: 0.45, level: 0.42, relief: 0.18 };
/** Mountain ranges: where they stand, and how they're ridged. */
const MOUNTAINS = {
	/** Ranges follow the zero lines of a broad layer... */
	rangeWavelength: 1300,
	/** ...broken into stretches by a finer one, weighted this much. */
	breakWavelength: 520, breakWeight: 0.25,
	/** The mask goes from none to full over 1 / this around the calibrated threshold. */
	maskSharpness: 4,
	ridgeWavelength: 300, ridgeOctaves: 3,
	/** The land a range stands on is this much higher than the plains around it. */
	lift: 0.06,
	/** Ridge height in rough country, at ruggedness 0 and 1. */
	height: { min: 0.2, max: 0.4 },
	/** Ridge octave gain, at ruggedness 0 and 1: rough ranges keep more fine detail. */
	gain: { min: 0.45, max: 0.62 },
};
const MOISTURE = {
	wavelength: 650, octaves: 2, gain: 0.5,
	/** How far moisture strays from the map's level. */
	spread: 0.55,
	/** Moisture gained per unit of elevation below the plains' level, lost above it. */
	lowland: 0.5,
};
/** Canyons: the zero lines of a noise layer, cut into dry country. */
const CANYONS = {
	wavelength: 520, octaves: 2, gain: 0.4,
	/** The map's dryness (1 - its moisture level) where canyons begin, and over how much more they reach full strength. */
	dryness: 0.35, drynessRange: 0.4,
	/** Strength at ruggedness 0 and 1, which sets width as well as depth. */
	strength: { min: 0.35, max: 1 },
	/** Half-width in canyon noise at strength 1. A canyon only the map's dryness makes faint is as wide, just shallower. */
	halfWidth: 0.15,
	/** Depth at full strength, in rough country. */
	depth: 0.2,
	/** The share of the half-width that's flat floor. */
	floor: 0.35,
	/** The share of the wall at each end over which its slope eases in and out; between, it rises at one grade. */
	wallEase: 0.2,
	/** Canyons fade out where a finer sample of their layer dips, leaving crossings. */
	gapWavelength: 420, gapLevel: 0.3, gapSharpness: 3,
};
/**
 * Rough country: the only ground where a cliff can stand, and where
 * mountains, canyons, and badlands rise to their full height. Elsewhere they
 * keep `floor` of it, and steep ground is only costly. Ruggedness sets rough
 * country's share of the land past the metro's surroundings, kept well under
 * half so it breaks into islands and the land between connects across the
 * map. It's decided per cell of a `cell`-unit lattice, so a flood fill over
 * the cells that aren't rough is exact: no cliff stands in any of them.
 */
const ROUGHNESS = {
	wavelength: 360, octaves: 2, gain: 0.5,
	/** Height climbs from `floor` to full over 1 / this of roughness noise above its calibrated floor. */
	sharpness: 5,
	share: { min: 0.1, max: 0.35 },
	floor: 0.3,
	cell: 16,
};
/** Badlands: patches of broken, gullied ground. */
const BADLANDS = {
	patchWavelength: 480, patchOctaves: 2, patchGain: 0.5,
	patchSharpness: 5,
	gullyWavelength: 60, gullyOctaves: 2, gullyGain: 0.5,
	/** Gully relief at ruggedness 0 and 1. */
	relief: { min: 0.03, max: 0.09 },
	/** The share of the map that's broken ground: this times ruggedness, weighted by contamination. */
	share: 0.7,
};
const CONTAMINATION = {
	wavelength: 450, octaves: 2, gain: 0.5,
	/** Contamination goes from none to full over 1 / this of noise around the calibrated threshold. */
	sharpness: 3,
};
/** Inside the metro the fields are scrub's: middling moisture, nothing toxic, the plains flattened this much. */
const START = { moisture: 0.45, flatten: 0.7 };
/** Lattice spacing, as a share of the radius, for the samples thresholds are calibrated on. */
const CALIBRATION_SPACING = 0.05;

const BASE_FREQUENCY = 1 / BASE.wavelength;
const RANGE_FREQUENCY = 1 / MOUNTAINS.rangeWavelength;
const BREAK_FREQUENCY = 1 / MOUNTAINS.breakWavelength;
const RIDGE_FREQUENCY = 1 / MOUNTAINS.ridgeWavelength;
const MOISTURE_FREQUENCY = 1 / MOISTURE.wavelength;
const CANYON_FREQUENCY = 1 / CANYONS.wavelength;
const CANYON_GAP_FREQUENCY = 1 / CANYONS.gapWavelength;
const PATCH_FREQUENCY = 1 / BADLANDS.patchWavelength;
const GULLY_FREQUENCY = 1 / BADLANDS.gullyWavelength;
const CONTAMINATION_FREQUENCY = 1 / CONTAMINATION.wavelength;
const ROUGHNESS_FREQUENCY = 1 / ROUGHNESS.wavelength;
/** Where single-octave layers and ridge octaves sample from, off the lattice points every layer shares at the origin. */
const RANGE_OFFSET = 7.31;
const BREAK_OFFSET = 23.17;
const GAP_OFFSET_X = 91.3;
const GAP_OFFSET_Y = 47.9;
const RIDGE_OFFSETS = [3.7, 57.1, 113.3];
/** A slope's squared gradient at the cliff grade. */
const CLIFF_SLOPE_SQUARED = (CLIFF_GRADE / RELIEF) * (CLIFF_GRADE / RELIEF);

/**
 * What `land` leaves behind for the callers that need more than elevation.
 * Moisture and contamination are theirs to fill, since elevation and slope
 * don't need them.
 */
interface LandFields {
	elevation: number;
	moisture: number;
	contamination: number;
	mountains: number;
	canyons: number;
	badlands: number;
	slopeX: number;
	slopeY: number;
	/** Elevation before canyons and badlands cut it, which moisture reads. */
	uplands: number;
	/** The start weight: 1 in the metro, 0 past the blend radius. */
	start: number;
}

/**
 * The land: every field, the features, and the parts of impassability and
 * cost that don't need water. Built once per map by `generateTerrain`;
 * `Terrain` is what stages use.
 */
export class TerrainFields {
	public readonly radius: number;
	/** The metro, around the compound; the fields are scrub's in it and nothing is impassable. */
	public readonly metro: Ruin;
	public readonly towns: readonly Ruin[];
	public readonly hotspots: readonly Hotspot[];
	/** Out to this the fields blend from scrub's to their own. */
	public readonly blendRadius: number;
	/** Out to this mountains, canyons, and badlands rise from nothing to full, and no cliff stands inside it. */
	public readonly reliefRadius: number;

	private readonly baseNoise: SimplexNoise;
	private readonly rangeNoise: SimplexNoise;
	private readonly breakNoise: SimplexNoise;
	private readonly ridgeNoise: SimplexNoise;
	private readonly moistureNoise: SimplexNoise;
	private readonly canyonNoise: SimplexNoise;
	private readonly patchNoise: SimplexNoise;
	private readonly gullyNoise: SimplexNoise;
	private readonly roughNoise: SimplexNoise;
	private readonly contaminationNoise: SimplexNoise;

	/** Range value above this is mountains: the `mountainCoverage` quantile. */
	private readonly maskThreshold: number;
	/** Patch noise above this is badlands. */
	private readonly patchThreshold: number;
	/** Contamination noise above this is toxic: the `contamination` quantile. */
	private readonly contaminationThreshold: number;
	/** Roughness noise above this is rough country: the share `ruggedness` asks for. */
	private readonly roughFloor: number;
	/** Where each ramp around a threshold bottoms out: values at or under these contribute nothing. */
	private readonly maskFloor: number;
	private readonly patchFloor: number;
	private readonly contaminationFloor: number;
	/** Rough country by lattice cell, row by row from (-radius, -radius): 1 where a cliff can stand. */
	private readonly roughCells: Uint8Array;
	/** The cells a road from the metro reaches over ground no cliff or crater stands on: 1 where reached. */
	private readonly reachedCells: Uint8Array;
	private readonly cellColumns: number;

	private readonly wetness: number;
	private readonly ruggedness: number;
	private readonly ridgeGain: number;
	private readonly ridgeHeight: number;
	/** Canyon strength from the map's dryness and ruggedness, 0 for none. */
	private readonly canyonStrength: number;
	private readonly canyonHalfWidth: number;
	private readonly gullyRelief: number;
	private readonly startSquared: number;
	private readonly blendSquared: number;
	private readonly reliefSquared: number;
	/** Hotspots flattened for the per-sample loops: x, y, crater radius squared, plume radius squared, strength. */
	private readonly hotspotData: Float64Array;

	private readonly scratch: LandFields = {
		elevation: 0, moisture: 0, contamination: 0, mountains: 0, canyons: 0, badlands: 0, slopeX: 0, slopeY: 0, uplands: 0, start: 0,
	};
	/** What each of `land`'s terms leaves behind: its gradient, per world unit, and its feature's value. */
	private partX = 0;
	private partY = 0;
	private partValue = 0;
	/** The gradients `rangeValue`, `ridge`, and `ruggedScale` leave behind, per world unit. */
	private rangeX = 0;
	private rangeY = 0;
	private ridgeX = 0;
	private ridgeY = 0;
	private ruggedX = 0;
	private ruggedY = 0;
	/** `ruggedScale` at the point `land` is on, worked out once per call however many terms ask. */
	private ruggedValue = 0;
	private ruggedReady = false;

	constructor({ params, rng }: TerrainOptions) {
		const { radius } = params;
		const metroRadius = params.metroSize * radius;
		this.radius = radius;
		this.metro = { x: 0, y: 0, radius: metroRadius };
		this.blendRadius = metroRadius + Math.max(0.5 * metroRadius, 0.06 * radius);
		this.reliefRadius = this.blendRadius + 0.1 * radius;
		this.startSquared = metroRadius * metroRadius;
		this.blendSquared = this.blendRadius * this.blendRadius;
		this.reliefSquared = this.reliefRadius * this.reliefRadius;

		this.wetness = moistureLevel(params.aridity);
		this.ruggedness = params.ruggedness;
		this.ridgeGain = lerp(MOUNTAINS.gain, params.ruggedness);
		this.ridgeHeight = lerp(MOUNTAINS.height, params.ruggedness);
		this.canyonStrength = smooth01((1 - this.wetness - CANYONS.dryness) / CANYONS.drynessRange) * lerp(CANYONS.strength, params.ruggedness);
		this.canyonHalfWidth = CANYONS.halfWidth * lerp(CANYONS.strength, params.ruggedness);
		this.gullyRelief = lerp(BADLANDS.relief, params.ruggedness);

		this.baseNoise = new SimplexNoise({ rng: rng.fork('plains') });
		this.rangeNoise = new SimplexNoise({ rng: rng.fork('ranges') });
		this.breakNoise = new SimplexNoise({ rng: rng.fork('rangeBreaks') });
		this.ridgeNoise = new SimplexNoise({ rng: rng.fork('ridges') });
		this.moistureNoise = new SimplexNoise({ rng: rng.fork('moisture') });
		this.canyonNoise = new SimplexNoise({ rng: rng.fork('canyons') });
		this.patchNoise = new SimplexNoise({ rng: rng.fork('badlands') });
		this.gullyNoise = new SimplexNoise({ rng: rng.fork('gullies') });
		this.roughNoise = new SimplexNoise({ rng: rng.fork('roughness') });
		this.contaminationNoise = new SimplexNoise({ rng: rng.fork('contamination') });

		const badlandsShare = BADLANDS.share * params.ruggedness * (0.3 + 0.7 * params.contamination);
		// Shares are of the land where each feature is at full strength, past
		// the start's blend: `mountainCoverage` 0.25 is a quarter of the country
		// beyond the metro's surroundings, whatever the metro's size.
		const reliefRing = this.reliefRadius;
		this.maskThreshold = this.calibrate((x, y) => this.rangeValue(x, y, -Infinity), params.mountainCoverage, reliefRing);
		this.patchThreshold = this.calibrate((x, y) => this.patchNoise.fractal(x * PATCH_FREQUENCY, y * PATCH_FREQUENCY, BADLANDS.patchOctaves, BADLANDS.patchGain), badlandsShare, reliefRing);
		this.roughFloor = this.calibrate((x, y) => this.roughNoise.fractal(x * ROUGHNESS_FREQUENCY, y * ROUGHNESS_FREQUENCY, ROUGHNESS.octaves, ROUGHNESS.gain), lerp(ROUGHNESS.share, params.ruggedness), reliefRing);
		this.contaminationThreshold = this.calibrate((x, y) => this.contaminationNoise.fractal(x * CONTAMINATION_FREQUENCY, y * CONTAMINATION_FREQUENCY, CONTAMINATION.octaves, CONTAMINATION.gain), params.contamination, this.blendRadius);
		this.maskFloor = this.maskThreshold - 0.5 / MOUNTAINS.maskSharpness;
		this.patchFloor = this.patchThreshold - 0.5 / BADLANDS.patchSharpness;
		this.contaminationFloor = this.contaminationThreshold - 0.5 / CONTAMINATION.sharpness;

		this.hotspots = placeHotspots({
			rng: rng.fork('hotspots'),
			count: params.hotspots,
			radius,
			ring: { inner: this.blendRadius + MAX_CRATER_RADIUS, outer: 0.9 * radius },
		});
		this.hotspotData = new Float64Array(this.hotspots.length * 5);
		this.hotspots.forEach((hotspot, index) => {
			this.hotspotData.set([hotspot.x, hotspot.y, hotspot.craterRadius * hotspot.craterRadius, hotspot.plumeRadius * hotspot.plumeRadius, hotspot.strength], index * 5);
		});

		this.cellColumns = Math.ceil(2 * radius / ROUGHNESS.cell);
		this.roughCells = this.markRoughCells();
		this.reachedCells = this.reachFromMetro();

		const townRing = { inner: this.blendRadius, outer: 0.9 * radius };
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
			suits: (x, y, strict) => {
				if (!strict) return true;
				this.land(x, y);
				return this.scratch.mountains < 0.25 && this.scratch.canyons <= 0;
			},
		});
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

	/** True where a road from the metro can surely reach: a lattice cell the flood fill got to. */
	public reachable(x: number, y: number): boolean {
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
		this.scratch.contamination = this.contamination(x, y);
		return slopeCost(classifyBiome(this.scratch), slopeSquared);
	}

	/** Everything at (x, y) into `out`, water aside: its obstacle is a crater, a cliff, or none. Returns `out`. */
	public sample(x: number, y: number, out: TerrainSample): TerrainSample {
		const scratch = this.scratch;
		out.elevation = this.land(x, y);
		out.moisture = this.landMoisture(x, y);
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
	 * Elevation at (x, y), with its gradient and the other land fields left in
	 * `scratch` (contamination isn't touched): the plains, then mountains,
	 * canyons, and badlands on top, each fading out toward the metro, where
	 * the plains flatten and moisture blends to scrub's. Each term's gradient
	 * is worked alongside it, from the noise layers' own derivatives.
	 */
	private land(x: number, y: number): number {
		this.ruggedReady = false;
		const distanceSquared = x * x + y * y;
		// The start and relief weights and their gradients, as functions of
		// distance squared, whose gradient is (2x, 2y): no square root taken.
		let start = 0;
		let startX = 0;
		let startY = 0;
		let relief = 1;
		let reliefX = 0;
		let reliefY = 0;
		if (distanceSquared <= this.startSquared) {
			start = 1;
			relief = 0;
		} else {
			if (distanceSquared < this.blendSquared) {
				const span = this.blendSquared - this.startSquared;
				const along = (this.blendSquared - distanceSquared) / span;
				start = smooth01(along);
				const rate = -2 * smoothSlope(along) / span;
				startX = rate * x;
				startY = rate * y;
			}
			if (distanceSquared < this.reliefSquared) {
				const span = this.reliefSquared - this.startSquared;
				const along = (distanceSquared - this.startSquared) / span;
				relief = smooth01(along);
				const rate = 2 * smoothSlope(along) / span;
				reliefX = rate * x;
				reliefY = rate * y;
			}
		}

		let elevation = this.plains(x, y, start, startX, startY);
		let slopeX = this.partX;
		let slopeY = this.partY;

		let mountains = 0;
		if (relief > 0 && this.maskThreshold !== Infinity) {
			elevation += this.mountainRelief(x, y, relief, reliefX, reliefY);
			slopeX += this.partX;
			slopeY += this.partY;
			mountains = this.partValue;
		}

		// Moisture reads the land before canyons and badlands cut it, so a
		// canyon floor stays as dry as the country it's cut into.
		const uplands = elevation;

		let canyons = 0;
		if (relief > 0 && this.canyonStrength > 0) {
			elevation += this.canyonRelief(x, y, relief, reliefX, reliefY);
			slopeX += this.partX;
			slopeY += this.partY;
			canyons = this.partValue;
		}

		let badlands = 0;
		if (relief > 0 && this.patchThreshold !== Infinity) {
			elevation += this.badlandsRelief(x, y, relief, reliefX, reliefY);
			slopeX += this.partX;
			slopeY += this.partY;
			badlands = this.partValue;
		}

		if (elevation < 0 || elevation > 1) {
			elevation = elevation < 0 ? 0 : 1;
			slopeX = 0;
			slopeY = 0;
		}

		const scratch = this.scratch;
		scratch.elevation = elevation;
		scratch.mountains = mountains;
		scratch.canyons = canyons;
		scratch.badlands = badlands;
		scratch.slopeX = slopeX;
		scratch.slopeY = slopeY;
		scratch.uplands = uplands;
		scratch.start = start;
		return elevation;
	}

	/**
	 * The plains: rolling ground, flattened toward the metro. Its gradient
	 * goes in `partX` and `partY`, as every term's does.
	 */
	private plains(x: number, y: number, start: number, startX: number, startY: number): number {
		const noise = this.baseNoise;
		const base = noise.fractal(x * BASE_FREQUENCY, y * BASE_FREQUENCY, BASE.octaves, BASE.gain);
		const flatten = 1 - START.flatten * start;
		this.partX = BASE.relief * (noise.derivativeX * BASE_FREQUENCY * flatten - base * START.flatten * startX);
		this.partY = BASE.relief * (noise.derivativeY * BASE_FREQUENCY * flatten - base * START.flatten * startY);
		return BASE.level + BASE.relief * base * flatten;
	}

	/**
	 * What mountain ranges add: ridges standing on lifted ground, as tall as
	 * the country is rough, inside the coverage mask, which goes in `partValue`.
	 */
	private mountainRelief(x: number, y: number, relief: number, reliefX: number, reliefY: number): number {
		this.partX = 0;
		this.partY = 0;
		this.partValue = 0;
		const along = (this.rangeValue(x, y, this.maskFloor) - this.maskThreshold) * MOUNTAINS.maskSharpness + 0.5;
		const raw = smooth01(along);
		if (raw <= 0) return 0;
		const rate = smoothSlope(along) * MOUNTAINS.maskSharpness;
		const mask = raw * relief;
		const maskX = rate * this.rangeX * relief + raw * reliefX;
		const maskY = rate * this.rangeY * relief + raw * reliefY;
		const ridge = this.ridge(x, y);
		const ridgeX = this.ridgeX;
		const ridgeY = this.ridgeY;
		const scale = this.ruggedScale(x, y) * this.ridgeHeight;
		const scaleX = this.ruggedX * this.ridgeHeight;
		const scaleY = this.ruggedY * this.ridgeHeight;
		const height = MOUNTAINS.lift + scale * ridge;
		this.partX = maskX * height + mask * (scaleX * ridge + scale * ridgeX);
		this.partY = maskY * height + mask * (scaleY * ridge + scale * ridgeY);
		this.partValue = mask;
		return mask * height;
	}

	/**
	 * What canyons take away: a flat floor and walls along the zero lines of
	 * their layer, deep in rough country and faded out at gaps; how far into
	 * one (x, y) is goes in `partValue`. A canyon's width is the map's, so a
	 * faint one is shallow rather than narrow, and its walls rise at one grade
	 * over their middle, so where one is steep enough to be a cliff, most of
	 * the wall is.
	 */
	private canyonRelief(x: number, y: number, relief: number, reliefX: number, reliefY: number): number {
		this.partX = 0;
		this.partY = 0;
		this.partValue = 0;
		const noise = this.canyonNoise;
		const halfWidth = this.canyonHalfWidth;
		let line = noise.fractal(x * CANYON_FREQUENCY, y * CANYON_FREQUENCY, CANYONS.octaves, CANYONS.gain, -halfWidth, halfWidth);
		let lineX = noise.derivativeX * CANYON_FREQUENCY;
		let lineY = noise.derivativeY * CANYON_FREQUENCY;
		if (line < 0) {
			line = -line;
			lineX = -lineX;
			lineY = -lineY;
		}
		if (!(line < halfWidth)) return 0;
		const gapAlong = (noise.sample(x * CANYON_GAP_FREQUENCY + GAP_OFFSET_X, y * CANYON_GAP_FREQUENCY + GAP_OFFSET_Y) + CANYONS.gapLevel) * CANYONS.gapSharpness;
		const gap = smooth01(gapAlong);
		if (gap <= 0) return 0;
		const gapRate = smoothSlope(gapAlong) * CANYONS.gapSharpness * CANYON_GAP_FREQUENCY;
		const gapX = gapRate * noise.derivativeX;
		const gapY = gapRate * noise.derivativeY;
		const strength = this.canyonStrength * relief * gap;
		const strengthX = this.canyonStrength * (reliefX * gap + relief * gapX);
		const strengthY = this.canyonStrength * (reliefY * gap + relief * gapY);
		const wall = (line / halfWidth - CANYONS.floor) / (1 - CANYONS.floor);
		const profile = 1 - wallRise(wall);
		const profileRate = -wallRiseSlope(wall) / ((1 - CANYONS.floor) * halfWidth);
		const scale = this.ruggedScale(x, y);
		const depth = CANYONS.depth * strength * scale;
		this.partX = -CANYONS.depth * ((strengthX * scale + strength * this.ruggedX) * profile + strength * scale * profileRate * lineX);
		this.partY = -CANYONS.depth * ((strengthY * scale + strength * this.ruggedY) * profile + strength * scale * profileRate * lineY);
		// A faint canyon is a gully, not the biome.
		this.partValue = profile * smooth01(strength * 4);
		return -depth * profile;
	}

	/**
	 * What badlands add: inside a patch, ridges where the gully layer crosses
	 * zero and gullies between them, as deep as the country is rough. The
	 * patch goes in `partValue`.
	 */
	private badlandsRelief(x: number, y: number, relief: number, reliefX: number, reliefY: number): number {
		this.partX = 0;
		this.partY = 0;
		this.partValue = 0;
		const patchNoise = this.patchNoise;
		const along = (patchNoise.fractal(x * PATCH_FREQUENCY, y * PATCH_FREQUENCY, BADLANDS.patchOctaves, BADLANDS.patchGain, this.patchFloor, Infinity) - this.patchThreshold) * BADLANDS.patchSharpness + 0.5;
		const raw = smooth01(along);
		if (raw <= 0) return 0;
		const rate = smoothSlope(along) * BADLANDS.patchSharpness * PATCH_FREQUENCY;
		const patch = raw * relief;
		const patchX = rate * patchNoise.derivativeX * relief + raw * reliefX;
		const patchY = rate * patchNoise.derivativeY * relief + raw * reliefY;
		const gullyNoise = this.gullyNoise;
		let gully = gullyNoise.fractal(x * GULLY_FREQUENCY, y * GULLY_FREQUENCY, BADLANDS.gullyOctaves, BADLANDS.gullyGain);
		let gullyX = gullyNoise.derivativeX * GULLY_FREQUENCY;
		let gullyY = gullyNoise.derivativeY * GULLY_FREQUENCY;
		if (gully < 0) {
			gully = -gully;
			gullyX = -gullyX;
			gullyY = -gullyY;
		}
		const crest = 1 - gully;
		const shape = crest * crest - 0.5;
		const scale = this.ruggedScale(x, y) * this.gullyRelief;
		const scaleX = this.ruggedX * this.gullyRelief;
		const scaleY = this.ruggedY * this.gullyRelief;
		this.partX = patchX * scale * shape + patch * (scaleX * shape - scale * 2 * crest * gullyX);
		this.partY = patchY * scale * shape + patch * (scaleY * shape - scale * 2 * crest * gullyY);
		this.partValue = patch;
		return patch * scale * shape;
	}

	/**
	 * Moisture at (x, y), the point `land` was last called with, left in
	 * `scratch` too: the map's level, its own noise, wetter in low country and
	 * drier high up, and scrub's in the metro.
	 */
	private landMoisture(x: number, y: number): number {
		const scratch = this.scratch;
		const noise = this.moistureNoise.fractal(x * MOISTURE_FREQUENCY, y * MOISTURE_FREQUENCY, MOISTURE.octaves, MOISTURE.gain);
		const moisture = clamp01(this.wetness + MOISTURE.spread * noise + MOISTURE.lowland * (BASE.level - scratch.uplands));
		scratch.moisture = moisture + (START.moisture - moisture) * scratch.start;
		return scratch.moisture;
	}

	/**
	 * How much of their full height mountains, canyons, and badlands stand to
	 * at (x, y), the point `land` is on, its gradient left in `ruggedX` and
	 * `ruggedY`: `ROUGHNESS.floor` of it outside rough country, climbing to all
	 * of it inside. Worked out once per `land` call.
	 */
	private ruggedScale(x: number, y: number): number {
		if (this.ruggedReady) return this.ruggedValue;
		this.ruggedReady = true;
		const noise = this.roughNoise;
		const along = (noise.fractal(x * ROUGHNESS_FREQUENCY, y * ROUGHNESS_FREQUENCY, ROUGHNESS.octaves, ROUGHNESS.gain, this.roughFloor, Infinity) - this.roughFloor) * ROUGHNESS.sharpness;
		const rough = smooth01(along);
		const rate = (1 - ROUGHNESS.floor) * smoothSlope(along) * ROUGHNESS.sharpness * ROUGHNESS_FREQUENCY;
		this.ruggedX = rough > 0 && rough < 1 ? rate * noise.derivativeX : 0;
		this.ruggedY = rough > 0 && rough < 1 ? rate * noise.derivativeY : 0;
		this.ruggedValue = ROUGHNESS.floor + (1 - ROUGHNESS.floor) * rough;
		return this.ruggedValue;
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

	/**
	 * How much (x, y) is range country, its gradient left in `rangeX` and
	 * `rangeY`: high along the zero lines of a broad layer, so ranges run in
	 * long belts, raised or lowered by a finer one, which breaks them into
	 * stretches with gaps between. The coverage threshold is a quantile of it.
	 * -Infinity, without a gradient, when it's sure to be `floor` or under.
	 */
	private rangeValue(x: number, y: number, floor: number): number {
		const rangeNoise = this.rangeNoise;
		const breakNoise = this.breakNoise;
		let line = rangeNoise.sample(x * RANGE_FREQUENCY + RANGE_OFFSET, y * RANGE_FREQUENCY + RANGE_OFFSET);
		let lineX = rangeNoise.derivativeX * RANGE_FREQUENCY;
		let lineY = rangeNoise.derivativeY * RANGE_FREQUENCY;
		if (line < 0) {
			line = -line;
			lineX = -lineX;
			lineY = -lineY;
		}
		// The breaks layer is under 1 in size, so it lifts the value by less than its weight.
		if (1 - line + MOUNTAINS.breakWeight <= floor) return -Infinity;
		const breaks = breakNoise.sample(x * BREAK_FREQUENCY + BREAK_OFFSET, y * BREAK_FREQUENCY + BREAK_OFFSET);
		this.rangeX = -lineX + MOUNTAINS.breakWeight * breakNoise.derivativeX * BREAK_FREQUENCY;
		this.rangeY = -lineY + MOUNTAINS.breakWeight * breakNoise.derivativeY * BREAK_FREQUENCY;
		return 1 - line + MOUNTAINS.breakWeight * breaks;
	}

	/**
	 * Ridged noise in [0, 1], high along the noise's zero lines, its gradient
	 * left in `ridgeX` and `ridgeY`. Each octave's crest is sharpened by
	 * ruggedness, from a rounded 1 - n^2 to a creased (1 - |n|)^3, and
	 * weighted by the octave before, so detail gathers on the ridges and
	 * valleys stay smooth.
	 */
	private ridge(x: number, y: number): number {
		const noise = this.ridgeNoise;
		const sharpness = this.ruggedness;
		const gain = this.ridgeGain;
		let sum = 0;
		let sumX = 0;
		let sumY = 0;
		let total = 0;
		let amplitude = 1;
		let scale = RIDGE_FREQUENCY;
		let weight = 1;
		let weightX = 0;
		let weightY = 0;
		for (let octave = 0; octave < MOUNTAINS.ridgeOctaves; octave += 1) {
			const value = noise.sample(x * scale + RIDGE_OFFSETS[octave], y * scale + RIDGE_OFFSETS[octave]);
			const sign = value < 0 ? -1 : 1;
			const crest = 1 - sign * value;
			const rounded = 1 - value * value;
			const raw = rounded + (crest * crest * crest - rounded) * sharpness;
			const rate = (-2 * value + (2 * value - 3 * sign * crest * crest) * sharpness) * scale;
			const rawX = rate * noise.derivativeX;
			const rawY = rate * noise.derivativeY;
			const signal = raw * weight;
			const signalX = rawX * weight + raw * weightX;
			const signalY = rawY * weight + raw * weightY;
			sum += signal * amplitude;
			sumX += signalX * amplitude;
			sumY += signalY * amplitude;
			total += amplitude;
			if (signal * 2 < 1) {
				weight = signal * 2;
				weightX = signalX * 2;
				weightY = signalY * 2;
			} else {
				weight = 1;
				weightX = 0;
				weightY = 0;
			}
			amplitude *= gain;
			scale *= 2;
		}
		this.ridgeX = sumX / total;
		this.ridgeY = sumY / total;
		return sum / total;
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
		samples.sort((a, b) => a - b);
		const index = Math.min(samples.length - 1, Math.max(0, Math.round((1 - share) * samples.length)));
		return samples[index];
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

	/** The metro's ruins around the compound, `metroSize` of the radius: the start, never impassable. */
	public get metro(): Ruin {
		return this.land.metro;
	}

	/**
	 * Ruined towns out past the metro: up to `towns` of them, each where a road
	 * from the metro can reach it. A town is left out only when no reachable
	 * cell in the ring has room for it.
	 */
	public get towns(): readonly Ruin[] {
		return this.land.towns;
	}

	/** World units: out to this the fields blend from scrub's to their own. */
	public get blendRadius(): number {
		return this.land.blendRadius;
	}

	/** World units: out to this mountains, canyons, and badlands rise to full, and no cliff stands inside it. */
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

	/** 0 to 1: basins and canyon floors to peaks. */
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
	 * True where a road from the metro can surely reach: a cell of the 16-unit
	 * lattice that a flood fill from the metro gets to through cells that
	 * aren't rough, lie wholly inside the disc, and keep clear of craters, so
	 * no cliff or crater stands between (water aside). Rough cells read false,
	 * though roads may still find a way through one.
	 */
	public reachable(x: number, y: number): boolean {
		return this.land.reachable(x, y);
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

function lerp({ min, max }: { min: number; max: number }, amount: number): number {
	return min + (max - min) * amount;
}

function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Smoothstep of a value already scaled to [0, 1], clamped outside it. */
function smooth01(value: number): number {
	if (value <= 0) return 0;
	if (value >= 1) return 1;
	return value * value * (3 - 2 * value);
}

/** The derivative of `smooth01`. */
function smoothSlope(value: number): number {
	if (value <= 0 || value >= 1) return 0;
	return 6 * value * (1 - value);
}

/**
 * How far up a canyon wall `v` is, 0 at its foot to 1 at its rim: the slope
 * eases in over the first `CANYONS.wallEase` of the wall, holds one grade
 * over the middle, and eases out over the last, so it's smooth everywhere.
 */
function wallRise(v: number): number {
	if (v <= 0) return 0;
	if (v >= 1) return 1;
	const ease = CANYONS.wallEase;
	const rate = 1 / (1 - ease);
	if (v < ease) return rate * v * v / (2 * ease);
	if (v > 1 - ease) {
		const rest = 1 - v;
		return 1 - rate * rest * rest / (2 * ease);
	}
	return rate * (v - ease / 2);
}

/** The derivative of `wallRise`. */
function wallRiseSlope(v: number): number {
	if (v <= 0 || v >= 1) return 0;
	const ease = CANYONS.wallEase;
	const rate = 1 / (1 - ease);
	if (v < ease) return rate * v / ease;
	if (v > 1 - ease) return rate * (1 - v) / ease;
	return rate;
}
