import { Card } from './Card';
import { Model } from '../core/Model';

/**
 * Deck data interface
 */
export interface DeckData {
	type: string; // The deck type identifier
	name: string;
	cards: Card[];
	maxSize: number | null;
}

/**
 * Deck interface for the class
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Deck extends DeckData {}

/**
 * Deck class representing a collection of cards
 */
export class Deck extends Model<DeckData> {
	// Runtime property list - MUST match DeckData interface
	static properties = new Set<keyof DeckData>([
		'type',
		'name',
		'cards',
		'maxSize'
	]);

	/**
	 * Create a new deck
	 * @param type Deck type identifier
	 * @param name Deck name
	 * @param cards Initial cards (optional)
	 * @param maxSize Maximum number of cards (optional)
	 */
	constructor(type: string, name: string, cards: Card[] = [], maxSize: number | null = null) {
		super({
			type,
			name,
			cards: [...cards],
			maxSize
		});
	}

	// Model properties are automatically available as:
	// this.id, this.name, this.cards, this.maxSize

	/**
	 * Get the number of cards in the deck
	 */
	get size(): number {
		return this.cards.length;
	}

	/**
	 * Check if the deck is full
	 */
	public isFull(): boolean {
		return this.maxSize !== null && this.cards.length >= this.maxSize;
	}

	/**
	 * Add a card to the deck
	 * @param card Card to add
	 * @returns Whether the card was added successfully
	 */
	public addCard(card: Card): boolean {
		if (this.isFull()) {
			console.warn('Cannot add card: deck is full');
			return false;
		}

		// Create new array to trigger change event
		this.cards = [...this.cards, card];
		return true;
	}

	/**
	 * Add multiple cards to the deck
	 * @param cards Cards to add
	 * @returns Number of cards successfully added
	 */
	public addCards(cards: Card[]): number {
		let addedCount = 0;

		for (const card of cards) {
			if (this.addCard(card)) {
				addedCount++;
			} else {
				// Deck is full, stop adding cards
				break;
			}
		}

		return addedCount;
	}

	/**
	 * Remove a card from the deck by index
	 * @param index Index of the card to remove
	 * @returns The removed card or null if the index is invalid
	 */
	public removeCardAt(index: number): Card | null {
		if (index < 0 || index >= this.cards.length) {
			console.warn(`Invalid card index: ${index}`);
			return null;
		}

		const removedCard = this.cards[index];
		// Create new array to trigger change event
		this.cards = this.cards.filter((_, i) => i !== index);
		return removedCard;
	}

	/**
	 * Remove a specific card from the deck
	 * @param card Card to remove
	 * @returns Whether the card was removed successfully
	 */
	public removeCard(card: Card): boolean {
		const index = this.cards.findIndex((c) => c.id === card.id);

		if (index === -1) {
			console.warn(`Card not found in deck: ${card.id}`);
			return false;
		}

		// Create new array to trigger change event
		this.cards = this.cards.filter((_, i) => i !== index);
		return true;
	}

	/**
	 * Remove all cards from the deck
	 */
	public clear(): void {
		this.cards = [];
	}

	/**
	 * Shuffle the deck using Fisher-Yates algorithm
	 */
	public shuffle(): void {
		const shuffled = [...this.cards];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		this.cards = shuffled;
	}

	/**
	 * Draw a card from the top of the deck
	 * @returns The drawn card or null if the deck is empty
	 */
	public draw(): Card | null {
		if (this.cards.length === 0) {
			return null;
		}

		const drawnCard = this.cards[this.cards.length - 1];
		// Create new array to trigger change event
		this.cards = this.cards.slice(0, -1);
		return drawnCard;
	}

	/**
	 * Draw multiple cards from the top of the deck
	 * @param count Number of cards to draw
	 * @returns Array of drawn cards
	 */
	public drawMultiple(count: number): Card[] {
		const drawnCards: Card[] = [];

		for (let i = 0; i < count; i++) {
			const card = this.draw();
			if (card) {
				drawnCards.push(card);
			} else {
				// Deck is empty
				break;
			}
		}

		return drawnCards;
	}

	/**
	 * Create a copy of this deck
	 * @returns New deck instance with copies of all cards
	 */
	public copy(): Deck {
		const cardCopies = this.cards.map((card) => card.copy());
		return new Deck(this.type, this.name, cardCopies, this.maxSize);
	}
}
