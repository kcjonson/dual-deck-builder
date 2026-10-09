import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { CardLoader } from '../../core/CardLoader';
import { isAtCompound } from '../../campaign/Campaign';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import type { DriverRecord } from '../../campaign/DriverRecord';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Divider } from '../../../engine/ui/Divider';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { Panel } from '../../../engine/ui/Panel';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { SCROLLBAR_GUTTER } from '../../../engine/ui/Scrollbar';
import { tokens } from '../../../engine/theme/tokens';
import { DRIVER_CONFIGS } from '../../mechanics/Driver';
import { MINI_GRID } from '../../ui/Card';
import { INSPECT_KEYS, inspectHotkey, inspectOnContextMenu, makeDriverInspectable } from '../../ui/cardInspect';
import { DRIVER_CARD_SIZE, DriverCard } from '../../ui/DriverCard';
import { driverCardData } from '../../ui/driverCardData';
import type { CardLookup } from '../../ui/DriverDetailView';
import { FlowWrap } from '../../ui/FlowWrap';
import { CostCurve, costCounts } from '../../ui/deckBuilder/CostCurve';
import type { CardSource } from '../../ui/deckBuilder/cardSource';
import { DECK_BUILDER, DeckBuilder } from '../../ui/deckBuilder/DeckBuilder';
import { crewDeckSource, crewLockerSource } from './crewSources';
import { deckLimitsText, deckSizeText, defaultDeckOf, hitpointsText, lockerNote, lostNote, rosterStatus, rosterTitle, standingText } from './crewText';

const { space, fontSize } = tokens;
const TOP_BAR_HEIGHT = 64;
/** A button doesn't hug its label, so Back has a width that fits its. */
const BACK_WIDTH = 168;
const CARDS_FAILED = "The cards couldn't be loaded.";
/** Two driver cards abreast, spaced as minis are, beside the scroller's gutter, inside a flush panel. */
export const ROSTER_WIDTH = DRIVER_CARD_SIZE.width * 2 + MINI_GRID.gap + MINI_GRID.margin * 2 + SCROLLBAR_GUTTER + DECK_BUILDER.flushEdge * 2;

/** What the compound hands the Crew screen: the campaign, as the store saves it. */
export interface CrewScreenData {
	campaign: Campaign;
}

export interface CrewScreenOptions {
	/** Where the campaign is saved, and loaded from when none is handed over. Default: the game's shared store. */
	store?: CampaignStore;
	/** The game's cards, to draw the minis and the detail views. Default: the card loader's, loaded if they aren't yet. */
	cards?: () => Promise<CardLookup>;
}

