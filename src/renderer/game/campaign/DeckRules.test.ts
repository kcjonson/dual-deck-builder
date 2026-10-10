import cardsFile from '../data/cards.json';
import deckRulesFile from '../data/deck-rules.json';
import { CardCounts, startingDeckCounts, totalCards } from './CardCounts';
import { DECK_RULES, cardArchetype, cardName, deckAddBlocker, deckRemoveBlocker, isForOtherArchetype, readCardCatalogue, readDeckRules, readNewCards } from './DeckRules';
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

/** A cards file holding these cards, each with only the fields the reader looks at, named Scrap Shot unless it says otherwise. */
const cardsWith = (...cards: Record<string, unknown>[]) => ({ cards: cards.map(card => ({ name: 'Scrap Shot', ...card })) });

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

describe('the card catalogue', () => {
	it('reads every card in cards.json with its name, the archetype it\'s marked for, and the escort it\'s the signature of', () => {
		const catalogue = readCardCatalogue(cardsFile, 'cards.json');
		const marked = (field: 'driverRestriction' | 'signatureOf') => cardsFile.cards
			.filter(card => field in card && (card as Record<string, unknown>)[field] !== null)
			.map(card => [card.type, (card as Record<string, unknown>)[field]]);

		expect([...catalogue.keys()]).toEqual(cardsFile.cards.map(card => card.type));
		expect([...catalogue].filter(([, card]) => card.archetype !== null).map(([type, card]) => [type, card.archetype])).toEqual(marked('driverRestriction'));
		expect([...catalogue].filter(([, card]) => card.signatureOf !== null).map(([type, card]) => [type, card.signatureOf])).toEqual(marked('signatureOf'));
		expect(catalogue.get('repair_kit')).toEqual({ name: 'Repair Kit', archetype: null, signatureOf: null });
		expect(cardArchetype('precision_shot')).toBe('interceptor');
		expect([cardName('repair_kit'), cardName('no_such_card')]).toEqual(['Repair Kit', 'no_such_card']);
	});

	it('takes new copies of any card the compound can own, and no escort\'s signature card or card cards.json doesn\'t list', () => {
		expect(readNewCards({ precision_shot: 1, repair_kit: 2 }, 'cardsWon')).toEqual({ precision_shot: 1, repair_kit: 2 });
		expect(() => readNewCards({ repair_kit: 1, no_such_card: 1 }, 'cardsWon')).toThrow("cardsWon.no_such_card isn't a card in cards.json");
		expect(() => readNewCards({ top_off: 1 }, 'cardsWon'))
			.toThrow("cardsWon.top_off is the signature card of the fuel_hauler escort, which comes with it and is never the compound's");
		expect(() => readNewCards({ repair_kit: 0 }, 'cardsWon')).toThrow('cardsWon.repair_kit must be an integer >= 1, got 0');
	});

	it.each([
		['an archetype that doesn\'t exist', cardsWith({ type: 'scrap_shot', driverRestriction: 'mutant' }),
			'cards.cards[0].driverRestriction must be one of road_warrior, interceptor, mechanic, raider, got "mutant"'],
		['a mark that isn\'t a string', cardsWith({ type: 'scrap_shot', driverRestriction: ['raider'] }), 'cards.cards[0].driverRestriction must be a string, got ["raider"]'],
		['two cards of one type', cardsWith({ type: 'scrap_shot' }, { type: 'scrap_shot', driverRestriction: 'raider' }), 'cards.cards[1].type scrap_shot belongs to an earlier card'],
		['a card type in title case', cardsWith({ type: 'Scrap Shot' }), 'cards.cards[0].type must be a card type in lower snake case, got "Scrap Shot"'],
		['a card with no name', cardsWith({ type: 'scrap_shot', name: undefined }), 'cards.cards[0].name must be a string, got undefined'],
		['a signature of no escort', cardsWith({ type: 'scrap_shot', signatureOf: 7 }), 'cards.cards[0].signatureOf must be a string, got 7'],
		['no list of cards', {}, 'cards.cards must be an array, got undefined']
	])('rejects a cards file with %s', (_label, file, message) => {
		expect(() => readCardCatalogue(file, 'cards')).toThrow(message);
	});
});

describe('card eligibility', () => {
	it.each([
		['marked for nobody', 'berserker'],
		['with no mark at all', 'headshot'],
		['that cards.json doesn\'t list', 'no_such_card']
	])('lets any driver take a card %s', (_label, cardType) => {
		expect(cardArchetype(cardType)).toBeNull();
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

	it('says a card marked for another archetype is for another, and one marked for none is for nobody else', () => {
		expect(isForOtherArchetype({ cardType: 'precision_shot', archetype: 'road_warrior' })).toBe(true);
		expect(isForOtherArchetype({ cardType: 'precision_shot', archetype: 'interceptor' })).toBe(false);
		expect(isForOtherArchetype({ cardType: 'headshot', archetype: 'road_warrior' })).toBe(false);
	});
});
