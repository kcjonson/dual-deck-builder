import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { BUILDING_IDS, BuildingId } from '../../campaign/Buildings';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import type { CheckpointResult } from '../../campaign/CampaignStore';
import { UPKEEP_RESOURCES } from '../../campaign/CompoundRules';
import { endDay, forecastNeeds } from '../../campaign/DayClock';
import { getScavengeBlocker, rollScavengeHaul, scavenge as sendScavengingParty } from '../../campaign/Scavenging';
import { getPlanBlocker, routesOnOffer } from '../../campaign/SupplyRun';
import { PlanningMap, PlanningMaps } from '../area-map/planningMap';
import { mapProgressText } from '../main-menu/campaignText';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import { AtlasButton } from '../../ui/atlas/AtlasButton';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { ATLAS, DISPLAY_BOLD } from '../../ui/atlas/atlasStyle';
import { DeckGlyph } from '../../ui/atlas/deck';
import { LegendBox, LegendRow } from '../../ui/atlas/LegendBox';
import { MapGlyph } from '../../ui/atlas/mapGlyphs';
import { PlateFrame } from '../../ui/atlas/PlateFrame';
import { ResourceStrip, ledger } from '../../ui/atlas/ResourceStrip';
import type { SectionTab, SectionTabs } from '../../ui/atlas/SectionTabs';
import { MetaSection, metaSectionTabs } from '../metaSections';
import {
	BUILDINGS,
	Building,
	NOT_THE_SAVE,
	NeedLine,
	RESOURCE_ORDER,
	REST_RUN_OUT,
	STRANDED_BUILDING,
	STRANDED_DAY,
	amountText,
	buildingNumber,
	buildingState,
	crewLine,
	dayEndReport,
	dayText,
	forecastLines,
	injuredLine,
	isShort,
	restCaption,
	scavengeCaption,
	scavengeRefusal,
	scavengeReport,
	unbuiltReason,
} from './compoundText';
import { CompoundYard } from './CompoundYard';
import { planRefusal } from '../run/runText';

const PLATE_CAPTION = 'Plate 1 · the compound from above, at dawn';
const GATE = { name: 'Gate', road: 'to the area map' };
const NO_RUMORS = 'Radio: no new rumors';
const NO_CAMPAIGN = 'Opens with a campaign in progress.';
/** The right column at its widest, the canvas's, and at its narrowest, for 1024 px; between, a share of the width. */
const COLUMN = { max: 452, min: 300, gap: 30, wide: 420 } as const;
/** The sheet's content box sits this far in from the window on every side: the table, the neatlines, and the padding (AtlasSheet). */
const SHEET_INSET = tokens.space.sheet_margin + ATLAS.neatlineInset + ATLAS.neatlineGap + ATLAS.sheetPadding;
/** What the plate column spends on the title, the stores, the gaps, the caption, and the plate's rules, above and below the art. */
const PLATE_COLUMN_CHROME = 150;
const PLATE_ASPECT = 920 / 760;
const GAP = 14;
const LINE_SIZE = tokens.fontSize.fs_sm;
const LINE_HEIGHT = tokens.lineHeight.lh;
/**
 * Rest's and Scavenge's lines hold as many lines as the longest of either
 * takes at the column's width (`fitColumn`), so the buttons above them stay
 * put under the pointer as the lines change; Plan's line holds two.
 */
const TWO_LINES = 2 * LINE_SIZE * LINE_HEIGHT;
const PLAN_LINE_SIZE = 12;
const PLAN_LINE_HEIGHT = 2 * PLAN_LINE_SIZE * LINE_HEIGHT;
/**
 * A press this soon after a day ended is the same click, a double-click's
 * second half, and ends nothing. A checkpoint to local storage lands within
 * the frame, so waiting for it alone lets a double-click spend two days.
 */
const SECOND_PRESS_MS = 300;

/** What New Campaign and Continue hand the compound screen: the campaign, as the store saves it. */
export interface CompoundScreenData {
	campaign: Campaign;
}

export interface CompoundScreenOptions {
	/** Where the campaign is saved, and loaded from when none is handed over. Default: the game's shared store. */
	store?: CampaignStore;
	/** Where the campaign's area map comes from, for Plan a supply run. Default: the session's (`PlanningMaps.shared`). */
	maps?: PlanningMaps;
}

/** Stores past four digits shortened, at least two digits, as a ledger prints them. */
function storeText(value: number): string {
	return value < 10_000 ? ledger(value) : amountText(value);
}

