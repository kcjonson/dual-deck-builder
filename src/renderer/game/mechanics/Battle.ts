import { Team, TeamType } from './Team';
import { Driver } from './Driver';
import { Vehicle } from './Vehicle';
import { Card } from './Card';
import { Model } from '../core/Model';

/**
 * Battle data interface - all properties of a battle
 */
export interface BattleData {
	playerTeam: Team;
	enemyTeam: Team;
	turn: number;
	isPlayerTurn: boolean;
	battleOver: boolean;
	battleWon: boolean;
}

/**
 * Battle state for UI consumption (same as BattleData)
 */
export type BattleState = BattleData;

/**
 * Battle interface for the class
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Battle extends BattleData {}

/**
 * Battle class representing vehicular combat using the Team system
 * Implements the Symbiotic Driver System with individual driver hands and adrenaline pools
 */
export class Battle extends Model<BattleData> {
	// Runtime property list - MUST match BattleData interface
	static properties = new Set<keyof BattleData>([
		'playerTeam',
		'enemyTeam',
		'turn',
		'isPlayerTurn',
		'battleOver',
		'battleWon'
	]);

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
		super({
			playerTeam,
			enemyTeam,
			turn: 1,
			isPlayerTurn: true,
			battleOver: false,
			battleWon: false
		});

		// Validate team types
		if (playerTeam.type !== TeamType.PLAYER) {
			throw new Error('Player team must have type PLAYER');
		}
		if (enemyTeam.type !== TeamType.ENEMY) {
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
		
		// Emit battle started event
		this.emit('battleStarted', this.getState());
	}

	// Model properties are automatically available as:
	// this.playerTeam, this.enemyTeam, this.turn, this.isPlayerTurn, etc.

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

		const card = result.card;
		if (!card) {
			console.error('Card play succeeded but no card returned');
			return false;
		}

		// Apply card effects
		if (targetVehicle) {
			this.applyCardEffects(card, targetVehicle, driver);
		} else {
			// Self-targeting or no target needed
			this.applyCardEffects(card, null, driver);
		}

		// Emit card played event
		this.emit('cardPlayed', Object.freeze({
			driver,
			card,
			targetVehicle
		}));

		// Check if battle is over
		this.checkBattleStatus();

		// Emit state change
		this.emit('stateChanged', this.getState());

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

		// Emit turn ended event
		this.emit('turnEnded', Object.freeze({ team: 'player' }));

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
		const hand = driver.hand;
		return hand.length > 0 && hand.every(card => this.isAttackCard(card));
	}

	/**
	 * Check if a card is an attack card
	 */
	private isAttackCard(card: Card): boolean {
		const effects = card.effects;
		return effects.some(effect => 
			effect.type === 'damage' || 
			effect.type === 'ram' ||
			card.name.toLowerCase().includes('attack') ||
			card.name.toLowerCase().includes('shot') ||
			card.name.toLowerCase().includes('ram')
		);
	}

	/**
	 * Execute an enemy's action (AI)
	 */
	private executeEnemyAction(enemyDriver: Driver): void {
		const hand = enemyDriver.hand;
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
					console.log(`${enemyDriver.metadata.name} plays ${result.card.displayName}`);
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
		for (const effect of card.effects) {
			switch (effect.type) {
				case 'damage':
					if (targetVehicle) {
						const damage = typeof effect.value === 'number' ? effect.value : 0;
						targetVehicle.takeDamage(damage);
						console.log(`${card.displayName} deals ${damage} damage to ${targetVehicle.name}`);
						
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
						const healValue = typeof effect.value === 'number' ? effect.value : 0;
						targetVehicle.repair(healValue);
						console.log(`${card.displayName} repairs ${healValue} structure on ${targetVehicle.name}`);
					}
					break;

				case 'armor':
					if (targetVehicle) {
						const armorValue = typeof effect.value === 'number' ? effect.value : 0;
						targetVehicle.addArmor(armorValue);
						console.log(`${card.displayName} adds ${armorValue} armor to ${targetVehicle.name}`);
					}
					break;

				case 'draw':
					const drawValue = typeof effect.value === 'number' ? effect.value : 0;
					caster.drawCards(drawValue);
					console.log(`${card.displayName} draws ${drawValue} cards for ${caster.metadata.name}`);
					break;

				case 'adrenaline':
					const adrenalineValue = typeof effect.value === 'number' ? effect.value : 0;
					caster.gainAdrenaline(adrenalineValue);
					console.log(`${card.displayName} gives ${adrenalineValue} adrenaline to ${caster.metadata.name}`);
					break;

				case 'status':
					if (targetVehicle) {
						const statusName = (effect.description || 'unknown').toLowerCase();
						const statusValue = typeof effect.value === 'number' ? effect.value : 0;
						const duration = typeof effect.duration === 'number' ? effect.duration : 1;
						
						targetVehicle.applyStatusEffect({
							name: statusName,
							duration: duration,
							value: statusValue,
							description: effect.description
						});
						console.log(`${card.displayName} applies ${statusName} to ${targetVehicle.name}`);
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
		if (this.playerTeam.vehicles.includes(vehicle)) {
			return this.playerTeam;
		}
		if (this.enemyTeam.vehicles.includes(vehicle)) {
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
			this.emit('battleEnded', Object.freeze({ won: false }));
			this.emit('stateChanged', this.getState());
			return;
		}

		// Check if enemy team is defeated
		if (this.enemyTeam.isDefeated()) {
			this.battleOver = true;
			this.battleWon = true;
			console.log('Battle won: All enemy drivers defeated');
			this.emit('battleEnded', Object.freeze({ won: true }));
			this.emit('stateChanged', this.getState());
			return;
		}
	}

	/**
	 * Get battle statistics for display with formatted team data
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

	// getState() is provided by Model base class
}