import { Battle } from './Battle';
import { Card, CardEffect, TargetType } from './Card';
import { Driver } from './Driver';
import { Intent, IntentTier, IntentType, formatIntentValue } from './Intent';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });

// Total speed is baseSpeed plus the test driver's speed skill of 2. Drivers get enough
// hitpoints that a few hits don't end the fight.
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

// Test drivers have gunnery 5 against evade 5, so attacks here always hit
const pointBlank = () => card('Point Blank', 'enemy_single', [{ type: 'damage', value: 4, range: 1, always_hits: true }]);
const farShot = () => card('Far Shot', 'enemy_single', [{ type: 'damage', value: 4, range: 2, always_hits: true }]);
const bigHit = () => card('Big Hit', 'enemy_single', [{ type: 'damage', value: 40, always_hits: true }]);
const armorUp = () => card('Armor Up', 'self', [{ type: 'gain_armor', value: 3, target: 'self' }]);
const nitro = () => card('Nitro Boost', 'self', [{ type: 'apply_status', status: 'speed_boost', value: 3, duration: 2, target: 'self' }]);
const flank = () => card('Flank', 'enemy_single', [{ type: 'change_position', position: 'flanking', target: 'self' }]);
const oilSlick = () => card('Oil Slick', 'enemy_single', [
	{ type: 'apply_status', status: 'speed_reduction', value: -4, duration: 2, target: 'target', condition: 'target_flanking', always_hits: true }
]);
const emp = () => card('EMP Blast', 'enemy_all', [{ type: 'apply_status', status: 'stunned', target: 'enemy_all', always_hits: true }], 3);

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const giveHand = (vehicle: Vehicle, cards: Card[]): void => {
	driverOf(vehicle).set({ hand: cards, adrenaline: 5 });
};

const logLines = (battle: Battle, type: string): string[] =>
	battle.getMessages().filter(m => m.type === type).map(m => m.message);

