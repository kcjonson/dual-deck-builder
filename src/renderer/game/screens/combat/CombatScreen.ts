import { Screen } from '../../core/Screen';
import { Renderer } from '../../../engine/rendering/Renderer';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Arrow } from '../../../engine/components/Arrow';
import { EnemyBattlefieldLayer, EnemyIntent } from './EnemyBattlefieldLayer';
import { PlayerBattlefieldLayer } from './PlayerBattlefieldLayer';
import { PlayerHandLayer } from './PlayerHandLayer';
import { ResourceBarLayer } from './ResourceBarLayer';
import { CombatLogLayer } from './CombatLogLayer';
import { TurnPhaseDisplay, CombatPhase } from './TurnPhaseDisplay';
import { CombatModel } from './CombatModel';
import { Driver, DriverRole } from '../../mechanics/Driver';
import { CombatLog, CombatLogType } from '../../mechanics/CombatLog';
import { Vehicle, VehiclePosition } from '../../mechanics/Vehicle';
import { Team, TeamType } from '../../mechanics/Team';
import { Battle, BattleState } from '../../mechanics/Battle';
import { Card } from '../../mechanics/Card';
import { CardLoader } from '../../core/CardLoader';
import { InputSystem } from '../../../engine/input/InputSystem';

/**
 * Combat Screen implementing Game Flow Spec section 2
 * Layered implementation with proper coordinate management
 */
export class CombatScreen extends Screen {
	// Layer components
	private enemyLayer!: EnemyBattlefieldLayer;
	private battlefieldLayer!: PlayerBattlefieldLayer;
	private handLayer!: PlayerHandLayer;
	private resourceLayer!: ResourceBarLayer;
	private combatLogLayer!: CombatLogLayer;
	private turnPhaseDisplay!: TurnPhaseDisplay;
	
	// Combat UI model
	private combatModel: CombatModel;
	
	// Game state using new Team architecture
	private battle: Battle | null = null;
	private playerTeam: Team | null = null;
	private enemyTeam: Team | null = null;
	private combatLog: CombatLog;
	private fuel = 5;
	private scrap = 150;
	
	// Driver-card mapping
	private cardDriverMap: Map<string, 1 | 2> = new Map();
	
	// UI state
	private combatLogVisible = false;
	
	// Targeting visual components
	private targetingArrow: Arrow;
	
	// Callbacks
	private onEndCombat: ((victory: boolean) => void) | null = null;
	private onBack: (() => void) | null = null;
	
	// Event unsubscribe functions
	private unsubscribers: (() => void)[] = [];

