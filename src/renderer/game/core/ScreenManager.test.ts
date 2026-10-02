/**
 * @jest-environment jsdom
 */
// ScreenManager first, as the game loads it: it and the screens import each
// other, and loading a screen first leaves it undefined in the registry
import { ScreenManager } from './ScreenManager';
import { Clock } from '../../engine/animation/Clock';
import type { MountContext } from '../../engine/components/MountContext';
import { createTestContext } from '../../engine/components/testing';
import { advance, key, send } from '../../engine/services/testing';
import { tokens } from '../../engine/theme/tokens';
import type { BattleResultData } from '../screens/battleResult/BattleResultScreen';
import { MainMenuScreen } from '../screens/main-menu/MainMenuScreen';

/** R8.22 and R12.38 through the game's scene manager. */

const FADE_MS = tokens.motion.dur + 32;
const VICTORY = { victory: true, battleState: {} } as BattleResultData;

let context: MountContext;

beforeAll(() => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
	context = createTestContext({ viewport: { logical: { width: 1280, height: 720 } }, clock: new Clock() });
	ScreenManager.initialize(context);
});

afterAll(() => {
	jest.restoreAllMocks();
});

beforeEach(() => {
	context.animator.reducedMotion = false;
	ScreenManager.navigate('mainMenuScreen', undefined, { immediate: true });
	context.frame.layout();
});

describe('ScreenManager.navigate', () => {
	it('swaps at once when immediate, with no transition', () => {
		ScreenManager.navigate('battleResultScreen', VICTORY, { immediate: true });
		expect(ScreenManager.getCurrentScreenName()).toBe('battleResultScreen');
		expect(ScreenManager.transitioning).toBe(false);
		expect(context.overlays.roots).toHaveLength(0);
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
		expect(context.focus.focused?.id).toBe('main_menu_start_button');
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
		['settings', 1, 'Escape', 'main_menu_settings_button'],
		['credits', 2, 'Enter', 'main_menu_credits_button'],
	])('returns focus to the button that opened %s', (_screen, down, leave, opener) => {
		advance(context, FADE_MS * 2);
		send(context, Array.from({ length: down }, () => key('ArrowDown')));
		expect(context.focus.focused?.id).toBe(opener);
		send(context, [key('Enter')]);
		advance(context, FADE_MS * 2);
		send(context, [key(leave)]);
		advance(context, FADE_MS * 2);
		expect(ScreenManager.getCurrentScreenName()).toBe('mainMenuScreen');
		expect(context.focus.focused?.id).toBe(opener);
	});

	it('restores focus only when asked, and only what the screen had when left', () => {
		const settings = ScreenManager.activeScreen?.root.findById('main_menu_settings_button') ?? null;
		context.focus.focus(settings);
		ScreenManager.navigate('settingsScreen', undefined, { immediate: true });
		ScreenManager.navigate('mainMenuScreen', undefined, { immediate: true });
		expect(context.focus.focused?.id).toBe('main_menu_start_button');

		context.focus.blur();
		ScreenManager.navigate('settingsScreen', undefined, { immediate: true });
		ScreenManager.navigate('mainMenuScreen', undefined, { immediate: true, restoreFocus: true });
		expect(context.focus.focused?.id).toBe('main_menu_start_button');
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
