/**
 * @jest-environment jsdom
 */
import { Vehicle, VehicleStatusEffect } from './Vehicle';
import { RoadLane, RoadRow } from './Road';
import { Driver, DriverRole } from './Driver';
import { Deck } from './Deck';

describe('Vehicle', () => {
	let vehicle: Vehicle;
	let driver: Driver;
	let passenger: Driver;

	// Helper to create a test driver
	const createTestDriver = (name: string): Driver => {
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
				ramming: 5,
				gunnery: 5,
				evade: 5,
				speed: 3
			},
			vehicleStats: {
				maxStructure: 30,
				weight: 5,
				armor: 0,
				speed: 2,
				gunnery: 5,
				evade: 5
			},
			startingDeck: {
				cards: []
			},
			deck: new Deck('test', 'Test Deck', []),
			hitpoints: 10,
			maxHitpoints: 10,
			adrenaline: 3,
			maxAdrenaline: 3,
			role: DriverRole.ACTIVE,
			hand: [],
			discard: []
		});
	};

	beforeEach(() => {
		driver = createTestDriver('Test Driver');
		passenger = createTestDriver('Test Passenger');
		
		vehicle = new Vehicle({
			name: 'Test Vehicle',
			structure: 30,
			maxStructure: 30,
			armor: 10,
			maxArmor: 10,
			baseSpeed: 2,
			slot: null,
			flank: null,
			velocity: 0,
			driver: driver,
			passenger: null,
			statusEffects: []
		});
	});

	describe('Speed Calculation', () => {
		test('should calculate total speed as driver speed + base speed', () => {
			// Base speed: 2, Driver speed: 3
			expect(vehicle.speed).toBe(5);
		});

		test('should use only base speed if no driver', () => {
			vehicle.driver = null;
			expect(vehicle.speed).toBe(2); // Just base speed
		});

		test('should apply speed modifiers from status effects', () => {
			const speedBoost: VehicleStatusEffect = {
				name: 'speed_boost',
				duration: 2,
				value: 3,
				description: 'Speed boost'
			};
			vehicle.applyStatusEffect(speedBoost);
			
			expect(vehicle.speed).toBe(8); // 5 + 3
		});

		test('should handle negative speed modifiers', () => {
			const speedReduction: VehicleStatusEffect = {
				name: 'speed_reduction',
				duration: 2,
				value: -4,
				description: 'Speed reduction'
			};
			vehicle.applyStatusEffect(speedReduction);
			
			expect(vehicle.speed).toBe(1); // 5 - 4
		});

		test('should not allow speed to go below 0', () => {
			const heavySpeedReduction: VehicleStatusEffect = {
				name: 'speed_reduction',
				duration: 2,
				value: -10,
				description: 'Heavy speed reduction'
			};
			vehicle.applyStatusEffect(heavySpeedReduction);
			
			expect(vehicle.speed).toBe(0); // Clamped to 0
		});
	});

	describe('Road Slot', () => {
		test('starts off the road until a battle places it', () => {
			expect(vehicle.slot).toBeNull();
			expect(vehicle.isFlanking).toBe(false);
		});

		test('is flanking only on a shoulder', () => {
			vehicle.slot = { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.CENTER };
			expect(vehicle.isFlanking).toBe(false);

			vehicle.slot = { lane: RoadLane.ENEMY_SHOULDER, row: RoadRow.CENTER };
			expect(vehicle.isFlanking).toBe(true);
		});

		test('emits a slot event when it moves', () => {
			const slotSpy = jest.fn();
			vehicle.on('slot', slotSpy);

			const slot = { lane: RoadLane.PLAYER_OUTSIDE, row: RoadRow.AHEAD };
			vehicle.slot = slot;

			expect(slotSpy).toHaveBeenCalledWith(slot, null);
		});
	});

	describe('Status Effects', () => {
		test('should apply vulnerable status', () => {
			const vulnerable: VehicleStatusEffect = {
				name: 'vulnerable',
				duration: 2,
				value: 0,
				description: 'Vehicle is vulnerable'
			};
			
			vehicle.applyStatusEffect(vulnerable);
			
			expect(vehicle.hasStatusEffect('vulnerable')).toBe(true);
			expect(vehicle.statusEffects.length).toBe(1);
		});

		test('should process status effect durations', () => {
			const tempEffect: VehicleStatusEffect = {
				name: 'temp_effect',
				duration: 2,
				value: 0,
				description: 'Temporary effect'
			};
			
			vehicle.applyStatusEffect(tempEffect);
			expect(vehicle.hasStatusEffect('temp_effect')).toBe(true);
			
			// Process turn 1
			vehicle.processStatusEffects();
			expect(vehicle.statusEffects[0].duration).toBe(1);
			
			// Process turn 2
			vehicle.processStatusEffects();
			expect(vehicle.hasStatusEffect('temp_effect')).toBe(false);
		});

		test('should handle permanent status effects (duration -1)', () => {
			const permanentEffect: VehicleStatusEffect = {
				name: 'permanent_speed_loss',
				duration: -1,
				value: -2,
				description: 'Permanent speed reduction'
			};
			
			vehicle.applyStatusEffect(permanentEffect);
			
			// Process multiple turns
			for (let i = 0; i < 10; i++) {
				vehicle.processStatusEffects();
			}
			
			// Should still have the effect
			expect(vehicle.hasStatusEffect('permanent_speed_loss')).toBe(true);
			expect(vehicle.statusEffects[0].duration).toBe(-1);
		});

		test('should stack multiple instances of same status effect', () => {
			const burn1: VehicleStatusEffect = {
				name: 'burn',
				duration: 2,
				value: 3,
				description: 'Burning'
			};
			
			const burn2: VehicleStatusEffect = {
				name: 'burn',
				duration: 3,
				value: 2,
				description: 'Burning'
			};
			
			vehicle.applyStatusEffect(burn1);
			vehicle.applyStatusEffect(burn2);
			
			const burnEffects = vehicle.statusEffects.filter(e => e.name === 'burn');
			expect(burnEffects.length).toBe(2);
		});
	});

	describe('Damage and Armor', () => {
		test('should reduce armor before structure', () => {
			const initialStructure = vehicle.structure;
			
			vehicle.takeDamage(5);
			
			expect(vehicle.armor).toBe(5); // 10 - 5
			expect(vehicle.structure).toBe(initialStructure); // Unchanged
		});

		test('should apply half of remaining damage to structure after armor depleted', () => {
			vehicle.takeDamage(15); // 10 armor + 5 overflow
			
			expect(vehicle.armor).toBe(0);
			expect(vehicle.structure).toBe(27); // 30 - ceil(5 / 2) = 30 - 3 = 27
		});

		test('should apply half of overflow damage to occupants', () => {
			const initialDriverHp = driver.hitpoints;
			
			vehicle.takeDamage(20); // 10 armor + 10 overflow
			
			expect(vehicle.armor).toBe(0);
			expect(vehicle.structure).toBe(25); // 30 - 5
			expect(driver.hitpoints).toBe(initialDriverHp - 5); // Half of 10 overflow
		});

		test('should damage both driver and passenger on overflow', () => {
			vehicle.passenger = passenger;
			const initialDriverHp = driver.hitpoints;
			const initialPassengerHp = passenger.hitpoints;
			
			vehicle.takeDamage(20); // 10 armor + 10 overflow
			
			expect(driver.hitpoints).toBe(initialDriverHp - 5);
			expect(passenger.hitpoints).toBe(initialPassengerHp - 5);
		});

		test('should handle armor overflow healing correctly', () => {
			vehicle.structure = 25; // Damaged
			vehicle.armor = 0;
			
			// Heal more than needed for structure
			vehicle.repair(10, true); // true enables overflow to armor
			
			expect(vehicle.structure).toBe(30); // Max structure
			expect(vehicle.armor).toBe(5); // 5 overflow to armor
		});

		test('should cap armor at max when overflow healing', () => {
			vehicle.structure = 25;
			vehicle.armor = 0;
			
			// Heal way more than needed
			vehicle.repair(20, true); // true enables overflow to armor
			
			expect(vehicle.structure).toBe(30);
			expect(vehicle.armor).toBe(10); // Capped at max
		});
	});

	describe('Driver Management', () => {
		test('should handle driver death with no passenger', () => {
			driver.takeDamage(driver.hitpoints);
			vehicle.handleDriverDeath();

			expect(vehicle.driver).toBeNull();
			expect(vehicle.isUnmanned()).toBe(true);
			expect(vehicle.isOutOfFight).toBe(true);
		});

		test('should leave a living driver at the wheel', () => {
			vehicle.passenger = passenger;

			vehicle.handleDriverDeath();

			expect(vehicle.driver).toBe(driver);
			expect(vehicle.passenger).toBe(passenger);
		});

		test('should promote passenger to driver on driver death', () => {
			vehicle.passenger = passenger;
			passenger.role = DriverRole.PASSENGER;

			driver.takeDamage(driver.hitpoints);
			vehicle.handleDriverDeath();

			expect(vehicle.driver).toBe(passenger);
			expect(vehicle.passenger).toBeNull();
			expect(passenger.role).toBe(DriverRole.ACTIVE);
		});

		test('should not promote a dead passenger', () => {
			vehicle.passenger = passenger;
			driver.takeDamage(driver.hitpoints);
			passenger.takeDamage(passenger.hitpoints);

			vehicle.handleDriverDeath();

			expect(vehicle.driver).toBeNull();
			expect(vehicle.passenger).toBeNull();
		});

		test('should clear a dead passenger and keep the living driver', () => {
			vehicle.passenger = passenger;
			passenger.takeDamage(passenger.hitpoints);

			vehicle.handleDriverDeath();

			expect(vehicle.driver).toBe(driver);
			expect(vehicle.passenger).toBeNull();
		});

		test('should handle a driver killed by damage to the vehicle', () => {
			vehicle.passenger = passenger;
			vehicle.armor = 0;
			driver.hitpoints = 1;

			vehicle.takeDamage(2);

			expect(vehicle.driver).toBe(passenger);
			expect(vehicle.passenger).toBeNull();
		});

		test('should emit driver change events', () => {
			const driverChangeSpy = jest.fn();
			vehicle.on('driverChanged', driverChangeSpy);

			vehicle.passenger = passenger;
			driver.takeDamage(driver.hitpoints);
			vehicle.handleDriverDeath();

			expect(driverChangeSpy).toHaveBeenCalledWith({
				oldDriver: driver,
				newDriver: passenger
			});
		});

		test('should handle adding passenger', () => {
			expect(vehicle.canAddPassenger()).toBe(true);
			
			vehicle.addPassenger(passenger);
			
			expect(vehicle.passenger).toBe(passenger);
			expect(passenger.role).toBe(DriverRole.PASSENGER);
		});

		test('should not allow adding passenger if slot full', () => {
			vehicle.passenger = createTestDriver('Existing Passenger');
			
			expect(vehicle.canAddPassenger()).toBe(false);
			
			const result = vehicle.addPassenger(passenger);
			expect(result).toBe(false);
		});

		test('should not seat a passenger behind a dead driver', () => {
			driver.takeDamage(driver.hitpoints);

			expect(vehicle.canAddPassenger()).toBe(false);
			expect(vehicle.addPassenger(passenger)).toBe(false);
		});

		test('should not seat a passenger in an unmanned vehicle', () => {
			vehicle.driver = null;

			expect(vehicle.canAddPassenger()).toBe(false);
		});
	});

	describe('Vehicle Destruction', () => {
		test('should be destroyed when structure reaches 0', () => {
			vehicle.armor = 0;
			vehicle.takeDamage(60); // 30 structure damage needed
			
			expect(vehicle.isAlive()).toBe(false);
			expect(vehicle.structure).toBe(0);
		});

		test('should emit destruction event', () => {
			const destructionSpy = jest.fn();
			vehicle.on('destroyed', destructionSpy);
			
			vehicle.armor = 0;
			vehicle.takeDamage(60);
			
			expect(destructionSpy).toHaveBeenCalled();
		});
	});

	describe('Flanking Mechanics', () => {
		test('should check if vehicle can flank based on speed', () => {
			const targetVehicle = new Vehicle({
				name: 'Target',
				structure: 20,
				maxStructure: 20,
				armor: 5,
				maxArmor: 5,
				baseSpeed: 1,
				slot: null,
				flank: null,
				velocity: 0,
				driver: createTestDriver('Target Driver'),
				passenger: null,
				statusEffects: []
			});
			
			// Ours is 2 + 3 = 5, the target 1 + 3 = 4
			expect(vehicle.canFlank(targetVehicle)).toBe(true);
		});

		test('should not allow flanking faster vehicles', () => {
			const fasterDriver = createTestDriver('Fast Driver');
			fasterDriver.skills.speed = 5;
			
			const fasterVehicle = new Vehicle({
				name: 'Faster',
				structure: 20,
				maxStructure: 20,
				armor: 5,
				maxArmor: 5,
				baseSpeed: 3,
				slot: null,
				flank: null,
				velocity: 0,
				driver: fasterDriver,
				passenger: null,
				statusEffects: []
			});
			
			expect(vehicle.canFlank(fasterVehicle)).toBe(false);
		});
	});
});