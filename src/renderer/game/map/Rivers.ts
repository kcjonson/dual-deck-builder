import { chaikin } from './Geometry';
import { GridSampler, LandGrid, cellCentre } from './LandGrid';
import { smooth01 } from './MapMath';
import { SimplexNoise } from './Noise';

/**
 * Rivers (Area Map Generation, Pipeline, 2. Water): the cells whose drainage
 * area passes the stream threshold, traced from their sources down to a
 * confluence, a lake, or where the drainage leaves, then drawn as smoothed
 * polylines that wander, most on flat ground, each point with its width.
 * The polylines are what the map draws, what a save keeps, and where the
 * water is: a point is in a river within half its width of the centreline,
 * so the picture and play agree, short of the view rounding widths to a few
 * steps.
 *
 * Everything is adds, multiplies, divides, compares, and square roots, so a
 * seed's rivers are the same to the bit in every engine. Starting values
 * throughout are provisional calls for the Map Lab, listed in
 * docs/AI_TECHNICAL_DECISIONS/water-and-biomes.md.
 */

/** How a river ends: joining a bigger one, in a lake, where the region's drainage leaves it, or at a closed basin's sink. */
export type RiverEnd = 'confluence' | 'lake' | 'edge' | 'sink';

/** One river's cells, from its source down to where it ends. */
export interface RiverChain {
	/**
	 * Cells downstream. A river leaving a lake starts on the lake's last cell,
	 * and one ending at a confluence or in a lake ends on the cell it meets.
	 */
	readonly cells: readonly number[];
	/** Where it starts: a spring, the head of the stream, or a lake. */
	readonly start: 'source' | 'lake';
	readonly end: RiverEnd;
	/** The river a confluence joins, or the lake a river ends in; -1 otherwise. */
	readonly into: number;
}

/** A river as the map keeps it: its end, and its polyline's slice of the packed points. */
export interface RiverInfo {
	readonly start: 'source' | 'lake';
	readonly end: RiverEnd;
	/** The river a confluence joins, or the lake a river ends in; -1 otherwise. */
	readonly into: number;
	/** The rain-weighted drainage area where it ends, before any confluence: how big a river it is. */
	readonly area: number;
}

/** Rivers' polylines packed end to end, the bulk of what crosses the worker boundary. */
export interface RiverLines {
	/** x, y per point. */
	readonly points: Float64Array;
	/** World units across the water, per point. */
	readonly widths: Float64Array;
	/** River i's points run from offsets[i] up to offsets[i + 1], counted in points. */
	readonly offsets: Uint32Array;
}

/**
 * Rain-weighted drainage area a cell needs to show as a stream, in cells of
 * average rain, at `riverDensity` 0 and 1: about 1% of the land square's
 * width squared at the default. Area isn't per world unit, so the land grid's
 * fixed cell size keeps it the same on any map.
 */
export const RIVER_THRESHOLD = { sparse: 700, dense: 110 } as const;

/**
 * Width across the water, world units: `min` at the threshold, growing with
 * the square root of the area past it, up to `max`. A river widens from
 * `min` over its first `rise` world units from its source.
 */
export const RIVER_WIDTH = { min: 1.2, gain: 0.75, max: 9, rise: 40 } as const;

/**
 * Turning a chain of cells into a line: a Douglas-Peucker pass at `simplify`
 * cells, which takes out the eight-direction staircase, down to `steep` of
 * it where the land's grade passes `steepGrade`, so a river in a steep
 * valley keeps to its floor rather than cutting over a spur; `smoothing`
 * passes of Chaikin's corner cutting; then points evenly every `spacing`
 * cells, so the meander has somewhere to bend a long straight run; and,
 * after the meander, one more Chaikin pass, which rounds off the corners
 * an offset of up to a couple of cells leaves between points a cell apart.
 */
const SHAPE = { simplify: 0.6, steep: 0.35, steepGrade: 0.15, smoothing: 3, spacing: 1 } as const;

/**
 * Meander: a sideways offset from noise along the river `wavelength` world
 * units long: `least` cells at any grade and any `riverMeander`, so no
 * river runs ruler-straight, plus up to `amplitude` cells at `riverMeander`
 * 1, full on ground flatter than grade `flat` and none past `steep`. It
 * tapers to nothing over `taper` world units at each end so confluences and
 * lakes stay joined, and never moves a point further than `bend` of the
 * line's radius of curvature there, so a bend can't fold over itself.
 */
