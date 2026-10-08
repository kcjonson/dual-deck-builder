import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { CampaignHistoryEntry } from '../../campaign/CampaignHistory';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Divider } from '../../../engine/ui/Divider';
import { Panel } from '../../../engine/ui/Panel';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { tokens } from '../../../engine/theme/tokens';
import { historyColumns } from '../main-menu/campaignText';

const PANEL_WIDTH = 600;
const BACK_WIDTH = 200;
const ENDING_WIDTH = 130;
const DAYS_WIDTH = 90;

export interface CampaignHistoryScreenOptions {
	/** Where the history is kept. Default: the game's shared store. */
	store?: CampaignStore;
}

/**
 * Campaign History (Game Flow 1.1): past campaigns, newest first, each with
 * how it ended, the days it held out, the strongholds it took, and its seed.
 * A root stack centres the title, one panel whose list scrolls once it
 * outgrows the room the title and Back leave, and Back. Nothing in the list
 * is interactive, so focus starts on Back; Page Up, Page Down, Home, and End
 * scroll the list from there, as on the credits screen, and Escape and Back
 * return to the menu with focus on Campaign History again.
 */
export class CampaignHistoryScreen extends Screen {
	private readonly stack: Stack;
	private readonly store: CampaignStore;
	private scroller: ScrollContainer | null = null;
	private list: Stack | null = null;
	private visit = 0;
	private historyRead: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared }: CampaignHistoryScreenOptions = {}) {
		const root = new Stack({
			id: 'campaignHistoryScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			distribution: 'center',
			crossAlign: 'center',
			gap: tokens.space.space_6,
			padding: tokens.space.space_8,
			style: { backgroundColor: 'bg_base' },
		});
		super('campaignHistoryScreen', { root });
		this.stack = root;
		this.store = store;
	}

	/** Settles once the history read on mount has been shown. */
	public get historyShown(): Promise<void> {
		return this.historyRead;
	}

	protected onMount(): void {
		this.visit += 1;
		this.stack.addChild(new Text({
			text: 'Campaign History',
			id: 'history_title',
			style: { fontRole: 'display', fontSize: 'fs_4xl', color: 'text_bright', textAlign: 'center' },
			wrap: 'none',
		}));

		this.list = new Stack({ id: 'history_list', crossAlign: 'stretch', gap: tokens.space.space_2 });
		this.scroller = new ScrollContainer({ id: 'history_scroll', widthMode: 'fill', heightMode: 'hug' });
		this.scroller.addChild(this.list);
		const panel = new Panel({ id: 'history_panel', corners: true, width: PANEL_WIDTH, crossAlign: 'stretch' });
		panel.addChild(this.scroller);
		this.stack.addChild(panel);

		const back = new Button({
			label: 'Back',
			id: 'history_back_button',
			icon: 'arrow_back',
			size: 'lg',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		});
		this.stack.addChild(back);

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
		this.stack.clearChildren();
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
			list.addChild(message({ id: 'history_trouble', text: shown, color: 'status_warn' }));
			return;
		}
		if (shown.length === 0) {
			list.addChild(message({
				id: 'history_empty',
				text: 'No campaign has ended yet. One is listed here when its compound falls, it is won, or a new campaign replaces it.',
				color: 'text_dim',
			}));
			return;
		}
		shown.forEach((entry, index) => {
			if (index > 0) list.addChild(new Divider());
			list.addChild(historyRow({ entry, index }));
		});
	}

	/** To the menu, focus back on the button that opened this screen. */
	private back(): void {
		ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}

function message({ id, text, color }: { id: string; text: string; color: 'text_dim' | 'status_warn' }): Text {
	return new Text({ text, id, widthMode: 'fill', style: { fontSize: 'fs_md', color, textAlign: 'center' } });
}

/** One past campaign: how it ended, the days it held out, the strongholds it took, and its seed at the end. */
function historyRow({ entry, index }: { entry: CampaignHistoryEntry; index: number }): Stack {
	const columns = historyColumns(entry);
	const row = new Stack({ id: `history_row_${index}`, direction: 'horizontal', crossAlign: 'center', gap: tokens.space.space_4 });
	row.addChild(new Text({
		text: columns.ending,
		width: ENDING_WIDTH,
		style: { fontRole: 'display', fontSize: 'fs_lg', color: entry.ending === 'won' ? 'accent' : 'text_bright', textTransform: 'uppercase', letterSpacing: 'ls_wide' },
		wrap: 'none',
	}));
	row.addChild(new Text({ text: columns.days, width: DAYS_WIDTH, style: { fontSize: 'fs_md', color: 'text' }, wrap: 'none' }));
	row.addChild(new Text({ text: columns.strongholds, widthMode: 'fill', style: { fontSize: 'fs_md', color: 'text' }, wrap: 'none' }));
	row.addChild(new Text({ text: columns.seed, style: { fontRole: 'mono', fontSize: 'fs_xs', color: 'text_faint' }, wrap: 'none' }));
	return row;
}
