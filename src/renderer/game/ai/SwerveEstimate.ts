import { BoardProjection, cardRange } from '../mechanics/BoardProjection';
import type { Card, CardEffect } from '../mechanics/Card';
import type { Driver } from '../mechanics/Driver';
import { EffectRecipient, effectRecipientOf, isCasterAction } from '../mechanics/EffectTargets';
import { attackEffectOf, movesCaster } from '../mechanics/Intent';
import { RoadSlot, sameSlot, slotRange } from '../mechanics/Road';
import type { Vehicle } from '../mechanics/Vehicle';
import { cardsKeptFromDraw } from './DrawEstimate';

/** What a swerve does to the rest of the hand: damage it puts in range, and damage it takes out */
export interface SwerveReach {
	gained: number;
	lost: number;
}

const NO_REACH: SwerveReach = { gained: 0, lost: 0 };

/**
 * What a card's own swerve or move does for the cards still to play after
 * it, scored like a flank (DDB-546): what it puts in range, and what it
 * takes out. Each other card in hand that's affordable once this one is
 * paid for and reaches out from where its player stands (a Range attack or
 * debuff aimed at the other side) counts its damage, or 1 for a debuff, if
 * anyone it could hit is in range from one slot and not the other. Hit
 * checks are deterministic, so someone the card would miss doesn't count:
 * a swerve to line up a ram the bike's evade beats lines up nothing
 * (DDB-552). Cards that make their own move first (Strafe) are left out,
 * since they reach from wherever they land. The one swerve estimate every
 * AI shares.
 */
export function swerveReach({ board, card, driver, caster, destination = null }: {
	board: BoardProjection;
	card: Card;
	driver: Driver;
	caster: Vehicle;
	destination?: RoadSlot | null;
}): SwerveReach {
	if (!movesCaster(card)) return NO_REACH;
	const from = board.slotOf(caster);
	const [to = null] = board.landingSlots({ card, caster, destination });
	if (!from || !to || sameSlot(from, to)) return NO_REACH;

	const hand = [...board.handOf(driver)];
	const own = hand.indexOf(card);
	if (own !== -1) hand.splice(own, 1);
	const adrenaline = board.adrenalineOf(driver) - card.cost;
	const targets = board.enemiesOf(caster)
		.filter(enemy => !enemy.isOutOfFight && !enemy.isUnmanned())
		.map(enemy => ({ enemy, slot: board.slotOf(enemy) }))
		.filter((target): target is { enemy: Vehicle; slot: RoadSlot } => target.slot !== null);

	const reach: SwerveReach = { gained: 0, lost: 0 };
	for (const other of hand) {
		const range = cardRange(other);
		if (range === null || other.cost > adrenaline || other.isOrder || other.targetType !== 'enemy_single' || movesCaster(other)) continue;
		const shot = other.effects.find(effect => !isCasterAction(effect) && effectRecipientOf({ effect, card: other }) === EffectRecipient.TARGET);
		const hittable = targets.filter(({ enemy }) => !shot || board.effectHits({ effect: shot, card: other, driver, caster, recipient: enemy }));
		const reaches = (slot: RoadSlot): boolean => hittable.some(target => slotRange(slot, target.slot) <= range);
		const value = attackEffectOf(other)?.value;
		const worth = typeof value === 'number' ? value : 1;
		const before = reaches(from);
		const after = reaches(to);
		if (after && !before) reach.gained += worth;
		if (before && !after) reach.lost += worth;
	}
	return reach;
}

/**
 * A swerve's reach as one score at a weight per point of damage: what it
 * puts in range when it takes nothing out, and otherwise minus what it
 * takes out, so a swerve waits until the cards it would strand are played
 * and only then counts for what it opens.
 */
export function swerveScore(reach: SwerveReach, weight: number): number {
	return reach.lost > 0 ? -reach.lost * weight : reach.gained * weight;
}

/**
 * Whether playing the card would only swerve: its swerve opens nothing for
 * the rest of the hand, and the card has nothing else worth playing for
 * (damage, a status, Shield, armor, a repair, adrenaline, or a draw that
 * keeps a card). An AI ends its turn rather than play one, so a raider
 * with nothing to line up doesn't swerve out and back again.
 *
 * A raider's plan (`board.actor`) plays on the enemy turn, and some riders
 * end with that turn: its Shield and a one-turn status on itself are gone
 * as the player's turn starts, before anyone can shoot it, and a card it
 * draws arrives after the plan was made and is discarded then. Those count
 * for nothing, so a raider's Floor It, Hard Brake, or Juke is worth only
 * what its swerve lines up (DDB-552).
 */
export function aimlessSwerve({ board, card, driver, reach }: {
	board: BoardProjection;
	card: Card;
	driver: Driver;
	reach: SwerveReach;
}): boolean {
	if (!movesCaster(card) || reach.gained > 0) return false;
	const raider = board.actor !== null;
	return card.effects.every(effect => effect.type === 'change_position' ||
		effect.type === 'draw_cards' && (raider || cardsKeptFromDraw({ board, card, player: driver }) === 0) ||
		raider && endsWithEnemyTurn({ effect, card }));
}

/** Shield, or a status of one turn on the caster: what a card played on the enemy turn loses as the player's turn starts */
function endsWithEnemyTurn({ effect, card }: { effect: CardEffect; card: Card }): boolean {
	if (effect.type === 'gain_shield') return true;
	const turns = typeof effect.duration === 'number' ? effect.duration : 1;
	return effect.type === 'apply_status' && effectRecipientOf({ effect, card }) === EffectRecipient.CASTER && turns === 1;
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
