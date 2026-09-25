import { Battle } from './Battle';
import { Card, CardEffect, TargetType } from './Card';
import { Driver, DriverRole } from './Driver';
import { RoadLane, RoadRow } from './Road';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';

// Total speed is baseSpeed plus the test driver's 50. Drivers get enough
// hitpoints to walk away from a wreck.
const createVehicle = (name: string, baseSpeed: number): Vehicle => {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({ hitpoints: 100, maxHitpoints: 100 });
	return new Vehicle({
		name,
		armor: 0,
		maxArmor: 0,
		structure: 20,
		maxStructure: 20,
		speed: baseSpeed,
		baseSpeed,
		slot: null,
		flank: null,
		velocity: 0,
		driver,
		passenger: null,
		statusEffects: []
	});
};

const createBattle = (playerVehicles: Vehicle[], enemyVehicles: Vehicle[]): Battle => new Battle({
	playerTeam: new Team({ type: TeamType.PLAYER, vehicles: playerVehicles }),
	enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: enemyVehicles })
});

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

const farShot = () => card('Far Shot', 'enemy_single', [{ type: 'damage', value: 4, range: 2, always_hits: true }]);
const bigHit = () => card('Big Hit', 'enemy_single', [{ type: 'damage', value: 40, always_hits: true }]);
const headshot = () => card('Headshot', 'enemy_single', [{ type: 'damage', value: 10, target: 'driver', always_hits: true }]);
const armorUp = () => card('Armor Up', 'self', [{ type: 'gain_armor', value: 3, target: 'self' }]);

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const giveHand = (driver: Driver, cards: Card[]): void => {
	driver.set({ hand: cards, adrenaline: 5 });
};

/** What the damage path does when a hit takes a vehicle's structure to zero. */
const wreck = (team: Team, vehicle: Vehicle): void => {
	vehicle.takeDamage(vehicle.armor + vehicle.structure * 2);
	team.handleVehicleDestruction(vehicle);
};