/**
 * The compound (Game Flow 3.1), the campaign's home screen, on the atlas
 * sheet (UI Art Direction, Screens, Compound): the section tabs along the
 * top; on the left the title, the day, the stores, and the compound plate,
 * an overhead view of the yard whose buildings are the menu; on the right
 * the chosen building's box, the needs, the day's orders (Rest and
 * Scavenge, with what each costs), and Plan a supply run pinned at the foot.
 *
 * The buildings and whether each stands come from the campaign
 * (`Campaign.buildings`). Choosing one on the plate, by press or by
 * moving focus onto it, shows it in the box with its action; the bunkhouse
 * opens the Crew screen with the campaign, and a building with nothing
 * behind it says why. The tabs go to the menu, the area map, and the Crew
 * screen; Plan a supply run opens the area map too, disabled with its
 * reason (`getPlanBlocker`) while a run is out, nobody can go, or there's
 * too little fuel for the map's cheapest route. Those read the campaign's
 * map, made again on Continue, so Plan waits for it, saying how far it's
 * got. Rest and Scavenge each end the day (`endDay`, `scavenge`) and
 * checkpoint the campaign, and each is disabled with its reason while a run
 * is out, Scavenge also once the campaign is over.
 *
 * A day that loses the campaign goes to the defeat screen once its end is
 * saved (`DefeatScreen`), handed the campaign. A checkpoint that finds the
 * store has moved on from this instance strands the screen: it says nothing
 * more is saved here, and Rest, Scavenge, Plan, the building's action, and
 * the tabs but Menu turn off.
 *
 * Focus starts on the Compound tab, not Rest or Scavenge, so a stray Enter
 * can't spend a day. The buildings are a focus group (R9.29), and so are
 * Rest and Scavenge. Escape returns to the menu with focus restored. Opened
 * with no campaign, as a capture or the dev navigate hook does, it loads the
 * save as Continue would.
 */
