import { Battle } from './Battle';
import { Card, CardData } from './Card';
import { Driver } from './Driver';
import { createEscort } from './Escort';
import { previewAim } from './AimPreview';
import { boardConditionOf, conditionHolds } from './EffectConditions';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { Team, TeamType } from './Team';
import { EVADE_BOOST, Vehicle } from './Vehicle';
import { rollRewardCards } from '../campaign/RunRewards';
import { Rng } from '../core/Rng';
import { statusChipContent } from '../ui/StatusChip';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import cardsFile from '../data/cards.json';

/**
 * DDB-549: the movement cards whose destination, if any, follows from the
 * board (Combat Rules, Movement cards), as cards.json has them. The swerve
 * model itself is Swerve.test.ts.
 */

const cardData = (type: string): CardData => {
	const data = (cardsFile as unknown as { cards: CardData[] }).cards.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return data;
};
const realCard = (type: string): Card => new Card({ ...cardData(type) });
const upgradedCard = (type: string): Card => new Card({ ...cardData(type), upgraded: true });

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });
const { PLAYER_SHOULDER, PLAYER_OUTSIDE, PLAYER_INSIDE, ENEMY_INSIDE, ENEMY_OUTSIDE, ENEMY_SHOULDER } = RoadLane;
const { AHEAD, CENTER, BEHIND } = RoadRow;

