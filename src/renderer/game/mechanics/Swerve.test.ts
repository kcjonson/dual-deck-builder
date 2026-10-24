import { Battle } from './Battle';
import { BoardProjection } from './BoardProjection';
import { Card, CardEffect, TargetType } from './Card';
import { Driver } from './Driver';
import { createEscort } from './Escort';
import { moveSpecOf } from './Movement';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { buildPlayerHandView } from '../screens/combat/PlayerHandView';
import { createTestDriver } from '../ai/__tests__/test-helpers';

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });
const { PLAYER_SHOULDER, PLAYER_OUTSIDE, PLAYER_INSIDE, ENEMY_INSIDE, ENEMY_OUTSIDE, ENEMY_SHOULDER } = RoadLane;
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

const createBattle = (playerVehicles: Vehicle[], enemyVehicles: Vehicle[]): Battle => new Battle({
	playerTeam: new Team({ type: TeamType.PLAYER, vehicles: playerVehicles }),
	enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: enemyVehicles })
});

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

// Stand-ins for the movement cards, built from the change_position shape the
// card batches will use (docs/AI_TECHNICAL_DECISIONS/movement-cards.md)
const laneChange = () => card('Lane Change', 'self', [{ type: 'change_position', position: 'swerve', to: 'other_lane', target: 'self' }]);
const floorIt = () => card('Floor It', 'self', [
	{ type: 'change_position', position: 'swerve', to: 'ahead', target: 'self' },
	{ type: 'apply_status', status: 'speed_boost', value: 2, duration: 1, target: 'self' }
]);
const hardBrake = () => card('Hard Brake', 'self', [{ type: 'change_position', position: 'swerve', to: 'behind', target: 'self' }]);
const juke = () => card('Juke', 'self', [{ type: 'change_position', position: 'swerve', to: 'pick', target: 'self' }]);
const bootlegger = () => card('Bootlegger Turn', 'self', [{ type: 'change_position', position: 'move', to: 'pick', target: 'self' }]);
const slipstream = () => card('Slipstream', 'self', [{ type: 'change_position', position: 'move', to: 'behind_partner', target: 'self' }]);
const strafe = () => card('Strafe', 'enemy_single', [
	{ type: 'change_position', position: 'swerve', to: 'pick', target: 'self' },
	{ type: 'damage', value: 4, range: 1, target: 'target', always_hits: true }
], ['attack']);
const cutOff = () => card('Cut Off', 'enemy_single', [
	{ type: 'change_position', position: 'swerve', to: 'ahead', target: 'self' },
	{ type: 'apply_status', status: 'speed_reduction', value: -2, duration: 1, range: 1, target: 'target', always_hits: true }
]);
const leapfrog = () => card('Leapfrog', 'ally', [{ type: 'change_position', position: 'swap', target: 'target' }]);
const peelOff = () => card('Peel Off', 'self', [{ type: 'change_position', position: 'drop_back', target: 'self' }]);
const layOnTheHorn = () => card('Lay on the Horn', 'enemy_single', [
	{ type: 'change_position', position: 'swerve', to: 'outside', target: 'target', optional: true },
	{ type: 'apply_status', status: 'speed_reduction', value: -1, duration: 1, range: 1, target: 'target', always_hits: true }
]);
const shove = () => card('Shove', 'enemy_single', [
	{ type: 'change_position', position: 'swerve', to: 'outside', target: 'target' },
	{ type: 'apply_status', status: 'speed_reduction', value: -1, duration: 1, range: 2, target: 'target', always_hits: true }
]);
// Ramming 5 against evade 5 hits, as Ram does
const shoulderCheck = () => card('Shoulder Check', 'enemy_single', [
	{ type: 'damage', value: 3, range: 1, attack_type: 'ramming', target: 'target' },
	{ type: 'change_position', position: 'swerve', to: 'pick_row', target: 'target', on_hit: true, optional: true }
], ['attack', 'physical']);
const brakeCheck = () => card('Brake Check', 'enemy_single', [
	{ type: 'change_position', position: 'drop_back', target: 'target', optional: true },
	{ type: 'apply_status', status: 'vulnerable', duration: 1, target: 'target', always_hits: true }
]);
const fallIn = () => card('Fall In', 'escort', [{ type: 'change_position', position: 'move', to: 'pick', target: 'target' }], ['order']);
const formationShift = () => card('Formation Shift', 'self', [{ type: 'change_position', position: 'formation_shift', target: 'self' }]);
const flank = () => card('Flank', 'enemy_single', [{ type: 'change_position', position: 'flanking', target: 'self' }]);
const pointBlank = () => card('Point Blank', 'enemy_single', [{ type: 'damage', value: 4, range: 1, always_hits: true }], ['attack']);

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

