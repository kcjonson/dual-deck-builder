import { Card } from './Card';

/**
 * Deck class representing a collection of cards
 */
export class Deck {
	private id: string;
	private name: string;
	private cards: Card[];
	private maxSize: number | null = null;

	/**
	 * Create a new deck
	 * @param id Unique deck identifier
	 * @param name Deck name
	 * @param cards Initial cards (optional)
	 * @param maxSize Maximum number of cards (optional)
	 */
	constructor(id: string, name: string, cards: Card[] = [], maxSize: number | null = null) {
		this.id = id;
		this.name = name;
		this.cards = [...cards];
		this.maxSize = maxSize;
	}

	/**
	 * Get the deck's unique ID
	 */
	public getId(): string {
		return this.id;
	}

	/**
	 * Get the deck's name
	 */
	public getName(): string {
		return this.name;
	}

	/**
	 * Set the deck's name
	 * @param name New deck name
	 */
	public setName(name: string): void {
		this.name = name;
	}

	/**
	 * Get all cards in the deck
	 */
	public getCards(): Card[] {
		return [...this.cards];
	}

	/**
	 * Get the number of cards in the deck
	 */
	public getSize(): number {
		return this.cards.length;
	}

	/**
	 * Get the maximum size of the deck
	 */
	public getMaxSize(): number | null {
		return this.maxSize;
	}

	/**
	 * Set the maximum size of the deck
	 * @param size Maximum number of cards
	 */
	public setMaxSize(size: number | null): void {
		this.maxSize = size;
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

		this.cards.push(card);
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

		const [removedCard] = this.cards.splice(index, 1);
		return removedCard;
	}

	/**
	 * Remove a specific card from the deck
	 * @param card Card to remove
	 * @returns Whether the card was removed successfully
	 */
	public removeCard(card: Card): boolean {
		const index = this.cards.findIndex((c) => c.getId() === card.getId());

		if (index === -1) {
			console.warn(`Card not found in deck: ${card.getId()}`);
			return false;
		}

		this.cards.splice(index, 1);
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
		for (let i = this.cards.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
		}
	}

	/**
	 * Draw a card from the top of the deck
	 * @returns The drawn card or null if the deck is empty
	 */
	public draw(): Card | null {
		if (this.cards.length === 0) {
			console.warn('Cannot draw: deck is empty');
			return null;
		}

		return this.cards.pop() || null;
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
		return new Deck(this.id, this.name, cardCopies, this.maxSize);
	}
}
