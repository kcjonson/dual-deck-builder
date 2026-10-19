import { AIPlayer } from './AIPlayer';
import { AggressiveFlankerStrategy } from './AggressiveFlankerAI';
import { AIDecision } from './types';
import { DamageKind, damageToFinish, effectDamageKind, lastingDamage } from './DamageEstimate';
import { Vehicle, splitDamage } from '../mechanics/Vehicle';
import { CardEffect } from '../mechanics/Card';
import { Driver } from '../mechanics/Driver';
import { Intent, IntentTier, IntentType, PlannedAction, attackEffectOf, intentTypeOf } from '../mechanics/Intent';
import { BoardProjection, cardRange } from '../mechanics/BoardProjection';
import { EffectRecipient, effectRecipientOf, effectRecipients, rollsToHit } from '../mechanics/EffectTargets';

/**
 * One raider attack that will land on a player vehicle next enemy turn,
 * its damage before Shield and armor
 */
interface IncomingHit {
	raider: Vehicle;
	target: Vehicle;
	damage: number;
}

/**
 * Shield, armor, structure, and occupant hitpoints added to one player
 * vehicle by a play, for weighing what the enemy turn will do to it
 */
interface Protection {
	shield: number;
	armor: number;
	structure: number;
	driverHitpoints: Map<Driver, number>;
}

/** What a play lands on one raider, past its hit checks, by damage kind */
interface Landing {
	damage: Map<DamageKind, number>;
	stuns: boolean;
}

/** Flanking adds half again to a hit, and a flanker that drops back loses it */
const FLANKING_MULTIPLIER = 1.5;

/**
 * The hit check a damage effect makes, as Battle's damage path picks it.
 * Battle and the aim preview keep their own copies; this one stays here
 * while mechanics/ is another session's.
 */
const attackTypeOf = (effect: CardEffect): string =>
	typeof effect.attack_type === 'string' ? effect.attack_type : effect.scaling === 'ramming' ? 'ramming' : 'ranged';

/**
 * The intent-aware player stand-in (Balance Simulation, Player stand-ins).
 * Before each card it reads the raiders' committed plans as the player sees
 * them (Battle.getAllIntents, Battle's projection of the enemy turn from the
 * board as it stands) and scores every legal play by the harm it keeps off
 * the convoy next enemy turn: a kill or stun removes that raider's attacks,
 * outpacing a flanker so it drops back takes the flanking bonus off its hits
 * (the speed test runs on a BoardProjection with the card applied), Shield
 * and armor soak what is aimed at the vehicle, and repair keeps a vehicle or
 * driver standing. Harm is structure plus occupant hitpoints, split the way
 * a hit splits, and a wreck or a dead driver counts extra. What a play
 * doesn't change about next turn is scored as the aggressive AI scores it,
 * so with no threat to answer it plays like the floor. One step and no
 * search: it never copies the battle.
 */
export class IntentAwareAI extends AIPlayer {
	/** Score for each point of harm a play keeps off the convoy */
	private static readonly HARM_WEIGHT = 60;
	/**
	 * How many turns of a raider's harm its non-lethal damage counts for: a
	 * hit now brings its wreck, and the end of its attacks, that much sooner
	 */
	private static readonly PROGRESS_TURNS = 0.5;
	/** Score for each point of driver hitpoints restored that no hit was about to take */
	private static readonly RESTORE_WEIGHT = 15;
	/** Harm a wrecked vehicle or a dead driver counts for past the points it took, since either costs the run far more */
	private static readonly LOSS_HARM = 20;

	private readonly offense = new AggressiveFlankerStrategy();

	protected chooseAction(): AIDecision {
		const plays = this.generatePossibleActions().filter(action => action.type === 'playCard');
		if (plays.length === 0) return { type: 'endTurn' };

		const incoming = this.incomingHits();
		const harmNow = this.convoyHarm({ incoming });
		const raiders = [...new Set([...incoming.map(hit => hit.raider), ...this.battle.enemyTeam.vehicles.filter(raider => !raider.isOutOfFight)])];
		const raiderHarm = new Map(raiders.map(raider => [raider, this.convoyHarm({ incoming: incoming.filter(hit => hit.raider === raider) })]));
		const holding = raiders.filter(raider => IntentAwareAI.holdsFlank(raider));
		const gameState = this.evaluateGameState();

		let best: AIDecision = plays[0];
		let bestScore = -Infinity;
		for (const play of plays) {
			const landings = new Map(raiders.map(raider => [raider, this.landing({ play, raider })]));
			const removed = new Set(raiders.filter(raider => this.removes({ raider, landing: landings.get(raider) })));
			const remaining = this.withoutDroppedFlanks({ play, holding, incoming: incoming.filter(hit => !removed.has(hit.raider)) });
			const protection = this.protectionFrom(play);

			const harmKept = harmNow - this.convoyHarm({ incoming: remaining, protection });
			const progressHarm = this.progress({ landings, removed, raiderHarm });
			const restored = this.restoredHitpoints({ protection, incoming, harmNow });
			// Hit checks are deterministic, so an attack that can't land is worth nothing, however the floor scores it
			const aimed = play.target instanceof Vehicle ? landings.get(play.target) : undefined;
			const offense = aimed && aimed.damage.size === 0 && !aimed.stuns && play.card?.effects.some(effect => effect.type === 'damage')
				? Math.min(0, this.offense.scoreAction(play, gameState))
				: this.offense.scoreAction(play, gameState);
			const score = (harmKept + progressHarm * IntentAwareAI.PROGRESS_TURNS) * IntentAwareAI.HARM_WEIGHT +
				restored * IntentAwareAI.RESTORE_WEIGHT +
				offense;
			if (score > bestScore) {
				best = play;
				bestScore = score;
			}
		}
		return best;
	}

