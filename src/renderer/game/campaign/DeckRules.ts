import { ReaderRangeError, readArray, readFields, readInteger, readNullable, readObject, readOneOf, readText } from '../core/JsonReader';
import cardsFile from '../data/cards.json';
import deckRulesFile from '../data/deck-rules.json';
import type { DriverArchetype } from '../mechanics/Driver';
import { CardCounts, readCardCounts, readCardType, totalCards } from './CardCounts';
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

/** What the campaign reads of each card in a cards file. */
export interface CatalogueCard {
	/** What the log calls it */
	readonly name: string;
	/** The archetype its `driverRestriction` marks it for, or null for a card any driver can take */
	readonly archetype: DriverArchetype | null;
	/** The escort type whose signature order it is, or null. One comes with its escort and is never the compound's (Card System Design 1.3). */
	readonly signatureOf: string | null;
}

/**
 * Each card in a cards file, by card type: its name, the archetype it's
 * marked for, and the escort it's the signature of. A `driverRestriction`
 * or `signatureOf` left out is null. Checks only what the campaign reads;
 * `CardLoader` checks the rest of a card when it loads the file.
 */
export function readCardCatalogue(value: unknown, path: string): ReadonlyMap<string, CatalogueCard> {
	const cards = readArray(readObject(value, path).cards, `${path}.cards`);
	const catalogue = new Map<string, CatalogueCard>();
	cards.forEach((card, index) => {
		const at = `${path}.cards[${index}]`;
		const fields = readObject(card, at);
		const type = readCardType(fields.type, `${at}.type`);
		if (catalogue.has(type)) throw new ReaderRangeError(`${at}.type ${type} belongs to an earlier card`);
		catalogue.set(type, Object.freeze({
			name: readText(fields.name, `${at}.name`),
			archetype: readNullable(fields.driverRestriction ?? null, `${at}.driverRestriction`, (restriction, restrictionPath) =>
				readOneOf(restriction, restrictionPath, DRIVER_ARCHETYPES)),
			signatureOf: readNullable(fields.signatureOf ?? null, `${at}.signatureOf`, readText)
		}));
	});
	return catalogue;
}

/** The shipped rules, read as this module loads, so a bad edit to the file fails straight away. */
export const DECK_RULES: DeckRules = readDeckRules(deckRulesFile, 'DeckRules');

/**
 * Read from the bundled cards.json as this module loads, since the campaign
 * checks eligibility and new copies synchronously, and `CardLoader` loads
 * asynchronously.
 */
const CARD_CATALOGUE = readCardCatalogue(cardsFile, 'cards.json');

/** The archetype a card is marked for, or null for a card any driver can take, a type cards.json doesn't list included. */
export function cardArchetype(cardType: string): DriverArchetype | null {
	return CARD_CATALOGUE.get(cardType)?.archetype ?? null;
}

/**
 * Whether a card is marked for an archetype other than `archetype`, so it
 * can never go in that driver's deck, whatever else would refuse it first:
 * the deck builders fade it.
 */
export function isForOtherArchetype({ cardType, archetype }: { cardType: string; archetype: DriverArchetype }): boolean {
	const marked = cardArchetype(cardType);
	return marked !== null && marked !== archetype;
}

/** What the log calls a card: its name in cards.json, or its card type for one the file no longer lists. */
export function cardName(cardType: string): string {
	return CARD_CATALOGUE.get(cardType)?.name ?? cardType;
}

/**
 * New copies for the compound (cards won on a run, or bought in the garage)
 * checked: card counts, every card one cards.json lists, and none an
 * escort's signature card, which comes with its escort and never goes in the
 * locker or a default deck. Throws a RangeError naming the card otherwise.
 * Copies the compound already holds are checked for shape only, so a save
 * holding a card the file has since dropped still loads and plays.
 */
export function readNewCards(value: unknown, path: string): CardCounts {
	const counts = readCardCounts(value, path);
	for (const cardType of Object.keys(counts)) {
		const card = CARD_CATALOGUE.get(cardType);
		if (card === undefined) throw new RangeError(`${path}.${cardType} isn't a card in cards.json`);
		if (card.signatureOf !== null) {
			throw new RangeError(`${path}.${cardType} is the signature card of the ${card.signatureOf} escort, which comes with it and is never the compound's`);
		}
	}
	return counts;
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
	if (isForOtherArchetype({ cardType, archetype })) return { reason: 'other_archetype', archetype: cardArchetype(cardType) as DriverArchetype };
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
