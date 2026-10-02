import { Battle } from './Battle';
import { Card, CardData, CardEffect, TargetType } from './Card';
import { Driver } from './Driver';
import { Intent, IntentTier, IntentType, formatIntentValue } from './Intent';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import cardsFile from '../data/cards.json';

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

/** A fresh copy of a card as cards.json has it */
const realCard = (type: string): Card => {
	const data = cardData.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data });
};

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

	describe('a raider slowed below 0 that plans a Nitro Boost, then a Flank', () => {
		// The Buggy is 3 with a -4 slow on it, so its speed sum is -1 and it
		// moves at 0. Nitro's +3 takes the sum to 2, not 0 + 3, so it moves
		// at 2 when the Flank plays.
		const slowedBuggy = ({ rigSlow = 0 }: { rigSlow?: number } = {}): void => {
			rig = createVehicle('Rig', 0);
			buggy = createVehicle('Buggy', 1);
			battle = createBattle([rig, bike], [buggy]);
			buggy.applyStatusEffect({ name: 'speed_reduction', duration: 2, value: -4 });
			if (rigSlow) rig.applyStatusEffect({ name: 'speed_reduction', duration: 2, value: rigSlow });
			giveHand(buggy, [flank(), nitro()]);
			battle.planEnemyTurn();
		};

		test('doesn\'t plan a Flank on a vehicle as fast as it will be', async () => {
			// The Rig moves at 2
			slowedBuggy();

			expect(battle.getPlan(buggy).map(action => action.card.name)).toEqual(['Nitro Boost']);
			expect(battle.getIntents(buggy).map(intent => intent.description)).toEqual(['Nitro Boost']);
			await battle.endPlayerTurn();

			expect(logLines(battle, 'card_played')).toEqual([expect.stringContaining('plays Nitro Boost')]);
			expect(logLines(battle, 'fizzle')).toEqual([]);
			expect(buggy.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
		});

		test('plans and plays a Flank on a slower one', async () => {
			// Slowed by 1, the Rig moves at 1
			slowedBuggy({ rigSlow: -1 });

			expect(battle.getPlan(buggy).map(action => [action.card.name, action.target])).toEqual([['Nitro Boost', null], ['Flank', rig]]);
			expect(battle.getIntents(buggy).map(intent => [intent.description, intent.target])).toEqual([['Nitro Boost', null], ['Flank', rig.id]]);
			await battle.endPlayerTurn();

			expect(logLines(battle, 'fizzle')).toEqual([]);
			expect(buggy.slot).toEqual(slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER));
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

		test('fizzles when the player moved out of range, and the card is still spent; the preview drops it', async () => {
			rig = createVehicle('Rig', 5);
			buggy = createVehicle('Buggy', 3);
			battle = createBattle([rig, createVehicle('Bike', 1)], [buggy]);
			giveHand(buggy, [pointBlank()]);
			battle.planEnemyTurn();
			expect(battle.getIntents(buggy)).toEqual([expect.objectContaining({ description: 'Point Blank', amount: 4, target: rig.id })]);

			// Rig outruns the buggy onto the enemy shoulder, two lanes from it
			giveHand(rig, [flank()]);
			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: buggy })).toBe(true);
			expect(battle.getIntents(buggy)).toEqual([]);

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

		test('fizzles when the player slowed a raider off the shoulder and it dropped back out of range; the preview drops it', async () => {
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
			expect(battle.getIntents(buggy)).toEqual([]);
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

		test('a raider wrecked during the player turn drops its plan, and the preview shows none', async () => {
			const hauler = createVehicle('Hauler', 2);
			battle = createBattle([rig, bike], [buggy, hauler]);
			giveHand(buggy, [pointBlank()]);
			battle.planEnemyTurn();

			buggy.structure = 0;
			expect(battle.getIntents(buggy)).toEqual([]);
			await battle.endPlayerTurn();

			expect(rig.structure).toBe(20);
			expect(logLines(battle, 'general')).toContain('Buggy is wrecked and drops its plan');
		});
	});

	describe('a flanker the player outpaces is previewed from where it drops back', () => {
		// The Buggy (speed 5) outran the Rig (3) onto the player shoulder,
		// center, holding enemy outside center. A Nitro Boost puts the Rig at
		// 6, so the Buggy drops back at the end of the player's turn.
		const flankRig = (): void => {
			buggy.set({
				slot: slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER),
				flank: { reservedSlot: slot(RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER), outran: rig }
			});
		};

		const boost = (vehicle: Vehicle): void => {
			giveHand(vehicle, [nitro()]);
			expect(battle.playCard({ driver: driverOf(vehicle), cardIndex: 0 })).toBe(true);
		};

		test('an attack loses the flank bonus it planned with', async () => {
			flankRig();
			giveHand(buggy, [farShot()]);
			battle.planEnemyTurn();
			expect(battle.getIntents(buggy)[0]).toMatchObject({ amount: 6, target: rig.id });

			boost(rig);
			expect(battle.getIntents(buggy)[0]).toMatchObject({ amount: 4, target: rig.id });
			await battle.endPlayerTurn();

			expect(buggy.slot).toEqual(slot(RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER));
			expect(logLines(battle, 'damage_dealt')).toEqual([expect.stringMatching(/^Far Shot deals 4 total .*damage to Rig /)]);
		});

		describe('when its plan starts with its own flank', () => {
			// The Bike (speed 3) is first in the roster, so the Buggy plans to
			// flank it from the shoulder onto the behind row, then shoot it from
			// there with the bonus: range 2, where its reserved slot is range 3.
			const longShot = () => card('Long Shot', 'enemy_single', [{ type: 'damage', value: 4, range: 3, always_hits: true }]);

			beforeEach(() => {
				rig = createVehicle('Rig', 1, slot(RoadLane.PLAYER_INSIDE, RoadRow.CENTER));
				bike = createVehicle('Bike', 1, slot(RoadLane.PLAYER_INSIDE, RoadRow.BEHIND));
				buggy = createVehicle('Buggy', 3);
				battle = createBattle([bike, rig], [buggy]);
				flankRig();
				giveHand(buggy, [flank(), longShot()]);
				battle.planEnemyTurn();
				expect(battle.getPlan(buggy).map(action => [action.card.name, action.target])).toEqual([['Flank', bike], ['Long Shot', bike]]);
				expect(battle.getIntents(buggy)[1]).toMatchObject({ amount: 6, target: bike.id });
			});

			test('it drops back, flanks again, and shoots from where the flank takes it', async () => {
				boost(rig);
				expect(battle.getIntents(buggy)[1]).toMatchObject({ amount: 6, target: bike.id });
				await battle.endPlayerTurn();

				expect(buggy.slot).toEqual(slot(RoadLane.PLAYER_SHOULDER, RoadRow.BEHIND));
				expect(logLines(battle, 'fizzle')).toEqual([]);
				expect(logLines(battle, 'damage_dealt')).toEqual([expect.stringMatching(/^Long Shot deals 6 total .*damage to Bike /)]);
			});

			test('a flank the player outpaces too drops out of the preview and leaves it shooting from its reserved slot', async () => {
				boost(rig);
				boost(bike);
				expect(battle.getIntents(buggy)).toEqual([expect.objectContaining({ description: 'Long Shot', amount: 4, target: bike.id })]);
				await battle.endPlayerTurn();

				expect(buggy.slot).toEqual(slot(RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER));
				expect(logLines(battle, 'fizzle')).toEqual(["Buggy's Flank fizzles: Buggy is not faster than Bike"]);
				expect(logLines(battle, 'damage_dealt')).toEqual([expect.stringMatching(/^Long Shot deals 4 total .*damage to Bike /)]);
			});
		});
	});

	describe('the preview replays the whole enemy turn', () => {
		// Speeds here are baseSpeed plus the test driver's 2
		const tireSpikes = () => card('Tire Spikes', 'enemy_single', [
			{ type: 'apply_status', status: 'speed_reduction', value: -4, duration: 2, range: 3, target: 'target', always_hits: true }
		]);
		const ram = () => card('Ram', 'enemy_single', [{ type: 'damage', value: 0, formula: 'speed_diff', range: 1, always_hits: true }]);

		test('a fizzled slow changes nothing, so a later raider\'s flank that needed it drops out too', async () => {
			// The Spiker (4) outran the Bike (3) onto the player shoulder, center,
			// and can spike the Rig (5) from there. Slowed to 1, the Rig is one
			// the Hauler (4) can outrun.
			rig = createVehicle('Rig', 3, slot(RoadLane.PLAYER_INSIDE, RoadRow.BEHIND));
			bike = createVehicle('Bike', 1, slot(RoadLane.PLAYER_OUTSIDE, RoadRow.CENTER));
			const spiker = createVehicle('Spiker', 2, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
			const hauler = createVehicle('Hauler', 2, slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
			battle = createBattle([rig, bike], [spiker, hauler]);
			spiker.set({
				slot: slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER),
				flank: { reservedSlot: slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD), outran: bike }
			});
			giveHand(spiker, [tireSpikes()]);
			giveHand(hauler, [flank()]);
			battle.planEnemyTurn();
			expect(battle.getIntents(spiker)).toEqual([expect.objectContaining({ description: 'Tire Spikes', target: rig.id })]);
			expect(battle.getIntents(hauler)).toEqual([expect.objectContaining({ description: 'Flank', target: rig.id })]);

			// The Bike outpaces the Spiker, which drops back 4 from the Rig
			giveHand(bike, [nitro()]);
			expect(battle.playCard({ driver: driverOf(bike), cardIndex: 0 })).toBe(true);
			expect(battle.getIntents(spiker)).toEqual([]);
			expect(battle.getIntents(hauler)).toEqual([]);
			await battle.endPlayerTurn();

			expect(logLines(battle, 'fizzle')).toEqual([
				"Spiker's Tire Spikes fizzles: Rig is out of range (4 away, needs 3)",
				"Hauler's Flank fizzles: Hauler is not faster than Rig"
			]);
			expect(hauler.slot).toEqual(slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
		});

		test('a Ram after another raider\'s slow previews the speed gap the slow opens', async () => {
			// The Rammer (8) against the Rig (5), slowed to 1 first
			rig = createVehicle('Rig', 3, slot(RoadLane.PLAYER_INSIDE, RoadRow.CENTER));
			const spiker = createVehicle('Spiker', 1, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER));
			const rammer = createVehicle('Rammer', 6, slot(RoadLane.ENEMY_INSIDE, RoadRow.CENTER));
			battle = createBattle([rig, bike], [spiker, rammer]);
			giveHand(spiker, [tireSpikes()]);
			giveHand(rammer, [ram()]);
			battle.planEnemyTurn();

			expect(battle.getIntents(rammer)).toEqual([expect.objectContaining({ description: 'Ram', amount: 7, target: rig.id })]);
			await battle.endPlayerTurn();

			expect(logLines(battle, 'damage_dealt')).toEqual([expect.stringMatching(/^Ram deals 7 total .*damage to Rig /)]);
		});
	});

	describe('planning from the board the enemy turn will find', () => {
		test('a flanker whose boost wore off plans from the slot it will drop back to', async () => {
			// Boosted to 6, the Buggy outran the Rig (3). The boost wears off at
			// the start of the next player turn, before the plan is made, so it
			// will drop back to enemy outside ahead, where the Rig is 3 away.
			buggy = createVehicle('Buggy', 1, slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
			battle = createBattle([rig, bike], [buggy]);
			buggy.set({
				slot: slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER),
				flank: { reservedSlot: slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD), outran: rig }
			});
			buggy.applyStatusEffect({ name: 'speed_boost', duration: 1, value: 3 });
			giveHand(buggy, []);
			driverOf(buggy).deck?.addCards([farShot()]);
			await battle.endPlayerTurn();

			expect(buggy.slot).toEqual(slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER));
			expect(buggy.speed).toBe(3);
			expect(driverOf(buggy).hand.map(held => held.name)).toEqual(['Far Shot']);
			expect(battle.getPlan(buggy)).toEqual([]);
			await battle.endPlayerTurn();

			expect(buggy.slot).toEqual(slot(RoadLane.ENEMY_OUTSIDE, RoadRow.AHEAD));
			expect(logLines(battle, 'fizzle')).toEqual([]);
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

	describe('stepping the enemy turn one action at a time (DDB-112)', () => {
		let hauler: Vehicle;

		beforeEach(() => {
			hauler = createVehicle('Hauler', 2);
			battle = createBattle([rig, bike], [buggy, hauler]);
			giveHand(buggy, [pointBlank(), armorUp()]);
			giveHand(hauler, [farShot()]);
			battle.planEnemyTurn();
		});

		test('plays each planned card on its own step, in plan order, and the player draws only after the last', () => {
			const events: string[] = [];
			battle.on('hitLanded', ({ vehicle }: { vehicle: Vehicle }) => events.push(`hit ${vehicle.name}`));
			battle.on('stateChanged', () => events.push(`turn ${battle.turn}, hand ${driverOf(rig).hand.length}`));
			battle.on('turnEnded', ({ team }: { team: string }) => events.push(`${team} turn ended`));
			driverOf(rig).deck?.addCards(Array.from({ length: 5 }, armorUp));

			battle.endPlayerTurn({ stepEnemyTurn: true });
			expect(battle.isPlayerTurn).toBe(false);
			expect(battle.enemyTurnInProgress).toBe(true);
			expect(logLines(battle, 'card_played')).toEqual([]);
			expect(events).toEqual(['player turn ended']);

			const steps = [];
			for (let step = battle.stepEnemyTurn(); step; step = battle.stepEnemyTurn()) {
				steps.push(`${step.raider.name}: ${step.card?.name} at ${step.target?.name ?? 'nobody'}, ${step.outcome}`);
				// Nothing is drawn while raiders still act
				expect(driverOf(rig).hand).toEqual([]);
				expect(battle.turn).toBe(1);
			}

			expect(steps).toEqual([
				'Buggy: Point Blank at Rig, played',
				'Buggy: Armor Up at nobody, played',
				'Hauler: Far Shot at Rig, played'
			]);
			expect(events).toEqual(['player turn ended', 'hit Rig', 'hit Rig', 'turn 2, hand 5']);
			expect(battle.enemyTurnInProgress).toBe(false);
			expect(battle.isPlayerTurn).toBe(true);
			expect(battle.stepEnemyTurn()).toBeNull();
		});

		test('lets nothing else happen while the raiders act', () => {
			battle.endPlayerTurn({ stepEnemyTurn: true });
			giveHand(rig, [pointBlank()]);

			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: buggy })).toBe(false);
			battle.endPlayerTurn();
			expect(battle.enemyTurnInProgress).toBe(true);
			expect(logLines(battle, 'card_played')).toEqual([]);
		});

		test('runs the rest of the turn at once, as endPlayerTurn does by default', () => {
			battle.endPlayerTurn({ stepEnemyTurn: true });
			expect(battle.stepEnemyTurn()?.card?.name).toBe('Point Blank');

			battle.runEnemyTurn();

			expect(battle.enemyTurnInProgress).toBe(false);
			expect(battle.isPlayerTurn).toBe(true);
			expect(logLines(battle, 'card_played')).toEqual([
				expect.stringContaining('plays Point Blank'),
				expect.stringContaining('plays Armor Up'),
				expect.stringContaining('plays Far Shot')
			]);
		});

		test('a raider that drops its plan is one step, with no card, and its other cards are skipped', () => {
			giveHand(bike, [realCard('emp_blast')]);
			expect(battle.playCard({ driver: driverOf(bike), cardIndex: 0 })).toBe(true);
			battle.endPlayerTurn({ stepEnemyTurn: true });

			expect(battle.stepEnemyTurn()).toEqual({ raider: buggy, card: null, target: null, outcome: 'dropped' });
			expect(battle.stepEnemyTurn()).toEqual({ raider: hauler, card: null, target: null, outcome: 'dropped' });
			expect(battle.stepEnemyTurn()).toBeNull();
			expect(battle.isPlayerTurn).toBe(true);
			expect(logLines(battle, 'general').filter(line => line.includes('stunned'))).toEqual([
				'Buggy is stunned and skips its turn',
				'Hauler is stunned and skips its turn'
			]);
		});

		test('a card that fizzles is a step of its own, headed where it was planned', () => {
			// Rig outruns the buggy onto the enemy shoulder, out of Point Blank's reach
			rig = createVehicle('Rig', 5);
			battle = createBattle([rig, createVehicle('Bike', 1)], [buggy]);
			giveHand(buggy, [pointBlank()]);
			battle.planEnemyTurn();
			giveHand(rig, [flank()]);
			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: buggy })).toBe(true);
			battle.endPlayerTurn({ stepEnemyTurn: true });

			expect(battle.stepEnemyTurn()).toEqual(expect.objectContaining({ raider: buggy, target: rig, outcome: 'fizzled' }));
			expect(rig.structure).toBe(20);
		});

		test('ends with the battle when a step wins it for the raiders, and plays nothing after', () => {
			const headshot = () => card('Headshot', 'enemy_single', [{ type: 'damage', value: 100, target: 'driver', always_hits: true }]);
			battle = createBattle([rig, bike], [buggy]);
			// The Bike's driver is already dead, so the Rig's is the last
			driverOf(bike).set({ hitpoints: 0 });
			battle.playerTeam.handleDriverDeath(bike);
			giveHand(buggy, [headshot(), headshot()]);
			battle.planEnemyTurn();
			battle.endPlayerTurn({ stepEnemyTurn: true });

			expect(battle.stepEnemyTurn()).toEqual(expect.objectContaining({ raider: buggy, target: rig, outcome: 'played' }));
			expect(battle.battleOver).toBe(true);
			expect(battle.battleWon).toBe(false);
			expect(battle.enemyTurnInProgress).toBe(false);
			expect(battle.stepEnemyTurn()).toBeNull();
			expect(logLines(battle, 'card_played')).toHaveLength(1);
			expect(battle.isPlayerTurn).toBe(false);
		});
	});

	describe('a raider stunned by EMP Blast', () => {
		let hauler: Vehicle;

		// The Bike's driver plays the real card, so its duration is what cards.json says
		const playEmp = (): void => {
			giveHand(bike, [realCard('emp_blast')]);
			expect(battle.playCard({ driver: driverOf(bike), cardIndex: 0 })).toBe(true);
		};

		beforeEach(() => {
			hauler = createVehicle('Hauler', 2);
			battle = createBattle([rig, bike], [buggy, hauler]);
			giveHand(buggy, [pointBlank()]);
			giveHand(hauler, [farShot()]);
			battle.planEnemyTurn();
			expect(battle.getIntents(buggy)).toEqual([expect.objectContaining({ description: 'Point Blank', target: rig.id })]);
			expect(battle.getIntents(hauler)).toEqual([expect.objectContaining({ description: 'Far Shot', target: rig.id })]);
		});

		test('shows no intents and plays nothing on the enemy turn, and the log says it skipped', async () => {
			playEmp();
			expect(battle.getAllIntents().size).toBe(0);
			await battle.endPlayerTurn();

			expect(logLines(battle, 'card_played')).toEqual([expect.stringContaining('plays EMP Blast')]);
			expect([rig.structure, bike.structure]).toEqual([20, 20]);
			expect(logLines(battle, 'general')).toEqual(expect.arrayContaining([
				'Buggy is stunned and skips its turn',
				'Hauler is stunned and skips its turn'
			]));
		});

		test('a raider whose driver the player killed after the EMP drops its plan for that, not the stun', async () => {
			const headshot = card('Headshot', 'enemy_single', [{ type: 'damage', value: 100, target: 'driver', always_hits: true }]);
			playEmp();
			giveHand(rig, [headshot]);
			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: buggy })).toBe(true);
			expect(buggy.isOutOfFight).toBe(true);
			await battle.endPlayerTurn();

			const general = logLines(battle, 'general');
			expect(general).toContain('Buggy lost its driver and drops its plan');
			expect(general).not.toContain('Buggy is stunned and skips its turn');
			expect(general).toContain('Hauler is stunned and skips its turn');
		});

		test('the preview has already dropped its intents when the play is announced', () => {
			let shown: Map<Vehicle, unknown> | null = null;
			battle.on('stateChanged', () => {
				shown = battle.getAllIntents();
			});

			playEmp();

			expect(shown).toEqual(new Map());
		});

		test('wears off at the start of the next player turn, so the raider plans and acts again', async () => {
			playEmp();
			await battle.endPlayerTurn();

			// The unplayed cards were discarded and shuffle back in for the new hand
			expect([buggy.isStunned, hauler.isStunned]).toEqual([false, false]);
			expect(battle.getIntents(buggy)).toEqual([expect.objectContaining({ description: 'Point Blank', target: rig.id })]);
			expect(battle.getIntents(hauler)).toEqual([expect.objectContaining({ description: 'Far Shot', target: rig.id })]);
			battle.clearMessages();
			await battle.endPlayerTurn();

			expect(logLines(battle, 'general').filter(line => line.includes('stunned'))).toEqual([]);
			expect(logLines(battle, 'card_played')).toEqual([
				expect.stringContaining('Buggy Driver plays Point Blank'),
				expect.stringContaining('Hauler Driver plays Far Shot')
			]);
			expect(rig.structure).toBe(16);
		});

		test('still drops back at the end of the player turn when outpaced on the shoulder', async () => {
			// The Buggy (5) outran the Rig (3) onto the player shoulder, center,
			// holding enemy outside center, where Far Shot still reaches the Rig
			battle = createBattle([rig, bike], [buggy]);
			buggy.set({
				slot: slot(RoadLane.PLAYER_SHOULDER, RoadRow.CENTER),
				flank: { reservedSlot: slot(RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER), outran: rig }
			});
			giveHand(buggy, [farShot()]);
			battle.planEnemyTurn();
			expect(battle.getIntents(buggy)).toEqual([expect.objectContaining({ description: 'Far Shot', target: rig.id })]);

			playEmp();
			giveHand(rig, [nitro()]);
			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0 })).toBe(true);
			await battle.endPlayerTurn();

			expect(buggy.slot).toEqual(slot(RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER));
			expect(buggy.flank).toBeNull();
			expect(rig.structure).toBe(20);
			expect(logLines(battle, 'general')).toContain('Buggy is stunned and skips its turn');
		});
	});
});
