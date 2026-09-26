import { Battle } from './Battle';
import { Card, CardData } from './Card';
import { Driver, DriverRole } from './Driver';
import { EscortType, UNMANNED_CREW, createEscort } from './Escort';
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

const P_INSIDE = RoadLane.PLAYER_INSIDE;
const P_OUTSIDE = RoadLane.PLAYER_OUTSIDE;
const E_INSIDE = RoadLane.ENEMY_INSIDE;
const E_OUTSIDE = RoadLane.ENEMY_OUTSIDE;
const E_SHOULDER = RoadLane.ENEMY_SHOULDER;
const { AHEAD, CENTER, BEHIND } = RoadRow;

// Test drivers have ramming, gunnery, and evade 5 and speed 2. They get
// enough hitpoints here to walk away from a wreck.
const createDriven = (name: string, at: RoadSlot | null = null, baseSpeed = 2): Vehicle => {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({ hitpoints: 100, maxHitpoints: 100 });
	return new Vehicle({
		name,
		armor: 0,
		maxArmor: 0,
		structure: 20,
		maxStructure: 20,
		baseSpeed,
		slot: at,
		flank: null,
		velocity: 0,
		driver,
		passenger: null,
		statusEffects: []
	});
};

const escortAt = (type: EscortType, at: RoadSlot | null = null, setPiece = false): Vehicle => {
	const escort = createEscort({ type, setPiece });
	escort.slot = at;
	return escort;
};

const createBattle = (playerVehicles: Vehicle[], enemyVehicles: Vehicle[]): Battle => new Battle({
	playerTeam: new Team({ type: TeamType.PLAYER, vehicles: playerVehicles }),
	enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: enemyVehicles })
});

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const giveHand = (driver: Driver, cards: Card[]): void => {
	driver.set({ hand: cards, adrenaline: 5 });
};

const raiderCard = (name: string, effects: CardData['effects'], targetType: CardData['targetType'] = 'enemy_single'): Card => new Card({
	type: name.toLowerCase().replace(/ /g, '_'),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost: 1,
	targetType,
	effects,
	tags: ['attack']
});

const farShot = (value = 4): Card => raiderCard('Far Shot', [{ type: 'damage', value, range: 10, target: 'target', always_hits: true }]);
const pointBlank = (value = 3): Card => raiderCard('Point Blank', [{ type: 'damage', value, range: 1, target: 'target', always_hits: true }]);
const headshot = (value = 10, range = 10): Card => raiderCard('Headshot', [{ type: 'damage', value, target: 'driver', range, always_hits: true }]);
const berserk = (): Card => new Card({
	type: 'berserk',
	name: 'Berserk',
	summary: 'Berserk',
	description: 'Berserk',
	rarity: 'common',
	cost: 1,
	targetType: 'self',
	effects: [{ type: 'damage', value: 200, target: 'self_driver' }],
	tags: ['utility']
});

/** A third driver in a seat, to take it */
const fillSeat = (vehicle: Vehicle): Driver => {
	const stowaway = createTestDriver('Stowaway');
	stowaway.set({ hitpoints: 100, maxHitpoints: 100, role: DriverRole.PASSENGER });
	vehicle.passenger = stowaway;
	return stowaway;
};

const messagesOf = (battle: Battle): string[] => battle.getMessages().map(message => message.message);

