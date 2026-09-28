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

export interface ScreenScenario {
	screen: string;
	/** A golden this project cannot honestly own yet, and why. */
	blockedBy?: string;
}

export interface SceneScenario {
	scene: string;
	blockedBy?: string;
}

/**
 * Every screen `ScreenManager.navigate` accepts, in registry order.
 *
 * Six of the seven are captured. `battleResultScreen` is not: it renders from
 * a `BattleResultData` payload and `window.__app.navigate(name)` passes none,
 * so what a capture would get is the screen's own missing-data fallback - a
 * picture of a state the game never puts a player in, and one that cannot pass
 * the clean-console gate either. Constructing a fake `BattleState` in the page
 * to get past that would be exactly the fabricated golden this harness is
 * supposed to make impossible. It becomes capturable when the control surface
 * grows a data argument, or when a spec can play a battle to its end.
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
 * first tick is outside what they cover. And `screen-developerScreen` captures
 * the viewport, not the document: the screen scrolls 3,144 logical pixels of
 * content through an 882-pixel window, so the golden holds
 * `interactive-controls` (y 120 to 420) and `style-guide` (500 to 770) whole,
 * 32 pixels of `input-showcase`, and none of the other five. The gallery
 * scenes below are where those six are actually covered.
 */
export const SCREEN_SCENARIOS: readonly ScreenScenario[] = [
	{ screen: 'splashScreen' },
	{ screen: 'mainMenuScreen' },
	{ screen: 'developerScreen' },
	{ screen: 'cardShowcaseScreen' },
	{ screen: 'driverSelectionScreen' },
	{ screen: 'combatScreen' },
	{
		screen: 'battleResultScreen',
		blockedBy: 'reachable only with BattleResultData, and the R13.32 navigate hook carries no payload; '
			+ 'without it the screen logs "Invalid or missing data" and draws a fallback the game never shows',
	},
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
	{ scene: 'overlays' },
];
