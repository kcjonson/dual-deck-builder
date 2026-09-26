import { Battle } from './Battle';
import { Card, CardData } from './Card';
import { Driver } from './Driver';
import { EscortType, createEscort } from './Escort';
import { RaiderArchetype } from './RaiderArchetype';
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

// Test drivers have speed 2, so a driven vehicle here moves at baseSpeed + 2
const createDriven = (name: string, startSlot: RoadSlot, baseSpeed = 2): Vehicle => {
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

const escortAt = (type: EscortType, at: RoadSlot): Vehicle => {
	const escort = createEscort({ type });
	escort.slot = at;
	return escort;
};

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const raiderCard = (name: string, targetType: CardData['targetType'], effects: CardData['effects']): Card => new Card({
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

const potShot = (range = 10): Card => raiderCard('Pot Shot', 'enemy_single', [{ type: 'damage', value: 3, range, target: 'target', always_hits: true }]);
const flank = (): Card => raiderCard('Flank', 'enemy_single', [{ type: 'change_position', position: 'flanking', target: 'self' }]);

const P_INSIDE = RoadLane.PLAYER_INSIDE;
const P_OUTSIDE = RoadLane.PLAYER_OUTSIDE;
const E_INSIDE = RoadLane.ENEMY_INSIDE;
const { AHEAD, CENTER, BEHIND } = RoadRow;

/**
 * Rig inside center and Bike inside behind, the raider's Buggy at enemy
 * inside center, plus whatever escorts the test brings. The Buggy is range
 * 1 from the Rig and range 2 from anything in the player's outside lane in
 * its row. Escorts go first in the roster unless a test says otherwise, so
 * FirstPlayableAI, which aims at the first legal target, would pick one.
 */
const setup = ({
	archetype = null,
	escorts = [],
	escortsFirst = true
}: {
	archetype?: RaiderArchetype | null;
	escorts?: Vehicle[];
	escortsFirst?: boolean;
}): { battle: Battle; rig: Vehicle; bike: Vehicle; buggy: Vehicle } => {
	const rig = createDriven('Rig', slot(P_INSIDE, CENTER));
	const bike = createDriven('Bike', slot(P_INSIDE, BEHIND));
	const buggy = createDriven('Buggy', slot(E_INSIDE, CENTER), 3);
	buggy.raiderArchetype = archetype;
	const driven = [rig, bike];
	const battle = new Battle({
		playerTeam: new Team({ type: TeamType.PLAYER, vehicles: escortsFirst ? [...escorts, ...driven] : [...driven, ...escorts] }),
		enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [buggy] })
	});
	return { battle, rig, bike, buggy };
};

const plan = (battle: Battle, buggy: Vehicle, cards: Card[]): void => {
	driverOf(buggy).set({ hand: cards, adrenaline: 5 });
	battle.planEnemyTurn();
};

const intentTargets = (battle: Battle, buggy: Vehicle): (string | null)[] =>
	battle.getIntents(buggy).map(intent => intent.target);

const logLines = (battle: Battle, type: string): string[] =>
	battle.getMessages().filter(message => message.type === type).map(message => message.message);

describe('Raider target preferences', () => {
	describe('looter', () => {
		test('goes for a hauler when its card can reach one', () => {
			const hauler = escortAt('fuel_hauler', slot(P_OUTSIDE, CENTER));
			const { battle, buggy } = setup({ archetype: 'looter', escorts: [hauler], escortsFirst: false });
			plan(battle, buggy, [potShot()]);

			expect(battle.getPlan(buggy)[0].target).toBe(hauler);
			expect(intentTargets(battle, buggy)).toEqual([hauler.id]);
		});

		test('falls back to planning as usual when the hauler is out of range', () => {
			const hauler = escortAt('fuel_hauler', slot(P_OUTSIDE, CENTER));
			const { battle, rig, buggy } = setup({ archetype: 'looter', escorts: [hauler] });
			// Range 1 reaches the Rig but not the hauler two lanes over
			plan(battle, buggy, [potShot(1)]);

			expect(intentTargets(battle, buggy)).toEqual([rig.id]);
		});

		test('falls back to planning as usual with no hauler, even past a gun escort', () => {
			const pilotCar = escortAt('pilot_car', slot(P_OUTSIDE, CENTER));
			const { battle, buggy } = setup({ archetype: 'looter', escorts: [pilotCar] });
			plan(battle, buggy, [potShot()]);

			// No preference to act on, so FirstPlayableAI's first legal target stands
			expect(intentTargets(battle, buggy)).toEqual([pilotCar.id]);
		});

		test('counts the Med Truck as a hauler', () => {
			const medTruck = escortAt('med_truck', slot(P_OUTSIDE, BEHIND));
			const { battle, buggy } = setup({ archetype: 'looter', escorts: [medTruck], escortsFirst: false });
			plan(battle, buggy, [potShot()]);

			expect(intentTargets(battle, buggy)).toEqual([medTruck.id]);
		});

		test('lets the AI\'s own scoring choose between two haulers', () => {
			const fresh = escortAt('fuel_hauler', slot(P_OUTSIDE, CENTER));
			const damaged = escortAt('med_truck', slot(P_OUTSIDE, BEHIND));
			damaged.set({ structure: 2, armor: 0 });
			// The softest target on the road, but not a hauler
			const wreckedGun = escortAt('pilot_car', slot(P_OUTSIDE, AHEAD));
			wreckedGun.set({ structure: 1, armor: 0 });
			const { battle, buggy } = setup({ archetype: 'looter', escorts: [fresh, damaged, wreckedGun], escortsFirst: false });
			battle.aiController.setEnemyAI('aggressive');
			plan(battle, buggy, [potShot()]);

			// The aggressive AI favors a kill, and it only looks at the haulers
			expect(intentTargets(battle, buggy)).toEqual([damaged.id]);
		});

		test('a flank keeps its usual target, since nothing lands on the vehicle it outruns', () => {
			const hauler = escortAt('fuel_hauler', slot(P_OUTSIDE, CENTER));
			const { battle, rig, buggy } = setup({ archetype: 'looter', escorts: [hauler], escortsFirst: false });
			plan(battle, buggy, [flank()]);

			expect(intentTargets(battle, buggy)).toEqual([rig.id]);
		});
	});

	describe('killer', () => {
		test('goes for a driven vehicle over an escort', () => {
			const pilotCar = escortAt('pilot_car', slot(P_OUTSIDE, CENTER));
			const hauler = escortAt('fuel_hauler', slot(P_OUTSIDE, AHEAD));
			const { battle, rig, buggy } = setup({ archetype: 'killer', escorts: [pilotCar, hauler] });
			plan(battle, buggy, [potShot()]);

			expect(intentTargets(battle, buggy)).toEqual([rig.id]);
		});

		test('passes up a nearly wrecked escort the aggressive AI would otherwise finish', () => {
			const planAgainstWreck = (archetype: RaiderArchetype | null): { target: string | null; rig: Vehicle; pilotCar: Vehicle } => {
				const pilotCar = escortAt('pilot_car', slot(P_OUTSIDE, CENTER));
				pilotCar.set({ structure: 2, armor: 0 });
				const { battle, rig, buggy } = setup({ archetype, escorts: [pilotCar], escortsFirst: false });
				battle.aiController.setEnemyAI('aggressive');
				plan(battle, buggy, [potShot()]);
				return { target: intentTargets(battle, buggy)[0], rig, pilotCar };
			};

			const unaligned = planAgainstWreck(null);
			expect(unaligned.target).toBe(unaligned.pilotCar.id);

			const killer = planAgainstWreck('killer');
			expect(killer.target).toBe(killer.rig.id);
		});

		test('Draw Fire still pulls its shot onto the escort in the row', async () => {
			const pilotCar = escortAt('pilot_car', slot(P_OUTSIDE, CENTER));
			const { battle, rig, buggy } = setup({ archetype: 'killer', escorts: [pilotCar] });
			plan(battle, buggy, [potShot()]);
			expect(intentTargets(battle, buggy)).toEqual([rig.id]);

			const drawFire = realCard('draw_fire');
			driverOf(rig).set({ hand: [drawFire], adrenaline: 5 });
			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: pilotCar })).toBe(true);
			expect(intentTargets(battle, buggy)).toEqual([pilotCar.id]);

			await battle.endPlayerTurn();

			expect(rig.structure).toBe(20);
			expect(logLines(battle, 'general')).toContain("Pilot Car draws Buggy's Pot Shot away from Rig");
		});
	});

	describe('no archetype', () => {
		test('plans exactly as before: the first legal target, escort or not', () => {
			const hauler = escortAt('fuel_hauler', slot(P_OUTSIDE, CENTER));
			const { battle, buggy } = setup({ escorts: [hauler] });
			plan(battle, buggy, [potShot()]);

			expect(buggy.raiderArchetype).toBeNull();
			expect(intentTargets(battle, buggy)).toEqual([hauler.id]);
		});
	});

	test('the planned marks are where the cards land', async () => {
		const hauler = escortAt('fuel_hauler', slot(P_OUTSIDE, CENTER));
		const { battle, rig, buggy } = setup({ archetype: 'looter', escorts: [hauler], escortsFirst: false });
		// The long shot can reach the hauler; the short one falls back to the Rig
		plan(battle, buggy, [potShot(), potShot(1)]);
		const marks = intentTargets(battle, buggy);
		expect(marks).toEqual([hauler.id, rig.id]);

		await battle.endPlayerTurn();

		const hits = logLines(battle, 'damage_dealt').filter(line => line.startsWith('Pot Shot'));
		const byId = new Map([[hauler.id, hauler.name], [rig.id, rig.name]]);
		expect(hits).toHaveLength(2);
		hits.forEach((line, index) => expect(line).toContain(`damage to ${byId.get(marks[index] ?? '')}`));
		expect(hauler.armor).toBeLessThan(hauler.maxArmor);
		expect(rig.structure).toBeLessThan(20);
	});
});
