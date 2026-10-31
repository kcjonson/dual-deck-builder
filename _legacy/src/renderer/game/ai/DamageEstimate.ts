import type { Card, CardEffect } from '../mechanics/Card';
import type { Vehicle } from '../mechanics/Vehicle';
import { EffectRecipient, effectRecipientOf } from '../mechanics/EffectTargets';

/**
 * Where a hit's damage goes, which decides what stands in its way. Shield
 * and armor stop a vehicle hit; driver-only damage (Headshot) and
 * structure-only damage (Ramming Run's cost) skip both.
 */
export enum DamageKind {
	VEHICLE = 'vehicle',
	STRUCTURE_ONLY = 'structure_only',
	DRIVER_ONLY = 'driver_only'
}

export function effectDamageKind(effect: CardEffect): DamageKind {
	if (effect.target === 'driver') return DamageKind.DRIVER_ONLY;
	if (effect.structure_only === true) return DamageKind.STRUCTURE_ONLY;
	return DamageKind.VEHICLE;
}

/**
 * The kind of damage a card deals its target
 */
export function cardDamageKind(card: Card): DamageKind {
	const onTarget = card.effects.find(effect => effect.type === 'damage' &&
		effectRecipientOf({ effect, card }) === EffectRecipient.TARGET);
	return onTarget ? effectDamageKind(onTarget) : DamageKind.VEHICLE;
}

/**
 * The smallest hit of this kind that finishes what it lands on: the person
 * a driver-only hit reaches, the bare structure for structure-only damage,
 * or the vehicle through its Shield and armor. The one kill estimate every
 * AI shares.
 */
export function damageToFinish({ target, kind }: { target: Vehicle; kind: DamageKind }): number {
	switch (kind) {
		case DamageKind.DRIVER_ONLY:
			return target.driverOnlyTarget?.hitpoints ?? Infinity;
		case DamageKind.STRUCTURE_ONLY:
			return target.structure;
		case DamageKind.VEHICLE:
			return target.damageToWreck;
	}
}

/**
 * The part of a hit that outlasts the turn. Shield soaks a vehicle hit
 * first and clears on its own at the start of the player's turn, so damage
 * it takes is wasted.
 */
export function lastingDamage({ target, damage, kind }: { target: Vehicle; damage: number; kind: DamageKind }): number {
	if (kind !== DamageKind.VEHICLE) return damage;
	return Math.max(0, damage - (target.shield ?? 0));
}