/** Play one card from the vehicle's driver, with a fresh hand of just it */
const play = (battle: Battle, vehicle: Vehicle, played: Card, options: { target?: Vehicle; destination?: RoadSlot } = {}): boolean => {
	const driver = driverOf(vehicle);
	driver.set({ hand: [played], adrenaline: 5 });
	return battle.playCard({ driver, cardIndex: 0, targetVehicle: options.target, destination: options.destination });
};

const blocker = (battle: Battle, vehicle: Vehicle, played: Card): string | null =>
	battle.getCardBlocker({ driver: driverOf(vehicle), card: played });

describe('Swerving', () => {
	// Rig (speed 3) inside center, Bike (speed 7) inside behind, Buggy
	// (speed 5) across from the Rig in the enemy inside lane
	let rig: Vehicle;
	let bike: Vehicle;
	let buggy: Vehicle;
	let battle: Battle;

	beforeEach(() => {
		rig = createVehicle('Rig', 1);
		bike = createVehicle('Bike', 5);
		buggy = createVehicle('Buggy', 3);
		battle = createBattle([rig, bike], [buggy]);
	});

	describe('a swerve', () => {
		test('moves to the adjacent slot its card names, one lane over or one row ahead or behind', () => {
			expect(play(battle, rig, laneChange())).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_OUTSIDE, CENTER));
			expect(play(battle, rig, floorIt())).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_OUTSIDE, AHEAD));
			expect(play(battle, rig, hardBrake())).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_OUTSIDE, CENTER));
		});

		test('to a picked slot goes only to an adjacent one, never two rows away', () => {
			expect(battle.getDestinationBlocker({ driver: driverOf(bike), card: juke(), destination: slot(PLAYER_INSIDE, AHEAD) }))
				.toBe('player inside, ahead is not next to Bike');
			expect(play(battle, bike, juke(), { destination: slot(PLAYER_INSIDE, AHEAD) })).toBe(false);
			expect(bike.slot).toEqual(slot(PLAYER_INSIDE, BEHIND));

			expect(play(battle, bike, juke(), { destination: slot(PLAYER_OUTSIDE, BEHIND) })).toBe(true);
			expect(bike.slot).toEqual(slot(PLAYER_OUTSIDE, BEHIND));
		});

		test('never diagonally', () => {
			expect(play(battle, rig, juke(), { destination: slot(PLAYER_OUTSIDE, AHEAD) })).toBe(false);
			expect(battle.getDestinationBlocker({ driver: driverOf(rig), card: juke(), destination: slot(PLAYER_OUTSIDE, AHEAD) }))
				.toBe('player outside, ahead is not next to Rig');
			expect(battle.moveDestinations({ driver: driverOf(rig), card: juke() })).toEqual([
				slot(PLAYER_OUTSIDE, CENTER),
				slot(PLAYER_INSIDE, AHEAD)
			]);
		});

		test('never into an occupied slot', () => {
			expect(blocker(battle, rig, hardBrake())).toBe('player inside, behind is taken by Bike');
			expect(play(battle, rig, hardBrake())).toBe(false);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
		});

		test('never into a reserved slot', () => {
			expect(play(battle, bike, flank(), { target: buggy })).toBe(true);
			expect(blocker(battle, rig, hardBrake())).toBe('player inside, behind is reserved for Bike');
			expect(play(battle, rig, juke(), { destination: slot(PLAYER_INSIDE, BEHIND) })).toBe(false);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
		});

		test('never onto a shoulder, or out of its own formation', () => {
			play(battle, rig, laneChange());
			expect(battle.getDestinationBlocker({ driver: driverOf(rig), card: juke(), destination: slot(PLAYER_SHOULDER, CENTER) }))
				.toBe("player shoulder, center is not in Rig's formation");
			// Its other lane is back inside, never the shoulder beside it
			expect(blocker(battle, rig, card('Out', 'self', [{ type: 'change_position', position: 'swerve', to: 'outside', target: 'self' }])))
				.toBe('Rig has no slot further out');

			play(battle, rig, laneChange());
			expect(battle.getDestinationBlocker({ driver: driverOf(rig), card: juke(), destination: slot(ENEMY_INSIDE, AHEAD) }))
				.toBe("enemy inside, ahead is not in Rig's formation");
		});

		test('never off or along a shoulder: a flanker can\'t swerve, so the card is unplayable', () => {
			play(battle, bike, flank(), { target: buggy });
			for (const played of [laneChange(), juke(), floorIt(), bootlegger(), strafe()]) {
				expect(blocker(battle, bike, played)).toBe('Bike is flanking and can\'t swerve');
			}
			// Off, back to its own reserved slot, or along to the next shoulder slot
			expect(play(battle, bike, juke(), { destination: slot(PLAYER_INSIDE, BEHIND) })).toBe(false);
			expect(play(battle, bike, juke(), { destination: slot(ENEMY_SHOULDER, AHEAD) })).toBe(false);
			expect(bike.slot).toEqual(slot(ENEMY_SHOULDER, CENTER));
		});

		test('with nowhere legal to go is unplayable, so the hand greys it out', () => {
			const outrider = createEscort({ type: 'outrider' });
			const hauler = createEscort({ type: 'fuel_hauler' });
			battle = createBattle([rig, bike, outrider, hauler], [buggy]);
			// Outrider inside ahead, Fuel Hauler outside center, Bike inside behind
			const driver = driverOf(rig);
			const stuck = juke();
			driver.set({ hand: [stuck, laneChange(), bootlegger()], adrenaline: 5 });

			expect(battle.getCardBlocker({ driver, card: stuck })).toBe('Rig has nowhere to swerve');
			expect(battle.canPlayCard({ driver, card: stuck })).toBe(false);
			expect(battle.moveDestinations({ driver, card: stuck })).toEqual([]);

			const hand = buildPlayerHandView({ drivers: [driver], canPlay: (who, played) => battle.canPlayCard({ driver: who, card: played }) });
			expect(hand.playable.has(stuck.id)).toBe(false);
			// Lane Change's one slot is taken too; Bootlegger Turn still has the formation's far end
			expect(hand.playable.has(driver.hand[1].id)).toBe(false);
			expect(hand.playable.has(driver.hand[2].id)).toBe(true);
		});

		test('off the formation\'s end is unplayable', () => {
			play(battle, rig, juke(), { destination: slot(PLAYER_INSIDE, AHEAD) });
			expect(blocker(battle, rig, floorIt())).toBe('Rig has no slot ahead');
			expect(battle.canPlayCard({ driver: driverOf(rig), card: floorIt() })).toBe(false);
		});

		test('needs its picked slot, and a card that picks none takes none', () => {
			expect(play(battle, rig, juke())).toBe(false);
			expect(play(battle, rig, laneChange(), { destination: slot(PLAYER_OUTSIDE, CENTER) })).toBe(false);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
		});
	});

	describe('a move to a named slot', () => {
		test('goes anywhere empty in the formation, under the same slot rules', () => {
			expect(play(battle, bike, bootlegger(), { destination: slot(PLAYER_OUTSIDE, AHEAD) })).toBe(true);
			expect(bike.slot).toEqual(slot(PLAYER_OUTSIDE, AHEAD));

			expect(play(battle, rig, bootlegger(), { destination: slot(PLAYER_OUTSIDE, AHEAD) })).toBe(false);
			expect(play(battle, rig, bootlegger(), { destination: slot(PLAYER_SHOULDER, AHEAD) })).toBe(false);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
		});

		test('never into a reserved slot', () => {
			play(battle, bike, flank(), { target: buggy });
			expect(play(battle, rig, bootlegger(), { destination: slot(PLAYER_INSIDE, BEHIND) })).toBe(false);
		});

		test('with no empty slot in the formation is unplayable', () => {
			battle = createBattle([rig, bike, ...(['outrider', 'pilot_car', 'fuel_hauler', 'med_truck'] as const).map(type => createEscort({ type }))], [buggy]);
			expect(blocker(battle, rig, bootlegger())).toBe('Rig has no empty slot to move to');
		});

		test('Slipstream goes to the slot behind the partner\'s vehicle, and is unplayable when it\'s taken or the partner flanks', () => {
			expect(blocker(battle, bike, slipstream())).toBe('Bike is already in player inside, behind');
			play(battle, rig, bootlegger(), { destination: slot(PLAYER_OUTSIDE, AHEAD) });

			expect(play(battle, bike, slipstream())).toBe(true);
			expect(bike.slot).toEqual(slot(PLAYER_OUTSIDE, CENTER));

			play(battle, rig, flank(), { target: createdSlowRaider(battle) });
			expect(blocker(battle, bike, slipstream())).toBe('Rig is flanking');
		});
	});

	describe('a swap', () => {
		test('trades slots with the partner\'s vehicle, and both have swerved this turn', () => {
			expect(play(battle, rig, leapfrog(), { target: bike })).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, BEHIND));
			expect(bike.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
			expect(battle.swervedThisTurn(rig)).toBe(true);
			expect(battle.swervedThisTurn(bike)).toBe(true);
		});

		test('with an escort needs it next to you, and never spends it', () => {
			const outrider = createEscort({ type: 'outrider' });
			const medTruck = createEscort({ type: 'med_truck' });
			battle = createBattle([rig, bike, outrider, medTruck], [buggy]);

			expect(battle.getTargetBlocker({ driver: driverOf(rig), card: leapfrog(), target: medTruck }))
				.toBe('Med Truck is neither the partner\'s vehicle nor an escort next to Rig');
			expect(play(battle, rig, leapfrog(), { target: outrider })).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
			expect(outrider.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
			expect(outrider.isReady).toBe(true);
		});

		test('never with a flanker, either way round', () => {
			play(battle, bike, flank(), { target: buggy });
			expect(battle.getTargetBlocker({ driver: driverOf(rig), card: leapfrog(), target: bike })).toBe('Bike is flanking and can\'t swerve');
			expect(blocker(battle, bike, leapfrog())).toBe('Bike is flanking and can\'t swerve');
		});
	});

	describe('moving escorts and raiders', () => {
		test('Fall In moves an escort, ready or spent, without spending it', () => {
			const outrider = createEscort({ type: 'outrider' });
			battle = createBattle([rig, bike, outrider], [buggy]);

			expect(battle.moveDestinations({ driver: driverOf(rig), card: fallIn(), target: outrider })).toHaveLength(3);
			expect(play(battle, rig, fallIn(), { target: outrider, destination: slot(PLAYER_OUTSIDE, BEHIND) })).toBe(true);
			expect(outrider.slot).toEqual(slot(PLAYER_OUTSIDE, BEHIND));
			expect(outrider.isReady).toBe(true);

			outrider.spent = true;
			expect(play(battle, rig, fallIn(), { target: outrider, destination: slot(PLAYER_OUTSIDE, AHEAD) })).toBe(true);
			expect(outrider.slot).toEqual(slot(PLAYER_OUTSIDE, AHEAD));
			expect(outrider.spent).toBe(true);
		});

		test('Formation Shift switches every lane, flankers\' reservations included, and spends no escort', () => {
			const outrider = createEscort({ type: 'outrider' });
			battle = createBattle([rig, bike, outrider], [buggy]);
			play(battle, bike, flank(), { target: buggy });

			expect(play(battle, rig, formationShift())).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_OUTSIDE, CENTER));
			expect(outrider.slot).toEqual(slot(PLAYER_OUTSIDE, AHEAD));
			expect(outrider.isReady).toBe(true);
			expect(bike.slot).toEqual(slot(ENEMY_SHOULDER, CENTER));
			expect(bike.flank?.reservedSlot).toEqual(slot(PLAYER_OUTSIDE, BEHIND));
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, CENTER));

			// It drops back to the reservation's new lane
			bike.applyStatusEffect({ name: 'speed_reduction', duration: 2, value: -4 });
			battle.endPlayerTurn();
			expect(bike.slot).toEqual(slot(PLAYER_OUTSIDE, BEHIND));
		});

		test('a shove moves a raider to its outside lane, and an optional one that can\'t happens to nobody', () => {
			expect(play(battle, rig, layOnTheHorn(), { target: buggy })).toBe(true);
			expect(buggy.slot).toEqual(slot(ENEMY_OUTSIDE, CENTER));
			expect(battle.swervedThisTurn(buggy)).toBe(true);

			const blocked = createVehicle('Blocked', 3, slot(ENEMY_INSIDE, CENTER));
			const blocking = createVehicle('Blocking', 3, slot(ENEMY_OUTSIDE, CENTER));
			battle = createBattle([createVehicle('Rig', 1), createVehicle('Bike', 5)], [blocked, blocking]);
			const [driverRig] = battle.playerTeam.vehicles;
			expect(play(battle, driverRig, layOnTheHorn(), { target: blocked })).toBe(true);
			expect(blocked.slot).toEqual(slot(ENEMY_INSIDE, CENTER));
			expect(blocked.hasStatusEffect('speed_reduction')).toBe(true);
		});

		test('a shove never moves a flanker or an ambusher', () => {
			buggy.set({ slot: slot(PLAYER_SHOULDER, CENTER), flank: { reservedSlot: slot(ENEMY_INSIDE, CENTER), outran: rig } });
			expect(battle.getTargetBlocker({ driver: driverOf(bike), card: shove(), target: buggy })).toBe('Buggy is flanking and can\'t swerve');
			buggy.set({ flank: { reservedSlot: null, outran: null } });
			expect(battle.getTargetBlocker({ driver: driverOf(bike), card: shove(), target: buggy })).toBe('Buggy is flanking and can\'t swerve');
		});

		test('Shoulder Check shoves its target a picked row ahead or behind, on a hit', () => {
			expect(battle.getDestinationBlocker({ driver: driverOf(rig), card: shoulderCheck(), target: buggy, destination: slot(ENEMY_OUTSIDE, CENTER) }))
				.toBe('enemy outside, center is not a row ahead of or behind Buggy');
			expect(battle.moveDestinations({ driver: driverOf(rig), card: shoulderCheck(), target: buggy }))
				.toEqual([slot(ENEMY_INSIDE, AHEAD), slot(ENEMY_INSIDE, BEHIND)]);

			expect(play(battle, rig, shoulderCheck(), { target: buggy, destination: slot(ENEMY_INSIDE, AHEAD) })).toBe(true);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, AHEAD));
		});

		test('a drop-back puts a flanker back in its reserved slot: Peel Off for yours, Brake Check for a raider', () => {
			expect(blocker(battle, bike, peelOff())).toBe('Bike isn\'t flanking');
			play(battle, bike, flank(), { target: buggy });
			expect(play(battle, bike, peelOff())).toBe(true);
			expect(bike.slot).toEqual(slot(PLAYER_INSIDE, BEHIND));
			expect(bike.flank).toBeNull();

			buggy.set({ slot: slot(PLAYER_SHOULDER, CENTER), flank: { reservedSlot: slot(ENEMY_INSIDE, CENTER), outran: rig } });
			expect(play(battle, rig, brakeCheck(), { target: buggy })).toBe(true);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, CENTER));
			expect(buggy.flank).toBeNull();
		});

		test('Peel Off needs a reserved slot; an ambusher has none', () => {
			bike.set({ slot: slot(ENEMY_SHOULDER, CENTER), flank: { reservedSlot: null, outran: null } });
			expect(blocker(battle, bike, peelOff())).toBe('Bike has no reserved slot to drop back to');
		});
	});

	describe('cards that move, then reach', () => {
		test('Strafe\'s target is judged from the slot it picks', () => {
			buggy.set({ slot: slot(ENEMY_INSIDE, AHEAD) });
			const driver = driverOf(rig);
			// Range 2 from where the Rig is, 1 from inside ahead
			expect(battle.getTargetBlocker({ driver, card: strafe(), target: buggy })).toBeNull();
			expect(battle.getTargetBlocker({ driver, card: strafe(), target: buggy, destination: slot(PLAYER_OUTSIDE, CENTER) }))
				.toBe('Target out of range: 3 > 1');
			expect(play(battle, rig, strafe(), { target: buggy, destination: slot(PLAYER_OUTSIDE, CENTER) })).toBe(false);

			expect(play(battle, rig, strafe(), { target: buggy, destination: slot(PLAYER_INSIDE, AHEAD) })).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
			expect(buggy.structure).toBeLessThan(20);
		});

		test('Cut Off\'s target is judged from the row ahead', () => {
			buggy.set({ slot: slot(ENEMY_INSIDE, AHEAD) });
			expect(battle.getTargetBlocker({ driver: driverOf(rig), card: cutOff(), target: buggy })).toBeNull();
			expect(play(battle, rig, cutOff(), { target: buggy })).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
			expect(buggy.hasStatusEffect('speed_reduction')).toBe(true);
		});
	});

	describe('the preview', () => {
		test('a planned raider card the swerve takes out of range fizzles as the swerve lands', () => {
			driverOf(buggy).set({ hand: [pointBlank()], adrenaline: 5 });
			battle.planEnemyTurn();
			expect(battle.getIntents(buggy).map(intent => intent.target)).toEqual([rig.id]);

			expect(play(battle, rig, laneChange())).toBe(true);
			expect(battle.getIntents(buggy)).toEqual([]);

			battle.endPlayerTurn();
			expect(battle.getMessages().some(message => message.type === 'fizzle' && message.message.includes('out of range'))).toBe(true);
			expect(rig.structure).toBe(20);
		});

		test('shows the fizzle while the move is only aimed, from the slot picked', () => {
			driverOf(buggy).set({ hand: [pointBlank()], adrenaline: 5 });
			battle.planEnemyTurn();
			const driver = driverOf(rig);
			const aimed = juke();
			driver.set({ hand: [aimed], adrenaline: 5 });

			expect(battle.getAllIntents({ preview: { driver, card: aimed, destination: slot(PLAYER_INSIDE, AHEAD) } }).get(buggy)).toBeUndefined();
			// Nothing has moved yet
			expect(battle.getIntents(buggy)).toHaveLength(1);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
		});
	});

	describe('Heavy', () => {
		test('a movement card\'s speed doesn\'t count while Heavy, and the move still happens', () => {
			rig.set({ armor: 4 });
			expect(rig.isHeavy).toBe(true);
			expect(play(battle, rig, floorIt())).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
			expect(rig.speed).toBe(3);
		});

		test('without plating the same card is +2 Speed', () => {
			expect(play(battle, rig, floorIt())).toBe(true);
			expect(rig.speed).toBe(5);
		});
	});

	describe('swerved this turn', () => {
		test('is set by any change of slot, one step or further, a flank included', () => {
			expect(battle.swervedThisTurn(rig)).toBe(false);
			play(battle, rig, bootlegger(), { destination: slot(PLAYER_OUTSIDE, AHEAD) });
			expect(battle.swervedThisTurn(rig)).toBe(true);
			expect(battle.swervedThisTurn(bike)).toBe(false);

			play(battle, bike, flank(), { target: buggy });
			expect(battle.swervedThisTurn(bike)).toBe(true);
		});

		test('is cleared when the next turn starts', () => {
			play(battle, rig, laneChange());
			battle.endPlayerTurn();
			expect(battle.isPlayerTurn).toBe(true);
			expect(battle.swervedThisTurn(rig)).toBe(false);
		});

		test('reads through a projection, which tracks its own moves', () => {
			const driver = driverOf(rig);
			const played = laneChange();
			driver.set({ hand: [played], adrenaline: 5 });
			const board = new BoardProjection({ battle });

			board.apply({ card: played, driver, target: null });
			expect(board.slotOf(rig)).toEqual(slot(PLAYER_OUTSIDE, CENTER));
			expect(board.swervedThisTurn(rig)).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
			expect(battle.swervedThisTurn(rig)).toBe(false);
		});
	});

	describe('the effect shape', () => {
		test('reads every move the cards need', () => {
			expect(moveSpecOf({ type: 'change_position', position: 'swerve', to: 'pick', target: 'self' }))
				.toEqual({ kind: 'swerve', mover: 'caster', to: 'pick', optional: false });
			expect(moveSpecOf({ type: 'change_position', position: 'move', to: 'pick', target: 'target' }))
				.toEqual({ kind: 'move', mover: 'target', to: 'pick', optional: false });
			expect(moveSpecOf({ type: 'change_position', position: 'drop_back', target: 'target', optional: true }))
				.toEqual({ kind: 'drop_back', mover: 'target', optional: true });
		});

		test('fails loud on a move the battle doesn\'t know', () => {
			expect(() => moveSpecOf({ type: 'change_position', position: 'teleport', target: 'self' })).toThrow('not a move the battle knows');
			expect(() => moveSpecOf({ type: 'change_position', position: 'swerve', to: 'sideways', target: 'self' })).toThrow('a swerve goes');
			expect(() => moveSpecOf({ type: 'change_position', position: 'swap', target: 'self' })).toThrow('its target is "target"');
		});
	});
});

/** A speed 0 raider in the enemy outside lane, so even the Rig can outrun it */
function createdSlowRaider(battle: Battle): Vehicle {
	const crawler = createVehicle('Crawler', -2, slot(ENEMY_OUTSIDE, AHEAD));
	battle.enemyTeam.addVehicle(crawler);
	return crawler;
}
