import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { loadedCardLookup } from '../../core/CardLoader';
import { CampaignVisit } from '../../core/CampaignVisit';
import { isAtCompound } from '../../campaign/Campaign';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStore } from '../../campaign/CampaignStore';
import type { DriverRecord } from '../../campaign/DriverRecord';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Divider } from '../../../engine/ui/Divider';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { tokens } from '../../../engine/theme/tokens';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { LegendBox } from '../../ui/atlas/LegendBox';
import { PageTitle } from '../../ui/atlas/PageTitle';
import type { SectionTabs } from '../../ui/atlas/SectionTabs';
import { getPlanBlocker } from '../../campaign/SupplyRun';
import { PlanningMaps } from '../area-map/planningMap';
import { gateSectionTabs, metaSectionTabs } from '../metaSections';
import { DRIVER_CONFIGS } from '../../mechanics/Driver';
import { MINI_GRID } from '../../ui/Card';
import { INSPECT_KEYS, inspectHotkey, inspectOnContextMenu, makeDriverInspectable } from '../../ui/cardInspect';
import { DriverCard } from '../../ui/DriverCard';
import { driverCardData } from '../../ui/driverCardData';
import type { CardLookup } from '../../ui/DriverDetailView';
import { FlowWrap } from '../../ui/FlowWrap';
import { CostCurve, costCounts } from '../../ui/deckBuilder/CostCurve';
import type { CardSource } from '../../ui/deckBuilder/cardSource';
import { DECK_BUILDER, DeckBuilder } from '../../ui/deckBuilder/DeckBuilder';
import { crewDeckSource, crewLockerSource } from './crewSources';
import { deckLimitsText, deckSizeText, defaultDeckOf, hitpointsText, lockerNote, lostNote, rosterStatus, rosterTitle, standingText } from './crewText';

const { space, fontSize } = tokens;
/** The deck and the locker need every pixel across for their columns, so the sheet sets its content close inside the neatline. */
const SHEET_INSET = space.space_2;
const CARDS_FAILED = "The cards couldn't be loaded.";
const LOOKING = 'Looking for the saved campaign.';

/** What the compound hands the Crew screen: the campaign, as the store saves it. */
export interface CrewScreenData {
	campaign: Campaign;
}

export interface CrewScreenOptions {
	/** Where the campaign is saved, and loaded from when none is handed over. Default: the game's shared store. */
	store?: CampaignStore;
	/** The game's cards, to draw the minis and the detail views. Default: the card loader's, loaded if they aren't yet. */
	cards?: () => Promise<CardLookup>;
	/** Where the campaign's area map comes from, for the Area map tab. Default: the session's (`PlanningMaps.shared`). */
	maps?: PlanningMaps;
}

/**
 * The Crew screen (Game Flow 3.2), opened from the compound's bunkhouse,
 * where each driver's default deck is built from the locker: the roster of
 * driver cards on the left, the chosen one ringed and the lost below them,
 * faded; the chosen driver's header, their deck as mini stacks with a
 * Remove under each, and the cost curve in the middle; and the locker on the
 * right, filterable by kind, each card with Add and Scrap.
 *
 * The deck and the locker are a `DeckBuilder`, which Customize (DDB-321)
 * reuses with its own sources; the Crew screen's (`crewDeckSource`,
 * `crewLockerSource`) ask the campaign's own rules why an action can't be
 * done (`getCardMoveBlocker`, `getScrapBlocker`), show it under the control
 * they disable, and make each move with `moveCards` or `scrapCards`. Moving
 * cards here is free. The screen shows the campaign again on its `change`,
 * not a record's, which can see half a move, and checkpoints after each
 * change; a save that fails says so under the top bar, as the compound's
 * does under Rest, until a later one lands.
 *
 * It's one atlas sheet (UI Art Direction, Screens) hung with the campaign's
 * section tabs (`metaSectionTabs`), which stand in for Back: the Compound
 * tab goes back to the compound. The Area map tab goes there as the
 * compound's Plan a supply run does, so it's live only once the campaign's
 * map is made and nothing blocks a plan. The roster, the deck, and the
 * locker are legend boxes; the cards keep their own faces. Nothing here is
 * a primary action (every change is free and saved as it's made), so there
 * is no highway.
 *
 * Focus starts on the Crew tab. The roster is one focus group, so Left and
 * Right walk every driver in reading order and Up and Down move between
 * rows (R9.26, R9.29); each grid is another. Escape goes back to the
 * compound with focus restored on the Bunkhouse, as the Compound tab does.
 */
