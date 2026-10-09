import { Rng } from '../core/Rng';
import { AreaMapProducts, TERRAIN_STAGE, areaMapPipeline } from './AreaMapPipeline';
import type { HighwayDeparture } from './Highways';
import { MAP_PARAMETERS, MapParamSet, MapParams, NUMBER_PARAMS, ENVIRONMENTS, resolveMapParams } from './MapParams';
import { AcceptHook, MapStage, PipelineResult } from './MapPipeline';
import { validateMapParams } from './ParamValidator';
import { GROWTH_RANGES, GROWTH_TUNING, GrowthStats, GrowthTerrain, GrowthTuning } from './RoadGrowth';
import { RoadClass, RoadNetwork } from './RoadNetwork';
import type { Terrain, WaterLayer } from './Terrain';
import type { Hotspot } from './TerrainSites';

/**
 * Fixtures for the road growth tests. Nothing in the game imports this file.
 */

export function paramsFor(set: MapParamSet): MapParams {
	return validateMapParams(resolveMapParams(set).params).params;
}

/** A parameter set with growth's own knobs beside it. */
export type GrowthSet = MapParamSet & GrowthTuning;

export interface GrownMap {
	readonly params: MapParams;
	/** The clearance growth kept, for the network checks. */
	readonly clearance: number;
	readonly terrain: Terrain;
	readonly highways: readonly HighwayDeparture[];
	readonly network: RoadNetwork;
	readonly stats: GrowthStats;
	/** Each stage's winning attempt, and the map attempt they won in. */
	readonly attempts: PipelineResult<AreaMapProducts>['attempts'];
	readonly mapAttempt: number;
}

/**
 * The area map's stages through the pipeline runner, with water laid over
 * the terrain when given. The runner retries a stage that fails its checks,
 * which would retry a growth regression out of a test's sight, so this
 * throws unless every stage won its first attempt on the first map attempt.
 * A caller that passes `accept` is steering the retries itself, and gets
 * whatever won.
 */
export function growMap(set: GrowthSet, { water, accept }: { water?: WaterLayer; accept?: AcceptHook<AreaMapProducts> } = {}): GrownMap {
	const { branchiness, clearance = GROWTH_TUNING.clearance, ...mapSet } = set;
	const params = paramsFor(mapSet);
	const terrain: MapStage<MapParams, Record<never, never>, 'terrain', Terrain> | undefined = water
		? { name: 'terrain', run: (context) => TERRAIN_STAGE.run(context).withWater(water) }
		: undefined;
	const { products, attempts, mapAttempt, failures } = areaMapPipeline({ growth: { branchiness, clearance }, terrain })
		.run({ seed: params.seed, input: params, accept });
	if (!accept && failures.length > 0) {
		const shown = failures.slice(0, 3).map(({ stage, attempt, mapAttempt: map, problems }) => `${stage} attempt ${attempt}, map attempt ${map}: ${problems.slice(0, 3).join('; ')}`);
		throw new Error(`growMap: seed ${params.seed} needed a retry, which hides what failed: ${shown.join(' | ')}`);
	}
	return { params, clearance, terrain: products.terrain, highways: products.highways, network: products.growth.network, stats: products.growth.stats, attempts, mapAttempt };
}

export interface FakeTerrainOptions {
	radius?: number;
	metroRadius?: number;
	hotspots?: Hotspot[];
	/** Travel cost on passable ground; 1 everywhere when left out. */
	cost?: (x: number, y: number) => number;
	/** Impassable ground besides craters. */
	wall?: (x: number, y: number) => boolean;
	rough?: (x: number, y: number) => boolean;
}

/** A terrain made of functions, for steering growth with ground no seed would draw. */
export function fakeTerrain({ radius = 1000, metroRadius = 150, hotspots = [], cost, wall, rough }: FakeTerrainOptions = {}): GrowthTerrain {
	const impassable = (x: number, y: number) => hotspots.some((hotspot) => (x - hotspot.x) ** 2 + (y - hotspot.y) ** 2 < hotspot.craterRadius ** 2)
		|| (wall?.(x, y) ?? false);
	return {
		radius,
		metro: { x: 0, y: 0, radius: metroRadius },
		hotspots,
		impassable,
		travelCost: (x, y) => (impassable(x, y) ? Infinity : cost?.(x, y) ?? 1),
		rough: (x, y) => rough?.(x, y) ?? false,
	};
}

