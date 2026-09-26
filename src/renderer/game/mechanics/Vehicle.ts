import { Driver, DriverRole, DriverSkills } from './Driver';
import { Model } from '../core/Model';
import { RoadSlot, isShoulder } from './Road';
import type { IntentTier } from './Intent';
import type { EscortProfile } from './Escort';

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
 * A flanker's bookkeeping: the formation slot it left, which stays empty and
 * reserved, and the vehicle it outran, whose speed it has to keep beating.
 * An ambusher (a vehicle its encounter started on the shoulder) has no
 * reserved slot, so it never drops back, and no outran vehicle until it
 * swerves again by outrunning one.
 */
export interface FlankState {
	reservedSlot: RoadSlot | null;
	outran: Vehicle | null;
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
	/** Null until a Battle places the vehicle on the road. */
	slot: RoadSlot | null;
	flank: FlankState | null;
	velocity: number;
	driver: Driver | null;
	passenger: Driver | null;
	statusEffects: VehicleStatusEffect[];
	/** How much of this vehicle's plan the player sees when it's a raider. Unset means basic. */
	intentTier?: IntentTier;
	/** Set on an escort, which has no driver by design. Unset means a driven vehicle. */
	escort?: EscortProfile | null;
}

/**
 * Speed a status adds or takes away. Oil Slick and Caltrops carry their own
 * values; these defaults cover statuses applied without one.
 */
export function statusSpeedModifier(effect: VehicleStatusEffect): number {
	switch (effect.name) {
		case 'oil_slick':
		case 'speed_reduction':
			return effect.value || -4;
		case 'caltrops':
			return effect.value || -2;
		case 'speed_boost':
		case 'nitro_boost':
			return effect.value || 3;
		default:
			return 0;
	}
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
		'slot',
		'flank',
		'velocity',
		'driver',
		'passenger',
		'statusEffects',
		'intentTier',
		'escort'
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

	/**
	 * An undriven vehicle in the convoy, acting only when ordered
	 */
	public get isEscort(): boolean {
		return Boolean(this.escort);
	}

	/**
	 * On the other team's shoulder. Slots are only ever changed by Battle,
	 * which keeps shoulders to flankers.
	 */
	public get isFlanking(): boolean {
		return this.slot !== null && isShoulder(this.slot.lane);
	}

	/**
	 * Started the fight on the shoulder, so it has no formation slot to drop
	 * back to and holds the shoulder for the rest of the fight.
	 */
	public get isAmbusher(): boolean {
		return this.flank !== null && this.flank.reservedSlot === null;
	}

	/**
	 * Armor soaks damage first. Past armor, damage splits half to structure
	 * and half to each living occupant; with nobody aboard (an empty escort)
	 * it all goes to structure.
	 */
	public takeDamage(damage: number): void {
		const armorDamage = Math.min(damage, this.armor);
		this.armor -= armorDamage;

		const remainingDamage = damage - armorDamage;
		if (remainingDamage > 0) {
			const occupants = [this.driver, this.passenger]
				.filter((occupant): occupant is Driver => occupant?.isAlive() ?? false);
			const halfDamage = Math.ceil(remainingDamage / 2);
			const structureDamage = occupants.length > 0 ? halfDamage : remainingDamage;
			this.structure = Math.max(0, this.structure - structureDamage);
			occupants.forEach(occupant => occupant.takeDamage(halfDamage));

			this.handleDriverDeath();
		}

		if (!this.isAlive()) {
			this.emit('destroyed', this);
		}
	}

	/**
	 * The skills a hit check reads for this vehicle. An escort's are its
	 * own, whoever rides in it or orders it. A driven vehicle's are the
	 * acting driver's: whoever plays the card when it attacks, the driver at
	 * the wheel when it's attacked. Null with nobody to act.
	 */
	public crewSkills(actor: Driver | null = this.driver): DriverSkills | null {
		return this.escort ?? actor?.skills ?? null;
	}

	/**
	 * Who a driver-only attack (Headshot) hits: the driver, or on an escort
	 * the passenger riding in it. Null on an empty escort, which makes it an
	 * illegal target for those cards.
	 */
	public get driverOnlyTarget(): Driver | null {
		return this.driver ?? (this.isEscort ? this.passenger : null);
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
		const speedModifier = this.statusEffects.reduce((sum, effect) => sum + statusSpeedModifier(effect), 0);

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
		
		totalSpeed += this.statusEffects.reduce((sum, effect) => sum + statusSpeedModifier(effect), 0);

		return Math.max(0, totalSpeed);
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
	 * A driven vehicle with nobody alive at the wheel. A dead driver's living
	 * passenger takes over, so this also means nobody alive aboard. An escort
	 * has no driver by design and is never unmanned.
	 */
	public isUnmanned(): boolean {
		return !this.isEscort && !this.driver?.isAlive();
	}

	/**
	 * Wrecked, or unmanned. Until a driverless player vehicle can become an
	 * escort (DDB-152) an unmanned vehicle doesn't act, can't be targeted,
	 * and leaves the road at the end of the turn, like a wreck. An escort is
	 * in the fight while it has structure.
	 */
	public get isOutOfFight(): boolean {
		return !this.isAlive() || this.isUnmanned();
	}

	/**
	 * A free passenger seat behind a living driver. Escorts have a seat by
	 * the rules, but riding in one waits on DDB-152.
	 */
	public canAddPassenger(): boolean {
		return this.passenger === null && !this.isEscort && !this.isOutOfFight;
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
	 * Take anyone who has died out of their seat. A dead driver's living
	 * passenger takes the wheel; with no living passenger the vehicle is left
	 * unmanned. Runs wherever driver damage lands.
	 */
	public handleDriverDeath(): void {
		if (this.passenger && !this.passenger.isAlive()) {
			this.passenger = null;
		}
		if (!this.driver || this.driver.isAlive()) {
			return;
		}

		const oldDriver = this.driver;
		const newDriver = this.passenger;
		this.set({ driver: newDriver, passenger: null });
		if (newDriver) {
			newDriver.role = DriverRole.ACTIVE;
		}
		this.emit('driverChanged', { oldDriver, newDriver });
	}

	/**
	 * Handle vehicle destruction
	 * Driver jumps to remaining vehicle as passenger (handled by combat system)
	 */
	public destroy(): void {
		this.structure = 0;
		this.armor = 0;
	}

	// All properties are directly accessible:
	// this.armor, this.maxArmor, this.structure, this.slot, etc.
}