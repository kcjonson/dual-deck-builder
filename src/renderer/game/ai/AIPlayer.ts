import { Battle } from '../mechanics/Battle';
import { Team } from '../mechanics/Team';
import { Vehicle } from '../mechanics/Vehicle';
import { Driver } from '../mechanics/Driver';
import { Card } from '../mechanics/Card';
import { AIDecision, GameStateEvaluation, TeamEvaluation, VehicleEvaluation } from './types';

export abstract class AIPlayer {
	protected team: Team;
	protected battle: Battle;

	constructor(team: Team, battle: Battle) {
		this.team = team;
		this.battle = battle;
	}

	abstract makeDecision(): Promise<AIDecision | null>;

	protected evaluateGameState(): GameStateEvaluation {
		return {
			playerTeam: this.evaluateTeam(this.battle.playerTeam),
			enemyTeam: this.evaluateTeam(this.battle.enemyTeam),
			currentTurn: this.battle.turn,
			phase: this.battle.isPlayerTurn ? 'player' : 'enemy'
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
			driver: driver!,
			healthPercent: (vehicle.structure || 0) / maxStructure,
			armorPercent: maxArmor > 0 ? (vehicle.armor || 0) / maxArmor : 0,
			adrenaline: driver?.adrenaline || 0,
			cardsInHand: driver?.hand.length || 0,
			isAlive: vehicle.isAlive(),
			position: vehicle.position
		};
	}

	protected generatePossibleActions(): AIDecision[] {
		const actions: AIDecision[] = [];

		for (const vehicle of this.team.vehicles) {
			if (!vehicle.isAlive() || !vehicle.driver) continue;

			const driver = vehicle.driver;
			
			for (const card of driver.hand) {
				if (driver.adrenaline < card.cost) continue;

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

		switch (card.targetType) {
			case 'enemy_single':
				const enemyTeam = this.team === this.battle.playerTeam ? 
					this.battle.enemyTeam : this.battle.playerTeam;
				targets.push(...enemyTeam.vehicles.filter(v => v.isAlive()));
				break;
			
			case 'ally':
				targets.push(...this.team.vehicles.filter(v => v.isAlive()));
				break;
			
			case 'self':
				targets.push(sourceVehicle);
				break;
			
			case 'both_drivers':
				for (const vehicle of this.team.vehicles) {
					if (vehicle.isAlive() && vehicle.driver) {
						targets.push(vehicle.driver);
					}
				}
				break;
		}

		return targets;
	}

	protected cardRequiresTarget(card: Card): boolean {
		return ['enemy_single', 'ally', 'self', 'both_drivers'].includes(card.targetType || '');
	}
}