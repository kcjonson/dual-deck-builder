import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { Campaign, Resources } from '../../campaign/Campaign';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import type { CheckpointResult } from '../../campaign/CampaignStore';
import { endDay, forecastNeeds } from '../../campaign/DayClock';
import { getScavengeBlocker, rollScavengeHaul, scavenge as sendScavengingParty } from '../../campaign/Scavenging';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Divider } from '../../../engine/ui/Divider';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { Panel } from '../../../engine/ui/Panel';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import {
	BUILDINGS,
	Building,
	NOT_THE_SAVE,
	NeedLine,
	RESOURCE_ORDER,
	REST_RUN_OUT,
	STRANDED_BUILDING,
	STRANDED_DAY,
	dayEndReport,
	dayText,
	forecastLines,
	injuredLine,
	resourceText,
	restCaption,
	scavengeCaption,
	scavengeRefusal,
	scavengeReport,
} from './compoundText';

const { space } = tokens;
const TOP_BAR_HEIGHT = 64;
const SIDE_WIDTH = 320;
const BUILDINGS_PER_ROW = 3;
/** A button doesn't hug its label, so the top bar's have widths that fit theirs. */
const BACK_WIDTH = 136;
const AREA_MAP_WIDTH = 96;

const PLAN_REASON = "Load out and the run route aren't built yet.";
const NO_RUMORS = 'Radio: no new rumors';
const NO_CAMPAIGN = 'Opens with a campaign in progress.';
/**
 * Rest's and Scavenge's lines hold two lines of caption, the most either
 * takes, so the buttons above them stay put under the pointer as the lines
 * change.
 */
const DAY_LINE_HEIGHT = 2 * tokens.fontSize.fs_sm * tokens.lineHeight.lh;
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
}

/**
 * The compound (Game Flow 3.1), the campaign's home screen: a top bar with
 * Back to menu, the day, the Area map, and the stores; the buildings as the
 * menu, in a grid where the illustrated scene will go; and beside them the
 * needs panel (food and water forecasts, injured drivers, rumors) over Rest
 * and Scavenge, side by side, and Plan a supply run.
 *
 * The bunkhouse opens the Crew screen with the campaign. Nothing behind the
 * other buildings, the Area map, or Plan a supply run exists yet, so each
 * is disabled with its reason as a line of text, as the main menu's
 * Continue is: a disabled control takes no focus or hover (R9.5), and a
 * tooltip needs one of them (R12.22). The Area map's reason is the Map
 * room's, on its tile, which leaves the top bar room for the stores. Rest
 * and Scavenge are live: each ends the day (`endDay`, `scavenge`) and
 * checkpoints the campaign, and each is disabled with its reason while a
 * run is out, Scavenge also once the campaign is over.
 *
 * A day that loses the campaign goes to the defeat screen once its end is
 * saved (`DefeatScreen`), handed the campaign. A checkpoint that finds the
 * store has moved on from this instance strands the screen: it says nothing
 * more is saved here, and Rest, Scavenge, and the buildings turn off.
 *
 * Focus starts on Back to menu, not Rest or Scavenge, so a stray Enter
 * can't spend a day. The buildings are a focus group (R9.29), and so are
 * Rest, Scavenge, and Plan a supply run. Escape returns to the menu with
 * focus restored, as Back does from the menu's other screens. Opened with no campaign, as a capture or the dev
 * navigate hook does, it loads the save as Continue would.
 */
