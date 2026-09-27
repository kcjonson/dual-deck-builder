import { MCTSAI } from '../MCTSAI';
import { AIDecision } from '../types';
import { Battle } from '../../mechanics/Battle';
import { BoardProjection } from '../../mechanics/BoardProjection';
import { Team, TeamType } from '../../mechanics/Team';
import { Driver } from '../../mechanics/Driver';
import { Vehicle } from '../../mechanics/Vehicle';
import { Card, CardData } from '../../mechanics/Card';
import { createTestDriver, createTestVehicle, createTestCard } from './test-helpers';
import cardsFile from '../../data/cards.json';

const cardData = (type: string): CardData => {
	const data = (cardsFile as unknown as { cards: CardData[] }).cards.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return { ...data, upgraded: false };
};

const realCard = (type: string): Card => new Card(cardData(type));

// A real card with its effects swapped for a status MCTS gives the flat unknown-effect score
const withFlatStatus = (type: string): Card => new Card({
	...cardData(type),
	type: `flat_${type}`,
	name: `Flat ${type}`,
	effects: [{ type: 'apply_status', status: 'vulnerable', target: 'target' }]
});

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

/**
 * Reads MCTS's score for one play against the live board
 */
class ScoringMCTSAI extends MCTSAI {
	public score(action: AIDecision): number {
		this.board = new BoardProjection({ battle: this.battle });
		return this.evaluateActionWithContext(action);
	}
}

