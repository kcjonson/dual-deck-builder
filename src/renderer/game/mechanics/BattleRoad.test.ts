import { Battle } from './Battle';
import { Card } from './Card';
import { Driver } from './Driver';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });

// Total speed is baseSpeed plus the test driver's 50
const createVehicle = (name: string, baseSpeed: number, startSlot: RoadSlot | null = null): Vehicle => new Vehicle({
	name,
	armor: 0,
	maxArmor: 0,
	structure: 20,
	maxStructure: 20,
	speed: baseSpeed,
	baseSpeed,
	slot: startSlot,
	flank: null,
	velocity: 0,
	driver: createTestDriver(`${name} Driver`),
	passenger: null,
	statusEffects: []
});

const createBattle = (playerVehicles: Vehicle[], enemyVehicles: Vehicle[]): Battle => new Battle({
	playerTeam: new Team({ type: TeamType.PLAYER, vehicles: playerVehicles }),
	enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: enemyVehicles })
});

const flankCard = (): Card => new Card({
	type: 'flank',
	name: 'Flank',
	description: 'Outrun a slower enemy',
	rarity: 'common',
	cost: 1,
	targetType: 'enemy_single',
	effects: [{ type: 'change_position', position: 'flanking', target: 'self' }],
	tags: ['utility', 'positioning']
});

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const playFlank = (battle: Battle, flanker: Vehicle, target: Vehicle, card: Card = flankCard()): boolean => {
	const driver = driverOf(flanker);
	driver.hand = [card];
	driver.adrenaline = 5;
	return battle.playCard({ driver, cardIndex: 0, targetVehicle: target });
};

