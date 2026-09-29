import type { BoxShadow } from '../draw/commands';
import type { RGBA } from '../draw/geometry';
import { resolveShadow } from '../style/styleObject';

/** A token colour as the mutable tuple a Text style and `setColor` take. */
export function rgba(color: RGBA): [number, number, number, number] {
	return [color[0], color[1], color[2], color[3]];
}

/** R11.5's elevations as draw shadows: raised surfaces (a toast, a tooltip) and popped ones (a dialog, a popover). */
export const SHADOW_RAISED: BoxShadow = resolveShadow('shadow_raised');
export const SHADOW_POP: BoxShadow = resolveShadow('shadow_pop');

/** A rect's fill defaults to white, so a border-only or shadow-only draw says clear. */
export const CLEAR: RGBA = [0, 0, 0, 0];
