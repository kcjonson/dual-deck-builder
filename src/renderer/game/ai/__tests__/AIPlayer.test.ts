import { Battle } from '../../mechanics/Battle';
import { Team, TeamType } from '../../mechanics/Team';
import { Driver } from '../../mechanics/Driver';
import { RandomAI } from '../RandomAI';
import { createTestDriver, createTestVehicle, createTestCard } from './test-helpers';

describe('AI Player System', () => {
	let playerTeam: Team;
	let enemyTeam: Team;
	let battle: Battle;
	let playerDriver1: Driver;
	let playerDriver2: Driver;
	let enemyDriver1: Driver;
	let enemyDriver2: Driver;

	beforeEach(() => {
		// Create drivers
		playerDriver1 = createTestDriver('Player Driver 1');
		playerDriver2 = createTestDriver('Player Driver 2');
		enemyDriver1 = createTestDriver('Enemy Driver 1');
		enemyDriver2 = createTestDriver('Enemy Driver 2');

		// Create vehicles
		const playerVehicle1 = createTestVehicle('Player Vehicle 1', playerDriver1);
		const playerVehicle2 = createTestVehicle('Player Vehicle 2', playerDriver2);
		const enemyVehicle1 = createTestVehicle('Enemy Vehicle 1', enemyDriver1);
		const enemyVehicle2 = createTestVehicle('Enemy Vehicle 2', enemyDriver2);

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
	});

	describe('RandomAI', () => {
		it('should create a RandomAI instance', () => {
			const ai = new RandomAI(enemyTeam, battle);
			expect(ai).toBeDefined();
		});

		it('should make decisions when cards are available', async () => {
			const ai = new RandomAI(enemyTeam, battle);
			
			// Add some cards to enemy driver's hand
			const card1 = createTestCard({
				type: 'test_attack',
				name: 'Test Attack',
				cost: 2,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 3 }]
			});
			const card2 = createTestCard({
				type: 'test_defense',
				name: 'Test Defense',
				cost: 1,
				targetType: 'self',
				effects: [{ type: 'armor', value: 2 }]
			});
			
			enemyDriver1.hand = [card1, card2];
			enemyDriver1.adrenaline = 3;

			const decision = await ai.makeDecision();
			
			expect(decision).toBeDefined();
			// RandomAI can decide to play a card or end turn
			expect(['playCard', 'endTurn']).toContain(decision?.type);
			
			if (decision?.type === 'playCard') {
				expect(decision.card).toBeDefined();
				expect(decision.driver).toBe(enemyDriver1);
			}
		});

		it('should return endTurn decision when no cards can be played', async () => {
			const ai = new RandomAI(enemyTeam, battle);
			
			// Add expensive card that can't be played
			const expensiveCard = createTestCard({
				type: 'expensive_card',
				name: 'Expensive Card',
				cost: 10,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 10 }]
			});
			
			enemyDriver1.hand = [expensiveCard];
			enemyDriver1.adrenaline = 2; // Not enough

			const decision = await ai.makeDecision();
			
			expect(decision).toBeDefined();
			expect(decision?.type).toBe('endTurn');
		});

		it('should handle multiple valid targets correctly', async () => {
			const ai = new RandomAI(enemyTeam, battle);
			
			const attackCard = createTestCard({
				type: 'multi_target_attack',
				name: 'Multi Target Attack',
				cost: 2,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 3 }]
			});
			
			enemyDriver1.hand = [attackCard];
			enemyDriver1.adrenaline = 3;

			const decisions: (Vehicle | Driver)[] = [];
			// Run multiple times to check randomness
			for (let i = 0; i < 10; i++) {
				const decision = await ai.makeDecision();
				if (decision?.target) {
					decisions.push(decision.target);
				}
			}

			// Should have some decisions
			expect(decisions.length).toBeGreaterThan(0);
			// Targets should be player vehicles
			decisions.forEach(target => {
				expect(playerTeam.vehicles).toContain(target);
			});
		});
	});

	describe('AIController', () => {
		it('should create AI players for enemy team', () => {
			const controller = battle.aiController;
			
			controller.setEnemyAI('random');
			expect(controller.isEnemyControlledByAI()).toBe(true);
			expect(controller.isPlayerControlledByAI()).toBe(false);
		});

		it('should create AI players for player team', () => {
			const controller = battle.aiController;
			
			controller.setPlayerAI('random');
			expect(controller.isPlayerControlledByAI()).toBe(true);
			expect(controller.isEnemyControlledByAI()).toBe(false);
		});

		it('should remove AI control when set to null', () => {
			const controller = battle.aiController;
			
			controller.setEnemyAI('random');
			expect(controller.isEnemyControlledByAI()).toBe(true);
			
			controller.setEnemyAI(null);
			expect(controller.isEnemyControlledByAI()).toBe(false);
		});

		it('should execute AI decisions correctly', async () => {
			const controller = battle.aiController;
			
			// Setup card for enemy
			const attackCard = createTestCard({
				type: 'ai_attack',
				name: 'AI Attack',
				cost: 2,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 3 }]
			});
			
			enemyDriver1.hand = [attackCard];
			enemyDriver1.adrenaline = 3;
			
			// Track if card was played
			const initialHandSize = enemyDriver1.hand.length;
			const initialAdrenaline = enemyDriver1.adrenaline;
			
			const decision = {
				type: 'playCard' as const,
				card: attackCard,
				driver: enemyDriver1,
				target: playerTeam.vehicles[0]
			};

			await controller.executeAIDecision(decision, false);
			
			// Should have played the card
			expect(enemyDriver1.hand.length).toBeLessThan(initialHandSize);
			expect(enemyDriver1.adrenaline).toBeLessThan(initialAdrenaline);
		});

		it('should handle endTurn decisions', async () => {
			const controller = battle.aiController;
			
			// Make sure it's player turn
			battle.isPlayerTurn = true;
			const initialTurn = battle.turn;
			
			const decision = { type: 'endTurn' as const };
			await controller.executeAIDecision(decision, true);
			
			// Should have progressed the game (enemy turn processed, new player turn started)
			expect(battle.turn).toBeGreaterThan(initialTurn);
		});
	});

	describe('Battle Integration', () => {
		it('should use AI for enemy turns when configured', async () => {
			// Setup AI control
			battle.aiController.setEnemyAI('random');
			
			// Add cards to enemy
			const card = createTestCard({
				type: 'enemy_ai_card',
				name: 'Enemy AI Card',
				cost: 1,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 2 }]
			});
			
			enemyDriver1.hand = [card];
			enemyDriver1.adrenaline = 5;
			enemyDriver2.hand = [card];
			enemyDriver2.adrenaline = 5;
			
			// Mock the AI decision execution
			const executeAISpy = jest.spyOn(battle.aiController, 'executeAIDecision').mockImplementation(async () => {
			// Mock implementation
		});
			
			// End player turn to trigger enemy AI
			await battle.endPlayerTurn();
			
			// Should have called AI execution
			expect(executeAISpy).toHaveBeenCalled();
			
			executeAISpy.mockRestore();
		});

		it('should fall back to simple AI when no AI controller configured', async () => {
			// Don't set any AI
			
			// Add card to enemy
			const card = createTestCard({
				type: 'simple_ai_card',
				name: 'Simple AI Card',
				cost: 1,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 2 }]
			});
			
			enemyDriver1.hand = [card];
			enemyDriver1.adrenaline = 5;
			
			// Track that enemy action was executed
			const initialTurn = battle.turn;
			
			// End player turn to trigger simple AI
			await battle.endPlayerTurn();
			
			// Should have processed enemy turn and started new player turn
			expect(battle.turn).toBeGreaterThan(initialTurn);
			expect(battle.isPlayerTurn).toBe(true);
		});
	});

	describe('AI vs AI Battles', () => {
		it('should support AI controlling both teams', async () => {
			// Configure both teams with AI
			battle.aiController.setPlayerAI('random');
			battle.aiController.setEnemyAI('random');
			
			expect(battle.aiController.isPlayerControlledByAI()).toBe(true);
			expect(battle.aiController.isEnemyControlledByAI()).toBe(true);
			
			// Add cards to all drivers
			const attackCard = createTestCard({
				type: 'attack',
				name: 'Attack',
				cost: 1,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 2 }]
			});
			
			playerDriver1.hand = [attackCard];
			playerDriver1.adrenaline = 5;
			playerDriver2.hand = [attackCard];
			playerDriver2.adrenaline = 5;
			enemyDriver1.hand = [attackCard];
			enemyDriver1.adrenaline = 5;
			enemyDriver2.hand = [attackCard];
			enemyDriver2.adrenaline = 5;
			
			// Get AI decisions
			const playerDecision = await battle.aiController.getPlayerDecision();
			const enemyDecision = await battle.aiController.getEnemyDecision();
			
			expect(playerDecision).toBeDefined();
			expect(enemyDecision).toBeDefined();
		});

		it('should run a full AI vs AI battle with max turns', async () => {
			// Create a battle with max turns to prevent infinite loops
			const aiVsAiBattle = new Battle({ 
				playerTeam, 
				enemyTeam,
				maxTurns: 20
			});
			
			// Configure both teams with AI
			aiVsAiBattle.aiController.setPlayerAI('random');
			aiVsAiBattle.aiController.setEnemyAI('random');
			
			// Give both teams combat-ready decks with enough cards
			const createCombatDeck = () => {
				const cards = [];
				// Add attack cards (15 total)
				for (let i = 0; i < 15; i++) {
					cards.push(createTestCard({
						type: 'basic_attack',
						name: 'Basic Attack',
						cost: 2,
						targetType: 'enemy_single',
						effects: [{ type: 'damage', value: 3 }]
					}));
				}
				// Add heal cards (10 total)
				for (let i = 0; i < 10; i++) {
					cards.push(createTestCard({
						type: 'heal',
						name: 'Heal',
						cost: 2,
						targetType: 'self',
						effects: [{ type: 'heal', value: 4 }]
					}));
				}
				// Add armor cards (5 total)
				for (let i = 0; i < 5; i++) {
					cards.push(createTestCard({
						type: 'armor',
						name: 'Armor Up',
						cost: 1,
						targetType: 'self',
						effects: [{ type: 'armor', value: 2 }]
					}));
				}
				// Total: 30 cards per deck
				return cards;
			};
			
			// Add cards to all drivers' decks
			const playerDeck1 = createCombatDeck();
			const playerDeck2 = createCombatDeck();
			const enemyDeck1 = createCombatDeck();
			const enemyDeck2 = createCombatDeck();
			
			// Set up decks
			if (playerDriver1.deck) playerDriver1.deck.cards = playerDeck1;
			if (playerDriver2.deck) playerDriver2.deck.cards = playerDeck2;
			if (enemyDriver1.deck) enemyDriver1.deck.cards = enemyDeck1;
			if (enemyDriver2.deck) enemyDriver2.deck.cards = enemyDeck2;
			
			// Start the battle
			aiVsAiBattle.start();
			
			// Run the battle until it ends
			let turnCount = 0;
			const maxIterations = 100; // Safety limit
			
			while (!aiVsAiBattle.isBattleOver() && turnCount < maxIterations) {
				turnCount++;
				
				if (aiVsAiBattle.isPlayerTurn) {
					// Player AI turn - keep playing cards until AI can't or won't
					let continuePlayingCards = true;
					while (continuePlayingCards && !aiVsAiBattle.isBattleOver()) {
						const decision = await aiVsAiBattle.aiController.getPlayerDecision();
						if (!decision || decision.type === 'endTurn') {
							// No valid action or AI decided to end turn
							await aiVsAiBattle.endPlayerTurn();
							continuePlayingCards = false;
						} else {
							await aiVsAiBattle.aiController.executeAIDecision(decision, true);
						}
					}
				}
				
				// Check if battle ended
				if (aiVsAiBattle.isBattleOver()) break;
			}
			
			// Battle should have ended
			expect(aiVsAiBattle.isBattleOver()).toBe(true);
			
			// Check the outcome
			if (aiVsAiBattle.isBattleTied()) {
				expect(aiVsAiBattle.turn).toBeGreaterThan(20);
				console.log(`AI Battle ended in a tie after ${aiVsAiBattle.turn - 1} turns`);
			} else if (aiVsAiBattle.isBattleWon()) {
				console.log(`AI Battle won by player team in ${aiVsAiBattle.turn} turns`);
				expect(aiVsAiBattle.enemyTeam.isDefeated()).toBe(true);
			} else {
				console.log(`AI Battle won by enemy team in ${aiVsAiBattle.turn} turns`);
				expect(aiVsAiBattle.playerTeam.isDefeated()).toBe(true);
			}
			
			// Ensure we didn't hit the safety limit
			expect(turnCount).toBeLessThan(maxIterations);
		});
	});
});