	/**
	 * Every raider attack the player can see coming that will land: each
	 * intent matched to its card in the plan (by name, or for an elite's
	 * hidden intent by its kind, in plan order, since the intents leave out
	 * cards that will fizzle), with the raider's own hit check run against
	 * the vehicle it's aimed at. An elite hides its numbers, so a hidden
	 * attack's damage is worked out from its card on the board as it stands.
	 */
	private incomingHits(): IncomingHit[] {
		const ours = this.team.vehicles.filter(vehicle => !vehicle.isOutOfFight);
		const hits: IncomingHit[] = [];
		for (const [raider, intents] of this.battle.getAllIntents()) {
			const plan = this.battle.getPlan(raider);
			const hidden = (raider.intentTier ?? IntentTier.BASIC) !== IntentTier.BASIC;
			let cursor = 0;
			for (const intent of intents) {
				const index = plan.findIndex((action, at) => at >= cursor &&
					(hidden ? intentTypeOf(action.card) === intent.type : action.card.displayName === intent.description));
				const planned = index === -1 ? null : plan[index];
				if (index !== -1) cursor = index + 1;
				const effect = planned ? attackEffectOf(planned.card) : null;
				if (intent.type !== IntentType.ATTACK || !planned || !effect) continue;

				for (const target of this.intentTargets({ intent, ours })) {
					if (rollsToHit({ effect, card: planned.card }) && !this.battle.checkHit({
						attacker: raider,
						caster: planned.driver,
						defender: target,
						attackType: attackTypeOf(effect),
						modifier: typeof effect.hit_modifier === 'number' ? effect.hit_modifier : 0
					})) continue;
					const damage = intent.amount ?? this.hiddenDamage({ planned, effect, raider, target });
					if (damage <= 0) continue;
					for (let hit = 0; hit < intent.hits; hit++) hits.push({ raider, target, damage });
				}
			}
		}
		return hits;
	}

	private intentTargets({ intent, ours }: { intent: Intent; ours: Vehicle[] }): Vehicle[] {
		if (intent.target === 'both') return ours;
		return ours.filter(vehicle => vehicle.id === intent.target);
	}

	/** A hidden attack's damage, as previewDamage would show it if the tier allowed */
	private hiddenDamage({ planned, effect, raider, target }: { planned: PlannedAction; effect: CardEffect; raider: Vehicle; target: Vehicle }): number {
		let damage = typeof effect.value === 'number' ? effect.value : 0;
		if (typeof effect.formula === 'string') {
			damage = this.battle.calculateFormulaDamage(effect.formula, { base: damage, armor: raider.armor, speedDiff: planned.speed - target.speed });
		}
		return this.battle.calculateDamage(damage, raider, target);
	}

