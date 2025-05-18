/**
 * Enum for card types
 */
export enum CardType {
	ATTACK = 'attack',
	DEFENSE = 'defense',
	SKILL = 'skill',
	POWER = 'power',
	STATUS = 'status',
	CURSE = 'curse',
}

/**
 * Enum for card rarities
 */
export enum CardRarity {
	COMMON = 'common',
	UNCOMMON = 'uncommon',
	RARE = 'rare',
	LEGENDARY = 'legendary',
}

/**
 * Interface for card effects
 */
export interface CardEffect {
	type: string;
	value: number;
	description: string;
}

/**
 * Card class representing a playable card in the game
 */
export class Card {
	private id: string;
	private name: string;
	private description: string;
	private type: CardType;
	private rarity: CardRarity;
	private cost: number;
	private effects: CardEffect[];
	private imagePath: string | null;
	private upgraded: boolean;

	/**
	 * Create a new card
	 * @param id Unique card identifier
	 * @param name Card name
	 * @param description Card description
	 * @param type Card type
	 * @param rarity Card rarity
	 * @param cost Energy cost to play
	 * @param effects Array of card effects
	 * @param imagePath Path to card image (optional)
	 */
	constructor(
		id: string,
		name: string,
		description: string,
		type: CardType,
		rarity: CardRarity,
		cost: number,
		effects: CardEffect[],
		imagePath: string | null = null,
	) {
		this.id = id;
		this.name = name;
		this.description = description;
		this.type = type;
		this.rarity = rarity;
		this.cost = cost;
		this.effects = [...effects];
		this.imagePath = imagePath;
		this.upgraded = false;
	}

	/**
	 * Get the card's unique ID
	 */
	public getId(): string {
		return this.id;
	}

	/**
	 * Get the card's name
	 */
	public getName(): string {
		return this.upgraded ? `${this.name}+` : this.name;
	}

	/**
	 * Get the card's description
	 */
	public getDescription(): string {
		return this.description;
	}

	/**
	 * Get the card's type
	 */
	public getType(): CardType {
		return this.type;
	}

	/**
	 * Get the card's rarity
	 */
	public getRarity(): CardRarity {
		return this.rarity;
	}

	/**
	 * Get the card's energy cost
	 */
	public getCost(): number {
		return this.cost;
	}

	/**
	 * Get the card's effects
	 */
	public getEffects(): CardEffect[] {
		return [...this.effects];
	}

	/**
	 * Get the card's image path
	 */
	public getImagePath(): string | null {
		return this.imagePath;
	}

	/**
	 * Check if the card is upgraded
	 */
	public isUpgraded(): boolean {
		return this.upgraded;
	}

	/**
	 * Upgrade the card
	 * @returns This card instance for chaining
	 */
	public upgrade(): Card {
		if (!this.upgraded) {
			this.upgraded = true;

			// Apply upgrade effects (example: reduce cost)
			if (this.cost > 0) {
				this.cost -= 1;
			}

			// Improve effects (example: increase values)
			this.effects = this.effects.map((effect) => ({
				...effect,
				value: Math.floor(effect.value * 1.5),
			}));

			// Update description to show upgraded values
			this.updateDescription();
		}

		return this;
	}

	/**
	 * Update the card's description
	 * @returns This card instance for chaining
	 */
	private updateDescription(): Card {
		// This would dynamically update the description based on effects
		// For now, it's just a placeholder

		return this;
	}

	/**
	 * Create a copy of this card
	 * @returns New card instance with the same properties
	 */
	public copy(): Card {
		const newCard = new Card(
			this.id,
			this.name,
			this.description,
			this.type,
			this.rarity,
			this.cost,
			this.effects,
			this.imagePath,
		);

		if (this.upgraded) {
			newCard.upgrade();
		}

		return newCard;
	}
}
