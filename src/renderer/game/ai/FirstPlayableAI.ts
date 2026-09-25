import { AIPlayer } from './AIPlayer';
import { AIDecision } from './types';

/**
 * Plays the first affordable card in hand order at its first legal target.
 * Raiders use it when no enemy AI type is set.
 */
export class FirstPlayableAI extends AIPlayer {
	protected chooseAction(): AIDecision {
		return this.generatePossibleActions().find(action => action.type === 'playCard') ?? { type: 'endTurn' };
	}
}