export class CompoundScreen extends Screen {
	private readonly stack: Stack;
	private readonly store: CampaignStore;
	private readonly maps: PlanningMaps;
	private campaign: Campaign | null = null;
	/** The campaign's area map once it's in, which Plan a supply run reads. */
	private map: PlanningMap | null = null;
	/** What Plan's line says while there's no map: how far it's got, or why it couldn't be made. */
	private mapWait = 'Making the area map.';
	private tabs: SectionTabs | null = null;
	private side: Stack | null = null;
	private dayLabel: Text | null = null;
	private stores: ResourceStrip | null = null;
	private yard: CompoundYard | null = null;
	private chosen: BuildingId = BUILDING_IDS[0];
	private building: {
		glyph: MapGlyph;
		name: Text;
		state: Text;
		description: Text;
		crew: Stack;
		crewText: Text;
		reason: Text;
		action: AtlasButton;
	} | null = null;
	private needs: LegendBox | null = null;
	private sideScroll: ScrollContainer | null = null;
	private restButton: AtlasButton | null = null;
	private restLine: Text | null = null;
	private scavengeButton: AtlasButton | null = null;
	private scavengeLine: Text | null = null;
	private planButton: AtlasButton | null = null;
	private planLine: Text | null = null;
	private report: Text | null = null;
	private saveError: Text | null = null;
	/**
	 * Nothing more starts here: the campaign is lost and the defeat screen is
	 * on its way, or the store has moved on from this instance, so nothing
	 * done here would be saved.
	 */
	private halted: 'defeated' | 'stranded' | null = null;
	private unsubscribe: (() => void) | null = null;
	/** A day end (Rest or Scavenge) or a fall's checkpoint is on its way, so the next step waits for it. */
	private passingDay = false;
	/** The clock's time when the last day ended, for `SECOND_PRESS_MS`. */
	private dayEndedAt = -Infinity;
	/** Counts mounts and unmounts, so an answer that arrives after the screen has gone changes nothing. */
	private visit = 0;
	private loaded: Promise<void> = Promise.resolve();
	/** Stops waiting for the map once the screen has gone. */
	private waiting: AbortController | null = null;
	/** Settles once the campaign's map is in, or couldn't be made. */
	private mapLoaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared, maps = PlanningMaps.shared }: CompoundScreenOptions = {}) {
		const root = new Stack({ id: 'compoundScreen', widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch' });
		super('compoundScreen', { root, theme: 'atlas' });
		this.stack = root;
		this.store = store;
		this.maps = maps;
	}

	/** The campaign on show, once there is one. */
	public get shown(): Campaign | null {
		return this.campaign;
	}

	/** The building in the box and circled on the plate. */
	public get selectedBuilding(): BuildingId {
		return this.chosen;
	}

	/** Settles once a save loaded on mount, or the campaign handed over, has been shown with its area map, or the map couldn't be made. */
	public get campaignLoaded(): Promise<void> {
		return this.loaded;
	}

	protected onMount(data?: unknown): void {
		this.visit += 1;
		this.waiting = new AbortController();
		const tabs = metaSectionTabs({ id: 'compound_tabs', open: 'compound', campaignOf: () => this.campaign });
		// The sections go as the shared tabs send them, once nothing here holds them back.
		const go = tabs.onSelect;
		tabs.onSelect = (id, event) => {
			tabs.selectedId = 'compound';
			if (this.tabHeld(id)) return;
			go?.(id, event);
		};
		this.tabs = tabs;
		this.refreshTabs();
		const sheet = new AtlasSheet({ id: 'compound_sheet', tabs, widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch' });
		const body = new Stack({ id: 'compound_body', direction: 'horizontal', widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch', gap: COLUMN.gap });
		body.addChild(this.createPlateColumn());
		body.addChild(this.createSide());
		sheet.addChild(body);
		this.stack.addChild(sheet);
		this.fitColumn();
		this.choose(this.chosen);

		const { hotkeys } = this.rootLayer;
		hotkeys.register('Escape', () => this.back());
		hotkeys.register('PageDown', () => this.sideScroll?.scrollByPages(1));
		hotkeys.register('PageUp', () => this.sideScroll?.scrollByPages(-1));
		this.unsubscribe = this.store.onSaveFailed((error) => this.showLine({ line: this.saveError, text: error.message, color: 'status_crit' }));
		const home = this.tab('compound');
		if (home) this.context.focus.focus(home);

		const handed = (data as Partial<CompoundScreenData> | undefined)?.campaign;
		if (handed) {
			this.show(handed);
			this.loaded = this.mapLoaded;
		} else {
			this.loaded = this.loadSave();
		}
	}

	protected onUnmount(): void {
		this.visit += 1;
		this.waiting?.abort();
		this.waiting = null;
		const { hotkeys } = this.rootLayer;
		for (const key of ['Escape', 'PageDown', 'PageUp']) hotkeys.unregister(key);
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.halted = null;
		this.stack.clearChildren();
		this.campaign = null;
		this.map = null;
		this.mapWait = 'Making the area map.';
		this.tabs = null;
		this.side = null;
		this.dayLabel = null;
		this.stores = null;
		this.yard = null;
		this.building = null;
		this.needs = null;
		this.sideScroll = null;
		this.restButton = null;
		this.restLine = null;
		this.scavengeButton = null;
		this.scavengeLine = null;
		this.planButton = null;
		this.planLine = null;
		this.report = null;
		this.saveError = null;
		this.passingDay = false;
		this.dayEndedAt = -Infinity;
	}

	protected onResized(): void {
		this.fitColumn();
	}

	/**
	 * The right column takes what the plate leaves: the plate fits its yard
	 * to the height it has, so the column widens to the canvas's width
	 * wherever the plate wouldn't use the room, as on a short window. Rest's
	 * and Scavenge's lines each hold one line in a wide column and two in a
	 * narrow one, so together they read as a paragraph.
	 */
	private fitColumn(): void {
		if (!this.side) return;
		const { width, height } = this.context.viewport.logical;
		const plate = (height - SHEET_INSET * 2 - PLATE_COLUMN_CHROME) * PLATE_ASPECT;
		const room = width - SHEET_INSET * 2 - COLUMN.gap - plate;
		const column = Math.round(Math.max(COLUMN.min, Math.min(COLUMN.max, room)));
		this.side.width = column;
		const lines = column >= COLUMN.wide ? 1 : 2;
		for (const line of [this.restLine, this.scavengeLine]) if (line) line.height = lines * LINE_SIZE * LINE_HEIGHT;
	}

	/** The title and the day, the stores under them, and the plate filling the rest. */
	private createPlateColumn(): Stack {
		const column = new Stack({ id: 'compound_plate_column', widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch', gap: GAP });
		const heading = new Stack({ id: 'compound_heading', direction: 'horizontal', crossAlign: 'end', gap: 16 });
		heading.addChild(new Text({
			text: 'The Compound',
			id: 'compound_title',
			style: { fontRole: DISPLAY_BOLD, fontWeight: 700, fontSize: 34, letterSpacing: 0.16, textTransform: 'uppercase', color: 'text' },
			wrap: 'none',
		}));
		// The day and the stores show once there's a campaign.
		this.dayLabel = new Text({ id: 'compound_day', visible: false, style: { fontSize: 16, color: 'text_dim' }, wrap: 'none' });
		heading.addChild(this.dayLabel);
		column.addChild(heading);

		this.stores = new ResourceStrip({
			id: 'compound_resources',
			widthMode: 'fill',
			visible: false,
			format: storeText,
			items: RESOURCE_ORDER.map((kind) => ({ kind, value: 0 })),
		});
		column.addChild(this.stores);

		const plate = new PlateFrame({ id: 'compound_plate', caption: PLATE_CAPTION, widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch' });
		this.yard = new CompoundYard({
			id: 'compound_yard',
			widthMode: 'fill',
			heightMode: 'fill',
			names: Object.fromEntries(BUILDINGS.map((building) => [building.id, building.name])) as Record<BuildingId, string>,
			numbers: Object.fromEntries(BUILDING_IDS.map((id) => [id, buildingNumber(id)])) as Record<BuildingId, string>,
			gate: GATE,
			onChoose: (id) => this.choose(id),
		});
		for (const id of BUILDING_IDS) this.yard.setBuilt({ building: id, built: false, state: '' });
		plate.addChild(this.yard);
		column.addChild(plate);
		return column;
	}

	/**
	 * The chosen building's box and the needs, scrolling when the column runs
	 * short; under them the day's orders and Plan a supply run, held to the
	 * foot so the buttons stay put under the pointer whatever the boxes above
	 * hold.
	 */
	private createSide(): Stack {
		const side = new Stack({ id: 'compound_side', width: COLUMN.max, heightMode: 'fill', crossAlign: 'stretch', distribution: 'spaceBetween', gap: GAP });
		this.side = side;
		const upper = new Stack({ id: 'compound_side_boxes', widthMode: 'fill', crossAlign: 'stretch', gap: GAP, padding: { top: 0, right: 4, bottom: 4, left: 4 } });
		upper.addChild(this.createBuildingBox());
		// Empty, and hidden, until there's a campaign to read.
		this.needs = new LegendBox({ id: 'compound_needs', title: 'Needs', widthMode: 'fill', crossAlign: 'stretch', visible: false });
		upper.addChild(this.needs);
		this.sideScroll = new ScrollContainer({ id: 'compound_side_scroll', widthMode: 'fill', heightMode: 'hug' });
		this.sideScroll.addChild(upper);
		side.addChild(this.sideScroll);
		const foot = new Stack({ id: 'compound_side_foot', widthMode: 'fill', crossAlign: 'stretch', gap: GAP });
		foot.addChild(this.createDayBox());

		const plan = new Stack({ id: 'compound_plan', widthMode: 'fill', crossAlign: 'stretch', gap: 8, padding: { top: 0, right: 4, bottom: 0, left: 4 } });
		this.planButton = new AtlasButton({
			id: 'compound_plan_button',
			label: 'Plan a supply run',
			variant: 'highway',
			shield: true,
			block: true,
			height: 64,
			disabled: true,
			onClick: () => this.plan(),
		});
		plan.addChild(this.planButton);
		this.planLine = new Text({
			id: 'compound_plan_reason',
			text: NO_CAMPAIGN,
			widthMode: 'fill',
			height: PLAN_LINE_HEIGHT,
			lineHeight: LINE_HEIGHT,
			textOverflow: 'ellipsis',
			style: { fontRole: 'mono', fontSize: PLAN_LINE_SIZE, color: 'text_dim' },
		});
		plan.addChild(this.planLine);
		foot.addChild(plan);
		side.addChild(foot);
		return side;
	}

	/** The chosen building on fresh paper (W0): its number, name, and state, what it's for, the crew line for the bunkhouse, and its action or why there's none. */
	private createBuildingBox(): LegendBox {
		const box = new LegendBox({ id: 'compound_building', fresh: true, widthMode: 'fill', crossAlign: 'stretch', gap: 10 });
		const head = new Stack({ id: 'compound_building_head', direction: 'horizontal', widthMode: 'fill', crossAlign: 'center', gap: 10 });
		const glyph = new MapGlyph({ id: 'compound_building_number', kind: 'circled', size: 26, label: '1' });
		head.addChild(glyph);
		const name = new Text({ id: 'compound_building_name', widthMode: 'fill', wrap: 'none', textOverflow: 'ellipsis', style: { fontRole: DISPLAY_BOLD, fontWeight: 700, fontSize: 28, color: 'text' } });
		head.addChild(name);
		const state = new Text({ id: 'compound_building_state', wrap: 'none', style: { fontRole: 'mono', fontSize: 11, textTransform: 'uppercase', color: 'text_dim' } });
		head.addChild(state);
		box.addChild(head);
		const description = new Text({ id: 'compound_building_description', widthMode: 'fill', wrap: 'word', style: { fontSize: 14, color: 'text' } });
		box.addChild(description);
		const crew = new Stack({ id: 'compound_building_crew', direction: 'horizontal', crossAlign: 'center', gap: 8, visible: false });
		crew.addChild(new DeckGlyph());
		const crewText = new Text({ id: 'compound_building_crew_text', wrap: 'none', style: { fontRole: 'mono', fontSize: 12, textTransform: 'uppercase', color: 'text_dim' } });
		crew.addChild(crewText);
		box.addChild(crew);
		const reason = new Text({ id: 'compound_building_reason', widthMode: 'fill', wrap: 'word', style: { fontSize: LINE_SIZE, color: 'text_dim' } });
		box.addChild(reason);
		const action = new AtlasButton({ id: 'compound_building_action', label: 'Open', block: true, disabled: true, visible: false, onClick: () => this.open(this.chosenBuilding) });
		box.addChild(action);
		this.building = { glyph, name, state, description, crew, crewText, reason, action };
		return box;
	}

	/**
	 * The day's orders: what the last day did and why it couldn't be saved,
	 * each hidden until there's something to say, then Rest and Scavenge side
	 * by side, each with its line under the pair. The report sits above the
	 * buttons, so the box grows upward and the buttons stay where the pointer
	 * left them.
	 */
	private createDayBox(): LegendBox {
		const box = new LegendBox({ id: 'compound_day_box', title: 'The day', widthMode: 'fill', crossAlign: 'stretch', gap: 10, margin: { left: 4, right: 4 } });
		this.report = caption({ id: 'compound_report', text: '' });
		this.report.visible = false;
		box.addChild(this.report);
		this.saveError = caption({ id: 'compound_save_error', text: '' });
		this.saveError.visible = false;
		box.addChild(this.saveError);
		const days = new FocusGroup({ id: 'compound_day_actions', orientation: 'both', direction: 'horizontal', widthMode: 'fill', crossAlign: 'stretch', gap: 10 });
		this.restButton = new AtlasButton({ id: 'compound_rest_button', label: 'Rest a day', block: true, disabled: true, onClick: () => { void this.rest(); } });
		days.addChild(this.restButton);
		this.scavengeButton = new AtlasButton({ id: 'compound_scavenge_button', label: 'Scavenge', block: true, disabled: true, onClick: () => { void this.scavenge(); } });
		days.addChild(this.scavengeButton);
		box.addChild(days);
		const lines = new Stack({ id: 'compound_day_lines', widthMode: 'fill', crossAlign: 'stretch', gap: 2 });
		this.restLine = dayLine({ id: 'compound_rest_line', text: 'Looking for the saved campaign.' });
		lines.addChild(this.restLine);
		// Empty until there's a campaign whose day it can preview.
		this.scavengeLine = dayLine({ id: 'compound_scavenge_line', text: '' });
		lines.addChild(this.scavengeLine);
		box.addChild(lines);
		return box;
	}

	private async loadSave(): Promise<void> {
		const visit = this.visit;
		let campaign: Campaign | null = null;
		let trouble = 'No campaign in progress.';
		try {
			campaign = await this.store.load();
		} catch (error) {
			if (!(error instanceof CampaignStoreError)) console.error('CompoundScreen: loading the save failed', error);
			trouble = error instanceof CampaignStoreError ? error.message : "The saved campaign couldn't be read.";
		}
		if (visit !== this.visit) return;
		if (campaign) {
			this.show(campaign);
			await this.mapLoaded;
		}
		else if (this.restLine) {
			this.restLine.text = trouble;
			this.restLine.color = 'status_crit';
		}
	}

	private show(campaign: Campaign): void {
		this.campaign = campaign;
		if (this.dayLabel) this.dayLabel.visible = true;
		if (this.stores) this.stores.visible = true;
		this.map = this.maps.known(campaign);
		this.refresh();
		// A save holding a campaign already over (another tab's, or a hand-made one) is ended in the store first.
		if (campaign.isOver) void this.settleFall(campaign);
		else if (!this.map) this.mapLoaded = this.loadMap(campaign);
	}

	/** The campaign's area map, for Plan, saying how far it's got on Plan's line until it's in. */
	private async loadMap(campaign: Campaign): Promise<void> {
		const visit = this.visit;
		const waiting = (text: string) => {
			if (visit !== this.visit) return;
			this.mapWait = text;
			this.refresh();
		};
		try {
			const map = await this.maps.load(campaign, { signal: this.waiting?.signal, onProgress: (progress) => waiting(mapProgressText(progress)) });
			if (visit !== this.visit || this.campaign !== campaign) return;
			this.map = map;
			this.refresh();
		} catch (error) {
			if (visit !== this.visit) return;
			console.error('CompoundScreen: the area map could not be made', error);
			waiting("The area map couldn't be made, so no run can be planned.");
		}
	}

	/**
	 * A lost campaign's checkpoint, which ends it in the store (its history
	 * line in, its save removed), then the defeat screen. A checkpoint that
	 * fails shows its reason over the buttons, and Rest tries it again.
	 */
	private async settleFall(campaign: Campaign): Promise<void> {
		const visit = this.visit;
		this.passingDay = true;
		const result = await this.store.checkpoint(campaign);
		if (visit !== this.visit) return;
		this.passingDay = false;
		this.afterCheckpoint({ campaign, result });
	}

	/**
	 * After a day end's or a fall's checkpoint: a lost campaign whose end is
	 * in the history, from this checkpoint or one before, goes to the defeat
	 * screen. One whose end failed to save stays, its reason over the buttons
	 * (`onSaveFailed`), and Rest tries again. An instance the store has moved
	 * on from (the save was loaded again, replaced, or deleted, or a campaign
	 * still standing was ended elsewhere) is stranded, lost or not.
	 */
	private afterCheckpoint({ campaign, result }: { campaign: Campaign; result: CheckpointResult }): void {
		if (result === 'ended' && campaign.isOver) this.toDefeat(campaign);
		else if (result === 'ended' || result === 'retired') this.strand();
	}

	/**
	 * Nothing done here would be saved any more: says so over the buttons,
	 * and turns off Rest, Scavenge, Plan, the building's action, and the tabs
	 * but Menu, each saying why. Focus on one of them goes to the Compound
	 * tab, from which Menu picks up the save.
	 */
	private strand(): void {
		if (this.halted !== null) return;
		this.halted = 'stranded';
		const focused = this.context.focus.focused;
		const turnedOff = [this.restButton, this.scavengeButton, this.planButton, this.building?.action, this.tab('area_map'), this.tab('crew')];
		this.refresh();
		this.showLine({ line: this.saveError, text: NOT_THE_SAVE, color: 'status_crit' });
		const home = this.tab('compound');
		if (focused !== null && turnedOff.includes(focused as never) && home) this.context.focus.focus(home);
	}

	/** Everything that reads the campaign, again. */
	private refresh(): void {
		const campaign = this.campaign;
		if (!campaign) return;
		const { day, resources } = campaign;
		if (this.dayLabel) this.dayLabel.text = dayText(day);

		const forecast = forecastNeeds({ resources });
		const short = new Set<string>(UPKEEP_RESOURCES.filter((resource) => isShort(forecast[resource])));
		for (const kind of RESOURCE_ORDER) {
			const item = this.stores?.item(kind);
			if (!item) continue;
			item.value = resources[kind];
			item.shortfall = short.has(kind);
		}
		const stranded = this.halted === 'stranded';
		this.refreshTabs();
		this.refreshBuildings();

		// Rest stays live once the campaign is over, to save its end again.
		const restWaits = this.restWaits;
		if (this.restButton) this.restButton.enabled = !restWaits && !stranded;
		if (this.restLine) {
			if (stranded) this.restLine.text = STRANDED_DAY;
			else this.restLine.text = restWaits ? REST_RUN_OUT : restCaption({ day, forecast, over: campaign.isOver });
			this.restLine.color = 'text_dim';
		}
		const blocker = getScavengeBlocker({ campaign });
		if (this.scavengeButton) this.scavengeButton.enabled = blocker === null && !stranded;
		if (this.scavengeLine) {
			// Rest's line says why both are off.
			if (stranded) this.scavengeLine.text = '';
			else this.scavengeLine.text = blocker === null ? scavengeCaption(rollScavengeHaul({ seed: campaign.seed, day })) : scavengeRefusal(blocker);
		}
		const map = this.map;
		const plan = map ? getPlanBlocker({ campaign, map }) : null;
		if (this.planButton) this.planButton.enabled = map !== null && plan === null && !stranded;
		if (this.planLine) {
			if (stranded) this.planLine.text = STRANDED_BUILDING;
			else if (!map) this.planLine.text = this.mapWait;
			else this.planLine.text = plan === null ? destinationsText({ map, campaign }) : planRefusal(plan);
		}
		const needs = this.needs;
		if (!needs) return;
		for (const row of needs.children.filter((child) => child instanceof LegendRow)) needs.removeChild(row);
		needs.visible = true;
		const lines: NeedLine[] = [
			...forecastLines(forecast),
			...campaign.drivers.filter((driver) => driver.status === 'injured').map((driver) => ({ text: injuredLine(driver), urgent: false })),
		];
		lines.forEach((line, index) => needs.addChild(new LegendRow({
			id: `compound_need_${index}`,
			text: line.text,
			symbol: line.short ? 'diamond' : 'ring',
			...(line.urgent ? { color: 'status_crit' as const } : {}),
		})));
		needs.addChild(new LegendRow({ id: 'compound_rumors', text: NO_RUMORS, symbol: 'dash' }));
	}

	private tab(section: MetaSection): SectionTab | null {
		return this.tabs?.tabs.find((tab) => tab.tabId === section) ?? null;
	}

	/** Area map and Crew open with a campaign to hand them, the Crew only once the bunkhouse stands; none while stranded. */
	private refreshTabs(): void {
		const areaMap = this.tab('area_map');
		const crew = this.tab('crew');
		if (areaMap) areaMap.enabled = !this.tabHeld('area_map');
		if (crew) crew.enabled = !this.tabHeld('crew');
	}

	/**
	 * Whether a tab can't go yet: the area map and the Crew screen need a
	 * campaign to hand them, the Crew a bunkhouse standing, and neither goes
	 * while a day end is being saved or the screen has halted. Menu always goes.
	 */
	private tabHeld(section: string): boolean {
		if (section === 'menu') return false;
		const campaign = this.campaign;
		if (!campaign || this.passingDay || this.halted !== null) return true;
		return section === 'crew' && !campaign.isBuilt('bunkhouse');
	}

	/** Each building on the plate, built or staked out, and the chosen one's box. */
	private refreshBuildings(): void {
		const yard = this.yard;
		if (!yard) return;
		yard.parked = (this.campaign?.currentRun ?? null) === null;
		for (const id of BUILDING_IDS) {
			const built = this.campaign?.isBuilt(id) ?? false;
			yard.setBuilt({ building: id, built, state: this.campaign ? buildingState(built) : '' });
		}
		this.showBuilding();
	}

	/** A building chosen on the plate: circled there, and shown in the box. */
	private choose(id: BuildingId): void {
		this.chosen = id;
		if (this.yard) this.yard.chosenBuilding = id;
		this.showBuilding();
	}

	private get chosenBuilding(): Building {
		return BUILDINGS.find((building) => building.id === this.chosen) ?? BUILDINGS[0];
	}

	/** The chosen building's box: its action when it stands and has a screen, else why not. */
	private showBuilding(): void {
		const parts = this.building;
		if (!parts) return;
		const building = this.chosenBuilding;
		const campaign = this.campaign;
		const built = campaign?.isBuilt(building.id) ?? false;
		parts.glyph.label = buildingNumber(building.id);
		parts.name.text = building.name;
		parts.state.text = campaign ? buildingState(built) : '';
		parts.state.visible = campaign !== null;
		parts.description.text = building.description;
		const crew = building.id === 'bunkhouse' && campaign !== null && built;
		parts.crew.visible = crew;
		if (crew && campaign) parts.crewText.text = crewLine(campaign);
		const action = building.action ?? null;
		const stranded = this.halted === 'stranded';
		parts.action.visible = action !== null && (built || !campaign);
		if (action) parts.action.label = action;
		parts.action.enabled = action !== null && campaign !== null && built && !stranded;
		let reason: string | null;
		if (stranded && action !== null && built) reason = STRANDED_BUILDING;
		else if (!campaign) reason = action !== null ? NO_CAMPAIGN : building.reason;
		else if (!built) reason = unbuiltReason(building);
		else reason = building.reason;
		parts.reason.text = reason ?? '';
		parts.reason.visible = reason !== null;
	}

	/** Rest waits while a run is out, since the run's return ends the day. */
	private get restWaits(): boolean {
		return (this.campaign?.currentRun ?? null) !== null;
	}

	/** A day of rest, refused while a run is out; once the campaign is over, its end's checkpoint again. */
	private async rest(): Promise<void> {
		if (!this.campaign || this.restWaits) return;
		await this.passDay((campaign) => dayEndReport(endDay({ campaign })));
	}

	/** A party out on foot for the day, refused as `getScavengeBlocker` says. */
	private async scavenge(): Promise<void> {
		if (!this.campaign || getScavengeBlocker({ campaign: this.campaign }) !== null) return;
		await this.passDay((campaign) => scavengeReport(sendScavengingParty({ campaign })));
	}

	/**
	 * Ends the day with `step`, which says what it did, then checkpoints. A
	 * second press of either while the checkpoint is on its way does
	 * nothing, so the next step starts after it, as the store asks, and nor
	 * does one within `SECOND_PRESS_MS` of the day ending. A night
	 * that empties the compound ends the campaign, and its checkpoint ends it
	 * in the store, writing the history line and removing the save, before
	 * the defeat screen opens (`afterCheckpoint`). A save that fails says so
	 * over the buttons (`onSaveFailed`), and a fall whose checkpoint failed
	 * stays here: the save still holds the day before, and Rest tries the
	 * checkpoint again without ending another day. Nothing ends once the
	 * screen has halted.
	 */
	private async passDay(step: (campaign: Campaign) => NeedLine): Promise<void> {
		const campaign = this.campaign;
		if (!campaign || this.passingDay || this.halted !== null) return;
		if (this.context.clock.now - this.dayEndedAt < SECOND_PRESS_MS) return;
		this.passingDay = true;
		const visit = this.visit;
		if (this.saveError) this.saveError.visible = false;
		if (!campaign.isOver) {
			let report: NeedLine;
			try {
				report = step(campaign);
			} catch (error) {
				console.error('CompoundScreen: ending the day failed', error);
				this.showLine({ line: this.report, text: "The day couldn't end.", color: 'status_crit' });
				this.passingDay = false;
				return;
			}
			this.dayEndedAt = this.context.clock.now;
			const scavengeFocused = this.context.focus.focused === this.scavengeButton;
			this.refresh();
			// A night that ends the campaign disables Scavenge; focus goes to Rest, which saves the end again, not to nothing (R9.28).
			if (scavengeFocused && this.restButton?.enabled && !this.scavengeButton?.enabled) this.context.focus.focus(this.restButton);
			this.showLine({ line: this.report, text: report.text, color: report.urgent ? 'status_crit' : 'text_dim' });
		}
		const result = await this.store.checkpoint(campaign);
		if (visit !== this.visit) return;
		this.passingDay = false;
		this.refreshTabs();
		this.afterCheckpoint({ campaign, result });
	}

	private showLine({ line, text, color }: { line: Text | null; text: string; color: ColorToken }): void {
		if (!line) return;
		line.text = text;
		line.color = color;
		line.visible = true;
	}

	/** The campaign is lost: the defeat screen, handed the campaign, once. */
	private toDefeat(campaign: Campaign): void {
		if (this.halted !== null) return;
		this.halted = 'defeated';
		ScreenManager.navigate('defeatScreen', { campaign });
	}

	/**
	 * A building's screen, handed the campaign, once it stands; Back from it
	 * lands where focus was. Not while a day end is being saved, so the next
	 * step starts after its checkpoint, as a second Rest or Scavenge waits.
	 */
	private open(building: Building): void {
		const campaign = this.campaign;
		if (!campaign || !building.screen || !campaign.isBuilt(building.id) || this.passingDay || this.halted !== null) return;
		ScreenManager.navigate(building.screen, { campaign });
	}

	/** The area map, handed the campaign, to plan a run; refused as `getPlanBlocker` says. */
	private plan(): void {
		const { campaign, map } = this;
		if (!campaign || !map || this.passingDay || this.halted !== null || getPlanBlocker({ campaign, map }) !== null) return;
		ScreenManager.navigate('areaMapScreen', { campaign });
	}

	/** To the menu, focus back on the button that opened this screen. */
	private back(): void {
		ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}

/** Plan's line when a run can go: "31 destinations on the area map". */
function destinationsText({ map, campaign }: { map: PlanningMap; campaign: Campaign }): string {
	const destinations = new Set(routesOnOffer({ map, campaign }).map((route) => route.destination.id)).size;
	return `${destinations} destination${destinations === 1 ? '' : 's'} on the area map`;
}

function caption({ id, text, color = 'text_dim' }: { id: string; text: string; color?: ColorToken }): Text {
	return new Text({ text, id, widthMode: 'fill', style: { fontSize: LINE_SIZE, color } });
}

/** A caption held at two lines, a longer one ending in an ellipsis. */
function dayLine({ id, text }: { id: string; text: string }): Text {
	return new Text({
		text,
		id,
		widthMode: 'fill',
		height: TWO_LINES,
		lineHeight: LINE_HEIGHT,
		textOverflow: 'ellipsis',
		style: { fontSize: LINE_SIZE, color: 'text_dim' },
	});
}
