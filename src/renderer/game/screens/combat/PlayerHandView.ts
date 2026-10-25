import { Card } from '../../mechanics/Card';
import { Driver } from '../../mechanics/Driver';

export type DriverSeat = 1 | 2;

/**
 * What the strip across a blocked card's art says (the mock's `.pblock`):
 * a passenger's attack, a card the battle's rules refuse now (already
 * flanking, boxed in, its escort gone), and a card with nothing to land on.
 */
export const BLOCK_LABELS = {
	passenger: 'NO ATTACKS',
	rule: "CAN'T PLAY",
	noTarget: 'NO TARGET',
} as const;

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
	/** Why each card its driver can pay for can't be played now, as its strip says it (`BLOCK_LABELS`). */
	blocked: Map<string, string>;
}

/**
 * Build the hand from the player's drivers in seat order. Seats are fixed
 * for the fight, so a driver keeps their side of the hand after riding into
 * the other vehicle as a passenger. A passenger's attack cards stay in the
 * hand but can't be played. A dead driver has no hand to show, and neither
 * does one who crashed out (no free seat after their wreck): their half of
 * the dock has no hand for the rest of the fight (section 9). The battle
 * passes its own check, which also knows the convoy (a signature card
 * needs its escort), and whether a card has anything to land on, asked
 * only of a card the check lets through.
 */
export function buildPlayerHandView({
	drivers,
	canPlay = (driver, card) => driver.canPlayCard(card),
	hasTarget = () => true,
	crashedOut = () => false,
}: {
	drivers: readonly Driver[];
	canPlay?: (driver: Driver, card: Card) => boolean;
	hasTarget?: (driver: Driver, card: Card) => boolean;
	crashedOut?: (driver: Driver) => boolean;
}): PlayerHandView {
	const view: PlayerHandView = { cards: [], seatOf: new Map(), playable: new Set(), unaffordable: new Set(), blocked: new Map() };

	drivers.forEach((driver, index) => {
		const seat = (index + 1) as DriverSeat;
		if (!driver.isAlive() || crashedOut(driver)) return;

		for (const card of driver.hand) {
			view.cards.push(card);
			view.seatOf.set(card.id, seat);
			if (card.cost > driver.adrenaline) {
				view.unaffordable.add(card.id);
			} else if (!canPlay(driver, card)) {
				view.blocked.set(card.id, card.isAttack && !driver.canPlayAttackCards() ? BLOCK_LABELS.passenger : BLOCK_LABELS.rule);
			} else if (!hasTarget(driver, card)) {
				view.blocked.set(card.id, BLOCK_LABELS.noTarget);
			} else {
				view.playable.add(card.id);
			}
		}
	});

	return view;
}
