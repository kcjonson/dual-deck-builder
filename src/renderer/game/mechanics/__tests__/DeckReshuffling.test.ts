import { Driver, DriverRole } from '../Driver';
import { Deck } from '../Deck';
import { Card } from '../Card';

describe('Deck Reshuffling', () => {
	let driver: Driver;
	let testCards: Card[];

	beforeEach(() => {
		// Create test cards
		testCards = [];
		for (let i = 1; i <= 10; i++) {
			testCards.push(new Card({
				type: `card_${i}`,
				name: `Test Card ${i}`,
				description: 'Test card',
				rarity: 'common',
				cost: 1,
				targetType: 'self',
				effects: [],
				tags: ['test']
			}));
		}

		// Create a deck with the test cards
		const deck = new Deck('test', 'Test Deck', [...testCards]);

		// Create driver with the deck
		driver = new Driver({
			archetype: 'road_warrior',
			metadata: {
				name: 'Test Driver',
				vehicleName: 'Test Vehicle',
				specialty: 'TEST',
				flavorText: 'Test driver',
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
	});

	test('should automatically reshuffle discard pile when deck is empty', () => {
		// Draw all cards from deck
		driver.drawCards(10);
		expect(driver.hand.length).toBe(10);
		expect(driver.deck?.size).toBe(0);
		
		// Discard all cards
		driver.discardHand();
		expect(driver.hand.length).toBe(0);
		expect(driver.discard.length).toBe(10);
		
		// Draw again - should automatically reshuffle
		driver.drawCards(5);
		expect(driver.hand.length).toBe(5);
		expect(driver.deck?.size).toBe(5);
		expect(driver.discard.length).toBe(0);
	});

	test('should handle multiple reshuffle cycles', () => {
		// First cycle
		driver.drawCards(10);
		driver.discardHand();
		
		// Second cycle - draw all and discard
		driver.drawCards(10);
		expect(driver.hand.length).toBe(10);
		driver.discardHand();
		
		// Third cycle - should still work
		driver.drawCards(7);
		expect(driver.hand.length).toBe(7);
		expect(driver.deck?.size).toBe(3);
	});

	test('should not draw more cards than available even with reshuffling', () => {
		// Draw all cards
		driver.drawCards(10);
		expect(driver.hand.length).toBe(10);
		
		// Try to draw more when deck and discard are empty
		driver.drawCards(5);
		expect(driver.hand.length).toBe(10); // Should still be 10
	});

	test('should reshuffle mid-draw if needed', () => {
		// Draw 8 cards, leaving 2 in deck
		driver.drawCards(8);
		
		// Discard 5 cards
		for (let i = 0; i < 5; i++) {
			const card = driver.hand.pop();
			if (card) driver.discard.push(card);
		}
		expect(driver.hand.length).toBe(3);
		expect(driver.discard.length).toBe(5);
		expect(driver.deck?.size).toBe(2);
		
		// Try to draw 5 cards - should draw 2 from deck, reshuffle, then draw 3 more
		driver.drawCards(5);
		expect(driver.hand.length).toBe(8); // 3 + 5
		expect(driver.deck?.size).toBe(2); // 5 reshuffled - 3 drawn
		expect(driver.discard.length).toBe(0);
	});

	test('should maintain card identity through reshuffling', () => {
		// Track specific cards
		const firstCard = testCards[0];
		const lastCard = testCards[9];
		
		// Draw all cards
		driver.drawCards(10);
		
		// Verify we have the expected cards
		expect(driver.hand.some(c => c.name === firstCard.name)).toBe(true);
		expect(driver.hand.some(c => c.name === lastCard.name)).toBe(true);
		
		// Discard and reshuffle
		driver.discardHand();
		driver.drawCards(10);
		
		// Should still have the same cards
		expect(driver.hand.some(c => c.name === firstCard.name)).toBe(true);
		expect(driver.hand.some(c => c.name === lastCard.name)).toBe(true);
	});

	test('should shuffle the deck when reshuffling', () => {
		// Draw and discard all cards multiple times to test randomization
		const firstDrawOrder = [];
		driver.drawCards(10);
		for (const card of driver.hand) {
			firstDrawOrder.push(card.name);
		}
		driver.discardHand();
		
		// Do multiple reshuffles to find at least one different order
		let foundDifferentOrder = false;
		for (let attempt = 0; attempt < 20; attempt++) {
			driver.drawCards(10);
			
			const currentOrder = driver.hand.map(c => c.name);
			
			// Check if order is different
			let isDifferent = false;
			for (let i = 0; i < 10; i++) {
				if (currentOrder[i] !== firstDrawOrder[i]) {
					isDifferent = true;
					break;
				}
			}
			
			if (isDifferent) {
				foundDifferentOrder = true;
				break;
			}
			
			driver.discardHand();
		}
		
		// With 10 cards and proper shuffling, we should get a different order
		// within 20 attempts with extremely high probability
		expect(foundDifferentOrder).toBe(true);
	});
});