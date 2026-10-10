import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { ScreenName } from '../../core/ScreenManager';
import { loadedCardLookup } from '../../core/CardLoader';
import { CampaignVisit } from '../../core/CampaignVisit';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStore } from '../../campaign/CampaignStore';
import type { DriverRecord } from '../../campaign/DriverRecord';
import type { RunDeck } from '../../campaign/RunDeck';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Divider } from '../../../engine/ui/Divider';
import { Panel } from '../../../engine/ui/Panel';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { tokens } from '../../../engine/theme/tokens';
import { DRIVER_CONFIGS } from '../../mechanics/Driver';
import { INSPECT_KEYS, inspectHotkey, inspectOnContextMenu, makeDriverInspectable } from '../../ui/cardInspect';
import { DriverCard } from '../../ui/DriverCard';
import { driverCardData } from '../../ui/driverCardData';
import type { CardLookup } from '../../ui/DriverDetailView';
import { FlowWrap } from '../../ui/FlowWrap';
import { CardEntryGrid } from '../../ui/deckBuilder/CardEntryGrid';
import type { CardEntryItem } from '../../ui/deckBuilder/CardEntryGrid';
import type { CardSource } from '../../ui/deckBuilder/cardSource';
import { DECK_BUILDER, DeckBuilder } from '../../ui/deckBuilder/DeckBuilder';
import { customizeLockerSource, escortCardSource, runDeckSource } from './customizeSources';
import {
	ESCORT_NOTE,
	NO_ESCORT_CARDS,
	RUN_DECK_FOOT,
	borrowedText,
	campaignOverText,
	leftHomeText,
	lockerKicker,
	runDeckNote,
	runDeckSizeText,
	seatOf,
	seatTitle,
} from './customizeText';

const { space, fontSize } = tokens;
const TOP_BAR_HEIGHT = 64;
/** A button doesn't hug its label, so Done has a width that fits its label. */
const DONE_WIDTH = 104;
const CARDS_LOADING = 'Loading the cards.';
const CARDS_FAILED = "The cards couldn't be loaded.";
const LOOKING = 'Looking for the saved campaign.';
const NO_RUN = 'No run is out, so there is no run deck to change.';
type Chip = 'size' | 'borrowed' | 'home';

/** What opens Customize, as load out's seat (DDB-320) and the developer launcher hand it over. */
export interface CustomizeScreenData {
	campaign: Campaign;
	/** The seated driver whose run deck this is. The first seat's when left out. */
	driver?: DriverRecord;
	/** Where Done goes, with focus back on what opened it. The compound when left out. */
	returnTo?: ScreenName;
	/** What Done hands `returnTo` besides the campaign, which it always hands back: load out's run summary, say. */
	returnData?: Record<string, unknown>;
	/**
	 * Where this visit's changes are saved, in place of the screen's own
	 * store: the developer launcher saves into memory, so trying the screen
	 * out leaves the player's save alone.
	 */
	store?: CampaignStore;
}

export interface CustomizeScreenOptions {
	/** Where the campaign is saved, and loaded from when none is handed over. Default: the game's shared store. */
	store?: CampaignStore;
	/** The game's cards, to draw the minis and the detail views. Default: the card loader's, loaded if they aren't yet. */
	cards?: () => Promise<CardLookup>;
}

/**
 * Customize (Game Flow 1.2): one seated driver's run deck, changed for this
 * run only, in the Crew screen's layout so the two feel like the same tool
 * (`DeckBuilder`). On the left, where the Crew screen's roster is, the
 * driver's card, whether the run deck still matches the default deck,
 * Reset to default, and the escort cards in this run deck, each with a
 * control that gives it to the other seat. In the middle the run deck as
 * mini stacks, a card's own copies, its borrowed ones, and its ones left at
 * home apart, each with one-fewer and one-more. On the right the locker
 * after the other seat's borrowing, each card with Borrow.
 *
 * The sources (`customizeSources.ts`) are the only code that touches the
 * campaign: each control is `moveCards` or `moveEscortCard`, disabled with
 * the rules' own reason, and Reset asks `getResetRunDeckBlocker`. As on the
 * Crew screen, a `CampaignVisit` loads the campaign and the cards, the
 * screen shows the campaign again on its `change`, checkpoints after each
 * change, and says under the top bar when a save fails until a later one
 * lands.
 *
 * Focus starts on Done. Tab goes Done, the driver card, Reset, the escort
 * cards, the run deck, the filter, and the locker (R9.18); each grid is one
 * focus group whose minis and controls Up and Down move between (R9.26,
 * R9.29). Escape is Done, unless a pinned detail view takes it first; I and
 * a secondary click pin a card's detail view, the driver's included.
 */
