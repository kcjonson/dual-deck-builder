import type { Rect, Vec2 } from '../../../engine/draw/geometry';
import { ROAD_HEADER_HEIGHT } from './CombatLayout';

/** How far above the higher of its two ends an arc rises, held under the lane header. */
const LIFT = 20;
const HEADER_CLEARANCE = 4;
/** The highest an arc rises, in the road band's space: just under the lane header. */
const CEILING = ROAD_HEADER_HEIGHT + HEADER_CLEARANCE;
const SAMPLES = 48;
/** How far a move's arc bows out of a straight line at its middle, as a share of its length, and at most. */
export const BOW = 0.2;
export const MAX_BOW = 28;

/**
 * The road's preview arcs, from one point on the road to another. `trace`
 * goes up from the first, across, and down onto the second, a cubic rising
 * over the higher end and never into the lane header: the raiders' intent
 * lines (EndTurnPreview) and a hand card's target arrows (TargetPreview)
 * run along it, the arrows with a `drop` so they come down steeply enough
 * for a head; `traceSide` comes in level onto the side of a target too
 * close under the lane header to come down onto. `traceMove` goes the
 * short way from slot to slot, bowed to the left of the way it goes, so two
 * vehicles trading slots draw two arcs rather than one line: a card's
 * moves. Traced into an arc-length table it keeps, so a frame of arcs
 * allocates nothing.
 */
export class RoadArc {
	private readonly points: Vec2[] = Array.from({ length: SAMPLES + 1 }, () => ({ x: 0, y: 0 }));
	private readonly distances = new Float64Array(SAMPLES + 1);

	/**
	 * Traces the arc from `from` to `to`, in the road band's space; returns
	 * its length. With a `drop`, the arc's last control sits at least that
	 * far above `to`, so its end comes down onto `to` rather than in from the
	 * side.
	 */
	public trace(from: Vec2, to: Vec2, drop = 0): number {
		const lift = Math.max(CEILING, Math.min(from.y, to.y) - LIFT);
		const landing = Math.max(CEILING, Math.min(lift, to.y - drop));
		return this.cubic(from, from.x, lift, to.x, landing, to);
	}

	/**
	 * Traces the arc from `from` up, across, and in level onto `to` from the
	 * side `from` is on, its last control `approach` short of `to`; returns
	 * its length. For a target too close under the lane header to come down
	 * onto (`headroom`).
	 */
	public traceSide(from: Vec2, to: Vec2, approach: number): number {
		const lift = Math.max(CEILING, Math.min(from.y, to.y) - LIFT);
		return this.cubic(from, from.x, lift, to.x - Math.sign(to.x - from.x) * approach, to.y, to);
	}

	/** Traces the cubic from `from` to `to` through the two controls between them. */
	private cubic(from: Vec2, firstX: number, firstY: number, secondX: number, secondY: number, to: Vec2): number {
		const { points, distances } = this;
		for (let step = 0; step <= SAMPLES; step++) {
			const t = step / SAMPLES;
			const u = 1 - t;
			const a = u * u * u;
			const b = 3 * u * u * t;
			const c = 3 * u * t * t;
			const d = t * t * t;
			points[step].x = a * from.x + b * firstX + c * secondX + d * to.x;
			points[step].y = a * from.y + b * firstY + c * secondY + d * to.y;
			distances[step] = step === 0 ? 0 : distances[step - 1] + Math.hypot(points[step].x - points[step - 1].x, points[step].y - points[step - 1].y);
		}
		return distances[SAMPLES];
	}

	/** Traces a move's arc from `from` to `to`, a quadratic bowed left of the way it goes; returns its length. */
	public traceMove(from: Vec2, to: Vec2): number {
		const { points, distances } = this;
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const span = Math.hypot(dx, dy);
		// A quadratic reaches half its control's offset at its middle
		const bow = span > 0 ? (2 * Math.min(MAX_BOW, span * BOW)) / span : 0;
		// Left of the way it goes, on a screen whose y runs down
		const controlX = (from.x + to.x) / 2 + dy * bow;
		const controlY = (from.y + to.y) / 2 - dx * bow;
		for (let step = 0; step <= SAMPLES; step++) {
			const t = step / SAMPLES;
			const u = 1 - t;
			points[step].x = u * u * from.x + 2 * u * t * controlX + t * t * to.x;
			points[step].y = u * u * from.y + 2 * u * t * controlY + t * t * to.y;
			distances[step] = step === 0 ? 0 : distances[step - 1] + Math.hypot(points[step].x - points[step - 1].x, points[step].y - points[step - 1].y);
		}
		return distances[SAMPLES];
	}

	/**
	 * How far along the traced arc it first leaves `box`, to the sample: 0
	 * when it starts outside, its whole length when it never leaves. Where a
	 * move's arc comes out from under the vehicle it moves.
	 */
	public leaves(box: Rect): number {
		const { points, distances } = this;
		for (let step = 0; step <= SAMPLES; step++) {
			const { x, y } = points[step];
			if (x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height) return distances[step];
		}
		return distances[SAMPLES];
	}

	/** The point `distance` along the traced arc, searching on from `segment`; returns the segment it was found in. */
	public pointAt(distance: number, segment: number, out: Vec2): number {
		const { points, distances } = this;
		let at = Math.max(1, segment);
		while (at < SAMPLES && distances[at] < distance) at++;
		const a = points[at - 1];
		const b = points[at];
		const span = distances[at] - distances[at - 1];
		const t = span > 0 ? Math.min(1, Math.max(0, (distance - distances[at - 1]) / span)) : 0;
		out.x = a.x + (b.x - a.x) * t;
		out.y = a.y + (b.y - a.y) * t;
		return at;
	}

	/**
	 * The traced arc as a line of points from `start` to `end` along it:
	 * the point at `start`, every sample between, then the point at `end`.
	 * Written into `out`, which grows only past its longest line so far;
	 * returns how many, none when `end` isn't past `start`.
	 */
	public pointsBetween(start: number, end: number, out: Vec2[]): number {
		if (end <= start) return 0;
		const { points, distances } = this;
		let count = 0;
		let segment = this.pointAt(start, 1, slotOf(out, count++));
		while (segment < SAMPLES && distances[segment] < end) {
			if (distances[segment] > start) {
				const point = slotOf(out, count++);
				point.x = points[segment].x;
				point.y = points[segment].y;
			}
			segment++;
		}
		this.pointAt(end, segment, slotOf(out, count++));
		return count;
	}
}

/** How far `y`, in the road band's space, is under the highest an arc may rise. */
export function headroom(y: number): number {
	return y - CEILING;
}

/** `out`'s point at `index`, added when the list is that short. */
function slotOf(out: Vec2[], index: number): Vec2 {
	if (index === out.length) out.push({ x: 0, y: 0 });
	return out[index];
}
