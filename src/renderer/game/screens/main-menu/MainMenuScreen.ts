import { Screen } from '../../core/Screen';
import { ScreenManager, type ScreenName } from '../../core/ScreenManager';
import { DriverLoader } from '../../core/DriverLoader';
import { freshSeed } from '../../core/Rng';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignFounding, CampaignFoundingOptions, FoundedCampaign } from '../../campaign/CampaignFounding';
import { CampaignMaps } from '../../campaign/CampaignMaps';
import { CampaignStore, CampaignStoreError, CampaignStoreFailure } from '../../campaign/CampaignStore';
import { MapGenerationCancelled } from '../../map/worker/MapGeneration';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Dialog } from '../../../engine/ui/Dialog';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { ATLAS } from '../../ui/atlas/atlasStyle';
import { ContentsRow } from '../../ui/atlas/ContentsRow';
import { DeckStack } from '../../ui/atlas/deck';
import { formatBuildLabel } from './buildLabel';
import { campaignSummary, foundingText } from './campaignText';
import { MenuCover } from './MenuCover';

/** Between the cover and the contents page, the canvas's. */
const COLUMN_GAP = 46;
/** The heading block to the rows. */
const PAGE_GAP = tokens.space.space_5;
/** The notice's one line, between the campaign rows and the appendices: held whether or not it says anything. */
const NOTICE_LINE = tokens.space.space_6;
const APPENDIX_GAP = 30;
const KICKER_GAP = tokens.space.space_1_5;
const REPLACE_CANCEL_WIDTH = 120;
const REPLACE_CONFIRM_WIDTH = 180;
/** The decks set down on the cover's lower right (UI Art Direction, Card hints): a card's width, and each deck's turn. */
const DECK_WIDTH = 76;
const DECK_TURN = { a: (-9 * Math.PI) / 180, b: (8 * Math.PI) / 180 } as const;

interface ElectronWindow extends Window {
	electron?: {
		isElectron: boolean;
		[key: string]: unknown;
	};
}

/**
 * What the menu knows of the save: still asking; none; a campaign to
 * continue, loaded; one another version of the game saved; or one it
 * couldn't read, damaged or behind a storage failure, with the store's
 * message.
 */
export type MenuSave =
	| { kind: 'checking' }
	| { kind: 'none' }
	| { kind: 'saved'; campaign: Campaign }
	| { kind: 'outdated' }
	| { kind: 'unreadable'; reason: CampaignStoreFailure; message: string };

/** A save another version of the game wrote, which has no store message of its own. */
const OUTDATED = "Saved by another version of the game, so it can't be continued.";

/**
 * Continue's subtitle: the campaign's state, or why there's nothing to
 * continue (Game Flow 1.1). A save it can't read says so in the store's own
 * words, in the warning colour.
 */
function continueCaption(save: MenuSave): { text: string; color: ColorToken } {
	switch (save.kind) {
		case 'checking': return { text: 'Looking for a saved campaign.', color: 'text_dim' };
		case 'none': return { text: 'No campaign in progress.', color: 'text_dim' };
		case 'saved': return { text: campaignSummary(save.campaign), color: 'text_dim' };
		case 'outdated': return { text: OUTDATED, color: 'status_crit' };
		case 'unreadable': return { text: save.message, color: 'status_crit' };
	}
}

/** Continue's value at the end of its leaders: the day, or what kind of save there isn't. */
function continueValue(save: MenuSave): string {
	switch (save.kind) {
		case 'checking': return '';
		case 'none': return 'NO SAVE';
		case 'saved': return dayValue(save.campaign.day);
		case 'outdated': return 'OLD SAVE';
		case 'unreadable': return save.reason === 'damaged' ? 'DAMAGED' : 'UNREAD';
	}
}

/** "DAY 09", the map's counter. */
function dayValue(day: number): string {
	return `DAY ${String(day).padStart(2, '0')}`;
}