export class CustomizeScreen extends Screen {
	private readonly stack: Stack;
	private readonly store: CampaignStore;
	private readonly loadCards: () => Promise<CardLookup>;
	private readonly session = new CampaignVisit({ name: 'CustomizeScreen' });
	private campaign: Campaign | null = null;
	private chosen: DriverRecord | null = null;
	private returnTo: ScreenName = 'compoundScreen';
	private returnData: Record<string, unknown> | null = null;
	private lookup: CardLookup | null = null;
	/** The cards once they've loaded, and none before, for the grids and the detail views. */
	private readonly cards: CardLookup = (type) => this.lookup?.(type) ?? null;
	private sources: { deck: CardSource; pool: CardSource; escorts: CardSource } | null = null;
	/** Why there's no campaign, once loading the save has said. */
	private trouble: string | null = null;
	private cardsState: 'loading' | 'ready' | 'failed' = 'loading';
	private builder: DeckBuilder | null = null;
	private sidePanel: Panel | null = null;
	private sideBody: Stack | null = null;
	private driverCard: DriverCard | null = null;
	private inspectable = false;
	private vehicle: Text | null = null;
	private note: Text | null = null;
	private reset: Button | null = null;
	private escortGrid: CardEntryGrid | null = null;
	private escortEmpty: Text | null = null;
	private escortNote: Text | null = null;
	private chipRow: FlowWrap | null = null;
	private readonly chips = new Map<Chip, Text>();
	private unsubscribe: (() => void)[] = [];
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared, cards = loadedCardLookup }: CustomizeScreenOptions = {}) {
		const root = new Stack({
			id: 'customizeScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			style: { backgroundColor: 'bg_base' },
		});
		super('customizeScreen', { root });
		this.stack = root;
		this.store = store;
		this.loadCards = cards;
	}

	/** The campaign on show, once there is one. */
	public get shown(): Campaign | null {
		return this.campaign;
	}

	/** The driver whose run deck is being changed, once there's a campaign with a run out. */
	public get driver(): DriverRecord | null {
		return this.chosen;
	}

	/** The run deck and the locker. */
	public get deckBuilder(): DeckBuilder | null {
		return this.builder;
	}

	/** Settles once the campaign and the cards have loaded and been shown, or failed to. */
	public get campaignLoaded(): Promise<void> {
		return this.loaded;
	}

	protected onMount(data?: unknown): void {
		const handed = (data ?? {}) as Partial<CustomizeScreenData>;
		this.returnTo = handed.returnTo ?? 'compoundScreen';
		this.returnData = handed.returnData ?? null;

		const done = new Button({
			label: 'Done',
			id: 'customize_done_button',
			icon: 'check',
			tone: 'accent',
			size: 'sm',
			width: DONE_WIDTH,
			onClick: () => this.done(),
		});
		this.stack.addChild(this.createTopBar(done));
		this.stack.addChild(new Divider({ id: 'customize_top_rule' }));
		const saveError = new Text({
			id: 'customize_save_error',
			visible: false,
			widthMode: 'fill',
			margin: { top: space.space_3, left: space.space_4, right: space.space_4 },
			style: { fontSize: 'fs_sm', color: 'status_crit' },
		});
		this.stack.addChild(saveError);

		this.builder = new DeckBuilder({
			id: 'customize',
			padding: space.space_4,
			side: this.createSide(),
			deckHeader: this.createHeader(),
			deckCaption: 'Run deck / hover a card for its detail view',
			deckFoot: new Text({ id: 'customize_deck_note', text: RUN_DECK_FOOT, widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' } }),
			// Empty until a campaign is shown, which makes the sources.
			deck: { entries: () => this.sources?.deck.entries() ?? [] },
			pool: { entries: () => this.sources?.pool.entries() ?? [] },
			poolTitle: 'Locker',
			poolKicker: lockerKicker(2),
			cards: this.cards,
			emptyDeck: LOOKING,
			emptyPool: LOOKING,
		});
		this.builder.footVisible = false;
		this.stack.addChild(this.builder);

		const { hotkeys } = this.rootLayer;
		hotkeys.register('Escape', () => this.done());
		for (const key of INSPECT_KEYS) hotkeys.register(key, () => inspectHotkey(this.context));
		this.session.start({ store: handed.store ?? this.store, saveError });
		this.context.focus.focus(done);

		this.loaded = this.session.load({
			handed: handed.campaign ?? null,
			cards: this.loadCards,
			show: (campaign) => this.show(campaign, handed.campaign ? handed.driver ?? null : null),
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
		const { hotkeys } = this.rootLayer;
		for (const key of ['Escape', ...INSPECT_KEYS]) hotkeys.unregister(key);
		this.unsubscribe.forEach((unsubscribe) => unsubscribe());
		this.unsubscribe = [];
		this.stack.clearChildren();
		this.campaign = null;
		this.chosen = null;
		this.returnTo = 'compoundScreen';
		this.returnData = null;
		this.lookup = null;
		this.sources = null;
		this.trouble = null;
		this.cardsState = 'loading';
		this.builder = null;
		this.sidePanel = null;
		this.sideBody = null;
		this.driverCard = null;
		this.inspectable = false;
		this.vehicle = null;
		this.note = null;
		this.reset = null;
		this.escortGrid = null;
		this.escortEmpty = null;
		this.escortNote = null;
		this.chipRow = null;
		this.chips.clear();
	}

	private createTopBar(done: Button): Stack {
		const bar = new Stack({
			id: 'customize_top_bar',
			direction: 'horizontal',
			widthMode: 'fill',
			height: TOP_BAR_HEIGHT,
			padding: { left: space.space_4, right: space.space_4 },
			crossAlign: 'center',
			gap: space.space_4,
			style: { backgroundColor: 'bg_panel' },
		});
		const heading = new Stack({ id: 'customize_heading', widthMode: 'fill', crossAlign: 'stretch' });
		heading.addChild(new Text({
			text: 'Customize',
			id: 'customize_title',
			style: { fontRole: 'display', fontSize: 'fs_xl', color: 'text_bright', textTransform: 'uppercase', letterSpacing: 'ls_wide' },
			wrap: 'none',
		}));
		heading.addChild(new Text({
			text: 'Changes last for this run only / default deck unchanged',
			id: 'customize_kicker',
			widthMode: 'fill',
			style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_dim', textTransform: 'uppercase' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));
		bar.addChild(heading);
		bar.addChild(done);
		return bar;
	}

	/**
	 * The left column, as wide as the Crew screen's roster
	 * (`DECK_BUILDER.sideWidth`) so the run deck and the locker are as wide
	 * as its deck and locker: the driver's card, their vehicle, a note on how
	 * the run deck differs from the default deck, Reset to default, and the
	 * escort cards, scrolling when four escorts' cards are more than
	 * 1024x600 holds. A secondary click on any card in it pins its detail
	 * view.
	 */
	private createSide(): Panel {
		const { inset } = DECK_BUILDER;
		const panel = new Panel({ id: 'customize_side_panel', title: seatTitle({ seat: null, seats: 0 }), flush: true, width: DECK_BUILDER.sideWidth, heightMode: 'fill', crossAlign: 'stretch' });
		const scroll = new ScrollContainer({ id: 'customize_side_scroll', widthMode: 'fill', heightMode: 'fill' });
		const body = new Stack({ id: 'customize_side_body', crossAlign: 'stretch', gap: space.space_2, padding: inset, visible: false });
		const card = new DriverCard({ id: 'customize_driver_card', data: driverCardData({ archetype: 'road_warrior' }) });
		card.focusable = true;
		card.alignSelf = 'start';
		this.vehicle = new Text({ id: 'customize_vehicle', widthMode: 'fill', style: { fontSize: 'fs_base', color: 'text' }, wrap: 'none', textOverflow: 'ellipsis' });
		this.note = new Text({ id: 'customize_note', widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' } });
		this.reset = new Button({ label: 'Reset to default', id: 'customize_reset_button', size: 'sm', block: true, disabled: true, onClick: () => this.resetRunDeck() });
		const caption = new Text({
			id: 'customize_escort_caption',
			text: 'Escort cards',
			widthMode: 'fill',
			margin: { top: space.space_2 },
			style: { fontRole: 'mono', fontSize: fontSize.fs_xs, color: 'text_dim', textTransform: 'uppercase' },
			wrap: 'none',
		});
		// A grid that empties under focus hands it to the driver card, the column's one stop that's always there.
		this.escortGrid = new CardEntryGrid({ id: 'customize_escort_grid', fallback: () => this.driverCard });
		this.escortGrid.visible = false;
		this.escortEmpty = new Text({ id: 'customize_escort_empty', text: NO_ESCORT_CARDS, visible: false, widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' } });
		this.escortNote = new Text({ id: 'customize_escort_note', text: ESCORT_NOTE, visible: false, widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' } });
		for (const child of [card, this.vehicle, this.note, this.reset, caption, this.escortGrid, this.escortEmpty, this.escortNote]) body.addChild(child);
		inspectOnContextMenu(body);
		scroll.addChild(body);
		panel.addChild(scroll);
		this.driverCard = card;
		this.sideBody = body;
		this.sidePanel = panel;
		return panel;
	}

	/** The run deck's figures as chips: its size against the most it holds, what's borrowed, and what's left at home. */
	private createHeader(): FlowWrap {
		const row = new FlowWrap({ id: 'customize_deck_chips', gap: space.space_1_5, visible: false });
		for (const key of ['size', 'borrowed', 'home'] as const) {
			const chip = new Stack({
				id: `customize_deck_${key}`,
				padding: { top: space.space_1, bottom: space.space_1, left: space.space_1_5, right: space.space_1_5 },
				style: { borderColor: key === 'size' ? 'text_dim' : 'line_edge', borderWidth: 'bw', borderRadius: 'r_sm' },
			});
			const text = new Text({ id: `customize_deck_${key}_text`, style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text' }, wrap: 'none' });
			chip.addChild(text);
			row.addChild(chip);
			this.chips.set(key, text);
		}
		this.chipRow = row;
		return row;
	}

	/** A handed-over driver, or with none, the first seat's. */
	private show(campaign: Campaign, driver: DriverRecord | null): void {
		this.campaign = campaign;
		this.chosen = driver ?? campaign.runDecks[0]?.driver ?? null;
		if (this.chosen) {
			const options = { campaign, driver: this.chosen, changed: () => this.checkpoint() };
			this.sources = { deck: runDeckSource(options), pool: customizeLockerSource(options), escorts: escortCardSource(options) };
		}
		this.unsubscribe.push(campaign.on('change', () => this.refresh()));
		this.refresh();
	}

	/** The run deck on show now, or null with no campaign, no run out, or a driver who isn't seated. */
	private get runDeck(): RunDeck | null {
		return this.campaign && this.chosen ? this.campaign.runDeckOf(this.chosen) : null;
	}

	/** What the cards say in place of a grid while they aren't there, or null once they are. */
	private get cardsTrouble(): string | null {
		if (this.cardsState === 'loading') return CARDS_LOADING;
		return this.cardsState === 'failed' ? CARDS_FAILED : null;
	}

	/** What the run deck and the locker say while they're empty, by what the screen knows so far, and whether the foot shows. */
	private sayEmpty(): void {
		const builder = this.builder;
		if (!builder) return;
		const runDeck = this.runDeck;
		let deck: string;
		let pool: string;
		if (!this.campaign) deck = pool = this.trouble ?? LOOKING;
		else if (this.campaign.end) deck = pool = campaignOverText(this.campaign.end);
		else if (!runDeck) deck = pool = this.campaign.runDecks.length === 0 || !this.chosen ? NO_RUN : `${this.chosen.name} isn't seated on this run.`;
		else if (this.cardsTrouble) deck = pool = this.cardsTrouble;
		else {
			deck = 'No cards in this run deck.';
			pool = 'The locker is empty.';
		}
		builder.emptyDeck = deck;
		builder.emptyPool = pool;
		builder.footVisible = runDeck !== null && this.cardsState === 'ready';
	}

	/** Everything that reads the campaign, again. */
	private refresh(): void {
		const campaign = this.campaign;
		if (!campaign) return;
		const runDeck = this.runDeck;
		this.refreshSide(campaign, runDeck);
		this.refreshHeader(runDeck);
		this.sayEmpty();
		if (this.builder) {
			this.builder.poolKicker = lockerKicker(campaign.runDecks.length);
			this.builder.refresh();
		}
	}

	private refreshSide(campaign: Campaign, runDeck: RunDeck | null): void {
		const driver = this.chosen;
		if (this.sidePanel) this.sidePanel.title = seatTitle({ seat: driver ? seatOf({ campaign, driver }) : null, seats: campaign.runDecks.length });
		if (this.sideBody) this.sideBody.visible = runDeck !== null;
		if (!runDeck || !driver) return;
		const card = this.driverCard;
		if (card) {
			card.data = driverCardData({
				archetype: driver.archetype,
				name: driver.name,
				hitpoints: driver.hitpoints,
				maxHitpoints: driver.maxHitpoints,
				handLimit: driver.handLimit,
				deck: runDeck.cards,
			});
			card.customDeck = runDeck.isCustomized;
			// Its detail view lays the deck out as minis, so it opens once the cards are there to draw them.
			if (this.lookup && !this.inspectable) {
				makeDriverInspectable(card, { cards: this.cards });
				this.inspectable = true;
			}
		}
		if (this.vehicle) this.vehicle.text = DRIVER_CONFIGS[driver.archetype].metadata.vehicleName;
		if (this.note) this.note.text = runDeckNote(runDeck);
		const reset = this.reset;
		if (reset) {
			const live = this.canReset(campaign, runDeck);
			// Disabled under focus, it hands focus to the card above it rather than back to Done (R9.28).
			if (!live && this.context.focus.focused === reset && card) this.context.focus.focus(card);
			reset.enabled = live;
		}
		this.refreshEscorts(runDeck);
	}

	private refreshEscorts(runDeck: RunDeck): void {
		const grid = this.escortGrid;
		if (!grid) return;
		const items = (this.sources?.escorts.entries() ?? []).flatMap((entry): CardEntryItem[] => {
			const card = this.cards(entry.cardType);
			return card ? [{ entry, card }] : [];
		});
		grid.show(items);
		const shown = grid.views.length > 0;
		grid.visible = shown;
		if (this.escortNote) this.escortNote.visible = shown;
		const empty = this.escortEmpty;
		if (!empty) return;
		// Escort cards wait on the cards like the rest; with none in the run deck there's nothing to wait for.
		const held = runDeck.escortCards.length > 0;
		empty.text = held ? this.cardsTrouble ?? '' : NO_ESCORT_CARDS;
		empty.visible = !shown && empty.text !== '';
	}

	private refreshHeader(runDeck: RunDeck | null): void {
		if (this.chipRow) this.chipRow.visible = runDeck !== null;
		if (!runDeck) return;
		this.chipText('size', runDeckSizeText(runDeck));
		this.chipText('borrowed', borrowedText(runDeck));
		this.chipText('home', leftHomeText(runDeck));
	}

	private chipText(key: Chip, text: string): void {
		const chip = this.chips.get(key);
		if (chip) chip.text = text;
	}

	/** Whether Reset to default has anything to undo, and the rules let it. */
	private canReset(campaign: Campaign, runDeck: RunDeck): boolean {
		return runDeck.isCustomized && campaign.getResetRunDeckBlocker({ runDeck }) === null;
	}

	/** The run deck back to the whole default deck, what was borrowed back in the locker; escort cards stay. */
	private resetRunDeck(): void {
		const campaign = this.campaign;
		const runDeck = this.runDeck;
		if (!campaign || !runDeck || !this.canReset(campaign, runDeck)) return;
		campaign.resetRunDeck({ runDeck });
		this.checkpoint();
	}

	/** Saves the step just taken. */
	private checkpoint(): void {
		if (this.campaign) this.session.checkpoint(this.campaign);
	}

	/** Back to whoever opened it, with what it handed over to hand back and the campaign, focus on what opened it. */
	private done(): void {
		const data = this.campaign ? { ...this.returnData, campaign: this.campaign } : this.returnData ?? undefined;
		ScreenManager.navigate(this.returnTo, data, { restoreFocus: true });
	}
}
