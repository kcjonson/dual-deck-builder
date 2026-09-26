import { Card } from './Card';
import { Deck } from './Deck';
import { Model } from '../core/Model';

/**
 * Most cards a driver can hold. A card drawn past the cap goes straight to discard (a burn).
 */
export const HAND_CAP = 7;

/**
 * Payload of the Driver 'cardsBurned' event, emitted once per draw that overflows the hand cap
 */
export interface CardsBurnedEvent {
	cards: readonly Card[];
}

/**
 * Outcome of a draw: cards that reached the hand, and cards burned to discard past the cap
 */
export interface DrawResult {
	drawn: Card[];
	burned: Card[];
}

/**
 * Driver archetype defining playstyle and starting deck
 */
export type DriverArchetype = 'road_warrior' | 'interceptor' | 'mechanic' | 'raider';

/**
 * The skills a hit check reads. A driver has them, and so does an escort's crew.
 */
export interface CrewSkills {
	ramming: number; // 0-10, affects ramming attack accuracy
	gunnery: number; // 0-10, affects ranged attack accuracy
	evade: number; // 0-10, affects defensive capabilities
}

/**
 * Driver skills based on Combat Rules specification
 */
export interface DriverSkills extends CrewSkills {
	speed: number; // 1-5, added to the base speed of whatever vehicle they're driving
}

/**
 * Vehicle stats that affect combat mechanics
 */
export interface VehicleStats {
	maxStructure: number; // Vehicle's maximum structure points
	weight: number; // Affects ramming damage
	armor: number; // Starting armor
	speed: number; // The vehicle's base speed, 1-5; the driver's speed skill adds to it
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
	cards: { type: string; quantity: number }[];
}

/**
 * Complete driver configuration
 */
export interface DriverConfig {
	id: DriverArchetype;
	metadata: DriverMetadata;
	skills: DriverSkills;
	vehicleStats: VehicleStats;
	startingDeck: StartingDeckConfig;
	maxHitpoints: number; // Driver's personal health
	maxAdrenaline: number; // Maximum adrenaline (energy) capacity
}

/**
 * Driver role in combat (affects card restrictions)
 */
export enum DriverRole {
	ACTIVE = 'active', // Driver controlling their own vehicle
	PASSENGER = 'passenger' // Driver whose vehicle was destroyed, now in another vehicle
}

/**
 * Driver data interface - used throughout the app
 */
export interface DriverData {
	// From DriverConfig
	archetype: DriverArchetype;
	metadata: DriverMetadata;
	skills: DriverSkills;
	vehicleStats: VehicleStats;
	startingDeck: StartingDeckConfig;
	
	// Runtime state
	hitpoints: number;
	maxHitpoints: number;
	adrenaline: number;
	maxAdrenaline: number;
	role: DriverRole;
	hand: Card[];
	discard: Card[];
	deck: Deck | null;
	/** Exhaust cards played this fight, out of the draw and discard until it ends */
	exhausted?: Card[];
}

/**
 * Driver interface for the class
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Driver extends DriverData {}

/**
 * Driver class representing a character with combat skills and individual adrenaline pool
 */
export class Driver extends Model<DriverData> {
	// Runtime property list - MUST match DriverData interface
	static properties = new Set<keyof DriverData>([
		'archetype',
		'metadata',
		'skills',
		'vehicleStats',
		'startingDeck',
		'hitpoints',
		'maxHitpoints',
		'adrenaline',
		'maxAdrenaline',
		'role',
		'hand',
		'discard',
		'deck',
		'exhausted'
	]);

	/**
	 * Create a new driver from configuration
	 */
	constructor(initialData: DriverData) {
		super(initialData);
	}


	// Model properties are automatically available as:
	// this.metadata.name, this.metadata.vehicleName, etc.
	// this.deck, this.hand, this.discard, etc.
	// They emit 'change' events when modified

	/**
	 * Create a starting deck for this driver using provided cards
	 * @param availableCards Map of card ID to Card instance
	 * @returns Deck instance with starting cards
	 */
	public createStartingDeck(availableCards: Map<string, Card>): Deck {
		const startingDeck = new Deck(
			`${this.archetype}_starting_deck`,
			`${this.metadata.name}'s Starting Deck`
		);

		// Add cards based on starting deck configuration
		for (const cardConfig of this.startingDeck.cards) {
			const cardTemplate = availableCards.get(cardConfig.type);
			if (cardTemplate) {
				// Add the specified quantity of this card
				for (let i = 0; i < cardConfig.quantity; i++) {
					startingDeck.addCard(cardTemplate.copy());
				}
			} else {
				console.warn(`Starting card not found: ${cardConfig.type} for driver ${this.archetype}`);
			}
		}

		this.deck = startingDeck;
		return startingDeck;
	}

	/**
	 * Get the complete driver configuration
	 */
	public getConfig(): DriverConfig {
		return {
			id: this.archetype,
			metadata: this.metadata,
			skills: this.skills,
			vehicleStats: this.vehicleStats,
			startingDeck: this.startingDeck,
			maxHitpoints: this.maxHitpoints,
			maxAdrenaline: this.maxAdrenaline
		};
	}

