import type { AreaMapProgress } from '../../campaign/CampaignMaps';
import { meshMap, randomMesh } from '../../map/meshTesting';
import { NO_RIVERS, flatTerrain } from '../../ui/areaMap/testing';
import { PlanningMap, PlanningMaps } from './planningMap';

/**
 * Fixtures the planning screens' tests share: a campaign map with POIs,
 * routes, and stops, which a generation takes most of a second to make, and
 * a map source that hands it over. Nothing in the game imports this file.
 */

/** A random mesh with POIs, strongholds, routes, and stops on flat ground (meshTesting.ts), as a generated map holds them. */
export function meshPlanningMap({ seed = 900, spacing = 85, poiSeed = 0, daylightHours = 14 }: { seed?: number; spacing?: number; poiSeed?: number; daylightHours?: number } = {}): PlanningMap {
	const network = randomMesh({ seed, spacing });
	const mesh = meshMap(network, { seed: poiSeed, daylightHours });
	return {
		params: mesh.params,
		products: { ...mesh.products, water: { terrain: flatTerrain({ radius: 1000 }), lines: NO_RIVERS }, roads: { network } },
	};
}

/** The map's progress through one stage, as a generation reports it. */
export const ROADS_PROGRESS: AreaMapProgress = { stage: 'roads', index: 2, count: 6, attempt: 0, mapAttempt: 0, seed: 1 };

export interface TestMaps {
	readonly maps: PlanningMaps;
	/** How many times a screen asked for a map it didn't know. */
	readonly asked: () => number;
	/** How many of those stopped waiting. */
	readonly aborted: () => number;
	/** Hands the waiting requests their map, or their error. */
	readonly finish: () => Promise<void>;
}

/**
 * Planning maps over a source that answers every campaign with `map`: at
 * once (a microtask later), or, `held`, only when `finish` is called,
 * telling `ROADS_PROGRESS` as it starts. With `error` it rejects instead,
 * and a request whose signal aborts rejects with an AbortError, as the
 * session's map cache does. `aborted` counts those.
 */
export function testMaps(map: PlanningMap = meshPlanningMap(), { held = false, error = null }: { held?: boolean; error?: Error | null } = {}): TestMaps {
	let asked = 0;
	let aborted = 0;
	const waiting: (() => void)[] = [];
	const maps = new PlanningMaps({
		source: {
			mapOf: (_campaign, { onProgress, signal } = {}) => {
				asked += 1;
				onProgress?.(ROADS_PROGRESS);
				return new Promise<PlanningMap>((resolve, reject) => {
					signal?.addEventListener('abort', () => {
						aborted += 1;
						reject(new DOMException('stopped waiting for the area map', 'AbortError'));
					}, { once: true });
					const answer = () => (error ? reject(error) : resolve(map));
					if (held) waiting.push(answer);
					else void Promise.resolve().then(answer);
				});
			},
		},
	});
	return {
		maps,
		asked: () => asked,
		aborted: () => aborted,
		finish: async () => {
			waiting.splice(0).forEach((answer) => answer());
			// Through the screens' awaits after the answer.
			for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
		},
	};
}
