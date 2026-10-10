import { AggressiveFlankerAI, AggressiveFlankerStrategy } from './AggressiveFlankerAI';
import { AIDecision } from './types';
import { Battle } from '../mechanics/Battle';
import { BoardProjection } from '../mechanics/BoardProjection';
import { Team, TeamType } from '../mechanics/Team';
import { RoadLane, RoadRow } from '../mechanics/Road';
import { Card, CardData } from '../mechanics/Card';
import { Driver } from '../mechanics/Driver';
import { Vehicle } from '../mechanics/Vehicle';
import { createTestDriver, createTestVehicle } from './__tests__/test-helpers';
import cardsFile from '../data/cards.json';

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

const realCard = (type: string): Card => {
	const data = cardData.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data, upgraded: false });
};

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

/**
 * Reads the strategy's score for one play against the live board
 */
class ScoringAggressiveAI extends AggressiveFlankerAI {
	private readonly scorer = new AggressiveFlankerStrategy();

	public score(action: AIDecision): number {
		this.board = new BoardProjection({ battle: this.battle });
		return this.scorer.scoreAction(action, this.evaluateGameState());
	}
}

const powerShot = (): Card => new Card({
	type: 'power_shot',
	name: 'Power Shot',
	summary: 'Deal 8 damage',
	description: 'Deal 8 damage',
	rarity: 'common',
	cost: 2,
	targetType: 'enemy_single',
	effects: [{ type: 'damage', value: 8 }],
	tags: ['attack']
});