/** What replacing the save puts in front of the player first, or null when there's no save to replace. */
function replaceWarning(save: MenuSave): { title: string; body: string; confirm: string } | null {
	switch (save.kind) {
		case 'saved': return {
			title: 'Abandon this campaign?',
			// A campaign that's over goes in with its own fall, whatever the end asks (`CampaignStore.end`).
			body: `${campaignSummary(save.campaign)}. A new campaign replaces it, and it goes into Campaign History as ${save.campaign.isOver ? 'it fell' : 'abandoned'}.`,
			confirm: 'Abandon and start new',
		};
		case 'outdated': return {
			title: 'Replace the old save?',
			body: "The saved campaign is from another version of the game and can't be continued. A new campaign replaces it.",
			confirm: 'Start new campaign',
		};
		case 'unreadable': return save.reason === 'damaged' ? {
			title: 'Replace the damaged save?',
			body: "The saved campaign can't be loaded. A new campaign replaces it, and a copy of the damaged save is kept.",
			confirm: 'Start new campaign',
		} : null;
		default: return null;
	}
}

/** A founding under way, which a CampaignFounding is. */
export interface FoundingTask {
	readonly result: Promise<FoundedCampaign>;
	cancel(): void;
}

export interface MainMenuScreenOptions {
	/** Where the campaign is saved. Default: the game's shared store. */
	store?: CampaignStore;
	/** Where the session's area map is kept. Default: the game's shared cache. */
	maps?: CampaignMaps;
	/** Founds a campaign with its map. Default: a CampaignFounding, generating in the map worker. */
	startFounding?: (options: CampaignFoundingOptions) => FoundingTask;
}

/**
 * The main menu (Game Flow 1.1; UI Art Direction, Screens: Main menu), on
 * the atlas theme: one sheet on the table, the atlas cover lying on its
 * left half with the two decks set down on it, and the contents page on its
 * right. The page leads with Continue when there's a campaign to continue:
 * a highway shield with the day in it and the save's summary under the
 * label. Otherwise New campaign leads, and Continue keeps its place in faded
 * print with why there's nothing to continue. Campaign history follows, then
 * the appendices in two columns. The rows are one focus group, one Tab stop
 * the arrows move through, and focus starts on Continue, moving to New
 * campaign if the save turns out to have nothing to continue.
 *
 * The menu loads the save on mount, since Continue's line reads from the
 * campaign, and Continue hands that instance on: it's the one the store
 * saves from then on. Continue also starts making the campaign's area map
 * again in the map worker, which the screens that need it wait for. New
 * campaign over a save asks first; founding generates the area map, with a
 * progress line under the campaign rows, and leaving the menu cancels it. A
 * campaign in progress goes into the history as abandoned before the new
 * one is saved.
 */
export class MainMenuScreen extends Screen {
	private readonly sheet: AtlasSheet;
	private readonly store: CampaignStore;
	private readonly maps: CampaignMaps;
	private readonly startFounding: (options: CampaignFoundingOptions) => FoundingTask;
	/** The founding under way, which leaving the menu cancels. */
	private founding: FoundingTask | null = null;
	private newCampaignRow: ContentsRow | null = null;
	private continueRow: ContentsRow | null = null;
	private notice: Text | null = null;
	private dialog: Dialog | null = null;
	private saveState: MenuSave = { kind: 'checking' };
	private saveRead: Promise<void> = Promise.resolve();
	/** Counts mounts and unmounts, so an answer that arrives after the menu has gone changes nothing. */
	private visit = 0;
	private starting = false;

	constructor({ store = CampaignStore.shared, maps = CampaignMaps.shared, startFounding = (options) => new CampaignFounding(options) }: MainMenuScreenOptions = {}) {
		// The tape would sit on the build stamp at the bottom right; the cover carries its own.
		const root = new AtlasSheet({
			id: 'mainMenuScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			direction: 'horizontal',
			crossAlign: 'stretch',
			gap: COLUMN_GAP,
			tape: false,
		});
		super('mainMenuScreen', { root, theme: 'atlas' });
		this.sheet = root;
		this.store = store;
		this.maps = maps;
		this.startFounding = startFounding;
	}

	/** The save as the menu last read it. */
	public get save(): MenuSave {
		return this.saveState;
	}