describe('Passengers and unmanned vehicles (DDB-152)', () => {
	describe('a wreck\'s survivors on the player\'s team', () => {
		test('go to the partner\'s vehicle first, even with an escort nearer the wreck', () => {
			const rig = createDriven('Rig', slot(P_INSIDE, CENTER));
			const bike = createDriven('Bike', slot(P_OUTSIDE, AHEAD));
			const outrider = escortAt('outrider', slot(P_OUTSIDE, CENTER));
			const battle = createBattle([rig, bike, outrider], [createDriven('Buggy')]);
			const rigDriver = driverOf(rig);

			battle.playerTeam.handleVehicleDestruction(rig);

			expect(bike.passenger).toBe(rigDriver);
			expect(outrider.passenger).toBeNull();
		});

		test('go to the escort nearest the wreck when the partner\'s seat is taken', () => {
			const rig = createDriven('Rig', slot(P_INSIDE, CENTER));
			const bike = createDriven('Bike', slot(P_INSIDE, BEHIND));
			const truck = escortAt('med_truck', slot(P_OUTSIDE, BEHIND));
			const outrider = escortAt('outrider', slot(P_INSIDE, AHEAD));
			const battle = createBattle([rig, bike, truck, outrider], [createDriven('Buggy')]);
			fillSeat(bike);

			const [escape] = battle.playerTeam.handleVehicleDestruction(rig);

			expect(escape.seat).toBe(outrider);
			expect(outrider.passenger).toBe(escape.driver);
			expect(escape.driver.role).toBe(DriverRole.PASSENGER);
		});

		// Rig is wrecked at outside center, or inside ahead for the shoulder
		// case, and both escorts sit at the same range from it
		test.each([
			['inside beats outside', slot(P_OUTSIDE, CENTER), slot(P_INSIDE, CENTER), slot(P_OUTSIDE, AHEAD)],
			['ahead beats behind in the same lane', slot(P_OUTSIDE, CENTER), slot(P_OUTSIDE, AHEAD), slot(P_OUTSIDE, BEHIND)],
			['the outside lane beats the raiders\' shoulder', slot(P_INSIDE, AHEAD), slot(P_OUTSIDE, BEHIND), slot(E_SHOULDER, AHEAD)]
		])('on a tie, %s, as for attack orders', (_case, wreckSlot, winnerSlot, loserSlot) => {
			const rig = createDriven('Rig', wreckSlot);
			const bike = createDriven('Bike', slot(P_INSIDE, BEHIND));
			const loser = escortAt('pilot_car', loserSlot, loserSlot.lane === E_SHOULDER);
			const winner = escortAt('pilot_car', winnerSlot);
			const battle = createBattle([rig, bike, loser, winner], [createDriven('Buggy', slot(E_INSIDE, AHEAD))]);
			fillSeat(bike);

			const [escape] = battle.playerTeam.handleVehicleDestruction(rig);

			expect(escape.seat).toBe(winner);
			expect(loser.passenger).toBeNull();
		});

		test('go driver first, each to the nearest free seat left', () => {
			const rig = createDriven('Rig', slot(P_INSIDE, CENTER));
			const bike = createDriven('Bike', slot(P_INSIDE, BEHIND));
			const outrider = escortAt('outrider', slot(P_INSIDE, AHEAD));
			const truck = escortAt('med_truck', slot(P_OUTSIDE, BEHIND));
			const battle = createBattle([rig, bike, outrider, truck], [createDriven('Buggy')]);
			const rigDriver = driverOf(rig);
			const bikeDriver = driverOf(bike);
			battle.playerTeam.handleVehicleDestruction(bike);
			expect(rig.passenger).toBe(bikeDriver);

			battle.playerTeam.handleVehicleDestruction(rig);

			expect(outrider.passenger).toBe(rigDriver);
			expect(truck.passenger).toBe(bikeDriver);
			expect(battle.playerTeam.isDefeated()).toBe(false);
		});

		test('crash out when there\'s no free seat anywhere, and the log says so', async () => {
			const rig = createDriven('Rig', slot(P_INSIDE, CENTER));
			const bike = createDriven('Bike', slot(P_INSIDE, BEHIND));
			const outrider = escortAt('outrider', slot(P_INSIDE, AHEAD));
			const buggy = createDriven('Buggy', slot(E_INSIDE, CENTER));
			const battle = createBattle([rig, bike, outrider], [buggy]);
			fillSeat(bike);
			fillSeat(outrider);
			const rigDriver = driverOf(rig);
			// Only Rig is in range 1 of the Buggy
			giveHand(driverOf(buggy), [pointBlank(40)]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].target).toBe(rig);

			await battle.endPlayerTurn();

			expect(rig.isAlive()).toBe(false);
			expect(rigDriver.isAlive()).toBe(true);
			expect(messagesOf(battle)).toContain('Player1 Rig Driver has no free seat and crashes out of the fight');
			expect(battle.playerTeam.getAliveDrivers()).not.toContain(rigDriver);
			expect(battle.battleOver).toBe(false);
		});
	});

	describe('a raider team', () => {
		test('still takes the first free seat on the team, however far', () => {
			const tanker = createDriven('Tanker', slot(E_OUTSIDE, AHEAD));
			const buggy = createDriven('Buggy', slot(E_INSIDE, CENTER));
			const hauler = createDriven('Hauler', slot(E_INSIDE, BEHIND));
			const battle = createBattle([createDriven('Rig'), createDriven('Bike')], [tanker, buggy, hauler]);
			const haulerDriver = driverOf(hauler);

			battle.enemyTeam.handleVehicleDestruction(hauler);

			expect(tanker.passenger).toBe(haulerDriver);
			expect(buggy.passenger).toBeNull();
		});
	});

	describe('a passenger riding in an escort', () => {
		// Rig inside center, Bike inside behind (its seat taken), the Outrider
		// inside ahead, the Buggy across from Rig
		let rig: Vehicle;
		let bike: Vehicle;
		let outrider: Vehicle;
		let buggy: Vehicle;
		let rigDriver: Driver;
		let battle: Battle;

		beforeEach(() => {
			rig = createDriven('Rig', slot(P_INSIDE, CENTER));
			bike = createDriven('Bike', slot(P_INSIDE, BEHIND));
			outrider = escortAt('outrider', slot(P_INSIDE, AHEAD));
			buggy = createDriven('Buggy', slot(E_INSIDE, CENTER));
			battle = createBattle([rig, bike, outrider], [buggy]);
			fillSeat(bike);
			rigDriver = driverOf(rig);
		});

		test('can play orders and any card that isn\'t an attack, but not an attack', () => {
			battle.playerTeam.handleVehicleDestruction(rig);
			expect(outrider.passenger).toBe(rigDriver);
			outrider.set({ structure: 20 });
			const pointBlankCard = realCard('point_blank');
			giveHand(rigDriver, [pointBlankCard, realCard('covering_fire'), realCard('close_ranks'), realCard('repair_kit')]);

			expect(battle.playCard({ driver: rigDriver, cardIndex: 0, targetVehicle: buggy })).toBe(false);
			expect(messagesOf(battle)).toContain('Cannot play card: Passengers cannot play attack cards');

			// The Outrider's gunnery 6 beats the Buggy driver's evade 5
			expect(battle.playCard({ driver: rigDriver, cardIndex: 1, targetVehicle: buggy })).toBe(true);
			expect(buggy.structure).toBe(18);
			expect(outrider.spent).toBe(true);

			expect(battle.playCard({ driver: rigDriver, cardIndex: 1, targetVehicle: outrider })).toBe(true);
			expect(outrider.shield).toBe(6);

			expect(battle.playCard({ driver: rigDriver, cardIndex: 1, targetVehicle: outrider })).toBe(true);
			expect(outrider.structure).toBe(25);

			expect(rigDriver.hand).toEqual([pointBlankCard]);
		});

		test('keeps their own hand, discard, and adrenaline, and draws and refills every turn', async () => {
			const hand = [realCard('repair_kit')];
			const discard = [realCard('close_ranks')];
			rigDriver.set({ hand, discard, adrenaline: 2 });
			rigDriver.deck?.addCards(Array.from({ length: 6 }, () => realCard('repair_kit')));

			battle.playerTeam.handleVehicleDestruction(rig);

			expect(rigDriver.hand).toBe(hand);
			expect(rigDriver.discard).toBe(discard);
			expect(rigDriver.adrenaline).toBe(2);

			await battle.endPlayerTurn();

			expect(battle.isPlayerTurn).toBe(true);
			expect(outrider.passenger).toBe(rigDriver);
			expect(rigDriver.hand).toHaveLength(5);
			expect(rigDriver.adrenaline).toBe(rigDriver.maxAdrenaline);
		});

		test('a raider plan aimed at their wrecked vehicle follows them into the escort, split half to structure and half to them', async () => {
			giveHand(driverOf(buggy), [farShot(10)]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].target).toBe(rig);

			battle.playerTeam.handleVehicleDestruction(rig);
			await battle.endPlayerTurn();

			expect(messagesOf(battle)).toContain('Rig is wrecked, so Buggy turns Far Shot on Outrider');
			expect(outrider.structure).toBe(20);
			expect(rigDriver.hitpoints).toBe(95);
		});

		test('a Headshot planned at their wrecked vehicle follows them and hits them', async () => {
			rigDriver.set({ hitpoints: 15 });
			giveHand(driverOf(buggy), [headshot()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].target).toBe(rig);

			battle.playerTeam.handleVehicleDestruction(rig);
			await battle.endPlayerTurn();

			expect(outrider.structure).toBe(25);
			expect(rigDriver.hitpoints).toBe(5);
		});
	});

	describe('the roster', () => {
		test('converted vehicles join it last, in the order they converted, so Rally the Convoy fires them after the convoy\'s own', () => {
			const rig = createDriven('Rig', slot(P_INSIDE, CENTER));
			const bike = createDriven('Bike', slot(P_INSIDE, BEHIND));
			const outrider = escortAt('outrider', slot(P_INSIDE, AHEAD));
			const buggy = createDriven('Buggy', slot(E_INSIDE, CENTER));
			buggy.set({ structure: 200, maxStructure: 200 });
			driverOf(buggy).set({ skills: { ...driverOf(buggy).skills, evade: 0 } });
			const battle = createBattle([rig, bike, outrider], [buggy]);
			const rider = fillSeat(outrider);

			for (const vehicle of [bike, rig]) {
				driverOf(vehicle).takeDamage(1000);
				battle.playerTeam.handleDriverDeath(vehicle);
			}
			expect(battle.playerTeam.escorts).toEqual([outrider, bike, rig]);

			// As at the start of the next player turn
			battle.playerTeam.readyEscorts();
			giveHand(rider, [realCard('rally_the_convoy')]);
			expect(battle.playCard({ driver: rider, cardIndex: 0 })).toBe(true);

			expect(messagesOf(battle).filter(line => line.includes(' fires on '))).toEqual([
				'Outrider fires on Buggy',
				'Bike fires on Buggy',
				'Rig fires on Buggy'
			]);
		});
	});

	describe('a player vehicle whose driver dies with no passenger', () => {
		let rig: Vehicle;
		let bike: Vehicle;
		let buggy: Vehicle;
		let rigDriver: Driver;
		let bikeDriver: Driver;
		let buggyDriver: Driver;
		let sniper: Vehicle;
		let battle: Battle;

		// Range 1 reaches only the player vehicle across the road: the Buggy
		// faces Rig, the Sniper faces Bike
		beforeEach(() => {
			rig = createDriven('Rig', slot(P_INSIDE, CENTER));
			bike = createDriven('Bike', slot(P_INSIDE, BEHIND), 5);
			buggy = createDriven('Buggy', slot(E_INSIDE, CENTER));
			sniper = createDriven('Sniper', slot(E_INSIDE, BEHIND));
			battle = createBattle([rig, bike], [buggy, sniper]);
			rigDriver = driverOf(rig);
			bikeDriver = driverOf(bike);
			buggyDriver = driverOf(buggy);
		});

		/** Bike's driver dies to a raider Headshot in the enemy turn */
		const headshotBikeDriver = async (): Promise<void> => {
			bikeDriver.set({ hitpoints: 5 });
			giveHand(driverOf(sniper), [headshot(10, 1)]);
			battle.planEnemyTurn();
			expect(battle.getPlan(sniper)[0].target).toBe(bike);
			await battle.endPlayerTurn();
			expect(bikeDriver.isAlive()).toBe(false);
		};

		test('becomes an escort with the default crew, its own base speed, and no signature card', () => {
			expect(bike.speed).toBe(7);
			giveHand(bikeDriver, [berserk()]);

			battle.playCard({ driver: bikeDriver, cardIndex: 0 });

			expect(bike.driver).toBeNull();
			expect(bike.isEscort).toBe(true);
			expect(bike.speed).toBe(5);
			expect(bike.crewSkills()).toMatchObject(UNMANNED_CREW);
			expect(bike.escort).toMatchObject({
				type: null,
				signatureCard: null,
				dividend: null,
				setPiece: false,
				preferredSlot: { lane: 'inside', row: BEHIND }
			});
			expect(battle.playerTeam.escorts).toEqual([bike]);
			expect(battle.playerTeam.drivenVehicles).toEqual([rig]);
			expect(messagesOf(battle)).toContain('Bike has nobody at the wheel and carries on as an escort');
		});

		test('starts spent when it converts mid-turn', () => {
			giveHand(bikeDriver, [berserk()]);

			battle.playCard({ driver: bikeDriver, cardIndex: 0 });

			expect(bike.spent).toBe(true);
			expect(battle.orderCarrier({ card: realCard('covering_fire'), target: buggy })).toBeNull();
		});

		test('converting in the enemy turn, it is ready when the player turn starts', async () => {
			await headshotBikeDriver();

			expect(battle.isPlayerTurn).toBe(true);
			expect(bike.isEscort).toBe(true);
			expect(bike.isReady).toBe(true);
			expect(battle.playerTeam.vehicles).toEqual([rig, bike]);
		});

		test.each([
			['hits', 3, 18],
			['misses', 4, 20]
		])('carries out Covering Fire with the default crew\'s gunnery 4, which %s evade %s', async (_outcome, evade, structure) => {
			await headshotBikeDriver();
			buggyDriver.set({ skills: { ...buggyDriver.skills, evade } });

			expect(battle.orderCarrier({ card: realCard('covering_fire'), target: buggy })).toBe(bike);
			giveHand(rigDriver, [realCard('covering_fire')]);
			expect(battle.playCard({ driver: rigDriver, cardIndex: 0, targetVehicle: buggy })).toBe(true);

			expect(buggy.structure).toBe(structure);
			expect(bike.spent).toBe(true);
		});

		test('can be ordered like any escort: Draw Fire targets it', async () => {
			await headshotBikeDriver();
			giveHand(rigDriver, [realCard('draw_fire')]);

			expect(battle.playCard({ driver: rigDriver, cardIndex: 0, targetVehicle: bike })).toBe(true);

			expect(bike.shield).toBe(4);
			expect(bike.spent).toBe(true);
		});

		test('gives a wreck survivor a seat, and the fight goes on while they ride in it', async () => {
			giveHand(bikeDriver, [berserk()]);
			battle.playCard({ driver: bikeDriver, cardIndex: 0 });
			// Only Rig is in range 1 of the Buggy
			giveHand(buggyDriver, [pointBlank(40)]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].target).toBe(rig);

			await battle.endPlayerTurn();

			expect(rig.isAlive()).toBe(false);
			expect(bike.passenger).toBe(rigDriver);
			expect(rigDriver.role).toBe(DriverRole.PASSENGER);
			expect(messagesOf(battle)).toContain('Player1 Rig Driver jumps from Rig into Bike');
			expect(battle.playerTeam.vehicles).toEqual([bike]);
			expect(battle.battleOver).toBe(false);
			expect(battle.isPlayerTurn).toBe(true);
		});

		test('the run ends when the last driver, riding in it, dies', async () => {
			giveHand(bikeDriver, [berserk()]);
			battle.playCard({ driver: bikeDriver, cardIndex: 0 });
			battle.playerTeam.handleVehicleDestruction(rig);
			expect(bike.passenger).toBe(rigDriver);
			expect(battle.playerTeam.isDefeated()).toBe(false);

			rigDriver.set({ hitpoints: 5 });
			giveHand(buggyDriver, [headshot()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].target).toBe(bike);
			await battle.endPlayerTurn();

			expect(rigDriver.isAlive()).toBe(false);
			expect(battle.battleOver).toBe(true);
			expect(battle.battleWon).toBe(false);
		});

		test('is a normal escort on the player team when the fight ends', () => {
			giveHand(bikeDriver, [berserk()]);
			battle.playCard({ driver: bikeDriver, cardIndex: 0 });

			giveHand(rigDriver, [farShot(100), farShot(100)]);
			battle.playCard({ driver: rigDriver, cardIndex: 0, targetVehicle: buggy });
			battle.playCard({ driver: rigDriver, cardIndex: 0, targetVehicle: sniper });

			expect(battle.battleWon).toBe(true);
			expect(battle.playerTeam.vehicles).toEqual([rig, bike]);
			expect(battle.playerTeam.escorts).toEqual([bike]);
			expect(bike.isOutOfFight).toBe(false);
		});
	});
});
