import { DrawApi } from '../engine/draw';
import type { CanvasViewport } from '../engine/rendering/CanvasViewport';
import { FrameTimer, PerfSnapshot } from '../engine/rendering/FrameTimer';
import type { GpuTimer } from '../engine/rendering/GpuTimer';
import { DeveloperOverlay } from '../engine/ui/DeveloperOverlay';
import { renderTree } from '../engine/components/renderTree';
import { ScreenManager } from './core/ScreenManager';
import type { MountContext } from '../engine/components/MountContext';
import { CardLoader } from './core/CardLoader';
import type { Layer } from '../engine/components/Layer';
import type { DeviceInfo } from '../engine/rendering/deviceInfo';

/**
 * What `window.__app.status()` answers on the game page (R13.3, R13.32). The
 * shape deliberately echoes the gallery's `SceneHostStatus`: a harness that
 * can read one page's control state can read the other's.
 *
 * `updates` and `renders` are the pause evidence. Reading a boolean back from
 * the same object that set it proves nothing; watching one counter climb while
 * the other holds still proves the loop is doing what pause claims.
 */
export interface GameStatus {
	screen: string | null;
	screens: string[];
	paused: boolean;
	/** Frames updated and rendered since init. Paused frames render but do not update. */
	updates: number;
	renders: number;
	/** The dispatcher's own gate, which is what actually drops events (R13.35). */
	inputPaused: boolean;
	viewport: { width: number; height: number };
	/**
	 * False while a data fetch the mounted screen started is still outstanding
	 * (R14.5). The screenshot harness gates on this because the drawn tree
	 * cannot answer the question: a screen whose `cards.json` request has not
	 * resolved holds exactly as still as one whose request finished, so a
	 * "two frames agree" check accepts the pre-data frame as readily as the
	 * real one and a mint run would commit it as the golden.
	 */
	assetsReady: boolean;
}

export interface GameOptions {
	/** R1.6's services, the draw API and input among them; every root mounts with it. */
	context: MountContext;
	/** Frame timing and per-frame draw counters (R13.7). */
	frameTimer: FrameTimer;
	/** R7.11's viewport owner; the game reads its size and hears its changes, never the window's. */
	viewport: CanvasViewport;
	/** R15.3 and R13.20's device identity, for the perf snapshot. */
	device: DeviceInfo;
	/** R13.16's GPU timer; null in a production build, which has none. */
	gpuTimer?: GpuTimer | null;
}

/**
 * Main game class responsible for managing game state and high-level systems
 */
export class Game {
	private readonly context: MountContext;
	private draw: DrawApi;
	private frameTimer: FrameTimer;
	private viewport: CanvasViewport;
	private device: DeviceInfo;
	private gpuTimer: GpuTimer | null;
	private developerOverlay: DeveloperOverlay;
	private isElectron = false;
	private isInitialized = false;
	/** R13.32's pause. Only reachable through window.__app in a dev build. */
	private isPaused = false;
	private updates = 0;
	private renders = 0;

	constructor({ context, frameTimer, viewport, device, gpuTimer = null }: GameOptions) {
		this.context = context;
		this.draw = context.draw;
		this.frameTimer = frameTimer;
		this.viewport = viewport;
		this.device = device;
		this.gpuTimer = gpuTimer;
		// Off until F5, so nothing it draws reaches a golden.
		this.developerOverlay = new DeveloperOverlay({
			snapshot: this.perfSnapshot,
			viewportWidth: viewport.logical.width,
		});
		viewport.onChange(({ width, height }) => {
			ScreenManager.resize(width, height);
			this.developerOverlay.viewportWidth = width;
		});

		// Check if running in Electron
		interface ElectronWindow extends Window {
			electron?: {
				isElectron: boolean;
				[key: string]: unknown;
			};
		}
		const electronWindow = window as ElectronWindow;
		this.isElectron = electronWindow.electron?.isElectron === true;

		console.log(`Running in ${this.isElectron ? 'Electron' : 'Browser'} mode`);
	}

