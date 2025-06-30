import { AIPlayer } from './AIPlayer';
import { AIDecision, GameStateEvaluation } from './types';
import { Battle } from '../mechanics/Battle';
import { Team } from '../mechanics/Team';
import { Vehicle } from '../mechanics/Vehicle';
import { Driver } from '../mechanics/Driver';
import { Card } from '../mechanics/Card';

/**
 * Monte Carlo Tree Search AI Player
 * Uses MCTS algorithm to find effective moves through simulated gameplay
 * 
 * Improved version with better evaluation functions and strategic planning
 */
export class MCTSAI extends AIPlayer {
	private readonly iterations: number;
	private readonly explorationConstant: number;
	
	// Strategic weights
	private readonly ELIMINATION_SCORE = 10.0;
	private readonly DAMAGE_WEIGHT = 1.0;
	private readonly FLANKING_BONUS = 1.5;
	private readonly LOW_HEALTH_BONUS = 2.0;
	private readonly HEAL_WEIGHT = 0.8;
	private readonly ARMOR_WEIGHT = 0.6;
	private readonly CARD_DRAW_WEIGHT = 1.5;
	private readonly ADRENALINE_WEIGHT = 2.0;
	private readonly POSITION_CHANGE_WEIGHT = 3.0;
	private readonly SPEED_BOOST_WEIGHT = 2.5;
	
	constructor({
		team,
		battle,
		iterations = 2000, // Increased iterations for better decision making
		explorationConstant = 1.4 // Slightly lower for more exploitation
	}: {
		team: Team;
		battle: Battle;
		iterations?: number;
		explorationConstant?: number;
	}) {
		super(team, battle);
		this.iterations = iterations;
		this.explorationConstant = explorationConstant;
	}
	
	async makeDecision(): Promise<AIDecision | null> {
		// Get possible actions
		const possibleActions = this.generatePossibleActions();
		
		if (possibleActions.length === 0) {
			return null;
		}
		
		// If only one action (end turn), return it
		if (possibleActions.length === 1) {
			return possibleActions[0];
		}
		
		// If battle is already over, return null
		if (this.battle.battleOver) {
			return null;
		}
		
		// Use improved MCTS with better evaluation
		const actionScores = new Map<AIDecision, { visits: number; totalScore: number }>();
		
		// Initialize scores for all actions
		for (const action of possibleActions) {
			actionScores.set(action, { visits: 0, totalScore: 0 });
		}
		
		// Run simulations
		for (let i = 0; i < this.iterations; i++) {
			// Select an action to evaluate using UCB1
			const selectedAction = this.selectActionUCB1(possibleActions, actionScores, i + 1);
			
			// Evaluate the action with improved evaluation
			const score = this.evaluateActionWithContext(selectedAction);
			
			// Update statistics
			const stats = actionScores.get(selectedAction);
			if (stats) {
				stats.visits++;
				stats.totalScore += score;
			}
		}
		
		// Select best action based on highest average score (not just visits)
		let bestAction = possibleActions[0];
		let bestScore = -Infinity;
		
		// Also consider ending turn if we've already played good cards
		let hasPlayedHighValueCards = false;
		
		for (const [action, stats] of actionScores) {
			if (stats.visits > 0) {
				const avgScore = stats.totalScore / stats.visits;
				
				// Log scores for debugging (remove in production)
				if (action.type === 'playCard' && action.card) {
					if (avgScore > 5) hasPlayedHighValueCards = true;
				}
				
				// Prefer actions with both high score and reasonable visits
				const confidence = Math.min(stats.visits / 50, 1); // Confidence factor
				const finalScore = avgScore * (0.7 + 0.3 * confidence);
				
				if (finalScore > bestScore) {
					bestScore = finalScore;
					bestAction = action;
				}
			}
		}
		
		// If best action is end turn but we haven't played high value cards, 
		// try to find a card to play
		if (bestAction.type === 'endTurn' && !hasPlayedHighValueCards) {
			for (const [action, stats] of actionScores) {
				if (action.type === 'playCard' && stats.visits > 0) {
					const avgScore = stats.totalScore / stats.visits;
					if (avgScore > 1) {
						return action;
					}
				}
			}
		}
		
		return bestAction;
	}
	
	/**
	 * Select action using UCB1 algorithm
	 */
	private selectActionUCB1(
		actions: AIDecision[], 
		scores: Map<AIDecision, { visits: number; totalScore: number }>,
		totalIterations: number
	): AIDecision {
		let bestAction = actions[0];
		let bestUCB = -Infinity;
		
		for (const action of actions) {
			const stats = scores.get(action);
			if (!stats) continue;
			
			// If unvisited, return immediately (infinite UCB)
			if (stats.visits === 0) {
				return action;
			}
			
			// Calculate UCB1 value
			const avgScore = stats.totalScore / stats.visits;
			const exploration = this.explorationConstant * Math.sqrt(Math.log(totalIterations) / stats.visits);
			const ucb = avgScore + exploration;
			
			if (ucb > bestUCB) {
				bestUCB = ucb;
				bestAction = action;
			}
		}
		
		return bestAction;
	}
	
