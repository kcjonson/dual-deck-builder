import type { Card } from './Card';
import type { Vehicle } from './Vehicle';
import { landsOnTarget } from './EffectTargets';

/**
 * Who a raider goes for, set per raider and independent of the AI strategy
 * that plans for it. A looter goes for haulers, a killer for driven
 * vehicles. A raider with neither plans with no preference. See Combat
 * Rules, Enemy intents, and escorts.md, Raider preferences.
 */
export type RaiderArchetype = 'looter' | 'killer';

export function isPreferredTarget({ archetype, target }: { archetype: RaiderArchetype; target: Vehicle }): boolean {
	switch (archetype) {
		case 'looter':
			return target.escort?.role === 'hauler';
		case 'killer':
			return !target.isEscort;
	}
}

/**
 * Narrow a card's legal targets to the ones this raider's archetype
 * prefers. Only a card aimed at the other side that lands something on its
 * target has a preference; a flank's target is only the vehicle to outrun.
 * With no preferred target among them the legal targets come back as they
 * are, so the raider plans as it would with no archetype. Legality is
 * BoardProjection.targetBlocker's alone; this only chooses among what it
 * allows.
 */
export function preferredTargets<T extends Vehicle>({
	archetype,
	card,
	targets
}: {
	archetype: RaiderArchetype | null | undefined;
	card: Card;
	targets: T[];
}): T[] {
	if (!archetype || card.targetType !== 'enemy_single' || !landsOnTarget(card)) {
		return targets;
	}
	const preferred = targets.filter(target => isPreferredTarget({ archetype, target }));
	return preferred.length > 0 ? preferred : targets;
}
