import type { Campaign } from '../../campaign/Campaign';
import { fallMessage } from '../../campaign/CampaignEnd';
import type { CampaignEnd } from '../../campaign/CampaignEnd';
import { cardBlockerReason } from '../../campaign/cardBlockerText';
import { totalCards } from '../../campaign/CardCounts';
import { DECK_RULES } from '../../campaign/DeckRules';
import type { DriverRecord } from '../../campaign/DriverRecord';
import type { RunDeck } from '../../campaign/RunDeck';
import { countOf } from '../main-menu/campaignText';

/**
 * Why Borrow is off for a card the driver left some of their own at home:
 * those come back first (run-decks.md), so the HOME stack's one-more is the
 * way to take another.
 */
export const YOURS_AT_HOME = 'Yours at home';

/** Under the run deck, from the wireframe: what borrowing risks. */
export const RUN_DECK_FOOT = "Borrowed cards come back with the driver. If the driver dies, they're lost with the deck.";

/**
 * In place of the run deck and the locker once the campaign is over, which
 * leaves no run out: the controls' own "Campaign over", then how it fell.
 */
export function campaignOverText(end: Readonly<CampaignEnd>): string {
	return `${cardBlockerReason({ reason: 'campaign_over', end })}. ${fallMessage(end)}`;
}

/** A driver's seat on the run, counted from 1, or null for a driver with no run deck. */
export function seatOf({ campaign, driver }: { campaign: Campaign; driver: DriverRecord }): number | null {
	const index = campaign.runDecks.findIndex((deck) => deck.driver === driver);
	return index < 0 ? null : index + 1;
}

/** "Driver 1 of 2", over the left column. */
export function seatTitle({ seat, seats }: { seat: number | null; seats: number }): string {
	return seat === null ? 'Driver' : `Driver ${seat} of ${seats}`;
}

/** "RUN DECK 12/20", the run deck against the most it holds; escort cards sit outside it. */
export function runDeckSizeText(deck: RunDeck): string {
	return `RUN DECK ${deck.deckSize}/${DECK_RULES.deckSize.max}`;
}

/** "BORROWED 1". */
export function borrowedText(deck: RunDeck): string {
	return `BORROWED ${totalCards(deck.borrowed)}`;
}

/** "LEFT HOME 2". */
export function leftHomeText(deck: RunDeck): string {
	return `LEFT HOME ${totalCards(deck.leftHome)}`;
}

/** Whether the run deck differs from the default deck it was copied from, which Reset to default undoes. */
export function isCustomized(deck: RunDeck): boolean {
	return totalCards(deck.leftHome) > 0 || totalCards(deck.borrowed) > 0;
}

/** Under the driver card: whether the run deck is the default deck, and if not, how it differs. */
export function runDeckNote(deck: RunDeck): string {
	if (!isCustomized(deck)) return 'Same as the default deck. Change anything here and it applies to this run only.';
	const home = totalCards(deck.leftHome);
	const borrowed = totalCards(deck.borrowed);
	const changes = [home > 0 ? `${countOf(home, 'card')} left at home` : '', borrowed > 0 ? `${borrowed} borrowed` : ''].filter((change) => change !== '');
	return `For this run only: ${changes.join(', ')}. The default deck stays as it is.`;
}

/** Under the escort cards, from the wireframe. */
export const ESCORT_NOTE = 'Locked, and outside the size limit.';

/** An escort card's control, giving it to the other seat, named as load out names seats. */
export function giveLabel(seat: number | null): string {
	return seat === null ? 'Give' : `Give to driver ${seat}`;
}
