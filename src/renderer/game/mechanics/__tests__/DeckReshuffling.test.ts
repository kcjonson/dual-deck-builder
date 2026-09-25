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
				summary: 'Test card',
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

	// Draws stay at or under the hand cap here; HandCap.test.ts covers overflow
	const emptyDeckIntoDiscard = (): void => {
		driver.drawCards(5);
		driver.discardHand();
		driver.drawCards(5);
		driver.discardHand();
	};

	test('should automatically reshuffle discard pile when deck is empty', () => {
		emptyDeckIntoDiscard();
		expect(driver.hand.length).toBe(0);
		expect(driver.deck?.size).toBe(0);
		expect(driver.discard.length).toBe(10);
		
		// Draw again - should automatically reshuffle
		driver.drawCards(5);
		expect(driver.hand.length).toBe(5);
		expect(driver.deck?.size).toBe(5);
		expect(driver.discard.length).toBe(0);
	});

	test('should handle multiple reshuffle cycles', () => {
		emptyDeckIntoDiscard();
		emptyDeckIntoDiscard();
		
		// Third cycle - should still work
		driver.drawCards(7);
		expect(driver.hand.length).toBe(7);
		expect(driver.deck?.size).toBe(3);
	});

	test('should not draw more cards than available even with reshuffling', () => {
		driver.deck = new Deck('small', 'Small Deck', testCards.slice(0, 3));

		driver.drawCards(5);
		expect(driver.hand.length).toBe(3);
		
		// Try to draw more when deck and discard are empty
		driver.drawCards(2);
		expect(driver.hand.length).toBe(3);
	});

	test('should reshuffle mid-draw if needed', () => {
		// Draw 7 cards, leaving 3 in deck
		driver.drawCards(7);
		
		// Discard 5 cards
		for (let i = 0; i < 5; i++) {
			const card = driver.hand.pop();
			if (card) driver.discard.push(card);
		}
		expect(driver.hand.length).toBe(2);
		expect(driver.discard.length).toBe(5);
		expect(driver.deck?.size).toBe(3);
		
		// Try to draw 5 cards - should draw 3 from deck, reshuffle, then draw 2 more
		driver.drawCards(5);
		expect(driver.hand.length).toBe(7); // 2 + 5
		expect(driver.deck?.size).toBe(3); // 5 reshuffled - 2 drawn
		expect(driver.discard.length).toBe(0);
	});

	test('should maintain card identity through reshuffling', () => {
		// Track specific cards
		const firstCard = testCards[0];
		const lastCard = testCards[9];
		const seenCardNames = (): string[] => [...driver.hand, ...driver.discard].map(c => c.name);
		
		// Draw all cards (the last three burn past the hand cap)
		driver.drawCards(10);
		
		// Verify we have the expected cards
		expect(seenCardNames()).toContain(firstCard.name);
		expect(seenCardNames()).toContain(lastCard.name);
		
		// Discard and reshuffle
		driver.discardHand();
		driver.drawCards(10);
		
		// Should still have the same cards
		expect(seenCardNames()).toContain(firstCard.name);
		expect(seenCardNames()).toContain(lastCard.name);
	});

	test('should shuffle the deck when reshuffling', () => {
		// Record the order of the unshuffled deck
		driver.drawCards(5);
		const firstDrawOrder = driver.hand.map(c => c.name);
		driver.discardHand();
		driver.drawCards(5);
		firstDrawOrder.push(...driver.hand.map(c => c.name));
		driver.discardHand();
		
		// Do multiple reshuffles to find at least one different order
		let foundDifferentOrder = false;
		for (let attempt = 0; attempt < 20; attempt++) {
			driver.drawCards(5);
			const currentOrder = driver.hand.map(c => c.name);
			driver.discardHand();
			driver.drawCards(5);
			currentOrder.push(...driver.hand.map(c => c.name));
			driver.discardHand();
			
			if (currentOrder.some((name, i) => name !== firstDrawOrder[i])) {
				foundDifferentOrder = true;
				break;
			}
		}
		
		// With 10 cards and proper shuffling, we should get a different order
		// within 20 attempts with extremely high probability
		expect(foundDifferentOrder).toBe(true);
	});
});