/** One highway leaving a metro of `metroRadius` at `bearing`, its drift knots as given (degrees) and level after. */
export function departure(bearing: number, metroRadius: number, drift: number[] = [0]): HighwayDeparture {
	const radians = bearing * Math.PI / 180;
	return { bearing, x: metroRadius * Math.cos(radians), y: metroRadius * Math.sin(radians), drift };
}

/**
 * Parameter sets across the tuning ranges: the corners that push hardest on
 * growth first (dense and sparse, tight and loose, straight and winding, on
 * the smallest and largest maps), then random sets where each world or
 * network number, `strongholds`, and growth's own knobs are at an end of
 * their range two times in five. The validator keeps `highways` at
 * `strongholds` plus 2, so the corners hold strongholds at 2 to reach the
 * fewest highways a map can have, 4; left at the default of 4, every map
 * would grow 6 or more.
 */
export function sampledRoadParamSets(count: number): GrowthSet[] {
	const corners: GrowthSet[] = [
		{ seed: 1, radius: 600, strongholds: 2, highways: 9, highwaySeparation: 20, branchiness: 1, curviness: 1, clearance: 60, metroSize: 0.08, ruggedness: 1, mountainCoverage: 1, aridity: 0, hotspots: 6 },
		{ seed: 2, radius: 1600, strongholds: 2, highways: 9, highwaySeparation: 40, branchiness: 1, curviness: 0, clearance: 10, trailShare: 1, metroSize: 0.25 },
		{ seed: 3, radius: 600, strongholds: 2, highways: 4, highwaySeparation: 60, branchiness: 0, curviness: 0, clearance: 10, trailShare: 0 },
		{ seed: 4, radius: 1600, strongholds: 2, highways: 4, highwaySeparation: 20, branchiness: 0.5, curviness: 1, clearance: 60, environment: 'badlands', hotspots: 6 },
		{ seed: 5, radius: 1000, strongholds: 2, highways: 9, highwaySeparation: 40, branchiness: 1, curviness: 0.5, clearance: 24, metroSize: 0.08, mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1 },
	];
	const rng = new Rng({ seed: 2026 });
	const draw = ({ kind, tuning }: { kind: 'int' | 'float'; tuning: { min: number; max: number } }): number => {
		const end = rng.float();
		const value = end < 0.2 ? tuning.min : end < 0.4 ? tuning.max : tuning.min + (tuning.max - tuning.min) * rng.float();
		return kind === 'int' ? Math.round(value) : value;
	};
	const random = Array.from({ length: Math.max(0, count - corners.length) }, (): GrowthSet => {
		const set: GrowthSet = { seed: rng.next(), environment: rng.pick(ENVIRONMENTS) };
		for (const name of NUMBER_PARAMS) {
			const spec = MAP_PARAMETERS[name];
			if (spec.group === 'world' || spec.group === 'network' || name === 'strongholds') set[name] = draw(spec);
		}
		set.branchiness = draw(GROWTH_RANGES.branchiness);
		set.clearance = draw(GROWTH_RANGES.clearance);
		return set;
	});
	return [...corners.slice(0, count), ...random];
}

/** A road's whole polyline, stretch after stretch, with each segment's class. */
export interface RoadLine {
	readonly road: number;
	readonly points: number[];
	readonly classes: RoadClass[];
}

export function roadLines(network: RoadNetwork): RoadLine[] {
	return network.roads.map((road, id) => {
		const points: number[] = [];
		const classes: RoadClass[] = [];
		road.stretches.forEach((stretchId, place) => {
			const stretch = network.stretches[stretchId];
			const from = place === 0 ? 0 : 2;
			for (let point = from; point < stretch.points.length; point += 1) points.push(stretch.points[point]);
			for (let segment = 0; segment + 3 < stretch.points.length; segment += 2) classes.push(stretch.roadClass);
		});
		return { road: id, points, classes };
	});
}

/** Degrees between two directions. */
export function degreesBetween(ax: number, ay: number, bx: number, by: number): number {
	const cos = (ax * bx + ay * by) / Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by));
	return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}