	/**
	 * The harm the incoming hits do the convoy, landing in order on each
	 * vehicle's Shield and armor (with any protection a play adds) before
	 * splitting between structure and the living occupants
	 */
	private convoyHarm({ incoming, protection = new Map() }: { incoming: IncomingHit[]; protection?: Map<Vehicle, Protection> }): number {
		let harm = 0;
		for (const vehicle of this.team.vehicles) {
			if (vehicle.isOutOfFight) continue;
			const added = protection.get(vehicle);
			let shield = (vehicle.shield ?? 0) + (added?.shield ?? 0);
			let armor = Math.min(vehicle.maxArmor, vehicle.armor + (added?.armor ?? 0));
			let structure = Math.min(vehicle.maxStructure, vehicle.structure + (added?.structure ?? 0));
			const occupants = [vehicle.driver, vehicle.passenger].filter((occupant): occupant is Driver => occupant?.isAlive() ?? false);
			const hitpoints = new Map(occupants.map(occupant =>
				[occupant, Math.min(occupant.maxHitpoints, occupant.hitpoints + (added?.driverHitpoints.get(occupant) ?? 0))]));

			for (const hit of incoming) {
				if (hit.target !== vehicle || structure <= 0) continue;
				const living = occupants.filter(occupant => (hitpoints.get(occupant) ?? 0) > 0);
				const split = splitDamage({ damage: hit.damage, shield, armor, occupied: living.length > 0 });
				shield -= split.shield;
				armor -= split.armor;
				harm += Math.min(structure, split.structure);
				structure -= split.structure;
				if (split.structure > 0 && structure <= 0) harm += IntentAwareAI.LOSS_HARM;
				for (const occupant of living) {
					const left = hitpoints.get(occupant) ?? 0;
					harm += Math.min(left, split.perOccupant);
					hitpoints.set(occupant, left - split.perOccupant);
					if (split.perOccupant >= left) harm += IntentAwareAI.LOSS_HARM;
				}
			}
		}
		return harm;
	}

	/**
	 * A flanker that keeps its shoulder at the end of the player's turn as
	 * the board stands: faster than the vehicle it outran (dropBackSlotOf)
	 */
	private static holdsFlank(raider: Vehicle): boolean {
		const outran = raider.flank?.outran;
		return Boolean(raider.flank?.reservedSlot && outran && !outran.isOutOfFight && raider.canFlank(outran));
	}

	/**
	 * The incoming hits once a play leaves holding flankers no faster than
	 * the vehicle they outran, so they drop back at the end of the player's
	 * turn and their hits lose the flanking bonus
	 */
	private withoutDroppedFlanks({ play, holding, incoming }: { play: AIDecision; holding: Vehicle[]; incoming: IncomingHit[] }): IncomingHit[] {
		const { card, driver } = play;
		if (!card || !driver || holding.length === 0) return incoming;

		const after = new BoardProjection({ battle: this.battle });
		after.apply({ card, driver, target: play.target instanceof Vehicle ? play.target : null });
		const dropped = new Set(holding.filter(raider => {
			const outran = raider.flank?.outran;
			return outran && after.speedOf(raider) <= after.speedOf(outran);
		}));
		if (dropped.size === 0) return incoming;
		return incoming.map(hit => dropped.has(hit.raider) ? { ...hit, damage: Math.ceil(hit.damage / FLANKING_MULTIPLIER) } : hit);
	}

	/** Whether what a play lands leaves the raider unable to play its plan: stunned, wrecked, or its driver dead */
	private removes({ raider, landing }: { raider: Vehicle; landing?: Landing }): boolean {
		if (!landing) return false;
		if (landing.stuns) return true;
		for (const [kind, damage] of landing.damage) {
			if (damage >= damageToFinish({ target: raider, kind })) return true;
			// A vehicle hit kills the driver before the wreck when the driver's hitpoints run out first
			const driver = raider.driver;
			if (kind === DamageKind.VEHICLE && driver?.isAlive()) {
				const split = splitDamage({ damage, shield: raider.shield ?? 0, armor: raider.armor, occupied: true });
				if (split.perOccupant >= driver.hitpoints) return true;
			}
		}
		return false;
	}

	/**
	 * The harm a play's non-lethal damage takes off the fight: each raider it
	 * hurts and doesn't remove is that much closer to wrecked, so its share
	 * of what the raider has left to lose, times the harm the raider's
	 * attacks do the convoy a turn
	 */
	private progress({ landings, removed, raiderHarm }: { landings: Map<Vehicle, Landing>; removed: Set<Vehicle>; raiderHarm: Map<Vehicle, number> }): number {
		let progress = 0;
		for (const [raider, landing] of landings) {
			if (removed.has(raider)) continue;
			let share = 0;
			for (const [kind, damage] of landing.damage) {
				share += lastingDamage({ target: raider, damage, kind }) / damageToFinish({ target: raider, kind });
			}
			progress += Math.min(1, share) * (raiderHarm.get(raider) ?? 0);
		}
		return progress;
	}

