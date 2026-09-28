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
	rect: Rect;
	borderWidth: number;
	/** Any radius opts out: a rounded corner relies on the coverage ramp. */
	radius?: number;
	ratio: number;
}

/**
 * R7.8: an axis-aligned rect with a hairline border. Each edge snaps
 * independently (so the size moves by at most one device pixel per axis), and
 * the border width becomes a whole number of device pixels, at least one. A
 * heavier border or any radius returns null: those rely on the SDF coverage
 * ramp and are not snapped.
 *
 * "Hairline" is a border that rounds to one logical pixel or less, which is
 * wider than R7.8's "at or below 1 logical pixel": chapter 7's own required
 * test snaps a 1.3 px border at ratio 1 to one device row, and the rule as
 * written would leave it alone. The test is the more specific statement.
 */
export function snapHairlineRect({ rect, borderWidth, radius = 0, ratio }: HairlineRectOptions): { rect: Rect; borderWidth: number } | null {
	if (Math.round(borderWidth) > 1 || radius > 0) return null;
	const left = snapToDevice(rect.x, ratio);
	const top = snapToDevice(rect.y, ratio);
	const right = snapToDevice(rect.x + rect.width, ratio);
	const bottom = snapToDevice(rect.y + rect.height, ratio);
	return {
		rect: { x: left, y: top, width: right - left, height: bottom - top },
		borderWidth: Math.max(1, Math.round(borderWidth * ratio)) / ratio,
	};
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
