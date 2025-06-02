import { Card } from './Card';
import { Deck } from './Deck';

/**
 * Driver archetype defining playstyle and starting deck
 */
export type DriverArchetype = 'road_warrior' | 'interceptor' | 'mechanic' | 'raider';

/**
 * Vehicle stats that affect combat mechanics
 */
export interface VehicleStats {
	maxHealth: number;
	weight: number; // Affects ramming damage
	armor: number; // Starting armor
	speed: number; // Affects turn order and evasion
	gunnery: number; // Ranged attack accuracy
	evade: number; // Defensive stat
}

/**
 * Driver metadata and flavor information
 */
export interface DriverMetadata {
	name: string;
	vehicleName: string;
	specialty: string; // Short description like "DEFENSIVE TANK"
	flavorText: string; // Character description
	portraitImage?: string; // Driver portrait
	vehicleImage?: string; // Vehicle artwork
	unlocked: boolean; // Whether this driver is available
	unlockCondition?: string; // How to unlock this driver
}

/**
 * Starting deck configuration for a driver
 */
export interface StartingDeckConfig {
	cards: { id: string; quantity: number }[];
}

/**
 * Complete driver configuration
 */
export interface DriverConfig {
	id: DriverArchetype;
	metadata: DriverMetadata;
	vehicleStats: VehicleStats;
	startingDeck: StartingDeckConfig;
}

/**
 * Driver class representing a character/vehicle combination
 */
export class Driver {
	private config: DriverConfig;
	private deck: Deck | null = null;

	/**
	 * Create a new driver from configuration
	 */
	constructor({ config }: { config: DriverConfig }) {
		this.config = { ...config };
	}

	/**
	 * Get the driver's unique ID
	 */
	public getId(): DriverArchetype {
		return this.config.id;
	}

	/**
	 * Get the driver's display name
	 */
	public getName(): string {
		return this.config.metadata.name;
	}

	/**
	 * Get the vehicle name
	 */
	public getVehicleName(): string {
		return this.config.metadata.vehicleName;
	}

	/**
	 * Get the driver's specialty description
	 */
	public getSpecialty(): string {
		return this.config.metadata.specialty;
	}

	/**
	 * Get the driver's flavor text
	 */
	public getFlavorText(): string {
		return this.config.metadata.flavorText;
	}

	/**
	 * Get the driver's portrait image path
	 */
	public getPortraitImage(): string | undefined {
		return this.config.metadata.portraitImage;
	}

	/**
	 * Get the vehicle artwork image path
	 */
	public getVehicleImage(): string | undefined {
		return this.config.metadata.vehicleImage;
	}

	/**
	 * Check if this driver is unlocked
	 */
	public isUnlocked(): boolean {
		return this.config.metadata.unlocked;
	}

	/**
	 * Get the unlock condition description
	 */
	public getUnlockCondition(): string | undefined {
		return this.config.metadata.unlockCondition;
	}

	/**
	 * Get the vehicle stats
	 */
	public getVehicleStats(): VehicleStats {
		return { ...this.config.vehicleStats };
	}

	/**
	 * Get the starting deck configuration
	 */
	public getStartingDeckConfig(): StartingDeckConfig {
		return { ...this.config.startingDeck };
	}

	/**
	 * Set the driver's deck
	 */
	public setDeck(deck: Deck): void {
		this.deck = deck;
	}

	/**
	 * Get the driver's current deck
	 */
	public getDeck(): Deck | null {
		return this.deck;
	}

	/**
	 * Create a starting deck for this driver using provided cards
	 * @param availableCards Map of card ID to Card instance
	 * @returns Deck instance with starting cards
	 */
	public createStartingDeck(availableCards: Map<string, Card>): Deck {
		const startingDeck = new Deck(
			`${this.config.id}_starting_deck`,
			`${this.getName()}'s Starting Deck`
		);

		// Add cards based on starting deck configuration
		for (const cardConfig of this.config.startingDeck.cards) {
			const cardTemplate = availableCards.get(cardConfig.id);
			if (cardTemplate) {
				// Add the specified quantity of this card
				for (let i = 0; i < cardConfig.quantity; i++) {
					startingDeck.addCard(cardTemplate.copy());
				}
			} else {
				console.warn(`Starting card not found: ${cardConfig.id} for driver ${this.config.id}`);
			}
		}

		this.deck = startingDeck;
		return startingDeck;
	}

	/**
	 * Get the complete driver configuration
	 */
	public getConfig(): DriverConfig {
		return { ...this.config };
	}

	/**
	 * Create a copy of this driver
	 */
	public copy(): Driver {
		const newDriver = new Driver({ config: JSON.parse(JSON.stringify(this.config)) });
		
		if (this.deck) {
			newDriver.setDeck(this.deck.copy());
		}

		return newDriver;
	}
}

