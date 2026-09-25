import { Driver, DriverRole, HAND_CAP, CardsBurnedEvent } from '../Driver';
import { Deck } from '../Deck';
import { Card } from '../Card';

describe('Hand cap', () => {
	let driver: Driver;

	const createCard = (index: number): Card => new Card({
		type: `card_${index}`,
		name: `Test Card ${index}`,
		description: 'Test card',
		rarity: 'common',
		cost: 1,
		targetType: 'self',
		effects: [],
		tags: ['test']
	});

	beforeEach(() => {
		const cards: Card[] = [];
		for (let i = 1; i <= 12; i++) {
			cards.push(createCard(i));
		}

		driver = new Driver({
			archetype: 'road_warrior',
			metadata: {
				name: 'Test Driver',
				vehicleName: 'Test Vehicle',
				specialty: 'TEST',
				flavorText: 'Test driver',
				unlocked: true
			},
			skills: { ramming: 5, gunnery: 5, evade: 5 },
			vehicleStats: { maxStructure: 10, weight: 1, armor: 0, speed: 1, gunnery: 1, evade: 1 },
			startingDeck: { cards: [] },
			hitpoints: 5,
			maxHitpoints: 5,
			adrenaline: 5,
			maxAdrenaline: 5,
			role: DriverRole.ACTIVE,
			hand: [],
			discard: [],
			deck: new Deck('test', 'Test Deck', cards)
		});
	});

	test('the cap is 7 cards', () => {
		expect(HAND_CAP).toBe(7);
	});

	test('draws up to the cap go to the hand without a burn', () => {
		const burnSpy = jest.fn();
		driver.on('cardsBurned', burnSpy);

		const result = driver.drawCards(HAND_CAP);

		expect(driver.hand.length).toBe(HAND_CAP);
		expect(result.drawn).toHaveLength(HAND_CAP);
		expect(result.burned).toHaveLength(0);
		expect(burnSpy).not.toHaveBeenCalled();
	});

	test('a turn draw into a hand of 5 keeps 2 and burns 3 to discard', () => {
		driver.drawCards(5);
		const burnSpy = jest.fn();
		driver.on('cardsBurned', burnSpy);

		const result = driver.drawCards(5);

		expect(driver.hand.length).toBe(HAND_CAP);
		expect(result.drawn).toHaveLength(2);
		expect(result.burned).toHaveLength(3);
		expect(driver.discard).toEqual(result.burned);
		expect(driver.deck?.size).toBe(2);

		expect(burnSpy).toHaveBeenCalledTimes(1);
		const event: CardsBurnedEvent = burnSpy.mock.calls[0][0];
		expect(event.cards).toEqual(result.burned);
	});
});
