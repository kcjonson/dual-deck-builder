import { CardLoader } from '../../renderer/game/core/CardLoader';
import { Card } from '../../renderer/game/mechanics/Card';
import { Deck } from '../../renderer/game/mechanics/Deck';
import { DRIVER_CONFIGS, Driver, DriverArchetype, DriverRole } from '../../renderer/game/mechanics/Driver';
import { EscortType, createEscort } from '../../renderer/game/mechanics/Escort';
import { IntentTier } from '../../renderer/game/mechanics/Intent';
import { RoadLane, RoadRow, RoadSlot, openingSlots, sameSlot } from '../../renderer/game/mechanics/Road';
import { Team } from '../../renderer/game/mechanics/Team';
import { TeamType } from '../../renderer/game/mechanics/TeamType';
import { Vehicle, VehicleMod, createDrivenVehicle } from '../../renderer/game/mechanics/Vehicle';
import { Battle } from '../../renderer/game/mechanics/Battle';
import type { PreparedCombat } from '../../renderer/game/screens/combat/CombatScreen';
import type { WaveStatus } from '../../renderer/game/screens/combat/TopBarLayer';

/**
 * The battle screen mock's six fit scenarios (docs/design/battle-screen,
 * `buildScenario`), as real fights for the real screen (DDB-141). Each one
 * builds teams, starts a `Battle` the way the screen does, then sets the
 * board to the mock's picture: hands, adrenaline, piles, mods, statuses,
 * flankers, a wreck. Raider plans are the AI's own from the decks given
 * here, so the pills show what the game would show for that board. A
 * seventh, `solo`, isn't the mock's: a run down to its last driver, who
 * fights alone with the escorts and leaves the dock's second seat empty
 * (DDB-166).
 */
export const BATTLE_FIT_SCENARIOS = ['typical', 'opening', 'convoy', 'fullroad', 'passenger', 'bighands', 'solo'] as const;
export type BattleFitScenario = typeof BATTLE_FIT_SCENARIOS[number];

const at = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });
const { PLAYER_SHOULDER: P_SH, PLAYER_OUTSIDE: P_OUT, PLAYER_INSIDE: P_IN, ENEMY_INSIDE: E_IN, ENEMY_OUTSIDE: E_OUT, ENEMY_SHOULDER: E_SH } = RoadLane;
const { AHEAD, CENTER, BEHIND } = RoadRow;

interface DrivenSpec {
	slot: RoadSlot;
	name?: string;
	structure?: [number, number];
	armor?: number;
	hp?: [number, number];
	statuses?: [string, number][];
	/** On the raiders' shoulder by outrunning this raider; driven vehicles never start there. */
	outran?: string;
}

interface SeatSpec {
	name?: string;
	adrenaline: number;
	draw: number;
	discard: number;
	hand: string[];
	mods: VehicleMod[];
}

interface EscortSpec {
	type: EscortType;
	name: string;
	slot: RoadSlot;
	structure?: [number, number];
	/** Set-piece escorts can start on the shoulder and don't count toward the convoy's four. */
	setPiece?: boolean;
}

interface RaiderSpec {
	id: string;
	name: string;
	slot: RoadSlot;
	structure?: [number, number];
	armor?: number;
	hp?: [number, number];
	speed?: number;
	statuses?: [string, number][];
	deck: string[];
	adrenaline?: number;
	tier?: IntentTier;
}

interface ScenarioBase {
	turn: number;
	wave: WaveStatus;
	scrap: number;
	fuel: number;
	log: string[];
	bike: DrivenSpec;
	escorts: EscortSpec[];
	raiders: RaiderSpec[];
	/** The Rig is wrecked and the Road Warrior rides on in the bike. */
	wreckRig?: boolean;
}

/** Both drivers in the fight, as all the mock's scenarios have them: seat 1 the Rig's driver, seat 2 the Bike's. */
type PairSpec = ScenarioBase & { rig: DrivenSpec; seats: [SeatSpec, SeatSpec] };
/** The Road Warrior isn't in the fight, and the Interceptor takes seat 1. */
type SoloSpec = ScenarioBase & { rig: null; seats: [SeatSpec] };
type ScenarioSpec = PairSpec | SoloSpec;