describe('Enemy intents', () => {
	// Rig 51 in player inside center, Bike 55 in player inside behind,
	// Buggy 53 in enemy inside center. Buggy to Rig is range 1, to Bike 2.
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

	describe('planning at the start of the player turn', () => {
		test('start() commits every card the raider can play from the hand it just drew', () => {
			const drawn = [pointBlank(), pointBlank()];
			driverOf(buggy).deck?.addCards(drawn);

			battle.start();

			const plan = battle.getPlan(buggy);
			expect(plan.map(action => action.card)).toEqual(expect.arrayContaining(drawn));
			expect(plan).toHaveLength(2);
			expect(plan.every(action => action.target === rig)).toBe(true);
		});

		test('the next player turn gets a fresh plan', async () => {
			giveHand(buggy, [pointBlank()]);
			battle.planEnemyTurn();
			driverOf(buggy).deck?.addCards([farShot(), farShot()]);

			await battle.endPlayerTurn();

			expect(battle.isPlayerTurn).toBe(true);
			expect(battle.getPlan(buggy).map(action => action.card.name)).toEqual(expect.arrayContaining(['Far Shot']));
		});

		test('each intent carries a type, a value, and a target', () => {
			giveHand(buggy, [pointBlank(), armorUp()]);
			battle.planEnemyTurn();

			expect(battle.getIntents(buggy)).toEqual([
				{ type: IntentType.ATTACK, amount: 4, hits: 1, label: null, target: rig.id, description: 'Point Blank' },
				{ type: IntentType.DEFEND, amount: 3, hits: 1, label: null, target: null, description: 'Armor Up' }
			]);
		});

		test('an area hit targets both vehicles', () => {
			giveHand(buggy, [emp()]);
			battle.planEnemyTurn();

			const [intent] = battle.getIntents(buggy);
			expect(intent.type).toBe(IntentType.DEBUFF);
			expect(intent.label).toBe('stunned');
			expect(intent.target).toBe('both');
		});

		test('self buffs are buff intents with no target', () => {
			giveHand(buggy, [nitro()]);
			battle.planEnemyTurn();

			const [intent] = battle.getIntents(buggy);
			expect(intent.type).toBe(IntentType.BUFF);
			expect(intent.label).toBe('speed_boost');
			expect(intent.target).toBeNull();
		});

		test('the attack value follows the target as it is now, so a Vulnerable picked up after planning shows', () => {
			giveHand(buggy, [pointBlank()]);
			battle.planEnemyTurn();
			rig.applyStatusEffect({ name: 'vulnerable', duration: 1 });

			expect(battle.getIntents(buggy)[0].amount).toBe(6);
		});

		test.each([IntentTier.ELITE, IntentTier.BOSS])('a %s raider hides the value and the card but not the type or target', tier => {
			buggy.intentTier = tier;
			giveHand(buggy, [pointBlank()]);
			battle.planEnemyTurn();

			const [intent] = battle.getIntents(buggy);
			expect(intent).toEqual({ type: IntentType.ATTACK, amount: null, hits: 1, label: null, target: rig.id, description: '???' });
			expect(formatIntentValue(intent)).toBe('?');
		});

		test('values print as the pill shows them', () => {
			const attack: Intent = { type: IntentType.ATTACK, amount: 6, hits: 3, label: null, target: 'both', description: 'Chain Gun' };
			expect(formatIntentValue(attack)).toBe('6x3');
			expect(formatIntentValue({ ...attack, hits: 1 })).toBe('6');
			expect(formatIntentValue({ ...attack, type: IntentType.DEBUFF, amount: null, label: 'speed_reduction' })).toBe('speed_reduction');
		});
	});

	describe('planning against a projection', () => {
		test('a pick after a planned flank sees the raider on the shoulder', () => {
			// From the player shoulder, center, Rig is range 2 and Bike range 3
			giveHand(buggy, [flank(), pointBlank()]);
			battle.planEnemyTurn();

			expect(battle.getPlan(buggy).map(action => action.card.name)).toEqual(['Flank']);
			expect(buggy.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
		});

		test('an attack planned after a flank shows the flank bonus', () => {
			giveHand(buggy, [flank(), farShot()]);
			battle.planEnemyTurn();

			const intents = battle.getIntents(buggy);
			expect(intents.map(intent => intent.type)).toEqual([IntentType.BUFF, IntentType.ATTACK]);
			expect(intents[1]).toMatchObject({ amount: 6, target: rig.id });
		});

		test('a planned Nitro Boost lets a later flank go through', () => {
			rig = createVehicle('Rig', 4);
			buggy = createVehicle('Buggy', 3);
			battle = createBattle([rig, createVehicle('Bike', 5)], [buggy]);
			giveHand(buggy, [flank(), nitro()]);

			battle.planEnemyTurn();

			const plan = battle.getPlan(buggy);
			expect(plan.map(action => action.card.name)).toEqual(['Nitro Boost', 'Flank']);
			expect(plan[1].target).toBe(rig);
		});
	});

	describe('the enemy turn plays the plan', () => {
		test('plays the planned cards and nothing it picked up since', async () => {
			giveHand(buggy, [pointBlank()]);
			battle.planEnemyTurn();
			driverOf(buggy).hand.push(bigHit());

			await battle.endPlayerTurn();

			expect(logLines(battle, 'card_played')).toEqual([expect.stringContaining('plays Point Blank')]);
			expect(rig.structure).toBe(18);
		});

		test('a planned draw goes through the hand cap, and what it draws is never played', async () => {
			const scavenge = card('Scavenge', 'self', [{ type: 'draw_cards', value: 3, target: 'self' }], 0);
			const fillers = Array.from({ length: 6 }, (_, i) => card(`Scrap ${i + 1}`, 'self', [], 9));
			giveHand(buggy, [scavenge, ...fillers]);
			driverOf(buggy).deck?.addCards([pointBlank(), pointBlank(), pointBlank()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy).map(action => action.card.name)).toEqual(['Scavenge']);

			await battle.endPlayerTurn();

			// Six left after Scavenge, one draw reaches the cap of 7, two burn
			expect(logLines(battle, 'cards_burned')).toContainEqual(expect.stringContaining('Point Blank, Point Blank go straight to the discard pile'));
			expect(logLines(battle, 'card_played').filter(line => line.includes('Point Blank'))).toEqual([]);
			expect(rig.structure).toBe(20);
		});

		test('fizzles when the player moved out of range, and the card is still spent', async () => {
			rig = createVehicle('Rig', 5);
			buggy = createVehicle('Buggy', 3);
			battle = createBattle([rig, createVehicle('Bike', 1)], [buggy]);
			giveHand(buggy, [pointBlank()]);
			battle.planEnemyTurn();

			// Rig outruns the buggy onto the enemy shoulder, two lanes from it
			giveHand(rig, [flank()]);
			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: buggy })).toBe(true);

			await battle.endPlayerTurn();

			expect(logLines(battle, 'card_played')).toContainEqual(expect.stringContaining('plays Point Blank (Adrenaline: 5 -> 4)'));
			expect(rig.structure).toBe(20);
			expect(logLines(battle, 'fizzle')).toEqual(["Buggy's Point Blank fizzles: Rig is out of range (2 away, needs 1)"]);
		});

		test('fizzles when the player outpaced a planned flank', async () => {
			giveHand(buggy, [flank()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].target).toBe(rig);

			giveHand(rig, [nitro()]);
			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0 })).toBe(true);
			await battle.endPlayerTurn();

			expect(buggy.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
			expect(logLines(battle, 'fizzle')).toEqual(["Buggy's Flank fizzles: Buggy is not faster than Rig"]);
		});

		test('fizzles when the player slowed a raider off the shoulder and it dropped back out of range', async () => {
			// Buggy flanked Rig earlier from its reserved slot, enemy outside ahead
			buggy = createVehicle('Buggy', 3, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
			battle = createBattle([rig, bike], [buggy]);
			buggy.set({
				slot: slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER),
				flank: { reservedSlot: slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD), outran: rig }
			});
			giveHand(buggy, [farShot()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(buggy)[0].target).toBe(rig);

			giveHand(rig, [oilSlick()]);
			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: buggy })).toBe(true);
			await battle.endPlayerTurn();

			expect(buggy.slot).toEqual(slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
			expect(rig.structure).toBe(20);
			expect(logLines(battle, 'fizzle')).toEqual(["Buggy's Far Shot fizzles: Rig is out of range (3 away, needs 2)"]);
		});

		describe('when the target was wrecked earlier in the enemy turn', () => {
			let hauler: Vehicle;

			beforeEach(() => {
				hauler = createVehicle('Hauler', 2);
				battle = createBattle([rig, bike], [buggy, hauler]);
				giveHand(buggy, [bigHit()]);
				giveHand(hauler, [farShot()]);
				battle.planEnemyTurn();
				expect(battle.getPlan(hauler)[0].target).toBe(rig);
			});

			test('the card follows the wrecked driver into the vehicle they ride in', async () => {
				await battle.endPlayerTurn();

				expect(rig.isAlive()).toBe(false);
				expect(bike.passenger?.metadata.name).toBe('Rig Driver');
				expect(bike.structure).toBe(18);
				expect(logLines(battle, 'general')).toContain('Rig is wrecked, so Hauler turns Far Shot on Bike');
			});

			test('it fizzles when the driver died in the wreck', async () => {
				driverOf(rig).set({ hitpoints: 5 });

				await battle.endPlayerTurn();

				expect(bike.structure).toBe(20);
				expect(logLines(battle, 'fizzle')).toEqual(["Hauler's Far Shot fizzles: Rig is wrecked and nobody got out"]);
			});
		});

		test('a raider wrecked during the player turn drops its plan', async () => {
			const hauler = createVehicle('Hauler', 2);
			battle = createBattle([rig, bike], [buggy, hauler]);
			giveHand(buggy, [pointBlank()]);
			battle.planEnemyTurn();

			buggy.structure = 0;
			await battle.endPlayerTurn();

			expect(rig.structure).toBe(20);
			expect(logLines(battle, 'general')).toContain('Buggy is wrecked and drops its plan');
		});
	});

	describe('ambushers', () => {
		const ambushAt = (row: RoadRow): Vehicle => {
			const ambusher = createVehicle('Ambusher', 3, slot(RoadLane.PLAYER_SHOULDER, row));
			battle = createBattle([rig, bike], [buggy, ambusher]);
			return ambusher;
		};

		test('an ambusher plans from the shoulder with the flank bonus', () => {
			// Player shoulder center to Rig at inside center is range 2
			const ambusher = ambushAt(RoadRow.CENTER);
			giveHand(ambusher, [farShot()]);
			battle.planEnemyTurn();

			expect(battle.getIntents(ambusher)).toEqual([
				expect.objectContaining({ type: IntentType.ATTACK, amount: 6, target: rig.id })
			]);
		});

		test('a planned swerve keeps it without a reserved slot, so it holds the shoulder once outpaced', async () => {
			// Ambusher 53 outruns Rig 51 from the behind row onto the center shoulder slot
			const ambusher = ambushAt(RoadRow.BEHIND);
			giveHand(ambusher, [flank()]);
			battle.planEnemyTurn();
			expect(battle.getPlan(ambusher)[0].target).toBe(rig);

			await battle.endPlayerTurn();

			expect(ambusher.slot).toEqual(slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER));
			expect(ambusher.flank).toEqual({ reservedSlot: null, outran: rig });

			ambusher.applyStatusEffect({ name: 'oil_slick', duration: 2, value: -40 });
			await battle.endPlayerTurn();

			expect(ambusher.slot).toEqual(slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER));
		});

		test("another raider can't plan a flank into the ambusher's slot", () => {
			ambushAt(RoadRow.CENTER);
			giveHand(buggy, [flank()]);
			battle.planEnemyTurn();

			expect(battle.getPlan(buggy)).toEqual([]);
			expect(battle.getFlankBlocker(buggy, rig)).toBe('player shoulder, center is taken');
		});

		test('the player plays against it as a flanker that is not in formation', () => {
			const ambusher = ambushAt(RoadRow.CENTER);

			expect(battle.getFlankBlocker(bike, ambusher)).toBe('Ambusher is not in formation');

			giveHand(rig, [oilSlick()]);
			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: ambusher })).toBe(true);
			expect(ambusher.hasStatusEffect('speed_reduction')).toBe(true);
		});
	});
});
