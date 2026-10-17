import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { ScreenName } from '../../core/ScreenManager';
import { loadedCardLookup } from '../../core/CardLoader';
import { CampaignVisit } from '../../core/CampaignVisit';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStore } from '../../campaign/CampaignStore';
import { departRun, getDepartBlocker, routesOnOffer } from '../../campaign/SupplyRun';
import { CardCounts, totalCards } from '../../campaign/CardCounts';
import type { DriverRecord } from '../../campaign/DriverRecord';
import type { Component } from '../../../engine/components/Component';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Divider } from '../../../engine/ui/Divider';
import { Panel } from '../../../engine/ui/Panel';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import { DRIVER_CONFIGS } from '../../mechanics/Driver';
import type { Card as GameCard } from '../../mechanics/Card';
import type { Vehicle } from '../../mechanics/Vehicle';
import { Card as UICard, CardSize, MINI_GRID, MiniCardState } from '../../ui/Card';
import { INSPECT_KEYS, inspectHotkey, inspectOnContextMenu, makeDriverInspectable, makeEscortInspectable, makeInspectable } from '../../ui/cardInspect';
import { DRIVER_CARD_INK, DRIVER_CARD_SIZE, DriverCard, DriverCardStatus } from '../../ui/DriverCard';
import { driverCardData } from '../../ui/driverCardData';
import { CardLookup, deckOrder } from '../../ui/DriverDetailView';
import { EscortCard } from '../../ui/EscortCard';
import { escortCardDataOf } from '../../ui/escortCardData';
import { FlowWrap } from '../../ui/FlowWrap';
import { PlanningMaps } from '../area-map/planningMap';
import { departRefusal } from '../run/runText';
import { LoadOutPlan, SEAT_COUNT } from './LoadOutPlan';
import {
	ESCORT_CAPTION,
	SOLO_SEAT,
	STRANDED_LOAD_OUT,
	SOLO_SYNERGY,
	POOL_NOTE,
	deckCaption,
	pairSynergy,
	readyText,
	seatTitle,
	standingText,
	startBlockerText,
} from './loadOutText';

const { space, fontSize } = tokens;
const TOP_BAR_HEIGHT = 64;
const SUMMARY_BAR_HEIGHT = 72;
/** A button doesn't hug its label, so these have widths that fit theirs. */
const BACK_WIDTH = 104;
const START_WIDTH = 168;
const SWAP_WIDTH = 112;
/** A seat's left column: the driver card, its vehicle, and the two seat buttons. */
const SEAT_COLUMN_WIDTH = DRIVER_CARD_SIZE.width + DRIVER_CARD_INK * 2;
/** A pool entry: the card, Seat under it, and two lines for why they can't go ("Same archetype as a seated driver"). */
const POOL_ENTRY = { width: 128, reasonSize: fontSize.fs_xs, reasonLine: 14, reasonLines: 2 } as const;
/** The convoy panel holds four escort cards abreast, the most a convoy has. */
const CONVOY_WIDTH = 432;
const CARDS_LOADING = 'Loading the cards.';
const CARDS_FAILED = "The cards couldn't be loaded.";
const LOOKING = 'Looking for the saved campaign.';
const NO_ROUTE = 'Pick a route first: load out was opened without one.';
const MONO_CAPTION = { fontRole: 'mono', fontSize: fontSize.fs_xs, color: 'text_dim', textTransform: 'uppercase' } as const;

/** An escort in the convoy: a hired vehicle (`Vehicle.isEscort`). */
export type Escort = Vehicle;

/**
 * What the run route screen opens load out with, all plain data, so
 * Customize can hand it back and a screen capture can hand it over.
 */
export interface LoadOutScreenData {
	campaign: Campaign;
	/** The POI by its index in the map's POI layer, which Back hands the run route screen. */
	poi: number;
	/** The picked route's id (`routeId`), set off on at START RUN against the campaign's map. */
	route: string;
	/** The destination and the route, e.g. "St. Brendan's Hospital by Back roads". */
	heading: string;
	/** e.g. "4 stops / fuel 4 / home by 17:30". */
	summary?: string;
}

/**
 * What the developer launcher adds: where this visit and Customize save,
 * in place of the shared store, so trying the screen leaves the player's
 * save alone, and where Back goes with no POI to go back to. The run route
 * screen leaves them out.
 */
export interface LoadOutLaunch extends LoadOutScreenData {
	store: CampaignStore;
	returnTo: ScreenName;
}

