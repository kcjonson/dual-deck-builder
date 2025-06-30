import { AggressiveFlankerAI } from './AggressiveFlankerAI';
import { Battle } from '../mechanics/Battle';
import { Team, TeamType } from '../mechanics/Team';
import { VehiclePosition } from '../mechanics/Vehicle';
import { Card } from '../mechanics/Card';
import { createTestDriver, createTestVehicle } from './__tests__/test-helpers';

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

		// Set vehicle positions
		playerVehicle1.position = VehiclePosition.FRONT;
		playerVehicle2.position = VehiclePosition.BACK;
		enemyVehicle1.position = VehiclePosition.FRONT;
		enemyVehicle2.position = VehiclePosition.BACK;

		// Set vehicle speeds (getTotalSpeed = baseSpeed + driver.vehicleStats.speed)
		// Test vehicles start with baseSpeed 50 and driver speed 50 = 100 total
		// We need vehicle 2 to be below the flanking threshold (60)
		enemyVehicle1.baseSpeed = 20; // Total: 20 + 50 = 70 (above threshold)
		enemyVehicle1.speed = 20;
		enemyVehicle2.baseSpeed = 5; // Total: 5 + 50 = 55 (below threshold of 60)
		enemyVehicle2.speed = 5;

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

	test('should prioritize moving to flanking position', async () => {
		// Start battle to setup hands
		battle.start();

		// Setup hand for the first driver
		const driver = enemyTeam.vehicles[0].driver;
		if (!driver) throw new Error('Driver not found');
		driver.hand = [
			new Card({
				type: 'flanking_maneuver',
				name: 'Flanking Maneuver',
				description: 'Move to flanking position',
				rarity: 'common',
				cost: 2,
				targetType: 'self',
				effects: [{ type: 'move_to_position', value: 2 }],
				tags: ['movement']
			}),
			new Card({
				type: 'power_shot',
				name: 'Power Shot',
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
		expect(decision?.card?.name).toBe('Flanking Maneuver');
	});

	test('should prioritize speed boost when below flanking threshold', async () => {
		// Start battle
		battle.start();

		// Setup low speed vehicle with speed boost card
		const driver = enemyTeam.vehicles[1].driver; // Low speed vehicle
		if (!driver) throw new Error('Driver not found');
		driver.hand = [
			new Card({
				type: 'speed_boost',
				name: 'Speed Boost',
				description: 'Increase speed by 2',
				rarity: 'common',
				cost: 1,
				targetType: 'self',
				effects: [{ type: 'speed', value: 2 }],
				tags: ['buff']
			}),
			new Card({
				type: 'power_shot',
				name: 'Power Shot',
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
		expect(decision?.card?.name).toBe('Speed Boost');
	});

	test('should prefer high damage cards when in flanking position', async () => {
		// Start battle
		battle.start();

		// Put vehicle in flanking position
		enemyTeam.vehicles[0].position = VehiclePosition.FLANKING;
		
		const driver = enemyTeam.vehicles[0].driver;
		if (!driver) throw new Error('Driver not found');
		driver.hand = [
			new Card({
				type: 'power_shot',
				name: 'Power Shot',
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

		// Damage one player vehicle significantly
		playerTeam.vehicles[0].takeDamage(15); // Low health
		playerTeam.vehicles[1].takeDamage(5);  // Higher health

		// Put enemy in flanking position with damage card
		enemyTeam.vehicles[0].position = VehiclePosition.FLANKING;
		const driver = enemyTeam.vehicles[0].driver;
		if (!driver) throw new Error('Driver not found');
		driver.hand = [
			new Card({
				type: 'power_shot',
				name: 'Power Shot',
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
		enemyTeam.vehicles[0].position = VehiclePosition.FRONT;
		
		// Damage enemy vehicle to exactly 20% health
		enemyTeam.vehicles[0].structure = 2; // Direct assignment to ensure exact value
		
		const driver = enemyTeam.vehicles[0].driver;
		if (!driver) throw new Error('Driver not found');
		driver.hand = [
			new Card({
				type: 'repair',
				name: 'Repair',
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