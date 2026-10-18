import type { Card } from './Card';
import { Deck } from './Deck';
import { DRIVER_CONFIGS, Driver, DriverArchetype, DriverRole, DriverSkills, VehicleStats } from './Driver';
import { IntentTier } from './Intent';
import type { RaiderArchetype } from './RaiderArchetype';
import { Vehicle, createDrivenVehicle } from './Vehicle';

/**
 * The raiders fights are built from, one profile each, so the combat
 * screen's own fight and a supply run's encounters field the same buggy.
 * Tuned with scripts/balance-sim.mjs; the values and why are in
 * docs/AI_TECHNICAL_DECISIONS/raider-tuning.md.
 */

export const RAIDER_IDS = ['scav_bike', 'rust_buggy', 'spike_buggy', 'warlord'] as const;
export type RaiderId = (typeof RAIDER_IDS)[number];

/**
 * A raider's place in a group (Runs and Encounters, Raider classes): a mook
 * is light and quick, out to one starter attack, and plays one card a
 * turn; a regular is the Rust Buggy; a heavy soaks hits and hits hard; a
 * leader is a warband's elite, whose fall routs the rest.
 */
export type RaiderClass = 'mook' | 'regular' | 'heavy' | 'leader';

export interface RaiderProfile {
	/** The driver's archetype, which sets nothing a raider uses but the default hand limit, and that's fixed below. */
	archetype: DriverArchetype;
	class: RaiderClass;
	name: string;
	vehicleName: string;
	specialty: string;
	flavorText: string;
	/** Who it goes for (RaiderArchetype). */
	targets: RaiderArchetype;
	/** Nominal threat, which a rout counts (Combat Rules, How a fight ends); the balance sim's calibrate fits it. */
	threat: number;
	/** What the player sees of its plan: an elite hides its values and cards. Basic when unset. */
	intentTier?: IntentTier;
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

/** How much a raider's structure and HP grow each game stage (Runs and Encounters, Encounters). A starting value. */
export const STAGE_GROWTH = 0.05;

export const RAIDER_PROFILES: Readonly<Record<RaiderId, Readonly<RaiderProfile>>> = Object.freeze({
	// The mook: one starter attack takes it out (a ram's 6 to its driver, a
	// Precision Shot's 8, a Headshot's 5 against 5 HP), it plays one card a
	// turn, and gunnery 9 reaches the Lightning Bike's evade of 8 (call 185)
	scav_bike: {
		archetype: 'interceptor',
		class: 'mook',
		name: 'Scavenger',
		vehicleName: 'Scav Bike',
		specialty: 'SWARM',
		flavorText: 'A scavenger on a patched-up bike, one of many',
		targets: 'looter',
		threat: 1,
		skills: { ramming: 3, gunnery: 9, evade: 4, speed: 2 },
		vehicleStats: { maxStructure: 12, weight: 1, armor: 0, speed: 4, gunnery: 4, evade: 4 },
		hitpoints: 5,
		maxAdrenaline: 1,
		soloAdrenaline: 1,
		deck: { point_blank: 3, far_shoot: 2 },
	},
	// The combat screen's default raider, a scavenger's buggy that goes for haulers (escorts.md decision 30)
	rust_buggy: {
		archetype: 'mechanic',
		class: 'regular',
		name: 'Wasteland Raider',
		vehicleName: 'Rust Buggy',
		specialty: 'AGGRESSIVE',
		flavorText: 'A dangerous raider',
		targets: 'looter',
		threat: 2,
		skills: { ramming: 5, gunnery: 9, evade: 4, speed: 2 },
		vehicleStats: { maxStructure: 30, weight: 2, armor: 5, speed: 3, gunnery: 6, evade: 4 },
		hitpoints: 30,
		maxAdrenaline: 5,
		soloAdrenaline: 3,
		deck: { ramming_speed: 2, precision_shot: 1, point_blank: 2 },
	},
	// The Raider archetype's Spike Buggy, going for the drivers. Its own
	// numbers and deck, not the archetype's: under the AI, Berserker burns
	// the raider's own HP and a flank carries it out of its rams' reach.
	spike_buggy: {
		archetype: 'raider',
		class: 'heavy',
		name: 'Spike Raider',
		vehicleName: spike.metadata.vehicleName,
		specialty: spike.metadata.specialty,
		flavorText: spike.metadata.flavorText,
		targets: 'killer',
		threat: 4,
		skills: { ...spike.skills, gunnery: 9 },
		vehicleStats: { ...spike.vehicleStats, maxStructure: 55, armor: 6 },
		hitpoints: 50,
		maxAdrenaline: 5,
		soloAdrenaline: 3,
		deck: { ramming_speed: 3, precision_shot: 1, armor_plating: 2 },
	},
	// A warband's leader: an elite, so its intents hide their values and
	// cards, and its fall routs the rest
	warlord: {
		archetype: 'raider',
		class: 'leader',
		name: 'Warlord',
		vehicleName: 'War Rig',
		specialty: 'WARBAND LEADER',
		flavorText: 'The scavengers ride for whoever is meanest. Today it is this one.',
		targets: 'killer',
		threat: 6,
		intentTier: IntentTier.ELITE,
		skills: { ramming: 8, gunnery: 9, evade: 4, speed: 1 },
		vehicleStats: { maxStructure: 70, weight: 4, armor: 6, speed: 3, gunnery: 3, evade: 3 },
		hitpoints: 50,
		maxAdrenaline: 6,
		soloAdrenaline: 6,
		deck: { ramming_speed: 2, precision_shot: 1, point_blank: 2, armor_plating: 1 },
	},
});

/**
 * A raider at the wheel of its vehicle, with a fresh copy of its deck from
 * `cards` in the profile's order, for an enemy team, refilling to its
 * `soloAdrenaline` when it faces a lone driver. Throws for a card the
 * map doesn't hold, since a raider dealt short would be an easier fight
 * than the one it stands for.
 */
export function raiderVehicle({ raider, cards, solo = false, stage = 0, profiles = RAIDER_PROFILES }: {
	raider: RaiderId;
	cards: ReadonlyMap<string, Card>;
	solo?: boolean;
	/** Game stage: structure and HP grow by STAGE_GROWTH a stage (Runs and Encounters, Encounters) */
	stage?: number;
	/** The shipped profiles when left out; the balance sim passes its config's. */
	profiles?: Readonly<Record<RaiderId, Readonly<RaiderProfile>>>;
}): Vehicle {
	const profile = profiles[raider];
	const adrenaline = solo ? profile.soloAdrenaline : profile.maxAdrenaline;
	const grown = (value: number): number => Math.round(value * (1 + STAGE_GROWTH * stage));
	const hitpoints = grown(profile.hitpoints);
	const deck = Object.entries(profile.deck).flatMap(([type, count]) => {
		const template = cards.get(type);
		if (!template) throw new RangeError(`${profile.name}'s deck holds ${type}, which isn't a card`);
		return Array.from({ length: count }, () => template.copy());
	});
	const driver = new Driver({
		archetype: profile.archetype,
		metadata: { name: profile.name, vehicleName: profile.vehicleName, specialty: profile.specialty, flavorText: profile.flavorText, unlocked: true },
		skills: { ...profile.skills },
		vehicleStats: { ...profile.vehicleStats, maxStructure: grown(profile.vehicleStats.maxStructure) },
		startingDeck: { cards: Object.entries(profile.deck).map(([type, quantity]) => ({ type, quantity })) },
		hitpoints,
		maxHitpoints: hitpoints,
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
	vehicle.set({
		raiderArchetype: profile.targets,
		threat: profile.threat,
		leader: profile.class === 'leader',
		intentTier: profile.intentTier ?? IntentTier.BASIC
	});
	return vehicle;
}
