import { Battle } from './Battle';
import { Card, CardData } from './Card';
import { Driver } from './Driver';
import { createEscort } from './Escort';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import cardsFile from '../data/cards.json';

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

const realCard = (type: string): Card => {
	const data = cardData.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data });
};

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });

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

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const giveHand = (vehicle: Vehicle, cards: Card[]): void => {
	driverOf(vehicle).set({ hand: cards, adrenaline: 5 });
};

const generalLines = (battle: Battle): string[] =>
	battle.getMessages().filter(message => message.type === 'general').map(message => message.message);

describe('Raider formation and stuns', () => {
	// Rig in player inside center, Bike in player inside behind
	let rig: Vehicle;
	let bike: Vehicle;

	beforeEach(() => {
		rig = createVehicle('Rig', 1);
		bike = createVehicle('Bike', 5);
	});

	const fight = (raiders: Vehicle[]): Battle => new Battle({
		playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, bike] }),
		enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: raiders })
	});

	describe('close-up', () => {
		test('fills the inside slot across from a driven vehicle with the nearest raider at the end of the enemy turn', () => {
			const ahead = createVehicle('Ahead', 3, slot(RoadLane.ENEMY_INSIDE, RoadRow.AHEAD));
			const outside = createVehicle('Outside', 3, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER));
			const battle = fight([ahead, outside]);

			battle.endPlayerTurn();

			// Center: Outside is 1 away, Ahead 1 away; inside before outside breaks the tie
			expect(ahead.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
			// Behind: Outside is now the only raider not across from a driven vehicle
			expect(outside.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.BEHIND));
			expect(generalLines(battle)).toEqual(expect.arrayContaining([
				'Ahead closes up to enemy inside, center',
				'Outside closes up to enemy inside, behind'
			]));
		});

		test('fills the slot a wreck left, so the raiders plan from it', () => {
			const center = createVehicle('Center', 3);
			const behind = createVehicle('Behind', 3);
			const reserve = createVehicle('Reserve', 3, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
			const battle = fight([center, behind, reserve]);
			center.structure = 0;

			battle.endPlayerTurn();

			expect(center.slot).toBeNull();
			expect(reserve.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
			expect(behind.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.BEHIND));
		});

		test('never moves a flanker or takes its reserved slot', () => {
			const flanker = createVehicle('Flanker', 9);
			const other = createVehicle('Other', 3, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
			const battle = fight([flanker, other]);
			// Flanker opened inside center and outran the Rig onto the player's shoulder
			flanker.set({ slot: slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER), flank: { reservedSlot: slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER), outran: rig } });

			battle.endPlayerTurn();

			expect(flanker.slot).toEqual(slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER));
			// Center is reserved, so Other takes behind instead
			expect(other.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.BEHIND));
		});

		test('never moves an ambusher, which has no slot of its own to leave', () => {
			const ambusher = createVehicle('Ambusher', 3, slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER));
			const battle = fight([ambusher]);

			battle.endPlayerTurn();

			expect(ambusher.slot).toEqual(slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER));
			expect(generalLines(battle).some(line => line.includes('closes up'))).toBe(false);
		});

		test('fills Driver 1\'s row first when one raider is nearest to both', () => {
			rig = createVehicle('Rig', 1, slot(RoadLane.PLAYER_INSIDE, RoadRow.AHEAD));
			bike = createVehicle('Bike', 5, slot(RoadLane.PLAYER_INSIDE, RoadRow.BEHIND));
			const raider = createVehicle('Raider', 3, slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
			const battle = fight([raider]);

			battle.endPlayerTurn();

			expect(raider.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.AHEAD));
		});

		test('ignores a driven vehicle that carried on as an escort when its driver died', () => {
			const raider = createVehicle('Raider', 3, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER));
			const behind = createVehicle('Behind', 3);
			const battle = fight([raider, behind]);
			// Behind opens inside center, across the Rig; the Rig's driver dies, so center is nobody's row
			driverOf(rig).set({ hitpoints: 0 });
			battle.playerTeam.handleDriverDeath(rig);
			expect(rig.isEscort).toBe(true);
			behind.set({ slot: slot(RoadLane.ENEMY_INSIDE, RoadRow.AHEAD) });

			battle.endPlayerTurn();

			// Only the Bike's row, behind, pulls a raider in (the two tie, inside first); the Rig's center stays empty
			expect([raider.slot, behind.slot]).toEqual([slot(RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER), slot(RoadLane.ENEMY_INSIDE, RoadRow.BEHIND)]);
		});

		test('lets the raider plan from the slot it closed up to', () => {
			const raider = createVehicle('Raider', 3, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
			const center = createVehicle('Center', 3);
			const battle = fight([center, raider]);

			battle.endPlayerTurn();
			expect(raider.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.BEHIND));
			giveHand(raider, [realCard('point_blank')]);
			battle.planEnemyTurn();

			expect(battle.getIntents(raider)).toEqual([expect.objectContaining({ target: bike.id, amount: 3 })]);
		});

		test('leaves a raider already across from a driven vehicle where it is', () => {
			const center = createVehicle('Center', 3);
			const battle = fight([center]);

			battle.endPlayerTurn();

			// Behind stays empty: the only raider holds center
			expect(center.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
			expect(generalLines(battle).some(line => line.includes('closes up'))).toBe(false);
		});

		test("ignores an escort, which isn't a driven vehicle", () => {
			const escort = createEscort({ type: 'outrider' });
			escort.slot = slot(RoadLane.PLAYER_INSIDE, RoadRow.AHEAD);
			const raider = createVehicle('Raider', 3, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
			const center = createVehicle('Center', 3);
			const behind = createVehicle('Behind', 3);
			const battle = new Battle({
				playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, bike, escort] }),
				enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [center, behind, raider] })
			});

			battle.endPlayerTurn();

			expect(raider.slot).toEqual(slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
		});
	});

	describe('shake-off', () => {
		let buggy: Vehicle;
		let battle: Battle;

		const playEmp = (): boolean => {
			giveHand(bike, [realCard('emp_blast')]);
			return battle.playCard({ driver: driverOf(bike), cardIndex: 0 });
		};

		beforeEach(() => {
			buggy = createVehicle('Buggy', 3);
			battle = fight([buggy]);
			battle.start();
		});

		test('a raider stunned last enemy turn is steady through the player turn after', () => {
			expect(playEmp()).toBe(true);
			expect(buggy.isStunned).toBe(true);
			battle.endPlayerTurn();

			expect(buggy.isStunned).toBe(false);
			expect(buggy.isSteady).toBe(true);
		});

		test('an EMP Blast played while steady passes it by, and its intents stay up', () => {
			playEmp();
			battle.endPlayerTurn();
			giveHand(buggy, [realCard('precision_shot')]);
			battle.planEnemyTurn();
			const intents = battle.getIntents(buggy);
			expect(intents).toHaveLength(1);

			expect(playEmp()).toBe(true);

			expect(buggy.isStunned).toBe(false);
			expect(battle.getIntents(buggy)).toEqual(intents);
			expect(generalLines(battle)).toContain('Buggy is steady and shakes off EMP Blast');
		});

		test('steady wears off at the next player turn, so a third EMP stuns again', () => {
			playEmp();
			battle.endPlayerTurn();
			playEmp();
			battle.endPlayerTurn();

			expect(buggy.isSteady).toBe(false);
			expect(playEmp()).toBe(true);
			expect(buggy.isStunned).toBe(true);
		});
	});
});