	/** Settles once the save read on mount, or after a failed New campaign, has been shown. */
	public get saveChecked(): Promise<void> {
		return this.saveRead;
	}

	protected onMount(): void {
		this.visit += 1;
		this.sheet.addChild(new MenuCover({ id: 'main_menu_cover', widthMode: 'fill', heightMode: 'fill', zIndex: 0 }));
		this.sheet.addChild(this.createContents());
		this.sheet.addChild(this.createDeck('a'));
		this.sheet.addChild(this.createDeck('b'));

		if (this.continueRow) this.context.focus.focus(this.continueRow);
		this.showSave({ kind: 'checking' });
		void this.readSave();
	}

	protected onUnmount(): void {
		this.visit += 1;
		this.founding?.cancel();
		this.founding = null;
		this.dialog?.close();
		this.dialog = null;
		this.sheet.clearChildren();
		this.newCampaignRow = null;
		this.continueRow = null;
		this.notice = null;
		this.starting = false;
	}

	/**
	 * A deck set down on the cover's lower right, B over A and a little lower,
	 * placed from the page's bottom centre so they stay on the cover, clear of
	 * the contents page, at any size.
	 */
	private createDeck(driver: 'a' | 'b'): DeckStack {
		const clear = COLUMN_GAP / 2 + 12;
		return new DeckStack({
			id: `main_menu_deck_${driver}`,
			driver,
			width: DECK_WIDTH,
			edges: driver === 'a' ? 3 : 4,
			positioned: 'absolute',
			anchor: 'bottom',
			pivot: 'bottomRight',
			x: driver === 'a' ? -(clear + DECK_WIDTH * 0.95) : -clear,
			y: driver === 'a' ? -54 : -30,
			zIndex: driver === 'a' ? 1 : 2,
			transform: { rotate: DECK_TURN[driver] },
			pointerEvents: 'none',
		});
	}

	private createContents(): Stack {
		const page = new Stack({
			id: 'main_menu_contents',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			distribution: 'spaceBetween',
			zIndex: 0,
		});
		const top = new Stack({ id: 'main_menu_page', crossAlign: 'stretch', gap: PAGE_GAP });
		const heading = new Stack({ id: 'main_menu_heading', crossAlign: 'start', gap: tokens.space.space_1 });
		heading.addChild(new Text({
			text: 'Contents',
			id: 'main_menu_title',
			style: { fontRole: 'display', fontWeight: 700, fontSize: 32, letterSpacing: 0.18, textTransform: 'uppercase', color: 'text' },
			wrap: 'none',
		}));
		// The serif italic of the canvas once that role exists (UI Art Direction, Type); body until then.
		heading.addChild(new Text({
			text: 'Where to open the book today',
			id: 'main_menu_subtitle',
			style: { fontSize: 15, color: 'text_dim' },
			wrap: 'none',
		}));
		top.addChild(heading);
		top.addChild(this.createMenu());
		page.addChild(top);
		page.addChild(this.createFooter());
		return page;
	}

	private createMenu(): FocusGroup {
		const menu = new FocusGroup({ id: 'main_menu_buttons', orientation: 'both', wrap: true, crossAlign: 'stretch' });

		const campaign = new Stack({ id: 'main_menu_campaign', crossAlign: 'stretch' });
		// Enabled until the save check says otherwise, so Back from the screen
		// Continue opened can restore focus to it while the check is running.
		this.continueRow = new ContentsRow({
			id: 'main_menu_continue_button',
			variant: 'primary',
			lead: { glyph: '' },
			label: 'Continue',
			subtitle: '',
			// Room for the store's reason in its own words at the narrowest window.
			subtitleLines: 2,
			value: '',
			onClick: () => this.continueCampaign(),
		});
		campaign.addChild(this.continueRow);
		this.newCampaignRow = new ContentsRow({
			id: 'main_menu_new_campaign_button',
			lead: { glyph: '1' },
			label: 'New campaign',
			value: dayValue(1),
			onClick: () => { void this.newCampaign(); },
		});
		campaign.addChild(this.newCampaignRow);
		campaign.addChild(new ContentsRow({
			id: 'main_menu_history_button',
			lead: { glyph: 'H' },
			label: 'Campaign history',
			value: 'PAST RUNS',
			onClick: () => this.leave('campaignHistoryScreen'),
		}));
		menu.addChild(campaign);

		// How far founding has got, or why the last New campaign failed; empty
		// otherwise. Its one line is held whether or not it says anything, so
		// nothing moves as it fills in; a message too long for it ends in an
		// ellipsis rather than wrap.
		this.notice = new Text({
			id: 'main_menu_notice',
			widthMode: 'fill',
			lineHeight: NOTICE_LINE / tokens.fontSize.fs_sm,
			wrap: 'none',
			textOverflow: 'ellipsis',
			style: { fontSize: 'fs_sm', color: 'status_crit' },
		});
		menu.addChild(this.notice);
		menu.addChild(this.createAppendices());
		return menu;
	}

