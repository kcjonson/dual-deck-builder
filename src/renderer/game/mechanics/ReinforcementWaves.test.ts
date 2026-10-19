import { Battle } from './Battle';
import { Card, CardData } from './Card';
import { Deck } from './Deck';
import { Driver } from './Driver';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { ReinforcementWave, Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { Rng } from '../core/Rng';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import cardsFile from '../data/cards.json';

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

const realCard = (type: string): Card => {
	const data = cardData.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data });
};

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });

const createVehicle = (name: string, startSlot: RoadSlot | null = null, structure = 20): Vehicle => {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({ hitpoints: 100, maxHitpoints: 100 });
	return new Vehicle({
		name,
		armor: 0,
		maxArmor: 0,
		structure,
		maxStructure: structure,
		baseSpeed: 3,
		slot: startSlot,
		flank: null,
		velocity: 0,
		driver,
		passenger: null,
		statusEffects: []
	});
};

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const giveHand = (vehicle: Vehicle, cards: Card[]): void => {
	driverOf(vehicle).set({ hand: cards, adrenaline: 5 });
};

/** A card that takes any raider's driver out, wherever it is */
const killShot = (): Card => new Card({
	type: 'kill_shot',
	name: 'Kill Shot',
	summary: 'Kill Shot',
	description: 'Kill Shot',
	rarity: 'common',
	cost: 0,
	targetType: 'enemy_single',
	effects: [{ type: 'damage', value: 500, target: 'driver', always_hits: true }],
	tags: []
});

const generalLines = (battle: Battle): string[] =>
	battle.getMessages().filter(message => message.type === 'general').map(message => message.message);

