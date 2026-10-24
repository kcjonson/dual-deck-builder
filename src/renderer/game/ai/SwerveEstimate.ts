import { BoardProjection, cardRange } from '../mechanics/BoardProjection';
import type { Card, CardEffect } from '../mechanics/Card';
import type { Driver } from '../mechanics/Driver';
import { effectValue } from '../mechanics/EffectConditions';
import { EffectRecipient, effectRecipientOf, isCasterAction } from '../mechanics/EffectTargets';
import { attackEffectOf, movesCaster } from '../mechanics/Intent';
import { movesOf } from '../mechanics/Movement';
import { RoadSlot, slotRange } from '../mechanics/Road';
import { Vehicle, statusSpeedModifier } from '../mechanics/Vehicle';
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
 * best target it reaches and would hit, row bonuses included (Point Man
 * from the ahead row), and the difference between the two boards is what
 * the move gains or loses. Hit checks are deterministic, so someone the
 * card would miss doesn't count: a swerve to line up a ram the bike's evade
 * beats lines up nothing (DDB-552). Cards that make their own move first
 * (Strafe) are left out, since they reach from wherever they land. The one
 * move estimate every AI shares.
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
				const change = worthFrom({ board: after, vehicle, occupant, slot: to, card: other, range }) -
					worthFrom({ board, vehicle, occupant, slot: from, card: other, range });
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
export function actingOccupants({ board, vehicle }: { board: BoardProjection; vehicle: Vehicle }): Driver[] {
	const occupants = board.actor ? (vehicle === board.actor ? [vehicle.driver] : []) : [vehicle.driver, vehicle.passenger];
	return occupants.filter((occupant): occupant is Driver => occupant?.isAlive() ?? false);
}

/**
 * What a card in hand is worth from a slot on this board: its damage at the
 * best target in range that it would hit, a bonus that holds there
 * included, or 1 for a debuff, and 0 with nobody it reaches and hits
 */
function worthFrom({ board, vehicle, occupant, slot, card, range }: {
	board: BoardProjection;
	vehicle: Vehicle;
	occupant: Driver;
	slot: RoadSlot;
	card: Card;
	range: number;
}): number {
	const effect = attackEffectOf(card);
	const shot = card.effects.find(candidate => !isCasterAction(candidate) && effectRecipientOf({ effect: candidate, card }) === EffectRecipient.TARGET);
	let best = 0;
	for (const enemy of board.enemiesOf(vehicle)) {
		const enemySlot = enemy.isOutOfFight || enemy.isUnmanned() ? null : board.slotOf(enemy);
		if (!enemySlot || slotRange(slot, enemySlot) > range) continue;
		if (shot && !board.effectHits({ effect: shot, card, driver: occupant, caster: vehicle, recipient: enemy })) continue;
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
 * (onlyMoves). An AI that doesn't read intents ends its turn rather than
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

/**
 * Whether the card does nothing worth playing for but move: no damage,
 * status, Shield, armor, repair, adrenaline, or draw that keeps a card.
 *
 * A raider's plan (`board.actor`) plays on the enemy turn, and some riders
 * end with that turn: its Shield and a one-turn status on itself are gone
 * as the player's turn starts, before anyone can shoot it, and a card it
 * draws arrives after the plan was made and is discarded then. Those count
 * for nothing, so a raider's Hard Brake or Juke is worth only what its
 * swerve lines up (DDB-552). A one-turn boost is the exception: the
 * drop-back at the end of the enemy turn comes before statuses tick, so
 * Floor It also counts when it would knock a flanker off the shoulder.
 */
export function onlyMoves({ board, card, driver }: { board: BoardProjection; card: Card; driver: Driver }): boolean {
	const raider = board.actor;
	return card.effects.every(effect => effect.type === 'change_position' ||
		effect.type === 'draw_cards' && (raider !== null || cardsKeptFromDraw({ board, card, player: driver }) === 0) ||
		raider !== null && endsWithEnemyTurn({ board, effect, card, raider }));
}

/**
 * Shield, or a status of one turn on the caster: what a card played on the
 * enemy turn loses as the player's turn starts. Not a boost that knocks a
 * flanker off at the drop-back before then.
 */
function endsWithEnemyTurn({ board, effect, card, raider }: { board: BoardProjection; effect: CardEffect; card: Card; raider: Vehicle }): boolean {
	if (effect.type === 'gain_shield') return true;
	const turns = typeof effect.duration === 'number' ? effect.duration : 1;
	if (effect.type !== 'apply_status' || effectRecipientOf({ effect, card }) !== EffectRecipient.CASTER || turns !== 1) return false;
	const boost = raider.speedChange(statusSpeedModifier({ name: effect.status ?? '', duration: 1, value: effect.value }));
	return boost <= 0 || !knocksFlankerOff({ board, raider, boost });
}

/**
 * Whether a speed boost on the raider would drop a flanker back at the end
 * of the enemy turn: one that outran the raider and is faster than it
 * now, but no faster once it's boosted (Battle.dropBackFlankers, which
 * runs before statuses tick)
 */
function knocksFlankerOff({ board, raider, boost }: { board: BoardProjection; raider: Vehicle; boost: number }): boolean {
	const speed = board.speedOf(raider);
	return board.enemiesOf(raider).some(flanker => {
		const flank = board.flankOf(flanker);
		if (flank?.outran !== raider || !flank.reservedSlot || flanker.isOutOfFight) return false;
		return board.speedOf(flanker) > speed && board.speedOf(flanker) <= speed + boost;
	});
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
