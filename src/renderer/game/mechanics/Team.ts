import { Driver, DriverRole } from './Driver';
import { Vehicle } from './Vehicle';
import { Model } from '../core/Model';
import { TeamType } from './TeamType';

export { TeamType };

/**
 * Team data interface - used throughout the app
 */
export interface TeamData {
	type: TeamType;
	vehicles: Vehicle[];
}

/**
 * Team interface for the class
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Team extends TeamData {}

/**
 * Team class representing a side in battle
 * Player teams start with exactly 2 vehicles, enemy teams can have variable
 * amounts. Wrecks leave the list when Battle clears them off the road.
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
	 * A wrecked vehicle's surviving occupants each jump to another team
	 * vehicle with a free passenger seat, driver first. Anyone with nowhere
	 * to go is left behind and out of the fight. The wreck itself stays on
	 * the road until Battle clears it at the end of the turn.
	 */
	public handleVehicleDestruction(destroyedVehicle: Vehicle): void {
		const occupants = [destroyedVehicle.driver, destroyedVehicle.passenger];
		destroyedVehicle.driver = null;
		destroyedVehicle.passenger = null;
		destroyedVehicle.destroy();

		for (const occupant of occupants) {
			if (occupant?.isAlive()) {
				this.handleDriverEscape(occupant);
			}
		}
	}

	/**
	 * Refill adrenaline for all drivers at start of turn
	 */
	public refillAdrenaline(): void {
		this.getAllDrivers().forEach(driver => driver.refillAdrenaline());
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
	 * Seat a driver as a passenger in the first alive team vehicle with room.
	 * Returns false if there's no room anywhere.
	 */
	public handleDriverEscape(driver: Driver): boolean {
		const availableVehicle = this.vehicles.find(v => v.canAddPassenger());
		return availableVehicle ? availableVehicle.addPassenger(driver) : false;
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