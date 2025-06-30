import { AIDecision } from './types';
import { Battle } from '../mechanics/Battle';
import { Team } from '../mechanics/Team';

/**
 * Represents a node in the Monte Carlo Tree Search
 */
export class MCTSNode {
	public readonly action: AIDecision | null;
	public readonly parent: MCTSNode | null;
	public readonly children: MCTSNode[] = [];
	public readonly team: Team;
	
	private visits = 0;
	private wins = 0;
	private untriedActions: AIDecision[] = [];
	private battleState: Battle | null = null;
	
	constructor({
		action = null,
		parent = null,
		battleState,
		team,
		possibleActions = []
	}: {
		action?: AIDecision | null;
		parent?: MCTSNode | null;
		battleState: Battle;
		team: Team;
		possibleActions?: AIDecision[];
	}) {
		this.action = action;
		this.parent = parent;
		this.battleState = battleState;
		this.team = team;
		this.untriedActions = [...possibleActions];
	}
	
	/**
	 * Get the current battle state
	 */
	get battle(): Battle {
		if (!this.battleState) {
			throw new Error('Battle state not initialized');
		}
		return this.battleState;
	}
	
	/**
	 * Select child node using UCB1 (Upper Confidence Bound)
	 */
	selectChild(explorationConstant = Math.sqrt(2)): MCTSNode {
		if (this.children.length === 0) {
			throw new Error('No children to select from');
		}
		
		let bestChild = this.children[0];
		let bestValue = -Infinity;
		
		for (const child of this.children) {
			const uctValue = child.getUCTValue(explorationConstant);
			if (uctValue > bestValue) {
				bestValue = uctValue;
				bestChild = child;
			}
		}
		
		return bestChild;
	}
	
	/**
	 * Calculate UCT (Upper Confidence Trees) value
	 */
	private getUCTValue(explorationConstant: number): number {
		if (this.visits === 0) {
			return Infinity;
		}
		
		const exploitation = this.wins / this.visits;
		const parentVisits = this.parent ? this.parent.visits : 1;
		const exploration = explorationConstant * Math.sqrt(Math.log(parentVisits) / this.visits);
		
		return exploitation + exploration;
	}
	
	/**
	 * Expand the node by trying an untried action
	 */
	expand(battleClone: Battle, team: Team, possibleActions: AIDecision[]): MCTSNode | null {
		if (this.untriedActions.length === 0) {
			return null;
		}
		
		// Pick a random untried action
		const actionIndex = Math.floor(Math.random() * this.untriedActions.length);
		const action = this.untriedActions.splice(actionIndex, 1)[0];
		
		// Create child node
		const childNode = new MCTSNode({
			action,
			parent: this,
			battleState: battleClone,
			team,
			possibleActions
		});
		
		this.children.push(childNode);
		return childNode;
	}
	
	/**
	 * Update node statistics with simulation result
	 */
	update(result: number): void {
		this.visits++;
		this.wins += result;
	}
	
	/**
	 * Check if node is fully expanded
	 */
	isFullyExpanded(): boolean {
		return this.untriedActions.length === 0;
	}
	
	/**
	 * Check if node is terminal (game over)
	 */
	isTerminal(): boolean {
		return this.battle.battleOver;
	}
	
	/**
	 * Get the best action based on most visits
	 */
	getBestAction(): AIDecision | null {
		if (this.children.length === 0) {
			return null;
		}
		
		let bestChild = this.children[0];
		let mostVisits = bestChild.visits;
		
		for (const child of this.children) {
			if (child.visits > mostVisits) {
				mostVisits = child.visits;
				bestChild = child;
			}
		}
		
		return bestChild.action;
	}
	
	/**
	 * Get win rate for this node
	 */
	getWinRate(): number {
		return this.visits > 0 ? this.wins / this.visits : 0;
	}
	
	/**
	 * Get visit count
	 */
	getVisits(): number {
		return this.visits;
	}
	
	/**
	 * Debug string representation
	 */
	toString(): string {
		const actionStr = this.action ? 
			(this.action.type === 'playCard' ? 
				`Play ${this.action.card?.name}` : 
				'End Turn') : 
			'Root';
		return `${actionStr} (${this.wins}/${this.visits} = ${this.getWinRate().toFixed(2)})`;
	}
}