export interface LoadOutScreenOptions {
	/** Where the campaign is saved, and loaded from when none is handed over. Default: the game's shared store. */
	store?: CampaignStore;
	/** The game's cards, to draw the minis and the detail views. Default: the card loader's, loaded if they aren't yet. */
	cards?: () => Promise<CardLookup>;
	/** Where the campaign's map comes from, for the route START RUN sets off on. Default: the session's (`PlanningMaps.shared`). */
	maps?: PlanningMaps;
}

/** One seat's parts, built once and shown again on every refresh. */
interface SeatView {
	panel: Panel;
	empty: Text;
	body: Stack;
	card: DriverCard;
	inspectable: boolean;
	vehicle: Text;
	clear: Button;
	customize: Button;
	caption: Text;
	deck: FlowWrap;
	deckNote: Text;
}

/** One mini in a seat's deck: a card's copies, plain, borrowed, or an escort's locked card. */
interface DeckMini {
	key: string;
	card: GameCard;
	copies: number;
	state: MiniCardState | null;
}

/** A pool driver's card, Seat, and why they can't go. */
class PoolEntry extends Stack {
	public readonly card: DriverCard;
	public readonly seatButton: Button;
	public readonly reason: Text;
	public inspectable = false;

	constructor({ id }: { id: string }) {
		super({ id, width: POOL_ENTRY.width, crossAlign: 'stretch' });
		this.card = new DriverCard({ id: `${id}_card`, data: driverCardData({ archetype: 'road_warrior' }) });
		this.card.focusable = true;
		this.card.alignSelf = 'center';
		this.seatButton = new Button({ id: `${id}_seat_button`, label: 'Seat', size: 'sm', block: true, margin: { top: DRIVER_CARD_INK + space.space_1 } });
		this.reason = new Text({
			id: `${id}_reason`,
			height: POOL_ENTRY.reasonLine * POOL_ENTRY.reasonLines,
			widthMode: 'fill',
			margin: { top: space.space_1 },
			style: { fontSize: POOL_ENTRY.reasonSize, color: 'text_dim', textAlign: 'center' },
			lineHeight: POOL_ENTRY.reasonLine / POOL_ENTRY.reasonSize,
			verticalAlign: 'top',
			wrap: 'word',
			textOverflow: 'ellipsis',
		});
		this.addChild(this.card);
		this.addChild(this.seatButton);
		this.addChild(this.reason);
	}
}

/**
 * Load out (Game Flow 1.2): the last step before a supply run leaves. Two
 * seats across the top, each with its driver's card, vehicle, Clear seat,
 * and Customize, and the deck they'll take as view-only minis; under them
 * the pool, every driver at the compound with Seat and why one can't go,
 * and the convoy, the pair's synergy over the escorts, each brought or
 * left at home with a click. A summary bar at the foot holds the
 * destination and START RUN, disabled with its reason until two seated
 * drivers can go together.
 *
 * What's picked, and the run deck lifecycle, is a `LoadOutPlan`; the
 * screen shows it and saves each change it makes to the campaign through
 * a `CampaignVisit`, as the Crew screen and Customize do. The run decks
 * start the first time Customize or START RUN needs them. START RUN sets
 * off on the route the run route screen picked (`departRun`), saves, and
 * opens the run screen; a departure that's refused says why and leaves
 * the run decks out for another try. Back unwinds them and returns to the
 * run route screen, so a run started here is never left out.
 *
 * Opened with no campaign, as the screen captures do, it loads the save as
 * Continue would; with no route, Back goes to the compound and START RUN
 * says there's no route to run.
 *
 * Focus starts on START RUN when it's live, else on Back. Escape is Back,
 * unless a pinned detail view takes it first; I and a secondary click pin
 * a card's detail view.
 */
