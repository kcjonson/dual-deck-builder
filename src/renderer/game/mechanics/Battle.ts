import { Team, TeamType } from './Team';
import { Driver } from './Driver';
import { Vehicle } from './Vehicle';
import { Card } from './Card';

/**
 * Battle class representing vehicular combat using the Team system
 * Implements the Symbiotic Driver System with individual driver hands and adrenaline pools
 */
export class Battle {
	private playerTeam: Team;
	private enemyTeam: Team;
	private turn = 1;
	private isPlayerTurn = true;
	private battleOver = false;
	private battleWon = false;

	/**
	 * Create a new battle
	 */
	constructor({
		playerTeam,
		enemyTeam
	}: {
		playerTeam: Team;
		enemyTeam: Team;
	}) {
		this.playerTeam = playerTeam;
		this.enemyTeam = enemyTeam;

		// Validate team types
		if (playerTeam.getType() !== TeamType.PLAYER) {
			throw new Error('Player team must have type PLAYER');
		}
		if (enemyTeam.getType() !== TeamType.ENEMY) {
			throw new Error('Enemy team must have type ENEMY');
		}
	}

	/**
	 * Start the battle
	 */
	public start(): void {
		// Set initiative (players always go first)
		this.playerTeam.setInitiative();
		this.enemyTeam.setInitiative();

		// Draw initial hands for all drivers
		this.playerTeam.drawCardsForAllDrivers(5);
		this.enemyTeam.drawCardsForAllDrivers(5);

		// Refill adrenaline for all drivers
		this.playerTeam.refillAdrenaline();
		this.enemyTeam.refillAdrenaline();

		console.log('Battle started!');
	}

	/**
	 * Get the player team
	 */
	public getPlayerTeam(): Team {
		return this.playerTeam;
	}

	/**
	 * Get the enemy team
	 */
	public getEnemyTeam(): Team {
		return this.enemyTeam;
	}

	/**
	 * Get the current turn number
	 */
	public getTurn(): number {
		return this.turn;
	}

	/**
	 * Check if it's the player's turn
	 */
	public isPlayersTurn(): boolean {
		return this.isPlayerTurn;
	}

	/**
	 * Check if the battle is over
	 */
	public isBattleOver(): boolean {
		return this.battleOver;
	}

	/**
	 * Check if the battle was won by the player
	 */
	public isBattleWon(): boolean {
		return this.battleOver && this.battleWon;
	}

	/**
	 * Play a card from a specific driver's hand
	 */
	public playCard({
		driver,
		cardIndex,
		targetVehicle
	}: {
		driver: Driver;
		cardIndex: number;
		targetVehicle?: Vehicle;
	}): boolean {
		if (!this.isPlayerTurn) {
			console.warn("Cannot play card: not player's turn");
			return false;
		}

		// Validate the driver belongs to the player team
		const playerDrivers = this.playerTeam.getAllDrivers();
		if (!playerDrivers.includes(driver)) {
			console.warn('Driver does not belong to player team');
			return false;
		}

		// Attempt to play the card with cost validation
		const result = driver.playCardWithCost(cardIndex);
		
		if (!result.success) {
			console.warn(`Cannot play card: ${result.reason}`);
			return false;
		}

		const card = result.card!;

		// Apply card effects
		if (targetVehicle) {
			this.applyCardEffects(card, targetVehicle, driver);
		} else {
			// Self-targeting or no target needed
			this.applyCardEffects(card, null, driver);
		}

		// Check if battle is over
		this.checkBattleStatus();

		return true;
	}

	/**
	 * End the player's turn
	 */
	public endPlayerTurn(): void {
		if (!this.isPlayerTurn || this.battleOver) {
			return;
		}

		// Discard hands for all player drivers
		this.playerTeam.discardAllHands();

		// Start enemy turn
		this.isPlayerTurn = false;

		// Process enemy turns
		this.processEnemyTurns();
	}

	/**
	 * Process enemy turns
	 */
	private processEnemyTurns(): void {
		if (this.battleOver) {
			return;
		}

		// Execute AI actions for each enemy driver
		const enemyDrivers = this.enemyTeam.getAliveDrivers();
		
		for (const enemyDriver of enemyDrivers) {
			// Skip if driver can't act (passenger restrictions, etc.)
			if (!enemyDriver.canPlayAttackCards() && this.hasOnlyAttackCards(enemyDriver)) {
				continue;
			}

			// Execute enemy AI action
			this.executeEnemyAction(enemyDriver);

			// Check if battle is over after enemy action
			this.checkBattleStatus();
			if (this.battleOver) {
				return;
			}
		}

		// End enemy turn, start player turn
		this.startPlayerTurn();
	}

	/**
	 * Check if driver only has attack cards
	 */
	private hasOnlyAttackCards(driver: Driver): boolean {
		const hand = driver.getHand();
		return hand.length > 0 && hand.every(card => this.isAttackCard(card));
	}

	/**
	 * Check if a card is an attack card
	 */
	private isAttackCard(card: Card): boolean {
		const effects = card.getEffects();
		return effects.some(effect => 
			effect.type === 'damage' || 
			effect.type === 'ram' ||
			card.getName().toLowerCase().includes('attack') ||
			card.getName().toLowerCase().includes('shot') ||
			card.getName().toLowerCase().includes('ram')
		);
	}

