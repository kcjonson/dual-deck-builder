import { describeValue } from '../core/Json';
import { ReaderRangeError, ReaderTypeError, readArray, readFields, readText } from '../core/JsonReader';
import { escortNumber } from '../mechanics/Convoy';
import { CardCounts, NO_CARDS, addCounts, cardCount, readCardCounts, readCardType, totalCards } from './CardCounts';
import { DriverRecord, readPoolDriver } from './DriverRecord';

/** An escort card as a save holds it. */
export interface EscortCardJson {
	cardType: string;
	/** The escort's `escort-<n>`, as a dealt copy's `Card.broughtBy` holds it */
	broughtBy: string;
}

/**
 * A signature order card an escort that came along brought into a run deck
 * (Compound and Supply Runs, At load out): locked there, outside the deck
 * limits, and gone when the run ends or its escort is lost. Not the
 * compound's, so `Campaign.cardsOwned` never counts it.
 */
export type EscortCard = Readonly<EscortCardJson>;

export interface RunDeckData {
	/** The seated driver whose run deck it is */
	driver: DriverRecord;
	/** Their default deck's copies going on the run */
	own: CardCounts;
	/** Their default deck's copies staying home for this run, kept for them */
	leftHome: CardCounts;
	/** Copies borrowed from the locker for this run */
	borrowed: CardCounts;
	/** In escort id order, one per escort that brought one */
	escortCards: readonly EscortCard[];
}

export type RunDeckOptions = Pick<RunDeckData, 'driver'> & Partial<RunDeckData>;

/** A run deck as a save holds it, naming its driver by id. */
export interface RunDeckJson {
	driver: string;
	own: Record<string, number>;
	leftHome: Record<string, number>;
	borrowed: Record<string, number>;
	escortCards: EscortCardJson[];
}

const JSON_FIELDS: readonly (keyof RunDeckJson)[] = ['driver', 'own', 'leftHome', 'borrowed', 'escortCards'];

/**
 * A seated driver's deck for one run (Compound and Supply Runs, At load out
 * and After the run). While a run is out it holds their whole default deck,
 * split between the copies going (`own`) and the ones left at home
 * (`leftHome`), with what they borrowed from the locker and the signature
 * cards escorts brought. Unwinding puts `own` and `leftHome` back in the
 * default deck and `borrowed` back in the locker; a driver who dies takes
 * `own` and `borrowed` with them.
 *
 * Immutable: the campaign replaces a run deck on every change, and as a
 * `CardPlace` any snapshot stands for its driver's run deck as it is now.
 */
export class RunDeck implements Readonly<RunDeckData> {
	public readonly driver: DriverRecord;
	public readonly own: CardCounts;
	public readonly leftHome: CardCounts;
	public readonly borrowed: CardCounts;
	public readonly escortCards: readonly EscortCard[];

	constructor({ driver, own = NO_CARDS, leftHome = NO_CARDS, borrowed = NO_CARDS, escortCards = [] }: RunDeckOptions) {
		const data = readRunDeckData({ driver, own, leftHome, borrowed, escortCards }, 'RunDeck');
		this.driver = data.driver;
		this.own = data.own;
		this.leftHome = data.leftHome;
		this.borrowed = data.borrowed;
		this.escortCards = data.escortCards;
		Object.freeze(this);
	}

	/** What the deck rules count and a fight deals besides the escort cards: the driver's own copies going, and what they borrowed. */
	public get cards(): CardCounts {
		return addCounts(this.own, this.borrowed);
	}

	/** Cards against the deck size limits, which escort cards sit outside. */
	public get deckSize(): number {
		return totalCards(this.own) + totalCards(this.borrowed);
	}

	/** The default deck this run deck holds, going or left at home, which unwinding gives back. */
	public get defaultDeck(): CardCounts {
		return addCounts(this.own, this.leftHome);
	}

	/**
	 * Whether it differs from the default deck it was copied from: anything
	 * left at home or borrowed, which Reset to default undoes, and which load
	 * out's CUSTOM tag marks. Escort cards don't count.
	 */
	public get isCustomized(): boolean {
		return totalCards(this.leftHome) > 0 || totalCards(this.borrowed) > 0;
	}

	/** This run deck with these changes, checked. */
	public with(changes: Partial<Omit<RunDeckData, 'driver'>>): RunDeck {
		return new RunDeck({
			driver: this.driver,
			own: this.own,
			leftHome: this.leftHome,
			borrowed: this.borrowed,
			escortCards: this.escortCards,
			...changes
		});
	}

	public toJSON(): RunDeckJson {
		return {
			driver: this.driver.id,
			own: { ...this.own },
			leftHome: { ...this.leftHome },
			borrowed: { ...this.borrowed },
			escortCards: this.escortCards.map(card => ({ ...card }))
		};
	}
}

/**
 * A saved run deck, its driver found by id among the campaign's drivers.
 * Errors name where in the save it was.
 */
export function readRunDeckJson(value: unknown, path: string, drivers: readonly DriverRecord[]): RunDeck {
	const fields = readFields(value, path, JSON_FIELDS);
	const driver = readPoolDriver(fields.driver, `${path}.driver`, drivers);
	const data = readRunDeckData({ ...fields, driver }, path);
	return new RunDeck(data);
}

/**
 * A run deck's fields checked. No card is both left at home and borrowed:
 * the driver's own come back before anything's borrowed, and borrowed
 * copies go back before their own stay home, so no move makes one.
 */
function readRunDeckData(value: Record<keyof RunDeckData, unknown>, path: string): RunDeckData {
	if (!(value.driver instanceof DriverRecord)) throw new ReaderTypeError(`${path}.driver must be a DriverRecord, got ${describeValue(value.driver)}`);
	const leftHome = readCardCounts(value.leftHome, `${path}.leftHome`);
	const borrowed = readCardCounts(value.borrowed, `${path}.borrowed`);
	for (const cardType of Object.keys(borrowed)) {
		const home = cardCount(leftHome, cardType);
		if (home > 0) throw new ReaderRangeError(`${path}.borrowed.${cardType} can't be borrowed while ${home} of the driver's own are left at home, which come back first`);
	}
	return {
		driver: value.driver,
		own: readCardCounts(value.own, `${path}.own`),
		leftHome,
		borrowed,
		escortCards: readEscortCards(value.escortCards, `${path}.escortCards`)
	};
}

/** Escort cards with `escort-<n>` ids, one per escort, frozen in id order so equal decks write the same JSON. */
function readEscortCards(value: unknown, path: string): readonly EscortCard[] {
	const cards = Array.from(readArray(value, path), (card, index) => {
		const at = `${path}[${index}]`;
		const fields = readFields(card, at, ['cardType', 'broughtBy']);
		const broughtBy = readText(fields.broughtBy, `${at}.broughtBy`);
		const number = escortNumber(broughtBy);
		if (number === null) throw new ReaderRangeError(`${at}.broughtBy must look like escort-1, got ${describeValue(broughtBy)}`);
		return { card: Object.freeze({ cardType: readCardType(fields.cardType, `${at}.cardType`), broughtBy }), number, at };
	});
	const numbers = new Set<number>();
	for (const { card, number, at } of cards) {
		if (numbers.has(number)) throw new ReaderRangeError(`${at}.broughtBy ${card.broughtBy} brought an earlier card here; an escort brings one`);
		numbers.add(number);
	}
	return Object.freeze(cards.sort((first, second) => first.number - second.number).map(({ card }) => card));
}
