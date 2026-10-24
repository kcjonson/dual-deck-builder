import { BoardProjection, cardRange } from '../mechanics/BoardProjection';
import type { Card } from '../mechanics/Card';
import type { Driver } from '../mechanics/Driver';
import { effectValue } from '../mechanics/EffectConditions';
import { attackEffectOf, movesCaster } from '../mechanics/Intent';
import { movesOf } from '../mechanics/Movement';
import { RoadSlot, slotRange } from '../mechanics/Road';
import type { Vehicle } from '../mechanics/Vehicle';
import { cardsKeptFromDraw } from './DrawEstimate';

/** What a move does to the rest of the hand: damage it puts in range, and damage it takes out */
export interface SwerveReach {
	gained: number;
	lost: number;
}

const NO_REACH: SwerveReach = { gained: 0, lost: 0 };

/**
 * Whether a card changes anyone's slot other than by flanking: a swerve,
 * move, swap, shove, drop-back, or formation shift. A flank is worth the
 * flank priority instead.
 */
export function cardMovesSlots(card: Card): boolean {
	return movesOf(card).some(move => move.kind !== 'flanking');
}

/**
 * What a card's moves do for the cards still to play after it, scored like
 * a flank (DDB-546, DDB-553): what they put in range, and what they take
 * out. The play is tried on a copy of the board, so the caster's own swerve,
 * a shove or drop-back of the target, a swap, and a formation shift are all
 * judged by the battle's own move rules. Each other card in hand that's
 * affordable once this one is paid for and reaches out from where its
 * player stands (a Range attack or debuff aimed at the other side) counts
 * its damage, or 1 for a debuff, at the best target it reaches, row bonuses
 * included (Point Man from the ahead row), and the difference between the
 * two boards is what the move gains or loses. Cards that make their own
 * move first (Strafe) are left out, since they reach from wherever they
 * land. The one move estimate every AI shares.
 */
export function swerveReach({ board, card, driver, caster, target = null, destination = null }: {
	board: BoardProjection;
	card: Card;
	driver: Driver;
	caster: Vehicle;
	target?: Vehicle | null;
	destination?: RoadSlot | null;
}): SwerveReach {
	if (!cardMovesSlots(card)) return NO_REACH;
	const from = board.slotOf(caster);
	if (!from) return NO_REACH;
	const after = board.copy();
	after.apply({ card, driver, target, destination, actor: caster });
	const to = after.slotOf(caster);
	if (!to) return NO_REACH;

	const adrenaline = after.adrenalineOf(driver);
	const reach: SwerveReach = { gained: 0, lost: 0 };
	for (const other of after.handOf(driver)) {
		const range = cardRange(other);
		if (range === null || other.cost > adrenaline || other.isOrder || other.targetType !== 'enemy_single' || movesCaster(other)) continue;
		const change = worthFrom({ board: after, caster, slot: to, card: other, range }) - worthFrom({ board, caster, slot: from, card: other, range });
		if (change > 0) reach.gained += change;
		if (change < 0) reach.lost -= change;
	}
	return reach;
}

/**
 * What a card in hand is worth from a slot on this board: its damage at the
 * best target in range, a bonus that holds there included, or 1 for a
 * debuff, and 0 with nobody in range
 */
function worthFrom({ board, caster, slot, card, range }: {
	board: BoardProjection;
	caster: Vehicle;
	slot: RoadSlot;
	card: Card;
	range: number;
}): number {
	const effect = attackEffectOf(card);
	let best = 0;
	for (const enemy of board.enemiesOf(caster)) {
		const enemySlot = enemy.isOutOfFight || enemy.isUnmanned() ? null : board.slotOf(enemy);
		if (!enemySlot || slotRange(slot, enemySlot) > range) continue;
		const worth = effect && typeof effect.value === 'number'
			? effectValue(effect, { casterSlot: slot, targetSlot: enemySlot, casterSwerved: board.swervedThisTurn(caster) })
			: 1;
		best = Math.max(best, worth);
	}
	return best;
}

/**
 * A move's reach as one score at a weight per point of damage: what it
 * puts in range when it takes nothing out, and otherwise minus what it
 * takes out, so a move waits until the cards it would strand are played
 * and only then counts for what it opens.
 */
export function swerveScore(reach: SwerveReach, weight: number): number {
	return reach.lost > 0 ? -reach.lost * weight : reach.gained * weight;
}

/**
 * Whether playing the card would only move someone: its moves open nothing
 * for the rest of the hand, and the card has nothing else worth playing for
 * (damage, a status, Shield, armor, a repair, adrenaline, or a draw that
 * keeps a card). An AI that doesn't read intents ends its turn rather than
 * play one, so a raider with nothing to line up doesn't swerve out and back
 * again, and the aggressive stand-in doesn't shove a raider for nothing.
 */
export function aimlessSwerve({ board, card, driver, reach }: {
	board: BoardProjection;
	card: Card;
	driver: Driver;
	reach: SwerveReach;
}): boolean {
	if (!cardMovesSlots(card) || reach.gained > 0) return false;
	return onlyMoves({ board, card, driver });
}

/** Whether every effect on the card is a move, or a draw that would keep nothing */
export function onlyMoves({ board, card, driver }: { board: BoardProjection; card: Card; driver: Driver }): boolean {
	return card.effects.every(effect => effect.type === 'change_position' ||
		effect.type === 'draw_cards' && cardsKeptFromDraw({ board, card, player: driver }) === 0);
}

/**
 * The most a card's swerve could put in range from any slot it could land
 * in: its one slot for a fixed direction, the best of its slots for a
 * picked one
 */
export function bestSwerveGain({ board, card, driver, caster }: {
	board: BoardProjection;
	card: Card;
	driver: Driver;
	caster: Vehicle;
}): number {
	if (!movesCaster(card)) return 0;
	return Math.max(0, ...board.landingSlots({ card, caster })
		.map(destination => swerveReach({ board, card, driver, caster, destination }).gained));
}