const MODS = {
	reactiveArmor: { name: 'Reactive Armor', kind: 'defense' },
	autoRepair: { name: 'Auto-Repair', kind: 'defense' },
	nitrous: { name: 'Nitrous System', kind: 'utility' },
	tank: { name: 'Expanded Tank', kind: 'utility' },
	bumper: { name: 'Spiked Bumper', kind: 'offense' },
	printer: { name: 'Card Printer', kind: 'utility' },
} satisfies Record<string, VehicleMod>;
const SIX_MODS: VehicleMod[] = [MODS.reactiveArmor, MODS.autoRepair, MODS.tank, MODS.bumper, MODS.nitrous, MODS.printer];

const TYPICAL_HANDS: [string[], string[]] = [
	['ramming_speed', 'armor_plating', 'coordinated_attack', 'repair_kit', 'point_blank'],
	['headshot', 'oil_slick', 'nitro_boost', 'caltrops', 'far_shoot'],
];

/** The mock's longest full text: Tag Team Takedown, 318 characters, inside the 330 the card data allows. */
export const TAG_TEAM_TAKEDOWN = 'tag_team_takedown';
function tagTeamTakedown(): Card {
	return new Card({
		type: TAG_TEAM_TAKEDOWN,
		name: 'Tag Team Takedown',
		summary: 'Deal 8. Your [Partner] deals 8 more. [Exhaust].',
		description: 'Deal 8 damage to target raider. If your partner\'s vehicle is within Range 1 of that raider, they immediately deal 8 more to it without spending adrenaline, and both hits ignore Evade. Only playable while The Road Warrior and The Interceptor are both driving. Exhaust: removed from your deck for the rest of this fight.',
		rarity: 'legendary',
		cost: 3,
		targetType: 'enemy_single',
		effects: [{ type: 'damage', value: 8, target: 'enemy_single', range: 1 }],
		tags: ['attack', 'synergy'],
	});
}

const BUGGY_DECK = ['ramming_speed', 'point_blank', 'far_shoot', 'point_blank', 'armor_plating'];
const HAULER_DECK = ['armor_plating', 'ram', 'point_blank', 'armor_plating', 'ram'];
const CRAWLER_DECK = ['oil_slick', 'far_shoot', 'oil_slick', 'far_shoot', 'far_shoot'];

function nineRaiders(): RaiderSpec[] {
	return [
		{ id: 'e1', name: 'Rust Buggy', slot: at(E_IN, AHEAD), statuses: [['vulnerable', 2]], deck: BUGGY_DECK },
		{
			id: 'e2', name: 'Scrapyard Juggernaut', slot: at(E_IN, CENTER), structure: [188, 240], armor: 30, hp: [99, 120], speed: 1,
			statuses: [['damage_bonus', 3], ['burn', 2], ['speed_reduction', 1], ['death_mark', 1], ['vulnerable', 2], ['triple_damage', 4], ['speed_boost', 2]],
			deck: ['armor_plating', 'point_blank', 'oil_slick', 'armor_plating', 'far_shoot'], adrenaline: 5, tier: IntentTier.BASIC,
		},
		{ id: 'e3', name: 'Rust Buggy', slot: at(E_IN, BEHIND), structure: [30, 30], deck: BUGGY_DECK },
		{ id: 'e4', name: 'Dust Crawler', slot: at(E_OUT, AHEAD), structure: [18, 25], armor: 0, hp: [20, 20], speed: 4, statuses: [['burn', 3]], deck: CRAWLER_DECK },
		{ id: 'e5', name: 'Warlord\'s Pride', slot: at(E_OUT, CENTER), structure: [150, 150], armor: 12, hp: [60, 60], speed: 2, deck: HAULER_DECK, tier: IntentTier.ELITE },
		{ id: 'e6', name: 'Chain Hauler', slot: at(E_OUT, BEHIND), structure: [90, 90], armor: 12, hp: [35, 35], speed: 2, deck: HAULER_DECK },
		{ id: 'e7', name: 'Spike Runner', slot: at(P_SH, AHEAD), speed: 5, deck: BUGGY_DECK },
		{ id: 'e8', name: 'Dust Crawler', slot: at(P_SH, CENTER), structure: [25, 25], armor: 0, hp: [20, 20], speed: 4, deck: CRAWLER_DECK },
		{ id: 'e9', name: 'Spike Runner', slot: at(P_SH, BEHIND), speed: 5, deck: HAULER_DECK },
	];
}

