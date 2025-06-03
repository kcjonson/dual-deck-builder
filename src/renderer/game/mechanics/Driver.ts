import { Card } from './Card';
import { Deck } from './Deck';
import { Vehicle } from './Vehicle';

/**
 * Driver archetype defining playstyle and starting deck
 */
export type DriverArchetype = 'road_warrior' | 'interceptor' | 'mechanic' | 'raider';

/**
 * Driver combat skills based on Combat Rules specification
 */
export interface DriverSkills {
	ramming: number; // 0-10, affects ramming attack accuracy
	gunnery: number; // 0-10, affects ranged attack accuracy  
	evade: number; // 0-10, affects defensive capabilities
}

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
	skills: DriverSkills;
	vehicleStats: VehicleStats;
	startingDeck: StartingDeckConfig;
}

/**
 * Driver role in combat (affects card restrictions)
 */
export enum DriverRole {
	ACTIVE = 'active', // Driver controlling their own vehicle
	PASSENGER = 'passenger' // Driver whose vehicle was destroyed, now in another vehicle
}

/**
 * Driver class representing a character with combat skills and individual adrenaline pool
 */
export class Driver {
	private config: DriverConfig;
	private deck: Deck | null = null;
	private hand: Card[] = [];
	private discard: Card[] = [];
	private hitpoints: number;
	private maxHitpoints: number;
	private speed: number;
	private adrenaline: number;
	private maxAdrenaline: number;
	private role: DriverRole = DriverRole.ACTIVE;

	/**
	 * Create a new driver from configuration
	 */
	constructor({ 
		config,
		hitpoints = 30,
		adrenaline = 3
	}: { 
		config: DriverConfig;
		hitpoints?: number;
		adrenaline?: number;
	}) {
		this.config = { ...config };
		this.hitpoints = hitpoints;
		this.maxHitpoints = hitpoints;
		this.speed = config.skills?.ramming || 1; // Driver speed based on ramming skill
		this.adrenaline = adrenaline;
		this.maxAdrenaline = adrenaline;
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
	 * Get driver's current hitpoints
	 */
	public getHitpoints(): number {
		return this.hitpoints;
	}

	/**
	 * Get driver's maximum hitpoints
	 */
	public getMaxHitpoints(): number {
		return this.maxHitpoints;
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
	 * Get driver's speed
	 */
	public getSpeed(): number {
		return this.speed;
	}

	/**
	 * Get driver's combat skills
	 */
	public getSkills(): DriverSkills {
		return { ...this.config.skills };
	}

	/**
	 * Get current adrenaline
	 */
	public getAdrenaline(): number {
		return this.adrenaline;
	}

	/**
	 * Get maximum adrenaline
	 */
	public getMaxAdrenaline(): number {
		return this.maxAdrenaline;
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

	/**
	 * Get driver's current role
	 */
	public getRole(): DriverRole {
		return this.role;
	}

	/**
	 * Set driver's role
	 */
	public setRole(role: DriverRole): void {
		this.role = role;
	}

	/**
	 * Check if driver can play attack cards
	 */
	public canPlayAttackCards(): boolean {
		return this.role === DriverRole.ACTIVE;
	}

	/**
	 * Get driver's hand
	 */
	public getHand(): Card[] {
		return [...this.hand];
	}

	/**
	 * Get driver's discard pile
	 */
	public getDiscardPile(): Card[] {
		return [...this.discard];
	}

	/**
	 * Add card to hand
	 */
	public addToHand(card: Card): void {
		this.hand.push(card);
	}

	/**
	 * Remove card from hand and add to discard pile
	 */
	public playCard(cardIndex: number): Card | null {
		if (cardIndex < 0 || cardIndex >= this.hand.length) {
			return null;
		}

		const card = this.hand.splice(cardIndex, 1)[0];
		this.discard.push(card);
		return card;
	}

	/**
	 * Play a card with adrenaline cost validation and restrictions
	 */
	public playCardWithCost(cardIndex: number): { success: boolean; card: Card | null; reason?: string } {
		const card = this.hand[cardIndex];
		
		if (!card) {
			return { success: false, card: null, reason: 'Invalid card index' };
		}

		// Check if driver can afford the card
		if (this.adrenaline < card.getCost()) {
			return { success: false, card: null, reason: 'Not enough adrenaline' };
		}

		// Check card restrictions for passengers
		if (!this.canPlayAttackCards() && this.isAttackCard(card)) {
			return { success: false, card: null, reason: 'Passengers cannot play attack cards' };
		}

		// Spend adrenaline and play card
		if (this.spendAdrenaline(card.getCost())) {
			const playedCard = this.playCard(cardIndex);
			return { success: true, card: playedCard };
		}

		return { success: false, card: null, reason: 'Failed to spend adrenaline' };
	}

	/**
	 * Check if a card is an attack card
	 */
	private isAttackCard(card: Card): boolean {
		const effects = card.getEffects();
		return effects.some(effect => 
			effect.type === 'damage' || 
			effect.type === 'ram' ||
			card.getName().toLowerCase().includes('attack') ||
			card.getName().toLowerCase().includes('shot') ||
			card.getName().toLowerCase().includes('ram')
		);
	}

	/**
	 * Draw cards from driver's deck into their hand
	 */
	public drawCards(count: number): void {
		if (!this.deck) return;

		for (let i = 0; i < count; i++) {
			const card = this.deck.draw();
			
			if (card) {
				this.addToHand(card);
			} else {
				// Deck is empty, try to reshuffle discard pile
				if (this.discard.length > 0) {
					this.reshuffleDiscardIntoDeck();
					const reshuffledCard = this.deck.draw();
					if (reshuffledCard) {
						this.addToHand(reshuffledCard);
					}
				}
				// If still no cards available, break
				if (!this.deck.draw()) {
					break;
				}
			}
		}
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
		return this.adrenaline >= card.getCost();
	}

	/**
	 * Check if driver can play a specific card (cost + restrictions)
	 */
	public canPlayCard(card: Card): boolean {
		if (!this.canAffordCard(card)) {
			return false;
		}

		// Check passenger restrictions
		if (!this.canPlayAttackCards() && this.isAttackCard(card)) {
			return false;
		}

		return true;
	}

	/**
	 * Create a copy of this driver
	 */
	public copy(): Driver {
		const newDriver = new Driver({ 
			config: JSON.parse(JSON.stringify(this.config)),
			hitpoints: this.maxHitpoints,
			adrenaline: this.maxAdrenaline
		});
		
		// Copy current state
		newDriver.hitpoints = this.hitpoints;
		newDriver.adrenaline = this.adrenaline;
		newDriver.role = this.role;
		
		// Copy hand and discard
		newDriver.hand = this.hand.map(card => card.copy());
		newDriver.discard = this.discard.map(card => card.copy());
		
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
		skills: {
			ramming: 8,
			gunnery: 4,
			evade: 3
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
		skills: {
			ramming: 3,
			gunnery: 9,
			evade: 8
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
		skills: {
			ramming: 4,
			gunnery: 6,
			evade: 5
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
		skills: {
			ramming: 7,
			gunnery: 6,
			evade: 4
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