describe('Wrecks and passengers', () => {
	// Rig 51 in player inside center, Bike 55 in player inside behind,
	// Buggy 53 in enemy inside center, Hauler 52 in enemy inside behind.
	let rig: Vehicle;
	let bike: Vehicle;
	let buggy: Vehicle;
	let hauler: Vehicle;
	let rigDriver: Driver;
	let bikeDriver: Driver;
	let battle: Battle;

	beforeEach(() => {
		rig = createVehicle('Rig', 1);
		bike = createVehicle('Bike', 5);
		buggy = createVehicle('Buggy', 3);
		hauler = createVehicle('Hauler', 2);
		rigDriver = driverOf(rig);
		bikeDriver = driverOf(bike);
		battle = createBattle([rig, bike], [buggy, hauler]);
	});

	describe('a vehicle wrecked mid-fight', () => {
		test('its driver rides on in the other vehicle as a passenger, keeping hand, discard, and adrenaline', () => {
			const hand = [armorUp(), farShot()];
			const discard = [armorUp()];
			rigDriver.set({ hand, discard, adrenaline: 3 });

			wreck(battle.playerTeam, rig);

			expect(bike.driver).toBe(bikeDriver);
			expect(bike.passenger).toBe(rigDriver);
			expect(rigDriver.role).toBe(DriverRole.PASSENGER);
			expect(rigDriver.hand).toEqual(hand);
			expect(rigDriver.discard).toEqual(discard);
			expect(rigDriver.adrenaline).toBe(3);
			expect(battle.playerTeam.getAllDrivers()).toEqual(expect.arrayContaining([rigDriver, bikeDriver]));
		});

		test('the passenger can play support cards but not attacks', () => {
			wreck(battle.playerTeam, rig);
			bike.set({ maxArmor: 10 });
			giveHand(rigDriver, [farShot(), armorUp()]);

			expect(battle.playCard({ driver: rigDriver, cardIndex: 0, targetVehicle: buggy })).toBe(false);
			expect(rigDriver.hand.map(c => c.name)).toEqual(['Far Shot', 'Armor Up']);

			expect(battle.playCard({ driver: rigDriver, cardIndex: 1 })).toBe(true);
			expect(bike.armor).toBe(3);
		});

		test('the passenger draws and refills next turn', async () => {
			rigDriver.deck?.addCards([armorUp(), armorUp(), armorUp(), armorUp(), armorUp(), armorUp()]);
			giveHand(driverOf(buggy), [bigHit()]);
			battle.planEnemyTurn();

			await battle.endPlayerTurn();

			expect(battle.isPlayerTurn).toBe(true);
			expect(bike.passenger).toBe(rigDriver);
			expect(rigDriver.hand).toHaveLength(5);
			expect(rigDriver.adrenaline).toBe(rigDriver.maxAdrenaline);
		});

		test('a driver who dies in the wreck does not ride on', () => {
			rigDriver.set({ hitpoints: 5 });

			wreck(battle.playerTeam, rig);

			expect(bike.passenger).toBeNull();
			expect(battle.playerTeam.getAllDrivers()).toEqual([bikeDriver]);
		});

		test('both occupants of a wreck look for a seat, one per vehicle', () => {
			const tanker = createVehicle('Tanker', 1);
			const buggyDriver = driverOf(buggy);
			const haulerDriver = driverOf(hauler);
			battle = createBattle([rig, bike], [buggy, hauler, tanker]);

			wreck(battle.enemyTeam, buggy);
			expect(hauler.passenger).toBe(buggyDriver);

			wreck(battle.enemyTeam, hauler);

			// Tanker has the only free seat, and Hauler's driver takes it
			expect(tanker.passenger).toBe(haulerDriver);
			expect(battle.enemyTeam.getAllDrivers()).not.toContain(buggyDriver);
		});
	});

	describe('the wreck leaves the road at the end of the turn it dies in', () => {
		test('a raider wrecked in the player turn holds its slot until the player turn ends', async () => {
			giveHand(bikeDriver, [bigHit()]);
			battle.playCard({ driver: bikeDriver, cardIndex: 0, targetVehicle: buggy });

			expect(buggy.isAlive()).toBe(false);
			expect(battle.enemyTeam.vehicles).toContain(buggy);
			expect(buggy.slot).toEqual({ lane: RoadLane.ENEMY_INSIDE, row: RoadRow.CENTER });

			await battle.endPlayerTurn();

			expect(battle.enemyTeam.vehicles).toEqual([hauler]);
			expect(buggy.slot).toBeNull();
		});

		test('a player vehicle wrecked in the enemy turn is gone when the player turn starts', async () => {
			giveHand(driverOf(buggy), [bigHit()]);
			battle.planEnemyTurn();

			await battle.endPlayerTurn();

			expect(rig.isAlive()).toBe(false);
			expect(battle.playerTeam.vehicles).toEqual([bike]);
			expect(rig.slot).toBeNull();
			expect(battle.getMessages().map(m => m.message)).toContain('Rig is wrecked and leaves the road');
		});

		test('a wrecked flanker frees its shoulder slot and its reservation', async () => {
			// Raiders only move on their own turn, so put Buggy on the shoulder by hand
			buggy.set({
				slot: { lane: RoadLane.PLAYER_SHOULDER, row: RoadRow.CENTER },
				flank: { reservedSlot: { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.CENTER }, outran: rig }
			});
			giveHand(bikeDriver, [bigHit()]);
			battle.playCard({ driver: bikeDriver, cardIndex: 0, targetVehicle: buggy });

			expect(battle.getFlankBlocker(hauler, rig)).toBe('player shoulder, center is taken');

			await battle.endPlayerTurn();

			expect(buggy.flank).toBeNull();
			expect(battle.getFlankBlocker(hauler, rig)).toBeNull();
		});
	});

	describe('enemies never target a wreck', () => {
		test('a wreck still on the road is not planned against', () => {
			wreck(battle.playerTeam, rig);
			giveHand(driverOf(buggy), [farShot()]);

			battle.planEnemyTurn();

			expect(battle.getPlan(buggy).map(action => action.target)).toEqual([bike]);
		});

		test('the player cannot target a wreck either', () => {
			wreck(battle.enemyTeam, buggy);
			giveHand(bikeDriver, [farShot()]);

			expect(battle.playCard({ driver: bikeDriver, cardIndex: 0, targetVehicle: buggy })).toBe(false);
		});

		test('a plan aimed at a vehicle cleared before the enemy turn follows its driver', async () => {
			giveHand(driverOf(hauler), [farShot()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(hauler)[0].target).toBe(rig);

			wreck(battle.playerTeam, rig);
			await battle.endPlayerTurn();

			expect(bike.structure).toBe(18);
			expect(battle.getMessages().map(m => m.message)).toContain('Rig is wrecked, so Hauler turns Far Shot on Bike');
		});
	});

	describe('the fight ends when all of a team\'s drivers are dead', () => {
		test('the player loses when the last driver dies, with vehicles still running', async () => {
			bikeDriver.set({ hitpoints: 0 });
			rigDriver.set({ hitpoints: 5 });
			giveHand(driverOf(buggy), [headshot()]);
			battle.planEnemyTurn();

			await battle.endPlayerTurn();

			expect(rig.isAlive()).toBe(true);
			expect(battle.battleOver).toBe(true);
			expect(battle.battleWon).toBe(false);
		});

		test('the player loses when both vehicles are wrecked in one enemy turn', async () => {
			giveHand(driverOf(buggy), [bigHit()]);
			giveHand(driverOf(hauler), [bigHit()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(hauler)[0].target).toBe(rig);

			await battle.endPlayerTurn();

			expect(rig.isAlive()).toBe(false);
			expect(bike.isAlive()).toBe(false);
			expect(battle.battleOver).toBe(true);
			expect(battle.battleWon).toBe(false);
		});

		test('the player wins when the last raider driver is gone', () => {
			battle = createBattle([rig, bike], [buggy]);
			giveHand(bikeDriver, [bigHit()]);

			battle.playCard({ driver: bikeDriver, cardIndex: 0, targetVehicle: buggy });

			expect(battle.battleOver).toBe(true);
			expect(battle.battleWon).toBe(true);
		});
	});
});