export class CrewScreen extends Screen {
	private readonly sheet: AtlasSheet;
	private readonly tabs: SectionTabs;
	private readonly store: CampaignStore;
	private readonly maps: PlanningMaps;
	private readonly loadCards: () => Promise<CardLookup>;
	private campaign: Campaign | null = null;
	private lookup: CardLookup | null = null;
	/** The cards once they've loaded, and none before, for the grids and the detail views. */
	private readonly cards: CardLookup = (type) => this.lookup?.(type) ?? null;
	private sources: { deck: CardSource; pool: CardSource } | null = null;
	/** Why there's no campaign, once loading the save has said. */
	private trouble: string | null = null;
	private cardsState: 'loading' | 'ready' | 'failed' = 'loading';
	/** Roster cards whose detail view opens, once the cards have loaded. */
	private inspectable = new WeakSet<DriverCard>();
	private chosen: DriverRecord | null = null;
	private builder: DeckBuilder | null = null;
	private rosterPanel: LegendBox | null = null;
	private rosterPool: FlowWrap | null = null;
	private rosterLost: FlowWrap | null = null;
	private rosterGroup: FocusGroup | null = null;
	private lostCaption: Text | null = null;
	private header: Stack | null = null;
	private driverName: Text | null = null;
	private identity: Text | null = null;
	private readonly chips = new Map<'hp' | 'hand' | 'deck' | 'standing', Text>();
	private curve: CostCurve | null = null;
	private saveError: Text | null = null;
	private unsubscribe: (() => void)[] = [];
	private readonly session = new CampaignVisit({ name: 'CrewScreen' });
	private loaded: Promise<void> = Promise.resolve();
	/** Waiting for the campaign's map, which the Area map tab follows; aborted on unmount. */
	private mapWait: AbortController | null = null;

	constructor({ store = CampaignStore.shared, cards = loadedCardLookup, maps = PlanningMaps.shared }: CrewScreenOptions = {}) {
		const tabs = metaSectionTabs({ id: 'crew_tabs', open: 'crew', campaignOf: () => this.campaign });
		const root = new AtlasSheet({
			id: 'crewScreen',
			tabs,
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			contentInset: SHEET_INSET,
			gap: space.space_3,
		});
		super('crewScreen', { root, theme: 'atlas' });
		this.sheet = root;
		this.tabs = tabs;
		this.store = store;
		this.maps = maps;
		this.loadCards = cards;
	}

	/** The campaign on show, once there is one. */
	public get shown(): Campaign | null {
		return this.campaign;
	}

	/** The driver whose default deck is being built. */
	public get selected(): DriverRecord | null {
		return this.chosen;
	}

	/** The deck and the locker. */
	public get deckBuilder(): DeckBuilder | null {
		return this.builder;
	}

	/** Settles once the campaign and the cards have loaded and been shown, or failed to. */
	public get campaignLoaded(): Promise<void> {
		return this.loaded;
	}

	protected onMount(data?: unknown): void {
		this.sheet.addChild(new PageTitle({
			id: 'crew_top_bar',
			title: 'Crew and decks',
			subtitle: 'Bunkhouse / default decks / changes here are free',
			titleId: 'crew_title',
			subtitleId: 'crew_kicker',
		}));
		this.saveError = new Text({
			id: 'crew_save_error',
			visible: false,
			widthMode: 'fill',
			style: { fontSize: 'fs_sm', color: 'status_crit' },
		});
		this.sheet.addChild(this.saveError);

		this.builder = new DeckBuilder({
			id: 'crew',
			side: this.createRoster(),
			deckHeader: this.createHeader(),
			deckCaption: 'Default deck / hover a card for its detail view',
			deckFoot: this.createFoot(),
			// Empty until a campaign is shown, which makes the sources.
			deck: { entries: () => this.sources?.deck.entries() ?? [] },
			pool: { entries: () => this.sources?.pool.entries() ?? [] },
			poolTitle: 'Locker',
			poolKicker: 'Spare cards, shared by every driver',
			poolNote: lockerNote(null),
			cards: this.cards,
			emptyDeck: LOOKING,
			emptyPool: LOOKING,
		});
		this.sheet.addChild(this.builder);

		const { hotkeys } = this.rootLayer;
		hotkeys.register('Escape', () => this.back());
		for (const key of INSPECT_KEYS) hotkeys.register(key, () => inspectHotkey(this.context));
		this.session.start({ store: this.store, saveError: this.saveError });
		this.tabs.selectedId = 'crew';
		this.gateTabs(null);
		const open = this.tabs.tabs.find((tab) => tab.selected);
		if (open) this.context.focus.focus(open);

		// The roster and the header show as soon as there's a campaign, and the deck and locker fill in once the cards are there.
		this.loaded = this.session.load({
			handed: (data as Partial<CrewScreenData> | undefined)?.campaign ?? null,
			cards: this.loadCards,
			show: (campaign) => this.show(campaign),
			missing: (trouble) => {
				this.trouble = trouble;
				this.sayEmpty();
			},
			cardsLoaded: (lookup) => {
				this.lookup = lookup;
				this.cardsState = lookup ? 'ready' : 'failed';
				this.sayEmpty();
				this.refresh();
			},
		});
	}

