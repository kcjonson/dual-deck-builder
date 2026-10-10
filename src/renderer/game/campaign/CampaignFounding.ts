import type { AreaMapStageName } from '../map/AreaMapPipeline';
import { MapPipelineError, type StageAttempt } from '../map/MapPipeline';
import { MapGeneration, MapGenerationCancelled, type MapGenerationOptions, type MapGenerationResult } from '../map/worker/MapGeneration';
import type { Campaign } from './Campaign';
import { FoundingOptions, foundCampaign, prepareFounding } from './Founding';

/**
 * Founding a campaign with its area map: the params resolved, the map
 * generated in the generation worker, then `foundCampaign` on it. Holds the
 * founding contract (map-pipeline-worker.md): when generation gives up on a
 * seed, a release build starts over from the next one, params and deal
 * included, and a debug build rethrows.
 *
 *   const founding = new CampaignFounding({ seed: freshSeed(), unlockedArchetypes, onProgress });
 *   const { campaign, map } = await founding.result;
 */

/** Seeds founding tries before generation's failure stands: the one given and the three after it. */
export const FOUNDING_SEEDS = 4;

export interface FoundingProgress extends StageAttempt<AreaMapStageName> {
	/** Which seed of the `FOUNDING_SEEDS` this is, from 0; past 0, generation gave up on the ones before. */
	readonly seedAttempt: number;
}

/** What founding needs of a generation, which a MapGeneration is. */
export interface FoundingGeneration {
	readonly result: Promise<MapGenerationResult>;
	cancel(): void;
}

export type StartGeneration = (options: Pick<MapGenerationOptions, 'params' | 'onProgress'>) => FoundingGeneration;

export interface CampaignFoundingOptions extends Omit<FoundingOptions, 'map'> {
	/** Told as each generation stage attempt starts. */
	readonly onProgress?: (progress: FoundingProgress) => void;
	/** Debug builds rethrow when generation gives up on a seed, release builds take the next. `__DEV_TOOLS__` when left out. */
	readonly debug?: boolean;
	/** Starts a generation: a MapGeneration, in a worker where there is one, when left out. */
	readonly generate?: StartGeneration;
	/** Where a release build says it's moving on to the next seed: console.warn when left out. */
	readonly warn?: (message: string) => void;
}

export interface FoundedCampaign {
	readonly campaign: Campaign;
	/** Its area map as generated, for the session's map cache (`CampaignMaps.remember`). */
	readonly map: MapGenerationResult;
}

const startMapGeneration: StartGeneration = (options) => new MapGeneration(options);

export class CampaignFounding {
	/** The campaign and its map; rejects with what stopped it, MapGenerationCancelled after `cancel`. */
	public readonly result: Promise<FoundedCampaign>;

	private generation: FoundingGeneration | null = null;
	private cancelled = false;

	constructor(options: CampaignFoundingOptions) {
		this.result = this.found(options);
	}

	/** Stops the founding, terminating its generation, and rejects `result` with MapGenerationCancelled. Nothing once it has settled. */
	public cancel(): void {
		if (this.cancelled) return;
		this.cancelled = true;
		// A caller that cancels has stopped listening, so the rejection mustn't surface as unhandled.
		this.result.catch(() => undefined);
		this.generation?.cancel();
	}

	private async found({ onProgress, debug = __DEV_TOOLS__, generate = startMapGeneration, warn = (message) => console.warn(message), ...options }: CampaignFoundingOptions): Promise<FoundedCampaign> {
		let failure: unknown = null;
		for (let seedAttempt = 0; seedAttempt < FOUNDING_SEEDS; seedAttempt += 1) {
			// The given seed is checked as it is; later ones are only reached from a checked uint32, and wrap the way the PRNG does.
			const founding = { ...options, seed: seedAttempt === 0 ? options.seed : (options.seed + seedAttempt) >>> 0 };
			const { params } = prepareFounding(founding);
			if (this.cancelled) throw new MapGenerationCancelled();
			this.generation = generate({ params, onProgress: (progress) => onProgress?.({ ...progress, seedAttempt }) });
			let map: MapGenerationResult;
			try {
				map = await this.generation.result;
			} catch (error) {
				// Params given rather than rolled (the Map Lab's) belong to their seed, so only rolled params move on.
				const nextSeed = error instanceof MapPipelineError && error.exhausted === 'map' && !debug && options.mapParams === undefined;
				if (this.cancelled || !nextSeed) throw error;
				failure = error;
				if (seedAttempt + 1 < FOUNDING_SEEDS) warn(`CampaignFounding: no map on seed ${founding.seed} (${error.message}); founding on seed ${(founding.seed + 1) >>> 0}`);
				continue;
			}
			if (this.cancelled) throw new MapGenerationCancelled();
			return { campaign: foundCampaign({ ...founding, map }), map };
		}
		throw failure;
	}
}
