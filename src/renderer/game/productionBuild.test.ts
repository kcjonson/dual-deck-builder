/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../engine/components/testing';
import { DrawApi, NullBackend } from '../engine/draw';
import { FrameTimer } from '../engine/rendering/FrameTimer';
import type { CanvasViewport } from '../engine/rendering/CanvasViewport';
import type { DeviceInfo } from '../engine/rendering/deviceInfo';
import { key, send } from '../engine/services/testing';
import type { Game as GameType } from './Game';
import type { ScreenManager as ScreenManagerType } from './core/ScreenManager';
import type { MainMenuScreen as MainMenuScreenType } from './screens/main-menu/MainMenuScreen';

/**
 * R13.2 from the production side: with `__DEV_TOOLS__` false, as DefinePlugin
 * folds it, the developer screen is not registered, nothing can navigate to
 * it, and the page builds no F5 overlay and listens for neither hotkey. Every
 * other suite runs with the flag true, so this is the one that fails if a
 * production path to either tool comes back.
 *
 * The modules load inside `beforeAll`, after the flag flips, because
 * ScreenManager reads it while its module evaluates.
 */

const overlayConstructed = jest.fn();
jest.mock('../engine/ui/DeveloperOverlay', () => ({
	DeveloperOverlay: class {
		constructor() {
			overlayConstructed();
		}
	},
}));

const device: DeviceInfo = {
	backend: 'webgl2',
	vendor: 'Test Vendor',
	renderer: 'Test Renderer',
	features: { timerQuery: false, parallelShaderCompile: true, debugRendererInfo: true },
};

const viewport = {
	logical: { width: 1280, height: 720 },
	frame: { viewport: { width: 1280, height: 720 }, ratio: 1 },
	onChange: () => () => undefined,
} as unknown as CanvasViewport;

let ScreenManager: typeof ScreenManagerType;
let Game: typeof GameType;
let MainMenuScreen: typeof MainMenuScreenType;
const globals = globalThis as unknown as { __DEV_TOOLS__: boolean };
const context = createTestContext({
	draw: new DrawApi({ backend: new NullBackend(), development: false }),
	viewport: { logical: { width: 1280, height: 720 } },
});

beforeAll(() => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
	jest.spyOn(console, 'error').mockImplementation(() => undefined);
	globals.__DEV_TOOLS__ = false;
	// ScreenManager first, as the game loads it (see ScreenManager.test).
	/* eslint-disable @typescript-eslint/no-var-requires */
	({ ScreenManager } = require('./core/ScreenManager') as typeof import('./core/ScreenManager'));
	({ Game } = require('./Game') as typeof import('./Game'));
	({ MainMenuScreen } = require('./screens/main-menu/MainMenuScreen') as typeof import('./screens/main-menu/MainMenuScreen'));
	/* eslint-enable @typescript-eslint/no-var-requires */
});

afterAll(() => {
	globals.__DEV_TOOLS__ = true;
	jest.restoreAllMocks();
});

describe('a production build (R13.2)', () => {
	it('does not register the developer screen', () => {
		expect(ScreenManager.isScreenName('developerScreen')).toBe(false);
		expect(ScreenManager.screenNames).not.toContain('developerScreen');
		expect(ScreenManager.screenNames).toContain('mainMenuScreen');
	});

	it('refuses to navigate to it and leaves the mounted screen alone', () => {
		ScreenManager.initialize(context);
		ScreenManager.navigate('mainMenuScreen', undefined, { immediate: true });

		ScreenManager.navigate('developerScreen', undefined, { immediate: true });
		ScreenManager.navigate('developerScreen');

		expect(ScreenManager.getCurrentScreenName()).toBe('mainMenuScreen');
		expect(ScreenManager.transitioning).toBe(false);
	});

	it('has no Developer Tools button on the main menu', () => {
		const screen = new MainMenuScreen();
		screen.mount(context);
		expect(screen.root.findById('main_menu_developer_button')).toBeNull();
		expect(screen.root.findById('main_menu_credits_button')).not.toBeNull();
		screen.unmount();
	});

	it('builds no F5 overlay and listens for neither F5 nor F12', async () => {
		const navigate = jest.spyOn(ScreenManager, 'navigate');
		const game = new Game({ context, frameTimer: new FrameTimer(), viewport, device });
		await game.init();
		navigate.mockClear();

		send(context, [key('F5'), key('F12')]);

		expect(overlayConstructed).not.toHaveBeenCalled();
		expect(navigate).not.toHaveBeenCalled();
		expect((window as unknown as { __app?: unknown }).__app).toBeUndefined();
		expect(() => {
			game.update(0.016);
			game.render();
			game.flush();
		}).not.toThrow();
	});
});