	/**
	 * R13.32's pause, on the game page rather than only in the gallery.
	 *
	 * The bargain is the gallery's, because R13.32 states it once for both:
	 * update stops, render keeps running, so a paused page still presents the
	 * frame a screenshot needs (DDB-59). The branch lives in `update` rather
	 * than in the frame loop for the same reason `SceneHost` keeps it, and
	 * `lastTime` in the loop advances on paused frames, so resuming hands
	 * `update` a normal delta instead of the whole pause.
	 *
	 * Input is not gated here. The dispatcher drains its queue in the loop's
	 * input section whether or not `update` runs, so `Dispatcher.paused`,
	 * which drops input at the queue, is the half that makes R13.35's
	 * "injected input is ignored while paused" true, and it is the same flag the
	 * gallery sets. The one listener outside the dispatcher is this class's own
	 * document keydown shortcut, gated in `setupEventHandlers`.
	 *
	 * What pause does not stop: the resize path. The viewport commits at the
	 * top of every frame, paused or not, and `Screen.onResized` runs, so a
	 * window resized while paused reflows the mounted screen.
	 */
	public get paused(): boolean {
		return this.isPaused;
	}

	public set paused(value: boolean) {
		this.isPaused = value;
		this.context.dispatcher.paused = value;
	}

	/**
	 * Initialize the game
	 */
	public async init(): Promise<void> {
		// Initialize the ScreenManager
		ScreenManager.initialize(this.context);
		// The overlay is a root of its own, drawn after the screen (R8.21).
		this.developerOverlay.mount(this.context);

		// Start with the splash screen
		ScreenManager.navigate('splashScreen');

		// Set up any global event handlers
		this.setupEventHandlers();

		if (__DEV_TOOLS__) {
			// Required, not imported: with tsconfig `module: commonjs` webpack
			// cannot tree-shake an unused ES import, but it does drop a require
			// inside a branch DefinePlugin has folded to false. That keeps the
			// whole debug/ subtree out of a production bundle (R13.2).
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const { installDebugHooks, installAppHooks, installPerfHooks } = require('../engine/debug/hooks') as typeof import('../engine/debug/hooks');
			// The game app's half of R13.32's control surface. Switching screens
			// is what switching scenes is in the gallery, and it is the only way
			// a capture script reaches a game screen without clicking through a
			// menu that positions its buttons by array index.
			//
			// pause, resume and status are inlined here for the reason `roots` is
			// below: terser cannot prove a class method is uncalled once
			// DefinePlugin folds away its only caller, so a `status` method would
			// survive into production whole. The `paused` accessor stays a member
			// because `update` reads the field on every frame either way.
			installAppHooks({
				navigate: (screenName: string) => {
					if (!ScreenManager.isScreenName(screenName)) return false;
					ScreenManager.navigate(screenName);
					return true;
				},
				screens: () => ScreenManager.screenNames,
				pause: () => {
					this.paused = true;
				},
				resume: () => {
					this.paused = false;
				},
				status: (): GameStatus => ({
					screen: ScreenManager.getCurrentScreenName(),
					screens: ScreenManager.screenNames,
					paused: this.isPaused,
					updates: this.updates,
					renders: this.renders,
					inputPaused: this.context.dispatcher.paused,
					viewport: this.viewport.logical,
					assetsReady: !CardLoader.getInstance().loading,
				}),
			});
			installDebugHooks({
				// Inlined rather than a method: terser cannot prove a class
				// method is uncalled once DefinePlugin folds away its only
				// caller, so a `debugRoots` method survives into production
				// whole. Inside the branch, the constant folding takes it.
				// Roots are the mounted screen plus the developer overlay, and
				// only while the overlay is actually drawn (R13.21).
				roots: () => {
					const roots: Layer[] = [];
					const screen = ScreenManager.activeScreen;
					if (screen) roots.push(screen.root);
					if (this.developerOverlay.shown) roots.push(this.developerOverlay);
					return roots;
				},
				viewport: () => ({ ...this.viewport.logical, ratio: this.viewport.state.ratio }),
			});
			installPerfHooks({ snapshot: this.perfSnapshot, gpuTimer: this.gpuTimer });
		}

		this.isInitialized = true;
	}

