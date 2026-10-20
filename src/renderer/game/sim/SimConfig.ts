import type { AIType } from '../ai/AIController';
import { ENCOUNTER_DATA, EncounterData, Skulls, readEncounterData } from '../campaign/Encounters';
import { STOP_TUNING, TierBand } from '../map/StopData';
import { DRIVER_CONFIGS, DriverArchetype } from '../mechanics/Driver';
import { RAIDER_IDS, RAIDER_PROFILES, RaiderId, RaiderProfile } from '../mechanics/Raiders';

/**
 * The balance sim's input (Balance Simulation, The core): plain data, so the
 * CLI reads it from `--config` and the Balance Lab exports it. Tuning comes
 * in here rather than being patched into the shipped tables; anything left
 * out is the shipped value.
 */
export interface SimConfigInput {
	readonly seed?: number;
	/** Runs a cell. */
	readonly runs?: number;
	/** `all` (every pair of different archetypes, then each alone), `pairs`, `solo`, or the crews themselves. */
	readonly crews?: 'all' | 'pairs' | 'solo' | readonly CrewInput[];
	/** The archetypes `all`, `pairs`, and `solo` draw from: the ones a new campaign can deal when left out. */
	readonly archetypes?: readonly DriverArchetype[];
	/** What each fights cell fights, in order: `[1]` one fight, `[1, 2]` a run's two, damage carried between them. Never empty. */
	readonly routes?: readonly (readonly Skulls[])[];
	/** The player's stand-in: the aggressive AI, the floor (Balance Simulation, Player stand-ins). */
	readonly playerAI?: AIType;
	readonly enemyAI?: AIType;
	/** A fight still going after this turn is a stall. */
	readonly turns?: number;
	/** Fields over the shipped profile's, by raider; `skills` and `vehicleStats` merge, `deck` replaces. */
	readonly raiders?: Partial<Record<RaiderId, RaiderPatch>>;
	/** The encounter templates and road caps, as data/encounters.json holds them; the shipped ones when left out. */
	readonly encounters?: unknown;
	/** The destination tier whose templates a fight draws from, 1 to 5. */
	readonly tier?: number;
	/** Game stage, 0 to 6: it grows each template and every raider (Runs and Encounters, Encounters). */
	readonly stage?: number;
	/** Campaign maps `gen` makes, from `seed` up. */
	readonly maps?: number;
	/** What a route to each destination tier should hold, by tier, a tier given replacing that tier's whole band; Runs and Encounters' starting values when left out. */
	readonly bands?: Readonly<Record<number, TierBand>>;
}

/** The stops stage's bands by destination tier, the stronghold's as tier 5, from its tuning. */
export const ROUTE_BANDS: Readonly<Record<number, TierBand>> = Object.freeze(Object.fromEntries(STOP_TUNING.bands.map((band, index) => [index + 1, band])));

/** Seat 1 first, one or two seats of different archetypes. A seat is an archetype on its default deck, or one with the deck given. */
export type CrewInput = readonly (DriverArchetype | SeatInput)[];

export interface SeatInput {
	readonly archetype: DriverArchetype;
	/** Card counts by type; the archetype's starting deck when left out. */
	readonly deck?: Readonly<Record<string, number>>;
}

export type RaiderPatch = Partial<Omit<RaiderProfile, 'skills' | 'vehicleStats'>> & {
	readonly skills?: Partial<RaiderProfile['skills']>;
	readonly vehicleStats?: Partial<RaiderProfile['vehicleStats']>;
};

/** A config with every value filled in. */
export interface SimConfig {
	readonly seed: number;
	readonly runs: number;
	readonly crews: readonly (readonly SeatInput[])[];
	readonly routes: readonly (readonly Skulls[])[];
	readonly playerAI: AIType;
	readonly enemyAI: AIType;
	readonly turns: number;
	readonly raiders: Readonly<Record<RaiderId, Readonly<RaiderProfile>>>;
	readonly encounters: EncounterData;
	readonly tier: number;
	readonly stage: number;
	readonly maps: number;
	readonly bands: Readonly<Record<number, TierBand>>;
}

