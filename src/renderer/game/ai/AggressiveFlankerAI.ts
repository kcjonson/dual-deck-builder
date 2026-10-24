import { AIPlayer } from './AIPlayer';
import { AIDecision, AIStrategy, GameStateEvaluation, VehicleEvaluation } from './types';
import { Team } from '../mechanics/Team';
import { Battle } from '../mechanics/Battle';
import { Vehicle } from '../mechanics/Vehicle';
import { Card } from '../mechanics/Card';
import type { Driver } from '../mechanics/Driver';
import { CardEffectValidator } from './CardEffectValidator';
import { cardDamageKind, damageToFinish, lastingDamage } from './DamageEstimate';
import { BoardProjection, cardFlanks, selfSpeedBonus } from '../mechanics/BoardProjection';
import { effectValue } from '../mechanics/EffectConditions';
import { EffectRecipient, effectRecipientOf } from '../mechanics/EffectTargets';
import { movesOf } from '../mechanics/Movement';
import { RoadSlot, sameSlot } from '../mechanics/Road';
import { SwerveReach, aimlessSwerve, swerveReach, swerveScore } from './SwerveEstimate';

/**
 * Aggressive Flanker AI Strategy
 * Prioritizes flanking position for 50% damage bonus and focuses on high-damage attacks
 */
export class AggressiveFlankerStrategy implements AIStrategy {
	name = 'Aggressive Flanker AI';
	private readonly FLANKING_BONUS = 1.5;
	private readonly VULNERABLE_BONUS = 1.5;
	private readonly POSITION_WEIGHT = 200;
	private readonly DAMAGE_WEIGHT = 10;
	private readonly HEAL_WEIGHT = 50;
	/** Ending the turn, the floor every play that does anything beats */
	private readonly END_TURN = -1000;

	chooseBestAction(
		possibleActions: AIDecision[],
		gameState: GameStateEvaluation
	): AIDecision {
		if (possibleActions.length === 0) {
			return { type: 'endTurn' };
		}

		// Score each action
		const scoredActions = possibleActions.map(action => ({
			action,
			score: this.scoreAction(action, gameState)
		}));

		// Sort by score descending
		scoredActions.sort((a, b) => b.score - a.score);

		// Return the best action
		return scoredActions[0].action;
	}

	/**
	 * Public so tests can read what a play is worth. A move that would do
	 * nothing else scores under ending the turn, so it isn't played, and so
	 * does dropping off a shoulder it would hold: this AI never reads
	 * intents, so it never has a reason to give up a flank.
	 */
	public scoreAction(action: AIDecision, gameState: GameStateEvaluation): number {
		const reach = this.reachOf(action, gameState);
		const { card, driver } = action;
		const ourVehicle = driver ? this.getVehicleForDriver(driver, gameState) : null;
		if (card && driver && reach && aimlessSwerve({ board: gameState.board, card, driver, reach })) {
			return this.END_TURN * 2;
		}
		if (card && ourVehicle && this.givesUpFlank({ card, caster: ourVehicle.vehicle, board: gameState.board })) {
			return this.END_TURN * 2;
		}
		return this.scorePlay(action, gameState, reach);
	}

	/**
	 * Whether the play drops the caster off a shoulder it would otherwise
	 * hold past the end of the turn (Peel Off). One it's about to lose anyway,
	 * the vehicle it outran now as fast, costs nothing.
	 */
	private givesUpFlank({ card, caster, board }: { card: Card; caster: Vehicle; board: BoardProjection }): boolean {
		return board.isFlanking(caster) && !board.wouldDropBack(caster) &&
			movesOf(card).some(move => move.kind === 'drop_back' && move.mover === 'caster');
	}

	/**
	 * What the play's own moves do for the rest of the hand (swerveReach),
	 * or null for a play that isn't a card from a vehicle on the road
	 */
	public reachOf(action: AIDecision, gameState: GameStateEvaluation): SwerveReach | null {
		const { card, driver } = action;
		const ourVehicle = driver ? this.getVehicleForDriver(driver, gameState) : null;
		if (!card || !driver || !ourVehicle) return null;
		return swerveReach({
			board: gameState.board,
			card,
			driver,
			caster: ourVehicle.vehicle,
			target: action.target instanceof Vehicle ? action.target : null,
			destination: action.destination ?? null
		});
	}

