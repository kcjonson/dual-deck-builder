/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import type { Text } from '../../../engine/components/Text';
import type { Dialog } from '../../../engine/ui/Dialog';
import { advance, click, key, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { tokens } from '../../../engine/theme/tokens';
import { ScreenManager } from '../../core/ScreenManager';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStoreError } from '../../campaign/CampaignStore';
import type { CampaignStore, SaveStatus } from '../../campaign/CampaignStore';
import { MemorySaveStorage } from '../../campaign/SaveStorage';
import {
	FaultyStorage,
	KEYS,
	damagedText,
	fixtureText,
	outdatedText,
	quotaError,
	securityError,
	storageWith,
	HeldStorage,
	storeOver,
} from '../../campaign/__fixtures__/storeFixtures';
import { MainMenuScreen } from './MainMenuScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

const OPEN_MS = tokens.motion.dur + 32;
const CLOSE_MS = tokens.motion.dur_fast + 32;

interface ElectronScope {
	electron?: { isElectron: boolean };
}

describe('MainMenuScreen', () => {
	const viewport = { logical: { width: 1280, height: 720 } };
	let context: MountContext;
	let screen: MainMenuScreen;
	let store: CampaignStore;
	let storage: FaultyStorage | MemorySaveStorage;

	beforeAll(() => {
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
	});

	afterAll(() => {
		jest.restoreAllMocks();
	});

	/** Mounts the menu over the storage and waits for it to show what the save holds. */
	async function open(over: FaultyStorage | MemorySaveStorage = new MemorySaveStorage()): Promise<void> {
		storage = over;
		store = storeOver(storage);
		screen = new MainMenuScreen({ store });
		screen.mount(context);
		await screen.saveChecked;
		context.frame.layout();
	}

	function find<T>(id: string): T {
		const found = screen.root.findById(id) ?? context.overlays.roots.map((root) => root.findById(id)).find(Boolean);
		if (!found) throw new Error(`no ${id}`);
		return found as unknown as T;
	}

	function clickOn(id: string): void {
		const { x, y, width, height } = find<{ screenBounds: { x: number; y: number; width: number; height: number } }>(id).screenBounds;
		click(context, x + width / 2, y + height / 2);
	}

	function continueLine(): string {
		return find<Text>('main_menu_continue_line').text;
	}

	function continueEnabled(): boolean {
		return find<{ enabled: boolean }>('main_menu_continue_button').enabled;
	}

	function dialog(): Dialog | null {
		const root = context.overlays.roots.find((each) => each.findById('main_menu_replace_dialog'));
		return (root?.findById('main_menu_replace_dialog') as Dialog | null | undefined) ?? null;
	}

	/** Lets the store's calls and the founding they wait on run: a few macrotask turns. */
	async function flush(): Promise<void> {
		for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
	}

	/** Tab from Cancel to the dialog's confirm, and Enter. */
	function confirmReplace(): void {
		send(context, [key('Tab')]);
		expect(context.focus.focused?.id).toBe('main_menu_replace_confirm');
		send(context, [key('Enter')]);
	}

	/** The compoundScreen navigation's campaign, failing when there was none. */
	function openedCampaign(): Campaign {
		const call = navigate.mock.calls.find(([name]) => name === 'compoundScreen');
		if (!call) throw new Error('the compound screen should have been opened');
		return (call[1] as { campaign: Campaign }).campaign;
	}

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1280, height: 720 };
		context = createTestContext({ viewport, clock: new Clock() });
	});

	afterEach(() => {
		screen?.unmount();
		delete (window as ElectronScope).electron;
	});

	describe('with no save', () => {
		beforeEach(() => open());

		it('focuses New Campaign, and disables Continue, saying there is nothing to continue', () => {
			expect(context.focus.focused?.id).toBe('main_menu_new_campaign_button');
			expect(continueEnabled()).toBe(false);
			expect(continueLine()).toBe('No campaign in progress.');
		});

		it('founds and saves a campaign on Enter, with no question, and opens the compound with it', async () => {
			send(context, [key('Enter')]);
			await flush();
			expect(dialog()).toBeNull();
			const campaign = openedCampaign();
			expect(campaign.day).toBe(1);
			expect(campaign.drivers.length).toBeGreaterThanOrEqual(2);
			expect(await store.saveStatus()).toBe('saved');
			// The instance handed on is the one the store saves.
			expect(await store.checkpoint(campaign)).toBe(true);
			expect((await store.load())?.seed).toBe(campaign.seed);
			expect(await store.history()).toEqual([]);
		});

		it('moves through the enabled buttons with the arrows, wrapping, past the disabled Continue', () => {
			send(context, [key('ArrowDown')]);
			expect(context.focus.focused?.id).toBe('main_menu_history_button');
			send(context, [key('ArrowDown')]);
			expect(context.focus.focused?.id).toBe('main_menu_skirmish_button');
			send(context, [key('ArrowUp'), key('ArrowUp'), key('ArrowUp')]);
			expect(context.focus.focused?.id).toBe('main_menu_developer_button');
			send(context, [key('Enter')]);
			expect(navigate).toHaveBeenCalledWith('developerScreen');
		});

		it('opens Campaign History and the Skirmish quick fight', () => {
			clickOn('main_menu_history_button');
			expect(navigate).toHaveBeenLastCalledWith('campaignHistoryScreen');
			clickOn('main_menu_skirmish_button');
			expect(navigate).toHaveBeenLastCalledWith('driverSelectionScreen');
		});

		it('shows the check running again after a start that failed to save, until the store answers', async () => {
			jest.spyOn(store, 'save').mockRejectedValue(new CampaignStoreError({
				reason: 'storage',
				message: "The campaign couldn't be saved: storage is full.",
				cause: quotaError(),
			}));
			let answer: (status: SaveStatus) => void = () => undefined;
			jest.spyOn(store, 'saveStatus').mockImplementation(() => new Promise<SaveStatus>((resolve) => { answer = resolve; }));
			send(context, [key('Enter')]);
			await flush();
			expect(navigate).not.toHaveBeenCalled();
			expect(find<Text>('main_menu_notice').text).toBe("The campaign couldn't be saved: storage is full.");
			expect(continueLine()).toBe('Looking for a saved campaign.');
			answer('none');
			await screen.saveChecked;
			expect(continueLine()).toBe('No campaign in progress.');
		});

		it('is one Tab stop', () => {
			send(context, [key('Tab')]);
			expect(context.focus.focused?.id).toBe('main_menu_new_campaign_button');
		});
	});

	describe('with a campaign in progress', () => {
		beforeEach(() => open(storageWith(fixtureText())));

		it("shows the campaign's state under Continue, counting the drivers at the compound", () => {
			expect(continueEnabled()).toBe(true);
			expect(continueLine()).toBe('Day 9 - 3 drivers - 1 stronghold taken');
		});

		it('continues the loaded campaign from the keys, which the store then saves', async () => {
			send(context, [key('ArrowDown')]);
			expect(context.focus.focused?.id).toBe('main_menu_continue_button');
			send(context, [key('Enter')]);
			const campaign = openedCampaign();
			const loaded = screen.save;
			expect(loaded.kind === 'saved' && loaded.campaign).toBe(campaign);
			expect(await store.checkpoint(campaign)).toBe(true);
		});

		it('asks before abandoning it, and Cancel or Escape keeps it, focus back on New Campaign', async () => {
			send(context, [key('Enter')]);
			await flush();
			const asked = dialog();
			expect(asked?.title).toBe('Abandon this campaign?');
			expect(find<Text>('main_menu_replace_body').text).toContain('Day 9 - 3 drivers - 1 stronghold taken');
			advance(context, OPEN_MS);
			// The safe answer has focus, so a stray Enter keeps the campaign.
			expect(context.focus.focused?.id).toBe('main_menu_replace_cancel');
			send(context, [key('Escape')]);
			advance(context, CLOSE_MS);
			expect(dialog()).toBeNull();
			expect(context.focus.focused?.id).toBe('main_menu_new_campaign_button');

			send(context, [key('Enter')]);
			await flush();
			advance(context, OPEN_MS);
			send(context, [key('Enter')]);
			advance(context, CLOSE_MS);
			await flush();
			expect(dialog()).toBeNull();
			expect(navigate).not.toHaveBeenCalled();
			expect((await store.load())?.day).toBe(9);
			expect(await store.history()).toEqual([]);
		});

		it('records it in the history as abandoned when confirmed with the pointer, then saves the new one', async () => {
			send(context, [key('Enter')]);
			await flush();
			advance(context, OPEN_MS);
			clickOn('main_menu_replace_confirm');
			advance(context, CLOSE_MS);
			await flush();
			const campaign = openedCampaign();
			expect(await store.history()).toEqual([{ seed: 20261006, day: 9, strongholdsTaken: 1, ending: 'abandoned' }]);
			expect((await store.load())?.seed).toBe(campaign.seed);
			expect(campaign.day).toBe(1);
		});

		it.each([
			{ width: 1440, height: 882 },
			{ width: 1024, height: 600 },
		])('lays the open dialog out with no lint at $width x $height, measured in the real faces', async (size) => {
			viewport.logical = size;
			context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
			screen.unmount();
			await open(storageWith(fixtureText()));
			send(context, [key('Enter')]);
			await flush();
			advance(context, OPEN_MS);
			const cancel = find<{ width: number }>('main_menu_replace_cancel');
			const confirm = find<{ width: number }>('main_menu_replace_confirm');
			expect(cancel.width).toBeGreaterThan(0);
			expect(confirm.width).toBeGreaterThan(0);
			const lint = layoutLint(treeSnapshot([screen.root, ...context.overlays.roots], size));
			expect(lint.violations).toEqual([]);
		});
	});

	describe('while the save check is running', () => {
		it('keeps Continue enabled, so Back can land on it, and moves focus to New Campaign if it turns out disabled', async () => {
			const held = new HeldStorage();
			held.hold();
			storage = held;
			store = storeOver(held);
			screen = new MainMenuScreen({ store });
			screen.mount(context);
			context.frame.layout();
			expect(screen.save.kind).toBe('checking');
			expect(continueEnabled()).toBe(true);
			send(context, [key('ArrowDown')]);
			expect(context.focus.focused?.id).toBe('main_menu_continue_button');
			// Nothing to continue yet: Enter on it does nothing.
			send(context, [key('Enter')]);
			expect(navigate).not.toHaveBeenCalled();

			held.release();
			await screen.saveChecked;
			expect(continueEnabled()).toBe(false);
			expect(context.focus.focused?.id).toBe('main_menu_new_campaign_button');
		});
	});

	describe('with a save it cannot continue', () => {
		it('reads again when storage failed, and still asks before abandoning a campaign the failure hid', async () => {
			const flaky = storageWith(fixtureText());
			flaky.fault = { method: 'getItem', error: securityError(), times: 1 };
			await open(flaky);
			expect(continueLine()).toBe("The saved campaign couldn't be read: storage is blocked.");

			send(context, [key('Enter')]);
			await flush();
			expect(dialog()?.title).toBe('Abandon this campaign?');
			expect(continueLine()).toBe('Day 9 - 3 drivers - 1 stronghold taken');
			advance(context, OPEN_MS);
			clickOn('main_menu_replace_confirm');
			advance(context, CLOSE_MS);
			await flush();
			expect(openedCampaign().day).toBe(1);
			expect(await store.history()).toEqual([{ seed: 20261006, day: 9, strongholdsTaken: 1, ending: 'abandoned' }]);
		});

		it("says an outdated save can't be continued, and replaces it after asking, with nothing in the history", async () => {
			await open(storageWith(outdatedText()));
			expect(continueEnabled()).toBe(false);
			expect(continueLine()).toBe("The saved campaign is from another version of the game and can't be continued. New Campaign replaces it.");

			send(context, [key('Enter')]);
			await flush();
			expect(dialog()?.title).toBe('Replace the old save?');
			advance(context, OPEN_MS);
			confirmReplace();
			advance(context, CLOSE_MS);
			await flush();
			const campaign = openedCampaign();
			expect((await store.load())?.seed).toBe(campaign.seed);
			expect(await store.history()).toEqual([]);
		});

		it("shows the store's message for a damaged save, and replaces it after asking, keeping a copy", async () => {
			const damaged = damagedText();
			await open(storageWith(damaged));
			expect(continueEnabled()).toBe(false);
			expect(continueLine()).toBe("The saved campaign is damaged and can't be loaded. It's been kept.");

			clickOn('main_menu_new_campaign_button');
			await flush();
			expect(dialog()?.title).toBe('Replace the damaged save?');
			advance(context, OPEN_MS);
			confirmReplace();
			advance(context, CLOSE_MS);
			await flush();
			expect(openedCampaign().day).toBe(1);
			expect(await storage.getItem(KEYS.recovery)).toBe(damaged);
		});

		it('says why when storage fails, and stays on the menu when New Campaign cannot save either', async () => {
			const blocked = new FaultyStorage();
			blocked.fault = { method: 'getItem', error: securityError() };
			await open(blocked);
			expect(continueEnabled()).toBe(false);
			expect(continueLine()).toBe("The saved campaign couldn't be read: storage is blocked.");

			send(context, [key('Enter')]);
			await flush();
			expect(dialog()).toBeNull();
			expect(navigate).not.toHaveBeenCalled();
			const notice = find<Text>('main_menu_notice');
			expect(notice.visible).toBe(true);
			expect(notice.text).toBe("The campaign couldn't be saved: storage is blocked.");
		});
	});

	it('fits the short viewport with every button and a two-line reason under Continue, measured in the real faces', async () => {
		(window as ElectronScope).electron = { isElectron: true };
		viewport.logical = { width: 1024, height: 600 };
		context = createTestContext({ viewport, draw: createMeasuringDrawApi().api });
		await open(storageWith(damagedText()));
		const menu = find<{ screenBounds: { x: number; y: number; width: number; height: number } }>('main_menu_buttons').screenBounds;
		const title = find<{ screenBounds: { y: number } }>('main_menu_title').screenBounds;
		expect(find<{ visible: boolean }>('main_menu_exit_button').visible).toBe(true);
		expect(find<Text>('main_menu_continue_line').height).toBeGreaterThan(tokens.fontSize.fs_sm * 2);
		expect(title.y).toBeGreaterThanOrEqual(0);
		expect(menu.y + menu.height).toBeLessThanOrEqual(600);
	});

	it('centres the column in the viewport and follows a resize with no screen code', async () => {
		await open();
		const menu = screen.root.findById('main_menu_buttons');
		if (!menu) throw new Error('the menu should be mounted');
		expect(screen.root.width).toBe(1280);
		expect(menu.x).toBe((1280 - menu.width) / 2);

		viewport.logical = { width: 1024, height: 600 };
		context.frame.viewportChanged();
		context.frame.layout();
		expect(screen.root.height).toBe(600);
		expect(menu.x).toBe((1024 - menu.width) / 2);
		expect(menu.y).toBeGreaterThanOrEqual(0);
		expect(menu.y + menu.height).toBeLessThanOrEqual(600);
	});

	it('builds nothing twice across a remount, and reads the save again', async () => {
		await open(storageWith(fixtureText()));
		screen.unmount();
		screen.mount(context);
		expect(screen.root.children.filter((child) => child.id === 'main_menu_buttons')).toHaveLength(1);
		expect(context.focus.focused?.id).toBe('main_menu_new_campaign_button');
		await screen.saveChecked;
		expect(continueLine()).toBe('Day 9 - 3 drivers - 1 stronghold taken');
	});

	it('ignores a save read that answers after the menu has gone', async () => {
		storage = storageWith(fixtureText());
		screen = new MainMenuScreen({ store: storeOver(storage) });
		screen.mount(context);
		const read = screen.saveChecked;
		screen.unmount();
		await read;
		expect(screen.save.kind).toBe('checking');
		screen.mount(context);
		await screen.saveChecked;
	});
});
