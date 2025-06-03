import { Driver, DriverRole } from './Driver';
import { Vehicle } from './Vehicle';

/**
 * Team type (player or AI controlled)
 */
export enum TeamType {
	PLAYER = 'player',
	ENEMY = 'enemy'
}

/**
 * Team class representing a side in battle
 * Player teams have exactly 2 vehicles, enemy teams can have variable amounts
 * Drivers manage their own hands/cards individually
 */
export class Team {
	private id: string;
	private type: TeamType;
	private vehicles: Vehicle[] = [];

	/**
	 * Create a new team
	 */
	constructor({
		id,
		type,
		vehicles = []
	}: {
		id: string;
		type: TeamType;
		vehicles?: Vehicle[];
	}) {
		this.id = id;
		this.type = type;
		this.vehicles = [...vehicles];

		// Validate player team has exactly 2 vehicles
		if (type === TeamType.PLAYER && vehicles.length !== 2) {
			throw new Error('Player teams must have exactly 2 vehicles');
		}
	}

	/**
	 * Get team ID
	 */
	public getId(): string {
		return this.id;
	}

	/**
	 * Get team type
	 */
	public getType(): TeamType {
		return this.type;
	}

	/**
	 * Get all vehicles
	 */
	public getVehicles(): Vehicle[] {
		return [...this.vehicles];
	}

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
			const driver = vehicle.getDriver();
			const passenger = vehicle.getPassenger();
			
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
		
		this.vehicles.push(vehicle);
	}

	/**
	 * Remove vehicle from team
	 */
	public removeVehicle(vehicleId: string): Vehicle | null {
		const index = this.vehicles.findIndex(v => v.getId() === vehicleId);
		if (index !== -1) {
			return this.vehicles.splice(index, 1)[0];
		}
		return null;
	}

	/**
	 * Handle vehicle destruction - driver becomes passenger in another vehicle
	 */
	public handleVehicleDestruction(destroyedVehicle: Vehicle): void {
		const destroyedDriver = destroyedVehicle.getDriver();
		const destroyedPassenger = destroyedVehicle.getPassenger();
		const survivingVehicles = this.getAliveVehicles().filter(v => v.getId() !== destroyedVehicle.getId());

		// Handle the driver
		if (destroyedDriver && destroyedDriver.isAlive() && survivingVehicles.length > 0) {
			// Find a vehicle without a passenger
			const targetVehicle = survivingVehicles.find(v => !v.getPassenger());
			
			if (targetVehicle) {
				targetVehicle.setPassenger(destroyedDriver);
				destroyedDriver.setRole(DriverRole.PASSENGER);
			}
		}

		// Handle the passenger (if there was one)
		if (destroyedPassenger && destroyedPassenger.isAlive() && survivingVehicles.length > 0) {
			// Find another vehicle without a passenger
			const targetVehicle = survivingVehicles.find(v => !v.getPassenger() && v.getDriver() !== destroyedDriver);
			
			if (targetVehicle) {
				targetVehicle.setPassenger(destroyedPassenger);
				destroyedPassenger.setRole(DriverRole.PASSENGER);
			}
		}

		// Clear the destroyed vehicle's occupants
		destroyedVehicle.setDriver(null);
		destroyedVehicle.setPassenger(null);
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
		return Math.max(...aliveVehicles.map(vehicle => vehicle.getVelocity()));
	}

	/**
	 * Set initiative based on team type (players always go first)
	 */
	public setInitiative(): void {
		const baseInitiative = this.type === TeamType.PLAYER ? 100 : 0;
		
		this.vehicles.forEach(vehicle => {
			if (vehicle.isAlive()) {
				// Players always go first, enemies go second
				vehicle.setVelocity(baseInitiative);
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
		teamId: string;
		type: TeamType;
		vehicles: Array<{
			id: string;
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
			teamId: this.id,
			type: this.type,
			vehicles: this.vehicles.map(vehicle => {
				const driver = vehicle.getDriver();
				const passenger = vehicle.getPassenger();
				
				return {
					id: vehicle.getId(),
					name: vehicle.getName(),
					armor: vehicle.getArmor(),
					maxArmor: vehicle.getMaxArmor(),
					structure: vehicle.getStructure(),
					maxStructure: vehicle.getMaxStructure(),
					speed: vehicle.getSpeed(),
					velocity: vehicle.getVelocity(),
					alive: vehicle.isAlive(),
					driver: driver ? {
						name: driver.getName(),
						hitpoints: driver.getHitpoints(),
						maxHitpoints: driver.getMaxHitpoints(),
						adrenaline: driver.getAdrenaline(),
						maxAdrenaline: driver.getMaxAdrenaline(),
						role: driver.getRole(),
						alive: driver.isAlive(),
						handSize: driver.getHand().length,
						discardSize: driver.getDiscardPile().length
					} : null,
					passenger: passenger ? {
						name: passenger.getName(),
						hitpoints: passenger.getHitpoints(),
						maxHitpoints: passenger.getMaxHitpoints(),
						adrenaline: passenger.getAdrenaline(),
						maxAdrenaline: passenger.getMaxAdrenaline(),
						role: passenger.getRole(),
						alive: passenger.isAlive(),
						handSize: passenger.getHand().length,
						discardSize: passenger.getDiscardPile().length
					} : null
				};
			}),
			isDefeated: this.isDefeated()
		};
	}
}