	/**
	 * What a play is worth with no check for an aimless move: the
	 * intent-aware stand-in judges that itself, since a move that makes a
	 * planned hit fizzle isn't aimless. `reach` is reachOf's.
	 */
	public scorePlay(action: AIDecision, gameState: GameStateEvaluation, reach: SwerveReach | null = this.reachOf(action, gameState)): number {
		if (action.type === 'endTurn') {
			// Only end turn if we have no other options
			return this.END_TURN;
		}

		let score = 0;
		if (!action.card || !action.driver) {
			return -1000;
		}
		
		const card = action.card;
		const driver = action.driver;

		// Find the vehicle for this driver
		const ourVehicle = this.getVehicleForDriver(driver, gameState);
		if (!ourVehicle) return -1000;

		// Check if the card will have any beneficial effect
		const targetVehicle = action.target as Vehicle || ourVehicle.vehicle;
		if (!CardEffectValidator.willCardHaveEffect(card, driver, targetVehicle, gameState.board)) {
			return -500; // Strong negative score for cards with no effect
		}

		// Get card effects
		const cardEffects = this.analyzeCardEffects({
			card,
			caster: ourVehicle.vehicle,
			target: action.target instanceof Vehicle ? action.target : null,
			destination: action.destination ?? null,
			board: gameState.board
		});

		// Moving to the shoulder. A Flank is only offered at a target it can
		// outrun, so every legal one gets the full priority, and dropping off
		// one it would hold costs as much.
		if (cardEffects.flanks && !ourVehicle.isFlanking) {
			score += this.POSITION_WEIGHT * 3;
		}
		if (this.givesUpFlank({ card, caster: ourVehicle.vehicle, board: gameState.board })) {
			score -= this.POSITION_WEIGHT * 3;
		}

		// A move is worth what it puts in range for the rest of the hand,
		// and waits while it would take something out
		if (reach) score += swerveScore(reach, this.DAMAGE_WEIGHT);

		// A speed boost is worth a lot when it's what opens a flank
		const board = gameState.board;
		if (cardEffects.speedBoost > 0 && !ourVehicle.isFlanking &&
			!board.canFlankAnyone(ourVehicle.vehicle) && board.canFlankAnyone(ourVehicle.vehicle, cardEffects.speedBoost)) {
			score += this.POSITION_WEIGHT * 2;
		}

		// Score damage effects
		if (cardEffects.damage > 0 && card.targetType === 'enemy_single') {
			const damageKind = cardDamageKind(card);
			const damageTarget = action.target && 'structure' in action.target ? action.target as Vehicle : null;
			// Damage that only soaks into Shield is gone by the player's turn
			const damageThatLasts = damageTarget
				? lastingDamage({ target: damageTarget, damage: cardEffects.damage, kind: damageKind })
				: cardEffects.damage;
			let damageScore = damageThatLasts * this.DAMAGE_WEIGHT;

			// Apply flanking bonus if we're in flanking position
			if (ourVehicle.isFlanking) {
				damageScore *= this.FLANKING_BONUS;
			}

			// Consider target's health if we have one
			if (damageTarget) {
				const targetEval = this.getVehicleEvaluation(damageTarget, gameState);
				
				if (targetEval) {
					// Bonus for attacking low health targets
					damageScore *= (2 - targetEval.healthPercent);
					
					// Bonus for attacking vulnerable targets
					if (damageTarget.hasStatusEffect('vulnerable')) {
						damageScore *= this.VULNERABLE_BONUS;
					}

					// Bonus if this would kill the target
					const potentialDamage = this.calculatePotentialDamage(
						cardEffects.damage, 
						ourVehicle.isFlanking,
						damageTarget.hasStatusEffect('vulnerable')
					);
					
					if (potentialDamage >= damageToFinish({ target: damageTarget, kind: damageKind })) {
						damageScore += 500; // Huge bonus for kills
					}
				}
			}

			score += damageScore;
		}

		// Score healing - critical priority when very low health
		if (cardEffects.heal > 0 && card.targetType === 'self') {
			// Heal if we're below 30% health
			if (ourVehicle.healthPercent <= 0.3) {
				// CRITICAL priority when very low health - should override almost everything
				score += 1000; // Base critical health bonus
				score += this.HEAL_WEIGHT * cardEffects.heal;
			}
		}

		// Score armor (even lower priority)
		if (cardEffects.armor > 0) {
			if (ourVehicle.armorPercent < 0.2) {
				score += cardEffects.armor * 2;
			}
		}

		// Consider card cost efficiency (but don't divide by cost, just slightly penalize expensive cards)
		if (card.cost > 3) {
			score *= 0.9;
		}

		// Penalize using all adrenaline early
		const adrenalineAfter = ourVehicle.adrenaline - card.cost;
		if (adrenalineAfter === 0 && gameState.currentTurn < 3) {
			score *= 0.8;
		}

		return score;
	}