	/**
	 * Create combat screen
	 */
	constructor(renderer: Renderer) {
		super('combatScreen', renderer);
		
		// Create models
		this.combatLog = new CombatLog(10); // Keep last 10 entries
		this.combatModel = new CombatModel();
		
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
		this.setupModelListeners();
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
			// const availableCards = cardLoader.getAllCards(); // For future use

			// Create vehicles from driver configurations
			const [driver1, driver2] = drivers;
			
			// Create starting decks for drivers
			driver1.createStartingDeck(cardLoader.getAllCardsAsMap());
			driver2.createStartingDeck(cardLoader.getAllCardsAsMap());
			
			// Create vehicles based on driver configs
			const vehicle1 = this.createVehicleFromDriver(driver1);
			const vehicle2 = this.createVehicleFromDriver(driver2);
			
			// Assign drivers to their vehicles
			vehicle1.driver = driver1;
			vehicle2.driver = driver2;

			// Create player team
			this.playerTeam = new Team({
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

			// Subscribe to battle events
			this.subscribeToBattleEvents();

			// Initial UI update is handled by battleStarted event
			
			// Set initial turn phase
			if (this.turnPhaseDisplay) {
				this.turnPhaseDisplay.turn = this.battle.turn;
				this.turnPhaseDisplay.phase = CombatPhase.COMBAT_START;
			}
			
			// Log combat start
			this.combatLog.addEntry('Combat Started!', CombatLogType.INFO);
			this.combatLog.addEntry(`${driver1.metadata.name} and ${driver2.metadata.name} vs ${this.enemyTeam.vehicles[0].name}`, CombatLogType.INFO);

			console.log('Combat initialized with Team system');
		} catch (error) {
			console.error('Failed to initialize combat:', error);
		}
	}

	/**
	 * Subscribe to battle and model events
	 */
	private subscribeToBattleEvents(): void {
		if (!this.battle) return;

		// Clear any existing subscriptions
		this.unsubscribeAll();

		// Subscribe to battle events
		this.unsubscribers.push(
			this.battle.on('stateChanged', (state: BattleState) => {
				const previousTurn = this.turnPhaseDisplay?.turn || 1;
				this.updateUIFromBattle();
				
				// Update turn phase display
				if (this.battle && this.turnPhaseDisplay) {
					this.turnPhaseDisplay.turn = this.battle.turn;
					this.turnPhaseDisplay.phase = state.isPlayerTurn ? 
						CombatPhase.PLAYER_TURN : 
						!state.isPlayerTurn && !state.battleOver ? CombatPhase.ENEMY_TURN :
						state.battleOver ? CombatPhase.COMBAT_END :
						CombatPhase.COMBAT_START;
					
					// Log turn changes
					if (state.turn > previousTurn && state.isPlayerTurn) {
						this.combatLog.addEntry(`Turn ${state.turn} - Player turn started`, CombatLogType.TURN);
					}
				}
			})
		);

		this.unsubscribers.push(
			this.battle.on('battleEnded', (event: { won: boolean }) => {
				// Log battle end
				this.combatLog.addEntry(
					event.won ? 'Victory! All enemies defeated!' : 'Defeat! Your vehicles were destroyed!',
					CombatLogType.INFO
				);
				if (this.onEndCombat) {
					this.onEndCombat(event.won);
				}
			})
		);

		this.unsubscribers.push(
			this.battle.on('cardPlayed', (event: { driver: Driver; card: Card; targetVehicle?: Vehicle }) => {
				// Log card play with driver info
				const driverNumber = this.playerTeam?.getAllDrivers().indexOf(event.driver);
				if (driverNumber !== undefined && driverNumber >= 0) {
					let message = `played ${event.card.displayName}`;
					if (event.targetVehicle) {
						message += ` targeting ${event.targetVehicle.name}`;
					}
					this.combatLog.addEntry({
						driver: (driverNumber + 1) as 1 | 2,
						message,
						type: CombatLogType.ACTION
					});
				} else {
					// Enemy card play
					let message = `${event.driver.metadata.name} played ${event.card.displayName}`;
					if (event.targetVehicle) {
						message += ` targeting ${event.targetVehicle.name}`;
					}
					this.combatLog.addEntry(message, CombatLogType.ACTION);
				}
				console.log(`Card played: ${event.card.displayName}`);
			})
		);

		// Subscribe to turn events
		this.unsubscribers.push(
			this.battle.on('turnEnded', (event: { team: string }) => {
				if (event.team === 'player') {
					this.combatLog.addEntry('Player turn ended', CombatLogType.TURN);
					this.combatLog.addEntry('Enemy turn started', CombatLogType.TURN);
				}
			})
		);
		
		// Subscribe to player team changes
		if (this.playerTeam) {
			this.unsubscribers.push(
				this.playerTeam.on('change', () => {
					this.updateUIFromBattle();
				})
			);
		}

		// Subscribe to enemy team changes
		if (this.enemyTeam) {
			this.unsubscribers.push(
				this.enemyTeam.on('change', () => {
					this.updateUIFromBattle();
				})
			);
		}
	}

	/**
	 * Unsubscribe from all events
	 */
	private unsubscribeAll(): void {
		this.unsubscribers.forEach(unsubscribe => unsubscribe());
		this.unsubscribers = [];
	}

	/**
	 * Create a vehicle from a driver configuration
	 */
	private createVehicleFromDriver(driver: Driver): Vehicle {
		const vehicleStats = driver.vehicleStats;
		
		return new Vehicle({
			name: driver.metadata.vehicleName,
			armor: vehicleStats.armor,
			maxArmor: vehicleStats.armor,
			structure: vehicleStats.maxStructure,
			maxStructure: vehicleStats.maxStructure,
			speed: vehicleStats.speed,
			baseSpeed: vehicleStats.speed,
			position: VehiclePosition.FRONT,
			velocity: 0,
			driver: null,
			passenger: null,
			statusEffects: []
		});
	}

	/**
	 * Create a test enemy team
	 */
	private createTestEnemyTeam(): Team {
		// Create enemy drivers with basic configs
		const enemyDriver1 = new Driver({
			archetype: 'mechanic', // Using mechanic archetype for enemy
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
				maxStructure: 30,
				weight: 2,
				armor: 5,
				speed: 3,
				gunnery: 6,
				evade: 4
			},
			startingDeck: {
				cards: [
					{ type: 'ramming_speed', quantity: 2 },
					{ type: 'precision_shot', quantity: 3 }
				]
			},
			hitpoints: 30,
			maxHitpoints: 30,
			adrenaline: 3,
			maxAdrenaline: 10,
			role: DriverRole.ACTIVE,
			hand: [],
			discard: [],
			deck: null
		});

		// Create starting deck for enemy
		const cardLoader = CardLoader.getInstance();
		enemyDriver1.createStartingDeck(cardLoader.getAllCardsAsMap());

		const enemyVehicle1 = new Vehicle({
			name: 'Rust Buggy',
			armor: 5,
			maxArmor: 5,
			structure: 30,
			maxStructure: 30,
			speed: 3,
			baseSpeed: 3,
			position: VehiclePosition.FRONT,
			velocity: 0,
			driver: enemyDriver1,
			passenger: null,
			statusEffects: []
		});

		return new Team({
			type: TeamType.ENEMY,
			vehicles: [enemyVehicle1]
		});
	}

