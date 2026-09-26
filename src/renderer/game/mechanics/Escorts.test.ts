import { Battle } from './Battle';
import { BoardProjection } from './BoardProjection';
import { Card } from './Card';
import { ESCORT_CONFIGS, createEscort } from './Escort';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { MAX_FORMATION_ESCORTS, Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });

const createDriven = (name: string, startSlot: RoadSlot | null = null): Vehicle => new Vehicle({
	name,
	armor: 0,
	maxArmor: 0,
	structure: 20,
	maxStructure: 20,
	speed: 2,
	baseSpeed: 2,
	slot: startSlot,
	flank: null,
	velocity: 0,
	driver: createTestDriver(`${name} Driver`),
	passenger: null,
	statusEffects: []
});

const playerTeam = (vehicles: Vehicle[]): Team => new Team({ type: TeamType.PLAYER, vehicles });

const createBattle = (playerVehicles: Vehicle[], enemyVehicles: Vehicle[] = [createDriven('Buggy')]): Battle => new Battle({
	playerTeam: playerTeam(playerVehicles),
	enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: enemyVehicles })
});

const fullConvoy = (): Vehicle[] => [
	createEscort({ type: 'outrider' }),
	createEscort({ type: 'pilot_car' }),
	createEscort({ type: 'fuel_hauler' }),
	createEscort({ type: 'med_truck' })
];

const potShot = (): Card => new Card({
	type: 'pot_shot',
	name: 'Pot Shot',
	summary: 'Shoot anything',
	description: 'Shoot anything',
	rarity: 'common',
	cost: 1,
	targetType: 'enemy_single',
	effects: [{ type: 'damage', value: 3, range: 10, always_hits: true }],
	tags: ['attack']
});

// Kills the driver who plays it, so a test can end the fight through a real play
const recklessBurn = (): Card => new Card({
	type: 'reckless_burn',
	name: 'Reckless Burn',
	summary: 'Burn out',
	description: 'Burn out',
	rarity: 'common',
	cost: 1,
	targetType: 'self',
	effects: [{ type: 'damage', value: 100, target: 'self_driver', always_hits: true }],
	tags: ['utility']
});