const LONG_TICKER = 'Scrapyard Juggernaut rammed Apocalypse Rig for 24 (18 blocked by Armor, 3 to Structure, 3 to The Road Warrior)';

function typical(): PairSpec {
	return {
		turn: 3,
		wave: { number: 1, total: 2, incoming: 2 },
		scrap: 150,
		fuel: 7,
		log: ['Rust Buggy rammed Apocalypse Rig for 6 (4 blocked by Armor)'],
		seats: [
			{ adrenaline: 3, draw: 7, discard: 4, hand: TYPICAL_HANDS[0], mods: [MODS.reactiveArmor, MODS.autoRepair] },
			{ adrenaline: 2, draw: 3, discard: 8, hand: TYPICAL_HANDS[1], mods: [MODS.nitrous] },
		],
		rig: { slot: at(P_IN, CENTER), structure: [54, 80], armor: 10, hp: [40, 40], statuses: [['damage_bonus', 2]] },
		bike: { slot: at(E_SH, AHEAD), structure: [31, 50], armor: 0, hp: [18, 25], statuses: [['speed_boost', 3], ['damage_bonus', 1]], outran: 'e3' },
		escorts: [],
		raiders: [
			{ id: 'e1', name: 'Rust Buggy', slot: at(E_IN, CENTER), statuses: [['vulnerable', 2]], deck: BUGGY_DECK },
			{ id: 'e2', name: 'Scrap Hauler', slot: at(E_IN, BEHIND), structure: [64, 90], armor: 12, hp: [35, 35], speed: 2, deck: HAULER_DECK },
			{ id: 'e3', name: 'Dust Crawler', slot: at(E_OUT, AHEAD), structure: [18, 25], armor: 0, hp: [20, 20], speed: 4, statuses: [['burn', 3]], deck: CRAWLER_DECK },
		],
	};
}

/** The mock's every-slot-full road, a layout stress case (Battle Screen Design, section 10). */
function fullRoad(): PairSpec {
	return {
		...typical(),
		wave: { number: 3, total: 3, incoming: 4 },
		scrap: 12450,
		fuel: 10,
		log: [LONG_TICKER],
		seats: [{ ...typical().seats[0], name: 'The Road Warrior of Ashfall' }, typical().seats[1]],
		rig: {
			slot: at(P_IN, CENTER), structure: [236, 240], armor: 48, hp: [140, 140],
			statuses: [['damage_bonus', 2], ['speed_boost', 3], ['vulnerable', 1], ['burn', 4], ['speed_reduction', 2], ['death_mark', 1], ['triple_damage', 2], ['nitro_boost', 9]],
		},
		bike: { slot: at(E_SH, AHEAD), name: 'Lightning Bike Mk II', structure: [31, 50], armor: 0, hp: [18, 25], statuses: [['speed_boost', 3]], outran: 'e4' },
		escorts: [
			{ type: 'fuel_hauler', name: 'Water Tanker', slot: at(P_IN, BEHIND) },
			{ type: 'pilot_car', name: 'Pilot Car', slot: at(P_IN, AHEAD) },
			{ type: 'fuel_hauler', name: 'Fuel Hauler', slot: at(P_OUT, AHEAD) },
			{ type: 'fuel_hauler', name: 'Salvage Rig', slot: at(P_OUT, CENTER), structure: [120, 120] },
			{ type: 'med_truck', name: 'Ammo Carrier', slot: at(P_OUT, BEHIND), setPiece: true },
			{ type: 'outrider', name: 'Outrider', slot: at(E_SH, CENTER), setPiece: true },
			{ type: 'outrider', name: 'Outrider', slot: at(E_SH, BEHIND), setPiece: true },
		],
		raiders: nineRaiders(),
	};
}

