import { Renderer } from '../engine/rendering/Renderer';
import { PerformanceMonitor } from '../engine/rendering/PerformanceMonitor';
import { DeveloperOverlay } from '../engine/ui/DeveloperOverlay';
import { ScreenManager } from './core/ScreenManager';
import type { Layer } from '../engine/components/Layer';

/**
 * Main game class responsible for managing game state and high-level systems
 */
export class Game {
	private renderer: Renderer;
	private performanceMonitor: PerformanceMonitor;
	private developerOverlay: DeveloperOverlay;
	private isElectron = false;
	private isInitialized = false;

	/**
	 * Create a new Game instance
	 * @param renderer WebGL renderer
	 * @param performanceMonitor Performance tracking system
	 */
	constructor(renderer: Renderer, performanceMonitor: PerformanceMonitor) {
		this.renderer = renderer;
		this.performanceMonitor = performanceMonitor;

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
		this.developerOverlay = new DeveloperOverlay(this.performanceMonitor);
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
			const { installDebugHooks, installAppHooks } = require('../engine/debug/hooks') as typeof import('../engine/debug/hooks');
			// The game app's half of R13.32's control surface. Switching screens
			// is what switching scenes is in the gallery, and it is the only way
			// a capture script reaches a game screen without clicking through a
			// menu that positions its buttons by array index.
			installAppHooks({
				navigate: (screenName: string) => {
					if (!ScreenManager.isScreenName(screenName)) return false;
					ScreenManager.navigate(screenName);
					return true;
				},
				screens: () => ScreenManager.screenNames,
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

		// Enable text batching for the entire frame
		this.renderer.beginTextBatch();

		// Render the current screen via ScreenManager
		ScreenManager.render();
		
		// Render developer overlay on top
		this.developerOverlay.render();
		
		// Ensure scissor is disabled before final flush
		if (this.renderer.isScissorEnabled()) {
			this.renderer.disableScissor();
		}
		
		// Flush any remaining text
		// Note: The shader should already be set by the main loop
		this.renderer.flushTextBatch();
		this.renderer.endTextBatch();
	}

}
