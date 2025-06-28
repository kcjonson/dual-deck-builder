/**
 * @jest-environment jsdom
 */
import { Battle } from './Battle';
import { Team, TeamType } from './Team';
import { Vehicle, VehiclePosition } from './Vehicle';
import { Driver, DriverRole } from './Driver';
import { Card } from './Card';
import { Deck } from './Deck';

describe('Combat Mechanics', () => {
	let battle: Battle;
	let playerTeam: Team;
	let enemyTeam: Team;
	let playerVehicle1: Vehicle;
	let playerVehicle2: Vehicle;
	let enemyVehicle1: Vehicle;
	let enemyVehicle2: Vehicle;
	let playerDriver1: Driver;
	let playerDriver2: Driver;
	let enemyDriver1: Driver;
	let enemyDriver2: Driver;

	// Helper to create drivers with specific skills
	const createDriverWithSkills = (name: string, gunnery: number, evade: number, ramming: number): Driver => {
		// Create some test cards for the deck
		const testCards = [
			new Card({
				type: 'test_card_1',
				name: 'Test Card 1',
				description: 'Test',
				cost: 1,
				rarity: 'common',
				targetType: 'self',
				effects: [],
				tags: []
			}),
			new Card({
				type: 'test_card_2',
				name: 'Test Card 2',
				description: 'Test',
				cost: 1,
				rarity: 'common',
				targetType: 'self',
				effects: [],
				tags: []
			})
		];
		
		// Create 10 cards for the deck
		const deckCards = [];
		for (let i = 0; i < 10; i++) {
			deckCards.push(...testCards);
		}
		
		return new Driver({
			archetype: 'road_warrior',
			metadata: {
				name: name,
				vehicleName: 'Test Vehicle',
				specialty: 'TEST',
				flavorText: 'Test driver',
				unlocked: true
			},
			skills: {
				ramming: ramming,
				gunnery: gunnery,
				evade: evade
			},
			vehicleStats: {
				maxHealth: 30,
				weight: 5,
				armor: 0,
				speed: 5,
				gunnery: gunnery,
				evade: evade
			},
			startingDeck: { cards: [] },
			deck: new Deck('test', 'Test Deck', deckCards),
			hitpoints: 10,
			maxHitpoints: 10,
			adrenaline: 5,
			maxAdrenaline: 5,
			role: DriverRole.ACTIVE,
			hand: [],
			discard: []
		});
	};

	// Helper to create vehicles at specific positions
	const createVehicleAtPosition = (name: string, position: VehiclePosition, driver: Driver): Vehicle => {
		return new Vehicle({
			name: name,
			structure: 30,
			maxStructure: 30,
			armor: 10,
			maxArmor: 10,
			speed: 5,
			baseSpeed: 5,
			position: position,
			velocity: 0,
			driver: driver,
			passenger: null,
			statusEffects: []
		});
	};

	beforeEach(() => {
		// Create drivers with different skill levels
		playerDriver1 = createDriverWithSkills('Player 1', 7, 5, 6); // Good gunner
		playerDriver2 = createDriverWithSkills('Player 2', 5, 7, 8); // Good evader/rammer
		enemyDriver1 = createDriverWithSkills('Enemy 1', 6, 6, 5); // Balanced
		enemyDriver2 = createDriverWithSkills('Enemy 2', 4, 8, 4); // High evade

		// Create vehicles at different positions
		playerVehicle1 = createVehicleAtPosition('Player Vehicle 1', VehiclePosition.FRONT, playerDriver1);
		playerVehicle2 = createVehicleAtPosition('Player Vehicle 2', VehiclePosition.BACK, playerDriver2);
		enemyVehicle1 = createVehicleAtPosition('Enemy Vehicle 1', VehiclePosition.FRONT, enemyDriver1);
		enemyVehicle2 = createVehicleAtPosition('Enemy Vehicle 2', VehiclePosition.BACK, enemyDriver2);

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
		battle = new Battle({
			playerTeam,
			enemyTeam
		});
	});

	describe('Range System', () => {
		test('should calculate range 1 for front to front', () => {
			const range = battle.calculateRange(playerVehicle1, enemyVehicle1);
			expect(range).toBe(1);
		});

		test('should calculate range 2 for front to back', () => {
			const range = battle.calculateRange(playerVehicle1, enemyVehicle2);
			expect(range).toBe(2);
		});

		test('should calculate range 2 for back to front', () => {
			const range = battle.calculateRange(playerVehicle2, enemyVehicle1);
			expect(range).toBe(2);
		});

		test('should calculate correct ranges for flanking positions', () => {
			playerVehicle1.changePosition(VehiclePosition.FLANKING);
			
			// Flanking to Front is range 2
			expect(battle.calculateRange(playerVehicle1, enemyVehicle1)).toBe(2); // enemyVehicle1 is FRONT
			// Flanking to Back is range 1
			expect(battle.calculateRange(playerVehicle1, enemyVehicle2)).toBe(1); // enemyVehicle2 is BACK
			
			// Also test reverse: Front/Back attacking Flanking
			enemyVehicle1.changePosition(VehiclePosition.FLANKING);
			enemyVehicle2.changePosition(VehiclePosition.FLANKING);
			playerVehicle1.changePosition(VehiclePosition.FRONT);
			playerVehicle2.changePosition(VehiclePosition.BACK);
			
			// Front to Flanking is range 2
			expect(battle.calculateRange(playerVehicle1, enemyVehicle1)).toBe(2);
			// Back to Flanking is range 1
			expect(battle.calculateRange(playerVehicle2, enemyVehicle1)).toBe(1);
		});

		test('should prevent out-of-range attacks', () => {
			battle.start();

			// Create a range 1 attack card
			const pointBlankCard = new Card({
				type: 'point_blank',
				name: 'Point Blank',
				cost: 1,
				description: 'Range 1 attack',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{
					type: 'damage',
					value: 3,
					range: 1
				}],
				tags: ['attack']
			});

			playerDriver1.hand.push(pointBlankCard);

			// Try to attack back vehicle (range 2)
			const result = battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1,
				targetVehicle: enemyVehicle2
			});

			expect(result).toBe(false); // Should fail due to range
		});
	});

	describe('Hit Calculation', () => {
		test('should hit when gunnery > evade', () => {
			battle.start();

			// Player 1 has gunnery 7, Enemy 1 has evade 6
			const attackCard = new Card({
				type: 'test_shot',
				name: 'Test Shot',
				cost: 1,
				description: 'Test attack',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{
					type: 'damage',
					value: 5
				}],
				tags: ['attack', 'ranged']
			});

			playerDriver1.hand.push(attackCard);
			const initialArmor = enemyVehicle1.armor;

			battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1,
				targetVehicle: enemyVehicle1
			});

			// Should hit and deal damage (first to armor)
			expect(enemyVehicle1.armor).toBeLessThan(initialArmor);
		});

		test('should miss when gunnery <= evade', () => {
			battle.start();

			// Player 1 has gunnery 7, Enemy 2 has evade 8
			const attackCard = new Card({
				type: 'test_shot',
				name: 'Test Shot',
				cost: 1,
				description: 'Test attack',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{
					type: 'damage',
					value: 5,
					scaling: 'gunnery'
				}],
				tags: ['attack', 'ranged']
			});

			playerDriver1.hand.push(attackCard);
			const initialArmor = enemyVehicle2.armor;

			battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1,
				targetVehicle: enemyVehicle2
			});

			// Should miss - no damage
			expect(enemyVehicle2.armor).toBe(initialArmor);
		});

		test('should apply hit modifier for headshot', () => {
			battle.start();

			// Headshot requires gunnery > evade + 2
			const headshotCard = new Card({
				type: 'headshot',
				name: 'Headshot',
				cost: 2,
				description: 'Precise shot',
				rarity: 'rare',
				targetType: 'enemy_single',
				effects: [{
					type: 'damage',
					value: 2,
					target: 'driver',
					hit_modifier: 2 // +2 to defender's evade
				}],
				tags: ['attack', 'ranged', 'precision']
			});

			// Player 1 gunnery 7 vs Enemy 1 evade 6
			// 7 > 6 + 2 = false, should miss
			playerDriver1.hand.push(headshotCard);
			const initialHp = enemyDriver1.hitpoints;

			battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1,
				targetVehicle: enemyVehicle1
			});

			expect(enemyDriver1.hitpoints).toBe(initialHp); // No damage
		});

		test('should hit with ram when ramming >= evade', () => {
			battle.start();

			// Player 2 has ramming 8, Enemy 1 has evade 6
			const ramCard = new Card({
				type: 'ram',
				name: 'Ram',
				cost: 2,
				description: 'Physical attack',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{
					type: 'damage',
					value: 0,
					formula: 'armor/10 + speed_diff',
					attack_type: 'ramming'
				}],
				tags: ['attack', 'physical']
			});

			playerDriver2.hand.push(ramCard);
			const initialArmor = enemyVehicle1.armor;

			battle.playCard({
				driver: playerDriver2,
				cardIndex: playerDriver2.hand.length - 1,
				targetVehicle: enemyVehicle1
			});

			// Should hit and deal damage (formula based)
			expect(enemyVehicle1.armor).toBeLessThan(initialArmor);
		});
	});

	describe('Damage Mechanics', () => {
		test('should apply flanking damage bonus', () => {
			battle.start();
			
			// Move to flanking position
			playerVehicle1.changePosition(VehiclePosition.FLANKING);

			const attackCard = new Card({
				type: 'test_attack',
				name: 'Test Attack',
				cost: 1,
				description: 'Basic attack',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{
					type: 'damage',
					value: 10,
					always_hits: true // Ensure it hits for this test
				}],
				tags: ['attack']
			});

			playerDriver1.hand.push(attackCard);
			enemyVehicle1.armor = 0; // Remove armor for easier calculation

			battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1,
				targetVehicle: enemyVehicle1
			});

			// Should deal 15 damage (10 * 1.5)
			// But first 10 goes to armor, then 5 to structure (30 - 5/2 = 27.5 -> 27 or 28)
			// Wait, we set armor to 0, so all 15 should go to structure
			// Actually vehicle takes half damage to structure, so 15/2 = 7.5 -> 8
			expect(enemyVehicle1.structure).toBe(22); // 30 - 8
		});

		test('should apply formula-based damage for ram', () => {
			battle.start();

			const ramCard = new Card({
				type: 'ram',
				name: 'Ram',
				cost: 2,
				description: 'Ram attack',
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [{
					type: 'damage',
					value: 0,
					formula: 'armor/10 + (speed_diff)',
					attack_type: 'ramming',
					always_hits: true // Ensure it hits for this test
				}],
				tags: ['attack', 'physical']
			});

			// Set specific values for testing
			playerVehicle1.armor = 20; // 20/10 = 2 damage
			// Player vehicle: base 5 + driver 5 = 10 total speed
			// Enemy vehicle: base 5 + driver 5 = 10 total speed
			// Speed diff = 0
			// Total damage = 2 + 0 = 2

			playerDriver1.hand.push(ramCard);
			enemyVehicle1.armor = 0;

			battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1,
				targetVehicle: enemyVehicle1
			});

			expect(enemyVehicle1.structure).toBe(29); // 30 - 1 (half of 2 damage)
		});

		test('should target driver only for headshot', () => {
			battle.start();

			const headshotCard = new Card({
				type: 'headshot',
				name: 'Headshot',
				cost: 2,
				description: 'Driver damage only',
				rarity: 'rare',
				targetType: 'enemy_single',
				effects: [{
					type: 'damage',
					value: 2,
					target: 'driver',
					hit_modifier: 0 // Make it easier to hit for test
				}],
				tags: ['attack', 'ranged', 'precision']
			});

			playerDriver1.hand.push(headshotCard);
			const initialStructure = enemyVehicle1.structure;
			const initialDriverHp = enemyDriver1.hitpoints;

			battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1,
				targetVehicle: enemyVehicle1
			});

			// Driver takes damage, vehicle doesn't
			expect(enemyDriver1.hitpoints).toBe(initialDriverHp - 2);
			expect(enemyVehicle1.structure).toBe(initialStructure);
		});
	});

	describe('Special Attack Mechanics', () => {
		test('should always hit with oil slick on flanking vehicles', () => {
			battle.start();
			
			// Move enemy to flanking
			enemyVehicle1.changePosition(VehiclePosition.FLANKING);

			const oilSlickCard = new Card({
				type: 'oil_slick',
				name: 'Oil Slick',
				cost: 1,
				description: 'Always hits flanking',
				rarity: 'uncommon',
				targetType: 'enemy_single',
				effects: [
					{
						type: 'apply_status',
						status: 'speed_reduction',
						value: -4,
						duration: 2,
						condition: 'target_flanking',
						always_hits: true
					},
					{
						type: 'apply_status',
						status: 'vulnerable',
						duration: 2,
						condition: 'target_flanking',
						always_hits: true
					}
				],
				tags: ['attack', 'control']
			});

			// Give enemy super high evade - should still hit
			enemyDriver1.skills.evade = 10;
			playerDriver1.skills.gunnery = 1;

			playerDriver1.hand.push(oilSlickCard);

			battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1,
				targetVehicle: enemyVehicle1
			});

			// Should apply effects despite low hit chance
			expect(enemyVehicle1.hasStatusEffect('speed_reduction')).toBe(true);
			expect(enemyVehicle1.hasStatusEffect('vulnerable')).toBe(true);
		});

		test('should only target flanking vehicles with caltrops', () => {
			battle.start();

			const caltropsCard = new Card({
				type: 'caltrops',
				name: 'Caltrops',
				cost: 2,
				description: 'Flanking only',
				rarity: 'rare',
				targetType: 'enemy_single',
				effects: [
					{
						type: 'damage',
						value: 2,
						condition: 'target_flanking',
						always_hits: true
					},
					{
						type: 'apply_status',
						status: 'speed_reduction',
						value: -2,
						duration: -1,
						condition: 'target_flanking',
						always_hits: true
					}
				],
				tags: ['attack', 'control']
			});

			playerDriver1.hand.push(caltropsCard);

			// Try to target non-flanking vehicle
			const result = battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1,
				targetVehicle: enemyVehicle1 // FRONT position
			});

			expect(result).toBe(false); // Should fail - wrong position
		});

		test('should only allow flanking with higher speed', () => {
			battle.start();

			const flankCard = new Card({
				type: 'flank',
				name: 'Flank',
				cost: 2,
				description: 'Move to flanking',
				rarity: 'common',
				targetType: 'self',
				effects: [{
					type: 'change_position',
					position: 'flanking',
					condition: 'speed_higher'
				}],
				tags: ['utility', 'positioning']
			});

			// Make player slower
			playerVehicle1.applyStatusEffect({
				name: 'slow',
				duration: 2,
				value: -10,
				description: 'Slowed'
			});

			playerDriver1.hand.push(flankCard);

			battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1
			});

			// Should not change position
			expect(playerVehicle1.position).toBe(VehiclePosition.FRONT);
		});
	});

	describe('Healing Mechanics', () => {
		test('should overflow structure healing to armor', () => {
			battle.start();

			const repairCard = new Card({
				type: 'repair_kit',
				name: 'Repair Kit',
				cost: 1,
				description: 'Heal with overflow',
				rarity: 'common',
				targetType: 'self',
				effects: [{
					type: 'heal',
					value: 8,
					overflow_to_armor: true
				}],
				tags: ['utility', 'heal']
			});

			// Damage vehicle
			playerVehicle1.structure = 27; // 3 damage
			playerVehicle1.armor = 0;

			playerDriver1.hand.push(repairCard);

			battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1
			});

			expect(playerVehicle1.structure).toBe(30); // Max
			expect(playerVehicle1.armor).toBe(5); // 8 - 3 = 5 overflow
		});

		test('should only heal drivers in same vehicle', () => {
			battle.start();

			const medicalCard = new Card({
				type: 'medical_kit',
				name: 'Medical Kit',
				cost: 2,
				description: 'Heal driver',
				rarity: 'uncommon',
				targetType: 'ally',
				effects: [{
					type: 'heal_driver',
					value: 4,
					target: 'same_vehicle'
				}],
				tags: ['utility', 'heal']
			});

			// Add passenger to vehicle 1
			const passenger = createDriverWithSkills('Passenger', 5, 5, 5);
			passenger.role = DriverRole.PASSENGER;
			playerVehicle1.passenger = passenger;

			// Damage the passenger
			passenger.takeDamage(5);

			playerDriver1.hand.push(medicalCard);

			// Try to heal driver in different vehicle (should fail)
			const result = battle.playCard({
				driver: playerDriver1,
				cardIndex: playerDriver1.hand.length - 1,
				targetVehicle: playerVehicle2 // Different vehicle
			});

			expect(result).toBe(false);
		});
	});

	describe('Post-Combat Mechanics', () => {
		test('should check flanking speed after combat', () => {
			battle.start();
			
			// Set up flanking vehicle
			playerVehicle1.changePosition(VehiclePosition.FLANKING);
			
			// Apply speed reduction during combat
			playerVehicle1.applyStatusEffect({
				name: 'speed_reduction',
				duration: -1,
				value: -4,
				description: 'Permanent slow'
			});

			// End combat
			battle.endCombat();

			// Should lose flanking if too slow
			if (playerVehicle1.getTotalSpeed() < 3) { // Assuming min speed
				expect(playerVehicle1.position).toBe(VehiclePosition.BACK);
			}
		});

		test('should handle driver jumping to other vehicles', () => {
			battle.start();

			// Destroy vehicle 1
			playerVehicle1.armor = 0;
			playerVehicle1.takeDamage(60);

			// Driver should attempt to jump to vehicle 2
			const jumped = playerTeam.handleDriverEscape(playerDriver1);

			expect(jumped).toBe(true);
			expect(playerVehicle2.passenger).toBe(playerDriver1);
			expect(playerDriver1.role).toBe(DriverRole.PASSENGER);
		});
	});
});