/** The archetypes a new campaign can deal. */
export function unlockedArchetypes(): DriverArchetype[] {
	return (Object.keys(DRIVER_CONFIGS) as DriverArchetype[]).filter(archetype => DRIVER_CONFIGS[archetype].metadata.unlocked);
}

/** The config filled out from the shipped values. Throws for a raider, template, or archetype the game doesn't have, and a tier or stage out of range. */
export function simConfig(input: SimConfigInput = {}): SimConfig {
	for (const id of Object.keys(input.raiders ?? {})) {
		if (!(RAIDER_IDS as readonly string[]).includes(id)) throw new RangeError(`raiders.${id} isn't a raider`);
	}
	const raiders = Object.fromEntries(RAIDER_IDS.map(id => [id, patched(RAIDER_PROFILES[id], input.raiders?.[id])])) as Record<RaiderId, RaiderProfile>;
	const encounters = input.encounters === undefined ? ENCOUNTER_DATA : readEncounterData(input.encounters, 'encounters');
	const tier = input.tier ?? 1;
	if (!Number.isInteger(tier) || tier < 1 || tier > 5) throw new RangeError(`tier must be a whole number from 1 to 5, not ${tier}`);
	const stage = input.stage ?? 0;
	if (!Number.isInteger(stage) || stage < 0 || stage > 6) throw new RangeError(`stage must be a whole number from 0 to 6, not ${stage}`);
	const routes = input.routes ?? [[1], [2], [3]];
	routes.forEach(route => {
		if (route.length === 0) throw new RangeError('A route fights at least once');
	});
	return {
		seed: input.seed ?? 1,
		runs: input.runs ?? 150,
		crews: crewsOf(input),
		routes,
		playerAI: input.playerAI ?? 'aggressive',
		enemyAI: input.enemyAI ?? 'aggressive',
		turns: input.turns ?? 25,
		raiders,
		encounters,
		tier,
		stage,
		maps: input.maps ?? 30,
		bands: { ...ROUTE_BANDS, ...input.bands },
	};
}

function patched(profile: Readonly<RaiderProfile>, patch: RaiderPatch | undefined): RaiderProfile {
	return {
		...profile,
		...patch,
		skills: { ...profile.skills, ...patch?.skills },
		vehicleStats: { ...profile.vehicleStats, ...patch?.vehicleStats },
		deck: { ...(patch?.deck ?? profile.deck) },
	};
}

function crewsOf({ crews = 'all', archetypes = unlockedArchetypes() }: SimConfigInput): SeatInput[][] {
	const known = Object.keys(DRIVER_CONFIGS);
	const seat = (value: DriverArchetype | SeatInput): SeatInput => {
		const read = typeof value === 'string' ? { archetype: value } : value;
		if (!known.includes(read.archetype)) throw new RangeError(`${read.archetype} isn't an archetype`);
		return read;
	};
	if (typeof crews !== 'string') {
		return crews.map(crew => {
			// What load out seats (getSeatBlocker): one driver, or two of different archetypes
			if (crew.length < 1 || crew.length > 2) throw new RangeError(`A crew seats one or two drivers, not ${crew.length}`);
			const seats = crew.map(seat);
			if (seats.length === 2 && seats[0].archetype === seats[1].archetype) throw new RangeError(`A pair seats two different archetypes, not two ${seats[0].archetype}s`);
			return seats;
		});
	}
	const pairs = archetypes.flatMap((first, index) => archetypes.slice(index + 1).map(second => [seat(first), seat(second)]));
	const solos = archetypes.map(archetype => [seat(archetype)]);
	switch (crews) {
		case 'all': return [...pairs, ...solos];
		case 'pairs': return pairs;
		default: return solos;
	}
}
