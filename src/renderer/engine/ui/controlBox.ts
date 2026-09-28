import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import type { Look } from '../style/look';
import { tokens } from '../theme/tokens';

const CLEAR: RGBA = [0, 0, 0, 0];

/**
 * A field-like control's box from its resolved look (R11.12): the fill,
 * border, and style shadow, then layer 6's focus ring outside it when the
 * look has one. TextInput and Select share it.
 */
export function drawControlBox(draw: DrawApi, { id, width, height, look }: { id?: string; width: number; height: number; look: Look }): void {
	const radius = look.radius > 0 ? look.radius : undefined;
	draw.drawRect({
		id,
		rect: { x: 0, y: 0, width, height },
		fill: look.fill,
		radius,
		border: look.borderWidth > 0 ? { color: look.border, width: look.borderWidth } : undefined,
		shadow: look.shadow ?? undefined,
	});
	if (!look.focusRing) return;
	const offset = tokens.control.focus_ring_offset;
	draw.drawRect({
		rect: { x: -offset, y: -offset, width: width + offset * 2, height: height + offset * 2 },
		fill: CLEAR,
		radius: radius !== undefined ? radius + offset : undefined,
		border: { color: look.focusRing, width: tokens.control.focus_ring_width, position: 'outside' },
	});
}
