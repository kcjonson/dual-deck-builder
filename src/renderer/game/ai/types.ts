import { Card } from '../mechanics/Card';
import { Driver } from '../mechanics/Driver';
import { Vehicle } from '../mechanics/Vehicle';
import { BoardProjection } from '../mechanics/BoardProjection';

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