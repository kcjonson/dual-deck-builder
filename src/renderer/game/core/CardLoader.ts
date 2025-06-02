import { Card, CardData } from '../mechanics/Card';

/**
 * Loads and manages card data from JSON configuration
 * Designed for easy content updates and modding support
 */
export class CardLoader {
	private static instance: CardLoader;
	private cardsData: Map<string, CardData> = new Map();
	private startingDecks: Map<string, string[]> = new Map();
	private loaded: boolean = false;

	private constructor() {}

	public static getInstance(): CardLoader {
		if (!CardLoader.instance) {
			CardLoader.instance = new CardLoader();
		}
		return CardLoader.instance;
	}

	/**
	 * Load cards from JSON file
	 */
	public async loadCards(jsonPath: string = '/cards.json'): Promise<void> {
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
	private parseCardData(data: any): void {
		if (!data.cards || !Array.isArray(data.cards)) {
			throw new Error('Invalid card data format: expected cards array');
		}

		// Clear existing data
		this.cardsData.clear();
		this.startingDecks.clear();

		// Load individual cards
		for (const cardData of data.cards) {
			this.validateCardData(cardData);
			this.cardsData.set(cardData.id, cardData);
		}

		// Load starting deck configurations
		if (data.startingDecks) {
			for (const [deckId, deckData] of Object.entries(data.startingDecks)) {
				if (typeof deckData === 'object' && deckData !== null && 'cards' in deckData) {
					const deck = deckData as { cards: string[] };
					this.startingDecks.set(deckId, deck.cards);
				}
			}
		}

		console.log(`Loaded ${this.cardsData.size} cards and ${this.startingDecks.size} starting decks`);
	}

	/**
	 * Validate card data structure
	 */
	private validateCardData(cardData: any): void {
		const required = ['id', 'name', 'description', 'rarity', 'cost', 'targetType', 'effects', 'tags'];
		
		for (const field of required) {
			if (!(field in cardData)) {
				throw new Error(`Card ${cardData.id || 'unknown'} missing required field: ${field}`);
			}
		}

		if (!Array.isArray(cardData.effects)) {
			throw new Error(`Card ${cardData.id} effects must be an array`);
		}

		if (!Array.isArray(cardData.tags)) {
			throw new Error(`Card ${cardData.id} tags must be an array`);
		}

		// Validate rarity
		const validRarities = ['starter', 'common', 'uncommon', 'rare', 'legendary'];
		if (!validRarities.includes(cardData.rarity)) {
			throw new Error(`Card ${cardData.id} has invalid rarity: ${cardData.rarity}`);
		}

		// Validate target type
		const validTargets = ['enemy_single', 'enemy_all', 'self', 'ally', 'both_drivers', 'any'];
		if (!validTargets.includes(cardData.targetType)) {
			throw new Error(`Card ${cardData.id} has invalid target type: ${cardData.targetType}`);
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

		return new Card({ data: cardData });
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
	 * Get starting deck for a driver archetype
	 */
	public getStartingDeck(archetypeId: string): Card[] {
		const cardIds = this.startingDecks.get(archetypeId);
		if (!cardIds) {
			console.warn(`CardLoader: Starting deck not found: ${archetypeId}`);
			return [];
		}

		const cards: Card[] = [];
		for (const cardId of cardIds) {
			const card = this.createCard(cardId);
			if (card) {
				cards.push(card);
			} else {
				console.warn(`CardLoader: Card in starting deck not found: ${cardId}`);
			}
		}

		return cards;
	}

	/**
	 * Get available starting deck archetypes
	 */
	public getStartingDeckIds(): string[] {
		return Array.from(this.startingDecks.keys());
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