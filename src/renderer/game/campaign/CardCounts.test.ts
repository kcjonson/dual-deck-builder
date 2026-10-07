import { DRIVER_CONFIGS } from '../mechanics/Driver';
import { NO_CARDS, addCards, cardCount, readCardCounts, removeCards, startingDeckCounts, totalCards } from './CardCounts';
import { DRIVER_ARCHETYPES } from './DriverRecord';

describe('card counts', () => {
	it.each(DRIVER_ARCHETYPES)('hold every copy of the %s starting deck', (archetype) => {
		const configured = DRIVER_CONFIGS[archetype].startingDeck.cards;
		const counts = startingDeckCounts(archetype);

		expect(totalCards(counts)).toBe(configured.reduce((total, { quantity }) => total + quantity, 0));
		for (const { type } of configured) {
			const copies = configured.filter(card => card.type === type).reduce((total, { quantity }) => total + quantity, 0);
			expect([type, cardCount(counts, type)]).toEqual([type, copies]);
		}
	});

	it('add and remove copies without touching the counts they came from', () => {
		const deck = startingDeckCounts('mechanic');

		const added = addCards(deck, 'headshot', 2);
		const removed = removeCards(added, 'repair_kit');

		expect(cardCount(deck, 'headshot')).toBe(0);
		expect(cardCount(added, 'headshot')).toBe(2);
		expect(cardCount(removed, 'repair_kit')).toBe(cardCount(deck, 'repair_kit') - 1);
		expect(totalCards(removed)).toBe(totalCards(deck) + 1);
	});

	it('drop a card type with its last copy, so no count is ever 0', () => {
		const counts = removeCards(addCards(NO_CARDS, 'emp_blast'), 'emp_blast');

		expect(counts).toEqual({});
		expect(Object.keys(counts)).toEqual([]);
	});

	it('refuse to remove copies that are not there', () => {
		const counts = addCards(NO_CARDS, 'emp_blast', 2);

		expect(() => removeCards(counts, 'emp_blast', 3)).toThrow("Can't take 3 emp_blast from 2");
		expect(() => removeCards(counts, 'headshot')).toThrow("Can't take 1 headshot from 0");
		expect(() => removeCards(counts, 'emp_blast', 0)).toThrow('count must be an integer >= 1, got 0');
		expect(() => addCards(counts, 'emp_blast', 1.5)).toThrow('count must be an integer >= 1, got 1.5');
		expect(() => addCards(counts, 'EMP Blast')).toThrow('cardType must be a card type in lower snake case, got "EMP Blast"');
		expect(() => addCards(counts, 7 as unknown as string)).toThrow('cardType must be a card type, got 7');
	});

	it('keep their keys sorted and frozen, so the same counts always write the same JSON', () => {
		const first = addCards(addCards(NO_CARDS, 'repair_kit'), 'armor_plating', 2);
		const second = addCards(addCards(NO_CARDS, 'armor_plating', 2), 'repair_kit');

		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
		expect(Object.keys(readCardCounts({ repair_kit: 1, armor_plating: 2, emp_blast: 1 }, 'deck'))).toEqual(['armor_plating', 'emp_blast', 'repair_kit']);
		expect(Object.isFrozen(first)).toBe(true);
	});

	it('come back as they are when they are already canonical', () => {
		const counts = startingDeckCounts('road_warrior');

		expect(readCardCounts(counts, 'deck')).toBe(counts);
	});

	it('never read a count off Object.prototype', () => {
		expect(cardCount(NO_CARDS, 'constructor')).toBe(0);
		expect(cardCount(NO_CARDS, 'toString')).toBe(0);
		expect(totalCards(NO_CARDS)).toBe(0);
	});

	it.each([
		['an array', [], 'deck must be an object, got []'],
		['null', null, 'deck must be an object, got null'],
		['a count of 0', { repair_kit: 0 }, 'deck.repair_kit must be an integer >= 1, got 0'],
		['a fractional count', { repair_kit: 1.5 }, 'deck.repair_kit must be an integer >= 1, got 1.5'],
		['a count in a string', { repair_kit: '2' }, 'deck.repair_kit must be a number, got "2"'],
		['a card name for a key', { 'Repair Kit': 1 }, 'deck has a key that isn\'t a card type: "Repair Kit"'],
		['a __proto__ key', JSON.parse('{"__proto__": 1}'), 'deck has a key that isn\'t a card type: "__proto__"']
	])('reject %s', (_label, value, message) => {
		expect(() => readCardCounts(value, 'deck')).toThrow(message);
	});
});