describe('MCTSAI', () => {
	let battle: Battle;
	let mctsAI: MCTSAI;
	let playerTeam: Team;
	let enemyTeam: Team;
	let playerDriver1: Driver;
	let enemyDriver1: Driver;
	
	beforeEach(() => {
		// Create test drivers
		playerDriver1 = createTestDriver('Player Driver 1');
		const playerDriver2 = createTestDriver('Player Driver 2');
		enemyDriver1 = createTestDriver('Enemy Driver 1');
		const enemyDriver2 = createTestDriver('Enemy Driver 2');
		
		// Create test vehicles
		const playerVehicle1 = createTestVehicle('Player Vehicle 1', playerDriver1);
		const playerVehicle2 = createTestVehicle('Player Vehicle 2', playerDriver2);
		const enemyVehicle1 = createTestVehicle('Enemy Vehicle 1', enemyDriver1);
		const enemyVehicle2 = createTestVehicle('Enemy Vehicle 2', enemyDriver2);
		
		// Create test cards
		const attackCard = createTestCard({
			type: 'action',
			name: 'Basic Attack',
			cost: 2,
			targetType: 'enemy_single',
			effects: [{ type: 'damage', value: 10 }]
		});
		
		const healCard = createTestCard({
			type: 'action',
			name: 'Repair',
			cost: 3,
			targetType: 'self',
			effects: [{ type: 'heal', value: 8 }]
		});
		
		// Add cards to enemy driver's hand
		enemyDriver1.hand = [attackCard, healCard];
		
		// Create teams
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
		
		// Create AI with reduced iterations for testing
		mctsAI = new MCTSAI({
			team: enemyTeam,
			battle,
			iterations: 100  // Reduced for faster tests
		});
	});
	
	test('should make a decision', async () => {
		const decision = await mctsAI.makeDecision();
		expect(decision).toBeTruthy();
		expect(decision?.type).toMatch(/playCard|endTurn/);
	});
	
	test('should prefer attacking when enemy is low health', async () => {
		// Set player vehicle to low health
		const playerVehicle = playerTeam.vehicles[0];
		playerVehicle.structure = 5;
		
		// Run MCTS with more iterations for this test
		const strategicAI = new MCTSAI({
			team: enemyTeam,
			battle,
			iterations: 500
		});
		
		const decision = await strategicAI.makeDecision();
		
		// AI should choose to attack
		expect(decision?.type).toBe('playCard');
		if (decision?.type === 'playCard') {
			expect(decision.card?.name).toBe('Basic Attack');
		}
	});
	
	test('a card\'s self cost isn\'t scored as damage on its target', async () => {
		// 2 structure behind 5 armor: the self cost's 2 would read as a kill against it
		const target = playerTeam.vehicles[0];
		target.set({ structure: 2 });
		playerTeam.vehicles[1].set({ structure: 10, armor: 50, maxArmor: 50 });
		const recklessShot = new Card({
			type: 'reckless_shot',
			name: 'Reckless Shot',
			summary: 'Reckless Shot',
			description: 'Reckless Shot',
			rarity: 'common',
			cost: 1,
			targetType: 'enemy_single',
			effects: [
				{ type: 'damage', value: 1, target: 'target', always_hits: true },
				{ type: 'damage', value: 2, target: 'self', structure_only: true }
			],
			tags: ['attack']
		});
		const potShot = createTestCard({
			type: 'action',
			name: 'Pot Shot',
			cost: 1,
			targetType: 'enemy_single',
			effects: [{ type: 'damage', value: 3 }]
		});
		enemyDriver1.hand = [recklessShot, potShot];
		enemyDriver1.adrenaline = 5;

		const decision = await mctsAI.makeDecision();

		expect(decision?.card).toBe(potShot);
		expect(decision?.target).toBe(target);
	});

	test('should handle empty hand gracefully', async () => {
		// Clear enemy driver's hand
		enemyDriver1.hand = [];
		
		const decision = await mctsAI.makeDecision();
		
		// Should only be able to end turn
		expect(decision).toBeTruthy();
		expect(decision?.type).toBe('endTurn');
	});
	
	test('should handle insufficient adrenaline', async () => {
		// Set low adrenaline
		enemyDriver1.adrenaline = 1;
		
		const decision = await mctsAI.makeDecision();
		
		// Should end turn since can't afford any cards
		expect(decision).toBeTruthy();
		expect(decision?.type).toBe('endTurn');
	});
	
	test('MCTS should explore different actions', async () => {
		// Give the AI multiple viable options
		const cheapAttack = createTestCard({
			type: 'action',
			name: 'Cheap Attack',
			cost: 1,
			targetType: 'enemy_single',
			effects: [{ type: 'damage', value: 5 }]
		});
		
		enemyDriver1.hand.push(cheapAttack);
		enemyDriver1.adrenaline = 6; // Enough for multiple cards
		
		// Run MCTS multiple times to see if it explores different options
		const decisions = [];
		for (let i = 0; i < 5; i++) {
			const ai = new MCTSAI({
				team: enemyTeam,
				battle,
				iterations: 50
			});
			const decision = await ai.makeDecision();
			if (decision?.type === 'playCard') {
				decisions.push(decision.card?.name);
			}
		}
		
		// Should have made some card decisions
		expect(decisions.length).toBeGreaterThan(0);
	});
	
	test('should handle terminal states', async () => {
		// Set battle to over
		battle.battleOver = true;
		battle.battleWon = false;
		
		const decision = await mctsAI.makeDecision();
		
		// Should return null or handle gracefully
		expect(decision).toBeNull();
	});

	describe('scores Flank and Nitro Boost by whether they open a flank', () => {
		// A speed 5 raider, base 3 plus the test driver's 2, against player vehicles of the given speeds
		const setup = (playerSpeeds: number[]): { battle: Battle; raider: Vehicle; players: Vehicle[]; ai: ScoringMCTSAI } => {
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
			return { battle, raider, players, ai: new ScoringMCTSAI({ team: battle.enemyTeam, battle, iterations: 100 }) };
		};

		const play = (raider: Vehicle, card: Card, target?: Vehicle): AIDecision =>
			({ type: 'playCard', card, driver: driverOf(raider), target });

		test('a Flank it can make scores above the flat default', () => {
			const { battle, raider, players, ai } = setup([2, 4]);
			const flank = realCard('flank');
			const control = withFlatStatus('flank');
			driverOf(raider).set({ hand: [flank, control] });

			expect(new BoardProjection({ battle }).canFlankAnyone(raider)).toBe(true);
			expect(ai.score(play(raider, flank, players[0]))).toBeGreaterThan(ai.score(play(raider, control, players[0])));
		});

		test('a Flank it can\'t make scores no more than the flat default', () => {
			const { battle, raider, players, ai } = setup([6, 8]);
			const flank = realCard('flank');
			const control = withFlatStatus('flank');
			driverOf(raider).set({ hand: [flank, control] });

			expect(new BoardProjection({ battle }).canFlankAnyone(raider)).toBe(false);
			expect(ai.score(play(raider, flank, players[0]))).toBeLessThanOrEqual(ai.score(play(raider, control, players[0])));
		});

		test('Nitro Boost scores higher when its boost opens a flank', () => {
			// 5 + 3 = 8 outruns a 6; it can't outrun two 8s, and already outruns a 2 and a 4
			const opens = setup([6, 8]);
			const noFlank = setup([8, 8]);
			const alreadyFast = setup([2, 4]);
			const nitroScore = ({ raider, ai }: { raider: Vehicle; ai: ScoringMCTSAI }): number => {
				const nitro = realCard('nitro_boost');
				driverOf(raider).set({ hand: [nitro] });
				return ai.score(play(raider, nitro));
			};

			expect(new BoardProjection({ battle: opens.battle }).canFlankAnyone(opens.raider, 3)).toBe(true);
			expect(new BoardProjection({ battle: noFlank.battle }).canFlankAnyone(noFlank.raider, 3)).toBe(false);
			expect(nitroScore(opens)).toBeGreaterThan(nitroScore(noFlank));
			expect(nitroScore(opens)).toBeGreaterThan(nitroScore(alreadyFast));
		});

		test('a slow on the target is worth a little more than the flat default', () => {
			const { raider, players, ai } = setup([2, 4]);
			const oilSlick = realCard('oil_slick');
			const control = withFlatStatus('oil_slick');
			driverOf(raider).set({ hand: [oilSlick, control] });

			// Oil Slick's vulnerable status scores flat, like the control's, so the gap is the -4 slow
			const slowValue = ai.score(play(raider, oilSlick, players[0])) - ai.score(play(raider, control, players[0]));
			expect(slowValue).toBeCloseTo(1.4);
		});
	});
});
