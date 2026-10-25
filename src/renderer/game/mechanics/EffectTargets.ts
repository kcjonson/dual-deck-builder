import type { Card, CardEffect } from './Card';
import type { Vehicle } from './Vehicle';

/**
 * Who one card effect lands on. The card's target is only where the player
 * dropped it; each effect names its own recipient, so Berserker's self
 * damage lands on the caster and EMP Blast's status on every enemy.
 */
export enum EffectRecipient {
	/** The caster's vehicle, or for self_driver damage the caster themself */
	CASTER = 'caster',
	/** The card's target vehicle, or for driver damage whoever it carries */
	TARGET = 'target',
	/** Every vehicle on the other team still in the fight */
	ENEMIES = 'enemies'
}

const RECIPIENT_BY_TARGET: Record<string, EffectRecipient> = {
	self: EffectRecipient.CASTER,
	self_driver: EffectRecipient.CASTER,
	same_vehicle: EffectRecipient.CASTER,
	target: EffectRecipient.TARGET,
	driver: EffectRecipient.TARGET,
	enemy_all: EffectRecipient.ENEMIES
};

/**
 * The effect target values card data may use. An effect with none goes
 * where its card's targetType points.
 */
export const EFFECT_TARGETS: readonly string[] = Object.keys(RECIPIENT_BY_TARGET);

/**
 * Effects that are the caster's own doing: drawing, gaining adrenaline,
 * moving. They happen once per card, whatever happened to the card's
 * target. A move's own target field says who it moves, the caster or the
 * card's target (Movement.moveSpecOf), and it never rolls to hit: a move
 * that should only follow a hit says `on_hit`.
 */
const CASTER_ACTIONS = new Set(['draw', 'draw_cards', 'adrenaline', 'gain_resource', 'change_position']);

export function isCasterAction(effect: CardEffect): boolean {
	return CASTER_ACTIONS.has(effect.type);
}

/**
 * No spec says what a both_drivers card does to the partner, so it lands
 * on the caster, as it did when the caster's vehicle stood in for the
 * target. An `any` card always has a target. A move lands on whoever it
 * moves: a shove or a drop-back of the card's target (Lay on the Horn,
 * Brake Check) lands on the target, though it's still resolved once as the
 * caster's action.
 */
export function effectRecipientOf({ effect, card }: { effect: CardEffect; card: Card }): EffectRecipient {
	if (effect.type === 'change_position') return effect.target === 'target' ? EffectRecipient.TARGET : EffectRecipient.CASTER;
	if (isCasterAction(effect)) return EffectRecipient.CASTER;
	const recipient = effect.target ? RECIPIENT_BY_TARGET[effect.target] : undefined;
	if (recipient) return recipient;
	if (card.targetType === 'self' || card.targetType === 'both_drivers') return EffectRecipient.CASTER;
	if (card.targetType === 'enemy_all') return EffectRecipient.ENEMIES;
	return EffectRecipient.TARGET;
}

/**
 * Whether any of the card's effects lands on its target. A flank's target
 * is only the vehicle it outruns, so nothing lands there.
 */
export function landsOnTarget(card: Card): boolean {
	return card.effects.some(effect => effectRecipientOf({ effect, card }) === EffectRecipient.TARGET);
}

/**
 * Whether a damage or status effect rolls the hit check against each
 * recipient. The caster never rolls against itself; anyone else is rolled
 * against unless the effect always hits. A caster action never rolls, a
 * shove included: one that should follow a hit says `on_hit`.
 */
export function rollsToHit({ effect, card }: { effect: CardEffect; card: Card }): boolean {
	return !isCasterAction(effect) && effectRecipientOf({ effect, card }) !== EffectRecipient.CASTER && !effect.always_hits;
}

/**
 * The hit check a damage effect rolls: its `attack_type`, else ramming for
 * a ramming-scaled hit, else ranged. Play, the projection, the aim
 * preview, and the AIs all read it here.
 */
export function attackTypeOf(effect: CardEffect): string {
	if (typeof effect.attack_type === 'string') return effect.attack_type;
	return effect.scaling === 'ramming' ? 'ramming' : 'ranged';
}

/**
 * The vehicles one effect lands on. The one rule for play, the enemy turn,
 * and the planning projection; each passes its own view of the enemies.
 */
export function effectRecipients({
	effect,
	card,
	caster,
	target,
	enemies
}: {
	effect: CardEffect;
	card: Card;
	caster: Vehicle | null;
	target: Vehicle | null;
	enemies: readonly Vehicle[];
}): Vehicle[] {
	switch (effectRecipientOf({ effect, card })) {
		case EffectRecipient.CASTER:
			return caster ? [caster] : [];
		case EffectRecipient.ENEMIES:
			return enemies.filter(enemy => !enemy.isOutOfFight);
		case EffectRecipient.TARGET:
			return target ? [target] : [];
	}
}
