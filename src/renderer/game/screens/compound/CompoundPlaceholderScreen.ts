import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Panel } from '../../../engine/ui/Panel';
import { tokens } from '../../../engine/theme/tokens';
import { campaignSummary } from '../main-menu/campaignText';

const PANEL_WIDTH = 480;
const BACK_WIDTH = 220;

/** What New Campaign and Continue hand the compound screen: the campaign, as the store saves it. */
export interface CompoundScreenData {
	campaign: Campaign;
}

export interface CompoundPlaceholderScreenOptions {
	/** Where a campaign comes from when none is handed over. Default: the game's shared store. */
	store?: CampaignStore;
}

/**
 * Stands in for the compound screen until it's built: the campaign's
 * summary and stores, and Back to menu (Escape too). It shows the campaign
 * the menu hands it; opened with none, as a capture or the dev navigate
 * hook does, it loads the save as Continue would. Registered as
 * `compoundScreen`, so the compound screen replaces this file and nothing
 * that navigates here changes.
 */
export class CompoundPlaceholderScreen extends Screen {
	private readonly stack: Stack;
	private readonly store: CampaignStore;
	private summary: Text | null = null;
	private stores: Text | null = null;
	private visit = 0;

	constructor({ store = CampaignStore.shared }: CompoundPlaceholderScreenOptions = {}) {
		const root = new Stack({
			id: 'compoundScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			distribution: 'center',
			crossAlign: 'center',
			gap: tokens.space.space_8,
			style: { backgroundColor: 'bg_base' },
		});
		super('compoundScreen', { root });
		this.stack = root;
		this.store = store;
	}

	protected onMount(data?: unknown): void {
		this.visit += 1;
		this.stack.addChild(new Text({
			text: 'The Compound',
			id: 'compound_title',
			style: { fontRole: 'display', fontSize: 'fs_4xl', color: 'text_bright', textAlign: 'center' },
			wrap: 'none',
		}));

		const panel = new Panel({ id: 'compound_panel', corners: true, width: PANEL_WIDTH, crossAlign: 'stretch', gap: tokens.space.space_3 });
		this.summary = new Text({ id: 'compound_summary', widthMode: 'fill', style: { fontSize: 'fs_lg', color: 'text_bright' } });
		panel.addChild(this.summary);
		this.stores = new Text({ id: 'compound_stores', widthMode: 'fill', style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_dim' } });
		panel.addChild(this.stores);
		panel.addChild(new Text({
			text: "The compound screen isn't built yet. The campaign is saved, and Continue on the main menu comes back to it.",
			id: 'compound_note',
			widthMode: 'fill',
			style: { fontSize: 'fs_base', color: 'text_dim' },
		}));
		this.stack.addChild(panel);

		const back = new Button({
			label: 'Back to menu',
			id: 'compound_back_button',
			icon: 'arrow_back',
			size: 'lg',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		});
		this.stack.addChild(back);
		this.rootLayer.hotkeys.register('Escape', () => this.back());
		this.context.focus.focus(back);

		const handed = (data as Partial<CompoundScreenData> | undefined)?.campaign;
		if (handed) this.show(handed);
		else void this.loadSave();
	}

	protected onUnmount(): void {
		this.visit += 1;
		this.rootLayer.hotkeys.unregister('Escape');
		this.stack.clearChildren();
		this.summary = null;
		this.stores = null;
	}

	private async loadSave(): Promise<void> {
		const visit = this.visit;
		let campaign: Campaign | null = null;
		let trouble = 'No campaign in progress.';
		try {
			campaign = await this.store.load();
		} catch (error) {
			if (!(error instanceof CampaignStoreError)) console.error('CompoundPlaceholderScreen: loading the save failed', error);
			trouble = error instanceof CampaignStoreError ? error.message : "The saved campaign couldn't be read.";
		}
		if (visit !== this.visit) return;
		if (campaign) this.show(campaign);
		else if (this.summary) this.summary.text = trouble;
	}

	private show(campaign: Campaign): void {
		if (this.summary) this.summary.text = campaignSummary(campaign);
		const { food, water, fuel, meds, scrap, people } = campaign.resources;
		if (this.stores) this.stores.text = `Food ${food}  Water ${water}  Fuel ${fuel}  Meds ${meds}  Scrap ${scrap}  People ${people}`;
	}

	private back(): void {
		ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}
