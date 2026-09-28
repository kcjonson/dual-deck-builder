import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Layer } from '../../../engine/components/Layer';
import { Rect } from '../../../engine/draw/geometry';
import { EnemyBattlefieldLayer, EnemyIntent } from './EnemyBattlefieldLayer';
import { PlayerBattlefieldLayer } from './PlayerBattlefieldLayer';
import { PlayerHandLayer } from './PlayerHandLayer';
import { ResourceBarLayer } from './ResourceBarLayer';
import { CombatLogLayer } from './CombatLogLayer';
import { TurnPhaseDisplay, CombatPhase } from './TurnPhaseDisplay';
import { CombatModel } from './CombatModel';
import { CombatLayout, computeCombatLayout } from './CombatLayout';
import { buildPlayerHandView } from './PlayerHandView';
import { Driver, DriverRole } from '../../mechanics/Driver';
import { assertDriverPair } from '../../mechanics/DriverPair';
import { CombatLog, CombatLogType } from '../../mechanics/CombatLog';
import { Vehicle, createDrivenVehicle } from '../../mechanics/Vehicle';
import { RoadLane, RoadRow } from '../../mechanics/Road';
import { Team, TeamType } from '../../mechanics/Team';
import { Battle, BattleState, BattleMessage } from '../../mechanics/Battle';
import { Card } from '../../mechanics/Card';
import { IntentType } from '../../mechanics/Intent';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { BattleResultData } from '../battleResult/BattleResultScreen';

/**
 * Combat Screen implementing Game Flow Spec section 2
 * Layered implementation with proper coordinate management
 */
export class CombatScreen extends Screen {
	// Layer components, built in onMount
	private background!: Rectangle;
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
	
	
	// Event unsubscribe functions: battle and team events, and the combat model's
	private unsubscribers: (() => void)[] = [];
	private modelUnsubscribers: (() => void)[] = [];

	// Bumped on every mount and unmount, so a load that finishes after its
	// mount has ended knows to stop
	private mountGeneration = 0;

	/**
	 * Create combat screen
	 */
	constructor() {
		super('combatScreen');
		
		// Create models
		this.combatLog = new CombatLog(10); // Keep last 10 entries
		this.combatModel = new CombatModel();
	}

