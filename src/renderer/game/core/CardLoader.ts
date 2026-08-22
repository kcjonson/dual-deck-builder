import { Card, CardData } from '../mechanics/Card';

/**
 * Loads and manages card data from JSON configuration
 * Designed for easy content updates and modding support
 */
export class CardLoader {
	private static instance: CardLoader;
	private cardsData: Map<string, CardData> = new Map();
	private startingDecks: Map<string, string[]> = new Map();
	private loaded = false;

	private constructor() {
		// Private constructor for singleton pattern
	}

	public static getInstance(): CardLoader {
		if (!CardLoader.instance) {
			CardLoader.instance = new CardLoader();
		}
		return CardLoader.instance;
	}

	/**
	 * Load cards from JSON file
	 */
	public async loadCards(jsonPath = 'cards.json'): Promise<void> {
		try {
			const response = await fetch(jsonPath);
			if (!response.ok) {
				throw new Error(`Failed to load cards: ${response.statusText}`);
			}

			const data = await response.json();
			this.parseCardData(data);
			this.loaded = true;
		} catch (error) {
			console.error('Error loading cards:', error);
			throw error;
		}
	}

	/**
	 * Parse and validate card data from JSON
	 */
	private parseCardData(data: { cards: CardData[]; startingDecks?: Record<string, { name: string; description: string; cards: string[] }> }): void {
		if (!data.cards || !Array.isArray(data.cards)) {
			throw new Error('Invalid card data format: expected cards array');
		}

		// Clear existing data
		this.cardsData.clear();
		this.startingDecks.clear();

		// Load individual cards
		for (const cardData of data.cards) {
			this.validateCardData(cardData);
			this.cardsData.set(cardData.type, cardData);
		}

		// Load starting deck configurations
		if (data.startingDecks) {
			for (const [deckId, deckData] of Object.entries(data.startingDecks)) {
				if (typeof deckData === 'object' && deckData !== null && 'cards' in deckData && Array.isArray(deckData.cards)) {
					this.startingDecks.set(deckId, deckData.cards);
				}
			}
		}

		console.log(`Loaded ${this.cardsData.size} cards and ${this.startingDecks.size} starting decks`);
	}

	/**
	 * Validate card data structure
	 */
	private validateCardData(cardData: CardData): void {
		const required = ['type', 'name', 'description', 'rarity', 'cost', 'targetType', 'effects', 'tags'];
		
		for (const field of required) {
			if (!(field in cardData)) {
				throw new Error(`Card ${cardData.type || 'unknown'} missing required field: ${field}`);
			}
		}

		if (!Array.isArray(cardData.effects)) {
			throw new Error(`Card ${cardData.type} effects must be an array`);
		}

		if (!Array.isArray(cardData.tags)) {
			throw new Error(`Card ${cardData.type} tags must be an array`);
		}

		// Validate rarity
		const validRarities = ['starter', 'common', 'uncommon', 'rare', 'legendary'];
		if (!validRarities.includes(cardData.rarity)) {
			throw new Error(`Card ${cardData.type} has invalid rarity: ${cardData.rarity}`);
		}

		// Validate target type
		const validTargets = ['enemy_single', 'enemy_all', 'self', 'ally', 'both_drivers', 'any'];
		if (!validTargets.includes(cardData.targetType)) {
			throw new Error(`Card ${cardData.type} has invalid target type: ${cardData.targetType}`);
		}
	}

	/**
	 * Create a Card instance from its ID
	 */
	public createCard(cardId: string): Card | null {
		if (!this.loaded) {
			console.warn('CardLoader: Cards not loaded yet');
			return null;
		}

		const cardData = this.cardsData.get(cardId);
		if (!cardData) {
			console.warn(`CardLoader: Card not found: ${cardId}`);
			return null;
		}

		return new Card(cardData);
	}

	/**
	 * Get all available card IDs
	 */
	public getAllCardIds(): string[] {
		return Array.from(this.cardsData.keys());
	}

	/**
	 * Get cards by rarity
	 */
	public getCardsByRarity(rarity: string): Card[] {
		const cards: Card[] = [];
		for (const [id, data] of this.cardsData) {
			if (data.rarity === rarity) {
				const card = this.createCard(id);
				if (card) cards.push(card);
			}
		}
		return cards;
	}

	/**
	 * Get cards by tag
	 */
	public getCardsByTag(tag: string): Card[] {
		const cards: Card[] = [];
		for (const [id, data] of this.cardsData) {
			if (data.tags.includes(tag)) {
				const card = this.createCard(id);
				if (card) cards.push(card);
			}
		}
		return cards;
	}

	/**
	 * Get all cards
	 */
	public getAllCards(): Card[] {
		const cards: Card[] = [];
		for (const id of this.cardsData.keys()) {
			const card = this.createCard(id);
			if (card) cards.push(card);
		}
		return cards;
	}

	/**
	 * Get all loaded cards as a map by ID
	 * @returns Map of card ID to Card instance
	 */
	public getAllCardsAsMap(): Map<string, Card> {
		const cardsMap = new Map<string, Card>();
		for (const id of this.cardsData.keys()) {
			const card = this.createCard(id);
			if (card) cardsMap.set(id, card);
		}
		return cardsMap;
	}

	/**
	 * Check if cards are loaded
	 */
	public isLoaded(): boolean {
		return this.loaded;
	}

	/**
	 * Get card count
	 */
	public getCardCount(): number {
		return this.cardsData.size;
	}
}