import type { CardBlocker } from '../../campaign/Campaign';
import { archetypeTitle } from '../../campaign/DriverRecord';
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
	/** Why it's disabled, shown under the entry's controls; null while it's live. */
	reason: string | null;
	/** What pressing it does. The screen refreshes from the change it makes. */
	run: () => void;
}

/** A card's copies in one place, shown as a mini card stacked to its count, with the controls under it. */
export interface CardEntry {
	cardType: string;
	copies: number;
	/** The mini's state against the deck being built (Game Flow 7.0); none when left out. */
	state?: MiniCardState | null;
	controls: readonly CardControl[];
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

/**
 * Why a card can't move, as a few words under the control it disables,
 * worded from the rules' own reason codes (`getCardMoveBlocker`,
 * `getScrapBlocker`) rather than their console messages, which name the
 * driver and the card in full. Each fits on one line under a mini.
 */
export function cardBlockerReason(blocker: CardBlocker): string {
	switch (blocker.reason) {
		case 'driver_away':
			return blocker.place.status === 'dead' ? 'Killed on a run' : 'Missing on a run';
		case 'on_run':
			return 'Out on a run';
		case 'too_few':
			return 'None left';
		case 'already_borrowed':
			return `${blocker.by.driver.name} has it`;
		case 'card_locked':
			return 'Locked escort card';
		case 'other_archetype':
			return `${archetypeTitle(blocker.archetype)} only`;
		case 'deck_full':
			return 'Deck full';
		case 'deck_at_minimum':
			return 'Deck at minimum';
	}
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
