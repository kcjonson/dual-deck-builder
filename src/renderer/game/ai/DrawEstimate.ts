import type { Card } from '../mechanics/Card';
import type { Driver } from '../mechanics/Driver';
import { BoardProjection, cardsKept } from '../mechanics/BoardProjection';

/**
 * How many cards a card's draws draw, counted as the battle counts them
 */
export function cardsDrawn(card: Card): number {
	return card.effects
		.filter(effect => effect.type === 'draw_cards')
		.reduce((sum, effect) => sum + (typeof effect.value === 'number' ? effect.value : 0), 0);
}

/**
 * How many of the cards a play draws stay in the drawer's hand, the one draw
 * estimate every AI shares. A draw fills the hand up to the drawer's hand
 * limit and burns the rest (Combat Rules, Driver), so a burned card is worth
 * nothing and the AIs value only these.
 *
 * The hand is counted as it will stand when the draw resolves: as the board
 * has it, so a plan's earlier plays and draws count, less the card itself
 * when it leaves the drawer's hand first. A draw is its caster's own
 * (EffectTargets), so the drawer is the player; `drawer` is for a card that
 * makes someone else draw, whose hand the played card frees no room in.
 */
export function cardsKeptFromDraw({
	board,
	card,
	player,
	drawer = player
}: {
	board: BoardProjection;
	card: Card;
	player: Driver;
	drawer?: Driver;
}): number {
	const count = cardsDrawn(card);
	if (count === 0) return 0;
	const leavesDrawersHand = drawer === player && board.handOf(player).includes(card);
	const handSize = board.handSizeOf(drawer) - (leavesDrawersHand ? 1 : 0);
	return cardsKept({ count, handSize, handLimit: drawer.handLimit });
}
