import { Driver, DriverRole } from './Driver';
import { Vehicle } from './Vehicle';
import { Model } from '../core/Model';

/**
 * Team type (player or AI controlled)
 */
export enum TeamType {
	PLAYER = 'player',
	ENEMY = 'enemy'
}

/**
 * Team data interface - used throughout the app
 */
export interface TeamData {
	type: TeamType;
	vehicles: Vehicle[];
}

/**
 * Team interface that merges with the class
 */
export interface Team extends TeamData {}

/**
 * Team class representing a side in battle
 * Player teams have exactly 2 vehicles, enemy teams can have variable amounts
 * Drivers manage their own hands/cards individually
 */
export class Team extends Model<TeamData> {
	// Runtime property list - MUST match TeamData interface
	static properties = new Set<keyof TeamData>([
		'type',
		'vehicles'
	]);

	/**
	 * Create a new team
	 */
	constructor(initialData: TeamData) {
		super(initialData);

		// Validate player team has exactly 2 vehicles
		if (initialData.type === TeamType.PLAYER && initialData.vehicles.length !== 2) {
			throw new Error('Player teams must have exactly 2 vehicles');
		}
	}

	// Model properties are automatically available as:
	// team.type, team.vehicles

	/**
	 * Get all alive vehicles
	 */
	public getAliveVehicles(): Vehicle[] {
		return this.vehicles.filter(vehicle => vehicle.isAlive());
	}

	/**
	 * Get all drivers (from all vehicles)
	 */
	public getAllDrivers(): Driver[] {
		const drivers: Driver[] = [];
		
		this.vehicles.forEach(vehicle => {
			const driver = vehicle.driver;
			const passenger = vehicle.passenger;
			
			if (driver) drivers.push(driver);
			if (passenger) drivers.push(passenger);
		});
		
		return drivers;
	}

	/**
	 * Get all alive drivers
	 */
	public getAliveDrivers(): Driver[] {
		return this.getAllDrivers().filter(driver => driver.isAlive());
	}

	/**
	 * Check if team is defeated (all drivers dead)
	 */
	public isDefeated(): boolean {
		return this.getAliveDrivers().length === 0;
	}

	/**
	 * Add vehicle to team
	 */
	public addVehicle(vehicle: Vehicle): void {
		// Prevent player teams from having more than 2 vehicles
		if (this.type === TeamType.PLAYER && this.vehicles.length >= 2) {
			throw new Error('Player teams cannot have more than 2 vehicles');
		}
		
		// Create new array to trigger change event
		this.vehicles = [...this.vehicles, vehicle];
	}

	/**
	 * Remove vehicle from team
	 */
	public removeVehicle(vehicle: Vehicle): boolean {
		const index = this.vehicles.indexOf(vehicle);
		if (index !== -1) {
			// Create new array to trigger change event
			this.vehicles = this.vehicles.filter(v => v !== vehicle);
			return true;
		}
		return false;
	}

	/**
	 * Handle vehicle destruction - driver becomes passenger in another vehicle
	 */
	public handleVehicleDestruction(destroyedVehicle: Vehicle): void {
		const destroyedDriver = destroyedVehicle.driver;
		const destroyedPassenger = destroyedVehicle.passenger;
		const survivingVehicles = this.getAliveVehicles().filter(v => v !== destroyedVehicle);

		// Handle the driver
		if (destroyedDriver && destroyedDriver.isAlive() && survivingVehicles.length > 0) {
			// Find a vehicle without a passenger
			const targetVehicle = survivingVehicles.find(v => !v.passenger);
			
			if (targetVehicle) {
				targetVehicle.passenger = destroyedDriver;
				destroyedDriver.role = DriverRole.PASSENGER;
			}
		}

		// Handle the passenger (if there was one)
		if (destroyedPassenger && destroyedPassenger.isAlive() && survivingVehicles.length > 0) {
			// Find another vehicle without a passenger
			const targetVehicle = survivingVehicles.find(v => !v.passenger && v.driver !== destroyedDriver);
			
			if (targetVehicle) {
				targetVehicle.passenger = destroyedPassenger;
				destroyedPassenger.role = DriverRole.PASSENGER;
			}
		}

		// Clear the destroyed vehicle's occupants
		destroyedVehicle.driver = null;
		destroyedVehicle.passenger = null;
		destroyedVehicle.destroy();
	}

