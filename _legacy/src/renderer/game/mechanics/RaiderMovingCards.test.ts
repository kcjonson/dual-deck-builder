import { Battle } from './Battle';
import { previewAim } from './AimPreview';
import { BoardProjection } from './BoardProjection';
import { Card, CardData } from './Card';
import { Driver } from './Driver';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import cardsFile from '../data/cards.json';

/**
 * The raider-moving movement cards (DDB-550): Lay on the Horn, Cut Off,
 * Box In, Brake Check, and Overtake, as cards.json has them. Combat Rules,
 * Movement cards; docs/AI_TECHNICAL_DECISIONS/movement-cards.md.
 */

const realCard = (type: string, upgraded = false): Card => {
	const data = (cardsFile as unknown as { cards: CardData[] }).cards.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data, upgraded });
};

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

const targetBlocker = (battle: Battle, vehicle: Vehicle, played: Card, target: Vehicle): string | null =>
	battle.getTargetBlocker({ driver: driverOf(vehicle), card: played, target });

const cardBlocker = (battle: Battle, vehicle: Vehicle, played: Card): string | null =>
	battle.getCardBlocker({ driver: driverOf(vehicle), card: played });

/** Out of reach of any hit check, so a card that lands proves it always hits */
const unhittable = (vehicle: Vehicle): void => {
	driverOf(vehicle).set({ skills: { ...driverOf(vehicle).skills, evade: 20 } });
};

/** The raider's plan for the coming enemy turn, from a hand of these cards, planned by the default AI */
const planWith = (battle: Battle, raider: Vehicle, hand: Card[]): void => {
	driverOf(raider).set({ hand, adrenaline: 5 });
	battle.planEnemyTurn();
};

const intentTargets = (battle: Battle, raider: Vehicle): (string | null)[] =>
	battle.getIntents(raider).map(intent => intent.target);

/**
 * The fizzle every card here can cause: the raider's planned card shows
 * while the player's card is only aimed, drops from the preview the moment
 * that card would land and once it's played, and fizzles in the enemy turn
 * with this log line.
 */
const expectFizzle = ({ battle, raider, caster, played, target, line }: {
	battle: Battle;
	raider: Vehicle;
	caster: Vehicle;
	played: Card;
	target: Vehicle;
	line: string;
}): void => {
	const driver = driverOf(caster);
	driver.set({ hand: [played], adrenaline: 5 });
	expect(battle.getIntents(raider)).toHaveLength(1);
	expect(battle.getAllIntents({ preview: { driver, card: played, target } }).get(raider)).toBeUndefined();

	expect(battle.playCard({ driver, cardIndex: 0, targetVehicle: target })).toBe(true);
	expect(battle.getIntents(raider)).toEqual([]);

	battle.endPlayerTurn();
	expect(battle.getMessages().filter(message => message.type === 'fizzle').map(message => message.message)).toContain(line);
};

