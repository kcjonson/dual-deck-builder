import { MCTSAI } from '../MCTSAI';
import { Battle } from '../../mechanics/Battle';
import { Team, TeamType } from '../../mechanics/Team';
import { Driver } from '../../mechanics/Driver';
import { Card } from '../../mechanics/Card';
import { createTestDriver, createTestVehicle, createTestCard } from './test-helpers';

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
});