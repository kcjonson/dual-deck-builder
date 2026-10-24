import type { Battle, PlayPreview } from '../mechanics/Battle';
import type { CardEffect } from '../mechanics/Card';
import { effectValue } from '../mechanics/EffectConditions';
import { Intent, IntentTier, IntentType, PlannedAction, attackEffectOf, intentTypeOf, movesCaster } from '../mechanics/Intent';
import { cardFlanks } from '../mechanics/BoardProjection';
import { rollsToHit } from '../mechanics/EffectTargets';
import type { Team } from '../mechanics/Team';
import { EVADE_BOOST, Vehicle } from '../mechanics/Vehicle';

/**
 * One raider attack that will land on a player vehicle next enemy turn,
 * its damage before Shield and armor
 */
export interface IncomingHit {
	raider: Vehicle;
	target: Vehicle;
	damage: number;
}

/**
 * The hit check a damage effect makes, as Battle's damage path picks it.
 * Battle and the aim preview keep their own copies; this one stays here
 * while mechanics/ is another session's.
 */
export const attackTypeOf = (effect: CardEffect): string =>
	typeof effect.attack_type === 'string' ? effect.attack_type : effect.scaling === 'ramming' ? 'ramming' : 'ranged';

/**
 * Every raider attack the player can see coming that will land on the
 * team: each intent matched to its card in the plan (by name, or for an
 * elite's hidden intent by its kind, in plan order, since the intents leave
 * out cards that will fizzle), with the raider's own hit check run against
 * the vehicle it's aimed at. An elite hides its numbers, so a hidden
 * attack's damage is worked out from its card.
 *
 * With `preview`, as they'll be once that card lands (Battle.getAllIntents'
 * preview, DDB-553): a swerve out of a planned card's range drops the hits
 * that fizzle, a shove or drop-back moves the raider, a speed change drops
 * a flanker back or stops a planned flank, Box In stops one, and Evade the
 * card lands (Weave, Bootlegger Turn) is in the hit checks.
 */
export function incomingHits({ battle, team, preview = null }: { battle: Battle; team: Team; preview?: PlayPreview | null }): IncomingHit[] {
	const ours = team.vehicles.filter(vehicle => !vehicle.isOutOfFight);
	// Only Evade changes a hit check, so the board is projected for it only when the card lands some
	const evadeBoard = preview?.card.effects.some(effect => effect.status === EVADE_BOOST)
		? battle.projectEnemyTurnStart({ preview })
		: null;
	const hits: IncomingHit[] = [];
	for (const [raider, intents] of battle.getAllIntents({ preview })) {
		const plan = battle.getPlan(raider);
		const hidden = (raider.intentTier ?? IntentTier.BASIC) !== IntentTier.BASIC;
		let cursor = 0;
		for (const intent of intents) {
			const index = plan.findIndex((action, at) => at >= cursor &&
				(hidden ? intentTypeOf(action.card) === intent.type : action.card.displayName === intent.description));
			const planned = index === -1 ? null : plan[index];
			if (index !== -1) cursor = index + 1;
			const effect = planned ? attackEffectOf(planned.card) : null;
			if (intent.type !== IntentType.ATTACK || !planned || !effect) continue;

			for (const target of intentTargets({ intent, ours })) {
				if (rollsToHit({ effect, card: planned.card }) && !battle.checkHit({
					attacker: raider,
					caster: planned.driver,
					defender: target,
					attackType: attackTypeOf(effect),
					modifier: typeof effect.hit_modifier === 'number' ? effect.hit_modifier : 0,
					evadeBoost: evadeBoard ? evadeBoard.evadeBoostOf(target) : target.evadeBoost
				})) continue;
				const swerved = plan.slice(0, index).some(earlier => movesCaster(earlier.card) || cardFlanks(earlier.card));
				const damage = intent.amount ?? hiddenDamage({ battle, planned, effect, raider, target, swerved });
				if (damage <= 0) continue;
				for (let hit = 0; hit < intent.hits; hit++) hits.push({ raider, target, damage });
			}
		}
	}
	return hits;
}

function intentTargets({ intent, ours }: { intent: Intent; ours: Vehicle[] }): Vehicle[] {
	if (intent.target === 'both') return ours;
	return ours.filter(vehicle => vehicle.id === intent.target);
}

/**
 * A hidden attack's damage, as previewDamage would show it if the tier
 * allowed, with any row bonus from where the plan has the raider (`swerved`:
 * an earlier card in its plan moved it)
 */
function hiddenDamage({ battle, planned, effect, raider, target, swerved }: {
	battle: Battle;
	planned: PlannedAction;
	effect: CardEffect;
	raider: Vehicle;
	target: Vehicle;
	swerved: boolean;
}): number {
	let damage = effectValue(effect, { casterSlot: planned.slot, targetSlot: target.slot, casterSwerved: swerved });
	if (typeof effect.formula === 'string') {
		damage = battle.calculateFormulaDamage(effect.formula, { base: damage, armor: raider.armor, speedDiff: planned.speed - target.speed });
	}
	return battle.calculateDamage(damage, raider, target);
}
