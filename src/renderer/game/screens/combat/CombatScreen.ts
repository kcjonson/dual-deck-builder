import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Stack } from '../../../engine/components/Stack';
import { RoadView, EnemyIntent } from './RoadView';
import { PlayerHandLayer } from './PlayerHandLayer';
import { LOG_KEY, TopBarLayer } from './TopBarLayer';
import { EndTurnColumn } from './EndTurnColumn';
import { CombatLogLayer } from './CombatLogLayer';
import { TURN_BANNER_LIFETIME, TurnBanner } from './TurnBanner';
import { EnemyTurnPacer } from './EnemyTurnPacer';
import { CombatModel } from './CombatModel';
import {
	DOCK_HEIGHT,
	LOG_DRAWER_WIDTH,
	ROAD_HEADER_HEIGHT,
	STAGE_MAX_WIDTH,
	computeCombatStage,
} from './CombatLayout';
import { ChromeStack } from './ChromeStack';
import { CombatFxLayer } from './CombatFxLayer';
import { DOCK_GRADIENT, Rgba, rgba } from './combatStyle';
import { openPileDialog } from '../../ui/CardPileView';
import { INSPECT_KEYS, inspectHotkey } from '../../ui/cardInspect';
import { buildPlayerHandView } from './PlayerHandView';
import { TargetMark, seatMark } from '../../ui/targetMarks';
import { Driver, DriverRole } from '../../mechanics/Driver';
import { assertDriverPair } from '../../mechanics/DriverPair';
import { CombatLog, CombatLogType } from '../../mechanics/CombatLog';
import { Vehicle, createDrivenVehicle } from '../../mechanics/Vehicle';
import { RoadLane, RoadRow } from '../../mechanics/Road';
import { Team, TeamType } from '../../mechanics/Team';
import { Battle, BattleState, BattleMessage, EnemyTurnStep, HitEvent } from '../../mechanics/Battle';
import { Card } from '../../mechanics/Card';
import { AimPreview, previewAim } from '../../mechanics/AimPreview';
import type { RangeLabel } from '../../ui/RangeChip';
import { Intent, IntentType, formatIntentValue } from '../../mechanics/Intent';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { BattleResultData } from '../battleResult/BattleResultScreen';
import type { Component } from '../../../engine/components/Component';
import type { UiPointerEvent } from '../../../engine/input/events';
import { tokens } from '../../../engine/theme/tokens';

/** Behind the stage, to the screen's edges (the mock's `.g-bg`). */
const SCREEN_BACKGROUND: Rgba = [0.0824, 0.0863, 0.0941, 1];
/** What a hand card carries through a drag (R9.12's `data`). */
interface HandCardDrag {
	kind: 'hand-card';
	card: Card;
}

function isHandCardDrag(data: unknown): data is HandCardDrag {
	return typeof data === 'object' && data !== null && (data as HandCardDrag).kind === 'hand-card';
}

/**
 * The top bar's LOG key in either case, and F6, the log's key before the
 * top bar had one, kept as an alias for playtesters who learned it.
 */
const LOG_TOGGLE_KEYS = [LOG_KEY.toLowerCase(), LOG_KEY, 'F6'];
/** Between the hands and the End Turn column. */
const DOCK_GAP = 16;
/**
 * From the mock: tabs 8 below the dock's edge, cards 38 below it and ending
 * 10 above the bottom, their edge cards dropping 5 into that. A lifted card
 * rises over the tab on the raised layer.
 */
const DOCK_PADDING = { top: 8, bottom: 5, left: 16, right: 16 };
/**
 * The enemy turn's pacing (DDB-112, section 6): the first raider acts as
 * the ENEMY TURN banner starts to leave, then each action gets a beat for
 * its number to rise before the next, and the last one's beat ends before
 * the player's draw. Reading time on the frame clock, so reduced motion
 * keeps it.
 */
export const ENEMY_TURN_LEAD_IN = TURN_BANNER_LIFETIME - tokens.motion.dur;
export const ENEMY_ACTION_BEAT = 700;

/**
 * The combat screen, laid out per Battle Screen Design section 2
 */