	/**
	 * Check if driver is alive
	 */
	public isAlive(): boolean {
		return this.hitpoints > 0;
	}

	/**
	 * Take damage
	 */
	public takeDamage(damage: number): void {
		this.hitpoints = Math.max(0, this.hitpoints - damage);
	}

	/**
	 * Heal hitpoints
	 */
	public heal(amount: number): void {
		this.hitpoints = Math.min(this.maxHitpoints, this.hitpoints + amount);
	}

	/**
	 * Spend adrenaline (returns true if successful)
	 */
	public spendAdrenaline(amount: number): boolean {
		if (this.adrenaline >= amount) {
			this.adrenaline -= amount;
			return true;
		}
		return false;
	}

	/**
	 * Gain adrenaline
	 */
	public gainAdrenaline(amount: number): void {
		this.adrenaline = Math.min(this.maxAdrenaline, this.adrenaline + amount);
	}

	/**
	 * Refill adrenaline to maximum
	 */
	public refillAdrenaline(): void {
		this.adrenaline = this.maxAdrenaline;
	}

	// Role is a model property - access it directly:
	// driver.role

	/**
	 * Check if driver can play attack cards. Order cards aren't attacks, so
	 * a passenger can play them.
	 */
	public canPlayAttackCards(): boolean {
		return this.role === DriverRole.ACTIVE;
	}

	// Hand and discard are model properties - access them directly:
	// driver.hand, driver.discard

	/**
	 * Add card to hand
	 */
	public addToHand(card: Card): void {
		this.hand.push(card);
	}

	/**
	 * Remove card from hand and add to discard pile, or to the exhausted pile
	 * for an Exhaust card
	 */
	public playCard(cardIndex: number): Card | null {
		if (cardIndex < 0 || cardIndex >= this.hand.length) {
			return null;
		}

		const card = this.hand.splice(cardIndex, 1)[0];
		if (card.hasTag('exhaust')) {
			this.exhausted = [...(this.exhausted ?? []), card];
		} else {
			this.discard.push(card);
		}
		return card;
	}

	/**
	 * Play a card with adrenaline cost validation and restrictions
	 */
	public playCardWithCost(cardIndex: number): { success: boolean; card: Card | null; reason?: string } {
		const reason = this.getPlayBlocker(cardIndex);
		if (reason) {
			return { success: false, card: null, reason };
		}

		const card = this.hand[cardIndex];

		// Spend adrenaline and play card
		if (this.spendAdrenaline(card.cost)) {
			const playedCard = this.playCard(cardIndex);
			return { success: true, card: playedCard };
		}

		return { success: false, card: null, reason: 'Failed to spend adrenaline' };
	}

	/**
	 * Why the card at this hand index can't be played now, or null if it can.
	 * Moves nothing, so a caller can check the target before spending the card.
	 */
	public getPlayBlocker(cardIndex: number): string | null {
		if (!this.isAlive()) {
			return 'Dead drivers cannot play cards';
		}
		const card = this.hand[cardIndex];
		if (!card) {
			return 'Invalid card index';
		}
		if (this.adrenaline < card.cost) {
			return 'Not enough adrenaline';
		}
		if (!this.canPlayAttackCards() && card.isAttack) {
			return 'Passengers cannot play attack cards';
		}
		return null;
	}

	/**
	 * Format a hand of cards with counts for duplicates
	 */
	private formatHandWithCounts(cards: Card[]): string {
		if (cards.length === 0) return 'No cards';
		
		// Count occurrences of each card
		const cardCounts = new Map<string, { card: Card, count: number }>();
		
		for (const card of cards) {
			const key = `${card.name}(${card.cost})`;
			const existing = cardCounts.get(key);
			if (existing) {
				existing.count++;
			} else {
				cardCounts.set(key, { card, count: 1 });
			}
		}
		
		// Format the output
		const formattedCards: string[] = [];
		for (const { card, count } of cardCounts.values()) {
			if (count > 1) {
				formattedCards.push(`${card.name} (${card.cost}) x${count}`);
			} else {
				formattedCards.push(`${card.name} (${card.cost})`);
			}
		}
		
		return formattedCards.join(', ');
	}

	/**
	 * Draw cards from driver's deck into their hand. Cards drawn while the hand is at
	 * HAND_CAP go straight to discard and are announced with a 'cardsBurned' event.
	 */
	public drawCards(count: number): DrawResult {
		const result: DrawResult = { drawn: [], burned: [] };
		if (!this.deck) return result;

		for (let i = 0; i < count; i++) {
			if (this.deck.size === 0 && this.discard.length > 0) {
				this.reshuffleDiscardIntoDeck();
			}

			const card = this.deck.draw();
			if (!card) break;

			if (this.hand.length < HAND_CAP) {
				this.addToHand(card);
				result.drawn.push(card);
			} else {
				this.discard.push(card);
				result.burned.push(card);
			}
		}

		if (result.drawn.length > 0) {
			const handCards = this.formatHandWithCounts(this.hand);
			console.log(`${this.metadata.name} drew ${result.drawn.length} cards. New hand: ${handCards}`);
		}

		if (result.burned.length > 0) {
			const payload: CardsBurnedEvent = { cards: Object.freeze([...result.burned]) };
			this.emit('cardsBurned', Object.freeze(payload));
		}

		return result;
	}

