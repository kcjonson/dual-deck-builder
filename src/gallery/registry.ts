import type { Panel } from '../renderer/engine/ui/Panel';
import type { DeveloperSectionOptions } from '../renderer/game/screens/developer/sections';
import { developerSections } from '../renderer/game/screens/developer/sections';
import { DialogScene } from './scenes/DialogScene';
import { OverlaysScene } from './scenes/OverlaysScene';
import { PopoverScene } from './scenes/PopoverScene';
import { ToastScene } from './scenes/ToastScene';

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

export interface GalleryScene {
	name: string;
	factory: SceneFactory;
}

/** Scenes only the gallery shows, after the developer sections. */
export const galleryOnlyScenes: readonly GalleryScene[] = [
	{ name: 'overlays', factory: (options) => new OverlaysScene(options) },
	{ name: 'dialog', factory: (options) => new DialogScene(options) },
	{ name: 'popover', factory: (options) => new PopoverScene(options) },
	{ name: 'toasts', factory: (options) => new ToastScene(options) },
];

export const gallerySceneRegistry: readonly GalleryScene[] = [
	...developerSections.map((section) => ({
		name: section.name,
		factory: section.build,
	})),
	...galleryOnlyScenes,
];
