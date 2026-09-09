import { Renderer } from '../engine/rendering/Renderer';
import { FrameTimer } from '../engine/rendering/FrameTimer';
import { DeveloperOverlay } from '../engine/ui/DeveloperOverlay';
import { ScreenManager } from './core/ScreenManager';
import { InputSystem } from '../engine/input/InputSystem';
import { CardLoader } from './core/CardLoader';
import type { Layer } from '../engine/components/Layer';

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
	/** The InputSystem's own gate, which is what actually drops events (R13.35). */
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

/**
 * Main game class responsible for managing game state and high-level systems
 */
export class Game {
	private renderer: Renderer;
	private frameTimer: FrameTimer;
	private developerOverlay: DeveloperOverlay;
	private isElectron = false;
	private isInitialized = false;
	/** R13.32's pause. Only reachable through window.__app in a dev build. */
	private isPaused = false;
	private updates = 0;
	private renders = 0;

	/**
	 * Create a new Game instance
	 * @param renderer WebGL renderer
	 * @param frameTimer Frame timing and per-frame draw counters (R13.7)
	 */
	constructor(renderer: Renderer, frameTimer: FrameTimer) {
		this.renderer = renderer;
		this.frameTimer = frameTimer;

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
		
		// Create developer overlay
		this.developerOverlay = new DeveloperOverlay(this.frameTimer);
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
	 * Input is not gated here. This engine dispatches straight from DOM
	 * listeners, so a loop that skipped `update` would still see buttons pressed
	 * and text typed; `InputSystem.paused` is the half that makes R13.35's
	 * "injected input is ignored while paused" true, and it is the same flag the
	 * gallery sets. The one listener outside the InputSystem is this class's own
	 * document keydown shortcut, gated in `setupEventHandlers`.
	 *
	 * What pause does not stop: the window resize path. `Renderer.handleResize`
	 * and `Screen.onResized` still run, so a window resized while paused
	 * reflows the mounted screen.
	 */
	public get paused(): boolean {
		return this.isPaused;
	}

	public set paused(value: boolean) {
		this.isPaused = value;
		InputSystem.getInstance().paused = value;
	}

	/**
	 * Initialize the game
	 */
	public async init(): Promise<void> {
		// Initialize the ScreenManager
		ScreenManager.initialize(this.renderer);

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
					inputPaused: InputSystem.getInstance().paused,
					viewport: { width: window.innerWidth, height: window.innerHeight },
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
				viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
			});
			// R13.11 wants the snapshot to carry the active screen so a capture
			// can group per scene, and the screen name is the game page's answer
			// to what the gallery calls a scene.
			installPerfHooks({
				snapshot: () => this.frameTimer.snapshot({ scene: ScreenManager.getCurrentScreenName() }),
			});
		}

		this.isInitialized = true;
	}

	/**
	 * Set up global event handlers
	 */
	private setupEventHandlers(): void {
		// Add any global event handlers here
		// For example, keyboard shortcuts for development
		document.addEventListener('keydown', (event) => {
			// These shortcuts navigate and toggle the overlay, and they are the one
			// input path the InputSystem's pause gate does not cover, so leaving
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

		// Update the current screen via ScreenManager
		ScreenManager.update(dt);
		
		// Update developer overlay
		this.developerOverlay.update();
	}

	/**
	 * Render the game
	 */
	public render(): void {
		if (!this.isInitialized) return;
		if (__DEV_TOOLS__) this.renders++;

		// Enable text batching for the entire frame
		this.renderer.beginTextBatch();

		// Render the current screen via ScreenManager
		ScreenManager.render();

		// Render developer overlay on top
		this.developerOverlay.render();
	}

	/**
	 * The deferred half of the frame, split from `render` so the loop can time
	 * the two as separate sections (R13.7). It is the batched text and nothing
	 * else: every other primitive reaches GL at its draw site inside `render`.
	 *
	 * It is not all of the batched text either, and the timed section reads low
	 * because of it. `Renderer.enableScissor` and `disableScissor` flush pending
	 * text before changing GL state, and `Panel` and `Layer` call those during
	 * the render tree walk, so a screen with a clipped panel submits most of its
	 * text inside `render` and leaves the tail here. Disabling the scissor is
	 * done here rather than at the end of `render` so that at least the frame's
	 * final flush is timed by the section that claims to measure flushing.
	 */
	public flush(): void {
		if (!this.isInitialized) return;

		if (this.renderer.isScissorEnabled()) {
			this.renderer.disableScissor();
		}
		this.renderer.flushTextBatch();
		this.renderer.endTextBatch();
	}

}
