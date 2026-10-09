import { ReaderRangeError, ReaderTypeError, describeValue, readInteger, readObject } from '../core/JsonReader';
import { DRIVER_CONFIGS, DriverArchetype } from '../mechanics/Driver';

/**
 * Copies of each card, by card type (`ramming_speed`): a driver's default
 * deck, or the compound's locker. A type with no copies there has no key,
 * so every count is a positive integer. Counts are frozen with their keys in
 * sorted order, so equal counts always write the same JSON. Read a count
 * with `cardCount`, which never sees `Object.prototype`.
 */
export type CardCounts = Readonly<Record<string, number>>;

export const NO_CARDS: CardCounts = Object.freeze({});

/** Card types as cards.json writes them: lower snake case, starting with a letter. */
const CARD_TYPE = /^[a-z][a-z0-9_]*$/;

export function readCardType(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new ReaderTypeError(`${path} must be a card type, got ${describeValue(value)}`);
	if (!CARD_TYPE.test(value)) throw new ReaderRangeError(`${path} must be a card type in lower snake case, got ${describeValue(value)}`);
	return value;
}

/**
 * Counts checked and made canonical: card-type keys, positive integer
 * counts, sorted and frozen. Counts already in that form come back as they
 * are, so checking them again doesn't make a new object.
 */
export function readCardCounts(value: unknown, path: string): CardCounts {
	const object = readObject(value, path);
	const types = Object.keys(object);
	const counts = new Map<string, number>();
	for (const type of types) {
		if (!CARD_TYPE.test(type)) throw new ReaderRangeError(`${path} has a key that isn't a card type: ${describeValue(type)}`);
		counts.set(type, readInteger(object[type], `${path}.${type}`, { min: 1 }));
	}
	const sorted = [...types].sort();
	if (Object.isFrozen(object) && sorted.every((type, index) => type === types[index])) return object as CardCounts;
	return Object.freeze(Object.fromEntries(sorted.map(type => [type, counts.get(type) as number])));
}

export function cardCount(counts: CardCounts, cardType: string): number {
	return Object.prototype.hasOwnProperty.call(counts, cardType) ? counts[cardType] : 0;
}

export function totalCards(counts: CardCounts): number {
	return Object.values(counts).reduce((total, count) => total + count, 0);
}

/** These counts with `count` more copies of a card. */
export function addCards(counts: CardCounts, cardType: string, count = 1): CardCounts {
	readCardType(cardType, 'cardType');
	readInteger(count, 'count', { min: 1 });
	return readCardCounts({ ...counts, [cardType]: cardCount(counts, cardType) + count }, 'counts');
}

/** These counts with `count` fewer copies of a card. Throws if they hold fewer than that. */
export function removeCards(counts: CardCounts, cardType: string, count = 1): CardCounts {
	readCardType(cardType, 'cardType');
	readInteger(count, 'count', { min: 1 });
	const held = cardCount(counts, cardType);
	if (held < count) throw new RangeError(`Can't take ${count} ${cardType} from ${held}`);
	const rest: Record<string, number> = { ...counts };
	if (held === count) delete rest[cardType];
	else rest[cardType] = held - count;
	return readCardCounts(rest, 'counts');
}

/** An archetype's starting deck, from DRIVER_CONFIGS, as counts. */
export function startingDeckCounts(archetype: DriverArchetype): CardCounts {
	return DRIVER_CONFIGS[archetype].startingDeck.cards.reduce(
		(counts, { type, quantity }) => addCards(counts, type, quantity),
		NO_CARDS
	);
}