const SCENARIOS: Record<BattleFitScenario, () => ScenarioSpec> = {
	typical,
	opening: () => ({
		...typical(),
		turn: 1,
		wave: { number: 1, total: 1, incoming: 0 },
		log: [],
		seats: [
			{ adrenaline: 5, draw: 5, discard: 0, hand: ['point_blank', 'point_blank', 'armor_plating', 'repair_kit', 'ram'], mods: [MODS.reactiveArmor, MODS.autoRepair] },
			{ adrenaline: 5, draw: 5, discard: 0, hand: ['headshot', 'nitro_boost', 'flanking_maneuver', 'far_shoot', 'far_shoot'], mods: [MODS.nitrous] },
		],
		rig: { slot: at(P_IN, CENTER), structure: [80, 80], armor: 10, hp: [40, 40] },
		bike: { slot: at(P_IN, BEHIND), structure: [50, 50], armor: 0, hp: [25, 25] },
		raiders: [{ id: 'e1', name: 'Rust Buggy', slot: at(E_IN, CENTER), structure: [30, 30], deck: BUGGY_DECK }],
	}),
	convoy: () => {
		const raiders = nineRaiders().filter((raider) => ['e1', 'e3', 'e4', 'e6', 'e7', 'e8'].includes(raider.id));
		return {
			...typical(),
			rig: { ...typical().rig },
			bike: { slot: at(P_OUT, AHEAD), structure: [31, 50], armor: 0, hp: [18, 25], statuses: [['speed_boost', 3]] },
			escorts: [
				{ type: 'fuel_hauler', name: 'Water Tanker', slot: at(P_OUT, CENTER), structure: [42, 60] },
				{ type: 'fuel_hauler', name: 'Fuel Hauler', slot: at(P_OUT, BEHIND) },
				{ type: 'med_truck', name: 'Med Truck', slot: at(P_IN, BEHIND) },
			],
			raiders,
		};
	},
	fullroad: fullRoad,
	passenger: () => ({
		...typical(),
		log: ['Apocalypse Rig is wrecked. The Road Warrior jumps to Lightning Bike as a passenger.'],
		seats: [
			{ adrenaline: 5, draw: 7, discard: 4, hand: ['ramming_speed', 'armor_plating', 'medical_kit', 'repair_kit', 'point_blank'], mods: [MODS.reactiveArmor, MODS.autoRepair] },
			typical().seats[1],
		],
		rig: { slot: at(P_IN, CENTER), structure: [80, 80], armor: 10, hp: [12, 40] },
		bike: { slot: at(P_IN, AHEAD), structure: [31, 50], armor: 0, hp: [18, 25], statuses: [['speed_boost', 3]] },
		wreckRig: true,
	}),
	bighands: () => {
		const road = fullRoad();
		return {
			...road,
			log: [LONG_TICKER],
			seats: [
				{ adrenaline: 5, draw: 24, discard: 17, hand: [TAG_TEAM_TAKEDOWN, ...TYPICAL_HANDS[0], 'precision_shot'], mods: SIX_MODS },
				{ adrenaline: 5, draw: 24, discard: 17, hand: [...TYPICAL_HANDS[1], 'flanking_maneuver', 'emp_blast'], mods: SIX_MODS },
			],
			escorts: road.escorts.slice(0, 2),
			raiders: road.raiders.slice(0, 7),
		};
	},
	// The Road Warrior lost on an earlier run: the Interceptor drives alone in
	// seat 1, opening inside center, with three escorts in their preferred slots
	solo: () => ({
		...typical(),
		turn: 2,
		wave: { number: 1, total: 1, incoming: 0 },
		log: ['Dust Crawler fired on Fuel Hauler for 2 (2 blocked by Armor)'],
		seats: [{ adrenaline: 5, draw: 9, discard: 3, hand: ['headshot', 'covering_fire', 'coordinated_attack', 'nitro_boost', 'far_shoot'], mods: [MODS.nitrous] }],
		rig: null,
		bike: { slot: at(P_IN, CENTER), structure: [38, 50], armor: 0, hp: [21, 25] },
		escorts: [
			{ type: 'outrider', name: 'Outrider', slot: at(P_IN, AHEAD) },
			{ type: 'fuel_hauler', name: 'Fuel Hauler', slot: at(P_OUT, CENTER) },
			{ type: 'med_truck', name: 'Med Truck', slot: at(P_OUT, BEHIND), structure: [29, 35] },
		],
	}),
};

