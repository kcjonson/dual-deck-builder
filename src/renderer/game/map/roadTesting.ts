import { Rng } from '../core/Rng';
import { ROADS_STAGE, TERRAIN_STAGE, WATER_STAGE } from './AreaMapPipeline';
import { ENVIRONMENTS, MAP_PARAMETERS, MapParamSet, MapParams, NUMBER_PARAMS, resolveMapParams } from './MapParams';
import { MapPipeline, PipelineResult } from './MapPipeline';
import { validateMapParams } from './ParamValidator';
import type { RoadGround } from './RoadChecks';
import type { RoadNetwork } from './RoadNetwork';
import type { Roads } from './Roads';
import { Obstacle, Terrain, generateTerrain } from './Terrain';
import { Water, generateWater } from './Water';

/**
 * Fixtures for the road tests. Nothing in the game imports this file.
 */

export function paramsFor(set: MapParamSet): MapParams {
	return validateMapParams(resolveMapParams(set).params).params;
}

interface RoadProducts {
	readonly terrain: Terrain;
	readonly water: Water;
	readonly roads: Roads;
}

/** The area map's stages up to the roads, through the runner. */
export function roadPipeline(): MapPipeline<MapParams, RoadProducts> {
	return new MapPipeline<MapParams>().stage(TERRAIN_STAGE).stage(WATER_STAGE).stage(ROADS_STAGE);
}

export interface RoadMap {
	readonly params: MapParams;
	/** The land with its water, which the roads were laid over. */
	readonly terrain: Terrain;
	readonly water: Water;
	readonly roads: Roads;
	readonly network: RoadNetwork;
	readonly result: PipelineResult<RoadProducts>;
}

/**
 * A map's roads through the runner. The roads stage may retry on its next
 * stream when it closes too few loops, as the spec has it; any other failure
 * is a broken rule that a retry would hide, so this throws on one.
 */
export function roadMap(set: MapParamSet): RoadMap {
	const params = paramsFor(set);
	const result = roadPipeline().run({ seed: params.seed, input: params, debug: true });
	const broken = result.failures.filter(({ problems }) => problems.some((problem) => !problem.startsWith('loops:')));
	if (broken.length > 0) {
		const shown = broken.slice(0, 3).map(({ stage, attempt, mapAttempt, problems }) => `${stage} attempt ${attempt}, map attempt ${mapAttempt}: ${problems.slice(0, 3).join('; ')}`);
		throw new Error(`roadMap: seed ${params.seed} broke a rule, which a retry hides: ${shown.join(' | ')}`);
	}
	const { water, roads } = result.products;
	return { params, terrain: water.terrain, water, roads, network: roads.network, result };
}

/** The land with its water for a set, on the pipeline's first streams, and the roads stage's first stream. */
export function landFor(set: MapParamSet): { params: MapParams; terrain: Terrain; water: Water; rng: Rng } {
	const params = paramsFor(set);
	const terrainStream = new Rng({ seed: params.seed }).fork('map', 0).fork('terrain', 0);
	const waterStream = terrainStream.fork('water', 0);
	const water = generateWater({ params, terrain: generateTerrain({ params, rng: terrainStream }), rng: waterStream });
	return { params, terrain: water.terrain, water, rng: waterStream.fork('roads', 0) };
}

/**
 * World units of road in river water off its bridges' decks and Home's own
 * cells, sampled every half unit along every stretch, the metro's rivers
 * included: none, when roads cross rivers rather than run along them.
 */
export function riverOffDecks(network: RoadNetwork, terrain: Terrain): number {
	const home = terrain.surface.grid.cellSize;
	let wet = 0;
	for (const { points, bridges } of network.stretches) {
		let along = 0;
		for (let point = 0; point + 3 < points.length; point += 2) {
			const dx = points[point + 2] - points[point];
			const dy = points[point + 3] - points[point + 1];
			const length = Math.sqrt(dx * dx + dy * dy);
			const samples = Math.max(1, Math.ceil(length / 0.5));
			for (let sample = 1; sample <= samples; sample += 1) {
				const x = points[point] + dx * sample / samples;
				const y = points[point + 1] + dy * sample / samples;
				const at = along + length * sample / samples;
				if (Math.abs(x) <= home && Math.abs(y) <= home) continue;
				if (terrain.waterAt(x, y) !== 'river' || bridges.some(({ start, end }) => at >= start && at <= end)) continue;
				wet += length / samples;
			}
			along += length;
		}
	}
	return wet;
}

export interface FakeGroundOptions {
	radius?: number;
	metroRadius?: number;
	/** Impassable ground, which reads as a cliff. */
	wall?: (x: number, y: number) => boolean;
}

/** Land made of functions for the network checks: a disc, a metro, a wall, and no rivers. */
export function fakeGround({ radius = 1000, metroRadius = 150, wall }: FakeGroundOptions = {}): RoadGround {
	return {
		radius,
		metro: { x: 0, y: 0, radius: metroRadius },
		obstacle: (x: number, y: number): Obstacle | null => (wall?.(x, y) ? 'cliff' : null),
		waterAt: () => null,
		bridgeSpans: () => 0,
	};
}

/**
 * Parameter sets across the tuning ranges: the corners that push hardest on
 * the roads first (small and large, rugged and flat, sparse and dense,
 * straight and winding), then random sets where each world, network, and
 * gameplay number is at an end of its range two times in five.
 */
export function sampledRoadParamSets(count: number): MapParamSet[] {
	const corners: MapParamSet[] = [
		{ seed: 1, radius: 600, highways: 9, highwaySeparation: 20, curviness: 1, metroSize: 0.08, ruggedness: 1, mountainCoverage: 1, aridity: 0, hotspots: 6, roadDensity: 1 },
		{ seed: 2, radius: 1600, highways: 9, highwaySeparation: 40, curviness: 0, trailShare: 1, metroSize: 0.25, roadDensity: 0, loops: 0 },
		{ seed: 3, radius: 600, curviness: 0, trailShare: 0, loops: 1, lakes: 8, rivers: 6 },
		{ seed: 4, radius: 1600, curviness: 1, environment: 'badlands', hotspots: 6, roadDensity: 1, loops: 1 },
		{ seed: 5, radius: 1000, metroSize: 0.08, mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1 },
	];
	const rng = new Rng({ seed: 2026 });
	const draw = ({ kind, tuning }: { kind: 'int' | 'float'; tuning: { min: number; max: number } }): number => {
		const end = rng.float();
		const value = end < 0.2 ? tuning.min : end < 0.4 ? tuning.max : tuning.min + (tuning.max - tuning.min) * rng.float();
		return kind === 'int' ? Math.round(value) : value;
	};
	const random = Array.from({ length: Math.max(0, count - corners.length) }, (): MapParamSet => {
		const set: MapParamSet = { seed: rng.next(), environment: rng.pick(ENVIRONMENTS) };
		for (const name of NUMBER_PARAMS) {
			const spec = MAP_PARAMETERS[name];
			if (spec.group === 'world' || spec.group === 'network' || name === 'strongholds' || name === 'poiDensity') set[name] = draw(spec);
		}
		return set;
	});
	return [...corners.slice(0, count), ...random];
}
