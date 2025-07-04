import { Renderer } from '../engine/rendering/Renderer';
import { PerformanceMonitor } from '../engine/rendering/PerformanceMonitor';
import { DeveloperOverlay } from '../engine/ui/DeveloperOverlay';
import { ScreenManager } from './core/ScreenManager';

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
