import { Battle } from './renderer/game/mechanics/Battle';
import { Driver } from './renderer/game/mechanics/Driver';
import { Card } from './renderer/game/mechanics/Card';
import { Vehicle } from './renderer/game/mechanics/Vehicle';

/**
 * Interface for managing human player interaction with the battle system
 */
interface PlayerDecision {
	type: 'playCard' | 'endTurn';
	driver?: Driver;
	card?: Card;
	target?: Vehicle;
}

export class HumanPlayerInterface {
	private battle: Battle;
	private playerDecisionCallback: ((decision: PlayerDecision) => void) | null = null;
	private waitingForDecision = false;
	
	constructor(battle: Battle) {
		this.battle = battle;
	}
	
	/**
	 * Request a decision from the human player
	 * Returns a promise that resolves when the player makes a decision
	 */
	async requestDecision(): Promise<PlayerDecision> {
		return new Promise((resolve) => {
			this.waitingForDecision = true;
			this.playerDecisionCallback = resolve;
			
			// Update UI to show it's the player's turn
			this.updateUIForPlayerTurn();
		});
	}
	
	/**
	 * Handle when a player selects a card to play
	 */
	public selectCard(driver: Driver, cardIndex: number): void {
		if (!this.waitingForDecision) {
			console.log('Not waiting for decision, ignoring card selection');
			return;
		}
		
		const card = driver.hand[cardIndex];
		if (!card) {
			console.error('Card not found at index:', cardIndex);
			return;
		}
		
		console.log('Card selected:', card.displayName, 'Target type:', card.targetType);
		
		// Check if card needs a target
		if (this.needsTarget(card)) {
			// Show target selection UI
			this.showTargetSelection(driver, card);
		} else {
			// Play card without target
			this.makeDecision({
				type: 'playCard',
				driver,
				card,
				target: undefined
			});
			
			// Trigger UI refresh after playing card
			setTimeout(() => {
				this.updateUIForPlayerTurn();
			}, 100);
		}
	}
	
	/**
	 * Handle when a player selects a target
	 */
	public selectTarget(driver: Driver, card: Card, target: Vehicle): void {
		if (!this.waitingForDecision) return;
		
		this.makeDecision({
			type: 'playCard',
			driver,
			card,
			target
		});
	}
	
	/**
	 * Handle when player ends their turn
	 */
	public endTurn(): void {
		if (!this.waitingForDecision) return;
		
		this.makeDecision({
			type: 'endTurn'
		});
	}
	
	/**
	 * Make a decision and resolve the promise
	 */
	private makeDecision(decision: PlayerDecision): void {
		if (this.playerDecisionCallback) {
			this.waitingForDecision = false;
			const callback = this.playerDecisionCallback;
			this.playerDecisionCallback = null;
			callback(decision);
		}
	}
	
	/**
	 * Check if a card needs a target
	 */
	private needsTarget(card: Card): boolean {
		// Cards that target self or both drivers don't need manual target selection
		return card.targetType === 'enemy_single' || card.targetType === 'enemy_all' || 
		       card.targetType === 'ally' || card.targetType === 'any';
	}
	
	/**
	 * Update UI to show it's the player's turn
	 */
	private updateUIForPlayerTurn(): void {
		// This will be called from the UI layer
		const event = new CustomEvent('playerTurnStart', {
			detail: {
				playerTeam: this.battle.playerTeam,
				enemyTeam: this.battle.enemyTeam
			}
		});
		window.dispatchEvent(event);
	}
	
	/**
	 * Show target selection UI
	 */
	private showTargetSelection(driver: Driver, card: Card): void {
		const validTargets = this.getValidTargets(card, driver);
		
		const event = new CustomEvent('showTargetSelection', {
			detail: {
				driver,
				card,
				validTargets
			}
		});
		window.dispatchEvent(event);
	}
	
	/**
	 * Get valid targets for a card
	 */
	private getValidTargets(card: Card, driver: Driver): Vehicle[] {
		const validTargets: Vehicle[] = [];
		
		// Get the caster's vehicle
		const casterVehicle = this.getVehicleForDriver(driver);
		if (!casterVehicle) return validTargets;
		
		// Get potential targets based on target type
		let potentialTargets: Vehicle[] = [];
		
		switch (card.targetType) {
			case 'enemy_single':
			case 'enemy_all':
				potentialTargets = this.battle.enemyTeam.getAliveVehicles();
				break;
			case 'ally':
				potentialTargets = this.battle.playerTeam.getAliveVehicles();
				break;
			case 'any':
				potentialTargets = [
					...this.battle.playerTeam.getAliveVehicles(),
					...this.battle.enemyTeam.getAliveVehicles()
				];
				break;
		}
		
		// Filter by range if any damage effects have range requirements
		for (const target of potentialTargets) {
			let inRange = true;
			
			// Check if card has any damage effects with range requirements
			for (const effect of card.effects) {
				if (effect.type === 'damage' && typeof effect.range === 'number') {
					const range = this.battle.calculateRange(casterVehicle, target);
					if (range > effect.range) {
						inRange = false;
						break;
					}
				}
			}
			
			if (inRange) {
				validTargets.push(target);
			}
		}
		
		return validTargets;
	}
	
	/**
	 * Get the vehicle containing a driver
	 */
	private getVehicleForDriver(driver: Driver | null): Vehicle | null {
		if (!driver) return null;
		
		const allVehicles = [
			...this.battle.playerTeam.getAliveVehicles(),
			...this.battle.enemyTeam.getAliveVehicles()
		];
		
		return allVehicles.find(v => v.driver === driver || v.passenger === driver) || null;
	}
	
	/**
	 * Get the current game state for UI display
	 */
	public getGameState() {
		return {
			turn: this.battle.turn,
			isPlayerTurn: this.battle.isPlayerTurn,
			playerTeam: this.battle.playerTeam,
			enemyTeam: this.battle.enemyTeam,
			waitingForDecision: this.waitingForDecision
		};
	}
}