export class CompoundScreen extends Screen {
	private readonly stack: Stack;
	private readonly store: CampaignStore;
	private campaign: Campaign | null = null;
	private dayLabel: Text | null = null;
	private stores: Stack | null = null;
	private readonly resources = new Map<keyof Resources, Text>();
	private needs: Stack | null = null;
	private needsScroll: ScrollContainer | null = null;
	private restButton: Button | null = null;
	private restLine: Text | null = null;
	private scavengeButton: Button | null = null;
	private scavengeLine: Text | null = null;
	private report: Text | null = null;
	private saveError: Text | null = null;
	private backButton: Button | null = null;
	/**
	 * Nothing more starts here: the campaign is lost and the defeat screen is
	 * on its way, or the store has moved on from this instance, so nothing
	 * done here would be saved.
	 */
	private halted: 'defeated' | 'stranded' | null = null;
	/** The buttons of buildings whose screens exist, enabled once there's a campaign to open them with, and the lines saying so until then. */
	private readonly liveBuildings: { button: Button; waiting: Text }[] = [];
	private unsubscribe: (() => void) | null = null;
	/** A day end (Rest or Scavenge) or a fall's checkpoint is on its way, so the next step waits for it. */
	private passingDay = false;
	/** The clock's time when the last day ended, for `SECOND_PRESS_MS`. */
	private dayEndedAt = -Infinity;
	/** Counts mounts and unmounts, so an answer that arrives after the screen has gone changes nothing. */
	private visit = 0;
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared }: CompoundScreenOptions = {}) {
		const root = new Stack({
			id: 'compoundScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			style: { backgroundColor: 'bg_base' },
		});
		super('compoundScreen', { root });
		this.stack = root;
		this.store = store;
	}

	/** The campaign on show, once there is one. */
	public get shown(): Campaign | null {
		return this.campaign;
	}

	/** Settles once a save loaded on mount has been shown. */
	public get campaignLoaded(): Promise<void> {
		return this.loaded;
	}

	protected onMount(data?: unknown): void {
		this.visit += 1;
		const back = new Button({
			label: 'Back to menu',
			id: 'compound_back_button',
			icon: 'arrow_back',
			size: 'sm',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		});
		this.backButton = back;
		this.stack.addChild(this.createTopBar(back));
		this.stack.addChild(new Divider({ id: 'compound_top_rule' }));

		const body = new Stack({
			id: 'compound_body',
			direction: 'horizontal',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			padding: space.space_4,
			gap: space.space_4,
		});
		body.addChild(createBuildings({ open: (building) => this.open(building), live: this.liveBuildings }));
		body.addChild(this.createSide());
		this.stack.addChild(body);

		const { hotkeys } = this.rootLayer;
		hotkeys.register('Escape', () => this.back());
		hotkeys.register('PageDown', () => this.needsScroll?.scrollByPages(1));
		hotkeys.register('PageUp', () => this.needsScroll?.scrollByPages(-1));
		this.unsubscribe = this.store.onSaveFailed((error) => this.showLine({ line: this.saveError, text: error.message, color: 'status_crit' }));
		this.context.focus.focus(back);

		const handed = (data as Partial<CompoundScreenData> | undefined)?.campaign;
		if (handed) this.show(handed);
		else this.loaded = this.loadSave();
	}

	protected onUnmount(): void {
		this.visit += 1;
		const { hotkeys } = this.rootLayer;
		for (const key of ['Escape', 'PageDown', 'PageUp']) hotkeys.unregister(key);
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.halted = null;
		this.backButton = null;
		this.stack.clearChildren();
		this.campaign = null;
		this.dayLabel = null;
		this.stores = null;
		this.resources.clear();
		this.needs = null;
		this.needsScroll = null;
		this.restButton = null;
		this.restLine = null;
		this.scavengeButton = null;
		this.scavengeLine = null;
		this.report = null;
		this.saveError = null;
		this.liveBuildings.length = 0;
		this.passingDay = false;
		this.dayEndedAt = -Infinity;
	}

	private createTopBar(back: Button): Stack {
		const bar = new Stack({
			id: 'compound_top_bar',
			direction: 'horizontal',
			widthMode: 'fill',
			height: TOP_BAR_HEIGHT,
			padding: { left: space.space_4, right: space.space_4 },
			crossAlign: 'center',
			gap: space.space_4,
			style: { backgroundColor: 'bg_panel' },
		});
		bar.addChild(back);

		const heading = new Stack({ id: 'compound_heading', crossAlign: 'start' });
		heading.addChild(new Text({
			text: 'The Compound',
			id: 'compound_title',
			style: { fontRole: 'display', fontSize: 'fs_xl', color: 'text_bright', textTransform: 'uppercase', letterSpacing: 'ls_wide' },
			wrap: 'none',
		}));
		// The day and the stores show once there's a campaign.
		this.dayLabel = new Text({ id: 'compound_day', visible: false, style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_dim' }, wrap: 'none' });
		heading.addChild(this.dayLabel);
		bar.addChild(heading);

		bar.addChild(new Button({ label: 'Area map', id: 'compound_area_map_button', size: 'sm', width: AREA_MAP_WIDTH, disabled: true }));

		this.stores = new Stack({
			id: 'compound_resources',
			direction: 'horizontal',
			widthMode: 'fill',
			distribution: 'end',
			crossAlign: 'center',
			gap: space.space_1_5,
			visible: false,
		});
		for (const resource of RESOURCE_ORDER) {
			const chip = new Stack({
				id: `compound_resource_${resource}`,
				padding: { top: space.space_1, bottom: space.space_1, left: space.space_2, right: space.space_2 },
				style: { borderColor: 'line_edge', borderWidth: 'bw', borderRadius: 'r_sm' },
			});
			const amount = new Text({ style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text' }, wrap: 'none' });
			chip.addChild(amount);
			this.stores.addChild(chip);
			this.resources.set(resource, amount);
		}
		bar.addChild(this.stores);
		return bar;
	}

	private createSide(): Stack {
		const side = new Stack({ id: 'compound_side', width: SIDE_WIDTH, heightMode: 'fill', crossAlign: 'stretch', gap: space.space_4 });

		const panel = new Panel({ id: 'compound_needs_panel', title: 'Needs', compact: true, heightMode: 'fill', crossAlign: 'stretch' });
		// Empty, and hidden, until there's a campaign to read.
		this.needs = new Stack({ id: 'compound_needs', crossAlign: 'stretch', gap: space.space_1_5, visible: false });
		this.needsScroll = new ScrollContainer({ id: 'compound_needs_scroll', widthMode: 'fill', heightMode: 'fill' });
		this.needsScroll.addChild(this.needs);
		panel.addChild(this.needsScroll);
		side.addChild(panel);

		const actions = new FocusGroup({ id: 'compound_actions', orientation: 'vertical', crossAlign: 'stretch', gap: space.space_1_5 });
		// What the last day did, and why it couldn't be saved; each hidden until there's something to say. Above
		// the buttons, so the column grows upward into the panel and the buttons stay where the pointer left them.
		this.report = caption({ id: 'compound_report', text: '' });
		this.report.visible = false;
		actions.addChild(this.report);
		this.saveError = caption({ id: 'compound_save_error', text: '' });
		this.saveError.visible = false;
		actions.addChild(this.saveError);
		// The two ways to spend a day at home, side by side, each with its line under the pair.
		const days = new Stack({ id: 'compound_day_actions', direction: 'horizontal', crossAlign: 'stretch', gap: space.space_1_5 });
		this.restButton = new Button({
			label: 'Rest a day',
			id: 'compound_rest_button',
			block: true,
			disabled: true,
			onClick: () => { void this.rest(); },
		});
		days.addChild(this.restButton);
		this.scavengeButton = new Button({
			label: 'Scavenge',
			id: 'compound_scavenge_button',
			block: true,
			disabled: true,
			onClick: () => { void this.scavenge(); },
		});
		days.addChild(this.scavengeButton);
		actions.addChild(days);
		this.restLine = dayLine({ id: 'compound_rest_line', text: 'Looking for the saved campaign.' });
		actions.addChild(this.restLine);
		// Empty until there's a campaign whose day it can preview.
		this.scavengeLine = dayLine({ id: 'compound_scavenge_line', text: '' });
		actions.addChild(this.scavengeLine);
		actions.addChild(new Button({
			label: 'Plan a supply run',
			id: 'compound_plan_button',
			tone: 'accent',
			size: 'lg',
			block: true,
			disabled: true,
			margin: { top: space.space_3 },
		}));
		actions.addChild(caption({ id: 'compound_plan_reason', text: PLAN_REASON }));
		side.addChild(actions);
		return side;
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
		if (campaign) this.show(campaign);
		else if (this.restLine) {
			this.restLine.text = trouble;
			this.restLine.color = 'status_warn';
		}
	}

	private show(campaign: Campaign): void {
		this.campaign = campaign;
		for (const { button, waiting } of this.liveBuildings) {
			button.enabled = true;
			waiting.visible = false;
		}
		if (this.dayLabel) this.dayLabel.visible = true;
		if (this.stores) this.stores.visible = true;
		this.refresh();
		// A save holding a campaign already over (another tab's, or a hand-made one) is ended in the store first.
		if (campaign.isOver) void this.settleFall(campaign);
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
	 * and turns off Rest, Scavenge, and the buildings, each saying why. Focus
	 * on one of them goes to Back to menu, which picks up the save.
	 */
	private strand(): void {
		if (this.halted !== null) return;
		this.halted = 'stranded';
		const focused = this.context.focus.focused;
		const turnedOff = [this.restButton, this.scavengeButton, ...this.liveBuildings.map(({ button }) => button)];
		for (const { button, waiting } of this.liveBuildings) {
			button.enabled = false;
			waiting.text = STRANDED_BUILDING;
			waiting.visible = true;
		}
		this.refresh();
		this.showLine({ line: this.saveError, text: NOT_THE_SAVE, color: 'status_warn' });
		if (focused !== null && turnedOff.includes(focused as Button) && this.backButton) this.context.focus.focus(this.backButton);
	}

	/** Everything that reads the campaign, again. */
	private refresh(): void {
		const campaign = this.campaign;
		if (!campaign) return;
		const { day, resources } = campaign;
		if (this.dayLabel) this.dayLabel.text = dayText(day);
		for (const [resource, amount] of this.resources) amount.text = resourceText({ resource, amount: resources[resource] });

		const forecast = forecastNeeds({ resources });
		// Rest stays live once the campaign is over, to save its end again.
		const restWaits = this.restWaits;
		const stranded = this.halted === 'stranded';
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
		const needs = this.needs;
		if (!needs) return;
		needs.clearChildren();
		needs.visible = true;
		const lines: NeedLine[] = [
			...forecastLines(forecast),
			...campaign.drivers.filter((driver) => driver.status === 'injured').map((driver) => ({ text: injuredLine(driver), urgent: false })),
		];
		lines.forEach((line, index) => needs.addChild(needRow({ id: `compound_need_${index}`, text: line.text, color: line.urgent ? 'status_crit' : 'text' })));
		needs.addChild(needRow({ id: 'compound_rumors', text: NO_RUMORS, color: 'text_dim' }));
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
			this.showLine({ line: this.report, text: report.text, color: report.urgent ? 'status_warn' : 'text_dim' });
		}
		const result = await this.store.checkpoint(campaign);
		if (visit !== this.visit) return;
		this.passingDay = false;
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
	 * A building's screen, handed the campaign; Back from it lands on the
	 * building's button. Not while a day end is being saved, so the next
	 * step starts after its checkpoint, as a second Rest or Scavenge waits.
	 */
	private open(building: Building): void {
		if (!this.campaign || !building.screen || this.passingDay || this.halted !== null) return;
		ScreenManager.navigate(building.screen, { campaign: this.campaign });
	}

	/** To the menu, focus back on the button that opened this screen. */
	private back(): void {
		ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}

/**
 * The buildings as the menu: rows of three tiles that share the room, where
 * the illustrated scene will go. One focus group whose Left and Right move
 * through the buildings in reading order; Up and Down go unconsumed to
 * directional focus (R9.24, R9.26), so they move between the rows. A
 * building whose screen exists has its button added to `live`, disabled
 * until there's a campaign to open it with, with a line saying so.
 */
function createBuildings({ open, live }: { open: (building: Building) => void; live: { button: Button; waiting: Text }[] }): FocusGroup {
	const grid = new FocusGroup({
		id: 'compound_buildings',
		orientation: 'horizontal',
		direction: 'vertical',
		widthMode: 'fill',
		heightMode: 'fill',
		crossAlign: 'stretch',
		gap: space.space_3,
	});
	for (let start = 0; start < BUILDINGS.length; start += BUILDINGS_PER_ROW) {
		const row = new Stack({
			id: `compound_building_row_${start / BUILDINGS_PER_ROW}`,
			direction: 'horizontal',
			heightMode: 'fill',
			crossAlign: 'stretch',
			gap: space.space_3,
		});
		BUILDINGS.slice(start, start + BUILDINGS_PER_ROW).forEach((building) => row.addChild(buildingTile({ building, open, live })));
		grid.addChild(row);
	}
	return grid;
}

/**
 * A building: its name at the top, as the wireframe has it, and at the foot
 * what it's for and why it's disabled over its button, so the buttons line up
 * whatever the text above them wraps to. The art goes in the room between.
 */
function buildingTile({ building, open, live }: { building: Building; open: (building: Building) => void; live: { button: Button; waiting: Text }[] }): Stack {
	const { id, name, description, reason } = building;
	const tile = new Stack({
		id: `compound_building_${id}`,
		widthMode: 'fill',
		distribution: 'spaceBetween',
		crossAlign: 'stretch',
		padding: space.space_3,
		gap: space.space_3,
		style: { backgroundColor: 'bg_panel', borderColor: 'line_edge', borderWidth: 'bw', borderRadius: 'r_sm' },
	});
	tile.addChild(new Text({
		text: name,
		id: `compound_building_${id}_name`,
		widthMode: 'fill',
		style: { fontRole: 'display', fontSize: 'fs_lg', color: 'text_bright', textTransform: 'uppercase', letterSpacing: 'ls_wide' },
		wrap: 'none',
		textOverflow: 'ellipsis',
	}));
	const foot = new Stack({ id: `compound_building_${id}_foot`, crossAlign: 'stretch', gap: space.space_1_5 });
	foot.addChild(caption({ id: `compound_building_${id}_description`, text: description, color: 'text' }));
	// A live building is disabled only until there's a campaign, and says so.
	const waiting = building.screen ? caption({ id: `compound_building_${id}_reason`, text: NO_CAMPAIGN }) : null;
	if (reason !== null) foot.addChild(caption({ id: `compound_building_${id}_reason`, text: reason }));
	else if (waiting) foot.addChild(waiting);
	const button = new Button({
		label: name,
		id: `compound_building_${id}_button`,
		block: true,
		disabled: true,
		onClick: () => open(building),
		margin: { top: space.space_1_5 },
	});
	if (reason === null && waiting) live.push({ button, waiting });
	foot.addChild(button);
	tile.addChild(foot);
	return tile;
}

function caption({ id, text, color = 'text_dim' }: { id: string; text: string; color?: ColorToken }): Text {
	return new Text({ text, id, widthMode: 'fill', style: { fontSize: 'fs_sm', color } });
}

/** A caption held at `DAY_LINE_HEIGHT`, a longer one ending in an ellipsis. */
function dayLine({ id, text }: { id: string; text: string }): Text {
	return new Text({
		text,
		id,
		widthMode: 'fill',
		height: DAY_LINE_HEIGHT,
		lineHeight: tokens.lineHeight.lh,
		textOverflow: 'ellipsis',
		style: { fontSize: 'fs_sm', color: 'text_dim' },
	});
}

/** A line of the needs panel, boxed as the wireframe draws them. */
function needRow({ id, text, color }: { id: string; text: string; color: ColorToken }): Stack {
	const row = new Stack({
		id,
		crossAlign: 'stretch',
		padding: { top: space.space_2, bottom: space.space_2, left: space.space_3, right: space.space_3 },
		style: { borderColor: 'line_edge', borderWidth: 'bw', borderRadius: 'r_sm' },
	});
	row.addChild(new Text({ text, id: `${id}_text`, widthMode: 'fill', style: { fontSize: 'fs_base', color } }));
	return row;
}