	/**
	 * Evaluate an action with full game context
	 */
	private evaluateActionWithContext(action: AIDecision): number {
		if (action.type === 'endTurn') {
			// End turn only if we can't play valuable cards
			const remainingActions = this.countRemainingValuableActions();
			if (remainingActions > 0) {
				return -2.0; // Penalty for ending turn with good plays available
			}
			return 0.1; // Small positive if we truly have nothing good to play
		}
		
		if (action.type === 'playCard' && action.card && action.driver) {
			const gameState = this.evaluateGameState();
			const card = action.card;
			const driver = action.driver;
			
			// Find our vehicle
			const ourVehicle = this.findVehicleForDriver(driver);
			if (!ourVehicle) return -10;
			
			let score = 0;
			
			// Evaluate card effects with context
			if (card.effects) {
				for (const effect of card.effects) {
					score += this.evaluateEffectWithContext(effect, action.target, ourVehicle, gameState);
				}
			}
			
			// Consider card synergies and combos
			score += this.evaluateCardSynergy(card, driver, ourVehicle);
			
			// Resource efficiency - don't divide by cost, use subtraction
			const costPenalty = card.cost * 0.2; // Small penalty for expensive cards
			score -= costPenalty;
			
			// Bonus for using adrenaline efficiently
			if (driver.adrenaline - card.cost <= 1) {
				score += 0.5; // Bonus for using up adrenaline
			}
			
			return Math.max(0, score);
		}
		
		return 0;
	}
	
	/**
	 * Count remaining valuable actions we could take
	 */
	private countRemainingValuableActions(): number {
		let count = 0;
		for (const vehicle of this.team.vehicles) {
			if (!vehicle.isAlive() || !vehicle.driver) continue;
			const driver = vehicle.driver;
			
			for (const card of driver.hand) {
				if (driver.adrenaline >= card.cost) {
					// Simple check if card has valuable effects
					if (card.effects && card.effects.some(e => 
						e.type === 'damage' && (e.value || 0) >= 5 ||
						e.type === 'heal' && (e.value || 0) >= 5 ||
						e.type === 'position_change'
					)) {
						count++;
					}
				}
			}
		}
		return count;
	}
	
	/**
	 * Find vehicle for a driver
	 */
	private findVehicleForDriver(driver: Driver): Vehicle | null {
		for (const vehicle of [...this.team.vehicles, ...this.getEnemyTeam().vehicles]) {
			if (vehicle.driver === driver) {
				return vehicle;
			}
		}
		return null;
	}
	
	/**
	 * Get enemy team
	 */
	private getEnemyTeam(): Team {
		return this.team === this.battle.playerTeam ? this.battle.enemyTeam : this.battle.playerTeam;
	}
	
	/**
	 * Evaluate effect with full context
	 */
	private evaluateEffectWithContext(
		effect: { type: string; value?: number }, 
		target: Vehicle | Driver | undefined,
		ourVehicle: Vehicle,
		_gameState: GameStateEvaluation
	): number {
		let score = 0;
		
		switch (effect.type) {
			case 'damage':
				score += this.evaluateDamageWithContext(effect.value || 0, target, ourVehicle);
				break;
			case 'heal':
				score += this.evaluateHealWithContext(effect.value || 0, target, ourVehicle);
				break;
			case 'armor':
				score += this.evaluateArmorWithContext(effect.value || 0, target);
				break;
			case 'draw':
				score += this.CARD_DRAW_WEIGHT * (effect.value || 1);
				break;
			case 'adrenaline':
				score += this.ADRENALINE_WEIGHT * (effect.value || 1);
				break;
			case 'position_change':
				score += this.evaluatePositionChange(ourVehicle);
				break;
			case 'speed':
				score += this.evaluateSpeedBoost(effect.value || 0, ourVehicle);
				break;
			default:
				score += 0.5; // Unknown effects get moderate score
		}
		
		return score;
	}
	