export class CombatScreen extends Screen {
	// Container components, built in onMount. The stage holds everything else
	// and is the one thing sized and scaled from the viewport.
	private stage!: Stack;
	private topBar!: TopBarLayer;
	private road!: RoadView;
	private handLayer!: PlayerHandLayer;
	private endTurnColumn!: EndTurnColumn;
	private combatLogLayer!: CombatLogLayer;
	private turnBanner!: TurnBanner;
	private fx!: CombatFxLayer;
	private dock!: Stack;
	private enemyTurnPacer: EnemyTurnPacer | null = null;
	/** The raider whose action is on screen during the enemy turn (DDB-139 glows it), or null. */
	private enemyActing: Vehicle | null = null;
	
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
	
	// The turn the screen last showed, for logging a new one
	private shownTurn = 1;
	// The hand slot of the card a keyboard player last chose, where focus
	// goes back to once it is played or put back
	private keyboardSlot = 0;
	// Whether a card was waiting for its target when the last press landed,
	// so the click that chose it doesn't also put it back
	private aimingAtPress = false;
	// The aimed card's preview on each raider (range, hit check, damage),
	// worked out once when the card is picked
	private readonly aimPreviews = new Map<string, AimPreview>();

	
	// Event unsubscribe functions: battle and team events, and the combat model's
	private unsubscribers: (() => void)[] = [];
	private modelUnsubscribers: (() => void)[] = [];
	private dragUnsubscribe: (() => void) | null = null;
	/** Cards already sent to a pile by `handDiscarded`, which the next deal won't fly again. */
	private readonly flownCards = new Set<Card>();

	// Bumped on every mount and unmount, so a load that finishes after its
	// mount has ended knows to stop
	private mountGeneration = 0;

