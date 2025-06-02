import { Screen } from '../../core/Screen';
import { Renderer } from '../../../engine/rendering/Renderer';
import { Rectangle } from '../../../engine/components/Rectangle';
import { EnemyLayer, EnemyVehicle } from './EnemyLayer';
import { BattlefieldLayer, PlayerVehicle } from './BattlefieldLayer';
import { PlayerHandLayer } from './PlayerHandLayer';
import { ResourceBarLayer } from './ResourceBarLayer';
import { Driver } from '../../mechanics/Driver';
import { Card } from '../../mechanics/Card';
import { CardLoader } from '../../core/CardLoader';

/**
 * Combat Screen implementing Game Flow Spec section 2
 * Layered implementation with proper coordinate management
 */
export class CombatScreen extends Screen {
	// Layer components
	private enemyLayer!: EnemyLayer;
	private battlefieldLayer!: BattlefieldLayer;
	private handLayer!: PlayerHandLayer;
	private resourceLayer!: ResourceBarLayer;
	
	// Game state
	private playerDrivers: Driver[] = [];
	private playerVehicles: PlayerVehicle[] = [];
	private enemies: EnemyVehicle[] = [];
	private currentAdrenaline: number = 3;
	private maxAdrenaline: number = 3;
	private drawPileCount: number = 10;
	private discardPileCount: number = 0;
	private fuel: number = 5;
	private scrap: number = 150;
	
	// Interaction state
	private selectedCard: Card | null = null;
	private isTargeting: boolean = false;
	
	// Callbacks
	private onEndCombat: ((victory: boolean) => void) | null = null;
	private onBack: (() => void) | null = null;

	/**
	 * Create combat screen
	 */
	constructor(renderer: Renderer) {
		super('combatScreen', renderer);
		
		// Build UI once during construction
		this.createBackground();
		this.createLayers();
		this.setupInteractions();
	}

	/**
	 * Create background
	 */
	private createBackground(): void {
		const background = new Rectangle({
			x: 0,
			y: 0,
			width: window.innerWidth,
			height: window.innerHeight,
			style: {
				backgroundColor: '#1a1a1a', // Dark combat background
			},
		});
		this.rootLayer.addChild(background);
	}

	/**
	 * Create all UI layers with proper positioning
	 */
	private createLayers(): void {
		const screenWidth = window.innerWidth;
		const screenHeight = window.innerHeight;
		
		// Enemy Layer - Top 25%
		const enemyLayerHeight = Math.floor(screenHeight * 0.25);
		this.enemyLayer = new EnemyLayer({
			x: 0,
			y: 0,
			width: screenWidth,
			height: enemyLayerHeight,
		});
		this.rootLayer.addChild(this.enemyLayer);

		// Battlefield Layer - Middle 40%
		const battlefieldLayerHeight = Math.floor(screenHeight * 0.4);
		const battlefieldLayerY = enemyLayerHeight;
		this.battlefieldLayer = new BattlefieldLayer({
			x: 0,
			y: battlefieldLayerY,
			width: screenWidth,
			height: battlefieldLayerHeight,
		});
		this.rootLayer.addChild(this.battlefieldLayer);

		// Hand Layer - Bottom 20%
		const handLayerHeight = Math.floor(screenHeight * 0.2);
		const handLayerY = battlefieldLayerY + battlefieldLayerHeight;
		this.handLayer = new PlayerHandLayer({
			x: 0,
			y: handLayerY,
			width: screenWidth,
			height: handLayerHeight,
		});
		this.rootLayer.addChild(this.handLayer);

		// Resource Layer - Bottom 5%
		const resourceLayerHeight = Math.floor(screenHeight * 0.05);
		const resourceLayerY = handLayerY + handLayerHeight;
		this.resourceLayer = new ResourceBarLayer({
			x: 0,
			y: resourceLayerY,
			width: screenWidth,
			height: resourceLayerHeight,
		});
		this.rootLayer.addChild(this.resourceLayer);
	}