const MEANDER = { least: 0.4, amplitude: 1.4, wavelength: 90, flat: 0.015, steep: 0.06, taper: 30, bend: 0.6 } as const;

// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;
const ceil = Math.ceil;

/** The stream threshold for a map's `riverDensity`. */
export function riverThreshold(riverDensity: number): number {
	return RIVER_THRESHOLD.sparse + (RIVER_THRESHOLD.dense - RIVER_THRESHOLD.sparse) * riverDensity;
}

/** Width across the water where the rain-weighted drainage area is `area`, for a stream threshold of `threshold`. */
export function riverWidth(area: number, threshold: number): number {
	const width = RIVER_WIDTH.min + RIVER_WIDTH.gain * (sqrt(area / threshold) - 1);
	return width < RIVER_WIDTH.min ? RIVER_WIDTH.min : width > RIVER_WIDTH.max ? RIVER_WIDTH.max : width;
}

export interface TraceOptions {
	/** Each cell's downstream neighbour, -1 where drainage leaves. */
	readonly receivers: Int32Array;
	/** Rain-weighted drainage area per cell. */
	readonly area: Float64Array;
	readonly threshold: number;
	/** The lake each cell lies in, -1 for none. */
	readonly lakeOf: Int32Array;
	/** Whether the cells with no receiver are a closed basin's sink rather than the edge. */
	readonly closedBasin: boolean;
}

/**
 * Every river, as chains of cells. A river cell is one whose area passes the
 * threshold and isn't under a lake. At a confluence the river carries on
 * from its biggest tributary, ties to the lower cell, and the others end
 * there; so a main river is one chain from its source to where it leaves,
 * and each tributary ends on the cell where it joins. A river that reaches a
 * lake ends on the lake's first cell, and one that leaves a lake starts on
 * its last. Chains are listed by their first cell's index.
 */
export function traceRivers({ receivers, area, threshold, lakeOf, closedBasin }: TraceOptions): RiverChain[] {
	const cells = receivers.length;
	// Each river cell's biggest river-sized donor, lake cells included.
	const mainDonor = new Int32Array(cells).fill(-1);
	for (let cell = 0; cell < cells; cell += 1) {
		if (!(area[cell] >= threshold)) continue;
		const receiver = receivers[cell];
		if (receiver < 0) continue;
		const best = mainDonor[receiver];
		if (best < 0 || area[cell] > area[best]) mainDonor[receiver] = cell;
	}
	const chainOf = new Int32Array(cells).fill(-1);
	const chains: { cells: number[]; start: 'source' | 'lake'; end: RiverEnd; into: number }[] = [];
	for (let head = 0; head < cells; head += 1) {
		if (!(area[head] >= threshold) || lakeOf[head] >= 0) continue;
		const donor = mainDonor[head];
		// Carried on from upstream: some other chain runs through it.
		if (donor >= 0 && lakeOf[donor] < 0) continue;
		const id = chains.length;
		const chain: number[] = donor >= 0 ? [donor] : [];
		let end: RiverEnd = closedBasin ? 'sink' : 'edge';
		let into = -1;
		let cell = head;
		for (;;) {
			chain.push(cell);
			chainOf[cell] = id;
			const receiver = receivers[cell];
			if (receiver < 0) break;
			if (lakeOf[receiver] >= 0) {
				chain.push(receiver);
				end = 'lake';
				into = lakeOf[receiver];
				break;
			}
			if (mainDonor[receiver] !== cell) {
				chain.push(receiver);
				end = 'confluence';
				break;
			}
			cell = receiver;
		}
		// An outlet with no river flowing into it is a single cell, not a river: nothing joins it, since any river donor would carry on through it.
		if (chain.length < 2) {
			chainOf[head] = -1;
			continue;
		}
		chains.push({ cells: chain, start: donor >= 0 ? 'lake' : 'source', end, into });
	}
	for (const chain of chains) {
		if (chain.end === 'confluence') chain.into = chainOf[chain.cells[chain.cells.length - 1]];
	}
	return chains;
}

export interface PolylineOptions {
	readonly grid: LandGrid;
	readonly chains: readonly RiverChain[];
	readonly area: Float64Array;
	readonly threshold: number;
	/** The land's elevation per cell: rivers meander where it's flat. */
	readonly elevation: Float64Array;
	/** 0 to 1: `riverMeander`. */
	readonly meander: number;
	/** The meander's noise, from the water stream. */
	readonly noise: SimplexNoise;
	/** Vertical scale: world units elevation 1 stands. */
	readonly relief: number;
}

