import { IntentAwareAI } from './IntentAwareAI';
import { AggressiveFlankerAI } from './AggressiveFlankerAI';
import { AIType } from './AIController';
import { AIDecision } from './types';
import { createTestDriver, driverOf } from './__tests__/test-helpers';
import { Battle } from '../mechanics/Battle';
import { Card, CardEffect, TargetType } from '../mechanics/Card';
import type { DriverArchetype } from '../mechanics/Driver';
import { RoadLane, RoadRow } from '../mechanics/Road';
import { Team } from '../mechanics/Team';
import { TeamType } from '../mechanics/TeamType';
import { Vehicle } from '../mechanics/Vehicle';
import { Rng } from '../core/Rng';
import { encounterFor, encounterTeam, Skulls } from '../campaign/Encounters';
import { seatOf } from '../campaign/CombatBridge';
import { DriverRecord, placeholderName } from '../campaign/DriverRecord';
import { RunDeck } from '../campaign/RunDeck';
import cardsFile from '../data/cards.json';

const card = (name: string, targetType: TargetType, effects: CardEffect[], cost = 1): Card => new Card({
	type: name.toLowerCase().replace(/ /g, '_'),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost,
	targetType,
	effects,
	tags: []
});

const shot = (name: string, value: number): Card => card(name, 'enemy_single', [{ type: 'damage', value, range: 3, always_hits: true }]);
const armorUp = (): Card => card('Armor Up', 'self', [{ type: 'gain_armor', value: 8, target: 'self' }]);
const nitro = (): Card => card('Nitro Boost', 'self', [{ type: 'apply_status', status: 'speed_boost', value: 3, duration: 2, target: 'self' }]);

// Total speed is baseSpeed plus the test driver's speed skill of 2
const vehicle = ({ name, baseSpeed = 3, structure = 20, maxArmor = 0 }: { name: string; baseSpeed?: number; structure?: number; maxArmor?: number }): Vehicle => {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({ hitpoints: 100, maxHitpoints: 100 });
	return new Vehicle({
		name,
		armor: 0,
		maxArmor,
		structure,
		maxStructure: 20,
		baseSpeed,
		slot: null,
		flank: null,
		velocity: 0,
		driver,
		passenger: null,
		statusEffects: []
	});
};

const giveHand = (of: Vehicle, cards: Card[]): void => {
	driverOf(of).set({ hand: cards, adrenaline: 5 });
};

const decisionOf = (ai: IntentAwareAI | AggressiveFlankerAI): [string | undefined, string | undefined] => {
	const decision: AIDecision | null = ai.makeDecision();
	return [decision?.card?.name, decision?.target instanceof Vehicle ? decision.target.name : undefined];
};

describe('IntentAwareAI', () => {
	let rig: Vehicle;
	let battle: Battle;
	const aisFor = (): { intent: IntentAwareAI; aggressive: AggressiveFlankerAI } => ({
		intent: new IntentAwareAI(battle.playerTeam, battle),
		aggressive: new AggressiveFlankerAI(battle.playerTeam, battle)
	});

	beforeEach(() => {
		rig = vehicle({ name: 'Rig', baseSpeed: 1, maxArmor: 10 });
	});

	test('takes the kill that removes the bigger intent, where the aggressive AI finishes the weaker raider', () => {
		const brute = vehicle({ name: 'Brute', structure: 10 });
		const pest = vehicle({ name: 'Pest', structure: 5 });
		battle = new Battle({
			playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig] }),
			enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [brute, pest] })
		});
		giveHand(brute, [shot('Heavy Shot', 12)]);
		giveHand(pest, [shot('Jab', 4)]);
		battle.planEnemyTurn();
		giveHand(rig, [shot('Finisher', 30)]);

		const { intent, aggressive } = aisFor();
		expect(decisionOf(aggressive)).toEqual(['Finisher', 'Pest']);
		expect(decisionOf(intent)).toEqual(['Finisher', 'Brute']);
	});

	test('soaks a planned hit with armor before chip damage that kills nothing', () => {
		const buggy = vehicle({ name: 'Buggy' });
		battle = new Battle({
			playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig] }),
			enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [buggy] })
		});
		giveHand(buggy, [shot('Heavy Shot', 12)]);
		battle.planEnemyTurn();
		giveHand(rig, [shot('Chip', 4), armorUp()]);

		const { intent, aggressive } = aisFor();
		expect(decisionOf(aggressive)).toEqual(['Chip', 'Buggy']);
		expect(decisionOf(intent)).toEqual(['Armor Up', undefined]);
	});

	test('outpaces a flanker so it drops back and its hit loses the flank bonus', () => {
		// The Buggy (5) outran the Rig (3) onto the player shoulder; a Nitro
		// Boost puts the Rig at 6
		const buggy = vehicle({ name: 'Buggy' });
		battle = new Battle({
			playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig] }),
			enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [buggy] })
		});
		buggy.set({
			slot: { lane: RoadLane.PLAYER_SHOULDER, row: RoadRow.CENTER },
			flank: { reservedSlot: { lane: RoadLane.ENEMY_OUTSIDE, row: RoadRow.CENTER }, outran: rig }
		});
		giveHand(buggy, [shot('Heavy Shot', 12)]);
		battle.planEnemyTurn();
		expect(battle.getIntents(buggy)[0]).toMatchObject({ amount: 18 });
		giveHand(rig, [shot('Chip', 4), nitro()]);

		expect(decisionOf(aisFor().intent)).toEqual(['Nitro Boost', undefined]);
	});

	test('plays as the aggressive AI does when no raider plans an attack', () => {
		const buggy = vehicle({ name: 'Buggy' });
		battle = new Battle({
			playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig] }),
			enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [buggy] })
		});
		battle.planEnemyTurn();
		giveHand(rig, [shot('Chip', 4), armorUp(), nitro()]);

		const { intent, aggressive } = aisFor();
		expect(decisionOf(intent)).toEqual(decisionOf(aggressive));
	});
});

