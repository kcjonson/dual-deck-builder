import type { Battle, PlayPreview } from '../mechanics/Battle';
import { Intent, IntentType, attackEffectOf } from '../mechanics/Intent';
import { attackTypeOf, rollsToHit } from '../mechanics/EffectTargets';
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
 * Every raider attack the player can see coming that will land on the
 * team: each intent matched to its card in the plan by name, in plan order
 * (the intents leave out cards that will fizzle), with the raider's own hit
 * check run against the vehicle it's aimed at. An elite's or boss's intents
 * are read in full (call 240), their damage worked out by the same
 * projection of the enemy turn as a basic raider's.
 *
 * With `preview`, as they'll be once that card lands (Battle.getAllIntents'
 * preview, DDB-553): a swerve out of a planned card's range drops the hits
 * that fizzle, a shove or drop-back moves the raider, a speed change drops
 * a flanker back (and its flank bonus with it) or stops a planned flank,
 * Box In stops one, and Evade the card lands (Weave, Bootlegger Turn) is in
 * the hit checks.
 */
export function incomingHits({ battle, team, preview = null }: { battle: Battle; team: Team; preview?: PlayPreview | null }): IncomingHit[] {
	const ours = team.vehicles.filter(vehicle => !vehicle.isOutOfFight);
	// Only Evade changes a hit check, so the board is projected for it only when the card lands some
	const evadeBoard = preview?.card.effects.some(effect => effect.status === EVADE_BOOST)
		? battle.projectEnemyTurnStart({ preview })
		: null;
	const hits: IncomingHit[] = [];
	for (const [raider, intents] of battle.getAllIntents({ preview, reveal: true })) {
		const plan = battle.getPlan(raider);
		let cursor = 0;
		for (const intent of intents) {
			const index = plan.findIndex((action, at) => at >= cursor && action.card.displayName === intent.description);
			const planned = index === -1 ? null : plan[index];
			if (index !== -1) cursor = index + 1;
			const effect = planned ? attackEffectOf(planned.card) : null;
			if (intent.type !== IntentType.ATTACK || !planned || !effect || intent.amount === null || intent.amount <= 0) continue;

			for (const target of intentTargets({ intent, ours })) {
				if (rollsToHit({ effect, card: planned.card }) && !battle.checkHit({
					attacker: raider,
					caster: planned.driver,
					defender: target,
					attackType: attackTypeOf(effect),
					modifier: typeof effect.hit_modifier === 'number' ? effect.hit_modifier : 0,
					evadeBoost: evadeBoard ? evadeBoard.evadeBoostOf(target) : target.evadeBoost
				})) continue;
				for (let hit = 0; hit < intent.hits; hit++) hits.push({ raider, target, damage: intent.amount });
			}
		}
	}
	return hits;
}

function intentTargets({ intent, ours }: { intent: Intent; ours: Vehicle[] }): Vehicle[] {
	if (intent.target === 'both') return ours;
	return ours.filter(vehicle => vehicle.id === intent.target);
}