	/**
	 * Create combat screen
	 */
	constructor() {
		super('combatScreen');
		
		// Create models
		this.combatLog = new CombatLog();
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
			
			this.turnBanner.announce(this.battle.isPlayerTurn ? 'player' : 'enemy');
			
			// The log opens on the matchup
			const raiders = this.enemyTeam.vehicles.map(vehicle => vehicle.name).join(', ');
			this.combatLog.addEntry({ message: `${driver1.metadata.name} and ${driver2.metadata.name} vs ${raiders}`, turn: this.battle.turn });

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

				// A new turn of yours: logged, and the banner says so once the
				// enemy's has had its turn on screen
				// The hand dealt for the new turn has been shown, so a card the
				// end of the last one flew and the draw dealt straight back is
				// an ordinary hand card again
				this.flownCards.clear();
				if (state.turn > previousTurn && state.isPlayerTurn && !state.battleOver) {
					this.combatLog.addEntry({ message: 'Your turn', type: CombatLogType.TURN, turn: state.turn });
					this.turnBanner.announce('player');
				}
			})
		);

		this.unsubscribers.push(
			this.battle.on('battleEnded', (event: { won: boolean }) => {
				// The battle logs its own end; navigate to battle result screen
				if (this.battle) {
					const resultData: BattleResultData = { victory: event.won };
					ScreenManager.navigate('battleResultScreen', resultData);
				}
			})
		);

		// A hit floats its number up off the vehicle it landed on, read from
		// the plate's bounds now, before a wreck leaves the road
		this.unsubscribers.push(
			this.battle.on('hitLanded', (hit: HitEvent) => this.popHitNumber(hit)),
			this.battle.on('hitMissed', (hit: HitEvent) => this.popHitNumber(hit))
		);

		// Subscribe to turn events
		this.unsubscribers.push(
			this.battle.on('turnEnded', (event: { team: string }) => {
				if (event.team === 'player') {
					this.turnBanner.announce('enemy');
					this.combatLog.addEntry({ message: "The raiders' turn", type: CombatLogType.TURN, turn: this.battle?.turn });
				}
			})
		);

		// What happened, as the player reads it; the log drops the record's debug lines
		this.unsubscribers.push(
			this.battle.on('battleMessage', (message: BattleMessage) => this.combatLog.addBattleMessage(message))
		);
		
		// The end of the turn sends each driver's hand to the discard (DDB-37)
		for (const driver of this.playerDrivers) {
			this.unsubscribers.push(driver.on('handDiscarded', (cards: readonly Card[]) => this.flyDiscardedHand(driver, cards)));
		}

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

	/** A player's driver's seat for the fight, 1 or 2; null for anyone else. */
	private seatOf(driver: Driver): 1 | 2 | null {
		const index = this.playerDrivers.indexOf(driver);
		return index === 0 || index === 1 ? (index + 1) as 1 | 2 : null;
	}

	/** Whose vehicle an intent lands on, as its mark: a driver's, an escort's square, or both for an area hit. */
	private intentTargetMark(intent: Intent): TargetMark | undefined {
		if (intent.target === 'both') return 'both';
		const vehicle = this.playerTeam?.vehicles.find(candidate => candidate.id === intent.target);
		if (!vehicle) return undefined;
		if (vehicle.isEscort) return 'escort';
		const seat = vehicle.driver ? this.seatOf(vehicle.driver) : null;
		return seat === null ? undefined : seatMark(seat);
	}

	private popHitNumber({ vehicle, damage }: HitEvent): void {
		const plate = this.road.vehicleView(vehicle.id);
		if (!plate?.isMounted) return;
		this.fx.popNumber({
			anchor: plate.plateScreenBounds,
			anchorKey: plate.id ?? vehicle.id,
			text: damage === null ? 'MISS' : `-${damage}`,
			kind: damage === null ? 'miss' : 'damage',
		});
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
		this.handLayer.hand = buildPlayerHandView(this.playerDrivers, (driver, card) => battle.canPlayCard({ driver, card }));

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
		// One wave until the game has reinforcements (Combat Rules: "once there is one")
		this.topBar.wave = { number: 1, total: 1, incoming: 0 };
		this.topBar.turn = battle.turn;
		this.topBar.scrap = this.scrap;
		this.topBar.fuel = this.fuel;
		// The dock is locked while the raiders act (section 6); DDB-139 drops and greys it
		// Locked too once the fight is over, through the transition out
		const waiting = battle.enemyTurnInProgress || battle.battleOver;
		this.dock.enabled = !waiting;
		this.endTurnColumn.show({
			turn: battle.turn,
			playerTurn: battle.isPlayerTurn && !battle.battleOver,
			waiting,
			unspentAdrenaline: this.playerDrivers
				.filter(driver => driver.isAlive())
				.reduce((total, driver) => total + driver.adrenaline, 0),
		});

		// Every vehicle on the road, in its slot
		this.road.showVehicles({ player: this.playerTeam?.vehicles ?? [], enemy: this.enemyTeam?.vehicles ?? [] });

		// Every raider's plan, two markers and then "+N", until the intent
		// pills land (DDB-139)
		if (this.enemyTeam) {
			// While the raiders act, the plan they are playing stays up; the
			// next one shows with the player's draw
			const intents = waiting ? null : battle.getAllIntents();
			this.enemyTeam.vehicles.forEach(vehicle => {
				if (intents) this.road.setVehicleIntents(vehicle.id, (intents.get(vehicle) ?? []).map(intent => this.intentMarkerOf(intent)));
			});
		}
	}

	/** A planned intent as its marker shows it, with the tooltip's line. */
	private intentMarkerOf(intent: Intent): EnemyIntent {
		const value = formatIntentValue(intent);
		const target = intent.target === 'both'
			? 'both of your vehicles'
			: this.playerTeam?.vehicles.find(vehicle => vehicle.id === intent.target)?.name ?? null;
		const on = target ? ` on ${target}` : '';
		const mark = this.intentTargetMark(intent);
		switch (intent.type) {
			case IntentType.ATTACK:
				return { type: 'attack', value: intent.amount ?? undefined, valueText: value, description: intent.description, detail: `${value} damage${on}`, target: mark };
			case IntentType.DEFEND:
				return { type: 'defend', value: intent.amount ?? undefined, description: intent.description, detail: `${value} armor` };
			case IntentType.DEBUFF:
				return { type: 'debuff', description: intent.description, detail: `${value}${on}`, target: mark };
			case IntentType.BUFF:
				return { type: 'buff', description: intent.description, detail: value };
			default:
				return { type: 'special', description: intent.description, detail: 'Hidden' };
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
		// The stage is the viewport's size, so its box is the screen's
		// background, and a target itself: a click on empty road or dock, or
		// a right-click anywhere, puts an aimed card back (section 6)
		this.stage = new Stack({
			id: 'combat_stage',
			style: { backgroundColor: SCREEN_BACKGROUND },
			direction: 'horizontal',
			distribution: 'center',
			crossAlign: 'stretch',
			pointerEvents: 'auto',
			onPointerDown: () => {
				this.aimingAtPress = this.combatModel.isTargeting;
			},
			onClick: () => {
				if (this.aimingAtPress && this.combatModel.isTargeting && !this.context.drag.isDragging) this.putCardBack();
			},
			onContextMenu: () => this.cancelAim(),
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

		// Over everything, the stage's size: the targeting line
		this.fx = new CombatFxLayer({ id: 'combat_fx', positioned: 'absolute' });
		this.stage.addChild(this.fx);
	}

	/** The road's lanes and slots, with the banner and the log drawer over them. */
	private createRoad(): Stack {
		const road = new Stack({
			id: 'combat_road',
			direction: 'vertical',
			crossAlign: 'stretch',
			widthMode: 'fill',
			heightMode: 'fill',
		});

		this.road = new RoadView({
			id: 'combat_road_view',
			widthMode: 'fill',
			heightMode: 'fill',
			combatData: this.combatModel,
			seatOf: (driver) => this.seatOf(driver),
		});
		road.addChild(this.road);

		// Across the road and only the road (section 6), over the vehicles and
		// the log drawer, centred on the slot rows rather than the band: the
		// rows run from 4 under the header to 4 above the band's foot, so their
		// middle is half the header below the band's, and a header-high top
		// margin on a centred banner puts it there
		this.turnBanner = new TurnBanner({
			id: 'combat_turn_banner',
			positioned: 'absolute',
			anchor: 'center',
			widthMode: 'fill',
			margin: { top: ROAD_HEADER_HEIGHT },
			layer: 'overlay',
			zIndex: 2,
		});
		road.addChild(this.turnBanner);

		this.combatLogLayer = new CombatLogLayer({
			id: 'combat_log',
			positioned: 'absolute',
			anchor: 'topRight',
			width: LOG_DRAWER_WIDTH,
			heightMode: 'fill',
			zIndex: 1,
			combatLog: this.combatLog,
			onFocusLost: () => this.restoreKeyboardFocus(),
		});
		road.addChild(this.combatLogLayer);

		return road;
	}

	/** Both drivers' tabs and hands, then the End Turn column at the stage's right end. */
	private createDock(): Stack {
		const dock = this.dock = new ChromeStack({
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
		const { scale, width, height } = computeCombatStage({ width: this.rootLayer.width, height: this.rootLayer.height });
		this.stage.setSize(width, height);
		this.stage.transform = { scale, origin: [0, 0] };
		this.fx.setSize(width, height);
		// The stage's column caps and centres; the road art runs on to the edges
		this.road.bleed = (width - Math.min(width, STAGE_MAX_WIDTH)) / 2;
	}

	/**
	 * Set up layer interactions and callbacks
	 */
	private setupInteractions(): void {
		this.handLayer.onCardSelect = (card) => {
			this.chooseCard(card, 'click');
		};
		this.handLayer.setOnCardDrag({
			press: (card, element, event) => this.pressCard(card, element, event),
			// Any other button cancels, a drag or a click-then-target choice
			// alike (section 6), and that press pins no card
			otherButton: () => {
				if (this.context.drag.isDragging) {
					this.context.drag.cancel();
					return true;
				}
				if (this.combatModel.isTargeting) {
					this.putCardBack();
					return true;
				}
				return false;
			},
			end: (card, event) => {
				// Dropped off a target, on the dock, or cancelled: the card goes back
				if (!event.dropped && this.combatModel.selectedCard === card) this.putCardBack();
			},
		});
		this.dragUnsubscribe = this.context.drag.onDraggingChange((dragging) => this.dragChanged(dragging));

		// A driver's tab opens their draw and discard piles, each card
		// inspectable with the hand's detail view (section 5)
		this.handLayer.onOpenPiles = (seat) => {
			const driver = this.playerDrivers[seat - 1];
			if (!driver || this.context.drag.isDragging) return;
			openPileDialog(this.context, {
				driverName: driver.metadata.name,
				driver: seat,
				drawPile: driver.deck?.cards ?? [],
				discardPile: driver.discard,
			});
		};

		// A card that went to its driver's discard pile flies there (DDB-37);
		// an exhausted one, or one taken out of the deck, just goes. The hand
		// hears of it after the next draw, which may already have shuffled
		// the discard back into the deck, so the deck counts as the pile too.
		// One played by a drop leaves from where it was dropped.
		this.handLayer.onCardsLeave = (leaving) => {
			for (const { card, element, seat } of leaving) {
				if (this.flownCards.delete(card)) continue;
				if (!seat || !this.playerDrivers.some(driver => this.wentToDiscard(driver, card))) continue;
				this.fx.flyToDiscard({ card: element, pile: this.handLayer.pilesOf(seat), droppedAtReticle: this.fx.aimingFrom === element });
			}
		};

		// Escape cancels targeting, L or F6 toggles the combat log, and I pins a card, from the
		// screen root's hotkey table, which keys reach after bubbling out of
		// whatever is focused (R9.15)
		const { hotkeys } = this.rootLayer;
		hotkeys.register('Escape', () => this.cancelAim());
		for (const key of LOG_TOGGLE_KEYS) hotkeys.register(key, () => this.toggleCombatLog());
		// I pins the detail view of the card being read, or lets it go
		// (section 5); the controller's inspect button maps here once there
		// is controller input
		for (const key of INSPECT_KEYS) hotkeys.register(key, () => inspectHotkey(this.context));

		// Removed global click handler - it was interfering with vehicle targeting
	}
	
	/**
	 * A driver's whole hand going to the discard at the end of the turn,
	 * told before it leaves the hand, so every card flies from its place
	 * even when the draw that follows shuffles the pile into the deck and
	 * deals some of the same cards straight back.
	 */
	private flyDiscardedHand(driver: Driver, cards: readonly Card[]): void {
		const seat = (this.playerDrivers.indexOf(driver) + 1) as 1 | 2;
		if (seat !== 1 && seat !== 2) return;
		for (const card of cards) {
			const element = this.handLayer.getCardElementByCard(card);
			if (!element?.isMounted) continue;
			this.flownCards.add(card);
			this.fx.flyToDiscard({ card: element, pile: this.handLayer.pilesOf(this.handLayer.seatOf(card) ?? seat) });
		}
	}

	/** In the discard, or shuffled from it back into the deck; not exhausted, not removed. */
	private wentToDiscard(driver: Driver, card: Card): boolean {
		return driver.discard.includes(card) || (driver.deck?.cards.includes(card) ?? false);
	}

	/**
	 * Set up combat model listeners
	 */
	private setupModelListeners(): void {
		this.modelUnsubscribers.push(
			// Listen for when a vehicle is targeted
			this.combatModel.on('targetedVehicle', (vehicle: Vehicle | null) => {
				const card = this.combatModel.selectedCard;
				if (vehicle && card && this.combatModel.selectedDriver) {
					// A card with no target was dropped on a vehicle it acts on; it still plays untargeted
					this.playCardWithTarget(card, this.combatModel.isTargeting ? vehicle : undefined);
				}
			}),

			// Over a raider, an attack order lights up the escort that would
			// carry it out; over any target, the hit check rides with the card
			// and a ghost shows what it takes off the bar it hits
			this.combatModel.on('focusedVehicleId', (vehicleId: string | null) => {
				this.combatModel.carrierVehicleId = this.findOrderCarrierId(vehicleId);
				this.showAimAt(vehicleId);
			}),

			// However targeting ends, the ranges, the ghost, and the hit check go
			this.combatModel.on('selectedCard', (card: Card | null) => {
				if (card) return;
				this.aimPreviews.clear();
				this.road.showRanges(new Map());
				this.showAimAt(null);
			}),
		);
	}

	/**
	 * Every raider's range from the slot the picked card acts from (section
	 * 6): "R1" or "R2" while it's within the card's reach, "OUT" past it,
	 * red-edged where the card can land. Worked out once, with the hit check
	 * and damage the target preview reads.
	 */
	private showRanges(card: Card): void {
		this.aimPreviews.clear();
		const labels = new Map<string, RangeLabel>();
		const battle = this.battle;
		const driver = this.combatModel.selectedDriver;
		if (battle && driver && this.enemyTeam && (card.targetType === 'enemy_single' || card.targetType === 'any')) {
			for (const raider of this.enemyTeam.vehicles) {
				if (raider.isOutOfFight || !raider.slot) continue;
				const preview = previewAim({ battle, driver, card, target: raider });
				this.aimPreviews.set(raider.id, preview);
				if (preview.range === null) continue;
				const inReach = preview.reach === null || preview.range <= preview.reach;
				labels.set(raider.id, { text: inReach ? `R${preview.range}` : 'OUT', legal: this.combatModel.isVehicleTargetable(raider.id) });
			}
		}
		this.road.showRanges(labels);
	}

	/**
	 * The target the pointer or focus is on: a ghost on the bars the card
	 * would hit and, on a raider, the hit check under the card. Null, or a
	 * vehicle the card can't land on, clears both.
	 */
	private showAimAt(vehicleId: string | null): void {
		const card = this.combatModel.selectedCard;
		const driver = this.combatModel.selectedDriver;
		const battle = this.battle;
		const target = vehicleId && this.combatModel.isTargeting && this.combatModel.isVehicleTargetable(vehicleId)
			? [...(this.enemyTeam?.vehicles ?? []), ...(this.playerTeam?.vehicles ?? [])].find(vehicle => vehicle.id === vehicleId) ?? null
			: null;
		if (!card || !driver || !battle || !target) {
			this.road.showDamageGhost(null, null);
			this.fx.showHitCheck(null, null);
			return;
		}
		const preview = this.aimPreviews.get(target.id) ?? previewAim({ battle, driver, card, target });
		const lands = !preview.check || preview.check.hits;
		this.road.showDamageGhost(target.id, lands ? preview.losses : null);
		// On a raider the card hits, not one it only outruns (a flank)
		const onRaider = preview.lands && (this.enemyTeam?.vehicles.includes(target) ?? false);
		this.fx.showHitCheck(onRaider ? this.fx.aimingFrom ?? this.handLayer.getCardElementByCard(card) : null, onRaider ? preview : null);
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
	 * A primary press on a hand card starts a candidate drag (R9.12a) with
	 * the aim reticle as its ghost. A press that never passes the threshold
	 * is still a click, which chooses the card for click-then-target play.
	 */
	private pressCard(card: Card, element: Component, event: UiPointerEvent): void {
		const drag = this.context.drag;
		if (!this.battle?.isPlayerTurn || !element.effectivelyEnabled) return;
		this.fx.prepareAim(event.screen);
		const data: HandCardDrag = { kind: 'hand-card', card };
		drag.start({ event, source: element, ghost: this.fx.reticle, data });
	}

	/**
	 * A card's drag went active: it becomes the chosen card, if it wasn't
	 * already from a click, and the line follows the pointer. When the drag
	 * ends, the line goes.
	 */
	private dragChanged(dragging: boolean): void {
		if (!dragging) {
			this.fx.hideAim();
			return;
		}
		const drag = this.context.drag.current;
		if (!drag || !isHandCardDrag(drag.data)) return;
		const { card } = drag.data;
		if (this.combatModel.selectedCard !== card && !this.chooseCard(card, 'drag')) {
			this.context.drag.cancel();
			return;
		}
		this.fx.showAim(drag.source);
	}

	/**
	 * Choose a card to play. On a click, a card with no target plays at once
	 * and a keyboard player's focus goes to the first target; a dragged card
	 * waits for its drop either way. False when the card can't be played
	 * now.
	 */
	private chooseCard(card: Card, via: 'click' | 'drag'): boolean {
		if (!this.battle || !this.playerTeam) {
			console.warn('No battle or player team');
			return false;
		}

		// Clicking the card that waits for its target puts it back
		if (via === 'click' && this.combatModel.isTargeting && this.combatModel.selectedCard === card) {
			this.putCardBack();
			return false;
		}

		const owningDriver = this.playerDrivers.find(driver => driver.hand.includes(card));
		if (!owningDriver) {
			console.warn('Could not find driver who owns this card');
			return false;
		}

		// Check if driver can afford and play this card
		if (!owningDriver.canPlayCard(card)) {
			const reason = !owningDriver.canAffordCard(card)
				? `${owningDriver.metadata.name}: Not enough adrenaline`
				: `${owningDriver.metadata.name}: Cannot play this card type as passenger`;
			console.log(reason);
			return false;
		}
		const cardBlocker = this.battle.getCardBlocker({ driver: owningDriver, card });
		if (cardBlocker) {
			console.log(`${owningDriver.metadata.name}: ${cardBlocker}`);
			return false;
		}

		this.combatModel.selectCard(card, owningDriver);
		this.keyboardSlot = Math.max(0, this.handLayer.slotOf(card));

		if (!this.combatModel.isTargeting) {
			// No target: a click plays it now. A drag plays when it lands on a
			// vehicle it acts on, as an order lands on its escort (Battle Screen
			// Design section 4); the road takes nothing, so releasing there
			// cancels (section 6)
			if (via === 'click') {
				this.playCardWithTarget(card, undefined);
			} else {
				this.handLayer.selectedCard = card;
				this.handLayer.targetingMode = true;
				this.combatModel.targetableVehicleIds = this.dropVehicles(card);
			}
			return true;
		}

		this.handLayer.selectedCard = card;
		this.handLayer.targetingMode = true;
		this.combatModel.targetableVehicleIds = this.determineTargetableVehicles(card);
		this.showRanges(card);

		// A keyboard player goes straight to the first target; the targets
		// are the only focusable vehicles now (R9.23: programmatic focus
		// keeps the keyboard's visible ring)
		const focus = this.context.focus;
		if (via === 'click' && focus.focusVisible) focus.focusFirst(this.road);
		return true;
	}

	/**
	 * Where a card with no target can be dropped: the vehicle the playing
	 * driver is in for a card on themselves, the raiders for one on all of
	 * them, your convoy for one on both drivers.
	 */
	private dropVehicles(card: Card): string[] {
		const onRoad = (vehicles: readonly Vehicle[] | undefined): string[] =>
			(vehicles ?? []).filter(vehicle => !vehicle.isOutOfFight).map(vehicle => vehicle.id);
		switch (card.targetType) {
			case 'enemy_all':
				return onRoad(this.enemyTeam?.vehicles);
			case 'both_drivers':
				return onRoad(this.playerTeam?.vehicles);
			default: {
				const driver = this.combatModel.selectedDriver;
				return onRoad(this.playerTeam?.vehicles.filter(vehicle => vehicle.driver === driver || vehicle.passenger === driver));
			}
		}
	}

	/** Escape or a right-click: a drag in progress ends, or a card waiting for its target goes back. */
	private cancelAim(): void {
		if (this.context.drag.isDragging) {
			this.context.drag.cancel();
		} else if (this.combatModel.isTargeting) {
			this.putCardBack();
		}
	}

	/** Targeting ends with nothing played: the card goes back to the hand. */
	private putCardBack(): void {
		this.combatModel.cancelSelection();
		this.handLayer.clearCardSelection();
		this.restoreKeyboardFocus();
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
	 * The vehicles a card can land on now, and only those (section 6): the
	 * card's side of the road by its target type, then the battle's own
	 * target rule, the one playCard checks (range, flanking, nobody aboard,
	 * an order's carrier). A drop, a click, or the keyboard can't offer
	 * anything playCard would refuse.
	 */
	private determineTargetableVehicles(card: Card): string[] {
		const battle = this.battle;
		const driver = this.combatModel.selectedDriver;
		if (!this.playerTeam || !this.enemyTeam || !battle || !driver) return [];

		// A wreck, or a vehicle with nobody aboard, still on the road for the
		// rest of the turn is never a target
		const players = this.playerTeam.vehicles.filter(vehicle => !vehicle.isOutOfFight);
		const enemies = this.enemyTeam.vehicles.filter(vehicle => !vehicle.isOutOfFight);

		let candidates: Vehicle[];
		if (card.isOrder) {
			// An order's targets depend on the convoy, so its rule picks the side
			candidates = [...players, ...enemies];
		} else {
			switch (card.targetType) {
				case 'enemy_single':
					candidates = enemies;
					break;
				case 'self':
					// Only the vehicle the playing driver is in, driving or riding
					candidates = players.filter(vehicle => vehicle.driver === driver || vehicle.passenger === driver);
					break;
				case 'ally':
					candidates = players;
					break;
				case 'any':
					candidates = [...players, ...enemies];
					break;
				default:
					candidates = [];
			}
		}
		return candidates
			.filter(target => battle.getTargetBlocker({ driver, card, target }) === null)
			.map(vehicle => vehicle.id);
	}





	// Removed deprecated methods - now handled by Battle system

	/**
	 * End the player's turn. The raiders then act one at a time on the
	 * pacer's beats (stepEnemyTurn), with the dock locked, and the player's
	 * draw comes after the last of them.
	 */
	private endPlayerTurn(): void {
		if (!this.battle?.isPlayerTurn || this.battle.battleOver || this.enemyTurnPacer?.running) return;

		// A card still aimed (picked with the keyboard, then Tab to END TURN)
		// goes back, so no range, outline, or hit check rides into the enemy turn
		this.cancelAim();

		console.log('Ending player turn...');
		this.battle.endPlayerTurn({ stepEnemyTurn: true });
		if (!this.isActive) return;
		this.updateUIFromBattle();
		// From when ENEMY TURN shows, which waits for a banner already up to leave
		this.enemyTurnPacer?.start(this.turnBanner.timeToNext + ENEMY_TURN_LEAD_IN);
	}

	/**
	 * One beat of the enemy turn: the next raider action, and how long until
	 * the one after, or null once the player's turn has begun or the battle
	 * is over. A raider dropping the rest of its plan shows nothing, so it
	 * takes no beat. A hit or a miss pops its own number as it resolves; a
	 * card that fizzled pops a miss on where it was headed.
	 */
	private playEnemyBeat(): number | null {
		const battle = this.battle;
		if (!battle || !this.isActive) return null;
		let step: EnemyTurnStep | null;
		do {
			step = battle.stepEnemyTurn();
		} while (step?.outcome === 'dropped');
		if (!this.isActive) return null;

		this.enemyActing = step?.raider ?? null;
		if (step?.outcome === 'fizzled' && step.target) this.popHitNumber({ vehicle: step.target, damage: null });
		this.updateUIFromBattle();
		// A loss ends the battle, which navigates away through the transition;
		// the screen stays up, locked, under the fade and takes no more beats
		if (battle.battleOver) return null;
		if (step) return ENEMY_ACTION_BEAT;
		this.restoreKeyboardFocus();
		return null;
	}

	/** The raider acting on screen now, for the enemy turn's glow (DDB-139). */
	public get actingRaider(): Vehicle | null {
		return this.enemyActing;
	}

	/**
	 * Toggle combat log visibility
	 */
	private toggleCombatLog(): void {
		this.combatLogLayer.toggle();
	}

	
	/** The battle's state, while there is a battle. */
	public get battleState(): BattleState | null {
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
		this.enemyTurnPacer = new EnemyTurnPacer({
			frame: this.context.frame,
			clock: this.context.clock,
			onBeat: () => this.playEnemyBeat(),
		});
		this.setupModelListeners();
		// `openLog` mounts with the drawer open, for the log's golden and lint gate
		if (data && typeof data === 'object' && (data as { openLog?: unknown }).openLog === true) this.combatLogLayer.openDrawer();

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

		this.dragUnsubscribe?.();
		this.dragUnsubscribe = null;
		this.enemyTurnPacer?.stop();
		this.enemyTurnPacer = null;
		this.enemyActing = null;

		// Cancel any active targeting
		if (this.combatModel.isTargeting) {
			this.combatModel.cancelSelection();
			this.handLayer.clearCardSelection();
		}

		// Remove every layer so a remount builds them fresh; removeChild
		// unmounts each one, cards included
		for (const layer of [...this.rootLayer.children]) {
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