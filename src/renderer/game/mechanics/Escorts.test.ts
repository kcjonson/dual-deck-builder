import { Battle } from './Battle';
import { BoardProjection } from './BoardProjection';
import { Card, CardEffect } from './Card';
import { Driver } from './Driver';
import { ESCORT_CONFIGS, createEscort } from './Escort';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { MAX_CONVOY_ESCORTS, Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });

const createDriven = (name: string, startSlot: RoadSlot | null = null): Vehicle => new Vehicle({
	name,
	armor: 0,
	maxArmor: 0,
	structure: 20,
	maxStructure: 20,
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

const card = (name: string, effects: CardEffect[], cost = 1): Card => new Card({
	type: name.toLowerCase().replace(/ /g, '_'),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost,
	targetType: 'enemy_single',
	effects,
	tags: []
});

// No always_hits: these roll the hit check. Test drivers have gunnery and
// ramming 5, so they hit the Fuel Hauler (evade 1) and miss the Outrider (evade 6).
const shot = (value = 15): Card => card('Shot', [{ type: 'damage', value, range: 10 }]);
const slow = (): Card => card('Slow', [{ type: 'apply_status', status: 'speed_reduction', value: -2, duration: 2, target: 'target' }]);
const ram = (): Card => card('Ram', [{ type: 'damage', value: 0, formula: 'armor/10 + (speed_diff)', attack_type: 'ramming', range: 10 }], 2);
const headshot = (value = 10): Card => card('Headshot', [{ type: 'damage', value, target: 'driver', range: 10, always_hits: true }], 2);

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const giveHand = (vehicle: Vehicle, cards: Card[]): void => {
	driverOf(vehicle).set({ hand: cards, adrenaline: 5 });
};

const logLines = (battle: Battle, type: string): string[] =>
	battle.getMessages().filter(message => message.type === type).map(message => message.message);

/** A driver riding in an escort. Seating one for real waits on DDB-152. */
const seatPassenger = (escort: Vehicle, hitpoints = 100): Driver => {
	const rider = createTestDriver('Rider');
	rider.set({ hitpoints, maxHitpoints: hitpoints });
	escort.passenger = rider;
	return rider;
};

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
			expect(createEscort({ type: 'outrider' }).speed).toBe(5);
			expect(createEscort({ type: 'pilot_car' }).speed).toBe(4);
		});

		test('a driven vehicle is not an escort', () => {
			expect(rig.isEscort).toBe(false);
		});
	});

	describe('team limits', () => {
		test('two driven vehicles and four escorts make a valid player team', () => {
			const team = playerTeam([rig, bike, ...fullConvoy()]);

			expect(team.drivenVehicles).toEqual([rig, bike]);
			expect(team.escorts).toHaveLength(MAX_CONVOY_ESCORTS);
		});

		test('a fifth escort in formation is rejected, at creation or when added', () => {
			expect(() => playerTeam([rig, bike, ...fullConvoy(), createEscort({ type: 'outrider' })]))
				.toThrow('Player teams can field 4 convoy escorts, not 5');

			const team = playerTeam([rig, bike, ...fullConvoy()]);
			expect(() => team.addVehicle(createEscort({ type: 'outrider' })))
				.toThrow('Player teams can field 4 convoy escorts, not 5');
		});

		test('a player team still needs exactly two driven vehicles', () => {
			expect(() => playerTeam([rig, ...fullConvoy()]))
				.toThrow('Player teams must have exactly 2 driven vehicles, not 1');
			expect(() => playerTeam([rig, bike]).addVehicle(createDriven('Van')))
				.toThrow('Player teams cannot have more than 2 driven vehicles');
		});

		test('addVehicle takes escorts up to the cap', () => {
			const team = playerTeam([rig, bike]);
			fullConvoy().forEach(escort => team.addVehicle(escort));

			expect(team.escorts).toHaveLength(MAX_CONVOY_ESCORTS);
		});

		test('a set-piece ambusher on the shoulder does not count toward the four', () => {
			const ally = createEscort({ type: 'outrider', setPiece: true });
			ally.slot = slot(RoadLane.ENEMY_SHOULDER, RoadRow.CENTER);

			expect(() => playerTeam([rig, bike, ...fullConvoy(), ally])).not.toThrow();
		});

		test('a set-piece ally added before its slot is set does not count toward the four', () => {
			const team = playerTeam([rig, bike, ...fullConvoy()]);
			const ally = createEscort({ type: 'pilot_car', setPiece: true });

			expect(ally.slot).toBeNull();
			expect(() => team.addVehicle(ally)).not.toThrow();
			expect(team.escorts).toContain(ally);
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

	describe('taking fire', () => {
		let buggy: Vehicle;

		beforeEach(() => {
			buggy = createDriven('Buggy');
		});

		describe('hit checks', () => {
			test('an escort defends with its own evade, whoever rides in it', () => {
				const outrider = createEscort({ type: 'outrider' });
				const hauler = createEscort({ type: 'fuel_hauler' });
				const battle = createBattle([rig, bike, outrider, hauler], [buggy]);
				const caster = driverOf(buggy);
				seatPassenger(hauler).set({ skills: { ramming: 0, gunnery: 0, evade: 10, speed: 2 } });

				expect(battle.checkHit({ attacker: buggy, caster, defender: outrider })).toBe(false);
				expect(battle.checkHit({ attacker: buggy, caster, defender: hauler })).toBe(true);
				expect(battle.checkHit({ attacker: buggy, caster, defender: outrider, attackType: 'ramming' })).toBe(false);
				expect(battle.checkHit({ attacker: buggy, caster, defender: hauler, attackType: 'ramming' })).toBe(true);
			});

			test('an escort attacks with its own skills, not those of the driver ordering it', () => {
				const outrider = createEscort({ type: 'outrider' });
				const pilotCar = createEscort({ type: 'pilot_car' });
				const battle = createBattle([rig, bike, outrider, pilotCar], [buggy]);
				driverOf(rig).set({ skills: { ramming: 10, gunnery: 10, evade: 10, speed: 2 } });

				// Buggy's driver evades 5: the Outrider's gunnery 6 beats it, the Pilot Car's 5 doesn't
				expect(battle.checkHit({ attacker: outrider, caster: driverOf(rig), defender: buggy })).toBe(true);
				expect(battle.checkHit({ attacker: pilotCar, caster: driverOf(rig), defender: buggy })).toBe(false);
			});

			test.each([
				['outrider', false],
				['fuel_hauler', true]
			] as const)('a raider\'s attack on the %s lands only if it beats the escort\'s evade', async (type, lands) => {
				const escort = createEscort({ type });
				const battle = createBattle([escort, rig, bike], [buggy]);
				const { armor, structure } = escort;
				giveHand(buggy, [shot()]);
				battle.planEnemyTurn();

				expect(battle.getPlan(buggy).map(action => action.target)).toEqual([escort]);
				await battle.endPlayerTurn();

				if (lands) {
					// 15 against 5 armor: all 10 past it goes to structure
					expect(escort.armor).toBe(0);
					expect(escort.structure).toBe(structure - 10);
					expect(logLines(battle, 'damage_dealt')).toContain(
						`Shot deals 15 total (5 to armor, 10 to structure) damage to ${escort.name} (Structure: 40/40 -> 30/40, Armor: 5/5 -> 0/5)`
					);
				} else {
					expect(escort.armor).toBe(armor);
					expect(escort.structure).toBe(structure);
					expect(logLines(battle, 'miss')).toContain(`Shot misses ${escort.name}`);
				}
			});

			test.each([
				['outrider', false],
				['fuel_hauler', true]
			] as const)('a raider\'s debuff on the %s lands only if it beats the escort\'s evade, as the plan projected', async (type, lands) => {
				const escort = createEscort({ type });
				const battle = createBattle([escort, rig, bike], [buggy]);
				giveHand(buggy, [slow()]);
				battle.planEnemyTurn();
				const [action] = battle.getPlan(buggy);
				const board = new BoardProjection({ battle });
				board.apply({ card: action.card, driver: action.driver, target: action.target });

				await battle.endPlayerTurn();

				expect(action.target).toBe(escort);
				expect(escort.hasStatusEffect('speed_reduction')).toBe(lands);
				expect(escort.speed).toBe(board.speedOf(escort));
				expect(escort.speed).toBe(lands ? escort.baseSpeed - 2 : escort.baseSpeed);
			});
		});

		describe('damage', () => {
			test('an empty escort takes everything past armor on structure', () => {
				const hauler = createEscort({ type: 'fuel_hauler' });

				hauler.takeDamage(15);

				expect(hauler.armor).toBe(0);
				expect(hauler.structure).toBe(30);
			});

			test('an escort carrying a passenger splits past armor like a driven vehicle', () => {
				const hauler = createEscort({ type: 'fuel_hauler' });
				const rider = seatPassenger(hauler);

				hauler.takeDamage(15);

				expect(hauler.structure).toBe(35);
				expect(rider.hitpoints).toBe(95);
			});

			test('a ram on an escort runs on the escort\'s own speed', async () => {
				const hauler = createEscort({ type: 'fuel_hauler' });
				const battle = createBattle([hauler, rig, bike], [buggy]);
				buggy.set({ armor: 40, maxArmor: 40 });
				driverOf(buggy).set({ skills: { ...driverOf(buggy).skills, speed: 3 } });
				giveHand(buggy, [ram()]);
				battle.planEnemyTurn();

				// 40 armor / 10, plus Buggy's 2 + 3 against the Hauler's 2
				expect(battle.getIntents(buggy)[0]).toMatchObject({ amount: 7, target: hauler.id });
				await battle.endPlayerTurn();

				expect(hauler.armor).toBe(0);
				expect(hauler.structure).toBe(38);
			});
		});

		describe('wrecks', () => {
			test('a wrecked escort holds its slot for the rest of the turn, then leaves the road', async () => {
				const hauler = createEscort({ type: 'fuel_hauler' });
				const battle = createBattle([hauler, rig, bike], [buggy]);
				const haulerSlot = hauler.slot;
				giveHand(buggy, [shot(100), shot()]);
				battle.planEnemyTurn();
				expect(battle.getPlan(buggy).map(action => action.target)).toEqual([hauler, hauler]);

				let onRoadWhenFollowedUp = false;
				battle.on('battleMessage', message => {
					if (message.type === 'fizzle') {
						onRoadWhenFollowedUp = battle.playerTeam.vehicles.includes(hauler) && hauler.slot === haulerSlot;
					}
				});
				await battle.endPlayerTurn();

				expect(hauler.isAlive()).toBe(false);
				expect(onRoadWhenFollowedUp).toBe(true);
				expect(logLines(battle, 'fizzle')).toEqual(["Buggy's Shot fizzles: Fuel Hauler is wrecked and nobody got out"]);
				expect(battle.playerTeam.vehicles).not.toContain(hauler);
				expect(hauler.slot).toBeNull();
				expect(logLines(battle, 'general')).toContain('Fuel Hauler is wrecked and leaves the road');
				expect(battle.battleOver).toBe(false);
			});

			test('a passenger riding in a wrecked escort jumps out', () => {
				const hauler = createEscort({ type: 'fuel_hauler' });
				const team = playerTeam([rig, bike, hauler]);
				const rider = seatPassenger(hauler);

				hauler.takeDamage(100);
				team.handleVehicleDestruction(hauler);

				expect(Team.survivorsOf(hauler)).toEqual([rider]);
				expect(rig.passenger).toBe(rider);
			});
		});

		describe('Headshot', () => {
			test('an empty escort is not a legal Headshot target, so a raider aims it elsewhere', () => {
				const hauler = createEscort({ type: 'fuel_hauler' });
				const battle = createBattle([hauler, rig, bike], [buggy]);
				giveHand(buggy, [headshot()]);
				battle.planEnemyTurn();

				expect(new BoardProjection({ battle }).targetBlocker({ card: headshot(), caster: buggy, target: hauler }))
					.toBe('Fuel Hauler has nobody aboard to hit');
				expect(battle.getPlan(buggy).map(action => action.target)).toEqual([rig]);
			});

			test('Headshot on an escort hits the passenger riding in it, not the structure', async () => {
				const hauler = createEscort({ type: 'fuel_hauler' });
				const battle = createBattle([hauler, rig, bike], [buggy]);
				const rider = seatPassenger(hauler);
				giveHand(buggy, [headshot()]);
				battle.planEnemyTurn();

				expect(battle.getPlan(buggy).map(action => action.target)).toEqual([hauler]);
				await battle.endPlayerTurn();

				expect(rider.hitpoints).toBe(90);
				expect(hauler.structure).toBe(40);
				expect(hauler.armor).toBe(5);
			});

			test('Headshot on an escort\'s passenger rolls against the escort\'s evade, not the passenger\'s', async () => {
				const hauler = createEscort({ type: 'fuel_hauler' });
				const battle = createBattle([hauler, rig, bike], [buggy]);
				const rider = seatPassenger(hauler);
				rider.set({ skills: { ramming: 0, gunnery: 0, evade: 3, speed: 2 } });
				// The effect as cards.json has it
				const realHeadshot = card('Headshot', [{ type: 'damage', value: 5, target: 'driver', hit_modifier: 2 }], 2);
				giveHand(buggy, [realHeadshot]);
				battle.planEnemyTurn();

				expect(battle.getPlan(buggy).map(action => action.target)).toEqual([hauler]);
				await battle.endPlayerTurn();

				// Gunnery 5 > Fuel Hauler evade 1 + 2 lands; against the rider's 3 + 2 it would miss
				expect(logLines(battle, 'miss')).toEqual([]);
				expect(rider.hitpoints).toBe(95);
				expect(hauler.structure).toBe(ESCORT_CONFIGS.fuel_hauler.structure);
			});

			test('a planned Headshot fizzles when the escort\'s passenger dies before it plays', async () => {
				const hauler = createEscort({ type: 'fuel_hauler' });
				const battle = createBattle([hauler, rig, bike], [buggy]);
				const rider = seatPassenger(hauler, 10);
				giveHand(buggy, [headshot(), headshot()]);
				battle.planEnemyTurn();
				expect(battle.getPlan(buggy).map(action => action.target)).toEqual([hauler, hauler]);

				await battle.endPlayerTurn();

				expect(rider.isAlive()).toBe(false);
				expect(hauler.passenger).toBeNull();
				expect(logLines(battle, 'fizzle')).toEqual(["Buggy's Headshot fizzles: Fuel Hauler has nobody aboard to hit"]);
			});
		});

		describe('self costs', () => {
			const recklessShot = (): Card => card('Reckless Shot', [
				{ type: 'damage', value: 3, range: 10 },
				{ type: 'damage', value: 1, target: 'self_driver' },
				{ type: 'gain_resource', resource: 'adrenaline', value: 1, target: 'self' },
				{ type: 'apply_status', status: 'vulnerable', duration: 2, target: 'self' }
			], 2);

			// FirstPlayableAI shoots at the first vehicle in the roster
			const costsPaid = async (target: Vehicle, others: Vehicle[]): Promise<{ hitpoints: number; vulnerable: boolean; adrenalineGained: boolean }> => {
				const raider = createDriven('Buggy');
				const battle = createBattle([target, ...others], [raider]);
				giveHand(raider, [recklessShot()]);
				battle.planEnemyTurn();
				await battle.endPlayerTurn();
				return {
					hitpoints: driverOf(raider).hitpoints,
					vulnerable: raider.hasStatusEffect('vulnerable'),
					adrenalineGained: battle.getMessages().some(message => message.message.startsWith('Reckless Shot gives 1 adrenaline'))
				};
			};

			test.each([
				['hits', 'fuel_hauler', 1],
				['misses', 'outrider', 6]
			] as const)('an attack that %s an escort pays the same self costs as one on a driven vehicle', async (_outcome, type, evade) => {
				const drivenTarget = createDriven('Van');
				driverOf(drivenTarget).set({ skills: { ramming: 5, gunnery: 5, evade, speed: 2 } });

				const onEscort = await costsPaid(createEscort({ type }), [rig, bike]);
				const onDriven = await costsPaid(drivenTarget, [createDriven('Bike')]);

				expect(onEscort).toEqual(onDriven);
				expect(onEscort.vulnerable).toBe(true);
				expect(onEscort.adrenalineGained).toBe(true);
			});

			test('an attack that hits an escort costs the self damage', async () => {
				const costs = await costsPaid(createEscort({ type: 'fuel_hauler' }), [rig, bike]);

				expect(costs.hitpoints).toBe(4);
			});
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
