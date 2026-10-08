import type { Rect, Vec2 } from '../../engine/draw/geometry';

/**
 * Geometry the battle screen draws as one bare triangle list rather than
 * many rects: the mock's 135 degree hatching (the road's shoulders, a damage
 * ghost) and dashed outlines (a legal target). Built when the shape changes
 * and replayed as a single `drawPolygon` each frame.
 */

export interface HatchOptions {
	/** From one stripe's start to the next, measured along `x + y`. */
	period: number;
	/** A stripe's width along `x + y`; a stripe `w` px across is `w * SQRT2`. */
	stripe: number;
}

/**
 * The mock's 135 degree hatch over a rect: bands of `x + y` a stripe wide,
 * one period apart, each clipped to the rect and fanned into triangles, as
 * one bare triangle list.
 */
export function hatchTriangles(rect: Rect, { period, stripe }: HatchOptions): Vec2[] {
	const corners: Vec2[] = [
		{ x: rect.x, y: rect.y },
		{ x: rect.x + rect.width, y: rect.y },
		{ x: rect.x + rect.width, y: rect.y + rect.height },
		{ x: rect.x, y: rect.y + rect.height },
	];
	const start = rect.x + rect.y;
	const end = rect.x + rect.width + rect.y + rect.height;
	const triangles: Vec2[] = [];
	for (let low = start + period - stripe; low < end; low += period) {
		const band = clipBand(corners, low, low + stripe);
		for (let index = 1; index + 1 < band.length; index++) {
			triangles.push(band[0], band[index], band[index + 1]);
		}
	}
	return triangles;
}

/** A convex polygon cut to `low <= x + y <= high`. */
function clipBand(polygon: readonly Vec2[], low: number, high: number): Vec2[] {
	return clipHalf(clipHalf(polygon, (point) => point.x + point.y - low), (point) => high - point.x - point.y);
}

/** Sutherland-Hodgman against one half-plane, kept where `side` is at least 0. */
function clipHalf(polygon: readonly Vec2[], side: (point: Vec2) => number): Vec2[] {
	const kept: Vec2[] = [];
	for (let index = 0; index < polygon.length; index++) {
		const current = polygon[index];
		const next = polygon[(index + 1) % polygon.length];
		const a = side(current);
		const b = side(next);
		if (a >= 0) kept.push(current);
		if ((a >= 0) !== (b >= 0)) {
			const t = a / (a - b);
			kept.push({ x: current.x + (next.x - current.x) * t, y: current.y + (next.y - current.y) * t });
		}
	}
	return kept;
}

export interface DashOptions {
	/** The line's thickness, inside the rect. */
	width: number;
	dash: number;
	gap: number;
	/**
	 * Left clear at each corner of a rounded frame, so no dash's square end
	 * pokes past the curve: the dashes run along the straight sides only.
	 * Zero, the default, dashes the top and bottom edges corner to corner.
	 */
	corner?: number;
}

/**
 * A dashed outline just inside `rect`, `width` thick, as a bare triangle
 * list written into `out` (cleared first): the top and bottom edges dashed
 * along x from the corners, the sides along y between them.
 */
export function dashedOutlineTriangles(rect: Rect, { width, dash, gap, corner = 0 }: DashOptions, out: Vec2[]): Vec2[] {
	out.length = 0;
	const right = rect.x + rect.width;
	const bottom = rect.y + rect.height;
	const quad = (x: number, y: number, w: number, h: number): void => {
		out.push({ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y }, { x: x + w, y: y + h }, { x, y: y + h });
	};
	for (let x = rect.x + corner; x < right - corner; x += dash + gap) {
		const length = Math.min(dash, right - corner - x);
		quad(x, rect.y, length, width);
		quad(x, bottom - width, length, width);
	}
	const top = rect.y + Math.max(corner, width + gap);
	const end = bottom - Math.max(corner, width);
	for (let y = top; y < end; y += dash + gap) {
		const length = Math.min(dash, end - y);
		quad(rect.x, y, width, length);
		quad(right - width, y, width, length);
	}
	return out;
}
