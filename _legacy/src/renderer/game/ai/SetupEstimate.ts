import type { BoardProjection } from '../mechanics/BoardProjection';
import type { Card } from '../mechanics/Card';
import type { Driver } from '../mechanics/Driver';
import { effectValue } from '../mechanics/EffectConditions';
import { EffectRecipient, effectRecipientOf, isCasterAction } from '../mechanics/EffectTargets';
import { movesCaster } from '../mechanics/Intent';
import { RoadSlot, slotRange } from '../mechanics/Road';
import type { Vehicle } from '../mechanics/Vehicle';
import { actingOccupants } from './SwerveEstimate';

/** Vulnerable adds half again to a hit (Battle.applyDamageModifiers) */
const VULNERABLE_SHARE = 0.5;

/**
 * The damage a Vulnerable the card lands on its target adds to the cards
 * still to play this turn (Cut Off's): half of what the rest of the turn's
 * hands would deal the target once the card lands. Every hand on the
 * caster's side counts (both drivers', DDB-553; a raider planning counts
 * only its own), each card at its damage with any bonus that holds, from
 * where its player then stands, past its range and hit check, the biggest
 * first, as many as that player's own adrenaline pays for. Its Vulnerable
 * lasts into the enemy turn at most, where the target's side doesn't hit
 * it, so the rest of the turn is all it sets up; raiders planned after this
 * one gain from it too, which this leaves out. Zero for a target already
 * Vulnerable on the board, or a card whose Vulnerable wouldn't land (a
 * miss, or Box In without both your vehicles in reach). Either side's AI
 * can use it, and both player stand-ins read it through the floor's score
 * (call 360).
 */
export function vulnerableSetup({ board, card, driver, caster, target, destination = null }: {
	board: BoardProjection;
	card: Card;
	driver: Driver;
	caster: Vehicle;
	target: Vehicle;
	destination?: RoadSlot | null;
}): number {
	if (board.isVulnerable(target)) return 0;
	const marks = card.effects.some(effect =>
		effect.type === 'apply_status' && effect.status === 'vulnerable' &&
		effectRecipientOf({ effect, card }) === EffectRecipient.TARGET &&
		board.landingConditionHolds({ effect, caster, recipient: target }) &&
		board.effectHits({ effect, card, driver, caster, recipient: target }));
	if (!marks) return 0;
	// Where everyone stands, and what's left in hand, once the card lands (Cut Off's swerve, Brake Check's drop-back)
	const after = board.copy();
	after.apply({ card, driver, target, destination, actor: caster });
	const targetSlot = after.slotOf(target);
	if (!targetSlot) return 0;

	let damage = 0;
	for (const vehicle of board.teamOf(caster)) {
		const slot = vehicle.isOutOfFight ? null : after.slotOf(vehicle);
		if (!slot) continue;
		for (const occupant of actingOccupants({ board, vehicle })) {
			const shots: { cost: number; damage: number }[] = [];
			for (const other of after.handOf(occupant)) {
				if (other.isOrder || other.targetType !== 'enemy_single' || movesCaster(other)) continue;
				if (other.isAttack && !occupant.canPlayAttackCards()) continue;
				let shot = 0;
				for (const effect of other.effects) {
					if (effect.type !== 'damage' || isCasterAction(effect) || effectRecipientOf({ effect, card: other }) !== EffectRecipient.TARGET) continue;
					if (typeof effect.range === 'number' && slotRange(slot, targetSlot) > effect.range) continue;
					if (!after.effectHits({ effect, card: other, driver: occupant, caster: vehicle, recipient: target })) continue;
					shot += effectValue(effect, { casterSlot: slot, targetSlot, casterSwerved: after.swervedThisTurn(vehicle) });
				}
				if (shot > 0) shots.push({ cost: other.cost, damage: shot });
			}
			let adrenaline = after.adrenalineOf(occupant);
			for (const shot of shots.sort((a, b) => b.damage - a.damage)) {
				if (shot.cost > adrenaline) continue;
				adrenaline -= shot.cost;
				damage += shot.damage;
			}
		}
	}
	return damage * VULNERABLE_SHARE;
}
