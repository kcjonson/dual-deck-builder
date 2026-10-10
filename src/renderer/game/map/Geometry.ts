import { clamp01 } from './MapMath';

/**
 * Plane geometry for the area map's roads. Everything here is adds,
 * multiplies, divides, square roots, and comparisons, which IEEE 754 and
 * ECMAScript round exactly, so a result is the same to the bit in every JS
 * engine and generation can branch on it. Nothing calls `Math.sin`, `cos`,
 * `atan2`, or `hypot`, which engines only approximate: angles become unit
 * vectors through `unitVector`, a polynomial, and are compared by their
 * cosines.
 */

export interface Vector {
	x: number;
	y: number;
}

const RADIANS_PER_DEGREE = Math.PI / 180;
// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const round = Math.round;
const sqrt = Math.sqrt;

/**
 * The unit vector at `degrees` counterclockwise from east (+x), into `out`.
 * The angle is reduced to within 45 degrees of a quarter turn, which is
 * exact, and its sine and cosine are Taylor series out to the x^17 and x^16
 * terms, under 1e-16 from the true values there.
 */
export function unitVector(degrees: number, out: Vector): Vector {
	const quarter = round(degrees / 90);
	const radians = (degrees - quarter * 90) * RADIANS_PER_DEGREE;
	const squared = radians * radians;
	const sin = radians * (1 - squared / 6 * (1 - squared / 20 * (1 - squared / 42 * (1 - squared / 72
		* (1 - squared / 110 * (1 - squared / 156 * (1 - squared / 210 * (1 - squared / 272))))))));
	const cos = 1 - squared / 2 * (1 - squared / 12 * (1 - squared / 30 * (1 - squared / 56
		* (1 - squared / 90 * (1 - squared / 132 * (1 - squared / 182 * (1 - squared / 240)))))));
	switch (((quarter % 4) + 4) % 4) {
		case 0:
			out.x = cos;
			out.y = sin;
			break;
		case 1:
			out.x = -sin;
			out.y = cos;
			break;
		case 2:
			out.x = -cos;
			out.y = -sin;
			break;
		default:
			out.x = sin;
			out.y = -cos;
	}
	return out;
}

/** The squared distance from (px, py) to the segment from (ax, ay) to (bx, by). */
export function pointSegmentDistanceSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax;
	const dy = by - ay;
	const lengthSquared = dx * dx + dy * dy;
	let t = 0;
	if (lengthSquared > 0) {
		t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
		if (t < 0) t = 0;
		else if (t > 1) t = 1;
	}
	const ex = ax + dx * t - px;
	const ey = ay + dy * t - py;
	return ex * ex + ey * ey;
}

/**
 * The squared distance between the segments AB and CD, zero where they touch
 * or cross: the closest points' parameters on each (Ericson, Real-Time
 * Collision Detection 5.1.9), clamped to the segments, parallel ones included.
 */
export function segmentDistanceSquared(
	ax: number, ay: number, bx: number, by: number,
	cx: number, cy: number, dx: number, dy: number,
): number {
	const firstX = bx - ax;
	const firstY = by - ay;
	const secondX = dx - cx;
	const secondY = dy - cy;
	const offsetX = ax - cx;
	const offsetY = ay - cy;
	const first = firstX * firstX + firstY * firstY;
	const second = secondX * secondX + secondY * secondY;
	const along = secondX * offsetX + secondY * offsetY;
	let s = 0;
	let t = 0;
	if (first === 0 && second === 0) return offsetX * offsetX + offsetY * offsetY;
	if (first === 0) {
		t = clamp01(along / second);
	} else {
		const back = firstX * offsetX + firstY * offsetY;
		if (second === 0) {
			s = clamp01(-back / first);
		} else {
			const cross = firstX * secondX + firstY * secondY;
			const denominator = first * second - cross * cross;
			// Parallel segments have no single closest pair: start from A and let the clamps below settle it.
			s = denominator > 0 ? clamp01((cross * along - back * second) / denominator) : 0;
			t = (cross * s + along) / second;
			if (t < 0) {
				t = 0;
				s = clamp01(-back / first);
			} else if (t > 1) {
				t = 1;
				s = clamp01((cross - back) / first);
			}
		}
	}
	const gapX = offsetX + firstX * s - secondX * t;
	const gapY = offsetY + firstY * s - secondY * t;
	return gapX * gapX + gapY * gapY;
}

