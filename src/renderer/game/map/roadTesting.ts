import { Rng } from '../core/Rng';
import type { Biome } from './Biome';
import { DrivableMap, layDrivableMap } from './DrivableMap';
import { HighwayDeparture, planHighways } from './Highways';
import { MAP_PARAMETERS, MapParamSet, MapParams, NUMBER_PARAMS, ENVIRONMENTS, resolveMapParams } from './MapParams';
import { validateMapParams } from './ParamValidator';
import type { PoiTerrain } from './Pois';
import { GrowthStats, growRoads } from './RoadGrowth';
import { Road, RoadClass, RoadNetwork, RoadNode, RoadStretch } from './RoadNetwork';
import { Terrain, WaterLayer, generateTerrain } from './Terrain';
import type { Hotspot } from './TerrainSites';

/**
 * Fixtures for the road growth and POI tests. Nothing in the game imports this file.
 */

/** A stage's stream as the pipeline forks it: root.fork('map', 0).fork(stage, attempt). */
export function pipelineStream(seed: number, stage: string, attempt = 0): Rng {
	return new Rng({ seed }).fork('map', 0).fork(stage, attempt);
}

export function paramsFor(set: MapParamSet): MapParams {
	return validateMapParams(resolveMapParams(set).params).params;
}

export interface GrownMap {
	readonly params: MapParams;
	readonly terrain: Terrain;
	readonly highways: HighwayDeparture[];
	readonly network: RoadNetwork;
	readonly stats: GrowthStats;
}

/** Stages 1 to 3 on the pipeline's streams, with water added when given. */
export function growMap(set: MapParamSet, { growthAttempt = 0, water }: { growthAttempt?: number; water?: WaterLayer } = {}): GrownMap {
	const params = paramsFor(set);
	const land = generateTerrain({ params, rng: pipelineStream(params.seed, 'terrain') });
	const terrain = water ? land.withWater(water) : land;
	const highways = planHighways({ terrain, params, rng: pipelineStream(params.seed, 'highways') });
	const { network, stats } = growRoads({ terrain, params, highways, rng: pipelineStream(params.seed, 'growth', growthAttempt) });
	return { params, terrain, highways, network, stats };
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
	/** Scrub everywhere when left out. */
	biome?: (x: number, y: number) => Biome;
	/** No ruins when left out. */
	ruin?: (x: number, y: number) => number;
	elevation?: (x: number, y: number) => number;
	moisture?: (x: number, y: number) => number;
}

/** A terrain made of functions, for steering growth and stage 5 with ground no seed would draw. */
export function fakeTerrain({
	radius = 1000, metroRadius = 150, hotspots = [], cost, wall, rough, biome, ruin, elevation, moisture,
}: FakeTerrainOptions = {}): PoiTerrain {
	const impassable = (x: number, y: number) => hotspots.some((hotspot) => (x - hotspot.x) ** 2 + (y - hotspot.y) ** 2 < hotspot.craterRadius ** 2)
		|| (wall?.(x, y) ?? false);
	return {
		radius,
		metro: { x: 0, y: 0, radius: metroRadius },
		hotspots,
		impassable,
		travelCost: (x, y) => (impassable(x, y) ? Infinity : cost?.(x, y) ?? 1),
		rough: (x, y) => rough?.(x, y) ?? false,
		biome: (x, y) => biome?.(x, y) ?? 'scrub',
		ruin: (x, y) => ruin?.(x, y) ?? 0,
		elevation: (x, y) => elevation?.(x, y) ?? 0.45,
		moisture: (x, y) => moisture?.(x, y) ?? 0.45,
	};
}

/** A straight road in a hand-built network: from where it starts, out on its bearing, to where it ends. */
export interface StraightRoad {
	/** Degrees counterclockwise from east. */
	readonly bearing: number;
	/** World units from the compound it ends at, measured along it... */
	readonly length: number;
	/** ...and how it ends: at the rim, blocked, or blocked as it left the metro. */
	readonly ending?: 'exit' | 'end' | 'metroEdge';
	/** For a branch: the road it leaves, and how far along that road (from the compound) its junction is. */
	readonly from?: { readonly road: number; readonly at: number };
}

/**
 * A network of straight roads as growth's plain data: highways out of a
 * metro of `metroRadius`, a city street and then one stretch, and branches
 * off them, back roads, each splitting its parent's last stretch at the
 * vertex nearest its junction. A vertex every `spacing` units. A branch
 * comes after the road it leaves.
 */
