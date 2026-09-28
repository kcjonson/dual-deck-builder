/**
 * Ear clipping for R2.11, whose `drawPolygon` takes pre-tessellated triangles:
 * turning an outline into a triangle list is the caller's job, and this is the
 * tool the library hands callers for it. Pure, like `geometry.ts` (R14.1).
 *
 * A fan from the first vertex is only right when that vertex sees every other
 * one, which a concave outline (a star, an L) does not promise. Ear clipping
 * is right for any simple polygon, whatever its winding, and it is O(n^3) in
 * the worst case, which is nothing at the sizes components draw; call it when
 * the outline changes, not per frame.
 */

import type { Vec2 } from './geometry';

/**
 * Indices into `points`, three per triangle, for a simple (non-self-crossing)
 * polygon in either winding. Every triangle keeps the outline's winding.
 * Collinear vertices are dropped rather than given zero-area triangles, and a
 * polygon with no area yields no triangles.
 *
 * A self-crossing outline has no correct answer here. Once no ear is left the
 * remainder is fanned, so the call still ends and still covers the shape's
 * body, but the fill can spill where the outline crosses itself.
 */
export function triangulatePolygon(points: readonly Vec2[]): number[] {
	const count = points.length;
	if (count < 3) return [];

	const epsilon = areaTolerance(points);
	const area = signedDoubleArea(points);
	if (Math.abs(area) <= epsilon) return [];
	const winding = area > 0 ? 1 : -1;

	const ring: number[] = [];
	for (let index = 0; index < count; index++) ring.push(index);

	const triangles: number[] = [];
	let cursor = 0;
	let stepsWithoutClip = 0;

	while (ring.length > 3) {
		const length = ring.length;
		const previous = ring[(cursor + length - 1) % length];
		const current = ring[cursor];
		const next = ring[(cursor + 1) % length];
		const turn = winding * cross(points[previous], points[current], points[next]);

		if (Math.abs(turn) <= epsilon) {
			// On the line from its neighbours, so it bounds nothing.
			ring.splice(cursor, 1);
			cursor %= ring.length;
			stepsWithoutClip = 0;
			continue;
		}

		if (turn > 0 && isEar(points, ring, previous, current, next, winding, epsilon)) {
			triangles.push(previous, current, next);
			ring.splice(cursor, 1);
			cursor %= ring.length;
			stepsWithoutClip = 0;
			continue;
		}

		cursor = (cursor + 1) % length;
		stepsWithoutClip++;
		if (stepsWithoutClip >= length) {
			fanRemainder(points, ring, triangles, winding, epsilon);
			return triangles;
		}
	}

	if (winding * cross(points[ring[0]], points[ring[1]], points[ring[2]]) > epsilon) {
		triangles.push(ring[0], ring[1], ring[2]);
	}
	return triangles;
}

/** Twice the shoelace area: positive when the outline turns from +x to +y. */
function signedDoubleArea(points: readonly Vec2[]): number {
	let sum = 0;
	for (let index = 0; index < points.length; index++) {
		const from = points[index];
		const to = points[(index + 1) % points.length];
		sum += from.x * to.y - to.x * from.y;
	}
	return sum;
}

/** Twice the signed area of `a b c`; the same sense as `signedDoubleArea`. */
function cross(a: Vec2, b: Vec2, c: Vec2): number {
	return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Cross products are in squared length, so the tolerance scales with the
 * square of the outline's extent: the same shape in unit space or in pixels
 * decides collinearity the same way.
 */
function areaTolerance(points: readonly Vec2[]): number {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	const extent = Math.max(maxX - minX, maxY - minY);
	return extent * extent * 1e-10;
}

/**
 * No other vertex of the ring may sit inside the candidate triangle or on its
 * edges; one that does means the diagonal `previous next` leaves the polygon.
 * Vertices at the same position as a corner (an outline that touches itself)
 * are not counted against it.
 */
function isEar(
	points: readonly Vec2[],
	ring: readonly number[],
	previous: number,
	current: number,
	next: number,
	winding: number,
	epsilon: number,
): boolean {
	const a = points[previous];
	const b = points[current];
	const c = points[next];
	for (const index of ring) {
		if (index === previous || index === current || index === next) continue;
		const point = points[index];
		if (samePosition(point, a) || samePosition(point, b) || samePosition(point, c)) continue;
		if (
			winding * cross(a, b, point) >= -epsilon &&
			winding * cross(b, c, point) >= -epsilon &&
			winding * cross(c, a, point) >= -epsilon
		) {
			return false;
		}
	}
	return true;
}

function samePosition(a: Vec2, b: Vec2): boolean {
	return a.x === b.x && a.y === b.y;
}

function fanRemainder(
	points: readonly Vec2[],
	ring: readonly number[],
	triangles: number[],
	winding: number,
	epsilon: number,
): void {
	for (let corner = 1; corner < ring.length - 1; corner++) {
		const a = ring[0];
		const b = ring[corner];
		const c = ring[corner + 1];
		if (Math.abs(cross(points[a], points[b], points[c])) <= epsilon) continue;
		if (winding * cross(points[a], points[b], points[c]) > 0) triangles.push(a, b, c);
		else triangles.push(a, c, b);
	}
}