/**
 * Whether the segments AB and CD share a point, crossing or touching, by the
 * signs of the four orientations: exact for crossings well clear of
 * collinear, where rounding can't flip a sign, which is all a road check
 * needs to tell a crossing from a near miss.
 */
export function segmentsMeet(
	ax: number, ay: number, bx: number, by: number,
	cx: number, cy: number, dx: number, dy: number,
): boolean {
	const a = orientation(cx, cy, dx, dy, ax, ay);
	const b = orientation(cx, cy, dx, dy, bx, by);
	const c = orientation(ax, ay, bx, by, cx, cy);
	const d = orientation(ax, ay, bx, by, dx, dy);
	if (((a > 0 && b < 0) || (a < 0 && b > 0)) && ((c > 0 && d < 0) || (c < 0 && d > 0))) return true;
	return (a === 0 && within(cx, cy, dx, dy, ax, ay)) || (b === 0 && within(cx, cy, dx, dy, bx, by))
		|| (c === 0 && within(ax, ay, bx, by, cx, cy)) || (d === 0 && within(ax, ay, bx, by, dx, dy));
}

/** Twice the signed area of the triangle (a, b, p): positive when p is left of a to b. */
function orientation(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
	return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/** Whether p, already on the line through a and b, lies between them. */
function within(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
	return px >= (ax < bx ? ax : bx) && px <= (ax < bx ? bx : ax) && py >= (ay < by ? ay : by) && py <= (ay < by ? by : ay);
}

/**
 * Chaikin's corner cutting on an open polyline, flat as x0, y0, x1, y1, ...:
 * each segment's inner quarter points replace its corners, and the two ends
 * stay put, so the first and last segments keep their directions. A
 * polyline of one segment comes back as it is. Returns a new array.
 */
export function chaikin(points: readonly number[]): number[] {
	const count = points.length / 2;
	if (count < 3) return points.slice();
	const smoothed: number[] = [points[0], points[1]];
	for (let index = 0; index < count - 1; index += 1) {
		const ax = points[2 * index];
		const ay = points[2 * index + 1];
		const bx = points[2 * index + 2];
		const by = points[2 * index + 3];
		if (index > 0) smoothed.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by);
		if (index < count - 2) smoothed.push(0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
	}
	smoothed.push(points[2 * count - 2], points[2 * count - 1]);
	return smoothed;
}

/** A polyline's length: the sum of its segments'. */
export function polylineLength(points: readonly number[]): number {
	let length = 0;
	for (let index = 0; index + 3 < points.length; index += 2) {
		const dx = points[index + 2] - points[index];
		const dy = points[index + 3] - points[index + 1];
		length += sqrt(dx * dx + dy * dy);
	}
	return length;
}

/** The point `distance` along a polyline from its start, into `out`; its end past its length. */
export function pointAlong(points: readonly number[], distance: number, out: { x: number; y: number }): { x: number; y: number } {
	let travelled = 0;
	for (let index = 0; index + 3 < points.length; index += 2) {
		const dx = points[index + 2] - points[index];
		const dy = points[index + 3] - points[index + 1];
		const segment = sqrt(dx * dx + dy * dy);
		if (travelled + segment >= distance && segment > 0) {
			const share = (distance - travelled) / segment;
			out.x = points[index] + dx * share;
			out.y = points[index + 1] + dy * share;
			return out;
		}
		travelled += segment;
	}
	out.x = points[points.length - 2];
	out.y = points[points.length - 1];
	return out;
}
