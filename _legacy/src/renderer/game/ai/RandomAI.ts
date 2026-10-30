import { AIPlayer } from './AIPlayer';
import { AIDecision, AIStrategy, GameStateEvaluation } from './types';
import { Team } from '../mechanics/Team';
import { Battle } from '../mechanics/Battle';
import type { Rng } from '../core/Rng';

export class RandomAIStrategy implements AIStrategy {
	name = 'Random AI';
	private readonly rng: Rng;

	constructor({ rng }: { rng: Rng }) {
		this.rng = rng;
	}

	chooseBestAction(
		possibleActions: AIDecision[],
		_gameState: GameStateEvaluation
	): AIDecision {
		if (possibleActions.length === 0) {
			return { type: 'endTurn' };
		}

		return this.rng.pick(possibleActions);
	}
}

/**
 * Picks uniformly among every action on offer, ending the turn included,
 * with draws from the stream it's given (AIController forks one per team)
 */
export class RandomAI extends AIPlayer {
	private strategy: RandomAIStrategy;

	constructor({ team, battle, rng }: { team: Team; battle: Battle; rng: Rng }) {
		super(team, battle);
		this.strategy = new RandomAIStrategy({ rng });
	}

	protected chooseAction(): AIDecision | null {
		const gameState = this.evaluateGameState();
		const possibleActions = this.generatePossibleActions();

		if (possibleActions.length === 0) {
			return null;
		}

		return this.strategy.chooseBestAction(possibleActions, gameState);
	}
}