/** The game's cards from the card loader, fetched the first time anything asks. */
async function loaderCards(): Promise<CardLookup> {
	const loader = CardLoader.getInstance();
	if (!loader.isLoaded()) await loader.loadCards();
	const cards = loader.getAllCardsAsMap();
	return (type) => cards.get(type) ?? null;
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
 * Focus starts on Back. The roster is one focus group, so Left and Right
 * walk every driver in reading order and Up and Down move between rows
 * (R9.26, R9.29); each grid is another. Escape goes back to the compound
 * with focus restored on the Bunkhouse, as Back does.
 */
export class CrewScreen extends Screen {
	private readonly stack: Stack;
	private readonly store: CampaignStore;
	private readonly loadCards: () => Promise<CardLookup>;
	private campaign: Campaign | null = null;
	private lookup: CardLookup | null = null;
	/** The cards once they've loaded, and none before, for the grids and the detail views. */
	private readonly cards: CardLookup = (type) => this.lookup?.(type) ?? null;
	private sources: { deck: CardSource; pool: CardSource } | null = null;
	private chosen: DriverRecord | null = null;
	private builder: DeckBuilder | null = null;
	private rosterPanel: Panel | null = null;
	private rosterPool: FlowWrap | null = null;
	private rosterLost: FlowWrap | null = null;
	private lostCaption: Text | null = null;
	private header: Stack | null = null;
	private driverName: Text | null = null;
	private identity: Text | null = null;
	private readonly chips = new Map<'hp' | 'hand' | 'deck' | 'standing', Text>();
	private curve: CostCurve | null = null;
	private saveError: Text | null = null;
	private unsubscribe: (() => void)[] = [];
	/** Counts mounts and unmounts, so an answer that arrives after the screen has gone changes nothing. */
	private visit = 0;
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared, cards = loaderCards }: CrewScreenOptions = {}) {
		const root = new Stack({
			id: 'crewScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			style: { backgroundColor: 'bg_base' },
		});
		super('crewScreen', { root });
		this.stack = root;
		this.store = store;
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
		this.visit += 1;
		const back = new Button({
			label: 'Back to compound',
			id: 'crew_back_button',
			icon: 'arrow_back',
			size: 'sm',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		});
		this.stack.addChild(this.createTopBar(back));
		this.stack.addChild(new Divider({ id: 'crew_top_rule' }));
		this.saveError = new Text({
			id: 'crew_save_error',
			visible: false,
			widthMode: 'fill',
			margin: { top: space.space_3, left: space.space_4, right: space.space_4 },
			style: { fontSize: 'fs_sm', color: 'status_crit' },
		});
		this.stack.addChild(this.saveError);

		this.builder = new DeckBuilder({
			id: 'crew',
			padding: space.space_4,
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
			emptyDeck: 'Looking for the saved campaign.',
			emptyPool: 'The locker is empty.',
		});
		this.stack.addChild(this.builder);

		const { hotkeys } = this.rootLayer;
		hotkeys.register('Escape', () => this.back());
		for (const key of INSPECT_KEYS) hotkeys.register(key, () => inspectHotkey(this.context));
		this.unsubscribe.push(this.store.onSaveFailed((error) => this.showSaveError(error.message)));
		this.context.focus.focus(back);

		const handed = (data as Partial<CrewScreenData> | undefined)?.campaign ?? null;
		this.loaded = this.load(handed);
	}

	protected onUnmount(): void {
		this.visit += 1;
		const { hotkeys } = this.rootLayer;
		for (const key of ['Escape', ...INSPECT_KEYS]) hotkeys.unregister(key);
		this.unsubscribe.forEach((unsubscribe) => unsubscribe());
		this.unsubscribe = [];
		this.stack.clearChildren();
		this.campaign = null;
		this.lookup = null;
		this.sources = null;
		this.chosen = null;
		this.builder = null;
		this.rosterPanel = null;
		this.rosterPool = null;
		this.rosterLost = null;
		this.lostCaption = null;
		this.header = null;
		this.driverName = null;
		this.identity = null;
		this.chips.clear();
		this.curve = null;
		this.saveError = null;
	}

	private createTopBar(back: Button): Stack {
		const bar = new Stack({
			id: 'crew_top_bar',
			direction: 'horizontal',
			widthMode: 'fill',
			height: TOP_BAR_HEIGHT,
			padding: { left: space.space_4, right: space.space_4 },
			crossAlign: 'center',
			gap: space.space_4,
			style: { backgroundColor: 'bg_panel' },
		});
		bar.addChild(back);
		const heading = new Stack({ id: 'crew_heading', widthMode: 'fill', crossAlign: 'stretch' });
		heading.addChild(new Text({
			text: 'Crew and decks',
			id: 'crew_title',
			style: { fontRole: 'display', fontSize: 'fs_xl', color: 'text_bright', textTransform: 'uppercase', letterSpacing: 'ls_wide' },
			wrap: 'none',
		}));
		heading.addChild(new Text({
			text: 'Bunkhouse / default decks / changes here are free',
			id: 'crew_kicker',
			widthMode: 'fill',
			style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_dim', textTransform: 'uppercase' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));
		bar.addChild(heading);
		return bar;
	}

	/**
	 * Every driver the compound has had, as driver cards two abreast: those
	 * at the compound first, then, under a caption, those lost on runs,
	 * faded with a LOST tag. One focus group across both, so Left and Right
	 * read on from one row to the next rather than turning off diagonally at
	 * a row's end (R9.26, R9.29).
	 */
	private createRoster(): Panel {
		const panel = new Panel({ id: 'crew_roster_panel', title: rosterTitle(null), flush: true, width: ROSTER_WIDTH, heightMode: 'fill', crossAlign: 'stretch' });
		const scroll = new ScrollContainer({ id: 'crew_roster_scroll', widthMode: 'fill', heightMode: 'fill' });
		const group = new FocusGroup({ id: 'crew_roster', orientation: 'horizontal', direction: 'vertical', crossAlign: 'stretch' });
		const pool = new FlowWrap({ id: 'crew_roster_pool', margin: MINI_GRID.margin, gap: MINI_GRID.gap });
		const lost = new FlowWrap({ id: 'crew_roster_lost', margin: MINI_GRID.margin, gap: MINI_GRID.gap });
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
				style: { borderColor: key === 'deck' ? 'text_dim' : 'line_edge', borderWidth: 'bw', borderRadius: 'r_sm' },
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

	/** The campaign, handed over or loaded as Continue would, and the cards, both started at once. */
	private async load(handed: Campaign | null): Promise<void> {
		const visit = this.visit;
		const [found, cards] = await Promise.all([
			handed ? Promise.resolve({ campaign: handed, trouble: null }) : this.loadSave(),
			this.loadCards().then(
				(lookup) => lookup,
				(error: unknown) => {
					console.error('CrewScreen: loading the cards failed', error);
					return null;
				},
			),
		]);
		const builder = this.builder;
		if (visit !== this.visit || !builder) return;
		this.lookup = cards;
		if (!found.campaign) {
			builder.emptyDeck = found.trouble ?? 'No campaign in progress.';
			return;
		}
		this.show(found.campaign);
		// The roster still shows, and Back still hands the campaign back.
		if (!cards) builder.emptyDeck = builder.emptyPool = CARDS_FAILED;
	}

	private async loadSave(): Promise<{ campaign: Campaign | null; trouble: string | null }> {
		try {
			const campaign = await this.store.load();
			return { campaign, trouble: campaign ? null : 'No campaign in progress.' };
		} catch (error) {
			if (!(error instanceof CampaignStoreError)) console.error('CrewScreen: loading the save failed', error);
			return { campaign: null, trouble: error instanceof CampaignStoreError ? error.message : "The saved campaign couldn't be read." };
		}
	}

	private show(campaign: Campaign): void {
		this.campaign = campaign;
		this.chosen = campaign.drivers.find((driver) => isAtCompound(driver)) ?? null;
		const options = { campaign, selected: () => this.chosen, changed: () => this.checkpoint() };
		this.sources = { deck: crewDeckSource(options), pool: crewLockerSource(options) };
		if (this.builder) this.builder.emptyDeck = this.chosen ? 'No cards in this deck.' : 'Nobody is at the compound.';
		this.unsubscribe.push(campaign.on('change', () => this.refresh()));
		this.refresh();
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
		this.rosterPool?.reconcileChildren(here, options);
		this.rosterLost?.reconcileChildren(lost, options);
		if (this.lostCaption) this.lostCaption.visible = lost.length > 0;
	}

	/** A driver's roster card: those at the compound pick whose deck is built; the lost are there to read. */
	private driverCard(campaign: Campaign, driver: DriverRecord): DriverCard {
		const card = new DriverCard({ id: `crew_driver_card_${driver.id}`, data: driverCardData({ archetype: driver.archetype }) });
		card.focusable = true;
		makeDriverInspectable(card, { cards: this.cards });
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

	/** Saves the step just taken. A save that lands clears the line a failed one left. */
	private checkpoint(): void {
		const campaign = this.campaign;
		if (!campaign) return;
		const visit = this.visit;
		void this.store.checkpoint(campaign).then((saved) => {
			if (saved && visit === this.visit && this.saveError) this.saveError.visible = false;
		});
	}

	private showSaveError(message: string): void {
		const line = this.saveError;
		if (!line) return;
		line.text = message;
		line.color = 'status_crit';
		line.visible = true;
	}

	/** To the compound, focus back on the Bunkhouse that opened this screen. */
	private back(): void {
		ScreenManager.navigate('compoundScreen', this.campaign ? { campaign: this.campaign } : undefined, { restoreFocus: true });
	}
}
