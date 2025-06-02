import { Card } from './Card';
import { Deck } from './Deck';

/**
 * Battle participant type (player or enemy)
 */
export enum BattleEntityType {
	PLAYER = 'player',
	ENEMY = 'enemy',
}

/**
 * Battle entity interface representing a participant in battle
 */
export interface BattleEntity {
	id: string;
	type: BattleEntityType;
	name: string;
	health: number;
	maxHealth: number;
	energy: number;
	maxEnergy: number;
	block: number;
	deck?: Deck;
	hand?: Card[];
	discard?: Card[];
	effects: Map<string, number>; // Effect name -> effect duration/stacks
}

/**
 * Battle class representing a card battle
 */
export class Battle {
	private player: BattleEntity;
	private enemies: BattleEntity[];
	private turn = 1;
	private currentEntityIndex = 0; // 0 for player, 1+ for enemies
	private isPlayerTurn = true;
	private battleOver = false;
	private battleWon = false;

	/**
	 * Create a new battle
	 * @param player Player entity
	 * @param enemies Enemy entities
	 */
	constructor(player: BattleEntity, enemies: BattleEntity[]) {
		this.player = player;
		this.enemies = [...enemies];

		// Initialize player hand and discard pile if they have a deck
		if (this.player.deck) {
			this.player.hand = [];
			this.player.discard = [];
		}
	}

	/**
	 * Start the battle
	 */
	public start(): void {
		// Shuffle player deck
		if (this.player.deck) {
			this.player.deck.shuffle();
		}

		// Draw initial hand
		this.drawPlayerHand(5);

		// Reset energy
		this.player.energy = this.player.maxEnergy;

		console.log('Battle started!');
	}

	/**
	 * Get the current player entity
	 */
	public getPlayer(): BattleEntity {
		return this.player;
	}

