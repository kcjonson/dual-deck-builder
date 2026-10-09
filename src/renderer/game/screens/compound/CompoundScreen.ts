import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { Campaign, Resources } from '../../campaign/Campaign';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import { DayEnd, endDay, forecastNeeds } from '../../campaign/DayClock';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Dialog } from '../../../engine/ui/Dialog';
import { Divider } from '../../../engine/ui/Divider';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { Panel } from '../../../engine/ui/Panel';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import {
	BUILDINGS,
	Building,
	NeedLine,
	RESOURCE_ORDER,
	dayEndReport,
	dayText,
	forecastLines,
	injuredLine,
	resourceText,
	restCaption,
} from './compoundText';

const { space } = tokens;
const TOP_BAR_HEIGHT = 64;
const SIDE_WIDTH = 320;
const BUILDINGS_PER_ROW = 3;
/** A button doesn't hug its label, so the top bar's and the notice's have widths that fit theirs. */
const BACK_WIDTH = 136;
const AREA_MAP_WIDTH = 96;
const FALLEN_BUTTON_WIDTH = 160;

const PLAN_REASON = "Load out and the run route aren't built yet.";
const NO_RUMORS = 'Radio: no new rumors';

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
 * and Plan a supply run.
 *
 * Nothing behind the buildings, the Area map, or Plan a supply run exists
 * yet, so each is disabled with its reason as a line of text, as the main
 * menu's Continue is: a disabled control takes no focus or hover (R9.5),
 * and a tooltip needs one of them (R12.22). The Area map's reason is the
 * Map room's, on its tile, which leaves the top bar room for the stores.
 * Rest is live: it ends the day (`endDay`) and checkpoints the campaign.
 *
 * Focus starts on Back to menu, not Rest, so a stray Enter can't spend a
 * day. The buildings and the two actions are focus groups (R9.29), and
 * Escape returns to the menu with focus restored, as Back does from the
 * menu's other screens. Opened with no campaign, as a capture or the dev
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
	private report: Text | null = null;
	private saveError: Text | null = null;
	private fallen: Dialog | null = null;
	private unsubscribe: (() => void) | null = null;
	private resting = false;
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
		body.addChild(createBuildings());
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
		this.fallen?.close();
		this.fallen = null;
		this.stack.clearChildren();
		this.campaign = null;
		this.dayLabel = null;
		this.stores = null;
		this.resources.clear();
		this.needs = null;
		this.needsScroll = null;
		this.restButton = null;
		this.restLine = null;
		this.report = null;
		this.saveError = null;
		this.resting = false;
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
		this.restButton = new Button({
			label: 'Rest a day',
			id: 'compound_rest_button',
			block: true,
			disabled: true,
			onClick: () => { void this.rest(); },
		});
		actions.addChild(this.restButton);
		this.restLine = caption({ id: 'compound_rest_line', text: 'Looking for the saved campaign.' });
		actions.addChild(this.restLine);
		// What the last night did, and why it couldn't be saved; each hidden until there's something to say.
		this.report = caption({ id: 'compound_report', text: '' });
		this.report.visible = false;
		actions.addChild(this.report);
		this.saveError = caption({ id: 'compound_save_error', text: '' });
		this.saveError.visible = false;
		actions.addChild(this.saveError);
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
		if (this.restButton) this.restButton.enabled = true;
		if (this.dayLabel) this.dayLabel.visible = true;
		if (this.stores) this.stores.visible = true;
		this.refresh();
		// A save made the night the last people left has fallen already.
		if (campaign.resources.people === 0) this.compoundFell();
	}

	/** Everything that reads the campaign, again. */
	private refresh(): void {
		const campaign = this.campaign;
		if (!campaign) return;
		const { day, resources } = campaign;
		if (this.dayLabel) this.dayLabel.text = dayText(day);
		for (const [resource, amount] of this.resources) amount.text = resourceText({ resource, amount: resources[resource] });

		const forecast = forecastNeeds({ resources });
		if (this.restLine) {
			this.restLine.text = restCaption({ day, forecast });
			this.restLine.color = 'text_dim';
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

	/**
	 * Ends the day, then checkpoints. A second press while the checkpoint is
	 * on its way does nothing, so the next step starts after it, as the store
	 * asks. A save that fails says so under Rest (`onSaveFailed`), and a fall
	 * whose save failed shows no notice: the save still holds the day before,
	 * and Rest tries the save again without ending another day.
	 */
	private async rest(): Promise<void> {
		const campaign = this.campaign;
		if (!campaign || this.resting || this.fallen) return;
		this.resting = true;
		const visit = this.visit;
		if (this.saveError) this.saveError.visible = false;
		let fell = campaign.resources.people === 0;
		if (!fell) {
			let dayEnd: DayEnd;
			try {
				dayEnd = endDay({ campaign });
			} catch (error) {
				console.error('CompoundScreen: ending the day failed', error);
				this.showLine({ line: this.report, text: "The day couldn't end.", color: 'status_crit' });
				this.resting = false;
				return;
			}
			this.refresh();
			const report = dayEndReport(dayEnd);
			this.showLine({ line: this.report, text: report.text, color: report.urgent ? 'status_warn' : 'text_dim' });
			fell = dayEnd.outcome === 'abandoned';
		}
		const saved = await this.store.checkpoint(campaign);
		if (visit !== this.visit) return;
		this.resting = false;
		if (saved && fell) this.compoundFell();
	}

	private showLine({ line, text, color }: { line: Text | null; text: string; color: ColorToken }): void {
		if (!line) return;
		line.text = text;
		line.color = color;
		line.visible = true;
	}

	/**
	 * Nobody is left at the compound, and the campaign is lost. A stand-in
	 * for the defeat screen (DDB-305), which replaces this method; it doesn't
	 * end the campaign in the store. Whatever closes it goes to the menu.
	 */
	private compoundFell(): void {
		if (this.fallen || !this.campaign) return;
		const dialog: Dialog = new Dialog({
			id: 'compound_fallen_dialog',
			kicker: dayText(this.campaign.day),
			title: 'The compound has fallen',
			size: 'sm',
			content: new Text({
				text: 'Nobody is left at the compound. The campaign is lost.',
				id: 'compound_fallen_body',
				widthMode: 'fill',
				style: { fontSize: 'fs_base', color: 'text' },
			}),
			footer: [new Button({ label: 'Back to menu', id: 'compound_fallen_back', width: FALLEN_BUTTON_WIDTH, onClick: () => dialog.close() })],
			onClose: () => {
				if (this.fallen !== dialog) return;
				this.fallen = null;
				this.back();
			},
		});
		this.fallen = dialog;
		dialog.show(this.context);
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
 * directional focus (R9.24, R9.26), so they move between the rows.
 */
function createBuildings(): FocusGroup {
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
		BUILDINGS.slice(start, start + BUILDINGS_PER_ROW).forEach((building) => row.addChild(buildingTile(building)));
		grid.addChild(row);
	}
	return grid;
}

/**
 * A building: its name at the top, as the wireframe has it, and at the foot
 * what it's for and why it's disabled over its button, so the buttons line up
 * whatever the text above them wraps to. The art goes in the room between.
 */
function buildingTile({ id, name, description, reason, action }: Building): Stack {
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
	if (reason !== null) foot.addChild(caption({ id: `compound_building_${id}_reason`, text: reason }));
	foot.addChild(new Button({
		label: name,
		id: `compound_building_${id}_button`,
		block: true,
		disabled: reason !== null,
		onClick: action,
		margin: { top: space.space_1_5 },
	}));
	tile.addChild(foot);
	return tile;
}

function caption({ id, text, color = 'text_dim' }: { id: string; text: string; color?: ColorToken }): Text {
	return new Text({ text, id, widthMode: 'fill', style: { fontSize: 'fs_sm', color } });
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
