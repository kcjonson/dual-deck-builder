import { Screen } from './Screen';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { MountContext } from '../../engine/components/MountContext';
import { SplashScreen } from '../screens/splash/SplashScreen';
import { MainMenuScreen } from '../screens/main-menu/MainMenuScreen';
import { DeveloperScreen } from '../screens/developer/DeveloperScreen';
import { CardShowcaseScreen } from '../screens/card-showcase/CardShowcaseScreen';
import { DriverSelectionScreen } from '../screens/driver-selection/DriverSelectionScreen';
import { CombatScreen } from '../screens/combat/CombatScreen';
import { BattleResultScreen } from '../screens/battleResult/BattleResultScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { CreditsScreen } from '../screens/credits/CreditsScreen';
import { ScreenTransition } from '../../engine/ui/ScreenTransition';

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
	| 'battleResultScreen'
	| 'settingsScreen'
	| 'creditsScreen';

/**
 * Screen constructor type
 */
type ScreenConstructor = new () => Screen;

export interface NavigateOptions {
	/**
	 * Swap at once with no fade, ending any transition under way. For the
	 * screen the game boots into and the dev navigate hook, which a capture
	 * drives while paused, when nothing ticks a fade. Asked for from inside a
	 * swap, it queues behind that swap as an ordinary navigate.
	 */
	immediate?: boolean;
}

/**
 * Manages screen lifecycle and navigation
 * Creates screens on demand and properly cleans them up
 * Implemented as a static class for global access
 */
export class ScreenManager {
	private static currentScreenName: ScreenName | null = null;
	private static currentScreen: Screen | null = null;
	private static context: MountContext | null = null;
	private static transition: ScreenTransition | null = null;
	/** A swap is unmounting or mounting a screen. */
	private static swapping = false;
	
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
		['settingsScreen', SettingsScreen],
		['creditsScreen', CreditsScreen],
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
	static initialize(context: MountContext): void {
		if (this.context) {
			console.warn('ScreenManager already initialized');
			return;
		}
		this.context = context;
		this.transition = new ScreenTransition({ id: 'screen_transition' });
	}

	/**
	 * Go to a screen through the screen transition (R8.22, R12.38): fade
	 * out, unmount the current screen, mount the new one, one layout, fade
	 * in, with input blocked throughout. Navigating again before the fade
	 * out ends replaces where it goes, so a double press swaps once.
	 */
	static navigate(screenName: ScreenName, data?: unknown, { immediate = false }: NavigateOptions = {}): void {
		const context = this.context;
		const transition = this.transition;
		if (!context || !transition) {
			throw new Error('ScreenManager not initialized. Call ScreenManager.initialize() first');
		}
		// From inside a swap (a screen redirecting from its mount) an immediate
		// swap would close the transition under the swap still running; it
		// queues behind it instead, still covered.
		if (immediate && !this.swapping) {
			transition.overlay?.close();
			this.swap(context, screenName, data);
			return;
		}
		void transition.run(context, () => this.swap(context, screenName, data));
	}

	/** A transition is covering the screen; nothing below it takes input. */
	static get transitioning(): boolean {
		return this.transition?.active ?? false;
	}

	/** Unmounts the current screen and mounts a new one: the transition's swap. */
	private static swap(context: MountContext, screenName: ScreenName, data?: unknown): void {
		this.swapping = true;
		try {
			this.mountScreen(context, screenName, data);
		} finally {
			this.swapping = false;
		}
	}

	private static mountScreen(context: MountContext, screenName: ScreenName, data?: unknown): void {
		console.log(`ScreenManager: Navigating to ${screenName}`);
		
		// Destroy current screen completely
		if (this.currentScreen) {
			console.log(`ScreenManager: Unmounting current screen ${this.currentScreenName}`);
			this.currentScreen.unmount();
			this.currentScreen = null;
			this.currentScreenName = null;
		}
		// R8.22: nothing the outgoing screen opened above itself survives it.
		context.popups.close();
		context.overlays.closeAll();
		
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
		screen.mount(context, data);
		// Its first frame builds all its small text at once (R6.4a).
		context.draw.prewarmText();
		this.currentScreen = screen;
		this.currentScreenName = screenName;
	}
	
	/** The viewport owner's new logical size, for the mounted screen (R7.11). */
	static resize(width: number, height: number): void {
		this.currentScreen?.resize(width, height);
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
	static render(draw: DrawApi): void {
		this.currentScreen?.render(draw);
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