import { Team, TeamType } from './Team';
import { Driver } from './Driver';
import { Vehicle, VehiclePosition } from './Vehicle';
import { Card } from './Card';
import { Model } from '../core/Model';
import { AIController } from '../ai/AIController';

/**
 * Battle log message types
 */
export type BattleMessageType = 
	| 'battle_start'
	| 'turn_start'
	| 'turn_end'
	| 'card_played'
	| 'damage_dealt'
	| 'heal_applied'
	| 'armor_gained'
	| 'status_applied'
	| 'miss'
	| 'battle_end'
	| 'adrenaline_remaining'
	| 'general';

/**
 * Battle log message
 */
export interface BattleMessage {
	type: BattleMessageType;
	message: string;
	timestamp: number;
	turn: number;
	metadata?: {
		driver?: string;
		card?: string;
		target?: string;
		value?: number;
		[key: string]: string | number | undefined;
	};
}

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
	maxTurns?: number;
	battleTied?: boolean;
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
		'battleWon',
		'maxTurns',
		'battleTied'
	]);

	// AI controller for managing computer players (stored separately due to Model freezing)
	private static aiControllers = new WeakMap<Battle, AIController>();
	
	// Battle message log (stored separately due to Model freezing)
	private static messageLogs = new WeakMap<Battle, BattleMessage[]>();
	
	// Static flag to control console logging
	public static suppressConsoleLog = false;

	/**
	 * Create a new battle
	 */
	constructor({
		playerTeam,
		enemyTeam,
		maxTurns
	}: {
		playerTeam: Team;
		enemyTeam: Team;
		maxTurns?: number;
	}) {
		super({
			playerTeam,
			enemyTeam,
			turn: 1,
			isPlayerTurn: true,
			battleOver: false,
			battleWon: false,
			maxTurns,
			battleTied: false
		});

		// Validate team types
		if (playerTeam.type !== TeamType.PLAYER) {
			throw new Error('Player team must have type PLAYER');
		}
		if (enemyTeam.type !== TeamType.ENEMY) {
			throw new Error('Enemy team must have type ENEMY');
		}

		// Initialize AI controller (stored in WeakMap to avoid Model freezing issues)
		Battle.aiControllers.set(this, new AIController(this));
		
		// Initialize message log
		Battle.messageLogs.set(this, []);
	}

	/**
	 * Get the AI controller for this battle
	 */
	public get aiController(): AIController {
		const controller = Battle.aiControllers.get(this);
		if (!controller) {
			throw new Error('AI controller not initialized');
		}
		return controller;
	}

	/**
	 * Log a battle message
	 */
	private log(type: BattleMessageType, message: string, metadata?: BattleMessage['metadata']): void {
		const messageLog = Battle.messageLogs.get(this);
		if (!messageLog) {
			throw new Error('Message log not initialized');
		}

		const logEntry: BattleMessage = {
			type,
			message,
			timestamp: Date.now(),
			turn: this.turn,
			metadata
		};

		messageLog.push(logEntry);

		// Emit the message as an event
		this.emit('battleMessage', Object.freeze(logEntry));

		// Also log to console in development (but not during AI evaluation)
		if (process.env.NODE_ENV !== 'test' && !Battle.suppressConsoleLog) {
			console.log(message);
		}
	}

	/**
	 * Get all battle messages
	 */
	public getMessages(): readonly BattleMessage[] {
		const messageLog = Battle.messageLogs.get(this);
		if (!messageLog) {
			return [];
		}
		return [...messageLog]; // Return a copy
	}

	/**
	 * Get messages of a specific type
	 */
	public getMessagesByType(type: BattleMessageType): readonly BattleMessage[] {
		return this.getMessages().filter(msg => msg.type === type);
	}

	/**
	 * Clear all battle messages
	 */
	public clearMessages(): void {
		const messageLog = Battle.messageLogs.get(this);
		if (messageLog) {
			messageLog.length = 0;
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

		this.log('battle_start', 'Battle started!');
		
		// Log initial team status
		this.logTeamStatus();
		
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
	 * Check if the battle ended in a tie
	 */
	public isBattleTied(): boolean {
		return this.battleOver && (this.battleTied || false);
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
			this.log('general', "Cannot play card: not player's turn");
			return false;
		}

		// Validate the driver belongs to the player team
		const playerDrivers = this.playerTeam.getAllDrivers();
		if (!playerDrivers.includes(driver)) {
			this.log('general', 'Driver does not belong to player team');
			return false;
		}

		// Store adrenaline before playing card
		const adrenalineBefore = driver.adrenaline;
		
		// Attempt to play the card with cost validation
		const result = driver.playCardWithCost(cardIndex);
		
		if (!result.success) {
			this.log('general', `Cannot play card: ${result.reason}`);
			return false;
		}

		const card = result.card;
		if (!card) {
			console.error('Card play succeeded but no card returned');
			return false;
		}

		// Validate target
		if (!this.validateTarget(card, driver, targetVehicle)) {
			this.log('general', `Invalid target for card "${card.name}" (type: ${card.targetType}). Driver: ${this.getDriverDisplayName(driver)}, Target: ${targetVehicle ? targetVehicle.name : 'undefined'}`);
			// Return card to hand and refund cost
			driver.hand.push(card);
			driver.gainAdrenaline(card.cost);
			return false;
		}

		// Log card play with adrenaline info
		this.log('card_played', 
			`${this.getDriverDisplayName(driver)} plays ${card.displayName} (Adrenaline: ${adrenalineBefore} -> ${driver.adrenaline})`,
			{ driver: driver.metadata.name, card: card.displayName, adrenalineBefore, adrenalineAfter: driver.adrenaline }
		);

		// Apply card effects
		if (targetVehicle) {
			this.applyCardEffects(card, targetVehicle, driver);
		} else {
			// Self-targeting or no target needed
			const driverVehicle = this.getVehicleForDriver(driver);
			this.applyCardEffects(card, driverVehicle, driver);
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
	public async endPlayerTurn(): Promise<void> {
		if (!this.isPlayerTurn || this.battleOver) {
			return;
		}

		// Log player hands before discarding
		this.log('general', '=== PLAYER FINAL HANDS ===');
		this.playerTeam.getAllDrivers().forEach(driver => {
			if (driver.isAlive()) {
				const handCards = this.formatHandWithCounts(driver.hand);
				this.log('general', `  ${this.getDriverDisplayName(driver)}: ${handCards}`);
			}
		});

		// Discard hands for all player drivers
		this.playerTeam.discardAllHands();

		// Start enemy turn
		this.isPlayerTurn = false;

		this.log('turn_end', 'Ending player turn');

		// Log leftover adrenaline for player drivers
		const playerDrivers = this.playerTeam.getAllDrivers();
		for (const driver of playerDrivers) {
			if (driver.isAlive() && driver.adrenaline > 0) {
				this.log('adrenaline_remaining', 
					`${this.getDriverDisplayName(driver)} ended turn with ${driver.adrenaline} adrenaline remaining`,
					{ driver: driver.metadata.name, value: driver.adrenaline }
				);
			}
		}

		// Emit turn ended event
		this.emit('turnEnded', Object.freeze({ team: 'player' }));

		// Process enemy turns
		await this.processEnemyTurns();
	}

	/**
	 * Process enemy turns
	 */
	private async processEnemyTurns(): Promise<void> {
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
			await this.executeEnemyAction(enemyDriver);

			// Check if battle is over after enemy action
			this.checkBattleStatus();
			if (this.battleOver) {
				return;
			}
		}

		// Log enemy hands before ending turn
		this.log('general', '=== ENEMY FINAL HANDS ===');
		this.enemyTeam.getAllDrivers().forEach(driver => {
			if (driver.isAlive()) {
				const handCards = this.formatHandWithCounts(driver.hand);
				this.log('general', `  ${this.getDriverDisplayName(driver)}: ${handCards}`);
			}
		});

		this.log('turn_end', 'Ending enemy turn');

		// Log leftover adrenaline for enemy drivers
		const aliveEnemyDrivers = this.enemyTeam.getAllDrivers();
		for (const driver of aliveEnemyDrivers) {
			if (driver.isAlive() && driver.adrenaline > 0) {
				this.log('adrenaline_remaining', 
					`${this.getDriverDisplayName(driver)} ended turn with ${driver.adrenaline} adrenaline remaining`,
					{ driver: driver.metadata.name, value: driver.adrenaline }
				);
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
	private async executeEnemyAction(enemyDriver: Driver): Promise<void> {
		const hand = enemyDriver.hand;
		if (hand.length === 0) return;

		// Use AI controller if available
		if (this.aiController.isEnemyControlledByAI()) {
			// Keep playing cards until AI decides to end turn or can't play any more
			let continuePlayingCards = true;
			while (continuePlayingCards) {
				const decision = await this.aiController.getEnemyDecision();
				
				if (!decision || decision.type === 'endTurn') {
					continuePlayingCards = false;
				} else if (decision.type === 'playCard' && decision.card && decision.driver) {
					// Execute the AI decision directly here
					const cardIndex = decision.driver.hand.indexOf(decision.card);
					if (cardIndex !== -1) {
						const result = decision.driver.playCardWithCost(cardIndex);
						if (result.success && result.card) {
							let targetVehicle: Vehicle | null = null;
							if (decision.target && 'structure' in decision.target) {
								targetVehicle = decision.target as Vehicle;
							}
							const adrenalineBefore = decision.driver.adrenaline + result.card.cost; // Add back cost since it was already spent
							this.applyCardEffects(result.card, targetVehicle, decision.driver);
							this.log('card_played', 
								`${this.getDriverDisplayName(decision.driver)} plays ${result.card.displayName} (Adrenaline: ${adrenalineBefore} -> ${decision.driver.adrenaline})`,
								{ driver: decision.driver.metadata.name, card: result.card.displayName, adrenalineBefore, adrenalineAfter: decision.driver.adrenaline }
							);
						}
					}
					
					// Check if battle ended after the action
					if (this.battleOver) {
						return;
					}
				}
			}
			return;
		}

		// Fallback to simple AI: play all affordable cards
		let playedCard = true;
		while (playedCard && !this.battleOver) {
			playedCard = false;
			
			for (let i = 0; i < enemyDriver.hand.length; i++) {
				const card = enemyDriver.hand[i];
				
				if (enemyDriver.canPlayCard(card)) {
					// Choose target (for now, target first alive player vehicle)
					const playerVehicles = this.playerTeam.getAliveVehicles();
					const target = playerVehicles.length > 0 ? playerVehicles[0] : null;

					const adrenalineBefore = enemyDriver.adrenaline;
					const result = enemyDriver.playCardWithCost(i);
					if (result.success && result.card) {
						this.applyCardEffects(result.card, target, enemyDriver);
						this.log('card_played',
							`${enemyDriver.metadata.name} plays ${result.card.displayName} (Adrenaline: ${adrenalineBefore} -> ${enemyDriver.adrenaline})`,
							{ driver: enemyDriver.metadata.name, card: result.card.displayName, adrenalineBefore, adrenalineAfter: enemyDriver.adrenaline }
						);
						playedCard = true;
						break; // Start from beginning since hand indices changed
					}
				}
			}
		}
	}

	/**
	 * Start the player's turn
	 */
	private startPlayerTurn(): void {
		// Increment turn counter
		this.turn++;

		// Check if max turns exceeded
		if (this.maxTurns && this.turn > this.maxTurns) {
			this.battleOver = true;
			this.battleTied = true;
			this.log('battle_end', 'Battle ended in a tie: Maximum turns exceeded');
			this.emit('battleEnded', Object.freeze({ winner: 'tie', reason: 'maxTurns' }));
			return;
		}

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

		this.log('turn_start', `Player turn ${this.turn} started`, { turn: this.turn });
		
		// Log hands for all drivers
		this.logAllHands();
		
		// Log team status at turn start
		this.logTeamStatus();
	}

	/**
	 * Apply card effects to a target
	 */
	private applyCardEffects(card: Card, targetVehicle: Vehicle | null, caster: Driver): void {
		// Process each effect on the card
		for (const effect of card.effects) {
			switch (effect.type) {
				case 'damage':
					if (targetVehicle && targetVehicle.driver) {
						let damage = typeof effect.value === 'number' ? effect.value : 0;
						
						// Check if attack hits (unless always_hits is true)
						if (!effect.always_hits) {
							const attackType = (typeof effect.attack_type === 'string' ? effect.attack_type : null) || 
								(effect.scaling === 'ramming' ? 'ramming' : 'ranged');
							const hitModifier = typeof effect.hit_modifier === 'number' ? effect.hit_modifier : 0;
							
							if (!this.checkHit(caster, targetVehicle.driver, attackType, hitModifier)) {
								this.log('miss',
									`${card.displayName} misses ${targetVehicle.name}`,
									{ card: card.displayName, target: targetVehicle.name }
								);
								break;
							}
						}
						
						// Calculate formula-based damage
						if (effect.formula && typeof effect.formula === 'string') {
							const casterVehicle = this.getVehicleForDriver(caster);
							if (casterVehicle) {
								damage = this.calculateFormulaDamage(effect.formula, casterVehicle, targetVehicle);
							}
						}
						
						// Apply damage modifiers
						const casterVehicle = this.getVehicleForDriver(caster);
						if (casterVehicle) {
							damage = this.calculateDamage(damage, casterVehicle, targetVehicle);
						}
						
						// Apply damage to specific target
						if (effect.target === 'driver' && targetVehicle.driver) {
							// Direct driver damage (e.g., Headshot)
							targetVehicle.driver.takeDamage(damage);
							this.log('damage_dealt',
								`${card.displayName} deals ${damage} damage to ${this.getDriverDisplayName(targetVehicle.driver)}`,
								{ card: card.displayName, target: targetVehicle.driver.metadata.name, value: damage }
							);
						} else if (effect.target === 'self_driver') {
							// Self damage (e.g., Berserker)
							caster.takeDamage(damage);
							this.log('damage_dealt',
								`${card.displayName} deals ${damage} damage to ${this.getDriverDisplayName(caster)}`,
								{ card: card.displayName, target: caster.metadata.name, value: damage }
							);
						} else {
							// Normal vehicle damage
							const beforeStructure = targetVehicle.structure;
							const beforeArmor = targetVehicle.armor;
							
							// Store driver health before damage
							const beforeDriverHealth = targetVehicle.driver ? targetVehicle.driver.hitpoints : 0;
							const beforePassengerHealth = targetVehicle.passenger ? targetVehicle.passenger.hitpoints : 0;
							
							targetVehicle.takeDamage(damage);
							
							// Calculate damage distribution
							const armorDamage = beforeArmor - targetVehicle.armor;
							const structureDamage = beforeStructure - targetVehicle.structure;
							const driverDamage = targetVehicle.driver ? beforeDriverHealth - targetVehicle.driver.hitpoints : 0;
							const passengerDamage = targetVehicle.passenger ? beforePassengerHealth - targetVehicle.passenger.hitpoints : 0;
							
							// Build damage breakdown message
							let damageBreakdown = `${damage} total`;
							if (armorDamage > 0) {
								damageBreakdown += ` (${armorDamage} to armor`;
								if (structureDamage > 0 || driverDamage > 0 || passengerDamage > 0) {
									damageBreakdown += `, ${structureDamage} to structure`;
									if (driverDamage > 0 || passengerDamage > 0) {
										damageBreakdown += `, ${driverDamage + passengerDamage} to occupants`;
									}
								}
								damageBreakdown += ')';
							} else if (structureDamage > 0 || driverDamage > 0 || passengerDamage > 0) {
								damageBreakdown += ` (${structureDamage} to structure, ${driverDamage + passengerDamage} to occupants)`;
							}
							
							// Show before and after state
							const structureText = `${beforeStructure}/${targetVehicle.maxStructure} -> ${targetVehicle.structure}/${targetVehicle.maxStructure}`;
							const armorText = `${beforeArmor}/${targetVehicle.maxArmor} -> ${targetVehicle.armor}/${targetVehicle.maxArmor}`;
							
							this.log('damage_dealt',
								`${card.displayName} deals ${damageBreakdown} damage to ${targetVehicle.name} (Structure: ${structureText}, Armor: ${armorText})`,
								{ card: card.displayName, target: targetVehicle.name, value: damage }
							);
						}
						
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
						const overflowToArmor = effect.overflow_to_armor === true;
						
						// Store before values
						const beforeStructure = targetVehicle.structure;
						const beforeArmor = targetVehicle.armor;
						
						targetVehicle.repair(healValue, overflowToArmor);
						
						// Calculate actual healing applied
						const structureHealed = targetVehicle.structure - beforeStructure;
						const armorHealed = targetVehicle.armor - beforeArmor;
						
						// Create detailed message showing before and after
						const structureText = `${beforeStructure}/${targetVehicle.maxStructure} -> ${targetVehicle.structure}/${targetVehicle.maxStructure}`;
						const armorText = `${beforeArmor}/${targetVehicle.maxArmor} -> ${targetVehicle.armor}/${targetVehicle.maxArmor}`;
						
						this.log('heal_applied',
							`${card.displayName} repairs ${structureHealed} structure and ${armorHealed} armor on ${targetVehicle.name} (Structure: ${structureText}, Armor: ${armorText})`,
							{ card: card.displayName, target: targetVehicle.name, value: healValue }
						);
					}
					break;
					
				case 'heal_driver':
					if (effect.target === 'same_vehicle' && targetVehicle) {
						const casterVehicle = this.getVehicleForDriver(caster);
						if (casterVehicle !== targetVehicle) {
							this.log('general', 'Medical kit can only heal drivers in same vehicle');
							break;
						}
					}
					
					const healValue = typeof effect.value === 'number' ? effect.value : 0;
					if (targetVehicle && targetVehicle.driver) {
						const beforeHP = targetVehicle.driver.hitpoints;
						const maxHP = targetVehicle.driver.maxHitpoints;
						
						targetVehicle.driver.heal(healValue);
						
						const afterHP = targetVehicle.driver.hitpoints;
						const actualHealed = afterHP - beforeHP;
						const hpText = `${beforeHP}/${maxHP} -> ${afterHP}/${maxHP}`;
						
						this.log('heal_applied',
							`${card.displayName} heals ${actualHealed} hit points on ${this.getDriverDisplayName(targetVehicle.driver)} (HP: ${hpText})`,
							{ card: card.displayName, target: targetVehicle.driver.metadata.name, value: healValue }
						);
					}
					break;

				case 'armor':
					if (targetVehicle) {
						const armorValue = typeof effect.value === 'number' ? effect.value : 0;
						const beforeArmor = targetVehicle.armor;
						
						targetVehicle.addArmor(armorValue);
						
						// Calculate actual armor gained
						const armorGained = targetVehicle.armor - beforeArmor;
						
						// Show before and after armor state
						const armorText = `${beforeArmor}/${targetVehicle.maxArmor} -> ${targetVehicle.armor}/${targetVehicle.maxArmor}`;
						
						this.log('armor_gained',
							`${card.displayName} adds ${armorGained} armor to ${targetVehicle.name} (Armor: ${armorText})`,
							{ card: card.displayName, target: targetVehicle.name, value: armorValue }
						);
					}
					break;

				case 'draw':
					const drawValue = typeof effect.value === 'number' ? effect.value : 0;
					caster.drawCards(drawValue);
					this.log('general',
						`${card.displayName} draws ${drawValue} cards for ${this.getDriverDisplayName(caster)}`,
						{ card: card.displayName, driver: caster.metadata.name, value: drawValue }
					);
					break;

				case 'adrenaline':
					const adrenalineValue = typeof effect.value === 'number' ? effect.value : 0;
					const beforeAdrenaline = caster.adrenaline;
					const maxAdrenaline = caster.maxAdrenaline;
					
					caster.gainAdrenaline(adrenalineValue);
					
					const afterAdrenaline = caster.adrenaline;
					const actualGained = afterAdrenaline - beforeAdrenaline;
					const adrenalineText = `${beforeAdrenaline}/${maxAdrenaline} -> ${afterAdrenaline}/${maxAdrenaline}`;
					
					this.log('general',
						`${card.displayName} gives ${actualGained} adrenaline to ${caster.metadata.name} (Adrenaline: ${adrenalineText})`,
						{ card: card.displayName, driver: caster.metadata.name, value: adrenalineValue }
					);
					break;

				case 'status':
				case 'apply_status':
					if (targetVehicle) {
						// Check condition
						if (effect.condition === 'target_flanking' && targetVehicle.position !== VehiclePosition.FLANKING) {
							break;
						}
						
						// Check if always hits or needs hit check
						if (!effect.always_hits && targetVehicle.driver) {
							if (!this.checkHit(caster, targetVehicle.driver)) {
								this.log('miss',
									`${card.displayName} misses ${targetVehicle.name}`,
									{ card: card.displayName, target: targetVehicle.name }
								);
								break;
							}
						}
						
						const statusName = effect.status || (effect.description || 'unknown').toLowerCase();
						const statusValue = typeof effect.value === 'number' ? effect.value : 0;
						const duration = typeof effect.duration === 'number' ? effect.duration : 1;
						
						// Get speed before applying status for speed-related effects
						const speedBefore = targetVehicle.getTotalSpeed();
						
						targetVehicle.applyStatusEffect({
							name: statusName,
							duration: duration,
							value: statusValue,
							description: effect.description
						});
						
						// Get speed after applying status
						const speedAfter = targetVehicle.getTotalSpeed();
						
						// Create appropriate log message based on status type
						let logMessage = `${card.displayName} applies ${statusName} to ${targetVehicle.name}`;
						
						// Add speed information for speed-related statuses
						if (statusName === 'speed_boost' || statusName === 'nitro_boost' || 
						    statusName === 'speed_reduction' || statusName === 'oil_slick' || 
						    statusName === 'caltrops') {
							logMessage += ` (Speed: ${speedBefore} -> ${speedAfter})`;
						}
						
						this.log('status_applied',
							logMessage,
							{ card: card.displayName, target: targetVehicle.name, status: statusName }
						);
					}
					break;
					
				case 'change_position':
					const casterVehicle = this.getVehicleForDriver(caster);
					if (casterVehicle && effect.position) {
						// Check speed condition for flanking
						if (effect.condition === 'speed_higher' && effect.position === 'flanking') {
							// Need to check against all enemy vehicles
							const casterTeam = this.getTeamForVehicle(casterVehicle);
							const enemyTeam = casterTeam === this.playerTeam ? this.enemyTeam : this.playerTeam;
							const fasterThanAll = enemyTeam.vehicles.every(v => 
								!v.isAlive() || casterVehicle.canFlank(v)
							);
							
							if (!fasterThanAll) {
								this.log('general', 'Cannot flank - not faster than all enemies');
								break;
							}
						}
						
						casterVehicle.changePosition(effect.position as VehiclePosition);
						this.log('general',
							`${casterVehicle.name} moves to ${effect.position} position`,
							{ vehicle: casterVehicle.name, position: String(effect.position) }
						);
					}
					break;
					
				case 'gain_armor':
					if (targetVehicle) {
						const armorValue = typeof effect.value === 'number' ? effect.value : 0;
						const beforeArmor = targetVehicle.armor;
						
						targetVehicle.addArmor(armorValue);
						
						// Calculate actual armor gained
						const armorGained = targetVehicle.armor - beforeArmor;
						
						// Show before and after armor state
						const armorText = `${beforeArmor}/${targetVehicle.maxArmor} -> ${targetVehicle.armor}/${targetVehicle.maxArmor}`;
						
						this.log('armor_gained',
							`${card.displayName} adds ${armorGained} armor to ${targetVehicle.name} (Armor: ${armorText})`,
							{ card: card.displayName, target: targetVehicle.name, value: armorValue }
						);
					}
					break;
					
				case 'draw_cards': {
					const drawCardsValue = typeof effect.value === 'number' ? effect.value : 0;
					caster.drawCards(drawCardsValue);
					this.log('general',
						`${card.displayName} draws ${drawCardsValue} cards for ${this.getDriverDisplayName(caster)}`,
						{ card: card.displayName, driver: caster.metadata.name, value: drawCardsValue }
					);
					break;
				}
					
				case 'gain_resource':
					if (effect.resource === 'adrenaline') {
						const adrenalineValue = typeof effect.value === 'number' ? effect.value : 0;
						const beforeAdrenaline = caster.adrenaline;
						const maxAdrenaline = caster.maxAdrenaline;
						
						caster.gainAdrenaline(adrenalineValue);
						
						const afterAdrenaline = caster.adrenaline;
						const actualGained = afterAdrenaline - beforeAdrenaline;
						const adrenalineText = `${beforeAdrenaline}/${maxAdrenaline} -> ${afterAdrenaline}/${maxAdrenaline}`;
						
						this.log('general',
							`${card.displayName} gives ${actualGained} adrenaline to ${caster.metadata.name} (Adrenaline: ${adrenalineText})`,
							{ card: card.displayName, driver: caster.metadata.name, value: adrenalineValue }
						);
					}
					break;

				// Legacy effect names for compatibility
				case 'armor':
					if (targetVehicle) {
						const armorValue = typeof effect.value === 'number' ? effect.value : 0;
						const beforeArmor = targetVehicle.armor;
						
						targetVehicle.addArmor(armorValue);
						
						// Calculate actual armor gained
						const armorGained = targetVehicle.armor - beforeArmor;
						
						// Show before and after armor state
						const armorText = `${beforeArmor}/${targetVehicle.maxArmor} -> ${targetVehicle.armor}/${targetVehicle.maxArmor}`;
						
						this.log('armor_gained',
							`${card.displayName} adds ${armorGained} armor to ${targetVehicle.name} (Armor: ${armorText})`,
							{ card: card.displayName, target: targetVehicle.name, value: armorValue }
						);
					}
					break;
					
				case 'draw': {
					const legacyDrawValue = typeof effect.value === 'number' ? effect.value : 0;
					caster.drawCards(legacyDrawValue);
					this.log('general',
						`${card.displayName} draws ${legacyDrawValue} cards for ${this.getDriverDisplayName(caster)}`,
						{ card: card.displayName, driver: caster.metadata.name, value: legacyDrawValue }
					);
					break;
				}
					
				case 'adrenaline': {
					const legacyAdrenalineValue = typeof effect.value === 'number' ? effect.value : 0;
					const beforeAdrenaline = caster.adrenaline;
					const maxAdrenaline = caster.maxAdrenaline;
					
					caster.gainAdrenaline(legacyAdrenalineValue);
					
					const afterAdrenaline = caster.adrenaline;
					const actualGained = afterAdrenaline - beforeAdrenaline;
					const adrenalineText = `${beforeAdrenaline}/${maxAdrenaline} -> ${afterAdrenaline}/${maxAdrenaline}`;
					
					this.log('general',
						`${card.displayName} gives ${actualGained} adrenaline to ${caster.metadata.name} (Adrenaline: ${adrenalineText})`,
						{ card: card.displayName, driver: caster.metadata.name, value: legacyAdrenalineValue }
					);
					break;
				}
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
			this.log('battle_end', 'Battle lost: All player drivers defeated');
			this.emit('battleEnded', Object.freeze({ won: false }));
			this.emit('stateChanged', this.getState());
			return;
		}

		// Check if enemy team is defeated
		if (this.enemyTeam.isDefeated()) {
			this.battleOver = true;
			this.battleWon = true;
			this.log('battle_end', 'Battle won: All enemy drivers defeated');
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

	/**
	 * Calculate range between two vehicles based on positions
	 */
	public calculateRange(attacker: Vehicle, target: Vehicle): number {
		// Same team vehicles can't attack each other
		const attackerTeam = this.getTeamForVehicle(attacker);
		const targetTeam = this.getTeamForVehicle(target);
		if (attackerTeam === targetTeam) {
			return 99; // Out of range
		}

		// Check if target team has only one vehicle
		const targetTeamVehicleCount = targetTeam ? targetTeam.getAliveVehicles().length : 0;
		
		if (targetTeamVehicleCount === 1) {
			// When target team has only one vehicle, treat it as occupying the "front" position
			// This makes flanking attacks against a single vehicle require range 2
			if (target.position === VehiclePosition.FRONT) {
				// Single vehicle in front position
				if (attacker.position === VehiclePosition.FRONT) {
					return 1; // Front to Front is adjacent
				} else if (attacker.position === VehiclePosition.FLANKING) {
					return 2; // Flanking to Front requires range 2
				} else {
					return 2; // Back to Front is range 2
				}
			} else if (target.position === VehiclePosition.FLANKING) {
				// Single vehicle in flanking position (less common but possible)
				if (attacker.position === VehiclePosition.FLANKING) {
					return 1; // Flanking to Flanking is adjacent
				} else {
					return 2; // Any other position to Flanking is range 2
				}
			} else {
				// Single vehicle in back position (shouldn't happen normally but handle it)
				if (attacker.position === VehiclePosition.BACK) {
					return 1; // Back to Back is adjacent
				} else if (attacker.position === VehiclePosition.FLANKING) {
					return 1; // Flanking to Back is adjacent
				} else {
					return 2; // Front to Back is range 2
				}
			}
		}

		// Normal multi-vehicle logic
		// Flanking to Back is range 1
		if ((attacker.position === VehiclePosition.FLANKING && target.position === VehiclePosition.BACK) ||
			(attacker.position === VehiclePosition.BACK && target.position === VehiclePosition.FLANKING)) {
			return 1;
		}

		// Flanking to Front is range 2
		if ((attacker.position === VehiclePosition.FLANKING && target.position === VehiclePosition.FRONT) ||
			(attacker.position === VehiclePosition.FRONT && target.position === VehiclePosition.FLANKING)) {
			return 2;
		}

		// Front to Front is range 1
		if (attacker.position === VehiclePosition.FRONT && 
			target.position === VehiclePosition.FRONT) {
			return 1;
		}

		// All other combinations (Front to Back, Back to Front, Back to Back) are range 2
		return 2;
	}

	/**
	 * Check if an attack hits based on skills
	 */
	public checkHit(attacker: Driver, defender: Driver, attackType = 'ranged', modifier = 0): boolean {
		if (attackType === 'ramming') {
			// Ram: attacker ramming >= defender evade
			return attacker.skills.ramming >= defender.skills.evade;
		} else {
			// Ranged: attacker gunnery > defender evade + modifier
			return attacker.skills.gunnery > (defender.skills.evade + modifier);
		}
	}

	/**
	 * Calculate damage with modifiers
	 */
	public calculateDamage(baseDamage: number, attacker: Vehicle, target: Vehicle): number {
		let damage = baseDamage;

		// Apply flanking bonus
		if (attacker.position === VehiclePosition.FLANKING) {
			damage = Math.floor(damage * 1.5); // 50% bonus
		}

		// Apply vulnerable status
		if (target.hasStatusEffect('vulnerable')) {
			damage = Math.floor(damage * 1.5); // 50% bonus
		}

		return damage;
	}

	/**
	 * Calculate formula-based damage (e.g., Ram)
	 */
	private calculateFormulaDamage(formula: string, attacker: Vehicle, target: Vehicle): number {
		// Parse formula like "armor/10 + (speed_diff)"
		let damage = 0;
		
		// Calculate speed difference
		const speedDiff = attacker.getTotalSpeed() - target.getTotalSpeed();
		
		// Simple formula parser for Ram
		if (formula.includes('armor/10')) {
			damage += Math.floor(attacker.armor / 10);
		}
		if (formula.includes('armor/7')) {
			damage += Math.floor(attacker.armor / 7);
		}
		if (formula.includes('speed_diff * 2')) {
			damage += speedDiff * 2;
		} else if (formula.includes('speed_diff')) {
			damage += speedDiff;
		}
		
		return Math.max(0, damage);
	}

	/**
	 * Validate if a target is valid for a card
	 */
	private validateTarget(card: Card, caster: Driver, target: Vehicle | undefined): boolean {
		// Check if card needs a target
		if (card.targetType === 'self' || card.targetType === 'both_drivers' || card.targetType === 'enemy_all') {
			return true; // No external target needed
		}

		if (!target) {
			return false; // Card needs a target but none provided
		}

		// Check range for ranged attacks
		const hasRangeEffect = card.effects.some(e => e.range !== undefined);
		if (hasRangeEffect) {
			const casterVehicle = this.getVehicleForDriver(caster);
			if (!casterVehicle) return false;

			const range = this.calculateRange(casterVehicle, target);
			const ranges = card.effects
				.filter(e => typeof e.range === 'number')
				.map(e => e.range as number);
			const maxRange = ranges.length > 0 ? Math.max(...ranges) : 2;
			
			if (range > maxRange) {
				this.log('general', `Target out of range: ${range} > ${maxRange}`);
				return false;
			}
		}

		// Check position restrictions
		for (const effect of card.effects) {
			if (effect.condition === 'target_flanking' && target.position !== VehiclePosition.FLANKING) {
				this.log('general', 'Target must be flanking');
				return false;
			}
			
			// Check same_vehicle restriction for heal_driver
			if (effect.type === 'heal_driver' && effect.target === 'same_vehicle') {
				const casterVehicle = this.getVehicleForDriver(caster);
				if (casterVehicle !== target) {
					this.log('general', 'Can only heal drivers in same vehicle');
					return false;
				}
			}
		}

		// Check team restrictions
		const casterTeam = this.getTeamForDriver(caster);
		const targetTeam = this.getTeamForVehicle(target);

		switch (card.targetType) {
			case 'enemy_single':
				return targetTeam !== casterTeam;
			case 'ally':
				return targetTeam === casterTeam;
			default:
				// For other target types like 'self', 'both_drivers', 'any', etc.
				return true;
		}
	}

	/**
	 * Get the vehicle that a driver is in
	 */
	private getVehicleForDriver(driver: Driver): Vehicle | null {
		const allVehicles = [...this.playerTeam.vehicles, ...this.enemyTeam.vehicles];
		return allVehicles.find(v => v.driver === driver || v.passenger === driver) || null;
	}

	/**
	 * Get the team that owns a driver
	 */
	private getTeamForDriver(driver: Driver): Team | null {
		if (this.playerTeam.getAllDrivers().includes(driver)) {
			return this.playerTeam;
		}
		if (this.enemyTeam.getAllDrivers().includes(driver)) {
			return this.enemyTeam;
		}
		return null;
	}
	
	/**
	 * Get driver display name with team prefix (e.g., "Player1 Road Warrior")
	 */
	private getDriverDisplayName(driver: Driver): string {
		const team = this.getTeamForDriver(driver);
		if (!team) return driver.metadata.name;
		
		const teamDrivers = team.getAllDrivers();
		const driverIndex = teamDrivers.indexOf(driver) + 1;
		const teamPrefix = team.type === TeamType.PLAYER ? `Player${driverIndex}` : `Enemy${driverIndex}`;
		
		return `${teamPrefix} ${driver.metadata.name}`;
	}

	/**
	 * End combat and process post-combat effects
	 */
	public endCombat(): void {
		// Check flanking vehicles that lost speed
		const allVehicles = [...this.playerTeam.vehicles, ...this.enemyTeam.vehicles];
		allVehicles.forEach(vehicle => {
			if (vehicle.shouldLoseFlanking()) {
				vehicle.changePosition(VehiclePosition.BACK);
				this.log('general',
					`${vehicle.name} loses flanking position due to low speed`,
					{ vehicle: vehicle.name }
				);
			}
		});

		this.emit('combatEnded', this.getState());
	}

	/**
	 * Format a hand of cards with counts for duplicates
	 */
	private formatHandWithCounts(cards: Card[]): string {
		if (cards.length === 0) return 'No cards';
		
		// Count occurrences of each card
		const cardCounts = new Map<string, { card: Card, count: number }>();
		
		for (const card of cards) {
			const key = `${card.name}(${card.cost})`;
			const existing = cardCounts.get(key);
			if (existing) {
				existing.count++;
			} else {
				cardCounts.set(key, { card, count: 1 });
			}
		}
		
		// Format the output
		const formattedCards: string[] = [];
		for (const { card, count } of cardCounts.values()) {
			if (count > 1) {
				formattedCards.push(`${card.name} (${card.cost}) x${count}`);
			} else {
				formattedCards.push(`${card.name} (${card.cost})`);
			}
		}
		
		return formattedCards.join(', ');
	}

	/**
	 * Log the status of all vehicles and drivers
	 */
	private logTeamStatus(): void {
		// Log player team status
		this.log('general', '=== PLAYER TEAM STATUS ===');
		this.playerTeam.vehicles.forEach((vehicle, index) => {
			const structureText = `${vehicle.structure}/${vehicle.maxStructure}`;
			const armorText = `${vehicle.armor}/${vehicle.maxArmor}`;
			let driverInfo = '';
			
			if (vehicle.driver) {
				driverInfo += ` | Driver: ${this.getDriverDisplayName(vehicle.driver)} (${vehicle.driver.hitpoints}/${vehicle.driver.maxHitpoints} HP)`;
			}
			if (vehicle.passenger) {
				driverInfo += ` | Passenger: ${this.getDriverDisplayName(vehicle.passenger)} (${vehicle.passenger.hitpoints}/${vehicle.passenger.maxHitpoints} HP)`;
			}
			
			this.log('general', 
				`  Vehicle ${index + 1}: Structure ${structureText}, Armor ${armorText}${driverInfo}`
			);
		});
		
		// Log enemy team status
		this.log('general', '=== ENEMY TEAM STATUS ===');
		this.enemyTeam.vehicles.forEach((vehicle, index) => {
			const structureText = `${vehicle.structure}/${vehicle.maxStructure}`;
			const armorText = `${vehicle.armor}/${vehicle.maxArmor}`;
			let driverInfo = '';
			
			if (vehicle.driver) {
				driverInfo += ` | Driver: ${this.getDriverDisplayName(vehicle.driver)} (${vehicle.driver.hitpoints}/${vehicle.driver.maxHitpoints} HP)`;
			}
			if (vehicle.passenger) {
				driverInfo += ` | Passenger: ${this.getDriverDisplayName(vehicle.passenger)} (${vehicle.passenger.hitpoints}/${vehicle.passenger.maxHitpoints} HP)`;
			}
			
			this.log('general', 
				`  Vehicle ${index + 1}: Structure ${structureText}, Armor ${armorText}${driverInfo}`
			);
		});
	}

	/**
	 * Log all drivers' hands for debugging
	 */
	private logAllHands(): void {
		// Log player team hands
		this.log('general', '=== PLAYER TEAM HANDS ===');
		this.playerTeam.getAllDrivers().forEach(driver => {
			if (driver.isAlive()) {
				const handCards = this.formatHandWithCounts(driver.hand);
				this.log('general', `  ${this.getDriverDisplayName(driver)}: ${handCards}`);
			}
		});
		
		// Log enemy team hands
		this.log('general', '=== ENEMY TEAM HANDS ===');
		this.enemyTeam.getAllDrivers().forEach(driver => {
			if (driver.isAlive()) {
				const handCards = this.formatHandWithCounts(driver.hand);
				this.log('general', `  ${this.getDriverDisplayName(driver)}: ${handCards}`);
			}
		});
	}
}