/**
 * The intent-aware stand-in against the aggressive floor on today's
 * encounters, set up as scripts/raider-sim.mjs does a fight: each crew
 * fresh on its default decks, the skull count's encounter sized to it, the
 * aggressive AI on the raiders, the same seeds for both stand-ins.
 */
describe('the intent-aware stand-in on today\'s encounters', () => {
	const CARDS = new Map(cardsFile.cards.map(data => [data.type, new Card({ ...data, upgraded: false } as ConstructorParameters<typeof Card>[0])]));
	const CREWS: DriverArchetype[][] = [
		['road_warrior', 'interceptor'], ['road_warrior', 'mechanic'], ['interceptor', 'mechanic'],
		['road_warrior'], ['interceptor'], ['mechanic']
	];
	const SKULLS: Skulls[] = [1, 2, 3];
	const SEEDS = [1, 2, 3, 4];
	const TURNS = 25;

	interface Sample {
		fights: number;
		won: number;
		stalled: number;
		/** Driver hitpoints lost over the fights won, as a share of the crews' maximum */
		hitpointsLost: number;
		/** Cards the battle refused */
		refused: number;
	}

	async function fight({ crew, skulls, seed, playerAI }: { crew: DriverArchetype[]; skulls: Skulls; seed: number; playerAI: AIType }): Promise<{ battle: Battle; lost: number; max: number }> {
		const seats = crew.map((archetype, seat) => {
			const record = new DriverRecord({ id: `driver-${seat + 1}`, archetype, name: placeholderName({ archetype, ordinal: 1 }) });
			return seatOf({ record, runDeck: new RunDeck({ driver: record, own: record.defaultDeck }), cards: CARDS });
		});
		const vehicles = seats.map(seat => seat.vehicle);
		const battle = new Battle({
			playerTeam: new Team({ type: TeamType.PLAYER, vehicles }),
			enemyTeam: encounterTeam({ encounter: encounterFor(skulls), cards: CARDS, crewStructure: vehicles.map(seated => seated.structure) }),
			rng: new Rng({ seed }).fork('fight', skulls)
		});
		battle.aiController.setEnemyAI('aggressive');
		battle.aiController.setPlayerAI(playerAI);
		const start = seats.map(({ driver }) => driver.hitpoints);
		battle.start();
		while (!battle.isBattleOver() && battle.turn <= TURNS) {
			await battle.aiController.playPlayerCards();
			battle.endPlayerTurn();
		}
		return {
			battle,
			lost: seats.reduce((sum, { driver }, seat) => sum + start[seat] - Math.max(0, driver.hitpoints), 0),
			max: seats.reduce((sum, { driver }) => sum + driver.maxHitpoints, 0)
		};
	}

	/** Raiders play their plans inside Battle, so every playCard call is the player side's */
	async function sample(playerAI: AIType): Promise<Sample> {
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const result: Sample = { fights: 0, won: 0, stalled: 0, hitpointsLost: 0, refused: 0 };
		let lost = 0;
		let max = 0;
		for (const crew of CREWS) {
			for (const skulls of SKULLS) {
				for (const seed of SEEDS) {
					const { battle, lost: fightLost, max: fightMax } = await fight({ crew, skulls, seed, playerAI });
					result.fights++;
					if (!battle.isBattleOver()) {
						result.stalled++;
					} else if (battle.isBattleWon()) {
						result.won++;
						lost += fightLost;
						max += fightMax;
					}
				}
			}
		}
		result.hitpointsLost = lost / max;
		result.refused = playCard.mock.results.filter(({ value }) => value === false).length;
		playCard.mockRestore();
		return result;
	}

	beforeEach(() => {
		// Drivers log every draw, and the AIs think aloud
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
		jest.spyOn(console, 'info').mockImplementation(() => undefined);
		jest.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('wins at least as often as the aggressive AI for no more HP, and never plays a card the battle refuses', async () => {
		const aggressive = await sample('aggressive');
		const intent = await sample('intent');
		const line = (name: string, { fights, won, stalled, hitpointsLost }: Sample): string =>
			`${name}: won ${won}/${fights}, stalled ${stalled}, HP lost in wins ${(hitpointsLost * 100).toFixed(1)}%`;
		process.stdout.write(`${line('aggressive', aggressive)}\n${line('intent', intent)}\n`);

		expect(intent.refused).toBe(0);
		expect(intent.won).toBeGreaterThanOrEqual(aggressive.won);
		expect(intent.hitpointsLost).toBeLessThanOrEqual(aggressive.hitpointsLost);
	}, 120000);
});
