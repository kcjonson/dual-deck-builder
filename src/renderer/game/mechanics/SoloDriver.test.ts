import { Battle, HitEvent, TURN_DRAW } from './Battle';
import { BoardProjection } from './BoardProjection';
import { Card, CardData, CardEffect, TargetType } from './Card';
import { Deck } from './Deck';
import { DRIVER_CONFIGS, Driver, DriverArchetype, DriverRole } from './Driver';
import { EscortType, convertToEscort, createEscort } from './Escort';
import { IntentType } from './Intent';
import { RoadLane, RoadRow } from './Road';
import { Team, TeamType } from './Team';
import { Vehicle, createDrivenVehicle } from './Vehicle';
import { Rng } from '../core/Rng';
import type { AIType } from '../ai/AIController';
import { RandomAI } from '../ai/RandomAI';
import type { AIDecision } from '../ai/types';
import cardsFile from '../data/cards.json';

/**
 * DDB-166: a player team with one driven vehicle, for a run down to its
 * last driver, and a driver's vehicle that carried on unmanned going into a
 * new team. Provisional calls: docs/AI_TECHNICAL_DECISIONS/solo-driver-fights.md.
 */

const CARDS = new Map((cardsFile as unknown as { cards: CardData[] }).cards.map(data => [data.type, new Card(data)]));

const card = (type: string): Card => {
	const template = CARDS.get(type);
	if (!template) throw new Error(`no card ${type}`);
	return template.copy();
};

/** An archetype's driver as a fight seats them, their starting deck plus `extra` cards, dealt from cards.json. */
function seated(archetype: DriverArchetype, extra: string[] = []): Driver {
	const config = DRIVER_CONFIGS[archetype];
	const driver = new Driver({
		archetype: config.id,
		metadata: { ...config.metadata },
		skills: { ...config.skills },
		vehicleStats: { ...config.vehicleStats },
		startingDeck: { cards: [...config.startingDeck.cards, ...extra.map(type => ({ type, quantity: 1 }))] },
		hitpoints: config.maxHitpoints,
		maxHitpoints: config.maxHitpoints,
		adrenaline: config.maxAdrenaline,
		maxAdrenaline: config.maxAdrenaline,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: null
	});
	driver.createStartingDeck(CARDS);
	return driver;
}

/** A Rust Buggy like the combat screen's: evade 4, its deck `deck`, or nothing to play. */
function raider({ deck = [], structure = 30, hitpoints = 30 }: { deck?: Card[]; structure?: number; hitpoints?: number } = {}): Vehicle {
	const driver = new Driver({
		archetype: 'raider',
		metadata: { name: 'Wasteland Raider', vehicleName: 'Rust Buggy', specialty: 'AGGRESSIVE', flavorText: '', unlocked: true },
		skills: { ramming: 5, gunnery: 6, evade: 4, speed: 2 },
		vehicleStats: { maxStructure: structure, weight: 2, armor: 0, speed: 3, gunnery: 6, evade: 4 },
		startingDeck: { cards: [] },
		hitpoints,
		maxHitpoints: hitpoints,
		adrenaline: 3,
		maxAdrenaline: 3,
		handLimit: 7,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck('raider', 'Raider deck', deck)
	});
	return createDrivenVehicle({ driver });
}

/** A raider's card that always lands where its AI aims it. */
const raiderCard = (name: string, effect: CardEffect, targetType: TargetType = 'enemy_single'): Card => new Card({
	type: name.toLowerCase(),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost: 1,
	targetType,
	effects: [{ ...effect, always_hits: true }],
	tags: ['attack']
});
const snipe = (): Card => raiderCard('Snipe', { type: 'damage', value: 500, target: 'driver' });
const wreck = (): Card => raiderCard('Wreck', { type: 'damage', value: 170, target: 'target' });

const playerTeam = (vehicles: Vehicle[]): Team => new Team({ type: TeamType.PLAYER, vehicles });

function fight({ player, raiders, rng = new Rng({ seed: 166 }) }: { player: Vehicle[]; raiders: Vehicle[]; rng?: Rng }): Battle {
	const battle = new Battle({ playerTeam: playerTeam(player), enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: raiders }), rng });
	battle.start();
	return battle;
}

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

/** The lone driver's hand set to these cards, with `adrenaline` to spend. */
function deal(driver: Driver, types: string[], adrenaline = driver.maxAdrenaline): void {
	driver.set({ hand: types.map(card), adrenaline });
}

