import { AIPlayer } from './AIPlayer';
import { AIDecision, GameStateEvaluation } from './types';
import { Battle } from '../mechanics/Battle';
import { Team } from '../mechanics/Team';
import { Vehicle, statusSpeedModifier } from '../mechanics/Vehicle';
import { Driver } from '../mechanics/Driver';
import { Card, CardEffect } from '../mechanics/Card';
import { laneKind } from '../mechanics/Road';
import { DamageKind, damageToFinish, effectDamageKind } from './DamageEstimate';
import { cardsKeptFromDraw } from './DrawEstimate';
import { EffectRecipient, effectRecipientOf } from '../mechanics/EffectTargets';
import { cardFlanks, selfSpeedBonus } from '../mechanics/BoardProjection';

/**
 * Monte Carlo Tree Search AI Player
 * Uses MCTS algorithm to find effective moves through simulated gameplay
 * 
 * Improved version with better evaluation functions and strategic planning
 */
export class MCTSAI extends AIPlayer {
	private readonly iterations: number;
	private readonly explorationConstant: number;
	
	// Strategic weights - optimized for winning
	private readonly ELIMINATION_SCORE = 20.0; // Doubled - eliminating enemies is key
	private readonly DAMAGE_WEIGHT = 1.5; // Increased - aggression wins games
	private readonly FLANKING_BONUS = 1.5; // Flanking deals +50%
	private readonly LOW_HEALTH_BONUS = 3.0; // Increased - finish off weak enemies
	private readonly HEAL_WEIGHT = 0.5; // Decreased - offense > defense
	private readonly ARMOR_WEIGHT = 0.4; // Decreased - offense > defense
	private readonly CARD_DRAW_WEIGHT = 2.0; // Increased - card advantage is crucial
	private readonly ADRENALINE_WEIGHT = 2.5; // Increased - enables more plays
	private readonly FLANK_WEIGHT = 8.0; // Flanking wins games
	private readonly SPEED_BOOST_WEIGHT = 3.5; // Increased - enables flanking
	private readonly FOCUS_FIRE_BONUS = 2.5; // New - concentrate attacks
	private readonly TEMPO_BONUS = 1.5; // New - reward playing multiple cards
	