function playerDriver(archetype: DriverArchetype, name?: string): Driver {
	const config = DRIVER_CONFIGS[archetype];
	return new Driver({
		archetype: config.id,
		metadata: { ...config.metadata, name: name ?? config.metadata.name },
		skills: { ...config.skills },
		vehicleStats: { ...config.vehicleStats },
		startingDeck: config.startingDeck,
		hitpoints: config.maxHitpoints,
		maxHitpoints: config.maxHitpoints,
		adrenaline: config.maxAdrenaline,
		maxAdrenaline: config.maxAdrenaline,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: null,
	});
}

function statusesOf(statuses: [string, number][] = []): Vehicle['statusEffects'] {
	return statuses.map(([name, duration]) => ({ name, duration }));
}

/** Structure, armor, driver HP and statuses from a spec, over whatever the vehicle came with. */
function applyVehicleSpec(vehicle: Vehicle, { structure, armor, hp, statuses }: Pick<DrivenSpec, 'structure' | 'armor' | 'hp' | 'statuses'>): void {
	if (structure) vehicle.set({ structure: structure[0], maxStructure: structure[1] });
	if (armor !== undefined) vehicle.set({ armor, maxArmor: Math.max(armor, vehicle.maxArmor) });
	if (hp && vehicle.driver) vehicle.driver.set({ hitpoints: hp[0], maxHitpoints: hp[1] });
	if (statuses) vehicle.statusEffects = statusesOf(statuses);
}

function raiderVehicle(spec: RaiderSpec, templates: Map<string, Card>): Vehicle {
	const [hitpoints, maxHitpoints] = spec.hp ?? [30, 30];
	const adrenaline = spec.adrenaline ?? 3;
	const driver = new Driver({
		archetype: 'raider',
		metadata: { name: `${spec.name} Driver`, vehicleName: spec.name, specialty: 'AGGRESSIVE', flavorText: '', unlocked: true },
		skills: { ramming: 5, gunnery: 6, evade: 4, speed: 0 },
		vehicleStats: { maxStructure: spec.structure?.[1] ?? 30, weight: 2, armor: spec.armor ?? 5, speed: spec.speed ?? 3, gunnery: 6, evade: 4 },
		startingDeck: { cards: spec.deck.map((type) => ({ type, quantity: 1 })) },
		hitpoints,
		maxHitpoints,
		adrenaline,
		maxAdrenaline: adrenaline,
		// Not the Raider driver's: per-archetype limits mustn't change a raider's draws
		handLimit: 7,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: null,
	});
	driver.createStartingDeck(templates);
	const vehicle = createDrivenVehicle({ driver, name: spec.name });
	applyVehicleSpec(vehicle, { structure: spec.structure ?? [22, 30], armor: spec.armor ?? 5, statuses: spec.statuses });
	vehicle.set({ slot: spec.slot, intentTier: spec.tier ?? IntentTier.BASIC });
	return vehicle;
}

function cardOf(type: string, templates: Map<string, Card>): Card {
	if (type === TAG_TEAM_TAKEDOWN) return tagTeamTakedown();
	const template = templates.get(type);
	if (!template) throw new Error(`battle fit scenario: no card "${type}"`);
	return template.copy();
}

/** `count` cards for a pile, cycled from the driver's own starting deck. */
function pile(driver: Driver, count: number, templates: Map<string, Card>): Card[] {
	const types = driver.startingDeck.cards.map((entry) => entry.type);
	return Array.from({ length: count }, (_, index) => cardOf(types[index % types.length], templates));
}

/**
 * The scenario's fight, started and set to the mock's board. Vehicles
 * that only get where they are mid-fight (a driven vehicle flanking on the
 * raiders' shoulder) start in a free formation slot and swerve there once
 * the battle has placed everyone; an escort whose slot the flanker had to
 * borrow joins after it.
 */
