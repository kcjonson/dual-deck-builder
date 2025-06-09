import { Driver } from './Driver';
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
	 * Follows Combat Rules: reduces armor first, then structure and occupants
	 */
	public takeDamage(damage: number): void {
		const armorDamage = Math.min(damage, this.armor);
		this.armor -= armorDamage;
		
		const remainingDamage = damage - armorDamage;
		if (remainingDamage > 0) {
			// Apply half to structure, half to occupants
			const structureDamage = Math.floor(remainingDamage / 2);
			const occupantDamage = remainingDamage - structureDamage;
			
			this.structure = Math.max(0, this.structure - structureDamage);
			
			// Apply damage to driver
			if (this.driver && occupantDamage > 0) {
				this.driver.takeDamage(occupantDamage);
			}
			
			// Apply damage to passenger if driver is dead
			if (this.passenger && occupantDamage > 0 && (!this.driver || !this.driver.isAlive())) {
				this.passenger.takeDamage(occupantDamage);
			}
		}
	}

	/**
	 * Repair vehicle structure
	 */
	public repair(amount: number): void {
		this.structure = Math.min(this.maxStructure, this.structure + amount);
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
		// Remove existing effect with same name
		this.statusEffects = this.statusEffects.filter(e => e.name !== effect.name);
		// Add new effect
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
			// Reduce duration
			effect.duration--;
			
			// Apply any ongoing effects
			switch (effect.name) {
				case 'oil_slick':
					// Speed reduction already applied in updateSpeedFromEffects
					break;
				case 'caltrops':
					// Speed reduction already applied in updateSpeedFromEffects
					if (effect.duration === 0) {
						// Apply structure damage when effect ends
						this.structure = Math.max(0, this.structure - 2);
					}
					break;
			}
			
			// Keep if not expired
			if (effect.duration > 0) {
				updatedEffects.push(effect);
			}
		});

		// Update effects array
		this.statusEffects = updatedEffects;
		this.updateSpeedFromEffects();
	}

	/**
	 * Update speed based on status effects
	 */
	private updateSpeedFromEffects(): void {
		let speedModifier = 0;
		
		this.statusEffects.forEach(effect => {
			switch (effect.name) {
				case 'oil_slick':
					speedModifier -= 4;
					break;
				case 'caltrops':
					speedModifier -= 2;
					break;
			}
		});

		this.speed = Math.max(1, this.baseSpeed + speedModifier);
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