import type { Card } from './Card';
import { Deck } from './Deck';
import { DRIVER_CONFIGS, Driver, DriverArchetype, DriverRole, DriverSkills, VehicleStats } from './Driver';
import type { RaiderArchetype } from './RaiderArchetype';
import { Vehicle, createDrivenVehicle } from './Vehicle';

/**
 * The raiders fights are built from, one profile each, so the combat
 * screen's own fight and a supply run's encounters field the same buggy.
 * Tuned with scripts/raider-sim.mjs; the values and why are in
 * docs/AI_TECHNICAL_DECISIONS/raider-tuning.md.
 */

export const RAIDER_IDS = ['rust_buggy', 'spike_buggy'] as const;
export type RaiderId = (typeof RAIDER_IDS)[number];

export interface RaiderProfile {
	/** The driver's archetype, which sets nothing a raider uses but the default hand limit, and that's fixed below. */
	archetype: DriverArchetype;
	name: string;
	vehicleName: string;
	specialty: string;
	flavorText: string;
	/** Who it goes for (RaiderArchetype). */
	targets: RaiderArchetype;
	skills: DriverSkills;
	vehicleStats: VehicleStats;
	hitpoints: number;
	/** Adrenaline it refills to every turn, the first included, against a pair. */
	maxAdrenaline: number;
	/** Adrenaline it refills to against a lone driver, who brings half a pair's guns and so gives it about twice the turns. */
	soloAdrenaline: number;
	deck: Readonly<Record<string, number>>;
}

const spike = DRIVER_CONFIGS.raider;

export const RAIDER_PROFILES: Readonly<Record<RaiderId, Readonly<RaiderProfile>>> = Object.freeze({
	// The combat screen's default raider, a scavenger's buggy that goes for haulers (escorts.md decision 30)
	rust_buggy: {
		archetype: 'mechanic',
		name: 'Wasteland Raider',
		vehicleName: 'Rust Buggy',
		specialty: 'AGGRESSIVE',
		flavorText: 'A dangerous raider',
		targets: 'looter',
		skills: { ramming: 5, gunnery: 9, evade: 4, speed: 2 },
		vehicleStats: { maxStructure: 30, weight: 2, armor: 5, speed: 3, gunnery: 6, evade: 4 },
		hitpoints: 30,
		maxAdrenaline: 5,
		soloAdrenaline: 3,
		deck: { ramming_speed: 2, precision_shot: 3 },
	},
	// The Raider archetype's Spike Buggy, going for the drivers. Its own
	// numbers and deck, not the archetype's: under the AI, Berserker burns
	// the raider's own HP and a flank carries it out of its rams' reach.
	spike_buggy: {
		archetype: 'raider',
		name: 'Spike Raider',
		vehicleName: spike.metadata.vehicleName,
		specialty: spike.metadata.specialty,
		flavorText: spike.metadata.flavorText,
		targets: 'killer',
		skills: { ...spike.skills, gunnery: 9 },
		vehicleStats: { ...spike.vehicleStats, maxStructure: 85, armor: 8 },
		hitpoints: 85,
		maxAdrenaline: 7,
		soloAdrenaline: 3,
		deck: { ramming_speed: 3, precision_shot: 2, armor_plating: 1 },
	},
});

/**
 * A raider at the wheel of its vehicle, with a fresh copy of its deck from
 * `cards` in the profile's order, for an enemy team, refilling to its
 * `soloAdrenaline` when it faces a lone driver. Throws for a card the
 * map doesn't hold, since a raider dealt short would be an easier fight
 * than the one it stands for.
 */
export function raiderVehicle({ raider, cards, solo = false }: { raider: RaiderId; cards: ReadonlyMap<string, Card>; solo?: boolean }): Vehicle {
	const profile = RAIDER_PROFILES[raider];
	const adrenaline = solo ? profile.soloAdrenaline : profile.maxAdrenaline;
	const deck = Object.entries(profile.deck).flatMap(([type, count]) => {
		const template = cards.get(type);
		if (!template) throw new RangeError(`${profile.name}'s deck holds ${type}, which isn't a card`);
		return Array.from({ length: count }, () => template.copy());
	});
	const driver = new Driver({
		archetype: profile.archetype,
		metadata: { name: profile.name, vehicleName: profile.vehicleName, specialty: profile.specialty, flavorText: profile.flavorText, unlocked: true },
		skills: { ...profile.skills },
		vehicleStats: { ...profile.vehicleStats },
		startingDeck: { cards: Object.entries(profile.deck).map(([type, quantity]) => ({ type, quantity })) },
		hitpoints: profile.hitpoints,
		maxHitpoints: profile.hitpoints,
		adrenaline,
		maxAdrenaline: adrenaline,
		// Not the archetype's: per-archetype limits mustn't change a raider's draws
		handLimit: 7,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck(`${raider}_deck`, `${profile.name}'s deck`, deck),
	});
	const vehicle = createDrivenVehicle({ driver });
	vehicle.raiderArchetype = profile.targets;
	return vehicle;
}
