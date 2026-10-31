import type { Card as GameCard } from '../../mechanics/Card';
import type { MiniCardState } from '../Card';

/**
 * A control under a mini card: the Crew screen's Add, Scrap, and Remove, or
 * Customize's one more, one fewer, and Borrow.
 */
export interface CardControl {
	/** Names the control within its entry, and in its id: `add`, `scrap`, `remove`. */
	key: string;
	label: string;
	/** A quiet control, drawn without a box at rest (R12.7's ghost): Scrap beside Add. */
	ghost?: boolean;
	/**
	 * It destroys something, so it takes two presses: the first arms it,
	 * reading "Confirm" as a warning in the same place, and the second on
	 * the same card runs it. Scrap.
	 */
	destructive?: boolean;
	/** Why it's disabled, shown under the entry's controls; null while it's live, unless `disabled` says otherwise. */
	reason: string | null;
	/** Disabled with no line of its own under the card, beside a control whose reason says it all. */
	disabled?: boolean;
	/** What pressing it does. The screen refreshes from the change it makes. */
	run: () => void;
}

/** A card's copies in one place, shown as a mini card stacked to its count, with the controls under it. */
export interface CardEntry {
	/**
	 * Tells entries apart, in ids and when a grid reconciles; the card type
	 * when left out. Customize shows a card's own copies and its borrowed ones
	 * as two stacks of one card type, so it gives each a key of its own.
	 */
	key?: string;
	cardType: string;
	copies: number;
	/** The mini's state against the deck being built (Game Flow 7.0); none when left out. */
	state?: MiniCardState | null;
	/**
	 * A card type whose stack takes focus when this entry goes from under
	 * it: Customize's +N and HOME stacks name their own card, so emptying one
	 * lands on the card's plain stack rather than on a control of whatever
	 * slides into its place.
	 */
	focusHeir?: string;
	controls: readonly CardControl[];
}

/** An entry's key: its own, or its card type. */
export function entryKey(entry: CardEntry): string {
	return entry.key ?? entry.cardType;
}

/**
 * One side of a deck builder, the deck being built or the pool it's built
 * from: the Crew screen's default deck and the locker, or Customize's run
 * deck and the locker after the other seat's borrowing. Read again on every
 * refresh, so a source holds no copy of what it shows.
 */
export interface CardSource {
	entries(): readonly CardEntry[];
}

/** The kinds the locker filters by. */
export type CardFilter = 'all' | 'attack' | 'defense' | 'utility' | 'order';

/** The locker's filter, in the order its segments show. */
export const CARD_FILTERS: readonly { label: string; value: CardFilter }[] = [
	{ label: 'All', value: 'all' },
	{ label: 'Attack', value: 'attack' },
	{ label: 'Defense', value: 'defense' },
	{ label: 'Utility', value: 'utility' },
	{ label: 'Order', value: 'order' },
];

/**
 * A card's kind for the filter, from its first tag as the face's type label
 * reads it. A power card files under attack, as its placeholder art does
 * (`cardArtIcon`), and anything else that isn't an attack, defense, or
 * order under utility, so every card is under exactly one kind.
 */
export function cardKind(card: GameCard): Exclude<CardFilter, 'all'> {
	switch (card.tags[0]) {
		case 'attack':
		case 'power':
			return 'attack';
		case 'defense':
			return 'defense';
		case 'order':
			return 'order';
		default:
			return 'utility';
	}
}

/** Whether a card shows under a filter. */
export function passesFilter(card: GameCard, filter: CardFilter): boolean {
	return filter === 'all' || cardKind(card) === filter;
}
