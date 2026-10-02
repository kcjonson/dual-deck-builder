import { Card } from '../../mechanics/Card';
import { Driver } from '../../mechanics/Driver';

export type DriverSeat = 1 | 2;

/**
 * What the hand layer draws: both drivers' cards side by side, the seat each
 * card belongs to, and which of them can be played now.
 */
export interface PlayerHandView {
	cards: Card[];
	seatOf: Map<string, DriverSeat>;
	playable: Set<string>;
	/** Cards whose driver can't pay their cost now: their cost turns dark red (section 6). */
	unaffordable: Set<string>;
}

/**
 * Build the hand from the player's drivers in seat order. Seats are fixed
 * for the fight, so a driver keeps their side of the hand after riding into
 * the other vehicle as a passenger. A passenger's attack cards stay in the
 * hand but can't be played. A dead driver has no hand to show, and neither
 * does one who crashed out (no free seat after their wreck): their half of
 * the dock has no hand for the rest of the fight (section 9). The battle
 * passes its own check, which also knows the convoy (a signature card
 * needs its escort).
 */
export function buildPlayerHandView({
	drivers,
	canPlay = (driver, card) => driver.canPlayCard(card),
	crashedOut = () => false,
}: {
	drivers: readonly Driver[];
	canPlay?: (driver: Driver, card: Card) => boolean;
	crashedOut?: (driver: Driver) => boolean;
}): PlayerHandView {
	const view: PlayerHandView = { cards: [], seatOf: new Map(), playable: new Set(), unaffordable: new Set() };

	drivers.forEach((driver, index) => {
		const seat = (index + 1) as DriverSeat;
		if (!driver.isAlive() || crashedOut(driver)) return;

		for (const card of driver.hand) {
			view.cards.push(card);
			view.seatOf.set(card.id, seat);
			if (canPlay(driver, card)) {
				view.playable.add(card.id);
			}
			if (card.cost > driver.adrenaline) view.unaffordable.add(card.id);
		}
	});

	return view;
}