describe('AggressiveFlankerAI', () => {
	let battle: Battle;
	let playerTeam: Team;
	let enemyTeam: Team;
	let ai: AggressiveFlankerAI;

	beforeEach(() => {
		// Create drivers first
		const playerDriver1 = createTestDriver('Player Driver 1');
		const playerDriver2 = createTestDriver('Player Driver 2');
		const enemyDriver1 = createTestDriver('Enemy Driver 1');
		const enemyDriver2 = createTestDriver('Enemy Driver 2');

		// Create vehicles with drivers
		const playerVehicle1 = createTestVehicle('Player Vehicle 1', playerDriver1);
		const playerVehicle2 = createTestVehicle('Player Vehicle 2', playerDriver2);
		const enemyVehicle1 = createTestVehicle('Enemy Vehicle 1', enemyDriver1);
		const enemyVehicle2 = createTestVehicle('Enemy Vehicle 2', enemyDriver2);

		// Battle places both teams in their opening formation

		// Speed is base speed plus the test driver's 2, against 3 + 2 = 5 for
		// both player vehicles. Vehicle 1 can outrun them; vehicle 2 ties
		// them, which can't flank, until a +2 boost.
		enemyVehicle1.baseSpeed = 5; // 5 + 2 = 7
		enemyVehicle2.baseSpeed = 3; // 3 + 2 = 5

		// Create teams with vehicles
		playerTeam = new Team({ 
			type: TeamType.PLAYER, 
			vehicles: [playerVehicle1, playerVehicle2] 
		});
		enemyTeam = new Team({ 
			type: TeamType.ENEMY, 
			vehicles: [enemyVehicle1, enemyVehicle2] 
		});


		// Create battle
		battle = new Battle({ playerTeam, enemyTeam });
		
		// Create AI
		ai = new AggressiveFlankerAI(enemyTeam, battle);
	});

	test('scores a play for the player\'s side from the caster\'s own vehicle, so the best play wins, not the first offered', async () => {
		battle.start();
		const playerAI = new AggressiveFlankerAI(playerTeam, battle);
		const [driver, partner] = playerTeam.vehicles.map(driverOf);
		partner.hand = [];
		// Armor Plating comes first and does nothing at full armor; Power Shot hits
		driver.hand = [realCard('armor_plating'), powerShot()];
		driver.adrenaline = 5;

		const score = new ScoringAggressiveAI(playerTeam, battle).score({ type: 'playCard', card: driver.hand[1], driver, target: enemyTeam.vehicles[1] });
		const decision = await playerAI.makeDecision();

		expect(score).toBeGreaterThan(0);
		expect(decision?.card?.name).toBe('Power Shot');
	});

	test('should prioritize moving to flanking position', async () => {
		// Start battle to setup hands
		battle.start();

		// Setup hand for the first driver
		const driver = enemyTeam.vehicles[0].driver;
		if (!driver) throw new Error('Driver not found');
		driver.hand = [realCard('flanking_maneuver'), powerShot()];
		driver.adrenaline = 5;

		// Make AI decision
		const decision = await ai.makeDecision();

		expect(decision).not.toBeNull();
		expect(decision?.type).toBe('playCard');
		expect(decision?.card?.name).toBe('Flanking Maneuver');
	});

	test('should prioritize speed boost when below flanking threshold', async () => {
		// Start battle
		battle.start();

		// Setup low speed vehicle with speed boost card
		const driver = enemyTeam.vehicles[1].driver; // Low speed vehicle
		if (!driver) throw new Error('Driver not found');
		driver.hand = [realCard('nitro_boost'), powerShot()];
		driver.adrenaline = 5;

		// Make AI decision
		const decision = await ai.makeDecision();

		expect(decision).not.toBeNull();
		expect(decision?.type).toBe('playCard');
		expect(decision?.card?.name).toBe('Nitro Boost');
	});

	test('shoots instead of boosting once it is already fast enough to flank', async () => {
		battle.start();

		// Vehicle 1 is at 7, so it can already outrun the player's 5s
		const driver = enemyTeam.vehicles[0].driver;
		if (!driver) throw new Error('Driver not found');
		driver.hand = [realCard('nitro_boost'), powerShot()];
		driver.adrenaline = 5;

		const decision = await ai.makeDecision();

		expect(decision?.type).toBe('playCard');
		expect(decision?.card?.name).toBe('Power Shot');
	});

	test('should prefer high damage cards when in flanking position', async () => {
		// Start battle
		battle.start();

		// Put vehicle in flanking position
		enemyTeam.vehicles[0].slot = { lane: RoadLane.PLAYER_SHOULDER, row: RoadRow.CENTER };
		
		const driver = enemyTeam.vehicles[0].driver;
		if (!driver) throw new Error('Driver not found');
		driver.hand = [
			new Card({
				type: 'power_shot',
				name: 'Power Shot',
				summary: 'Deal 8 damage',
				description: 'Deal 8 damage',
				rarity: 'common',
				cost: 2,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 8 }],
				tags: ['attack']
			}),
			new Card({
				type: 'potshot',
				name: 'Potshot',
				summary: 'Deal 3 damage',
				description: 'Deal 3 damage',
				rarity: 'starter',
				cost: 1,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 3 }],
				tags: ['attack']
			})
		];
		driver.adrenaline = 5;

		// Make AI decision
		const decision = await ai.makeDecision();

		expect(decision).not.toBeNull();
		expect(decision?.type).toBe('playCard');
		expect(decision?.card?.name).toBe('Power Shot'); // Should pick higher damage
	});

	test('should target low health enemies', async () => {
		// Start battle
		battle.start();

		// Damage one player vehicle significantly, with drivers tough enough to live through it
		playerTeam.vehicles.forEach(vehicle => vehicle.driver?.set({ hitpoints: 20, maxHitpoints: 20 }));
		playerTeam.vehicles[0].takeDamage(15); // Low health
		playerTeam.vehicles[1].takeDamage(5);  // Higher health

		// Put enemy in flanking position with damage card
		enemyTeam.vehicles[0].slot = { lane: RoadLane.PLAYER_SHOULDER, row: RoadRow.CENTER };
		const driver = enemyTeam.vehicles[0].driver;
		if (!driver) throw new Error('Driver not found');
		driver.hand = [
			new Card({
				type: 'power_shot',
				name: 'Power Shot',
				summary: 'Deal 8 damage',
				description: 'Deal 8 damage',
				rarity: 'common',
				cost: 2,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 8 }],
				tags: ['attack']
			})
		];
		driver.adrenaline = 5;

		// Make AI decision
		const decision = await ai.makeDecision();

		expect(decision).not.toBeNull();
		expect(decision?.type).toBe('playCard');
		expect(decision?.target).toBe(playerTeam.vehicles[0]); // Should target low health
	});

	test('should consider healing when very low on health', async () => {
		// Start battle
		battle.start();

		// Ensure vehicle is NOT in flanking position (so damage isn't boosted)
		expect(enemyTeam.vehicles[0].isFlanking).toBe(false);
		
		// Damage enemy vehicle to exactly 20% health
		enemyTeam.vehicles[0].structure = 2; // Direct assignment to ensure exact value
		
		const driver = enemyTeam.vehicles[0].driver;
		if (!driver) throw new Error('Driver not found');
		driver.hand = [
			new Card({
				type: 'repair',
				name: 'Repair',
				summary: 'Heal 5 structure',
				description: 'Heal 5 structure',
				rarity: 'common',
				cost: 2,
				targetType: 'self',
				effects: [{ type: 'heal', value: 5 }],
				tags: ['heal']
			}),
			new Card({
				type: 'power_shot',
				name: 'Power Shot',
				summary: 'Deal 8 damage',
				description: 'Deal 8 damage',
				rarity: 'common',
				cost: 2,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 8 }],
				tags: ['attack']
			})
		];
		driver.adrenaline = 5;

		// Make AI decision
		const decision = await ai.makeDecision();

		expect(decision).not.toBeNull();
		expect(decision?.type).toBe('playCard');
		expect(decision?.card?.name).toBe('Repair'); // Should heal when very low
	});

	test('a Headshot\'s kill math reads the driver and skips Shield', async () => {
		battle.start();
		const [healthyCrew, shieldedCrew] = playerTeam.vehicles;
		driverOf(healthyCrew).set({ hitpoints: 20, maxHitpoints: 20 });
		// A 2 HP driver behind 30 Shield: a vehicle hit would soak, a Headshot won't
		driverOf(shieldedCrew).set({ hitpoints: 2, maxHitpoints: 20 });
		shieldedCrew.addShield(30);
		const headshot = realCard('headshot');
		driverOf(enemyTeam.vehicles[0]).set({ hand: [headshot], adrenaline: 5 });

		const decision = await ai.makeDecision();

		expect(decision?.card).toBe(headshot);
		expect(decision?.target).toBe(shieldedCrew);
	});

	describe('fast enough to flank is relative to who is on the road', () => {
		// The combat screen's Rust Buggy: base 3 plus the test driver's 2 = 5
		const setup = (playerSpeeds: number[]): { battle: Battle; raider: Vehicle; players: Vehicle[]; ai: ScoringAggressiveAI } => {
			const raider = createTestVehicle('Rust Buggy', createTestDriver('Raider'));
			const players = playerSpeeds.map((speed, index) => {
				const vehicle = createTestVehicle(`Player Vehicle ${index + 1}`, createTestDriver(`Player Driver ${index + 1}`));
				vehicle.baseSpeed = speed - 2;
				return vehicle;
			});
			const battle = new Battle({
				playerTeam: new Team({ type: TeamType.PLAYER, vehicles: players }),
				enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [raider] })
			});
			battle.start();
			driverOf(raider).set({ adrenaline: 5 });
			return { battle, raider, players, ai: new ScoringAggressiveAI(battle.enemyTeam, battle) };
		};

		const play = (raider: Vehicle, card: Card, target?: Vehicle): AIDecision =>
			({ type: 'playCard', card, driver: driverOf(raider), target });

		describe('a speed 5 raider against a Rig (2) and a Workshop (4)', () => {
			test('can already flank, so Nitro Boost earns no speed bonus and it shoots instead', async () => {
				const { battle, raider, ai } = setup([2, 4]);
				const nitro = realCard('nitro_boost');
				const shot = powerShot();
				driverOf(raider).set({ hand: [nitro, shot] });

				expect(new BoardProjection({ battle }).canFlankAnyone(raider)).toBe(true);
				expect(ai.score(play(raider, nitro))).toBe(0);
				expect((await ai.makeDecision())?.card).toBe(shot);
			});

			test('every legal Flank gets the full flank priority', () => {
				const { raider, players, ai } = setup([2, 4]);
				const flank = realCard('flank');
				driverOf(raider).set({ hand: [flank] });

				// POSITION_WEIGHT (200) three times
				expect(ai.score(play(raider, flank, players[0]))).toBe(600);
			});
		});

		test('against faster vehicles it can\'t flank, so Nitro Boost that opens a flank comes first', async () => {
			const { battle, raider, ai } = setup([6, 8]);
			const nitro = realCard('nitro_boost');
			driverOf(raider).set({ hand: [powerShot(), nitro] });

			const board = new BoardProjection({ battle });
			expect(board.canFlankAnyone(raider)).toBe(false);
			// 5 + 3 = 8 outruns the 6 but not the 8
			expect(board.canFlankAnyone(raider, 3)).toBe(true);
			expect(ai.score(play(raider, nitro))).toBe(400);
			expect((await ai.makeDecision())?.card).toBe(nitro);
		});

		test('an unmanned raider isn\'t someone to flank', () => {
			// The player's 8 outruns the Buggy's 5 until nobody is left aboard it
			const { battle, raider, players } = setup([8, 8]);
			expect(new BoardProjection({ battle }).canFlankAnyone(players[0])).toBe(true);

			driverOf(raider).set({ hitpoints: 0 });

			expect(raider.isUnmanned()).toBe(true);
			expect(new BoardProjection({ battle }).canFlankAnyone(players[0])).toBe(false);
		});

		test('a boost that opens no flank earns no speed bonus', () => {
			const { raider, ai } = setup([8, 8]);
			const nitro = realCard('nitro_boost');
			driverOf(raider).set({ hand: [nitro] });

			expect(ai.score(play(raider, nitro))).toBe(0);
		});
	});

	test('should end turn when no good options available', async () => {
		// Start battle
		battle.start();

		// Clear hands
		for (const vehicle of enemyTeam.vehicles) {
			if (vehicle.driver) {
				vehicle.driver.hand = [];
				vehicle.driver.adrenaline = 0; // No adrenaline
			}
		}

		// Make AI decision
		const decision = await ai.makeDecision();

		expect(decision).not.toBeNull();
		expect(decision?.type).toBe('endTurn'); // Should end turn when no actions available
	});
});