	/** The appendices in two columns, in reading order, lettered like an atlas's. */
	private createAppendices(): Stack {
		const entries: ContentsRow[] = [
			this.appendix({ id: 'main_menu_settings_button', label: 'Settings', screen: 'settingsScreen' }),
			this.appendix({ id: 'main_menu_card_showcase_button', label: 'Card showcase', screen: 'cardShowcaseScreen', deck: true }),
			this.appendix({ id: 'main_menu_credits_button', label: 'Credits', screen: 'creditsScreen' }),
		];
		// Development tooling, so absent from a production build (R13.2).
		if (__DEV_TOOLS__) entries.push(this.appendix({ id: 'main_menu_developer_button', label: 'Developer tools', screen: 'developerScreen', muted: true }));
		// Only the desktop build can quit
		if ((window as ElectronWindow).electron?.isElectron === true) {
			// Would use the electron API to quit
			entries.push(new ContentsRow({ id: 'main_menu_exit_button', variant: 'compact', label: 'Exit game', value: '', onClick: () => console.log('Exit requested in Electron mode') }));
		}
		entries.forEach((entry, index) => { entry.value = String.fromCharCode(65 + index); });

		const appendices = new Stack({ id: 'main_menu_more', crossAlign: 'stretch', gap: KICKER_GAP });
		appendices.addChild(new Text({
			text: 'Appendices',
			id: 'main_menu_appendices',
			style: { fontRole: 'mono', fontSize: 11, letterSpacing: 0.18, textTransform: 'uppercase', color: 'text_dim' },
			wrap: 'none',
		}));
		const grid = new Stack({ id: 'main_menu_appendix_grid', crossAlign: 'stretch' });
		for (let index = 0; index < entries.length; index += 2) {
			const pair = new Stack({ direction: 'horizontal', gap: APPENDIX_GAP, crossAlign: 'stretch' });
			pair.addChild(entries[index]);
			pair.addChild(entries[index + 1] ?? new Stack({ widthMode: 'fill' }));
			grid.addChild(pair);
		}
		appendices.addChild(grid);
		return appendices;
	}

	private appendix({ id, label, screen, deck = false, muted = false }: { id: string; label: string; screen: ScreenName; deck?: boolean; muted?: boolean }): ContentsRow {
		return new ContentsRow({ id, variant: 'compact', label, value: '', lead: deck ? 'deck' : null, muted, onClick: () => this.leave(screen) });
	}

	/**
	 * The page's foot: the atlas's imprint, and the build stamp so a
	 * playtester can tell which deploy they're on. Development builds define
	 * no SHA and show none, which keeps the main menu goldens stable across
	 * commits.
	 */
	private createFooter(): Stack {
		const footer = new Stack({ id: 'main_menu_footer', direction: 'horizontal', crossAlign: 'end', distribution: 'spaceBetween' });
		const caption = { fontRole: 'mono', fontSize: ATLAS.captionSize, letterSpacing: ATLAS.captionTracking, textTransform: 'uppercase', color: 'text_dim' } as const;
		footer.addChild(new Text({ text: 'Printed before · revised by hand after', id: 'main_menu_imprint', style: caption, wrap: 'none' }));
		const label = formatBuildLabel({ sha: __BUILD_SHA__, number: __BUILD_NUMBER__ });
		if (label) footer.addChild(new Text({ text: label, id: 'main_menu_build_label', style: caption, wrap: 'none' }));
		return footer;
	}