	protected onUnmount(): void {
		this.session.stop();
		this.mapWait?.abort();
		this.mapWait = null;
		const { hotkeys } = this.rootLayer;
		for (const key of ['Escape', ...INSPECT_KEYS]) hotkeys.unregister(key);
		this.unsubscribe.forEach((unsubscribe) => unsubscribe());
		this.unsubscribe = [];
		this.sheet.clearContent();
		this.campaign = null;
		this.lookup = null;
		this.sources = null;
		this.trouble = null;
		this.cardsState = 'loading';
		this.inspectable = new WeakSet();
		this.chosen = null;
		this.builder = null;
		this.rosterPanel = null;
		this.rosterPool = null;
		this.rosterLost = null;
		this.rosterGroup = null;
		this.lostCaption = null;
		this.header = null;
		this.driverName = null;
		this.identity = null;
		this.chips.clear();
		this.curve = null;
		this.saveError = null;
	}

	/**
	 * Every driver the compound has had, as driver cards one above the
	 * next: those at the compound first, then, under a caption, those lost
	 * on runs, faded with a LOST tag. One focus group across both, so Left
	 * and Right read on through every driver as Up and Down do (R9.26,
	 * R9.29).
	 */
	private createRoster(): LegendBox {
		const panel = new LegendBox({ id: 'crew_roster_panel', title: rosterTitle(null), padding: DECK_BUILDER.boxPadding, headIndent: DECK_BUILDER.headIndent, gap: 0, width: DECK_BUILDER.sideWidth, heightMode: 'fill', crossAlign: 'stretch' });
		const scroll = new ScrollContainer({ id: 'crew_roster_scroll', widthMode: 'fill', heightMode: 'fill' });
		const group = new FocusGroup({ id: 'crew_roster', orientation: 'horizontal', direction: 'vertical', crossAlign: 'stretch', visible: false });
		const pool = new FlowWrap({ id: 'crew_roster_pool', margin: MINI_GRID.margin, gap: MINI_GRID.gap, visible: false });
		const lost = new FlowWrap({ id: 'crew_roster_lost', margin: MINI_GRID.margin, gap: MINI_GRID.gap, visible: false });
		this.lostCaption = new Text({
			id: 'crew_roster_lost_caption',
			text: 'Lost on runs',
			visible: false,
			widthMode: 'fill',
			margin: { top: space.space_2, left: space.space_2, right: space.space_2 },
			style: { fontRole: 'mono', fontSize: fontSize.fs_xs, color: 'text_dim', textTransform: 'uppercase' },
			wrap: 'none',
		});
		group.addChild(pool);
		group.addChild(this.lostCaption);
		group.addChild(lost);
		scroll.addChild(group);
		this.rosterGroup = group;
		panel.addChild(scroll);
		inspectOnContextMenu(group);
		this.rosterPanel = panel;
		this.rosterPool = pool;
		this.rosterLost = lost;
		return panel;
	}

