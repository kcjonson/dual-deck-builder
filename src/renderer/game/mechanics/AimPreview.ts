import type { Battle } from './Battle';
import type { Card, CardEffect } from './Card';
import type { Driver } from './Driver';
import { splitDamage } from './Vehicle';
import type { Vehicle } from './Vehicle';
import { BoardProjection, cardRange } from './BoardProjection';
import { EffectRecipient, effectRecipientOf, isCasterAction, landsOnTarget, rollsToHit } from './EffectTargets';
import { pickedMoveOf } from './Movement';
import { RoadSlot, nearestTo, slotRange } from './Road';
import { effectBonus } from './EffectConditions';

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
	/**
	 * Lanes apart plus rows apart from where the actor stands when the card
	 * reaches out: its slot, or where the card's own move lands it (Strafe,
	 * Cut Off). Null when either is off the road.
	 */
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
 *
 * A card that moves its caster before it reaches out (Strafe, Cut Off)
 * reads its range from where the move lands, as the target rule does
 * (BoardProjection.landingSlots): the picked `destination`, the one slot
 * a fixed move goes to, or until a slot is picked the nearest of the slots
 * the card could pick.
 */
export function previewAim({ battle, driver, card, target, destination = null }: {
	battle: Battle;
	driver: Driver;
	card: Card;
	target: Vehicle;
	destination?: RoadSlot | null;
}): AimPreview {
	const actor = aimActor({ battle, driver, card, target });
	const range = actor && target.slot ? landingRange({ battle, card, actor, target: target.slot, destination }) : null;
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

/** The range the target rule measures: from the nearest slot the actor lands in, or null when it's off the road. */
function landingRange({ battle, card, actor, target, destination }: {
	battle: Battle;
	card: Card;
	actor: Vehicle;
	target: RoadSlot;
	destination: RoadSlot | null;
}): number | null {
	const slots = new BoardProjection({ battle }).landingSlots({ card, caster: actor, destination });
	return slots.length > 0 ? Math.min(...slots.map(slot => slotRange(slot, target))) : null;
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

	const board = new BoardProjection({ battle });
	for (const effect of card.effects) {
		if (effect.type !== 'damage' || !landsOnTargetEffect(effect, card)) continue;
		if (typeof effect.range === 'number' && range !== null && range > effect.range) continue;
		// Brake Check's damage, only on an ambusher
		if (!board.landingConditionHolds({ effect, caster: actor, recipient: target })) continue;
		let damage = typeof effect.value === 'number' ? effect.value : 0;
		// Point Man's ahead row, Tail Gunner's target ahead, as play adds them
		damage += effectBonus(effect, { casterSlot: actor?.slot ?? null, targetSlot: target.slot, casterSwerved: actor ? battle.swervedThisTurn(actor) : false });
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

/**
 * Range 2, the furthest any card reaches today (Battle Screen Design
 * section 1). A slot's readout counts a card with no range of its own
 * (Juke, Bootlegger Turn, Fall In) against it, so OUT reads as out of
 * reach of every card (call 301).
 */
export const LONGEST_REACH = 2;

/** A destination hovered before it's picked (slot targeting), as the range readouts show it. */
export interface DestinationPreview {
	/** Where the readout measures from. */
	from: RoadSlot;
	/** Each raider on the road and its range from `from`, a shoved raider's from the destination. */
	ranges: Map<Vehicle, number>;
	/** What R1 and R2 are counted against before OUT: the card's own range, or LONGEST_REACH. */
	reach: number;
}

/**
 * Every raider's range once the card's picked move lands on `destination`
 * (Battle Screen Design section 6, slot targeting's hover). When the
 * vehicle moving is yours (Juke, Strafe, Bootlegger Turn, Fall In's
 * escort) the ranges are read from the destination, where it will stand;
 * when it's a raider being shoved (Shoulder Check) they're read from the
 * caster's vehicle, with the shoved raider at the destination (call 300).
 * Null for a card that picks no slot, or a mover that isn't on the road.
 * Pass the card's `target` once it's known, for a move that moves it.
 */
export function previewDestination({ battle, driver, card, target = null, destination }: {
	battle: Battle;
	driver: Driver;
	card: Card;
	target?: Vehicle | null;
	destination: RoadSlot;
}): DestinationPreview | null {
	const move = pickedMoveOf(card);
	const caster = battle.getVehicleForDriver(driver);
	const mover = move?.mover === 'target' ? target : caster;
	if (!move || !mover?.slot) return null;
	const shoved = battle.enemyTeam.vehicles.includes(mover);
	const from = shoved ? caster?.slot ?? null : destination;
	if (!from) return null;
	const ranges = new Map<Vehicle, number>();
	for (const raider of battle.enemyTeam.vehicles) {
		const at = raider === mover ? destination : raider.slot;
		if (raider.isOutOfFight || !at) continue;
		ranges.set(raider, slotRange(from, at));
	}
	return { from, ranges, reach: cardRange(card) ?? LONGEST_REACH };
}
