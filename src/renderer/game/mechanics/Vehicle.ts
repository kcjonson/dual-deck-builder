import { Driver, DriverRole } from './Driver';
import { Model } from '../core/Model';

/**
 * Vehicle position in combat
 */
export enum VehiclePosition {
	FRONT = 'front',
	BACK = 'back',
	FLANKING = 'flanking'
}

/**
 * Vehicle status effects
 */
export interface VehicleStatusEffect {
	name: string;
	duration: number;
	value?: number;
	description?: string;
}

/**
 * Vehicle data interface - used throughout the app
 */
export interface VehicleData {
	name: string;
	armor: number;
	maxArmor: number;
	structure: number;
	maxStructure: number;
	speed: number;
	baseSpeed: number;
	position: VehiclePosition;
	velocity: number;
	driver: Driver | null;
	passenger: Driver | null;
	statusEffects: VehicleStatusEffect[];
}

// VehicleState is now the same as VehicleData
export type VehicleState = VehicleData;

/**
 * Vehicle interface for the class
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Vehicle extends VehicleData {}

/**
 * Vehicle class representing a combat vehicle
 * Based on Combat Rules specification
 */
export class Vehicle extends Model<VehicleData> {
	// Runtime property list - MUST match VehicleData interface
	static properties = new Set<keyof VehicleData>([
		'name',
		'armor',
		'maxArmor',
		'structure',
		'maxStructure',
		'speed',
		'baseSpeed',
		'position',
		'velocity',
		'driver',
		'passenger',
		'statusEffects'
	]);

	// All properties are now model properties!

	/**
	 * Create a new vehicle
	 */
	constructor(initialData: VehicleData) {
		super(initialData);
	}

	// Model properties are automatically available as:
	// this.name, this.armor, this.structure, etc.
	// They emit 'change' events when modified

	/**
	 * Check if vehicle is alive (structure > 0)
	 */
	public isAlive(): boolean {
		return this.structure > 0;
	}

	// Model properties are automatically available as:
	// this.driver, this.passenger, this.position, etc.

	/**
	 * Take damage to the vehicle
	 * Follows Combat Rules: reduces armor first, then applies half of remaining to structure and occupants
	 */
	public takeDamage(damage: number): void {
		// First, reduce armor
		const armorDamage = Math.min(damage, this.armor);
		this.armor -= armorDamage;
		
		const remainingDamage = damage - armorDamage;
		if (remainingDamage > 0) {
			// Apply half of remaining damage to structure
			const structureDamage = Math.ceil(remainingDamage / 2);
			this.structure = Math.max(0, this.structure - structureDamage);
			
			// Apply half of remaining damage to ALL occupants
			const occupantDamage = Math.ceil(remainingDamage / 2);
			
			// Damage driver
			if (this.driver && this.driver.isAlive()) {
				this.driver.takeDamage(occupantDamage);
			}
			
			// Damage passenger
			if (this.passenger && this.passenger.isAlive()) {
				this.passenger.takeDamage(occupantDamage);
			}
		}
		
		// Check if vehicle is destroyed
		if (!this.isAlive()) {
			this.emit('destroyed', this);
		}
	}

	/**
	 * Repair vehicle structure
	 */
	public repair(amount: number, overflowToArmor = false): void {
		const oldStructure = this.structure;
		this.structure = Math.min(this.maxStructure, this.structure + amount);
		
		if (overflowToArmor) {
			const actualHealing = this.structure - oldStructure;
			const overflow = amount - actualHealing;
			
			if (overflow > 0) {
				this.addArmor(overflow);
			}
		}
	}

	/**
	 * Add armor to vehicle
	 */
	public addArmor(amount: number): void {
		this.armor = Math.min(this.maxArmor, this.armor + amount);
	}

	/**
	 * Apply a status effect
	 */
	public applyStatusEffect(effect: VehicleStatusEffect): void {
		// Add new effect (allow stacking)
		this.statusEffects = [...this.statusEffects, { ...effect }];
		this.updateSpeedFromEffects();
	}

	/**
	 * Remove a status effect
	 */
	public removeStatusEffect(effectName: string): void {
		this.statusEffects = this.statusEffects.filter(e => e.name !== effectName);
		this.updateSpeedFromEffects();
	}

	// statusEffects is a model property - access it directly with this.statusEffects

	/**
	 * Process status effects at turn start
	 */
	public processStatusEffects(): void {
		const updatedEffects: VehicleStatusEffect[] = [];

		this.statusEffects.forEach(effect => {
			// Don't reduce duration for permanent effects
			if (effect.duration !== -1) {
				effect.duration--;
			}
			
			// Apply any ongoing effects
			switch (effect.name) {
				case 'oil_slick':
				case 'speed_reduction':
				case 'speed_boost':
					// Speed modifications already applied in updateSpeedFromEffects
					break;
				case 'caltrops':
					// Speed reduction already applied in updateSpeedFromEffects
					// Caltrops are permanent, no ongoing damage
					break;
				case 'vulnerable':
					// Just a status, no ongoing effect
					break;
			}
			
			// Keep if not expired (duration > 0 or permanent -1)
			if (effect.duration > 0 || effect.duration === -1) {
				updatedEffects.push(effect);
			}
		});

		// Update effects array
		this.statusEffects = updatedEffects;
		this.updateSpeedFromEffects();
	}

