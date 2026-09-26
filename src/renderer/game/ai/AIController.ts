import { Battle } from '../mechanics/Battle';
import { Team } from '../mechanics/Team';
import { Vehicle } from '../mechanics/Vehicle';
import { BoardProjection } from '../mechanics/BoardProjection';
import { PlannedAction } from '../mechanics/Intent';
import { AIPlayer } from './AIPlayer';
import { RandomAI } from './RandomAI';
import { AggressiveFlankerAI } from './AggressiveFlankerAI';
import { MCTSAI } from './MCTSAI';
import { SalvageAI } from './SalvageAI';
import { RammingAI } from './RammingAI';
import { FirstPlayableAI } from './FirstPlayableAI';
import { AIDecision } from './types';

export type AIType = 'random' | 'aggressive' | 'defensive' | 'balanced' | 'mcts' | 'salvage' | 'ramming';

export class AIController {
	private battle: Battle;
	private playerAI: AIPlayer | null = null;
	private enemyAI: AIPlayer | null = null;

	constructor(battle: Battle) {
		this.battle = battle;
	}

	setPlayerAI(type: AIType | null): void {
		if (type === null) {
			this.playerAI = null;
			return;
		}

		this.playerAI = this.createAI(type, this.battle.playerTeam);
	}

	setEnemyAI(type: AIType | null): void {
		if (type === null) {
			this.enemyAI = null;
			return;
		}

		this.enemyAI = this.createAI(type, this.battle.enemyTeam);
	}

	private createAI(type: AIType, team: Team): AIPlayer {
		switch (type) {
			case 'random':
				return new RandomAI(team, this.battle);
			case 'aggressive':
				return new AggressiveFlankerAI(team, this.battle);
			case 'mcts':
				return new MCTSAI({ team, battle: this.battle });
			case 'salvage':
				return new SalvageAI(team, this.battle);
			case 'ramming':
				return new RammingAI(team, this.battle);
			case 'defensive':
			case 'balanced':
				console.warn(`AI type '${type}' not yet implemented, using RandomAI`);
				return new RandomAI(team, this.battle);
			default:
				throw new Error(`Unknown AI type: ${type}`);
		}
	}

	async getPlayerDecision(): Promise<AIDecision | null> {
		if (!this.playerAI) return null;
		return this.playerAI.makeDecision();
	}

	/**
	 * Commit every raider's cards for its coming turn. Raiders plan one at a
	 * time in team order, which is the order they act, against one shared
	 * projection, so a later pick sees the board after an earlier flank or
	 * speed change, this raider's or another's. With no enemy AI set, raiders
	 * play their first playable card each time.
	 */
	planEnemyTurn(): Map<Vehicle, PlannedAction[]> {
		const team = this.battle.enemyTeam;
		const ai = this.enemyAI ?? new FirstPlayableAI(team, this.battle);
		const board = new BoardProjection({ battle: this.battle });
		const plans = new Map<Vehicle, PlannedAction[]>();

		for (const raider of team.vehicles) {
			const driver = raider.driver;
			if (raider.isOutOfFight || !driver) continue;

			board.actor = raider;
			const actions: PlannedAction[] = [];
			for (;;) {
				const decision = ai.makeDecision(board);
				const card = decision?.card;
				if (decision?.type !== 'playCard' || !card || decision.driver !== driver || !board.handOf(driver).includes(card)) {
					break;
				}
				const target = decision.target instanceof Vehicle ? decision.target : null;
				actions.push({
					card,
					driver,
					target,
					flanking: board.isFlanking(raider),
					speed: board.speedOf(raider)
				});
				board.apply({ card, driver, target });
			}
			if (actions.length > 0) {
				plans.set(raider, actions);
			}
		}

		return plans;
	}

	isPlayerControlledByAI(): boolean {
		return this.playerAI !== null;
	}

	isEnemyControlledByAI(): boolean {
		return this.enemyAI !== null;
	}

	/**
	 * Let the player AI play cards until it chooses to end the turn or picks
	 * a play the battle refuses. Stopping on a refusal keeps a bad pick from
	 * being offered forever. Doesn't end the turn itself.
	 */
	async playPlayerCards(): Promise<void> {
		while (!this.battle.isBattleOver()) {
			const decision = await this.getPlayerDecision();
			if (decision?.type !== 'playCard' || !await this.executeAIDecision(decision, true)) {
				return;
			}
		}
	}

	/**
	 * Carry out an AI decision. Returns true only when a card was played.
	 */
	async executeAIDecision(decision: AIDecision, isPlayerTeam: boolean): Promise<boolean> {
		if (decision.type === 'endTurn') {
			if (isPlayerTeam) {
				await this.battle.endPlayerTurn();
			}
			return false;
		}

		if (decision.type === 'playCard' && decision.card && decision.driver) {
			// Find the card index in the driver's hand
			const cardIndex = decision.driver.hand.indexOf(decision.card);
			if (cardIndex === -1) {
				console.error('Card not found in driver hand');
				return false;
			}

			if (isPlayerTeam) {
				// For player AI, use the public playCard method
				let targetVehicle: Vehicle | undefined;
				
				// Only pass target for cards that need external targets
				// Self-targeting cards should not have a target passed
				if (decision.card.targetType !== 'self' && decision.card.targetType !== 'both_drivers') {
					if (decision.target && 'structure' in decision.target) {
						targetVehicle = decision.target as Vehicle;
					}
				}
				
				return this.battle.playCard({
					driver: decision.driver,
					cardIndex,
					targetVehicle
				});
			}
			// The enemy team plays its planned turn inside Battle, never through here
		}
		return false;
	}
}