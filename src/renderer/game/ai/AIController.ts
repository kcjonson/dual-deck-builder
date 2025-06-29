import { Battle } from '../mechanics/Battle';
import { Team } from '../mechanics/Team';
import { Vehicle } from '../mechanics/Vehicle';
import { Driver } from '../mechanics/Driver';
import { Card } from '../mechanics/Card';
import { AIPlayer } from './AIPlayer';
import { RandomAI } from './RandomAI';
import { AIDecision } from './types';

export type AIType = 'random' | 'aggressive' | 'defensive' | 'balanced';

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

	async getEnemyDecision(): Promise<AIDecision | null> {
		if (!this.enemyAI) return null;
		return this.enemyAI.makeDecision();
	}

	isPlayerControlledByAI(): boolean {
		return this.playerAI !== null;
	}

	isEnemyControlledByAI(): boolean {
		return this.enemyAI !== null;
	}

	async executeAIDecision(decision: AIDecision, isPlayerTeam: boolean): Promise<void> {
		if (decision.type === 'endTurn') {
			if (isPlayerTeam) {
				await this.battle.endPlayerTurn();
			}
			return;
		}

		if (decision.type === 'playCard' && decision.card && decision.driver) {
			// Find the card index in the driver's hand
			const cardIndex = decision.driver.hand.indexOf(decision.card);
			if (cardIndex === -1) {
				console.error('Card not found in driver hand');
				return;
			}

			if (isPlayerTeam) {
				// For player AI, use the public playCard method
				let targetVehicle: Vehicle | undefined;
				if (decision.target && 'structure' in decision.target) {
					targetVehicle = decision.target as Vehicle;
				}
				
				this.battle.playCard({
					driver: decision.driver,
					cardIndex,
					targetVehicle
				});
			}
			// For enemy AI, the Battle.executeEnemyAction will handle it directly
		}
	}

	private findVehicleByDriver(driver: Driver): Vehicle | undefined {
		const allVehicles = [...this.battle.playerTeam.vehicles, ...this.battle.enemyTeam.vehicles];
		return allVehicles.find(v => v.driver === driver);
	}
}