/**
 * Each chain as a line: its cell centres simplified, less on steep ground,
 * smoothed, resampled every cell, given a meander, and smoothed once more,
 * with a width per point by the drainage area there. A tributary is drawn
 * after the river it joins and ends on that river's line, the nearest point
 * to their meeting cell, so every confluence touches.
 */
export function riverPolylines({ grid, chains, area, threshold, elevation, meander, noise, relief }: PolylineOptions): RiverLines {
	const lines: number[][] = new Array(chains.length);
	const widths: number[][] = new Array(chains.length);
	const sampler = new GridSampler({ grid, values: elevation });
	const tolerance = SHAPE.simplify * grid.cellSize;
	for (const id of drawingOrder(chains)) {
		const chain = chains[id];
		const raw: number[] = [];
		const tolerances: number[] = [];
		for (const cell of chain.cells) {
			const row = (cell / grid.size) | 0;
			const x = cellCentre(grid, cell - row * grid.size);
			const y = cellCentre(grid, row);
			raw.push(x, y);
			sampler.bicubic(x, y);
			const grade = sqrt(sampler.gradientX * sampler.gradientX + sampler.gradientY * sampler.gradientY) * relief;
			tolerances.push(tolerance * (1 - (1 - SHAPE.steep) * smooth01(grade / SHAPE.steepGrade)));
		}
		let line = simplify(raw, tolerances);
		for (let pass = 0; pass < SHAPE.smoothing; pass += 1) line = chaikin(line);
		line = resampled(line, SHAPE.spacing * grid.cellSize);
		line = chaikin(meandered({
			line, least: MEANDER.least * grid.cellSize, amount: meander * MEANDER.amplitude * grid.cellSize, noise, offset: 13.7 * id, sampler, relief,
		}));
		if (chain.end === 'confluence') snapEnd(line, lines[chain.into]);
		lines[id] = line;
		widths[id] = widthsAlong({
			line, raw, cells: chain.cells, area, threshold, joined: chain.end === 'confluence' || chain.end === 'lake', source: chain.start === 'source',
		});
	}
	const offsets = new Uint32Array(chains.length + 1);
	lines.forEach((line, id) => {
		offsets[id + 1] = offsets[id] + line.length / 2;
	});
	const points = new Float64Array(2 * offsets[chains.length]);
	const pointWidths = new Float64Array(offsets[chains.length]);
	lines.forEach((line, id) => {
		points.set(line, 2 * offsets[id]);
		pointWidths.set(widths[id], offsets[id]);
	});
	return { points, widths: pointWidths, offsets };
}

/** Chains in an order that puts each river before the tributaries that join it, otherwise by index. */
function drawingOrder(chains: readonly RiverChain[]): number[] {
	const depth = new Int32Array(chains.length).fill(-1);
	const depthOf = (id: number): number => {
		const path: number[] = [];
		let at = id;
		while (depth[at] < 0 && chains[at].end === 'confluence') {
			path.push(at);
			at = chains[at].into;
		}
		let value = depth[at] >= 0 ? depth[at] : 0;
		depth[at] = value;
		for (let index = path.length - 1; index >= 0; index -= 1) {
			value += 1;
			depth[path[index]] = value;
		}
		return depth[id];
	};
	const order = chains.map((_, id) => id);
	const depths = order.map(depthOf);
	return order.sort((a, b) => depths[a] - depths[b] || a - b);
}

/**
 * Douglas-Peucker on a flat polyline, keeping its ends: every point whose
 * removal would move the line more than its tolerance stays. The tolerance
 * is one for every point, or one per point.
 */
