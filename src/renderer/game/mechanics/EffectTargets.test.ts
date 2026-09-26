import { Battle } from './Battle';
import { BoardProjection } from './BoardProjection';
import { Card, CardData, CardEffect, TargetType } from './Card';
import { Driver } from './Driver';
import { EffectRecipient, effectRecipientOf } from './EffectTargets';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import cardsFile from '../data/cards.json';

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

const realCard = (type: string): Card => {
	const data = cardData.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data, upgraded: false });
};

const card = (name: string, targetType: TargetType, effects: CardEffect[]): Card => new Card({
	type: name.toLowerCase().replace(/ /g, '_'),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost: 1,
	targetType,
	effects,
	tags: []
});

// Total speed is baseSpeed plus the test driver's 50. Test drivers have
// gunnery 5 and evade 5, so anything that rolls to hit misses by default.
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

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const giveHand = (vehicle: Vehicle, cards: Card[]): void => {
	driverOf(vehicle).set({ hand: cards, adrenaline: 5 });
};

const setGunnery = (vehicle: Vehicle, gunnery: number): void => {
	driverOf(vehicle).set({ skills: { ramming: 5, gunnery, evade: 5 } });
};

const setEvade = (vehicle: Vehicle, evade: number): void => {
	driverOf(vehicle).set({ skills: { ramming: 5, gunnery: 5, evade } });
};

const statusNames = (vehicle: Vehicle): string[] => vehicle.statusEffects.map(effect => effect.name);

const logLines = (battle: Battle, type: string): string[] =>
	battle.getMessages().filter(m => m.type === type).map(m => m.message);

// A slow on the target and a boost on the caster, both landing without a roll
const slipstream = (): Card => card('Slipstream', 'enemy_single', [
	{ type: 'apply_status', status: 'speed_reduction', value: -2, duration: 2, target: 'target', always_hits: true },
	{ type: 'apply_status', status: 'speed_boost', value: 3, duration: 2, target: 'self' }
]);

// An area slow that rolls to hit each enemy
const tarSpray = (): Card => card('Tar Spray', 'enemy_all', [
	{ type: 'apply_status', status: 'speed_reduction', value: -2, duration: 2, target: 'enemy_all' }
]);