	constructor({
		team,
		battle,
		iterations = 3000, // Further increased for better decision making
		explorationConstant = 1.2 // Lower for more exploitation of good moves
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
	
	private isInsideLane(vehicle: Vehicle): boolean {
		const slot = this.board.slotOf(vehicle);
		return slot !== null && laneKind(slot.lane) === 'inside';
	}

	protected chooseAction(): AIDecision | null {
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
		
		// Track card plays for aggressive strategy
		let cardPlaysAvailable = 0;
		let bestCardScore = -Infinity;
		let bestCardAction: AIDecision | null = null;
		
		for (const [action, stats] of actionScores) {
			if (stats.visits > 0) {
				const avgScore = stats.totalScore / stats.visits;
				
				// Track card plays separately
				if (action.type === 'playCard' && action.card) {
					cardPlaysAvailable++;
					if (avgScore > bestCardScore) {
						bestCardScore = avgScore;
						bestCardAction = action;
					}
				}
				
				// Prefer actions with both high score and reasonable visits
				const confidence = Math.min(stats.visits / 100, 1); // Confidence factor
				const finalScore = avgScore * (0.8 + 0.2 * confidence);
				
				if (finalScore > bestScore) {
					bestScore = finalScore;
					bestAction = action;
				}
			}
		}
		
		// Aggressive strategy: Always prefer playing cards if they have positive value
		if (bestAction.type === 'endTurn' && bestCardAction && bestCardScore > 0.5) {
			// Only end turn if no cards have any value
			return bestCardAction;
		}
		
		// Extra aggressive: If we have high-damage cards available, play them
		if (cardPlaysAvailable > 0 && bestCardScore > 3.0) {
			return bestCardAction;
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
	 * Evaluate an action with full game context. Protected so tests can read
	 * what a play is worth.
	 */
	protected evaluateActionWithContext(action: AIDecision): number {
		if (action.type === 'endTurn') {
			// End turn only if we can't play valuable cards
			const remainingActions = this.countRemainingValuableActions();
			if (remainingActions > 0) {
				return -5.0; // Stronger penalty for ending turn with good plays available
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
			
			const actor = this.actorOf({ card, target: action.target, ourVehicle });
			const keptCards = cardsKeptFromDraw({ board: this.board, card, player: driver });
			let score = this.evaluateMovement(card, actor) + this.CARD_DRAW_WEIGHT * keptCards;
			
			// Evaluate card effects with context
			if (card.effects) {
				for (const effect of card.effects) {
					// Self damage (Ramming Run's cost) lands on us, not the target
					if (effect.type === 'damage' && effectRecipientOf({ effect, card }) === EffectRecipient.CASTER) continue;
					score += this.evaluateEffectWithContext({ effect, card, target: action.target, ourVehicle, actor });
				}
			}
			
			// Special bonus for area damage cards when multiple enemies exist
			if (card.targetType === 'enemy_all') {
				const aliveEnemies = this.getEnemyTeam().getAliveVehicles().length;
				if (aliveEnemies > 1) {
					score *= 1.5; // 50% bonus for hitting multiple targets
				}
			}
			
			// Consider card synergies and combos
			score += this.evaluateCardSynergy({ card, driver, keptCards });
			
			// Resource efficiency - reduced penalty for aggressive play
			const costPenalty = card.cost * 0.1; // Reduced penalty
			score -= costPenalty;
			
			// Bonus for using adrenaline efficiently
			if (this.board.adrenalineOf(driver) - card.cost <= 1) {
				score += 1.0; // Increased bonus for using up adrenaline
			}
			
			// Apply tempo bonus for playing multiple cards
			score += this.calculateTempoBonus(driver, gameState);
			
			// Bonus for offensive cards
			if (card.effects && card.effects.some(e => e.type === 'damage')) {
				score += 2.0; // Flat bonus for damage cards
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
			if (vehicle.isOutOfFight) continue;
			for (const driver of this.actingOccupants(vehicle)) {
				for (const card of this.board.handOf(driver)) {
					if (this.canPlay({ driver, card }) && this.isValuablePlay({ card, driver })) {
						count++;
					}
				}
			}
		}
		return count;
	}

	/**
	 * Whether a card in hand is worth holding the turn open for: a real hit
	 * or heal, a move, adrenaline, a speed boost, or a draw that keeps a card
	 */
	private isValuablePlay({ card, driver }: { card: Card; driver: Driver }): boolean {
		const valuableEffect = card.effects.some(e =>
			e.type === 'damage' && (e.value || 0) >= 3 || // Lowered threshold
			e.type === 'heal' && (e.value || 0) >= 3 ||
			e.type === 'change_position' ||
			e.type === 'gain_resource' && e.resource === 'adrenaline'
		);
		if (valuableEffect) return true;
		if (selfSpeedBonus(card) > 0) return true;
		return cardsKeptFromDraw({ board: this.board, card, player: driver }) > 0;
	}
	
	/**
	 * The vehicle a driver plays from: the one they drive, or ride in as a passenger
	 */
	private findVehicleForDriver(driver: Driver): Vehicle | null {
		return [...this.team.vehicles, ...this.getEnemyTeam().vehicles].find(vehicle => vehicle.carries(driver)) ?? null;
	}
	
	/**
	 * Get enemy team
	 */
	private getEnemyTeam(): Team {
		return this.team === this.battle.playerTeam ? this.battle.enemyTeam : this.battle.playerTeam;
	}
	
	/**
	 * The vehicle a card's own effects land on: the escort that carries out an
	 * attack order (Run Ahead's Outrider), otherwise the one playing it. Null
	 * when no escort can carry the order out.
	 */
	private actorOf({ card, target, ourVehicle }: { card: Card; target: Vehicle | Driver | undefined; ourVehicle: Vehicle }): Vehicle | null {
		if (!this.battle.isAttackOrder(card)) return ourVehicle;
		return target instanceof Vehicle ? this.board.orderCarrier({ card, target }) : null;
	}

	/**
	 * Evaluate effect with full context. The card's flank and its own speed
	 * are scored once for the whole card in evaluateMovement, and its draws
	 * once in evaluateActionWithContext.
	 */
	private evaluateEffectWithContext({
		effect,
		card,
		target,
		ourVehicle,
		actor
	}: {
		effect: CardEffect;
		card: Card;
		target: Vehicle | Driver | undefined;
		ourVehicle: Vehicle;
		actor: Vehicle | null;
	}): number {
		const onActor = effectRecipientOf({ effect, card }) === EffectRecipient.CASTER;
		switch (effect.type) {
			case 'damage':
				return this.evaluateDamageWithContext({ damage: effect.value || 0, kind: effectDamageKind(effect), target, ourVehicle });
			case 'heal':
				return this.evaluateHealWithContext(effect.value || 0, target, ourVehicle);
			case 'gain_armor':
				return this.evaluateArmorWithContext(effect.value || 0, onActor ? actor ?? undefined : target);
			case 'gain_resource':
				return effect.resource === 'adrenaline' ? this.ADRENALINE_WEIGHT * (effect.value || 1) : 0;
			case 'change_position':
			case 'draw_cards':
				return 0;
			case 'apply_status':
				return this.evaluateStatus({ effect, onActor, target });
			default:
				return 0.5; // Unknown effects get moderate score
		}
	}
	
	/**
	 * Evaluate damage with flanking bonus and target priority
	 */
	private evaluateDamageWithContext({
		damage,
		kind,
		target,
		ourVehicle
	}: {
		damage: number;
		kind: DamageKind;
		target: Vehicle | Driver | undefined;
		ourVehicle: Vehicle;
	}): number {
		if (!target || !(target instanceof Vehicle)) {
			return damage * 0.1; // Small score for untargeted damage
		}
		
		const targetVehicle = target as Vehicle;
		const currentHealth = damageToFinish({ target: targetVehicle, kind });
		let score = damage * this.DAMAGE_WEIGHT;
		
		// Apply flanking bonus
		if (this.board.isFlanking(ourVehicle)) {
			score *= this.FLANKING_BONUS;
		}
		
		// Huge bonus for elimination
		if (damage >= currentHealth) {
			return this.ELIMINATION_SCORE * 2; // Double bonus for guaranteed kills
		}
		
		// Bonus for attacking low health targets
		const healthPercent = targetVehicle.structure / targetVehicle.maxStructure;
		if (healthPercent < 0.5) {
			score *= this.LOW_HEALTH_BONUS;
		}
		
		// Extra bonus if this puts them in elimination range for next attack
		if (currentHealth - damage <= 5) {
			score += this.ELIMINATION_SCORE * 0.5;
		}
		
		// Prioritize targets in the inside lane, closest to the centre line
		if (this.isInsideLane(targetVehicle)) {
			score *= 1.2;
		}
		
		// Shield and armor soak a vehicle hit, which makes it worth less
		const soak = kind === DamageKind.VEHICLE ? (targetVehicle.shield ?? 0) + targetVehicle.armor : 0;
		if (soak > 0) {
			const soakReduction = Math.min(soak / damage, 0.5);
			score *= (1 - soakReduction);
		}
		
		// Apply focus fire bonus if others are also targeting this vehicle
		score += this.calculateFocusFireBonus(targetVehicle, currentHealth);
		
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
		// Armor past the vehicle's max is lost
		const armorGained = Math.min(armor, targetVehicle.maxArmor - targetVehicle.armor);
		if (armorGained <= 0) {
			return 0;
		}
		let score = armorGained * this.ARMOR_WEIGHT;
		
		// Armor is more valuable on healthy vehicles
		const healthPercent = targetVehicle.structure / targetVehicle.maxStructure;
		score *= healthPercent;
		
		// Bonus if vehicle is in the inside lane (likely to take damage)
		if (this.isInsideLane(targetVehicle)) {
			score *= 1.5;
		}
		
		return score;
	}
	
	/**
	 * The card's flank and its speed boost for whoever acts, scored once for
	 * the whole card. A card that flanks is worth the flank weight when its
	 * boost (Run Ahead) or the actor's own speed lets it outrun someone, and
	 * nothing otherwise; the boost counts only through the flank. A boost
	 * alone (Nitro Boost) is worth most when it's what opens a flank.
	 */
	private evaluateMovement(card: Card, actor: Vehicle | null): number {
		if (!actor) {
			return 0;
		}
		const speedBonus = selfSpeedBonus(card);
		if (cardFlanks(card)) {
			return !this.board.isFlanking(actor) && this.board.canFlankAnyone(actor, speedBonus) ? this.FLANK_WEIGHT : 0;
		}
		return speedBonus > 0 ? this.evaluateSpeedBoost(speedBonus, actor) : 0;
	}

	/**
	 * A slow on the target (Oil Slick, Caltrops, Flag Down) is worth the speed
	 * it can take away. A speed boost on whoever acts is scored in
	 * evaluateMovement, and any other status keeps the flat score unknown
	 * effects get.
	 */
	private evaluateStatus({ effect, onActor, target }: { effect: CardEffect; onActor: boolean; target: Vehicle | Driver | undefined }): number {
		const speedChange = statusSpeedModifier({ name: effect.status ?? '', duration: 1, value: effect.value });
		if (onActor && speedChange > 0) {
			return 0;
		}
		if (!onActor && speedChange < 0) {
			// Speed floors at 0, so a slow takes away no more than the target has.
			// Worth what a boost that opens no flank is worth, point for point.
			const speedLost = target instanceof Vehicle ? Math.min(-speedChange, this.board.speedOf(target)) : 0;
			return this.SPEED_BOOST_WEIGHT * (speedLost / 10);
		}
		return 0.5;
	}

	/**
	 * Evaluate speed boost
	 */
	private evaluateSpeedBoost(speedBoost: number, ourVehicle: Vehicle): number {
		// Very valuable if we need speed for flanking
		if (!this.board.isFlanking(ourVehicle)) {
			// Big bonus if this is what opens a flank
			if (!this.board.canFlankAnyone(ourVehicle) && this.board.canFlankAnyone(ourVehicle, speedBoost)) {
				return this.SPEED_BOOST_WEIGHT * 3;
			}
			
			return this.SPEED_BOOST_WEIGHT * (speedBoost / 10);
		}
		
		return speedBoost * 0.1; // Small value if already flanking
	}
	
	/**
	 * Evaluate card synergies. `keptCards` is how many cards the play's draw
	 * keeps.
	 */
	private evaluateCardSynergy({ card, driver, keptCards }: { card: Card; driver: Driver; keptCards: number }): number {
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
		
		// Bonus for combo potential, from cards a draw keeps
		if (keptCards > 0) {
			synergyScore += 0.5; // Card draw enables more combos
		}
		
		return synergyScore;
	}
	
	/**
	 * Calculate focus fire bonus - reward concentrating attacks on one target
	 */
	private calculateFocusFireBonus(targetVehicle: Vehicle, damageToFinishTarget: number): number {
		let bonus = 0;
		
		// Check if this target is already damaged
		const healthPercent = targetVehicle.structure / targetVehicle.maxStructure;
		if (healthPercent < 0.7) {
			// Give bonus for attacking already damaged targets
			bonus += this.FOCUS_FIRE_BONUS * (1 - healthPercent);
			
			// Extra bonus if we can eliminate the target
			if (damageToFinishTarget <= 10) {
				bonus += this.FOCUS_FIRE_BONUS;
			}
		}
		
		return bonus;
	}
	
	/**
	 * Calculate tempo bonus - reward playing multiple cards in a turn
	 */
	private calculateTempoBonus(driver: Driver, _gameState: GameStateEvaluation): number {
		// Check how many cards we can still play
		let playableCards = 0;
		for (const card of this.board.handOf(driver)) {
			if (this.board.adrenalineOf(driver) >= card.cost) {
				playableCards++;
			}
		}
		
		// Give bonus if we can play more cards (tempo advantage)
		if (playableCards > 1) {
			return this.TEMPO_BONUS * Math.min(playableCards - 1, 2);
		}
		
		return 0;
	}
}