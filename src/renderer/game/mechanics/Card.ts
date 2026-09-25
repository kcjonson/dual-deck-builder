import { Model } from '../core/Model';

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
	[key: string]: string | number | boolean | CardEffect | undefined; // Allow additional properties for future expansion
}

/**
 * Upgrade data structure for card improvements
 */
export interface UpgradeData {
	[key: string]: number | string | CardEffect[];
}

/**
 * Card data interface - all properties of a card
 */
export interface CardData {
	type: string; // The card identifier (e.g., "ramming_speed")
	name: string;
	summary: string; // Card face text: keywords in [brackets], {variables} filled like description
	description: string; // Full rules text for the detail view
	driverRestriction?: string | null;
	rarity: CardRarity;
	cost: number;
	targetType: TargetType;
	effects: CardEffect[];
	upgrades?: UpgradeData;
	tags: string[];
	image?: string;
	variables?: { [key: string]: { base: number; upgraded?: number; scaling?: ScalingType } };
	upgraded: boolean;
}

/**
 * Card interface for the class
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Card extends CardData {}

/**
 * Card class representing a playable card in the game
 * Built for maximum configurability and future expansion
 */
export class Card extends Model<CardData> {
	// Runtime property list - MUST match CardData interface
	static properties = new Set<keyof CardData>([
		'type',
		'name',
		'summary',
		'description',
		'driverRestriction',
		'rarity',
		'cost',
		'targetType',
		'effects',
		'upgrades',
		'tags',
		'image',
		'variables',
		'upgraded'
	]);

	/**
	 * Create a new card from data configuration
	 */
	constructor(data: Omit<CardData, 'upgraded'> & { upgraded?: boolean }) {
		super({
			...data,
			effects: [...data.effects],
			upgraded: data.upgraded || false
		});
	}

	// Model properties are automatically available as:
	// this.id, this.name, this.description, etc.

	/**
	 * Get the card's display name (with upgrade indicator)
	 */
	get displayName(): string {
		return this.upgraded ? `${this.name}+` : this.name;
	}

	/**
	 * Card face text with {variables} filled in (upgraded values once upgraded)
	 */
	get displaySummary(): string {
		return this.fillVariables(this.summary);
	}

	/**
	 * Full rules text with {variables} filled in (upgraded values once upgraded)
	 */
	get displayDescription(): string {
		return this.fillVariables(this.description);
	}

	private fillVariables(template: string): string {
		return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
			const value = this.getVariableValue(name);
			return value === undefined ? placeholder : value.toString();
		});
	}

	// rarity is a model property - access it directly with this.rarity

	// cost is a model property - access it directly with this.cost

	// targetType is a model property - access it directly with this.targetType

	// effects is a model property - access it directly with this.effects

	// tags is a model property - access it directly with this.tags

	// image is a model property - access it directly with this.image

	// driverRestriction is a model property - access it directly with this.driverRestriction

	// All properties are model properties - access them directly

	/**
	 * Upgrade the card using configured upgrade data
	 */
	public upgrade(): Card {
		if (!this.upgraded && this.upgrades) {
			this.upgraded = true;
			
			// Apply configured upgrades
			for (const [key, value] of Object.entries(this.upgrades)) {
				if (key === 'cost' && typeof value === 'number') {
					this.cost = value;
				} else if (key === 'effects' && Array.isArray(value)) {
					this.effects = [...value as CardEffect[]];
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
		const variable = this.variables?.[variableName];
		if (!variable) return undefined;
		
		return this.upgraded && variable.upgraded !== undefined 
			? variable.upgraded 
			: variable.base;
	}

	/**
	 * Check if card has a specific tag
	 */
	public hasTag(tag: string): boolean {
		return this.tags.includes(tag);
	}

	/**
	 * Create a copy of this card
	 */
	public copy(): Card {
		const newCard = new Card({
			type: this.type,
			name: this.name,
			summary: this.summary,
			description: this.description,
			driverRestriction: this.driverRestriction,
			rarity: this.rarity,
			cost: this.cost,
			targetType: this.targetType,
			effects: [...this.effects],
			upgrades: this.upgrades ? { ...this.upgrades } : undefined,
			tags: [...this.tags],
			image: this.image,
			variables: this.variables ? JSON.parse(JSON.stringify(this.variables)) : undefined,
			upgraded: this.upgraded
		});

		return newCard;
	}
}
