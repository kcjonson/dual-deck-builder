import { Battle, EnemyTurnStep } from './Battle';
import { Card, CardData, CardEffect, TargetType } from './Card';
import { Driver } from './Driver';
import { IntentTier, IntentType, buffLabelOf, intentTypeOf } from './Intent';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { Team, TeamType } from './Team';
import { BOXED_IN, Vehicle } from './Vehicle';
import { AIPlayer } from '../ai/AIPlayer';
import { MCTSAI } from '../ai/MCTSAI';
import { AggressiveFlankerAI } from '../ai/AggressiveFlankerAI';
import { AIDecision } from '../ai/types';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import cardsFile from '../data/cards.json';

/**
 * DDB-546: raiders swerve from movement cards in their own decks. Planning
 * judges the cards after a swerve from where it lands and can choose one,
 * the plan names each swerve's slot, a swerve whose slot has gone stale
 * fizzles (call 289), and the intent says where it's going (call 288).
 */

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });
const { PLAYER_SHOULDER, PLAYER_INSIDE, ENEMY_INSIDE, ENEMY_OUTSIDE } = RoadLane;
const { AHEAD, CENTER, BEHIND } = RoadRow;

// Total speed is baseSpeed plus the test driver's speed skill of 2
const createVehicle = (name: string, baseSpeed: number, startSlot: RoadSlot | null = null): Vehicle => {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({ hitpoints: 100, maxHitpoints: 100 });
	return new Vehicle({
		name,
		armor: 0,
		maxArmor: 0,
		structure: 20,
		maxStructure: 20,
		baseSpeed,
		slot: startSlot,
		flank: null,
		velocity: 0,
		driver,
		passenger: null,
		statusEffects: []
	});
};

const card = (name: string, targetType: TargetType, effects: CardEffect[], tags: string[] = []): Card => new Card({
	type: name.toLowerCase().replace(/ /g, '_'),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost: 1,
	targetType,
	effects,
	tags
});

/** A fresh copy of a card as cards.json has it */
const realCard = (type: string): Card => {
	const data = (cardsFile as unknown as { cards: CardData[] }).cards.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data });
};

// The six raider movement cards (call 287), as cards.json has them
const laneChange = () => realCard('lane_change');
const floorIt = () => realCard('floor_it');
const hardBrake = () => realCard('hard_brake');
const cutOff = () => realCard('cut_off');
const juke = () => realCard('juke');
const strafe = () => realCard('strafe');
const flank = () => card('Flank', 'enemy_single', [{ type: 'change_position', position: 'flanking', target: 'self' }]);
const pointBlank = () => card('Point Blank', 'enemy_single', [{ type: 'damage', value: 4, range: 1, always_hits: true }], ['attack']);

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const giveHand = (vehicle: Vehicle, cards: Card[]): void => {
	driverOf(vehicle).set({ hand: cards, adrenaline: 5 });
};

/** Gunnery 6, past the test drivers' evade 5, since Strafe's shot rolls (call 342) */
const sharpshooter = (vehicle: Vehicle): void => {
	driverOf(vehicle).set({ skills: { ...driverOf(vehicle).skills, gunnery: 6 } });
};

const fizzles = (battle: Battle): string[] =>
	battle.getMessages().filter(message => message.type === 'fizzle').map(message => message.message);

/**
 * End the player's turn and play this many raider actions, stopping before
 * the enemy turn finishes, so close-up and the next draw don't move or
 * refill anything a test reads
 */
const playPlans = (battle: Battle, count: number): EnemyTurnStep[] => {
	battle.endPlayerTurn({ stepEnemyTurn: true });
	const steps: EnemyTurnStep[] = [];
	for (let index = 0; index < count; index++) {
		const step = battle.stepEnemyTurn();
		if (!step) throw new Error(`the enemy turn ran out after ${index} actions`);
		steps.push(step);
	}
	return steps;
};

/** The raiders plan with MCTS, kept short so a test runs fast */
const useMcts = (battle: Battle): void => {
	battle.aiController['enemyAI'] = new MCTSAI({ team: battle.enemyTeam, battle, iterations: 60 });
};

const useAggressive = (battle: Battle): void => {
	battle.aiController.setEnemyAI('aggressive');
};

