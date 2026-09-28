import type { TextAlign, TextDecoration, VerticalAlign } from '../draw/commands';
import type { Rect, Vec2 } from '../draw/geometry';
import type { TextLayout } from './TextLayout';

/** Where a laid-out run goes: R2.13's anchor or box, and its alignment. */
export interface TextPlacement {
	readonly position?: Vec2 | null;
	readonly box?: Rect | null;
	readonly align?: TextAlign;
	readonly verticalAlign?: VerticalAlign;
}

/** A line's pen origin: the start of its first glyph, on its baseline. Logical pixels, local space. */
export interface LineOrigin {
	x: number;
	y: number;
}

const ALIGN_FRACTION: Record<TextAlign, number> = { left: 0, center: 0.5, right: 1 };

/**
 * The origin of `layout.lines[line]` for `placement`, into `out`.
 *
 * Horizontal (R6.15): each line is aligned on its own width, against the box
 * when there is one and against `position.x` when there is not.
 *
 * Vertical, with a box: `top` puts the first line box's top on the box top
 * and `bottom` the last line box's bottom on the box bottom, a line box being
 * `lineHeight` tall with the face's ascent and descent centred in it (the
 * half-leading split); `middle` centres the block from the first line's ascent
 * to the last line's descent, the face's metrics and never the glyphs' bounds,
 * which is R6.11's guarantee: a line with no descenders sits on the same
 * baseline as one with them. `baseline` in a box is `top`.
 *
 * R6.11 says the centring is on the ascent alone. That puts every centred
 * label low in these faces, whose ascenders leave room for accents above the
 * caps: Open Sans's 1.069 em ascender centres 16 px caps 2.9 px low in a
 * 30 px field, where the ascent plus descent box (CSS's content area) leaves
 * them 0.5 px low. The descender-independence the rule exists for holds
 * either way; see docs/AI_TECHNICAL_DECISIONS/text-metrics-service.md.
 *
 * Vertical, without a box, `position.y` is a zero-height box: `baseline` (the
 * default, R2.13) is the first baseline itself, and the other three put the
 * same edge on it that they put on a box's edge, `middle` centring on it.
 */
export function lineOrigin(layout: TextLayout, placement: TextPlacement, line: number, out: LineOrigin): LineOrigin {
	const { lineHeight, ascent, descent } = layout;
	const count = layout.lines.length;
	const halfLeading = (lineHeight - ascent - descent) / 2;
	const box = placement.box ?? null;
	const align = ALIGN_FRACTION[placement.align ?? 'left'];
	const verticalAlign = placement.verticalAlign ?? (box ? 'top' : 'baseline');

	const top = box ? box.y : placement.position?.y ?? 0;
	const height = box ? box.height : 0;
	let firstBaseline: number;
	switch (verticalAlign) {
		case 'middle':
			firstBaseline = top + (height - ((count - 1) * lineHeight + ascent + descent)) / 2 + ascent;
			break;
		case 'bottom':
			firstBaseline = top + height - halfLeading - descent - (count - 1) * lineHeight;
			break;
		case 'baseline':
			firstBaseline = box ? top + halfLeading + ascent : top;
			break;
		default:
			firstBaseline = top + halfLeading + ascent;
	}

	const anchorX = box ? box.x + box.width * align : placement.position?.x ?? 0;
	out.x = anchorX - layout.lines[line].width * align;
	out.y = firstBaseline + line * lineHeight;
	return out;
}

/** R12.4's decoration: one logical pixel thick. */
export const DECORATION_THICKNESS = 1;

/**
 * Where a line's decoration line is centred, as an offset from its baseline,
 * y down: the face's underline position, or half the x-height above the
 * baseline for a strike. Null for no decoration.
 */
export function decorationOffset(layout: TextLayout, decoration: TextDecoration | undefined): number | null {
	const { atlas, size } = layout;
	if (decoration === 'underline') return (atlas.metrics.underlineY ?? 0.1) * size;
	if (decoration === 'strike') {
		const xHeight = -(atlas.glyph(0x78)?.plane?.top ?? -0.5);
		return (-xHeight / 2) * size;
	}
	return null;
}

/**
 * The union of every glyph quad and decoration the run draws, in local space
 * before snapping, or null when it draws nothing. R4.2a's cull grows it by a
 * device pixel, which covers R6.16's snap of at most half of one.
 */
export function layoutInk(layout: TextLayout, placement: TextPlacement, decoration?: TextDecoration): Rect | null {
	const origin: LineOrigin = { x: 0, y: 0 };
	const size = layout.size;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const decorationY = decorationOffset(layout, decoration);
	for (let line = 0; line < layout.lines.length; line++) {
		lineOrigin(layout, placement, line, origin);
		const width = layout.lines[line].width;
		if (decorationY !== null && width > 0) {
			minX = Math.min(minX, origin.x);
			maxX = Math.max(maxX, origin.x + width);
			minY = Math.min(minY, origin.y + decorationY - DECORATION_THICKNESS / 2);
			maxY = Math.max(maxY, origin.y + decorationY + DECORATION_THICKNESS / 2);
		}
		for (const { glyph, x } of layout.lines[line].glyphs) {
			const plane = glyph.plane;
			if (!plane) continue;
			minX = Math.min(minX, origin.x + x + plane.left * size);
			maxX = Math.max(maxX, origin.x + x + plane.right * size);
			minY = Math.min(minY, origin.y + plane.top * size);
			maxY = Math.max(maxY, origin.y + plane.bottom * size);
		}
	}
	if (minX === Infinity) return null;
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
