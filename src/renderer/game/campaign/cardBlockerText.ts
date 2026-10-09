import type { CardBlocker } from './Campaign';
import { DriverStatus, archetypeTitle } from './DriverRecord';

/** How a driver who isn't at the compound went, for the screens that show them. */
export function awayText(status: DriverStatus): string {
	return status === 'dead' ? 'Killed on a run' : 'Missing on a run';
}

/**
 * Why a card can't move, be scrapped, or be bought, as the few words a
 * screen shows under the control it disables. Worded from the rules' own
 * reason codes (`getCardMoveBlocker`, `getScrapBlocker`, and the garage's
 * price check) rather than their console messages, which name the driver
 * and the card in full; each fits one line under a mini card, which the
 * Crew screen's tests measure.
 */
export function cardBlockerReason(blocker: CardBlocker): string {
	switch (blocker.reason) {
		case 'driver_away':
			return awayText(blocker.place.status);
		case 'on_run':
			return 'Out on a run';
		case 'too_few':
			return 'None left';
		case 'already_borrowed':
			return 'Other seat has it';
		case 'card_locked':
			return "Escort's card";
		case 'too_little_scrap':
			return `Needs ${blocker.needed} scrap`;
		case 'other_archetype':
			return `${archetypeTitle(blocker.archetype)} only`;
		case 'deck_full':
			return 'Deck full';
		case 'deck_at_minimum':
			return 'Deck at minimum';
	}
}
