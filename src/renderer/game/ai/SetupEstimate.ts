import type { BoardProjection } from '../mechanics/BoardProjection';
import type { Card } from '../mechanics/Card';
import type { Driver } from '../mechanics/Driver';
import { EffectRecipient, effectRecipientOf, isCasterAction } from '../mechanics/EffectTargets';
import { RoadSlot, slotRange } from '../mechanics/Road';
import type { Vehicle } from '../mechanics/Vehicle';

/** Vulnerable adds half again to a hit (Battle.applyDamageModifiers) */
const VULNERABLE_SHARE = 0.5;

/**
 * The damage a Vulnerable the card lands on its target adds to the cards
 * still to play this turn (Cut Off's): half of what each other card in
 * hand, affordable once this one is paid for, would deal the target from
 * where this card leaves its player, past its range and hit check. Its
 * Vulnerable lasts into the enemy turn at most, where the target's side
 * doesn't hit it, so the rest of the turn is all it sets up; raiders
 * planned after this one gain from it too, which this leaves out. Zero
 * for a target already Vulnerable or a card that doesn't make it so.
 */
export function vulnerableSetup({ board, card, driver, caster, target, destination = null }: {
	board: BoardProjection;
	card: Card;
	driver: Driver;
	caster: Vehicle;
	target: Vehicle;
	destination?: RoadSlot | null;
}): number {
	if (target.hasStatusEffect('vulnerable')) return 0;
	const marks = card.effects.some(effect =>
		effect.type === 'apply_status' && effect.status === 'vulnerable' &&
		effectRecipientOf({ effect, card }) === EffectRecipient.TARGET &&
		board.effectHits({ effect, card, driver, caster, recipient: target }));
	const [from = null] = board.landingSlots({ card, caster, destination });
	const targetSlot = board.slotOf(target);
	if (!marks || !from || !targetSlot) return 0;

	const adrenaline = board.adrenalineOf(driver) - card.cost;
	let damage = 0;
	for (const other of board.handOf(driver)) {
		if (other === card || other.cost > adrenaline || other.isOrder || other.targetType !== 'enemy_single') continue;
		for (const effect of other.effects) {
			if (effect.type !== 'damage' || isCasterAction(effect) || effectRecipientOf({ effect, card: other }) !== EffectRecipient.TARGET) continue;
			if (typeof effect.range === 'number' && slotRange(from, targetSlot) > effect.range) continue;
			if (!board.effectHits({ effect, card: other, driver, caster, recipient: target })) continue;
			damage += typeof effect.value === 'number' ? effect.value : 0;
		}
	}
	return damage * VULNERABLE_SHARE;
}