export function straightNetwork(roads: readonly StraightRoad[], { metroRadius = 150, spacing = 5 } = {}): RoadNetwork {
	const nodes: { kind: RoadNode['kind']; x: number; y: number }[] = [{ kind: 'compound', x: 0, y: 0 }];
	const stretches: RoadStretch[] = [];
	const built: Road[] = [];
	const addNode = (kind: RoadNode['kind'], x: number, y: number) => nodes.push({ kind, x, y }) - 1;
	const addStretch = (stretch: RoadStretch) => stretches.push(stretch) - 1;
	const line = (fromX: number, fromY: number, bearing: number, length: number) => {
		const dx = Math.cos(bearing * Math.PI / 180);
		const dy = Math.sin(bearing * Math.PI / 180);
		const steps = Math.max(1, Math.round(length / spacing));
		const points: number[] = [];
		for (let step = 0; step <= steps; step += 1) points.push(fromX + dx * length * step / steps, fromY + dy * length * step / steps);
		return points;
	};
	roads.forEach((road, id) => {
		const ending = road.ending ?? 'exit';
		if (road.from === undefined) {
			const street = line(0, 0, road.bearing, metroRadius);
			const edgeX = street[street.length - 2];
			const edgeY = street[street.length - 1];
			const edge = addNode('metroEdge', edgeX, edgeY);
			const chain = [addStretch({ road: id, roadClass: 'highway', from: 0, to: edge, parent: -1, points: [0, 0, edgeX, edgeY] })];
			if (ending !== 'metroEdge') {
				const points = line(edgeX, edgeY, road.bearing, road.length - metroRadius);
				const end = addNode(ending, points[points.length - 2], points[points.length - 1]);
				chain.push(addStretch({ road: id, roadClass: 'highway', from: edge, to: end, parent: chain[0], points }));
			}
			built.push({ roadClass: 'highway', parent: -1, from: 0, stretches: chain });
			return;
		}
		const parent = built[road.from.road];
		const chain = parent.stretches as number[];
		const host = chain[chain.length - 1];
		const hostStretch = stretches[host];
		let vertex = 1;
		for (let point = 1; point < hostStretch.points.length / 2 - 1; point += 1) {
			const along = Math.hypot(hostStretch.points[2 * point], hostStretch.points[2 * point + 1]);
			const best = Math.hypot(hostStretch.points[2 * vertex], hostStretch.points[2 * vertex + 1]);
			if (Math.abs(along - road.from.at) < Math.abs(best - road.from.at)) vertex = point;
		}
		const junction = addNode('junction', hostStretch.points[2 * vertex], hostStretch.points[2 * vertex + 1]);
		const outer = addStretch({ ...hostStretch, from: junction, parent: host, points: hostStretch.points.slice(2 * vertex) });
		stretches[host] = { ...hostStretch, to: junction, points: hostStretch.points.slice(0, 2 * vertex + 2) };
		chain.push(outer);
		const points = line(nodes[junction].x, nodes[junction].y, road.bearing, road.length);
		const end = addNode(ending === 'metroEdge' ? 'end' : ending, points[points.length - 2], points[points.length - 1]);
		built.push({ roadClass: 'backRoad', parent: road.from.road, from: junction, stretches: [addStretch({ road: id, roadClass: 'backRoad', from: junction, to: end, parent: host, points })] });
	});
	return { nodes: nodes.map(({ kind, x, y }) => ({ kind, x, y })), roads: built, stretches };
}

export interface LaidMap {
	readonly params: MapParams;
	readonly terrain: Terrain;
	readonly laid: DrivableMap;
	/** The map attempt it was laid on. */
	readonly mapAttempt: number;
}

/**
 * Stages 1 to 5 on the pipeline's streams, with the lever (`layDrivableMap`)
 * and, when that runs out, the whole map restarted on its next attempt, up
 * to `mapAttempts`. The last attempt's when none lays a map.
 */
