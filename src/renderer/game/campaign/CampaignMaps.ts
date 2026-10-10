import { AREA_MAP_GENERATOR_VERSION, AreaMapGeneration, AreaMapStageName } from '../map/AreaMapPipeline';
import type { PipelineReplay, StageAttempt } from '../map/MapPipeline';
import { MapGeneration, type MapGenerationOptions } from '../map/worker/MapGeneration';
import type { Campaign } from './Campaign';

/**
 * The session's area map. Founding hands over the map it generated; a
 * loaded campaign's is made again from its seed, params, and map attempts,
 * in the generation worker, since saves don't keep the map's lines yet
 * (DDB-436). Either way it's kept for the session, so it's made at most once.
 * One campaign's map is kept at a time: asking for another's drops it,
 * cancelling it if it's still being made. A campaign whose map another
 * generator version made can't have it made again; the store reads its save
 * as outdated, as it does one of another save format version.
 *
 *   CampaignMaps.shared.prepare(campaign);                  // Continue: start it, wait for nothing
 *   const map = await getAreaMap(campaign, { onProgress }); // a screen that needs it
 */

export type AreaMapProgress = StageAttempt<AreaMapStageName>;

/** What the cache needs of a generation, which a MapGeneration is. */
export interface CampaignMapGeneration {
	readonly result: Promise<AreaMapGeneration>;
	cancel(): void;
}

export interface CampaignMapsOptions {
	/** Starts a regeneration: a MapGeneration, in a worker where there is one, when left out. */
	generate?: (options: Pick<MapGenerationOptions, 'params' | 'replay' | 'onProgress'>) => CampaignMapGeneration;
}

export interface AreaMapRequest {
	/** Told as each stage starts while the map is being made; never called for a map already made. */
	onProgress?: (progress: AreaMapProgress) => void;
}

interface Kept {
	/** Which map: the generator version, the seed, the params, and the attempts. */
	readonly key: string;
	readonly map: Promise<AreaMapGeneration>;
	/** While it's being made. */
	generation: CampaignMapGeneration | null;
	readonly listeners: Set<(progress: AreaMapProgress) => void>;
}

export class CampaignMaps {
	/** The game's, which founding fills and screens read. */
	public static readonly shared = new CampaignMaps();

	private readonly generate: NonNullable<CampaignMapsOptions['generate']>;
	private kept: Kept | null = null;

	constructor({ generate = (options) => new MapGeneration(options) }: CampaignMapsOptions = {}) {
		this.generate = generate;
	}

	/** Keeps the map founding generated for its campaign, so the session never makes it again. */
	public remember(campaign: Campaign, map: AreaMapGeneration): void {
		this.forget();
		this.kept = { key: mapKey(campaign), map: Promise.resolve(map), generation: null, listeners: new Set() };
	}

	/** Starts making the campaign's map unless it's kept or being made, and waits for nothing: Continue calls it, so a screen that needs the map seldom waits. */
	public prepare(campaign: Campaign): void {
		this.mapOf(campaign).catch(() => undefined);
	}

	/**
	 * The campaign's area map: kept, being made, or made now from its seed,
	 * params, and map attempts. Any instance of one campaign gets the same
	 * map, so a campaign loaded again doesn't make it twice. Rejects when it
	 * can't be made: a campaign without map attempts, one whose map another
	 * generator version made, attempts this pipeline can't replay, or the
	 * generation failing or being cancelled. A failure isn't kept, so asking
	 * again tries again.
	 */
	public mapOf(campaign: Campaign, { onProgress }: AreaMapRequest = {}): Promise<AreaMapGeneration> {
		const key = mapKey(campaign);
		const kept = this.kept?.key === key ? this.kept : this.start({ campaign, key });
		if (onProgress && kept.generation) {
			kept.listeners.add(onProgress);
			const stop = (): void => {
				kept.listeners.delete(onProgress);
			};
			kept.map.then(stop, stop);
		}
		return kept.map;
	}

	/** Drops the kept map, cancelling it if it's being made. */
	public forget(): void {
		const kept = this.kept;
		this.kept = null;
		kept?.generation?.cancel();
	}

	private start({ campaign, key }: { campaign: Campaign; key: string }): Kept {
		this.forget();
		const listeners = new Set<(progress: AreaMapProgress) => void>();
		let replay: PipelineReplay;
		let generation: CampaignMapGeneration | null = null;
		try {
			replay = replayOf(campaign);
			generation = this.generate({ params: campaign.mapParams, replay, onProgress: (progress) => listeners.forEach((listener) => listener(progress)) });
		} catch (error) {
			const failed: Kept = { key, map: Promise.reject(error), generation: null, listeners };
			failed.map.catch(() => undefined);
			return failed;
		}
		const kept: Kept = {
			key,
			generation,
			listeners,
			map: generation.result.then(
				(map) => {
					kept.generation = null;
					return map;
				},
				(error: unknown) => {
					if (this.kept === kept) this.kept = null;
					throw error;
				}
			),
		};
		this.kept = kept;
		return kept;
	}
}

/** The shared cache's map for the campaign (`CampaignMaps.mapOf`). */
export function getAreaMap(campaign: Campaign, request: AreaMapRequest = {}): Promise<AreaMapGeneration> {
	return CampaignMaps.shared.mapOf(campaign, request);
}

function replayOf({ generatorVersion, mapAttempts }: Campaign): PipelineReplay {
	if (mapAttempts === null) throw new Error('CampaignMaps: the campaign has no map attempts, so it has no map to make again');
	// The store reads such a save as outdated, so only a campaign that never went through it gets here.
	if (generatorVersion !== AREA_MAP_GENERATOR_VERSION) {
		const build = generatorVersion < AREA_MAP_GENERATOR_VERSION ? 'an older' : 'a newer';
		throw new Error(`CampaignMaps: this save's map is from ${build} build (generator version ${generatorVersion}; this build makes version ${AREA_MAP_GENERATOR_VERSION})`);
	}
	return { mapAttempt: mapAttempts.map, attempts: mapAttempts.stages };
}

function mapKey({ generatorVersion, seed, mapParams, mapAttempts }: Campaign): string {
	return JSON.stringify([generatorVersion, seed, mapParams, mapAttempts]);
}