	/**
	 * Set up layer interactions and callbacks
	 */
	private setupInteractions(): void {
		// Hand layer interactions
		this.handLayer.setOnCardHover((card) => {
			// Show card details on hover
			// TODO: Implement card detail popup
		});

		this.handLayer.setOnCardClick((card) => {
			this.onCardClicked(card);
		});

		// Resource layer interactions
		this.resourceLayer.setOnEndTurn(() => {
			this.endPlayerTurn();
		});
	}

	/**
	 * Initialize combat with drivers and enemies
	 */
	public async initializeCombat(drivers: Driver[], enemies: EnemyVehicle[]): Promise<void> {
		this.playerDrivers = drivers;
		this.enemies = enemies;
		
		// Ensure CardLoader is initialized
		const cardLoader = CardLoader.getInstance();
		try {
			await cardLoader.loadCards();
		} catch (error) {
			console.warn('Cards already loaded or error loading:', error);
		}
		
		// Create player vehicles from drivers
		this.playerVehicles = drivers.map(driver => ({
			driver,
			currentHealth: driver.getVehicleStats().maxHealth,
			maxHealth: driver.getVehicleStats().maxHealth,
			armor: driver.getVehicleStats().armor,
			statusEffects: [],
			position: 'front' as const,
		}));

		// Set up layers with initial data
		this.enemyLayer.setEnemies(enemies);
		this.battlefieldLayer.setPlayerVehicles(this.playerVehicles);
		
		// Initialize hand with starting cards
		this.initializePlayerHand();
		
		// Set initial resource values
		this.updateResourceDisplay();

		console.log('Combat initialized with', drivers.length, 'drivers and', enemies.length, 'enemies');
	}

	/**
	 * Initialize player hand with cards from both drivers
	 */
	private initializePlayerHand(): void {
		const handCards: Card[] = [];
		const cardLoader = CardLoader.getInstance();
		
		// Draw initial hand from combined decks
		// For now, show some cards from each driver
		for (const driver of this.playerDrivers) {
			const startingDeckConfig = driver.getStartingDeckConfig();
			
			// Add first 2-3 cards from each driver's deck as initial hand
			let cardCount = 0;
			const maxCardsPerDriver = Math.floor(5 / this.playerDrivers.length) + 1;
			
			for (const cardConfig of startingDeckConfig.cards) {
				if (cardCount >= maxCardsPerDriver) break;
				if (handCards.length >= 5) break; // Max initial hand of 5 cards
				
				const cardInstance = cardLoader.createCard(cardConfig.id);
				if (cardInstance) {
					handCards.push(cardInstance);
					cardCount++;
				}
			}
		}

		console.log(`Initialized hand with ${handCards.length} cards:`, handCards.map(c => c.getName()));
		this.handLayer.setHand(handCards);
		this.handLayer.setAdrenaline(this.currentAdrenaline);
	}

	/**
	 * Handle card click
	 */
	private onCardClicked(card: Card): void {
		// Check if player has enough adrenaline
		if (this.currentAdrenaline < card.getCost()) {
			console.log('Not enough adrenaline to play card');
			return;
		}

		// If already targeting, cancel previous selection
		if (this.isTargeting && this.selectedCard) {
			this.cancelCardSelection();
		}

		// Check if card needs a target
		const targetType = card.getTargetType();
		if (targetType === 'enemy_all' || targetType === 'self' || targetType === 'both_drivers') {
			// No specific target needed, play immediately
			this.playCard(card, null, null);
		} else {
			// Enter targeting mode
			this.selectedCard = card;
			this.isTargeting = true;
			
			// Highlight valid targets
			this.highlightValidTargets(card);
			
			// Set up click handlers for targets
			this.setupTargetingHandlers();
			
			console.log(`Select target for ${card.getName()}`);
		}
	}

