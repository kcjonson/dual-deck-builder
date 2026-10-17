import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { Campaign } from '../../campaign/Campaign';
import { campaignStats } from '../../campaign/CampaignEnd';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { ColorToken } from '../../../engine/theme/tokens';
import { AtlasButton } from '../../ui/atlas/AtlasButton';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { ATLAS, DISPLAY_BOLD, MONO_MEDIUM } from '../../ui/atlas/atlasStyle';
import { DamageMark } from '../../ui/atlas/DamageMark';
import { LegendBox, LegendRow } from '../../ui/atlas/LegendBox';
import { fellOnText } from '../main-menu/campaignText';
import { FALL_TITLES, NO_FALL, fallStory, lastDayLines, recordRows } from './defeatText';

const STORY_WIDTH = 560;
/** The last day beside the record, with the gap between, fits inside the sheet's neatline at 1024 wide. */
const LAST_DAY_WIDTH = 380;
const RECORD_WIDTH = 500;
const BACK_WIDTH = 220;
const SAVE_ERROR_WIDTH = 420;
const TITLE_SIZE = 34;
const KICKER_SIZE = 12;

/** What the compound hands the defeat screen once a lost campaign's end is saved: the campaign. */
export interface DefeatScreenData {
	campaign: Campaign;
}

export interface DefeatScreenOptions {
	/** Where a save is loaded from when no campaign is handed over. Default: the game's shared store. */
	store?: CampaignStore;
}

/**
 * The campaign's defeat (Game Flow 6.3) on the atlas sheet: over the day it
 * fell on, how the compound fell, why (the last driver lost, or the last
 * People gone, and the state that chose the ending), then the last day's
 * log, in place of the final moments, beside the campaign's record from
 * `campaignStats`, each a legend box, then Back to menu, the highway.
 *
 * A fall is W3 (UI Art Direction, Wear): the sheet is burnt at its bottom
 * right corner and FALLEN is struck beside the title, the screen's one hero
 * mark. The page is damaged only once a fall is shown; with none to show it
 * stays W2. Back to menu sits at the left of the foot, clear of the burn.
 *
 * The compound hands it the campaign once the end's checkpoint has landed, so
 * the history already holds its line and the save is gone. Opened with
 * nothing handed over, as a capture or the dev navigate hook does, it loads
 * the save: a campaign already over is shown, and checkpointed, which ends it
 * in the store as the compound would; a campaign still standing, or none,
 * shows that there's no fall to show, and a save that can't be loaded says
 * why. A checkpoint that fails says so beside Back to menu.
 *
 * Back to menu is the only control, so focus starts there; Enter on it and
 * Escape both go to the menu with focus restored, which lands on New
 * Campaign, since Continue has nothing left to continue.
 */