/** Exposes the plays an AI is offered on the live board */
class OfferingAI extends AggressiveFlankerAI {
	public offered(raider: Vehicle): AIDecision[] {
		this.board = this.battle.projectEnemyTurnStart();
		this.board.actor = raider;
		return this.generatePossibleActions().filter(action => action.type === 'playCard');
	}
}

describe('Raider swerves', () => {
	// Rig inside center and Bike inside behind; the Buggy in the raiders'
	// outside lane, center, 2 from the Rig, so a Range 1 card needs a
	// swerve into the inside lane first
	let rig: Vehicle;
	let bike: Vehicle;
	let buggy: Vehicle;
	let battle: Battle;

	const build = (raiders: Vehicle[]): Battle => new Battle({
		playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, bike] }),
		enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: raiders })
	});

	beforeEach(() => {
		rig = createVehicle('Rig', 1);
		bike = createVehicle('Bike', 5);
		buggy = createVehicle('Buggy', 3, slot(ENEMY_OUTSIDE, CENTER));
		battle = build([buggy]);
	});

	describe('planning', () => {
		test.each([
			['the aggressive AI', useAggressive],
			['MCTS', useMcts]
		])('%s swerves into range first, and judges the shot after it from the slot it lands in', (_, useAI) => {
			useAI(battle);
			giveHand(buggy, [pointBlank(), laneChange()]);
			battle.planEnemyTurn();

			const plan = battle.getPlan(buggy);
			expect(plan.map(action => action.card.name)).toEqual(['Lane Change', 'Point Blank']);
			expect(plan[0].destination).toEqual(slot(ENEMY_INSIDE, CENTER));
			expect(plan[1].slot).toEqual(slot(ENEMY_INSIDE, CENTER));
			expect(plan[1].target).toBe(rig);
			// The preview judges the shot from there too
			expect(battle.getIntents(buggy).map(intent => intent.type)).toEqual([IntentType.MOVE, IntentType.ATTACK]);
		});

		test.each([
			['the aggressive AI', useAggressive],
			['MCTS', useMcts]
		])('%s won\'t swerve a shot out of range, nor swerve afterwards for nothing', (_, useAI) => {
			buggy.set({ slot: slot(ENEMY_INSIDE, CENTER) });
			useAI(battle);
			giveHand(buggy, [laneChange(), pointBlank()]);
			battle.planEnemyTurn();

			expect(battle.getPlan(buggy).map(action => action.card.name)).toEqual(['Point Blank']);
		});

		test.each([
			['the aggressive AI', useAggressive],
			['MCTS', useMcts]
		])('%s ends its turn rather than swerve out and back with nothing to line up', (_, useAI) => {
			useAI(battle);
			giveHand(buggy, [laneChange(), laneChange()]);
			battle.planEnemyTurn();

			expect(battle.getPlan(buggy)).toEqual([]);
			expect(battle.getIntents(buggy)).toEqual([]);
		});

		test.each([
			['the aggressive AI', useAggressive],
			['MCTS', useMcts]
		])('%s still plays a swerve on a card with more to it', (_, useAI) => {
			useAI(battle);
			giveHand(buggy, [hardBrake()]);
			battle.planEnemyTurn();

			expect(battle.getPlan(buggy).map(action => action.card.name)).toEqual(['Hard Brake']);
		});

		test.each([
			['the aggressive AI', useAggressive],
			['MCTS', useMcts]
		])('%s picks the slot a picked swerve goes to by what it puts in range, not by the order slots come in', (_, useAI) => {
			// From the inside lane, ahead: the slot behind lines up the Rig, and the outside lane comes first
			buggy.set({ slot: slot(ENEMY_INSIDE, AHEAD) });
			useAI(battle);
			giveHand(buggy, [juke(), pointBlank()]);
			battle.planEnemyTurn();

			const plan = battle.getPlan(buggy);
			expect(plan.map(action => action.card.name)).toEqual(['Juke', 'Point Blank']);
			expect(plan[0].destination).toEqual(slot(ENEMY_INSIDE, CENTER));
			expect(plan[1].target).toBe(rig);
		});

		test('a boxed-in raider can\'t flank, so it swerves into range instead', () => {
			useAggressive(battle);
			giveHand(buggy, [flank(), laneChange(), pointBlank()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].card.name).toBe('Flank');

			giveHand(buggy, [flank(), laneChange(), pointBlank()]);
			buggy.applyStatusEffect({ name: BOXED_IN, duration: 1, value: 0 });
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy).map(action => action.card.name)).toEqual(['Lane Change', 'Point Blank']);
		});

		test('a Strafe carries the slot its shot reaches from, and plays from there', () => {
			sharpshooter(buggy);
			useAggressive(battle);
			giveHand(buggy, [strafe()]);
			battle.planEnemyTurn();

			const [planned] = battle.getPlan(buggy);
			expect(planned.target).toBe(rig);
			expect(planned.destination).toEqual(slot(ENEMY_INSIDE, CENTER));

			playPlans(battle, 1);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, CENTER));
			// 4 past no armor, split between structure and the driver
			expect(rig.structure).toBe(18);
		});

		test('offers a picked swerve at each slot it could take, and a Strafe only where its shot reaches', () => {
			const ai = new OfferingAI(battle.enemyTeam, battle);
			giveHand(buggy, [juke()]);
			expect(ai.offered(buggy).map(action => action.destination)).toEqual(expect.arrayContaining([
				slot(ENEMY_INSIDE, CENTER),
				slot(ENEMY_OUTSIDE, AHEAD),
				slot(ENEMY_OUTSIDE, BEHIND)
			]));
			expect(ai.offered(buggy)).toHaveLength(3);

			giveHand(buggy, [strafe()]);
			expect(ai.offered(buggy).map(action => [action.target, action.destination])).toEqual([[rig, slot(ENEMY_INSIDE, CENTER)]]);
		});

		test('a flanker plans no swerve', () => {
			buggy.set({ slot: slot(PLAYER_SHOULDER, CENTER), flank: { reservedSlot: slot(ENEMY_INSIDE, CENTER), outran: rig } });
			useAggressive(battle);
			giveHand(buggy, [laneChange(), juke()]);
			battle.planEnemyTurn();

			expect(battle.getPlan(buggy)).toEqual([]);
		});

		test('a flank is still the only move worth the flank priority', () => {
			useAggressive(battle);
			giveHand(buggy, [laneChange(), flank()]);
			battle.planEnemyTurn();

			expect(battle.getPlan(buggy)[0].card.name).toBe('Flank');
		});

		test('a plan names where a fixed swerve goes, not just a picked one', () => {
			giveHand(buggy, [floorIt()]);
			battle.planEnemyTurn();

			expect(battle.getPlan(buggy)[0].destination).toEqual(slot(ENEMY_OUTSIDE, AHEAD));
		});

		test('an AI that plans a picked swerve without its slot fails loudly', () => {
			const picked = juke();
			giveHand(buggy, [picked]);
			const careless: Pick<AIPlayer, 'makeDecision'> = { makeDecision: () => ({ type: 'playCard', card: picked, driver: driverOf(buggy) }) };
			battle.aiController['enemyAI'] = careless as AIPlayer;

			expect(() => battle.planEnemyTurn()).toThrow('Buggy planned Juke without picking the slot its move goes to');
		});

		test('an AI that plans a picked swerve to a slot it can\'t take fails loudly', () => {
			const picked = juke();
			giveHand(buggy, [picked]);
			const careless: Pick<AIPlayer, 'makeDecision'> = {
				makeDecision: () => ({ type: 'playCard', card: picked, driver: driverOf(buggy), destination: slot(PLAYER_INSIDE, AHEAD) })
			};
			battle.aiController['enemyAI'] = careless as AIPlayer;

			expect(() => battle.planEnemyTurn()).toThrow("Buggy planned Juke to player inside, ahead, which it can't take: player inside, ahead is not in Buggy's formation");
		});
	});

	describe('a planned swerve that goes stale (call 289)', () => {
		beforeEach(() => {
			useAggressive(battle);
		});

		test('fizzles when a shove leaves its slot out of reach, and the shot after it fizzles from where the raider really is', () => {
			giveHand(buggy, [pointBlank(), laneChange()]);
			battle.planEnemyTurn();
			expect(battle.getIntents(buggy)).toHaveLength(2);

			// Shoved a row ahead: the planned slot is diagonal now, and the Rig 3 away
			buggy.set({ slot: slot(ENEMY_OUTSIDE, AHEAD) });
			expect(battle.getIntents(buggy)).toEqual([]);

			expect(playPlans(battle, 2).map(step => step.outcome)).toEqual(['fizzled', 'fizzled']);
			expect(fizzles(battle)).toEqual([
				"Buggy's Lane Change fizzles: enemy inside, center is not next to Buggy",
				"Buggy's Point Blank fizzles: Rig is out of range (3 away, needs 1)"
			]);
			expect(buggy.slot).toEqual(slot(ENEMY_OUTSIDE, AHEAD));
			expect(rig.structure).toBe(20);
		});

		test('a fixed swerve fizzles rather than going some way the player never saw outlined (call 330)', () => {
			giveHand(buggy, [pointBlank(), laneChange()]);
			battle.planEnemyTurn();

			// Next to the planned slot, but Lane Change from here goes across, not back
			buggy.set({ slot: slot(ENEMY_INSIDE, AHEAD) });
			expect(battle.getIntents(buggy)).toEqual([]);

			playPlans(battle, 1);
			expect(fizzles(battle)).toEqual(["Buggy's Lane Change fizzles: enemy inside, center is no longer beside Buggy"]);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, AHEAD));
		});

		test('fizzles when its slot is taken, and does nothing else either (call 333)', () => {
			const blocker = createVehicle('Blocker', 3, slot(ENEMY_INSIDE, BEHIND));
			battle = build([buggy, blocker]);
			giveHand(buggy, [floorIt()]);
			giveHand(blocker, []);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].destination).toEqual(slot(ENEMY_OUTSIDE, AHEAD));
			const speed = buggy.speed;

			blocker.set({ slot: slot(ENEMY_OUTSIDE, AHEAD) });
			expect(battle.getIntents(buggy)).toEqual([]);

			playPlans(battle, 1);
			expect(fizzles(battle)).toEqual(["Buggy's Floor It fizzles: enemy outside, ahead is taken by Blocker"]);
			expect(buggy.slot).toEqual(slot(ENEMY_OUTSIDE, CENTER));
			expect(buggy.hasStatusEffect('speed_boost')).toBe(false);
			expect(buggy.speed).toBe(speed);
		});

		test('a Strafe whose slot is taken fizzles, swerve and shot both', () => {
			sharpshooter(buggy);
			giveHand(buggy, [strafe()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].destination).toEqual(slot(ENEMY_INSIDE, CENTER));

			battle.enemyTeam.addVehicle(createVehicle('Blocker', 3, slot(ENEMY_INSIDE, CENTER)));
			expect(battle.getIntents(buggy)).toEqual([]);

			playPlans(battle, 1);
			expect(fizzles(battle)).toEqual(["Buggy's Strafe fizzles: enemy inside, center is taken by Blocker"]);
			expect(buggy.slot).toEqual(slot(ENEMY_OUTSIDE, CENTER));
			expect(rig.structure).toBe(20);
		});

		test('a fizzled Hard Brake gains no Shield', () => {
			giveHand(buggy, [hardBrake()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].destination).toEqual(slot(ENEMY_OUTSIDE, BEHIND));

			buggy.set({ slot: slot(ENEMY_INSIDE, CENTER) });
			playPlans(battle, 1);
			expect(fizzles(battle)).toEqual(["Buggy's Hard Brake fizzles: enemy outside, behind is not next to Buggy"]);
			expect(buggy.shield ?? 0).toBe(0);
		});

		test('a picked swerve fizzles once its slot isn\'t next to the raider, and draws nothing', () => {
			giveHand(buggy, [juke(), pointBlank()]);
			driverOf(buggy).deck?.addCards([pointBlank(), pointBlank()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].destination).toEqual(slot(ENEMY_INSIDE, CENTER));

			buggy.set({ slot: slot(ENEMY_OUTSIDE, AHEAD) });
			playPlans(battle, 2);
			expect(fizzles(battle)[0]).toBe("Buggy's Juke fizzles: enemy inside, center is not next to Buggy");
			expect(driverOf(buggy).deck?.cards).toHaveLength(2);
			expect(buggy.slot).toEqual(slot(ENEMY_OUTSIDE, AHEAD));
		});

		test('a picked swerve still plays while its slot is next to the raider and empty', () => {
			giveHand(buggy, [juke(), pointBlank()]);
			battle.planEnemyTurn();

			// Shoved a row ahead in the inside lane: the planned slot is right behind it
			buggy.set({ slot: slot(ENEMY_INSIDE, AHEAD) });
			expect(battle.getIntents(buggy)).toHaveLength(2);

			playPlans(battle, 2);
			expect(fizzles(battle)).toEqual([]);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, CENTER));
			// A vehicle hit splits between structure and whoever is aboard
			expect(rig.structure).toBeLessThan(20);
		});

		test('the shot after a fizzled swerve plays from where the raider really is', () => {
			giveHand(buggy, [pointBlank(), laneChange()]);
			battle.planEnemyTurn();

			// Shoved into its own planned slot: no swerve, but the Rig is in range
			buggy.set({ slot: slot(ENEMY_INSIDE, CENTER) });
			expect(battle.getIntents(buggy).map(intent => intent.description)).toEqual(['Point Blank']);

			expect(playPlans(battle, 2).map(step => step.outcome)).toEqual(['fizzled', 'played']);
			expect(fizzles(battle)).toEqual(["Buggy's Lane Change fizzles: Buggy is already in enemy inside, center"]);
			// A vehicle hit splits between structure and whoever is aboard
			expect(rig.structure).toBeLessThan(20);
		});

		test('a swerve whose slot still stands plays and moves the raider', () => {
			giveHand(buggy, [pointBlank(), laneChange()]);
			battle.planEnemyTurn();

			playPlans(battle, 2);
			expect(fizzles(battle)).toEqual([]);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, CENTER));
			expect(rig.structure).toBeLessThan(20);
		});
	});

	describe('the move intent (call 288)', () => {
		test('a swerve with nothing stronger is a move intent naming where it lands', () => {
			giveHand(buggy, [laneChange()]);
			battle.planEnemyTurn();

			expect(battle.getIntents(buggy)).toEqual([{
				type: IntentType.MOVE,
				amount: null,
				hits: 1,
				label: null,
				target: null,
				destination: slot(ENEMY_INSIDE, CENTER),
				description: 'Lane Change'
			}]);
		});

		test.each([
			['Floor It', floorIt, 'speed_boost'],
			['Juke', juke, 'draw']
		])('%s is a move intent labelled with what else it does', (_, make, label) => {
			giveHand(buggy, [make()]);
			battle.planEnemyTurn();

			const [intent] = battle.getIntents(buggy);
			expect(intent.type).toBe(IntentType.MOVE);
			expect(intent.label).toBe(label);
			expect(intent.destination).not.toBeNull();
		});

		test('a swerve that attacks or defends keeps that type and still names where it lands (call 331)', () => {
			sharpshooter(buggy);
			useAggressive(battle);
			giveHand(buggy, [strafe()]);
			battle.planEnemyTurn();
			expect(battle.getIntents(buggy)).toEqual([expect.objectContaining({
				type: IntentType.ATTACK,
				amount: 4,
				target: rig.id,
				destination: slot(ENEMY_INSIDE, CENTER)
			})]);

			giveHand(buggy, [hardBrake()]);
			battle.planEnemyTurn();
			expect(battle.getIntents(buggy)).toEqual([expect.objectContaining({
				type: IntentType.DEFEND,
				amount: 4,
				destination: slot(ENEMY_OUTSIDE, BEHIND)
			})]);

			// Cut Off from the inside lane, behind, lines up the Rig from the row ahead
			buggy.set({ slot: slot(ENEMY_INSIDE, BEHIND) });
			giveHand(buggy, [cutOff()]);
			battle.planEnemyTurn();
			expect(battle.getIntents(buggy)).toEqual([expect.objectContaining({
				type: IntentType.DEBUFF,
				label: 'vulnerable',
				target: rig.id,
				destination: slot(ENEMY_INSIDE, CENTER)
			})]);
		});

		test('an elite hides the card and its label but not where it goes (call 332)', () => {
			buggy.intentTier = IntentTier.ELITE;
			giveHand(buggy, [floorIt()]);
			battle.planEnemyTurn();

			expect(battle.getIntents(buggy)).toEqual([expect.objectContaining({
				type: IntentType.MOVE,
				label: null,
				description: '???',
				destination: slot(ENEMY_OUTSIDE, AHEAD)
			})]);
		});

		test('a flank is still a buff labelled flank, with no destination, and a swerve is never labelled flank', () => {
			giveHand(buggy, [flank()]);
			battle.planEnemyTurn();
			expect(battle.getIntents(buggy)).toEqual([expect.objectContaining({ type: IntentType.BUFF, label: 'flank', destination: null })]);

			expect(buffLabelOf(floorIt())).toBe('speed_boost');
			expect(buffLabelOf(laneChange())).toBeNull();
			expect(intentTypeOf(laneChange())).toBe(IntentType.MOVE);
		});
	});
});
