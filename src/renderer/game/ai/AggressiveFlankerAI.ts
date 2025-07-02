import { AIPlayer } from './AIPlayer';
import { AIDecision, AIStrategy, GameStateEvaluation, VehicleEvaluation } from './types';
import { Team } from '../mechanics/Team';
import { Battle } from '../mechanics/Battle';
import { Vehicle } from '../mechanics/Vehicle';
import { Card } from '../mechanics/Card';
import { CardEffectValidator } from './CardEffectValidator';

/**
 * Aggressive Flanker AI Strategy
 * Prioritizes flanking position for 50% damage bonus and focuses on high-damage attacks
 */
export class AggressiveFlankerStrategy implements AIStrategy {
	name = 'Aggressive Flanker AI';
	private battle: Battle;

	constructor(battle: Battle) {
		this.battle = battle;
	}

	private readonly FLANKING_BONUS = 1.5;
	private readonly VULNERABLE_BONUS = 1.5;
	private readonly POSITION_WEIGHT = 200;
	private readonly DAMAGE_WEIGHT = 10;
	private readonly HEAL_WEIGHT = 50;
	private readonly SPEED_THRESHOLD = 60; // Minimum total speed for flanking (baseSpeed + driver speed)

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

	private scoreAction(action: AIDecision, gameState: GameStateEvaluation): number {
		if (action.type === 'endTurn') {
			// Only end turn if we have no other options
			return -1000;
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
		if (!CardEffectValidator.willCardHaveEffect(card, driver, targetVehicle, this.battle)) {
			return -500; // Strong negative score for cards with no effect
		}

		// Get card effects
		const cardEffects = this.analyzeCardEffects(card);

		// Prioritize position changes to flanking
		if (cardEffects.changesPosition && ourVehicle.position !== 'flanking') {
			score += this.POSITION_WEIGHT * 2;
			
			// Extra bonus if we have enough speed for flanking
			if (ourVehicle.vehicle.getTotalSpeed() >= this.SPEED_THRESHOLD) {
				score += this.POSITION_WEIGHT;
			}
		}

		// Prioritize speed boosts if not in flanking position and below threshold
		if (cardEffects.speedBoost > 0 && 
			ourVehicle.position !== 'flanking') {
			const currentSpeed = ourVehicle.vehicle.getTotalSpeed();
			if (currentSpeed < this.SPEED_THRESHOLD) {
				// Very high priority for speed boost when we need it for flanking
				score += this.POSITION_WEIGHT * 2;
			}
		}

		// Score damage effects
		if (cardEffects.damage > 0 && card.targetType === 'enemy_single') {
			let damageScore = cardEffects.damage * this.DAMAGE_WEIGHT;

			// Apply flanking bonus if we're in flanking position
			if (ourVehicle.position === 'flanking') {
				damageScore *= this.FLANKING_BONUS;
			}

			// Consider target's health if we have one
			if (action.target && 'structure' in action.target) {
				const targetVehicle = action.target as Vehicle;
				const targetEval = this.getVehicleEvaluation(targetVehicle, gameState);
				
				if (targetEval) {
					// Bonus for attacking low health targets
					damageScore *= (2 - targetEval.healthPercent);
					
					// Bonus for attacking vulnerable targets
					if (targetVehicle.hasStatusEffect('vulnerable')) {
						damageScore *= this.VULNERABLE_BONUS;
					}

					// Bonus if this would kill the target
					const potentialDamage = this.calculatePotentialDamage(
						cardEffects.damage, 
						ourVehicle.position === 'flanking',
						targetVehicle.hasStatusEffect('vulnerable')
					);
					
					if (potentialDamage >= targetVehicle.structure + targetVehicle.armor) {
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
		const adrenalineAfter = driver.adrenaline - card.cost;
		if (adrenalineAfter === 0 && gameState.currentTurn < 3) {
			score *= 0.8;
		}

		return score;
	}

	private analyzeCardEffects(card: Card): {
		damage: number;
		heal: number;
		armor: number;
		speedBoost: number;
		changesPosition: boolean;
	} {
		const result = {
			damage: 0,
			heal: 0,
			armor: 0,
			speedBoost: 0,
			changesPosition: false
		};

		for (const effect of card.effects) {
			switch (effect.type) {
				case 'damage':
					result.damage += effect.value || 0;
					break;
				case 'heal':
					result.heal += effect.value || 0;
					break;
				case 'armor':
					result.armor += effect.value || 0;
					break;
				case 'speed':
					result.speedBoost += effect.value || 0;
					break;
				case 'move_to_position':
				case 'change_position':
					result.changesPosition = true;
					break;
			}
		}

		// Check for variable damage
		if (card.variables?.damage) {
			result.damage = card.upgraded && card.variables.damage.upgraded 
				? card.variables.damage.upgraded 
				: card.variables.damage.base;
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

	private getVehicleForDriver(
		driver: unknown, 
		gameState: GameStateEvaluation
	): VehicleEvaluation | null {
		// Check enemy team vehicles
		for (const vehicleEval of gameState.enemyTeam.vehicles) {
			if (vehicleEval.driver === driver) {
				return vehicleEval;
			}
		}
		return null;
	}

	private getVehicleEvaluation(
		vehicle: Vehicle, 
		gameState: GameStateEvaluation
	): VehicleEvaluation | null {
		// Check player team vehicles
		for (const vehicleEval of gameState.playerTeam.vehicles) {
			if (vehicleEval.vehicle === vehicle) {
				return vehicleEval;
			}
		}
		return null;
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
		this.strategy = new AggressiveFlankerStrategy(battle);
	}

	async makeDecision(): Promise<AIDecision | null> {
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