	/**
	 * Set up mouse handlers for target selection
	 */
	private setupTargetingHandlers(): void {
		// Register click handlers on enemy and battlefield layers
		// TODO: Add visual indicator that we're in targeting mode
		
		// For now, use a simple document click handler
		const handleClick = (event: MouseEvent) => {
			if (!this.isTargeting || !this.selectedCard) return;
			
			const targetX = event.clientX;
			const targetY = event.clientY;
			
			// Check what was clicked
			const targetedEnemy = this.enemyLayer.getEnemyAtPosition(targetX, targetY);
			const targetedVehicle = this.battlefieldLayer.getVehicleAtPosition(targetX, targetY);
			
			if (this.isValidTarget(this.selectedCard, targetedEnemy, targetedVehicle)) {
				// Valid target - play the card
				this.playCard(this.selectedCard, targetedEnemy, targetedVehicle);
				this.cancelCardSelection();
			} else {
				// Invalid target or clicked elsewhere - cancel selection
				console.log('Invalid target or cancelled');
				this.cancelCardSelection();
			}
			
			// Remove this handler
			document.removeEventListener('click', handleClick);
		};
		
		// Add handler after a small delay to avoid immediate trigger
		setTimeout(() => {
			document.addEventListener('click', handleClick);
		}, 100);
	}

	/**
	 * Cancel card selection and targeting mode
	 */
	private cancelCardSelection(): void {
		this.selectedCard = null;
		this.isTargeting = false;
		this.clearTargetHighlights();
	}

	/**
	 * Highlight valid targets for a card
	 */
	private highlightValidTargets(card: Card): void {
		const targetType = card.getTargetType();
		
		switch (targetType) {
			case 'enemy_single':
			case 'enemy_all':
				// Highlight enemies
				// TODO: Add highlighting to enemy layer
				break;
			case 'self':
			case 'ally':
			case 'both_drivers':
				// Highlight player vehicles
				this.playerVehicles.forEach(vehicle => {
					this.battlefieldLayer.highlightVehicle(vehicle.driver.getId(), '#44aa44');
				});
				break;
			case 'any':
				// Highlight all valid targets
				// TODO: Highlight both enemies and player vehicles
				break;
		}
	}

	/**
	 * Clear all target highlights
	 */
	private clearTargetHighlights(): void {
		this.battlefieldLayer.clearHighlights();
		// TODO: Clear enemy highlights when implemented
	}

	/**
	 * Check if target is valid for card
	 */
	private isValidTarget(card: Card, enemy: EnemyVehicle | null, vehicle: PlayerVehicle | null): boolean {
		const targetType = card.getTargetType();
		
		switch (targetType) {
			case 'enemy_single':
				return enemy !== null;
			case 'enemy_all':
				return true; // Area effect, no specific target needed
			case 'self':
			case 'ally':
			case 'both_drivers':
				return vehicle !== null;
			case 'any':
				return enemy !== null || vehicle !== null;
			default:
				return false;
		}
	}

	/**
	 * Play a card with the given target
	 */
	private playCard(card: Card, targetEnemy: EnemyVehicle | null, targetVehicle: PlayerVehicle | null): void {
		// Check if player has enough adrenaline
		if (this.currentAdrenaline < card.getCost()) {
			console.log('Not enough adrenaline to play card');
			return;
		}

		// Spend adrenaline
		this.currentAdrenaline -= card.getCost();
		
		// Remove card from hand
		this.handLayer.removeCard(card);
		
		// Apply card effects
		this.applyCardEffects(card, targetEnemy, targetVehicle);
		
		// Animate card to discard
		this.discardPileCount++;
		this.handLayer.animateCardToDiscard(card, window.innerWidth - 100, window.innerHeight - 50);
		
		// Update displays
		this.updateResourceDisplay();
		
		console.log(`Played card: ${card.getName()}`);
	}

	/**
	 * Apply card effects to targets
	 */
	private applyCardEffects(card: Card, targetEnemy: EnemyVehicle | null, targetVehicle: PlayerVehicle | null): void {
		const effects = card.getEffects();
		
		for (const effect of effects) {
			switch (effect.type) {
				case 'damage':
					if (targetEnemy && effect.value) {
						this.damageEnemy(targetEnemy, effect.value);
					}
					break;
				case 'heal':
					if (targetVehicle && effect.value) {
						this.healVehicle(targetVehicle, effect.value);
					}
					break;
				case 'gain_armor':
					if (targetVehicle && effect.value) {
						this.addArmor(targetVehicle, effect.value);
					}
					break;
				// TODO: Implement more effect types
			}
		}
	}

