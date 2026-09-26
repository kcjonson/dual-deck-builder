import { Driver, DriverRole } from './Driver';
import { Vehicle } from './Vehicle';
import { Model } from '../core/Model';
import { TeamType } from './TeamType';

export { TeamType };

/** A player team's driven vehicles, one per driver */
export const PLAYER_DRIVEN_VEHICLES = 2;

/** Escorts from the convoy a player team can field; an encounter's set-piece allies don't count */
export const MAX_CONVOY_ESCORTS = 4;

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
 * Player teams start with exactly 2 driven vehicles plus up to 4 convoy
 * escorts, listed in roster order, plus any set-piece allies; enemy teams can have variable amounts.
 * Wrecks leave the list when Battle clears them off the road.
 * Drivers manage their own hands/cards individually
 */
export class Team extends Model<TeamData> {
	// Runtime property list - MUST match TeamData interface
	static properties = new Set<keyof TeamData>([
		'type',
		'vehicles'
	]);

	// Who got out of each wreck alive, kept after the wreck leaves its team so
	// a card planned at it can follow them (stored separately due to Model freezing)
	private static wreckSurvivors = new WeakMap<Vehicle, Driver[]>();

	/**
	 * Everyone who was aboard a wreck when it was wrecked and lived, driver
	 * first, whether they found a seat or crashed out
	 */
	public static survivorsOf(wreck: Vehicle): readonly Driver[] {
		return Team.wreckSurvivors.get(wreck) ?? [];
	}

	/**
	 * Create a new team
	 */
	constructor(initialData: TeamData) {
		super(initialData);

		if (initialData.type === TeamType.PLAYER) {
			if (this.drivenVehicles.length !== PLAYER_DRIVEN_VEHICLES) {
				throw new Error(`Player teams must have exactly ${PLAYER_DRIVEN_VEHICLES} driven vehicles, not ${this.drivenVehicles.length}`);
			}
			this.assertEscortRoom(0);
		}
	}

	// Model properties are automatically available as:
	// team.type, team.vehicles

	/**
	 * Vehicles with a driver's seat, whether or not anyone is in it
	 */
	public get drivenVehicles(): Vehicle[] {
		return this.vehicles.filter(vehicle => !vehicle.isEscort);
	}

	/**
	 * Escorts in roster order, first acquired first
	 */
	public get escorts(): Vehicle[] {
		return this.vehicles.filter(vehicle => vehicle.isEscort);
	}

	/**
	 * Counts toward the escort cap: the convoy's own escorts, wherever they
	 * are on the road. A set-piece ally belongs to its encounter, so it never
	 * counts, whether or not its slot has been set yet.
	 */
	private static countsTowardEscortCap(vehicle: Vehicle): boolean {
		return vehicle.isEscort && !vehicle.escort?.setPiece;
	}

	private assertEscortRoom(adding: number): void {
		const convoyEscorts = this.vehicles.filter(Team.countsTowardEscortCap).length + adding;
		if (convoyEscorts > MAX_CONVOY_ESCORTS) {
			throw new Error(`Player teams can field ${MAX_CONVOY_ESCORTS} convoy escorts, not ${convoyEscorts}`);
		}
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
	 * No driver still in the fight, driving or riding. The dead leave their
	 * seats, and a driver who crashed out never got one, so only living
	 * drivers still aboard a vehicle count.
	 */
	public isDefeated(): boolean {
		return this.getAliveDrivers().length === 0;
	}

	/**
	 * Add vehicle to team
	 */
	public addVehicle(vehicle: Vehicle): void {
		if (this.type === TeamType.PLAYER) {
			if (!vehicle.isEscort && this.drivenVehicles.length >= PLAYER_DRIVEN_VEHICLES) {
				throw new Error(`Player teams cannot have more than ${PLAYER_DRIVEN_VEHICLES} driven vehicles`);
			}
			if (Team.countsTowardEscortCap(vehicle)) {
				this.assertEscortRoom(1);
			}
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
		const survivors = [destroyedVehicle.driver, destroyedVehicle.passenger]
			.filter((occupant): occupant is Driver => occupant?.isAlive() ?? false);
		Team.wreckSurvivors.set(destroyedVehicle, survivors);
		destroyedVehicle.driver = null;
		destroyedVehicle.passenger = null;
		destroyedVehicle.destroy();

		for (const survivor of survivors) {
			this.handleDriverEscape(survivor);
		}
	}

	/**
	 * Refill adrenaline for all living drivers at start of turn
	 */
	public refillAdrenaline(): void {
		this.getAliveDrivers().forEach(driver => driver.refillAdrenaline());
	}

	/**
	 * Every vehicle's Shield wears off, at the start of the player's turn
	 */
	public clearShields(): void {
		this.vehicles.forEach(vehicle => vehicle.clearShield());
	}

	/**
	 * Every escort is ready to act again, at the start of the player's turn
	 */
	public readyEscorts(): void {
		this.escorts.forEach(escort => { escort.spent = false; });
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
	 * Seat a driver as a passenger in the first team vehicle with a free seat
	 * behind a living driver. Returns false if there's no room anywhere.
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