import { AIPlayer } from './AIPlayer';
import { AggressiveFlankerStrategy } from './AggressiveFlankerAI';
import { AIDecision, GameStateEvaluation } from './types';
import { DamageKind, damageToFinish, effectDamageKind, lastingDamage } from './DamageEstimate';
import { IncomingHit, attackTypeOf, incomingHits } from './IncomingHits';
import { cardMovesSlots, onlyMoves } from './SwerveEstimate';
import { BOXED_IN, Vehicle, splitDamage, statusEvadeModifier, statusSpeedModifier } from '../mechanics/Vehicle';
import { Card, CardEffect } from '../mechanics/Card';
import { Driver } from '../mechanics/Driver';
import { attackEffectOf, movesCaster } from '../mechanics/Intent';
import { BoardProjection, cardRange } from '../mechanics/BoardProjection';
import { ConditionBoard, effectValue } from '../mechanics/EffectConditions';
import { EffectRecipient, effectRecipientOf, effectRecipients, rollsToHit } from '../mechanics/EffectTargets';
import { sameSlot, slotRange } from '../mechanics/Road';

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
	/** Vulnerable lands on a raider that isn't already */
	exposes: boolean;
}

/** What a decision reads once, before it scores each play */
interface Threat {
	incoming: IncomingHit[];
	harmNow: number;
	raiders: Vehicle[];
	raiderHarm: Map<Vehicle, number>;
	gameState: GameStateEvaluation;
}

