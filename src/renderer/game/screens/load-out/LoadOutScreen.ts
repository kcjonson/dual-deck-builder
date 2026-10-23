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
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import { DRIVER_CONFIGS } from '../../mechanics/Driver';
import type { Card as GameCard } from '../../mechanics/Card';
import type { Vehicle } from '../../mechanics/Vehicle';
import { AtlasButton } from '../../ui/atlas/AtlasButton';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { HandMarkLayer, HandMarkVariant } from '../../ui/atlas/HandMarkLayer';
import { LegendBox, LegendRow } from '../../ui/atlas/LegendBox';
import { PageTitle } from '../../ui/atlas/PageTitle';
import { ATLAS } from '../../ui/atlas/atlasStyle';
import { Card as UICard, CardSize, MINI_GRID, MiniCardState } from '../../ui/Card';
import { INSPECT_KEYS, inspectHotkey, inspectOnContextMenu, makeDriverInspectable, makeEscortInspectable, makeInspectable } from '../../ui/cardInspect';
import { DRIVER_CARD_INK, DRIVER_CARD_SIZE, DriverCard, DriverCardStatus } from '../../ui/DriverCard';
import { driverCardData } from '../../ui/driverCardData';
import { CardLookup, deckOrder } from '../../ui/DriverDetailView';
import { EscortCard } from '../../ui/EscortCard';
import { escortCardDataOf } from '../../ui/escortCardData';
import { FlowWrap } from '../../ui/FlowWrap';
import { PRIMARY_LABEL } from '../area-map/atlasPanel';
import { PlanningMaps } from '../area-map/planningMap';
import { departRefusal } from '../run/runText';
import { LoadOutPlan, SEAT_COUNT } from './LoadOutPlan';
import { reportToPage } from '../../../engine/errors/reportToPage';
import {
	ESCORT_CAPTION,
	ESCORT_COMING,
	ESCORT_STAYING,
	NO_ROUTE_PICKED,
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
	tripItems,
} from './loadOutText';

const { space, fontSize } = tokens;
/** Between the header, the boxes, and the foot, and between the boxes. */
const GAP = space.space_2;
/** The boxes run close to their cards, so their padding is the spec's least less a little. */
const BOX_PADDING = 10;
const BOX_GAP = space.space_1;
/** A seat's vehicle, role, and deck caption share a line where the box is wide enough, each this tall. */
const NAMED_LINE = 20;
/** The word under an escort card that the highlighter marks when it's coming along. */
const ESCORT_LABEL = { size: ATLAS.captionSize + 1, line: 13 } as const;
/** A seat's left column: the driver card, then Clear seat and Customize under it. */
const SEAT_COLUMN_WIDTH = DRIVER_CARD_SIZE.width + DRIVER_CARD_INK * 2;
/** Back roads in a seat or under a pool card sit at a smaller label, to fit a card's width. */
const SMALL_LABEL = 16;
/** A pool entry, as the Crew screen's roster sets one: the card, Seat under it, and two lines for why they can't go ("Same archetype as a seated driver"). */
const POOL_ENTRY = { width: 128, reasonSize: fontSize.fs_xs, reasonLine: 13, reasonLines: 2 } as const;
/** Wide enough for the synergy beside Swap seats in two lines, and four escorts abreast, the most a convoy has. */
const CONVOY_WIDTH = 500;
const SWAP_WIDTH = 132;
/** Start run: the highway, pinned to the sheet's bottom right with its line under it. */
const START_WIDTH = 240;
const START_HEIGHT = 48;
const GO_WIDTH = 620;
const CARDS_LOADING = 'Loading the cards.';
const CARDS_FAILED = "The cards couldn't be loaded.";
const LOOKING = 'Looking for the saved campaign.';
const NO_ROUTE = 'Pick a route first: load out was opened without one.';
const MONO_CAPTION = { fontRole: 'mono', fontSize: ATLAS.captionSize + 1, letterSpacing: ATLAS.captionTracking, color: 'text_dim', textTransform: 'uppercase' } as const;
const ROUTE_ITEM = { fontRole: 'mono', fontWeight: 500, fontSize: fontSize.fs_sm, letterSpacing: 0.06, textTransform: 'uppercase' } as const;
const ROUTE_ITEMS = ['route_name', 'stops', 'fuel', 'home_by'] as const;

/** An escort in the convoy: a hired vehicle (`Vehicle.isEscort`). */
export type Escort = Vehicle;

