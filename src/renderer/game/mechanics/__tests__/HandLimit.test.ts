import { Driver, DriverArchetype, DriverRole, CardsBurnedEvent, DRIVER_CONFIGS } from '../Driver';
import { Deck } from '../Deck';
import { Card } from '../Card';

describe('Hand limit', () => {
	const createCard = (index: number): Card => new Card({
		type: `card_${index}`,
		name: `Test Card ${index}`,
		summary: 'Test card',
		description: 'Test card',
		rarity: 'common',
		cost: 1,
		targetType: 'self',
		effects: [],
		tags: ['test']
	});

	/** A driver with a deck of 12 cards and an empty hand, at their archetype's limit unless given one. */
	const newDriver = ({ archetype = 'road_warrior', handLimit }: { archetype?: DriverArchetype; handLimit?: number } = {}): Driver => new Driver({
		archetype,
		metadata: {
			name: 'Test Driver',
			vehicleName: 'Test Vehicle',
			specialty: 'TEST',
			flavorText: 'Test driver',
			unlocked: true
		},
		skills: { ramming: 5, gunnery: 5, evade: 5, speed: 1 },
		vehicleStats: { maxStructure: 10, weight: 1, armor: 0, speed: 1, gunnery: 1, evade: 1 },
		startingDeck: { cards: [] },
		hitpoints: 5,
		maxHitpoints: 5,
		adrenaline: 5,
		maxAdrenaline: 5,
		handLimit,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck('test', 'Test Deck', Array.from({ length: 12 }, (_unused, index) => createCard(index + 1)))
	});

	test('every archetype starts at 7', () => {
		for (const config of Object.values(DRIVER_CONFIGS)) {
			expect(config.handLimit).toBe(7);
		}
	});

	test('a driver takes their archetype\'s limit unless built with their own', () => {
		const replaced = jest.replaceProperty(DRIVER_CONFIGS.interceptor, 'handLimit', 9);
		try {
			expect(newDriver({ archetype: 'interceptor' }).handLimit).toBe(9);
		} finally {
			replaced.restore();
		}
		expect(newDriver().handLimit).toBe(7);
		expect(newDriver({ handLimit: 5 }).handLimit).toBe(5);
	});

	test('draws up to the limit go to the hand without a burn', () => {
		const driver = newDriver();
		const burnSpy = jest.fn();
		driver.on('cardsBurned', burnSpy);

		const result = driver.drawCards(driver.handLimit);

		expect(driver.hand.length).toBe(7);
		expect(result.drawn).toHaveLength(7);
		expect(result.burned).toHaveLength(0);
		expect(burnSpy).not.toHaveBeenCalled();
	});

	test('a turn draw into a hand of 5 keeps 2 and burns 3 to discard', () => {
		const driver = newDriver();
		driver.drawCards(5);
		const burnSpy = jest.fn();
		driver.on('cardsBurned', burnSpy);

		const result = driver.drawCards(5);

		expect(driver.hand.length).toBe(7);
		expect(result.drawn).toHaveLength(2);
		expect(result.burned).toHaveLength(3);
		expect(driver.discard).toEqual(result.burned);
		expect(driver.deck?.size).toBe(2);

		expect(burnSpy).toHaveBeenCalledTimes(1);
		const event: CardsBurnedEvent = burnSpy.mock.calls[0][0];
		expect(event.cards).toEqual(result.burned);
	});

	test.each([4, 9])('a driver with a limit of %i fills to it and burns the rest of a 10 card draw', (handLimit) => {
		const driver = newDriver({ handLimit });

		const result = driver.drawCards(10);

		expect(driver.hand.length).toBe(handLimit);
		expect(result.drawn).toHaveLength(handLimit);
		expect(result.burned).toHaveLength(10 - handLimit);
		expect(driver.discard).toEqual(result.burned);
	});

	test('a limit raised mid-fight lets the next draw past the old one', () => {
		const driver = newDriver();
		driver.drawCards(7);

		driver.handLimit = 8;
		const result = driver.drawCards(2);

		expect(driver.hand.length).toBe(8);
		expect(result.drawn).toHaveLength(1);
		expect(result.burned).toHaveLength(1);
	});

	test('a limit lowered under the hand discards nothing, and every draw burns until the hand is under it', () => {
		const driver = newDriver();
		driver.drawCards(7);

		driver.handLimit = 5;
		expect(driver.hand.length).toBe(7);
		expect(driver.discard).toHaveLength(0);

		const result = driver.drawCards(2);
		expect(driver.hand.length).toBe(7);
		expect(result.drawn).toHaveLength(0);
		expect(result.burned).toHaveLength(2);
	});

	test('a copy keeps the driver\'s own limit', () => {
		expect(newDriver({ handLimit: 9 }).copy().handLimit).toBe(9);
	});
});