	/**
	 * Update UI layers with current battle state
	 */
	private updateUIFromBattle(): void {
		if (!this.battle || !this.playerTeam || !this.enemyTeam) return;

		// const battleStats = this.battle.getBattleStats(); // For future use
		
		// Get both drivers
		const drivers = this.playerTeam.getAllDrivers();
		if (drivers.length >= 2) {
			const [driver1, driver2] = drivers;
			
			// Show combined hand from both drivers with ownership tracking
			const driver1Cards = driver1.hand.map(card => ({ card, driverNumber: 1 as const }));
			const driver2Cards = driver2.hand.map(card => ({ card, driverNumber: 2 as const }));
			const combinedHandData = [...driver1Cards, ...driver2Cards];
			
			// For now, still pass just the cards array (will update PlayerHandLayer next)
			const combinedHand: Card[] = combinedHandData.map(data => data.card);
			this.handLayer.setHand(combinedHand);
			
			// Store the driver mapping and pass to hand layer
			this.cardDriverMap = new Map(combinedHandData.map(data => [data.card.id, data.driverNumber]));
			this.handLayer.setCardDriverMap(this.cardDriverMap);
			
			// Set adrenaline for hand layer (using combined adrenaline for now)
			// TODO: Track which driver owns which card for proper adrenaline checking
			const totalAdrenaline = driver1.adrenaline + driver2.adrenaline;
			this.handLayer.setAdrenaline(totalAdrenaline);
			
			// Update both drivers' resource displays
			this.resourceLayer.setDriverData(1, {
				name: driver1.metadata.name,
				adrenaline: driver1.adrenaline,
				maxAdrenaline: driver1.maxAdrenaline,
				drawPileCount: driver1.deck ? driver1.deck.cards.length : 0,
				discardPileCount: driver1.discard.length,
				fuel: this.fuel // TODO: Track fuel per driver when implemented
			});
			
			this.resourceLayer.setDriverData(2, {
				name: driver2.metadata.name,
				adrenaline: driver2.adrenaline,
				maxAdrenaline: driver2.maxAdrenaline,
				drawPileCount: driver2.deck ? driver2.deck.cards.length : 0,
				discardPileCount: driver2.discard.length,
				fuel: 0 // TODO: Track fuel per driver when implemented
			});
			
			// Update shared resources
			this.resourceLayer.setScrap(this.scrap);
		}

		// Update enemy layer with enemy vehicles
		if (this.enemyTeam) {
			// Pass the Vehicle[] directly
			this.enemyLayer.setVehicles(this.enemyTeam.vehicles);
			
			// Set intents for enemy vehicles (temporary placeholder)
			this.enemyTeam.vehicles.forEach(vehicle => {
				const intent: EnemyIntent = {
					type: 'attack',
					value: 5,
					description: 'Preparing to attack'
				};
				this.enemyLayer.setVehicleIntent(vehicle.id, intent);
			});
		}

		// Update battlefield layer with player vehicles
		if (this.playerTeam) {
			// Pass the Vehicle[] directly
			this.battlefieldLayer.setVehicles(this.playerTeam.vehicles);
		}
	}