	/**
	 * Damage an enemy
	 */
	private damageEnemy(enemy: EnemyVehicle, damage: number): void {
		// Apply damage through armor first
		let remainingDamage = damage;
		
		if (enemy.armor > 0) {
			const armorDamage = Math.min(enemy.armor, remainingDamage);
			enemy.armor -= armorDamage;
			remainingDamage -= armorDamage;
		}
		
		if (remainingDamage > 0) {
			enemy.currentHealth = Math.max(0, enemy.currentHealth - remainingDamage);
		}
		
		// Update enemy display
		this.enemyLayer.updateEnemy(enemy.id, enemy);
		
		// Check if enemy is defeated
		if (enemy.currentHealth <= 0) {
			console.log(`Enemy ${enemy.name} defeated!`);
			this.checkVictoryCondition();
		}
	}

	/**
	 * Heal a player vehicle
	 */
	private healVehicle(vehicle: PlayerVehicle, healing: number): void {
		vehicle.currentHealth = Math.min(vehicle.maxHealth, vehicle.currentHealth + healing);
		this.battlefieldLayer.updatePlayerVehicle(vehicle.driver.getId(), vehicle);
	}

	/**
	 * Add armor to a player vehicle
	 */
	private addArmor(vehicle: PlayerVehicle, armor: number): void {
		vehicle.armor += armor;
		this.battlefieldLayer.updatePlayerVehicle(vehicle.driver.getId(), vehicle);
	}

	/**
	 * End player turn
	 */
	private endPlayerTurn(): void {
		console.log('Ending player turn...');
		
		// Refill adrenaline
		this.currentAdrenaline = this.maxAdrenaline;
		
		// Draw new cards
		// TODO: Implement proper card drawing
		
		// Process enemy turn
		this.processEnemyTurn();
		
		// Update displays
		this.updateResourceDisplay();
	}

	/**
	 * Process enemy turn
	 */
	private processEnemyTurn(): void {
		console.log('Processing enemy turn...');
		
		// TODO: Implement enemy AI and actions
		// For now, just apply some basic enemy actions
		
		for (const enemy of this.enemies) {
			if (enemy.currentHealth <= 0) continue;
			
			// Execute enemy intent
			this.executeEnemyIntent(enemy);
		}
		
		// Check defeat condition
		this.checkDefeatCondition();
	}

	/**
	 * Execute an enemy's intent
	 */
	private executeEnemyIntent(enemy: EnemyVehicle): void {
		switch (enemy.intent.type) {
			case 'attack':
				if (enemy.intent.value) {
					// Attack random player vehicle
					const alivePlayers = this.playerVehicles.filter(v => v.currentHealth > 0);
					if (alivePlayers.length > 0) {
						const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
						this.damagePlayerVehicle(target, enemy.intent.value);
					}
				}
				break;
			case 'defend':
				// Add armor to self
				enemy.armor += 5;
				this.enemyLayer.updateEnemy(enemy.id, enemy);
				break;
			case 'repair':
				// Heal self
				enemy.currentHealth = Math.min(enemy.maxHealth, enemy.currentHealth + 10);
				this.enemyLayer.updateEnemy(enemy.id, enemy);
				break;
		}
		
		// Generate new intent for next turn
		enemy.intent = this.generateRandomIntent();
		this.enemyLayer.updateEnemy(enemy.id, enemy);
	}

	/**
	 * Damage a player vehicle
	 */
	private damagePlayerVehicle(vehicle: PlayerVehicle, damage: number): void {
		let remainingDamage = damage;
		
		// Apply damage through armor first
		if (vehicle.armor > 0) {
			const armorDamage = Math.min(vehicle.armor, remainingDamage);
			vehicle.armor -= armorDamage;
			remainingDamage -= armorDamage;
		}
		
		if (remainingDamage > 0) {
			vehicle.currentHealth = Math.max(0, vehicle.currentHealth - remainingDamage);
		}
		
		this.battlefieldLayer.updatePlayerVehicle(vehicle.driver.getId(), vehicle);
		
		console.log(`${vehicle.driver.getName()} takes ${damage} damage`);
	}

	/**
	 * Generate random enemy intent
	 */
	private generateRandomIntent() {
		const intents = [
			{ type: 'attack' as const, value: Math.floor(Math.random() * 15) + 5, description: 'Attack' },
			{ type: 'defend' as const, description: 'Defend' },
			{ type: 'repair' as const, description: 'Repair' },
		];
		return intents[Math.floor(Math.random() * intents.length)];
	}