export function simplify(points: readonly number[], tolerance: number | readonly number[]): number[] {
	const count = points.length / 2;
	if (count < 3) return points.slice();
	const keep = new Uint8Array(count);
	keep[0] = 1;
	keep[count - 1] = 1;
	const stack = [0, count - 1];
	while (stack.length > 0) {
		const last = stack.pop() as number;
		const first = stack.pop() as number;
		const ax = points[2 * first];
		const ay = points[2 * first + 1];
		const dx = points[2 * last] - ax;
		const dy = points[2 * last + 1] - ay;
		const lengthSquared = dx * dx + dy * dy;
		let farthest = -1;
		// Each point's squared distance from the chord over its squared tolerance, times the chord's squared length.
		let most = lengthSquared > 0 ? lengthSquared : 1;
		for (let index = first + 1; index < last; index += 1) {
			const px = points[2 * index] - ax;
			const py = points[2 * index + 1] - ay;
			const allowed = typeof tolerance === 'number' ? tolerance : tolerance[index];
			const cross = dx * py - dy * px;
			const away = (lengthSquared > 0 ? cross * cross : px * px + py * py) / (allowed * allowed);
			if (away > most) {
				most = away;
				farthest = index;
			}
		}
		if (farthest > 0) {
			keep[farthest] = 1;
			stack.push(first, farthest, farthest, last);
		}
	}
	const simplified: number[] = [];
	for (let index = 0; index < count; index += 1) {
		if (keep[index] === 1) simplified.push(points[2 * index], points[2 * index + 1]);
	}
	return simplified;
}

/**
 * The line's points evenly along it, `spacing` world units apart or a little
 * less, its ends kept: even spacing gives every point neighbours the same
 * distance away, which the meander's normals and its room to bend read.
 */
export function resampled(line: readonly number[], spacing: number): number[] {
	const count = line.length / 2;
	if (count < 2) return line.slice();
	const along = lengthsAlong(line);
	const length = along[count - 1];
	const steps = ceil(length / spacing);
	if (!(steps > 1)) return [line[0], line[1], line[line.length - 2], line[line.length - 1]];
	const out: number[] = [line[0], line[1]];
	let segment = 1;
	for (let step = 1; step < steps; step += 1) {
		const target = length * (step / steps);
		while (along[segment] < target) segment += 1;
		const start = along[segment - 1];
		const t = (target - start) / (along[segment] - start);
		out.push(line[2 * segment - 2] + (line[2 * segment] - line[2 * segment - 2]) * t, line[2 * segment - 1] + (line[2 * segment + 1] - line[2 * segment - 1]) * t);
	}
	out.push(line[line.length - 2], line[line.length - 1]);
	return out;
}

/**
 * The line moved sideways by noise along its length: by up to `least` world
 * units anywhere, plus up to `amount` where the land is flat, tapering to
 * nothing at both ends and held within `MEANDER.bend` of the line's radius
 * of curvature. Each river reads its own row of the noise, `offset` across.
 */
function meandered({ line, least, amount, noise, offset, sampler, relief }: {
	line: number[]; least: number; amount: number; noise: SimplexNoise; offset: number; sampler: GridSampler; relief: number;
}): number[] {
	const count = line.length / 2;
	if (count < 3) return line;
	const along = lengthsAlong(line);
	const length = along[count - 1];
	// Room to move at each point: the least, over the line, of a point's radius of curvature plus how far along the line it is,
	// so the room shrinks steadily toward a tight bend rather than only at it, and neighbours can't cross there.
	const room = new Float64Array(count).fill(Infinity);
	for (let index = 1; index < count - 1; index += 1) {
		const inX = line[2 * index] - line[2 * index - 2];
		const inY = line[2 * index + 1] - line[2 * index - 1];
		const outX = line[2 * index + 2] - line[2 * index];
		const outY = line[2 * index + 3] - line[2 * index + 1];
		const turn = inX * outY - inY * outX;
		const product = sqrt((inX * inX + inY * inY) * (outX * outX + outY * outY));
		const sine = product > 0 ? (turn < 0 ? -turn : turn) / product : 0;
		if (sine > 0) room[index] = 0.5 * (along[index + 1] - along[index - 1]) / sine;
	}
	for (let index = 1; index < count; index += 1) {
		const eased = room[index - 1] + (along[index] - along[index - 1]);
		if (eased < room[index]) room[index] = eased;
	}
	for (let index = count - 2; index >= 0; index -= 1) {
		const eased = room[index + 1] + (along[index + 1] - along[index]);
		if (eased < room[index]) room[index] = eased;
	}
	const out = line.slice();
	const span = MEANDER.steep - MEANDER.flat;
	for (let index = 1; index < count - 1; index += 1) {
		const fromEnd = along[index] < length - along[index] ? along[index] : length - along[index];
		const taper = smooth01(fromEnd / MEANDER.taper);
		if (taper <= 0) continue;
		const x = line[2 * index];
		const y = line[2 * index + 1];
		let reach = least;
		if (amount > 0) {
			sampler.bicubic(x, y);
			const grade = sqrt(sampler.gradientX * sampler.gradientX + sampler.gradientY * sampler.gradientY) * relief;
			reach += amount * (1 - smooth01((grade - MEANDER.flat) / span));
		}
		const cap = MEANDER.bend * room[index];
		let shift = reach * taper * noise.fractal(along[index] / MEANDER.wavelength, offset, 2, 0.5);
		if (shift > cap) shift = cap;
		else if (shift < -cap) shift = -cap;
		// Square to the chord across the point, from its neighbour behind to its neighbour ahead.
		const tx = line[2 * index + 2] - line[2 * index - 2];
		const ty = line[2 * index + 3] - line[2 * index - 1];
		const norm = sqrt(tx * tx + ty * ty);
		if (!(norm > 0)) continue;
		out[2 * index] = x - (ty / norm) * shift;
		out[2 * index + 1] = y + (tx / norm) * shift;
	}
	return out;
}

