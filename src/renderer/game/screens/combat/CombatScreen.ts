import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Stack } from '../../../engine/components/Stack';
import { EnemyBattlefieldLayer, EnemyIntent } from './EnemyBattlefieldLayer';
import { PlayerBattlefieldLayer } from './PlayerBattlefieldLayer';
import { PlayerHandLayer } from './PlayerHandLayer';
import { LOG_KEY, TopBarLayer } from './TopBarLayer';
import { EndTurnColumn } from './EndTurnColumn';
import { CombatLogLayer } from './CombatLogLayer';
import { TurnPhaseDisplay, CombatPhase } from './TurnPhaseDisplay';
import { CombatModel } from './CombatModel';
import {
	DOCK_HEIGHT,
	ENEMY_ROAD_WEIGHT,
	LOG_DRAWER_WIDTH,
	PLAYER_ROAD_WEIGHT,
	STAGE_MAX_WIDTH,
	computeCombatStage,
} from './CombatLayout';
import { ChromeStack } from './ChromeStack';
import { DOCK_GRADIENT, Rgba, rgba } from './combatStyle';
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

/** Behind the stage, to the screen's edges (the mock's `.g-bg`). */
const SCREEN_BACKGROUND: Rgba = [0.0824, 0.0863, 0.0941, 1];
const BANNER_INSET = 12;
/** The top bar's LOG key in either case, and F6, which it has always had. */
const LOG_TOGGLE_KEYS = [LOG_KEY.toLowerCase(), LOG_KEY, 'F6'];
/** Between the hands and the End Turn column. */
const DOCK_GAP = 16;
/**
 * From the mock: tabs 8 below the dock's edge and cards ending 10 above the
 * bottom, less the lift a hovered card rises by, which the fan keeps inside
 * itself.
 */
const DOCK_PADDING = { top: 8, bottom: 5, left: 16, right: 16 };

/**
 * The combat screen, laid out per Battle Screen Design section 2
 */
export class CombatScreen extends Screen {
	// Container components, built in onMount. The stage holds everything else
	// and is the one thing sized and scaled from the viewport.
	private stage!: Stack;
	private topBar!: TopBarLayer;
	private enemyLayer!: EnemyBattlefieldLayer;
	private battlefieldLayer!: PlayerBattlefieldLayer;
	private handLayer!: PlayerHandLayer;
	private endTurnColumn!: EndTurnColumn;
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
	// The turn the screen last showed, for logging a new one
	private shownTurn = 1;
	// The hand slot of the card a keyboard player last chose, where focus
	// goes back to once it is played or put back
	private keyboardSlot = 0;
	
	
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
			
			this.turnPhaseDisplay.phase = this.battle.isPlayerTurn ? CombatPhase.PLAYER_TURN : CombatPhase.ENEMY_TURN;
			
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
				const previousTurn = this.shownTurn;
				this.updateUIFromBattle();
				
				this.turnPhaseDisplay.phase = state.isPlayerTurn ? 
					CombatPhase.PLAYER_TURN : 
					!state.isPlayerTurn && !state.battleOver ? CombatPhase.ENEMY_TURN :
					state.battleOver ? CombatPhase.COMBAT_END :
					CombatPhase.COMBAT_START;
				