	/**
	 * Initialize combat with driver teams and vehicles
	 */
	private async initializeCombat(drivers: Driver[], generation: number): Promise<void> {
		assertDriverPair(drivers);

		try {
			// Ensure cards are loaded
			const cardLoader = CardLoader.getInstance();
			await cardLoader.loadCards();
			if (generation !== this.mountGeneration) return;

			// Create vehicles from driver configurations
			const [driver1, driver2] = drivers;
			
			// Create starting decks for drivers
			driver1.createStartingDeck(cardLoader.getAllCardsAsMap());
			driver2.createStartingDeck(cardLoader.getAllCardsAsMap());
			
			const vehicle1 = createDrivenVehicle({ driver: driver1 });
			const vehicle2 = createDrivenVehicle({ driver: driver2 });

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
				evade: 4,
				speed: 2
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

		const enemyVehicle1 = createDrivenVehicle({ driver: enemyDriver1 });
		enemyVehicle1.slot = { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.CENTER };
		// A scavenger's buggy: it goes for your haulers (escorts.md decision 30)
		enemyVehicle1.raiderArchetype = 'looter';

		return new Team({
			type: TeamType.ENEMY,
			vehicles: [enemyVehicle1]
		});
	}

	/**
	 * Update UI layers with current battle state
	 */
	private updateUIFromBattle(): void {
		// An unmounted screen's layers are detached; building cards on them
		// would register those cards with the InputSystem again
		if (!this.isActive || !this.battle || !this.playerTeam || !this.enemyTeam) return;

		// Both hands show whenever both drivers are alive, whichever vehicle they're in
		const battle = this.battle;
		this.handLayer.setHand(buildPlayerHandView(this.playerDrivers, (driver, card) => battle.canPlayCard({ driver, card })));

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
			const intents = this.battle?.getAllIntents();
			this.enemyTeam.vehicles.forEach(vehicle => {
				const [planned] = intents?.get(vehicle) ?? [];
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
	 * The layout for the screen's current size
	 */
	private get layout(): CombatLayout {
		return computeCombatLayout({ width: this.rootLayer.getWidth(), height: this.rootLayer.getHeight() });
	}

	/**
	 * Create the background and every layer where the layout puts them
	 */
	private createLayers(): void {
		const layout = this.layout;

		this.background = new Rectangle({
			x: 0,
			y: 0,
			width: this.rootLayer.getWidth(),
			height: this.rootLayer.getHeight(),
			style: {
				backgroundColor: '#1a1a1a', // Dark combat background
			},
		});
		this.rootLayer.addChild(this.background);

		this.resourceLayer = new ResourceBarLayer({
			id: 'combat_resource_bar',
			...layout.resourceBar,
		});
		this.rootLayer.addChild(this.resourceLayer);

		this.enemyLayer = new EnemyBattlefieldLayer({
			id: 'combat_enemy_battlefield',
			...layout.enemyBattlefield,
			combatData: this.combatModel,
		});
		this.rootLayer.addChild(this.enemyLayer);

		this.battlefieldLayer = new PlayerBattlefieldLayer({
			id: 'combat_player_battlefield',
			...layout.playerBattlefield,
			combatData: this.combatModel,
		});
		this.rootLayer.addChild(this.battlefieldLayer);

		this.handLayer = new PlayerHandLayer({
			id: 'combat_player_hand',
			...layout.hand,
		});
		this.rootLayer.addChild(this.handLayer);

		this.turnPhaseDisplay = new TurnPhaseDisplay({
			id: 'combat_turn_banner',
			...layout.turnBanner,
		});
		this.rootLayer.addChild(this.turnPhaseDisplay);

		this.combatLogLayer = new CombatLogLayer({
			id: 'combat_log',
			...layout.combatLog,
			combatLog: this.combatLog,
		});
		this.rootLayer.addChild(this.combatLogLayer);

		// Start with combat log hidden
		this.combatLogLayer.setVisible(this.combatLogVisible);
	}

	/**
	 * Move and size every layer to the layout for the current size
	 */
	private applyLayout(): void {
		const layout = this.layout;
		const place = (layer: Layer, { x, y, width, height }: Rect): void => {
			layer.setPosition(x, y);
			layer.setSize(width, height);
		};

		this.background.setSize(this.rootLayer.getWidth(), this.rootLayer.getHeight());
		place(this.resourceLayer, layout.resourceBar);
		place(this.enemyLayer, layout.enemyBattlefield);
		place(this.battlefieldLayer, layout.playerBattlefield);
		place(this.handLayer, layout.hand);
		place(this.turnPhaseDisplay, layout.turnBanner);
		place(this.combatLogLayer, layout.combatLog);
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
		this.context.input.registerKeyDown(this.rootLayer, (key: string) => {
			if (key === 'Escape' && this.combatModel.isTargeting) {
				this.combatModel.cancelSelection();
				this.handLayer.clearCardSelection();
			}
		});
		
		// Register global F6 handler for combat log toggle
		this.context.input.registerGlobalKeyDown('F6', () => {
			this.toggleCombatLog();
		});

		// Removed global click handler - it was interfering with vehicle targeting
	}
	
	/**
	 * Set up combat model listeners
	 */
	private setupModelListeners(): void {
		this.modelUnsubscribers.push(
			// Listen for when a vehicle is targeted
			this.combatModel.on('targetedVehicle', (vehicle: Vehicle | null) => {
				if (vehicle && this.combatModel.selectedCard && this.combatModel.selectedDriver) {
					this.playCardWithTarget(this.combatModel.selectedCard, vehicle);
				}
			}),

			// Over a raider, an attack order lights up the escort that would carry it out
			this.combatModel.on('focusedVehicleId', (vehicleId: string | null) => {
				this.combatModel.carrierVehicleId = this.findOrderCarrierId(vehicleId);
			}),
		);
	}

	/**
	 * The escort that would carry out the selected attack order on this
	 * raider, if any
	 */
	private findOrderCarrierId(raiderId: string | null): string | null {
		const card = this.combatModel.selectedCard;
		const raider = raiderId ? this.enemyTeam?.vehicles.find(vehicle => vehicle.id === raiderId) : null;
		if (!this.battle || !card || !raider || !this.battle.isAttackOrder(card)) return null;
		return this.battle.orderCarrier({ card, target: raider })?.id ?? null;
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
		const cardBlocker = this.battle.getCardBlocker({ driver: owningDriver, card });
		if (cardBlocker) {
			console.log(`${owningDriver.metadata.name}: ${cardBlocker}`);
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

		// A winning play ends the battle, which navigates away and unmounts
		// this screen before playCard returns
		if (!this.isActive) return;

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
		// rest of the turn is never a target. Nor is an empty escort for
		// Headshot, which has nobody on it to hit.
		const targetable = (vehicle: Vehicle): boolean =>
			!vehicle.isOutOfFight && !(card.hitsDriverOnly && !vehicle.driverOnlyTarget);
		const players = this.playerTeam.vehicles.filter(targetable);
		const enemies = this.enemyTeam.vehicles.filter(targetable);

		// An order's targets depend on the convoy (a raider with no escort to
		// carry it out isn't one), so ask the battle's own rule
		const selectedDriver = this.combatModel.selectedDriver;
		if (card.isOrder && this.battle && selectedDriver) {
			const battle = this.battle;
			return [...players, ...enemies]
				.filter(target => battle.getTargetBlocker({ driver: selectedDriver, card, target }) === null)
				.map(v => v.id);
		}

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
		
		// End turn through the battle system. A loss on the enemy turn ends the
		// battle, which navigates away and unmounts this screen.
		this.battle.endPlayerTurn();
		if (!this.isActive) return;

		// Update UI to reflect new state
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
		const generation = ++this.mountGeneration;

		this.createLayers();
		this.setupInteractions();
		this.setupModelListeners();

		// Check if we have driver data
		if (data && typeof data === 'object' && 'drivers' in data) {
			const combatData = data as { drivers: Driver[] };
			try {
				await this.initializeCombat(combatData.drivers, generation);
			} catch (error) {
				console.error('Failed to initialize combat:', error);
			}
		} else {
			// For development - create default drivers if none provided
			try {
				const driverLoader = DriverLoader.getInstance();
				await driverLoader.loadDrivers();
				if (generation !== this.mountGeneration) return;
				const drivers = driverLoader.getUnlockedDrivers();
				if (drivers.length >= 2) {
					await this.initializeCombat([drivers[0], drivers[1]], generation);
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
		// A load still in flight for this mount stops when it lands
		this.mountGeneration++;

		// Cancel any active targeting
		if (this.combatModel.isTargeting) {
			this.combatModel.cancelSelection();
			this.handLayer.clearCardSelection();
		}

		// Remove every layer so a remount builds them fresh; removeChild
		// unmounts each one, cards included
		for (const layer of [...this.rootLayer.getChildren()]) {
			this.rootLayer.removeChild(layer);
		}

		// Unregister global keyboard handler. The root's own keydown goes with
		// its unmount, which the base class releases.
		this.context.input.unregisterGlobalKeyDown('F6');

		// Unsubscribe from all events
		this.unsubscribeAll();
		this.modelUnsubscribers.forEach(unsubscribe => unsubscribe());
		this.modelUnsubscribers = [];
	}

	/**
	 * Handle window resize
	 */
	protected onResized(): void {
		this.applyLayout();
	}
}