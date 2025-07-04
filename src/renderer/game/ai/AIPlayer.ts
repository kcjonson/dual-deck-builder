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
			driver: driver || ({} as Driver), // Provide empty object as fallback
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

		// First get potential targets based on target type
		let potentialTargets: Vehicle[] = [];
		
		switch (card.targetType) {
			case 'enemy_single':
				const enemyTeam = this.team === this.battle.playerTeam ? 
					this.battle.enemyTeam : this.battle.playerTeam;
				potentialTargets = enemyTeam.vehicles.filter(v => v.isAlive());
				break;
			
			case 'enemy_all':
				// Enemy all cards don't need specific targets - handled by battle system
				break;
			
			case 'ally':
				potentialTargets = this.team.vehicles.filter(v => v.isAlive());
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
					...this.team.vehicles.filter(v => v.isAlive()),
					...(this.team === this.battle.playerTeam ? 
						this.battle.enemyTeam : this.battle.playerTeam).vehicles.filter(v => v.isAlive())
				];
				break;
		}

		// Filter by range if card has damage effects with range requirements
		for (const target of potentialTargets) {
			let inRange = true;
			
			// Check if card has any damage effects with range requirements
			for (const effect of card.effects) {
				if (effect.type === 'damage' && typeof effect.range === 'number') {
					const range = this.battle.calculateRange(sourceVehicle, target);
					if (range > effect.range) {
						inRange = false;
						break;
					}
				}
			}
			
			if (inRange) {
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