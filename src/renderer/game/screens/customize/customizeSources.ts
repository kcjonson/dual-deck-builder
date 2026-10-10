import type { Campaign, CardMove } from '../../campaign/Campaign';
import { cardBlockerReason } from '../../campaign/cardBlockerText';
import { NO_CARDS, cardCount } from '../../campaign/CardCounts';
import { deckAddBlocker } from '../../campaign/DeckRules';
import type { DriverRecord } from '../../campaign/DriverRecord';
import type { RunDeck } from '../../campaign/RunDeck';
import type { CardControl, CardEntry, CardSource } from '../../ui/deckBuilder/cardSource';
import { YOURS_AT_HOME, giveLabel, seatOf } from './customizeText';

export interface CustomizeSourceOptions {
	campaign: Campaign;
	/** The seated driver whose run deck is customized. */
	driver: DriverRecord;
	/** After a move has changed the campaign: the screen checkpoints it. */
	changed: () => void;
}

/** The keys of a card's two other stacks in the run deck, beside its own copies (keyed by card type). Card types are snake case, so a hyphen can't collide. */
export const STACK_KEYS = {
	borrowed: (cardType: string): string => `${cardType}-borrowed`,
	home: (cardType: string): string => `${cardType}-home`,
} as const;

/**
 * The run deck (Game Flow 1.2, Customize): a card's own copies going, its
 * copies borrowed from the locker (dashed, "+N"), and its copies left at
 * home (faded, HOME), each a stack of its own with one-fewer and one-more
 * controls. Each control is `moveCards` between the run deck and the
 * locker, whose order decides which stack it acts on: copies come out
 * borrowed first, then the driver's own stay home, and go in from home
 * first, then borrowed (run-decks.md). So a control is live only on the
 * stack its move changes, and disabled with no line of its own elsewhere:
 * one-more on a stack with nothing at home ("full", as on the wireframe),
 * one-fewer on the own stack while copies of the card are borrowed, and
 * one-fewer on HOME. A live control that the rules refuse says why
 * (`getCardMoveBlocker`).
 */
export function runDeckSource({ campaign, driver, changed }: CustomizeSourceOptions): CardSource {
	return {
		entries: (): CardEntry[] => {
			const deck = campaign.runDeckOf(driver);
			if (!deck) return [];
			const move = { campaign, deck, changed };
			const entries: CardEntry[] = [];
			for (const [cardType, copies] of Object.entries(deck.own)) {
				entries.push({
					cardType,
					copies,
					controls: [
						fewer({ ...move, cardType, live: cardCount(deck.borrowed, cardType) === 0 }),
						more({ ...move, cardType, live: cardCount(deck.leftHome, cardType) > 0 }),
					],
				});
			}
			for (const [cardType, copies] of Object.entries(deck.borrowed)) {
				entries.push({
					key: STACK_KEYS.borrowed(cardType),
					cardType,
					copies,
					state: 'borrowed',
					controls: [fewer({ ...move, cardType, live: true }), more({ ...move, cardType, live: true })],
				});
			}
			for (const [cardType, copies] of Object.entries(deck.leftHome)) {
				entries.push({
					key: STACK_KEYS.home(cardType),
					cardType,
					copies,
					state: 'home',
					controls: [fewer({ ...move, cardType, live: false }), more({ ...move, cardType, live: true })],
				});
			}
			return entries;
		},
	};
}

/**
 * The locker after the other seat's borrowing (`campaign.locker` holds
 * only what's free), each card with Borrow, disabled with the rules'
 * reason when the run deck is full or the card is for another archetype,
 * which is faded as on the Crew screen, or with `YOURS_AT_HOME` when the
 * driver left some of their own at home, which would come back instead.
 */
export function customizeLockerSource({ campaign, driver, changed }: CustomizeSourceOptions): CardSource {
	return {
		entries: (): CardEntry[] => {
			const deck = campaign.runDeckOf(driver);
			if (!deck) return [];
			return Object.entries(campaign.locker).map(([cardType, copies]) => {
				const otherArchetype = deckAddBlocker({ deck: NO_CARDS, archetype: driver.archetype, cardType, count: 1 })?.reason === 'other_archetype';
				const blocker = campaign.getCardMoveBlocker({ cardType, from: 'locker', to: deck });
				const home = cardCount(deck.leftHome, cardType) > 0;
				return {
					cardType,
					copies,
					state: otherArchetype ? 'unavailable' : null,
					controls: [{
						key: 'borrow',
						label: 'Borrow',
						reason: blocker ? cardBlockerReason(blocker) : home ? YOURS_AT_HOME : null,
						run: () => {
							campaign.moveCards({ cardType, from: 'locker', to: deck });
							changed();
						},
					}],
				};
			});
		},
	};
}

/**
 * The escort cards in the run deck, each locked, with a control that gives
 * it to the other seat (`moveEscortCard`), disabled with the rules' reason
 * when either driver is away. Keyed by the escort that brought it, in
 * escort order, as the run deck holds them.
 */
export function escortCardSource({ campaign, driver, changed }: CustomizeSourceOptions): CardSource {
	return {
		entries: (): CardEntry[] => {
			const deck = campaign.runDeckOf(driver);
			if (!deck) return [];
			const partner = campaign.runDecks.find((other) => other.driver !== driver) ?? null;
			const seat = partner ? seatOf({ campaign, driver: partner.driver }) : null;
			return deck.escortCards.map(({ cardType, broughtBy }) => {
				const blocker = partner ? campaign.getEscortCardMoveBlocker({ broughtBy, to: partner }) : null;
				return {
					key: broughtBy,
					cardType,
					copies: 1,
					state: 'locked',
					controls: [{
						key: 'give',
						label: giveLabel(seat),
						reason: blocker ? cardBlockerReason(blocker) : null,
						disabled: partner === null,
						run: () => {
							if (!partner) return;
							campaign.moveEscortCard({ broughtBy, to: partner });
							changed();
						},
					}],
				};
			});
		},
	};
}

interface MoveOptions {
	campaign: Campaign;
	/** Any snapshot stands for the driver's run deck as it is now. */
	deck: RunDeck;
	cardType: string;
	changed: () => void;
	/** Whether the move would change this stack; a control that wouldn't is disabled with nothing to say. */
	live: boolean;
}

/** One copy out of the run deck: back to the locker if borrowed, else left at home. */
function fewer({ campaign, deck, cardType, changed, live }: MoveOptions): CardControl {
	return moveControl({ key: 'fewer', label: '-', live, campaign, changed, move: { cardType, from: deck, to: 'locker' } });
}

/** One copy into the run deck: one of the driver's own from home if any, else borrowed. */
function more({ campaign, deck, cardType, changed, live }: MoveOptions): CardControl {
	return moveControl({ key: 'more', label: '+', live, campaign, changed, move: { cardType, from: 'locker', to: deck } });
}

function moveControl({ key, label, live, campaign, changed, move }: {
	key: string;
	label: string;
	live: boolean;
	campaign: Campaign;
	changed: () => void;
	move: CardMove;
}): CardControl {
	const run = (): void => {
		campaign.moveCards(move);
		changed();
	};
	if (!live) return { key, label, reason: null, disabled: true, run };
	const blocker = campaign.getCardMoveBlocker(move);
	return { key, label, reason: blocker ? cardBlockerReason(blocker) : null, run };
}
