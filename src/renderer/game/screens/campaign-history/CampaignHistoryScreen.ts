import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { CampaignHistoryEntry } from '../../campaign/CampaignHistory';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import { Stack } from '../../../engine/components/Stack';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { tokens } from '../../../engine/theme/tokens';
import { AtlasButton } from '../../ui/atlas/AtlasButton';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { ContentsRow } from '../../ui/atlas/ContentsRow';
import { LegendBox, LegendRow } from '../../ui/atlas/LegendBox';
import { PageTitle } from '../../ui/atlas/PageTitle';
import { countOf, historyColumns } from '../main-menu/campaignText';

const { space } = tokens;
const PANEL_WIDTH = 600;
const BACK_WIDTH = 240;

export interface CampaignHistoryScreenOptions {
	/** Where the history is kept. Default: the game's shared store. */
	store?: CampaignStore;
}

/**
 * Campaign History (Game Flow 1.1), an appendix of the atlas: past
 * campaigns, newest first, as the contents page lists things (UI Art
 * Direction, Components), each a numbered row with how it ended, the days it
 * held out at the right, and the strongholds it took and its seed under it.
 * One sheet holds the title, a legend box whose list scrolls once it
 * outgrows the room the title and Back leave, and Back to contents as a back
 * road; there's no primary action, so no highway. Nothing in the list is
 * interactive, so focus starts on Back; Page Up, Page Down, Home, and End
 * scroll the list from there, as on the credits screen, and Escape and Back
 * return to the menu with focus on Campaign History again.
 */
export class CampaignHistoryScreen extends Screen {
	private readonly sheet: AtlasSheet;
	private readonly store: CampaignStore;
	private title: PageTitle | null = null;
	private scroller: ScrollContainer | null = null;
	private list: Stack | null = null;
	private visit = 0;
	private historyRead: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared }: CampaignHistoryScreenOptions = {}) {
		const root = new AtlasSheet({
			id: 'campaignHistoryScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'center',
			gap: space.space_5,
		});
		super('campaignHistoryScreen', { root, theme: 'atlas' });
		this.sheet = root;
		this.store = store;
	}

	/** Settles once the history read on mount has been shown. */
	public get historyShown(): Promise<void> {
		return this.historyRead;
	}

	protected onMount(): void {
		this.visit += 1;
		this.title = new PageTitle({ title: 'Campaign history', subtitle: '', titleId: 'history_title', subtitleId: 'history_count', alignSelf: 'stretch' });
		this.sheet.addChild(this.title);

		this.list = new Stack({ id: 'history_list', crossAlign: 'stretch' });
		this.scroller = new ScrollContainer({ id: 'history_scroll', widthMode: 'fill', heightMode: 'hug' });
		this.scroller.addChild(this.list);
		const panel = new LegendBox({ id: 'history_panel', width: PANEL_WIDTH, crossAlign: 'stretch' });
		panel.addChild(this.scroller);
		this.sheet.addChild(panel);

		const back = new AtlasButton({
			label: 'Back to contents',
			id: 'history_back_button',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		});
		this.sheet.addChild(back);

		const { hotkeys } = this.rootLayer;
		hotkeys.register('Escape', () => this.back());
		hotkeys.register('PageDown', () => this.scroller?.scrollByPages(1));
		hotkeys.register('PageUp', () => this.scroller?.scrollByPages(-1));
		hotkeys.register('Home', () => this.scroller?.scrollToTop());
		hotkeys.register('End', () => this.scroller?.scrollToBottom());
		this.context.focus.focus(back);

		const visit = this.visit;
		this.historyRead = this.readHistory().then((shown) => {
			if (visit === this.visit) this.show(shown);
		});
	}

	protected onUnmount(): void {
		this.visit += 1;
		const { hotkeys } = this.rootLayer;
		for (const key of ['Escape', 'PageDown', 'PageUp', 'Home', 'End']) hotkeys.unregister(key);
		this.sheet.clearChildren();
		this.title = null;
		this.scroller = null;
		this.list = null;
	}

	/** The entries, or the store's message when the history can't be read. */
	private async readHistory(): Promise<CampaignHistoryEntry[] | string> {
		try {
			return await this.store.history();
		} catch (error) {
			if (error instanceof CampaignStoreError) return error.message;
			console.error('CampaignHistoryScreen: reading the history failed', error);
			return "Campaign history couldn't be read.";
		}
	}

	private show(shown: CampaignHistoryEntry[] | string): void {
		const list = this.list;
		if (!list) return;
		if (typeof shown === 'string') {
			list.addChild(message({ id: 'history_trouble', text: shown, symbol: 'diamond' }));
			return;
		}
		if (this.title) this.title.subtitle = shown.length > 0 ? `${countOf(shown.length, 'campaign')} ended` : '';
		if (shown.length === 0) {
			list.addChild(message({
				id: 'history_empty',
				text: 'No campaign has ended yet. One is listed here when its compound falls, it is won, or a new campaign replaces it.',
				symbol: 'dash',
			}));
			return;
		}
		shown.forEach((entry, index) => list.addChild(historyRow({ entry, index })));
	}

	/** To the menu, focus back on the button that opened this screen. */
	private back(): void {
		ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}

/**
 * Said in place of the list, led by its map-legend symbol: a stronghold
 * diamond when the history can't be read, a dashed line for nothing to
 * report.
 */
function message({ id, text, symbol }: { id: string; text: string; symbol: 'diamond' | 'dash' }): LegendRow {
	return new LegendRow({ text, symbol, textId: id });
}

/** One past campaign: its number, how it ended, the days it held out, and the strongholds it took and its seed. */
function historyRow({ entry, index }: { entry: CampaignHistoryEntry; index: number }): ContentsRow {
	const columns = historyColumns(entry);
	return new ContentsRow({
		id: `history_row_${index}`,
		label: columns.ending,
		value: columns.days,
		subtitle: `${columns.strongholds} / ${columns.seed}`,
		lead: { glyph: String(index + 1) },
		// A record to read, not a place to go: no hover, no focus stop.
		focusable: false,
		pointerEvents: 'none',
	});
}
