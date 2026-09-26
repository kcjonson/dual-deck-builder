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

export function effectRecipientOf({ effect, card }: { effect: CardEffect; card: Card }): EffectRecipient {
	const recipient = effect.target ? RECIPIENT_BY_TARGET[effect.target] : undefined;
	if (recipient) return recipient;
	if (card.targetType === 'self') return EffectRecipient.CASTER;
	if (card.targetType === 'enemy_all') return EffectRecipient.ENEMIES;
	return EffectRecipient.TARGET;
}

/**
 * Whether a damage or status effect rolls the hit check against each
 * recipient. The caster never rolls against itself; anyone else is rolled
 * against unless the effect always hits.
 */
export function rollsToHit({ effect, card }: { effect: CardEffect; card: Card }): boolean {
	return effectRecipientOf({ effect, card }) !== EffectRecipient.CASTER && !effect.always_hits;
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
