import type { Rng } from '../core/Rng';
import { HighwayDeparture, planHighways } from './Highways';
import type { MapParams } from './MapParams';
import type { Factions, PoiTuning } from './PoiData';
import { PoiMap, PoiStats, PoiTerrain, placePois } from './Pois';
import { GrowthStats, growRoads } from './RoadGrowth';

/**
 * Stages 2 to 5 of one map attempt (Area Map Generation, Validation and
 * retries): highways, growth, and POIs, with the lever for roads that fall
 * short of the outer band. Stage 5 can't move a road, so when its attempts
 * run out on one network, growth reruns on its next attempt and stage 5
 * starts over on the new roads, instead of the whole map restarting with
 * new terrain. Only when growth's attempts run out too does the caller
 * restart the map. Why this lever, and how often it's pulled, is in
 * docs/AI_TECHNICAL_DECISIONS/pois-and-strongholds.md.
 */

/** Attempts a stage gets before the stage before it reruns (the spec's 8 a stage). */
export const STAGE_ATTEMPTS = 8;

export interface DrivableMapOptions {
	terrain: PoiTerrain;
	/** Validated. */
	params: MapParams;
	/** The map attempt's stream, root.fork('map', mapAttempt). Each stage forks its own from it. */
	map: Rng;
	tuning?: PoiTuning;
	factions?: Factions;
}

/** A stage-5 run that couldn't seat a stronghold: the attempts it ran on, and the sector. */
export interface PoiFailure {
	readonly growth: number;
	readonly pois: number;
	readonly sector: number;
}

export interface DrivableMap {
	readonly highways: readonly HighwayDeparture[];
	/** Stage 5's output, or null when every growth attempt ran stage 5 out: restart the map. */
	readonly pois: PoiMap | null;
	/**
	 * The attempts the map was made on, or the last tried: growth's, on
	 * map.fork('growth', growth), and stage 5's, on map.fork('pois', pois).
	 * Stage 5 counts on across growth's attempts, so no stream is run twice.
	 */
	readonly attempts: { readonly growth: number; readonly pois: number };
	/** Every stage-5 run that failed on the way, in order. */
	readonly failures: readonly PoiFailure[];
	/** The last growth's and the last stage 5's. */
	readonly stats: { readonly growth: GrowthStats; readonly pois: PoiStats };
}

/**
 * Highways on map.fork('highways', 0), then for each growth attempt up to
 * `STAGE_ATTEMPTS`, growth and up to `STAGE_ATTEMPTS` runs of stage 5 on
 * it, until one seats every stronghold.
 */
export function layDrivableMap({ terrain, params, map, tuning, factions }: DrivableMapOptions): DrivableMap {
	const highways = planHighways({ terrain, params, rng: map.fork('highways', 0) });
	const failures: PoiFailure[] = [];
	let growthStats: GrowthStats | null = null;
	let poiStats: PoiStats | null = null;
	for (let growth = 0; growth < STAGE_ATTEMPTS; growth += 1) {
		const grown = growRoads({ terrain, params, highways, rng: map.fork('growth', growth) });
		growthStats = grown.stats;
		for (let run = 0; run < STAGE_ATTEMPTS; run += 1) {
			const pois = growth * STAGE_ATTEMPTS + run;
			const outcome = placePois({ terrain, params, network: grown.network, rng: map.fork('pois', pois), tuning, factions });
			poiStats = outcome.stats;
			if (outcome.placed) return { highways, pois: outcome.map, attempts: { growth, pois }, failures, stats: { growth: growthStats, pois: poiStats } };
			failures.push({ growth, pois, sector: outcome.sector });
		}
	}
	const last = STAGE_ATTEMPTS * STAGE_ATTEMPTS - 1;
	return {
		highways, pois: null, attempts: { growth: STAGE_ATTEMPTS - 1, pois: last }, failures,
		stats: { growth: growthStats as GrowthStats, pois: poiStats as PoiStats },
	};
}