/** The picked route, as the run route screen read it, for the line under the title. */
export interface LoadOutTrip {
	/** The POI's name. */
	destination: string;
	/** The route's name, "Back roads". */
	routeName: string;
	stops: number;
	fuel: number;
	/** When the convoy would be home, "16:30". */
	homeBy: string;
	/** Home after dark. */
	pastDark: boolean;
}

/**
 * What the run route screen opens load out with, all plain data, so
 * Customize can hand it back and a screen capture can hand it over.
 */
export interface LoadOutScreenData {
	campaign: Campaign;
	/** The POI by its index in the map's POI layer, which Back hands the run route screen. */
	poi: number;
	/** The picked route's id (`routeId`), set off on at Start run against the campaign's map. */
	route: string;
	/** The destination and the route's figures, for the route line. */
	trip?: LoadOutTrip;
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
	/** Where the campaign's map comes from, for the route Start run sets off on. Default: the session's (`PlanningMaps.shared`). */
	maps?: PlanningMaps;
}

/** One seat's parts, built once and shown again on every refresh. */
interface SeatView {
	panel: LegendBox;
	empty: Text;
	body: Stack;
	card: DriverCard;
	inspectable: boolean;
	vehicle: Text;
	role: Text;
	clear: AtlasButton;
	customize: AtlasButton;
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

/** A pool driver's card, with Seat and why they can't go under it. */
class PoolEntry extends Stack {
	public readonly card: DriverCard;
	public readonly seatButton: AtlasButton;
	public readonly reason: Text;
	public inspectable = false;

