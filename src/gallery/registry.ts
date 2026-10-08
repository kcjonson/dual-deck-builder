import type { Panel } from '../renderer/engine/ui/Panel';
import type { DeveloperSectionOptions } from '../renderer/game/screens/developer/sections';
import type { Screen } from '../renderer/game/core/Screen';
import { developerSections } from '../renderer/game/screens/developer/sections';
import { CardPileScene } from './scenes/CardPileScene';
import { DialogScene } from './scenes/DialogScene';
import { EscortCardScene } from './scenes/EscortCardScene';
import { OverlaysScene } from './scenes/OverlaysScene';
import { PopoverScene } from './scenes/PopoverScene';
import { RoundedClipScene } from './scenes/RoundedClipScene';
import { ScrollHugScene } from './scenes/ScrollHugScene';
import { ToastScene } from './scenes/ToastScene';
import { TransitionScene } from './scenes/TransitionScene';
import { BATTLE_FIT_SCENARIOS, prepareBattleFit } from './scenes/battleFitScenarios';
import { CombatScreen } from '../renderer/game/screens/combat/CombatScreen';

/**
 * The gallery's scene registry (R13.30): one scene per developer-screen
 * section, wrapped from the single definition of that list in
 * `screens/developer/sections.ts`, so the screen and the gallery cannot show
 * different things; then the gallery's own scenes, which exist to exercise
 * services a developer-screen section cannot (they open overlay roots over
 * whatever hosts them).
 *
 * The list is imported rather than owned because the arrow has to point this
 * way. DeveloperScreen is a live game screen; the gallery is a development-only
 * entry point (R15.37's development-builds-only half, enforced by the
 * NODE_ENV=production guard in webpack.web.js). Owning the list here made
 * `src/gallery/` a dependency of production code and put this file in the
 * deployed bundle; importing it keeps `src/gallery/**` uniformly dev-only.
 */

export type SceneFactoryOptions = DeveloperSectionOptions;
export type SceneFactory = (options: SceneFactoryOptions) => Panel;

/** A scene built as a panel, placed at the gallery's margin and laid out to its width. */
export interface PanelScene {
	name: string;
	factory: SceneFactory;
}

/** A game screen mounted whole, at the viewport's size, with the data the game would hand it. */
export interface ScreenSceneMount {
	screen: Screen;
	data?: unknown;
}

/**
 * A scene that is a whole screen: the battle screen's fit scenes (DDB-141)
 * are the real `CombatScreen` with a prepared fight, so what they measure
 * is the screen's own layout, input and overlays rather than a copy.
 */
export interface ScreenScene {
	name: string;
	screen: () => ScreenSceneMount;
}

export type GalleryScene = PanelScene | ScreenScene;

export function isScreenScene(scene: GalleryScene): scene is ScreenScene {
	return 'screen' in scene;
}

/** Scenes only the gallery shows, after the developer sections. */
export const galleryOnlyScenes: readonly GalleryScene[] = [
	{ name: 'overlays', factory: (options) => new OverlaysScene(options) },
	{ name: 'dialog', factory: (options) => new DialogScene(options) },
	{ name: 'popover', factory: (options) => new PopoverScene(options) },
	{ name: 'toasts', factory: (options) => new ToastScene(options) },
	{ name: 'screen-transition', factory: (options) => new TransitionScene(options) },
	{ name: 'scroll-hug', factory: (options) => new ScrollHugScene(options) },
	{ name: 'rounded-clip', factory: (options) => new RoundedClipScene(options) },
	// The escort card's states and its detail view (DDB-313), one view a scene so each fits 1024x600
	{ name: 'escort-cards', factory: (options) => new EscortCardScene({ ...options, mode: 'cards' }) },
	{ name: 'escort-detail', factory: (options) => new EscortCardScene({ ...options, mode: 'detail' }) },
	{ name: 'escort-detail-pinned', factory: (options) => new EscortCardScene({ ...options, mode: 'detail-pinned' }) },
	{ name: 'card-pile-draw', factory: (options) => new CardPileScene({ ...options, mode: 'draw' }) },
	{ name: 'card-pile-discard', factory: (options) => new CardPileScene({ ...options, mode: 'discard' }) },
	{ name: 'card-reward', factory: (options) => new CardPileScene({ ...options, mode: 'reward' }) },
	// The battle screen whole, at the mock's six fit scenarios (DDB-141)
	...BATTLE_FIT_SCENARIOS.map((scenario): ScreenScene => ({
		name: `battle-${scenario}`,
		screen: () => ({ screen: new CombatScreen(), data: { prepare: () => prepareBattleFit(scenario) } }),
	})),
];

export const gallerySceneRegistry: readonly GalleryScene[] = [
	...developerSections.map((section) => ({
		name: section.name,
		factory: section.build,
	})),
	...galleryOnlyScenes,
];
