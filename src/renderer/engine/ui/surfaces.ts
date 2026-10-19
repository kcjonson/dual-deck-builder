import type { BoxShadow } from '../draw/commands';
import type { RGBA, Rect } from '../draw/geometry';
import { resolveShadow } from '../style/styleObject';
import type { Theme } from '../theme/tokens';

/** A token colour as the mutable tuple a Text style and `color` take. */
export function rgba(color: RGBA): [number, number, number, number] {
	return [color[0], color[1], color[2], color[3]];
}

/** R11.5's elevations as draw shadows: raised surfaces (a toast, a tooltip) and popped ones (a dialog, a popover). */
export const SHADOW_RAISED: BoxShadow = resolveShadow('shadow_raised');
export const SHADOW_POP: BoxShadow = resolveShadow('shadow_pop');

type SurfaceShadow = 'shadow_raised' | 'shadow_pop';
const themedShadows = new Map<Theme, Record<SurfaceShadow, BoxShadow>>();

/** A surface's elevation in `theme`, resolved once per theme so a render never allocates one. */
export function themedShadow(name: SurfaceShadow, theme: Theme): BoxShadow {
	let shadows = themedShadows.get(theme);
	if (!shadows) {
		shadows = { shadow_raised: resolveShadow('shadow_raised', theme), shadow_pop: resolveShadow('shadow_pop', theme) };
		themedShadows.set(theme, shadows);
	}
	return shadows[name];
}

/** A rect's fill defaults to white, so a border-only or shadow-only draw says clear. */
export const CLEAR: RGBA = [0, 0, 0, 0];

/**
 * A floating surface's clip, for when placement shrinks it and it clips
 * (R12.22, R12.33): the box inset by its border, so content cut at the edge
 * stops at the border's inner edge rather than painting over it. Its corner
 * is `borderClipRadius`, concentric with the background's (R4.14), as
 * Panel's is.
 */
export function borderClipRect(width: number, height: number, borderWidth: number): Rect {
	const inset = Math.min(borderWidth, width / 2, height / 2);
	return { x: inset, y: inset, width: width - inset * 2, height: height - inset * 2 };
}

/** The background's corner radius less the clip's inset: the border's inner arc. */
export function borderClipRadius(radius: number, clip: Rect): number {
	return Math.max(radius - clip.x, 0);
}
