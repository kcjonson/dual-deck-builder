import { Driver, DriverRole } from '../Driver';
import { Deck } from '../Deck';
import { Card } from '../Card';
import { Rng } from '../../core/Rng';

describe('Deck Reshuffling', () => {
	let driver: Driver;
	let testCards: Card[];
	let rng: Rng;

	/** A driver drawing from a fresh deck of these cards, in this order. */
	const driverWith = (cards: Card[]): Driver => {
		// Create a deck with the test cards
		const deck = new Deck('test', 'Test Deck', [...cards]);

		// Create driver with the deck
		return new Driver({
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
	};

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

		driver = driverWith(testCards);
		rng = new Rng({ seed: 20261007 });
	});

	// Draws stay at or under the hand limit here; HandLimit.test.ts covers overflow
	const emptyDeckIntoDiscard = (): void => {
		driver.drawCards(5, rng);
		driver.discardHand();
		driver.drawCards(5, rng);
		driver.discardHand();
	};

	test('should automatically reshuffle discard pile when deck is empty', () => {
		emptyDeckIntoDiscard();
		expect(driver.hand.length).toBe(0);
		expect(driver.deck?.size).toBe(0);
		expect(driver.discard.length).toBe(10);
		
		// Draw again - should automatically reshuffle
		driver.drawCards(5, rng);
		expect(driver.hand.length).toBe(5);
		expect(driver.deck?.size).toBe(5);
		expect(driver.discard.length).toBe(0);
	});

	test('should handle multiple reshuffle cycles', () => {
		emptyDeckIntoDiscard();
		emptyDeckIntoDiscard();
		
		// Third cycle - should still work
		driver.drawCards(7, rng);
		expect(driver.hand.length).toBe(7);
		expect(driver.deck?.size).toBe(3);
	});

	test('should not draw more cards than available even with reshuffling', () => {
		driver.deck = new Deck('small', 'Small Deck', testCards.slice(0, 3));

		driver.drawCards(5, rng);
		expect(driver.hand.length).toBe(3);
		
		// Try to draw more when deck and discard are empty
		driver.drawCards(2, rng);
		expect(driver.hand.length).toBe(3);
	});

	test('should reshuffle mid-draw if needed', () => {
		// Draw 7 cards, leaving 3 in deck
		driver.drawCards(7, rng);
		
		// Discard 5 cards
		for (let i = 0; i < 5; i++) {
			const card = driver.hand.pop();
			if (card) driver.discard.push(card);
		}
		expect(driver.hand.length).toBe(2);
		expect(driver.discard.length).toBe(5);
		expect(driver.deck?.size).toBe(3);
		
		// Try to draw 5 cards - should draw 3 from deck, reshuffle, then draw 2 more
		driver.drawCards(5, rng);
		expect(driver.hand.length).toBe(7); // 2 + 5
		expect(driver.deck?.size).toBe(3); // 5 reshuffled - 2 drawn
		expect(driver.discard.length).toBe(0);
	});

	test('should maintain card identity through reshuffling', () => {
		// Track specific cards
		const firstCard = testCards[0];
		const lastCard = testCards[9];
		const seenCardNames = (): string[] => [...driver.hand, ...driver.discard].map(c => c.name);
		
		// Draw all cards (the last three burn past the hand limit)
		driver.drawCards(10, rng);
		
		// Verify we have the expected cards
		expect(seenCardNames()).toContain(firstCard.name);
		expect(seenCardNames()).toContain(lastCard.name);
		
		// Discard and reshuffle
		driver.discardHand();
		driver.drawCards(10, rng);
		
		// Should still have the same cards
		expect(seenCardNames()).toContain(firstCard.name);
		expect(seenCardNames()).toContain(lastCard.name);
	});

	test('should shuffle the deck when reshuffling', () => {
		// Record the order of the unshuffled deck
		driver.drawCards(5, rng);
		const firstDrawOrder = driver.hand.map(c => c.name);
		driver.discardHand();
		driver.drawCards(5, rng);
		firstDrawOrder.push(...driver.hand.map(c => c.name));
		driver.discardHand();
		
		// Do multiple reshuffles to find at least one different order
		let foundDifferentOrder = false;
		for (let attempt = 0; attempt < 20; attempt++) {
			driver.drawCards(5, rng);
			const currentOrder = driver.hand.map(c => c.name);
			driver.discardHand();
			driver.drawCards(5, rng);
			currentOrder.push(...driver.hand.map(c => c.name));
			driver.discardHand();
			
			if (currentOrder.some((name, i) => name !== firstDrawOrder[i])) {
				foundDifferentOrder = true;
				break;
			}
		}
		
		// The seed fixes the draws, so this holds on every run once it holds;
		// a fair shuffle of 10 cards repeats an order once in 3.6 million
		expect(foundDifferentOrder).toBe(true);
	});

	/** Every card dealt over `turns` draws of 5, by name, the hand discarded after each */
	const dealOrder = (dealt: Driver, stream: Rng, turns: number): string[] => {
		const names: string[] = [];
		for (let turn = 0; turn < turns; turn++) {
			dealt.drawCards(5, stream);
			names.push(...dealt.hand.map(c => c.name));
			dealt.discardHand();
		}
		return names;
	};

	test('reshuffles the same way from the same seed, and another way from another', () => {
		// Eight turns of five from ten cards: three reshuffles after the opening order
		const deal = (seed: number): string[] => dealOrder(driverWith(testCards.map(card => card.copy())), new Rng({ seed }), 8);

		expect(deal(1)).toEqual(deal(1));
		expect(deal(1)).not.toEqual(deal(2));
	});

	test('shuffles a copy, so listeners hear it and an earlier read keeps its order', () => {
		const deck = new Deck('test', 'Test Deck', testCards);
		const before = deck.cards;
		const snapshot = deck.getState().cards;
		const order = before.map(c => c.name);
		const cardsChanged = jest.fn();
		const changed = jest.fn();
		deck.on('cards', cardsChanged);
		deck.on('change', changed);

		// Rng.shuffle works in place; shuffling the deck's own array would move
		// the earlier reads and leave the setter nothing new to announce
		deck.shuffle(new Rng({ seed: 1 }));

		expect(cardsChanged).toHaveBeenCalledTimes(1);
		expect(changed).toHaveBeenCalledTimes(1);
		expect(deck.cards).not.toBe(before);
		expect(deck.cards.map(c => c.name)).not.toEqual(order);
		expect(before.map(c => c.name)).toEqual(order);
		expect(snapshot.map(c => c.name)).toEqual(order);
	});
});