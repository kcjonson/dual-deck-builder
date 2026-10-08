import { Rng } from '../core/Rng';
import { MapParamSet, MapParams, resolveMapParams } from '../map/MapParams';
import { validateMapParams } from '../map/ParamValidator';
import { rollParams } from '../map/RollParams';
import { Convoy } from '../mechanics/Convoy';
import { DriverArchetype } from '../mechanics/Driver';
import { createEscort } from '../mechanics/Escort';
import { PLAYER_DRIVEN_VEHICLES } from '../mechanics/Team';
import { Campaign } from './Campaign';
import { CAMPAIGN_START, CampaignStart, readCampaignStart } from './CampaignStart';
import { DRIVER_ARCHETYPES } from './DriverRecord';
import { describeValue, readArray, readInteger, readOneOf } from './JsonReader';
import { EMPTY_MAP } from './MapState';

const UINT32_MAX = 0xffffffff;

/**
 * What campaigns are founded on until the area map generator exists: the
 * campaign model's stand-in map state, at generator version 1. Read in the
 * one place the generator's call goes, in `foundCampaign`.
 */
const MAP_STAND_IN = Object.freeze({ map: EMPTY_MAP, generatorVersion: 1 });

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
	 * Map Lab's current set, say. Their seed must be `seed`. They're filled
	 * out and validated, as generation runs on them, and the campaign keeps
	 * the result.
	 */
	mapParams?: MapParamSet;
	/** What the compound starts with: the shipped `data/campaign-start.json` when left out. */
	start?: CampaignStart;
}

/**
 * A new campaign (Compound and Supply Runs, Founding the compound): map
 * params rolled from the seed unless they're given, the starting pool dealt
 * from the unlocked archetypes and recruited through the campaign, each with
 * their archetype's starting deck, the start's stores and starter escorts,
 * an empty locker, and day 1 at dawn. The same options found the same
 * campaign, and nothing in it comes from `Math.random`.
 *
 * Throws, founding nothing, on a seed that isn't a uint32, params made from
 * another seed, a start that doesn't check out, or fewer than two
 * archetypes unlocked: a run takes two drivers, no two alike, and the pool
 * only grows on runs, so a compound founded with one could never leave.
 */
export function foundCampaign({ seed, unlockedArchetypes, mapParams, start = CAMPAIGN_START }: FoundingOptions): Campaign {
	readSeed(seed);
	const startingValues = readCampaignStart(start, 'CampaignStart');
	const params = foundingParams({ seed, set: mapParams });
	const unlocked = readUnlocked(unlockedArchetypes);
	if (unlocked.length < PLAYER_DRIVEN_VEHICLES) {
		throw new RangeError(`unlockedArchetypes must hold at least ${PLAYER_DRIVEN_VEHICLES} different archetypes, since a run takes ${PLAYER_DRIVEN_VEHICLES} drivers and no two alike, got ${unlocked.length}`);
	}
	const pool = deal({ seed, unlocked, size: startingValues.poolSize });

	// The area map generator's call goes here: it makes the gameplay map from
	// the seed and `params` (Area Map Generation, Pipeline), and the campaign
	// keeps that map and the generator's version. Until it exists, campaigns
	// are founded on the model's stand-in.
	const { map, generatorVersion } = MAP_STAND_IN;

	const campaign = new Campaign({
		seed,
		generatorVersion,
		mapParams: params,
		map,
		// The clock only runs on the road, so between runs the compound is always at the dawn of its day.
		day: 1,
		resources: startingValues.resources,
		convoy: new Convoy({ escorts: startingValues.escorts.map(type => createEscort({ type })) })
	});
	pool.forEach(archetype => campaign.recruitDriver({ archetype }));
	campaign.addLogEntry({ message: 'Founded the compound.' });
	return campaign;
}

/**
 * The starting pool's archetypes, in the order they join: `size` different
 * ones dealt from those unlocked, or all of them when fewer are unlocked
 * (Compound and Supply Runs, The driver pool). The deal shuffles the
 * unlocked archetypes on the `pool` fork of the seed's `founding` stream and
 * takes the first `size`. It starts from them sorted by id, so neither the
 * order they're passed in, a repeat, nor the order of `DRIVER_CONFIGS`
 * changes a seed's deal. A plain deal: it takes a single archetype, and
 * throws only when nothing is unlocked. Founding asks for two.
 */
export function dealStartingPool({ seed, unlockedArchetypes, size }: {
	seed: number;
	unlockedArchetypes: readonly DriverArchetype[];
	size: number;
}): DriverArchetype[] {
	readSeed(seed);
	const unlocked = readUnlocked(unlockedArchetypes);
	readInteger(size, 'size', { min: 1 });
	if (unlocked.length === 0) throw new RangeError("unlockedArchetypes is empty, so there's nothing to deal");
	return deal({ seed, unlocked, size });
}

/** The unlocked archetypes checked, without repeats, and sorted by id: what the deal starts from. */
function readUnlocked(value: readonly DriverArchetype[]): DriverArchetype[] {
	const archetypes = readArray(value, 'unlockedArchetypes')
		.map((archetype, index) => readOneOf(archetype, `unlockedArchetypes[${index}]`, DRIVER_ARCHETYPES));
	return [...new Set(archetypes)].sort();
}

function deal({ seed, unlocked, size }: { seed: number; unlocked: readonly DriverArchetype[]; size: number }): DriverArchetype[] {
	return new Rng({ seed }).fork('founding').fork('pool').shuffle([...unlocked]).slice(0, size);
}

/** Rolled from the seed, or the set given, filled out and validated: what generation runs on. */
function foundingParams({ seed, set }: { seed: number; set?: MapParamSet }): MapParams {
	if (set === undefined) return rollParams(seed);
	if (set.seed !== seed) throw new RangeError(`mapParams.seed must be the campaign's seed, ${seed}, got ${describeValue(set.seed)}`);
	return validateMapParams(resolveMapParams(set).params).params;
}

function readSeed(seed: number): void {
	readInteger(seed, 'seed', { min: 0, max: UINT32_MAX });
}
