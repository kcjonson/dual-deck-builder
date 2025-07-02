import { AIPlayer } from './AIPlayer';
import { AIDecision, AIStrategy, GameStateEvaluation, VehicleEvaluation } from './types';
import { Team } from '../mechanics/Team';
import { Battle } from '../mechanics/Battle';
import { Vehicle } from '../mechanics/Vehicle';
import { Card } from '../mechanics/Card';
import { CardEffectValidator } from './CardEffectValidator';

/**
 * Ramming AI Strategy
 * Prioritizes ramming attacks, close-range combat, and aggressive positioning
 * Focuses on building up speed and armor to maximize ramming damage
 */
export class RammingStrategy implements AIStrategy {
	name = 'Ramming AI';
	private battle: Battle;

	constructor(battle: Battle) {
		this.battle = battle;
	}

	private readonly RAMMING_PRIORITY = 300;
	private readonly SPEED_PRIORITY = 250;
	private readonly ARMOR_PRIORITY = 200;
	private readonly POSITION_PRIORITY = 150;
	private readonly DAMAGE_WEIGHT = 10;
	private readonly HEAL_WEIGHT = 50;
	private readonly KILL_BONUS = 500;
	private readonly LOW_HEALTH_THRESHOLD = 0.3;
	private readonly SPEED_THRESHOLD = 60; // Minimum speed for effective ramming
	private readonly VULNERABLE_BONUS = 1.5;

	chooseBestAction(
		possibleActions: AIDecision[],
		gameState: GameStateEvaluation
	): AIDecision {
		if (possibleActions.length === 0) {
			return { type: 'endTurn' };
		}

		// Debug log game state
		console.log('RammingAI gameState:', {
			currentTurn: gameState.currentTurn,
			phase: gameState.phase,
			playerTeamVehicles: gameState.playerTeam.vehicles.length,
			enemyTeamVehicles: gameState.enemyTeam.vehicles.length
		});

		// Score each action
		const scoredActions = possibleActions.map(action => ({
			action,
			score: this.scoreAction(action, gameState)
		}));

		// Sort by score descending
		scoredActions.sort((a, b) => b.score - a.score);

		if (scoredActions[0].score < 0) {
			return { type: 'endTurn'};
		}
		
		// Return the best action
		return scoredActions[0].action;
	}