	constructor({ id }: { id: string }) {
		super({ id, width: POOL_ENTRY.width, crossAlign: 'stretch', gap: space.space_1 });
		this.card = new DriverCard({ id: `${id}_card`, data: driverCardData({ archetype: 'road_warrior' }) });
		this.card.focusable = true;
		this.card.alignSelf = 'center';
		this.card.margin = { top: DRIVER_CARD_INK, bottom: 0 };
		this.seatButton = new AtlasButton({ id: `${id}_seat_button`, label: 'Seat', labelSize: SMALL_LABEL, height: ATLAS.minHit, block: true });
		this.reason = new Text({
			id: `${id}_reason`,
			height: POOL_ENTRY.reasonLine * POOL_ENTRY.reasonLines,
			widthMode: 'fill',
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

/** An escort's card, and under it whether it's coming along or staying home. */
class EscortSlot extends Stack {
	public readonly card: EscortCard;
	public readonly label: Text;

	constructor({ id, escort, cards }: { id: string; escort: Escort; cards: CardLookup }) {
		super({ id: `${id}_slot`, crossAlign: 'stretch', gap: space.space_0_5 });
		this.card = new EscortCard({ id, data: escortCardDataOf(escort), cards });
		this.card.focusable = true;
		makeEscortInspectable(this.card);
		this.label = new Text({
			id: `${id}_label`,
			widthMode: 'fill',
			height: ESCORT_LABEL.line,
			lineHeight: ESCORT_LABEL.line / ESCORT_LABEL.size,
			verticalAlign: 'middle',
			style: { fontRole: 'mono', fontWeight: 500, fontSize: ESCORT_LABEL.size, letterSpacing: ATLAS.captionTracking, textTransform: 'uppercase', textAlign: 'center', color: 'text' },
			wrap: 'none',
		});
		this.addChild(this.card);
		this.addChild(this.label);
	}
}

/**
 * Load out (Game Flow 1.2): the last step before a supply run leaves, one
 * atlas sheet (UI Art Direction, Screens). Back to the route and the title
 * head it, with the route line under the title: the destination, the
 * route, its stops, the fuel it burns, and when the convoy is home, a
 * shortfall in stronghold red. Under them two seats, each a legend box
 * with its driver's card, Clear seat, and Customize, and beside them the
 * deck they'll take as view-only minis, as many abreast as the box holds.
 * Under the seats the pool, every driver at the compound with
 * Seat and why one can't go, and the convoy, the pair's synergy with Swap
 * seats, and the escorts, each brought or left at home with a click, the
 * ones coming along marked in highlighter. Start run, the screen's one
 * highway, sits pinned to the sheet's bottom right, faded print with its
 * reason under it in stronghold red until two seated drivers can go
 * together; the seats and the boxes under them scroll in a short window.
 *
 * What's picked, and the run deck lifecycle, is a `LoadOutPlan`; the
 * screen shows it and saves each change it makes to the campaign through
 * a `CampaignVisit`, as the Crew screen and Customize do. The run decks
 * start the first time Customize or Start run needs them. Start run sets
 * off on the route the run route screen picked (`departRun`), saves, and
 * opens the run screen; a departure that's refused says why and leaves
 * the run decks out for another try. Back unwinds them and returns to the
 * run route screen, so a run started here is never left out.
 *
 * Opened with no campaign, as the screen captures do, it loads the save as
 * Continue would; with no route, Back goes to the compound and Start run
 * says there's no route to run.
 *
 * Focus starts on Start run when it's live, else on Back. Escape is Back,
 * unless a pinned detail view takes it first; I and a secondary click pin
 * a card's detail view.
 */
export class LoadOutScreen extends Screen {
	private readonly sheet: AtlasSheet;
	private readonly store: CampaignStore;
	private readonly loadCards: () => Promise<CardLookup>;
	private readonly maps: PlanningMaps;
	private readonly session = new CampaignVisit({ name: 'LoadOutScreen' });
	/** Counts mounts and unmounts, so a departure that settles after the screen has gone changes nothing. */
	private visit = 0;
	/** Why the last Start run didn't set off, until the plan changes. */
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
	private swapButton: AtlasButton | null = null;
	private synergy: LegendRow | null = null;
	private synergyWarning: LegendRow | null = null;
	private escorts: FlowWrap | null = null;
	private escortMarks: HandMarkLayer | null = null;
	private escortNote: Text | null = null;
	private readonly routeItems = new Map<(typeof ROUTE_ITEMS)[number], Text>();
	private summaryLine: Text | null = null;
	private startButton: AtlasButton | null = null;
	private unsubscribe: (() => void)[] = [];
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared, cards = loadedCardLookup, maps = PlanningMaps.shared }: LoadOutScreenOptions = {}) {
		const root = new AtlasSheet({
			id: 'loadOutScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			gap: GAP,
		});
		super('loadOutScreen', { root, theme: 'atlas' });
		this.sheet = root;
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

		const back = new AtlasButton({ label: 'Back to the route', id: 'load_out_back_button', onClick: () => this.back() });
		this.sheet.addChild(this.createHeader(back));
		this.sheet.addChild(this.createBody());
		const saveError = new Text({
			id: 'load_out_save_error',
			visible: false,
			widthMode: 'fill',
			style: { fontSize: 'fs_sm', color: 'status_crit' },
		});
		this.sheet.addChild(this.createFoot(saveError));

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
		// A handed-over campaign is shown by now, so Start run knows whether it's live.
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
		this.sheet.clearContent();
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
		this.escortMarks = null;
		this.escortNote = null;
		this.routeItems.clear();
		this.summaryLine = null;
		this.startButton = null;
	}

	/** Back to the route at the left; the title, and under it the route line, the map legend's way. */
	private createHeader(back: AtlasButton): Stack {
		const header = new Stack({ id: 'load_out_top_bar', direction: 'horizontal', widthMode: 'fill', crossAlign: 'start', gap: space.space_5 });
		header.addChild(back);
		const heading = new Stack({ id: 'load_out_heading_column', widthMode: 'fill', crossAlign: 'stretch', gap: space.space_0_5 });
		heading.addChild(new PageTitle({
			id: 'load_out_heading',
			title: 'Load out',
			subtitle: POOL_NOTE,
			titleId: 'load_out_title',
			subtitleId: 'load_out_kicker',
		}));
		const line = new Stack({ id: 'load_out_route', direction: 'horizontal', widthMode: 'fill', crossAlign: 'center', gap: space.space_2 });
		const { trip } = this.handed;
		line.addChild(new Text({
			id: 'load_out_destination',
			text: trip?.destination ?? NO_ROUTE_PICKED,
			maxSize: { width: 360 },
			style: { fontRole: 'display', fontWeight: 700, fontSize: 18, color: trip ? 'text' : 'text_faint' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));
		// Before the campaign is in, the route line can't know the stores, so it shows no shortfall yet.
		const items = trip ? tripItems(trip, Infinity) : null;
		for (const key of ROUTE_ITEMS) {
			if (key !== 'route_name') line.addChild(new Text({ id: `load_out_${key}_rule`, text: '/', visible: items !== null, style: { ...ROUTE_ITEM, color: 'text_faint' }, wrap: 'none' }));
			const item = new Text({ id: `load_out_${key}`, text: items?.[key].text ?? '', visible: items !== null, style: { ...ROUTE_ITEM, color: key === 'route_name' ? 'text' : 'text_dim' }, wrap: 'none', textOverflow: 'ellipsis' });
			line.addChild(item);
			this.routeItems.set(key, item);
		}
		heading.addChild(line);
		header.addChild(heading);
		return header;
	}

	/** The seats over the pool and the convoy, scrolling where the window is short. */
	private createBody(): ScrollContainer {
		const scroll = new ScrollContainer({ id: 'load_out_scroll', widthMode: 'fill', heightMode: 'fill' });
		const content = new Stack({ id: 'load_out_content', widthMode: 'fill', crossAlign: 'stretch', gap: GAP });
		const seatRow = new Stack({ id: 'load_out_seats', direction: 'horizontal', widthMode: 'fill', crossAlign: 'stretch', gap: GAP });
		this.seats = Array.from({ length: SEAT_COUNT }, (_, seat) => this.createSeat(seat));
		this.seats.forEach(({ panel }) => seatRow.addChild(panel));
		content.addChild(seatRow);
		const lower = new Stack({ id: 'load_out_lower', direction: 'horizontal', widthMode: 'fill', crossAlign: 'stretch', gap: GAP });
		lower.addChild(this.createPool());
		lower.addChild(this.createConvoy());
		content.addChild(lower);
		scroll.addChild(content);
		return scroll;
	}

	/**
	 * A seat: "Choose a driver" until filled, then the driver's card with
	 * Clear seat and Customize under it, and beside them a line with the
	 * vehicle, the role, and the deck's size, over the deck. Both reflow to
	 * the box's width: the line wraps and the deck takes fewer columns and
	 * more rows in a narrow window, where the sheet scrolls.
	 */
	private createSeat(seat: number): SeatView {
		const id = `load_out_seat_${seat + 1}`;
		const panel = new LegendBox({ id: `${id}_panel`, title: seatTitle(seat), padding: BOX_PADDING, gap: BOX_GAP, widthMode: 'fill', crossAlign: 'stretch' });
		const empty = new Text({ id: `${id}_empty`, text: 'Choose a driver', widthMode: 'fill', style: { fontSize: 'fs_base', color: 'text_faint' } });
		const body = new Stack({ id: `${id}_body`, direction: 'horizontal', widthMode: 'fill', gap: space.space_3, visible: false });

		const column = new Stack({ id: `${id}_column`, width: SEAT_COLUMN_WIDTH, crossAlign: 'stretch', gap: space.space_1_5 });
		const card = new DriverCard({ id: `${id}_card`, data: driverCardData({ archetype: 'road_warrior' }) });
		card.focusable = true;
		card.alignSelf = 'center';
		card.margin = { top: DRIVER_CARD_INK, bottom: DRIVER_CARD_INK - space.space_1_5 };
		const clear = new AtlasButton({ id: `${id}_clear_button`, label: 'Clear seat', labelSize: SMALL_LABEL, block: true, onClick: () => this.clearSeat(seat) });
		// A stable id, so Done in Customize lands back on it (ScreenManager's restoreFocus).
		const customize = new AtlasButton({ id: `${id}_customize_button`, label: 'Customize', labelSize: SMALL_LABEL, block: true, onClick: () => this.customize(seat) });
		for (const child of [card, clear, customize]) column.addChild(child);
		body.addChild(column);

		const deckColumn = new Stack({ id: `${id}_deck_column`, widthMode: 'fill', crossAlign: 'stretch', gap: space.space_0_5 });
		const named = new FlowWrap({ id: `${id}_named`, gap: space.space_4, rowGap: 0 });
		const vehicle = new Text({ id: `${id}_vehicle`, height: NAMED_LINE, lineHeight: NAMED_LINE / 18, verticalAlign: 'middle', style: { fontRole: 'display', fontWeight: 700, fontSize: 18, color: 'text' }, wrap: 'none' });
		const role = new Text({ id: `${id}_role`, height: NAMED_LINE, verticalAlign: 'middle', style: { ...MONO_CAPTION, fontWeight: 500, color: 'text' }, wrap: 'none' });
		const caption = new Text({ id: `${id}_deck_caption`, height: NAMED_LINE, verticalAlign: 'middle', style: MONO_CAPTION, wrap: 'none' });
		for (const child of [vehicle, role, caption]) named.addChild(child);
		const deck = new FlowWrap({ id: `${id}_deck`, margin: MINI_GRID.margin, gap: MINI_GRID.gap, focusGroup: { orientation: 'horizontal' }, visible: false });
		const deckNote = new Text({ id: `${id}_deck_note`, text: CARDS_LOADING, widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' } });
		for (const child of [named, deck, deckNote]) deckColumn.addChild(child);
		body.addChild(deckColumn);
		inspectOnContextMenu(body);

		panel.addChild(empty);
		panel.addChild(body);
		return { panel, empty, body, card, inspectable: false, vehicle, role, clear, customize, caption, deck, deckNote };
	}

	private createPool(): LegendBox {
		const panel = new LegendBox({ id: 'load_out_pool_panel', title: 'Driver pool', padding: BOX_PADDING, gap: BOX_GAP, widthMode: 'fill', crossAlign: 'stretch' });
		this.pool = new FlowWrap({ id: 'load_out_pool', gap: space.space_3, rowGap: space.space_2, focusGroup: { orientation: 'horizontal' } });
		inspectOnContextMenu(this.pool);
		panel.addChild(this.pool);
		return panel;
	}

	/**
	 * The pair's synergy beside Swap seats, a warning under it when the pair
	 * has a gap, then the escorts as cards, each a click to bring or leave,
	 * the ones coming along marked in highlighter (the player's choice).
	 */
	private createConvoy(): LegendBox {
		const panel = new LegendBox({ id: 'load_out_convoy_panel', title: 'Convoy', padding: BOX_PADDING, gap: BOX_GAP, width: CONVOY_WIDTH, crossAlign: 'stretch' });
		const head = new Stack({ id: 'load_out_synergy_head', direction: 'horizontal', widthMode: 'fill', crossAlign: 'start', gap: space.space_3 });
		this.synergy = new LegendRow({ id: 'load_out_synergy_row', textId: 'load_out_synergy', text: '' });
		head.addChild(this.synergy);
		this.swapButton = new AtlasButton({ id: 'load_out_swap_button', label: 'Swap seats', labelSize: SMALL_LABEL, width: SWAP_WIDTH, height: ATLAS.minHit, disabled: true, onClick: () => this.swapSeats() });
		head.addChild(this.swapButton);
		panel.addChild(head);
		this.synergyWarning = new LegendRow({ id: 'load_out_synergy_warning_row', textId: 'load_out_synergy_warning', text: '', symbol: 'diamond', color: 'status_crit', visible: false });
		panel.addChild(this.synergyWarning);
		panel.addChild(new Text({ id: 'load_out_escort_caption', text: ESCORT_CAPTION, widthMode: 'fill', style: MONO_CAPTION, wrap: 'none', textOverflow: 'ellipsis' }));
		const area = new Stack({ id: 'load_out_escort_area', widthMode: 'fill', crossAlign: 'stretch' });
		// The highlighter goes down under the words, so their ink stays at full strength.
		this.escortMarks = new HandMarkLayer({ id: 'load_out_escort_marks', place: 'under' });
		area.addChild(this.escortMarks);
		this.escorts = new FlowWrap({ id: 'load_out_escorts', margin: MINI_GRID.margin, gap: MINI_GRID.gap + space.space_1, focusGroup: { orientation: 'horizontal' }, visible: false });
		inspectOnContextMenu(this.escorts);
		area.addChild(this.escorts);
		panel.addChild(area);
		this.escortNote = new Text({ id: 'load_out_escort_note', widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' } });
		panel.addChild(this.escortNote);
		return panel;
	}

	/** A save that failed at the left; Start run at the right, with what's going or why it can't under it. */
	private createFoot(saveError: Text): Stack {
		const foot = new Stack({ id: 'load_out_summary_bar', direction: 'horizontal', widthMode: 'fill', crossAlign: 'end', distribution: 'end', gap: space.space_4 });
		foot.addChild(saveError);
		const go = new Stack({ id: 'load_out_go', width: GO_WIDTH, crossAlign: 'end', gap: space.space_1 });
		this.startButton = new AtlasButton({
			id: 'load_out_start_button',
			label: 'Start run',
			variant: 'highway',
			shield: true,
			labelSize: PRIMARY_LABEL,
			height: START_HEIGHT,
			width: START_WIDTH,
			disabled: true,
			onClick: () => { void this.depart(); },
		});
		go.addChild(this.startButton);
		this.summaryLine = new Text({
			id: 'load_out_summary_line',
			text: LOOKING,
			widthMode: 'fill',
			style: { fontSize: 'fs_sm', color: 'text_dim', textAlign: 'right' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		go.addChild(this.summaryLine);
		foot.addChild(go);
		return foot;
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
		this.refreshTrip(plan.campaign);
		this.seats.forEach((view, seat) => this.refreshSeat(view, seat, plan));
		this.refreshPool(plan);
		this.refreshConvoy(plan);
		this.refreshSummary();
	}

	/** The route line's items, the fuel in stronghold red when the stores hold less than the route burns, and home-by when it's after dark. */
	private refreshTrip(campaign: Campaign): void {
		const { trip } = this.handed;
		if (!trip) return;
		const items = tripItems(trip, campaign.resources.fuel);
		for (const key of ROUTE_ITEMS) {
			const view = this.routeItems.get(key);
			if (!view) continue;
			const { text, short } = items[key];
			view.text = text;
			view.color = short ? 'status_crit' : key === 'route_name' ? 'text' : 'text_dim';
		}
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
		const { metadata } = DRIVER_CONFIGS[driver.archetype];
		view.vehicle.text = metadata.vehicleName;
		view.role.text = metadata.specialty;
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
			synergy.color = analysis || solo ? 'text' : 'text_faint';
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
				const slot = new EscortSlot({ id: `load_out_escort_${escort.convoyId}`, escort, cards: this.cards });
				slot.card.onSelect = () => this.toggleEscort(escort);
				this.showEscort(slot, escort, plan);
				return slot;
			},
			update: (slot: EscortSlot, escort) => this.showEscort(slot, escort, plan),
		});
		row.visible = escorts.length > 0;
		this.markBrought();
		const none = plan.campaign.convoy.escorts.length === 0;
		note.text = none ? 'No escorts in the convoy.' : this.cardsState === 'failed' ? CARDS_FAILED : CARDS_LOADING;
		note.visible = escorts.length === 0;
	}

	private showEscort(slot: EscortSlot, escort: Escort, plan: LoadOutPlan): void {
		const { card, label } = slot;
		card.data = escortCardDataOf(escort);
		card.staying = plan.isStaying(escort);
		card.enabled = plan.canToggle(escort) && !this.departed && !this.stranded;
		label.text = card.staying ? ESCORT_STAYING : ESCORT_COMING;
		label.color = card.staying ? 'text_faint' : 'text';
	}

	/** A highlighter swipe under the word under each escort coming along; the word and the STAYING tag say it too. */
	private markBrought(): void {
		const marks = this.escortMarks;
		const row = this.escorts;
		if (!marks || !row) return;
		marks.clear();
		row.children.forEach((slot, index) => {
			if (slot instanceof EscortSlot && !slot.card.staying) marks.highlight(slot.label, { variant: (index % 4) as HandMarkVariant });
		});
	}

	/** Start run and the line under it: what's going, or why it can't. */
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
			if (this.trouble) color = 'status_crit';
		} else {
			const blocker = plan.startBlocker;
			if (this.stranded) {
				text = STRANDED_LOAD_OUT;
				color = 'status_crit';
			} else if (blocker) {
				text = startBlockerText(blocker, plan.campaign.end);
				color = 'status_crit';
			} else if (!this.handed.route) {
				text = NO_ROUTE;
				color = 'status_crit';
			} else if (this.departed) text = 'Setting off.';
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
	private setEnabled(control: Component, live: boolean, heir: Component | null): void {
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

	/** A pick changed, which clears why the last Start run didn't set off. */
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
	 * Start run: the run decks out, then the departure on the picked route
	 * against the campaign's map, then the checkpoint and the run screen,
	 * handed the save's result so it can say a save failed. A departure
	 * that's refused says why, leaving the run decks out and Start run live.
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
		let refusal: string | null = null;
		try {
			const map = this.maps.known(campaign) ?? await this.maps.load(campaign);
			if (visit !== this.visit) return;
			const route = routesOnOffer({ map, campaign }).find((offered) => offered.id === id);
			const blocker = route ? getDepartBlocker({ campaign, route }) : null;
			if (!route) refusal = "That route isn't on the area map any more. Back to pick another.";
			else if (blocker) refusal = departRefusal(blocker);
			else {
				plan.start();
				departRun({ campaign, map, route, escorts: plan.escorts });
			}
		} catch (error) {
			if (visit !== this.visit) return;
			// A refusal is the player's to hear; a throw is a bug, and the page hears it too
			console.error('LoadOutScreen: the run could not set off', error);
			reportToPage(error);
			refusal = error instanceof Error ? error.message : "The run couldn't set off.";
		}
		if (refusal !== null) {
			this.refusal = refusal;
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
