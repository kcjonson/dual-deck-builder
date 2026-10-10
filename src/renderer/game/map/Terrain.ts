import { Rng } from '../core/Rng';
import { Biome, BiomeFields, classifyBiome } from './Biome';
import { LandSurface, RELIEF, generateLand, moistureLevel, startRadii, terraceLift, terracePull, terraceSlope } from './Land';
import { GridSampler, cellCentre, landGridFor } from './LandGrid';
import { clamp01, lerp, positiveQuantile, quantileAbove, smooth01, smoothSlope } from './MapMath';
import { MapParams } from './MapParams';
import { SimplexNoise } from './Noise';
import type { RiverCrossing } from './Rivers';
import type { RoadClass } from './RoadNetwork';
import { Hotspot, MAX_CRATER_RADIUS, Ruin, placeHotspots, placeTowns } from './TerrainSites';

/**
 * Stage 1 of area map generation, terrain (Area Map Generation, Pipeline,
 * 1. Terrain, and 3. Biomes, hazards, and cost): the eroded land (Land.ts)
 * read as fields over the disc, the metro and towns, hotspots, rough country
 * and cliffs, and, once the water stage lays its water over it, the biomes,
 * what's impassable, and what a move costs. Every query is a function of
 * (x, y) in world units, the compound at the origin, so later stages and the
 * renderer sample it at whatever resolution they need. Building one erodes
 * the land and precomputes the rest of the per-map parts (noise
 * permutations, calibrated thresholds, hotspots, towns); sampling allocates
 * nothing.
 *
 * Elevation is the eroded grid sampled bicubic, plus a little fine noise in
 * range country for the picture, and carries its exact gradient, so slope
 * costs no extra samples. Moisture, low ground, and canyons are the water
 * stage's (Water.ts): until it lays its water over the land, moisture is the
 * map's level and there are no canyons. Starting values throughout are for
 * the Map Lab to tune; the land's are in
 * docs/AI_TECHNICAL_DECISIONS/terrain-erosion.md, the water's, the biomes',
 * and cost's in water-and-biomes.md, and the rest in terrain-fields.md.
 */

/** Why ground is impassable. Lakes and rivers come from the water stage, through `withWater`. */
export type Obstacle = 'crater' | 'lake' | 'river' | 'cliff';

export type WaterKind = 'lake' | 'river';

/**
 * Rivers and lakes, and the fields that follow where water runs: what the
 * water stage lays over the land through `Terrain.withWater`. `Water` is the
 * real one; tests can stand in their own.
 */
export interface WaterLayer {
	/** A lake, a river, or neither at (x, y); a lake where both are. */
	waterAt(x: number, y: number): WaterKind | null;
	/** A lake's depth at (x, y) as elevation, less than 0 on land and 0 at the shore. */
	lakeDepth(x: number, y: number): number;
	/** 0 dry to 1 wet. */
	moisture(x: number, y: number): number;
	/** 1 barely above the river or lake the ground drains to, 0 well above it. */
	lowland(x: number, y: number): number;
	/** 0 to 1: deep in a river valley cut into dry country. */
	canyons(x: number, y: number): number;
	/** How many river centrelines the move crosses; `riverCrossing(index)` reads each until the next call. */
	riverCrossings(x0: number, y0: number, x1: number, y1: number): number;
	riverCrossing(index: number): RiverCrossing;
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
}