	/**
	 * What a play lands on one raider, from the vehicle that acts as Battle
	 * resolves the card: an attack order through its carrier escort, Rally
	 * the Convoy through each ready escort whose nearest raider in range this
	 * is, anything else from the caster's vehicle
	 */
	private landing({ play, raider }: { play: AIDecision; raider: Vehicle }): Landing {
		const landing: Landing = { damage: new Map(), stuns: false };
		const { card, driver } = play;
		const caster = driver ? this.board.vehicleOf(driver) : null;
		if (!card || !driver || !caster) return landing;

		let actors: Vehicle[];
		if (card.isOrder && card.targetType === 'enemy_all') {
			const range = cardRange(card) ?? 0;
			actors = this.team.escorts.filter(escort => escort.isReady && this.board.nearestEnemyInRange({ from: escort, range }) === raider);
		} else if (play.target !== raider && card.targetType !== 'enemy_all') {
			actors = [];
		} else if (this.battle.isAttackOrder(card)) {
			const carrier = this.board.orderCarrier({ card, target: raider });
			actors = carrier ? [carrier] : [];
		} else {
			actors = [caster];
		}

		for (const actor of actors) {
			for (const effect of card.effects) {
				if (effectRecipientOf({ effect, card }) === EffectRecipient.CASTER) continue;
				if (effect.condition === 'target_flanking' && !this.board.isFlanking(raider)) continue;
				const isDamage = effect.type === 'damage';
				// Statuses roll Battle's default check; damage rolls its own attack type
				if (rollsToHit({ effect, card }) && !this.battle.checkHit({
					attacker: actor,
					caster: driver,
					defender: raider,
					...(isDamage ? { attackType: attackTypeOf(effect), modifier: typeof effect.hit_modifier === 'number' ? effect.hit_modifier : 0 } : {})
				})) continue;
				if (effect.type === 'apply_status' && effect.status === 'stunned') landing.stuns = true;
				if (isDamage) {
					const kind = effectDamageKind(effect);
					landing.damage.set(kind, (landing.damage.get(kind) ?? 0) + this.damageOf({ effect, actor, raider }));
				}
			}
		}
		return landing;
	}

	/** A hit's damage as Battle works it out on play: formula, then flanking and Vulnerable */
	private damageOf({ effect, actor, raider }: { effect: CardEffect; actor: Vehicle; raider: Vehicle }): number {
		let damage = typeof effect.value === 'number' ? effect.value : 0;
		if (typeof effect.formula === 'string') {
			damage = this.battle.calculateFormulaDamage(effect.formula, { base: damage, armor: actor.armor, speedDiff: actor.speed - raider.speed });
		}
		return this.battle.calculateDamage(damage, actor, raider);
	}

	/**
	 * What a play adds to the convoy's own vehicles before the enemy turn:
	 * Shield, armor, repair, and driver healing, on the vehicles the card
	 * lands on. A driver heal goes to the first living occupant, as it does
	 * in play when nobody picks a patient.
	 */
	private protectionFrom(play: AIDecision): Map<Vehicle, Protection> {
		const protection = new Map<Vehicle, Protection>();
		const { card, driver } = play;
		const caster = driver ? this.board.vehicleOf(driver) : null;
		if (!card || !driver || !caster) return protection;
		const target = play.target instanceof Vehicle ? play.target : null;

		for (const effect of card.effects) {
			const value = typeof effect.value === 'number' ? effect.value : 0;
			if (value <= 0) continue;
			for (const vehicle of effectRecipients({ effect, card, caster, target, enemies: [] })) {
				if (!this.team.vehicles.includes(vehicle)) continue;
				const entry = protection.get(vehicle) ?? { shield: 0, armor: 0, structure: 0, driverHitpoints: new Map() };
				switch (effect.type) {
					case 'gain_shield':
						entry.shield += value;
						break;
					case 'gain_armor':
						entry.armor += value;
						break;
					case 'heal':
						entry.structure += value;
						break;
					case 'heal_driver': {
						const patient = [vehicle.driver, vehicle.passenger].find(occupant => occupant?.isAlive());
						if (!patient) continue;
						entry.driverHitpoints.set(patient, (entry.driverHitpoints.get(patient) ?? 0) + value);
						break;
					}
					default:
						continue;
				}
				protection.set(vehicle, entry);
			}
		}
		return protection;
	}

	/**
	 * Driver hitpoints a heal gives back beyond what it saves from next
	 * turn's hits, which convoyHarm already counts. Hitpoints carry from
	 * fight to fight on a run, so they're worth restoring with no threat.
	 */
	private restoredHitpoints({ protection, incoming, harmNow }: { protection: Map<Vehicle, Protection>; incoming: IncomingHit[]; harmNow: number }): number {
		let restored = 0;
		for (const [vehicle, added] of protection) {
			if (added.driverHitpoints.size === 0) continue;
			let healed = 0;
			for (const [patient, healing] of added.driverHitpoints) {
				healed += Math.min(healing, patient.maxHitpoints - patient.hitpoints);
			}
			const healingOnly: Protection = { shield: 0, armor: 0, structure: 0, driverHitpoints: added.driverHitpoints };
			const saved = harmNow - this.convoyHarm({ incoming, protection: new Map([[vehicle, healingOnly]]) });
			restored += Math.max(0, healed - saved);
		}
		return restored;
	}
}
