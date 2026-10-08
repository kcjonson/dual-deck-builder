import { pointSegmentDistanceSquared } from './Geometry';

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;

/**
 * A spatial hash over road segments, for growth's clearance checks: a square
 * grid of cells over the disc, each listing the segments whose bounding box
 * overlaps it. Segments are added as growth accepts steps and can be
 * retired (smoothing swaps a stretch's steps for its curve), never moved.
 * Storage is typed arrays that double when full, and a query fills a reused
 * buffer, so checking a step allocates nothing.
 */
export class SegmentIndex {
	private readonly cellSize: number;
	private readonly origin: number;
	private readonly columns: number;
	/** The first entry of each cell's list, -1 for none. */
	private readonly heads: Int32Array;

	private entrySegment = new Int32Array(1024);
	private entryNext = new Int32Array(1024);
	private entryCount = 0;

	/** x0, y0, x1, y1 per segment. */
	private ends = new Float64Array(4 * 256);
	private owners = new Int32Array(256);
	private live = new Uint8Array(256);
	/** The query each segment was last returned by, so one listed in several cells comes back once. */
	private stamps = new Int32Array(256);
	private segmentCount = 0;
	private stamp = 0;

	private found = new Int32Array(64);

	/** Covers the square from -`extent` to `extent` on both axes; anything outside is filed in the edge cells. */
	constructor({ extent, cellSize }: { extent: number; cellSize: number }) {
		this.cellSize = cellSize;
		this.origin = -extent;
		this.columns = Math.max(1, Math.ceil(2 * extent / cellSize));
		this.heads = new Int32Array(this.columns * this.columns).fill(-1);
	}

	/** Segments added so far, retired ones included; ids run from 0 to this. */
	public get size(): number {
		return this.segmentCount;
	}

	/** Files a segment under `owner` (a road's id) and returns its id. */
	public add(x0: number, y0: number, x1: number, y1: number, owner: number): number {
		const id = this.segmentCount;
		if (id === this.owners.length) this.growSegments();
		this.segmentCount += 1;
		this.ends[4 * id] = x0;
		this.ends[4 * id + 1] = y0;
		this.ends[4 * id + 2] = x1;
		this.ends[4 * id + 3] = y1;
		this.owners[id] = owner;
		this.live[id] = 1;
		this.stamps[id] = 0;
		const first = this.column(x0 < x1 ? x0 : x1);
		const last = this.column(x0 < x1 ? x1 : x0);
		const bottom = this.column(y0 < y1 ? y0 : y1);
		const top = this.column(y0 < y1 ? y1 : y0);
		for (let row = bottom; row <= top; row += 1) {
			for (let column = first; column <= last; column += 1) this.file(row * this.columns + column, id);
		}
		return id;
	}

	/** Takes a segment out of every later query. */
	public retire(id: number): void {
		this.live[id] = 0;
	}

	public owner(id: number): number {
		return this.owners[id];
	}

	public x0(id: number): number {
		return this.ends[4 * id];
	}

	public y0(id: number): number {
		return this.ends[4 * id + 1];
	}

	public x1(id: number): number {
		return this.ends[4 * id + 2];
	}

	public y1(id: number): number {
		return this.ends[4 * id + 3];
	}

	/**
	 * The live segments filed in cells the box overlaps, each once, into
	 * `results` (read it before the next query). Returns how many; the list
	 * holds every segment that comes within the box, and some that don't.
	 */
	public query(minX: number, minY: number, maxX: number, maxY: number): number {
		this.stamp += 1;
		const stamp = this.stamp;
		let count = 0;
		const first = this.column(minX);
		const last = this.column(maxX);
		const bottom = this.column(minY);
		const top = this.column(maxY);
		for (let row = bottom; row <= top; row += 1) {
			for (let column = first; column <= last; column += 1) {
				for (let entry = this.heads[row * this.columns + column]; entry >= 0; entry = this.entryNext[entry]) {
					const id = this.entrySegment[entry];
					if (this.stamps[id] === stamp || this.live[id] === 0) continue;
					this.stamps[id] = stamp;
					if (count === this.found.length) this.growFound();
					this.found[count] = id;
					count += 1;
				}
			}
		}
		return count;
	}

	/** The ids the last query found, valid up to the count it returned. */
	public get results(): Int32Array {
		return this.found;
	}

	/**
	 * The distance from (x, y) to the nearest live segment not owned by
	 * `skipOwner`, or `limit` when none comes nearer.
	 */
	public nearest(x: number, y: number, limit: number, skipOwner: number): number {
		const count = this.query(x - limit, y - limit, x + limit, y + limit);
		let best = limit * limit;
		for (let index = 0; index < count; index += 1) {
			const id = this.found[index];
			if (this.owners[id] === skipOwner) continue;
			const distanceSquared = pointSegmentDistanceSquared(x, y, this.ends[4 * id], this.ends[4 * id + 1], this.ends[4 * id + 2], this.ends[4 * id + 3]);
			if (distanceSquared < best) best = distanceSquared;
		}
		return sqrt(best);
	}

	private column(value: number): number {
		const column = floor((value - this.origin) / this.cellSize);
		return column < 0 ? 0 : column >= this.columns ? this.columns - 1 : column;
	}

	private file(cell: number, id: number): void {
		if (this.entryCount === this.entrySegment.length) {
			this.entrySegment = grown(this.entrySegment);
			this.entryNext = grown(this.entryNext);
		}
		const entry = this.entryCount;
		this.entryCount += 1;
		this.entrySegment[entry] = id;
		this.entryNext[entry] = this.heads[cell];
		this.heads[cell] = entry;
	}

	private growSegments(): void {
		const ends = new Float64Array(this.ends.length * 2);
		ends.set(this.ends);
		this.ends = ends;
		this.owners = grown(this.owners);
		this.stamps = grown(this.stamps);
		const live = new Uint8Array(this.live.length * 2);
		live.set(this.live);
		this.live = live;
	}

	private growFound(): void {
		this.found = grown(this.found);
	}
}

function grown(array: Int32Array): Int32Array {
	const bigger = new Int32Array(array.length * 2);
	bigger.set(array);
	return bigger;
}
