import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Rectangle } from '../../../engine/components/Rectangle';
import { EnemyBattlefieldLayer, EnemyIntent } from './EnemyBattlefieldLayer';
import { PlayerBattlefieldLayer } from './PlayerBattlefieldLayer';
import { PlayerHandLayer } from './PlayerHandLayer';
import { ResourceBarLayer } from './ResourceBarLayer';
import { CombatLogLayer } from './CombatLogLayer';
import { TurnPhaseDisplay, CombatPhase } from './TurnPhaseDisplay';
import { CombatModel } from './CombatModel';
import { buildPlayerHandView } from './PlayerHandView';
import { Driver, DriverRole } from '../../mechanics/Driver';
import { assertDriverPair } from '../../mechanics/DriverPair';
import { CombatLog, CombatLogType } from '../../mechanics/CombatLog';
import { Vehicle } from '../../mechanics/Vehicle';
import { RoadLane, RoadRow } from '../../mechanics/Road';
import { Team, TeamType } from '../../mechanics/Team';
import { Battle, BattleState, BattleMessage } from '../../mechanics/Battle';
import { Card } from '../../mechanics/Card';
import { IntentType } from '../../mechanics/Intent';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { InputSystem } from '../../../engine/input/InputSystem';
import { BattleResultData } from '../battleResult/BattleResultScreen';

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
	
	// The player's drivers in seat order (Driver 1, Driver 2), fixed for the
	// fight so a driver keeps their seat after riding on as a passenger
	private playerDrivers: Driver[] = [];
	
	// UI state
	private combatLogVisible = false;
	
	
	// Event unsubscribe functions
	private unsubscribers: (() => void)[] = [];

	/**
	 * Create combat screen
	 */
	constructor() {
		super('combatScreen');
		
		// Create models
		this.combatLog = new CombatLog(10); // Keep last 10 entries
		this.combatModel = new CombatModel();
		
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
		assertDriverPair(drivers);

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

			this.playerDrivers = [driver1, driver2];

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

			// Enable AI for enemy team - using aggressive AI as default
			// Other options: 'random', 'mcts', 'salvage', 'ramming'
			this.battle.aiController.setEnemyAI('aggressive');

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

			// Force UI update after initialization
			this.updateUIFromBattle();
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
				// Navigate to battle result screen
				if (this.battle) {
					const resultData: BattleResultData = {
						victory: event.won,
						battleState: this.battle.getState()
					};
					ScreenManager.navigate('battleResultScreen', resultData);
				}
			})
		);

		this.unsubscribers.push(
			this.battle.on('cardPlayed', (event: { driver: Driver; card: Card; targetVehicle?: Vehicle }) => {
				// Log card play with driver info
				const driverNumber = this.playerDrivers.indexOf(event.driver);
				if (driverNumber >= 0) {
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

		// Subscribe to detailed battle messages for comprehensive logging
		this.unsubscribers.push(
			this.battle.on('battleMessage', (message: BattleMessage) => {
				// Pass battle messages directly to the combat log
				this.combatLog.addBattleMessage(message);
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
			slot: null,
			flank: null,
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
			slot: { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.CENTER },
			flank: null,
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

		// Both hands show whenever both drivers are alive, whichever vehicle they're in
		this.handLayer.setHand(buildPlayerHandView(this.playerDrivers));

		this.playerDrivers.forEach((driver, index) => {
			this.resourceLayer.setDriverData((index + 1) as 1 | 2, {
				name: driver.metadata.name,
				adrenaline: driver.adrenaline,
				maxAdrenaline: driver.maxAdrenaline,
				drawPileCount: driver.deck ? driver.deck.cards.length : 0,
				discardPileCount: driver.discard.length,
				fuel: index === 0 ? this.fuel : 0 // TODO: Track fuel per driver when implemented
			});
		});
		this.resourceLayer.setScrap(this.scrap);

		// Update enemy layer with enemy vehicles
		if (this.enemyTeam) {
			// Pass the Vehicle[] directly
			this.enemyLayer.setVehicles(this.enemyTeam.vehicles);
			
			// Show each raider's first planned intent until the intent pills land (DDB-33)
			this.enemyTeam.vehicles.forEach(vehicle => {
				const [planned] = this.battle?.getIntents(vehicle) ?? [];
				if (!planned) {
					this.enemyLayer.clearVehicleIntent(vehicle.id);
					return;
				}
				const intent: EnemyIntent = {
					type: planned.type === IntentType.ATTACK ? 'attack' : planned.type === IntentType.DEFEND ? 'defend' : 'special',
					value: planned.amount ?? undefined,
					description: planned.description
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
		
		// Resource Layer - Top 7%
		const resourceLayerHeight = Math.floor(screenHeight * 0.07);
		this.resourceLayer = new ResourceBarLayer({
			id: 'combat_resource_bar',
			x: 0,
			y: 0,
			width: screenWidth,
			height: resourceLayerHeight,
		});
		this.rootLayer.addChild(this.resourceLayer);
		
		// Enemy Layer - 23%
		const enemyLayerHeight = Math.floor(screenHeight * 0.23);
		const enemyLayerY = resourceLayerHeight;
		this.enemyLayer = new EnemyBattlefieldLayer({
			id: 'combat_enemy_battlefield',
			x: 0,
			y: enemyLayerY,
			width: screenWidth,
			height: enemyLayerHeight,
			combatData: this.combatModel,
		});
		this.rootLayer.addChild(this.enemyLayer);

		// Battlefield Layer - Middle 40%
		const battlefieldLayerHeight = Math.floor(screenHeight * 0.4);
		const battlefieldLayerY = enemyLayerY + enemyLayerHeight;
		this.battlefieldLayer = new PlayerBattlefieldLayer({
			id: 'combat_player_battlefield',
			x: 0,
			y: battlefieldLayerY,
			width: screenWidth,
			height: battlefieldLayerHeight,
			combatData: this.combatModel,
		});
		this.rootLayer.addChild(this.battlefieldLayer);

		// Hand Layer - Bottom 18%
		const handLayerHeight = Math.floor(screenHeight * 0.18);
		const handLayerY = battlefieldLayerY + battlefieldLayerHeight;
		this.handLayer = new PlayerHandLayer({
			id: 'combat_player_hand',
			x: 0,
			y: handLayerY,
			width: screenWidth,
			height: handLayerHeight,
		});
		this.rootLayer.addChild(this.handLayer);
		
		// Turn Phase Display - Below resource bar, left side
		this.turnPhaseDisplay = new TurnPhaseDisplay({
			id: 'combat_turn_banner',
			x: 10,
			y: resourceLayerHeight + 10,
			width: 200,
			height: 40
		});
		this.rootLayer.addChild(this.turnPhaseDisplay);
		
		// Combat Log - Below resource bar, right side
		const combatLogWidth = 240; // Reduced width
		const combatLogHeight = 200; // Reduced height
		this.combatLogLayer = new CombatLogLayer({
			id: 'combat_log',
			x: screenWidth - combatLogWidth - 10,
			y: resourceLayerHeight + 10,
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

		// Removed global click handler - it was interfering with vehicle targeting
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
	}


	/**
	 * Handle card selection using new Team system
	 */
	private onCardSelected(card: Card): void {
		if (!this.battle || !this.playerTeam) {
			console.warn('No battle or player team');
			return;
		}

		const owningDriver = this.playerDrivers.find(driver => driver.hand.includes(card));
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
			
			console.log(`Select target for ${card.displayName}, targetType: ${card.targetType}`);
			console.log(`Targetable vehicle IDs:`, targetableIds);
			console.log(`Is targeting mode active:`, this.combatModel.isTargeting);
			console.log(`Enemy vehicles:`, this.enemyTeam?.vehicles.map(v => ({ id: v.id, name: v.name })));
		}
	}

	/**
	 * Play a card with the specified target using the new Battle system
	 */
	private playCardWithTarget(card: Card, targetVehicle: Vehicle | undefined): void {
		if (!this.battle || !this.combatModel.selectedDriver) {
			console.warn('Cannot play card: no battle or driver');
			this.combatModel.cancelSelection();
			this.handLayer.clearCardSelection();
			return;
		}

		// Find the card index in the driver's hand
		const driver = this.combatModel.selectedDriver;
		const hand = driver.hand;
		const cardIndex = hand.findIndex(c => c === card);

		if (cardIndex === -1) {
			console.warn('Card not found in driver hand');
			this.combatModel.cancelSelection();
			this.handLayer.clearCardSelection();
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
			
			// Clear selection state immediately after successful play
			this.combatModel.cancelSelection();
			this.handLayer.clearCardSelection();
			
			// Update UI to reflect new state (this will refresh the hand)
			this.updateUIFromBattle();
		} else {
			console.warn('Failed to play card');
			// Still clear selection state on failure
			this.combatModel.cancelSelection();
			this.handLayer.clearCardSelection();
		}
	}
	
	/**
	 * Determine which vehicles can be targeted by a card
	 */
	private determineTargetableVehicles(card: Card): string[] {
		if (!this.playerTeam || !this.enemyTeam) return [];
		
		const targetType = card.targetType;
		
		// A wreck, or a vehicle with nobody aboard, still on the road for the
		// rest of the turn is never a target
		const players = this.playerTeam.vehicles.filter(vehicle => !vehicle.isOutOfFight);
		const enemies = this.enemyTeam.vehicles.filter(vehicle => !vehicle.isOutOfFight);

		switch (targetType) {
			case 'enemy_single':
				return enemies.map(v => v.id);
				
			case 'self': {
				// Only the vehicle the playing driver is in, driving or riding
				const selectedDriver = this.combatModel.selectedDriver;
				const driverVehicle = selectedDriver && players.find(v => v.driver === selectedDriver || v.passenger === selectedDriver);
				return driverVehicle ? [driverVehicle.id] : [];
			}
				
			case 'ally':
				return players.map(v => v.id);
				
			case 'any':
				return [...players, ...enemies].map(v => v.id);
				
			default:
				return [];
		}
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
	 * Get the current battle state
	 */
	public getBattleState(): BattleState | null {
		return this.battle ? this.battle.getState() : null;
	}

	/**
	 * Handle screen mount
	 */
	protected async onMount(data?: unknown): Promise<void> {
		super.onMount(data);
		
		// Check if we have driver data
		if (data && typeof data === 'object' && 'drivers' in data) {
			const combatData = data as { drivers: Driver[] };
			try {
				await this.initializeCombat(combatData.drivers);
				// Force another UI update after async initialization completes
				this.updateUIFromBattle();
			} catch (error) {
				console.error('Failed to initialize combat:', error);
			}
		} else if (this.battle) {
			// Update UI from existing battle state
			this.updateUIFromBattle();
		} else {
			// For development - create default drivers if none provided
			try {
				const driverLoader = DriverLoader.getInstance();
				await driverLoader.loadDrivers();
				const drivers = driverLoader.getUnlockedDrivers();
				if (drivers.length >= 2) {
					await this.initializeCombat([drivers[0], drivers[1]]);
				} else {
					console.error('Not enough drivers available for default combat');
				}
			} catch (error) {
				console.error('Failed to create default combat:', error);
			}
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
		
		// Unmount all layers (this will unmount cards too)
		this.handLayer.unmount();
		this.enemyLayer.unmount();
		this.battlefieldLayer.unmount();
		this.resourceLayer.unmount();
		this.combatLogLayer.unmount();
		
		// Unregister global keyboard handler
		InputSystem.unregisterGlobalKeyDown('F6');

		// rootLayer is a plain Layer, whose unmount only recurses; it does not
		// unregister itself the way Component.unmount does.
		InputSystem.unregisterComponent(this.rootLayer);
		
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