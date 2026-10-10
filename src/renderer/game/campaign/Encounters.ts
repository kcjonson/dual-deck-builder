import type { Card } from '../mechanics/Card';
import { Deck } from '../mechanics/Deck';
import { DRIVER_CONFIGS, Driver, DriverRole, DriverSkills, VehicleStats } from '../mechanics/Driver';
import type { RaiderArchetype } from '../mechanics/RaiderArchetype';
import { Team, TeamType } from '../mechanics/Team';
import { Vehicle, createDrivenVehicle } from '../mechanics/Vehicle';

/**
 * Stand-in raider encounters for the MVP supply run (DDB-454): a small fixed
 * table a fight stop's skulls pick from, until stops roll their encounters
 * from the area map's tables. Decision record:
 * docs/AI_TECHNICAL_DECISIONS/mvp-supply-run.md.
 */

export const ENCOUNTER_IDS = ['scavengers', 'road_gang', 'spike_pack'] as const;
export type EncounterId = (typeof ENCOUNTER_IDS)[number];

/** Danger, as the route screen's skulls count it (Game Flow 3.4). */
export type Skulls = 1 | 2 | 3;

type RaiderId = 'rust_buggy' | 'spike_buggy';

export interface Encounter {
	readonly id: EncounterId;
	readonly name: string;
	readonly skulls: Skulls;
	readonly raiders: readonly RaiderId[];
}

export const ENCOUNTERS: Readonly<Record<EncounterId, Encounter>> = Object.freeze({
	scavengers: { id: 'scavengers', name: 'Scavengers', skulls: 1, raiders: ['rust_buggy'] },
	road_gang: { id: 'road_gang', name: 'Road gang', skulls: 2, raiders: ['rust_buggy', 'rust_buggy'] },
	spike_pack: { id: 'spike_pack', name: 'Spike pack', skulls: 3, raiders: ['rust_buggy', 'spike_buggy'] },
});

/** The encounter a fight of this many skulls rolls: one each, until stops roll from the area map's tables. */
export function encounterFor(skulls: Skulls): EncounterId {
	const encounter = ENCOUNTER_IDS.find(id => ENCOUNTERS[id].skulls === skulls);
	if (!encounter) throw new RangeError(`No encounter has ${skulls} skulls`);
	return encounter;
}

interface RaiderProfile {
	name: string;
	vehicleName: string;
	archetype: RaiderArchetype;
	skills: DriverSkills;
	vehicleStats: VehicleStats;
	hitpoints: number;
	maxAdrenaline: number;
	deck: Readonly<Record<string, number>>;
}

const spike = DRIVER_CONFIGS.raider;

/** The combat screen's own test raider, and the Raider archetype's Spike Buggy. */
const RAIDERS: Readonly<Record<RaiderId, RaiderProfile>> = {
	rust_buggy: {
		name: 'Wasteland Raider',
		vehicleName: 'Rust Buggy',
		archetype: 'looter',
		skills: { ramming: 5, gunnery: 6, evade: 4, speed: 2 },
		vehicleStats: { maxStructure: 30, weight: 2, armor: 5, speed: 3, gunnery: 6, evade: 4 },
		hitpoints: 30,
		maxAdrenaline: 3,
		deck: { ramming_speed: 2, precision_shot: 3 },
	},
	spike_buggy: {
		name: 'Spike Raider',
		vehicleName: spike.metadata.vehicleName,
		archetype: 'killer',
		skills: { ...spike.skills },
		vehicleStats: { ...spike.vehicleStats },
		hitpoints: spike.maxHitpoints,
		maxAdrenaline: 3,
		deck: Object.fromEntries(spike.startingDeck.cards.map(({ type, quantity }) => [type, quantity])),
	},
};

/**
 * The encounter's raiders as an enemy team, each with a fresh copy of its
 * deck from `cards`, in the formation's opening order. Throws for a card the
 * map doesn't hold, since a raider dealt short would be an easier fight than
 * the route promised.
 */
export function encounterTeam({ encounter, cards }: { encounter: EncounterId; cards: ReadonlyMap<string, Card> }): Team {
	const vehicles = ENCOUNTERS[encounter].raiders.map((raider, index) => raiderVehicle({ profile: RAIDERS[raider], id: `${encounter}_${index}`, cards }));
	return new Team({ type: TeamType.ENEMY, vehicles });
}

function raiderVehicle({ profile, id, cards }: { profile: RaiderProfile; id: string; cards: ReadonlyMap<string, Card> }): Vehicle {
	const deck = Object.entries(profile.deck).flatMap(([type, count]) => {
		const template = cards.get(type);
		if (!template) throw new RangeError(`${profile.name}'s deck holds ${type}, which isn't a card`);
		return Array.from({ length: count }, () => template.copy());
	});
	const driver = new Driver({
		archetype: 'raider',
		metadata: { name: profile.name, vehicleName: profile.vehicleName, specialty: 'RAIDER', flavorText: '', unlocked: true },
		skills: { ...profile.skills },
		vehicleStats: { ...profile.vehicleStats },
		startingDeck: { cards: Object.entries(profile.deck).map(([type, quantity]) => ({ type, quantity })) },
		hitpoints: profile.hitpoints,
		maxHitpoints: profile.hitpoints,
		adrenaline: profile.maxAdrenaline,
		maxAdrenaline: profile.maxAdrenaline,
		// Not an archetype's: per-archetype limits mustn't change a raider's draws
		handLimit: 7,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck(id, `${profile.name}'s deck`, deck),
	});
	const vehicle = createDrivenVehicle({ driver });
	vehicle.raiderArchetype = profile.archetype;
	return vehicle;
}
