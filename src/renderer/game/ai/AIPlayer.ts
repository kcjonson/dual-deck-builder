import { Battle } from '../mechanics/Battle';
import { Team } from '../mechanics/Team';
import { Vehicle } from '../mechanics/Vehicle';
import { Driver } from '../mechanics/Driver';
import { Card, TargetType } from '../mechanics/Card';
import { BoardProjection } from '../mechanics/BoardProjection';
import { preferredTargets } from '../mechanics/RaiderArchetype';
import { AIDecision, GameStateEvaluation, TeamEvaluation, VehicleEvaluation } from './types';

/** Whether a vehicle carries this driver, at the wheel or as a passenger: the vehicle they play from */
export function carriesDriver(vehicle: Vehicle, driver: unknown): boolean {
	return vehicle.driver === driver || vehicle.passenger === driver;
}

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

	/**
	 * Every play the team could make now, each card with each legal target,
	 * then ending the turn. Each living occupant plays from the vehicle they
	 * ride in, a passenger included, so a driver riding in an escort after
	 * their wreck still plays their orders. A raider's plan is its driver's
	 * alone, since the enemy turn plays it as theirs (planEnemyTurn).
	 */
	protected generatePossibleActions(): AIDecision[] {
		const actions: AIDecision[] = [];

		for (const vehicle of this.team.vehicles) {
			if (vehicle.isOutOfFight) continue;
			if (this.board.actor && vehicle !== this.board.actor) continue;

			for (const driver of this.actingOccupants(vehicle)) {
				for (const card of this.board.handOf(driver)) {
					if (!this.canPlay({ driver, card })) continue;

					const validTargets = this.getValidTargets(card, vehicle);
					if (validTargets.length === 0 && this.cardRequiresTarget(card)) {
						continue;
					}

					if (validTargets.length > 0) {
						for (const target of validTargets) {
							actions.push({ type: 'playCard', card, driver, target });
						}
					} else {
						actions.push({ type: 'playCard', card, driver });
					}
				}
			}
		}

		actions.push({ type: 'endTurn' });

		return actions;
	}

	/**
	 * Who plays cards from this vehicle: its living driver and passenger, or
	 * only its driver while a raider plans (see generatePossibleActions)
	 */
	protected actingOccupants(vehicle: Vehicle): Driver[] {
		const occupants = this.board.actor ? [vehicle.driver] : [vehicle.driver, vehicle.passenger];
		return occupants.filter((occupant): occupant is Driver => occupant?.isAlive() ?? false);
	}

	/**
	 * Whether a driver could play this card now on the board being judged:
	 * its cost from their projected adrenaline, no attacks from a passenger,
	 * and the battle's own check on the convoy (a signature card needs a
	 * living escort of its type, Rally the Convoy a ready escort), which
	 * playCard would otherwise refuse
	 */
	protected canPlay({ driver, card }: { driver: Driver; card: Card }): boolean {
		if (this.board.adrenalineOf(driver) < card.cost) return false;
		if (card.isAttack && !driver.canPlayAttackCards()) return false;
		return this.battle.getCardBlocker({ driver, card }) === null;
	}

	/**
	 * The targets the battle's targeting rules accept for this card, narrowed
	 * to the ones a raider's archetype prefers when any of them is legal
	 */
	protected getValidTargets(card: Card, sourceVehicle: Vehicle): Vehicle[] {
		const inFight = (vehicles: readonly Vehicle[]): Vehicle[] => vehicles.filter(vehicle => !vehicle.isOutOfFight);
		const theirs = (): Vehicle[] => inFight((this.team === this.battle.playerTeam ? this.battle.enemyTeam : this.battle.playerTeam).vehicles);
		let potentialTargets: Vehicle[];
		switch (AIPlayer.aimedAt(card.targetType)) {
			case 'theirs':
				potentialTargets = theirs();
				break;
			case 'ours':
				potentialTargets = inFight(this.team.vehicles);
				break;
			case 'escorts':
				potentialTargets = inFight(this.team.escorts);
				break;
			case 'any':
				potentialTargets = [...inFight(this.team.vehicles), ...theirs()];
				break;
			case null:
				potentialTargets = [];
				break;
		}

		const legalTargets = potentialTargets.filter(target =>
			this.board.targetBlocker({ card, caster: sourceVehicle, target }) === null);

		// Archetypes are a raider's; a player vehicle carrying one plans without it
		const archetype = this.team === this.battle.enemyTeam ? sourceVehicle.raiderArchetype : null;
		return preferredTargets({ archetype, card, targets: legalTargets });
	}

	/**
	 * Which vehicles a card of this target type is aimed at: the other side's,
	 * the team's own (an ally card), the team's escorts (a buff order such as
	 * Draw Fire or Close Ranks), or any; null for one the battle aims itself,
	 * at the caster's vehicle or every raider
	 */
	private static aimedAt(targetType: TargetType): 'theirs' | 'ours' | 'escorts' | 'any' | null {
		switch (targetType) {
			case 'enemy_single':
				return 'theirs';
			case 'ally':
				return 'ours';
			case 'escort':
				return 'escorts';
			case 'any':
				return 'any';
			case 'self':
			case 'both_drivers':
			case 'enemy_all':
				return null;
			default: {
				const unknown: never = targetType;
				throw new Error(`Unknown target type ${String(unknown)}`);
			}
		}
	}

	/** A card the player aims, rather than one the battle aims itself */
	protected cardRequiresTarget(card: Card): boolean {
		return AIPlayer.aimedAt(card.targetType) !== null;
	}
}