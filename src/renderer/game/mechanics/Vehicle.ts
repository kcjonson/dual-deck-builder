import { Driver } from './Driver';

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
 * Vehicle class representing a combat vehicle
 * Based on Combat Rules specification
 */
export class Vehicle {
	private id: string;
	private name: string;
	private armor: number;
	private maxArmor: number;
	private structure: number;
	private maxStructure: number;
	private speed: number;
	private baseSpeed: number;
	private driver: Driver | null = null;
	private passenger: Driver | null = null;
	private position: VehiclePosition = VehiclePosition.BACK;
	private statusEffects: Map<string, VehicleStatusEffect> = new Map();
	private velocity = 0; // Calculated each turn

	/**
	 * Create a new vehicle
	 */
	constructor({
		id,
		name,
		armor,
		structure,
		speed
	}: {
		id: string;
		name: string;
		armor: number;
		structure: number;
		speed: number;
	}) {
		this.id = id;
		this.name = name;
		this.armor = armor;
		this.maxArmor = armor;
		this.structure = structure;
		this.maxStructure = structure;
		this.speed = speed;
		this.baseSpeed = speed;
	}

	/**
	 * Get vehicle ID
	 */
	public getId(): string {
		return this.id;
	}

	/**
	 * Get vehicle name
	 */
	public getName(): string {
		return this.name;
	}

	/**
	 * Get current armor
	 */
	public getArmor(): number {
		return this.armor;
	}

	/**
	 * Get maximum armor
	 */
	public getMaxArmor(): number {
		return this.maxArmor;
	}

	/**
	 * Get current structure (health)
	 */
	public getStructure(): number {
		return this.structure;
	}

	/**
	 * Get maximum structure
	 */
	public getMaxStructure(): number {
		return this.maxStructure;
	}

	/**
	 * Get current speed (may be modified by effects)
	 */
	public getSpeed(): number {
		return this.speed;
	}

	/**
	 * Get base speed (unmodified)
	 */
	public getBaseSpeed(): number {
		return this.baseSpeed;
	}

	/**
	 * Get current velocity (calculated for turn order)
	 */
	public getVelocity(): number {
		return this.velocity;
	}

	/**
	 * Set velocity for this turn
	 */
	public setVelocity(velocity: number): void {
		this.velocity = velocity;
	}

	/**
	 * Check if vehicle is alive (structure > 0)
	 */
	public isAlive(): boolean {
		return this.structure > 0;
	}

	/**
	 * Get the driver of this vehicle
	 */
	public getDriver(): Driver | null {
		return this.driver;
	}

	/**
	 * Get the passenger of this vehicle
	 */
	public getPassenger(): Driver | null {
		return this.passenger;
	}

	/**
	 * Set the driver of this vehicle
	 */
	public setDriver(driver: Driver | null): void {
		this.driver = driver;
	}

	/**
	 * Set the passenger of this vehicle
	 */
	public setPassenger(passenger: Driver | null): void {
		this.passenger = passenger;
	}

	/**
	 * Get vehicle position
	 */
	public getPosition(): VehiclePosition {
		return this.position;
	}

	/**
	 * Set vehicle position
	 */
	public setPosition(position: VehiclePosition): void {
		this.position = position;
	}

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
		this.statusEffects.set(effect.name, { ...effect });
		this.updateSpeedFromEffects();
	}

	/**
	 * Remove a status effect
	 */
	public removeStatusEffect(effectName: string): void {
		this.statusEffects.delete(effectName);
		this.updateSpeedFromEffects();
	}

	/**
	 * Get all status effects
	 */
	public getStatusEffects(): Map<string, VehicleStatusEffect> {
		return new Map(this.statusEffects);
	}

	/**
	 * Process status effects at turn start
	 */
	public processStatusEffects(): void {
		const effectsToRemove: string[] = [];

		this.statusEffects.forEach((effect, name) => {
			// Reduce duration
			effect.duration--;
			
			// Apply any ongoing effects
			switch (name) {
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
			
			// Mark for removal if expired
			if (effect.duration <= 0) {
				effectsToRemove.push(name);
			}
		});

		// Remove expired effects
		effectsToRemove.forEach(name => this.removeStatusEffect(name));
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
			id: this.id,
			name: this.name,
			armor: this.maxArmor,
			structure: this.maxStructure,
			speed: this.baseSpeed
		});
		
		// Copy current state
		newVehicle.armor = this.armor;
		newVehicle.structure = this.structure;
		newVehicle.speed = this.speed;
		newVehicle.position = this.position;
		newVehicle.velocity = this.velocity;
		
		// Copy status effects
		this.statusEffects.forEach((effect, name) => {
			newVehicle.statusEffects.set(name, { ...effect });
		});
		
		return newVehicle;
	}

	/**
	 * Get vehicle stats for display
	 */
	public getDisplayStats(): {
		armor: number;
		maxArmor: number;
		structure: number;
		maxStructure: number;
		speed: number;
		velocity: number;
		position: VehiclePosition;
		driver: string | null;
		passenger: string | null;
		statusEffects: VehicleStatusEffect[];
	} {
		return {
			armor: this.armor,
			maxArmor: this.maxArmor,
			structure: this.structure,
			maxStructure: this.maxStructure,
			speed: this.speed,
			velocity: this.velocity,
			position: this.position,
			driver: this.driver?.getName() || null,
			passenger: this.passenger?.getName() || null,
			statusEffects: Array.from(this.statusEffects.values())
		};
	}
}