	private readSave(): Promise<void> {
		const visit = this.visit;
		this.saveRead = this.checkSave().then((save) => {
			if (visit === this.visit) this.showSave(save);
		});
		return this.saveRead;
	}

	private async checkSave(): Promise<MenuSave> {
		try {
			const status = await this.store.saveStatus();
			if (status !== 'saved') return { kind: status };
			const campaign = await this.store.load();
			return campaign ? { kind: 'saved', campaign } : { kind: 'none' };
		} catch (error) {
			if (error instanceof CampaignStoreError) return { kind: 'unreadable', reason: error.reason, message: error.message };
			console.error('MainMenuScreen: reading the save failed', error);
			return { kind: 'unreadable', reason: 'storage', message: "The saved campaign couldn't be read." };
		}
	}

	private showSave(save: MenuSave): void {
		this.saveState = save;
		const row = this.continueRow;
		if (row) {
			const caption = continueCaption(save);
			row.subtitle = caption.text;
			row.subtitleColor = caption.color;
			row.value = continueValue(save);
			row.leadLabel = save.kind === 'saved' ? String(save.campaign.day) : '';
		}
		this.showContinue();
	}

	/**
	 * Continue is enabled for a save it can open, or while the check runs, and
	 * never while a campaign is being founded. Whichever of Continue and New
	 * campaign the player can take leads the page; the two rows trade heights,
	 * so nothing under them moves.
	 */
	private showContinue(): void {
		const continueRow = this.continueRow;
		const newCampaignRow = this.newCampaignRow;
		if (!continueRow || !newCampaignRow) return;
		const { focus } = this.context;
		// Focused, or waiting to be once a transition's scope pops (Back restored it during the fade).
		const holdsFocus = focus.focused === continueRow || focus.pendingFocus === continueRow;
		const save = this.saveState.kind;
		const available = !this.starting && (save === 'saved' || save === 'checking');
		continueRow.faded = !available;
		continueRow.variant = available ? 'primary' : 'standard';
		newCampaignRow.variant = available ? 'standard' : 'primary';
		// A disabled control can't hold focus (R9.5); New campaign takes it, or the request, in its place.
		if (holdsFocus && !available) focus.focus(newCampaignRow);
	}

	private showNotice(message: string | null, color: ColorToken = 'status_crit'): void {
		if (!this.notice) return;
		this.notice.text = message ?? '';
		this.notice.color = color;
	}

	/** Leaves the menu, cancelling a founding under way at the click rather than once the fade has unmounted the menu. */
	private leave(screenName: ScreenName): void {
		this.founding?.cancel();
		this.founding = null;
		ScreenManager.navigate(screenName);
	}

	/**
	 * The run screen with a run on the road, at its saved step; otherwise the
	 * compound. A load out left before its run set off is given up first, and
	 * saved, since nothing at the compound can bring it back.
	 */
	private continueCampaign(): void {
		if (this.starting || this.saveState.kind !== 'saved') return;
		const { campaign } = this.saveState;
		this.maps.prepare(campaign);
		if (campaign.supplyRun !== null) {
			ScreenManager.navigate('runScreen', { campaign });
			return;
		}
		if (campaign.currentRun !== null && !campaign.isOver) {
			campaign.unwindRunDecks();
			void this.store.checkpoint(campaign);
		}
		ScreenManager.navigate('compoundScreen', { campaign });
	}

	/**
	 * Founds a campaign, after asking when it would replace a save. Waits for
	 * the save check if it's still running, and reads the save again when
	 * storage failed the last time, so a failure that has passed can't let a
	 * campaign in progress be replaced without asking or reaching the history.
	 */
	private async newCampaign(): Promise<void> {
		if (this.starting || this.dialog) return;
		const visit = this.visit;
		await this.saveRead;
		if (this.saveState.kind === 'unreadable' && this.saveState.reason === 'storage' && visit === this.visit) {
			this.showSave({ kind: 'checking' });
			await this.readSave();
		}
		if (visit !== this.visit || this.starting || this.dialog) return;
		const replacing = this.saveState;
		const warning = replaceWarning(replacing);
		if (!warning) {
			await this.startCampaign(replacing);
			return;
		}
		this.confirmReplace({ ...warning, onConfirm: () => { void this.startCampaign(replacing); } });
	}

