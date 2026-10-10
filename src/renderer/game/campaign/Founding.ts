import { readArray, readOneOf, readSeed } from '../core/JsonReader';
import { Rng } from '../core/Rng';
import { AREA_MAP_GENERATOR_VERSION } from '../map/AreaMapPipeline';
import { MapParamSet, MapParams } from '../map/MapParams';
import { validateMapParamSet } from '../map/ParamValidator';
import { rollParams } from '../map/RollParams';
import { Convoy } from '../mechanics/Convoy';
import { DriverArchetype } from '../mechanics/Driver';
import { createEscort } from '../mechanics/Escort';
import { Campaign } from './Campaign';
import { CAMPAIGN_START, CampaignStart, FULL_RUN_SEATS, readCampaignStart } from './CampaignStart';
import { DRIVER_ARCHETYPES } from './DriverRecord';
import { readMapParamSet, readMapParams } from './MapParamsJson';
import { EMPTY_MAP } from './MapState';

/**
 * The area map a campaign is founded on, as the generator hands it back
 * (`MapGeneration`'s result fits): the params it was made on, which must be
 * the campaign's, and where it sits among the seed's attempts, which the
 * campaign keeps so a load can make it again.
 */
export interface FoundingMap {
	readonly params: Readonly<MapParams>;
	readonly mapAttempt: number;
	/** Each stage's winning attempt, by stage name. */
	readonly attempts: Readonly<Record<string, number>>;
}

export interface FoundingOptions {
	/**
	 * Any uint32: the map's seed, and the root every campaign stream forks
	 * from. The caller mints it with `freshSeed()` (core/Rng.ts), or brings
	 * the Map Lab's.
	 */
	seed: number;
	/**
	 * The archetypes unlocked so far, in any order, which the starting pool is
	 * dealt from: `DriverLoader`'s unlocked drivers, once it has loaded, by
	 * archetype.
	 */
	unlockedArchetypes: readonly DriverArchetype[];
	/**
	 * Map parameters to found on instead of rolling them from the seed: the
	 * Map Lab's current set, say. A plain object holding `seed` and any of an
	 * environment, numbers for the parameters, and stop tables as an object
	 * of JSON, and nothing else (`readMapParamSet`). They're filled out from
	 * the environment and run through the validator, which clamps what's out
	 * of range, and the campaign keeps the result.
	 */
	mapParams?: MapParamSet;
	/** What the compound starts with: the shipped `data/campaign-start.json` when left out. */
	start?: CampaignStart;
	/**
	 * The area map, generated on the params founding resolves for these
	 * options (`prepareFounding`) and the seed, in the generation worker:
	 * `CampaignFounding` runs both and hands it in.
	 */
	map: FoundingMap;
}

/** What founding checked and resolved before it builds anything. */
export interface PreparedFounding {
	/** Rolled from the seed, or the set given, filled out and validated: what the map is generated on. */
	readonly params: Readonly<MapParams>;
	readonly startingValues: CampaignStart;
	/** The unlocked archetypes without repeats, sorted by id. */
	readonly unlocked: readonly DriverArchetype[];
}

/**
 * Founding's checks, and the params to generate the map on: everything
 * `foundCampaign` does before it needs the map. The async founding runs it
 * first, so a bad call fails before a generation is spent on it. Throws as
 * `foundCampaign` does.
 */
export function prepareFounding({ seed, unlockedArchetypes, mapParams, start = CAMPAIGN_START }: Omit<FoundingOptions, 'map'>): PreparedFounding {
	readSeed(seed, 'seed');
	const startingValues = readCampaignStart(start, 'CampaignStart');
	const params = foundingParams({ seed, set: mapParams });
	const unlocked = readUnlocked(unlockedArchetypes);
	if (unlocked.length < FULL_RUN_SEATS) {
		throw new RangeError(`unlockedArchetypes must hold at least ${FULL_RUN_SEATS} different archetypes, since a run takes ${FULL_RUN_SEATS} drivers and no two alike, got ${unlocked.length}`);
	}
	return { params, startingValues, unlocked };
}

