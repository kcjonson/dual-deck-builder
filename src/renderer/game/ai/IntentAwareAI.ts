import { AIPlayer } from './AIPlayer';
import { AggressiveFlankerStrategy } from './AggressiveFlankerAI';
import { AIDecision } from './types';
import { DamageKind, damageToFinish, effectDamageKind, lastingDamage } from './DamageEstimate';
import { Vehicle, splitDamage } from '../mechanics/Vehicle';
import { Card, CardEffect } from '../mechanics/Card';
import { Driver } from '../mechanics/Driver';
import { Intent, IntentType, attackEffectOf } from '../mechanics/Intent';
import { BoardProjection } from '../mechanics/BoardProjection';
import { EffectRecipient, effectRecipientOf, effectRecipients, rollsToHit } from '../mechanics/EffectTargets';

/**
 * One raider attack headed at the convoy next enemy turn: who throws it,
 * the player vehicles it lands on, and its damage per vehicle before Shield
 * and armor
 */
interface IncomingHit {
	raider: Vehicle;
	targets: Vehicle[];
	damage: number;
}

/** Flanking adds half again to a hit, and a flanker that drops back loses it */
const FLANKING_MULTIPLIER = 1.5;

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

/**
 * The intent-aware player stand-in (Balance Simulation, Player stand-ins).
 * Before each card it reads the raiders' committed plans as the player sees
 * them (Battle.getAllIntents, worked out on the projected board) and scores
 * every legal play by the harm it keeps off the convoy next enemy turn:
 * a kill or stun removes that raider's attacks, outpacing a flanker so it
 * drops back takes the flanking bonus off its hits (the speed test runs on
 * a BoardProjection with the card applied), Shield and armor soak what is
 * aimed at the vehicle, and repair keeps a vehicle or driver standing.
 * Harm is structure plus occupant hitpoints, split the way a hit splits,
 * and a wreck or a dead driver counts extra.
 * What a play doesn't change about next turn is scored as the aggressive AI
 * scores it, so with no threat to answer it plays like the floor. One step
 * and no search: it never copies the battle.
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
		const actions = this.generatePossibleActions();
		const plays = actions.filter(action => action.type === 'playCard');
		if (plays.length === 0) return { type: 'endTurn' };

		const incoming = this.incomingHits();
		const harmNow = this.convoyHarm({ incoming });
		const gameState = this.evaluateGameState();

		let best: AIDecision = plays[0];
		let bestScore = -Infinity;
		for (const play of plays) {
			const remaining = this.withoutDroppedFlanks({ play, incoming: this.withoutRemovedRaiders({ play, incoming }) });
			const harmAfter = this.convoyHarm({ incoming: remaining, protection: this.protectionFrom(play) });
			const score = (harmNow - harmAfter + this.progress({ play, incoming }) * IntentAwareAI.PROGRESS_TURNS) * IntentAwareAI.HARM_WEIGHT +
				this.restoredHitpoints({ play, incoming }) * IntentAwareAI.RESTORE_WEIGHT +
				this.offense.scoreAction(play, gameState);
			if (score > bestScore) {
				best = play;
				bestScore = score;
			}
		}
		return best;
	}

	/**
	 * Every attack the raiders have committed to, as the player sees it. An
	 * elite hides its numbers, so a hidden attack is read from the printed
	 * value of the card in that slot of its plan.
	 */
	private incomingHits(): IncomingHit[] {
		const ours = this.team.vehicles.filter(vehicle => !vehicle.isOutOfFight);
		const hits: IncomingHit[] = [];
		for (const [raider, intents] of this.battle.getAllIntents()) {
			const hiddenAttacks = this.battle.getPlan(raider)
				.map(({ card }) => attackEffectOf(card))
				.filter((effect): effect is CardEffect => effect !== null);
			let attackIndex = 0;
			for (const intent of intents) {
				if (intent.type !== IntentType.ATTACK) continue;
				const printed = hiddenAttacks[attackIndex++];
				const damage = intent.amount ?? (typeof printed?.value === 'number' ? printed.value : 0);
				const targets = this.intentTargets({ intent, ours });
				if (damage > 0 && targets.length > 0) {
					for (let hit = 0; hit < intent.hits; hit++) hits.push({ raider, targets, damage });
				}
			}
		}
		return hits;
	}

	private intentTargets({ intent, ours }: { intent: Intent; ours: Vehicle[] }): Vehicle[] {
		if (intent.target === 'both') return ours;
		return ours.filter(vehicle => vehicle.id === intent.target);
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
				if (!hit.targets.includes(vehicle) || structure <= 0) continue;
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
	 * The incoming hits left once a play wrecks, kills the driver of, or
	 * stuns the raiders it lands on, each of which drops its plan
	 */
	private withoutRemovedRaiders({ play, incoming }: { play: AIDecision; incoming: IncomingHit[] }): IncomingHit[] {
		const { card, driver } = play;
		const caster = driver ? this.board.vehicleOf(driver) : null;
		if (!card || !driver || !caster) return incoming;
		const removed = new Set<Vehicle>();
		for (const raider of new Set(incoming.map(hit => hit.raider))) {
			const landed = this.landing({ card, driver, caster, raider, target: play.target });
			if (landed.stuns || (landed.damage > 0 && this.finishes({ raider, ...landed }))) removed.add(raider);
		}
		return removed.size === 0 ? incoming : incoming.filter(hit => !removed.has(hit.raider));
	}

	/**
	 * The incoming hits once a play leaves flankers no faster than the
	 * vehicle they outran, so they drop back at the end of the player's turn
	 * and their hits lose the flanking bonus. A flanker that will drop back
	 * as the board stands is already shown without it.
	 */
	private withoutDroppedFlanks({ play, incoming }: { play: AIDecision; incoming: IncomingHit[] }): IncomingHit[] {
		const { card, driver } = play;
		if (!card || !driver) return incoming;
		const holding = [...new Set(incoming.map(hit => hit.raider))].filter(raider => {
			const outran = raider.flank?.outran;
			return raider.flank?.reservedSlot && outran && !outran.isOutOfFight && raider.canFlank(outran);
		});
		if (holding.length === 0) return incoming;

		const after = new BoardProjection({ battle: this.battle });
		after.apply({ card, driver, target: play.target instanceof Vehicle ? play.target : null });
		const dropped = new Set(holding.filter(raider => {
			const outran = raider.flank?.outran;
			return outran && after.speedOf(raider) <= after.speedOf(outran);
		}));
		if (dropped.size === 0) return incoming;
		return incoming.map(hit => dropped.has(hit.raider) ? { ...hit, damage: Math.ceil(hit.damage / FLANKING_MULTIPLIER) } : hit);
	}

	/**
	 * The harm a play's non-lethal damage takes off the fight: each raider it
	 * hurts and doesn't remove is that much closer to wrecked, so its share
	 * of what the raider has left to lose, times the harm the raider's
	 * attacks do the convoy a turn
	 */
	private progress({ play, incoming }: { play: AIDecision; incoming: IncomingHit[] }): number {
		const { card, driver } = play;
		const caster = driver ? this.board.vehicleOf(driver) : null;
		if (!card || !driver || !caster) return 0;
		let progress = 0;
		for (const raider of new Set(incoming.map(hit => hit.raider))) {
			const { damage, kind } = this.landing({ card, driver, caster, raider, target: play.target });
			if (damage <= 0) continue;
			const share = Math.min(1, lastingDamage({ target: raider, damage, kind }) / damageToFinish({ target: raider, kind }));
			progress += share * this.convoyHarm({ incoming: incoming.filter(hit => hit.raider === raider) });
		}
		return progress;
	}

	/**
	 * What a play lands on one raider, past its hit checks: the damage and
	 * its kind, and whether it stuns
	 */
	private landing({ card, driver, caster, raider, target }: {
		card: Card;
		driver: Driver;
		caster: Vehicle;
		raider: Vehicle;
		target: AIDecision['target'];
	}): { damage: number; kind: DamageKind; stuns: boolean } {
		const reaches = (effect: CardEffect): boolean => {
			if (effectRecipientOf({ effect, card }) === EffectRecipient.CASTER) return false;
			if (card.targetType !== 'enemy_all' && target !== raider) return false;
			return !rollsToHit({ effect, card }) || this.battle.checkHit({
				attacker: caster,
				caster: driver,
				defender: raider,
				attackType: typeof effect.attack_type === 'string' ? effect.attack_type : effect.scaling === 'ramming' ? 'ramming' : 'ranged',
				modifier: typeof effect.hit_modifier === 'number' ? effect.hit_modifier : 0
			});
		};

		let damage = 0;
		let kind = DamageKind.VEHICLE;
		let stuns = false;
		for (const effect of card.effects) {
			if (!reaches(effect)) continue;
			if (effect.type === 'apply_status' && effect.status === 'stunned') stuns = true;
			if (effect.type === 'damage') {
				damage += this.damageOf({ effect, caster, raider });
				kind = effectDamageKind(effect);
			}
		}
		return { damage, kind, stuns };
	}

	/**
	 * A hit's damage as the battle works it out on play: formula, then
	 * flanking and Vulnerable
	 */
	private damageOf({ effect, caster, raider }: { effect: CardEffect; caster: Vehicle; raider: Vehicle }): number {
		let damage = typeof effect.value === 'number' ? effect.value : 0;
		if (typeof effect.formula === 'string') {
			damage = this.battle.calculateFormulaDamage(effect.formula, {
				base: damage,
				armor: caster.armor,
				speedDiff: this.board.speedOf(caster) - this.board.speedOf(raider)
			});
		}
		if (this.board.isFlanking(caster)) damage = Math.floor(damage * FLANKING_MULTIPLIER);
		if (raider.hasStatusEffect('vulnerable')) damage = Math.floor(damage * 1.5);
		return damage;
	}

	/** Whether a hit leaves the raider unable to play its plan: wrecked, or its driver dead */
	private finishes({ raider, damage, kind }: { raider: Vehicle; damage: number; kind: DamageKind }): boolean {
		const driver = raider.driver;
		switch (kind) {
			case DamageKind.DRIVER_ONLY:
				return driver !== null && damage >= driver.hitpoints;
			case DamageKind.STRUCTURE_ONLY:
				return damage >= raider.structure;
			case DamageKind.VEHICLE: {
				const occupied = driver?.isAlive() ?? false;
				const split = splitDamage({ damage, shield: raider.shield ?? 0, armor: raider.armor, occupied });
				return split.structure >= raider.structure || (driver !== null && occupied && split.perOccupant >= driver.hitpoints);
			}
		}
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
	private restoredHitpoints({ play, incoming }: { play: AIDecision; incoming: IncomingHit[] }): number {
		let restored = 0;
		const harmNow = this.convoyHarm({ incoming });
		for (const [vehicle, added] of this.protectionFrom(play)) {
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
