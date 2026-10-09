/**
 * @jest-environment jsdom
 */
// ScreenManager first, as the game loads it: it and the screens import each
// other, and loading a screen first leaves it undefined in the registry
import { ScreenManager } from './ScreenManager';
import { Clock } from '../../engine/animation/Clock';
import type { MountContext } from '../../engine/components/MountContext';
import { createTestContext } from '../../engine/components/testing';
import { advance, click, key, send } from '../../engine/services/testing';
import { tokens } from '../../engine/theme/tokens';
import type { BattleResultData } from '../screens/battleResult/BattleResultScreen';
import { MainMenuScreen } from '../screens/main-menu/MainMenuScreen';
import { campaignKeys, pageNamespace } from '../campaign/CampaignStore';
import { fixtureText } from '../campaign/__fixtures__/storeFixtures';

/** R8.22 and R12.38 through the game's scene manager. */

const FADE_MS = tokens.motion.dur + 32;
const VICTORY: BattleResultData = { victory: true };

let context: MountContext;

beforeAll(() => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
	context = createTestContext({ viewport: { logical: { width: 1280, height: 720 } }, clock: new Clock() });
	ScreenManager.initialize(context);
});

afterAll(() => {
	jest.restoreAllMocks();
});

/** The page's campaign keys, which the menu's shared store reads through jsdom's local storage. */
const KEYS = campaignKeys(pageNamespace(location));

/** Opens the menu at once and waits for its save check, which decides whether Continue takes focus. */
async function openMenu(): Promise<void> {
	ScreenManager.navigate('mainMenuScreen', undefined, { immediate: true });
	context.frame.layout();
	await (ScreenManager.activeScreen as MainMenuScreen).saveChecked;
	context.frame.layout();
}

function clearCampaignKeys(): void {
	for (const stored of Object.keys(localStorage)) {
		if (stored.startsWith('dual-deckbuilder.campaign[')) localStorage.removeItem(stored);
	}
}

beforeEach(async () => {
	context.animator.reducedMotion = false;
	clearCampaignKeys();
	await openMenu();
});

function focusOn(id: string): void {
	context.focus.focus(ScreenManager.activeScreen?.root.findById(id) ?? null);
}

function clickOn(id: string): void {
	const target = ScreenManager.activeScreen?.root.findById(id);
	if (!target) throw new Error(`no ${id} on ${ScreenManager.getCurrentScreenName()}`);
	const { x, y, width, height } = target.screenBounds;
	click(context, x + width / 2, y + height / 2);
}

