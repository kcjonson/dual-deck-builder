/**
 * Which scene a gallery URL asks for (R13.30).
 *
 * Pure string handling: no DOM, no registry import, nothing from the renderer,
 * so the same function the browser calls is the one the unit tests call in the
 * node environment the rest of the suite runs in (R13.4, R14.1). The caller
 * owns the list of names and decides what each outcome means, which is why an
 * unknown name comes back as a result rather than a thrown error or a silent
 * fall back to the default: a scripted run that asks for a renamed scene must
 * be able to tell "the harness is stale" from "this is what the scene looks
 * like now".
 */

/** The query parameter R13.30 and the chapter 13 backend mapping both name. */
export const SCENE_QUERY_PARAMETER = 'scene';

export type SceneResolution =
	| { status: 'requested'; name: string }
	| { status: 'default'; name: string }
	| { status: 'unknown'; requested: string }
	| { status: 'empty' };

/**
 * Reads `?scene=` out of a location search string.
 *
 * An empty or whitespace value is treated as absent: `gallery.html?scene=` is
 * what a person ends up with after deleting a name from the address bar, and
 * answering that with "unknown scene ''" helps nobody. A repeated parameter
 * takes the first, which is what URLSearchParams.get does.
 */
export function readSceneParameter(search: string): string | null {
	const parameters = new URLSearchParams(search || '');
	const requested = parameters.get(SCENE_QUERY_PARAMETER);
	if (requested === null) return null;

	const trimmed = requested.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve a location search against the registry's names.
 * @param search The `location.search` string, with or without its leading '?'.
 * @param names Registry scene names, in registry order; the first is the default.
 */
export function resolveScene(search: string, names: readonly string[]): SceneResolution {
	if (names.length === 0) return { status: 'empty' };

	const requested = readSceneParameter(search);
	if (requested === null) return { status: 'default', name: names[0] };
	if (names.includes(requested)) return { status: 'requested', name: requested };

	return { status: 'unknown', requested };
}