	/**
	 * Update speed based on status effects
	 * This is kept for Model compatibility but getTotalSpeed() handles the actual calculation
	 */
	private updateSpeedFromEffects(): void {
		// Speed property represents base speed with modifiers (without driver)
		// getTotalSpeed() adds the driver speed
		let speedModifier = 0;
		
		this.statusEffects.forEach(effect => {
			switch (effect.name) {
				case 'oil_slick':
				case 'speed_reduction':
					speedModifier += (effect.value || -4);
					break;
				case 'caltrops':
					speedModifier += (effect.value || -2);
					break;
				case 'speed_boost':
				case 'nitro_boost':
					speedModifier += (effect.value || 3);
					break;
			}
		});

		this.speed = Math.max(0, this.baseSpeed + speedModifier);
	}

	/**
	 * Get total speed (driver speed + vehicle base speed + modifiers)
	 */
	public getTotalSpeed(): number {
		// Start with base speed
		let totalSpeed = this.baseSpeed;
		
		// Add driver speed
		if (this.driver) {
			totalSpeed += this.driver.vehicleStats.speed;
		}
		
		// Apply status effect modifiers
		let speedModifier = 0;
		this.statusEffects.forEach(effect => {
			switch (effect.name) {
				case 'oil_slick':
				case 'speed_reduction':
					speedModifier += (effect.value || -4);
					break;
				case 'caltrops':
					speedModifier += (effect.value || -2);
					break;
				case 'speed_boost':
				case 'nitro_boost':
					speedModifier += (effect.value || 3);
					break;
			}
		});
		
		totalSpeed += speedModifier;
		
		return Math.max(0, totalSpeed);
	}

	/**
	 * Change vehicle position
	 */
	public changePosition(newPosition: VehiclePosition): void {
		const oldPosition = this.position;
		this.position = newPosition;
		this.emit('positionChanged', { oldPosition, newPosition });
	}

	/**
	 * Check if vehicle has a specific status effect
	 */
	public hasStatusEffect(effectName: string): boolean {
		return this.statusEffects.some(e => e.name === effectName);
	}

	/**
	 * Check if this vehicle can flank the target
	 */
	public canFlank(target: Vehicle): boolean {
		return this.getTotalSpeed() > target.getTotalSpeed();
	}

	/**
	 * Check if vehicle should lose flanking position
	 */
	public shouldLoseFlanking(minFlankingSpeed = 3): boolean {
		return this.position === VehiclePosition.FLANKING && 
			   this.getTotalSpeed() < minFlankingSpeed;
	}

	/**
	 * Check if vehicle is unmanned
	 */
	public isUnmanned(): boolean {
		return this.driver === null;
	}

	/**
	 * Check if vehicle can add a passenger
	 */
	public canAddPassenger(): boolean {
		return this.passenger === null && this.isAlive();
	}

	/**
	 * Add a passenger to the vehicle
	 */
	public addPassenger(driver: Driver): boolean {
		if (!this.canAddPassenger()) {
			return false;
		}
		
		this.passenger = driver;
		driver.role = DriverRole.PASSENGER;
		return true;
	}

	/**
	 * Handle driver death - promote passenger if available
	 */
	public handleDriverDeath(): void {
		const oldDriver = this.driver;
		
		if (this.passenger) {
			// Promote passenger to driver
			this.driver = this.passenger;
			this.passenger = null;
			this.driver.role = DriverRole.ACTIVE;
			this.emit('driverChanged', { oldDriver, newDriver: this.driver });
		} else {
			// Vehicle becomes unmanned
			this.driver = null;
			this.emit('driverChanged', { oldDriver, newDriver: null });
		}
	}

	/**
	 * Handle vehicle destruction
	 * Driver jumps to remaining vehicle as passenger (handled by combat system)
	 */
	public destroy(): void {
		this.structure = 0;
		this.armor = 0;
	}

	/**
	 * Create a copy of this vehicle
	 */
	public copy(): Vehicle {
		const newVehicle = new Vehicle({
			name: this.name,
			armor: this.armor,
			maxArmor: this.maxArmor,
			structure: this.structure,
			maxStructure: this.maxStructure,
			speed: this.speed,
			baseSpeed: this.baseSpeed,
			position: this.position,
			velocity: this.velocity,
			driver: null,
			passenger: null,
			statusEffects: this.statusEffects.map(effect => ({ ...effect }))
		});
		
		return newVehicle;
	}

	// All properties are directly accessible:
	// this.armor, this.maxArmor, this.structure, this.position, etc.
}