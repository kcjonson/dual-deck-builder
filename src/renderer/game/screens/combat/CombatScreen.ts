import { Screen } from '../../core/Screen';
import { Renderer } from '../../../engine/rendering/Renderer';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Arrow } from '../../../engine/components/Arrow';
import { EnemyLayer, EnemyVehicle } from './EnemyLayer';
import { BattlefieldLayer, PlayerVehicle, StatusEffect } from './BattlefieldLayer';
import { PlayerHandLayer } from './PlayerHandLayer';
import { ResourceBarLayer } from './ResourceBarLayer';
import { Driver } from '../../mechanics/Driver';
import { Vehicle } from '../../mechanics/Vehicle';
import { Team, TeamType } from '../../mechanics/Team';
import { Battle } from '../../mechanics/Battle';
import { Card } from '../../mechanics/Card';
import { CardLoader } from '../../core/CardLoader';
import { InputSystem } from '../../../engine/input/InputSystem';
import { Button } from '../../../engine/ui/Button';

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
	
	// Game state using new Team architecture
	private battle: Battle | null = null;
	private playerTeam: Team | null = null;
	private enemyTeam: Team | null = null;
	private fuel: number = 5;
	private scrap: number = 150;
	
	// Interaction state
	private selectedCard: Card | null = null;
	private selectedCardDriver: Driver | null = null; // Which driver is playing the card
	private isTargeting: boolean = false;
	private hoveredTarget: Vehicle | null = null;
	
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
	 * Initialize combat with driver teams and vehicles
	 */
	public async initializeCombat(drivers: Driver[]): Promise<void> {
		if (drivers.length !== 2) {
			throw new Error('Combat requires exactly 2 drivers');
		}

		try {
			// Ensure cards are loaded
			const cardLoader = CardLoader.getInstance();
			await cardLoader.loadCards();
			const availableCards = cardLoader.getAllCards();

			// Create vehicles from driver configurations
			const [driver1, driver2] = drivers;
			
			// Create starting decks for drivers
			driver1.createStartingDeck(cardLoader.getAllCardsAsMap());
			driver2.createStartingDeck(cardLoader.getAllCardsAsMap());
			
			// Create vehicles based on driver configs
			const vehicle1 = this.createVehicleFromDriver(driver1);
			const vehicle2 = this.createVehicleFromDriver(driver2);
			
			// Assign drivers to their vehicles
			vehicle1.setDriver(driver1);
			vehicle2.setDriver(driver2);

			// Create player team
			this.playerTeam = new Team({
				id: 'player_team',
				type: TeamType.PLAYER,
				vehicles: [vehicle1, vehicle2]
			});

			// Create simple enemy team for testing
			this.enemyTeam = this.createTestEnemyTeam();

			// Create battle instance
			this.battle = new Battle({
				playerTeam: this.playerTeam,
				enemyTeam: this.enemyTeam
			});

			// Start the battle
			this.battle.start();

			// Update UI with new data
			this.updateUIFromBattle();

			console.log('Combat initialized with Team system');
		} catch (error) {
			console.error('Failed to initialize combat:', error);
		}
	}

	/**
	 * Create a vehicle from a driver configuration
	 */
	private createVehicleFromDriver(driver: Driver): Vehicle {
		const config = driver.getConfig();
		const vehicleStats = config.vehicleStats;
		
		return new Vehicle({
			id: `${config.id}_vehicle`,
			name: config.metadata.vehicleName,
			armor: vehicleStats.armor,
			structure: vehicleStats.maxHealth,
			speed: vehicleStats.speed
		});
	}

	/**
	 * Create a test enemy team
	 */
	private createTestEnemyTeam(): Team {
		// Create enemy drivers with basic configs
		const enemyDriver1 = new Driver({
			config: {
				id: 'raider' as any, // Using 'raider' for enemy
				metadata: {
					name: 'Wasteland Raider',
					vehicleName: 'Rust Buggy',
					specialty: 'AGGRESSIVE',
					flavorText: 'A dangerous raider',
					unlocked: true
				},
				skills: {
					ramming: 5,
					gunnery: 6,
					evade: 4
				},
				vehicleStats: {
					maxHealth: 30,
					weight: 2,
					armor: 5,
					speed: 3,
					gunnery: 6,
					evade: 4
				},
				startingDeck: {
					cards: [
						{ id: 'ramming_speed', quantity: 2 },
						{ id: 'precision_shot', quantity: 3 }
					]
				}
			}
		});

		// Create starting deck for enemy
		const cardLoader = CardLoader.getInstance();
		enemyDriver1.createStartingDeck(cardLoader.getAllCardsAsMap());

		const enemyVehicle1 = new Vehicle({
			id: 'enemy_vehicle_1',
			name: 'Rust Buggy',
			armor: 5,
			structure: 30,
			speed: 3
		});

		enemyVehicle1.setDriver(enemyDriver1);

		return new Team({
			id: 'enemy_team',
			type: TeamType.ENEMY,
			vehicles: [enemyVehicle1]
		});
	}

	/**
	 * Update UI layers with current battle state
	 */
	private updateUIFromBattle(): void {
		if (!this.battle || !this.playerTeam || !this.enemyTeam) return;

		const battleStats = this.battle.getBattleStats();
		
		// Get both drivers
		const drivers = this.playerTeam.getAllDrivers();
		if (drivers.length >= 2) {
			const [driver1, driver2] = drivers;
			
			// Show combined hand from both drivers
			const combinedHand: Card[] = [...driver1.getHand(), ...driver2.getHand()];
			this.handLayer.setHand(combinedHand);
			
			// Set adrenaline for hand layer (using combined adrenaline for now)
			// TODO: Track which driver owns which card for proper adrenaline checking
			const totalAdrenaline = driver1.getAdrenaline() + driver2.getAdrenaline();
			this.handLayer.setAdrenaline(totalAdrenaline);
			
			// For now, show the first driver's stats in resource bar
			// TODO: Update resource bar to show both drivers' adrenaline
			this.resourceLayer.setAdrenaline(
				driver1.getAdrenaline(),
				driver1.getMaxAdrenaline()
			);
			this.resourceLayer.setFuel(this.fuel);
			this.resourceLayer.setScrap(this.scrap);
			
			// Show combined deck/discard counts
			const deck1 = driver1.getDeck();
			const deck2 = driver2.getDeck();
			const totalDeckCount = (deck1 ? deck1.getCards().length : 0) + (deck2 ? deck2.getCards().length : 0);
			const totalDiscardCount = driver1.getDiscardPile().length + driver2.getDiscardPile().length;
			
			this.resourceLayer.setDrawPileCount(totalDeckCount);
			this.resourceLayer.setDiscardPileCount(totalDiscardCount);
		}

		// Update enemy layer with enemy vehicles
		if (this.enemyTeam) {
			const enemyVehicles = this.enemyTeam.getVehicles();
			const enemyData: EnemyVehicle[] = enemyVehicles.map(vehicle => ({
				id: vehicle.getId(),
				name: vehicle.getName(),
				maxHealth: vehicle.getMaxStructure(),
				currentHealth: vehicle.getStructure(),
				armor: vehicle.getArmor(),
				intent: {
					type: 'attack' as const,
					value: 5,
					description: 'Preparing to attack'
				}
			}));
			this.enemyLayer.setEnemies(enemyData);
		}

		// Update battlefield layer with player vehicles
		if (this.playerTeam) {
			const playerVehicles = this.playerTeam.getVehicles();
			const playerData: PlayerVehicle[] = playerVehicles.map(vehicle => {
				const driver = vehicle.getDriver();
				return {
					driver: driver!,
					currentHealth: vehicle.getStructure(),
					maxHealth: vehicle.getMaxStructure(),
					armor: vehicle.getArmor(),
					statusEffects: [],
					position: 'front' as const
				};
			});
			this.battlefieldLayer.setPlayerVehicles(playerData);
		}
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
	 * Handle card selection using new Team system
	 */
	private onCardSelected(card: Card): void {
		if (!this.battle || !this.playerTeam) {
			console.warn('No battle or player team');
			return;
		}

		// Find which driver owns this card
		const drivers = this.playerTeam.getAllDrivers();
		let owningDriver: Driver | null = null;
		
		for (const driver of drivers) {
			if (driver.getHand().includes(card)) {
				owningDriver = driver;
				break;
			}
		}
		
		if (!owningDriver) {
			console.warn('Could not find driver who owns this card');
			return;
		}

		// Check if driver can afford and play this card
		if (!owningDriver.canPlayCard(card)) {
			const reason = !owningDriver.canAffordCard(card) 
				? `${owningDriver.getName()}: Not enough adrenaline`
				: `${owningDriver.getName()}: Cannot play this card type as passenger`;
			console.log(reason);
			return;
		}

		// If already targeting, cancel previous selection
		if (this.isTargeting && this.selectedCard) {
			this.cancelCardSelection();
		}

		// Store the driver who will play this card
		this.selectedCard = card;
		this.selectedCardDriver = owningDriver;

		// Check if card needs a target
		const targetType = card.getTargetType();
		if (targetType === 'enemy_all' || targetType === 'self' || targetType === 'both_drivers') {
			// No specific target needed, play immediately
			this.playCardWithTarget(card, undefined);
		} else {
			// Enter targeting mode
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
	 * Play a card with the specified target using the new Battle system
	 */
	private playCardWithTarget(card: Card, targetVehicle: Vehicle | undefined): void {
		if (!this.battle || !this.selectedCardDriver) {
			console.warn('Cannot play card: no battle or driver');
			return;
		}

		// Find the card index in the driver's hand
		const hand = this.selectedCardDriver.getHand();
		const cardIndex = hand.findIndex(c => c === card);
		
		if (cardIndex === -1) {
			console.warn('Card not found in driver hand');
			return;
		}

		// Play the card through the battle system
		const success = this.battle.playCard({
			driver: this.selectedCardDriver,
			cardIndex: cardIndex,
			targetVehicle: targetVehicle
		});

		if (success) {
			console.log(`${this.selectedCardDriver.getName()} played ${card.getName()}`);
			
			// Update UI to reflect new state
			this.updateUIFromBattle();
			
			// Check for battle end conditions
			if (this.battle.isBattleOver()) {
				this.handleBattleEnd();
			}
		} else {
			console.warn('Failed to play card');
		}

		// Clear selection state
		this.cancelCardSelection();
	}

	/**
	 * Handle battle end
	 */
	private handleBattleEnd(): void {
		if (!this.battle) return;

		const victory = this.battle.isBattleWon();
		console.log(victory ? 'Victory!' : 'Defeat!');
		
		// Call the end combat callback
		if (this.onEndCombat) {
			this.onEndCombat(victory);
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
		if (this.isTargeting && this.selectedCard === card && this.enemyTeam) {
			// Find the actual Vehicle object from the enemy team
			const targetVehicle = this.enemyTeam.getVehicles().find(v => v.getId() === enemy.id);
			if (targetVehicle) {
				this.playCardWithTarget(card, targetVehicle);
			}
		}
	}

	/**
	 * Handle vehicle being targeted
	 */
	private onVehicleTargeted(card: Card, vehicle: PlayerVehicle): void {
		if (this.isTargeting && this.selectedCard === card && this.playerTeam) {
			// Find the actual Vehicle object from the player team
			const targetVehicle = this.playerTeam.getVehicles().find(v => v.getDriver()?.getId() === vehicle.driver.getId());
			if (targetVehicle) {
				this.playCardWithTarget(card, targetVehicle);
			}
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
	 * TODO: Update to work with new Vehicle class
	 */
	private updateHoveredTarget(enemy: any, vehicle: any): void {
		// Temporarily disabled - needs update for new Vehicle system
		return;
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
		this.selectedCardDriver = null;
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
		
		// TODO: Update to work with new Team/Vehicle system
		// For now, basic highlighting disabled until UI layers are updated
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
	private playCard(card: Card, targetEnemy: any, targetVehicle: any): void {
		// TODO: Remove - replaced by playCardWithTarget
		return;
	}

	/**
	 * Apply card effects to targets
	 */
	private applyCardEffects(card: Card, targetEnemy: any, targetVehicle: any): void {
		// TODO: Remove - replaced by Battle system
		return;
	}

	/**
	 * Damage an enemy
	 */
	private damageEnemy(enemy: any, damage: number): void {
		// TODO: Remove - replaced by Battle system
		return;
	}

	/**
	 * Heal a player vehicle
	 */
	private healVehicle(vehicle: any, healing: number): void {
		// TODO: Remove - replaced by Battle system
		return;
	}

	/**
	 * Add armor to a player vehicle
	 */
	private addArmor(vehicle: any, armor: number): void {
		// TODO: Remove - replaced by Battle system
		return;
	}

	/**
	 * End player turn
	 */
	private endPlayerTurn(): void {
		if (!this.battle) {
			console.warn('Cannot end turn: no battle active');
			return;
		}

		console.log('Ending player turn...');
		
		// End turn through the battle system
		this.battle.endPlayerTurn();
		
		// Update UI to reflect new state
		this.updateUIFromBattle();
		
		// Update displays
		this.updateResourceDisplay();
	}

	/**
	 * Process enemy turn
	 */
	private processEnemyTurn(): void {
		// Enemy turn is now handled by the Battle system
		// This method is no longer needed with the new architecture
		return;
	}

	/**
	 * Execute an enemy's intent
	 * TODO: Remove - replaced by Battle system
	 */
	private executeEnemyIntent(enemy: any): void {
		return;
	}

	/**
	 * Damage a player vehicle
	 * TODO: Remove - replaced by Battle system
	 */
	private damagePlayerVehicle(vehicle: any, damage: number): void {
		return;
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
		// TODO: Update for new Battle system
		return;
	}

	/**
	 * Check defeat condition
	 */
	private checkDefeatCondition(): void {
		// TODO: Update for new Battle system
		return;
	}

	/**
	 * Update resource display
	 */
	private updateResourceDisplay(): void {
		// Now handled by updateUIFromBattle
		this.updateUIFromBattle();
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
		// Update UI from battle state if we have an active battle
		if (this.battle) {
			this.updateUIFromBattle();
		}
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
		
		// Refresh displays from battle state
		if (this.battle) {
			this.updateUIFromBattle();
		}
	}
}