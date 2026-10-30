import { lookup } from '../testing';
import { cardKind, entryKey, passesFilter } from './cardSource';

describe('cardKind', () => {
	it('files every card under one kind by its first tag, a power card under attack', () => {
		const card = (type: string) => lookup(type) as NonNullable<ReturnType<typeof lookup>>;
		const kinds = ['ram', 'witness_me', 'coordinated_attack', 'armor_plating', 'repair_kit', 'flank', 'covering_fire'].map((type) => cardKind(card(type)));
		expect(kinds).toEqual(['attack', 'attack', 'attack', 'defense', 'utility', 'utility', 'order']);
		expect([passesFilter(card('ram'), 'all'), passesFilter(card('ram'), 'attack'), passesFilter(card('ram'), 'order')]).toEqual([true, true, false]);
	});
});

describe('entryKey', () => {
	it('is the card type unless an entry has a key of its own', () => {
		expect(entryKey({ cardType: 'headshot', copies: 2, controls: [] })).toBe('headshot');
		expect(entryKey({ key: 'headshot_borrowed', cardType: 'headshot', copies: 1, controls: [] })).toBe('headshot_borrowed');
	});
});
