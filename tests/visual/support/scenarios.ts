/**
 * What the harness captures, listed once so the chromium and electron projects
 * cannot drift apart.
 *
 * Screen names are `ScreenManager`'s own (`src/renderer/game/core/ScreenManager.ts`)
 * and scene names are the gallery registry's (`src/renderer/game/screens/developer/sections.ts`).
 * Both are also the golden filenames, so renaming one invalidates a baseline
 * and that is the intended coupling: a scene that was renamed should not keep
 * comparing against the old picture.
 */
import { SHORT_VIEWPORT } from '../../../playwright.config';
import type { Viewport } from '../../../playwright.config';
import { AT_HOME, DAMAGED, ENDED, FULL_LOCKER, FULL_RUN, IN_PROGRESS, OUTDATED } from './campaignSaves';

export interface ScreenScenario {
	/** The golden's name: the screen's, plus a variant and a window size where they are not the defaults. */
	name: string;
	screen: string;
	/** What `navigate` hands the screen's onMount, as the game would pass it. */
	data?: unknown;
	/** Campaign saves in local storage when the screen mounts (`campaignSaves.ts`); none when left out. */
	storage?: Record<string, string>;
	/** The window, when it is not `FIXED_VIEWPORT`. */
	viewport?: Viewport;
	/** A golden this project cannot honestly own yet, and why. */
	blockedBy?: string;
}

export interface SceneScenario {
	scene: string;
	blockedBy?: string;
	/** Also linted at the short viewport, for a scene that lays out to the window's width. */
	lintShort?: boolean;
	/**
	 * Captured and linted at the short viewport too, as `<scene>-1024x600`:
	 * a scene standing in for a screen state that both gate sizes have to
	 * hold, as the screens themselves are (DDB-138's mid-drag road).
	 */
	shortViewport?: boolean;
}

interface ScreenCase {
	screen: string;
	variant?: string;
	data?: unknown;
	storage?: Record<string, string>;
}

/**
 * Every screen `ScreenManager.navigate` accepts, in registry order, with the
 * battle result once per outcome.
 *
 * The battle result renders from a `BattleResultData`, which is plain data
 * (the outcome), so `window.__app.navigate(name, data)` passes it exactly as
 * the combat screen does when a fight ends (DDB-230). Nothing is made up for
 * the capture: the payload is the whole of what the game hands the screen.
 *
 * Each spec arrives at its screen the same way every time: a fresh page, the
 * splash screen the app boots into, then exactly one `window.__app.navigate`.
 * That matters for driver selection specifically (DDB-106: 49 GPU calls on the
 * first mount and 33 on every mount after it, so the screen is not the same
 * drawing twice), and it costs nothing to hold every other screen to it too.
 *
 * Two properties of that path are worth stating, because they decide what
 * these goldens are pictures of. `openScreen` pauses before it navigates, so
 * `update` never runs on the incoming screen and every one of these captures
 * is the pre-first-update frame; anything a screen would settle into on its
 * first tick is outside what they cover. And the developer and card showcase
 * screens capture the viewport, not the content they scroll: the gallery
 * scenes below are where each developer section is covered whole.
 *
 * The screens that read the campaign store mount over the saves a case puts
 * in local storage first, the way a player's page holds them, and every other
 * case over none. The compound, Crew, and Customize screens are opened with
 * no campaign handed over, so each loads the save as Continue would, and
 * Customize shows the first seat's run deck (DDB-283, DDB-301, DDB-314,
 * DDB-321).
 */
const SCREEN_CASES: readonly ScreenCase[] = [
	{ screen: 'splashScreen' },
	{ screen: 'mainMenuScreen' },
	// Continue with the save's state, and the two saves it can't continue (DDB-283)
	{ screen: 'mainMenuScreen', variant: 'continue', storage: IN_PROGRESS },
	{ screen: 'mainMenuScreen', variant: 'outdated', storage: OUTDATED },
	{ screen: 'mainMenuScreen', variant: 'damaged', storage: DAMAGED },
	{ screen: 'settingsScreen' },
	{ screen: 'creditsScreen' },
	{ screen: 'developerScreen' },
	{ screen: 'cardShowcaseScreen' },
	{ screen: 'driverSelectionScreen' },
	{ screen: 'combatScreen' },
	// The log drawer open over the road, at both sizes: never over the dock or End Turn (DDB-140)
	{ screen: 'combatScreen', variant: 'log', data: { openLog: true } },
	{ screen: 'battleResultScreen', variant: 'victory', data: { victory: true } },
	{ screen: 'battleResultScreen', variant: 'defeat', data: { victory: false } },
	{ screen: 'campaignHistoryScreen' },
	{ screen: 'campaignHistoryScreen', variant: 'ended', storage: ENDED },
	// The fixture with its run out, Rest and Scavenge waiting for it, then home, the two live (DDB-303)
	{ screen: 'compoundScreen', storage: IN_PROGRESS },
	{ screen: 'compoundScreen', variant: 'home', storage: AT_HOME },
	// The fixture's run home, then a deck at the most it holds beside every card but the escorts' in the locker (DDB-314)
	{ screen: 'crewScreen', storage: AT_HOME },
	{ screen: 'crewScreen', variant: 'full', storage: FULL_LOCKER },
	// The fixture's run in seat 1: a card left at home, one borrowed, and an escort card; then a run deck at the most it holds beside the full locker (DDB-321)
	{ screen: 'customizeScreen', storage: IN_PROGRESS },
	{ screen: 'customizeScreen', variant: 'full', storage: FULL_RUN },
];

