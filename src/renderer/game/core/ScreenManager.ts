import { Screen } from './Screen';
import { SplashScreen } from '../screens/splash/SplashScreen';
import { MainMenuScreen } from '../screens/main-menu/MainMenuScreen';
import { DeveloperScreen } from '../screens/developer/DeveloperScreen';
import { CardShowcaseScreen } from '../screens/card-showcase/CardShowcaseScreen';
import { DriverSelectionScreen } from '../screens/driver-selection/DriverSelectionScreen';
import { CombatScreen } from '../screens/combat/CombatScreen';
import { BattleResultScreen } from '../screens/battleResult/BattleResultScreen';

/**
 * Known screen names in the game
 */
export type ScreenName = 
	| 'splashScreen'
	| 'mainMenuScreen'
	| 'developerScreen'
	| 'cardShowcaseScreen'
	| 'driverSelectionScreen'
	| 'combatScreen'
	| 'battleResultScreen';

/**
 * Screen constructor type
 */
type ScreenConstructor = new () => Screen;

/**
 * Manages screen lifecycle and navigation
 * Creates screens on demand and properly cleans them up
 * Implemented as a static class for global access
 */
export class ScreenManager {
	private static currentScreenName: ScreenName | null = null;
	private static currentScreen: Screen | null = null;
	private static initialized = false;
	
	/**
	 * Map of screen names to their constructors
	 */
	private static readonly screenConstructors: Map<ScreenName, ScreenConstructor> = new Map<ScreenName, ScreenConstructor>([
		['splashScreen', SplashScreen],
		['mainMenuScreen', MainMenuScreen],
		['developerScreen', DeveloperScreen],
		['cardShowcaseScreen', CardShowcaseScreen],
		['driverSelectionScreen', DriverSelectionScreen],
		['combatScreen', CombatScreen],
		['battleResultScreen', BattleResultScreen],
	]);
	
	/**
	 * Private constructor to prevent instantiation
	 */
	private constructor() {
		throw new Error('ScreenManager is a static class and cannot be instantiated');
	}
	
	/**
	 * Must be called once before using any other methods
	 */
	static initialize(): void {
		if (this.initialized) {
			console.warn('ScreenManager already initialized');
			return;
		}
		this.initialized = true;
	}
	
	/**
	 * Navigate to a screen by name, creating it if needed
	 * Properly destroys the current screen before creating the new one
	 */
	static navigate(screenName: ScreenName, data?: unknown): void {
		if (!this.initialized) {
			throw new Error('ScreenManager not initialized. Call ScreenManager.initialize() first');
		}
		
		console.log(`ScreenManager: Navigating to ${screenName}`);
		
		// Destroy current screen completely
		if (this.currentScreen) {
			console.log(`ScreenManager: Unmounting current screen ${this.currentScreenName}`);
			this.currentScreen.unmount();
			this.currentScreen = null;
			this.currentScreenName = null;
		}
		
		// Get screen constructor
		const ScreenConstructor = this.screenConstructors.get(screenName);
		if (!ScreenConstructor) {
			console.error(`ScreenManager: Unknown screen: ${screenName}`);
			return;
		}
		
		// Create new screen instance
		const screen = new ScreenConstructor();
		
		// Mount new screen
		console.log(`ScreenManager: Mounting new screen ${screenName}`);
		screen.mount(data);
		this.currentScreen = screen;
		this.currentScreenName = screenName;
	}
	
	/**
	 * Update the current screen
	 */
	static update(dt: number): void {
		this.currentScreen?.update(dt);
	}
	
	/**
	 * Render the current screen
	 */
	static render(): void {
		this.currentScreen?.render();
	}
	
	/**
	 * The mounted screen instance, for the dev tree snapshot.
	 */
	static get activeScreen(): Screen | null {
		return this.currentScreen;
	}

	/**
	 * The screens navigate() accepts, for the dev-only window.__app.navigate
	 * hook: a capture script has to enumerate before it can drive.
	 */
	static get screenNames(): ScreenName[] {
		return [...this.screenConstructors.keys()];
	}

	/**
	 * Whether a string names a screen. Guards the dev navigate hook, which
	 * takes whatever a console or a Playwright script hands it.
	 */
	static isScreenName(name: string): name is ScreenName {
		return this.screenConstructors.has(name as ScreenName);
	}

	/**
	 * Get the current screen name
	 */
	static getCurrentScreenName(): ScreenName | null {
		return this.currentScreenName;
	}
}