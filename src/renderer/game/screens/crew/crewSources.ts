import type { Campaign } from '../../campaign/Campaign';
import { cardBlockerReason } from '../../campaign/cardBlockerText';
import { NO_CARDS } from '../../campaign/CardCounts';
import { deckAddBlocker } from '../../campaign/DeckRules';
import type { DriverRecord } from '../../campaign/DriverRecord';
import type { CardEntry, CardSource } from '../../ui/deckBuilder/cardSource';
import { defaultDeckOf } from './crewText';

/** What Add says with no driver chosen, which happens only with nobody at the compound. */
export const NO_DRIVER = 'No driver chosen';

export interface CrewSourceOptions {
	campaign: Campaign;
	/** The driver whose default deck is being built, as chosen now; null with nobody to choose. */
	selected: () => DriverRecord | null;
	/** After a move or a scrap has changed the campaign: the screen checkpoints it. */
	changed: () => void;
}

/**
 * The selected driver's default deck (Game Flow 3.2): each card with a
 * Remove that puts a copy back in the locker, disabled with the rules' own
 * reason (`getCardMoveBlocker`) when the deck is at its minimum or the
 * driver is out on a run.
 */
export function crewDeckSource({ campaign, selected, changed }: CrewSourceOptions): CardSource {
	return {
		entries: (): CardEntry[] => {
			const driver = selected();
			if (!driver) return [];
			return Object.entries(defaultDeckOf({ campaign, driver })).map(([cardType, copies]) => {
				const blocker = campaign.getCardMoveBlocker({ cardType, from: driver, to: 'locker' });
				return {
					cardType,
					copies,
					controls: [{
						key: 'remove',
						label: 'Remove',
						reason: blocker ? cardBlockerReason(blocker) : null,
						run: () => {
							campaign.moveCards({ cardType, from: driver, to: 'locker' });
							changed();
						},
					}],
				};
			});
		},
	};
}

/**
 * The compound's locker against the selected driver's deck: each card with
 * Add, disabled with the rules' reason when the deck is full, the card is
 * for another archetype, or the driver is out on a run, and Scrap, which
 * destroys a copy for `DECK_RULES.scrapPerCard` scrap (`scrapCards`) on its
 * second press. A card for another archetype is faded, since it can never
 * go in this deck, whatever else would refuse it first; a full deck fades
 * nothing, since every card would fit once one comes out.
 */
export function crewLockerSource({ campaign, selected, changed }: CrewSourceOptions): CardSource {
	return {
		entries: (): CardEntry[] => {
			const driver = selected();
			return Object.entries(campaign.locker).map(([cardType, copies]) => {
				const addBlocker = driver ? campaign.getCardMoveBlocker({ cardType, from: 'locker', to: driver }) : null;
				const scrapBlocker = campaign.getScrapBlocker({ cardType });
				const otherArchetype = driver !== null && deckAddBlocker({ deck: NO_CARDS, archetype: driver.archetype, cardType, count: 1 })?.reason === 'other_archetype';
				return {
					cardType,
					copies,
					state: otherArchetype ? 'unavailable' : null,
					controls: [
						{
							key: 'add',
							label: 'Add',
							reason: driver ? (addBlocker ? cardBlockerReason(addBlocker) : null) : NO_DRIVER,
							run: () => {
								if (!driver) return;
								campaign.moveCards({ cardType, from: 'locker', to: driver });
								changed();
							},
						},
						{
							key: 'scrap',
							label: 'Scrap',
							ghost: true,
							destructive: true,
							reason: scrapBlocker ? cardBlockerReason(scrapBlocker) : null,
							run: () => {
								campaign.scrapCards({ cardType });
								changed();
							},
						},
					],
				};
			});
		},
	};
}