	/**
	 * Check victory condition
	 */
	private checkVictoryCondition(): void {
		const aliveEnemies = this.enemies.filter(enemy => enemy.currentHealth > 0);
		if (aliveEnemies.length === 0) {
			console.log('Victory! All enemies defeated!');
			if (this.onEndCombat) {
				this.onEndCombat(true);
			}
		}
	}

	/**
	 * Check defeat condition
	 */
	private checkDefeatCondition(): void {
		const alivePlayers = this.playerVehicles.filter(vehicle => vehicle.currentHealth > 0);
		if (alivePlayers.length === 0) {
			console.log('Defeat! All vehicles destroyed!');
			if (this.onEndCombat) {
				this.onEndCombat(false);
			}
		}
	}

	/**
	 * Update resource display
	 */
	private updateResourceDisplay(): void {
		this.resourceLayer.setAdrenaline(this.currentAdrenaline, this.maxAdrenaline);
		this.resourceLayer.setDrawPileCount(this.drawPileCount);
		this.resourceLayer.setDiscardPileCount(this.discardPileCount);
		this.resourceLayer.setFuel(this.fuel);
		this.resourceLayer.setScrap(this.scrap);
		
		this.handLayer.setAdrenaline(this.currentAdrenaline);
	}

	/**
	 * Set combat end callback
	 */
	public setOnEndCombat(callback: (victory: boolean) => void): void {
		this.onEndCombat = callback;
	}

	/**
	 * Set back callback
	 */
	public setOnBack(callback: () => void): void {
		this.onBack = callback;
	}

	/**
	 * Handle screen mount
	 */
	protected onMount(): void {
		// Restore state if we have data
		if (this.enemies.length > 0) {
			this.enemyLayer.setEnemies(this.enemies);
		}
		if (this.playerVehicles.length > 0) {
			this.battlefieldLayer.setPlayerVehicles(this.playerVehicles);
			this.initializePlayerHand();
		}
		
		this.updateResourceDisplay();
	}

	/**
	 * Handle screen unmount
	 */
	protected onUnmount(): void {
		// Cancel any active targeting
		if (this.isTargeting) {
			this.cancelCardSelection();
		}
	}

	/**
	 * Handle window resize
	 */
	protected onResized(): void {
		// Update layer positions and sizes
		const screenWidth = window.innerWidth;
		const screenHeight = window.innerHeight;
		
		// Update background
		const background = this.rootLayer.getChildren()[0] as Rectangle;
		if (background) {
			background.setSize(screenWidth, screenHeight);
		}
		
		// Update layer sizes and positions
		const enemyLayerHeight = Math.floor(screenHeight * 0.25);
		this.enemyLayer.setPosition(0, 0);
		this.enemyLayer.setSize(screenWidth, enemyLayerHeight);
		
		const battlefieldLayerHeight = Math.floor(screenHeight * 0.4);
		const battlefieldLayerY = enemyLayerHeight;
		this.battlefieldLayer.setPosition(0, battlefieldLayerY);
		this.battlefieldLayer.setSize(screenWidth, battlefieldLayerHeight);
		
		const handLayerHeight = Math.floor(screenHeight * 0.2);
		const handLayerY = battlefieldLayerY + battlefieldLayerHeight;
		this.handLayer.setPosition(0, handLayerY);
		this.handLayer.setSize(screenWidth, handLayerHeight);
		
		const resourceLayerHeight = Math.floor(screenHeight * 0.05);
		const resourceLayerY = handLayerY + handLayerHeight;
		this.resourceLayer.setPosition(0, resourceLayerY);
		this.resourceLayer.setSize(screenWidth, resourceLayerHeight);
		
		// Refresh displays
		if (this.enemies.length > 0) {
			this.enemyLayer.setEnemies(this.enemies);
		}
		if (this.playerVehicles.length > 0) {
			this.battlefieldLayer.setPlayerVehicles(this.playerVehicles);
			this.initializePlayerHand();
		}
		this.updateResourceDisplay();
	}
}