/** Moves the line's last point onto `target`, the nearest point of it to where it was. */
function snapEnd(line: number[], target: readonly number[] | undefined): void {
	if (!target || target.length < 4) return;
	const px = line[line.length - 2];
	const py = line[line.length - 1];
	let bestX = target[0];
	let bestY = target[1];
	let best = Infinity;
	for (let index = 0; index + 3 < target.length; index += 2) {
		const ax = target[index];
		const ay = target[index + 1];
		const dx = target[index + 2] - ax;
		const dy = target[index + 3] - ay;
		const lengthSquared = dx * dx + dy * dy;
		let t = lengthSquared > 0 ? ((px - ax) * dx + (py - ay) * dy) / lengthSquared : 0;
		t = t < 0 ? 0 : t > 1 ? 1 : t;
		const x = ax + dx * t;
		const y = ay + dy * t;
		const squared = (x - px) * (x - px) + (y - py) * (y - py);
		if (squared < best) {
			best = squared;
			bestX = x;
			bestY = y;
		}
	}
	line[line.length - 2] = bestX;
	line[line.length - 1] = bestY;
}

/**
 * A width per point of the line, from the drainage area of the chain's cell
 * the same share of the way along, measured by length along each. A river
 * that joins another or a lake ends on a cell of that, so it takes its own
 * last cell's area there instead.
 */
function widthsAlong({ line, raw, cells, area, threshold, joined, source }: {
	line: readonly number[]; raw: readonly number[]; cells: readonly number[]; area: Float64Array; threshold: number; joined: boolean; source: boolean;
}): number[] {
	const count = line.length / 2;
	const last = joined && cells.length > 1 ? cells.length - 2 : cells.length - 1;
	const lineAlong = lengthsAlong(line);
	const rawAlong = lengthsAlong(raw);
	const lineLength = lineAlong[count - 1];
	const rawLength = rawAlong[rawAlong.length - 1];
	const widths: number[] = [];
	let at = 0;
	for (let index = 0; index < count; index += 1) {
		const target = lineLength > 0 ? (lineAlong[index] / lineLength) * rawLength : 0;
		// The cell whose stretch of the raw chain holds the same share: walk on while the next cell's centre is nearer.
		while (at < last && rawAlong[at + 1] - target < target - rawAlong[at]) at += 1;
		const width = riverWidth(area[cells[at]], threshold);
		// A stream rising where many small flows meet, on flat ground, starts already broad; it widens from a creek instead.
		const rise = source ? smooth01(lineAlong[index] / RIVER_WIDTH.rise) : 1;
		widths.push(RIVER_WIDTH.min + (width - RIVER_WIDTH.min) * rise);
	}
	return widths;
}

/** The length along a flat polyline to each of its points, from 0 at the first. */
function lengthsAlong(line: readonly number[]): Float64Array {
	const count = line.length / 2;
	const along = new Float64Array(count);
	for (let index = 1; index < count; index += 1) {
		const dx = line[2 * index] - line[2 * index - 2];
		const dy = line[2 * index + 1] - line[2 * index - 1];
		along[index] = along[index - 1] + sqrt(dx * dx + dy * dy);
	}
	return along;
}

/** A river crossing a move: how far along the move, how wide the water is there, and how square-on the move crosses it. */
export interface RiverCrossing {
	/** 0 to 1 along the move. */
	along: number;
	/** World units across the water. */
	width: number;
	/** The sine of the angle between the move and the river, 1 square-on. */
	sine: number;
}