function playOne({ battle, driver, type, target }: { battle: Battle; driver: Driver; type: string; target?: Vehicle }): boolean {
	return battle.playCard({ driver, cardIndex: driver.hand.findIndex(held => held.type === type), targetVehicle: target });
}

/** A driven vehicle whose driver died with nobody to take the wheel, carrying on as an escort. */
function carriedOnUnmanned(archetype: DriverArchetype): Vehicle {
	const vehicle = createDrivenVehicle({ driver: seated(archetype) });
	vehicle.set({ driver: null, slot: { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.BEHIND } });
	convertToEscort(vehicle);
	return vehicle;
}

const convoy = (...types: EscortType[]): Vehicle[] => types.map(type => createEscort({ type }));

describe('a fight with one driver', () => {
	beforeEach(() => {
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('the team', () => {
		it('takes one driven vehicle and a full convoy', () => {
			const bike = createDrivenVehicle({ driver: seated('interceptor') });
			const escorts = convoy('outrider', 'pilot_car', 'fuel_hauler', 'med_truck');

			const team = playerTeam([bike, ...escorts]);

			expect(team.drivenVehicles).toEqual([bike]);
			expect(team.convoyEscorts).toEqual(escorts);
		});

		it('takes a vehicle that carried on unmanned beside one driven vehicle, as its driver\'s and not the convoy\'s', () => {
			const rig = createDrivenVehicle({ driver: seated('road_warrior') });
			const bike = carriedOnUnmanned('interceptor');
			const escorts = convoy('outrider', 'pilot_car', 'fuel_hauler', 'med_truck');

			const team = playerTeam([rig, bike, ...escorts]);

			expect(bike.carriesOnUnmanned).toBe(true);
			expect(team.drivenVehicles).toEqual([rig]);
			expect(team.escorts).toEqual([bike, ...escorts]);
			// Four convoy escorts and the Bike: the Bike is a driver's vehicle, so the convoy's four aren't over
			expect(team.convoyEscorts).toEqual(escorts);
		});

		it('refuses a third driver\'s vehicle, driven or carrying on unmanned, and a team with nobody driving', () => {
			const rig = createDrivenVehicle({ driver: seated('road_warrior') });
			const bike = createDrivenVehicle({ driver: seated('interceptor') });

			expect(() => playerTeam([rig, bike, carriedOnUnmanned('mechanic')]))
				.toThrow("Player teams can field 2 drivers' vehicles, driven or carrying on unmanned, not 3");
			expect(() => playerTeam([rig, carriedOnUnmanned('interceptor')]).addVehicle(createDrivenVehicle({ driver: seated('mechanic') })))
				.toThrow("Player teams can field 2 drivers' vehicles, driven or carrying on unmanned, not 3");
			expect(() => playerTeam([rig, bike]).addVehicle(carriedOnUnmanned('mechanic')))
				.toThrow("Player teams can field 2 drivers' vehicles, driven or carrying on unmanned, not 3");
			expect(() => playerTeam([carriedOnUnmanned('interceptor'), ...convoy('outrider')]))
				.toThrow('Player teams must have 1 or 2 driven vehicles, not 0');
		});

		it('ends a fight with the vehicle that carried on unmanned still its driver\'s: not in the convoy, its armor as it was', () => {
			const rig = createDrivenVehicle({ driver: seated('road_warrior') });
			const bike = carriedOnUnmanned('road_warrior');
			bike.set({ armor: 2 });
			const [hauler] = convoy('fuel_hauler');
			const battle = fight({ player: [rig, bike, hauler], raiders: [raider()] });

			const after = battle.endCombat();

			expect(after.escorts).toEqual([hauler]);
			expect(bike.armor).toBe(2);
		});
	});

	describe('the turn', () => {
		it('opens with the lone driver inside center, one hand of five, and their own pool full', () => {
			const bike = createDrivenVehicle({ driver: seated('interceptor') });
			const [outrider, truck] = convoy('outrider', 'med_truck');

			const battle = fight({ player: [bike, outrider, truck], raiders: [raider()] });
			const driver = driverOf(bike);

			expect(bike.slot).toEqual({ lane: RoadLane.PLAYER_INSIDE, row: RoadRow.CENTER });
			expect(outrider.slot).toEqual({ lane: RoadLane.PLAYER_INSIDE, row: RoadRow.AHEAD });
			expect(truck.slot).toEqual({ lane: RoadLane.PLAYER_OUTSIDE, row: RoadRow.BEHIND });
			expect(driver.hand).toHaveLength(TURN_DRAW);
			expect(driver.adrenaline).toBe(driver.maxAdrenaline);
			expect(battle.isPlayerTurn).toBe(true);
		});

		it('goes the lone driver, the raiders, then the lone driver again, discarding and drawing their own hand and refilling their own pool', () => {
			const bike = createDrivenVehicle({ driver: seated('interceptor') });
			const battle = fight({ player: [bike], raiders: [raider()] });
			const driver = driverOf(bike);
			deal(driver, ['armor_plating', 'nitro_boost'], 2);
			const dealt = [...driver.hand];

			expect(playOne({ battle, driver, type: 'armor_plating' })).toBe(true);
			battle.endPlayerTurn();

			expect([battle.turn, battle.isPlayerTurn]).toEqual([2, true]);
			expect(driver.adrenaline).toBe(driver.maxAdrenaline);
			expect(driver.hand).toHaveLength(TURN_DRAW);
			expect(driver.discard).toEqual(expect.arrayContaining(dealt));
		});
	});

	describe('cards with no partner', () => {
		it('plays Coordinated Attack for its base damage, since no partner can have attacked this turn', () => {
			const bike = createDrivenVehicle({ driver: seated('interceptor') });
			const target = raider({ structure: 200, hitpoints: 200 });
			const battle = fight({ player: [bike], raiders: [target] });
			const driver = driverOf(bike);
			const hits: HitEvent[] = [];
			battle.on('hitLanded', (hit: HitEvent) => hits.push(hit));
			deal(driver, ['coordinated_attack']);

			expect(battle.canPlayCard({ driver, card: driver.hand[0] })).toBe(true);
			expect(playOne({ battle, driver, type: 'coordinated_attack', target })).toBe(true);

			expect(hits.map(hit => [hit.vehicle, hit.damage])).toEqual([[target, 3]]);
		});

		it('lands a card on both drivers on the lone driver\'s own vehicle', () => {
			const bike = createDrivenVehicle({ driver: seated('interceptor') });
			const battle = fight({ player: [bike], raiders: [raider()] });
			const driver = driverOf(bike);
			const rally = raiderCard('Rally Cry', { type: 'gain_shield', value: 3 }, 'both_drivers');
			driver.set({ hand: [rally], adrenaline: 1 });

			expect(battle.playCard({ driver, cardIndex: 0 })).toBe(true);

			expect(bike.shield).toBe(3);
		});

		it('fuels and patches up the lone driver with the haulers\' cards, picked on their own vehicle', () => {
			const bike = createDrivenVehicle({ driver: seated('interceptor') });
			const battle = fight({ player: [bike, ...convoy('fuel_hauler', 'med_truck')], raiders: [raider()] });
			const driver = driverOf(bike);
			driver.set({ hitpoints: 10 });
			deal(driver, ['top_off', 'triage'], 1);

			expect(playOne({ battle, driver, type: 'top_off', target: bike })).toBe(true);
			expect(driver.adrenaline).toBe(2);
			expect(playOne({ battle, driver, type: 'triage', target: bike })).toBe(true);
			expect(driver.hitpoints).toBe(14);
		});
	});

	describe('losing the lone driver', () => {
		it('loses the fight the moment they go down', () => {
			const bike = createDrivenVehicle({ driver: seated('interceptor') });
			const battle = fight({ player: [bike, ...convoy('outrider')], raiders: [raider({ deck: [snipe()] })] });

			battle.endPlayerTurn();

			expect([battle.isBattleOver(), battle.isBattleWon()]).toEqual([true, false]);
			expect(battle.getMessages().map(message => message.message)).toContain('Battle lost: All player drivers defeated');
		});

		it('loses the fight when they crash out of a wreck with no escort to ride in', () => {
			const bike = createDrivenVehicle({ driver: seated('interceptor') });
			const driver = driverOf(bike);
			driver.set({ maxHitpoints: 200, hitpoints: 200 });
			const battle = fight({ player: [bike], raiders: [raider({ deck: [wreck()] })] });

			battle.endPlayerTurn();

			expect(driver.isAlive()).toBe(true);
			expect(battle.playerTeam.isAboard(driver)).toBe(false);
			expect([battle.isBattleOver(), battle.isBattleWon()]).toEqual([true, false]);
		});

		it('seats them in the nearest escort when their vehicle is wrecked, as a passenger who orders and can\'t attack', () => {
			const bike = createDrivenVehicle({ driver: seated('interceptor') });
			const driver = driverOf(bike);
			driver.set({ maxHitpoints: 200, hitpoints: 200 });
			const [outrider, hauler] = convoy('outrider', 'fuel_hauler');
			const battle = fight({ player: [bike, outrider, hauler], raiders: [raider({ deck: [wreck()] })] });

			battle.endPlayerTurn();

			// The Outrider, inside ahead, is one row from the wreck; the Fuel Hauler, outside center, is one lane
			// away too, and the tie goes to the inside lane, as for attack orders
			expect(outrider.passenger).toBe(driver);
			expect(driver.role).toBe(DriverRole.PASSENGER);
			expect(battle.isBattleOver()).toBe(false);
			deal(driver, ['precision_shot', 'covering_fire']);
			expect(battle.canPlayCard({ driver, card: driver.hand[0] })).toBe(false);
			expect(battle.canPlayCard({ driver, card: driver.hand[1] })).toBe(true);
		});
	});
});

/** Escort orders for the player's deck, the buff orders that target an escort among them. */
const ORDERS = ['covering_fire', 'draw_fire', 'close_ranks', 'run_ahead', 'top_off', 'triage'];

/** Each AI on each side once a seed, MCTS on both. */
const MATCHUPS: readonly [AIType, AIType][] = [
	['random', 'aggressive'],
	['aggressive', 'mcts'],
	['mcts', 'salvage'],
	['salvage', 'ramming'],
	['ramming', 'random']
];

const SEEDS = [1, 2, 3];

/** The combat screen's own raider: precision shots and ramming speed, one a looter. */
function rustBuggy({ looter }: { looter: boolean }): Vehicle {
	const buggy = raider({ deck: ['ramming_speed', 'ramming_speed', 'precision_shot', 'precision_shot', 'precision_shot'].map(card) });
	buggy.raiderArchetype = looter ? 'looter' : null;
	return buggy;
}

describe('AIs against one player vehicle', () => {
	beforeEach(() => {
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	const played: string[] = [];

	describe.each(SEEDS)('seed %i', (seed) => {
		it.each(MATCHUPS)('%s for the player against %s raiders plays the fight out', async (playerAI, enemyAI) => {
			const driver = seated('interceptor', ORDERS);
			const player = [createDrivenVehicle({ driver }), ...convoy('outrider', 'fuel_hauler', 'med_truck')];
			const battle = new Battle({
				playerTeam: playerTeam(player),
				enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [rustBuggy({ looter: true }), rustBuggy({ looter: false })] }),
				maxTurns: 25,
				rng: new Rng({ seed })
			});
			battle.aiController.setPlayerAI(playerAI);
			battle.aiController.setEnemyAI(enemyAI);
			battle.start();

			for (let turn = 0; turn < 30 && !battle.isBattleOver(); turn++) {
				// Every attack the raiders plan is aimed at one of the player's vehicles
				for (const intents of battle.getAllIntents().values()) {
					for (const intent of intents.filter(planned => planned.type === IntentType.ATTACK && planned.target !== 'both' && planned.target !== null)) {
						expect(player.map(vehicle => vehicle.id)).toContain(intent.target);
					}
				}
				await battle.aiController.playPlayerCards();
				battle.endPlayerTurn();
			}

			expect(battle.isBattleOver()).toBe(true);
			const plays = battle.getMessagesByType('card_played').filter(message => message.metadata?.driver === driver.metadata.name);
			expect(plays.length).toBeGreaterThan(0);
			played.push(...plays.map(message => String(message.metadata?.card)));
		});
	});

	it('offers an order aimed at an escort each of the team\'s own escorts in the fight', () => {
		const driver = seated('interceptor');
		const [outrider, hauler] = convoy('outrider', 'fuel_hauler');
		const battle = fight({ player: [createDrivenVehicle({ driver }), outrider, hauler], raiders: [raider()] });
		deal(driver, ['draw_fire']);
		const ai = new RandomAI({ team: battle.playerTeam, battle, rng: new Rng({ seed: 1 }) });
		ai['board'] = new BoardProjection({ battle });

		const offered: AIDecision[] = ai['generatePossibleActions']();

		expect(offered.filter(action => action.card?.type === 'draw_fire').map(action => action.target)).toEqual([outrider, hauler]);
	});

	it('plays the orders that target an escort along the way', () => {
		expect(played).toEqual(expect.arrayContaining(['Draw Fire']));
		expect(played.some(name => name === 'Close Ranks' || name === 'Draw Fire')).toBe(true);
	});
});
