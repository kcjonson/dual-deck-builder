import { Card } from '../mechanics/Card';
import { Driver } from '../mechanics/Driver';
import { Vehicle } from '../mechanics/Vehicle';
import { BoardProjection } from '../mechanics/BoardProjection';

/**
 * Speed the AIs treat as fast enough to flank and ram well. It's one more
 * than the Spike Buggy and the Outrider (5), so of the stock vehicles only
 * the Lightning Bike (8) is faster.
 */
export const FAST_VEHICLE_SPEED = 6;

export interface AIDecision {
	type: 'playCard' | 'endTurn';
	card?: Card;
	driver?: Driver;
	target?: Vehicle | Driver;
}

export interface GameStateEvaluation {
	playerTeam: TeamEvaluation;
	enemyTeam: TeamEvaluation;
	currentTurn: number;
	phase: 'player' | 'enemy';
	board: BoardProjection;
}

export interface TeamEvaluation {
	vehicles: VehicleEvaluation[];
	totalHealth: number;
	totalArmor: number;
	totalAdrenaline: number;
	cardsInHand: number;
}

export interface VehicleEvaluation {
	vehicle: Vehicle;
	driver: Driver;
	healthPercent: number;
	armorPercent: number;
	adrenaline: number;
	cardsInHand: number;
	isAlive: boolean;
	isFlanking: boolean;
	speed: number;
}

export interface AIStrategy {
	name: string;
	chooseBestAction(
		possibleActions: AIDecision[],
		gameState: GameStateEvaluation
	): AIDecision;
}