/**
 * Where the rivers' water is: their segments filed in square buckets over
 * the land, each listing the segments whose water reaches into it. A point
 * is in a river within half the river's width there of its centreline,
 * the width running straight between a segment's ends. Queries allocate
 * nothing and read the packed lines as they are.
 */
export class RiverIndex {
	private readonly points: Float64Array;
	private readonly widths: Float64Array;
	private readonly bucket: number;
	private readonly origin: number;
	private readonly columns: number;
	/** Bucket b's segments are ids[starts[b]] up to ids[starts[b + 1]]; a segment's id is its first point's index. */
	private readonly starts: Uint32Array;
	private readonly ids: Uint32Array;
	/** The query each segment was last looked at by, so one filed in several buckets counts once. */
	private readonly stamps: Uint32Array;
	private stamp = 0;
	private readonly found: RiverCrossing[] = [];
	private foundCount = 0;

	constructor({ lines, extent, bucket }: { lines: RiverLines; extent: number; bucket: number }) {
		this.points = lines.points;
		this.widths = lines.widths;
		this.bucket = bucket;
		this.origin = -extent;
		this.columns = Math.max(1, Math.ceil((2 * extent) / bucket));
		const { starts, ids } = this.file(lines);
		this.starts = starts;
		this.ids = ids;
		this.stamps = new Uint32Array(lines.points.length / 2);
	}

	/** True within half a river's width of its centreline. */
	public contains(x: number, y: number): boolean {
		const at = this.cellOf(y) * this.columns + this.cellOf(x);
		const { points, widths, ids } = this;
		for (let entry = this.starts[at]; entry < this.starts[at + 1]; entry += 1) {
			const point = ids[entry];
			const ax = points[2 * point];
			const ay = points[2 * point + 1];
			const dx = points[2 * point + 2] - ax;
			const dy = points[2 * point + 3] - ay;
			const lengthSquared = dx * dx + dy * dy;
			let t = lengthSquared > 0 ? ((x - ax) * dx + (y - ay) * dy) / lengthSquared : 0;
			t = t < 0 ? 0 : t > 1 ? 1 : t;
			const ox = ax + dx * t - x;
			const oy = ay + dy * t - y;
			const half = 0.5 * (widths[point] + (widths[point + 1] - widths[point]) * t);
			if (ox * ox + oy * oy < half * half) return true;
		}
		return false;
	}

	/**
	 * True within `reach` of a river's water: within half the river's width
	 * there plus `reach` of its centreline. Exact: the water nearest the point
	 * lies in a bucket within `reach` of it, and its segment is filed there.
	 */
	public near(x: number, y: number, reach: number): boolean {
		this.stamp += 1;
		const stamp = this.stamp;
		const { points, widths, ids, stamps } = this;
		const first = this.cellOf(x - reach);
		const last = this.cellOf(x + reach);
		const bottom = this.cellOf(y - reach);
		const top = this.cellOf(y + reach);
		for (let row = bottom; row <= top; row += 1) {
			for (let column = first; column <= last; column += 1) {
				const at = row * this.columns + column;
				for (let entry = this.starts[at]; entry < this.starts[at + 1]; entry += 1) {
					const point = ids[entry];
					if (stamps[point] === stamp) continue;
					stamps[point] = stamp;
					const ax = points[2 * point];
					const ay = points[2 * point + 1];
					const dx = points[2 * point + 2] - ax;
					const dy = points[2 * point + 3] - ay;
					const lengthSquared = dx * dx + dy * dy;
					let t = lengthSquared > 0 ? ((x - ax) * dx + (y - ay) * dy) / lengthSquared : 0;
					t = t < 0 ? 0 : t > 1 ? 1 : t;
					const ox = ax + dx * t - x;
					const oy = ay + dy * t - y;
					const within = 0.5 * (widths[point] + (widths[point + 1] - widths[point]) * t) + reach;
					if (ox * ox + oy * oy < within * within) return true;
				}
			}
		}
		return false;
	}