	/**
	 * Refill adrenaline for all drivers at start of turn
	 */
	public refillAdrenaline(): void {
		this.getAllDrivers().forEach(driver => driver.refillAdrenaline());
	}

	/**
	 * Draw cards for all drivers at start of turn
	 */
	public drawCardsForAllDrivers(count: number): void {
		this.getAllDrivers().forEach(driver => driver.drawCards(count));
	}

	/**
	 * Discard hands for all drivers at end of turn
	 */
	public discardAllHands(): void {
		this.getAllDrivers().forEach(driver => driver.discardHand());
	}

	/**
	 * Calculate team's initiative for turn order
	 */
	public calculateInitiative(): number {
		const aliveVehicles = this.getAliveVehicles();
		if (aliveVehicles.length === 0) return 0;

		// Use the fastest vehicle's velocity for turn order
		return Math.max(...aliveVehicles.map(vehicle => vehicle.velocity));
	}

	/**
	 * Set initiative based on team type (players always go first)
	 */
	public setInitiative(): void {
		const baseInitiative = this.type === TeamType.PLAYER ? 100 : 0;
		
		this.vehicles.forEach(vehicle => {
			if (vehicle.isAlive()) {
				// Players always go first, enemies go second
				vehicle.velocity = baseInitiative;
			}
		});
	}

	/**
	 * Process status effects for all vehicles
	 */
	public processStatusEffects(): void {
		this.vehicles.forEach(vehicle => vehicle.processStatusEffects());
	}

	/**
	 * Get team combat statistics for display
	 */
	public getCombatStats(): {
		type: TeamType;
		vehicles: Array<{
			name: string;
			armor: number;
			maxArmor: number;
			structure: number;
			maxStructure: number;
			speed: number;
			velocity: number;
			alive: boolean;
			driver: {
				name: string;
				hitpoints: number;
				maxHitpoints: number;
				adrenaline: number;
				maxAdrenaline: number;
				role: DriverRole;
				alive: boolean;
				handSize: number;
				discardSize: number;
			} | null;
			passenger: {
				name: string;
				hitpoints: number;
				maxHitpoints: number;
				adrenaline: number;
				maxAdrenaline: number;
				role: DriverRole;
				alive: boolean;
				handSize: number;
				discardSize: number;
			} | null;
		}>;
		isDefeated: boolean;
	} {
		return {
			type: this.type,
			vehicles: this.vehicles.map(vehicle => {
				const driver = vehicle.driver;
				const passenger = vehicle.passenger;
				
				return {
					name: vehicle.name,
					armor: vehicle.armor,
					maxArmor: vehicle.maxArmor,
					structure: vehicle.structure,
					maxStructure: vehicle.maxStructure,
					speed: vehicle.speed,
					velocity: vehicle.velocity,
					alive: vehicle.isAlive(),
					driver: driver ? {
						name: driver.metadata.name,
						hitpoints: driver.hitpoints,
						maxHitpoints: driver.maxHitpoints,
						adrenaline: driver.adrenaline,
						maxAdrenaline: driver.maxAdrenaline,
						role: driver.role,
						alive: driver.isAlive(),
						handSize: driver.hand.length,
						discardSize: driver.discard.length
					} : null,
					passenger: passenger ? {
						name: passenger.metadata.name,
						hitpoints: passenger.hitpoints,
						maxHitpoints: passenger.maxHitpoints,
						adrenaline: passenger.adrenaline,
						maxAdrenaline: passenger.maxAdrenaline,
						role: passenger.role,
						alive: passenger.isAlive(),
						handSize: passenger.hand.length,
						discardSize: passenger.discard.length
					} : null
				};
			}),
			isDefeated: this.isDefeated()
		};
	}
}