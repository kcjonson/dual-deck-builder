import { AIPlayer } from './AIPlayer';
import { AIDecision, AIStrategy, GameStateEvaluation } from './types';
import { Battle } from '../mechanics/Battle';
import { Driver } from '../mechanics/Driver';
import { Card } from '../mechanics/Card';
import { Vehicle } from '../mechanics/Vehicle';
import { Team, TeamType } from '../mechanics/Team';

/**
 * AI strategy that tries to win while minimizing vehicle damage for salvage
 * Balances between preserving vehicles and actually winning the game
 */
export class SalvageAIStrategy implements AIStrategy {
	name = 'Salvage AI';
	
	constructor(private team: Team) {}

	chooseBestAction(
		possibleActions: AIDecision[],
		gameState: GameStateEvaluation
	): AIDecision {
		if (possibleActions.length === 0) {
			return { type: 'endTurn' };
		}

		// Score and sort actions by salvage priority
		const scoredActions = possibleActions.map(action => ({
			action,
			score: this.scoreAction(action, gameState)
		}));

		scoredActions.sort((a, b) => b.score - a.score);

		// Debug logging
		if (scoredActions.length > 0 && scoredActions[0].score > 0) {
			console.log('SalvageAI top actions:', scoredActions.slice(0, 3).map(sa => ({
				card: sa.action.card?.displayName,
				score: sa.score,
				driver: sa.action.driver?.metadata.name
			})));
		}

		// If best action has very negative score, check if we should force action
		const bestScore = scoredActions[0].score;
		const bestAction = scoredActions[0].action;
		
		// Check if any driver has high adrenaline remaining
		let hasHighAdrenaline = false;
		if (bestAction.driver && bestAction.driver.adrenaline >= 5) {
			hasHighAdrenaline = true;
		}
		
		// If we have high adrenaline but negative scores, still try to act
		if (bestScore < -50 && !hasHighAdrenaline) {
			return { type: 'endTurn' };
		}
		
		// Force action if we have lots of unused adrenaline
		if (bestScore < 0 && hasHighAdrenaline && bestScore > -100) {
			console.log(`SalvageAI: Forcing action despite negative score (${bestScore}) due to high adrenaline`);
		}

		// Return the best action
		return scoredActions[0].action;
	}