// Total speed is baseSpeed plus the test driver's speed skill of 2. Test
// drivers have gunnery, evade, and ramming 5.
const createVehicle = (name: string, baseSpeed: number, startSlot: RoadSlot | null = null): Vehicle => {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({ hitpoints: 100, maxHitpoints: 100 });
	return new Vehicle({
		name,
		armor: 0,
		maxArmor: 0,
		structure: 40,
		maxStructure: 40,
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

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

/** Play one card from the vehicle's driver, with a fresh hand of just it */
const play = (battle: Battle, vehicle: Vehicle, played: Card, target?: Vehicle): boolean => {
	const driver = driverOf(vehicle);
	driver.set({ hand: [played], adrenaline: 5 });
	return battle.playCard({ driver, cardIndex: 0, targetVehicle: target });
};

const blocker = (battle: Battle, vehicle: Vehicle, played: Card): string | null =>
	battle.getCardBlocker({ driver: driverOf(vehicle), card: played });

const flankOnto = (vehicle: Vehicle, shoulder: RoadSlot, reservedSlot: RoadSlot | null, outran: Vehicle | null): void => {
	vehicle.set({ slot: shoulder, flank: { reservedSlot, outran } });
};

describe('fixed-destination movement cards', () => {
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

	describe('Lane Change', () => {
		test('swerves to the other lane, same row, for 1 Adrenaline, 0 upgraded', () => {
			expect(realCard('lane_change').cost).toBe(1);
			expect(upgradedCard('lane_change').cost).toBe(0);
			expect(play(battle, rig, realCard('lane_change'))).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_OUTSIDE, CENTER));
			expect(battle.swervedThisTurn(rig)).toBe(true);
		});

		test('is unplayable when the other lane\'s slot is taken or reserved, or while flanking', () => {
			const hauler = createEscort({ type: 'fuel_hauler' });
			battle = createBattle([rig, bike, hauler], [buggy]);
			expect(hauler.slot).toEqual(slot(PLAYER_OUTSIDE, CENTER));
			expect(blocker(battle, rig, realCard('lane_change'))).toBe('player outside, center is taken by Fuel Hauler');

			hauler.set({ slot: slot(PLAYER_OUTSIDE, AHEAD) });
			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_OUTSIDE, CENTER), buggy);
			expect(blocker(battle, rig, realCard('lane_change'))).toBe('player outside, center is reserved for Bike');
			expect(blocker(battle, bike, realCard('lane_change'))).toBe('Bike is flanking and can\'t swerve');
			expect(battle.canPlayCard({ driver: driverOf(bike), card: realCard('lane_change') })).toBe(false);
		});
	});

	describe('Floor It', () => {
		test('swerves a row ahead and is +2 Speed until the end of the next enemy turn (call 286)', () => {
			expect(play(battle, rig, realCard('floor_it'))).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
			expect(rig.speed).toBe(5);

			battle.endPlayerTurn({ stepEnemyTurn: true });
			expect(rig.speed).toBe(5);
			battle.runEnemyTurn();
			expect(battle.isPlayerTurn).toBe(true);
			expect(rig.speed).toBe(3);
		});

		test('upgraded, the speed lasts 2 turns', () => {
			const card = upgradedCard('floor_it');
			expect(card.displaySummary).toBe('[Swerve] ahead. +2 Speed for 2 turns.');
			expect(play(battle, rig, card)).toBe(true);
			battle.endPlayerTurn();
			expect(rig.speed).toBe(5);
			battle.endPlayerTurn();
			expect(rig.speed).toBe(3);
		});

		test('is unplayable from the ahead row, into a taken slot, or while flanking', () => {
			expect(blocker(battle, bike, realCard('floor_it'))).toBe('player inside, center is taken by Rig');
			rig.set({ slot: slot(PLAYER_INSIDE, AHEAD) });
			expect(blocker(battle, rig, realCard('floor_it'))).toBe('Rig has no slot ahead');
			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, BEHIND), buggy);
			expect(blocker(battle, bike, realCard('floor_it'))).toBe('Bike is flanking and can\'t swerve');
		});

		test('while Heavy still swerves, without the speed', () => {
			rig.set({ armor: 4 });
			expect(play(battle, rig, realCard('floor_it'))).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
			expect(rig.speed).toBe(3);
		});
	});

	describe('Hard Brake', () => {
		test('swerves a row behind and gains 4 Shield, 6 upgraded', () => {
			bike.set({ slot: slot(PLAYER_OUTSIDE, BEHIND) });
			expect(play(battle, rig, realCard('hard_brake'))).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, BEHIND));
			expect(rig.shield).toBe(4);

			expect(play(battle, bike, upgradedCard('hard_brake'))).toBe(false);
			bike.set({ slot: slot(PLAYER_OUTSIDE, CENTER) });
			expect(play(battle, bike, upgradedCard('hard_brake'))).toBe(true);
			expect(bike.shield).toBe(6);
		});

		test('is unplayable into a taken slot, from the behind row, or while flanking, and gives no Shield then', () => {
			expect(blocker(battle, rig, realCard('hard_brake'))).toBe('player inside, behind is taken by Bike');
			expect(play(battle, rig, realCard('hard_brake'))).toBe(false);
			expect(rig.shield ?? 0).toBe(0);
			expect(blocker(battle, bike, realCard('hard_brake'))).toBe('Bike has no slot behind');
			flankOnto(rig, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, CENTER), buggy);
			expect(blocker(battle, rig, realCard('hard_brake'))).toBe('Rig is flanking and can\'t swerve');
		});
	});

	describe('Slipstream', () => {
		test('moves to the empty slot behind the partner\'s vehicle and is +3 Speed for 2 turns', () => {
			bike.set({ slot: slot(PLAYER_OUTSIDE, AHEAD) });
			expect(play(battle, bike, realCard('slipstream'))).toBe(true);
			expect(bike.slot).toEqual(slot(PLAYER_INSIDE, BEHIND));
			expect(bike.speed).toBe(10);
			expect(battle.swervedThisTurn(bike)).toBe(true);
			battle.endPlayerTurn();
			expect(bike.speed).toBe(10);
			battle.endPlayerTurn();
			expect(bike.speed).toBe(7);
		});

		test('upgraded, it also draws 1', () => {
			bike.set({ slot: slot(PLAYER_OUTSIDE, AHEAD) });
			driverOf(bike).deck?.addCards([realCard('point_blank'), realCard('point_blank')]);
			expect(play(battle, bike, upgradedCard('slipstream'))).toBe(true);
			expect(driverOf(bike).hand).toHaveLength(1);
			expect(play(battle, rig, realCard('slipstream'))).toBe(false);
		});

		test('is unplayable when that slot is taken, there is none, or either vehicle is flanking', () => {
			const hauler = createEscort({ type: 'fuel_hauler' });
			battle = createBattle([rig, bike, hauler], [buggy]);
			bike.set({ slot: slot(PLAYER_OUTSIDE, AHEAD) });
			hauler.set({ slot: slot(PLAYER_INSIDE, BEHIND) });
			expect(blocker(battle, bike, realCard('slipstream'))).toBe('player inside, behind is taken by Fuel Hauler');

			// Already in that slot (call 314)
			hauler.set({ slot: slot(PLAYER_OUTSIDE, CENTER) });
			bike.set({ slot: slot(PLAYER_INSIDE, BEHIND) });
			expect(blocker(battle, bike, realCard('slipstream'))).toBe('Bike is already in player inside, behind');
			// The partner in the behind row has nothing behind it
			expect(blocker(battle, rig, realCard('slipstream'))).toBe('There is no slot behind Bike');

			flankOnto(rig, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, CENTER), buggy);
			bike.set({ slot: slot(PLAYER_OUTSIDE, AHEAD) });
			expect(blocker(battle, bike, realCard('slipstream'))).toBe('Rig is flanking');
			expect(blocker(battle, rig, realCard('slipstream'))).toBe('Rig is flanking and can\'t swerve');
		});

		test('with no partner on the road is unplayable', () => {
			battle = createBattle([rig], [buggy]);
			expect(blocker(battle, rig, realCard('slipstream'))).toBe('Rig has no partner to slip in behind');
		});
	});

	describe('Peel Off', () => {
		test('drops a flanker back to its reserved slot for 0 Adrenaline and draws 1, 2 upgraded', () => {
			const card = realCard('peel_off');
			expect(card.cost).toBe(0);
			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, BEHIND), buggy);
			driverOf(bike).deck?.addCards([realCard('point_blank'), realCard('point_blank'), realCard('point_blank')]);

			expect(play(battle, bike, card)).toBe(true);
			expect(bike.slot).toEqual(slot(PLAYER_INSIDE, BEHIND));
			expect(bike.flank).toBeNull();
			expect(driverOf(bike).hand).toHaveLength(1);
			expect(battle.swervedThisTurn(bike)).toBe(true);

			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, BEHIND), buggy);
			expect(play(battle, bike, upgradedCard('peel_off'))).toBe(true);
			expect(driverOf(bike).hand).toHaveLength(2);
		});

		test('is unplayable unless flanking with a reserved slot', () => {
			expect(blocker(battle, bike, realCard('peel_off'))).toBe('Bike isn\'t flanking');
			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), null, null);
			expect(blocker(battle, bike, realCard('peel_off'))).toBe('Bike has no reserved slot to drop back to');
			expect(play(battle, bike, realCard('peel_off'))).toBe(false);
			expect(bike.slot).toEqual(slot(ENEMY_SHOULDER, CENTER));
		});
	});

	describe('Formation Shift', () => {
		test('switches every vehicle in the formation to its other lane, spends no escort, and exhausts', () => {
			const outrider = createEscort({ type: 'outrider' });
			battle = createBattle([rig, bike, outrider], [buggy]);
			const card = realCard('formation_shift');

			expect(play(battle, rig, card)).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_OUTSIDE, CENTER));
			expect(bike.slot).toEqual(slot(PLAYER_OUTSIDE, BEHIND));
			expect(outrider.slot).toEqual(slot(PLAYER_OUTSIDE, AHEAD));
			expect(outrider.isReady).toBe(true);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, CENTER));
			expect(driverOf(rig).exhausted).toEqual([card]);
			expect(driverOf(rig).discard).not.toContain(card);
		});

		test('upgraded, it doesn\'t exhaust and its text drops Exhaust', () => {
			const card = upgradedCard('formation_shift');
			expect(card.hasTag('exhaust')).toBe(false);
			expect(card.displaySummary).not.toContain('Exhaust');
			expect(card.displayDescription).not.toContain('Exhaust');
			expect(realCard('formation_shift').hasTag('exhaust')).toBe(true);

			expect(play(battle, rig, card)).toBe(true);
			expect(driverOf(rig).exhausted ?? []).toEqual([]);
			expect(driverOf(rig).discard).toContain(card);
		});

		test('plays while its caster flanks, switching the reservation (call 291)', () => {
			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, BEHIND), buggy);
			expect(blocker(battle, bike, realCard('formation_shift'))).toBeNull();
			expect(play(battle, bike, realCard('formation_shift'))).toBe(true);
			expect(bike.slot).toEqual(slot(ENEMY_SHOULDER, CENTER));
			expect(bike.flank?.reservedSlot).toEqual(slot(PLAYER_OUTSIDE, BEHIND));
		});
	});

	describe('Weave', () => {
		test('is +1 Evade until the end of the next enemy turn', () => {
			expect(play(battle, rig, realCard('weave'))).toBe(true);
			expect(rig.evadeBoost).toBe(1);
			expect(rig.statusEffects).toEqual([expect.objectContaining({ name: EVADE_BOOST, value: 1, duration: 1 })]);
			expect(battle.hitCheck({ attacker: buggy, caster: driverOf(buggy), defender: rig })?.evade).toBe(6);

			battle.endPlayerTurn({ stepEnemyTurn: true });
			expect(rig.evadeBoost).toBe(1);
			battle.runEnemyTurn();
			expect(rig.evadeBoost).toBe(0);
		});

		test('is +2 once the vehicle has swerved this turn, and +2 or +3 upgraded', () => {
			play(battle, rig, realCard('lane_change'));
			expect(play(battle, rig, realCard('weave'))).toBe(true);
			expect(rig.evadeBoost).toBe(2);

			expect(play(battle, bike, upgradedCard('weave'))).toBe(true);
			expect(bike.evadeBoost).toBe(2);
			bike.set({ statusEffects: [] });
			play(battle, bike, realCard('lane_change'));
			expect(play(battle, bike, upgradedCard('weave'))).toBe(true);
			expect(bike.evadeBoost).toBe(3);
		});

		test('counts any change of slot this turn, a flank or being moved included (call 290)', () => {
			const outrider = createEscort({ type: 'outrider' });
			battle = createBattle([rig, bike, outrider], [buggy]);
			play(battle, bike, realCard('formation_shift'));
			expect(play(battle, rig, realCard('weave'))).toBe(true);
			expect(rig.evadeBoost).toBe(2);
		});

		test('stacks with another Evade (call 312)', () => {
			play(battle, rig, realCard('weave'));
			play(battle, rig, realCard('weave'));
			expect(rig.evadeBoost).toBe(2);
		});

		test('makes a planned raider shot that would have hit miss, and the hit check says why', () => {
			// Point Blank hits on gunnery 5 > evade 5 - 1; +1 Evade makes it 5 > 5
			driverOf(buggy).set({ hand: [realCard('point_blank')], adrenaline: 5 });
			battle.planEnemyTurn();
			expect(battle.getIntents(buggy).map(intent => intent.target)).toEqual([rig.id]);

			play(battle, rig, realCard('weave'));
			battle.endPlayerTurn();
			expect(rig.structure).toBe(40);
			expect(battle.getMessages().some(message => message.type === 'miss' && message.message.includes('evade 6 - 1'))).toBe(true);
		});

		test('without Weave the same shot hits', () => {
			driverOf(buggy).set({ hand: [realCard('point_blank')], adrenaline: 5 });
			battle.planEnemyTurn();
			battle.endPlayerTurn();
			expect(rig.structure).toBeLessThan(40);
		});

		test('raises evade against a ram too', () => {
			expect(battle.checkHit({ attacker: buggy, caster: driverOf(buggy), defender: rig, attackType: 'ramming' })).toBe(true);
			play(battle, rig, realCard('weave'));
			expect(battle.checkHit({ attacker: buggy, caster: driverOf(buggy), defender: rig, attackType: 'ramming' })).toBe(false);
		});

		test('lands in the preview while only aimed, so the projection\'s hit checks count it', () => {
			const driver = driverOf(rig);
			const aimed = realCard('weave');
			driver.set({ hand: [aimed], adrenaline: 5 });
			expect(battle.projectEnemyTurnStart({ preview: { driver, card: aimed } }).evadeBoostOf(rig)).toBe(1);
			expect(rig.evadeBoost).toBe(0);

			play(battle, rig, realCard('lane_change'));
			driver.set({ hand: [aimed], adrenaline: 5 });
			expect(battle.projectEnemyTurnStart({ preview: { driver, card: aimed } }).evadeBoostOf(rig)).toBe(2);
		});

		test('shows on the status row as a buff chip that names its value', () => {
			expect(statusChipContent({ name: EVADE_BOOST, duration: 1, value: 2 })).toEqual(expect.objectContaining({
				kind: 'status',
				tone: 'buff',
				count: 1,
				title: 'Evade +2'
			}));
		});
	});

	describe('Point Man', () => {
		const sharpshooter = (vehicle: Vehicle): void => {
			driverOf(vehicle).set({ skills: { ...driverOf(vehicle).skills, gunnery: 9 } });
		};

		test('deals 1 at Range 2, and 4 from the ahead row; upgraded 2, or 5', () => {
			sharpshooter(rig);
			buggy.set({ shield: 50 });
			expect(play(battle, rig, realCard('point_man'), buggy)).toBe(true);
			expect(buggy.shield).toBe(49);

			rig.set({ slot: slot(PLAYER_INSIDE, AHEAD) });
			expect(play(battle, rig, realCard('point_man'), buggy)).toBe(true);
			expect(buggy.shield).toBe(45);
			expect(play(battle, rig, upgradedCard('point_man'), buggy)).toBe(true);
			expect(buggy.shield).toBe(40);

			rig.set({ slot: slot(PLAYER_INSIDE, CENTER) });
			expect(play(battle, rig, upgradedCard('point_man'), buggy)).toBe(true);
			expect(buggy.shield).toBe(38);
		});

		test('counts a flanker\'s shoulder row, with the flank\'s 50% on top (call 310)', () => {
			sharpshooter(rig);
			buggy.set({ shield: 50, slot: slot(ENEMY_INSIDE, AHEAD) });
			flankOnto(rig, slot(ENEMY_SHOULDER, AHEAD), slot(PLAYER_INSIDE, CENTER), buggy);
			expect(play(battle, rig, realCard('point_man'), buggy)).toBe(true);
			expect(buggy.shield).toBe(44);
		});

		test('reaches only Range 2', () => {
			buggy.set({ slot: slot(ENEMY_OUTSIDE, AHEAD) });
			expect(battle.getTargetBlocker({ driver: driverOf(rig), card: realCard('point_man'), target: buggy })).toBe('Target out of range: 3 > 2');
		});

		test('the aim preview counts the ahead row as play does', () => {
			sharpshooter(rig);
			rig.set({ slot: slot(PLAYER_INSIDE, AHEAD) });
			buggy.set({ slot: slot(ENEMY_INSIDE, AHEAD) });
			const card = realCard('point_man');
			const preview = previewAim({ battle, driver: driverOf(rig), card, target: buggy });
			const before = buggy.structure;
			expect(play(battle, rig, card, buggy)).toBe(true);
			expect(preview.losses.structure).toBe(before - buggy.structure);
			expect(preview.losses.structure).toBe(2);
		});

		test('misses against a raider\'s Evade, which the aim preview shows', () => {
			driverOf(rig).set({ skills: { ...driverOf(rig).skills, gunnery: 6 } });
			buggy.applyStatusEffect({ name: EVADE_BOOST, duration: 1, value: 1 });
			const preview = previewAim({ battle, driver: driverOf(rig), card: realCard('point_man'), target: buggy });
			expect(preview.check).toEqual(expect.objectContaining({ evade: 6, hits: false }));
			expect(preview.losses.structure).toBe(0);
		});
	});

	describe('Tail Gunner', () => {
		beforeEach(() => {
			driverOf(rig).set({ skills: { ...driverOf(rig).skills, gunnery: 9 } });
		});

		test('deals 1, +2 on a target in a row ahead of yours; upgraded +3', () => {
			buggy.set({ shield: 50, slot: slot(ENEMY_INSIDE, AHEAD) });
			expect(play(battle, rig, realCard('tail_gunner'), buggy)).toBe(true);
			expect(buggy.shield).toBe(47);
			expect(play(battle, rig, upgradedCard('tail_gunner'), buggy)).toBe(true);
			expect(buggy.shield).toBe(43);
		});

		test('deals 1 to a target level with you or behind', () => {
			buggy.set({ shield: 50 });
			expect(play(battle, rig, realCard('tail_gunner'), buggy)).toBe(true);
			expect(buggy.shield).toBe(49);
			buggy.set({ slot: slot(ENEMY_INSIDE, BEHIND) });
			expect(play(battle, rig, realCard('tail_gunner'), buggy)).toBe(true);
			expect(buggy.shield).toBe(48);
		});

		test('reads a flanker\'s row as anyone\'s', () => {
			const raider = createVehicle('Raider', 3);
			battle = createBattle([rig, bike], [buggy, raider]);
			// Range 2 from the outside lane's center row
			rig.set({ slot: slot(PLAYER_OUTSIDE, CENTER) });
			flankOnto(raider, slot(PLAYER_SHOULDER, AHEAD), slot(ENEMY_OUTSIDE, AHEAD), rig);
			raider.set({ shield: 50 });
			expect(play(battle, rig, realCard('tail_gunner'), raider)).toBe(true);
			expect(raider.shield).toBe(47);
		});
	});

	describe('the rewards', () => {
		const ours = ['lane_change', 'floor_it', 'hard_brake', 'slipstream', 'peel_off', 'formation_shift', 'weave', 'point_man', 'tail_gunner'];

		test('have the rarities and costs Combat Rules gives', () => {
			expect(ours.map(type => [type, cardData(type).rarity, cardData(type).cost])).toEqual([
				['lane_change', 'common', 1],
				['floor_it', 'common', 1],
				['hard_brake', 'common', 1],
				['slipstream', 'uncommon', 1],
				['peel_off', 'common', 0],
				['formation_shift', 'rare', 2],
				['weave', 'uncommon', 1],
				['point_man', 'common', 1],
				['tail_gunner', 'common', 1]
			]);
		});

		test('are each offered by the card reward', () => {
			const offered = new Set(Array.from({ length: 300 }, (_, roll) =>
				rollRewardCards({ rng: new Rng({ seed: 549 }).fork('reward', roll), ownsEscort: false })).flat());
			for (const type of ours) expect(offered).toContain(type);
		});
	});

	describe('row and swerve conditions', () => {
		const at = (row: RoadRow): RoadSlot => slot(PLAYER_INSIDE, row);
		const enemyAt = (row: RoadRow): RoadSlot => slot(ENEMY_INSIDE, row);

		test('read rows on any lane', () => {
			expect(conditionHolds(boardConditionOf('caster_row_ahead'), { casterSlot: slot(ENEMY_SHOULDER, AHEAD), targetSlot: null, casterSwerved: false })).toBe(true);
			expect(conditionHolds(boardConditionOf('caster_row_behind'), { casterSlot: at(CENTER), targetSlot: null, casterSwerved: false })).toBe(false);
			expect(conditionHolds(boardConditionOf('target_row_ahead'), { casterSlot: at(BEHIND), targetSlot: enemyAt(CENTER), casterSwerved: false })).toBe(true);
			expect(conditionHolds(boardConditionOf('target_row_ahead'), { casterSlot: at(CENTER), targetSlot: enemyAt(CENTER), casterSwerved: false })).toBe(false);
			expect(conditionHolds(boardConditionOf('target_row_behind'), { casterSlot: at(AHEAD), targetSlot: enemyAt(BEHIND), casterSwerved: false })).toBe(true);
			expect(conditionHolds(boardConditionOf('target_row_same'), { casterSlot: at(AHEAD), targetSlot: enemyAt(AHEAD), casterSwerved: false })).toBe(true);
			expect(conditionHolds(boardConditionOf('caster_swerved'), { casterSlot: null, targetSlot: null, casterSwerved: true })).toBe(true);
		});

		test('fail loud on one the battle doesn\'t know', () => {
			expect(() => boardConditionOf('caster_row_sideways')).toThrow('names no row');
			expect(() => boardConditionOf('target_row_diagonal')).toThrow('names no relation');
			expect(() => boardConditionOf('caster_happy')).toThrow('not a condition the battle knows');
		});
	});
});
