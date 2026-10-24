import { BoardProjection, cardRange } from '../mechanics/BoardProjection';
import type { Card } from '../mechanics/Card';
import type { Driver } from '../mechanics/Driver';
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
 * anyone it could hit is in range from one slot and not the other. Cards
 * that make their own move first (Strafe) are left out, since they reach
 * from wherever they land. The one swerve estimate every AI shares.
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
		.map(enemy => enemy.isOutOfFight || enemy.isUnmanned() ? null : board.slotOf(enemy))
		.filter((slot): slot is RoadSlot => slot !== null);
	const reaches = (slot: RoadSlot, range: number): boolean => targets.some(target => slotRange(slot, target) <= range);

	const reach: SwerveReach = { gained: 0, lost: 0 };
	for (const other of hand) {
		const range = cardRange(other);
		if (range === null || other.cost > adrenaline || other.isOrder || other.targetType !== 'enemy_single' || movesCaster(other)) continue;
		const value = attackEffectOf(other)?.value;
		const worth = typeof value === 'number' ? value : 1;
		const before = reaches(from, range);
		const after = reaches(to, range);
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
 */
export function aimlessSwerve({ board, card, driver, reach }: {
	board: BoardProjection;
	card: Card;
	driver: Driver;
	reach: SwerveReach;
}): boolean {
	if (!movesCaster(card) || reach.gained > 0) return false;
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