	private confirmReplace({ title, body, confirm, onConfirm }: { title: string; body: string; confirm: string; onConfirm: () => void }): void {
		// Fixed widths: a footer button doesn't size to its label, and both fit the small dialog's body.
		const cancel = new Button({
			label: 'Cancel',
			id: 'main_menu_replace_cancel',
			width: REPLACE_CANCEL_WIDTH,
			onClick: () => dialog.close(),
		});
		const accept = new Button({
			label: confirm,
			id: 'main_menu_replace_confirm',
			width: REPLACE_CONFIRM_WIDTH,
			tone: 'crit',
			onClick: () => {
				dialog.close();
				onConfirm();
			},
		});
		const dialog: Dialog = new Dialog({
			id: 'main_menu_replace_dialog',
			title,
			kicker: 'New campaign',
			size: 'sm',
			content: new Text({
				text: body,
				id: 'main_menu_replace_body',
				widthMode: 'fill',
				style: { fontSize: 'fs_base', color: 'text' },
			}),
			footer: [cancel, accept],
			// The safe answer, so a stray Enter keeps the campaign.
			initialFocus: cancel,
			onClose: () => {
				if (this.dialog === dialog) this.dialog = null;
			},
		});
		this.dialog = dialog;
		dialog.show(this.context, { theme: this.theme });
	}

	/**
	 * Founds a campaign on a fresh seed, its area map generated in the map
	 * worker while the notice line under the campaign rows shows how far it's
	 * got, and saves it, ending the campaign in progress as abandoned first so
	 * it reaches the history (a damaged or outdated save is simply replaced),
	 * then keeps the map for the session and opens the compound. Leaving the
	 * menu before the map is made cancels it, changing nothing. A failure
	 * stays on the menu and says why, and the save is read again, since the
	 * old campaign may have ended before it.
	 */
	private async startCampaign(replacing: MenuSave): Promise<void> {
		if (this.starting) return;
		this.starting = true;
		this.showContinue();
		this.showNotice(null);
		const visit = this.visit;
		let founding: FoundingTask | null = null;
		try {
			const loader = DriverLoader.getInstance();
			await loader.loadDrivers();
			if (visit !== this.visit) return;
			this.showNotice('Founding the compound.', 'text_dim');
			founding = this.startFounding({
				seed: freshSeed(),
				unlockedArchetypes: loader.getUnlockedDrivers().map((driver) => driver.archetype),
				onProgress: (progress) => {
					if (visit === this.visit) this.showNotice(foundingText(progress), 'text_dim');
				},
			});
			this.founding = founding;
			const { campaign, map } = await founding.result;
			// Leaving starts a fade, and the menu unmounts only at its end: a map that arrives in between founds nothing.
			if (visit !== this.visit || this.founding !== founding || ScreenManager.transitioning) return;
			if (replacing.kind === 'saved') await this.store.end({ campaign: replacing.campaign, ending: 'abandoned' });
			await this.store.save(campaign);
			this.maps.remember(campaign, map);
			// Saved now, so it's there to continue, but a player who left as it saved goes where they asked.
			if (visit === this.visit && !ScreenManager.transitioning) ScreenManager.navigate('compoundScreen', { campaign });
		} catch (error) {
			// The player left, which cancelled the founding.
			if (error instanceof MapGenerationCancelled) return;
			if (!(error instanceof CampaignStoreError)) console.error('MainMenuScreen: starting a campaign failed', error);
			if (visit !== this.visit) return;
			this.showNotice(error instanceof CampaignStoreError ? error.message : "The new campaign couldn't be started.");
			this.showSave({ kind: 'checking' });
			void this.readSave();
		} finally {
			if (founding !== null && this.founding === founding) this.founding = null;
			if (visit === this.visit) {
				this.starting = false;
				this.showContinue();
			}
		}
	}
}