describe('Raider-moving cards', () => {
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

	/** The Buggy flanking on the Rig's shoulder, its formation slot reserved */
	const flankOnRig = (): void => {
		buggy.set({ slot: slot(PLAYER_SHOULDER, CENTER), flank: { reservedSlot: slot(ENEMY_INSIDE, CENTER), outran: rig } });
	};

	describe('Lay on the Horn', () => {
		test('shoves a raider in its formation at Range 1 to its outside lane, whatever its evade', () => {
			unhittable(buggy);
			expect(play(battle, rig, realCard('lay_on_the_horn'), buggy)).toBe(true);
			expect(buggy.slot).toEqual(slot(ENEMY_OUTSIDE, CENTER));
			expect(buggy.statusEffects).toEqual([]);
			expect(battle.swervedThisTurn(buggy)).toBe(true);
		});

		test('can\'t target a raider past Range 1, or a flanker or an ambusher, which a shove never moves', () => {
			const horn = realCard('lay_on_the_horn');
			buggy.set({ slot: slot(ENEMY_INSIDE, AHEAD) });
			expect(targetBlocker(battle, rig, horn, buggy)).toBe('Target out of range: 2 > 1');

			// From your outside lane, Range 1 is your shoulder
			rig.set({ slot: slot(PLAYER_OUTSIDE, CENTER) });
			flankOnRig();
			expect(targetBlocker(battle, rig, horn, buggy)).toBe('Buggy is not in its formation');
			buggy.set({ flank: { reservedSlot: null, outran: null } });
			expect(targetBlocker(battle, rig, horn, buggy)).toBe('Buggy is not in its formation');
			expect(play(battle, rig, horn, buggy)).toBe(false);
			expect(buggy.slot).toEqual(slot(PLAYER_SHOULDER, CENTER));
		});

		test('into a taken outside slot still plays and moves nobody, and upgraded still slows (call 293)', () => {
			const blocking = createVehicle('Blocking', 3, slot(ENEMY_OUTSIDE, CENTER));
			battle = createBattle([rig, bike], [buggy, blocking]);
			expect(targetBlocker(battle, rig, realCard('lay_on_the_horn'), buggy)).toBeNull();

			expect(play(battle, rig, realCard('lay_on_the_horn', true), buggy)).toBe(true);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, CENTER));
			expect(buggy.speed).toBe(4);
		});

		test('upgraded, the raider is also 1 slower until the end of the next enemy turn', () => {
			unhittable(buggy);
			expect(play(battle, rig, realCard('lay_on_the_horn', true), buggy)).toBe(true);
			expect(buggy.slot).toEqual(slot(ENEMY_OUTSIDE, CENTER));
			expect(buggy.speed).toBe(4);

			battle.endPlayerTurn();
			expect(buggy.speed).toBe(5);
		});

		test('reads as landing on its target, so aiming it shows the sure hit', () => {
			const preview = previewAim({ battle, driver: driverOf(rig), card: realCard('lay_on_the_horn'), target: buggy });
			expect(preview.lands).toBe(true);
			expect(preview.check).toBeNull();
		});

		test('shoving a raider out of its planned card\'s range fizzles it', () => {
			planWith(battle, buggy, [realCard('point_blank')]);
			expect(intentTargets(battle, buggy)).toEqual([rig.id]);

			expectFizzle({
				battle, raider: buggy, caster: rig, played: realCard('lay_on_the_horn'), target: buggy,
				line: "Buggy's Point Blank fizzles: Rig is out of range (2 away, needs 1)"
			});
			expect(rig.structure).toBe(20);
		});
	});

	describe('Cut Off', () => {
		beforeEach(() => {
			buggy.set({ slot: slot(ENEMY_INSIDE, AHEAD) });
		});

		test('swerves you a row ahead, then the raider at Range 1 there is Vulnerable and 2 slower until the end of the next enemy turn', () => {
			unhittable(buggy);
			expect(play(battle, rig, realCard('cut_off'), buggy)).toBe(true);
			expect(rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
			expect(buggy.hasStatusEffect('vulnerable')).toBe(true);
			expect(buggy.speed).toBe(3);

			battle.endPlayerTurn();
			expect(buggy.hasStatusEffect('vulnerable')).toBe(false);
			expect(buggy.speed).toBe(5);
		});

		test('costs 1 upgraded', () => {
			expect(realCard('cut_off').cost).toBe(2);
			expect(realCard('cut_off', true).cost).toBe(1);
		});

		test('greys out when the slot ahead is taken or off the road, or you\'re flanking, and needs a raider at Range 1 of the row ahead', () => {
			const cut = realCard('cut_off');
			bike.set({ slot: slot(PLAYER_INSIDE, AHEAD) });
			expect(cardBlocker(battle, rig, cut)).toBe('player inside, ahead is taken by Bike');
			expect(cardBlocker(battle, bike, cut)).toBe('Bike has no slot ahead');

			bike.set({ slot: slot(PLAYER_INSIDE, BEHIND) });
			// The Bike's row ahead is the Rig's
			expect(targetBlocker(battle, bike, cut, buggy)).toBe('player inside, center is taken by Rig');
			buggy.set({ slot: slot(ENEMY_INSIDE, CENTER) });
			expect(targetBlocker(battle, rig, cut, buggy)).toBe('Target out of range: 2 > 1');

			expect(play(battle, bike, realCard('flank'), buggy)).toBe(true);
			expect(cardBlocker(battle, bike, cut)).toBe('Bike is flanking and can\'t swerve');
		});

		test('slowing a raider past its planned flank fizzles it', () => {
			planWith(battle, buggy, [realCard('flank')]);
			expect(intentTargets(battle, buggy)).toEqual([rig.id]);

			expectFizzle({
				battle, raider: buggy, caster: rig, played: realCard('cut_off'), target: buggy,
				line: "Buggy's Flank fizzles: Buggy is not faster than Rig"
			});
			expect(buggy.isFlanking).toBe(false);
		});
	});

	describe('Box In', () => {
		test('stops a raider at Range 1 flanking until the end of the next enemy turn, whatever its evade', () => {
			unhittable(buggy);
			expect(play(battle, rig, realCard('box_in'), buggy)).toBe(true);
			expect(buggy.isBoxedIn).toBe(true);
			expect(battle.getFlankBlocker(buggy, rig)).toBe('Buggy is boxed in and can\'t flank');

			battle.endPlayerTurn();
			expect(buggy.isBoxedIn).toBe(false);
			expect(battle.getFlankBlocker(buggy, rig)).toBeNull();
		});

		test('needs a raider at Range 1, and costs 1 upgraded', () => {
			buggy.set({ slot: slot(ENEMY_OUTSIDE, CENTER) });
			expect(targetBlocker(battle, rig, realCard('box_in'), buggy)).toBe('Target out of range: 2 > 1');
			expect(realCard('box_in', true).cost).toBe(1);
		});

		test('fizzles the raider\'s planned flank', () => {
			planWith(battle, buggy, [realCard('flank')]);
			expect(intentTargets(battle, buggy)).toEqual([rig.id]);

			expectFizzle({
				battle, raider: buggy, caster: rig, played: realCard('box_in'), target: buggy,
				line: "Buggy's Flank fizzles: Buggy is boxed in and can't flank"
			});
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, CENTER));
		});

		test('a boxed-in raider\'s Flank greys out, so it never plans one', () => {
			buggy.applyStatusEffect({ name: 'boxed_in', duration: 2 });
			const flank = realCard('flank');
			driverOf(buggy).set({ hand: [flank], adrenaline: 5 });
			expect(battle.getCardBlocker({ driver: driverOf(buggy), card: flank })).toBe('Buggy is boxed in and can\'t flank');

			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)).toEqual([]);
		});

		test('never knocks a flanker off the shoulder (call 322)', () => {
			rig.set({ slot: slot(PLAYER_OUTSIDE, CENTER) });
			flankOnRig();
			expect(play(battle, rig, realCard('box_in'), buggy)).toBe(true);

			battle.endPlayerTurn();
			expect(buggy.slot).toEqual(slot(PLAYER_SHOULDER, CENTER));
		});

		test.each([
			['both driven vehicles are within Range 2', slot(PLAYER_INSIDE, BEHIND), true],
			['the partner is Range 3 away', slot(PLAYER_OUTSIDE, BEHIND), false]
		])('makes it Vulnerable until the end of the next enemy turn only when %s', (_, bikeSlot, vulnerable) => {
			bike.set({ slot: bikeSlot });
			expect(play(battle, rig, realCard('box_in'), buggy)).toBe(true);
			expect(buggy.hasStatusEffect('vulnerable')).toBe(vulnerable);
		});

		test('never makes it Vulnerable with only one driven vehicle left (call 321)', () => {
			bike.set({ structure: 0 });
			expect(play(battle, rig, realCard('box_in'), buggy)).toBe(true);
			expect(buggy.isBoxedIn).toBe(true);
			expect(buggy.hasStatusEffect('vulnerable')).toBe(false);
		});
	});

	describe('Brake Check', () => {
		test('drops a raider flanking in your row back to its reserved slot, and you\'re 1 slower until the end of the next enemy turn', () => {
			flankOnRig();
			unhittable(buggy);
			expect(play(battle, rig, realCard('brake_check'), buggy)).toBe(true);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, CENTER));
			expect(buggy.flank).toBeNull();
			expect(buggy.structure).toBe(20);
			expect(rig.speed).toBe(2);

			battle.endPlayerTurn();
			expect(rig.speed).toBe(3);
		});

		test('deals 4 to an ambusher instead, which has no slot to drop back to (call 293)', () => {
			buggy.set({ slot: slot(PLAYER_SHOULDER, CENTER), flank: { reservedSlot: null, outran: null } });
			expect(play(battle, rig, realCard('brake_check'), buggy)).toBe(true);
			expect(buggy.slot).toEqual(slot(PLAYER_SHOULDER, CENTER));
			// Half to structure, half to the driver, past no armor
			expect(buggy.structure).toBe(18);
			expect(driverOf(buggy).hitpoints).toBe(98);
		});

		test('aiming it shows the 4 only on an ambusher', () => {
			flankOnRig();
			const brake = realCard('brake_check');
			expect(previewAim({ battle, driver: driverOf(rig), card: brake, target: buggy }).losses).toEqual({ structure: 0, driver: 0, passenger: 0 });
			buggy.set({ flank: { reservedSlot: null, outran: null } });
			expect(previewAim({ battle, driver: driverOf(rig), card: brake, target: buggy }).losses).toEqual({ structure: 2, driver: 2, passenger: 0 });
		});

		test('upgraded, the target is also Vulnerable until the end of the next enemy turn', () => {
			flankOnRig();
			expect(play(battle, rig, realCard('brake_check', true), buggy)).toBe(true);
			expect(buggy.slot).toEqual(slot(ENEMY_INSIDE, CENTER));
			expect(buggy.hasStatusEffect('vulnerable')).toBe(true);
		});

		test('needs a raider flanking on your shoulder in your vehicle\'s row', () => {
			const brake = realCard('brake_check');
			expect(targetBlocker(battle, rig, brake, buggy)).toBe('Buggy is not flanking');

			flankOnRig();
			expect(targetBlocker(battle, bike, brake, buggy)).toBe('Buggy is not in Bike\'s row');
			buggy.set({ slot: slot(PLAYER_SHOULDER, AHEAD) });
			expect(targetBlocker(battle, rig, brake, buggy)).toBe('Buggy is not in Rig\'s row');
			expect(play(battle, rig, brake, buggy)).toBe(false);
		});

		test('can\'t target your own flanker', () => {
			expect(play(battle, bike, realCard('flank'), buggy)).toBe(true);
			expect(bike.slot).toEqual(slot(ENEMY_SHOULDER, CENTER));
			expect(targetBlocker(battle, rig, realCard('brake_check'), bike)).toBe('Bike is not an enemy');
		});

		test('dropping a flanker back out of its planned card\'s range fizzles it', () => {
			rig.set({ slot: slot(PLAYER_OUTSIDE, CENTER) });
			flankOnRig();
			planWith(battle, buggy, [realCard('point_blank')]);
			expect(intentTargets(battle, buggy)).toEqual([rig.id]);

			expectFizzle({
				battle, raider: buggy, caster: rig, played: realCard('brake_check'), target: buggy,
				line: "Buggy's Point Blank fizzles: Rig is out of range (2 away, needs 1)"
			});
			expect(rig.structure).toBe(20);
		});
	});

	describe('effect conditions', () => {
		test('fail loud on a name the battle doesn\'t know, in targeting and as an effect lands', () => {
			const typo = new Card({
				type: 'typo',
				name: 'Typo',
				summary: 'Typo',
				description: 'Typo',
				rarity: 'common',
				cost: 1,
				targetType: 'enemy_single',
				tags: [],
				effects: [{ type: 'apply_status', status: 'vulnerable', duration: 1, range: 1, target: 'target', always_hits: true, condition: 'target_in_fromation' }]
			});
			const board = new BoardProjection({ battle });
			expect(() => board.targetConditionBlocker({ card: typo, caster: rig, target: buggy })).toThrow('Effect condition "target_in_fromation" is not one the battle knows');
			expect(() => board.landingConditionHolds({ effect: typo.effects[0], caster: rig, recipient: buggy })).toThrow('not one the battle knows');
			expect(() => targetBlocker(battle, rig, typo, buggy)).toThrow('not one the battle knows');

			// A known one read elsewhere passes through both
			const oilSlick = realCard('oil_slick');
			expect(board.targetConditionBlocker({ card: oilSlick, caster: rig, target: buggy })).toBeNull();
			expect(board.landingConditionHolds({ effect: oilSlick.effects[0], caster: rig, recipient: buggy })).toBe(true);
		});
	});

	describe('Overtake', () => {
		// Speed 4: only the Rig's +2 outruns it
		let crawler: Vehicle;

		beforeEach(() => {
			crawler = createVehicle('Crawler', 2, slot(ENEMY_INSIDE, BEHIND));
			battle = createBattle([rig, bike], [buggy, crawler]);
		});

		test('gains 2 Speed for 2 turns, then flanks a raider only the boost outruns', () => {
			expect(targetBlocker(battle, rig, realCard('flank'), crawler)).toBe('Cannot flank: Rig is not faster than Crawler');
			expect(targetBlocker(battle, rig, realCard('overtake'), crawler)).toBeNull();

			expect(play(battle, rig, realCard('overtake'), crawler)).toBe(true);
			expect(rig.slot).toEqual(slot(ENEMY_SHOULDER, BEHIND));
			expect(rig.flank).toEqual({ reservedSlot: slot(PLAYER_INSIDE, CENTER), outran: crawler });
			expect(rig.speed).toBe(5);

			// Still boosted through the next turn, so it holds the shoulder
			battle.endPlayerTurn();
			expect(rig.speed).toBe(5);
			expect(rig.isFlanking).toBe(true);
		});

		test('costs 2 upgraded', () => {
			expect(realCard('overtake').cost).toBe(3);
			expect(realCard('overtake', true).cost).toBe(2);
		});

		test('greys out while flanking, and needs a raider slower than your boosted speed with its shoulder slot free', () => {
			const overtake = realCard('overtake');
			// The Buggy's 5 ties the Rig's boosted 5, and a tie can't flank
			expect(targetBlocker(battle, rig, overtake, buggy)).toBe('Cannot flank: Rig is not faster than Buggy');

			// The Bike on the shoulder in the Crawler's row
			expect(play(battle, bike, realCard('flank'), crawler)).toBe(true);
			expect(cardBlocker(battle, bike, overtake)).toBe('Bike is already flanking');
			expect(targetBlocker(battle, rig, overtake, crawler)).toBe('Cannot flank: enemy shoulder, behind is taken');
		});

		test('while Heavy the boost doesn\'t count', () => {
			rig.set({ armor: 4 });
			expect(targetBlocker(battle, rig, realCard('overtake'), crawler)).toBe('Cannot flank: Rig is not faster than Crawler');
		});

		test('pulling out of formation fizzles a raider\'s planned flank on you', () => {
			planWith(battle, buggy, [realCard('flank')]);
			expect(intentTargets(battle, buggy)).toEqual([rig.id]);

			expectFizzle({
				battle, raider: buggy, caster: rig, played: realCard('overtake'), target: crawler,
				line: "Buggy's Flank fizzles: Rig is not in formation"
			});
			expect(buggy.isFlanking).toBe(false);
		});
	});
});
