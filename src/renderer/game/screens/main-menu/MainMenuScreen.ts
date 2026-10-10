import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { DriverLoader } from '../../core/DriverLoader';
import { freshSeed } from '../../core/Rng';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStore, CampaignStoreError, CampaignStoreFailure } from '../../campaign/CampaignStore';
import { foundCampaign } from '../../campaign/Founding';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Dialog } from '../../../engine/ui/Dialog';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import { formatBuildLabel } from './buildLabel';
import { campaignSummary } from './campaignText';

const MENU_WIDTH = 320;
const REPLACE_CANCEL_WIDTH = 120;
const REPLACE_CONFIRM_WIDTH = 180;

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

const OUTDATED = "The saved campaign is from another version of the game and can't be continued. New Campaign replaces it.";

/** Continue's line under the button: the campaign's state, or why there's nothing to continue. */
function continueCaption(save: MenuSave): { text: string; color: ColorToken } {
	switch (save.kind) {
		case 'checking': return { text: 'Looking for a saved campaign.', color: 'text_dim' };
		case 'none': return { text: 'No campaign in progress.', color: 'text_dim' };
		case 'saved': return { text: campaignSummary(save.campaign), color: 'text' };
		case 'outdated': return { text: OUTDATED, color: 'status_warn' };
		case 'unreadable': return { text: save.message, color: 'status_warn' };
	}
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

export interface MainMenuScreenOptions {
	/** Where the campaign is saved. Default: the game's shared store. */
	store?: CampaignStore;
}

/**
 * The main menu (Game Flow 1.1): a root stack that centres the title over
 * one column of buttons, so the frame lays it out at any viewport. New
 * Campaign leads; Continue sits under it with the saved campaign's state, or
 * why there's nothing to continue, and Campaign History closes the campaign
 * group. The column is a focus group, one Tab stop the arrows move through,
 * and focus starts on New Campaign.
 *
 * The menu loads the save on mount, since Continue's line reads from the
 * campaign, and Continue hands that instance on: it's the one the store
 * saves from then on. New Campaign over a save asks first; a campaign in
 * progress goes into the history as abandoned before the new one is saved.
 *
 * Skirmish keeps the old quick fight from driver selection reachable for
 * playtesters until load out replaces driver selection.
 */
export class MainMenuScreen extends Screen {
	private readonly stack: Stack;
	private readonly store: CampaignStore;
	private newCampaignButton: Button | null = null;
	private continueButton: Button | null = null;
	private continueLine: Text | null = null;
	private notice: Text | null = null;
	private dialog: Dialog | null = null;
	private saveState: MenuSave = { kind: 'checking' };
	private saveRead: Promise<void> = Promise.resolve();
	/** Counts mounts and unmounts, so an answer that arrives after the menu has gone changes nothing. */
	private visit = 0;
	private starting = false;

	constructor({ store = CampaignStore.shared }: MainMenuScreenOptions = {}) {
		const root = new Stack({
			id: 'mainMenuScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			distribution: 'center',
			crossAlign: 'center',
			gap: tokens.space.space_8,
			style: { backgroundColor: 'bg_base' },
		});
		super('mainMenuScreen', { root });
		this.stack = root;
		this.store = store;
	}

	/** The save as the menu last read it. */
	public get save(): MenuSave {
		return this.saveState;
	}

	/** Settles once the save read on mount, or after a failed New Campaign, has been shown. */
	public get saveChecked(): Promise<void> {
		return this.saveRead;
	}

	protected onMount(): void {
		this.visit += 1;
		this.stack.addChild(new Text({
			text: 'Dual Deckbuilder',
			id: 'main_menu_title',
			style: {
				fontRole: 'display',
				fontSize: 'fs_5xl',
				color: 'text_bright',
				textAlign: 'center',
			},
			wrap: 'none',
		}));
		this.stack.addChild(this.createMenu());

		// The build stamp in the bottom-right corner, so a playtester can tell
		// which deploy they're on. Development builds define no SHA and show
		// none, which keeps the main menu goldens stable across commits.
		const label = formatBuildLabel({ sha: __BUILD_SHA__, number: __BUILD_NUMBER__ });
		if (label) {
			this.stack.addChild(new Text({
				text: label,
				id: 'main_menu_build_label',
				positioned: 'absolute',
				anchor: 'bottomRight',
				pivot: 'bottomRight',
				x: -tokens.space.space_2,
				y: -tokens.space.space_2,
				style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_faint' },
				wrap: 'none',
			}));
		}

		if (this.newCampaignButton) this.context.focus.focus(this.newCampaignButton);
		this.showSave({ kind: 'checking' });
		void this.readSave();
	}

	protected onUnmount(): void {
		this.visit += 1;
		this.dialog?.close();
		this.dialog = null;
		this.stack.clearChildren();
		this.newCampaignButton = null;
		this.continueButton = null;
		this.continueLine = null;
		this.notice = null;
		this.starting = false;
	}

	private createMenu(): FocusGroup {
		const menu = new FocusGroup({
			id: 'main_menu_buttons',
			orientation: 'vertical',
			wrap: true,
			width: MENU_WIDTH,
			crossAlign: 'stretch',
			gap: tokens.space.space_6,
		});

		const campaign = new Stack({ id: 'main_menu_campaign', crossAlign: 'stretch', gap: tokens.space.space_3 });
		this.newCampaignButton = new Button({
			label: 'New Campaign',
			id: 'main_menu_new_campaign_button',
			tone: 'accent',
			size: 'lg',
			block: true,
			onClick: () => { void this.newCampaign(); },
		});
		campaign.addChild(this.newCampaignButton);
		// Why the last New Campaign failed; hidden until one does.
		this.notice = new Text({
			id: 'main_menu_notice',
			visible: false,
			widthMode: 'fill',
			style: { fontSize: 'fs_sm', color: 'status_crit', textAlign: 'center' },
		});
		campaign.addChild(this.notice);

		const resume = new Stack({ id: 'main_menu_continue', crossAlign: 'stretch', gap: tokens.space.space_1_5 });
		// Enabled until the save check says otherwise, so Back from the screen
		// Continue opened can restore focus to it while the check is running.
		this.continueButton = new Button({
			label: 'Continue',
			id: 'main_menu_continue_button',
			size: 'lg',
			block: true,
			onClick: () => this.continueCampaign(),
		});
		resume.addChild(this.continueButton);
		this.continueLine = new Text({
			id: 'main_menu_continue_line',
			widthMode: 'fill',
			style: { fontSize: 'fs_sm', textAlign: 'center' },
		});
		resume.addChild(this.continueLine);
		campaign.addChild(resume);

		campaign.addChild(new Button({
			label: 'Campaign History',
			id: 'main_menu_history_button',
			size: 'lg',
			block: true,
			onClick: () => ScreenManager.navigate('campaignHistoryScreen'),
		}));
		menu.addChild(campaign);

		const more = new Stack({ id: 'main_menu_more', crossAlign: 'stretch', gap: tokens.space.space_2 });
		more.addChild(new Button({
			label: 'Skirmish',
			id: 'main_menu_skirmish_button',
			block: true,
			onClick: () => ScreenManager.navigate('driverSelectionScreen'),
		}));
		more.addChild(new Button({
			label: 'Settings',
			id: 'main_menu_settings_button',
			block: true,
			onClick: () => ScreenManager.navigate('settingsScreen'),
		}));
		more.addChild(new Button({
			label: 'Credits',
			id: 'main_menu_credits_button',
			block: true,
			onClick: () => ScreenManager.navigate('creditsScreen'),
		}));
		more.addChild(new Button({
			label: 'Card Showcase',
			id: 'main_menu_card_showcase_button',
			block: true,
			onClick: () => ScreenManager.navigate('cardShowcaseScreen'),
		}));
		// Development tooling, so absent from a production build (R13.2).
		if (__DEV_TOOLS__) {
			more.addChild(new Button({
				label: 'Developer Tools',
				id: 'main_menu_developer_button',
				block: true,
				onClick: () => ScreenManager.navigate('developerScreen'),
			}));
		}

		// Only the desktop build can quit
		if ((window as ElectronWindow).electron?.isElectron === true) {
			more.addChild(new Button({
				label: 'Exit Game',
				id: 'main_menu_exit_button',
				block: true,
				// Would use the electron API to quit
				onClick: () => console.log('Exit requested in Electron mode'),
			}));
		}
		menu.addChild(more);
		return menu;
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
		const continueButton = this.continueButton;
		if (continueButton) {
			const { focus } = this.context;
			// Focused, or waiting to be once a transition's scope pops (Back restored it during the fade).
			const holdsFocus = focus.focused === continueButton || focus.pendingFocus === continueButton;
			continueButton.enabled = save.kind === 'saved' || save.kind === 'checking';
			// A disabled control can't hold focus (R9.5); the column's first action takes it, or the request, in its place.
			if (holdsFocus && !continueButton.enabled && this.newCampaignButton) focus.focus(this.newCampaignButton);
		}
		if (this.continueLine) {
			const { text, color } = continueCaption(save);
			this.continueLine.text = text;
			this.continueLine.color = color;
		}
	}

	private showNotice(message: string | null): void {
		if (!this.notice) return;
		this.notice.text = message ?? '';
		this.notice.visible = message !== null;
	}

	/**
	 * The run screen with a run on the road, at its saved step; otherwise the
	 * compound. A load out left before its run set off is given up first, and
	 * saved, since nothing at the compound can bring it back.
	 */
	private continueCampaign(): void {
		if (this.starting || this.saveState.kind !== 'saved') return;
		const { campaign } = this.saveState;
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
		dialog.show(this.context);
	}

	/**
	 * Founds a campaign on a fresh seed and saves it, ending the campaign in
	 * progress as abandoned first so it reaches the history (a damaged or
	 * outdated save is simply replaced), then opens the compound. A failure
	 * stays on the menu and says why, and the save is read again, since the
	 * old campaign may have ended before it.
	 */
	private async startCampaign(replacing: MenuSave): Promise<void> {
		if (this.starting) return;
		this.starting = true;
		this.showNotice(null);
		const visit = this.visit;
		try {
			const loader = DriverLoader.getInstance();
			await loader.loadDrivers();
			const campaign = foundCampaign({
				seed: freshSeed(),
				unlockedArchetypes: loader.getUnlockedDrivers().map((driver) => driver.archetype),
			});
			if (replacing.kind === 'saved') await this.store.end({ campaign: replacing.campaign, ending: 'abandoned' });
			await this.store.save(campaign);
			if (visit === this.visit) ScreenManager.navigate('compoundScreen', { campaign });
		} catch (error) {
			if (!(error instanceof CampaignStoreError)) console.error('MainMenuScreen: starting a campaign failed', error);
			if (visit !== this.visit) return;
			this.showNotice(error instanceof CampaignStoreError ? error.message : "The new campaign couldn't be started.");
			this.showSave({ kind: 'checking' });
			void this.readSave();
		} finally {
			if (visit === this.visit) this.starting = false;
		}
	}
}