	/**
	 * R13.11's snapshot with everything this page owns folded in. The F5
	 * overlay and `window.__perf` both read this one function, so what a person
	 * sees and what a capture records cannot disagree (R13.3). R13.11 wants the
	 * active screen on it so a capture can group per scene, and the screen name
	 * is the game page's answer to what the gallery calls a scene.
	 */
	private perfSnapshot = (): PerfSnapshot => this.frameTimer.snapshot({
		scene: ScreenManager.getCurrentScreenName(),
		device: this.device,
		// Null before the first frame: an unopened draw API's zeros would read
		// as a measured empty frame (R13.5).
		batcher: this.draw.frame > 0 ? this.draw.getStats() : null,
		gpu: this.gpuTimer?.stats ?? null,
	});

	/**
	 * Set up global event handlers
	 */
	private setupEventHandlers(): void {
		// Add any global event handlers here
		// For example, keyboard shortcuts for development
		document.addEventListener('keydown', (event) => {
			// These shortcuts navigate and toggle the overlay, and they are the one
			// input path the dispatcher's pause gate does not cover, so leaving
			// them live would let a keystroke change the screen underneath a paused
			// capture and make status().paused a lie (R13.32, R13.35). Gating them
			// changes what real keys do while paused, which is only reachable
			// through window.__app.pause() in a development build; DefinePlugin
			// folds the check away in production.
			if (__DEV_TOOLS__ && this.isPaused) return;

			// Example: Press F12 to toggle developer screen
			if (event.key === 'F12') {
				if (ScreenManager.getCurrentScreenName() === 'developerScreen') {
					ScreenManager.navigate('mainMenuScreen');
				} else {
					ScreenManager.navigate('developerScreen');
				}
			}

			// Toggle developer overlay with F5
			if (event.key === 'F5') {
				event.preventDefault();
				this.developerOverlay.toggle();
				// The GPU timer costs frame time on some drivers, so it runs
				// only while someone is looking at what it reports.
				if (this.gpuTimer) this.gpuTimer.enabled = this.developerOverlay.shown;
			}
			
			// Example: Press Escape to go back to main menu
			const currentScreen = ScreenManager.getCurrentScreenName();
			if (event.key === 'Escape' && currentScreen !== 'mainMenuScreen' && currentScreen !== 'splashScreen') {
				// Don't interfere with combat targeting
				if (currentScreen === 'combatScreen') {
					// Let combat screen handle Escape for canceling targeting
					return;
				}
				ScreenManager.navigate('mainMenuScreen');
			}
		});
	}


	/**
	 * Update the game state
	 * @param dt Time elapsed since last frame in seconds
	 */
	public update(dt: number): void {
		if (!this.isInitialized) return;
		if (__DEV_TOOLS__ && this.isPaused) return;
		if (__DEV_TOOLS__) this.updates++;

		// R8.17: the components that asked for this frame, then the screen's
		// own game logic.
		this.context.frame.update(dt);
		ScreenManager.update(dt);
		
		// Update developer overlay
		this.developerOverlay.update();
	}

	/**
	 * R8.16's layout phase, after update and before render: every dirty
	 * relayout boundary once. It runs while paused too, so a resize during a
	 * capture still reflows the frame render is about to present.
	 */
	public layout(): void {
		if (!this.isInitialized) return;
		this.context.frame.layout();
	}

	/**
	 * Render the game
	 */
	public render(): void {
		if (!this.isInitialized) return;
		if (__DEV_TOOLS__) this.renders++;

		// Nothing below reaches GL: a draw call resolves its state onto a command
		// and the command waits for a barrier or endFrame (R2.4 to R2.7).
		this.draw.beginFrame(this.viewport.frame);

		// Render the current screen via ScreenManager
		ScreenManager.render(this.draw);

		// Render developer overlay on top
		renderTree(this.developerOverlay, this.draw);
	}

	/**
	 * The deferred half of the frame, split from `render` so the loop can time
	 * the two as separate sections (R13.7). `endFrame` drains the last sort
	 * domain and hands it to the backend, which is where it paints.
	 *
	 * Shapes used to reach GL at their draw sites inside `render`, so section
	 * timings on both pages are not comparable with the phase 0 baseline. Now
	 * `render` is CPU work only and, since a clip change is not a barrier
	 * (R3.20), the whole frame is submitted here.
	 */
	public flush(): void {
		if (!this.isInitialized) return;
		this.draw.endFrame();
	}

}
