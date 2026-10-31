import { Battle } from './Battle';
import { Card, CardData } from './Card';
import { Driver } from './Driver';
import { createEscort } from './Escort';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { Team, TeamType } from './Team';
import { EVADE_BOOST, Vehicle } from './Vehicle';
import { rollRewardCards } from '../campaign/RunRewards';
import { Rng } from '../core/Rng';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import cardsFile from '../data/cards.json';

/**
 * The slot-pick movement cards (DDB-551): Juke, Bootlegger Turn, Strafe,
 * Fall In, Leapfrog, and Shoulder Check, as cards.json has them. Combat
 * Rules, Movement cards; docs/AI_TECHNICAL_DECISIONS/movement-cards.md. The
 * swerve model is Swerve.test.ts, and picking the slot on the combat screen
 * is CombatScreenSlotTargeting.test.ts.
 */

const cardData = (type: string): CardData => {
	const data = (cardsFile as unknown as { cards: CardData[] }).cards.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return data;
};
const realCard = (type: string, upgraded = false): Card => new Card({ ...cardData(type), upgraded });

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

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

/** Play one card from the vehicle's driver, with a fresh hand of just it */
const play = (battle: Battle, vehicle: Vehicle, played: Card, { target, destination }: { target?: Vehicle; destination?: RoadSlot } = {}): boolean => {
	const driver = driverOf(vehicle);
	driver.set({ hand: [played], adrenaline: 5 });
	return battle.playCard({ driver, cardIndex: 0, targetVehicle: target, destination });
};

const cardBlocker = (battle: Battle, vehicle: Vehicle, played: Card): string | null =>
	battle.getCardBlocker({ driver: driverOf(vehicle), card: played });

const targetBlocker = (battle: Battle, vehicle: Vehicle, played: Card, target: Vehicle, destination: RoadSlot | null = null): string | null =>
	battle.getTargetBlocker({ driver: driverOf(vehicle), card: played, target, destination });

const destinationBlocker = (battle: Battle, vehicle: Vehicle, played: Card, destination: RoadSlot, target: Vehicle | null = null): string | null =>
	battle.getDestinationBlocker({ driver: driverOf(vehicle), card: played, target, destination });

const withSkill = (vehicle: Vehicle, skill: 'gunnery' | 'ramming' | 'evade', value: number): void => {
	driverOf(vehicle).set({ skills: { ...driverOf(vehicle).skills, [skill]: value } });
};

const flankOnto = (vehicle: Vehicle, shoulder: RoadSlot, reservedSlot: RoadSlot | null, outran: Vehicle | null): void => {
	vehicle.set({ slot: shoulder, flank: { reservedSlot, outran } });
};

/** Cards in the deck for a draw to take */
const stockDeck = (vehicle: Vehicle, count: number): void => {
	driverOf(vehicle).deck?.addCards(Array.from({ length: count }, () => realCard('point_blank')));
};

/** The raider's plan for the coming enemy turn, from a hand of these cards, planned by the default AI */
const planWith = (battle: Battle, raider: Vehicle, hand: Card[]): void => {
	driverOf(raider).set({ hand, adrenaline: 5 });
	battle.planEnemyTurn();
};

const intentTargets = (battle: Battle, raider: Vehicle): (string | null)[] =>
	battle.getIntents(raider).map(intent => intent.target);

/**
 * The fizzle a card here causes: the raider's planned card shows while the
 * player's card is only aimed at its slot, drops from the preview the moment
 * that card would land and once it's played, and fizzles in the enemy turn
 * with this log line.
 */
const expectFizzle = ({ battle, raider, caster, played, target, destination, line }: {
	battle: Battle;
	raider: Vehicle;
	caster: Vehicle;
	played: Card;
	target?: Vehicle;
	destination?: RoadSlot;
	line: string;
}): void => {
	const driver = driverOf(caster);
	driver.set({ hand: [played], adrenaline: 5 });
	expect(battle.getIntents(raider)).toHaveLength(1);
	expect(battle.getAllIntents({ preview: { driver, card: played, target, destination } }).get(raider)).toBeUndefined();

	expect(battle.playCard({ driver, cardIndex: 0, targetVehicle: target, destination })).toBe(true);
	expect(battle.getIntents(raider)).toEqual([]);

	battle.endPlayerTurn();
	expect(battle.getMessages().filter(message => message.type === 'fizzle').map(message => message.message)).toContain(line);
};

