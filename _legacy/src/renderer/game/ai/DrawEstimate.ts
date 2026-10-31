import type { BoardProjection } from '../mechanics/BoardProjection';
import type { Card } from '../mechanics/Card';
import { Driver, cardsKept } from '../mechanics/Driver';

/**
 * How many cards a card's draw_cards effects draw, the only draw effect the
 * cards use. An effect with no value draws none.
 */
export function cardsDrawn(card: Card): number {
	return card.effects
		.filter(effect => effect.type === 'draw_cards')
		.reduce((sum, effect) => sum + (typeof effect.value === 'number' ? effect.value : 0), 0);
}

/**
 * How many of the cards a play draws stay in its player's hand, the one draw
 * estimate every AI shares. A draw fills the hand up to the driver's hand
 * limit and burns the rest (Combat Rules, Driver), so a burned card is worth
 * nothing and the AIs value only these. The hand is the player's as the board
 * has it, less the card itself, which leaves the hand before its draw
 * resolves.
 */
export function cardsKeptFromDraw({ board, card, player }: { board: BoardProjection; card: Card; player: Driver }): number {
	const count = cardsDrawn(card);
	if (count === 0) return 0;
	const hand = board.handOf(player);
	const handSize = hand.length - (hand.includes(card) ? 1 : 0);
	return cardsKept({ count, handSize, handLimit: player.handLimit });
}
