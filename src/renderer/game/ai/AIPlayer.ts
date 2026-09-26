import { Battle } from '../mechanics/Battle';
import { Team } from '../mechanics/Team';
import { Vehicle } from '../mechanics/Vehicle';
import { Driver } from '../mechanics/Driver';
import { Card } from '../mechanics/Card';
import { BoardProjection } from '../mechanics/BoardProjection';
import { AIDecision, GameStateEvaluation, TeamEvaluation, VehicleEvaluation } from './types';

export abstract class AIPlayer {
	protected team: Team;
	protected battle: Battle;
	/**
	 * The board this decision is made against: the live board, or the enemy
	 * turn planner's projection with earlier planned cards already applied.
	 * AIs read slots, flanks, speed, hands, and adrenaline from here, not
	 * from the vehicles and drivers.
	 */
	protected board!: BoardProjection;

	constructor(team: Team, battle: Battle) {
		this.team = team;
		this.battle = battle;
	}

	/**
	 * Pick the next action. Without a board, decides against the live one.
	 */
	public makeDecision(board: BoardProjection = new BoardProjection({ battle: this.battle })): AIDecision | null {
		this.board = board;
		return this.chooseAction();
	}

	protected abstract chooseAction(): AIDecision | null;

	protected evaluateGameState(): GameStateEvaluation {
		return {
			playerTeam: this.evaluateTeam(this.battle.playerTeam),
			enemyTeam: this.evaluateTeam(this.battle.enemyTeam),
			currentTurn: this.battle.turn,
			phase: this.battle.isPlayerTurn ? 'player' : 'enemy',
			board: this.board
		};
	}

	protected evaluateTeam(team: Team): TeamEvaluation {
		const vehicles = team.vehicles.map(vehicle => this.evaluateVehicle(vehicle));
		
		return {
			vehicles,
			totalHealth: vehicles.reduce((sum, v) => sum + (v.vehicle.structure || 0), 0),
			totalArmor: vehicles.reduce((sum, v) => sum + (v.vehicle.armor || 0), 0),
			totalAdrenaline: vehicles.reduce((sum, v) => sum + (v.adrenaline || 0), 0),
			cardsInHand: vehicles.reduce((sum, v) => sum + (v.cardsInHand || 0), 0)
		};
	}

	protected evaluateVehicle(vehicle: Vehicle): VehicleEvaluation {
		const driver = vehicle.driver;
		const maxStructure = vehicle.maxStructure || 1;
		const maxArmor = vehicle.maxArmor || 0;

		return {
			vehicle,
			driver: driver || ({} as Driver), // Provide empty object as fallback
			healthPercent: (vehicle.structure || 0) / maxStructure,
			armorPercent: maxArmor > 0 ? (vehicle.armor || 0) / maxArmor : 0,
			adrenaline: driver ? this.board.adrenalineOf(driver) : 0,
			cardsInHand: driver ? this.board.handOf(driver).length : 0,
			isAlive: vehicle.isAlive(),
			isFlanking: this.board.isFlanking(vehicle),
			speed: this.board.speedOf(vehicle)
		};
	}

	protected generatePossibleActions(): AIDecision[] {
		const actions: AIDecision[] = [];

		for (const vehicle of this.team.vehicles) {
			if (vehicle.isOutOfFight || !vehicle.driver) continue;
			if (this.board.actor && vehicle !== this.board.actor) continue;

			const driver = vehicle.driver;
			
			for (const card of this.board.handOf(driver)) {
				if (this.board.adrenalineOf(driver) < card.cost) continue;

				const validTargets = this.getValidTargets(card, vehicle);
				
				if (validTargets.length === 0 && this.cardRequiresTarget(card)) {
					continue;
				}

				if (validTargets.length > 0) {
					for (const target of validTargets) {
						actions.push({
							type: 'playCard',
							card,
							driver,
							target
						});
					}
				} else {
					actions.push({
						type: 'playCard',
						card,
						driver
					});
				}
			}
		}

		actions.push({ type: 'endTurn' });

		return actions;
	}

	protected getValidTargets(card: Card, sourceVehicle: Vehicle): (Vehicle | Driver)[] {
		const targets: (Vehicle | Driver)[] = [];

		// First get potential targets based on target type
		let potentialTargets: Vehicle[] = [];
		
		switch (card.targetType) {
			case 'enemy_single':
				const enemyTeam = this.team === this.battle.playerTeam ? 
					this.battle.enemyTeam : this.battle.playerTeam;
				potentialTargets = enemyTeam.vehicles.filter(v => !v.isOutOfFight);
				break;
			
			case 'enemy_all':
				// Enemy all cards don't need specific targets - handled by battle system
				break;
			
			case 'ally':
				potentialTargets = this.team.vehicles.filter(v => !v.isOutOfFight);
				break;
			
			case 'self':
				// Self-targeting cards don't need an explicit target
				// The battle system will handle this automatically
				break;
			
			case 'both_drivers':
				// Both drivers cards don't need an explicit target
				// The battle system will handle this automatically
				break;
				
			case 'any':
				// 'Any' target type means it can target any vehicle
				potentialTargets = [
					...this.team.vehicles.filter(v => !v.isOutOfFight),
					...(this.team === this.battle.playerTeam ?
						this.battle.enemyTeam : this.battle.playerTeam).vehicles.filter(v => !v.isOutOfFight)
				];
				break;
		}

		// Only offer targets the battle's own targeting rules accept
		for (const target of potentialTargets) {
			if (this.board.targetBlocker({ card, caster: sourceVehicle, target }) === null) {
				targets.push(target);
			}
		}

		return targets;
	}

	protected cardRequiresTarget(card: Card): boolean {
		// Only enemy_single, ally and any cards require explicit targets
		// self, both_drivers, and enemy_all are handled automatically by the battle system
		return ['enemy_single', 'ally', 'any'].includes(card.targetType || '');
	}
}