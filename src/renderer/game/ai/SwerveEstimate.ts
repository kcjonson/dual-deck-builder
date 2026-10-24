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
 * judged by the battle's own move rules. Every card still in the hand of
 * everyone who acts from the caster's side (the caster, a partner a swap or
 * formation shift moves too, the driver of a vehicle a passenger swerves)
 * that's affordable from their own adrenaline once this card is paid for
 * and reaches out from where its player stands (a Range attack or debuff
 * aimed at the other side) counts its damage, or 1 for a debuff, at the
 * best target it reaches, row bonuses included (Point Man from the ahead
 * row), and the difference between the two boards is what the move gains
 * or loses. Cards that make their own move first (Strafe) are left out,
 * since they reach from wherever they land. The one move estimate every AI
 * shares.
 */
export function swerveReach({ board, card, driver, caster, target = null, destination = null }: {
	board: BoardProjection;
	card: Card;
	driver: Driver;
	caster: Vehicle;
	target?: Vehicle | null;
	destination?: RoadSlot | null;
}): SwerveReach {
	if (!cardMovesSlots(card) || !board.slotOf(caster)) return NO_REACH;
	const after = board.copy();
	after.apply({ card, driver, target, destination, actor: caster });

	const reach: SwerveReach = { gained: 0, lost: 0 };
	// A shove moves a raider, so a vehicle that stays put can gain or lose a target too
	for (const vehicle of board.teamOf(caster)) {
		const from = vehicle.isOutOfFight ? null : board.slotOf(vehicle);
		const to = after.slotOf(vehicle);
		if (!from || !to) continue;
		for (const occupant of actingOccupants({ board, vehicle })) {
			const adrenaline = after.adrenalineOf(occupant);
			for (const other of after.handOf(occupant)) {
				const range = cardRange(other);
				if (range === null || other.cost > adrenaline || other.isOrder || other.targetType !== 'enemy_single' || movesCaster(other)) continue;
				if (other.isAttack && !occupant.canPlayAttackCards()) continue;
				const change = worthFrom({ board: after, vehicle, slot: to, card: other, range }) - worthFrom({ board, vehicle, slot: from, card: other, range });
				if (change > 0) reach.gained += change;
				if (change < 0) reach.lost -= change;
			}
		}
	}
	return reach;
}

/**
 * Who plays cards from a vehicle on this board: its living driver and
 * passenger, or while a raider plans (`board.actor`), that raider's driver
 * alone, as AIPlayer.actingOccupants has it
 */
function actingOccupants({ board, vehicle }: { board: BoardProjection; vehicle: Vehicle }): Driver[] {
	const occupants = board.actor ? (vehicle === board.actor ? [vehicle.driver] : []) : [vehicle.driver, vehicle.passenger];
	return occupants.filter((occupant): occupant is Driver => occupant?.isAlive() ?? false);
}

/**
 * What a card in hand is worth from a slot on this board: its damage at the
 * best target in range, a bonus that holds there included, or 1 for a
 * debuff, and 0 with nobody in range
 */
function worthFrom({ board, vehicle, slot, card, range }: {
	board: BoardProjection;
	vehicle: Vehicle;
	slot: RoadSlot;
	card: Card;
	range: number;
}): number {
	const effect = attackEffectOf(card);
	let best = 0;
	for (const enemy of board.enemiesOf(vehicle)) {
		const enemySlot = enemy.isOutOfFight || enemy.isUnmanned() ? null : board.slotOf(enemy);
		if (!enemySlot || slotRange(slot, enemySlot) > range) continue;
		const worth = effect && typeof effect.value === 'number'
			? effectValue(effect, { casterSlot: slot, targetSlot: enemySlot, casterSwerved: board.swervedThisTurn(vehicle) })
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