				// Log turn changes
				if (state.turn > previousTurn && state.isPlayerTurn) {
					this.combatLog.addEntry(`Turn ${state.turn} - Player turn started`, CombatLogType.TURN);
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
		// An unmounted screen's layers are detached, and nothing it builds on
		// them would ever be shown
		if (!this.isActive || !this.battle || !this.playerTeam || !this.enemyTeam) return;

		// Both hands show whenever both drivers are alive, whichever vehicle they're in
		const battle = this.battle;
		this.handLayer.setHand(buildPlayerHandView(this.playerDrivers, (driver, card) => battle.canPlayCard({ driver, card })));

		this.playerDrivers.forEach((driver, index) => {
			this.handLayer.setDriverData((index + 1) as 1 | 2, {
				name: driver.metadata.name,
				adrenaline: driver.adrenaline,
				maxAdrenaline: driver.maxAdrenaline,
				drawPileCount: driver.deck ? driver.deck.cards.length : 0,
				discardPileCount: driver.discard.length,
				passenger: driver.role === DriverRole.PASSENGER,
			});
		});
		this.shownTurn = battle.turn;
		this.topBar.turn = battle.turn;
		this.topBar.scrap = this.scrap;
		this.topBar.fuel = this.fuel;
		this.endTurnColumn.show({
			turn: battle.turn,
			playerTurn: battle.isPlayerTurn && !battle.battleOver,
			unspentAdrenaline: this.playerDrivers
				.filter(driver => driver.isAlive())
				.reduce((total, driver) => total + driver.adrenaline, 0),
		});

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
	 * Build the screen as stacks (Battle Screen Design, section 2): a stage
	 * the viewport's size in logical pixels, holding a column capped at
	 * 1600 and centred, of a 36 px top bar, the road filling what is left,
	 * and a 228 px dock. The turn banner and the log drawer are anchored
	 * over the road, so neither ever covers the dock.
	 */
	private createLayers(): void {
		// The stage is the viewport's size, so its box is the screen's background.
		this.stage = new Stack({
			id: 'combat_stage',
			style: { backgroundColor: SCREEN_BACKGROUND },
			direction: 'horizontal',
			distribution: 'center',
			crossAlign: 'stretch',
		});
		this.rootLayer.addChild(this.stage);

		const bands = new Stack({
			id: 'combat_bands',
			direction: 'vertical',
			crossAlign: 'stretch',
			widthMode: 'fill',
			heightMode: 'fill',
			maxSize: { width: STAGE_MAX_WIDTH },
		});
		this.stage.addChild(bands);

		this.topBar = new TopBarLayer({
			id: 'combat_top_bar',
			combatLog: this.combatLog,
			onToggleLog: () => this.toggleCombatLog(),
		});
		bands.addChild(this.topBar);
		bands.addChild(this.createRoad());
		bands.addChild(this.createDock());
	}

	/** The raiders' band above the player's until the slot grid (DDB-134), with the banner and the log drawer over both. */
	private createRoad(): Stack {
		const road = new Stack({
			id: 'combat_road',
			direction: 'vertical',
			crossAlign: 'stretch',
			widthMode: 'fill',
			heightMode: 'fill',
		});

		this.enemyLayer = new EnemyBattlefieldLayer({
			id: 'combat_enemy_battlefield',
			widthMode: 'fill',
			heightMode: 'fill',
			fillWeight: ENEMY_ROAD_WEIGHT,
			combatData: this.combatModel,
		});
		road.addChild(this.enemyLayer);

		this.battlefieldLayer = new PlayerBattlefieldLayer({
			id: 'combat_player_battlefield',
			widthMode: 'fill',
			heightMode: 'fill',
			fillWeight: PLAYER_ROAD_WEIGHT,
			combatData: this.combatModel,
		});
		road.addChild(this.battlefieldLayer);

		// Centred on the road's height at its left edge, whatever fills the
		// road, so the slot grid (DDB-134) can replace the two bands under it
		this.turnPhaseDisplay = new TurnPhaseDisplay({
			id: 'combat_turn_banner',
			positioned: 'absolute',
			anchor: 'left',
			x: BANNER_INSET,
			zIndex: 1,
		});
		road.addChild(this.turnPhaseDisplay);

		this.combatLogLayer = new CombatLogLayer({
			id: 'combat_log',
			positioned: 'absolute',
			anchor: 'topRight',
			width: LOG_DRAWER_WIDTH,
			heightMode: 'fill',
			zIndex: 1,
			combatLog: this.combatLog,
		});
		this.combatLogLayer.setVisible(this.combatLogVisible);
		road.addChild(this.combatLogLayer);

		return road;
	}

	/** Both drivers' tabs and hands, then the End Turn column at the stage's right end. */
	private createDock(): Stack {
		const dock = new ChromeStack({
			id: 'combat_dock',
			direction: 'horizontal',
			gap: DOCK_GAP,
			padding: DOCK_PADDING,
			crossAlign: 'stretch',
			widthMode: 'fill',
			height: DOCK_HEIGHT,
			chrome: { fill: DOCK_GRADIENT, edge: { color: rgba('line_edge'), edges: { top: true } } },
		});

		this.handLayer = new PlayerHandLayer({
			id: 'combat_player_hand',
			widthMode: 'fill',
			heightMode: 'fill',
		});
		dock.addChild(this.handLayer);

		this.endTurnColumn = new EndTurnColumn({
			id: 'combat_end_turn',
			onEndTurn: () => this.endPlayerTurn(),
		});
		dock.addChild(this.endTurnColumn);

		return dock;
	}

	/**
	 * The one layout function's screen half, on mount and on every resize:
	 * the stage takes the logical canvas for the viewport and scales it
	 * back up to fill the screen. The stacks lay out everything inside it.
	 */
	private applyLayout(): void {
		const { scale, width, height } = computeCombatStage({ width: this.rootLayer.getWidth(), height: this.rootLayer.getHeight() });
		this.stage.setSize(width, height);
		this.stage.transform = { scale, origin: [0, 0] };
	}

	/**
	 * Set up layer interactions and callbacks
	 */
	private setupInteractions(): void {
		this.handLayer.setOnCardSelect((card) => {
			this.onCardSelected(card);
		});

		// Escape cancels targeting and L or F6 toggles the combat log, from the
		// screen root's hotkey table, which keys reach after bubbling out of
		// whatever is focused (R9.15)
		const { hotkeys } = this.rootLayer;
		hotkeys.register('Escape', () => {
			if (this.combatModel.isTargeting) {
				this.combatModel.cancelSelection();
				this.handLayer.clearCardSelection();
				this.restoreKeyboardFocus();
			}
		});
		for (const key of LOG_TOGGLE_KEYS) hotkeys.register(key, () => this.toggleCombatLog());

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
		this.keyboardSlot = Math.max(0, this.handLayer.slotOf(card));

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

			// A keyboard player goes straight to the first target; the targets
			// are the only focusable vehicles now (R9.23: programmatic focus
			// keeps the keyboard's visible ring)
			const focus = this.context.focus;
			if (focus.focusVisible && !focus.focusFirst(this.enemyLayer)) focus.focusFirst(this.battlefieldLayer);
			
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
		this.restoreKeyboardFocus();
	}

	/**
	 * After a keyboard player's card is played or put back, focus goes back
	 * to the hand at the same slot, or to END TURN when nothing is playable.
	 * The hand is rebuilt on every change, so the card focus was on is gone,
	 * and a target vehicle stops being focusable when targeting ends.
	 */
	private restoreKeyboardFocus(): void {
		const focus = this.context.focus;
		if (!focus.focusVisible) return;
		if (this.handLayer.focusNearSlot(this.keyboardSlot)) return;
		focus.focus(this.endTurnColumn.endTurn);
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
		this.applyLayout();
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

		this.rootLayer.hotkeys.unregister('Escape');
		for (const key of LOG_TOGGLE_KEYS) this.rootLayer.hotkeys.unregister(key);

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