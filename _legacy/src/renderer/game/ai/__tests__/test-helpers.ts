import { Driver, DriverRole } from '../../mechanics/Driver';
import { Vehicle } from '../../mechanics/Vehicle';
import { Card, CardData, CardEffect } from '../../mechanics/Card';
import { Deck } from '../../mechanics/Deck';
import type { AIDecision } from '../types';
import cardsFile from '../../data/cards.json';

export function createTestDriver(name: string): Driver {
	const deck = new Deck('test', 'Test Deck', []);
	
	return new Driver({
		archetype: 'road_warrior',
		metadata: {
			name,
			vehicleName: 'Test Vehicle',
			specialty: 'TEST DRIVER',
			flavorText: 'Test driver for unit tests',
			unlocked: true
		},
		skills: {
			ramming: 5,
			gunnery: 5,
			evade: 5,
			speed: 2
		},
		vehicleStats: {
			maxStructure: 10,
			weight: 100,
			armor: 5,
			speed: 3,
			gunnery: 70,
			evade: 30
		},
		startingDeck: {
			cards: []
		},
		hitpoints: 5,
		maxHitpoints: 5,
		adrenaline: 5,
		maxAdrenaline: 5,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck
	});
}

export function createTestVehicle(name: string, driver: Driver): Vehicle {
	return new Vehicle({
		name,
		armor: 5,
		maxArmor: 5,
		structure: 10,
		maxStructure: 10,
		baseSpeed: 3,
		slot: null,
		flank: null,
		velocity: 0,
		driver,
		passenger: null,
		statusEffects: []
	});
}

export function createTestCard(options: {
	type: string;
	name: string;
	cost: number;
	targetType: string;
	effects: Array<{ type: string; value: number }>;
}): Card {
	return new Card({
		type: options.type,
		name: options.name,
		summary: `Test card: ${options.name}`,
		description: `Test card: ${options.name}`,
		rarity: 'common',
		cost: options.cost,
		targetType: options.targetType as Card['targetType'],
		effects: options.effects,
		tags: ['test']
	});
}

/**
 * Cards that only take up room in a hand. Nobody can afford one, so no AI
 * is offered it.
 */
export function createFillerCards(count: number): Card[] {
	return Array.from({ length: count }, (_, index) => createTestCard({
		type: 'filler',
		name: `Filler ${index + 1}`,
		cost: 99,
		targetType: 'self',
		effects: []
	}));
}

/**
 * A free card that does nothing, to read what another card adds to a score
 */
export function createBlankCard(): Card {
	return createTestCard({ type: 'blank', name: 'Blank', cost: 0, targetType: 'self', effects: [] });
}

/**
 * A free card that only draws
 */
export function createDrawCard(draws: number): Card {
	return createTestCard({
		type: 'test_draw',
		name: `Draw ${draws}`,
		cost: 0,
		targetType: 'self',
		effects: [{ type: 'draw_cards', value: draws }]
	});
}

/**
 * A card's data in cards.json, not upgraded
 */
export function cardData(type: string): CardData {
	const data = (cardsFile as unknown as { cards: CardData[] }).cards.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return { ...data, upgraded: false };
}

/**
 * A card from cards.json, not upgraded
 */
export function realCard(type: string): Card {
	return new Card(cardData(type));
}

/**
 * A real card, cost, targeting, and order rules included, with other effects
 */
export function withEffects(type: string, effects: CardEffect[]): Card {
	return new Card({
		...cardData(type),
		type: `control_${type}`,
		name: `Control ${type}`,
		effects
	});
}

export function driverOf(vehicle: Vehicle): Driver {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
}

/**
 * A driver's play of a card that takes no target
 */
export function play(card: Card, driver: Driver): AIDecision {
	return { type: 'playCard', card, driver };
}