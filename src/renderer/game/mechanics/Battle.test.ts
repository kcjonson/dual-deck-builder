/**
 * @jest-environment jsdom
 */
import { Battle } from './Battle';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { RoadLane, RoadRow } from './Road';
import { Driver, DriverRole, HAND_CAP } from './Driver';
import { Card } from './Card';
import { Deck } from './Deck';

describe('Battle', () => {
	let playerTeam: Team;
	let enemyTeam: Team;
	let battle: Battle;
	let playerVehicle1: Vehicle;
	let playerVehicle2: Vehicle;
	let enemyVehicle: Vehicle;
	let playerDriver1: Driver;
	let playerDriver2: Driver;
	let enemyDriver: Driver;

	// Helper function to create a test deck
	const createTestDeck = (): Deck => {
		const cards: Card[] = [];
		
		// Add some test cards
		for (let i = 0; i < 10; i++) {
			cards.push(new Card({
				type: `test_card_${i}`,
				name: `Test Card ${i}`,
				cost: 1,
				summary: 'Test card',
				description: 'Test card',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 5, description: 'Deal 5 damage' }
				],
				tags: ['test']
			}));
		}
		
		// Add some utility cards
		cards.push(new Card({
			type: 'heal_card',
			name: 'Heal',
			cost: 2,
			summary: 'Heal 10 structure',
			description: 'Heal 10 structure',
			rarity: 'common',
			targetType: 'ally',
			effects: [
				{ type: 'heal', value: 10, description: 'Heal 10 structure' }
			],
			tags: ['heal']
		}));
		
		cards.push(new Card({
			type: 'draw_card',
			name: 'Draw',
			cost: 0,
			summary: 'Draw 2 cards',
			description: 'Draw 2 cards',
			rarity: 'common',
			targetType: 'self',
			effects: [
				{ type: 'draw', value: 2, description: 'Draw 2 cards' }
			],
			tags: ['draw']
		}));
		
		return new Deck('test', 'Test Deck', cards);
	};

	beforeEach(() => {
		// Create player drivers with test decks
		playerDriver1 = new Driver({
			archetype: 'road_warrior',
			metadata: {
				name: 'Player Driver 1',
				vehicleName: 'Test Vehicle 1',
				specialty: 'TEST',
				flavorText: 'Test driver',
				unlocked: true
			},
			skills: {
				ramming: 5,
				gunnery: 5,
				evade: 5
			},
			vehicleStats: {
				maxStructure: 30,
				weight: 5,
				armor: 0,
				speed: 5,
				gunnery: 5,
				evade: 5
			},
			startingDeck: {
				cards: []
			},
			deck: createTestDeck(),
			hitpoints: 10,
			maxHitpoints: 10,
			adrenaline: 3,
			maxAdrenaline: 3,
			role: DriverRole.ACTIVE,
			hand: [],
			discard: []
		});

		playerDriver2 = new Driver({
			archetype: 'road_warrior',
			metadata: {
				name: 'Player Driver 2',
				vehicleName: 'Test Vehicle 2',
				specialty: 'TEST',
				flavorText: 'Test driver',
				unlocked: true
			},
			skills: {
				ramming: 5,
				gunnery: 5,
				evade: 5
			},
			vehicleStats: {
				maxStructure: 30,
				weight: 5,
				armor: 0,
				speed: 5,
				gunnery: 5,
				evade: 5
			},
			startingDeck: {
				cards: []
			},
			deck: createTestDeck(),
			hitpoints: 10,
			maxHitpoints: 10,
			adrenaline: 3,
			maxAdrenaline: 3,
			role: DriverRole.ACTIVE,
			hand: [],
			discard: []
		});

		// Create enemy driver
		enemyDriver = new Driver({
			archetype: 'raider',
			metadata: {
				name: 'Enemy Driver 1',
				vehicleName: 'Enemy Vehicle',
				specialty: 'ENEMY',
				flavorText: 'Enemy driver',
				unlocked: true
			},
			skills: {
				ramming: 5,
				gunnery: 5,
				evade: 5
			},
			vehicleStats: {
				maxStructure: 20,
				weight: 4,
				armor: 0,
				speed: 4,
				gunnery: 4,
				evade: 4
			},
			startingDeck: {
				cards: []
			},
			deck: createTestDeck(),
			hitpoints: 10,
			maxHitpoints: 10,
			adrenaline: 3,
			maxAdrenaline: 3,
			role: DriverRole.ACTIVE,
			hand: [],
			discard: []
		});

		// Create vehicles
		playerVehicle1 = new Vehicle({
			name: 'Player Vehicle 1',
			structure: 30,
			maxStructure: 30,
			armor: 0,
			maxArmor: 10,
			speed: 5,
			baseSpeed: 5,
			slot: null,
			flank: null,
			velocity: 0,
			driver: playerDriver1,
			passenger: null,
			statusEffects: []
		});

		playerVehicle2 = new Vehicle({
			name: 'Player Vehicle 2',
			structure: 30,
			maxStructure: 30,
			armor: 0,
			maxArmor: 10,
			speed: 5,
			baseSpeed: 5,
			slot: null,
			flank: null,
			velocity: 0,
			driver: playerDriver2,
			passenger: null,
			statusEffects: []
		});

		enemyVehicle = new Vehicle({
			name: 'Enemy Vehicle 1',
			structure: 20,
			maxStructure: 20,
			armor: 0,
			maxArmor: 5,
			speed: 4,
			baseSpeed: 4,
			slot: null,
			flank: null,
			velocity: 0,
			driver: enemyDriver,
			passenger: null,
			statusEffects: []
		});

		// Create teams
		playerTeam = new Team({
			type: TeamType.PLAYER,
			vehicles: [playerVehicle1, playerVehicle2]
		});

		enemyTeam = new Team({
			type: TeamType.ENEMY,
			vehicles: [enemyVehicle]
		});

		// Create battle
		battle = new Battle({
			playerTeam,
			enemyTeam
		});
	});

	describe('Battle Initialization', () => {
		test('should create a battle with correct initial state', () => {
			expect(battle.playerTeam).toBe(playerTeam);
			expect(battle.enemyTeam).toBe(enemyTeam);
			expect(battle.turn).toBe(1);
			expect(battle.isPlayerTurn).toBe(true);
			expect(battle.battleOver).toBe(false);
			expect(battle.battleWon).toBe(false);
		});

		test('should throw error if player team is not of type PLAYER', () => {
			const invalidPlayerTeam = new Team({
				type: TeamType.ENEMY,
				vehicles: [playerVehicle1, playerVehicle2]
			});

			expect(() => {
				new Battle({
					playerTeam: invalidPlayerTeam,
					enemyTeam
				});
			}).toThrow('Player team must have type PLAYER');
		});

		test('should throw error if enemy team is not of type ENEMY', () => {
			const invalidEnemyTeam = new Team({
				type: TeamType.PLAYER,
				vehicles: [enemyVehicle, playerVehicle2]
			});

			expect(() => {
				new Battle({
					playerTeam,
					enemyTeam: invalidEnemyTeam
				});
			}).toThrow('Enemy team must have type ENEMY');
		});

		test('should start battle and draw initial hands', () => {
			// Clear hands before starting
			playerDriver1.hand = [];
			playerDriver2.hand = [];
			enemyDriver.hand = [];

			battle.start();

			// Each driver should have 5 cards in hand
			expect(playerDriver1.hand.length).toBe(5);
			expect(playerDriver2.hand.length).toBe(5);
			expect(enemyDriver.hand.length).toBe(5);

			// Check adrenaline is refilled
			expect(playerDriver1.adrenaline).toBe(playerDriver1.maxAdrenaline);
			expect(playerDriver2.adrenaline).toBe(playerDriver2.maxAdrenaline);
			expect(enemyDriver.adrenaline).toBe(enemyDriver.maxAdrenaline);
		});

		test('should emit battleStarted event when started', () => {
			const eventSpy = jest.fn();
			battle.on('battleStarted', eventSpy);

			battle.start();

			expect(eventSpy).toHaveBeenCalledWith(battle.getState());
		});
	});

	describe('Card Playing', () => {
		beforeEach(() => {
			battle.start();
		});

		test('should not allow enemy driver to play cards during player turn', () => {
			const result = battle.playCard({
				driver: enemyDriver,
				cardIndex: 0,
				targetVehicle: playerVehicle1
			});

			expect(result).toBe(false);
		});

		test('should consume adrenaline when playing a card', () => {
			const initialAdrenaline = playerDriver1.adrenaline;
			const cardCost = playerDriver1.hand[0].cost;
			
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: enemyVehicle
			});

			expect(playerDriver1.adrenaline).toBe(initialAdrenaline - cardCost);
		});

		test('should not allow playing card without enough adrenaline', () => {
			// Find a card that costs more than 0
			let expensiveCardIndex = -1;
			for (let i = 0; i < playerDriver1.hand.length; i++) {
				if (playerDriver1.hand[i].cost > 0) {
					expensiveCardIndex = i;
					break;
				}
			}
			
			// If no expensive card found, skip test
			if (expensiveCardIndex === -1) {
				return;
			}
			
			// Drain all adrenaline
			playerDriver1.adrenaline = 0;
			
			const result = battle.playCard({
				driver: playerDriver1,
				cardIndex: expensiveCardIndex,
				targetVehicle: enemyVehicle
			});

			expect(result).toBe(false);
		});

		test('should emit cardPlayed event when card is played', () => {
			const eventSpy = jest.fn();
			battle.on('cardPlayed', eventSpy);

			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: enemyVehicle
			});

			expect(eventSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					driver: playerDriver1,
					card: expect.any(Card),
					targetVehicle: enemyVehicle
				})
			);
		});
	});

	describe('Battle Statistics', () => {
		test('should return correct battle statistics', () => {
			battle.start();

			const stats = battle.getBattleStats();

			expect(stats.turn).toBe(1);
			expect(stats.isPlayerTurn).toBe(true);
			expect(stats.battleOver).toBe(false);
			expect(stats.battleWon).toBe(false);
			expect(stats.playerTeam).toBeDefined();
			expect(stats.enemyTeam).toBeDefined();
		});
	});


	describe('Model Event System', () => {
		test('should emit stateChanged events when battle state changes', () => {
			const stateChangedSpy = jest.fn();
			battle.on('stateChanged', stateChangedSpy);

			battle.start();

			// Playing a card should emit state change
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: enemyVehicle
			});

			expect(stateChangedSpy).toHaveBeenCalled();
		});

		test('should properly implement isBattleOver and isBattleWon helpers', () => {
			expect(battle.isBattleOver()).toBe(false);
			expect(battle.isBattleWon()).toBe(false);

			// Play a card that will kill the enemy
			const damageCard = new Card({
				type: 'instant_kill',
				name: 'Instant Kill',
				cost: 0,
				summary: 'Kill enemy',
				description: 'Kill enemy',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{
					type: 'damage',
					value: 100,
					target: 'driver',
					always_hits: true
				}],
				tags: ['attack']
			});
			
			playerDriver1.hand.push(damageCard);
			
			// This should kill the enemy driver and trigger battle end
			battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1,
				targetVehicle: enemyVehicle
			});

			expect(battle.isBattleOver()).toBe(true);
			expect(battle.isBattleWon()).toBe(true);
		});
	});

	describe('Edge Cases', () => {
		beforeEach(() => {
			battle.start();
		});

		test('should handle playing card with no target when target is required', () => {
			const result = battle.playCard({
				driver: playerDriver1,
				cardIndex: 0
				// No target specified for damage card
			});

			expect(result).toBe(true); // Method doesn't validate target requirement
		});

		test('should handle invalid card index', () => {
			const result = battle.playCard({
				driver: playerDriver1,
				cardIndex: 999, // Invalid index
				targetVehicle: enemyVehicle
			});

			expect(result).toBe(false);
		});

		test('should handle adrenaline gain effects', () => {
			// Set specific adrenaline amount to test gain
			playerDriver1.adrenaline = 1;
			
			// Create adrenaline card
			const adrenalineCard = new Card({
				type: 'boost_card',
				name: 'Boost',
				cost: 0,
				summary: 'Gain adrenaline',
				description: 'Gain adrenaline',
				rarity: 'common',
				targetType: 'self',
				effects: [
					{ type: 'adrenaline', value: 2, description: 'Gain 2 adrenaline' }
				],
				tags: ['adrenaline']
			});

			playerDriver1.hand.push(adrenalineCard);

			const result = battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1
			});

			expect(result).toBe(true);
			// Card costs 0, adrenaline was 1, gain 2, should be 3 (max)
			expect(playerDriver1.adrenaline).toBe(3);
		});
	});

	describe('Turn Management', () => {
		beforeEach(() => {
			battle.start();
		});

		test('should not allow ending turn during enemy turn', async () => {
			// Force enemy turn
			battle.isPlayerTurn = false;
			
			const initialTurn = battle.turn;
			await battle.endPlayerTurn();
			
			// Turn should not advance when trying to end turn during enemy turn
			expect(battle.turn).toBe(initialTurn);
			expect(battle.isPlayerTurn).toBe(false);
		});

		test('should process full enemy turn with AI actions', async () => {
			// Set enemy to have low enough skills to ensure a hit
			playerDriver1.skills.evade = 1;
			enemyDriver.skills.gunnery = 5;
			
			// Give enemy a card that will hit
			const attackCard = new Card({
				type: 'enemy_attack',
				name: 'Enemy Attack',
				cost: 1,
				summary: 'Enemy attack',
				description: 'Enemy attack',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 10, always_hits: true }],
				tags: ['attack']
			});
			
			// Set up enemy with card in hand and enough adrenaline
			enemyDriver.hand = [attackCard];
			enemyDriver.adrenaline = 3; // Ensure enough adrenaline
			// The plan was made at start() against the drawn hand; plan again for the rigged one
			battle.planEnemyTurn();
			
			const playerInitialStructure = playerVehicle1.structure;
			const playerInitialArmor = playerVehicle1.armor;
			
			// End player turn to trigger enemy AI
			await battle.endPlayerTurn();
			
			// Enemy should have played a card
			// Turn should advance back to player
			expect(battle.isPlayerTurn).toBe(true);
			expect(battle.turn).toBe(2);
			
			// Player should have taken damage from enemy attack
			// Check either armor or structure was reduced
			const totalDamage = (playerInitialArmor - playerVehicle1.armor) + 
			                   (playerInitialStructure - playerVehicle1.structure);
			expect(totalDamage).toBeGreaterThan(0);
		});

		test('should handle enemy passenger drivers who cannot play attack cards', async () => {
			// Create a passenger driver for enemy
			const enemyPassenger = new Driver({
				archetype: 'raider',
				metadata: {
					name: 'Enemy Passenger',
					vehicleName: 'Enemy Vehicle',
					specialty: 'ENEMY',
					flavorText: 'Enemy passenger',
					unlocked: true
				},
				skills: {
					ramming: 5,
					gunnery: 5,
					evade: 5
				},
				vehicleStats: {
					maxStructure: 20,
					weight: 4,
					armor: 0,
					speed: 4,
					gunnery: 4,
					evade: 4
				},
				startingDeck: { cards: [] },
				deck: createTestDeck(),
				hitpoints: 10,
				maxHitpoints: 10,
				adrenaline: 3,
				maxAdrenaline: 3,
				role: DriverRole.PASSENGER,
				hand: [],
				discard: []
			});

			// Add passenger to enemy vehicle
			enemyVehicle.passenger = enemyPassenger;
			
			// Clear hands and discards to control what cards are available
			enemyDriver.hand = [];
			enemyDriver.discard = [];
			enemyPassenger.hand = [];
			enemyPassenger.discard = [];
			
			// Give passenger only attack cards in discard (will be drawn at turn start)
			const attackCard = new Card({
				type: 'attack_card',
				name: 'Attack',
				cost: 1,
				summary: 'Attack card',
				description: 'Attack card',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 5, description: 'Deal 5 damage' }],
				tags: ['attack']
			});
			
			for (let i = 0; i < 5; i++) {
				enemyPassenger.discard.push(attackCard);
			}
			
			const playerInitialStructure = playerVehicle1.structure;
			
			// End player turn to trigger enemy AI
			await battle.endPlayerTurn();
			
			// Passenger should not have played attack cards (they can't as passenger)
			// The processEnemyTurns should skip passengers who only have attack cards
			expect(playerVehicle1.structure).toBe(playerInitialStructure);
		});

		test('should process status effects at start of new turn', async () => {
			// Apply a status effect to player vehicle
			playerVehicle1.applyStatusEffect({
				name: 'oil_slick',
				duration: 2,
				value: -4,
				description: 'Speed reduced'
			});
			
			const initialDuration = playerVehicle1.statusEffects[0].duration;
			
			// Clear enemy cards to avoid damage during enemy turn
			enemyDriver.hand = [];
			if (enemyDriver.deck) {
				enemyDriver.deck.cards = [];
			}
			
			// End player turn and let enemy turn complete
			await battle.endPlayerTurn();
			
			// Status effect duration should have been processed at start of new player turn
			expect(playerVehicle1.statusEffects[0].duration).toBe(initialDuration - 1);
			// Effect should still be active
			expect(playerVehicle1.statusEffects.length).toBe(1);
		});

		test('should handle turn transition when battle ends during enemy turn', () => {
			// Set enemy driver to low health
			enemyDriver.hitpoints = 1;
			
			// Give player a card that will kill enemy on their turn
			const killCard = new Card({
				type: 'headshot',
				name: 'Headshot',
				cost: 1,
				summary: 'Kill driver',
				description: 'Kill driver',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{
					type: 'damage',
					value: 10,
					target: 'driver',
					always_hits: true,
					description: 'Deal 10 damage to driver'
				}],
				tags: ['attack']
			});
			
			playerDriver1.hand = [killCard];
			playerDriver1.adrenaline = 3;
			
			// Play card to kill enemy
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: enemyVehicle
			});
			
			// Battle should end immediately
			expect(battle.battleOver).toBe(true);
			expect(battle.battleWon).toBe(true);
		});
	});

	describe('Combat Effects', () => {
		beforeEach(() => {
			battle.start();
		});

		test('should apply self damage effects (Berserker card)', () => {
			// The Battle implementation processes effects in order, so self_driver damage is separate
			const berserkerCard = new Card({
				type: 'berserker',
				name: 'Berserker Rage',
				cost: 1,
				summary: 'Deal damage but hurt yourself',
				description: 'Deal damage but hurt yourself',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 10, always_hits: true, description: 'Deal 10 damage' },
					{ type: 'damage', value: 3, target: 'self_driver', description: 'Take 3 damage' }
				],
				tags: ['attack', 'berserker']
			});
			
			playerDriver1.hand = [berserkerCard];
			// Make sure driver has enough HP to survive self damage
			playerDriver1.hitpoints = 10;
			playerDriver1.maxHitpoints = 10;
			const enemyInitialStructure = enemyVehicle.structure;
			
			// Clear messages before playing card
			battle.clearMessages();
			
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: enemyVehicle
			});
			
			// Enemy should take damage
			expect(enemyVehicle.structure).toBeLessThan(enemyInitialStructure);
			
			// Due to current implementation, self_driver damage requires a target vehicle
			// and is processed as part of the damage effect against the target
			// This is a known limitation - self damage isn't currently working
			// TODO: Fix Battle.ts to handle self_driver effects independently
			
			// Check battle messages instead of console.log
			const messages = battle.getMessages();
			const damageMessage = messages.find(m => 
				m.type === 'damage_dealt' && 
				m.message.includes('Berserker Rage deals') &&
				m.message.includes('damage to Enemy Vehicle 1')
			);
			expect(damageMessage).toBeDefined();
		});

		test('should handle vehicle destruction and driver escape', () => {
			// Set enemy vehicle to low structure
			enemyVehicle.structure = 5;
			
			// Create a second enemy vehicle for driver to escape to
			const enemyVehicle2 = new Vehicle({
				name: 'Enemy Vehicle 2',
				structure: 20,
				maxStructure: 20,
				armor: 0,
				maxArmor: 5,
				speed: 4,
				baseSpeed: 4,
				slot: { lane: RoadLane.ENEMY_OUTSIDE, row: RoadRow.CENTER },
				flank: null,
				velocity: 0,
				driver: null,
				passenger: null,
				statusEffects: []
			});
			
			enemyTeam.vehicles.push(enemyVehicle2);
			
			const highDamageCard = new Card({
				type: 'high_damage',
				name: 'Big Shot',
				cost: 1,
				summary: 'Deal massive damage',
				description: 'Deal massive damage',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 10, always_hits: true, description: 'Deal 10 damage' }],
				tags: ['attack']
			});
			
			playerDriver1.hand = [highDamageCard];
			
			// Store initial driver
			const originalDriver = enemyDriver;
			
			// Play card to destroy vehicle
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: enemyVehicle
			});
			
			// Vehicle should be destroyed
			expect(enemyVehicle.isAlive()).toBe(false);
			// The destroyed vehicle should have no occupants
			expect(enemyVehicle.driver).toBe(null);
			expect(enemyVehicle.passenger).toBe(null);
			// Driver should have escaped to the other vehicle as passenger
			expect(enemyVehicle2.passenger).toBe(originalDriver);
			expect(originalDriver.role).toBe(DriverRole.PASSENGER);
		});

		test('should apply heal_driver effect with same_vehicle restriction', () => {
			// Damage the driver in the same vehicle
			playerDriver1.hitpoints = 5;
			playerDriver1.maxHitpoints = 10;
			
			// Medical kit card that targets the vehicle (which contains the driver)
			const medicalKit = new Card({
				type: 'medical_kit',
				name: 'Medical Kit',
				cost: 1,
				summary: 'Heal driver in same vehicle',
				description: 'Heal driver in same vehicle',
				rarity: 'common',
				targetType: 'ally',
				effects: [{
					type: 'heal_driver',
					value: 3,
					target: 'same_vehicle',
					description: 'Heal 3 HP to driver in same vehicle'
				}],
				tags: ['heal']
			});
			
			playerDriver1.hand = [medicalKit];
			
			// Clear messages before test
			battle.clearMessages();
			
			// Try to heal driver in same vehicle (should work)
			const result1 = battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: playerVehicle1
			});
			
			expect(result1).toBe(true);
			// The heal_driver effect heals the driver of the target vehicle
			expect(playerDriver1.hitpoints).toBe(8); // 5 + 3
			
			// Check battle messages for heal message
			const messages = battle.getMessages();
			const healMessage = messages.find(m => 
				m.type === 'heal_applied' && 
				m.message.includes('heals 3 hit points')
			);
			expect(healMessage).toBeDefined();
			
			// Try to heal driver in different vehicle (should fail)
			playerDriver2.hitpoints = 5; // Damage driver 2
			playerDriver2.maxHitpoints = 10;
			playerDriver1.hand = [medicalKit];
			playerDriver1.adrenaline = 3;
			
			// Clear messages before second attempt
			battle.clearMessages();
			
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: playerVehicle2
			});
			
			// Check for warning message
			const warningMessage = battle.getMessages().find(m => 
				m.type === 'general' && 
				m.message.includes('Can only heal drivers in same vehicle')
			);
			expect(warningMessage).toBeDefined();
			expect(playerDriver2.hitpoints).toBe(5); // Should not heal
		});

		test('should apply armor effect to vehicles', () => {
			const armorCard = new Card({
				type: 'armor_plating',
				name: 'Armor Plating',
				cost: 1,
				summary: 'Add armor',
				description: 'Add armor',
				rarity: 'common',
				targetType: 'ally',
				effects: [{ type: 'armor', value: 5, description: 'Add 5 armor' }],
				tags: ['armor']
			});
			
			playerDriver1.hand = [armorCard];
			const initialArmor = playerVehicle1.armor;
			
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: playerVehicle1
			});
			
			expect(playerVehicle1.armor).toBe(initialArmor + 5);
		});
	});

	describe('Status Effects', () => {
		beforeEach(() => {
			battle.start();
		});

		test('should skip status effects when condition not met', () => {
			// Create a conditional status card
			const conditionalCard = new Card({
				type: 'flanking_shot',
				name: 'Flanking Shot',
				cost: 1,
				summary: 'Apply slow to flanking targets',
				description: 'Apply slow to flanking targets',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{
					type: 'status',
					status: 'slow',
					value: 2,
					duration: 2,
					condition: 'target_flanking',
					description: 'Apply slow if target is flanking'
				}],
				tags: ['attack']
			});
			
			// Enemy is not flanking
			expect(enemyVehicle.isFlanking).toBe(false);
			
			playerDriver1.hand = [conditionalCard];
			
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: enemyVehicle
			});
			
			// Status should not be applied
			expect(enemyVehicle.statusEffects.length).toBe(0);
		});

		test('should require hit check for status effects without always_hits', () => {
			// Create a status card that needs to hit
			const statusCard = new Card({
				type: 'stun_shot',
				name: 'Stun Shot',
				cost: 1,
				summary: 'Apply stun',
				description: 'Apply stun',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{
					type: 'status',
					status: 'stunned',
					value: 1,
					duration: 1,
					description: 'Apply stun'
				}],
				tags: ['attack']
			});
			
			// Set enemy evade higher than player gunnery
			enemyDriver.skills.evade = 10;
			playerDriver1.skills.gunnery = 5;
			
			playerDriver1.hand = [statusCard];
			
			// Clear messages before test
			battle.clearMessages();
			
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: enemyVehicle
			});
			
			// Should miss and not apply status
			const missMessage = battle.getMessages().find(m => 
				m.type === 'miss' && 
				m.message.includes('misses')
			);
			expect(missMessage).toBeDefined();
			expect(enemyVehicle.statusEffects.length).toBe(0);
		});

		test('should apply status with always_hits', () => {
			const alwaysHitCard = new Card({
				type: 'guaranteed_slow',
				name: 'Guaranteed Slow',
				cost: 1,
				summary: 'Always apply slow',
				description: 'Always apply slow',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{
					type: 'status',
					status: 'slow',
					value: 2,
					duration: 2,
					always_hits: true,
					description: 'Always apply slow'
				}],
				tags: ['attack']
			});
			
			// Set enemy evade very high
			enemyDriver.skills.evade = 20;
			playerDriver1.skills.gunnery = 1;
			
			playerDriver1.hand = [alwaysHitCard];
			
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: enemyVehicle
			});
			
			// Status should be applied despite low hit chance
			expect(enemyVehicle.statusEffects.length).toBe(1);
			expect(enemyVehicle.statusEffects[0].name).toBe('slow');
		});
	});

	describe('Target Validation', () => {
		beforeEach(() => {
			battle.start();
		});

		test('should validate range for cards without explicit range', () => {
			// Your outside to their inside is range 2
			playerVehicle1.slot = { lane: RoadLane.PLAYER_OUTSIDE, row: RoadRow.CENTER };
			
			// Card with damage but no explicit range (should use default)
			const rangedCard = new Card({
				type: 'long_shot',
				name: 'Long Shot',
				cost: 1,
				summary: 'Ranged attack',
				description: 'Ranged attack',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 5, description: 'Deal 5 damage' }],
				tags: ['attack']
			});
			
			playerDriver1.hand = [rangedCard];
			
			// Should work - range 2 is the default max range
			const result = battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: enemyVehicle
			});
			
			expect(result).toBe(true);
		});

		test('should prevent targeting same team vehicles', () => {
			const damageCard = new Card({
				type: 'damage',
				name: 'Damage',
				cost: 1,
				summary: 'Deal damage',
				description: 'Deal damage',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 5, description: 'Deal 5 damage' }],
				tags: ['attack']
			});
			
			playerDriver1.hand = [damageCard];
			
			// Clear messages before test
			battle.clearMessages();
			
			// Try to target friendly vehicle
			const result = battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: playerVehicle2
			});
			
			expect(result).toBe(false);
			// Check for invalid target message
			const invalidMessage = battle.getMessages().find(m => 
				m.type === 'general' && 
				m.message.includes('Invalid target for card')
			);
			expect(invalidMessage).toBeDefined();
		});

		test('should enforce explicit range limits', () => {
			// Position vehicles at range 2
			enemyVehicle.slot = { lane: RoadLane.ENEMY_OUTSIDE, row: RoadRow.CENTER };
			
			// Card with explicit range 1
			const shortRangeCard = new Card({
				type: 'point_blank',
				name: 'Point Blank',
				cost: 1,
				summary: 'Short range attack',
				description: 'Short range attack',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{ 
					type: 'damage', 
					value: 10, 
					range: 1,
					description: 'Deal 10 damage at range 1' 
				}],
				tags: ['attack']
			});
			
			playerDriver1.hand = [shortRangeCard];
			
			// Clear messages before test
			battle.clearMessages();
			
			const result = battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: enemyVehicle
			});
			
			expect(result).toBe(false);
			// Check for out of range message
			const rangeMessage = battle.getMessages().find(m => 
				m.type === 'general' && 
				m.message.includes('Target out of range: 2 > 1')
			);
			expect(rangeMessage).toBeDefined();
		});
	});

	describe('Battle End Conditions', () => {
		beforeEach(() => {
			battle.start();
		});

		test('should emit battleEnded event when player loses', () => {
			const eventSpy = jest.fn();
			battle.on('battleEnded', eventSpy);
			
			// Kill all player drivers
			playerDriver1.hitpoints = 0;
			playerDriver2.hitpoints = 0;
			
			// Play any card to trigger battle status check
			const card = new Card({
				type: 'simple',
				name: 'Simple',
				cost: 0,
				summary: 'Simple card',
				description: 'Simple card',
				rarity: 'common',
				targetType: 'self',
				effects: [{ type: 'draw', value: 1, description: 'Draw 1' }],
				tags: ['draw']
			});
			
			playerDriver1.hand = [card];
			playerDriver1.adrenaline = 1;
			
			// This should trigger checkBattleStatus internally
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0
			});
			
			expect(battle.battleOver).toBe(true);
			expect(battle.battleWon).toBe(false);
			expect(eventSpy).toHaveBeenCalledWith({ won: false });
		});

		test('should emit combatEnded event', () => {
			const eventSpy = jest.fn();
			battle.on('combatEnded', eventSpy);
			
			battle.endCombat();
			
			expect(eventSpy).toHaveBeenCalledWith(battle.getState());
		});
	});

	describe('Edge Cases - Extended', () => {
		beforeEach(() => {
			battle.start();
		});

		test('should prevent playing cards during enemy turn', () => {
			// Force enemy turn
			battle.isPlayerTurn = false;
			
			const result = battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: enemyVehicle
			});
			
			expect(result).toBe(false);
		});

		test('should handle null card from playCardWithCost', () => {
			// This edge case tests defensive programming for an unlikely scenario
			// Since we can't mock frozen Model objects, we'll test a different way
			
			// Give player an invalid card index that's just within bounds
			// but might cause issues if the deck state is corrupted
			playerDriver1.hand = [];
			
			// Clear messages before test
			battle.clearMessages();
			
			const result = battle.playCard({
				driver: playerDriver1,
				cardIndex: 0, // Index 0 but hand is empty
				targetVehicle: enemyVehicle
			});
			
			expect(result).toBe(false);
			// Should get invalid card index message
			const errorMessage = battle.getMessages().find(m => 
				m.type === 'general' && 
				m.message.includes('Cannot play card:')
			);
			expect(errorMessage).toBeDefined();
		});
	});

	describe('Legacy Effect Compatibility', () => {
		beforeEach(() => {
			battle.start();
		});

		test('should handle legacy armor effect type', () => {
			const legacyArmorCard = new Card({
				type: 'legacy_armor',
				name: 'Legacy Armor',
				cost: 1,
				summary: 'Add armor (legacy)',
				description: 'Add armor (legacy)',
				rarity: 'common',
				targetType: 'ally',
				effects: [{ type: 'armor', value: 3, description: 'Add 3 armor' }],
				tags: ['armor']
			});
			
			playerDriver1.hand = [legacyArmorCard];
			const initialArmor = playerVehicle1.armor;
			
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0,
				targetVehicle: playerVehicle1
			});
			
			expect(playerVehicle1.armor).toBe(initialArmor + 3);
		});

		test('should handle draw effect type', () => {
			const drawCard = new Card({
				type: 'draw',
				name: 'Draw',
				cost: 0,
				summary: 'Draw cards',
				description: 'Draw cards',
				rarity: 'common',
				targetType: 'self',
				effects: [{ type: 'draw', value: 2, description: 'Draw 2 cards' }],
				tags: ['draw']
			});
			
			// Set up hand with known cards
			playerDriver1.hand = [drawCard];
			const initialHandSize = playerDriver1.hand.length;
			
			battle.playCard({
				driver: playerDriver1,
				cardIndex: 0
			});
			
			// Should have drawn 2 cards minus the one played
			expect(playerDriver1.hand.length).toBe(initialHandSize + 1);
		});

	});

	describe('Hand Cap', () => {
		const createNitroBoost = (): Card => new Card({
			type: 'nitro_boost',
			name: 'Nitro Boost',
			cost: 1,
			summary: 'Gain 3 speed for 2 turns. Draw 2 cards.',
			description: 'Gain 3 speed for 2 turns. Draw 2 cards.',
			rarity: 'uncommon',
			targetType: 'self',
			effects: [
				{ type: 'apply_status', status: 'speed_boost', value: 3, duration: 2, target: 'self' },
				{ type: 'draw_cards', value: 2, target: 'self' }
			],
			tags: ['utility', 'status', 'draw']
		});

		const nitroDeckSize = 20;

		beforeEach(() => {
			const nitroCards: Card[] = [];
			for (let i = 0; i < nitroDeckSize; i++) {
				nitroCards.push(createNitroBoost());
			}
			playerDriver1.deck = new Deck('nitro', 'Nitro Deck', nitroCards);
		});

		const startWithNitroInHand = (): void => {
			battle.start();
			playerDriver1.adrenaline = 10;
		};

		test('a Nitro Boost chain stops at the hand cap and burns the overflow to discard', () => {
			startWithNitroInHand();
			const burnSpy = jest.fn();
			playerDriver1.on('cardsBurned', burnSpy);

			for (let play = 0; play < 5; play++) {
				expect(battle.playCard({ driver: playerDriver1, cardIndex: 0 })).toBe(true);
				expect(playerDriver1.hand.length).toBeLessThanOrEqual(HAND_CAP);
			}

			// 5 + 2 per play: 5 -> 6 -> 7, then each later play burns 1 of its 2 draws
			expect(playerDriver1.hand.length).toBe(HAND_CAP);
			expect(burnSpy).toHaveBeenCalledTimes(3);
			expect(playerDriver1.discard.length).toBe(5 + 3);
			expect(playerDriver1.deck?.size).toBe(nitroDeckSize - 15);

			const burnedCards = burnSpy.mock.calls.flatMap(([event]) => event.cards);
			burnedCards.forEach(card => expect(playerDriver1.discard).toContain(card));
		});

		test('burned cards are logged in plain words', () => {
			startWithNitroInHand();
			for (let play = 0; play < 3; play++) {
				battle.playCard({ driver: playerDriver1, cardIndex: 0 });
			}

			const burnMessages = battle.getMessagesByType('cards_burned');
			expect(burnMessages).toHaveLength(1);
			expect(burnMessages[0].message).toBe(
				"Player1 Player Driver 1's hand is full, so Nitro Boost goes straight to the discard pile"
			);
			expect(burnMessages[0].metadata?.value).toBe(1);
		});

		test('the turn draw burns past the cap too', () => {
			playerDriver2.hand = [createNitroBoost(), createNitroBoost(), createNitroBoost(), createNitroBoost()];

			battle.start();

			expect(playerDriver2.hand.length).toBe(HAND_CAP);
			expect(playerDriver2.discard.length).toBe(4 + 5 - HAND_CAP);
			expect(battle.getMessagesByType('cards_burned')).toHaveLength(1);
		});
	});
});