export class LoadOutScreen extends Screen {
	private readonly stack: Stack;
	private readonly store: CampaignStore;
	private readonly loadCards: () => Promise<CardLookup>;
	private readonly maps: PlanningMaps;
	private readonly session = new CampaignVisit({ name: 'LoadOutScreen' });
	/** Counts mounts and unmounts, so a departure that settles after the screen has gone changes nothing. */
	private visit = 0;
	/** Why the last START RUN didn't set off, until the plan changes. */
	private refusal: string | null = null;
	/** The store has moved on from this campaign: nothing here is saved, and Back goes to the menu. */
	private stranded = false;
	/** What it was opened with, minus the campaign, which Customize hands back. */
	private handed: Partial<LoadOutLaunch> = {};
	private campaign: Campaign | null = null;
	private planned: LoadOutPlan | null = null;
	private lookup: CardLookup | null = null;
	/** The cards once they've loaded, and none before, for the minis and the detail views. */
	private readonly cards: CardLookup = (type) => this.lookup?.(type) ?? null;
	private trouble: string | null = null;
	private cardsState: 'loading' | 'ready' | 'failed' = 'loading';
	private departed = false;
	private seats: SeatView[] = [];
	private pool: FlowWrap | null = null;
	private swapButton: Button | null = null;
	private synergy: Text | null = null;
	private synergyWarning: Text | null = null;
	private escorts: FlowWrap | null = null;
	private escortNote: Text | null = null;
	private summaryLine: Text | null = null;
	private startButton: Button | null = null;
	private unsubscribe: (() => void)[] = [];
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared, cards = loadedCardLookup, maps = PlanningMaps.shared }: LoadOutScreenOptions = {}) {
		const root = new Stack({
			id: 'loadOutScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			style: { backgroundColor: 'bg_base' },
		});
		super('loadOutScreen', { root });
		this.stack = root;
		this.store = store;
		this.loadCards = cards;
		this.maps = maps;
	}

	/** The campaign on show, once there is one. */
	public get shown(): Campaign | null {
		return this.campaign;
	}

	/** What's picked, once there's a campaign. */
	public get plan(): LoadOutPlan | null {
		return this.planned;
	}

	/** Settles once the campaign and the cards have loaded and been shown, or failed to. */
	public get campaignLoaded(): Promise<void> {
		return this.loaded;
	}

	protected onMount(data?: unknown): void {
		this.visit += 1;
		const { campaign, ...rest } = (data ?? {}) as Partial<LoadOutLaunch>;
		this.handed = rest;

		const back = new Button({
			label: 'Back',
			id: 'load_out_back_button',
			icon: 'arrow_back',
			size: 'sm',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		});
		this.stack.addChild(this.createTopBar(back));
		this.stack.addChild(new Divider({ id: 'load_out_top_rule' }));
		const saveError = new Text({
			id: 'load_out_save_error',
			visible: false,
			widthMode: 'fill',
			margin: { top: space.space_3, left: space.space_4, right: space.space_4 },
			style: { fontSize: 'fs_sm', color: 'status_crit' },
		});
		this.stack.addChild(saveError);
		this.stack.addChild(this.createBody());
		this.stack.addChild(new Divider({ id: 'load_out_summary_rule' }));
		this.stack.addChild(this.createSummaryBar());

		const { hotkeys } = this.rootLayer;
		hotkeys.register('Escape', () => this.back());
		for (const key of INSPECT_KEYS) hotkeys.register(key, () => inspectHotkey(this.context));
		this.session.start({ store: rest.store ?? this.store, saveError });

		this.loaded = this.session.load({
			handed: campaign ?? null,
			cards: this.loadCards,
			show: (shown) => this.show(shown),
			missing: (trouble) => {
				this.trouble = trouble;
				this.refreshSummary();
			},
			cardsLoaded: (lookup) => {
				this.lookup = lookup;
				this.cardsState = lookup ? 'ready' : 'failed';
				this.refresh();
			},
		});
		// A handed-over campaign is shown by now, so START RUN knows whether it's live.
		const start = this.startButton;
		this.context.focus.focus(start?.enabled ? start : back);
	}

	protected onUnmount(): void {
		this.visit += 1;
		this.session.stop();
		this.refusal = null;
		this.stranded = false;
		const { hotkeys } = this.rootLayer;
		for (const key of ['Escape', ...INSPECT_KEYS]) hotkeys.unregister(key);
		this.unsubscribe.forEach((unsubscribe) => unsubscribe());
		this.unsubscribe = [];
		this.stack.clearChildren();
		this.handed = {};
		this.campaign = null;
		this.planned = null;
		this.lookup = null;
		this.trouble = null;
		this.cardsState = 'loading';
		this.departed = false;
		this.seats = [];
		this.pool = null;
		this.swapButton = null;
		this.synergy = null;
		this.synergyWarning = null;
		this.escorts = null;
		this.escortNote = null;
		this.summaryLine = null;
		this.startButton = null;
	}

	private createTopBar(back: Button): Stack {
		const bar = new Stack({
			id: 'load_out_top_bar',
			direction: 'horizontal',
			widthMode: 'fill',
			height: TOP_BAR_HEIGHT,
			padding: { left: space.space_4, right: space.space_4 },
			crossAlign: 'center',
			gap: space.space_4,
			style: { backgroundColor: 'bg_panel' },
		});
		bar.addChild(back);
		const heading = new Stack({ id: 'load_out_heading', widthMode: 'fill', crossAlign: 'stretch' });
		heading.addChild(new Text({
			text: 'Load out',
			id: 'load_out_title',
			style: { fontRole: 'display', fontSize: 'fs_xl', color: 'text_bright', textTransform: 'uppercase', letterSpacing: 'ls_wide' },
			wrap: 'none',
		}));
		heading.addChild(new Text({
			text: 'Two drivers / their decks / the escorts coming along',
			id: 'load_out_kicker',
			widthMode: 'fill',
			style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_dim', textTransform: 'uppercase' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));
		bar.addChild(heading);
		return bar;
	}

	/** The seats over the pool and the convoy, scrolling where the window is short. */
	private createBody(): ScrollContainer {
		const scroll = new ScrollContainer({ id: 'load_out_scroll', widthMode: 'fill', heightMode: 'fill' });
		const content = new Stack({ id: 'load_out_content', widthMode: 'fill', crossAlign: 'stretch', gap: space.space_3, padding: space.space_4 });
		const seatRow = new Stack({ id: 'load_out_seats', direction: 'horizontal', widthMode: 'fill', crossAlign: 'stretch', gap: space.space_3 });
		this.seats = Array.from({ length: SEAT_COUNT }, (_, seat) => this.createSeat(seat));
		this.seats.forEach(({ panel }) => seatRow.addChild(panel));
		content.addChild(seatRow);
		const lower = new Stack({ id: 'load_out_lower', direction: 'horizontal', widthMode: 'fill', crossAlign: 'stretch', gap: space.space_3 });
		lower.addChild(this.createPool());
		lower.addChild(this.createConvoy());
		content.addChild(lower);
		scroll.addChild(content);
		return scroll;
	}

	/** A seat: "Choose a driver" until filled, then the driver's card and buttons beside their deck. */
	private createSeat(seat: number): SeatView {
		const id = `load_out_seat_${seat + 1}`;
		const panel = new Panel({ id: `${id}_panel`, title: seatTitle(seat), compact: true, widthMode: 'fill', crossAlign: 'stretch' });
		const empty = new Text({ id: `${id}_empty`, text: 'Choose a driver', widthMode: 'fill', style: { fontSize: 'fs_base', color: 'text_dim' } });
		const body = new Stack({ id: `${id}_body`, direction: 'horizontal', widthMode: 'fill', gap: space.space_3, visible: false });

		const column = new Stack({ id: `${id}_column`, width: SEAT_COLUMN_WIDTH, crossAlign: 'stretch', gap: space.space_2, margin: { top: DRIVER_CARD_INK } });
		const card = new DriverCard({ id: `${id}_card`, data: driverCardData({ archetype: 'road_warrior' }) });
		card.focusable = true;
		card.alignSelf = 'center';
		const vehicle = new Text({ id: `${id}_vehicle`, widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim', textAlign: 'center' }, wrap: 'none', textOverflow: 'ellipsis' });
		const clear = new Button({ id: `${id}_clear_button`, label: 'Clear seat', size: 'sm', block: true, onClick: () => this.clearSeat(seat) });
		// A stable id, so Done in Customize lands back on it (ScreenManager's restoreFocus).
		const customize = new Button({ id: `${id}_customize_button`, label: 'Customize', size: 'sm', block: true, onClick: () => this.customize(seat) });
		for (const child of [card, vehicle, clear, customize]) column.addChild(child);
		body.addChild(column);

		const deckColumn = new Stack({ id: `${id}_deck_column`, widthMode: 'fill', crossAlign: 'stretch', gap: space.space_1 });
		const caption = new Text({ id: `${id}_deck_caption`, widthMode: 'fill', style: MONO_CAPTION, wrap: 'none', textOverflow: 'ellipsis' });
		const deck = new FlowWrap({ id: `${id}_deck`, margin: MINI_GRID.margin, gap: MINI_GRID.gap, focusGroup: { orientation: 'horizontal' }, visible: false });
		const deckNote = new Text({ id: `${id}_deck_note`, text: CARDS_LOADING, widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' } });
		for (const child of [caption, deck, deckNote]) deckColumn.addChild(child);
		body.addChild(deckColumn);
		inspectOnContextMenu(body);

		panel.addChild(empty);
		panel.addChild(body);
		return { panel, empty, body, card, inspectable: false, vehicle, clear, customize, caption, deck, deckNote };
	}

	private createPool(): Panel {
		const panel = new Panel({ id: 'load_out_pool_panel', title: 'Driver pool', compact: true, widthMode: 'fill', crossAlign: 'stretch', gap: space.space_2 });
		panel.addChild(new Text({ id: 'load_out_pool_note', text: POOL_NOTE, widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' } }));
		this.pool = new FlowWrap({ id: 'load_out_pool', margin: MINI_GRID.margin, gap: MINI_GRID.gap, focusGroup: { orientation: 'horizontal' } });
		inspectOnContextMenu(this.pool);
		panel.addChild(this.pool);
		return panel;
	}

	/** The pair's synergy, then the convoy's escorts as cards, each a click to bring or leave. */
	private createConvoy(): Panel {
		const panel = new Panel({ id: 'load_out_convoy_panel', title: 'Convoy', compact: true, width: CONVOY_WIDTH, crossAlign: 'stretch', gap: space.space_2 });
		const head = new Stack({ id: 'load_out_synergy_head', direction: 'horizontal', widthMode: 'fill', crossAlign: 'center', gap: space.space_2 });
		head.addChild(new Text({ id: 'load_out_synergy_caption', text: 'Synergy', widthMode: 'fill', style: MONO_CAPTION, wrap: 'none' }));
		this.swapButton = new Button({ id: 'load_out_swap_button', label: 'Swap seats', size: 'sm', width: SWAP_WIDTH, disabled: true, onClick: () => this.swapSeats() });
		head.addChild(this.swapButton);
		panel.addChild(head);
		this.synergy = new Text({ id: 'load_out_synergy', widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text' } });
		this.synergyWarning = new Text({ id: 'load_out_synergy_warning', visible: false, widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'status_warn' } });
		panel.addChild(this.synergy);
		panel.addChild(this.synergyWarning);
		panel.addChild(new Text({ id: 'load_out_escort_caption', text: ESCORT_CAPTION, widthMode: 'fill', margin: { top: space.space_2 }, style: MONO_CAPTION, wrap: 'none', textOverflow: 'ellipsis' }));
		this.escorts = new FlowWrap({ id: 'load_out_escorts', margin: MINI_GRID.margin, gap: MINI_GRID.gap, focusGroup: { orientation: 'horizontal' }, visible: false });
		inspectOnContextMenu(this.escorts);
		this.escortNote = new Text({ id: 'load_out_escort_note', widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' } });
		panel.addChild(this.escorts);
		panel.addChild(this.escortNote);
		return panel;
	}

	/** The destination and its summary, what's going or why it can't, and START RUN. */
	private createSummaryBar(): Stack {
		const bar = new Stack({
			id: 'load_out_summary_bar',
			direction: 'horizontal',
			widthMode: 'fill',
			height: SUMMARY_BAR_HEIGHT,
			padding: { left: space.space_4, right: space.space_4 },
			crossAlign: 'center',
			gap: space.space_4,
			style: { backgroundColor: 'bg_panel' },
		});
		const words = new Stack({ id: 'load_out_summary', widthMode: 'fill', crossAlign: 'stretch', gap: space.space_1 });
		const route = new Stack({ id: 'load_out_route', direction: 'horizontal', widthMode: 'fill', crossAlign: 'center', gap: space.space_3 });
		const { heading = '', summary = '' } = this.handed;
		route.addChild(new Text({
			id: 'load_out_destination',
			text: heading || 'No route picked',
			maxSize: { width: 420 },
			style: { fontRole: 'display', fontSize: 'fs_lg', color: heading ? 'text_bright' : 'text_dim' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));
		route.addChild(new Text({
			id: 'load_out_route_summary',
			text: summary,
			visible: summary !== '',
			widthMode: 'fill',
			style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_dim', textTransform: 'uppercase' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));
		words.addChild(route);
		this.summaryLine = new Text({ id: 'load_out_summary_line', text: LOOKING, widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' }, wrap: 'none', textOverflow: 'ellipsis' });
		words.addChild(this.summaryLine);
		bar.addChild(words);
		this.startButton = new Button({
			id: 'load_out_start_button',
			label: 'START RUN',
			tone: 'accent',
			size: 'lg',
			width: START_WIDTH,
			disabled: true,
			onClick: () => { void this.depart(); },
		});
		bar.addChild(this.startButton);
		return bar;
	}

	private show(campaign: Campaign): void {
		this.campaign = campaign;
		this.planned = new LoadOutPlan({ campaign, changed: () => this.session.checkpoint(campaign) });
		this.unsubscribe.push(campaign.on('change', () => this.refresh()));
		this.refresh();
	}

	/** Everything that reads the plan, again. */
	private refresh(): void {
		const plan = this.planned;
		if (!plan) return;
		this.seats.forEach((view, seat) => this.refreshSeat(view, seat, plan));
		this.refreshPool(plan);
		this.refreshConvoy(plan);
		this.refreshSummary();
	}

	private refreshSeat(view: SeatView, seat: number, plan: LoadOutPlan): void {
		const driver = plan.seats[seat];
		view.empty.visible = driver === null;
		view.body.visible = driver !== null;
		view.empty.text = seat >= plan.seatsNeeded ? SOLO_SEAT : 'Choose a driver';
		if (!driver) return;
		const runDeck = plan.runDeckAt(seat);
		const deck = runDeck?.cards ?? driver.defaultDeck;
		view.card.data = this.cardData(driver, deck);
		view.card.customDeck = runDeck?.isCustomized ?? false;
		view.card.unavailable = plan.standing(driver).kind === 'blocked';
		this.makeInspectable(view);
		view.vehicle.text = DRIVER_CONFIGS[driver.archetype].metadata.vehicleName;
		const over = plan.campaign.isOver;
		this.setEnabled(view.clear, !over && !this.departed, view.card);
		this.setEnabled(view.customize, !this.departed && plan.canCustomize(seat), view.card);
		view.caption.text = deckCaption(runDeck?.deckSize ?? totalCards(deck));

		const minis = this.cardsState === 'ready' ? this.deckMinis(plan, seat) : [];
		view.deck.reconcileChildren(minis, {
			key: (mini) => mini.key,
			create: (mini) => {
				const card = new UICard({ id: `${view.deck.id}_${mini.key}`, x: 0, y: 0, data: mini.card, size: CardSize.MINI, copies: mini.copies, miniState: mini.state });
				card.focusable = true;
				makeInspectable(card);
				return card;
			},
			update: (card: UICard, mini) => {
				card.copies = mini.copies;
				card.miniState = mini.state;
			},
		});
		view.deck.visible = minis.length > 0;
		view.deckNote.text = this.cardsState === 'loading' ? CARDS_LOADING : this.cardsState === 'failed' ? CARDS_FAILED : 'No cards in this deck.';
		view.deckNote.visible = minis.length === 0;
	}

	/**
	 * A seat's deck as minis, cheapest first: the run deck's own copies, its
	 * borrowed ones (+N), and its escort cards (LOCKED) once it's out; before
	 * that the default deck, with the escorts' cards Driver 1 will take.
	 */
	private deckMinis(plan: LoadOutPlan, seat: number): DeckMini[] {
		const driver = plan.seats[seat];
		if (!driver) return [];
		const runDeck = plan.runDeckAt(seat);
		const minis: DeckMini[] = [];
		const add = (key: string, cardType: string, copies: number, state: MiniCardState | null): void => {
			const card = this.cards(cardType);
			if (card && copies > 0) minis.push({ key, card, copies, state });
		};
		for (const [cardType, copies] of Object.entries(runDeck?.own ?? driver.defaultDeck)) add(cardType, cardType, copies, null);
		if (runDeck) {
			for (const [cardType, copies] of Object.entries(runDeck.borrowed)) add(`${cardType}-borrowed`, cardType, copies, 'borrowed');
			for (const { cardType, broughtBy } of runDeck.escortCards) add(broughtBy, cardType, 1, 'locked');
		} else if (seat === 0) {
			for (const escort of plan.escorts) {
				const signature = escort.escort?.signatureCard;
				if (signature && escort.convoyId) add(escort.convoyId, signature, 1, 'locked');
			}
		}
		return minis.sort((a, b) => deckOrder(a.card, b.card) || a.key.localeCompare(b.key));
	}

	private refreshPool(plan: LoadOutPlan): void {
		const pool = this.pool;
		if (!pool) return;
		pool.reconcileChildren(plan.pool, {
			key: (driver) => driver.id,
			create: (driver) => {
				const entry = new PoolEntry({ id: `load_out_pool_${driver.id}` });
				entry.seatButton.onClick = () => this.seatDriver(driver);
				this.showPoolEntry(entry, driver, plan);
				return entry;
			},
			update: (entry: PoolEntry, driver) => this.showPoolEntry(entry, driver, plan),
		});
	}

	private showPoolEntry(entry: PoolEntry, driver: DriverRecord, plan: LoadOutPlan): void {
		const standing = plan.standing(driver);
		const runDeck = plan.campaign.runDeckOf(driver);
		entry.card.data = this.cardData(driver, runDeck?.cards ?? driver.defaultDeck);
		entry.card.status = poolStatus(driver, standing.kind === 'seated' ? standing.seat : null);
		entry.card.customDeck = runDeck?.isCustomized ?? false;
		entry.card.unavailable = standing.kind === 'blocked';
		if (this.lookup && !entry.inspectable) {
			makeDriverInspectable(entry.card, { cards: this.cards });
			entry.inspectable = true;
		}
		const { label, reason } = standingText(standing);
		entry.seatButton.label = label;
		this.setEnabled(entry.seatButton, standing.kind === 'free' && !this.departed, entry.card);
		entry.reason.text = reason;
	}

	private refreshConvoy(plan: LoadOutPlan): void {
		const [first, second] = plan.seats;
		if (this.swapButton) this.setEnabled(this.swapButton, plan.canSwap && !this.departed && !this.stranded, this.startButton);
		const synergy = this.synergy;
		const warning = this.synergyWarning;
		if (synergy && warning) {
			const analysis = first && second ? pairSynergy(first, second) : null;
			const solo = plan.seatsNeeded === 1;
			synergy.text = analysis?.description ?? (solo ? SOLO_SYNERGY : 'Seat two drivers to see how they work together.');
			synergy.color = analysis || solo ? 'text' : 'text_dim';
			warning.text = analysis?.warning ?? '';
			warning.visible = Boolean(analysis?.warning);
		}

		const row = this.escorts;
		const note = this.escortNote;
		if (!row || !note) return;
		const escorts = this.cardsState === 'ready' ? plan.campaign.convoy.escorts : [];
		row.reconcileChildren(escorts, {
			key: (escort) => escort.convoyId ?? escort.name,
			create: (escort) => {
				const card = new EscortCard({ id: `load_out_escort_${escort.convoyId}`, data: escortCardDataOf(escort), cards: this.cards });
				card.focusable = true;
				card.onSelect = () => this.toggleEscort(escort);
				makeEscortInspectable(card);
				this.showEscort(card, escort, plan);
				return card;
			},
			update: (card: EscortCard, escort) => this.showEscort(card, escort, plan),
		});
		row.visible = escorts.length > 0;
		const none = plan.campaign.convoy.escorts.length === 0;
		note.text = none ? 'No escorts in the convoy.' : this.cardsState === 'failed' ? CARDS_FAILED : CARDS_LOADING;
		note.visible = escorts.length === 0;
	}

	private showEscort(card: EscortCard, escort: Escort, plan: LoadOutPlan): void {
		card.data = escortCardDataOf(escort);
		card.staying = plan.isStaying(escort);
		card.enabled = plan.canToggle(escort) && !this.departed && !this.stranded;
	}

	/** START RUN and the line beside it: what's going, or why it can't. */
	private refreshSummary(): void {
		const line = this.summaryLine;
		const start = this.startButton;
		if (!line || !start) return;
		const plan = this.planned;
		let text: string;
		let live = false;
		let color: ColorToken = 'text_dim';
		if (!plan) {
			text = this.trouble ?? LOOKING;
		} else {
			const blocker = plan.startBlocker;
			if (this.stranded) {
				text = STRANDED_LOAD_OUT;
				color = 'status_warn';
			} else if (blocker) text = startBlockerText(blocker, plan.campaign.end);
			else if (!this.handed.route) text = NO_ROUTE;
			else if (this.departed) text = 'Setting off.';
			else if (this.refusal) {
				text = this.refusal;
				color = 'status_crit';
				live = true;
			} else {
				text = readyText(plan);
				color = 'text';
				live = true;
			}
		}
		line.text = text;
		line.color = color;
		this.setEnabled(start, live, this.rootLayer.findById('load_out_back_button'));
	}

	/** A control on or off; one that goes off under focus hands it to `heir` rather than dropping it (R9.28). */
	private setEnabled(control: Button, live: boolean, heir: Component | null): void {
		if (!live && control.enabled && this.context.focus.focused === control && heir?.canReceiveFocus()) this.context.focus.focus(heir);
		control.enabled = live;
	}

	/** A seat's card opens its detail view once the cards are there to draw its deck. */
	private makeInspectable(view: SeatView): void {
		if (!this.lookup || view.inspectable) return;
		makeDriverInspectable(view.card, { cards: this.cards });
		view.inspectable = true;
	}

	private cardData(driver: DriverRecord, deck: CardCounts) {
		return driverCardData({
			archetype: driver.archetype,
			name: driver.name,
			hitpoints: driver.hitpoints,
			maxHitpoints: driver.maxHitpoints,
			handLimit: driver.handLimit,
			deck,
		});
	}

	private seatDriver(driver: DriverRecord): void {
		this.change((plan) => plan.seat(driver));
	}

	private clearSeat(seat: number): void {
		this.change((plan) => plan.clear(seat));
	}

	private swapSeats(): void {
		this.change((plan) => plan.swap());
	}

	private toggleEscort(escort: Escort): void {
		this.change((plan) => plan.toggleEscort(escort));
	}

	/** A pick changed, which clears why the last START RUN didn't set off. */
	private change(pick: (plan: LoadOutPlan) => void): void {
		const plan = this.planned;
		if (!plan || this.departed || this.stranded) return;
		pick(plan);
		this.refusal = null;
		this.refresh();
	}

	/**
	 * Opens Customize on a seat's run deck, starting the run decks first if
	 * they aren't out. Done comes back here with what this screen was handed
	 * and the campaign, focus on this seat's Customize.
	 */
	private customize(seat: number): void {
		const plan = this.planned;
		const driver = plan?.seats[seat];
		if (!plan || !driver || this.departed || !plan.canCustomize(seat)) return;
		plan.start();
		const { store } = this.handed;
		ScreenManager.navigate('customizeScreen', {
			campaign: plan.campaign,
			driver,
			returnTo: 'loadOutScreen',
			returnData: { ...this.handed },
			...(store ? { store } : {}),
		});
	}

	/**
	 * START RUN: the run decks out, then the departure on the picked route
	 * against the campaign's map, then the checkpoint and the run screen,
	 * handed the save's result so it can say a save failed. A departure
	 * that's refused says why, leaving the run decks out and START RUN live.
	 * A save the store has moved on from stays here, saying nothing more is
	 * saved, with Back going to the menu.
	 */
	private async depart(): Promise<void> {
		const plan = this.planned;
		const id = this.handed.route;
		if (!plan || !id || this.departed || this.stranded || plan.startBlocker) return;
		const { campaign } = plan;
		const visit = this.visit;
		this.departed = true;
		this.refusal = null;
		this.refresh();
		try {
			const map = this.maps.known(campaign) ?? await this.maps.load(campaign);
			if (visit !== this.visit) return;
			const route = routesOnOffer({ map, campaign }).find((offered) => offered.id === id);
			if (!route) throw new RangeError("That route isn't on the area map any more. Back to pick another.");
			const blocker = getDepartBlocker({ campaign, route });
			if (blocker) throw new Error(departRefusal(blocker));
			plan.start();
			departRun({ campaign, map, route, escorts: plan.escorts });
		} catch (error) {
			if (visit !== this.visit) return;
			console.error('LoadOutScreen: the run could not set off', error);
			this.refusal = error instanceof Error ? error.message : "The run couldn't set off.";
			this.departed = false;
			this.refresh();
			return;
		}
		const result = await this.session.checkpoint(campaign);
		if (visit !== this.visit) return;
		if (result === 'retired') {
			this.departed = false;
			this.stranded = true;
			this.refresh();
			return;
		}
		ScreenManager.navigate('runScreen', { campaign, saved: Promise.resolve(result ?? 'saved') });
	}

	/**
	 * Back: any run decks out are unwound, then the run route screen with the
	 * POI still chosen; the compound when load out was opened without one,
	 * and the menu once the store has moved on from this campaign.
	 */
	private back(): void {
		if (this.departed) return;
		const { campaign } = this;
		if (!campaign || this.stranded) {
			ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
			return;
		}
		this.planned?.giveUp();
		const { poi, returnTo } = this.handed;
		if (typeof poi === 'number') ScreenManager.navigate('runRouteScreen', { campaign, poi }, { restoreFocus: true });
		else if (returnTo) ScreenManager.navigate(returnTo, undefined, { restoreFocus: true });
		else ScreenManager.navigate('compoundScreen', { campaign }, { restoreFocus: true });
	}
}

/** A pool card's tag: its seat, or injured. */
function poolStatus(driver: DriverRecord, seat: number | null): DriverCardStatus | null {
	if (seat === 0) return 'seat1';
	if (seat === 1) return 'seat2';
	return driver.status === 'injured' ? 'injured' : null;
}
