import { Renderer } from '../engine/rendering/Renderer';
import { PerformanceMonitor } from '../engine/rendering/PerformanceMonitor';
import { DeveloperOverlay } from '../engine/ui/DeveloperOverlay';
import { SplashScreen } from './screens/splash/SplashScreen';
import { MainMenuScreen } from './screens/main-menu/MainMenuScreen';
import { DeveloperScreen } from './screens/developer/DeveloperScreen';
import { CardShowcaseScreen } from './screens/card-showcase/CardShowcaseScreen';
import { DriverSelectionScreen } from './screens/driver-selection/DriverSelectionScreen';
import { CombatScreen } from './screens/combat/CombatScreen';
import { BattleResultScreen, BattleResultData } from './screens/battleResult/BattleResultScreen';
import { Driver } from './mechanics/Driver';

/**
 * Interface for game screens
 */
export interface GameScreen {
	mount(data?: unknown): void;
	unmount(): void;
	update(dt: number): void;
	render(): void;
}

/**
 * Main game class responsible for managing game state, screens, and resources
 */
export class Game {
	private renderer: Renderer;
	private performanceMonitor: PerformanceMonitor;
	private developerOverlay: DeveloperOverlay;
	private currentScreen: string | null = null;
	private screens: Map<string, GameScreen> = new Map();
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
			// Go to driver selection screen
			this.showScreen('driverSelectionScreen');
		});
		mainMenuScreen.setOnOpenSettings(() => {
			// Settings action (not implemented yet)
		});
		mainMenuScreen.setOnOpenCredits(() => {
			// Credits action (not implemented yet)
		});
		mainMenuScreen.setOnOpenCardShowcase(() => {
			// Show card showcase screen
			this.showScreen('cardShowcaseScreen');
		});
		mainMenuScreen.setOnOpenDeveloper(() => {
			// Show developer screen
			this.showScreen('developerScreen');
		});
		mainMenuScreen.setOnExitGame(() => {
			if (this.isElectron) {
				// In Electron mode, request to close the app
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

		// Create card showcase screen
		const cardShowcaseScreen = new CardShowcaseScreen(this.renderer);
		cardShowcaseScreen.setOnBack(() => {
			// Go back to main menu
			this.showScreen('mainMenuScreen');
		});
		this.screens.set('cardShowcaseScreen', cardShowcaseScreen);

		// Create driver selection screen
		const driverSelectionScreen = new DriverSelectionScreen(this.renderer);
		driverSelectionScreen.setOnBack(() => {
			// Go back to main menu
			this.showScreen('mainMenuScreen');
		});
		driverSelectionScreen.setOnStartRun((driver1, driver2) => {
			// Start the run with selected drivers
			console.log(`Starting run with ${driver1.metadata.name} and ${driver2.metadata.name}`);
			this.startCombatWithDrivers([driver1, driver2]);
		});
		this.screens.set('driverSelectionScreen', driverSelectionScreen);

		// Create combat screen
		const combatScreen = new CombatScreen(this.renderer);
		combatScreen.setOnEndCombat((victory) => {
			// Get the battle state from the combat screen
			const battleState = combatScreen.getBattleState();
			if (battleState) {
				const resultData: BattleResultData = {
					victory,
					battleState
				};
				this.showScreen('battleResultScreen', resultData);
			} else {
				console.error('No battle state available');
				this.showScreen('mainMenuScreen');
			}
		});
		combatScreen.setOnBack(() => {
			this.showScreen('mainMenuScreen');
		});
		this.screens.set('combatScreen', combatScreen);
		
		// Create battle result screen
		const battleResultScreen = new BattleResultScreen(this.renderer);
		battleResultScreen.setOnContinue(() => {
			// TODO: Go to reward screen or map for victory, or retry options for defeat
			this.showScreen('mainMenuScreen');
		});
		this.screens.set('battleResultScreen', battleResultScreen);
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

			// Toggle developer overlay with F5
			if (event.key === 'F5') {
				event.preventDefault();
				this.developerOverlay.toggle();
			}
			
			// Example: Press Escape to go back to main menu
			if (event.key === 'Escape' && this.currentScreen !== 'mainMenuScreen' && this.currentScreen !== 'splashScreen') {
				// Don't interfere with combat targeting
				if (this.currentScreen === 'combatScreen') {
					// Let combat screen handle Escape for canceling targeting
					return;
				}
				this.showScreen('mainMenuScreen');
			}
		});
	}

	/**
	 * Show a specific screen
	 * @param screenId ID of the screen to show
	 * @param data Optional data to pass to the screen
	 */
	public showScreen(screenId: string, data?: unknown): void {
		// Unmount the current screen if there is one
		if (this.currentScreen) {
			const currentScreen = this.screens.get(this.currentScreen);
			if (currentScreen) {
				currentScreen.unmount();
			}
		}

		// Mount the new screen with optional data
		const nextScreen = this.screens.get(screenId);
		if (nextScreen) {
			nextScreen.mount(data);
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

		// Render the current screen
		if (this.currentScreen) {
			const screen = this.screens.get(this.currentScreen);
			if (screen) {
				screen.render();
			}
		}
		
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

	/**
	 * Start combat with selected drivers using new Team system
	 */
	private async startCombatWithDrivers(drivers: Driver[]): Promise<void> {
		// Get combat screen and initialize it with the new Team-based system
		const combatScreen = this.screens.get('combatScreen') as CombatScreen;
		if (combatScreen) {
			await combatScreen.initializeCombat(drivers);
			this.showScreen('combatScreen');
		}
	}
}
