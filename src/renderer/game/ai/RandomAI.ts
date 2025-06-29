import { AIPlayer } from './AIPlayer';
import { AIDecision, AIStrategy, GameStateEvaluation } from './types';

export class RandomAIStrategy implements AIStrategy {
	name = 'Random AI';

	chooseBestAction(
		possibleActions: AIDecision[],
		gameState: GameStateEvaluation
	): AIDecision {
		if (possibleActions.length === 0) {
			return { type: 'endTurn' };
		}

		const randomIndex = Math.floor(Math.random() * possibleActions.length);
		return possibleActions[randomIndex];
	}
}

export class RandomAI extends AIPlayer {
	private strategy: RandomAIStrategy;

	constructor(team: any, battle: any) {
		super(team, battle);
		this.strategy = new RandomAIStrategy();
	}

	async makeDecision(): Promise<AIDecision | null> {
		const gameState = this.evaluateGameState();
		const possibleActions = this.generatePossibleActions();

		if (possibleActions.length === 0) {
			return null;
		}

		return this.strategy.chooseBestAction(possibleActions, gameState);
	}
}