/**
 * The intent-aware player stand-in (Balance Simulation, Player stand-ins).
 * Before each card it reads the raiders' committed plans as the player sees
 * them (Battle.getAllIntents, Battle's projection of the enemy turn from the
 * board as it stands) and scores every legal play by the harm it keeps off
 * the convoy next enemy turn. A kill or stun removes that raider's attacks.
 * A play that changes the board (a swerve, shove, swap, drop-back, or
 * flank, a speed change, Box In, Evade) is judged against the intents as
 * they'd be once it lands, Battle's own preview, so a hit it makes fizzle,
 * lose its flank bonus, or miss is off (DDB-553). Shield and armor soak
 * what is aimed at the vehicle, and repair keeps a vehicle or driver
 * standing. Harm is structure plus occupant hitpoints, split the way a hit
 * splits, and a wreck or a dead driver counts extra. What a play doesn't
 * change about next turn is scored as the aggressive AI scores it, so with
 * no threat to answer it plays like the floor, except that a move that does
 * nothing, or does harm, waits. One step and no search: it never copies the
 * battle.
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
	/** Score for each point of damage Vulnerable adds to the rest of the turn's hands, as the floor scores a point of damage */
	private static readonly SETUP_WEIGHT = 10;
	/** Vulnerable adds half again to a hit */
	private static readonly VULNERABLE_SHARE = 0.5;
	/** Ending the turn, as the floor scores it */
	private static readonly END_TURN = -1000;

	private readonly offense = new AggressiveFlankerStrategy();

	protected chooseAction(): AIDecision {
		const plays = this.generatePossibleActions().filter(action => action.type === 'playCard');
		if (plays.length === 0) return { type: 'endTurn' };

		const incoming = incomingHits({ battle: this.battle, team: this.team });
		const raiders = [...new Set([...incoming.map(hit => hit.raider), ...this.battle.enemyTeam.vehicles.filter(raider => !raider.isOutOfFight)])];
		const threat: Threat = {
			incoming,
			harmNow: this.convoyHarm({ incoming }),
			raiders,
			raiderHarm: new Map(raiders.map(raider => [raider, this.convoyHarm({ incoming: incoming.filter(hit => hit.raider === raider) })])),
			gameState: this.evaluateGameState()
		};

		let best: AIDecision = { type: 'endTurn' };
		let bestScore = IntentAwareAI.END_TURN;
		for (const play of plays) {
			const score = this.scorePlay({ play, threat });
			if (score > bestScore) {
				best = play;
				bestScore = score;
			}
		}
		return best;
	}

	/**
	 * What one play is worth: the harm it keeps off the convoy, its progress
	 * on the raiders it hurts, hitpoints it restores, the damage its
	 * Vulnerable adds to the rest of the turn, and the floor's score for the
	 * rest. A play that moves someone (anything but a flank) and comes out
	 * worse than nothing, or that only moves and comes out at nothing, scores
	 * under ending the turn: the floor's aimless-swerve rule with the enemy
	 * turn counted, since a swerve that makes a planned hit fizzle isn't
	 * aimless.
	 */
	private scorePlay({ play, threat }: { play: AIDecision; threat: Threat }): number {
		const { card, driver } = play;
		const { harmNow, raiders, raiderHarm, gameState } = threat;
		const target = play.target instanceof Vehicle ? play.target : null;
		const landings = new Map(raiders.map(raider => [raider, this.landing({ play, raider })]));
		const removed = new Set(raiders.filter(raider => this.removes({ raider, landing: landings.get(raider) })));
		const incoming = card && driver && IntentAwareAI.changesBoard(card)
			? incomingHits({ battle: this.battle, team: this.team, preview: { driver, card, target, destination: play.destination ?? null } })
			: threat.incoming;
		const remaining = incoming.filter(hit => !removed.has(hit.raider));
		const protection = this.protectionFrom(play);

		const harmKept = harmNow - this.convoyHarm({ incoming: remaining, protection });
		const progressHarm = this.progress({ landings, removed, raiderHarm });
		const restored = this.restoredHitpoints({ protection, incoming: threat.incoming, harmNow });
		const exposed = [...landings].filter(([raider, landing]) => landing.exposes && !removed.has(raider)).map(([raider]) => raider);
		const setUp = exposed.length > 0 ? this.followUpDamage({ play, raiders: exposed }) * IntentAwareAI.VULNERABLE_SHARE : 0;
		// Hit checks are deterministic, so an attack that can't land is worth nothing, however the floor scores it
		const aimed = target ? landings.get(target) : undefined;
		const floor = this.offense.scorePlay(play, gameState);
		const offense = aimed && aimed.damage.size === 0 && !aimed.stuns && card?.effects.some(effect => effect.type === 'damage')
			? Math.min(0, floor)
			: floor;
		const score = (harmKept + progressHarm * IntentAwareAI.PROGRESS_TURNS) * IntentAwareAI.HARM_WEIGHT +
			restored * IntentAwareAI.RESTORE_WEIGHT +
			setUp * IntentAwareAI.SETUP_WEIGHT +
			offense;
		if (card && driver && cardMovesSlots(card) && (score < 0 || score === 0 && onlyMoves({ board: this.board, card, driver }))) {
			return IntentAwareAI.END_TURN * 2;
		}
		return score;
	}

	/**
	 * Whether a card changes what the enemy turn finds, past damage and
	 * stuns: a move of anyone, a speed change, Box In, or Evade. Those are
	 * judged on the preview (incomingHits).
	 */
	private static changesBoard(card: Card): boolean {
		return card.effects.some(effect => {
			if (effect.type === 'change_position') return true;
			if (effect.type !== 'apply_status' || !effect.status) return false;
			const status = { name: effect.status, duration: 1, value: effect.value };
			return statusSpeedModifier(status) !== 0 || statusEvadeModifier(status) !== 0 || effect.status === BOXED_IN;
		});
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
			let armor = vehicle.armor + (added?.armor ?? 0);
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
	 * is, anything else from the caster's vehicle. An effect lands only where
	 * its landing condition holds (Brake Check's 4 on an ambusher, Box In's
	 * Vulnerable with both driven vehicles near), and damage counts from where
	 * the card's own move puts the caster, with any row bonus there.
	 */
	private landing({ play, raider }: { play: AIDecision; raider: Vehicle }): Landing {
		const landing: Landing = { damage: new Map(), stuns: false, exposes: false };
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
			const conditions = this.conditionsOf({ play, actor, target: raider });
			for (const effect of card.effects) {
				if (effectRecipientOf({ effect, card }) === EffectRecipient.CASTER) continue;
				if (effect.condition === 'target_flanking' && !this.board.isFlanking(raider)) continue;
				if (!this.board.landingConditionHolds({ effect, caster: actor, recipient: raider })) continue;
				const isDamage = effect.type === 'damage';
				// Statuses roll Battle's default check; damage rolls its own attack type
				if (rollsToHit({ effect, card }) && !this.battle.checkHit({
					attacker: actor,
					caster: driver,
					defender: raider,
					...(isDamage ? { attackType: attackTypeOf(effect), modifier: typeof effect.hit_modifier === 'number' ? effect.hit_modifier : 0 } : {})
				})) continue;
				if (effect.type === 'apply_status' && effect.status === 'stunned' && !raider.isSteady) landing.stuns = true;
				if (effect.type === 'apply_status' && effect.status === 'vulnerable' && !raider.hasStatusEffect('vulnerable')) landing.exposes = true;
				if (isDamage) {
					const kind = effectDamageKind(effect);
					landing.damage.set(kind, (landing.damage.get(kind) ?? 0) + this.damageOf({ effect, actor, raider, conditions }));
				}
			}
		}
		return landing;
	}

	/**
	 * What a condition on one of the play's effects reads: where the acting
	 * vehicle will stand once the card's own move lands (Strafe), the
	 * target's slot, and whether the actor has changed slot this turn,
	 * counting that move
	 */
	private conditionsOf({ play, actor, target }: { play: AIDecision; actor: Vehicle; target: Vehicle | null }): ConditionBoard {
		const standing = this.board.slotOf(actor);
		const [casterSlot = standing] = play.card ? this.board.landingSlots({ card: play.card, caster: actor, destination: play.destination ?? null }) : [];
		return {
			casterSlot,
			targetSlot: target ? this.board.slotOf(target) : null,
			casterSwerved: this.board.swervedThisTurn(actor) || !sameSlot(casterSlot, standing)
		};
	}

	/** A hit's damage as Battle works it out on play: value and any bonus that holds, formula, then flanking and Vulnerable */
	private damageOf({ effect, actor, raider, conditions }: { effect: CardEffect; actor: Vehicle; raider: Vehicle; conditions: ConditionBoard }): number {
		let damage = effectValue(effect, conditions);
		if (typeof effect.formula === 'string') {
			damage = this.battle.calculateFormulaDamage(effect.formula, { base: damage, armor: actor.armor, speedDiff: actor.speed - raider.speed });
		}
		return this.battle.calculateDamage(damage, actor, raider);
	}

	/**
	 * Damage the rest of the turn's hands could still deal these raiders
	 * once the play lands: each card left in a hand on the team that's
	 * affordable, aims at one raider, and reaches it from where its player
	 * then stands, at its damage with any bonus that holds there, once for
	 * the best raider it reaches. Vulnerable on them adds half of it.
	 */
	private followUpDamage({ play, raiders }: { play: AIDecision; raiders: Vehicle[] }): number {
		const { card, driver } = play;
		if (!card || !driver) return 0;
		const after = this.boardAfter(play);
		let damage = 0;
		for (const vehicle of this.team.vehicles) {
			const slot = vehicle.isOutOfFight ? null : after.slotOf(vehicle);
			if (!slot) continue;
			for (const occupant of this.actingOccupants(vehicle)) {
				const adrenaline = after.adrenalineOf(occupant);
				for (const other of after.handOf(occupant)) {
					const effect = attackEffectOf(other);
					const range = cardRange(other);
					if (!effect || other.isOrder || other.targetType !== 'enemy_single' || movesCaster(other) || other.cost > adrenaline) continue;
					if (other.isAttack && !occupant.canPlayAttackCards()) continue;
					let best = 0;
					for (const raider of raiders) {
						const raiderSlot = after.slotOf(raider);
						if (!raiderSlot || range !== null && slotRange(slot, raiderSlot) > range) continue;
						best = Math.max(best, effectValue(effect, { casterSlot: slot, targetSlot: raiderSlot, casterSwerved: after.swervedThisTurn(vehicle) }));
					}
					damage += best;
				}
			}
		}
		return damage;
	}

	/** The board once the play lands, moves and all, from the vehicle that carries it out */
	private boardAfter(play: AIDecision): BoardProjection {
		const after = this.board.copy();
		const { card, driver } = play;
		if (!card || !driver) return after;
		const target = play.target instanceof Vehicle ? play.target : null;
		const actor = this.battle.isAttackOrder(card) ? (target ? this.board.orderCarrier({ card, target }) : null) : undefined;
		if (actor !== null) after.apply({ card, driver, target, destination: play.destination ?? null, actor });
		return after;
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
		const conditions = this.conditionsOf({ play, actor: caster, target });

		for (const effect of card.effects) {
			const value = effectValue(effect, conditions);
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
