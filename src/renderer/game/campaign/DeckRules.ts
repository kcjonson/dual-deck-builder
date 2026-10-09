import { ReaderRangeError, readArray, readFields, readInteger, readNullable, readObject, readOneOf } from '../core/JsonReader';
import cardsFile from '../data/cards.json';
import deckRulesFile from '../data/deck-rules.json';
import type { DriverArchetype } from '../mechanics/Driver';
import { CardCounts, readCardType, totalCards } from './CardCounts';
import { DRIVER_ARCHETYPES } from './DriverRecord';

/**
 * The rules every deck keeps (Compound and Supply Runs, Decks and the
 * locker), kept in `data/deck-rules.json` so they tune without a code
 * change. The size limits are provisional (DDB-317), and so is the scrap.
 */
export interface DeckRules {
	/** The fewest and the most cards a deck holds, at home and on a run. */
	deckSize: Readonly<{ min: number; max: number }>;
	/** Scrap the compound gets for each copy it scraps from the locker. */
	scrapPerCard: number;
}

/**
 * Why a deck refuses a change, which a screen shows on the action it
 * disables: the card is marked for another archetype, the deck would hold
 * more than the most it takes, or fewer than the fewest.
 */
export type DeckBlocker =
	| { reason: 'other_archetype'; archetype: DriverArchetype }
	| { reason: 'deck_full'; max: number }
	| { reason: 'deck_at_minimum'; min: number };

/**
 * Deck rules checked: exactly these fields, a minimum of at least 1, a
 * maximum no lower than it, and a whole number of scrap from 0. Comes back
 * frozen, with errors naming the path.
 */
export function readDeckRules(value: unknown, path: string): DeckRules {
	const fields = readFields(value, path, ['deckSize', 'scrapPerCard']);
	const size = readFields(fields.deckSize, `${path}.deckSize`, ['min', 'max']);
	const min = readInteger(size.min, `${path}.deckSize.min`, { min: 1 });
	const max = readInteger(size.max, `${path}.deckSize.max`, { min });
	return Object.freeze({
		deckSize: Object.freeze({ min, max }),
		scrapPerCard: readInteger(fields.scrapPerCard, `${path}.scrapPerCard`, { min: 0 })
	});
}

/**
 * The archetype each card in a cards file is marked for, by card type. A
 * card's `driverRestriction` names one archetype, or is null or left out
 * for a card any driver can take, which the map leaves out.
 */
export function readCardArchetypes(value: unknown, path: string): ReadonlyMap<string, DriverArchetype> {
	const cards = readArray(readObject(value, path).cards, `${path}.cards`);
	const archetypes = new Map<string, DriverArchetype>();
	const types = new Set<string>();
	cards.forEach((card, index) => {
		const at = `${path}.cards[${index}]`;
		const fields = readObject(card, at);
		const type = readCardType(fields.type, `${at}.type`);
		if (types.has(type)) throw new ReaderRangeError(`${at}.type ${type} belongs to an earlier card`);
		types.add(type);
		const archetype = readNullable(fields.driverRestriction ?? null, `${at}.driverRestriction`, (restriction, restrictionPath) =>
			readOneOf(restriction, restrictionPath, DRIVER_ARCHETYPES));
		if (archetype !== null) archetypes.set(type, archetype);
	});
	return archetypes;
}

/** The shipped rules, read as this module loads, so a bad edit to the file fails straight away. */
export const DECK_RULES: DeckRules = readDeckRules(deckRulesFile, 'DeckRules');

/**
 * Read from the bundled cards.json as this module loads, since the campaign
 * checks eligibility synchronously and `CardLoader` loads asynchronously.
 */
const CARD_ARCHETYPES = readCardArchetypes(cardsFile, 'cards.json');

/** The archetype a card is marked for, or null for a card any driver can take, a type cards.json doesn't list included. */
export function cardArchetype(cardType: string): DriverArchetype | null {
	return CARD_ARCHETYPES.get(cardType) ?? null;
}

/**
 * Why a deck of a driver of `archetype` can't take `count` more copies of a
 * card, or null if it can: the card is marked for another archetype, or the
 * deck would go past the most it holds. A deck under the fewest can always
 * take cards that fit, since that moves it toward the limits.
 */
export function deckAddBlocker({ deck, archetype, cardType, count }: {
	deck: CardCounts;
	archetype: DriverArchetype;
	cardType: string;
	count: number;
}): DeckBlocker | null {
	const marked = cardArchetype(cardType);
	if (marked !== null && marked !== archetype) return { reason: 'other_archetype', archetype: marked };
	const { max } = DECK_RULES.deckSize;
	return totalCards(deck) + count > max ? { reason: 'deck_full', max } : null;
}

/**
 * Why a deck can't give up `count` copies, or null if it can: it would hold
 * fewer than the fewest. A deck over the most can give cards up toward it.
 */
export function deckRemoveBlocker({ deck, count }: { deck: CardCounts; count: number }): DeckBlocker | null {
	const { min } = DECK_RULES.deckSize;
	return totalCards(deck) - count < min ? { reason: 'deck_at_minimum', min } : null;
}