export async function prepareBattleFit(scenario: BattleFitScenario): Promise<PreparedCombat> {
	const cardLoader = CardLoader.getInstance();
	await cardLoader.loadCards();
	const templates = cardLoader.getAllCardsAsMap();
	const spec = SCENARIOS[scenario]();

	// Seat order: the Rig's driver first when they're in the fight
	const rigged = spec.rig ? { spec: spec.rig, driver: playerDriver('road_warrior', spec.seats[0].name) } : null;
	const bikeDriver = playerDriver('interceptor', spec.seats[spec.seats.length - 1].name);
	const drivers = rigged ? [rigged.driver, bikeDriver] : [bikeDriver];
	for (const driver of drivers) driver.createStartingDeck(templates);

	const rig = rigged ? createDrivenVehicle({ driver: rigged.driver, name: rigged.spec.name }) : null;
	const bike = createDrivenVehicle({ driver: bikeDriver, name: spec.bike.name });
	const driven = rig ? [rig, bike] : [bike];
	if (rig && rigged) rig.slot = rigged.spec.slot;
	const escorts = spec.escorts.map(({ type, name, slot, structure, setPiece }) => {
		const escort = createEscort({ type, setPiece });
		escort.set({ name, slot });
		if (structure) escort.set({ structure: structure[0], maxStructure: structure[1] });
		return escort;
	});

	// A flanker starts in formation: the first slot nobody else claims, or
	// the last claimed one, whose escort waits until the flanker has left it
	const flanking = spec.bike.outran !== undefined;
	const claimed = [...driven.filter((vehicle) => vehicle !== bike), ...escorts].map((vehicle) => vehicle.slot as RoadSlot);
	let borrowed: Vehicle | null = null;
	if (flanking) {
		const free = openingSlots(TeamType.PLAYER).find((slot) => !claimed.some((taken) => sameSlot(taken, slot)));
		if (free) {
			bike.slot = free;
		} else {
			borrowed = escorts.filter((escort) => escort.slot && !escort.slot.lane.endsWith('shoulder')).pop() ?? null;
			bike.slot = borrowed?.slot ?? null;
		}
	} else {
		bike.slot = spec.bike.slot;
	}

	const raiders = spec.raiders.map((raider) => raiderVehicle(raider, templates));
	const playerTeam = new Team({ type: TeamType.PLAYER, vehicles: [...driven, ...escorts.filter((escort) => escort !== borrowed)] });
	const enemyTeam = new Team({ type: TeamType.ENEMY, vehicles: raiders });
	const battle = new Battle({ playerTeam, enemyTeam });
	battle.aiController.setEnemyAI('aggressive');

	if (flanking) {
		const outranIndex = spec.raiders.findIndex((raider) => raider.id === spec.bike.outran);
		bike.set({ slot: spec.bike.slot, flank: { reservedSlot: borrowed ? null : bike.slot, outran: raiders[outranIndex] ?? null } });
		if (borrowed) playerTeam.addVehicle(borrowed);
	}

	battle.start();
	battle.turn = spec.turn;

	if (rig && rigged) applyVehicleSpec(rig, rigged.spec);
	applyVehicleSpec(bike, spec.bike);
	spec.seats.forEach((seat, index) => {
		const driver = drivers[index];
		driver.set({
			hand: seat.hand.map((type) => cardOf(type, templates)),
			adrenaline: seat.adrenaline,
			discard: pile(driver, seat.discard, templates),
			deck: new Deck(`${driver.archetype}_fit_draw`, 'Draw pile', pile(driver, seat.draw, templates)),
		});
		driven[index].mods = seat.mods;
	});

	if (spec.wreckRig && rig && rigged) {
		const [hitpoints] = rigged.spec.hp ?? [rigged.driver.hitpoints];
		rigged.driver.hitpoints = hitpoints;
		playerTeam.handleVehicleDestruction(rig);
	}

	// The board has changed since the battle planned at its start
	battle.planEnemyTurn();

	return { battle, wave: spec.wave, scrap: spec.scrap, fuel: spec.fuel, log: spec.log };
}
