import type { AIType } from '../ai/AIController';
import { ENCOUNTERS, ENCOUNTER_IDS, EncounterId, Skulls } from '../campaign/Encounters';
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
	/** An encounter's raiders, by encounter. */
	readonly encounters?: Partial<Record<EncounterId, { readonly raiders: readonly RaiderId[] }>>;
	/** Campaign maps `gen` makes, from `seed` up. */
	readonly maps?: number;
	/** What a route to each destination tier should hold, by tier; Runs and Encounters' starting values when left out. */
	readonly bands?: Readonly<Record<number, TierBand>>;
}

/** A route's stops and fights at game stage 0, its least and most (Runs and Encounters, How many stops). */
export interface TierBand {
	readonly stops: { readonly min: number; readonly max: number };
	readonly fights: { readonly min: number; readonly max: number };
}

/** Runs and Encounters' starting bands by destination tier, the stronghold's as tier 5; its boss isn't counted. */
export const ROUTE_BANDS: Readonly<Record<number, TierBand>> = Object.freeze({
	1: { stops: { min: 3, max: 4 }, fights: { min: 1, max: 2 } },
	2: { stops: { min: 3, max: 4 }, fights: { min: 1, max: 2 } },
	3: { stops: { min: 4, max: 5 }, fights: { min: 2, max: 3 } },
	4: { stops: { min: 5, max: 6 }, fights: { min: 2, max: 3 } },
	5: { stops: { min: 6, max: 7 }, fights: { min: 2, max: 3 } },
});

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
	readonly encounters: Readonly<Record<EncounterId, readonly RaiderId[]>>;
	readonly maps: number;
	readonly bands: Readonly<Record<number, TierBand>>;
}

/** The archetypes a new campaign can deal. */
export function unlockedArchetypes(): DriverArchetype[] {
	return (Object.keys(DRIVER_CONFIGS) as DriverArchetype[]).filter(archetype => DRIVER_CONFIGS[archetype].metadata.unlocked);
}

/** The config filled out from the shipped values. Throws for a raider, encounter, or archetype the game doesn't have. */
export function simConfig(input: SimConfigInput = {}): SimConfig {
	for (const id of Object.keys(input.raiders ?? {})) {
		if (!(RAIDER_IDS as readonly string[]).includes(id)) throw new RangeError(`raiders.${id} isn't a raider`);
	}
	for (const id of Object.keys(input.encounters ?? {})) {
		if (!(ENCOUNTER_IDS as readonly string[]).includes(id)) throw new RangeError(`encounters.${id} isn't an encounter`);
	}
	const raiders = Object.fromEntries(RAIDER_IDS.map(id => [id, patched(RAIDER_PROFILES[id], input.raiders?.[id])])) as Record<RaiderId, RaiderProfile>;
	const encounters = Object.fromEntries(ENCOUNTER_IDS.map(id => {
		const list = input.encounters?.[id]?.raiders ?? ENCOUNTERS[id].raiders;
		if (list.length === 0) throw new RangeError(`encounters.${id} fields no raiders`);
		list.forEach(raider => {
			if (!(RAIDER_IDS as readonly string[]).includes(raider)) throw new RangeError(`encounters.${id} holds ${raider}, which isn't a raider`);
		});
		return [id, [...list]];
	})) as Record<EncounterId, RaiderId[]>;
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
