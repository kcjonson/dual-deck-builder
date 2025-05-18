import { Renderer } from '../engine/rendering/Renderer';
import { SplashScreen } from './screens/SplashScreen';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { DeveloperScreen } from './screens/DeveloperScreen';

/**
 * Interface for game screens
 */
export interface GameScreen {
	activate(): void;
	deactivate(): void;
	update(dt: number): void;
	render(): void;
}

/**
 * Main game class responsible for managing game state, screens, and resources
 */
export class Game {
	private renderer: Renderer;
	private currentScreen: string | null = null;
	private screens: Map<string, GameScreen> = new Map();
	private isElectron = false;
	private isInitialized = false;

	/**
	 * Create a new Game instance
	 * @param renderer WebGL renderer
	 */
	constructor(renderer: Renderer) {
		this.renderer = renderer;

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
	 * Initialize the game
	 */
	public async init(): Promise<void> {
		// Create screens
		await this.createScreens();

		// Start with the splash screen
		this.showScreen('splashScreen');

		// Set up any global event handlers
		this.setupEventHandlers();

		this.isInitialized = true;
	}

	/**
	 * Create game screens
	 */
	private async createScreens(): Promise<void> {
		// Create splash screen
		const splashScreen = new SplashScreen(this.renderer);
		splashScreen.setOnComplete(() => {
			// Switch to main menu after splash completes
			this.showScreen('mainMenuScreen');
		});
		this.screens.set('splashScreen', splashScreen);

		// Create main menu screen
		const mainMenuScreen = new MainMenuScreen(this.renderer);
		mainMenuScreen.setOnStartGame(() => {
			console.log('Start game clicked (not implemented yet)');
		});
		mainMenuScreen.setOnOpenSettings(() => {
			console.log('Settings clicked (not implemented yet)');
		});
		mainMenuScreen.setOnOpenCredits(() => {
			console.log('Credits clicked (not implemented yet)');
		});
		mainMenuScreen.setOnOpenDeveloper(() => {
			// Show developer screen
			this.showScreen('developerScreen');
		});
		mainMenuScreen.setOnExitGame(() => {
			if (this.isElectron) {
				// In Electron mode, request to close the app
				console.log('Exit game clicked');
				// Would use electron API to quit
			}
		});
		this.screens.set('mainMenuScreen', mainMenuScreen);

		// Create developer screen
		const developerScreen = new DeveloperScreen(this.renderer);
		developerScreen.setOnBack(() => {
			// Go back to main menu
			this.showScreen('mainMenuScreen');
		});
		this.screens.set('developerScreen', developerScreen);
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
				if (this.currentScreen === 'developerScreen') {
					this.showScreen('mainMenuScreen');
				} else {
					this.showScreen('developerScreen');
				}
			}

			// Example: Press Escape to go back to main menu
			if (event.key === 'Escape' && this.currentScreen !== 'mainMenuScreen') {
				this.showScreen('mainMenuScreen');
			}
		});
	}

	/**
	 * Show a specific screen
	 * @param screenId ID of the screen to show
	 */
	public showScreen(screenId: string): void {
		// Deactivate the current screen if there is one
		if (this.currentScreen) {
			const currentScreen = this.screens.get(this.currentScreen);
			if (currentScreen) {
				currentScreen.deactivate();
			}
		}

		// Activate the new screen
		const nextScreen = this.screens.get(screenId);
		if (nextScreen) {
			nextScreen.activate();
			this.currentScreen = screenId;
		} else {
			console.error(`Screen not found: ${screenId}`);
		}
	}

	/**
	 * Update the game state
	 * @param dt Time elapsed since last frame in seconds
	 */
	public update(dt: number): void {
		if (!this.isInitialized) return;

		// Update the current screen
		if (this.currentScreen) {
			const screen = this.screens.get(this.currentScreen);
			if (screen) {
				screen.update(dt);
			}
		}
	}

	/**
	 * Render the game
	 */
	public render(): void {
		if (!this.isInitialized) return;

		// Render the current screen
		if (this.currentScreen) {
			const screen = this.screens.get(this.currentScreen);
			if (screen) {
				screen.render();
			}
		}
	}
}