	/** The chosen driver's name, their vehicle and specialty, and their figures as chips. */
	private createHeader(): Stack {
		const header = new Stack({ id: 'crew_driver_header', crossAlign: 'stretch', gap: space.space_1, visible: false });
		this.driverName = new Text({
			id: 'crew_driver_name',
			widthMode: 'fill',
			style: { fontRole: 'display', fontSize: 'fs_xl', color: 'text_bright', textTransform: 'uppercase', letterSpacing: 'ls_wide' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		this.identity = new Text({ id: 'crew_driver_identity', widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' }, wrap: 'none', textOverflow: 'ellipsis' });
		const chips = new FlowWrap({ id: 'crew_driver_chips', gap: space.space_1_5, margin: { top: space.space_1 } });
		for (const key of ['hp', 'hand', 'deck', 'standing'] as const) {
			const chip = new Stack({
				id: `crew_driver_${key}`,
				padding: { top: space.space_1, bottom: space.space_1, left: space.space_1_5, right: space.space_1_5 },
				style: { borderColor: key === 'deck' ? 'text_dim' : 'line_edge', borderWidth: 'bw', borderRadius: 'radius_ui' },
			});
			const text = new Text({ id: `crew_driver_${key}_text`, style: { fontRole: key === 'standing' ? 'body' : 'mono', fontSize: 'fs_sm', color: 'text' }, wrap: 'none' });
			chip.addChild(text);
			chips.addChild(chip);
			this.chips.set(key, text);
		}
		header.addChild(this.driverName);
		header.addChild(this.identity);
		header.addChild(chips);
		this.header = header;
		return header;
	}

	/** The cost curve, and the limits every deck keeps. */
	private createFoot(): Stack {
		const foot = new Stack({ id: 'crew_deck_foot_row', crossAlign: 'stretch', gap: space.space_2 });
		foot.addChild(new Divider({ id: 'crew_deck_foot_rule' }));
		const row = new Stack({ id: 'crew_curve_row', direction: 'horizontal', crossAlign: 'center', gap: space.space_3 });
		row.addChild(new Text({
			id: 'crew_curve_label',
			text: 'Cost curve',
			style: { fontRole: 'mono', fontSize: fontSize.fs_xs, color: 'text_dim', textTransform: 'uppercase' },
			wrap: 'none',
		}));
		this.curve = new CostCurve({ id: 'crew_curve' });
		row.addChild(this.curve);
		row.addChild(new Text({ id: 'crew_deck_limits', text: deckLimitsText(), widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim', textAlign: 'right' } }));
		foot.addChild(row);
		return foot;
	}

	private show(campaign: Campaign): void {
		this.campaign = campaign;
		this.chosen = campaign.drivers.find((driver) => isAtCompound(driver)) ?? null;
		const options = { campaign, selected: () => this.chosen, changed: () => this.checkpoint() };
		this.sources = { deck: crewDeckSource(options), pool: crewLockerSource(options) };
		this.unsubscribe.push(campaign.on('change', () => this.refresh()));
		this.refresh();
		this.watchMap(campaign);
	}

	/** Asks for the campaign's map if it isn't made yet, and shows the Area map tab again when it is. */
	private watchMap(campaign: Campaign): void {
		if (this.maps.known(campaign)) return;
		const wait = new AbortController();
		this.mapWait = wait;
		this.maps.load(campaign, { signal: wait.signal }).then(
			() => {
				if (this.campaign === campaign) this.gateTabs(campaign);
			},
			// No map, no plan: the tab stays as it is, and the compound says why.
			() => undefined,
		);
	}

	/**
	 * What the deck and the locker say while they're empty, by what the
	 * screen knows so far, and whether the cost curve shows: only under a
	 * chosen driver's deck once the cards are there.
	 */
	private sayEmpty(): void {
		const builder = this.builder;
		if (!builder) return;
		let deck: string;
		let pool: string;
		if (!this.campaign) deck = pool = this.trouble ?? LOOKING;
		else if (this.cardsState === 'loading') deck = pool = 'Loading the cards.';
		else if (this.cardsState === 'failed') deck = pool = CARDS_FAILED;
		else {
			deck = this.chosen ? 'No cards in this deck.' : 'Nobody is at the compound.';
			pool = 'The locker is empty.';
		}
		builder.emptyDeck = deck;
		builder.emptyPool = pool;
		builder.footVisible = this.campaign !== null && this.chosen !== null && this.cardsState === 'ready';
	}

	/** Builds this driver's default deck now. */
	public select(driver: DriverRecord): void {
		if (!this.campaign || driver === this.chosen || !isAtCompound(driver) || !this.campaign.drivers.includes(driver)) return;
		this.chosen = driver;
		this.refresh();
	}

	/** Everything that reads the campaign, again. */
	private refresh(): void {
		const campaign = this.campaign;
		if (!campaign) return;
		this.refreshRoster(campaign);
		this.refreshHeader(campaign);
		this.gateTabs(campaign);
		this.sayEmpty();
		if (this.builder) {
			this.builder.poolNote = lockerNote(campaign.resources.scrap);
			this.builder.refresh();
		}
	}

	private refreshRoster(campaign: Campaign): void {
		if (this.rosterPanel) this.rosterPanel.title = rosterTitle(campaign);
		const here = campaign.drivers.filter((driver) => isAtCompound(driver));
		const lost = campaign.drivers.filter((driver) => !isAtCompound(driver));
		const options = {
			key: (driver: DriverRecord) => driver.id,
			create: (driver: DriverRecord) => this.driverCard(campaign, driver),
			update: (card: DriverCard, driver: DriverRecord) => this.showDriver({ card, campaign, driver }),
		};
		// An empty row is hidden rather than drawn as a box with no height.
		if (this.rosterPool) {
			this.rosterPool.reconcileChildren(here, options);
			this.rosterPool.visible = here.length > 0;
		}
		if (this.rosterLost) {
			this.rosterLost.reconcileChildren(lost, options);
			this.rosterLost.visible = lost.length > 0;
		}
		if (this.lostCaption) this.lostCaption.visible = lost.length > 0;
		if (this.rosterGroup) this.rosterGroup.visible = campaign.drivers.length > 0;
	}

	/** A driver's roster card: those at the compound pick whose deck is built; the lost are there to read. */
	private driverCard(campaign: Campaign, driver: DriverRecord): DriverCard {
		const card = new DriverCard({ id: `crew_driver_card_${driver.id}`, data: driverCardData({ archetype: driver.archetype }) });
		card.focusable = true;
		if (isAtCompound(driver)) card.onSelect = () => this.select(driver);
		this.showDriver({ card, campaign, driver });
		return card;
	}

	private showDriver({ card, campaign, driver }: { card: DriverCard; campaign: Campaign; driver: DriverRecord }): void {
		card.data = driverCardData({
			archetype: driver.archetype,
			name: driver.name,
			hitpoints: driver.hitpoints,
			maxHitpoints: driver.maxHitpoints,
			handLimit: driver.handLimit,
			deck: defaultDeckOf({ campaign, driver }),
			note: lostNote(driver),
		});
		card.status = rosterStatus({ campaign, driver });
		card.selected = driver === this.chosen;
		// Its detail view lays the deck out as minis, so it opens once the cards are there to draw them.
		if (this.lookup && !this.inspectable.has(card)) {
			makeDriverInspectable(card, { cards: this.cards });
			this.inspectable.add(card);
		}
	}

	private refreshHeader(campaign: Campaign): void {
		const driver = this.chosen;
		if (this.header) this.header.visible = driver !== null;
		if (!driver) return;
		const deck = defaultDeckOf({ campaign, driver });
		const { metadata } = DRIVER_CONFIGS[driver.archetype];
		if (this.driverName) this.driverName.text = driver.name;
		if (this.identity) this.identity.text = `${metadata.vehicleName} / ${metadata.specialty}`;
		this.chipText('hp', hitpointsText(driver));
		this.chipText('hand', `HAND LIMIT ${driver.handLimit}`);
		this.chipText('deck', deckSizeText(deck));
		this.chipText('standing', standingText({ campaign, driver }));
		if (this.curve && this.lookup) this.curve.counts = costCounts(deck, this.lookup);
	}

	private chipText(key: 'hp' | 'hand' | 'deck' | 'standing', text: string): void {
		const chip = this.chips.get(key);
		if (chip) chip.text = text;
	}

	/** Saves the step just taken. */
	private checkpoint(): void {
		if (this.campaign) this.session.checkpoint(this.campaign);
	}

	/** To the compound, focus back on the Bunkhouse that opened this screen. */
	private back(): void {
		ScreenManager.navigate('compoundScreen', this.campaign ? { campaign: this.campaign } : undefined, { restoreFocus: true });
	}

	/** The section tabs this screen can take now (`sectionAvailability`); the Area map's is live when the compound's Plan a supply run would be. */
	private gateTabs(campaign: Campaign | null): void {
		const map = campaign ? this.maps.known(campaign) : null;
		gateSectionTabs(this.tabs, { campaign, mapKnown: map !== null, planBlocked: campaign !== null && map !== null && getPlanBlocker({ campaign, map }) !== null, busy: false });
	}
}

