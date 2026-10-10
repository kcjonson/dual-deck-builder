import type { Vec2 } from '../../../engine/draw';
import { pointSegmentDistanceSquared } from '../../map/Geometry';
import type { RoadNetwork } from '../../map/RoadNetwork';
import { stretchesAt } from './layers';

/**
 * The drivable network's geometry as the view draws it, built once per map:
 * each stretch's polyline in map space (world y flipped, see `MapCamera`)
 * with its bounds, coarser copies of it for zoomed-out frames,
 * and the junctions. Plus the arithmetic the view needs per frame or per
 * press: which detail level a zoom wants, dashes along a stub, and how near
 * a point is to a polyline.
 */

/** The bounds of a polyline in map space. */
export interface MapBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface StretchGeometry {
	/** Map space, from the stretch's inner end outward. */
	readonly points: readonly Vec2[];
	readonly bounds: MapBounds;
}

export interface JunctionGeometry {
	/** Map space. */
	readonly at: Vec2;
	/** The stretches that meet there. */
	readonly stretches: readonly number[];
}

/**
 * Screen pixels a simplified polyline may stray from the full one. Under
 * half a pixel the two draw alike.
 */
export const DETAIL_PIXELS = 0.4;
/** World units the first detail level may stray; each level after doubles it. */
export const FIRST_DETAIL_TOLERANCE = 0.25;
export const DETAIL_LEVELS = 7;

export class RoadGeometry {
	public readonly stretches: readonly StretchGeometry[];
	public readonly junctions: readonly JunctionGeometry[];
	/** Per level, per stretch: the simplified polyline, filled the first time a frame asks. */
	private readonly levels: (Vec2[] | undefined)[][];

	constructor({ network }: { network: RoadNetwork }) {
		this.stretches = network.stretches.map((stretch) => {
			const points = toMapSpace(stretch.points);
			return { points, bounds: boundsOf(points) };
		});
		const meeting = stretchesAt(network);
		this.junctions = network.nodes.flatMap((node, id) => (node.kind === 'junction' && meeting[id].length > 0 ? [{ at: { x: node.x, y: 0 - node.y }, stretches: meeting[id] }] : []));
		this.levels = Array.from({ length: DETAIL_LEVELS }, () => new Array<Vec2[] | undefined>(this.stretches.length));
	}

	/** Stretch `id`'s polyline at `level`, or whole at -1. */
	public polyline(id: number, level: number): readonly Vec2[] {
		const full = this.stretches[id].points;
		if (level < 0) return full;
		const cache = this.levels[level];
		let simplified = cache[id];
		if (simplified === undefined) {
			simplified = simplifyPolyline(full, FIRST_DETAIL_TOLERANCE * 2 ** level);
			cache[id] = simplified;
		}
		return simplified;
	}
}

/**
 * The coarsest detail level whose tolerance stays under `DETAIL_PIXELS` on
 * screen at `zoom` (pixels per world unit), or -1 for the full polylines.
 */
export function detailLevel(zoom: number): number {
	if (!(zoom > 0)) return -1;
	const tolerance = DETAIL_PIXELS / zoom;
	if (tolerance < FIRST_DETAIL_TOLERANCE) return -1;
	return Math.min(DETAIL_LEVELS - 1, Math.floor(Math.log2(tolerance / FIRST_DETAIL_TOLERANCE)));
}

/** Flat world x, y pairs to map-space points. */
export function toMapSpace(flat: readonly number[]): Vec2[] {
	const points: Vec2[] = [];
	for (let index = 0; index + 1 < flat.length; index += 2) points.push({ x: flat[index], y: 0 - flat[index + 1] });
	return points;
}

export function boundsOf(points: readonly Vec2[]): MapBounds {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const { x, y } of points) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}
	return { minX, minY, maxX, maxY };
}

export function lengthOf(points: readonly Vec2[]): number {
	let length = 0;
	for (let index = 1; index < points.length; index++) {
		length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
	}
	return length;
}

/**
 * Douglas-Peucker: the fewest of `points` that keep every dropped point
 * within `tolerance` of the line kept, both ends always kept.
 */