describe('Escorts', () => {
	let rig: Vehicle;
	let bike: Vehicle;

	beforeEach(() => {
		rig = createDriven('Rig');
		bike = createDriven('Bike');
	});

	describe('the escort profile', () => {
		test('builds each starting type from its config, undriven, at full armor and structure', () => {
			const hauler = createEscort({ type: 'fuel_hauler' });

			expect(hauler.isEscort).toBe(true);
			expect(hauler.driver).toBeNull();
			expect(hauler.name).toBe('Fuel Hauler');
			expect(hauler.structure).toBe(ESCORT_CONFIGS.fuel_hauler.structure);
			expect(hauler.escort?.role).toBe('hauler');
			expect(hauler.escort?.dividend).toEqual({ resource: 'fuel', amount: 1 });
			expect(hauler.escort?.setPiece).toBe(false);
			expect(createEscort({ type: 'med_truck' }).escort?.signatureCard).toBe('triage');
		});

		test('an escort moves at its base speed', () => {
			expect(createEscort({ type: 'outrider' }).getTotalSpeed()).toBe(5);
			expect(createEscort({ type: 'pilot_car' }).getTotalSpeed()).toBe(4);
		});

		test('a driven vehicle is not an escort', () => {
			expect(rig.isEscort).toBe(false);
		});
	});

	describe('team limits', () => {
		test('two driven vehicles and four escorts make a valid player team', () => {
			const team = playerTeam([rig, bike, ...fullConvoy()]);

			expect(team.drivenVehicles).toEqual([rig, bike]);
			expect(team.escorts).toHaveLength(MAX_FORMATION_ESCORTS);
		});

		test('a fifth escort in formation is rejected, at creation or when added', () => {
			expect(() => playerTeam([rig, bike, ...fullConvoy(), createEscort({ type: 'outrider' })]))
				.toThrow('Player teams can hold 4 escorts in formation, not 5');

			const team = playerTeam([rig, bike, ...fullConvoy()]);
			expect(() => team.addVehicle(createEscort({ type: 'outrider' })))
				.toThrow('Player teams can hold 4 escorts in formation, not 5');
		});

		test('a player team still needs exactly two driven vehicles', () => {
			expect(() => playerTeam([rig, ...fullConvoy()]))
				.toThrow('Player teams must have exactly 2 driven vehicles, not 1');
			expect(() => playerTeam([rig, bike]).addVehicle(createDriven('Van')))
				.toThrow('Player teams cannot have more than 2 driven vehicles');
		});

		test('escorts join after the fight starts until the formation cap', () => {
			const team = playerTeam([rig, bike]);
			fullConvoy().forEach(escort => team.addVehicle(escort));

			expect(team.escorts).toHaveLength(MAX_FORMATION_ESCORTS);
		});

		test('a set-piece ambusher on the shoulder does not count toward the four', () => {
			const ally = createEscort({ type: 'outrider', setPiece: true });
			ally.slot = slot(RoadLane.ENEMY_SHOULDER, RoadRow.CENTER);

			expect(() => playerTeam([rig, bike, ...fullConvoy(), ally])).not.toThrow();
		});

		test('duplicate escort types are allowed, each with its own profile', () => {
			const first = createEscort({ type: 'med_truck' });
			const second = createEscort({ type: 'med_truck' });
			const team = playerTeam([rig, bike, first, second]);

			expect(team.escorts).toEqual([first, second]);
			expect(first.escort).not.toBe(second.escort);
		});
	});

	describe('opening fill', () => {
		test('the four starting types take their preferred slots around the drivers', () => {
			const [outrider, pilotCar, fuelHauler, medTruck] = fullConvoy();
			createBattle([rig, bike, medTruck, fuelHauler, pilotCar, outrider]);

			expect(rig.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.CENTER));
			expect(bike.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.BEHIND));
			expect(outrider.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.AHEAD));
			expect(pilotCar.slot).toEqual(slot(RoadLane.PLAYER_OUTSIDE, RoadRow.AHEAD));
			expect(fuelHauler.slot).toEqual(slot(RoadLane.PLAYER_OUTSIDE, RoadRow.CENTER));
			expect(medTruck.slot).toEqual(slot(RoadLane.PLAYER_OUTSIDE, RoadRow.BEHIND));
		});

		test('drivers take their opening slots first even when escorts are listed ahead of them', () => {
			const hauler = createEscort({ type: 'fuel_hauler' });
			createBattle([hauler, rig, bike]);

			expect(rig.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.CENTER));
			expect(bike.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.BEHIND));
			expect(hauler.slot).toEqual(slot(RoadLane.PLAYER_OUTSIDE, RoadRow.CENTER));
		});

		test('a taken preferred slot falls back to the next free slot in fill order, in roster order', () => {
			const firstOutrider = createEscort({ type: 'outrider' });
			const secondOutrider = createEscort({ type: 'outrider' });
			const hauler = createEscort({ type: 'fuel_hauler' });
			createBattle([rig, bike, firstOutrider, secondOutrider, hauler]);

			expect(firstOutrider.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.AHEAD));
			// Inside is full, so the next in fill order is outside center, which the hauler wanted
			expect(secondOutrider.slot).toEqual(slot(RoadLane.PLAYER_OUTSIDE, RoadRow.CENTER));
			expect(hauler.slot).toEqual(slot(RoadLane.PLAYER_OUTSIDE, RoadRow.BEHIND));
		});

		test('encounter-given slots are honored and push an escort off its preferred slot', () => {
			const ahead = createDriven('Rig', slot(RoadLane.PLAYER_INSIDE, RoadRow.AHEAD));
			const outrider = createEscort({ type: 'outrider' });
			const placedTruck = createEscort({ type: 'med_truck' });
			placedTruck.slot = slot(RoadLane.PLAYER_OUTSIDE, RoadRow.AHEAD);
			createBattle([ahead, bike, outrider, placedTruck]);

			expect(ahead.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.AHEAD));
			expect(placedTruck.slot).toEqual(slot(RoadLane.PLAYER_OUTSIDE, RoadRow.AHEAD));
			expect(bike.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.CENTER));
			expect(outrider.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.BEHIND));
		});
	});

	describe('in the fight', () => {
		test('an escort with no driver is not unmanned or out of the fight', () => {
			const escort = createEscort({ type: 'pilot_car' });

			expect(escort.isUnmanned()).toBe(false);
			expect(escort.isOutOfFight).toBe(false);
		});

		test('a wrecked escort is out of the fight', () => {
			const escort = createEscort({ type: 'pilot_car' });
			escort.destroy();

			expect(escort.isOutOfFight).toBe(true);
		});

		test('a driven vehicle whose driver died is still unmanned and out of the fight', () => {
			rig.driver?.takeDamage(100);
			rig.handleDriverDeath();

			expect(rig.isUnmanned()).toBe(true);
			expect(rig.isOutOfFight).toBe(true);
		});

		test('an escort stays on the road at the end of the turn', async () => {
			const escort = createEscort({ type: 'outrider' });
			const battle = createBattle([rig, bike, escort]);

			await battle.endPlayerTurn();

			expect(battle.playerTeam.vehicles).toContain(escort);
			expect(escort.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.AHEAD));
		});

		test('an escort is a legal target', () => {
			const escort = createEscort({ type: 'outrider' });
			const buggy = createDriven('Buggy');
			const battle = createBattle([rig, bike, escort], [buggy]);

			expect(new BoardProjection({ battle }).targetBlocker({ card: potShot(), caster: buggy, target: escort })).toBeNull();
		});

		test('a wrecked driver does not ride in an escort yet', () => {
			const escort = createEscort({ type: 'med_truck' });
			const team = playerTeam([rig, bike, escort]);
			const bikeDriver = bike.driver;
			rig.passenger = createTestDriver('Rider');

			team.handleVehicleDestruction(bike);

			expect(escort.canAddPassenger()).toBe(false);
			expect(escort.passenger).toBeNull();
			expect(bikeDriver && team.getAliveDrivers().includes(bikeDriver)).toBe(false);
		});
	});

	describe('defeat', () => {
		test('escorts never count: with every driver dead the team is defeated', () => {
			const team = playerTeam([rig, bike, ...fullConvoy()]);
			rig.driver?.takeDamage(100);
			bike.driver?.takeDamage(100);
			rig.handleDriverDeath();
			bike.handleDriverDeath();

			expect(team.escorts.every(escort => !escort.isOutOfFight)).toBe(true);
			expect(team.isDefeated()).toBe(true);
		});

		test('the battle is lost when the last driver goes, escorts or not', () => {
			const battle = createBattle([rig, bike, ...fullConvoy()]);
			bike.driver?.takeDamage(100);
			bike.handleDriverDeath();
			const lastDriver = rig.driver;
			if (!lastDriver) throw new Error('Rig has no driver');
			lastDriver.hand = [recklessBurn()];
			lastDriver.adrenaline = 5;

			battle.playCard({ driver: lastDriver, cardIndex: 0 });

			expect(battle.battleOver).toBe(true);
			expect(battle.battleWon).toBe(false);
		});
	});

	describe('ambush starts', () => {
		const buggyCenter = (): Vehicle => createDriven('Buggy', slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));

		test('a set-piece escort may start on the raiders\' shoulder', () => {
			const ally = createEscort({ type: 'outrider', setPiece: true });
			ally.slot = slot(RoadLane.ENEMY_SHOULDER, RoadRow.CENTER);
			createBattle([rig, bike, ally], [buggyCenter()]);

			expect(ally.isAmbusher).toBe(true);
			expect(ally.isFlanking).toBe(true);
		});

		test('a set-piece escort may arrive on the shoulder mid-fight', () => {
			const battle = createBattle([rig, bike], [buggyCenter()]);
			const ally = createEscort({ type: 'pilot_car', setPiece: true });

			expect(battle.getAmbushBlocker({
				vehicle: ally,
				teamType: TeamType.PLAYER,
				slot: slot(RoadLane.ENEMY_SHOULDER, RoadRow.CENTER)
			})).toBeNull();
		});

		test('a convoy escort may not ambush', () => {
			const outrider = createEscort({ type: 'outrider' });
			outrider.slot = slot(RoadLane.ENEMY_SHOULDER, RoadRow.CENTER);

			expect(() => createBattle([rig, bike, outrider], [buggyCenter()]))
				.toThrow("Outrider can't start flanking; only set-piece escorts ambush, the convoy's own start in formation");
		});

		test('a driven vehicle may not ambush', () => {
			const battle = createBattle([rig, bike], [buggyCenter()]);

			expect(battle.getAmbushBlocker({
				vehicle: createDriven('Van'),
				teamType: TeamType.PLAYER,
				slot: slot(RoadLane.ENEMY_SHOULDER, RoadRow.CENTER)
			})).toBe("Van can't start flanking; the player's driven vehicles always start in formation");
		});
	});
});