describe('Battle on the road grid', () => {
	describe('opening placement', () => {
		test('puts both player vehicles in the inside lane, center and behind', () => {
			const rig = createVehicle('Rig', 1);
			const bike = createVehicle('Bike', 5);
			createBattle([rig, bike], [createVehicle('Buggy', 3)]);

			expect(rig.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.CENTER));
			expect(bike.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.BEHIND));
		});

		test('fills the enemy formation inside first when the encounter gives no slots', () => {
			const raiders = [1, 2, 3, 4].map(n => createVehicle(`Raider ${n}`, 3));
			createBattle([createVehicle('Rig', 1), createVehicle('Bike', 5)], raiders);

			expect(raiders.map(v => v.slot)).toEqual([
				slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER),
				slot(RoadLane.ENEMY_INSIDE, RoadRow.BEHIND),
				slot(RoadLane.ENEMY_INSIDE, RoadRow.AHEAD),
				slot(RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER)
			]);
		});

		test('keeps slots the encounter gives and fills around them', () => {
			const scout = createVehicle('Scout', 4, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
			const hauler = createVehicle('Hauler', 2, slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
			const buggy = createVehicle('Buggy', 3);
			createBattle([createVehicle('Rig', 1), createVehicle('Bike', 5)], [scout, hauler, buggy]);

			expect(scout.slot).toEqual(slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
			expect(hauler.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
			expect(buggy.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.BEHIND));
		});

		test('rejects a seventh vehicle; a formation holds six', () => {
			const raiders = [1, 2, 3, 4, 5, 6, 7].map(n => createVehicle(`Raider ${n}`, 3));
			expect(() => createBattle([createVehicle('Rig', 1), createVehicle('Bike', 5)], raiders))
				.toThrow('a formation holds six');
		});
	});

	describe('one vehicle per slot', () => {
		test('two vehicles cannot start in the same slot', () => {
			const shared = slot(RoadLane.ENEMY_INSIDE, RoadRow.AHEAD);
			expect(() => createBattle(
				[createVehicle('Rig', 1), createVehicle('Bike', 5)],
				[createVehicle('Raider 1', 3, shared), createVehicle('Raider 2', 3, shared)]
			)).toThrow('Two vehicles start in');
		});

		test('a flanker cannot swerve into a shoulder slot that is taken', () => {
			const rig = createVehicle('Rig', 1);
			const bike = createVehicle('Bike', 5);
			const buggy = createVehicle('Buggy', 3, slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
			const crawler = createVehicle('Crawler', 0, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER));
			const battle = createBattle([rig, bike], [buggy, crawler]);

			// Rig outruns the crawler onto the center shoulder slot
			expect(playFlank(battle, rig, crawler)).toBe(true);
			// Bike outruns the buggy, same row, so the same shoulder slot
			expect(playFlank(battle, bike, buggy)).toBe(false);
			expect(bike.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.BEHIND));
		});
	});

	describe('own-shoulder rule', () => {
		test('a vehicle cannot start on its own shoulder', () => {
			expect(() => createBattle(
				[createVehicle('Rig', 1, slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER)), createVehicle('Bike', 5)],
				[createVehicle('Buggy', 3)]
			)).toThrow('must start in its own formation');
		});

		test("a vehicle cannot start on the other team's shoulder; only flanking gets it there", () => {
			expect(() => createBattle(
				[createVehicle('Rig', 1), createVehicle('Bike', 5)],
				[createVehicle('Buggy', 3, slot(RoadLane.ENEMY_SHOULDER, RoadRow.CENTER))]
			)).toThrow('must start in its own formation');
		});

		test("a vehicle cannot start in the other team's formation", () => {
			expect(() => createBattle(
				[createVehicle('Rig', 1, slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER)), createVehicle('Bike', 5)],
				[createVehicle('Buggy', 3)]
			)).toThrow('must start in its own formation');
		});

		test("player flankers land on the raiders' shoulder and raider flankers on yours", () => {
			const rig = createVehicle('Rig', 1);
			const bike = createVehicle('Bike', 5);
			const buggy = createVehicle('Buggy', 3);
			const battle = createBattle([rig, bike], [buggy]);

			expect(playFlank(battle, bike, buggy)).toBe(true);
			expect(bike.slot?.lane).toBe(RoadLane.ENEMY_SHOULDER);

			expect(battle.canFlank(buggy, rig)).toBe(true);
		});
	});

	describe('flanking', () => {
		let rig: Vehicle;
		let bike: Vehicle;
		let buggy: Vehicle;
		let hauler: Vehicle;
		let battle: Battle;

		beforeEach(() => {
			rig = createVehicle('Rig', 1);
			bike = createVehicle('Bike', 5);
			buggy = createVehicle('Buggy', 3, slot(RoadLane.ENEMY_INSIDE, RoadRow.AHEAD));
			hauler = createVehicle('Hauler', 2, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.BEHIND));
			battle = createBattle([rig, bike], [buggy, hauler]);
		});

		test('takes the row of the vehicle it outran', () => {
			expect(playFlank(battle, bike, buggy)).toBe(true);
			expect(bike.slot).toEqual(slot(RoadLane.ENEMY_SHOULDER, RoadRow.AHEAD));
			expect(bike.flank?.outran).toBe(buggy);
		});

		test('leaves its formation slot empty and reserved; nobody shifts', () => {
			playFlank(battle, bike, hauler);

			expect(bike.flank?.reservedSlot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.BEHIND));
			expect(rig.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.CENTER));
		});

		test('needs more speed than the vehicle it outruns', () => {
			// Rig 1 vs buggy 3
			expect(playFlank(battle, rig, buggy)).toBe(false);
			expect(rig.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.CENTER));
			expect(driverOf(rig).hand).toHaveLength(1);
		});

		test('can only outrun a vehicle in formation, not a flanker', () => {
			buggy.set({
				slot: slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER),
				flank: { reservedSlot: slot(RoadLane.ENEMY_INSIDE, RoadRow.AHEAD), outran: rig }
			});

			expect(battle.getFlankBlocker(bike, buggy)).toBe('Buggy is not in formation');
		});

		test('cannot target your own convoy', () => {
			expect(playFlank(battle, bike, rig)).toBe(false);
		});

		test('an existing flanker keeps its first reserved slot when it swerves again', () => {
			playFlank(battle, bike, buggy);
			playFlank(battle, bike, hauler);

			expect(bike.slot).toEqual(slot(RoadLane.ENEMY_SHOULDER, RoadRow.BEHIND));
			expect(bike.flank?.reservedSlot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.BEHIND));
			expect(bike.flank?.outran).toBe(hauler);
		});

		test('deals +50% damage', () => {
			playFlank(battle, bike, buggy);
			expect(battle.calculateDamage(10, bike, buggy)).toBe(15);
			expect(battle.calculateDamage(10, rig, buggy)).toBe(10);
		});

		test("Flanking Maneuver's bonus lands on the flanker, not the target", () => {
			const maneuver = new Card({
				type: 'flanking_maneuver',
				name: 'Flanking Maneuver',
				description: 'Outrun a slower enemy',
				rarity: 'uncommon',
				cost: 1,
				targetType: 'enemy_single',
				effects: [
					{ type: 'change_position', position: 'flanking', target: 'self' },
					{ type: 'apply_status', status: 'damage_bonus', value: 50, duration: 1, target: 'self' }
				],
				tags: ['utility', 'positioning', 'buff']
			});

			expect(playFlank(battle, bike, buggy, maneuver)).toBe(true);
			expect(bike.hasStatusEffect('damage_bonus')).toBe(true);
			expect(buggy.hasStatusEffect('damage_bonus')).toBe(false);
		});
	});

	describe('dropping back at the end of a turn', () => {
		let rig: Vehicle;
		let bike: Vehicle;
		let buggy: Vehicle;
		let battle: Battle;

		beforeEach(() => {
			rig = createVehicle('Rig', 1);
			bike = createVehicle('Bike', 5);
			buggy = createVehicle('Buggy', 3);
			battle = createBattle([rig, bike], [buggy]);
			playFlank(battle, bike, buggy);
		});

		test('a flanker no longer faster than the vehicle it outran returns to its reserved slot', async () => {
			bike.applyStatusEffect({ name: 'oil_slick', duration: 2, value: -4 });

			await battle.endPlayerTurn();

			expect(bike.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.BEHIND));
			expect(bike.flank).toBeNull();
			expect(bike.isFlanking).toBe(false);
		});

		test('a flanker still faster holds the shoulder', async () => {
			await battle.endPlayerTurn();

			expect(bike.slot).toEqual(slot(RoadLane.ENEMY_SHOULDER, RoadRow.CENTER));
		});

		test('a flanker whose outran vehicle is wrecked holds the shoulder', async () => {
			bike.applyStatusEffect({ name: 'oil_slick', duration: 2, value: -4 });
			buggy.structure = 0;

			await battle.endPlayerTurn();

			expect(bike.isFlanking).toBe(true);
		});
	});
});
