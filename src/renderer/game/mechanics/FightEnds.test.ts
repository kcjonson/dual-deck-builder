import { BREAK_OFF_TURNS, Battle } from './Battle';
import { Card } from './Card';
import { Driver } from './Driver';
import { RoadSlot } from './Road';
import { ReinforcementWave, Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';

const createVehicle = (name: string, { threat, leader = false, slot = null }: { threat?: number; leader?: boolean; slot?: RoadSlot | null } = {}): Vehicle => {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({ hitpoints: 100, maxHitpoints: 100 });
	return new Vehicle({
		name,
		armor: 0,
		maxArmor: 0,
		structure: 50,
		maxStructure: 50,
		baseSpeed: 3,
		slot,
		flank: null,
		velocity: 0,
		driver,
		passenger: null,
		statusEffects: [],
		threat,
		leader
	});
};

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const card = (name: string, effects: Card['effects']): Card => new Card({
	type: name.toLowerCase().replace(/ /g, '_'),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost: 0,
	targetType: 'enemy_single',
	effects,
	tags: []
});

const killShot = (): Card => card('Kill Shot', [{ type: 'damage', value: 500, target: 'driver', always_hits: true }]);
const scratch = (): Card => card('Scratch', [{ type: 'damage', value: 1, always_hits: true }]);

describe('How a fight ends', () => {
	let rig: Vehicle;
	let bike: Vehicle;

	beforeEach(() => {
		rig = createVehicle('Rig');
		bike = createVehicle('Bike');
	});

	const fight = (raiders: Vehicle[], reinforcements: ReinforcementWave[] = [], breakOffTurns: number | null = BREAK_OFF_TURNS): Battle => {
		const battle = new Battle({
			playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, bike] }),
			enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: raiders, reinforcements }),
			breakOffTurns
		});
		battle.start();
		return battle;
	};

	const play = (battle: Battle, played: Card, target: Vehicle): void => {
		driverOf(rig).set({ hand: [played], adrenaline: 5 });
		expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: target })).toBe(true);
	};

	describe('rout', () => {
		test('the rest flee and the fight is won when the threat left is at or under a quarter of the start', () => {
			const raiders = ['A', 'B', 'C', 'D'].map(name => createVehicle(name, { threat: 2 }));
			const battle = fight(raiders);
			play(battle, killShot(), raiders[0]);
			play(battle, killShot(), raiders[1]);
			expect(battle.battleOver).toBe(false);

			// 2 of 8 left
			play(battle, killShot(), raiders[2]);

			expect(battle.isBattleWon()).toBe(true);
			expect(battle.routed).toBe(true);
			expect(battle.getMessages().map(message => message.message)).toContain('The raiders rout, since too few are left to fight on: D flees');
		});

		test('counts raiders still queued, and they never arrive', () => {
			const first = ['A', 'B'].map(name => createVehicle(name, { threat: 2 }));
			const queued = ['C', 'D'].map(name => createVehicle(name, { threat: 2 }));
			const battle = fight(first, [{ raiders: queued }]);
			play(battle, killShot(), first[0]);
			expect(battle.battleOver).toBe(false);

			// 2 on the road gone, 4 of 8 queued: the road is clear, so the wave comes
			play(battle, killShot(), first[1]);
			expect(battle.battleOver).toBe(false);
			battle.endPlayerTurn();
			play(battle, killShot(), queued[0]);

			expect(battle.isBattleWon()).toBe(true);
			expect(battle.routed).toBe(true);
		});

		test('routs with the road clear and a wave still queued, which never pulls in', () => {
			const first = ['A', 'B', 'C'].map(name => createVehicle(name, { threat: 2 }));
			const queued = createVehicle('D', { threat: 2 });
			const battle = fight(first, [{ raiders: [queued] }]);
			first.forEach(raider => play(battle, killShot(), raider));

			expect(battle.isBattleWon()).toBe(true);
			expect(battle.routed).toBe(true);
			expect(battle.queuedRaiders).toEqual([]);
			expect(queued.slot).toBeNull();
			expect(battle.getMessages().map(message => message.message)).toContain('The raiders rout, since too few are left to fight on');
		});

		test('routs when the leader loses its driver, not only its vehicle', () => {
			const leader = createVehicle('Boss', { threat: 10, leader: true });
			const battle = fight([leader, createVehicle('A', { threat: 2 })]);

			play(battle, killShot(), leader);

			expect(leader.isAlive()).toBe(true);
			expect(battle.routed).toBe(true);
		});

		test('is threat, not damage: hurting every raider doesn\'t rout them', () => {
			const raiders = ['A', 'B', 'C', 'D'].map(name => createVehicle(name, { threat: 2 }));
			const battle = fight(raiders);
			for (const raider of raiders) play(battle, scratch(), raider);
			expect(battle.battleOver).toBe(false);
		});

		test('a leader out of the fight routs the rest at once', () => {
			const leader = createVehicle('Boss', { threat: 10, leader: true });
			const raiders = ['A', 'B', 'C'].map(name => createVehicle(name, { threat: 2 }));
			const battle = fight([leader, ...raiders]);

			play(battle, killShot(), leader);

			expect(battle.isBattleWon()).toBe(true);
			expect(battle.routed).toBe(true);
			expect(battle.getMessages().map(message => message.message)).toContain('The raiders rout, since their leader is out of the fight: A, B, C flee');
		});

		test('a fight with no threat numbers never routs; it ends when the road is clear', () => {
			const raiders = ['A', 'B', 'C', 'D'].map(name => createVehicle(name));
			const battle = fight(raiders);
			raiders.slice(0, 3).forEach(raider => play(battle, killShot(), raider));
			expect(battle.battleOver).toBe(false);
			play(battle, killShot(), raiders[3]);
			expect(battle.isBattleWon()).toBe(true);
			expect(battle.routed).toBe(false);
		});
	});

	describe('break-off', () => {
		test('three player turns running without a hit on a raider end the fight neither won nor lost', () => {
			const raider = createVehicle('Raider', { threat: 2 });
			const battle = fight([raider]);
			const ended: unknown[] = [];
			battle.on('battleEnded', (event: unknown) => ended.push(event));
			battle.endPlayerTurn();
			battle.endPlayerTurn();
			expect(battle.battleOver).toBe(false);

			battle.endPlayerTurn();

			expect(battle.isBattleBrokenOff()).toBe(true);
			expect(battle.isBattleWon()).toBe(false);
			expect(battle.enemyTurnInProgress).toBe(false);
			expect(ended).toEqual([{ won: false, brokenOff: true }]);
		});

		test('a hit on a raider starts the count again', () => {
			const raider = createVehicle('Raider', { threat: 2 });
			const battle = fight([raider]);
			battle.endPlayerTurn();
			battle.endPlayerTurn();
			play(battle, scratch(), raider);
			battle.endPlayerTurn();
			battle.endPlayerTurn();
			battle.endPlayerTurn();
			expect(battle.battleOver).toBe(false);

			battle.endPlayerTurn();
			expect(battle.isBattleBrokenOff()).toBe(true);
		});

		test('a hit a shield takes all of doesn\'t count, so the fight still breaks off (call 197)', () => {
			const raider = createVehicle('Raider', { threat: 2 });
			const battle = fight([raider]);
			battle.endPlayerTurn();
			battle.endPlayerTurn();
			raider.set({ shield: 10 });
			play(battle, scratch(), raider);
			expect(raider.structure).toBe(50);

			battle.endPlayerTurn();
			expect(battle.isBattleBrokenOff()).toBe(true);
		});

		test('a fight built without a break-off never breaks off', () => {
			const battle = fight([createVehicle('Raider')], [], null);
			for (let turn = 0; turn < 6; turn += 1) battle.endPlayerTurn();
			expect(battle.battleOver).toBe(false);
		});
	});
});
