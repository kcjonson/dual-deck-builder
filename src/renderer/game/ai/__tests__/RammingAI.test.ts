import { RammingAI } from '../RammingAI';
import { createTestDriver, createTestVehicle } from './test-helpers';
import { Card } from '../../mechanics/Card';
import { Battle } from '../../mechanics/Battle';
import { Team, TeamType } from '../../mechanics/Team';
import { VehiclePosition } from '../../mechanics/Vehicle';

describe('RammingAI', () => {
	let battle: Battle;
	let playerTeam: Team;
	let enemyTeam: Team;
	let ai: RammingAI;

	beforeEach(() => {
		// Create drivers
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
		ai = new RammingAI(enemyTeam, battle);
	});

	describe('makeDecision', () => {
		it('should prioritize ramming cards over other damage cards', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = enemyVehicle.driver!;

			// Create test cards
			const rammingCard = new Card({
				type: 'ramming_speed',
				name: 'Ramming Speed',
				description: 'Ram an enemy for damage',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', formula: 'armor/10 + speed_diff', scaling: 'ramming' }
				],
				tags: ['ramming', 'attack']
			});

			const gunCard = new Card({
				type: 'gun_attack',
				name: 'Gun Attack',
				description: 'Shoot an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 15 }
				],
				tags: ['ranged', 'attack']
			});

			// Give the AI both cards
			enemyDriver.hand = [gunCard, rammingCard];
			enemyDriver.adrenaline = 5;

			// Make decision
			const decision = await ai.makeDecision();

			expect(decision).not.toBeNull();
			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(rammingCard);
		});

		it('should prioritize speed boosts when below speed threshold', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = enemyVehicle.driver!;

			// Set low speed
			enemyVehicle.speed = 20;

			const speedCard = new Card({
				type: 'nitro_boost',
				name: 'Nitro Boost',
				description: 'Increase speed',
				cost: 1,
				rarity: 'common',
				targetType: 'self',
				effects: [
					{ type: 'speed', value: 30 }
				],
				tags: ['buff']
			});

			const attackCard = new Card({
				type: 'gun_attack',
				name: 'Gun Attack',
				description: 'Shoot an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 10 }
				],
				tags: ['ranged', 'attack']
			});

			enemyDriver.hand = [attackCard, speedCard];
			enemyDriver.adrenaline = 5;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(speedCard);
		});

		it('should prioritize armor cards to protect during rams', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = enemyVehicle.driver!;

			// Set low armor
			enemyVehicle.armor = 0;

			const armorCard = new Card({
				type: 'reinforced_plating',
				name: 'Reinforced Plating',
				description: 'Add armor',
				cost: 1,
				rarity: 'common',
				targetType: 'self',
				effects: [
					{ type: 'armor', value: 20 }
				],
				tags: ['defense']
			});

			const attackCard = new Card({
				type: 'gun_attack',
				name: 'Gun Attack',
				description: 'Shoot an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 10 }
				],
				tags: ['ranged', 'attack']
			});

			enemyDriver.hand = [attackCard, armorCard];
			enemyDriver.adrenaline = 5;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(armorCard);
		});

		it('should prioritize healing when at critical health', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = enemyVehicle.driver!;

			// Set critical health
			enemyVehicle.structure = 10;
			enemyVehicle.maxStructure = 100;

			const healCard = new Card({
				type: 'emergency_repair',
				name: 'Emergency Repair',
				description: 'Heal vehicle',
				cost: 2,
				rarity: 'common',
				targetType: 'self',
				effects: [
					{ type: 'heal', value: 30 }
				],
				tags: ['heal']
			});

			const rammingCard = new Card({
				type: 'ramming_speed',
				name: 'Ramming Speed',
				description: 'Ram an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', formula: 'armor/10 + speed_diff', scaling: 'ramming' }
				],
				tags: ['ramming', 'attack']
			});

			enemyDriver.hand = [rammingCard, healCard];
			enemyDriver.adrenaline = 5;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(healCard);
		});

		it('should prefer front position for ramming', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = enemyVehicle.driver!;

			// Set to back position
			enemyVehicle.position = VehiclePosition.BACK;

			const positionCard = new Card({
				type: 'charge_forward',
				name: 'Charge Forward',
				description: 'Move to front',
				cost: 1,
				rarity: 'common',
				targetType: 'self',
				effects: [
					{ type: 'move_to_position', target: 'front' }
				],
				tags: ['movement']
			});

			const attackCard = new Card({
				type: 'gun_attack',
				name: 'Gun Attack',
				description: 'Shoot an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 10 }
				],
				tags: ['ranged', 'attack']
			});

			enemyDriver.hand = [attackCard, positionCard];
			enemyDriver.adrenaline = 5;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(positionCard);
		});

		it('should target low health enemies with rams for kill bonus', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = enemyVehicle.driver!;

			// Set enemy vehicles with different health
			const playerVehicle1 = battle.playerTeam.vehicles[0];
			const playerVehicle2 = battle.playerTeam.vehicles[1];
			
			playerVehicle1.structure = 100;
			playerVehicle1.maxStructure = 100;
			playerVehicle2.structure = 15; // Low health
			playerVehicle2.maxStructure = 100;

			const rammingCard = new Card({
				type: 'ramming_speed',
				name: 'Ramming Speed',
				description: 'Ram an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 30, scaling: 'ramming' }
				],
				tags: ['ramming', 'attack']
			});

			enemyDriver.hand = [rammingCard];
			enemyDriver.adrenaline = 5;

			// Set up good ramming conditions
			enemyVehicle.speed = 80;
			enemyVehicle.armor = 50;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(rammingCard);
			expect(decision?.target).toBe(playerVehicle2); // Should target low health vehicle
		});

		it('should end turn when no good plays available', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = enemyVehicle.driver!;

			// Give expensive card with no adrenaline
			const expensiveCard = new Card({
				type: 'mega_ram',
				name: 'Mega Ram',
				description: 'Expensive ram',
				cost: 10,
				rarity: 'rare',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 50, scaling: 'ramming' }
				],
				tags: ['ramming', 'attack']
			});

			enemyDriver.hand = [expensiveCard];
			enemyDriver.adrenaline = 2; // Not enough

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('endTurn');
		});

		it('should not play healing cards when at full health', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = enemyVehicle.driver!;

			// Ensure vehicle is at full health
			enemyVehicle.structure = enemyVehicle.maxStructure;
			enemyVehicle.armor = enemyVehicle.maxArmor;

			const healCard = new Card({
				type: 'repair_kit',
				name: 'Repair Kit',
				description: 'Heal vehicle',
				cost: 1,
				rarity: 'common',
				targetType: 'self',
				effects: [
					{ type: 'heal', value: 10 }
				],
				tags: ['heal']
			});

			const attackCard = new Card({
				type: 'gun_attack',
				name: 'Gun Attack',
				description: 'Shoot an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 10 }
				],
				tags: ['ranged', 'attack']
			});

			enemyDriver.hand = [healCard, attackCard];
			enemyDriver.adrenaline = 5;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(attackCard); // Should prefer attack over useless heal
		});

		it('should not play armor cards when at full armor', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = enemyVehicle.driver!;

			// Ensure vehicle is at full armor
			enemyVehicle.armor = enemyVehicle.maxArmor;

			const armorCard = new Card({
				type: 'armor_plating',
				name: 'Armor Plating',
				description: 'Add armor',
				cost: 1,
				rarity: 'common',
				targetType: 'self',
				effects: [
					{ type: 'armor', value: 10 }
				],
				tags: ['defense']
			});

			const attackCard = new Card({
				type: 'gun_attack',
				name: 'Gun Attack',
				description: 'Shoot an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 10 }
				],
				tags: ['ranged', 'attack']
			});

			enemyDriver.hand = [armorCard, attackCard];
			enemyDriver.adrenaline = 5;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(attackCard); // Should prefer attack over useless armor
		});
	});
});