import type { Vec2 } from '../../../engine/draw';
import type { RiverLines } from '../../map/Rivers';
import { RIVER_STYLE } from './areaMapStyle';
import { DETAIL_LEVELS, FIRST_DETAIL_TOLERANCE, MapBounds, boundsOf, simplifyPolyline } from './roadGeometry';

/**
 * The rivers as the view draws them, built once per map: each river cut into
 * runs of one width, its widths rounded to `RIVER_STYLE.widthStep`, so a
 * river widens downstream in a few steps, each run a polyline in map space
 * (world y flipped, see `MapCamera`) with its bounds and coarser copies for
 * zoomed-out frames. Runs are cut at the disc's rim too, so the stretches
 * past it can draw fainter.
 */

export interface RiverRun {
	/** Map space, downstream. */
	readonly points: readonly Vec2[];
	readonly bounds: MapBounds;
	/** World units across. */
	readonly width: number;
	/** Inside the disc, or past its rim. */
	readonly inside: boolean;
}

export class RiverGeometry {
	public readonly runs: readonly RiverRun[];
	/** Per level, per run: the simplified polyline, filled the first time a frame asks. */
	private readonly levels: (Vec2[] | undefined)[][];

	constructor({ rivers, radius }: { rivers: RiverLines; radius: number }) {
		this.runs = riverRuns(rivers, radius);
		this.levels = Array.from({ length: DETAIL_LEVELS }, () => new Array<Vec2[] | undefined>(this.runs.length));
	}

	/** Run `id`'s polyline at `level`, or whole at -1. */
	public polyline(id: number, level: number): readonly Vec2[] {
		const full = this.runs[id].points;
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
 * Every river's runs: a new run wherever its rounded width changes, or it
 * crosses the rim, where the run ends on the rim and the next starts there,
 * so the runs join up.
 */
function riverRuns({ points, widths, offsets }: RiverLines, radius: number): RiverRun[] {
	const runs: RiverRun[] = [];
	const radiusSquared = radius * radius;
	const step = RIVER_STYLE.widthStep;
	const rounded = (width: number) => Math.max(step, Math.round(width / step) * step);
	for (let river = 0; river + 1 < offsets.length; river++) {
		const first = offsets[river];
		const last = offsets[river + 1] - 1;
		if (last <= first) continue;
		let run: Vec2[] = [{ x: points[2 * first], y: -points[2 * first + 1] }];
		let width = rounded(widths[first]);
		let inside = points[2 * first] ** 2 + points[2 * first + 1] ** 2 <= radiusSquared;
		const finish = () => {
			if (run.length > 1) runs.push({ points: run, bounds: boundsOf(run), width, inside });
		};
		for (let point = first + 1; point <= last; point++) {
			const ax = points[2 * point - 2];
			const ay = points[2 * point - 1];
			const bx = points[2 * point];
			const by = points[2 * point + 1];
			const nowInside = bx * bx + by * by <= radiusSquared;
			if (nowInside !== inside) {
				const rim = rimCrossing(ax, ay, bx, by, radius);
				run.push(rim);
				finish();
				run = [rim];
				inside = nowInside;
			}
			run.push({ x: bx, y: -by });
			const next = rounded(widths[point]);
			if (next !== width && point < last) {
				finish();
				run = [{ x: bx, y: -by }];
				width = next;
			}
		}
		finish();
	}
	return runs;
}

/** Where the segment from (ax, ay) to (bx, by), one end each side of the rim, crosses it, in map space. */
function rimCrossing(ax: number, ay: number, bx: number, by: number, radius: number): Vec2 {
	const dx = bx - ax;
	const dy = by - ay;
	const a = dx * dx + dy * dy;
	const b = 2 * (ax * dx + ay * dy);
	const c = ax * ax + ay * ay - radius * radius;
	const root = Math.sqrt(Math.max(0, b * b - 4 * a * c));
	const near = (-b - root) / (2 * a);
	const t = near >= 0 && near <= 1 ? near : (-b + root) / (2 * a);
	return { x: ax + dx * t, y: -(ay + dy * t) };
}