/**
 * Pre-configured driver archetypes based on the Card System Design spec
 */
export const DRIVER_CONFIGS: Record<DriverArchetype, DriverConfig> = {
	road_warrior: {
		id: 'road_warrior',
		metadata: {
			name: 'THE ROAD WARRIOR',
			vehicleName: 'Apocalypse Rig',
			specialty: 'DEFENSIVE TANK',
			flavorText: 'A weathered veteran of the wasteland, the Road Warrior\'s massive rig is a rolling fortress. Built to endure punishment and dish it back out, this driver excels at protecting allies while crushing enemies with overwhelming force.',
			portraitImage: 'drivers/road_warrior_portrait.png',
			vehicleImage: 'vehicles/apocalypse_rig.png',
			unlocked: true
		},
		vehicleStats: {
			maxHealth: 80,
			weight: 5,
			armor: 10,
			speed: 1,
			gunnery: 2,
			evade: 1
		},
		startingDeck: {
			cards: [
				{ id: 'ramming_speed', quantity: 2 },
				{ id: 'armor_plating', quantity: 3 },
				{ id: 'repair_kit', quantity: 2 },
				{ id: 'nitro_boost', quantity: 1 },
				{ id: 'coordinated_strike', quantity: 1 },
				{ id: 'flanking_maneuver', quantity: 1 }
			]
		}
	},

	interceptor: {
		id: 'interceptor',
		metadata: {
			name: 'THE INTERCEPTOR',
			vehicleName: 'Lightning Bike',
			specialty: 'AGILE STRIKER',
			flavorText: 'Swift as desert wind and twice as deadly, the Interceptor rides a souped-up motorcycle built for speed and precision. This driver strikes hard and fast, dancing around enemy attacks with supernatural grace.',
			portraitImage: 'drivers/interceptor_portrait.png',
			vehicleImage: 'vehicles/lightning_bike.png',
			unlocked: true
		},
		vehicleStats: {
			maxHealth: 50,
			weight: 1,
			armor: 0,
			speed: 5,
			gunnery: 4,
			evade: 4
		},
		startingDeck: {
			cards: [
				{ id: 'precision_shot', quantity: 3 },
				{ id: 'nitro_boost', quantity: 2 },
				{ id: 'flanking_maneuver', quantity: 2 },
				{ id: 'armor_plating', quantity: 1 },
				{ id: 'repair_kit', quantity: 1 },
				{ id: 'coordinated_strike', quantity: 1 }
			]
		}
	},

	mechanic: {
		id: 'mechanic',
		metadata: {
			name: 'THE MECHANIC',
			vehicleName: 'Mobile Workshop',
			specialty: 'SUPPORT SPECIALIST',
			flavorText: 'A brilliant engineer with grease-stained hands and an inventive mind, the Mechanic keeps the team running with jury-rigged repairs and devastating sabotage. Their mobile workshop is a marvel of wasteland ingenuity.',
			portraitImage: 'drivers/mechanic_portrait.png',
			vehicleImage: 'vehicles/mobile_workshop.png',
			unlocked: true
		},
		vehicleStats: {
			maxHealth: 60,
			weight: 3,
			armor: 5,
			speed: 2,
			gunnery: 3,
			evade: 2
		},
		startingDeck: {
			cards: [
				{ id: 'emp_blast', quantity: 1 },
				{ id: 'repair_kit', quantity: 3 },
				{ id: 'nitro_boost', quantity: 2 },
				{ id: 'armor_plating', quantity: 2 },
				{ id: 'coordinated_strike', quantity: 2 }
			]
		}
	},

	raider: {
		id: 'raider',
		metadata: {
			name: 'THE RAIDER',
			vehicleName: 'Spike Buggy',
			specialty: 'BERSERKER',
			flavorText: 'Driven mad by chrome and gasoline fumes, the Raider lives for chaos and violence. Their spike-covered buggy is a testament to their reckless nature - trading safety for devastating offensive power.',
			portraitImage: 'drivers/raider_portrait.png',
			vehicleImage: 'vehicles/spike_buggy.png',
			unlocked: false,
			unlockCondition: 'Complete a run with any driver'
		},
		vehicleStats: {
			maxHealth: 65,
			weight: 2,
			armor: 2,
			speed: 3,
			gunnery: 3,
			evade: 3
		},
		startingDeck: {
			cards: [
				{ id: 'blood_for_chrome', quantity: 3 },
				{ id: 'ramming_speed', quantity: 2 },
				{ id: 'coordinated_strike', quantity: 1 },
				{ id: 'flanking_maneuver', quantity: 1 },
				{ id: 'repair_kit', quantity: 1 },
				{ id: 'armor_plating', quantity: 1 },
				{ id: 'nitro_boost', quantity: 1 }
			]
		}
	}
};