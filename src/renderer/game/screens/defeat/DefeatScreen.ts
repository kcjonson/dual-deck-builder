import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { Campaign } from '../../campaign/Campaign';
import { campaignStats } from '../../campaign/CampaignEnd';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Divider } from '../../../engine/ui/Divider';
import { Panel } from '../../../engine/ui/Panel';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import { fellOnText } from '../main-menu/campaignText';
import { FALL_TITLES, NO_FALL, fallStory, lastDayLines, recordRows } from './defeatText';

const { space } = tokens;
const STORY_WIDTH = 560;
/** The last day beside the record, with the gap between, fits inside the root's padding at 1024 wide. */
const LAST_DAY_WIDTH = 400;
const RECORD_WIDTH = 520;
const LABEL_WIDTH = 170;
const BACK_WIDTH = 200;

/** What the compound hands the defeat screen once a lost campaign's end is saved: the campaign. */
export interface DefeatScreenData {
	campaign: Campaign;
}

export interface DefeatScreenOptions {
	/** Where a save is loaded from when no campaign is handed over. Default: the game's shared store. */
	store?: CampaignStore;
}

/**
 * The campaign's defeat (Game Flow 6.3): over the day it fell on, how the
 * compound fell, why (the last driver lost, or the last People gone, and the
 * state that chose the ending), then the last day's log, in place of the
 * final moments, beside the campaign's record from `campaignStats`, then Back
 * to menu. A root stack centres it all, as Campaign History does.
 *
 * The compound hands it the campaign once the end's checkpoint has landed, so
 * the history already holds its line and the save is gone. Opened with
 * nothing handed over, as a capture or the dev navigate hook does, it loads
 * the save: a campaign already over is shown, and checkpointed, which ends it
 * in the store as the compound would; a campaign still standing, or none,
 * shows that there's no fall to show, and a save that can't be loaded says
 * why. A checkpoint that fails says so under the record.
 *
 * Back to menu is the only control, so focus starts there; Enter on it and
 * Escape both go to the menu with focus restored, which lands on New
 * Campaign, since Continue has nothing left to continue.
 */
export class DefeatScreen extends Screen {
	private readonly stack: Stack;
	private readonly store: CampaignStore;
	private campaign: Campaign | null = null;
	private content: Stack | null = null;
	private saveError: Text | null = null;
	private unsubscribe: (() => void) | null = null;
	/** Counts mounts and unmounts, so an answer that arrives after the screen has gone changes nothing. */
	private visit = 0;
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared }: DefeatScreenOptions = {}) {
		const root = new Stack({
			id: 'defeatScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			distribution: 'center',
			crossAlign: 'center',
			gap: space.space_4,
			padding: space.space_6,
			style: { backgroundColor: 'bg_base' },
		});
		super('defeatScreen', { root });
		this.stack = root;
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
		this.content = new Stack({ id: 'defeat_content', crossAlign: 'center', gap: space.space_3 });
		this.stack.addChild(this.content);
		this.saveError = new Text({
			text: '',
			id: 'defeat_save_error',
			width: STORY_WIDTH,
			visible: false,
			style: { fontSize: 'fs_sm', color: 'status_crit', textAlign: 'center' },
		});
		this.stack.addChild(this.saveError);
		const back = new Button({
			label: 'Back to menu',
			id: 'defeat_back_button',
			icon: 'arrow_back',
			size: 'lg',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		});
		this.stack.addChild(back);

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
		this.stack.clearChildren();
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

	/** In the fall's place, a line saying why there's none to show. */
	private showNone({ text, color }: { text: string; color: ColorToken }): void {
		this.content?.clearChildren();
		this.content?.addChild(new Text({ text, id: 'defeat_none', width: STORY_WIDTH, style: { fontSize: 'fs_md', color, textAlign: 'center' } }));
	}

	/**
	 * The fall: the day, the title, and the story, then the last day's log
	 * beside the record. Or that there's none to show, for a campaign still
	 * standing or none at all.
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
		content.addChild(new Text({
			text: fellOnText(campaign.day),
			id: 'defeat_day',
			style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_dim', textAlign: 'center' },
			wrap: 'none',
		}));
		content.addChild(new Text({
			text: FALL_TITLES[end.ending],
			id: 'defeat_title',
			style: { fontRole: 'display', fontSize: 'fs_4xl', color: 'status_crit', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 'ls_wide' },
			wrap: 'none',
		}));
		content.addChild(new Text({
			text: fallStory(end),
			id: 'defeat_story',
			width: STORY_WIDTH,
			style: { fontSize: 'fs_md', color: 'text', textAlign: 'center' },
		}));

		// Side by side, so both fit under the story at 1024x600; the row stretches them to one height.
		const panels = new Stack({ id: 'defeat_panels', direction: 'horizontal', crossAlign: 'stretch', gap: space.space_4 });
		const lastDay = lastDayLines(campaign);
		if (lastDay.length > 0) {
			const panel = new Panel({ id: 'defeat_last_day', title: 'The last day', compact: true, corners: true, width: LAST_DAY_WIDTH, crossAlign: 'stretch', gap: space.space_1_5 });
			lastDay.forEach((message, index) => {
				if (index > 0) panel.addChild(new Divider());
				panel.addChild(new Text({ text: message, id: `defeat_last_day_${index}`, widthMode: 'fill', style: { fontSize: 'fs_md', color: 'text' } }));
			});
			panels.addChild(panel);
		}
		const record = new Panel({ id: 'defeat_record', title: 'Campaign record', compact: true, corners: true, width: RECORD_WIDTH, crossAlign: 'stretch', gap: space.space_1_5 });
		recordRows({ campaign, stats: campaignStats({ campaign }) }).forEach((row, index) => {
			if (index > 0) record.addChild(new Divider());
			const line = new Stack({ id: `defeat_record_${row.id}`, direction: 'horizontal', crossAlign: 'center', gap: space.space_4 });
			line.addChild(new Text({ text: row.label, id: `defeat_record_${row.id}_label`, width: LABEL_WIDTH, style: { fontSize: 'fs_md', color: 'text_dim' }, wrap: 'none' }));
			line.addChild(new Text({ text: row.value, id: `defeat_record_${row.id}_value`, widthMode: 'fill', style: { fontRole: 'mono', fontSize: 'fs_md', color: 'text_bright' } }));
			record.addChild(line);
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
