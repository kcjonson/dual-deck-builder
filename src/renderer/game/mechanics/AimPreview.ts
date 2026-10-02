import type { Battle } from './Battle';
import type { Card, CardEffect } from './Card';
import type { Driver } from './Driver';
import { splitDamage } from './Vehicle';
import type { Vehicle } from './Vehicle';
import { cardRange } from './BoardProjection';
import { EffectRecipient, effectRecipientOf, isCasterAction, landsOnTarget, rollsToHit } from './EffectTargets';
import { nearestTo, slotRange } from './Road';

/**
 * The one hit rule's numbers (Battle.checkHit): gunnery against evade plus
 * the card's modifier, or ramming against evade for a ram. Nothing is
 * rolled, so `hits` is the outcome.
 */
export interface HitCheck {
	skill: 'gunnery' | 'ramming';
	attack: number;
	evade: number;
	/** Added to evade; a ram has none. */
	modifier: number;
	hits: boolean;
}

/** What a card would take off its target's bars if it lands. */
export interface AimLosses {
	structure: number;
	driver: number;
	passenger: number;
}

/**
 * A card aimed at one vehicle, before it's played: who acts, how far away
 * the target is, the hit check, and what it takes off the target's bars
 * (Battle Screen Design section 6, Targeting).
 */
export interface AimPreview {
	/** The vehicle the card acts from: the caster's, or for an attack order the escort that carries it out. */
	actor: Vehicle | null;
	/** Lanes apart plus rows apart from the actor's slot; null when either is off the road. */
	range: number | null;
	/** The card's longest range; null when it has none. */
	reach: number | null;
	/** Whether anything on the card lands on the target; a flank's target is only the vehicle it outruns. */
	lands: boolean;
	/** Null when nothing on the card rolls against the target (a sure hit, or no attack). */
	check: HitCheck | null;
	/** Zero across when the check misses. */
	losses: AimLosses;
}

const NO_LOSSES: AimLosses = { structure: 0, driver: 0, passenger: 0 };

/**
 * The preview of `card` from `driver` on `target`, by the rules play
 * resolves it with: the same actor, the same hit check, the same damage
 * modifiers, and the same split of a vehicle hit through shield, armor,
 * structure, and whoever is aboard. Reads the battle and changes nothing.
 * Damage on the caster (Berserker) isn't counted; only what lands on the
 * target is.
 */
export function previewAim({ battle, driver, card, target }: { battle: Battle; driver: Driver; card: Card; target: Vehicle }): AimPreview {
	const actor = aimActor({ battle, driver, card, target });
	const range = actor?.slot && target.slot ? slotRange(actor.slot, target.slot) : null;
	const reach = cardRange(card);
	const lands = landsOnTarget(card);

	const rolled = card.effects.find(effect => landsOnTargetEffect(effect, card) && isHitEffect(effect) && rollsToHit({ effect, card }));
	const check = rolled ? battle.hitCheck({
		attacker: actor,
		caster: driver,
		defender: target,
		attackType: attackTypeOf(rolled),
		modifier: typeof rolled.hit_modifier === 'number' ? rolled.hit_modifier : 0,
	}) ?? { skill: attackTypeOf(rolled) === 'ramming' ? 'ramming' : 'gunnery', attack: 0, evade: 0, modifier: 0, hits: false } : null;

	if (check && !check.hits) return { actor, range, reach, lands, check, losses: { ...NO_LOSSES } };
	return { actor, range, reach, lands, check, losses: projectLosses({ battle, card, actor, target, range }) };
}

/**
 * Who acts: the caster's own vehicle, or for an attack order the escort
 * that would carry it out, else the nearest ready one, so an out-of-reach
 * raider still reads its range from the convoy.
 */
function aimActor({ battle, driver, card, target }: { battle: Battle; driver: Driver; card: Card; target: Vehicle }): Vehicle | null {
	if (battle.isAttackOrder(card)) {
		const carrier = battle.orderCarrier({ card, target });
		if (carrier) return carrier;
		const ready = battle.playerTeam.escorts.filter(escort => escort.isReady);
		return target.slot ? nearestTo({ to: target.slot, candidates: ready, slotOf: escort => escort.slot }) : null;
	}
	return battle.getVehicleForDriver(driver);
}

function landsOnTargetEffect(effect: CardEffect, card: Card): boolean {
	return !isCasterAction(effect) && effectRecipientOf({ effect, card }) === EffectRecipient.TARGET;
}

function isHitEffect(effect: CardEffect): boolean {
	return effect.type === 'damage' || effect.type === 'apply_status' || effect.type === 'status';
}

function attackTypeOf(effect: CardEffect): string {
	if (typeof effect.attack_type === 'string') return effect.attack_type;
	return effect.scaling === 'ramming' ? 'ramming' : 'ranged';
}

/**
 * Each damage effect that lands on the target, in card order, on a scratch
 * copy of its shield, armor, structure, and crew's HP, split by the rule
 * Vehicle.takeDamage uses (`splitDamage`) after Battle.applyDamage's
 * modifiers. An effect past its own range does nothing.
 */
function projectLosses({ battle, card, actor, target, range }: { battle: Battle; card: Card; actor: Vehicle | null; target: Vehicle; range: number | null }): AimLosses {
	let shield = target.shield ?? 0;
	let armor = target.armor;
	let structure = target.structure;
	const driver = target.driver;
	const passenger = target.passenger;
	let driverHp = driver?.isAlive() ? driver.hitpoints : 0;
	let passengerHp = passenger?.isAlive() ? passenger.hitpoints : 0;

	for (const effect of card.effects) {
		if (effect.type !== 'damage' || !landsOnTargetEffect(effect, card)) continue;
		if (typeof effect.range === 'number' && range !== null && range > effect.range) continue;
		let damage = typeof effect.value === 'number' ? effect.value : 0;
		if (actor) {
			if (typeof effect.formula === 'string') {
				damage = battle.calculateFormulaDamage(effect.formula, { base: damage, armor: actor.armor, speedDiff: actor.speed - target.speed });
			}
			damage = battle.calculateDamage(damage, actor, target);
		}

		if (effect.target === 'driver') {
			const victim = target.driverOnlyTarget;
			if (victim && victim === driver) driverHp = Math.max(0, driverHp - damage);
			else if (victim && victim === passenger) passengerHp = Math.max(0, passengerHp - damage);
			continue;
		}

		const split = splitDamage({ damage, shield, armor, occupied: driverHp > 0 || passengerHp > 0 });
		shield -= split.shield;
		armor -= split.armor;
		structure = Math.max(0, structure - split.structure);
		if (driverHp > 0) driverHp = Math.max(0, driverHp - split.perOccupant);
		if (passengerHp > 0) passengerHp = Math.max(0, passengerHp - split.perOccupant);
	}

	return {
		structure: target.structure - structure,
		driver: (driver?.isAlive() ? driver.hitpoints : 0) - driverHp,
		passenger: (passenger?.isAlive() ? passenger.hitpoints : 0) - passengerHp,
	};
}
