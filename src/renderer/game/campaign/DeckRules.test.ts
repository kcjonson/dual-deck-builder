import cardsFile from '../data/cards.json';
import deckRulesFile from '../data/deck-rules.json';
import { CardCounts, startingDeckCounts, totalCards } from './CardCounts';
import { DECK_RULES, cardArchetype, deckAddBlocker, deckRemoveBlocker, readCardArchetypes, readDeckRules } from './DeckRules';
import { DRIVER_ARCHETYPES } from './DriverRecord';

type RulesJson = Record<string, unknown>;

const read = (json: unknown) => readDeckRules(json, 'DeckRules');

/** The shipped file with one change made to it. */
const damaged = (change: (json: RulesJson) => void): RulesJson => {
	const json: RulesJson = JSON.parse(JSON.stringify(deckRulesFile));
	change(json);
	return json;
};

const { min, max } = DECK_RULES.deckSize;

/** A deck of `size` repair kits, a card anyone can take. */
const deckOf = (size: number): CardCounts => (size === 0 ? {} : { repair_kit: size });

/** A cards file holding these cards, each with only the fields the reader looks at. */
const cardsWith = (...cards: Record<string, unknown>[]) => ({ cards });

describe('deck-rules.json', () => {
	it('reads as the deck rules every campaign keeps, frozen', () => {
		expect(read(deckRulesFile)).toEqual(DECK_RULES);
		expect(Object.isFrozen(DECK_RULES)).toBe(true);
		expect(Object.isFrozen(DECK_RULES.deckSize)).toBe(true);
	});

	it('takes a minimum and maximum that are the same, a deck of exactly that size', () => {
		expect(read(damaged(json => { json.deckSize = { min: 10, max: 10 }; })).deckSize).toEqual({ min: 10, max: 10 });
	});

	it.each([
		['an unknown field', (json: RulesJson) => { json.handLimit = 7; }, 'DeckRules has an unknown field "handLimit"'],
		['no deck size', (json: RulesJson) => { delete json.deckSize; }, 'DeckRules.deckSize is missing'],
		['no maximum', (json: RulesJson) => { json.deckSize = { min: 8 }; }, 'DeckRules.deckSize.max is missing'],
		['a minimum of 0, a deck with nothing to draw', (json: RulesJson) => { json.deckSize = { min: 0, max: 20 }; }, 'DeckRules.deckSize.min must be an integer >= 1, got 0'],
		['a maximum below the minimum', (json: RulesJson) => { json.deckSize = { min: 8, max: 7 }; }, 'DeckRules.deckSize.max must be an integer >= 8, got 7'],
		['a size in a string', (json: RulesJson) => { json.deckSize = { min: '8', max: 20 }; }, 'DeckRules.deckSize.min must be a number, got "8"'],
		['scrap below 0', (json: RulesJson) => { json.scrapPerCard = -1; }, 'DeckRules.scrapPerCard must be an integer >= 0, got -1'],
		['part of a scrap', (json: RulesJson) => { json.scrapPerCard = 2.5; }, 'DeckRules.scrapPerCard must be an integer >= 0, got 2.5']
	])('rejects %s', (_label, change, message) => {
		expect(() => read(damaged(change))).toThrow(message);
	});
});

describe('card eligibility', () => {
	it('reads each card cards.json marks for an archetype, and only those', () => {
		const marked = cardsFile.cards.filter(card => 'driverRestriction' in card && card.driverRestriction !== null);

		expect([...readCardArchetypes(cardsFile, 'cards.json')]).toEqual(marked.map(card => [card.type, (card as { driverRestriction: string }).driverRestriction]));
		expect(cardArchetype('precision_shot')).toBe('interceptor');
	});

	it.each([
		['marked for nobody', 'berserker'],
		['with no mark at all', 'headshot'],
		['that cards.json doesn\'t list', 'no_such_card']
	])('lets any driver take a card %s', (_label, cardType) => {
		expect(cardArchetype(cardType)).toBeNull();
	});

	it.each([
		['an archetype that doesn\'t exist', cardsWith({ type: 'scrap_shot', driverRestriction: 'mutant' }),
			'cards.cards[0].driverRestriction must be one of road_warrior, interceptor, mechanic, raider, got "mutant"'],
		['a mark that isn\'t a string', cardsWith({ type: 'scrap_shot', driverRestriction: ['raider'] }), 'cards.cards[0].driverRestriction must be a string, got ["raider"]'],
		['two cards of one type', cardsWith({ type: 'scrap_shot' }, { type: 'scrap_shot', driverRestriction: 'raider' }), 'cards.cards[1].type scrap_shot belongs to an earlier card'],
		['a card type in title case', cardsWith({ type: 'Scrap Shot' }), 'cards.cards[0].type must be a card type in lower snake case, got "Scrap Shot"'],
		['no list of cards', {}, 'cards.cards must be an array, got undefined']
	])('rejects a cards file with %s', (_label, file, message) => {
		expect(() => readCardArchetypes(file, 'cards')).toThrow(message);
	});
});

describe('a deck', () => {
	it.each(DRIVER_ARCHETYPES)('starts a %s within the size limits, holding only cards they can take', (archetype) => {
		const deck = startingDeckCounts(archetype);

		expect(totalCards(deck)).toBeGreaterThanOrEqual(min);
		expect(totalCards(deck)).toBeLessThanOrEqual(max);
		for (const cardType of Object.keys(deck)) expect([cardType, cardArchetype(cardType) ?? archetype]).toEqual([cardType, archetype]);
	});

	it('takes cards up to the most it holds, and no further', () => {
		expect(deckAddBlocker({ deck: deckOf(max - 2), archetype: 'mechanic', cardType: 'headshot', count: 2 })).toBeNull();
		expect(deckAddBlocker({ deck: deckOf(max - 1), archetype: 'mechanic', cardType: 'headshot', count: 2 })).toEqual({ reason: 'deck_full', max });
		expect(deckAddBlocker({ deck: deckOf(max), archetype: 'mechanic', cardType: 'headshot', count: 1 })).toEqual({ reason: 'deck_full', max });
	});

	it('gives cards up down to the fewest it holds, and no further', () => {
		expect(deckRemoveBlocker({ deck: deckOf(min + 2), count: 2 })).toBeNull();
		expect(deckRemoveBlocker({ deck: deckOf(min + 1), count: 2 })).toEqual({ reason: 'deck_at_minimum', min });
		expect(deckRemoveBlocker({ deck: deckOf(min), count: 1 })).toEqual({ reason: 'deck_at_minimum', min });
	});

	it('outside the limits, moves only toward them', () => {
		expect(deckAddBlocker({ deck: deckOf(min - 3), archetype: 'raider', cardType: 'headshot', count: 1 })).toBeNull();
		expect(deckRemoveBlocker({ deck: deckOf(min - 3), count: 1 })).toEqual({ reason: 'deck_at_minimum', min });
		expect(deckRemoveBlocker({ deck: deckOf(max + 3), count: 1 })).toBeNull();
		expect(deckAddBlocker({ deck: deckOf(max + 3), archetype: 'raider', cardType: 'headshot', count: 1 })).toEqual({ reason: 'deck_full', max });
	});

	it('takes a card marked for its archetype, and refuses one marked for another before it counts', () => {
		expect(deckAddBlocker({ deck: deckOf(min), archetype: 'interceptor', cardType: 'precision_shot', count: 1 })).toBeNull();
		expect(deckAddBlocker({ deck: deckOf(max), archetype: 'road_warrior', cardType: 'precision_shot', count: 1 }))
			.toEqual({ reason: 'other_archetype', archetype: 'interceptor' });
	});
});
