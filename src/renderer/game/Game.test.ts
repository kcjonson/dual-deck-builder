/**
 * @jest-environment jsdom
 */
import { Game, GameStatus } from './Game';
import { ScreenManager } from './core/ScreenManager';
import { InputSystem } from '../engine/input/InputSystem';
import type { Renderer } from '../engine/rendering/Renderer';
import type { PerformanceMonitor } from '../engine/rendering/PerformanceMonitor';

/**
 * R13.32's pause on the game page, driven through `window.__app` rather than
 * through the class, because that surface is the thing DDB-59 will script and
 * a test that called `game.paused = true` directly would prove the field works
 * and nothing about the hook.
 *
 * ScreenManager and DeveloperOverlay are mocked out with factories, which stops
 * the real modules being required at all: the real ScreenManager pulls in all
 * seven screens and the card data behind them, none of which this file has
 * anything to say about.
 */

jest.mock('./core/ScreenManager', () => ({
	ScreenManager: {
		initialize: jest.fn(),
		navigate: jest.fn(),
		isScreenName: jest.fn(() => true),
		screenNames: ['splashScreen', 'mainMenuScreen', 'developerScreen'],
		activeScreen: null,
		getCurrentScreenName: jest.fn(() => 'mainMenuScreen'),
		update: jest.fn(),
		render: jest.fn(),
	},
}));

jest.mock('../engine/ui/DeveloperOverlay', () => ({
	DeveloperOverlay: class {
		public shown = false;
		public toggle(): void {
			this.shown = !this.shown;
		}
		public update(): void {
			/* no drawing in a test */
		}
		public render(): void {
			/* no drawing in a test */
		}
	},
}));

interface AppWindow extends Window {
	__app?: {
		navigate?(screenName: string): boolean;
		screens?(): string[];
		pause?(): void;
		resume?(): void;
		status?(): unknown;
	};
}

const screens = ScreenManager as unknown as {
	navigate: jest.Mock;
	update: jest.Mock;
	render: jest.Mock;
};

const rendererStub = {
	beginTextBatch: () => undefined,
	isScissorEnabled: () => false,
	disableScissor: () => undefined,
	flushTextBatch: () => undefined,
	endTextBatch: () => undefined,
} as unknown as Renderer;

let game: Game;

function app(): NonNullable<AppWindow['__app']> {
	const installed = (window as AppWindow).__app;
	if (!installed) throw new Error('window.__app was not installed');
	return installed;
}

function status(): GameStatus {
	return app().status?.() as GameStatus;
}

beforeAll(async () => {
	game = new Game(rendererStub, {} as PerformanceMonitor);
	await game.init();
});

beforeEach(() => {
	app().resume?.();
	screens.navigate.mockClear();
	screens.update.mockClear();
	screens.render.mockClear();
});

afterAll(() => {
	app().resume?.();
	delete (window as AppWindow).__app;
});

describe('window.__app on the game page (R13.32, R15.37)', () => {
	it('carries the control half as well as the navigation half', () => {
		expect(typeof app().navigate).toBe('function');
		expect(typeof app().screens).toBe('function');
		expect(typeof app().pause).toBe('function');
		expect(typeof app().resume).toBe('function');
		expect(typeof app().status).toBe('function');
	});

	it('reports an unpaused start with the mounted screen', () => {
		expect(status().paused).toBe(false);
		expect(status().inputPaused).toBe(false);
		expect(status().screen).toBe('mainMenuScreen');
		expect(status().screens).toContain('developerScreen');
	});
});

describe('pause stops update and leaves render running', () => {
	// The counters are the point: a screenshot needs a frame, so render has to
	// keep going, and the only outside evidence that update stopped is one
	// counter climbing while the other holds.
	it('holds updates still while renders climb', () => {
		app().pause?.();
		const before = status();

		game.update(0.016);
		game.update(0.016);
		game.render();
		game.render();

		const after = status();
		expect(after.updates).toBe(before.updates);
		expect(after.renders).toBe(before.renders + 2);
		expect(screens.update).not.toHaveBeenCalled();
		expect(screens.render).toHaveBeenCalledTimes(2);
	});

	it('resumes without replaying the frames it skipped', () => {
		app().pause?.();
		game.update(0.016);
		app().resume?.();

		const before = status();
		game.update(0.016);

		expect(status().updates).toBe(before.updates + 1);
		expect(screens.update).toHaveBeenCalledTimes(1);
		expect(screens.update).toHaveBeenCalledWith(0.016);
	});

	it('sets the InputSystem gate, which is what actually drops events (R13.35)', () => {
		app().pause?.();
		expect(InputSystem.getInstance().paused).toBe(true);
		expect(status().inputPaused).toBe(true);

		app().resume?.();
		expect(InputSystem.getInstance().paused).toBe(false);
		expect(status().inputPaused).toBe(false);
	});
});

describe('the document keydown shortcut is gated by pause too', () => {
	// F12 and F5 sit on a raw document listener, outside the InputSystem, so
	// the pause gate there does not reach them. Ungated they would navigate
	// out from under a paused capture. Gating changes what a real key does
	// while paused, which is only reachable in a development build.
	function pressF12(): void {
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }));
	}

	it('navigates while running', () => {
		pressF12();

		expect(screens.navigate).toHaveBeenCalledWith('developerScreen');
	});

	it('does nothing while paused', () => {
		app().pause?.();
		pressF12();

		expect(screens.navigate).not.toHaveBeenCalled();
	});

	it('navigates again after resume', () => {
		app().pause?.();
		pressF12();
		app().resume?.();
		pressF12();

		expect(screens.navigate).toHaveBeenCalledTimes(1);
	});
});