describe('slot-pick movement cards', () => {
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

	/** A convoy whose formation leaves the Rig nowhere to swerve: an escort ahead of it and one beside it, the Bike behind */
	const boxInRig = (): void => {
		bike.set({ slot: slot(PLAYER_INSIDE, BEHIND), flank: null });
		const outrider = createEscort({ type: 'outrider' });
		const hauler = createEscort({ type: 'fuel_hauler' });
		battle = createBattle([rig, bike, outrider, hauler], [buggy]);
		expect([outrider.slot, hauler.slot]).toEqual([slot(PLAYER_INSIDE, AHEAD), slot(PLAYER_OUTSIDE, CENTER)]);
	};

	describe('Juke', () => {
		test('swerves to the slot next to you that you pick and draws 1, 2 upgraded, for 1 Adrenaline', () => {
			expect(realCard('juke').cost).toBe(1);
			expect(realCard('juke', true).cost).toBe(1);
			stockDeck(rig, 3);

			expect(play(battle, rig, realCard('juke'), { destination: slot(PLAYER_OUTSIDE, CENTER) })).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_OUTSIDE, CENTER));
			expect(battle.swervedThisTurn(rig)).toBe(true);
			expect(driverOf(rig).hand).toHaveLength(1);

			expect(play(battle, rig, realCard('juke', true), { destination: slot(PLAYER_OUTSIDE, AHEAD) })).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_OUTSIDE, AHEAD));
			expect(driverOf(rig).hand).toHaveLength(2);
		});

		test('offers only the empty slots next to you: never diagonal, taken, reserved, or off the formation', () => {
			const juke = realCard('juke');
			expect(battle.moveDestinations({ driver: driverOf(rig), card: juke })).toEqual([slot(PLAYER_OUTSIDE, CENTER), slot(PLAYER_INSIDE, AHEAD)]);
			expect(destinationBlocker(battle, rig, juke, slot(PLAYER_OUTSIDE, AHEAD))).toBe('player outside, ahead is not next to Rig');
			expect(destinationBlocker(battle, rig, juke, slot(PLAYER_INSIDE, BEHIND))).toBe('player inside, behind is taken by Bike');
			expect(destinationBlocker(battle, rig, juke, slot(ENEMY_INSIDE, CENTER))).toBe('enemy inside, center is not in Rig\'s formation');

			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, BEHIND), buggy);
			expect(destinationBlocker(battle, rig, juke, slot(PLAYER_INSIDE, BEHIND))).toBe('player inside, behind is reserved for Bike');
			expect(play(battle, rig, juke, { destination: slot(PLAYER_INSIDE, BEHIND) })).toBe(false);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
		});

		test('is unplayable while flanking or with every slot next to you filled, draws nothing then, and needs its slot', () => {
			expect(play(battle, rig, realCard('juke'))).toBe(false);

			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, BEHIND), buggy);
			expect(cardBlocker(battle, bike, realCard('juke'))).toBe('Bike is flanking and can\'t swerve');

			boxInRig();
			stockDeck(rig, 2);
			expect(cardBlocker(battle, rig, realCard('juke'))).toBe('Rig has nowhere to swerve');
			expect(battle.canPlayCard({ driver: driverOf(rig), card: realCard('juke') })).toBe(false);
			expect(play(battle, rig, realCard('juke'), { destination: slot(PLAYER_OUTSIDE, CENTER) })).toBe(false);
			expect(driverOf(rig).hand).toHaveLength(1);
		});

		test('swerving out of a planned raider card\'s range fizzles it', () => {
			planWith(battle, buggy, [realCard('point_blank')]);
			expect(intentTargets(battle, buggy)).toEqual([rig.id]);

			expectFizzle({
				battle, raider: buggy, caster: rig, played: realCard('juke'), destination: slot(PLAYER_OUTSIDE, CENTER),
				line: 'Buggy\'s Point Blank fizzles: Rig is out of range (2 away, needs 1)'
			});
			expect(rig.structure).toBe(20);
		});
	});

	describe('Bootlegger Turn', () => {
		test('moves to any empty slot in the formation, however far, and is +1 Evade until the end of the next enemy turn', () => {
			expect(play(battle, rig, realCard('bootlegger_turn'), { destination: slot(PLAYER_OUTSIDE, AHEAD) })).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_OUTSIDE, AHEAD));
			expect(battle.swervedThisTurn(rig)).toBe(true);
			expect(rig.evadeBoost).toBe(1);
			expect(rig.statusEffects).toEqual([expect.objectContaining({ name: EVADE_BOOST, value: 1, duration: 1 })]);
			expect(battle.hitCheck({ attacker: buggy, caster: driverOf(buggy), defender: rig })?.evade).toBe(6);

			battle.endPlayerTurn({ stepEnemyTurn: true });
			expect(rig.evadeBoost).toBe(1);
			battle.runEnemyTurn();
			expect(rig.evadeBoost).toBe(0);
		});

		test('is rare and costs 2, 1 upgraded', () => {
			expect(cardData('bootlegger_turn').rarity).toBe('rare');
			expect(realCard('bootlegger_turn').cost).toBe(2);
			expect(realCard('bootlegger_turn', true).cost).toBe(1);
			expect(realCard('bootlegger_turn', true).effects).toEqual(realCard('bootlegger_turn').effects);
		});

		test('never goes to a taken or reserved slot or a shoulder', () => {
			const bootlegger = realCard('bootlegger_turn');
			expect(battle.moveDestinations({ driver: driverOf(rig), card: bootlegger })).toHaveLength(4);
			expect(destinationBlocker(battle, rig, bootlegger, slot(PLAYER_INSIDE, BEHIND))).toBe('player inside, behind is taken by Bike');
			expect(destinationBlocker(battle, rig, bootlegger, slot(PLAYER_SHOULDER, AHEAD))).toBe('player shoulder, ahead is not in Rig\'s formation');

			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, BEHIND), buggy);
			expect(destinationBlocker(battle, rig, bootlegger, slot(PLAYER_INSIDE, BEHIND))).toBe('player inside, behind is reserved for Bike');
		});

		test('is unplayable while flanking or with no empty slot in the formation, and gives no Evade then', () => {
			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, BEHIND), buggy);
			expect(cardBlocker(battle, bike, realCard('bootlegger_turn'))).toBe('Bike is flanking and can\'t swerve');

			battle = createBattle([rig, createVehicle('Bike', 5), ...(['outrider', 'pilot_car', 'fuel_hauler', 'med_truck'] as const).map(type => createEscort({ type }))], [buggy]);
			expect(cardBlocker(battle, rig, realCard('bootlegger_turn'))).toBe('Rig has no empty slot to move to');
			expect(play(battle, rig, realCard('bootlegger_turn'), { destination: slot(PLAYER_OUTSIDE, AHEAD) })).toBe(false);
			expect(rig.evadeBoost).toBe(0);
		});

		test('makes a planned raider shot that would have hit miss, from where it lands', () => {
			// Far Shoot hits on gunnery 6 > evade 5; +1 Evade makes it 6 > 6
			withSkill(buggy, 'gunnery', 6);
			planWith(battle, buggy, [realCard('far_shoot')]);
			expect(intentTargets(battle, buggy)).toEqual([rig.id]);

			// Inside ahead is still Range 2 of the Buggy
			expect(play(battle, rig, realCard('bootlegger_turn'), { destination: slot(PLAYER_INSIDE, AHEAD) })).toBe(true);
			battle.endPlayerTurn();
			expect(rig.structure).toBe(20);
			expect(battle.getMessages().some(message => message.type === 'miss' && message.message.includes('evade 6'))).toBe(true);
		});

		test('lands its Evade in the preview while only aimed', () => {
			const driver = driverOf(rig);
			const aimed = realCard('bootlegger_turn');
			driver.set({ hand: [aimed], adrenaline: 5 });
			const board = battle.projectEnemyTurnStart({ preview: { driver, card: aimed, destination: slot(PLAYER_OUTSIDE, AHEAD) } });
			expect(board.evadeBoostOf(rig)).toBe(1);
			expect(board.slotOf(rig)).toEqual(slot(PLAYER_OUTSIDE, AHEAD));
			expect(rig.evadeBoost).toBe(0);
		});

		test('moving out of a planned raider card\'s range fizzles it', () => {
			planWith(battle, buggy, [realCard('point_blank')]);
			expectFizzle({
				battle, raider: buggy, caster: rig, played: realCard('bootlegger_turn'), destination: slot(PLAYER_OUTSIDE, AHEAD),
				line: 'Buggy\'s Point Blank fizzles: Rig is out of range (3 away, needs 1)'
			});
		});
	});

	describe('Strafe', () => {
		beforeEach(() => {
			// Range 2 from the Rig, 1 from inside ahead
			buggy.set({ slot: slot(ENEMY_INSIDE, AHEAD), shield: 50 });
		});

		test('swerves to the slot you pick, then deals 4 to a raider at Range 1 of it; 6 upgraded', () => {
			withSkill(rig, 'gunnery', 9);
			expect(play(battle, rig, realCard('strafe'), { target: buggy, destination: slot(PLAYER_INSIDE, AHEAD) })).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
			expect(battle.swervedThisTurn(rig)).toBe(true);
			expect(buggy.shield).toBe(46);

			rig.set({ slot: slot(PLAYER_INSIDE, CENTER) });
			expect(play(battle, rig, realCard('strafe', true), { target: buggy, destination: slot(PLAYER_INSIDE, AHEAD) })).toBe(true);
			expect(buggy.shield).toBe(40);
		});

		test('is uncommon and costs 2, upgraded or not', () => {
			expect(cardData('strafe').rarity).toBe('uncommon');
			expect(realCard('strafe').cost).toBe(2);
			expect(realCard('strafe', true).cost).toBe(2);
		});

		test('rolls gunnery against evade as a ranged attack, and the swerve happens hit or miss', () => {
			// Gunnery 5 doesn't beat evade 5
			expect(play(battle, rig, realCard('strafe'), { target: buggy, destination: slot(PLAYER_INSIDE, AHEAD) })).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
			expect(buggy.shield).toBe(50);
			expect(battle.getMessages().some(message => message.type === 'miss' && message.message.startsWith('Strafe misses Buggy'))).toBe(true);
		});

		test('reaches a raider only at Range 1 of the slot it picks', () => {
			const strafe = realCard('strafe');
			// Before a slot is picked, any slot it could pick
			expect(targetBlocker(battle, rig, strafe, buggy)).toBeNull();
			expect(targetBlocker(battle, rig, strafe, buggy, slot(PLAYER_OUTSIDE, CENTER))).toBe('Target out of range: 3 > 1');
			expect(play(battle, rig, strafe, { target: buggy, destination: slot(PLAYER_OUTSIDE, CENTER) })).toBe(false);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, CENTER));

			// No slot next to the Rig is Range 1 of the enemy outside lane
			buggy.set({ slot: slot(ENEMY_OUTSIDE, CENTER) });
			expect(targetBlocker(battle, rig, strafe, buggy)).toBe('Target out of range: 3 > 1');
		});

		test('is unplayable while flanking or with nowhere to swerve, and needs its slot', () => {
			expect(play(battle, rig, realCard('strafe'), { target: buggy })).toBe(false);

			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, BEHIND), buggy);
			expect(cardBlocker(battle, bike, realCard('strafe'))).toBe('Bike is flanking and can\'t swerve');

			boxInRig();
			expect(cardBlocker(battle, rig, realCard('strafe'))).toBe('Rig has nowhere to swerve');
		});

		test('swerving out of a planned raider card\'s range fizzles it, whoever it shoots', () => {
			// The Crawler across from the Rig plans a Point Blank at it
			const crawler = createVehicle('Crawler', 3, slot(ENEMY_INSIDE, CENTER));
			battle = createBattle([rig, bike], [buggy, crawler]);
			planWith(battle, crawler, [realCard('point_blank')]);
			expect(intentTargets(battle, crawler)).toEqual([rig.id]);

			expectFizzle({
				battle, raider: crawler, caster: rig, played: realCard('strafe'), target: buggy, destination: slot(PLAYER_INSIDE, AHEAD),
				line: 'Crawler\'s Point Blank fizzles: Rig is out of range (2 away, needs 1)'
			});
		});
	});

	describe('Leapfrog', () => {
		test('swaps slots with the partner\'s vehicle wherever it is in the formation, for 1 Adrenaline, 0 upgraded', () => {
			expect(realCard('leapfrog').cost).toBe(1);
			expect(realCard('leapfrog', true).cost).toBe(0);
			bike.set({ slot: slot(PLAYER_OUTSIDE, AHEAD) });

			expect(play(battle, rig, realCard('leapfrog'), { target: bike })).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_OUTSIDE, AHEAD));
			expect(bike.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
			expect(battle.swervedThisTurn(rig)).toBe(true);
			expect(battle.swervedThisTurn(bike)).toBe(true);
		});

		test('swaps with an escort next to you, ready or spent, and never spends it', () => {
			const outrider = createEscort({ type: 'outrider' });
			battle = createBattle([rig, bike, outrider], [buggy]);
			expect(play(battle, rig, realCard('leapfrog'), { target: outrider })).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
			expect(outrider.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
			expect(outrider.isReady).toBe(true);

			outrider.spent = true;
			expect(play(battle, rig, realCard('leapfrog'), { target: outrider })).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
			expect(outrider.spent).toBe(true);
		});

		test('can\'t take an escort that isn\'t next to you, a raider, or your own vehicle', () => {
			const medTruck = createEscort({ type: 'med_truck' });
			battle = createBattle([rig, bike, medTruck], [buggy]);
			const leapfrog = realCard('leapfrog');
			expect(medTruck.slot).toEqual(slot(PLAYER_OUTSIDE, BEHIND));
			expect(targetBlocker(battle, rig, leapfrog, medTruck)).toBe('Med Truck is neither the partner\'s vehicle nor an escort next to Rig');
			expect(targetBlocker(battle, rig, leapfrog, buggy)).toBe('Buggy is not in Rig\'s convoy');
			expect(targetBlocker(battle, rig, leapfrog, rig)).toBe('Rig can\'t swap with itself');
			expect(play(battle, rig, leapfrog, { target: medTruck })).toBe(false);
			expect(medTruck.slot).toEqual(slot(PLAYER_OUTSIDE, BEHIND));
		});

		test('is unplayable while flanking, never takes a flanker, and greys out with nobody to swap with (call 341)', () => {
			const leapfrog = realCard('leapfrog');
			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, BEHIND), buggy);
			expect(cardBlocker(battle, bike, leapfrog)).toBe('Bike is flanking and can\'t swerve');
			expect(targetBlocker(battle, rig, leapfrog, bike)).toBe('Bike is flanking and can\'t swerve');
			expect(cardBlocker(battle, rig, leapfrog)).toBe('Rig has nobody to swap with');
			expect(battle.canPlayCard({ driver: driverOf(rig), card: leapfrog })).toBe(false);

			// An escort next to the Rig gives it someone again
			const outrider = createEscort({ type: 'outrider' });
			battle.playerTeam.addVehicle(outrider);
			outrider.set({ slot: slot(PLAYER_OUTSIDE, CENTER) });
			expect(cardBlocker(battle, rig, leapfrog)).toBeNull();

			// Unless it's flanking too
			flankOnto(outrider, slot(ENEMY_SHOULDER, AHEAD), slot(PLAYER_OUTSIDE, CENTER), buggy);
			expect(cardBlocker(battle, rig, leapfrog)).toBe('Rig has nobody to swap with');
		});

		test('swapping out of a planned raider card\'s range fizzles it', () => {
			planWith(battle, buggy, [realCard('point_blank')]);
			expect(intentTargets(battle, buggy)).toEqual([rig.id]);

			expectFizzle({
				battle, raider: buggy, caster: rig, played: realCard('leapfrog'), target: bike,
				line: 'Buggy\'s Point Blank fizzles: Rig is out of range (2 away, needs 1)'
			});
			expect(rig.structure).toBe(20);
		});
	});

	describe('Fall In', () => {
		let outrider: Vehicle;

		beforeEach(() => {
			outrider = createEscort({ type: 'outrider' });
			battle = createBattle([rig, bike, outrider], [buggy]);
			expect(outrider.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
		});

		test('moves an escort, ready or spent, to any empty slot in the formation without spending it', () => {
			const fallIn = realCard('fall_in');
			expect(fallIn.isOrder).toBe(true);
			expect(battle.moveDestinations({ driver: driverOf(rig), card: fallIn, target: outrider })).toHaveLength(3);
			expect(play(battle, rig, fallIn, { target: outrider, destination: slot(PLAYER_OUTSIDE, BEHIND) })).toBe(true);
			expect(outrider.slot).toEqual(slot(PLAYER_OUTSIDE, BEHIND));
			expect(outrider.isReady).toBe(true);
			expect(battle.swervedThisTurn(outrider)).toBe(true);

			outrider.spent = true;
			expect(play(battle, rig, realCard('fall_in'), { target: outrider, destination: slot(PLAYER_OUTSIDE, AHEAD) })).toBe(true);
			expect(outrider.slot).toEqual(slot(PLAYER_OUTSIDE, AHEAD));
			expect(outrider.spent).toBe(true);
		});

		test('is common and costs 1; upgraded, the escort also gains 3 Shield', () => {
			expect(cardData('fall_in').rarity).toBe('common');
			expect(realCard('fall_in', true).cost).toBe(1);
			const upgraded = realCard('fall_in', true);
			expect(upgraded.displaySummary).toBe('Move an [Escort] to any empty slot. +3 [Shield]. Not spent.');

			expect(play(battle, rig, upgraded, { target: outrider, destination: slot(PLAYER_OUTSIDE, AHEAD) })).toBe(true);
			expect(outrider.slot).toEqual(slot(PLAYER_OUTSIDE, AHEAD));
			expect(outrider.shield).toBe(3);
			expect(outrider.isReady).toBe(true);
		});

		test('targets only an escort in your convoy that isn\'t flanking', () => {
			const fallIn = realCard('fall_in');
			expect(targetBlocker(battle, rig, fallIn, bike)).toBe('Bike is not an escort in your convoy');
			expect(targetBlocker(battle, rig, fallIn, buggy)).toBe('Buggy is not an escort in your convoy');
			flankOnto(outrider, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, AHEAD), buggy);
			expect(targetBlocker(battle, rig, fallIn, outrider)).toBe('Outrider is flanking and can\'t swerve');
			expect(play(battle, rig, fallIn, { target: outrider, destination: slot(PLAYER_INSIDE, AHEAD) })).toBe(false);
		});

		test('never moves it to a taken or reserved slot or a shoulder, and needs its slot', () => {
			const fallIn = realCard('fall_in');
			expect(play(battle, rig, fallIn, { target: outrider })).toBe(false);
			expect(destinationBlocker(battle, rig, fallIn, slot(PLAYER_INSIDE, CENTER), outrider)).toBe('player inside, center is taken by Rig');
			expect(destinationBlocker(battle, rig, fallIn, slot(ENEMY_SHOULDER, AHEAD), outrider)).toBe('enemy shoulder, ahead is not in Outrider\'s formation');
			expect(destinationBlocker(battle, rig, fallIn, slot(PLAYER_OUTSIDE, AHEAD))).toBe('Fall In needs its target before its slot');

			flankOnto(bike, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, BEHIND), buggy);
			expect(destinationBlocker(battle, rig, fallIn, slot(PLAYER_INSIDE, BEHIND), outrider)).toBe('player inside, behind is reserved for Bike');
		});

		test('greys out with no escort that can move (call 341)', () => {
			const fallIn = realCard('fall_in');
			expect(cardBlocker(battle, rig, fallIn)).toBeNull();

			flankOnto(outrider, slot(ENEMY_SHOULDER, CENTER), slot(PLAYER_INSIDE, AHEAD), buggy);
			expect(cardBlocker(battle, rig, fallIn)).toBe('Fall In has no escort that can move');
			expect(battle.canPlayCard({ driver: driverOf(rig), card: fallIn })).toBe(false);

			battle = createBattle([rig, bike], [buggy]);
			expect(cardBlocker(battle, rig, fallIn)).toBe('Fall In has no escort that can move');

			battle = createBattle([rig, bike, ...(['outrider', 'pilot_car', 'fuel_hauler', 'med_truck'] as const).map(type => createEscort({ type }))], [buggy]);
			expect(cardBlocker(battle, rig, fallIn)).toBe('Fall In has no escort that can move');
		});

		test('a passenger can play it, moving an escort as the driver would', () => {
			const passenger = createTestDriver('Passenger');
			rig.set({ passenger });
			passenger.set({ hand: [realCard('fall_in')], adrenaline: 5 });
			expect(battle.playCard({ driver: passenger, cardIndex: 0, targetVehicle: outrider, destination: slot(PLAYER_OUTSIDE, CENTER) })).toBe(true);
			expect(outrider.slot).toEqual(slot(PLAYER_OUTSIDE, CENTER));
		});

		test('moving an escort out of a planned raider card\'s range fizzles it', () => {
			// Across from the Outrider, two from the Rig, so its Point Blank goes at the Outrider
			buggy.set({ slot: slot(ENEMY_INSIDE, AHEAD) });
			planWith(battle, buggy, [realCard('point_blank')]);
			expect(intentTargets(battle, buggy)).toEqual([outrider.id]);

			expectFizzle({
				battle, raider: buggy, caster: rig, played: realCard('fall_in'), target: outrider, destination: slot(PLAYER_OUTSIDE, BEHIND),
				line: 'Buggy\'s Point Blank fizzles: Outrider is out of range (4 away, needs 1)'
			});
		});
	});

	describe('Shoulder Check', () => {
		test('rams a raider at Range 1 for 3, and on a hit shoves it into the row you pick', () => {
			buggy.set({ shield: 50 });
			expect(play(battle, rig, realCard('shoulder_check'), { target: buggy, destination: slot(ENEMY_INSIDE, AHEAD) })).toBe(true);
			expect(buggy.shield).toBe(47);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, AHEAD));
			expect(battle.swervedThisTurn(buggy)).toBe(true);
			expect(battle.swervedThisTurn(rig)).toBe(false);
		});

		test('is uncommon, costs 2, and deals 5 upgraded', () => {
			expect(cardData('shoulder_check').rarity).toBe('uncommon');
			expect(realCard('shoulder_check').cost).toBe(2);
			buggy.set({ shield: 50 });
			expect(play(battle, rig, realCard('shoulder_check', true), { target: buggy, destination: slot(ENEMY_INSIDE, BEHIND) })).toBe(true);
			expect(buggy.shield).toBe(45);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, BEHIND));
		});

		test('hits on ramming at least the target\'s evade, Evade included, and a miss shoves nobody (call 303)', () => {
			buggy.set({ shield: 50 });
			// Ramming 5 against evade 5 + 1
			buggy.applyStatusEffect({ name: EVADE_BOOST, duration: 1, value: 1 });
			expect(battle.needsDestination({ driver: driverOf(rig), card: realCard('shoulder_check'), target: buggy })).toBe(true);
			expect(play(battle, rig, realCard('shoulder_check'), { target: buggy, destination: slot(ENEMY_INSIDE, AHEAD) })).toBe(true);
			expect(buggy.shield).toBe(50);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, CENTER));
			expect(battle.getMessages().some(message => message.type === 'miss' && message.message.startsWith('Shoulder Check misses Buggy (ramming 5 vs evade 6'))).toBe(true);
		});

		test('needs a raider at Range 1, and shoves only a row ahead or behind into an empty slot', () => {
			const check = realCard('shoulder_check');
			expect(battle.moveDestinations({ driver: driverOf(rig), card: check, target: buggy })).toEqual([slot(ENEMY_INSIDE, AHEAD), slot(ENEMY_INSIDE, BEHIND)]);
			expect(destinationBlocker(battle, rig, check, slot(ENEMY_OUTSIDE, CENTER), buggy)).toBe('enemy outside, center is not a row ahead of or behind Buggy');

			const blocking = createVehicle('Blocking', 3, slot(ENEMY_INSIDE, AHEAD));
			battle = createBattle([rig, bike], [buggy, blocking]);
			expect(destinationBlocker(battle, rig, check, slot(ENEMY_INSIDE, AHEAD), buggy)).toBe('enemy inside, ahead is taken by Blocking');
			expect(play(battle, rig, check, { target: buggy, destination: slot(ENEMY_INSIDE, AHEAD) })).toBe(false);

			buggy.set({ slot: slot(ENEMY_INSIDE, BEHIND) });
			expect(targetBlocker(battle, rig, check, buggy)).toBe('Target out of range: 2 > 1');
		});

		test.each([
			['a flanker', (): void => {
				rig.set({ slot: slot(PLAYER_OUTSIDE, CENTER) });
				flankOnto(buggy, slot(PLAYER_SHOULDER, CENTER), slot(ENEMY_INSIDE, CENTER), rig);
			}],
			['a raider boxed in ahead and behind', (): void => {
				battle.enemyTeam.addVehicle(createVehicle('Ahead', 3, slot(ENEMY_INSIDE, AHEAD)));
				battle.enemyTeam.addVehicle(createVehicle('Behind', 3, slot(ENEMY_INSIDE, BEHIND)));
			}]
		])('on %s still hits, needing no slot, and shoves nobody (call 293)', (_, setUp) => {
			setUp();
			const check = realCard('shoulder_check');
			const from = buggy.slot;
			buggy.set({ shield: 50 });
			expect(battle.needsDestination({ driver: driverOf(rig), card: check, target: buggy })).toBe(false);
			expect(play(battle, rig, check, { target: buggy })).toBe(true);
			expect(buggy.shield).toBe(47);
			expect(buggy.slot).toEqual(from);
		});

		test('shoving a raider out of its planned card\'s range fizzles it', () => {
			planWith(battle, buggy, [realCard('point_blank')]);
			expect(intentTargets(battle, buggy)).toEqual([rig.id]);

			expectFizzle({
				battle, raider: buggy, caster: rig, played: realCard('shoulder_check'), target: buggy, destination: slot(ENEMY_INSIDE, BEHIND),
				line: 'Buggy\'s Point Blank fizzles: Rig is out of range (2 away, needs 1)'
			});
			expect(rig.structure).toBe(20);
		});

		test('a miss leaves the plan standing in the preview, since the shove only follows a hit', () => {
			planWith(battle, buggy, [realCard('point_blank')]);
			withSkill(rig, 'ramming', 4);
			const driver = driverOf(rig);
			const aimed = realCard('shoulder_check');
			driver.set({ hand: [aimed], adrenaline: 5 });
			expect(battle.getAllIntents({ preview: { driver, card: aimed, target: buggy, destination: slot(ENEMY_INSIDE, AHEAD) } }).get(buggy)).toHaveLength(1);
		});
	});

	describe('the rewards', () => {
		const ours = ['juke', 'bootlegger_turn', 'strafe', 'leapfrog', 'shoulder_check', 'fall_in'];

		test('have the rarities and costs Combat Rules gives', () => {
			expect(ours.map(type => [type, cardData(type).rarity, cardData(type).cost])).toEqual([
				['juke', 'common', 1],
				['bootlegger_turn', 'rare', 2],
				['strafe', 'uncommon', 2],
				['leapfrog', 'uncommon', 1],
				['shoulder_check', 'uncommon', 2],
				['fall_in', 'common', 1]
			]);
		});

		const offered = (ownsEscort: boolean): Set<string> => new Set(Array.from({ length: 400 }, (_, roll) =>
			rollRewardCards({ rng: new Rng({ seed: 551 }).fork('reward', roll), ownsEscort })).flat());

		test('are each offered by the card reward, Fall In only while you own an escort', () => {
			const withEscort = offered(true);
			for (const type of ours) expect(withEscort).toContain(type);

			const without = offered(false);
			for (const type of ours.filter(type => type !== 'fall_in')) expect(without).toContain(type);
			expect(without).not.toContain('fall_in');
		});
	});
});