function caseName({ screen, variant }: ScreenCase): string {
	return variant ? `${screen}-${variant}` : screen;
}

/**
 * Every case at the fixed viewport, then every case again at the short one,
 * where each screen lays out differently (DDB-91). Both sets are in the lint
 * gate and both have goldens.
 */
export const SCREEN_SCENARIOS: readonly ScreenScenario[] = [
	...SCREEN_CASES.map((entry) => ({ ...entry, name: caseName(entry) })),
	...SCREEN_CASES.map((entry) => ({
		...entry,
		name: `${caseName(entry)}-${SHORT_VIEWPORT.width}x${SHORT_VIEWPORT.height}`,
		viewport: SHORT_VIEWPORT,
	})),
];

/** Every gallery scene, `?scene=` names. */
export const SCENE_SCENARIOS: readonly SceneScenario[] = [
	{ scene: 'interactive-controls' },
	{ scene: 'style-guide' },
	{ scene: 'input-showcase' },
	{ scene: 'rectangles' },
	{ scene: 'buttons' },
	{ scene: 'text' },
	{ scene: 'primitive-shapes' },
	{ scene: 'nested-panels' },
	{ scene: 'paint-order' },
	{ scene: 'clipping' },
	{ scene: 'shading' },
	{ scene: 'icons' },
	{ scene: 'stack' },
	{ scene: 'button-variants' },
	{ scene: 'lists' },
	{ scene: 'checkboxes' },
	{ scene: 'radio-group' },
	{ scene: 'panels' },
	{ scene: 'scrolling' },
	{ scene: 'leaves' },
	{ scene: 'menus' },
	{ scene: 'meters' },
	{ scene: 'data-display' },
	{ scene: 'tree-view' },
	{ scene: 'combat-fx' },
	{ scene: 'combat-log', lintShort: true },
	{ scene: 'slider-tabs' },
	{ scene: 'card-faces', lintShort: true },
	{ scene: 'card-detail', lintShort: true },
	{ scene: 'card-detail-pinned', lintShort: true },
	{ scene: 'card-detail-cap', lintShort: true },
	// The mini card's states and stacks (DDB-311)
	{ scene: 'card-minis', lintShort: true },
	// The driver card's states and its detail view (DDB-312)
	{ scene: 'driver-cards', lintShort: true },
	{ scene: 'driver-detail', lintShort: true },
	{ scene: 'driver-detail-pinned', lintShort: true },
	// The escort card's states and its detail view (DDB-313)
	{ scene: 'escort-cards', lintShort: true },
	{ scene: 'escort-detail', lintShort: true },
	{ scene: 'escort-detail-pinned', lintShort: true },
	// The area map view, the whole map and under fog (DDB-298)
	{ scene: 'area-map' },
	{ scene: 'area-map-fog' },
	{ scene: 'overlays' },
	{ scene: 'dialog' },
	{ scene: 'popover' },
	{ scene: 'toasts' },
	{ scene: 'screen-transition' },
	{ scene: 'scroll-hug' },
	{ scene: 'rounded-clip' },
	// Gated at both sizes, as the combat screen is: the intent pills' heavy tier, multi-hit, and "+N" (DDB-139)
	{ scene: 'combat-road', lintShort: true },
	{ scene: 'vehicle-tokens' },
	{ scene: 'card-pile-draw', lintShort: true },
	{ scene: 'card-pile-discard', lintShort: true },
	{ scene: 'card-reward', lintShort: true },
	{ scene: 'combat-targeting', shortViewport: true },
	// The dock's worst cases, gated at both sizes as the combat screen is (DDB-136)
	{ scene: 'combat-dock', lintShort: true },
	{ scene: 'combat-dock-crashed-out', lintShort: true },
];

/** A scene at one window size, and the name its golden and text record go by there. */
export interface SizedSceneScenario extends SceneScenario {
	name: string;
	viewport?: Viewport;
}

/**
 * Every scene at the fixed viewport, then the ones flagged `shortViewport`
 * again at the short one.
 */
export const SIZED_SCENE_SCENARIOS: readonly SizedSceneScenario[] = [
	...SCENE_SCENARIOS.map((entry) => ({ ...entry, name: entry.scene })),
	...SCENE_SCENARIOS.filter((entry) => entry.shortViewport).map((entry) => ({
		...entry,
		name: `${entry.scene}-${SHORT_VIEWPORT.width}x${SHORT_VIEWPORT.height}`,
		viewport: SHORT_VIEWPORT,
	})),
];
