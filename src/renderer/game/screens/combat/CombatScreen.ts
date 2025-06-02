import { Screen } from '../../core/Screen';
import { Renderer } from '../../../engine/rendering/Renderer';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Arrow } from '../../../engine/components/Arrow';
import { EnemyLayer, EnemyVehicle } from './EnemyLayer';
import { BattlefieldLayer, PlayerVehicle } from './BattlefieldLayer';
import { PlayerHandLayer } from './PlayerHandLayer';
import { ResourceBarLayer } from './ResourceBarLayer';
import { Driver } from '../../mechanics/Driver';
import { Card } from '../../mechanics/Card';
import { CardLoader } from '../../core/CardLoader';
import { InputSystem } from '../../../engine/input/InputSystem';

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
	private hoveredTarget: EnemyVehicle | PlayerVehicle | null = null;
	
	// Targeting visual components
	private targetingArrow: Arrow;
	
	// Callbacks
	private onEndCombat: ((victory: boolean) => void) | null = null;
	private onBack: (() => void) | null = null;

	/**
	 * Create combat screen
	 */
	constructor(renderer: Renderer) {
		super('combatScreen', renderer);
		
		// Create targeting arrow (hidden initially)
		this.targetingArrow = new Arrow({
			color: '#00aaff',
			lineWidth: 3,
			arrowHeadSize: 12,
		});
		this.targetingArrow.hide();
		
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

		// Use semantic events for card interactions
		this.handLayer.setOnCardSelect((card) => {
			this.onCardSelected(card);
		});

		// Resource layer interactions
		this.resourceLayer.setOnEndTurn(() => {
			this.endPlayerTurn();
		});

		// Add targeting arrow to screen (on top of everything)
		this.rootLayer.addChild(this.targetingArrow);

		// Set up keyboard handler for ESC key during targeting
		InputSystem.registerKeyDown(this.rootLayer, (key: string) => {
			if (key === 'Escape' && this.isTargeting) {
				this.cancelCardSelection();
			}
		});

		// Set up global click handler for targeting cancellation
		InputSystem.registerMouseDown(this.rootLayer, () => {
			if (this.isTargeting && this.selectedCard) {
				// If we're targeting and click somewhere that doesn't handle targeting,
				// cancel the targeting mode
				setTimeout(() => {
					if (this.isTargeting) {
						console.log('Cancelled targeting - clicked empty space');
						this.cancelCardSelection();
					}
				}, 10); // Small delay to let target handlers run first
			}
		});
	}

	/**
	 * Handle screen updates
	 */
	protected onUpdate(dt: number): void {
		super.onUpdate(dt);

		// Handle targeting arrow updates during mouse movement
		if (this.isTargeting && this.selectedCard) {
			const mousePos = InputSystem.getMousePosition();
			this.updateTargetingArrow(mousePos.x, mousePos.y);
		}
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
	 * Handle card selection
	 */
	private onCardSelected(card: Card): void {
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
			
			// Update hand layer to show selection state
			this.handLayer.setCardSelected(card);
			this.handLayer.setTargetingMode(true);
			
			// Set up target handlers
			this.setupTargetHandlers(card);
			
			// Highlight valid targets
			this.highlightValidTargets(card);
			
			console.log(`Select target for ${card.getName()}`);
		}
	}

	/**
	 * Set up target handlers for the current card
	 */
	private setupTargetHandlers(card: Card): void {
		const targetType = card.getTargetType();
		
		// Set up enemy targeting
		if (targetType === 'enemy_single' || targetType === 'any') {
			this.enemyLayer.setOnTarget((enemy) => {
				this.onEnemyTargeted(card, enemy);
			});
		}
		
		// Set up vehicle targeting
		if (targetType === 'self' || targetType === 'ally' || targetType === 'any') {
			this.battlefieldLayer.setOnTarget((vehicle) => {
				this.onVehicleTargeted(card, vehicle);
			});
		}
	}

	/**
	 * Handle enemy being targeted
	 */
	private onEnemyTargeted(card: Card, enemy: EnemyVehicle): void {
		if (this.isTargeting && this.selectedCard === card) {
			this.playCard(card, enemy, null);
			this.cancelCardSelection();
		}
	}

	/**
	 * Handle vehicle being targeted
	 */
	private onVehicleTargeted(card: Card, vehicle: PlayerVehicle): void {
		if (this.isTargeting && this.selectedCard === card) {
			this.playCard(card, null, vehicle);
			this.cancelCardSelection();
		}
	}

	/**
	 * Handle targeting arrow updates during mouse movement
	 */
	private updateTargetingArrow(mouseX: number, mouseY: number): void {
		if (!this.selectedCard || !this.isTargeting) {
			this.targetingArrow.hide();
			return;
		}

		// Get the center position of the selected card in the hand
		const selectedCardElement = this.handLayer.getCardElementByCard(this.selectedCard);
		if (!selectedCardElement) {
			this.targetingArrow.hide();
			return;
		}

		// Get global position of selected card center
		const cardGlobalPos = this.handLayer.localToGlobal(
			selectedCardElement.getX() + selectedCardElement.getWidth() / 2,
			selectedCardElement.getY() + selectedCardElement.getHeight() / 2
		);

		// Check for valid targets under mouse
		const targetedEnemy = this.enemyLayer.getEnemyAtPosition(mouseX, mouseY);
		const targetedVehicle = this.battlefieldLayer.getVehicleAtPosition(mouseX, mouseY);

		// Update hovered target and highlighting
		this.updateHoveredTarget(targetedEnemy, targetedVehicle);

		// Set arrow color based on target validity
		const isValidTarget = this.isValidTarget(this.selectedCard, targetedEnemy, targetedVehicle);
		this.targetingArrow.setColor(isValidTarget ? '#00ff00' : '#ff6666');

		// Draw arrow from card to mouse position
		this.targetingArrow.setPoints(cardGlobalPos.x, cardGlobalPos.y, mouseX, mouseY);
	}

	/**
	 * Update the currently hovered target and highlighting
	 */
	private updateHoveredTarget(enemy: EnemyVehicle | null, vehicle: PlayerVehicle | null): void {
		// Clear previous highlights
		if (this.hoveredTarget) {
			if ('intent' in this.hoveredTarget) {
				// It's an enemy
				this.enemyLayer.highlightEnemy(null);
			} else {
				// It's a player vehicle - clear all highlights
				this.battlefieldLayer.clearHighlights();
			}
		}

		// Set new hovered target
		this.hoveredTarget = enemy || vehicle || null;

		// Apply new highlights
		if (this.hoveredTarget) {
			if ('intent' in this.hoveredTarget) {
				// Highlight enemy
				this.enemyLayer.highlightEnemy(this.hoveredTarget.id);
			} else {
				// Highlight player vehicle
				this.battlefieldLayer.highlightVehicle(this.hoveredTarget.driver.getId(), '#44aa44');
			}
		}
	}

	/**
	 * Handle click during targeting mode
	 */
	public handleTargetClick(mouseX: number, mouseY: number): void {
		if (!this.isTargeting || !this.selectedCard) return;

		// Check what was clicked
		const targetedEnemy = this.enemyLayer.getEnemyAtPosition(mouseX, mouseY);
		const targetedVehicle = this.battlefieldLayer.getVehicleAtPosition(mouseX, mouseY);

		if (this.isValidTarget(this.selectedCard, targetedEnemy, targetedVehicle)) {
			// Valid target - play the card
			this.playCard(this.selectedCard, targetedEnemy, targetedVehicle);
		} else {
			// Invalid target or clicked elsewhere - cancel selection
			console.log('Invalid target or cancelled targeting');
		}

		this.cancelCardSelection();
	}

	/**
	 * Cancel card selection and targeting mode
	 */
	private cancelCardSelection(): void {
		this.selectedCard = null;
		this.isTargeting = false;
		this.hoveredTarget = null;

		// Hide targeting arrow
		this.targetingArrow.hide();

		// Clear hand selection state
		this.handLayer.clearCardSelection();

		// Clear target callbacks
		this.enemyLayer.setOnTarget(null);
		this.battlefieldLayer.setOnTarget(null);

		// Clear all highlights
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
				// Visual cue that enemies are targetable (no pre-highlighting)
				// Highlighting will happen on hover via updateHoveredTarget
				break;
			case 'self':
			case 'ally':
			case 'both_drivers':
				// Pre-highlight valid friendly vehicles
				this.playerVehicles.forEach(vehicle => {
					this.battlefieldLayer.highlightVehicle(vehicle.driver.getId(), '#44aa44');
				});
				break;
			case 'any':
				// Pre-highlight all valid targets
				this.playerVehicles.forEach(vehicle => {
					this.battlefieldLayer.highlightVehicle(vehicle.driver.getId(), '#44aa44');
				});
				// Enemies will be highlighted on hover
				break;
		}
	}

	/**
	 * Clear all target highlights
	 */
	private clearTargetHighlights(): void {
		this.battlefieldLayer.clearHighlights();
		this.enemyLayer.clearHighlights();
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
		
		// Only update layers if they exist (screen is fully initialized)
		if (!this.enemyLayer || !this.battlefieldLayer || !this.handLayer || !this.resourceLayer) {
			return;
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