	/**
	 * Create background
	 */
	private createBackground(): void {
		const background = new Rectangle({
			x: 0,
			y: 0,
			width: this.rootLayer.getWidth(),
			height: this.rootLayer.getHeight(),
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
		const screenWidth = this.rootLayer.getWidth();
		const screenHeight = this.rootLayer.getHeight();
		
		// Enemy Layer - Top 25%
		const enemyLayerHeight = Math.floor(screenHeight * 0.25);
		this.enemyLayer = new EnemyBattlefieldLayer({
			x: 0,
			y: 0,
			width: screenWidth,
			height: enemyLayerHeight,
			combatData: this.combatModel,
		});
		this.rootLayer.addChild(this.enemyLayer);

		// Battlefield Layer - Middle 40%
		const battlefieldLayerHeight = Math.floor(screenHeight * 0.4);
		const battlefieldLayerY = enemyLayerHeight;
		this.battlefieldLayer = new PlayerBattlefieldLayer({
			x: 0,
			y: battlefieldLayerY,
			width: screenWidth,
			height: battlefieldLayerHeight,
			combatData: this.combatModel,
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
		
		// Turn Phase Display - Top left corner
		this.turnPhaseDisplay = new TurnPhaseDisplay({
			x: 10,
			y: 10,
			width: 200,
			height: 40
		});
		this.rootLayer.addChild(this.turnPhaseDisplay);
		
		// Combat Log - Top right corner
		const combatLogWidth = 300; // Fixed width
		const combatLogHeight = 250; // Enough for ~10 entries
		this.combatLogLayer = new CombatLogLayer({
			x: screenWidth - combatLogWidth - 10,
			y: 10,
			width: combatLogWidth,
			height: combatLogHeight,
			combatLog: this.combatLog
		});
		this.rootLayer.addChild(this.combatLogLayer);
		
		// Start with combat log hidden
		this.combatLogLayer.setVisible(this.combatLogVisible);
	}

	/**
	 * Set up layer interactions and callbacks
	 */
	private setupInteractions(): void {
		// Hand layer interactions
		this.handLayer.setOnCardHover((_card) => {
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
			if (key === 'Escape' && this.combatModel.isTargeting) {
				this.combatModel.cancelSelection();
				this.handLayer.clearCardSelection();
			}
		});
		
		// Register global F6 handler for combat log toggle
		InputSystem.registerGlobalKeyDown('F6', () => {
			this.toggleCombatLog();
		});

		// Set up global click handler for targeting cancellation
		InputSystem.registerMouseDown(this.rootLayer, () => {
			if (this.combatModel.isTargeting && this.combatModel.selectedCard) {
				// If we're targeting and click somewhere that doesn't handle targeting,
				// cancel the targeting mode
				setTimeout(() => {
					if (this.combatModel.isTargeting) {
						console.log('Cancelled targeting - clicked empty space');
						this.combatModel.cancelSelection();
						this.handLayer.clearCardSelection();
					}
				}, 10); // Small delay to let target handlers run first
			}
		});
	}
	
	/**
	 * Set up combat model listeners
	 */
	private setupModelListeners(): void {
		// Listen for when a vehicle is targeted
		this.combatModel.on('targetedVehicle', (vehicle: Vehicle | null) => {
			if (vehicle && this.combatModel.selectedCard && this.combatModel.selectedDriver) {
				this.playCardWithTarget(this.combatModel.selectedCard, vehicle);
			}
		});
	}

	/**
	 * Handle screen updates
	 */
	protected onUpdate(dt: number): void {
		super.onUpdate(dt);

		// Handle targeting arrow updates during mouse movement
		if (this.combatModel.isTargeting && this.combatModel.selectedCard) {
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

		// Find which driver owns this card using our map
		const drivers = this.playerTeam.getAllDrivers();
		const driverNumber = this.cardDriverMap.get(card.id);
		let owningDriver: Driver | null = null;
		
		if (driverNumber && drivers.length >= driverNumber) {
			owningDriver = drivers[driverNumber - 1];
		} else {
			// Fallback to searching in hands if map is not set
			for (const driver of drivers) {
				if (driver.hand.includes(card)) {
					owningDriver = driver;
					break;
				}
			}
		}
		
		if (!owningDriver) {
			console.warn('Could not find driver who owns this card');
			return;
		}

		// Check if driver can afford and play this card
		if (!owningDriver.canPlayCard(card)) {
			const reason = !owningDriver.canAffordCard(card) 
				? `${owningDriver.metadata.name}: Not enough adrenaline`
				: `${owningDriver.metadata.name}: Cannot play this card type as passenger`;
			console.log(reason);
			return;
		}

		// Use combat model to handle selection
		this.combatModel.selectCard(card, owningDriver);

		// Check if card needs a target
		const targetType = card.targetType;
		if (targetType === 'enemy_all' || targetType === 'self' || targetType === 'both_drivers') {
			// No specific target needed, play immediately
			this.playCardWithTarget(card, undefined);
		} else {
			// Update UI for targeting mode
			this.handLayer.setCardSelected(card);
			this.handLayer.setTargetingMode(true);
			
			// Determine valid targets
			const targetableIds = this.determineTargetableVehicles(card);
			this.combatModel.targetableVehicleIds = targetableIds;
			
			console.log(`Select target for ${card.displayName}`);
		}
	}

	/**
	 * Play a card with the specified target using the new Battle system
	 */
	private playCardWithTarget(card: Card, targetVehicle: Vehicle | undefined): void {
		if (!this.battle || !this.combatModel.selectedDriver) {
			console.warn('Cannot play card: no battle or driver');
			return;
		}

		// Find the card index in the driver's hand
		const driver = this.combatModel.selectedDriver;
		const hand = driver.hand;
		const cardIndex = hand.findIndex(c => c === card);
		
		if (cardIndex === -1) {
			console.warn('Card not found in driver hand');
			return;
		}

		// Play the card through the battle system
		const success = this.battle.playCard({
			driver: driver,
			cardIndex: cardIndex,
			targetVehicle: targetVehicle
		});

		if (success) {
			console.log(`${driver.metadata.name} played ${card.displayName}`);
			
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
		this.combatModel.cancelSelection();
		this.handLayer.clearCardSelection();
	}
	
	/**
	 * Determine which vehicles can be targeted by a card
	 */
	private determineTargetableVehicles(card: Card): string[] {
		if (!this.playerTeam || !this.enemyTeam) return [];
		
		const targetType = card.targetType;
		
		switch (targetType) {
			case 'enemy_single':
				return this.enemyTeam.vehicles.map(v => v.id);
				
			case 'self':
				// Only the vehicle with the driver playing the card
				if (this.combatModel.selectedDriver) {
					const driverVehicle = this.playerTeam.vehicles.find(v => v.driver === this.combatModel.selectedDriver);
					return driverVehicle ? [driverVehicle.id] : [];
				}
				return [];
				
			case 'ally':
				return this.playerTeam.vehicles.map(v => v.id);
				
			case 'any':
				return [...this.playerTeam.vehicles, ...this.enemyTeam.vehicles].map(v => v.id);
				
			default:
				return [];
		}
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
	 * Handle targeting arrow updates during mouse movement
	 */
	private updateTargetingArrow(mouseX: number, mouseY: number): void {
		if (!this.combatModel.selectedCard || !this.combatModel.isTargeting) {
			this.targetingArrow.hide();
			return;
		}

		// Get the center position of the selected card in the hand
		const selectedCardElement = this.handLayer.getCardElementByCard(this.combatModel.selectedCard);
		if (!selectedCardElement) {
			this.targetingArrow.hide();
			return;
		}

		// Get global position of selected card center
		const cardGlobalPos = this.handLayer.localToGlobal(
			selectedCardElement.getX() + selectedCardElement.getWidth() / 2,
			selectedCardElement.getY() + selectedCardElement.getHeight() / 2
		);

		// Arrow will automatically show when points are set
		
		// Set arrow color based on whether we have a focused (valid) target
		const isValidTarget = this.combatModel.focusedVehicleId && 
			this.combatModel.isVehicleTargetable(this.combatModel.focusedVehicleId);
		this.targetingArrow.setColor(isValidTarget ? '#00ff00' : '#ff6666');

		// Draw arrow from card to mouse position
		this.targetingArrow.setPoints(cardGlobalPos.x, cardGlobalPos.y, mouseX, mouseY);
	}







	// Removed deprecated methods - now handled by Battle system

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
	 * Toggle combat log visibility
	 */
	private toggleCombatLog(): void {
		this.combatLogVisible = !this.combatLogVisible;
		this.combatLogLayer.setVisible(this.combatLogVisible);
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
		if (this.combatModel.isTargeting) {
			this.combatModel.cancelSelection();
			this.handLayer.clearCardSelection();
		}
		
		// Clean up combat log subscriptions
		if (this.combatLogLayer) {
			this.combatLogLayer.cleanup();
		}
		
		// Unregister global keyboard handler
		InputSystem.unregisterGlobalKeyDown('F6');
		
		// Unsubscribe from all events
		this.unsubscribeAll();
	}

	/**
	 * Handle window resize
	 */
	protected onResized(): void {
		// Update layer positions and sizes
		const screenWidth = this.rootLayer.getWidth();
		const screenHeight = this.rootLayer.getHeight();
		
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
		
		// Update turn phase display position
		if (this.turnPhaseDisplay) {
			this.turnPhaseDisplay.setPosition(10, 10);
		}
		
		// Update combat log position
		if (this.combatLogLayer) {
			const combatLogWidth = 300;
			this.combatLogLayer.setPosition(screenWidth - combatLogWidth - 10, 10);
		}
		
		// Don't recreate all UI elements on resize - they'll be repositioned by their own resize handlers
	}
}