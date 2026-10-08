import { Driver, DriverRole } from '../../mechanics/Driver';
import { Vehicle } from '../../mechanics/Vehicle';
import { Card } from '../../mechanics/Card';
import { Deck } from '../../mechanics/Deck';

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
 * Cards that only take up room in a hand. At the default cost nobody can
 * afford one, so no AI is offered it.
 */
export function createFillerCards({ count, cost = 99 }: { count: number; cost?: number }): Card[] {
	return Array.from({ length: count }, (_, index) => createTestCard({
		type: 'filler',
		name: `Filler ${index + 1}`,
		cost,
		targetType: 'self',
		effects: []
	}));
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
 * The same card without its draws, to read what they add to a play's score
 */
export function withoutDraws(card: Card): Card {
	const control = card.copy();
	control.set({ type: `${card.type}_without_draws`, effects: card.effects.filter(effect => effect.type !== 'draw_cards') });
	return control;
}