	/**
	 * Evaluate damage with flanking bonus and target priority
	 */
	private evaluateDamageWithContext(damage: number, target: Vehicle | Driver | undefined, ourVehicle: Vehicle): number {
		if (!target || !(target instanceof Vehicle)) {
			return damage * 0.1; // Small score for untargeted damage
		}
		
		const targetVehicle = target as Vehicle;
		const currentHealth = targetVehicle.structure + targetVehicle.armor;
		let score = damage * this.DAMAGE_WEIGHT;
		
		// Apply flanking bonus
		if (ourVehicle.position === 'flanking') {
			score *= this.FLANKING_BONUS;
		}
		
		// Huge bonus for elimination
		if (damage >= currentHealth) {
			return this.ELIMINATION_SCORE;
		}
		
		// Bonus for attacking low health targets
		const healthPercent = targetVehicle.structure / targetVehicle.maxStructure;
		if (healthPercent < 0.5) {
			score *= this.LOW_HEALTH_BONUS;
		}
		
		// Consider armor (armor reduces damage effectiveness)
		if (targetVehicle.armor > 0) {
			const armorReduction = Math.min(targetVehicle.armor / damage, 0.5);
			score *= (1 - armorReduction);
		}
		
		return score;
	}
	
	/**
	 * Evaluate healing with context
	 */
	private evaluateHealWithContext(healing: number, target: Vehicle | Driver | undefined, ourVehicle: Vehicle): number {
		if (!target || !(target instanceof Vehicle)) {
			return 0;
		}
		
		const targetVehicle = target as Vehicle;
		const missingHealth = targetVehicle.maxStructure - targetVehicle.structure;
		
		if (missingHealth === 0) {
			return 0; // No value in healing full health
		}
		
		let score = Math.min(healing, missingHealth) * this.HEAL_WEIGHT;
		
		// Higher priority for healing critical allies
		const healthPercent = targetVehicle.structure / targetVehicle.maxStructure;
		if (healthPercent < 0.3) {
			score *= 2.0; // Double value for critical healing
		}
		
		// Bonus for self-preservation
		if (targetVehicle === ourVehicle && healthPercent < 0.5) {
			score *= 1.5;
		}
		
		return score;
	}
	
	/**
	 * Evaluate armor with context
	 */
	private evaluateArmorWithContext(armor: number, target: Vehicle | Driver | undefined): number {
		if (!target || !(target instanceof Vehicle)) {
			return 0;
		}
		
		const targetVehicle = target as Vehicle;
		let score = armor * this.ARMOR_WEIGHT;
		
		// Armor is more valuable on healthy vehicles
		const healthPercent = targetVehicle.structure / targetVehicle.maxStructure;
		score *= healthPercent;
		
		// Bonus if vehicle is in front position (likely to take damage)
		if (targetVehicle.position === 'front') {
			score *= 1.5;
		}
		
		return score;
	}
	
	/**
	 * Evaluate position change
	 */
	private evaluatePositionChange(ourVehicle: Vehicle): number {
		// High value if not in flanking and have good speed
		if (ourVehicle.position !== 'flanking') {
			const totalSpeed = ourVehicle.speed + (ourVehicle.driver?.vehicleStats?.speed || 0);
			if (totalSpeed >= 60) {
				return this.POSITION_CHANGE_WEIGHT * 2;
			}
			return this.POSITION_CHANGE_WEIGHT;
		}
		
		// Low value if already flanking
		return 0.2;
	}
	
	/**
	 * Evaluate speed boost
	 */
	private evaluateSpeedBoost(speedBoost: number, ourVehicle: Vehicle): number {
		// Very valuable if we need speed for flanking
		if (ourVehicle.position !== 'flanking') {
			const currentSpeed = ourVehicle.speed + (ourVehicle.driver?.vehicleStats?.speed || 0);
			const newSpeed = currentSpeed + speedBoost;
			
			// Big bonus if this gets us to flanking threshold
			if (currentSpeed < 60 && newSpeed >= 60) {
				return this.SPEED_BOOST_WEIGHT * 3;
			}
			
			return this.SPEED_BOOST_WEIGHT * (speedBoost / 10);
		}
		
		return speedBoost * 0.1; // Small value if already flanking
	}
	
	/**
	 * Evaluate card synergies
	 */
	private evaluateCardSynergy(card: Card, driver: Driver, _vehicle: Vehicle): number {
		let synergyScore = 0;
		
		// Check for card type synergies
		if (card.tags) {
			// Bonus for matching driver specialties (would need driver specialty data)
			if (card.tags.includes('gunnery') && driver.skills?.gunnery && driver.skills.gunnery > 7) {
				synergyScore += 1.0;
			}
			if (card.tags.includes('ramming') && driver.skills?.ramming && driver.skills.ramming > 7) {
				synergyScore += 1.0;
			}
			if (card.tags.includes('evade') && driver.skills?.evade && driver.skills.evade > 7) {
				synergyScore += 1.0;
			}
		}
		
		// Bonus for combo potential
		if (card.effects && card.effects.some(e => e.type === 'draw')) {
			synergyScore += 0.5; // Card draw enables more combos
		}
		
		return synergyScore;
	}
}