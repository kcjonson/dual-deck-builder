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

const pointBlank = () => card('Point Blank', 'enemy_single', [{ type: 'damage', value: 4, range: 1, always_hits: true }]);
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
		// Regression guard; passed before DDB-96
		test('a wreck still on the road is not planned against', () => {
			wreck(battle.playerTeam, rig);
			giveHand(driverOf(buggy), [farShot()]);

			battle.planEnemyTurn();

			expect(battle.getPlan(buggy).map(action => action.target)).toEqual([bike]);
		});

		test('the player cannot target a wreck either, and the card stays where it was', () => {
			wreck(battle.enemyTeam, buggy);
			const hand = [armorUp(), farShot(), armorUp()];
			giveHand(bikeDriver, [...hand]);

			expect(battle.playCard({ driver: bikeDriver, cardIndex: 1, targetVehicle: buggy })).toBe(false);
			expect(bikeDriver.hand).toEqual(hand);
			expect(bikeDriver.discard).toEqual([]);
			expect(bikeDriver.adrenaline).toBe(5);
		});

		test('a target out of range is refused without spending the card', () => {
			const hand = [armorUp(), pointBlank(), armorUp()];
			giveHand(bikeDriver, [...hand]);

			// Bike (inside, behind) to Buggy (enemy inside, center) is range 2
			expect(battle.playCard({ driver: bikeDriver, cardIndex: 1, targetVehicle: buggy })).toBe(false);
			expect(bikeDriver.hand).toEqual(hand);
			expect(bikeDriver.discard).toEqual([]);
			expect(bikeDriver.adrenaline).toBe(5);
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

describe('Driver death', () => {
	// Same road as above: Rig and Bike for the player, Buggy and Hauler for the raiders
	let rig: Vehicle;
	let bike: Vehicle;
	let buggy: Vehicle;
	let hauler: Vehicle;
	let rigDriver: Driver;
	let bikeDriver: Driver;
	let buggyDriver: Driver;
	let haulerDriver: Driver;
	let battle: Battle;

	const berserk = () => card('Berserk', 'self', [{ type: 'damage', value: 10, target: 'self_driver', always_hits: true }]);
	const messages = () => battle.getMessages().map(m => m.message);

	beforeEach(() => {
		rig = createVehicle('Rig', 1);
		bike = createVehicle('Bike', 5);
		buggy = createVehicle('Buggy', 3);
		hauler = createVehicle('Hauler', 2);
		rigDriver = driverOf(rig);
		bikeDriver = driverOf(bike);
		buggyDriver = driverOf(buggy);
		haulerDriver = driverOf(hauler);
		battle = createBattle([rig, bike], [buggy, hauler]);
	});

	describe('the passenger takes the wheel', () => {
		test('a survivor riding behind a driver killed by Headshot drives on and can attack (the DDB-156 soft lock)', async () => {
			wreck(battle.playerTeam, rig);
			expect(bike.passenger).toBe(rigDriver);

			bikeDriver.set({ hitpoints: 5 });
			giveHand(buggyDriver, [headshot()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].target).toBe(bike);

			await battle.endPlayerTurn();

			expect(bikeDriver.isAlive()).toBe(false);
			expect(bike.driver).toBe(rigDriver);
			expect(bike.passenger).toBeNull();
			expect(rigDriver.role).toBe(DriverRole.ACTIVE);
			expect(battle.battleOver).toBe(false);
			expect(battle.isPlayerTurn).toBe(true);
			expect(messages()).toContain('Player2 Bike Driver is dead');
			expect(messages()).toContain('Player1 Rig Driver takes the wheel of Bike');

			giveHand(rigDriver, [farShot()]);
			expect(battle.playCard({ driver: rigDriver, cardIndex: 0, targetVehicle: buggy })).toBe(true);
			expect(buggy.structure).toBe(18);
		});

		test('a driver killed by vehicle damage hands the wheel to the living passenger', () => {
			wreck(battle.playerTeam, rig);
			bikeDriver.set({ hitpoints: 2 });

			bike.takeDamage(4);

			expect(bike.driver).toBe(rigDriver);
			expect(bike.passenger).toBeNull();
			expect(rigDriver.role).toBe(DriverRole.ACTIVE);
		});

		test('a raider whose driver dies drops its plan, and its passenger drives from then on', async () => {
			battle = createBattle([rig, bike], [buggy, hauler, createVehicle('Tanker', 1)]);
			wreck(battle.enemyTeam, hauler);
			expect(buggy.passenger).toBe(haulerDriver);
			buggyDriver.set({ hitpoints: 5 });
			giveHand(buggyDriver, [farShot()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)).toHaveLength(1);

			giveHand(bikeDriver, [headshot()]);
			battle.playCard({ driver: bikeDriver, cardIndex: 0, targetVehicle: buggy });
			expect(buggy.driver).toBe(haulerDriver);

			const rigStructure = rig.structure;
			const bikeStructure = bike.structure;
			await battle.endPlayerTurn();

			expect(messages()).toContain('Buggy lost its driver and drops its plan');
			expect(rig.structure).toBe(rigStructure);
			expect(bike.structure).toBe(bikeStructure);
			expect(battle.enemyTeam.vehicles).toContain(buggy);
		});
	});

	describe('only the living take a seat', () => {
		test('a dead passenger is never promoted', () => {
			wreck(battle.playerTeam, rig);
			rigDriver.set({ hitpoints: 0 });
			bikeDriver.set({ hitpoints: 0 });

			bike.handleDriverDeath();

			expect(bike.driver).toBeNull();
			expect(bike.passenger).toBeNull();
		});

		test('a wreck survivor is not seated behind a dead driver, and crashes out', () => {
			bikeDriver.set({ hitpoints: 0 });

			wreck(battle.playerTeam, rig);

			expect(bike.passenger).toBeNull();
			expect(battle.playerTeam.isDefeated()).toBe(true);
		});

		test('a wreck survivor is not seated in a vehicle with nobody aboard', () => {
			bikeDriver.set({ hitpoints: 2 });
			bike.takeDamage(4);
			expect(bike.driver).toBeNull();

			wreck(battle.playerTeam, rig);

			expect(bike.passenger).toBeNull();
			expect(battle.playerTeam.isDefeated()).toBe(true);
		});
	});

	describe('a vehicle with nobody alive aboard', () => {
		test('a raider killed by Headshot with no passenger is out of the fight and leaves the road at the end of the turn', async () => {
			giveHand(buggyDriver, [farShot()]);
			battle.planEnemyTurn();
			buggyDriver.set({ hitpoints: 5 });
			giveHand(bikeDriver, [headshot(), farShot()]);

			battle.playCard({ driver: bikeDriver, cardIndex: 0, targetVehicle: buggy });

			expect(buggy.isAlive()).toBe(true);
			expect(buggy.driver).toBeNull();
			expect(messages()).toContain('Buggy has nobody aboard and is out of the fight');
			expect(battle.battleOver).toBe(false);

			// Not a legal target while it waits to leave, and the card stays in hand
			expect(battle.playCard({ driver: bikeDriver, cardIndex: 0, targetVehicle: buggy })).toBe(false);
			expect(bikeDriver.hand.map(c => c.name)).toEqual(['Far Shot']);

			await battle.endPlayerTurn();

			expect(messages()).toContain('Buggy lost its driver and drops its plan');
			expect(messages()).toContain('Buggy has nobody aboard and leaves the road');
			expect(battle.enemyTeam.vehicles).toEqual([hauler]);
			expect(buggy.slot).toBeNull();
		});

		test('it does not keep the fight going: the player wins when the last raider driver dies', () => {
			battle = createBattle([rig, bike], [buggy]);
			buggyDriver.set({ hitpoints: 5 });
			giveHand(bikeDriver, [headshot()]);

			battle.playCard({ driver: bikeDriver, cardIndex: 0, targetVehicle: buggy });

			expect(buggy.isAlive()).toBe(true);
			expect(battle.battleOver).toBe(true);
			expect(battle.battleWon).toBe(true);
		});

		test('a player vehicle whose driver dies alone leaves the road, and the partner fights on', async () => {
			rigDriver.set({ hitpoints: 5 });
			giveHand(buggyDriver, [headshot()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].target).toBe(rig);

			await battle.endPlayerTurn();

			expect(messages()).toContain('Rig has nobody aboard and is out of the fight');
			expect(messages()).toContain('Rig has nobody aboard and leaves the road');
			expect(battle.battleOver).toBe(false);
			expect(battle.playerTeam.vehicles).toEqual([bike]);
			expect(rig.slot).toBeNull();
			expect(bike.driver).toBe(bikeDriver);
		});

		test('a planned attack on a vehicle emptied earlier in the enemy turn fizzles', async () => {
			rigDriver.set({ hitpoints: 5 });
			giveHand(buggyDriver, [headshot()]);
			giveHand(haulerDriver, [farShot()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].target).toBe(rig);
			expect(battle.getPlan(hauler)[0].target).toBe(rig);

			await battle.endPlayerTurn();

			expect(rig.structure).toBe(20);
			expect(messages()).toContain("Hauler's Far Shot fizzles: Rig has nobody aboard");
		});

		test('a driver who kills themself leaves their vehicle empty', () => {
			rigDriver.set({ hitpoints: 5 });
			giveHand(rigDriver, [berserk()]);

			battle.playCard({ driver: rigDriver, cardIndex: 0 });

			expect(rigDriver.isAlive()).toBe(false);
			expect(rig.driver).toBeNull();
			expect(battle.battleOver).toBe(false);
		});
	});

	describe('dead drivers sit out', () => {
		test('a dead driver neither draws nor refills at the start of the turn', async () => {
			bikeDriver.deck?.addCards([armorUp(), armorUp(), armorUp(), armorUp(), armorUp()]);
			rigDriver.deck?.addCards([armorUp(), armorUp(), armorUp(), armorUp(), armorUp()]);
			bikeDriver.set({ hitpoints: 0, adrenaline: 0 });

			await battle.endPlayerTurn();

			expect(battle.isPlayerTurn).toBe(true);
			expect(bikeDriver.hand).toEqual([]);
			expect(bikeDriver.adrenaline).toBe(0);
			expect(rigDriver.hand).toHaveLength(5);
			expect(rigDriver.adrenaline).toBe(rigDriver.maxAdrenaline);
		});

		test('a dead driver cannot play a card, and it stays in hand', () => {
			bikeDriver.set({ hitpoints: 0 });
			giveHand(bikeDriver, [armorUp()]);

			expect(battle.playCard({ driver: bikeDriver, cardIndex: 0 })).toBe(false);
			expect(bikeDriver.hand.map(c => c.name)).toEqual(['Armor Up']);
			expect(bikeDriver.adrenaline).toBe(5);
			expect(messages()).toContain('Cannot play card: Dead drivers cannot play cards');
		});

		test('a driver killed and taken out of their seat cannot play either', () => {
			bikeDriver.set({ hitpoints: 5 });
			giveHand(bikeDriver, [armorUp()]);

			bike.takeDamage(20);

			expect(bike.driver).toBeNull();
			expect(battle.playCard({ driver: bikeDriver, cardIndex: 0 })).toBe(false);
			expect(bikeDriver.hand.map(c => c.name)).toEqual(['Armor Up']);
			expect(messages()).toContain('Cannot play card: Dead drivers cannot play cards');
		});
	});

	describe('a stale plan follows whoever got out of the wreck', () => {
		beforeEach(() => {
			giveHand(haulerDriver, [farShot()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(hauler)[0].target).toBe(rig);
		});

		test('into the vehicle they were promoted to drive', async () => {
			wreck(battle.playerTeam, rig);
			bikeDriver.set({ hitpoints: 2 });
			bike.takeDamage(4);
			expect(bike.driver).toBe(rigDriver);

			await battle.endPlayerTurn();

			expect(bike.structure).toBe(16);
			expect(messages()).toContain('Rig is wrecked, so Hauler turns Far Shot on Bike');
		});

		test('even when the driver it was planned against died before the wreck', async () => {
			const stowaway = createTestDriver('Stowaway');
			stowaway.set({ hitpoints: 100, maxHitpoints: 100, role: DriverRole.PASSENGER });
			rig.set({ passenger: stowaway });
			rigDriver.set({ hitpoints: 2 });
			rig.takeDamage(4);
			expect(rig.driver).toBe(stowaway);

			wreck(battle.playerTeam, rig);
			expect(bike.passenger).toBe(stowaway);

			await battle.endPlayerTurn();

			expect(bike.structure).toBe(18);
			expect(messages()).toContain('Rig is wrecked, so Hauler turns Far Shot on Bike');
		});

		test('and fizzles when everyone who got out crashed out', async () => {
			bikeDriver.set({ hitpoints: 2 });
			bike.takeDamage(4);
			wreck(battle.playerTeam, rig);
			expect(rigDriver.isAlive()).toBe(true);

			await battle.endPlayerTurn();

			expect(messages()).toContain("Hauler's Far Shot fizzles: Rig is wrecked and nobody who got out is still in the fight");
		});
	});

	describe('the player AI', () => {
		const emptyBuggy = () => {
			buggyDriver.set({ hitpoints: 5 });
			giveHand(bikeDriver, [headshot()]);
			battle.playCard({ driver: bikeDriver, cardIndex: 0, targetVehicle: buggy });
			expect(buggy.isUnmanned()).toBe(true);
			expect(battle.enemyTeam.vehicles).toContain(buggy);
		};

		test.each(['aggressive', 'random', 'salvage', 'ramming', 'defensive', 'balanced', 'mcts'] as const)(
			'%s AI never offers a vehicle with nobody aboard as a target',
			async (aiType) => {
				emptyBuggy();
				// Point Blank reaches only Buggy from Rig; Hauler is two away
				giveHand(rigDriver, [pointBlank()]);
				battle.aiController.setPlayerAI(aiType);

				const decision = await battle.aiController.getPlayerDecision();

				expect(decision?.target).not.toBe(buggy);
			}
		);

		test('stops playing cards the first time the battle refuses one', async () => {
			emptyBuggy();
			giveHand(rigDriver, [pointBlank()]);
			battle.aiController.setPlayerAI('aggressive');
			const refused = { type: 'playCard' as const, card: rigDriver.hand[0], driver: rigDriver, target: buggy };
			const decide = jest.spyOn(battle.aiController, 'getPlayerDecision').mockResolvedValue(refused);

			expect(await battle.aiController.executeAIDecision(refused, true)).toBe(false);
			await battle.aiController.playPlayerCards();

			expect(decide).toHaveBeenCalledTimes(1);
			expect(rigDriver.hand.map(c => c.name)).toEqual(['Point Blank']);
		});
	});

	describe('the battle log keeps seat names', () => {
		test('a driver riding on as a passenger keeps their Player number', () => {
			wreck(battle.playerTeam, rig);
			expect(battle.playerTeam.getAllDrivers()).toEqual([bikeDriver, rigDriver]);
			bike.set({ maxArmor: 10 });
			giveHand(rigDriver, [armorUp()]);

			battle.playCard({ driver: rigDriver, cardIndex: 0 });

			expect(messages()).toContain('Player1 Rig Driver plays Armor Up (Adrenaline: 5 -> 4)');
		});
	});
});