export function layMap(set: MapParamSet, { mapAttempts = 4 }: { mapAttempts?: number } = {}): LaidMap {
	const params = paramsFor(set);
	const root = new Rng({ seed: params.seed });
	let laidMap: LaidMap | null = null;
	for (let mapAttempt = 0; mapAttempt < mapAttempts; mapAttempt += 1) {
		const map = root.fork('map', mapAttempt);
		const terrain = generateTerrain({ params, rng: map.fork('terrain', 0) });
		laidMap = { params, terrain, laid: layDrivableMap({ terrain, params, map }), mapAttempt };
		if (laidMap.laid.pois !== null) break;
	}
	return laidMap as LaidMap;
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
 * network number, and `strongholds`, is at an end of its range two times in
 * five. The validator keeps `highways` at `strongholds` plus 2, so the
 * corners hold strongholds at 2 to reach the fewest highways a map can have,
 * 4; left at the default of 4, every map would grow 6 or more.
 */
export function sampledRoadParamSets(count: number): MapParamSet[] {
	const corners: MapParamSet[] = [
		{ seed: 1, radius: 600, strongholds: 2, highways: 9, highwaySeparation: 20, branchiness: 1, curviness: 1, roadClearance: 60, metroSize: 0.08, ruggedness: 1, mountainCoverage: 1, aridity: 0, hotspots: 6 },
		{ seed: 2, radius: 1600, strongholds: 2, highways: 9, highwaySeparation: 40, branchiness: 1, curviness: 0, roadClearance: 10, trailShare: 1, metroSize: 0.25 },
		{ seed: 3, radius: 600, strongholds: 2, highways: 4, highwaySeparation: 60, branchiness: 0, curviness: 0, roadClearance: 10, trailShare: 0 },
		{ seed: 4, radius: 1600, strongholds: 2, highways: 4, highwaySeparation: 20, branchiness: 0.5, curviness: 1, roadClearance: 60, environment: 'badlands', hotspots: 6 },
		{ seed: 5, radius: 1000, strongholds: 2, highways: 9, highwaySeparation: 40, branchiness: 1, curviness: 0.5, roadClearance: 24, metroSize: 0.08, mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1 },
	];
	const rng = new Rng({ seed: 2026 });
	const random = Array.from({ length: Math.max(0, count - corners.length) }, (): MapParamSet => {
		const set: MapParamSet = { seed: rng.next(), environment: rng.pick(ENVIRONMENTS) };
		for (const name of NUMBER_PARAMS) {
			const { group, kind, tuning } = MAP_PARAMETERS[name];
			if (group !== 'world' && group !== 'network' && name !== 'strongholds') continue;
			const draw = rng.float();
			const value = draw < 0.2 ? tuning.min : draw < 0.4 ? tuning.max : tuning.min + (tuning.max - tuning.min) * rng.float();
			set[name] = kind === 'int' ? Math.round(value) : value;
		}
		return set;
	});
	return [...corners.slice(0, count), ...random];
}

/**
 * Parameter sets for stage 5 across the tuning ranges: corners that push on
 * it first (the most and fewest strongholds, sparse and dense POIs, two and
 * three routes, small maps with wide clearances, large ones with tight),
 * then random sets where each world or network number, and strongholds,
 * POI density, and routes per POI, is at an end of its range two times in
 * five.
 */
export function sampledPoiParamSets(count: number): MapParamSet[] {
	const corners: MapParamSet[] = [
		{ seed: 1, radius: 600, strongholds: 2, poiDensity: 2, routesTarget: 3, roadClearance: 10, branchiness: 1 },
		{ seed: 2, radius: 1600, strongholds: 8, highways: 9, poiDensity: 2, routesTarget: 3, highwaySeparation: 20 },
		{ seed: 3, radius: 1000, strongholds: 8, poiDensity: 0.5, routesTarget: 2 },
		{ seed: 4, radius: 600, strongholds: 5, roadClearance: 60, metroSize: 0.25, poiDensity: 2 },
		{ seed: 5, radius: 1200, strongholds: 4, environment: 'badlands', branchiness: 0.3 },
	];
	const gameplay = ['strongholds', 'poiDensity', 'routesTarget'];
	const rng = new Rng({ seed: 291 });
	const random = Array.from({ length: Math.max(0, count - corners.length) }, (): MapParamSet => {
		const set: MapParamSet = { seed: rng.next(), environment: rng.pick(ENVIRONMENTS) };
		for (const name of NUMBER_PARAMS) {
			const { group, kind, tuning } = MAP_PARAMETERS[name];
			if (group !== 'world' && group !== 'network' && !gameplay.includes(name)) continue;
			const draw = rng.float();
			const value = draw < 0.2 ? tuning.min : draw < 0.4 ? tuning.max : tuning.min + (tuning.max - tuning.min) * rng.float();
			set[name] = kind === 'int' ? Math.round(value) : value;
		}
		return set;
	});
	return [...corners.slice(0, count), ...random];
}

/**
 * The corners of the tuning ranges where stage 5 can't promise a map within
 * the restarts a test can afford, and sometimes not at all (see
 * pois-and-strongholds.md, Where it falls short):
 *
 * - rough: mountains on 0.4 of the land or more, ruggedness 0.7 or more,
 *   where roads give out in cliff country and approaches stall;
 * - crowded: seven strongholds, the most the validator leaves, or five or
 *   more on a map whose clearance is 0.08 of its radius or more, where
 *   narrow sectors leave no room for a site between two groups of roads.
 */
export function inHardCorner(params: MapParams): boolean {
	const rough = params.mountainCoverage >= 0.4 && params.ruggedness >= 0.7;
	const crowded = params.strongholds >= 7 || (params.strongholds >= 5 && params.roadClearance >= 0.08 * params.radius);
	return rough || crowded;
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
