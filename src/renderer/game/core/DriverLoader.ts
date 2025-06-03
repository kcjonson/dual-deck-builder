import { Driver, DriverArchetype, DriverConfig, DRIVER_CONFIGS } from '../mechanics/Driver';
import { CardLoader } from './CardLoader';

/**
 * DriverLoader manages the loading and creation of driver instances
 * Follows the same pattern as CardLoader for consistency
 */
export class DriverLoader {
	private static instance: DriverLoader;
	private drivers: Map<DriverArchetype, Driver> = new Map();
	private loaded = false;

	/**
	 * Private constructor for singleton pattern
	 */
	private constructor() {
		// Private constructor for singleton pattern
	}

	/**
	 * Get the singleton instance
	 */
	public static getInstance(): DriverLoader {
		if (!DriverLoader.instance) {
			DriverLoader.instance = new DriverLoader();
		}
		return DriverLoader.instance;
	}

	/**
	 * Load all drivers from configuration
	 * @returns Promise that resolves when drivers are loaded
	 */
	public async loadDrivers(): Promise<void> {
		if (this.loaded) {
			return; // Already loaded
		}

		try {
			console.log('Loading drivers...');

			// Create driver instances from configurations
			for (const [archetype, config] of Object.entries(DRIVER_CONFIGS)) {
				const driver = new Driver({ config: config as DriverConfig });
				this.drivers.set(archetype as DriverArchetype, driver);
			}

			this.loaded = true;
			console.log(`Loaded ${this.drivers.size} drivers successfully`);

		} catch (error) {
			console.error('Failed to load drivers:', error);
			throw error;
		}
	}

	/**
	 * Get a driver by archetype
	 * @param archetype The driver archetype to retrieve
	 * @returns Driver instance or undefined if not found
	 */
	public getDriver(archetype: DriverArchetype): Driver | undefined {
		if (!this.loaded) {
			console.warn('Drivers not loaded yet. Call loadDrivers() first.');
			return undefined;
		}

		return this.drivers.get(archetype);
	}

	/**
	 * Get all loaded drivers
	 * @returns Array of all driver instances
	 */
	public getAllDrivers(): Driver[] {
		if (!this.loaded) {
			console.warn('Drivers not loaded yet. Call loadDrivers() first.');
			return [];
		}

		return Array.from(this.drivers.values());
	}

	/**
	 * Get all unlocked drivers
	 * @returns Array of unlocked driver instances
	 */
	public getUnlockedDrivers(): Driver[] {
		return this.getAllDrivers().filter(driver => driver.isUnlocked());
	}

	/**
	 * Get all locked drivers
	 * @returns Array of locked driver instances
	 */
	public getLockedDrivers(): Driver[] {
		return this.getAllDrivers().filter(driver => !driver.isUnlocked());
	}

	/**
	 * Create a starting deck for a driver
	 * @param archetype The driver archetype
	 * @returns Promise that resolves to the driver with starting deck
	 */
	public async createDriverWithStartingDeck(archetype: DriverArchetype): Promise<Driver | null> {
		if (!this.loaded) {
			await this.loadDrivers();
		}

		const driver = this.getDriver(archetype);
		if (!driver) {
			console.error(`Driver not found: ${archetype}`);
			return null;
		}

		// Ensure CardLoader is loaded
		const cardLoader = CardLoader.getInstance();
		if (!cardLoader.isLoaded()) {
			await cardLoader.loadCards();
		}

		// Create starting deck using available cards
		const availableCards = cardLoader.getAllCardsAsMap();
		driver.createStartingDeck(availableCards);

		return driver.copy(); // Return a copy to avoid modifying the template
	}

	/**
	 * Check if drivers are loaded
	 * @returns Whether drivers have been loaded
	 */
	public isLoaded(): boolean {
		return this.loaded;
	}

	/**
	 * Get the number of loaded drivers
	 * @returns Number of drivers
	 */
	public getDriverCount(): number {
		return this.drivers.size;
	}

	/**
	 * Unlock a driver (for progression system)
	 * @param archetype The driver to unlock
	 * @returns Whether the driver was successfully unlocked
	 */
	public unlockDriver(archetype: DriverArchetype): boolean {
		const driver = this.getDriver(archetype);
		if (!driver) {
			console.warn(`Cannot unlock driver: ${archetype} not found`);
			return false;
		}

		if (driver.isUnlocked()) {
			console.log(`Driver ${archetype} is already unlocked`);
			return true;
		}

		// Modify the driver's config to unlock it
		const config = driver.getConfig();
		config.metadata.unlocked = true;
		
		// Create new driver instance with unlocked status
		const unlockedDriver = new Driver({ config });
		this.drivers.set(archetype, unlockedDriver);

		console.log(`Driver ${archetype} unlocked!`);
		return true;
	}

	/**
	 * Reset all drivers to their default unlock state
	 */
	public resetUnlockState(): void {
		this.drivers.clear();
		this.loaded = false;
		
		// Reload drivers with default unlock states
		this.loadDrivers();
	}
}