export function createTerrainSample(): TerrainSample {
	return {
		elevation: 0, lowland: 0, moisture: 0, contamination: 0, mountains: 0, canyons: 0, badlands: 0,
		slopeX: 0, slopeY: 0, grade: 0, ruin: 0, biome: 'scrub', obstacle: null,
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
 * their grid; the rest of the terrain is rebuilt from the stream, bar the
 * badlands when they're passed too.
 */
export function terrainFromSurface({ params, rng, surface, badlands }: TerrainFieldsOptions): Terrain {
	return new Terrain({ fields: new TerrainFields({ params, rng, surface, badlands }) });
}

export { RELIEF };

/**
 * What a road pays to move over the land (Area Map Generation, 3. Biomes,
 * hazards, and cost): the distance, times one plus the grade along the move
 * squared, weighted by class and by `curviness`, plus the slope across it
 * squared, weighted by class; and a bridge to cross a river, dearer the
 * longer the bridge, which keeps crossings short and square-on. Highways
 * mind grades most and bridges least. A highway or back road can't climb a
 * grade past `maxGrade`, and no bridge runs longer than `longestBridge`, so
 * a creek can be crossed at almost any angle and a broad river only close
 * to square.
 */
export const MOVE_COST = {
	grade: { highway: 26, backRoad: 10, trail: 3.5 },
	side: { highway: 3, backRoad: 1.2, trail: 0.3 },
	/** The grade weight's scale, from curviness 0, roads that barely mind a climb, to 1, roads that wind to keep it gentle. */
	curviness: { min: 0.2, max: 1.8 },
	maxGrade: { highway: 1.1, backRoad: 1.1, trail: Infinity },
	/** World units of flat road a bridge costs, by class, and as much again for each `bridgeSpan` world units it runs. */
	bridge: { highway: 130, backRoad: 210, trail: 280 },
	bridgeSpan: 8,
	/** World units: the longest a bridge can be, the river's width over the sine of the angle it's crossed at. */
	longestBridge: 24,
	/** World units past the water a bridge's deck reaches either side. */
	bridgeSlack: 1,
} as const;

/** Fine relief in range country, for the picture: as much as this, times the range mask. */
const DETAIL = { wavelength: 60, octaves: 3, gain: 0.5, amplitude: 0.006 };
/**
 * Rough country: the only ground where a cliff can stand. It's the
 * steepest land past the relief radius, the eroded grade averaged over
 * `blur` cells each way, `share` of it by ruggedness. Steep land runs in
 * belts along the ranges, so the grade is swayed by `breaks` of a noise
 * layer `wavelength` world units across, which breaks a belt into stretches
 * with gaps where a road can climb, and the land between connects across
 * the map. The land grid's cells carry it and it's read bilinear, so a
 * flood fill over the squares between cell centres whose four corners are
 * all under the threshold is exact: no cliff stands in any of them.
 */
const ROUGHNESS = { blur: 1, share: { min: 0.1, max: 0.35 }, breaks: 0.7, wavelength: 300, octaves: 2 };
/**
 * Cliffs: the steepest of the rough country, by the same averaged grade read
 * bilinear off the land grid, so an escarpment is one band, not a stripe per
 * gully the way the grade at a point would draw it. `share` times ruggedness
 * squared of the land past the relief radius, as main's grade rule gave (0
 * at ruggedness 0, about 1% at 0.5, 5% at 1), and none where the averaged
 * grade is under `least`, so a gentle map's quota doesn't put cliffs on mild
 * slopes.
 */
const CLIFFS = { share: 0.05, least: 0.5 };
/**
 * Badlands: the most broken ground away from the ranges, the averaged
 * grade weighted toward the toxic, `share` times ruggedness of the land
 * outside the ranges, weighted by contamination.
 */
const BADLANDS = { share: 0.7, toxic: 0.7 };
/** Badlands go from none to full over a quarter of their threshold either side of it. */
const FEATURE_SHARPNESS = 2;
/** Badlands keep `reach` cells off any range lift, and off a range mask of `mask` entirely. */
const RANGE_CLEARANCE = { reach: 3, mask: 0.1 };
const CONTAMINATION = {
	wavelength: 450, octaves: 2, gain: 0.5,
	/** Contamination goes from none to full over 1 / this of noise around the calibrated threshold. */
	sharpness: 3,
};
/**
 * Craters keep off the land's drainage, so a blast site doesn't sit on a
 * river: no cell within `margin` cells of the crater carries `area` cells'
 * drainage, under the least a river needs at any `riverDensity` and the
 * heaviest rain (Rivers.ts, Water.ts). The water stage routes the land again
 * with a little noise, which can move a river a cell on flat ground, so the
 * margin is two cells.
 */
const CRATER_DRAINAGE = { area: 40, margin: 2 };
/** Inside the metro moisture is scrub's middling level. */
const START_MOISTURE = 0.45;
/** World units past the metro's edge its streets' bridges reach, so a highway leaving it over a river leaves on one. */
export const METRO_BRIDGES = 1;
/** Lattice spacing, as a share of the radius, for the samples thresholds are calibrated on. */
const CALIBRATION_SPACING = 0.05;

const DETAIL_FREQUENCY = 1 / DETAIL.wavelength;
const CONTAMINATION_FREQUENCY = 1 / CONTAMINATION.wavelength;

// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;

/** What `land` leaves behind for the callers that need more than elevation. */
interface LandFields {
	elevation: number;
	mountains: number;
	slopeX: number;
	slopeY: number;
}

export interface TerrainFieldsOptions extends TerrainOptions {
	/** The eroded land these fields read: `generateLand`'s for the same params, never written. */
	surface: LandSurface;
	/**
	 * The badlands per land cell, when a worker has already worked them out
	 * for the same params, stream, and land (`Terrain.badlandsCells`), so
	 * they aren't again: a sample of contamination per cell is most of what
	 * rebuilding the terrain costs.
	 */
	badlands?: Float32Array;
}

/**
 * The land: every field, the features, and impassability and cost, with the
 * water layer, when there is one, passed in. Built once per map by
 * `generateTerrain`; `Terrain` is what stages use.
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
	/** Badlands per land cell, 0 to 1, read bilinear. Read-only by contract: the badlands sampler reads it. */
	public readonly badlandsCells: Float32Array;
	/** How wet the map runs on average: `aridity`'s level. */
	public readonly wetness: number;

	private readonly elevationGrid: GridSampler;
	private readonly mountainGrid: GridSampler;
	private readonly roughGrid: GridSampler;
	/** The averaged grade cliffs are read off. */
	private readonly steepGrid: GridSampler;
	private readonly badlandsGrid: GridSampler;
	private readonly detailNoise: SimplexNoise;
	private readonly contaminationNoise: SimplexNoise;

	/** Contamination noise above this is toxic: the `contamination` quantile. */
	private readonly contaminationThreshold: number;
	/** Where the contamination ramp bottoms out: values at or under this contribute nothing. */
	private readonly contaminationFloor: number;
	/** Rough country is where the averaged grade, read bilinear, is this or more: the share `ruggedness` asks for. */
	private readonly roughThreshold: number;
	/** In rough country, a cliff is where the averaged grade, read bilinear, is this or more: `CLIFFS`. */
	private readonly cliffThreshold: number;
	/** Per square between cell centres, row by row from the square whose lower-left corner is cell 0's centre: 1 where a road from the metro surely reaches. */
	private readonly reachedSquares: Uint8Array;
	/** The grade weight's scale by `curviness`. */
	private readonly gradeScale: number;

	/** How hard dry land is pulled toward terraces past the blend radius: `terracePull` of the map's wetness. */
	private readonly terracing: number;
	private readonly startSquared: number;
	/** Inside this, a river isn't an obstacle: the metro's streets cross its rivers, its edge and the highways' departures on it included. */
	private readonly bridgedSquared: number;
	private readonly blendSquared: number;
	/** Hotspots flattened for the per-sample loops: x, y, crater radius squared, plume radius squared, strength. */
	private readonly hotspotData: Float64Array;

	private readonly scratch: LandFields = { elevation: 0, mountains: 0, slopeX: 0, slopeY: 0 };
	private readonly biomeFields = { lowland: 0, moisture: 0, contamination: 0, mountains: 0, canyons: 0, badlands: 0 };

	constructor({ params, rng, surface, badlands }: TerrainFieldsOptions) {
		const { radius } = params;
		const expected = landGridFor(radius);
		const { grid } = surface;
		if (grid.size !== expected.size || grid.cellSize !== expected.cellSize || grid.halfExtent !== expected.halfExtent) {
			throw new RangeError(`TerrainFields: the surface's grid (${grid.size} cells over ${grid.halfExtent}) isn't radius ${radius}'s (${expected.size} over ${expected.halfExtent})`);
		}
		const cells = grid.size * grid.size;
		const { drainage } = surface;
		if (drainage.size !== grid.size) throw new RangeError(`TerrainFields: the surface's drainage is for a grid of ${drainage.size}, not ${grid.size}`);
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
		this.bridgedSquared = (metroRadius + METRO_BRIDGES) * (metroRadius + METRO_BRIDGES);
		this.blendSquared = blendRadius * blendRadius;
		this.wetness = moistureLevel(params.aridity);
		this.terracing = terracePull(this.wetness);
		this.gradeScale = lerp(MOVE_COST.curviness, params.curviness);

		this.elevationGrid = new GridSampler({ grid, values: surface.elevation });
		this.mountainGrid = new GridSampler({ grid, values: surface.mountains });
		this.detailNoise = new SimplexNoise({ rng: rng.fork('detail') });
		this.contaminationNoise = new SimplexNoise({ rng: rng.fork('contamination') });

		this.contaminationThreshold = this.calibrate((x, y) => this.contaminationNoise.fractal(x * CONTAMINATION_FREQUENCY, y * CONTAMINATION_FREQUENCY, CONTAMINATION.octaves, CONTAMINATION.gain), params.contamination, blendRadius);
		this.contaminationFloor = this.contaminationThreshold - 0.5 / CONTAMINATION.sharpness;

		this.hotspots = placeHotspots({
			rng: rng.fork('hotspots'),
			count: params.hotspots,
			radius,
			ring: { inner: blendRadius + MAX_CRATER_RADIUS, outer: 0.9 * radius },
			suits: (x, y, craterRadius) => offDrainage({ surface, x, y, reach: craterRadius + CRATER_DRAINAGE.margin * grid.cellSize }),
		});
		this.hotspotData = new Float64Array(this.hotspots.length * 5);
		this.hotspots.forEach((hotspot, index) => {
			this.hotspotData.set([hotspot.x, hotspot.y, hotspot.craterRadius * hotspot.craterRadius, hotspot.plumeRadius * hotspot.plumeRadius, hotspot.strength], index * 5);
		});

		const { steepness, roughness } = roughnessField({ surface, reliefRadius, noise: new SimplexNoise({ rng: rng.fork('roughness') }) });
		this.roughGrid = new GridSampler({ grid, values: roughness });
		const roughThreshold = quantileAbove(landValues({ surface, radius, reliefRadius, values: roughness, ranges: true }), lerp(ROUGHNESS.share, params.ruggedness));
		// Ground with no grade at all is never rough, which only a map flatter than any erosion makes would need.
		this.roughThreshold = roughThreshold > 0 ? roughThreshold : Infinity;
		this.reachedSquares = this.reachFromMetro(roughness);
		this.steepGrid = new GridSampler({ grid, values: steepness });
		const roughSteepness = new Float64Array(cells);
		for (let cell = 0; cell < cells; cell += 1) if (roughness[cell] >= this.roughThreshold) roughSteepness[cell] = steepness[cell];
		const cliffThreshold = positiveQuantile(landValues({ surface, radius, reliefRadius, values: roughSteepness, ranges: true }), CLIFFS.share * params.ruggedness * params.ruggedness);
		this.cliffThreshold = cliffThreshold > CLIFFS.least ? cliffThreshold : CLIFFS.least;

		if (badlands !== undefined && badlands.length !== cells) throw new RangeError(`TerrainFields: the badlands hold ${badlands.length} values, not the grid's ${cells}`);
		const badlandsShare = BADLANDS.share * params.ruggedness * (0.3 + 0.7 * params.contamination);
		this.badlandsCells = badlands ?? this.badlandsField({ steepness, share: badlandsShare, metroRadius });
		this.badlandsGrid = new GridSampler({ grid, values: this.badlandsCells });

		const townRing = { inner: blendRadius, outer: 0.9 * radius };
		this.towns = placeTowns({
			rng: rng.fork('towns'),
			count: params.towns,
			radius,
			metroRadius,
			ring: townRing,
			hotspots: this.hotspots,
			cells: params.towns > 0 ? this.reachedSquaresIn(townRing) : [],
			cellSize: grid.cellSize,
			// Every point of a reached square is ground a road can get to; towns prefer open country.
			suits: (x, y, strict) => !strict || this.mountainGrid.bilinear(x, y) < 0.25,
		});
	}

	public elevation(x: number, y: number): number {
		return this.land(x, y);
	}

	/** 0 dry to 1 wet: the water's moisture, or the map's level before there's water, and scrub's in the metro. */
	public moisture(x: number, y: number, water: WaterLayer | null): number {
		const moisture = water === null ? this.wetness : water.moisture(x, y);
		return moisture + (START_MOISTURE - moisture) * this.startWeight(x * x + y * y);
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

	public biome(x: number, y: number, water: WaterLayer | null): Biome {
		const fields = this.biomeFields;
		this.land(x, y);
		fields.mountains = this.scratch.mountains;
		fields.moisture = this.moisture(x, y, water);
		fields.contamination = this.contamination(x, y);
		fields.badlands = this.badlandsGrid.bilinear(x, y);
		fields.lowland = water === null ? 0 : water.lowland(x, y);
		fields.canyons = water === null ? 0 : water.canyons(x, y);
		return classifyBiome(fields);
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
		return this.roughGrid.bilinear(x, y) >= this.roughThreshold;
	}

	/** True in a square between cell centres that the flood fill from the metro got to; false only means not proven. */
	public surelyReachable(x: number, y: number): boolean {
		const square = this.squareAt(x, y);
		return square >= 0 && this.reachedSquares[square] === 1;
	}

	/** True on a cliff: in rough country, where the averaged grade passes the cliff threshold. */
	public cliff(x: number, y: number): boolean {
		return this.rough(x, y) && this.steepGrid.bilinear(x, y) >= this.cliffThreshold;
	}

	/**
	 * How far into a cliff (x, y) lies, for drawing its edge: the lesser of
	 * the roughness and the averaged grade over their thresholds, less 1. 0
	 * or more on a cliff, give or take a rounding at the edge; less off one.
	 */
	public cliffDepth(x: number, y: number): number {
		const rough = this.roughGrid.bilinear(x, y) / this.roughThreshold - 1;
		const steep = this.steepGrid.bilinear(x, y) / this.cliffThreshold - 1;
		return rough < steep ? rough : steep;
	}

	/** Rise over run at (x, y). */
	public grade(x: number, y: number): number {
		this.land(x, y);
		return sqrt(this.slopeSquared()) * RELIEF;
	}

	/** Elevation's gradient at (x, y) into `out`, per world unit. Returns `out`. */
	public slope<Out extends { x: number; y: number }>(x: number, y: number, out: Out): Out {
		this.land(x, y);
		out.x = this.scratch.slopeX;
		out.y = this.scratch.slopeY;
		return out;
	}

	/**
	 * Why (x, y) is impassable, or null: a crater, then water, then a cliff.
	 * The metro's rivers aren't: its streets cross them wherever they meet.
	 */
	public obstacle(x: number, y: number, water: WaterLayer | null): Obstacle | null {
		if (this.crater(x, y)) return 'crater';
		if (water !== null) {
			const kind = water.waterAt(x, y);
			if (kind === 'lake' || (kind === 'river' && x * x + y * y > this.bridgedSquared)) return kind;
		}
		if (this.cliff(x, y)) return 'cliff';
		return null;
	}

	/** Everything at (x, y) into `out`. Returns `out`. */
	public sample(x: number, y: number, out: TerrainSample, water: WaterLayer | null): TerrainSample {
		const scratch = this.scratch;
		out.elevation = this.land(x, y);
		out.mountains = scratch.mountains;
		out.slopeX = scratch.slopeX;
		out.slopeY = scratch.slopeY;
		out.grade = sqrt(this.slopeSquared()) * RELIEF;
		out.moisture = this.moisture(x, y, water);
		out.contamination = this.contamination(x, y);
		out.badlands = this.badlandsGrid.bilinear(x, y);
		out.lowland = water === null ? 0 : water.lowland(x, y);
		out.canyons = water === null ? 0 : water.canyons(x, y);
		out.ruin = this.ruin(x, y);
		out.biome = classifyBiome(out);
		if (this.crater(x, y)) {
			out.obstacle = 'crater';
			return out;
		}
		const kind = water === null ? null : water.waterAt(x, y);
		if (kind === 'lake' || (kind === 'river' && x * x + y * y > this.bridgedSquared)) out.obstacle = kind;
		else out.obstacle = this.cliff(x, y) ? 'cliff' : null;
		return out;
	}

	/**
	 * What a road of `roadClass` pays to drive the short move from (x0, y0) to
	 * (x1, y1) (`MOVE_COST`): Infinity when its end or its middle is
	 * impassable, short of a river it bridges, when a bridge would run longer
	 * than `longestBridge`, or when it climbs too steeply for its class.
	 * The ground between its end and its middle isn't sampled, so a caller
	 * stepping further than a few world units samples its own way. The
	 * metro's rivers cost nothing to cross. Leaves the bridges' share in
	 * `parts`, when given.
	 */
	public moveCost(x0: number, y0: number, x1: number, y1: number, roadClass: RoadClass, water: WaterLayer | null, parts?: { bridge: number }): number {
		if (parts) parts.bridge = 0;
		const dx = x1 - x0;
		const dy = y1 - y0;
		if (dx === 0 && dy === 0) return 0;
		const length = sqrt(dx * dx + dy * dy);
		if (!(length > 0 && length < Infinity)) return Infinity;
		if (this.obstacle(x1, y1, water) !== null) return Infinity;
		let bridge = 0;
		const crossings = water === null ? 0 : water.riverCrossings(x0, y0, x1, y1);
		for (let index = 0; index < crossings; index += 1) {
			const { along, width, sine } = (water as WaterLayer).riverCrossing(index);
			const cx = x0 + dx * along;
			const cy = y0 + dy * along;
			if (cx * cx + cy * cy <= this.bridgedSquared) continue;
			if (!(width <= MOVE_COST.longestBridge * sine)) return Infinity;
			bridge += MOVE_COST.bridge[roadClass] * (1 + width / sine / MOVE_COST.bridgeSpan);
		}
		const middle = this.obstacle(x0 + 0.5 * dx, y0 + 0.5 * dy, water);
		if (middle !== null && !(middle === 'river' && bridge > 0)) return Infinity;
		const climb = this.land(x1, y1) - this.land(x0, y0);
		const grade = (climb < 0 ? -climb : climb) * RELIEF / length;
		if (grade > MOVE_COST.maxGrade[roadClass]) return Infinity;
		this.land(x0 + 0.5 * dx, y0 + 0.5 * dy);
		const across = (this.scratch.slopeY * dx - this.scratch.slopeX * dy) * RELIEF / length;
		if (parts) parts.bridge = bridge;
		return length * (1 + MOVE_COST.grade[roadClass] * this.gradeScale * grade * grade + MOVE_COST.side[roadClass] * across * across) + bridge;
	}

	/**
	 * The stretches of the move from (x0, y0) to (x1, y1) on a bridge, into
	 * `spans` as pairs of `along` (0 to 1), from then to: one for each river
	 * the move crosses with a bridge no longer than `MOVE_COST.longestBridge`,
	 * or any bridge in the metro, reaching the bridge's span either side of
	 * where it crosses and `MOVE_COST.bridgeSlack` past that. Returns how many.
	 */
	public bridgeSpans(x0: number, y0: number, x1: number, y1: number, water: WaterLayer | null, spans: number[]): number {
		if (water === null) return 0;
		const dx = x1 - x0;
		const dy = y1 - y0;
		const length = sqrt(dx * dx + dy * dy);
		if (!(length > 0)) return 0;
		const crossings = water.riverCrossings(x0, y0, x1, y1);
		let count = 0;
		for (let index = 0; index < crossings; index += 1) {
			const { along, width, sine } = water.riverCrossing(index);
			const cx = x0 + dx * along;
			const cy = y0 + dy * along;
			if (cx * cx + cy * cy > this.bridgedSquared && !(width <= MOVE_COST.longestBridge * sine)) continue;
			const reach = (0.5 * width / sine + MOVE_COST.bridgeSlack) / length;
			spans[2 * count] = along - reach;
			spans[2 * count + 1] = along + reach;
			count += 1;
		}
		return count;
	}

	/** The squared gradient the last `land` call left. */
	private slopeSquared(): number {
		const scratch = this.scratch;
		return scratch.slopeX * scratch.slopeX + scratch.slopeY * scratch.slopeY;
	}

	/**
	 * Elevation at (x, y), with its gradient and the range mask left in
	 * `scratch`: the eroded grid, bicubic, terraced on a dry map, plus fine
	 * relief as strong as the point is range country, held to 0 to 1.
	 * Terraced here rather than on the grid, so a riser follows the land's
	 * contours instead of its cells. The pull fades out over the blend ring,
	 * since the metro is flat ground, not a bench.
	 */
	private land(x: number, y: number): number {
		const elevationGrid = this.elevationGrid;
		const mountainGrid = this.mountainGrid;
		let elevation = elevationGrid.bicubic(x, y);
		let slopeX = elevationGrid.gradientX;
		let slopeY = elevationGrid.gradientY;
		const distanceSquared = x * x + y * y;
		if (this.terracing > 0 && distanceSquared > this.startSquared) {
			let pull = this.terracing;
			let pullX = 0;
			let pullY = 0;
			if (distanceSquared < this.blendSquared) {
				const span = this.blendSquared - this.startSquared;
				const ramp = (this.blendSquared - distanceSquared) / span;
				pull *= 1 - smooth01(ramp);
				const change = 2 * this.terracing * smoothSlope(ramp) / span;
				pullX = change * x;
				pullY = change * y;
			}
			const lift = terraceLift(elevation);
			const scale = terraceSlope(elevation, pull);
			slopeX = slopeX * scale + lift * pullX;
			slopeY = slopeY * scale + lift * pullY;
			elevation += lift * pull;
		}
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
	 * The square between cell centres holding (x, y), counted from the square
	 * whose lower-left corner is cell 0's centre, or -1 off them: the cells
	 * whose values `GridSampler.bilinear` blends there are its corners.
	 */
	private squareAt(x: number, y: number): number {
		const { grid } = this.surface;
		const column = floor((x + grid.halfExtent) / grid.cellSize - 0.5);
		const row = floor((y + grid.halfExtent) / grid.cellSize - 0.5);
		const squares = grid.size - 1;
		if (!(column >= 0 && row >= 0 && column < squares && row < squares)) return -1;
		return row * squares + column;
	}

	/**
	 * Which squares between cell centres a road from the metro can reach: a
	 * flood fill from the square holding the compound through squares whose
	 * four corners are all under the rough threshold, so no point in them is
	 * rough and no cliff stands there, that lie wholly inside the disc, and
	 * that no crater reaches into. 1 where reached. Exact for cliffs and
	 * craters by construction; water comes later.
	 */
	private reachFromMetro(roughness: Float64Array): Uint8Array {
		const { grid } = this.surface;
		const size = grid.size;
		const squares = size - 1;
		const threshold = this.roughThreshold;
		const radiusSquared = this.radius * this.radius;
		const hotspots = this.hotspots;
		const open = new Uint8Array(squares * squares);
		for (let row = 0; row < squares; row += 1) {
			const bottom = cellCentre(grid, row);
			const top = cellCentre(grid, row + 1);
			for (let column = 0; column < squares; column += 1) {
				const corner = row * size + column;
				if (!(roughness[corner] < threshold && roughness[corner + 1] < threshold && roughness[corner + size] < threshold && roughness[corner + size + 1] < threshold)) continue;
				const left = cellCentre(grid, column);
				const right = cellCentre(grid, column + 1);
				// The disc is convex, so the square is inside it when its farthest corner is.
				const farX = -left > right ? left : right;
				const farY = -bottom > top ? bottom : top;
				if (farX * farX + farY * farY > radiusSquared) continue;
				let touchesCrater = false;
				for (let hotspot = 0; hotspot < hotspots.length && !touchesCrater; hotspot += 1) {
					const { x, y, craterRadius } = hotspots[hotspot];
					const nearX = x < left ? left : x > right ? right : x;
					const nearY = y < bottom ? bottom : y > top ? top : y;
					touchesCrater = (nearX - x) * (nearX - x) + (nearY - y) * (nearY - y) < craterRadius * craterRadius;
				}
				if (!touchesCrater) open[row * squares + column] = 1;
			}
		}
		const reached = new Uint8Array(squares * squares);
		const start = this.squareAt(0, 0);
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
			const square = queue.pop() as number;
			const column = square % squares;
			if (column > 0) visit(square - 1);
			if (column < squares - 1) visit(square + 1);
			if (square >= squares) visit(square - squares);
			if (square + squares < open.length) visit(square + squares);
		}
		return reached;
	}

	/** The centres of the reached squares whose eight neighbours are reached too, and whose centres lie in the ring, in order. */
	private reachedSquaresIn({ inner, outer }: { inner: number; outer: number }): { x: number; y: number }[] {
		const { grid } = this.surface;
		const squares = grid.size - 1;
		const reached = this.reachedSquares;
		const centres: { x: number; y: number }[] = [];
		for (let row = 1; row < squares - 1; row += 1) {
			const y = cellCentre(grid, row) + 0.5 * grid.cellSize;
			for (let column = 1; column < squares - 1; column += 1) {
				const square = row * squares + column;
				// Its eight neighbours too, so a town stands a square clear of rough ground.
				if (reached[square] !== 1 || reached[square - 1] !== 1 || reached[square + 1] !== 1
					|| reached[square - squares - 1] !== 1 || reached[square - squares] !== 1 || reached[square - squares + 1] !== 1
					|| reached[square + squares - 1] !== 1 || reached[square + squares] !== 1 || reached[square + squares + 1] !== 1) continue;
				const x = cellCentre(grid, column) + 0.5 * grid.cellSize;
				const distanceSquared = x * x + y * y;
				if (distanceSquared >= inner * inner && distanceSquared <= outer * outer) centres.push({ x, y });
			}
		}
		return centres;
	}

	/**
	 * Badlands per cell, 0 to 1: the most broken ground away from the ranges,
	 * the averaged grade weighted toward toxic ground, `share` of the land
	 * outside the ranges.
	 */
	private badlandsField({ steepness, share, metroRadius }: { steepness: Float64Array; share: number; metroRadius: number }): Float32Array {
		const surface = this.surface;
		const { grid } = surface;
		const size = grid.size;
		const field = new Float32Array(size * size);
		if (!(share > 0)) return field;
		const room = featureRoom({ surface, metroRadius, reliefRadius: this.reliefRadius });
		const broken = new Float64Array(size * size);
		for (let row = 0; row < size; row += 1) {
			const y = cellCentre(grid, row);
			for (let column = 0; column < size; column += 1) {
				const cell = row * size + column;
				if (room[cell] > 0) broken[cell] = steepness[cell] * room[cell] * (1 - BADLANDS.toxic + BADLANDS.toxic * this.contamination(cellCentre(grid, column), y));
			}
		}
		const threshold = positiveQuantile(landValues({ surface, radius: this.radius, reliefRadius: this.reliefRadius, values: broken, ranges: false }), share);
		if (threshold === Infinity) return field;
		for (let cell = 0; cell < field.length; cell += 1) field[cell] = smooth01((broken[cell] / threshold - 1) * FEATURE_SHARPNESS + 0.5);
		return field;
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
 * The terrain stages read: the land's fields, plus water once the water
 * stage lays it over the land, in the biomes, what's impassable, and what a
 * move costs.
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
	 * square's centre in the ring has room for it.
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

	/**
	 * Badlands per land cell, 0 to 1, as `badlands` reads them bilinear: what a
	 * worker sends so the client needn't work them out again. Read-only: the
	 * terrain samples this array, so writing it changes the map. A typed
	 * array can't be frozen, so that's by contract.
	 */
	public get badlandsCells(): Float32Array {
		return this.land.badlandsCells;
	}

	/** The same land with water in its fields, what's impassable, and what a move costs. */
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

	/** 0 dry to 1 wet: the map's level until there's water, then wetter beside rivers and lakes. */
	public moisture(x: number, y: number): number {
		return this.land.moisture(x, y, this.water);
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
		return this.land.biome(x, y, this.water);
	}

	/** Rise over run at (x, y). */
	public grade(x: number, y: number): number {
		return this.land.grade(x, y);
	}

	/**
	 * True in rough country, the only ground where a cliff can stand: the
	 * steepest land past the relief radius, `ruggedness`'s share of it, in
	 * bands and islands along the steep slopes. Elsewhere steep ground is only
	 * costly.
	 */
	public rough(x: number, y: number): boolean {
		return this.land.rough(x, y);
	}

	/**
	 * How far into a cliff (x, y) lies, for drawing its edge: 0 or more on a
	 * cliff, less off one. Cliffs are the steepest of the rough country by
	 * the land grid's averaged grade, so a band, never a point's grade.
	 */
	public cliffDepth(x: number, y: number): number {
		return this.land.cliffDepth(x, y);
	}

	/**
	 * True where a road from the metro surely reaches: a square between land
	 * cell centres that a flood fill from the metro gets to through squares
	 * with no rough ground in them, lying wholly inside the disc and clear of
	 * craters, so no cliff or crater stands between. It's the test towns are
	 * placed by, and it's sufficient only: false means not proven, not a
	 * pocket. It reads false next to rough ground, on open ground rough
	 * country rings off, and at the rim or by a crater, though roads often
	 * find a way, and it ignores water. How much a road can reach is a fine
	 * flood fill over `impassable`.
	 */
	public surelyReachable(x: number, y: number): boolean {
		return this.land.surelyReachable(x, y);
	}

	/** A lake, a river, or neither at (x, y): the water layer's, none before it's laid. */
	public waterAt(x: number, y: number): WaterKind | null {
		return this.water === null ? null : this.water.waterAt(x, y);
	}

	/** Why (x, y) is impassable, or null: a crater, water, then a cliff. The metro's rivers are bridged everywhere. */
	public obstacle(x: number, y: number): Obstacle | null {
		return this.land.obstacle(x, y, this.water);
	}

	public impassable(x: number, y: number): boolean {
		return this.obstacle(x, y) !== null;
	}

	/**
	 * What a road of `roadClass` pays to drive from (x0, y0) to (x1, y1), a
	 * short move of a few world units to a land cell or so (`MOVE_COST`): the
	 * distance times one plus the grade along it squared and the slope
	 * across it squared, by class and `curviness`, plus a bridge for each
	 * river it crosses, dearer the longer the bridge. Infinity where its end
	 * or middle is impassable bar a bridge, where a bridge would run longer
	 * than `MOVE_COST.longestBridge`, or where it climbs too steeply for the
	 * class. Cost along a move, rather than of a point, is what makes roads
	 * follow the contours and the valley floors. Leaves the bridges' share in
	 * `parts`, when given.
	 */
	public moveCost(x0: number, y0: number, x1: number, y1: number, roadClass: RoadClass, parts?: { bridge: number }): number {
		return this.land.moveCost(x0, y0, x1, y1, roadClass, this.water, parts);
	}

	/**
	 * The stretches of the move from (x0, y0) to (x1, y1) on a bridge over a
	 * river it crosses, into `spans` as pairs of `along` (0 to 1), from then
	 * to: the river water a road can drive over. Returns how many.
	 */
	public bridgeSpans(x0: number, y0: number, x1: number, y1: number, spans: number[]): number {
		return this.land.bridgeSpans(x0, y0, x1, y1, this.water, spans);
	}

	/** Everything at (x, y) into `out`, sharing the work between fields. Returns `out`. */
	public sample(x: number, y: number, out: TerrainSample): TerrainSample {
		return this.land.sample(x, y, out, this.water);
	}
}

/** Whether no cell whose centre lies within `reach` of (x, y) carries `CRATER_DRAINAGE.area` cells of the land's drainage. */
function offDrainage({ surface, x, y, reach }: { surface: LandSurface; x: number; y: number; reach: number }): boolean {
	const { grid, drainage } = surface;
	const size = grid.size;
	const first = floor((x - reach + grid.halfExtent) / grid.cellSize);
	const last = floor((x + reach + grid.halfExtent) / grid.cellSize);
	const bottom = floor((y - reach + grid.halfExtent) / grid.cellSize);
	const top = floor((y + reach + grid.halfExtent) / grid.cellSize);
	for (let row = bottom < 0 ? 0 : bottom; row <= top && row < size; row += 1) {
		const dy = cellCentre(grid, row) - y;
		for (let column = first < 0 ? 0 : first; column <= last && column < size; column += 1) {
			const dx = cellCentre(grid, column) - x;
			if (dx * dx + dy * dy <= reach * reach && drainage.area[row * size + column] >= CRATER_DRAINAGE.area) return false;
		}
	}
	return true;
}

/**
 * Per cell, rough country's measure: how steep the country is, the eroded
 * land's grade averaged over `ROUGHNESS.blur` cells each way, swayed by
 * `ROUGHNESS.breaks` of a broad noise layer, so a long steep belt breaks
 * into stretches with gaps where a road can climb. None within the relief
 * radius, by a cell's diagonal, so no point inside it reads as rough.
 */
function roughnessField({ surface, reliefRadius, noise }: { surface: LandSurface; reliefRadius: number; noise: SimplexNoise }): { steepness: Float64Array; roughness: Float64Array } {
	const { grid, elevation } = surface;
	const size = grid.size;
	const grade = new Float64Array(size * size);
	const toGrade = RELIEF / grid.cellSize;
	for (let row = 0; row < size; row += 1) {
		const below = row > 0 ? row - 1 : row;
		const above = row < size - 1 ? row + 1 : row;
		for (let column = 0; column < size; column += 1) {
			const left = column > 0 ? column - 1 : column;
			const right = column < size - 1 ? column + 1 : column;
			const slopeX = (elevation[row * size + right] - elevation[row * size + left]) / (right - left) * toGrade;
			const slopeY = (elevation[above * size + column] - elevation[below * size + column]) / (above - below) * toGrade;
			grade[row * size + column] = sqrt(slopeX * slopeX + slopeY * slopeY);
		}
	}
	const steepness = blur(grade, size, ROUGHNESS.blur);
	const roughness = new Float64Array(size * size);
	const clear = reliefRadius + Math.SQRT2 * grid.cellSize;
	const clearSquared = clear * clear;
	const frequency = 1 / ROUGHNESS.wavelength;
	for (let row = 0; row < size; row += 1) {
		const y = cellCentre(grid, row);
		for (let column = 0; column < size; column += 1) {
			const x = cellCentre(grid, column);
			const cell = row * size + column;
			if (x * x + y * y < clearSquared) {
				steepness[cell] = 0;
				continue;
			}
			roughness[cell] = steepness[cell] * (1 + ROUGHNESS.breaks * noise.fractal(x * frequency, y * frequency, ROUGHNESS.octaves, 0.5));
		}
	}
	return { steepness, roughness };
}

/**
 * Per cell, the room badlands have: 1 where no cell within
 * `RANGE_CLEARANCE.reach` has any range lift, falling to 0 where one's range
 * mask reaches `RANGE_CLEARANCE.mask`, since a range's flanks run on past its
 * mask's middle and bend the land at their foot as steeply as any broken
 * ground; and, like the ranges, none in the metro, rising to full at the
 * relief radius.
 */
export function featureRoom({ surface, metroRadius, reliefRadius }: { surface: LandSurface; metroRadius: number; reliefRadius: number }): Float64Array {
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
 * `values` at the cells past `reliefRadius` and inside the disc: the land a
 * feature's share is of. Without `ranges`, only the cells outside the
 * ranges, unless the ranges cover all of it.
 */
export function landValues({ surface, radius, reliefRadius, values, ranges }: { surface: LandSurface; radius: number; reliefRadius: number; values: ArrayLike<number>; ranges: boolean }): number[] {
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
	return ranges || outside.length === 0 ? all : outside;
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

function ruinWeight(x: number, y: number, ruin: Ruin): number {
	const dx = x - ruin.x;
	const dy = y - ruin.y;
	const ratio = (dx * dx + dy * dy) / (ruin.radius * ruin.radius);
	if (ratio <= 1) return 1;
	if (ratio >= 4) return 0;
	return (4 - ratio) / 3;
}