	/**
	 * How many river centrelines the move from (x0, y0) to (x1, y1) crosses;
	 * `crossing(index)` reads each until the next call. A move that only
	 * touches a centreline, or runs along one, crosses nothing.
	 */
	public crossings(x0: number, y0: number, x1: number, y1: number): number {
		this.foundCount = 0;
		const mx = x1 - x0;
		const my = y1 - y0;
		const moveSquared = mx * mx + my * my;
		if (!(moveSquared > 0)) return 0;
		this.stamp += 1;
		const stamp = this.stamp;
		const { points, widths, ids, stamps } = this;
		const first = this.cellOf(x0 < x1 ? x0 : x1);
		const last = this.cellOf(x0 < x1 ? x1 : x0);
		const bottom = this.cellOf(y0 < y1 ? y0 : y1);
		const top = this.cellOf(y0 < y1 ? y1 : y0);
		for (let row = bottom; row <= top; row += 1) {
			for (let column = first; column <= last; column += 1) {
				const at = row * this.columns + column;
				for (let entry = this.starts[at]; entry < this.starts[at + 1]; entry += 1) {
					const point = ids[entry];
					if (stamps[point] === stamp) continue;
					stamps[point] = stamp;
					const ax = points[2 * point];
					const ay = points[2 * point + 1];
					const sx = points[2 * point + 2] - ax;
					const sy = points[2 * point + 3] - ay;
					// Which side of the river each end of the move is on, and of the move each end of the river.
					const startSide = sx * (y0 - ay) - sy * (x0 - ax);
					const endSide = sx * (y1 - ay) - sy * (x1 - ax);
					if (!((startSide > 0 && endSide < 0) || (startSide < 0 && endSide > 0))) continue;
					const fromSide = mx * (ay - y0) - my * (ax - x0);
					const toSide = mx * (ay + sy - y0) - my * (ax + sx - x0);
					if (!((fromSide > 0 && toSide < 0) || (fromSide < 0 && toSide > 0))) continue;
					const along = fromSide / (fromSide - toSide);
					const cross = mx * sy - my * sx;
					this.record(
						startSide / (startSide - endSide),
						widths[point] + (widths[point + 1] - widths[point]) * along,
						(cross < 0 ? -cross : cross) / sqrt(moveSquared * (sx * sx + sy * sy)),
					);
				}
			}
		}
		return this.foundCount;
	}

	/** The `index`th crossing the last `crossings` call found; shared, so read it before the next call. */
	public crossing(index: number): RiverCrossing {
		return this.found[index];
	}

	private record(along: number, width: number, sine: number): void {
		if (this.foundCount === this.found.length) this.found.push({ along: 0, width: 0, sine: 0 });
		const crossing = this.found[this.foundCount];
		crossing.along = along;
		crossing.width = width;
		crossing.sine = sine;
		this.foundCount += 1;
	}

	/** Every segment filed in each bucket its water reaches: a count, then the filing. */
	private file({ points, widths, offsets }: RiverLines): { starts: Uint32Array; ids: Uint32Array } {
		const buckets = this.columns * this.columns;
		const starts = new Uint32Array(buckets + 1);
		let ids = new Uint32Array(0);
		let cursor = new Uint32Array(0);
		const rivers = offsets.length - 1;
		for (let pass = 0; pass < 2; pass += 1) {
			for (let river = 0; river < rivers; river += 1) {
				for (let point = offsets[river]; point + 1 < offsets[river + 1]; point += 1) {
					const reach = 0.5 * (widths[point] > widths[point + 1] ? widths[point] : widths[point + 1]);
					const x0 = points[2 * point];
					const y0 = points[2 * point + 1];
					const x1 = points[2 * point + 2];
					const y1 = points[2 * point + 3];
					const first = this.cellOf((x0 < x1 ? x0 : x1) - reach);
					const last = this.cellOf((x0 < x1 ? x1 : x0) + reach);
					const bottom = this.cellOf((y0 < y1 ? y0 : y1) - reach);
					const top = this.cellOf((y0 < y1 ? y1 : y0) + reach);
					for (let row = bottom; row <= top; row += 1) {
						for (let column = first; column <= last; column += 1) {
							const at = row * this.columns + column;
							if (pass === 0) starts[at + 1] += 1;
							else ids[cursor[at]++] = point;
						}
					}
				}
			}
			if (pass === 0) {
				for (let at = 0; at < buckets; at += 1) starts[at + 1] += starts[at];
				ids = new Uint32Array(starts[buckets]);
				cursor = starts.slice(0, buckets);
			}
		}
		return { starts, ids };
	}

	/** The bucket column holding x, or row holding y, held to the buckets. */
	private cellOf(value: number): number {
		const cell = floor((value - this.origin) / this.bucket);
		return !(cell >= 0) ? 0 : cell >= this.columns ? this.columns - 1 : cell;
	}
}