	/**
	 * Execute an enemy's action (AI)
	 */
	private executeEnemyAction(enemyDriver: Driver): void {
		const hand = enemyDriver.getHand();
		if (hand.length === 0) return;

		// Simple AI: play first affordable card
		for (let i = 0; i < hand.length; i++) {
			const card = hand[i];
			
			if (enemyDriver.canPlayCard(card)) {
				// Choose target (for now, target first alive player vehicle)
				const playerVehicles = this.playerTeam.getAliveVehicles();
				const target = playerVehicles.length > 0 ? playerVehicles[0] : null;

				const result = enemyDriver.playCardWithCost(i);
				if (result.success && result.card) {
					this.applyCardEffects(result.card, target, enemyDriver);
					console.log(`${enemyDriver.getName()} plays ${result.card.getName()}`);
				}
				break;
			}
		}
	}

	/**
	 * Start the player's turn
	 */
	private startPlayerTurn(): void {
		// Increment turn counter
		this.turn++;

		// Process status effects for all vehicles
		this.playerTeam.processStatusEffects();
		this.enemyTeam.processStatusEffects();

		// Refill adrenaline for all drivers
		this.playerTeam.refillAdrenaline();
		this.enemyTeam.refillAdrenaline();

		// Draw new hands for all drivers
		this.playerTeam.drawCardsForAllDrivers(5);
		this.enemyTeam.drawCardsForAllDrivers(5);

		// Set turn state
		this.isPlayerTurn = true;

		console.log(`Player turn ${this.turn} started`);
	}

	/**
	 * Apply card effects to a target
	 */
	private applyCardEffects(card: Card, targetVehicle: Vehicle | null, caster: Driver): void {
		// Process each effect on the card
		for (const effect of card.getEffects()) {
			switch (effect.type) {
				case 'damage':
					if (targetVehicle) {
						const damage = effect.value || 0;
						targetVehicle.takeDamage(damage);
						console.log(`${card.getName()} deals ${damage} damage to ${targetVehicle.getName()}`);
						
						// Handle vehicle destruction
						if (!targetVehicle.isAlive()) {
							const owningTeam = this.getTeamForVehicle(targetVehicle);
							if (owningTeam) {
								owningTeam.handleVehicleDestruction(targetVehicle);
							}
						}
					}
					break;

				case 'heal':
					if (targetVehicle) {
						const healValue = effect.value || 0;
						targetVehicle.repair(healValue);
						console.log(`${card.getName()} repairs ${healValue} structure on ${targetVehicle.getName()}`);
					}
					break;

				case 'armor':
					if (targetVehicle) {
						const armorValue = effect.value || 0;
						targetVehicle.addArmor(armorValue);
						console.log(`${card.getName()} adds ${armorValue} armor to ${targetVehicle.getName()}`);
					}
					break;

				case 'draw':
					const drawValue = effect.value || 0;
					caster.drawCards(drawValue);
					console.log(`${card.getName()} draws ${drawValue} cards for ${caster.getName()}`);
					break;

				case 'adrenaline':
					const adrenalineValue = effect.value || 0;
					caster.gainAdrenaline(adrenalineValue);
					console.log(`${card.getName()} gives ${adrenalineValue} adrenaline to ${caster.getName()}`);
					break;

				case 'status':
					if (targetVehicle) {
						const statusName = (effect.description || 'unknown').toLowerCase();
						const statusValue = effect.value || 0;
						const duration = effect.duration || 1;
						
						targetVehicle.applyStatusEffect({
							name: statusName,
							duration: duration,
							value: statusValue,
							description: effect.description
						});
						console.log(`${card.getName()} applies ${statusName} to ${targetVehicle.getName()}`);
					}
					break;

				// Add more effect types as needed
			}
		}
	}

	/**
	 * Get the team that owns a specific vehicle
	 */
	private getTeamForVehicle(vehicle: Vehicle): Team | null {
		if (this.playerTeam.getVehicles().includes(vehicle)) {
			return this.playerTeam;
		}
		if (this.enemyTeam.getVehicles().includes(vehicle)) {
			return this.enemyTeam;
		}
		return null;
	}

	/**
	 * Check if the battle is over
	 */
	private checkBattleStatus(): void {
		// Check if player team is defeated
		if (this.playerTeam.isDefeated()) {
			this.battleOver = true;
			this.battleWon = false;
			console.log('Battle lost: All player drivers defeated');
			return;
		}

		// Check if enemy team is defeated
		if (this.enemyTeam.isDefeated()) {
			this.battleOver = true;
			this.battleWon = true;
			console.log('Battle won: All enemy drivers defeated');
			return;
		}
	}

	/**
	 * Get battle statistics for display
	 */
	public getBattleStats(): {
		turn: number;
		isPlayerTurn: boolean;
		battleOver: boolean;
		battleWon: boolean;
		playerTeam: ReturnType<Team['getCombatStats']>;
		enemyTeam: ReturnType<Team['getCombatStats']>;
	} {
		return {
			turn: this.turn,
			isPlayerTurn: this.isPlayerTurn,
			battleOver: this.battleOver,
			battleWon: this.battleWon,
			playerTeam: this.playerTeam.getCombatStats(),
			enemyTeam: this.enemyTeam.getCombatStats()
		};
	}
}