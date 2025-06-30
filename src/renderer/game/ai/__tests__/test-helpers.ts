import { Driver, DriverRole } from '../../mechanics/Driver';
import { Vehicle, VehiclePosition } from '../../mechanics/Vehicle';
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
			evade: 5
		},
		vehicleStats: {
			maxStructure: 10,
			weight: 100,
			armor: 5,
			speed: 50,
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
		speed: 50,
		baseSpeed: 50,
		position: VehiclePosition.FRONT,
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
		description: `Test card: ${options.name}`,
		rarity: 'common',
		cost: options.cost,
		targetType: options.targetType as Card['targetType'],
		effects: options.effects,
		tags: ['test']
	});
}