export function simplifyPolyline(points: readonly Vec2[], tolerance: number): Vec2[] {
	if (points.length <= 2) return [...points];
	const keep = new Uint8Array(points.length);
	keep[0] = 1;
	keep[points.length - 1] = 1;
	const toleranceSquared = tolerance * tolerance;
	const spans: number[] = [0, points.length - 1];
	while (spans.length > 0) {
		const last = spans.pop() as number;
		const first = spans.pop() as number;
		let farthest = -1;
		let farthestSquared = toleranceSquared;
		for (let index = first + 1; index < last; index++) {
			const point = points[index];
			const squared = pointSegmentDistanceSquared(point.x, point.y, points[first].x, points[first].y, points[last].x, points[last].y);
			if (squared > farthestSquared) {
				farthestSquared = squared;
				farthest = index;
			}
		}
		if (farthest < 0) continue;
		keep[farthest] = 1;
		spans.push(first, farthest, farthest, last);
	}
	return points.filter((_point, index) => keep[index] === 1);
}

/** The first `length` world units of `points`, cut mid-segment where it ends. */
export function truncatePolyline(points: readonly Vec2[], length: number): Vec2[] {
	const kept: Vec2[] = points.length > 0 ? [points[0]] : [];
	let travelled = 0;
	for (let index = 1; index < points.length; index++) {
		const from = points[index - 1];
		const to = points[index];
		const segment = Math.hypot(to.x - from.x, to.y - from.y);
		if (travelled + segment >= length) {
			const t = segment > 0 ? (length - travelled) / segment : 0;
			kept.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
			return kept;
		}
		kept.push(to);
		travelled += segment;
	}
	return kept;
}

/** One dash: its points in map space and how far along the stub it starts, 0 to 1. */
export interface Dash {
	readonly points: Vec2[];
	readonly along: number;
}

/**
 * Dashes along the first `length` world units of `points`: `dash` units
 * drawn, `gap` units skipped, from the start. A dash that turns a corner
 * keeps the corner. The phase is carried as what's left of the current dash
 * or gap rather than read back from the distance, so float error can't end
 * a dash early.
 */
export function dashesAlong(points: readonly Vec2[], length: number, dash: number, gap: number): Dash[] {
	if (!(dash > 0) || !(length > 0) || points.length < 2) return [];
	const space = Math.max(0, gap);
	const dashes: Dash[] = [];
	let drawing = true;
	let left = dash;
	let current: Vec2[] | null = null;
	let currentStart = 0;
	let travelled = 0;
	for (let index = 1; index < points.length && travelled < length; index++) {
		const from = points[index - 1];
		const to = points[index];
		const segment = Math.hypot(to.x - from.x, to.y - from.y);
		if (segment <= 0) continue;
		const end = Math.min(segment, length - travelled);
		const at = (along: number): Vec2 => ({ x: from.x + (to.x - from.x) * (along / segment), y: from.y + (to.y - from.y) * (along / segment) });
		let position = 0;
		while (position < end) {
			const step = Math.min(left, end - position);
			if (drawing) {
				if (current === null) {
					current = [at(position)];
					currentStart = travelled + position;
				}
				// A dash still open at the segment's end carries on round the corner.
				current.push(at(position + step));
			}
			position += step;
			left -= step;
			if (left > 0) continue;
			if (current !== null) {
				dashes.push({ points: current, along: currentStart / length });
				current = null;
			}
			drawing = !drawing || space === 0;
			left = drawing ? dash : space;
		}
		travelled += end;
	}
	if (current !== null) dashes.push({ points: current, along: currentStart / length });
	return dashes;
}

/**
 * The distance from (x, y) to `points`, all in map space, counting only the
 * polyline's first `within` world units.
 */
export function distanceToPolyline(points: readonly Vec2[], x: number, y: number, within = Infinity): number {
	let best = Infinity;
	let travelled = 0;
	for (let index = 1; index < points.length && travelled < within; index++) {
		const from = points[index - 1];
		let to = points[index];
		const segment = Math.hypot(to.x - from.x, to.y - from.y);
		if (travelled + segment > within && segment > 0) {
			const t = (within - travelled) / segment;
			to = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
		}
		const squared = pointSegmentDistanceSquared(x, y, from.x, from.y, to.x, to.y);
		if (squared < best) best = squared;
		travelled += segment;
	}
	return Math.sqrt(best);
}
