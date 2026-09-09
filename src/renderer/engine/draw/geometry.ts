/**
 * The plain-data geometry vocabulary the draw API and its commands are built
 * from. Imports nothing, touches no GL and no DOM (R14.1).
 *
 * Two rectangle shapes exist on purpose and neither is a rename of the other.
 * `Rect` is `{x, y, width, height}` because that is how a caller describes a
 * thing to draw. `ClipRect` is `{minX, minY, maxX, maxY}` because R4.1 states
 * that form for the per-draw clip, and the intersection of R4.3 is three lines
 * in that form and a subtraction lattice in the other.
 *
 * `Mat2D` is the six-element affine matrix in the order DOMMatrix uses, so
 * `x' = a*x + c*y + e` and `y' = b*x + d*y + f`. A 3x3 with a constant bottom
 * row would carry three numbers per draw that are always 0, 0, 1, and the
 * instanced backend of R2.4 wants exactly a 2x3.
 */

export interface Vec2 {
	x: number;
	y: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** R4.1's form: screen space, logical pixels. */
export interface ClipRect {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Straight (non-premultiplied) RGBA in [0, 1], per the chapter 0 conventions. */
export type RGBA = readonly [number, number, number, number];

/** `[a, b, c, d, e, f]`; see the module comment for the convention. */
export type Mat2D = readonly [number, number, number, number, number, number];

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

export function translation(dx: number, dy: number): Mat2D {
	return [1, 0, 0, 1, dx, dy];
}

/** `outer` applied after `inner`, which is what pushing a child transform means. */
export function concat(outer: Mat2D, inner: Mat2D): Mat2D {
	return [
		outer[0] * inner[0] + outer[2] * inner[1],
		outer[1] * inner[0] + outer[3] * inner[1],
		outer[0] * inner[2] + outer[2] * inner[3],
		outer[1] * inner[2] + outer[3] * inner[3],
		outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
		outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
	];
}

export function transformPoint(matrix: Mat2D, x: number, y: number): Vec2 {
	return {
		x: matrix[0] * x + matrix[2] * y + matrix[4],
		y: matrix[1] * x + matrix[3] * y + matrix[5],
	};
}

/**
 * R2.4's translate-only test, run on the *concatenated* matrix rather than on
 * the one being pushed. A scale under its own inverse is translate-only again
 * and gets the cheap snapping path back; propagating a flag down the stack
 * instead would keep it false for the rest of the scope and fire R4.7's
 * under-clipping warning on a clip that converts exactly.
 */
export function isTranslateOnly(matrix: Mat2D): boolean {
	return matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === 1;
}

/**
 * The axis-aligned bounds of `rect` transformed by `matrix`. Exact under
 * translate-only transforms; under rotation or non-uniform scale this is
 * R4.7's first option, the documented approximation that under-clips.
 */
export function transformedBounds(matrix: Mat2D, rect: Rect): ClipRect {
	if (isTranslateOnly(matrix)) {
		return {
			minX: rect.x + matrix[4],
			minY: rect.y + matrix[5],
			maxX: rect.x + rect.width + matrix[4],
			maxY: rect.y + rect.height + matrix[5],
		};
	}
	const right = rect.x + rect.width;
	const bottom = rect.y + rect.height;
	const a = transformPoint(matrix, rect.x, rect.y);
	const b = transformPoint(matrix, right, rect.y);
	const c = transformPoint(matrix, right, bottom);
	const d = transformPoint(matrix, rect.x, bottom);
	return {
		minX: Math.min(a.x, b.x, c.x, d.x),
		minY: Math.min(a.y, b.y, c.y, d.y),
		maxX: Math.max(a.x, b.x, c.x, d.x),
		maxY: Math.max(a.y, b.y, c.y, d.y),
	};
}

/** Grown by `amount` on every side. Used for the conservative cull bounds of R4.2a. */
export function inflate(rect: ClipRect, amount: number): ClipRect {
	return {
		minX: rect.minX - amount,
		minY: rect.minY - amount,
		maxX: rect.maxX + amount,
		maxY: rect.maxY + amount,
	};
}

/**
 * Half-open, matching R4.4's fragment test: rects that merely touch share no
 * fragment, so they do not intersect and the cull may drop the draw.
 */
export function intersects(a: ClipRect, b: ClipRect): boolean {
	return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

export function copyRect(rect: Rect): Rect {
	return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

export function copyVec2(point: Vec2): Vec2 {
	return { x: point.x, y: point.y };
}

/**
 * Colours arrive as tuples the caller may reuse. A command outlives its call
 * (chapter 3 sorts it, the recording backend keeps it), so every value one
 * carries is copied out of the caller's memory at submission; a shared array
 * mutated on the next frame would rewrite a recording of the last one.
 */
export function copyColor(color: RGBA): RGBA {
	return [color[0], color[1], color[2], color[3]];
}
