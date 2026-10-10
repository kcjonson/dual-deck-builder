import type { CardBlocker, CardMove, Campaign } from '../../campaign/Campaign';
import { cardBlockerReason } from '../../campaign/cardBlockerText';
import { isForOtherArchetype } from '../../campaign/DeckRules';
import type { DriverRecord } from '../../campaign/DriverRecord';
import { RunDeck } from '../../campaign/RunDeck';
import type { CardControl, CardEntry, CardSource } from '../../ui/deckBuilder/cardSource';
import { giveLabel, seatOf } from './customizeText';

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
 * home (faded, HOME), each a stack of its own with one-fewer and one-more.
 * Each control is `moveCards` between the run deck and the locker for the
 * copies its stack holds (`CardMove.copies`): on the own and HOME stacks,
 * one of the driver's own going home or coming back; on the +N stack, a
 * borrowed copy going back or another borrowed. The rules say why one
 * can't, the move order included (borrowed copies go back before the
 * driver's own stay home, and the driver's own come back before anything's
 * borrowed), and the line under the card says so, except where the run
 * deck itself has no such copy to move: a full stack's one-more, as on the
 * wireframe, says nothing. A +N or HOME stack that empties hands focus to
 * its card's plain stack (`focusHeir`).
 */
export function runDeckSource({ campaign, driver, changed }: CustomizeSourceOptions): CardSource {
	return {
		entries: (): CardEntry[] => {
			const deck = campaign.runDeckOf(driver);
			if (!deck) return [];
			const control = (cardType: string, key: 'fewer' | 'more', copies: 'own' | 'borrowed' | 'home'): CardControl => moveControl({
				key,
				label: key === 'fewer' ? '-' : '+',
				campaign,
				changed,
				move: key === 'fewer' ? { cardType, from: deck, to: 'locker', copies } : { cardType, from: 'locker', to: deck, copies },
			});
			const ownControls = (cardType: string): CardControl[] => [control(cardType, 'fewer', 'own'), control(cardType, 'more', 'home')];
			return [
				...Object.entries(deck.own).map(([cardType, copies]): CardEntry => ({ cardType, copies, controls: ownControls(cardType) })),
				...Object.entries(deck.borrowed).map(([cardType, copies]): CardEntry => ({
					key: STACK_KEYS.borrowed(cardType),
					cardType,
					copies,
					state: 'borrowed',
					focusHeir: cardType,
					controls: [control(cardType, 'fewer', 'borrowed'), control(cardType, 'more', 'borrowed')],
				})),
				...Object.entries(deck.leftHome).map(([cardType, copies]): CardEntry => ({
					key: STACK_KEYS.home(cardType),
					cardType,
					copies,
					state: 'home',
					focusHeir: cardType,
					controls: ownControls(cardType),
				})),
			];
		},
	};
}

/**
 * The locker after the other seat's borrowing (`campaign.locker` holds
 * only what's free), each card with Borrow, disabled with the rules'
 * reason: the run deck is full, the card is for another archetype, which
 * is faded as on the Crew screen, or the driver left some of their own at
 * home, which come back first.
 */
export function customizeLockerSource({ campaign, driver, changed }: CustomizeSourceOptions): CardSource {
	return {
		entries: (): CardEntry[] => {
			const deck = campaign.runDeckOf(driver);
			if (!deck) return [];
			return Object.entries(campaign.locker).map(([cardType, copies]) => ({
				cardType,
				copies,
				state: isForOtherArchetype({ cardType, archetype: driver.archetype }) ? 'unavailable' : null,
				controls: [moveControl({ key: 'borrow', label: 'Borrow', campaign, changed, move: { cardType, from: 'locker', to: deck, copies: 'borrowed' } })],
			}));
		},
	};
}

/**
 * The escort cards in the run deck, each locked, with a control that gives
 * it to the other seat (`moveEscortCard`), disabled with the rules' reason
 * when either driver is away. On a run with one seat there's nobody to give
 * one to, so there's no control. Keyed by the escort that brought it, in
 * escort order, as the run deck holds them.
 */
export function escortCardSource({ campaign, driver, changed }: CustomizeSourceOptions): CardSource {
	return {
		entries: (): CardEntry[] => {
			const deck = campaign.runDeckOf(driver);
			if (!deck) return [];
			const partner = campaign.runDecks.find((other) => other.driver !== driver) ?? null;
			return deck.escortCards.map(({ cardType, broughtBy }) => ({
				key: broughtBy,
				cardType,
				copies: 1,
				state: 'locked',
				controls: partner ? [giveControl({ campaign, broughtBy, partner, changed })] : [],
			}));
		},
	};
}

function giveControl({ campaign, broughtBy, partner, changed }: { campaign: Campaign; broughtBy: string; partner: RunDeck; changed: () => void }): CardControl {
	const blocker = campaign.getEscortCardMoveBlocker({ broughtBy, to: partner });
	return {
		key: 'give',
		label: giveLabel(seatOf({ campaign, driver: partner.driver })),
		reason: blocker ? cardBlockerReason(blocker) : null,
		run: () => {
			campaign.moveEscortCard({ broughtBy, to: partner });
			changed();
		},
	};
}

/**
 * A control that makes a move, disabled with the rules' reason when they
 * refuse it, or with nothing said when the run deck holds no such copy to
 * move (`isQuiet`).
 */
function moveControl({ key, label, campaign, changed, move }: { key: string; label: string; campaign: Campaign; changed: () => void; move: CardMove }): CardControl {
	const blocker = campaign.getCardMoveBlocker(move);
	return {
		key,
		label,
		reason: blocker && !isQuiet(blocker) ? cardBlockerReason(blocker) : null,
		disabled: blocker !== null,
		run: () => {
			campaign.moveCards(move);
			changed();
		},
	};
}

/**
 * A run deck short of the copies a control would move: nothing at home to
 * bring back under a full stack, or none of the driver's own left to leave
 * home under HOME. The stack's own count says it, so the line under the
 * card stays free for a reason that tells the player something.
 */
function isQuiet(blocker: CardBlocker): boolean {
	return blocker.reason === 'too_few' && blocker.place instanceof RunDeck;
}