	private scoreAction(action: AIDecision, gameState: GameStateEvaluation): number {
		if (action.type === 'endTurn') {
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
		if (!ourVehicle) {
			console.warn(`RammingAI: Could not find vehicle for driver ${driver.metadata?.name || 'unknown'}`);
			return -1000;
		}

		// Check if the card will have any beneficial effect
		const targetVehicle = action.target as Vehicle || ourVehicle.vehicle;
		if (!CardEffectValidator.willCardHaveEffect(card, driver, targetVehicle, this.battle)) {
			console.log(`RammingAI: ${card.name} would have no effect, skipping`);
			return -500; // Strong negative score for cards with no effect
		}

		// Get card effects
		const cardEffects = this.analyzeCardEffects(card);

		// HIGHEST PRIORITY: Ramming attacks
		if (cardEffects.isRamming) {
			score += this.RAMMING_PRIORITY;
			
			// Extra bonus if we have high speed
			const currentSpeed = ourVehicle.vehicle.getTotalSpeed();
			if (currentSpeed >= this.SPEED_THRESHOLD) {
				score += this.RAMMING_PRIORITY * 0.5;
			}
			
			// Extra bonus if we have high armor (less damage to ourselves)
			if (ourVehicle.armorPercent > 0.5) {
				score += this.RAMMING_PRIORITY * 0.3;
			}

			// Consider target if we have one
			if (action.target && 'structure' in action.target) {
				const targetVehicle = action.target as Vehicle;
				const targetEval = this.getVehicleEvaluation(targetVehicle, gameState);
				
				if (targetEval) {
					// Bonus for ramming low health targets
					score += (1 - targetEval.healthPercent) * 200;
					
					// Bonus if target is vulnerable
					if (targetVehicle.hasStatusEffect('vulnerable')) {
						score *= this.VULNERABLE_BONUS;
					}

					// Check if ram would kill
					const potentialDamage = this.estimateRamDamage(ourVehicle, targetEval);
					if (potentialDamage >= targetVehicle.structure + targetVehicle.armor) {
						score += this.KILL_BONUS;
					}
				}
			}
		}

		// HIGH PRIORITY: Speed boosts (essential for ramming)
		if (cardEffects.speedBoost > 0) {
			score += this.SPEED_PRIORITY;
			
			// Extra priority if we're below speed threshold
			const currentSpeed = ourVehicle.vehicle.getTotalSpeed();
			if (currentSpeed < this.SPEED_THRESHOLD) {
				score += this.SPEED_PRIORITY * 0.5;
			}
		}

		// HIGH PRIORITY: Armor (protects us during rams)
		if (cardEffects.armor > 0) {
			// Use validator to check effective armor
			const effectiveArmor = CardEffectValidator.getEffectiveArmor(card, ourVehicle.vehicle);
			
			console.log(`RammingAI: Evaluating armor card ${card.name} - Vehicle ${ourVehicle.vehicle.name} has ${ourVehicle.vehicle.armor}/${ourVehicle.vehicle.maxArmor} armor (effective gain: ${effectiveArmor})`);
			
			if (effectiveArmor > 0) {
				score += this.ARMOR_PRIORITY;
				
				// Extra priority if low on armor
				if (ourVehicle.armorPercent < 0.3) {
					score += this.ARMOR_PRIORITY * 0.5;
				}
			}
		}

		// MEDIUM PRIORITY: Position changes (get to front for ramming)
		if (cardEffects.changesPosition) {
			// Prefer front position for ramming
			if (ourVehicle.position !== 'front') {
				score += this.POSITION_PRIORITY;
			}
		}

		// Score regular damage (lower priority than ramming)
		if (cardEffects.damage > 0 && !cardEffects.isRamming) {
			let damageScore = cardEffects.damage * this.DAMAGE_WEIGHT;

			// Consider target
			if (action.target && 'structure' in action.target) {
				const targetVehicle = action.target as Vehicle;
				const targetEval = this.getVehicleEvaluation(targetVehicle, gameState);
				
				if (targetEval) {
					// Bonus for attacking low health targets
					damageScore *= (2 - targetEval.healthPercent);
					
					// Kill bonus
					if (cardEffects.damage >= targetVehicle.structure + targetVehicle.armor) {
						damageScore += this.KILL_BONUS * 0.5; // Less than ram kill
					}
				}
			}

			score += damageScore;
		}

		// Healing logic
		if (cardEffects.heal > 0) {
			// Use validator to check effective healing
			const effectiveHealing = CardEffectValidator.getEffectiveHealing(card, ourVehicle.vehicle);
			
			// Only consider healing if it will actually heal something
			if (effectiveHealing > 0) {
				// CRITICAL priority when very low health
				if (ourVehicle.healthPercent <= this.LOW_HEALTH_THRESHOLD) {
					score += 1000 + (this.HEAL_WEIGHT * effectiveHealing);
				} else if (ourVehicle.healthPercent < 0.7) {
					// Medium priority when moderately damaged
					score += this.HEAL_WEIGHT * effectiveHealing * 0.5;
				}
			}
		}

		// Adrenaline generation is good for more rams
		if (cardEffects.adrenalineGain > 0) {
			score += cardEffects.adrenalineGain * 30;
		}

		// Card draw is valuable, especially with leftover adrenaline
		if (cardEffects.drawCards > 0) {
			// Base value for card draw
			let drawScore = cardEffects.drawCards * 40;
			
			// Extra value if we have adrenaline left after playing this card
			const adrenalineAfter = driver.adrenaline - card.cost;
			if (adrenalineAfter >= 2) {
				drawScore *= 1.5; // 50% bonus if we can likely play drawn cards
			}
			
			// Extra value in early game for hand building
			if (gameState.currentTurn <= 3) {
				drawScore *= 1.2;
			}
			
			score += drawScore;
		}

		// Consider card cost efficiency
		if (card.cost > 3) {
			score *= 0.9;
		}

		// Slightly penalize using all adrenaline early
		const adrenalineAfter = driver.adrenaline - card.cost;
		if (adrenalineAfter === 0 && gameState.currentTurn < 3) {
			score *= 0.9;
		}

		console.log(`RammingAI: Final score for ${card.name}: ${score}`);
		return score;
	}

	private analyzeCardEffects(card: Card): {
		damage: number;
		heal: number;
		armor: number;
		speedBoost: number;
		adrenalineGain: number;
		changesPosition: boolean;
		isRamming: boolean;
		drawCards: number;
	} {
		const result = {
			damage: 0,
			heal: 0,
			armor: 0,
			speedBoost: 0,
			adrenalineGain: 0, 
			changesPosition: false,
			isRamming: false,
			drawCards: 0
		};

		// Check if this is a ramming card
		if (card.type.includes('ram') || card.description.toLowerCase().includes('ram')) {
			result.isRamming = true;
		}

		// Check scaling type
		if (card.effects.some(e => e.scaling === 'ramming')) {
			result.isRamming = true;
		}

		for (const effect of card.effects) {
			switch (effect.type) {
				case 'damage':
					result.damage += effect.value || 0;
					// Formula-based damage (ram damage)
					if (effect.formula && typeof effect.formula === 'string') {
						result.isRamming = true;
						// Estimate ram damage (simplified)
						result.damage += 30; // Approximate average ram damage
					}
					break;
				case 'heal':
					result.heal += effect.value || 0;
					break;
				case 'armor':
				case 'gain_armor':
					result.armor += effect.value || 0;
					break;
				case 'speed':
					result.speedBoost += effect.value || 0;
					break;
				case 'adrenaline':
					result.adrenalineGain += effect.value || 0;
					break;
				case 'move_to_position':
				case 'change_position':
					result.changesPosition = true;
					break;
				case 'draw_cards':
				case 'draw':
					result.drawCards += effect.value || 0;
					break;
				case 'apply_status':
				case 'status':
					// Check for speed-related statuses
					if (effect.status === 'speed_boost' || effect.status === 'nitro_boost') {
						result.speedBoost += effect.value || 0;
					}
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

	private estimateRamDamage(
		attacker: VehicleEvaluation,
		target: VehicleEvaluation
	): number {
		// Simplified ram damage calculation
		const attackerSpeed = attacker.vehicle.getTotalSpeed();
		const targetSpeed = target.vehicle.getTotalSpeed();
		const speedDiff = Math.max(0, attackerSpeed - targetSpeed);
		
		// Base ram damage formula (simplified)
		const attackerArmor = attacker.vehicle.armor;
		const baseDamage = Math.floor(attackerArmor / 10) + speedDiff;
		
		// Apply driver ramming skill bonus (assumed)
		const rammingSkill = attacker.driver?.skills?.ramming || 5;
		const skillMultiplier = 1 + (rammingSkill / 10);
		
		return Math.floor(baseDamage * skillMultiplier);
	}

	private getVehicleForDriver(
		driver: unknown, 
		gameState: GameStateEvaluation
	): VehicleEvaluation | null {
		// Check both teams - AI can control either team
		for (const vehicleEval of gameState.playerTeam.vehicles) {
			if (vehicleEval.driver === driver) {
				return vehicleEval;
			}
		}
		for (const vehicleEval of gameState.enemyTeam.vehicles) {
			if (vehicleEval.driver === driver) {
				return vehicleEval;
			}
		}
		console.log('Vehicle not found for driver!');
		return null;
	}

	private getVehicleEvaluation(
		vehicle: Vehicle, 
		gameState: GameStateEvaluation
	): VehicleEvaluation | null {
		// Check both teams - vehicles can be on either team
		for (const vehicleEval of gameState.playerTeam.vehicles) {
			if (vehicleEval.vehicle === vehicle) {
				return vehicleEval;
			}
		}
		for (const vehicleEval of gameState.enemyTeam.vehicles) {
			if (vehicleEval.vehicle === vehicle) {
				return vehicleEval;
			}
		}
		return null;
	}
}

/**
 * Ramming AI Player
 * Uses ramming-focused strategy to crush enemies with vehicle collisions
 */
export class RammingAI extends AIPlayer {
	private strategy: RammingStrategy;

	constructor(team: Team, battle: Battle) {
		super(team, battle);
		this.strategy = new RammingStrategy(battle);
	}

	async makeDecision(): Promise<AIDecision | null> {
		const gameState = this.evaluateGameState();
		const possibleActions = this.generatePossibleActions();

		if (possibleActions.length === 0) {
			return { type: 'endTurn' };
		}

		const decision = this.strategy.chooseBestAction(possibleActions, gameState);
		return decision || { type: 'endTurn' };
	}
}