describe('Reinforcement waves', () => {
	let rig: Vehicle;
	let bike: Vehicle;

	beforeEach(() => {
		rig = createVehicle('Rig');
		bike = createVehicle('Bike');
	});

	const fight = ({ raiders, reinforcements, rng }: { raiders: Vehicle[]; reinforcements: ReinforcementWave[]; rng?: Rng }): Battle => new Battle({
		playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, bike] }),
		enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: raiders, reinforcements }),
		rng
	});

	const kill = (battle: Battle, raider: Vehicle): void => {
		giveHand(rig, [killShot()]);
		expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: raider })).toBe(true);
	};

	describe('an empty road', () => {
		test('isn\'t a win while a wave is queued: the wave is announced and pulls in at the end of the enemy turn', () => {
			const first = createVehicle('First');
			const second = createVehicle('Second');
			const battle = fight({ raiders: [first], reinforcements: [{ raiders: [second] }] });
			battle.start();
			expect(battle.waves).toEqual({ number: 1, total: 2, arriving: 0, rows: [] });

			kill(battle, first);

			expect(battle.battleOver).toBe(false);
			expect(battle.waves).toMatchObject({ number: 1, total: 2, arriving: 1 });
			battle.endPlayerTurn();

			expect(battle.enemyTeam.vehicles).toEqual([second]);
			expect(second.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
			expect(battle.waves).toEqual({ number: 2, total: 2, arriving: 0, rows: [] });
			expect(generalLines(battle)).toEqual(expect.arrayContaining(['1 raider arriving', 'Second pulls in to enemy inside, center']));
		});

		test('is a win once the queue is empty too', () => {
			const first = createVehicle('First');
			const second = createVehicle('Second');
			const battle = fight({ raiders: [first], reinforcements: [{ raiders: [second] }] });
			battle.start();
			kill(battle, first);
			battle.endPlayerTurn();

			kill(battle, second);

			expect(battle.battleOver).toBe(true);
			expect(battle.battleWon).toBe(true);
		});
	});

	describe('when a wave is due', () => {
		test('when the road thins to its arrival count, at the start of the player\'s turn', () => {
			const first = createVehicle('First');
			const second = createVehicle('Second');
			const queued = createVehicle('Queued');
			const battle = fight({ raiders: [first, second], reinforcements: [{ raiders: [queued], arriveAt: 1 }] });
			battle.start();
			expect(battle.waves.arriving).toBe(0);

			kill(battle, first);
			// Not until the next player turn starts
			expect(battle.waves.arriving).toBe(0);
			battle.endPlayerTurn();

			expect(queued.slot).toBeNull();
			expect(battle.waves).toMatchObject({ number: 1, arriving: 1 });
			battle.endPlayerTurn();
			expect(battle.enemyTeam.vehicles).toContain(queued);
		});

		test('when its turn count has passed since the fight began', () => {
			const first = createVehicle('First', null, 999);
			const queued = createVehicle('Queued');
			const battle = fight({ raiders: [first], reinforcements: [{ raiders: [queued], afterTurns: 2 }] });
			battle.start();
			battle.endPlayerTurn();
			expect(battle.turn).toBe(2);
			expect(battle.waves.arriving).toBe(0);

			battle.endPlayerTurn();

			expect(battle.turn).toBe(3);
			expect(battle.waves.arriving).toBe(1);
		});

		test('its turn count runs from when the last wave first played', () => {
			const first = createVehicle('First');
			const second = createVehicle('Second', null, 999);
			const third = createVehicle('Third');
			const battle = fight({ raiders: [first], reinforcements: [{ raiders: [second] }, { raiders: [third], afterTurns: 2 }] });
			battle.start();
			kill(battle, first);
			battle.endPlayerTurn();
			expect(battle.turn).toBe(2);

			battle.endPlayerTurn();
			expect(battle.waves.arriving).toBe(0);
			battle.endPlayerTurn();
			expect(battle.waves).toMatchObject({ number: 2, total: 3, arriving: 1 });
		});
	});

	describe('arrival', () => {
		test('fills the formation from the row the latest wreck left, and plans with everyone at the next player turn', () => {
			// Rig inside center, Bike inside behind; a raider across from each and one ahead
			const center = createVehicle('Center');
			const behind = createVehicle('Behind');
			const ahead = createVehicle('Ahead', slot(RoadLane.ENEMY_INSIDE, RoadRow.AHEAD));
			const queued = [createVehicle('Q1'), createVehicle('Q2')];
			const battle = fight({ raiders: [center, behind, ahead], reinforcements: [{ raiders: queued, arriveAt: 2 }] });
			battle.start();
			kill(battle, ahead);
			battle.endPlayerTurn();
			expect(battle.waves).toMatchObject({ arriving: 2, rows: [RoadRow.AHEAD] });
			queued.forEach(raider => driverOf(raider).deck?.addCards([realCard('precision_shot')]));

			battle.endPlayerTurn();

			expect(queued.map(raider => raider.slot)).toEqual([
				slot(RoadLane.ENEMY_INSIDE, RoadRow.AHEAD),
				slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD)
			]);
			expect(queued.every(raider => battle.getIntents(raider).length > 0)).toBe(true);
		});

		test('marks the rows arrivals will really take when a raider plans to flank this turn', () => {
			// Rig inside center, Bike inside behind; Flanker plans to outrun the Rig, which keeps its slot reserved
			const center = createVehicle('Center');
			const behind = createVehicle('Behind');
			const flanker = createVehicle('Flanker', slot(RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER));
			flanker.set({ baseSpeed: 9 });
			const queued = createVehicle('Queued');
			const battle = fight({ raiders: [center, behind, flanker], reinforcements: [{ raiders: [queued], arriveAt: 3 }] });
			battle.start();
			const flank = new Card({
				type: 'flank', name: 'Flank', summary: 'Flank', description: 'Flank', rarity: 'common', cost: 1,
				targetType: 'enemy_single', effects: [{ type: 'change_position', position: 'flanking', target: 'self' }], tags: []
			});
			giveHand(flanker, [flank]);
			driverOf(center).set({ hand: [] });
			driverOf(behind).set({ hand: [] });
			battle.planEnemyTurn();
			expect(battle.getPlan(flanker).map(action => action.card)).toEqual([flank]);
			kill(battle, behind);
			const marked = battle.waves.rows;

			battle.endPlayerTurn();

			expect(flanker.isFlanking).toBe(true);
			expect(queued.slot).not.toBeNull();
			expect(marked).toEqual([queued.slot?.row]);
		});

		test('lands the next wave at the end of an enemy turn that empties the road itself', () => {
			const first = createVehicle('First');
			driverOf(first).set({ hitpoints: 3, maxHitpoints: 3 });
			const queued = createVehicle('Queued');
			const battle = fight({ raiders: [first], reinforcements: [{ raiders: [queued] }] });
			battle.start();
			// Berserker costs its own driver 3 HP
			giveHand(first, [realCard('berserker')]);
			battle.planEnemyTurn();

			battle.endPlayerTurn();

			expect(first.isOutOfFight).toBe(true);
			expect(battle.battleOver).toBe(false);
			expect(battle.enemyTeam.vehicles).toEqual([queued]);
			expect(generalLines(battle)).toContain('1 raider arriving');
		});

		test('lands only what fits under the road cap, says so, and keeps the rest due', () => {
			const raiders = ['A', 'B'].map(name => createVehicle(name));
			const queued = ['Q1', 'Q2', 'Q3'].map(name => createVehicle(name));
			const battle = fight({ raiders, reinforcements: [{ raiders: queued, arriveAt: 2, maxOnRoad: 3 }] });
			battle.start();
			expect(battle.waves).toMatchObject({ arriving: 1 });
			expect(generalLines(battle)).toContain('1 raider arriving');

			battle.endPlayerTurn();

			expect(queued.map(raider => raider.slot !== null)).toEqual([true, false, false]);
			expect(battle.queuedRaiders).toEqual([queued[1], queued[2]]);
			expect(battle.waves).toMatchObject({ number: 2, arriving: 0 });
			kill(battle, raiders[0]);
			expect(battle.waves).toMatchObject({ arriving: 1 });
		});

		test('leaves the rest queued, still due, when the formation is full', () => {
			const raiders = [
				...[RoadRow.CENTER, RoadRow.BEHIND, RoadRow.AHEAD].map(row => createVehicle(`In ${row}`, slot(RoadLane.ENEMY_INSIDE, row))),
				...[RoadRow.CENTER, RoadRow.BEHIND].map(row => createVehicle(`Out ${row}`, slot(RoadLane.ENEMY_OUTSIDE, row)))
			];
			const queued = [createVehicle('Q1'), createVehicle('Q2')];
			const battle = fight({ raiders, reinforcements: [{ raiders: queued, arriveAt: 5 }] });
			battle.start();
			expect(battle.waves).toMatchObject({ arriving: 1, rows: [RoadRow.AHEAD] });

			battle.endPlayerTurn();

			expect(queued[0].slot).toEqual(slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
			expect(queued[1].slot).toBeNull();
			expect(battle.queuedRaiders).toEqual([queued[1]]);
			expect(battle.waves).toMatchObject({ number: 2, total: 2, arriving: 0, rows: [] });
		});

		test('isn\'t stunned by an EMP Blast played before it arrived', () => {
			const first = createVehicle('First');
			const queued = createVehicle('Queued');
			const battle = fight({ raiders: [first], reinforcements: [{ raiders: [queued], arriveAt: 1 }] });
			battle.start();
			giveHand(bike, [realCard('emp_blast')]);
			expect(battle.playCard({ driver: driverOf(bike), cardIndex: 0 })).toBe(true);

			battle.endPlayerTurn();
			expect(queued.isStunned).toBe(false);
			battle.endPlayerTurn();
			expect(queued.isStunned).toBe(false);
		});
	});

	describe('deck streams', () => {
		const deckOf = (prefix: string): Deck => new Deck(`${prefix}_deck`, prefix,
			['point_blank', 'precision_shot', 'ram', 'armor_plating', 'nitro_boost', 'far_shoot', 'repair_kit', 'ramming_speed'].map(realCard));

		const playToArrival = (withWave: boolean): { first: Vehicle; queued: Vehicle; firstHands: string[][] } => {
			rig = createVehicle('Rig');
			bike = createVehicle('Bike');
			const first = createVehicle('First', null, 999);
			const queued = createVehicle('Queued');
			driverOf(first).deck = deckOf('first');
			driverOf(queued).deck = deckOf('queued');
			const battle = fight({ raiders: [first], reinforcements: withWave ? [{ raiders: [queued], afterTurns: 1 }] : [], rng: new Rng({ seed: 7 }) });
			battle.start();
			const firstHands = [driverOf(first).hand.map(card => card.type)];
			for (let turn = 0; turn < 3; turn += 1) {
				battle.endPlayerTurn();
				firstHands.push(driverOf(first).hand.map(card => card.type));
			}
			return { first, queued, firstHands };
		};

		test('an arriving raider takes a new seat\'s stream, so the seats already in the fight draw the same', () => {
			expect(playToArrival(true).firstHands).toEqual(playToArrival(false).firstHands);
		});

		test('an arriving raider\'s deck is shuffled before its first draw, the same way from the same seed', () => {
			const { queued } = playToArrival(true);
			const drawn = driverOf(queued).hand.map(card => card.type);
			expect(drawn).toHaveLength(5);
			expect(drawn).not.toEqual(['point_blank', 'precision_shot', 'ram', 'armor_plating', 'nitro_boost']);
			expect(driverOf(playToArrival(true).queued).hand.map(card => card.type)).toEqual(drawn);
		});
	});
});
