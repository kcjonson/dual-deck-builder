import { Card } from '../../mechanics/Card';
import { Driver, DriverRole } from '../../mechanics/Driver';

export type DriverSeat = 1 | 2;

/**
 * What the hand layer draws: both drivers' cards side by side, the seat each
 * card belongs to, which of them can be played now, and each seat's label.
 */
export interface PlayerHandView {
	cards: Card[];
	seatOf: Map<string, DriverSeat>;
	playable: Set<string>;
	labels: Map<DriverSeat, string>;
}

/**
 * Build the hand from the player's drivers in seat order. Seats are fixed
 * for the fight, so a driver keeps their side of the hand after riding into
 * the other vehicle as a passenger. A passenger's attack cards stay in the
 * hand but can't be played; a dead driver has no hand to show. The battle
 * passes its own check, which also knows the convoy (a signature card
 * needs its escort).
 */
export function buildPlayerHandView(
	drivers: readonly Driver[],
	canPlay: (driver: Driver, card: Card) => boolean = (driver, card) => driver.canPlayCard(card)
): PlayerHandView {
	const view: PlayerHandView = { cards: [], seatOf: new Map(), playable: new Set(), labels: new Map() };

	drivers.forEach((driver, index) => {
		const seat = (index + 1) as DriverSeat;
		const passenger = driver.role === DriverRole.PASSENGER;
		view.labels.set(seat, passenger ? `Driver ${seat} (passenger)` : `Driver ${seat}`);
		if (!driver.isAlive()) return;

		for (const card of driver.hand) {
			view.cards.push(card);
			view.seatOf.set(card.id, seat);
			if (canPlay(driver, card)) {
				view.playable.add(card.id);
			}
		}
	});

	return view;
}