	/**
	 * Score an action based on game state and salvage priorities
	 */
	private scoreAction(action: AIDecision, gameState: GameStateEvaluation): number {
		if (action.type !== 'playCard' || !action.card) {
			return -100;
		}

		const card = action.card;
		let score = 0;

		// Determine which team we're controlling
		const isPlayerTeam = this.team.type === TeamType.PLAYER;
		const ourTeam = isPlayerTeam ? gameState.playerTeam : gameState.enemyTeam;
		const theirTeam = isPlayerTeam ? gameState.enemyTeam : gameState.playerTeam;
		
		// Evaluate game state for strategic decisions
		const ourHealth = ourTeam.totalHealth;
		const enemyHealth = theirTeam.totalHealth;
		const healthRatio = ourHealth / Math.max(1, enemyHealth);
		
		// Are we in danger? Switch to survival mode
		const inDanger = healthRatio < 0.5;
		
		// Are we winning? Can afford to be more selective
		const winning = healthRatio > 1.5;
		
		// Do we have card advantage?
		const cardAdvantage = ourTeam.cardsInHand - theirTeam.cardsInHand;

		// HIGHEST PRIORITY: Headshot cards (but only if we're not about to die)
		const isHeadshot = card.type === 'headshot' || 
			card.effects.some(e => e.type === 'damage' && e.target === 'driver');
		
		if (isHeadshot) {
			console.log(`SalvageAI: Found headshot card '${card.displayName}', inDanger: ${inDanger}`);
			
			if (!inDanger) {
				score += 500; // Reduced from 1000 to be more balanced
				
				// Extra points for good targets
				if (action.target && 'driver' in action.target) {
					const targetVehicle = action.target as Vehicle;
					if (targetVehicle.driver) {
						const driverHealth = targetVehicle.driver.hitpoints;
						const damage = this.estimateCardDamage(card, action.driver);
						
						// Perfect kill shot
						if (driverHealth <= damage && driverHealth > 0) {
							score += 300;
						}
						
						// Low health target
						if (driverHealth <= 5) {
							score += 100;
						}
					}
				}
				console.log(`SalvageAI: Headshot score: ${score}`);
			} else {
				// Still give some score when in danger, just less
				score += 200;
				console.log(`SalvageAI: Headshot score (in danger): ${score}`);
			}
		}

		// POSITIONING: Flanking is crucial for 50% damage bonus
		if (card.effects.some(e => e.type === 'change_position' && e.position === 'flanking')) {
			score += 150; // High priority for flanking
			
			// Even better if we have damage cards in hand
			if (action.driver && action.driver.hand.some(c => c.effects.some(e => e.type === 'damage'))) {
				score += 50;
			}
		}

		// CARD DRAW: Essential for finding headshots and maintaining options
		if (card.effects.some(e => e.type === 'draw')) {
			score += 80 + (cardAdvantage < 0 ? 40 : 0); // More valuable when behind on cards
		}

		// DEFENSIVE CARDS: Important when in danger or damaged
		if (card.effects.some(e => ['armor', 'gain_armor', 'heal'].includes(e.type))) {
			// Check if we actually need healing or armor
			let needsHealing = false;
			let healingValue = 0;
			let canUseArmor = false;
			
			if (action.driver) {
				// Find our vehicle
				for (const vehicleEval of ourTeam.vehicles) {
					if (vehicleEval.driver === action.driver) {
						const vehicle = vehicleEval.vehicle;
						// Check if structure is below max
						if (vehicle.structure < vehicle.maxStructure) {
							needsHealing = true;
							healingValue = vehicle.maxStructure - vehicle.structure;
						}
						// Check if armor is below max (for overflow healing)
						if (vehicle.armor < vehicle.maxArmor) {
							canUseArmor = true;
						}
						break;
					}
				}
			}
			
			// For heal cards, only give score if we need healing
			if (card.effects.some(e => e.type === 'heal')) {
				// Check if this is a heal card with overflow to armor
				const hasOverflow = card.effects.some(e => e.overflow_to_armor === true);
				
				if (!needsHealing && (!hasOverflow || !canUseArmor)) {
					// Repair Kit at full health/armor is completely wasteful
					score -= 100;
				} else if (!needsHealing && hasOverflow && canUseArmor) {
					// Can only use for armor, less valuable
					score += winning ? 10 : 30;
				} else {
					// Scale value based on how much healing we need
					const healEfficiency = Math.min(healingValue / 8, 1); // Assuming 8 heal from repair kit
					score += (inDanger ? 120 : 60) * healEfficiency;
				}
			} else if (card.effects.some(e => e.type === 'armor' || e.type === 'gain_armor')) {
				// Armor cards - check if we can use them
				if (!canUseArmor) {
					score -= 200; // Armor plating at max armor is very wasteful
				} else {
					const defenseValue = inDanger ? 100 : (winning ? 20 : 50);
					score += defenseValue;
				}
			}
		}

		// REGULAR DAMAGE: Penalized but sometimes necessary
		const isDamageCard = card.effects.some(e => e.type === 'damage' && e.target !== 'driver');
		if (isDamageCard) {
			const damage = this.estimateCardDamage(card, action.driver);
			
			// Check if we're in flanking position (50% bonus)
			const inFlanking = action.driver && this.isDriverInFlanking(action.driver, gameState);
			const effectiveDamage = inFlanking ? damage * 1.5 : damage;
			
			// Base penalty for structure damage (greatly reduced)
			const structureDamage = Math.ceil(effectiveDamage / 2);
			score -= structureDamage * 2; // Reduced from 5 to make attacks viable
			
			// Base value for dealing damage
			score += effectiveDamage; // Add base value for damage
			
			// Flanking position bonus - don't waste the 50% damage boost
			if (inFlanking) {
				score += 30; // Significant bonus for using flanking position
			}
			
			// But add value based on situation
			if (action.target && 'structure' in action.target) {
				const targetVehicle = action.target as Vehicle;
				
				// If we're in danger, we need to eliminate threats
				if (inDanger) {
					score += effectiveDamage * 2;
				}
				
				// Finishing blow is always good
				if (targetVehicle.structure <= structureDamage) {
					score += 200;
				}
				
				// Low health driver makes regular damage more acceptable
				if (targetVehicle.driver && targetVehicle.driver.hitpoints <= 5) {
					score += 100;
				}
				
				// Focus fire bonus - target already damaged vehicles
				const healthPercent = targetVehicle.structure / targetVehicle.maxStructure;
				if (healthPercent < 0.5) {
					score += 50;
				}
				
				// Target at full health - need to start dealing damage
				if (healthPercent === 1) {
					score += 20; // Encourage starting to damage fresh targets
				}
			}
		}

		// STATUS EFFECTS: Valuable for control
		if (card.effects.some(e => ['status', 'apply_status'].includes(e.type))) {
			score += 40;
			
			// Speed reduction effects are great
			if (card.effects.some(e => e.status === 'oil_slick' || e.status === 'caltrops')) {
				score += 30;
			}
		}

		// ADRENALINE GENERATION: Always useful
		if (card.effects.some(e => e.type === 'adrenaline')) {
			score += 30;
		}

		// Cost considerations
		const costPenalty = card.cost * 3;
		score -= costPenalty;
		
		// But if we have lots of adrenaline, reduce the penalty
		if (action.driver) {
			const adrenaline = action.driver.adrenaline;
			if (adrenaline >= 8) {
				score += card.cost * 2; // Offset some of the cost penalty
			}
			
			// High adrenaline remaining - encourage using it
			if (adrenaline >= 6) {
				score += 15; // Bonus for using high adrenaline
				
				// Extra bonus for attack cards when we have lots of adrenaline
				if (isDamageCard && adrenaline >= 7) {
					score += 25; // Strong encouragement to attack
				}
			}
		}

		// Can't play it? Heavy penalty
		if (action.driver && action.driver.adrenaline < card.cost) {
			score = -1000;
		}

		return score;
	}

