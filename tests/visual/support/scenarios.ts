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

export interface ScreenScenario {
	/** The golden's name: the screen's, plus a variant and a window size where they are not the defaults. */
	name: string;
	screen: string;
	/** What `navigate` hands the screen's onMount, as the game would pass it. */
	data?: unknown;
	/** The window, when it is not `FIXED_VIEWPORT`. */
	viewport?: Viewport;
	/** A golden this project cannot honestly own yet, and why. */
	blockedBy?: string;
}

export interface SceneScenario {
	scene: string;
	blockedBy?: string;
}

interface ScreenCase {
	screen: string;
	variant?: string;
	data?: unknown;
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
 */
const SCREEN_CASES: readonly ScreenCase[] = [
	{ screen: 'splashScreen' },
	{ screen: 'mainMenuScreen' },
	{ screen: 'settingsScreen' },
	{ screen: 'creditsScreen' },
	{ screen: 'developerScreen' },
	{ screen: 'cardShowcaseScreen' },
	{ screen: 'driverSelectionScreen' },
	{ screen: 'combatScreen' },
	{ screen: 'battleResultScreen', variant: 'victory', data: { victory: true } },
	{ screen: 'battleResultScreen', variant: 'defeat', data: { victory: false } },
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
	{ scene: 'combat-log' },
	{ scene: 'slider-tabs' },
	{ scene: 'overlays' },
	{ scene: 'dialog' },
	{ scene: 'popover' },
	{ scene: 'toasts' },
	{ scene: 'screen-transition' },
	{ scene: 'scroll-hug' },
	{ scene: 'rounded-clip' },
	{ scene: 'combat-road' },
];
