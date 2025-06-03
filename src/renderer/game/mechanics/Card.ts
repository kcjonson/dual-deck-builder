/**
 * Card rarities following spec requirements
 */
export type CardRarity = 'starter' | 'common' | 'uncommon' | 'rare' | 'legendary';

/**
 * Card target types for effect resolution
 */
export type TargetType = 'enemy_single' | 'enemy_all' | 'self' | 'ally' | 'both_drivers' | 'any';

/**
 * Scaling types for variable effects
 */
export type ScalingType = 'ramming' | 'gunnery' | 'evade' | 'vehicle_weight' | 'armor' | 'speed';

/**
 * Flexible card effect interface - supports nested and conditional effects
 */
export interface CardEffect {
	type: string;
	value?: number;
	scaling?: ScalingType;
	target?: string;
	condition?: string;
	status?: string;
	resource?: string;
	distance?: number;
	effect?: CardEffect;
	description?: string;
	[key: string]: string | number | CardEffect | undefined; // Allow additional properties for future expansion
}

/**
 * Upgrade data structure for card improvements
 */
export interface UpgradeData {
	[key: string]: number | string | CardEffect[];
}

/**
 * Complete card data structure loaded from JSON
 */
export interface CardData {
	id: string;
	name: string;
	description: string;
	driverRestriction?: string | null;
	rarity: CardRarity;
	cost: number;
	targetType: TargetType;
	effects: CardEffect[];
	upgrades?: UpgradeData;
	tags: string[];
	image?: string;
	variables?: { [key: string]: { base: number; upgraded?: number; scaling?: ScalingType } };
}

/**
 * Card class representing a playable card in the game
 * Built for maximum configurability and future expansion
 */
export class Card {
	private data: CardData;
	private upgraded = false;

	/**
	 * Create a new card from data configuration
	 */
	constructor({ data }: { data: CardData }) {
		this.data = { ...data, effects: [...data.effects] };
		this.upgraded = false;
	}

	/**
	 * Get the card's unique ID
	 */
	public getId(): string {
		return this.data.id;
	}

	/**
	 * Get the card's name (with upgrade indicator)
	 */
	public getName(): string {
		return this.upgraded ? `${this.data.name}+` : this.data.name;
	}

	/**
	 * Get the card's description with variable substitution
	 */
	public getDescription(): string {
		let description = this.data.description;
		
		// Substitute variables in description (e.g., {damage})
		if (this.data.variables) {
			for (const [key, variable] of Object.entries(this.data.variables)) {
				const value = this.upgraded && variable.upgraded !== undefined 
					? variable.upgraded 
					: variable.base;
				description = description.replace(new RegExp(`{${key}}`, 'g'), value.toString());
			}
		}
		
		return description;
	}

	/**
	 * Get the card's rarity
	 */
	public getRarity(): CardRarity {
		return this.data.rarity;
	}

	/**
	 * Get the card's adrenaline cost
	 */
	public getCost(): number {
		return this.data.cost;
	}

	/**
	 * Get the card's target type
	 */
	public getTargetType(): TargetType {
		return this.data.targetType;
	}

	/**
	 * Get the card's effects
	 */
	public getEffects(): CardEffect[] {
		return [...this.data.effects];
	}

	/**
	 * Get the card's tags
	 */
	public getTags(): string[] {
		return [...this.data.tags];
	}

	/**
	 * Get the card's image path
	 */
	public getImagePath(): string | undefined {
		return this.data.image;
	}

	/**
	 * Get the driver restriction (if any)
	 */
	public getDriverRestriction(): string | null | undefined {
		return this.data.driverRestriction;
	}

	/**
	 * Check if the card is upgraded
	 */
	public isUpgraded(): boolean {
		return this.upgraded;
	}

	/**
	 * Get the raw card data
	 */
	public getData(): CardData {
		return { ...this.data };
	}

	/**
	 * Upgrade the card using configured upgrade data
	 */
	public upgrade(): Card {
		if (!this.upgraded && this.data.upgrades) {
			this.upgraded = true;
			
			// Apply configured upgrades
			for (const [key, value] of Object.entries(this.data.upgrades)) {
				if (key === 'cost' && typeof value === 'number') {
					this.data.cost = value;
				} else if (key === 'effects' && Array.isArray(value)) {
					this.data.effects = [...value as CardEffect[]];
				}
				// Additional upgrade types can be easily added here
			}
		}

		return this;
	}

	/**
	 * Get a variable's current value (base or upgraded)
	 */
	public getVariableValue(variableName: string): number | undefined {
		const variable = this.data.variables?.[variableName];
		if (!variable) return undefined;
		
		return this.upgraded && variable.upgraded !== undefined 
			? variable.upgraded 
			: variable.base;
	}

	/**
	 * Check if card has a specific tag
	 */
	public hasTag(tag: string): boolean {
		return this.data.tags.includes(tag);
	}

	/**
	 * Create a copy of this card
	 */
	public copy(): Card {
		const newCard = new Card({ data: JSON.parse(JSON.stringify(this.data)) });
		
		if (this.upgraded) {
			newCard.upgrade();
		}

		return newCard;
	}
}
