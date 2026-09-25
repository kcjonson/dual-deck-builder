import { Border, BoxShadow } from './commands';
import { ClipRect, Mat2D, Rect, Vec2, inflate, transformedBounds } from './geometry';

/**
 * Local-space ink extents for R4.2a's CPU cull, and the one conversion that
 * takes them to screen space.
 *
 * Every bound here is CONSERVATIVE: it is allowed to be larger than the ink and
 * is never allowed to be smaller. An over-large bound under-culls, which costs a
 * draw the fragment stage would have discarded anyway; an under-large bound
 * drops something the user should have seen. R4.2a's own wording ("transformed
 * bounds including shadow padding and ink extent") is why each function grows
 * rather than fits.
 *
 * Text has no function here on purpose. A run's extent needs the glyph
 * iteration of R6.8, which is chapter 6 and phase 2, so `drawText` is never
 * bounds-culled and only an `empty` clip drops it. Guessing a width from
 * `text.length * size` would be exactly the fabricated number this project's
 * phase 0 had to retract. R4.2a's scrolled-list benefit is therefore only
 * partly realised until the text PR lands.
 *
 * The one-device-pixel inflation in `screenInk` is R5.7's: the quad extends at
 * least one device pixel past the outermost SDF edge so the outer half of the
 * coverage ramp rasterises. It also covers R5.17's polygon feather ring, which
 * is the same width. It is applied after the transform because a device pixel
 * is a screen-space quantity.
 */

/** R5.7: how far a border grows the shape's footprint outward. */
function borderOutset(border: Border | null | undefined): number {
	if (!border) return 0;
	if (border.position === 'outside') return border.width;
	if (border.position === 'center') return border.width / 2;
	return 0;
}

function grow(rect: Rect, amount: number): Rect {
	return {
		x: rect.x - amount,
		y: rect.y - amount,
		width: rect.width + amount * 2,
		height: rect.height + amount * 2,
	};
}

export function rectInk(rect: Rect, border: Border | null | undefined): Rect {
	return grow(rect, borderOutset(border));
}

/**
 * R5.11: the shadow quad is the owner's rect offset by `offset`, grown by
 * `spread`, and padded by `3 * sigma` with `sigma = blur / 2`. The erf form's
 * padding (1.5 blur) is used rather than the smoothstep approximation's (1
 * blur) because it is the larger of the two and this is a cull bound.
 */
export function shadowInk(rect: Rect, shadow: BoxShadow): Rect {
	const spread = shadow.spread ?? 0;
	const blur = shadow.blur ?? 0;
	const offset = shadow.offset ?? { x: 0, y: 0 };
	const pad = Math.max(0, spread) + blur * 1.5;
	return {
		x: rect.x + offset.x - pad,
		y: rect.y + offset.y - pad,
		width: rect.width + pad * 2,
		height: rect.height + pad * 2,
	};
}

export function circleInk(center: Vec2, radius: number, border: Border | null | undefined): Rect {
	const extent = radius + borderOutset(border);
	return { x: center.x - extent, y: center.y - extent, width: extent * 2, height: extent * 2 };
}

/** Half the width on every side covers both caps of R2.10, `round` included. */
export function lineInk(from: Vec2, to: Vec2, width: number): Rect {
	const half = width / 2;
	const minX = Math.min(from.x, to.x) - half;
	const minY = Math.min(from.y, to.y) - half;
	return {
		x: minX,
		y: minY,
		width: Math.max(from.x, to.x) + half - minX,
		height: Math.max(from.y, to.y) + half - minY,
	};
}

/** The point hull grown by half a stroke width; pass 0 for a filled polygon. */
export function pointsInk(points: readonly Vec2[], width: number): Rect | null {
	if (points.length === 0) return null;

	let minX = points[0].x;
	let minY = points[0].y;
	let maxX = minX;
	let maxY = minY;
	for (let index = 1; index < points.length; index++) {
		const point = points[index];
		if (point.x < minX) minX = point.x;
		if (point.x > maxX) maxX = point.x;
		if (point.y < minY) minY = point.y;
		if (point.y > maxY) maxY = point.y;
	}

	const half = width / 2;
	return { x: minX - half, y: minY - half, width: maxX - minX + width, height: maxY - minY + width };
}

export function screenInk(local: Rect, transform: Mat2D, ratio: number): ClipRect {
	const devicePixel = ratio > 0 ? 1 / ratio : 1;
	return inflate(transformedBounds(transform, local), devicePixel);
}
