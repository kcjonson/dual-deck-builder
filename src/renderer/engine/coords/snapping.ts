import type { BorderPosition } from '../draw/commands';
import type { ClipRect, Rect } from '../draw/geometry';

/**
 * Pixel snapping (chapter 7, 7.3): the arithmetic, in one place, with `ratio`
 * (R7.2) as its only device input. Positions stay fractional through layout
 * (R7.10); these run at submission, and only under translate-only transforms
 * (R7.9), which the caller checks because only it knows the transform.
 *
 * At ratio 1 `snapToDevice` is exactly `Math.round`: `x * 1` and `r / 1` are
 * exact in floating point.
 */

/** A logical coordinate moved to the nearest device-pixel boundary. */
export function snapToDevice(value: number, ratio: number): number {
	return Math.round(value * ratio) / ratio;
}

/**
 * R7.7's text run origin, which chapter 6's encoder snaps once per line
 * (R6.16) and moves every glyph on the line by the same delta. Written into
 * `out` so the encoder's per-line call allocates nothing.
 */
export function snapTextOrigin(
	x: number,
	y: number,
	ratio: number,
	out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
	out.x = snapToDevice(x, ratio);
	out.y = snapToDevice(y, ratio);
	return out;
}

export interface HairlineRectOptions {
	/** Screen space: the caller has already applied the translation. */
	rect: Rect;
	/** Zero for a borderless rect, which snaps its edges and keeps no border. */
	borderWidth: number;
	/** R5.7's position; `center` straddles the edge and snaps on a shifted grid. */
	position?: BorderPosition;
	/** Any radius opts out: a rounded corner relies on the coverage ramp. */
	radius?: number;
	ratio: number;
}

export interface SnappedHairlineRect {
	rect: Rect;
	borderWidth: number;
}

/**
 * R7.8: an axis-aligned rect with a hairline border, or none. Each edge snaps
 * independently (so the size moves by at most one device pixel per axis), and
 * the border width becomes a whole number of device pixels, at least one. A
 * heavier border or any radius returns null: those rely on the SDF coverage
 * ramp and are not snapped.
 *
 * What lands on the device grid is the border's outer edge, so its inner edge
 * does too. For `inside` and `outside` that is the rect's own edge, the snapped
 * width being whole device pixels. A `center` border straddles the edge by
 * half its width, so the edge is snapped on a grid shifted by that half: a
 * 1 px center border at ratio 1 puts the rect's edge on a half pixel and the
 * border on one whole row, where snapping the edge itself would leave it
 * across two half-covered ones.
 *
 * A borderless rect is in (its border is at or below one logical pixel), which
 * is how R7.8a's shared edges get snapped: two rects that abut at a fractional
 * x both round that x the same way, whoever draws them. A rect narrower than a
 * device pixel keeps the one device pixel its centre is in rather than
 * rounding to nothing, so a thin divider does not vanish at some offsets; for
 * a `center` border that pixel is on the same shifted grid, so the border
 * still lands on whole pixels.
 *
 * "Hairline" is a border that rounds to one logical pixel or less, which is
 * wider than R7.8's "at or below 1 logical pixel": chapter 7's own required
 * test snaps a 1.3 px border at ratio 1 to one device row, and the rule as
 * written would leave it alone. The test is the more specific statement.
 *
 * Written into `out` so the encoder's per-rect call allocates nothing.
 */
export function snapHairlineRect(
	{ rect, borderWidth, position = 'inside', radius = 0, ratio }: HairlineRectOptions,
	out: SnappedHairlineRect = { rect: { x: 0, y: 0, width: 0, height: 0 }, borderWidth: 0 },
): SnappedHairlineRect | null {
	if (Math.round(borderWidth) > 1 || radius > 0) return null;
	const width = borderWidth > 0 ? Math.max(1, Math.round(borderWidth * ratio)) / ratio : 0;
	const shift = position === 'center' ? width / 2 : 0;
	snapSpan(rect.x, rect.width, shift, ratio, out.rect, 'x');
	snapSpan(rect.y, rect.height, shift, ratio, out.rect, 'y');
	out.borderWidth = width;
	return out;
}

/** One axis of `snapHairlineRect`, into `out[axis]` and the matching extent. */
function snapSpan(start: number, extent: number, shift: number, ratio: number, out: Rect, axis: 'x' | 'y'): void {
	let low = snapToDevice(start - shift, ratio) + shift;
	let high = snapToDevice(start + extent + shift, ratio) - shift;
	if (high <= low && extent > 0) {
		low = Math.floor((start + extent / 2 - shift) * ratio) / ratio + shift;
		high = low + 1 / ratio;
	}
	out[axis] = low;
	if (axis === 'x') out.width = high - low;
	else out.height = high - low;
}

/** R7.8a: a container's clip, and the shared edges of abutting rects, on the device grid. */
export function snapClipRect(clip: ClipRect, ratio: number): ClipRect {
	return {
		minX: snapToDevice(clip.minX, ratio),
		minY: snapToDevice(clip.minY, ratio),
		maxX: snapToDevice(clip.maxX, ratio),
		maxY: snapToDevice(clip.maxY, ratio),
	};
}