	/**
	 * Get all enemy entities
	 */
	public getEnemies(): BattleEntity[] {
		return [...this.enemies];
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
	 * Play a card from the player's hand
	 * @param cardIndex Index of the card in the player's hand
	 * @param targetIndex Index of the target entity (0 for player, 1+ for enemies)
	 * @returns Whether the card was played successfully
	 */
	public playCard(cardIndex: number, targetIndex: number): boolean {
		if (!this.isPlayerTurn) {
			console.warn("Cannot play card: not player's turn");
			return false;
		}

		if (!this.player.hand || cardIndex < 0 || cardIndex >= this.player.hand.length) {
			console.warn('Invalid card index');
			return false;
		}

		const card = this.player.hand[cardIndex];

		// Check if player has enough energy
		if (this.player.energy < card.getCost()) {
			console.warn('Not enough energy to play this card');
			return false;
		}

		// Validate target
		let target: BattleEntity | undefined;
		if (targetIndex === 0) {
			target = this.player;
		} else if (targetIndex > 0 && targetIndex <= this.enemies.length) {
			target = this.enemies[targetIndex - 1];
		}

		if (!target) {
			console.warn('Invalid target');
			return false;
		}

		// Apply card effects
		this.applyCardEffects(card, target);

		// Spend energy
		this.player.energy -= card.getCost();

		// Move card to discard pile
		if (this.player.hand && this.player.discard) {
			this.player.hand.splice(cardIndex, 1);
			this.player.discard.push(card);
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

		// Discard hand
		if (this.player.hand && this.player.discard) {
			this.player.discard.push(...this.player.hand);
			this.player.hand = [];
		}

		// Start enemy turn
		this.isPlayerTurn = false;
		this.currentEntityIndex = 1; // First enemy

		// Process enemy turns
		this.processEnemyTurns();
	}

	/**
	 * Process enemy turns
	 */
	private processEnemyTurns(): void {
		// Check if battle is over
		if (this.battleOver) {
			return;
		}

		// Process each enemy's turn
		for (let i = 0; i < this.enemies.length; i++) {
			const enemy = this.enemies[i];

			// Skip dead enemies
			if (enemy.health <= 0) {
				continue;
			}

			// Execute enemy AI action
			this.executeEnemyAction(enemy);

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
	 * Execute an enemy's action
	 * @param enemy Enemy entity
	 */
	private executeEnemyAction(enemy: BattleEntity): void {
		// This would contain the enemy AI logic
		// For example, the enemy might attack, defend, or use special abilities

		// Example: Simple attack action
		const damage = 5; // This would be determined by the enemy's stats and logic
		this.player.health -= Math.max(0, damage - this.player.block);
		this.player.block = Math.max(0, this.player.block - damage);

		console.log(`${enemy.name} attacks for ${damage} damage!`);
	}

	/**
	 * Start the player's turn
	 */
	private startPlayerTurn(): void {
		// Increment turn counter
		this.turn++;

		// Reset player energy
		this.player.energy = this.player.maxEnergy;

		// Draw new hand
		this.drawPlayerHand(5);

		// Set turn state
		this.isPlayerTurn = true;
		this.currentEntityIndex = 0;

		// Apply ongoing effects (like poison, regeneration, etc.)
		this.applyStatusEffects();

		console.log(`Player turn ${this.turn} started`);
	}

	/**
	 * Draw cards for the player's hand
	 * @param count Number of cards to draw
	 */
	private drawPlayerHand(count: number): void {
		if (!this.player.deck || !this.player.hand || !this.player.discard) {
			return;
		}

		for (let i = 0; i < count; i++) {
			// Try to draw from deck
			const card = this.player.deck.draw();

			if (card) {
				// Successfully drew a card
				this.player.hand.push(card);
			} else {
				// Deck is empty, shuffle discard pile into deck
				if (this.player.discard.length > 0) {
					const discardedCards = [...this.player.discard];
					this.player.discard = [];

					// Add cards back to deck and shuffle
					for (const discardedCard of discardedCards) {
						this.player.deck.addCard(discardedCard);
					}
					this.player.deck.shuffle();

					// Try drawing again
					const reshuffledCard = this.player.deck.draw();
					if (reshuffledCard) {
						this.player.hand.push(reshuffledCard);
					}
				} else {
					// Both deck and discard are empty, can't draw more cards
					break;
				}
			}
		}
	}

	/**
	 * Apply status effects at the start of the turn
	 */
	private applyStatusEffects(): void {
		// Apply effects for player
		this.applyEntityStatusEffects(this.player);

		// Apply effects for enemies
		for (const enemy of this.enemies) {
			this.applyEntityStatusEffects(enemy);
		}
	}

	/**
	 * Apply status effects to an entity
	 * @param entity The entity to apply effects to
	 */
	private applyEntityStatusEffects(entity: BattleEntity): void {
		// Process each effect
		entity.effects.forEach((value, effectName) => {
			switch (effectName) {
				case 'poison':
					// Apply poison damage
					entity.health -= value;
					// Reduce poison by 1
					entity.effects.set(effectName, value - 1);
					console.log(`${entity.name} takes ${value} poison damage`);
					break;

				case 'regeneration':
					// Apply healing
					entity.health = Math.min(entity.health + value, entity.maxHealth);
					// Reduce regeneration by 1
					entity.effects.set(effectName, value - 1);
					console.log(`${entity.name} regenerates ${value} health`);
					break;

				// Add more effects as needed
			}

			// Remove effect if duration is over
			const effectDuration = entity.effects.get(effectName);
			if (effectDuration !== undefined && effectDuration <= 0) {
				entity.effects.delete(effectName);
			}
		});
	}

	/**
	 * Apply card effects to a target
	 * @param card The card being played
	 * @param target The target entity
	 */
	private applyCardEffects(card: Card, target: BattleEntity): void {
		// Process each effect on the card
		for (const effect of card.getEffects()) {
			switch (effect.type) {
				case 'damage':
					// Apply damage to target
					const damage = effect.value || 0;
					target.health -= Math.max(0, damage - target.block);
					target.block = Math.max(0, target.block - damage);
					console.log(`${card.getName()} deals ${damage} damage to ${target.name}`);
					break;

				case 'block':
					// Add block to player
					const blockValue = effect.value || 0;
					this.player.block += blockValue;
					console.log(`${card.getName()} gives ${blockValue} block`);
					break;

				case 'heal':
					// Heal target
					const healValue = effect.value || 0;
					target.health = Math.min(target.health + healValue, target.maxHealth);
					console.log(`${card.getName()} heals ${healValue} health`);
					break;

				case 'draw':
					// Draw cards
					const drawValue = effect.value || 0;
					this.drawPlayerHand(drawValue);
					console.log(`${card.getName()} draws ${drawValue} cards`);
					break;

				case 'energy':
					// Gain energy
					const energyValue = effect.value || 0;
					this.player.energy += energyValue;
					console.log(`${card.getName()} gives ${energyValue} energy`);
					break;

				case 'status':
					// Apply status effect
					const statusName = (effect.description || 'unknown').toLowerCase();
					const statusValue = effect.value || 0;
					const currentValue = target.effects.get(statusName) || 0;
					target.effects.set(statusName, currentValue + statusValue);
					console.log(`${card.getName()} applies ${statusValue} ${statusName} to ${target.name}`);
					break;

				// Add more effect types as needed
			}
		}
	}

	/**
	 * Check if the battle is over
	 */
	private checkBattleStatus(): void {
		// Check if player is defeated
		if (this.player.health <= 0) {
			this.battleOver = true;
			this.battleWon = false;
			console.log('Battle lost: Player defeated');
			return;
		}

		// Check if all enemies are defeated
		const allEnemiesDefeated = this.enemies.every((enemy) => enemy.health <= 0);
		if (allEnemiesDefeated) {
			this.battleOver = true;
			this.battleWon = true;
			console.log('Battle won: All enemies defeated');
			return;
		}
	}
}
