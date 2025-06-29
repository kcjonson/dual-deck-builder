import { Card } from '../mechanics/Card';
import { Driver } from '../mechanics/Driver';
import { Vehicle } from '../mechanics/Vehicle';

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
	position: 'front' | 'back' | 'flanking';
}

export interface AIStrategy {
	name: string;
	chooseBestAction(
		possibleActions: AIDecision[],
		gameState: GameStateEvaluation
	): AIDecision;
}