export class DefeatScreen extends Screen {
	private readonly sheet: AtlasSheet;
	private readonly store: CampaignStore;
	private campaign: Campaign | null = null;
	private content: Stack | null = null;
	private saveError: Text | null = null;
	private unsubscribe: (() => void) | null = null;
	/** Counts mounts and unmounts, so an answer that arrives after the screen has gone changes nothing. */
	private visit = 0;
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared }: DefeatScreenOptions = {}) {
		const root = new AtlasSheet({
			id: 'defeatScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			distribution: 'center',
			crossAlign: 'center',
			contentInset: 16,
			paper: 'a',
		});
		super('defeatScreen', { root, theme: 'atlas' });
		this.sheet = root;
		this.store = store;
	}

	/** The lost campaign on show, once there is one. */
	public get shown(): Campaign | null {
		return this.campaign;
	}

	/** Settles once a save loaded on mount has been shown, and checkpointed when it's over. */
	public get campaignLoaded(): Promise<void> {
		return this.loaded;
	}

	protected onMount(data?: unknown): void {
		this.visit += 1;
		this.sheet.wear = 2;
		const page = new Stack({ id: 'defeat_page', crossAlign: 'stretch', gap: 20 });
		this.content = new Stack({ id: 'defeat_content', crossAlign: 'start', gap: 20 });
		page.addChild(this.content);

		const foot = new Stack({ id: 'defeat_foot', direction: 'horizontal', widthMode: 'fill', crossAlign: 'center', gap: 16 });
		const back = new AtlasButton({
			label: 'Back to menu',
			id: 'defeat_back_button',
			variant: 'highway',
			labelSize: 22,
			height: 52,
			labelAlign: 'center',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		});
		foot.addChild(back);
		this.saveError = new Text({
			text: '',
			id: 'defeat_save_error',
			width: SAVE_ERROR_WIDTH,
			visible: false,
			style: { fontSize: 14, color: 'status_crit' },
		});
		foot.addChild(this.saveError);
		page.addChild(foot);
		this.sheet.addChild(page);

		this.rootLayer.hotkeys.register('Escape', () => this.back());
		this.unsubscribe = this.store.onSaveFailed((error) => this.showError(error.message));
		this.context.focus.focus(back);

		const handed = (data as Partial<DefeatScreenData> | undefined)?.campaign;
		if (handed) this.show(handed);
		else this.loaded = this.loadSave();
	}

	protected onUnmount(): void {
		this.visit += 1;
		this.rootLayer.hotkeys.unregister('Escape');
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.sheet.clearChildren();
		this.campaign = null;
		this.content = null;
		this.saveError = null;
	}

	/** The save's campaign: shown when it's over, and its end checkpointed. A save that can't be loaded says why, as the compound does. */
	private async loadSave(): Promise<void> {
		const visit = this.visit;
		let campaign: Campaign | null = null;
		let trouble: string | null = null;
		try {
			campaign = await this.store.load();
		} catch (error) {
			if (!(error instanceof CampaignStoreError)) console.error('DefeatScreen: loading the save failed', error);
			trouble = error instanceof CampaignStoreError ? error.message : "The saved campaign couldn't be read.";
		}
		if (visit !== this.visit) return;
		if (trouble !== null) {
			this.showNone({ text: trouble, color: 'status_warn' });
			return;
		}
		this.show(campaign);
		if (campaign?.isOver) await this.store.checkpoint(campaign);
	}

	/** In the fall's place, a line saying why there's none to show, on an undamaged page. */
	private showNone({ text, color }: { text: string; color: ColorToken }): void {
		this.sheet.wear = 2;
		this.content?.clearChildren();
		this.content?.addChild(new Text({ text, id: 'defeat_none', width: STORY_WIDTH, style: { fontSize: 16, color } }));
	}

	/**
	 * The fall: the day, the title, and the story with the stamp beside
	 * them, then the last day's log beside the record. Or that there's none
	 * to show, for a campaign still standing or none at all.
	 */
	private show(campaign: Campaign | null): void {
		const content = this.content;
		if (!content) return;
		const end = campaign?.end ?? null;
		if (!campaign || end === null) {
			this.showNone({ text: NO_FALL, color: 'text_dim' });
			return;
		}
		content.clearChildren();
		this.campaign = campaign;
		this.sheet.wear = 3;

		const head = new Stack({ id: 'defeat_head', direction: 'horizontal', crossAlign: 'center', gap: 24 });
		const heading = new Stack({ id: 'defeat_heading', gap: 6 });
		heading.addChild(new Text({
			text: fellOnText(campaign.day),
			id: 'defeat_day',
			style: { fontRole: MONO_MEDIUM, fontWeight: 500, fontSize: KICKER_SIZE, letterSpacing: 0.14, textTransform: 'uppercase', color: 'text_dim' },
			wrap: 'none',
		}));
		heading.addChild(new Text({
			text: FALL_TITLES[end.ending],
			id: 'defeat_title',
			style: { fontRole: DISPLAY_BOLD, fontWeight: 700, fontSize: TITLE_SIZE, color: 'status_crit', textTransform: 'uppercase', letterSpacing: ATLAS.headTracking },
			wrap: 'none',
		}));
		heading.addChild(new Text({
			text: fallStory(end),
			id: 'defeat_story',
			width: STORY_WIDTH,
			style: { fontSize: 15, color: 'text' },
		}));
		head.addChild(heading);
		head.addChild(new DamageMark({ id: 'defeat_stamp', kind: 'fallen' }));
		content.addChild(head);

		// Side by side, so both fit under the story at 1024x600; the row stretches them to one height.
		const panels = new Stack({ id: 'defeat_panels', direction: 'horizontal', crossAlign: 'stretch', gap: 16 });
		const lastDay = lastDayLines(campaign);
		if (lastDay.length > 0) {
			const panel = new LegendBox({ id: 'defeat_last_day', title: 'The last day', width: LAST_DAY_WIDTH, crossAlign: 'stretch' });
			lastDay.forEach((message, index) => {
				panel.addChild(new LegendRow({ id: `defeat_last_day_${index}`, text: message, symbol: index === lastDay.length - 1 ? 'diamond' : undefined }));
			});
			panels.addChild(panel);
		}
		const record = new LegendBox({ id: 'defeat_record', title: 'Campaign record', width: RECORD_WIDTH, crossAlign: 'stretch' });
		recordRows({ campaign, stats: campaignStats({ campaign }) }).forEach((row) => {
			const id = `defeat_record_${row.id}`;
			record.addChild(new LegendRow({ id, text: row.label, value: row.value, textId: `${id}_label`, valueId: `${id}_value` }));
		});
		panels.addChild(record);
		content.addChild(panels);
	}

	private showError(message: string): void {
		if (!this.saveError) return;
		this.saveError.text = message;
		this.saveError.visible = true;
	}

	/** To the menu, focus back where it was when the player last left it; a disabled Continue hands it to New Campaign. */
	private back(): void {
		ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}