describe('Effect targets', () => {
	// Rig 55 in player inside center, Bike 53 in player inside behind,
	// Buggy 53 and Truck 51 in the enemy formation.
	let rig: Vehicle;
	let bike: Vehicle;
	let buggy: Vehicle;
	let truck: Vehicle;
	let battle: Battle;

	beforeEach(() => {
		rig = createVehicle('Rig', 5);
		bike = createVehicle('Bike', 3);
		buggy = createVehicle('Buggy', 3);
		truck = createVehicle('Truck', 1);
		battle = new Battle({
			playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, bike] }),
			enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [buggy, truck] })
		});
	});

	describe('resolving an effect', () => {
		test('reads the effect target first and falls back to the card target type', () => {
			const berserker = realCard('berserker');
			const emp = realCard('emp_blast');
			const headshot = realCard('headshot');
			const selfDraw = card('Self Draw', 'self', [{ type: 'draw', value: 1 }]);

			expect(berserker.effects.map(effect => effectRecipientOf({ effect, card: berserker })))
				.toEqual([EffectRecipient.CASTER, EffectRecipient.CASTER, EffectRecipient.CASTER]);
			expect(effectRecipientOf({ effect: emp.effects[0], card: emp })).toBe(EffectRecipient.ENEMIES);
			expect(effectRecipientOf({ effect: headshot.effects[0], card: headshot })).toBe(EffectRecipient.TARGET);
			expect(effectRecipientOf({ effect: selfDraw.effects[0], card: selfDraw })).toBe(EffectRecipient.CASTER);
		});
	});

	describe('Berserker', () => {
		test('with gunnery below evade it still deals its self damage, gives its adrenaline, and makes the vehicle Vulnerable', () => {
			setGunnery(rig, 1);
			driverOf(rig).set({ hand: [realCard('berserker')], adrenaline: 1 });

			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0 })).toBe(true);

			expect(driverOf(rig).hitpoints).toBe(97);
			expect(driverOf(rig).adrenaline).toBe(3);
			expect(statusNames(rig)).toEqual(['vulnerable']);
			expect(logLines(battle, 'miss')).toEqual([]);
		});

		test("its self damage lands as printed, not raised by the caster's own Vulnerable", () => {
			rig.applyStatusEffect({ name: 'vulnerable', duration: -1, value: 0 });
			giveHand(rig, [realCard('berserker')]);
			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0 })).toBe(true);

			expect(driverOf(rig).hitpoints).toBe(97);
		});

		test('a raider playing it hurts only its own driver', async () => {
			giveHand(buggy, [realCard('berserker')]);
			battle.planEnemyTurn();

			await battle.endPlayerTurn();

			expect(driverOf(buggy).hitpoints).toBe(97);
			expect([rig, bike, truck].map(vehicle => driverOf(vehicle).hitpoints)).toEqual([100, 100, 100]);
		});
	});

	describe('EMP Blast', () => {
		test('lands on every raider and never on the caster or its partner', () => {
			setGunnery(rig, 6);
			giveHand(rig, [realCard('emp_blast')]);

			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0 })).toBe(true);

			expect(statusNames(buggy)).toEqual(['stunned']);
			expect(statusNames(truck)).toEqual(['stunned']);
			expect(statusNames(rig)).toEqual([]);
			expect(statusNames(bike)).toEqual([]);
		});

		test('rolls the hit check against each raider on its own', () => {
			setGunnery(rig, 6);
			setEvade(truck, 9);
			giveHand(rig, [realCard('emp_blast')]);

			battle.playCard({ driver: driverOf(rig), cardIndex: 0 });

			expect(statusNames(buggy)).toEqual(['stunned']);
			expect(statusNames(truck)).toEqual([]);
			expect(logLines(battle, 'miss')).toEqual(['EMP Blast misses Truck']);
		});

		test('skips a raider already out of the fight', () => {
			setGunnery(rig, 6);
			truck.set({ structure: 0 });
			giveHand(rig, [realCard('emp_blast')]);

			battle.playCard({ driver: driverOf(rig), cardIndex: 0 });

			expect(statusNames(buggy)).toEqual(['stunned']);
			expect(statusNames(truck)).toEqual([]);
		});

		test('a raider playing it lands on every player vehicle and none of its own side', async () => {
			setGunnery(buggy, 6);
			giveHand(buggy, [realCard('emp_blast')]);
			battle.planEnemyTurn();

			await battle.endPlayerTurn();

			expect(logLines(battle, 'status_applied')).toEqual([
				'EMP Blast applies stunned to Rig',
				'EMP Blast applies stunned to Bike'
			]);
		});
	});

	describe('a card with a self effect and a target effect', () => {
		test('Slipstream slows the target and boosts the caster', () => {
			giveHand(rig, [slipstream()]);

			battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: buggy });

			expect(statusNames(buggy)).toEqual(['speed_reduction']);
			expect(statusNames(rig)).toEqual(['speed_boost']);
			expect(buggy.getTotalSpeed()).toBe(51);
			expect(rig.getTotalSpeed()).toBe(58);
		});

		test('Flanking Maneuver moves the caster and puts its damage bonus on the caster, not the target', () => {
			giveHand(rig, [realCard('flanking_maneuver')]);

			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: buggy })).toBe(true);

			expect(rig.isFlanking).toBe(true);
			expect(statusNames(rig)).toEqual(['damage_bonus']);
			expect(statusNames(buggy)).toEqual([]);
		});

		test('self damage on a targeted card hits the caster whether or not the attack lands', () => {
			const reckless = card('Reckless Shot', 'enemy_single', [
				{ type: 'damage', value: 4, target: 'target' },
				{ type: 'damage', value: 2, target: 'self_driver' }
			]);
			giveHand(rig, [reckless]);

			battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: buggy });

			expect(logLines(battle, 'miss')).toEqual(['Reckless Shot misses Buggy']);
			expect(buggy.structure).toBe(20);
			expect(driverOf(rig).hitpoints).toBe(98);
		});
	});

	describe('the planning projection agrees with play', () => {
		const speeds = (vehicles: Vehicle[]): number[] => vehicles.map(vehicle => vehicle.getTotalSpeed());

		test.each([
			['Slipstream', slipstream, true],
			['Tar Spray', tarSpray, false],
			['Nitro Boost', () => realCard('nitro_boost'), false],
			['Berserker', () => realCard('berserker'), false]
		])('%s', (_name, makeCard, targeted) => {
			// Gunnery 6 hits the Buggy (evade 5) and misses the Truck (evade 9)
			setGunnery(rig, 6);
			setEvade(truck, 9);
			const played = makeCard();
			giveHand(rig, [played]);
			const everyone = [rig, bike, buggy, truck];
			const target = targeted ? buggy : null;

			const board = new BoardProjection({ battle });
			board.apply({ card: played, driver: driverOf(rig), target });
			const projected = everyone.map(vehicle => board.speedOf(vehicle));

			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: target ?? undefined })).toBe(true);
			expect(speeds(everyone)).toEqual(projected);
		});

		test('a raider plans an area slow on the vehicles it will hit', async () => {
			setGunnery(buggy, 6);
			setEvade(bike, 9);
			const spray = tarSpray();
			giveHand(buggy, [spray]);

			const board = new BoardProjection({ battle });
			board.apply({ card: spray, driver: driverOf(buggy), target: null });
			expect([rig, bike, buggy, truck].map(vehicle => board.speedOf(vehicle))).toEqual([53, 53, 53, 51]);

			battle.planEnemyTurn();
			await battle.endPlayerTurn();

			expect(logLines(battle, 'status_applied')).toEqual(['Tar Spray applies speed_reduction to Rig (Speed: 55 -> 53)']);
			expect(logLines(battle, 'miss')).toEqual(['Tar Spray misses Bike']);
		});
	});
});
