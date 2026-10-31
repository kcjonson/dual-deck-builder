import { ErrorOverlay } from './renderer/engine/errors/ErrorOverlay';
import { buildLine } from './renderer/game/screens/main-menu/buildLabel';

/**
 * The game page's error overlay (DDB-538), listening from the moment the
 * bundle starts: index.ts imports this module before anything else, so a
 * module that throws while the rest of the bundle evaluates is shown too.
 * The build line is the one the splash and the main menu print, so a report
 * and the menu name the same build.
 */
export const errorOverlay = new ErrorOverlay({
	build: buildLine({ sha: __BUILD_SHA__, number: __BUILD_NUMBER__ }),
	hint: 'Please send a screenshot of this, or paste the copied details, to whoever gave you the playtest link, with what you were doing when it happened.',
});
errorOverlay.install();
