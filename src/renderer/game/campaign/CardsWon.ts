import type { Campaign, CardBlocker } from './Campaign';
import { CardCounts, addCounts, readCardCounts } from './CardCounts';
import type { RunParty } from './CombatBridge';
import { readNewCards } from './DeckRules';
import type { DriverRecord } from './DriverRecord';

/**
 * Cards won on a supply run (DDB-316): loot, so cargo until the run gets
 * home, then the locker's, where the debrief offers each one to a driver's
 * default deck. Decision record: docs/AI_TECHNICAL_DECISIONS/cards-won.md.
 */

/** A driver the debrief could hand a card won to, and why not if they can't take one now. */
export interface DebriefTaker {
	readonly driver: DriverRecord;
	/**
	 * Why one copy can't go from the locker to their default deck now, or
	 * null if it can: `getCardMoveBlocker`'s own reason for that move
	 * (`driver_away`, `on_run`, `too_few`, `other_archetype`, `deck_full`).
	 */
	readonly blocker: CardBlocker | null;
}

/** A card won, as the debrief offers it. */
export interface DebriefCard {
	readonly cardType: string;
	/** Copies of it still to offer */
	readonly count: number;
	/** Every driver in the pool, in pool order */
	readonly takers: readonly DebriefTaker[];
}

/**
 * The party with cards won on the road added to its cargo: a fight's
 * reward, a Find: cards stop, or a roadside garage's sale. They ride home
 * with the cargo, reach the locker when the run is unloaded
 * (`Campaign.unloadRun`), and are lost if the run fails. Returns a new
 * party, leaving the one given as it was.
 *
 * Throws, adding nothing, for a card cards.json doesn't list, an escort's
 * signature card, which comes with its escort and never as loot, and
 * counts or a party's cargo cards that aren't card counts.
 */
export function addCardsWon({ party, cardsWon }: { party: RunParty; cardsWon: CardCounts }): RunParty {
	const won = readNewCards(cardsWon, 'cardsWon');
	const cargoCards = addCounts(readCardCounts(party.cargoCards, 'RunParty.cargoCards'), won);
	return { seats: party.seats, escorts: party.escorts, cargo: party.cargo, cargoCards };
}

/**
 * The debrief after a run gets home (Compound and Supply Runs, After the
 * run): each card won, in card-type order, with every driver in the pool
 * and whether one copy can go from the locker into their default deck now.
 * A driver can take one when they're at the compound (alive, and not
 * missing), the card isn't marked for another archetype, and their deck is
 * under the most it holds; the locker has to hold a copy too.
 *
 * Accepting is the Crew screen's move, `campaign.moveCards({ cardType,
 * from: 'locker', to: driver })`, under the same rules, so a debrief
 * button and the move can't disagree. Pass the cards still to offer, which
 * start as `unloadRun`'s, and ask again after each move: one changes the
 * deck it lands in, and the locker. Changes nothing. Throws on cards won
 * that aren't card counts.
 */
export function getDebrief({ campaign, cardsWon }: { campaign: Campaign; cardsWon: CardCounts }): readonly DebriefCard[] {
	const offered = readCardCounts(cardsWon, 'cardsWon');
	return Object.freeze(Object.entries(offered).map(([cardType, count]) => Object.freeze({
		cardType,
		count,
		takers: Object.freeze(campaign.drivers.map(driver => Object.freeze({
			driver,
			blocker: campaign.getCardMoveBlocker({ cardType, from: 'locker', to: driver })
		})))
	})));
}
