/**
 * @jest-environment jsdom
 */
import { Game, GameStatus } from './Game';
import { ScreenManager } from './core/ScreenManager';
import { InputSystem } from '../engine/input/InputSystem';
import { DrawApi, NullBackend } from '../engine/draw';
import { FrameTimer } from '../engine/rendering/FrameTimer';
import type { PerfSnapshot } from '../engine/rendering/FrameTimer';
import type { GpuTimer } from '../engine/rendering/GpuTimer';
import type { CanvasViewport, ViewportListener } from '../engine/rendering/CanvasViewport';
import type { DeviceInfo } from '../engine/rendering/deviceInfo';

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
		resize: jest.fn(),
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

interface PerfWindow extends Window {
	__perf?: {
		snapshot(): PerfSnapshot;
	};
}

const screens = ScreenManager as unknown as {
	navigate: jest.Mock;
	update: jest.Mock;
	render: jest.Mock;
	resize: jest.Mock;
};

/**
 * The viewport owner's surface as `Game` uses it: a size to report and a
 * change to hear. `CanvasViewport.test.ts` covers the measuring.
 */
const viewportListeners: ViewportListener[] = [];
const viewport = {
	logical: { width: 1440, height: 882 },
	frame: { viewport: { width: 1440, height: 882 }, ratio: 1 },
	onChange: (listener: ViewportListener) => {
		viewportListeners.push(listener);
		return () => undefined;
	},
} as unknown as CanvasViewport;

const device: DeviceInfo = {
	backend: 'webgl2',
	vendor: 'Test Vendor',
	renderer: 'Test Renderer',
	features: { timerQuery: false, parallelShaderCompile: true, debugRendererInfo: true },
};

// A real draw API over R2.21's null backend rather than five no-op lambdas:
// `Game` drives the frame lifecycle now, so the frame it opens and closes is
// the real one and a mismatched pair would fail here rather than in a browser.
const draw = new DrawApi({ backend: new NullBackend(), development: false });

let game: Game;
/** Stands in for the GPU timer: the page only ever flips `enabled` and reads `stats`. */
const gpuTimer = { enabled: false, stats: undefined } as unknown as GpuTimer;

function app(): NonNullable<AppWindow['__app']> {
	const installed = (window as AppWindow).__app;
	if (!installed) throw new Error('window.__app was not installed');
	return installed;
}

function status(): GameStatus {
	return app().status?.() as GameStatus;
}

beforeAll(async () => {
	game = new Game({ draw, frameTimer: new FrameTimer(), viewport, device, gpuTimer });
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
	delete (window as PerfWindow).__perf;
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

describe('F5 runs the GPU timer only while the overlay shows', () => {
	function pressF5(): void {
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
	}

	it('turns the timer on with the overlay and off again with it', () => {
		expect(gpuTimer.enabled).toBe(false);
		pressF5();
		expect(gpuTimer.enabled).toBe(true);
		pressF5();
		expect(gpuTimer.enabled).toBe(false);
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

describe('window.__perf on the game page (R13.11, R15.37)', () => {
	function perf(): NonNullable<PerfWindow['__perf']> {
		const installed = (window as PerfWindow).__perf;
		if (!installed) throw new Error('window.__perf was not installed');
		return installed;
	}

	it('installs the fourth global', () => {
		expect(typeof perf().snapshot).toBe('function');
	});

	it('carries the mounted screen as the scene, which is what groups a capture', () => {
		expect(perf().snapshot().scene).toBe('mainMenuScreen');
	});

	it('reports null rather than zero for a timer that has seen no frame pair', () => {
		const snapshot = perf().snapshot();

		expect(snapshot.frame.ms).toBeNull();
		expect(snapshot.frame.p99Ms).toBeNull();
		expect(snapshot.sections.update).toBeNull();
		expect(snapshot.gpu.ms).toBeNull();
		expect(snapshot.memory.usedBytes).toBeNull();
	});

	it('carries the device the renderer detected (R15.3, R13.20)', () => {
		expect(perf().snapshot().device).toEqual(device);
	});

	it('carries the draw API counters for the last completed frame (R13.12)', () => {
		game.render();
		game.flush();

		const { batcher } = perf().snapshot();
		expect(batcher).not.toBeNull();
		expect(batcher).toEqual(draw.getStats());
	});
});

describe('the viewport owner, not the window, resizes the screen (R7.11)', () => {
	it('hands a committed viewport to the mounted screen', () => {
		for (const listener of viewportListeners) {
			listener({ width: 1280, height: 720, framebufferWidth: 2560, framebufferHeight: 1440, dpr: 2, uiScale: 1, ratio: 2 });
		}
		expect(screens.resize).toHaveBeenCalledWith(1280, 720);
	});

	it('reports the owner\'s logical size in status', () => {
		expect(status().viewport).toEqual({ width: 1440, height: 882 });
	});
});