/**
 * A new campaign (Compound and Supply Runs, Founding the compound): map
 * params rolled from the seed unless they're given, the area map generated
 * on them, the starting pool dealt from the unlocked archetypes and
 * recruited through the campaign, each with their archetype's starting
 * deck, the start's stores and starter escorts, an empty locker, and day 1
 * at dawn. The same options found the same
 * campaign: founding reads no randomness but the seed's own streams, and
 * never calls `Math.random`.
 *
 * Throws, founding nothing, on a seed that isn't a uint32, map params that
 * don't read or hold another seed, a start that doesn't check out, fewer
 * than two archetypes unlocked (a run takes two drivers, no two alike, and
 * the pool only grows on runs, so a compound founded with one could never
 * leave), or a map generated on other params.
 */
export function foundCampaign({ map, ...options }: FoundingOptions): Campaign {
	const { seed } = options;
	const { params, startingValues, unlocked } = prepareFounding(options);
	// The map was generated in a worker by the async caller (CampaignFounding), which also takes the next seed when generation gives up on this one.
	if (JSON.stringify(map.params) !== JSON.stringify(params)) {
		throw new RangeError(`map must be generated on the campaign's params (seed ${seed}), got one made on seed ${map.params.seed} or other params`);
	}
	const pool = deal({ seed, unlocked, size: startingValues.poolSize });

	const campaign = new Campaign({
		seed,
		generatorVersion: AREA_MAP_GENERATOR_VERSION,
		mapParams: params,
		map: EMPTY_MAP,
		mapAttempts: { map: map.mapAttempt, stages: { ...map.attempts } },
		// The clock only runs on the road, and it's one run a day, so the compound is always at the dawn of its day.
		day: 1,
		resources: startingValues.resources,
		convoy: new Convoy({ escorts: startingValues.escorts.map(type => createEscort({ type })) })
	});
	pool.forEach(archetype => campaign.recruitDriver({ archetype }));
	campaign.addLogEntry({ message: 'Founded the compound.' });
	return campaign;
}

/** The unlocked archetypes checked, without repeats, and sorted by id: what the deal starts from. */
function readUnlocked(value: readonly DriverArchetype[]): DriverArchetype[] {
	const archetypes = readArray(value, 'unlockedArchetypes')
		.map((archetype, index) => readOneOf(archetype, `unlockedArchetypes[${index}]`, DRIVER_ARCHETYPES));
	return [...new Set(archetypes)].sort();
}

/**
 * The starting pool's archetypes, in the order they join: `size` different
 * ones dealt from those unlocked, or all of them when fewer are unlocked
 * (Compound and Supply Runs, The driver pool). The deal shuffles the
 * unlocked archetypes on the `pool` fork of the seed's `founding` stream and
 * takes the first `size`. They come in sorted by id (`readUnlocked`), so
 * neither the order they're passed in, a repeat, nor the order of
 * `DRIVER_CONFIGS` changes a seed's deal.
 */
function deal({ seed, unlocked, size }: { seed: number; unlocked: readonly DriverArchetype[]; size: number }): DriverArchetype[] {
	return new Rng({ seed }).fork('founding').fork('pool').shuffle([...unlocked]).slice(0, size);
}

/**
 * Rolled from the seed, or the set given, read, filled out, and validated:
 * what generation runs on. Reading the set first fails a bad value with its
 * path before anything is built, and its seed is compared as given, before
 * the validator could wrap it. Reading the result as the campaign does
 * freezes it, so the campaign holds it as it is.
 */
function foundingParams({ seed, set }: { seed: number; set?: MapParamSet }): Readonly<MapParams> {
	if (set === undefined) return readMapParams(rollParams(seed), 'mapParams');
	const given = readMapParamSet(set, 'mapParams');
	if (given.seed !== seed) throw new RangeError(`mapParams.seed must be the campaign's seed, ${seed}, got ${given.seed}`);
	return readMapParams(validateMapParamSet(given).params, 'mapParams');
}