	/**
	 * Check if a driver's vehicle is in flanking position
	 */
	private isDriverInFlanking(driver: Driver, gameState: GameStateEvaluation): boolean {
		// Determine which team we're controlling
		const isPlayerTeam = this.team.type === TeamType.PLAYER;
		const ourVehicles = isPlayerTeam ? gameState.playerTeam.vehicles : gameState.enemyTeam.vehicles;
		
		// Find the driver's vehicle in the game state
		for (const vehicleEval of ourVehicles) {
			if (vehicleEval.driver === driver) {
				return vehicleEval.position === 'flanking';
			}
		}
		return false;
	}

	/**
	 * Estimate damage a card will deal
	 */
	private estimateCardDamage(card: Card, driver?: Driver): number {
		let damage = 0;
		
		for (const effect of card.effects) {
			if (effect.type === 'damage' && typeof effect.value === 'number') {
				damage += effect.value;
			}
		}

		// Account for driver's gunnery bonus (affects ranged attacks)
		if (driver && driver.vehicleStats.gunnery > 0 && card.tags?.includes('ranged')) {
			// Gunnery improves hit chance, not damage directly
			// But we can factor it in as expected damage
			damage = Math.ceil(damage * 1.1);
		}

		return damage;
	}
}

export class SalvageAI extends AIPlayer {
	private strategy: SalvageAIStrategy;

	constructor(team: Team, battle: Battle) {
		super(team, battle);
		this.strategy = new SalvageAIStrategy(team);
	}

	async makeDecision(): Promise<AIDecision | null> {
		const gameState = this.evaluateGameState();
		const possibleActions = this.generatePossibleActions();

		if (possibleActions.length === 0) {
			return null;
		}

		return this.strategy.chooseBestAction(possibleActions, gameState);
	}

	/**
	 * Get difficulty rating (0-1)
	 */
	getDifficulty(): number {
		return 0.8; // Increased from 0.7
	}
}