import type { Panel } from '../renderer/engine/ui/Panel';
import type { DeveloperSectionOptions } from '../renderer/game/screens/developer/sections';
import { developerSections } from '../renderer/game/screens/developer/sections';

/**
 * The gallery's scene registry (R13.30): one scene per developer-screen
 * section, wrapped from the single definition of that list in
 * `screens/developer/sections.ts`. The wrap is all this file does, so the
 * screen and the gallery cannot show different things.
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

export const gallerySceneRegistry: readonly GalleryScene[] = developerSections.map((section) => ({
	name: section.name,
	factory: section.build,
}));