	/**
	 * Discard entire hand
	 */
	public discardHand(): void {
		this.discard.push(...this.hand);
		this.hand = [];
	}

	/**
	 * Reshuffle discard pile back into deck
	 */
	private reshuffleDiscardIntoDeck(): void {
		if (!this.deck) return;

		const discardedCards = [...this.discard];
		this.discard = [];
		
		for (const card of discardedCards) {
			this.deck.addCard(card);
		}
		
		this.deck.shuffle();
	}

	/**
	 * Check if driver can afford a specific card
	 */
	public canAffordCard(card: Card): boolean {
		return this.adrenaline >= card.cost;
	}

	/**
	 * Check if driver can play a specific card (cost + restrictions)
	 */
	public canPlayCard(card: Card): boolean {
		if (!this.isAlive() || !this.canAffordCard(card)) {
			return false;
		}

		// Check passenger restrictions
		if (!this.canPlayAttackCards() && card.isAttack) {
			return false;
		}

		return true;
	}

	/**
	 * Create a copy of this driver
	 */
	public copy(): Driver {
		const newDriver = new Driver({
			archetype: this.archetype,
			metadata: { ...this.metadata },
			skills: { ...this.skills },
			vehicleStats: { ...this.vehicleStats },
			startingDeck: { cards: this.startingDeck.cards.map(cardConfig => ({ ...cardConfig })) },
			hitpoints: this.hitpoints,
			maxHitpoints: this.maxHitpoints,
			adrenaline: this.adrenaline,
			maxAdrenaline: this.maxAdrenaline,
			role: this.role,
			hand: this.hand.map(card => card.copy()),
			discard: this.discard.map(card => card.copy()),
			deck: this.deck ? this.deck.copy() : null,
			exhausted: this.exhausted?.map(card => card.copy())
		});

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
		skills: {
			ramming: 8,
			gunnery: 4,
			evade: 3,
			speed: 1
		},
		vehicleStats: {
			maxStructure: 80,
			weight: 5,
			armor: 10,
			speed: 1,
			gunnery: 2,
			evade: 1
		},
		startingDeck: {
			cards: [
				{ type: 'ramming_speed', quantity: 5 },
				{ type: 'armor_plating', quantity: 3 },
				{ type: 'repair_kit', quantity: 2 },
				{ type: 'nitro_boost', quantity: 2 }
			]
		},
		maxHitpoints: 40, // Tough veteran driver
		maxAdrenaline: 5 // Default energy capacity
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
		skills: {
			ramming: 3,
			gunnery: 9,
			evade: 8,
			speed: 3
		},
		vehicleStats: {
			maxStructure: 50,
			weight: 1,
			armor: 0,
			speed: 5,
			gunnery: 4,
			evade: 4
		},
		startingDeck: {
			cards: [
				{ type: 'precision_shot', quantity: 3 },
				{ type: 'nitro_boost', quantity: 2 },
				{ type: 'flanking_maneuver', quantity: 2 },
				{ type: 'armor_plating', quantity: 1 },
				{ type: 'repair_kit', quantity: 1 },
				{ type: 'headshot', quantity: 2 }
			]
		},
		maxHitpoints: 25, // Agile but fragile
		maxAdrenaline: 5 // Default energy capacity
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
		skills: {
			ramming: 4,
			gunnery: 6,
			evade: 5,
			speed: 2
		},
		vehicleStats: {
			maxStructure: 60,
			weight: 3,
			armor: 5,
			speed: 2,
			gunnery: 3,
			evade: 2
		},
		startingDeck: {
			cards: [
				{ type: 'emp_blast', quantity: 1 },
				{ type: 'repair_kit', quantity: 3 },
				{ type: 'nitro_boost', quantity: 2 },
				{ type: 'armor_plating', quantity: 2 },
			]
		},
		maxHitpoints: 30, // Balanced survivability
		maxAdrenaline: 5 // Default energy capacity
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
		skills: {
			ramming: 7,
			gunnery: 6,
			evade: 4,
			speed: 2
		},
		vehicleStats: {
			maxStructure: 65,
			weight: 2,
			armor: 2,
			speed: 3,
			gunnery: 3,
			evade: 3
		},
		startingDeck: {
			cards: [
				{ type: 'berserker', quantity: 3 },
				{ type: 'ramming_speed', quantity: 2 },
				{ type: 'flanking_maneuver', quantity: 1 },
				{ type: 'repair_kit', quantity: 1 },
				{ type: 'armor_plating', quantity: 1 },
				{ type: 'nitro_boost', quantity: 1 }
			]
		},
		maxHitpoints: 33, // Reckless but resilient
		maxAdrenaline: 5 // Default energy capacity
	}
};