	/**
	 * What a play's effects add up to. Damage on the other side counts from
	 * where the card's own move lands (Strafe), with any row bonus that holds
	 * there (Point Man, Tail Gunner), and only where its landing condition
	 * holds (Brake Check's 4 on an ambusher); damage the caster takes isn't
	 * the target's.
	 */
	private analyzeCardEffects({ card, caster, target, destination, board }: {
		card: Card;
		caster: Vehicle;
		target: Vehicle | null;
		destination: RoadSlot | null;
		board: BoardProjection;
	}): {
		damage: number;
		heal: number;
		armor: number;
		speedBoost: number;
		flanks: boolean;
	} {
		const result = {
			damage: 0,
			heal: 0,
			armor: 0,
			speedBoost: selfSpeedBonus(card),
			flanks: cardFlanks(card)
		};
		const standing = board.slotOf(caster);
		const [casterSlot = standing] = board.landingSlots({ card, caster, destination });
		const conditions = {
			casterSlot,
			targetSlot: target ? board.slotOf(target) : null,
			casterSwerved: board.swervedThisTurn(caster) || !sameSlot(casterSlot, standing)
		};

		for (const effect of card.effects) {
			switch (effect.type) {
				case 'damage':
					if (effectRecipientOf({ effect, card }) === EffectRecipient.CASTER) break;
					if (target && !board.landingConditionHolds({ effect, caster, recipient: target })) break;
					result.damage += effectValue(effect, conditions);
					break;
				case 'heal':
					result.heal += effectValue(effect, conditions);
					break;
				case 'gain_armor':
					result.armor += effectValue(effect, conditions);
					break;
			}
		}
		return result;
	}

	private calculatePotentialDamage(
		baseDamage: number, 
		isFlanking: boolean, 
		targetVulnerable: boolean
	): number {
		let damage = baseDamage;
		
		if (isFlanking) {
			damage *= this.FLANKING_BONUS;
		}
		
		if (targetVulnerable) {
			damage *= this.VULNERABLE_BONUS;
		}
		
		return Math.floor(damage);
	}

	/** The vehicle a driver plays from, on either team, since this AI can play either side */
	private getVehicleForDriver(driver: Driver, gameState: GameStateEvaluation): VehicleEvaluation | null {
		return [...gameState.playerTeam.vehicles, ...gameState.enemyTeam.vehicles].find(vehicleEval => vehicleEval.vehicle.carries(driver)) ?? null;
	}

	/** A vehicle's evaluation, on either team */
	private getVehicleEvaluation(vehicle: Vehicle, gameState: GameStateEvaluation): VehicleEvaluation | null {
		return [...gameState.playerTeam.vehicles, ...gameState.enemyTeam.vehicles].find(vehicleEval => vehicleEval.vehicle === vehicle) ?? null;
	}
}

/**
 * Aggressive Flanker AI Player
 * Uses aggressive flanking strategy to maximize damage output
 */
export class AggressiveFlankerAI extends AIPlayer {
	private strategy: AggressiveFlankerStrategy;

	constructor(team: Team, battle: Battle) {
		super(team, battle);
		this.strategy = new AggressiveFlankerStrategy();
	}

	protected chooseAction(): AIDecision | null {
		const gameState = this.evaluateGameState();
		const possibleActions = this.generatePossibleActions();

		if (possibleActions.length === 0) {
			return { type: 'endTurn' };
		}

		const decision = this.strategy.chooseBestAction(possibleActions, gameState);
		// Don't return null, return endTurn if no good action
		return decision || { type: 'endTurn' };
	}
}