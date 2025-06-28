import { Team, TeamType } from './Team';
import { Driver } from './Driver';
import { Vehicle, VehiclePosition } from './Vehicle';
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

		// Validate target
		if (!this.validateTarget(card, driver, targetVehicle)) {
			console.warn('Invalid target for card');
			// Return card to hand and refund cost
			driver.hand.push(card);
			driver.gainAdrenaline(card.cost);
			return false;
		}

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
					if (targetVehicle && targetVehicle.driver) {
						let damage = typeof effect.value === 'number' ? effect.value : 0;
						
						// Check if attack hits (unless always_hits is true)
						if (!effect.always_hits) {
							const attackType = (typeof effect.attack_type === 'string' ? effect.attack_type : null) || 
								(effect.scaling === 'ramming' ? 'ramming' : 'ranged');
							const hitModifier = typeof effect.hit_modifier === 'number' ? effect.hit_modifier : 0;
							
							if (!this.checkHit(caster, targetVehicle.driver, attackType, hitModifier)) {
								console.log(`${card.displayName} misses ${targetVehicle.name}`);
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
							console.log(`${card.displayName} deals ${damage} damage to ${targetVehicle.driver.metadata.name}`);
						} else if (effect.target === 'self_driver') {
							// Self damage (e.g., Berserker)
							caster.takeDamage(damage);
							console.log(`${card.displayName} deals ${damage} damage to ${caster.metadata.name}`);
						} else {
							// Normal vehicle damage
							targetVehicle.takeDamage(damage);
							console.log(`${card.displayName} deals ${damage} damage to ${targetVehicle.name}`);
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
						targetVehicle.repair(healValue, overflowToArmor);
						console.log(`${card.displayName} repairs ${healValue} structure on ${targetVehicle.name}`);
					}
					break;
					
				case 'heal_driver':
					if (effect.target === 'same_vehicle' && targetVehicle) {
						const casterVehicle = this.getVehicleForDriver(caster);
						if (casterVehicle !== targetVehicle) {
							console.warn('Medical kit can only heal drivers in same vehicle');
							break;
						}
					}
					
					const healValue = typeof effect.value === 'number' ? effect.value : 0;
					if (targetVehicle && targetVehicle.driver) {
						targetVehicle.driver.heal(healValue);
						console.log(`${card.displayName} heals ${healValue} hit points on ${targetVehicle.driver.metadata.name}`);
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
				case 'apply_status':
					if (targetVehicle) {
						// Check condition
						if (effect.condition === 'target_flanking' && targetVehicle.position !== VehiclePosition.FLANKING) {
							break;
						}
						
						// Check if always hits or needs hit check
						if (!effect.always_hits && targetVehicle.driver) {
							if (!this.checkHit(caster, targetVehicle.driver)) {
								console.log(`${card.displayName} misses ${targetVehicle.name}`);
								break;
							}
						}
						
						const statusName = effect.status || (effect.description || 'unknown').toLowerCase();
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
								console.warn('Cannot flank - not faster than all enemies');
								break;
							}
						}
						
						casterVehicle.changePosition(effect.position as VehiclePosition);
						console.log(`${casterVehicle.name} moves to ${effect.position} position`);
					}
					break;
					
				case 'gain_armor':
					if (targetVehicle) {
						const armorValue = typeof effect.value === 'number' ? effect.value : 0;
						targetVehicle.addArmor(armorValue);
						console.log(`${card.displayName} adds ${armorValue} armor to ${targetVehicle.name}`);
					}
					break;
					
				case 'draw_cards': {
					const drawCardsValue = typeof effect.value === 'number' ? effect.value : 0;
					caster.drawCards(drawCardsValue);
					console.log(`${card.displayName} draws ${drawCardsValue} cards for ${caster.metadata.name}`);
					break;
				}
					
				case 'gain_resource':
					if (effect.resource === 'adrenaline') {
						const adrenalineValue = typeof effect.value === 'number' ? effect.value : 0;
						caster.gainAdrenaline(adrenalineValue);
						console.log(`${card.displayName} gives ${adrenalineValue} adrenaline to ${caster.metadata.name}`);
					}
					break;

				// Legacy effect names for compatibility
				case 'armor':
					if (targetVehicle) {
						const armorValue = typeof effect.value === 'number' ? effect.value : 0;
						targetVehicle.addArmor(armorValue);
						console.log(`${card.displayName} adds ${armorValue} armor to ${targetVehicle.name}`);
					}
					break;
					
				case 'draw': {
					const legacyDrawValue = typeof effect.value === 'number' ? effect.value : 0;
					caster.drawCards(legacyDrawValue);
					console.log(`${card.displayName} draws ${legacyDrawValue} cards for ${caster.metadata.name}`);
					break;
				}
					
				case 'adrenaline': {
					const legacyAdrenalineValue = typeof effect.value === 'number' ? effect.value : 0;
					caster.gainAdrenaline(legacyAdrenalineValue);
					console.log(`${card.displayName} gives ${legacyAdrenalineValue} adrenaline to ${caster.metadata.name}`);
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
		if (card.targetType === 'self' || card.targetType === 'both_drivers') {
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
				console.warn(`Target out of range: ${range} > ${maxRange}`);
				return false;
			}
		}

		// Check position restrictions
		for (const effect of card.effects) {
			if (effect.condition === 'target_flanking' && target.position !== VehiclePosition.FLANKING) {
				console.warn('Target must be flanking');
				return false;
			}
			
			// Check same_vehicle restriction for heal_driver
			if (effect.type === 'heal_driver' && effect.target === 'same_vehicle') {
				const casterVehicle = this.getVehicleForDriver(caster);
				if (casterVehicle !== target) {
					console.warn('Can only heal drivers in same vehicle');
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
	 * End combat and process post-combat effects
	 */
	public endCombat(): void {
		// Check flanking vehicles that lost speed
		const allVehicles = [...this.playerTeam.vehicles, ...this.enemyTeam.vehicles];
		allVehicles.forEach(vehicle => {
			if (vehicle.shouldLoseFlanking()) {
				vehicle.changePosition(VehiclePosition.BACK);
				console.log(`${vehicle.name} loses flanking position due to low speed`);
			}
		});

		this.emit('combatEnded', this.getState());
	}
}