describe('ScreenManager.navigate', () => {
	it('swaps at once when immediate, with no transition', () => {
		ScreenManager.navigate('battleResultScreen', VICTORY, { immediate: true });
		expect(ScreenManager.getCurrentScreenName()).toBe('battleResultScreen');
		expect(ScreenManager.transitioning).toBe(false);
		expect(context.overlays.roots).toHaveLength(0);
	});

	it('lists the developer screen third in a development build, where a capture script expects it', () => {
		expect(ScreenManager.screenNames.slice(0, 4)).toEqual(['splashScreen', 'mainMenuScreen', 'developerScreen', 'cardShowcaseScreen']);
	});

	it('refuses a name nothing registers, leaving the screen mounted and no transition running', () => {
		const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		const before = ScreenManager.activeScreen;

		ScreenManager.navigate('noSuchScreen' as unknown as 'mainMenuScreen');
		ScreenManager.navigate('noSuchScreen' as unknown as 'mainMenuScreen', undefined, { immediate: true });

		expect(error).toHaveBeenCalledTimes(2);
		expect(ScreenManager.getCurrentScreenName()).toBe('mainMenuScreen');
		expect(ScreenManager.activeScreen).toBe(before);
		expect(ScreenManager.transitioning).toBe(false);
		error.mockRestore();
	});

	it('fades out, swaps, and fades in, with the outgoing screen up until the swap', () => {
		ScreenManager.navigate('battleResultScreen', VICTORY);
		expect(ScreenManager.transitioning).toBe(true);
		expect(ScreenManager.getCurrentScreenName()).toBe('mainMenuScreen');

		advance(context, FADE_MS);
		expect(ScreenManager.getCurrentScreenName()).toBe('battleResultScreen');
		expect(ScreenManager.transitioning).toBe(true);

		advance(context, FADE_MS);
		expect(ScreenManager.transitioning).toBe(false);
		expect(context.overlays.roots).toHaveLength(0);
	});

	it('gives focus to the incoming screen\'s primary action once the transition lets go', () => {
		ScreenManager.navigate('battleResultScreen', VICTORY);
		advance(context, FADE_MS * 2);
		expect(context.focus.focused?.id).toBe('result_continue_button');

		send(context, [key('Enter')]);
		advance(context, FADE_MS * 2);
		expect(ScreenManager.getCurrentScreenName()).toBe('mainMenuScreen');
		expect(context.focus.focused?.id).toBe('main_menu_new_campaign_button');
	});

	it('swaps once for a double press', () => {
		ScreenManager.navigate('battleResultScreen', VICTORY, { immediate: true });
		const mounts = jest.spyOn(ScreenManager as unknown as { swap: () => void }, 'swap');
		send(context, [key('Escape'), key('Escape')]);
		advance(context, FADE_MS * 2);
		expect(mounts).toHaveBeenCalledTimes(1);
		expect(ScreenManager.getCurrentScreenName()).toBe('mainMenuScreen');
		mounts.mockRestore();
	});

	it('keeps keys from the screen beneath while it runs', () => {
		ScreenManager.navigate('battleResultScreen', VICTORY);
		advance(context, FADE_MS);
		// Enter on the result screen's Continue, still under the fade in
		send(context, [key('Enter')]);
		advance(context, FADE_MS);
		expect(ScreenManager.getCurrentScreenName()).toBe('battleResultScreen');
	});

	it('ends a transition under way when an immediate navigate arrives', () => {
		ScreenManager.navigate('battleResultScreen', VICTORY);
		advance(context, 50);
		ScreenManager.navigate('splashScreen', undefined, { immediate: true });
		expect(ScreenManager.transitioning).toBe(false);
		advance(context, FADE_MS * 2);
		expect(ScreenManager.getCurrentScreenName()).toBe('splashScreen');
	});

	it('queues an immediate navigate from inside a swap behind it, and ends idle', () => {
		ScreenManager.navigate('battleResultScreen', VICTORY, { immediate: true });
		const prototype = MainMenuScreen.prototype as unknown as { onMount: () => void };
		const onMount = prototype.onMount;
		const redirect = jest.spyOn(prototype, 'onMount').mockImplementationOnce(function (this: MainMenuScreen) {
			onMount.call(this);
			ScreenManager.navigate('splashScreen', undefined, { immediate: true });
		});
		ScreenManager.navigate('mainMenuScreen');
		advance(context, FADE_MS);
		expect(ScreenManager.getCurrentScreenName()).toBe('splashScreen');
		expect(ScreenManager.transitioning).toBe(true);
		advance(context, FADE_MS);
		expect(ScreenManager.transitioning).toBe(false);
		expect(context.overlays.roots).toHaveLength(0);
		redirect.mockRestore();
	});

	it.each([
		['campaign history', 1, 'Escape', 'main_menu_history_button'],
		['settings', 3, 'Escape', 'main_menu_settings_button'],
		['credits', 4, 'Enter', 'main_menu_credits_button'],
		['card showcase', 5, 'Escape', 'main_menu_card_showcase_button'],
		['developer tools', 6, 'Enter', 'main_menu_developer_button'],
		// Continue is enabled while the remounted menu checks the save, so focus can land back on it.
		['compound', 1, 'Escape', 'main_menu_continue_button', true],
	])('returns focus to the button that opened %s, with the ring a keyboard round trip shows', async (_screen, down, leave, opener, saved = false) => {
		if (saved) {
			localStorage.setItem(KEYS.slots.a, fixtureText());
			localStorage.setItem(KEYS.active, 'a');
			await openMenu();
		}
		advance(context, FADE_MS * 2);
		send(context, Array.from({ length: down }, () => key('ArrowDown')));
		expect(context.focus.focused?.id).toBe(opener);
		send(context, [key('Enter')]);
		advance(context, FADE_MS * 2);
		send(context, [key(leave)]);
		advance(context, FADE_MS * 2);
		expect(ScreenManager.getCurrentScreenName()).toBe('mainMenuScreen');
		expect(context.focus.focused?.id).toBe(opener);
		expect(context.focus.focusVisible).toBe(true);
		await (ScreenManager.activeScreen as MainMenuScreen).saveChecked;
		context.frame.layout();
		expect(context.focus.focused?.id).toBe(opener);
	});

	it('hands the restore to New Campaign when the save is gone by the time the menu checks, mid-fade', async () => {
		localStorage.setItem(KEYS.slots.a, fixtureText());
		localStorage.setItem(KEYS.active, 'a');
		await openMenu();
		advance(context, FADE_MS * 2);
		send(context, [key('ArrowDown'), key('Enter')]);
		advance(context, FADE_MS * 2);
		expect(ScreenManager.getCurrentScreenName()).toBe('compoundScreen');

		clearCampaignKeys();
		send(context, [key('Escape')]);
		// Through the fade out and the swap: the menu has mounted under the fade in, Continue restored as pending.
		advance(context, FADE_MS);
		expect(ScreenManager.getCurrentScreenName()).toBe('mainMenuScreen');
		expect(ScreenManager.transitioning).toBe(true);
		expect(context.focus.pendingFocus?.id).toBe('main_menu_continue_button');

		await (ScreenManager.activeScreen as MainMenuScreen).saveChecked;
		expect(context.focus.pendingFocus?.id).toBe('main_menu_new_campaign_button');
		advance(context, FADE_MS * 2);
		expect(ScreenManager.transitioning).toBe(false);
		expect(context.focus.focused?.id).toBe('main_menu_new_campaign_button');
	});

	it('returns focus without a ring after a pointer round trip (R9.23)', () => {
		advance(context, FADE_MS * 2);
		clickOn('main_menu_settings_button');
		advance(context, FADE_MS * 2);
		expect(ScreenManager.getCurrentScreenName()).toBe('settingsScreen');
		clickOn('settings_back_button');
		advance(context, FADE_MS * 2);
		expect(ScreenManager.getCurrentScreenName()).toBe('mainMenuScreen');
		expect(context.focus.focused?.id).toBe('main_menu_settings_button');
		expect(context.focus.focusVisible).toBe(false);
	});

	it('leaves the screen\'s own first focus when the opener can\'t take focus in the new mount', () => {
		focusOn('main_menu_settings_button');
		ScreenManager.navigate('settingsScreen', undefined, { immediate: true });
		const prototype = MainMenuScreen.prototype as unknown as { onMount: () => void };
		const onMount = prototype.onMount;
		const disable = jest.spyOn(prototype, 'onMount').mockImplementationOnce(function (this: MainMenuScreen) {
			onMount.call(this);
			const settings = this.root.findById('main_menu_settings_button');
			if (settings) settings.enabled = false;
		});
		ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
		advance(context, FADE_MS * 2);
		expect(disable).toHaveBeenCalled();
		expect(context.focus.focused?.id).toBe('main_menu_new_campaign_button');
		disable.mockRestore();
	});

	it('uses a remembered focus once: a later leave it did not record restores nothing', () => {
		focusOn('main_menu_settings_button');
		ScreenManager.navigate('settingsScreen', undefined, { immediate: true });
		// Back to the menu without a restore, then away again while the fade
		// in still covers it, which the recorder skips
		ScreenManager.navigate('mainMenuScreen');
		advance(context, FADE_MS + 16);
		expect(ScreenManager.transitioning).toBe(true);
		ScreenManager.navigate('settingsScreen', undefined, { immediate: true });
		ScreenManager.navigate('mainMenuScreen', undefined, { immediate: true, restoreFocus: true });
		expect(context.focus.focused?.id).toBe('main_menu_new_campaign_button');
	});

	it('restores focus only when asked, and only what the screen had when left', () => {
		focusOn('main_menu_settings_button');
		ScreenManager.navigate('settingsScreen', undefined, { immediate: true });
		ScreenManager.navigate('mainMenuScreen', undefined, { immediate: true });
		expect(context.focus.focused?.id).toBe('main_menu_new_campaign_button');

		context.focus.blur();
		ScreenManager.navigate('settingsScreen', undefined, { immediate: true });
		ScreenManager.navigate('mainMenuScreen', undefined, { immediate: true, restoreFocus: true });
		expect(context.focus.focused?.id).toBe('main_menu_new_campaign_button');
	});

	it('runs the whole transition at once under reduced motion', () => {
		context.animator.reducedMotion = true;
		ScreenManager.navigate('battleResultScreen', VICTORY);
		advance(context, 48);
		expect(ScreenManager.getCurrentScreenName()).toBe('battleResultScreen');
		expect(ScreenManager.transitioning).toBe(false);
		expect(context.focus.focused?.id).toBe('result_continue_button');
	});
});
