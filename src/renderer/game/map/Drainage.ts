/**
 * Drainage on the land grid (Area Map Generation, Pipeline, 1. Terrain, and
 * 2. Water): which way every cell drains, and how much drains through it.
 *
 * Every cell drains to the neighbour it falls to most steeply per unit of
 * distance on the water levels, a diagonal's drop counted at 1 over the
 * square root of 2, ties to the lower index. A cell's level is its height,
 * or FLOOD_RISE above its lowest neighbour's level where that's higher, and
 * an outlet's is its height: a priority flood's levels (Barnes et al. 2014),
 * so a pit or a flat fills to its spill and drains out over it, outward from
 * it, and water runs downhill everywhere on the levels. Those levels are the
 * one solution of that rule, so however they're found they come out the
 * same to the bit.
 *
 * Routing finds them in time linear in the grid where the land drains
 * freely, after Braun and Willett (2013), and floods only where water
 * stands:
 *
 * - Local receivers: one scan in index order finds each cell's steepest
 *   fall on the heights. A cell with no neighbour a flood rise below it is
 *   a root, a pit unless it's an outlet.
 * - Basins: each cell's root, found by walking its local receivers. The
 *   outlets' basins are one, the ocean, and every cell in it stands at its
 *   height, since each falls a flood rise or more to a cell that does.
 * - Spills: neighbouring cells in two basins make a pass at the higher of
 *   the two. A pit's spill is the lowest, over every way to the ocean, of
 *   the highest pass on the way: a widest-path Dijkstra over the basins.
 * - The flood: over each pit's cells under its limit, its spill and a band,
 *   from the cells round them, which stand at their heights and offer
 *   nothing over a candidate's limit. A heap holds the cells reached at their
 *   own heights and a FIFO those reached under water, one rise above the
 *   level just settled, so its levels never fall, and cells leave the two in
 *   level order.
 * - The check: every level settles under its limit, so nothing left out
 *   could have lowered it, and the cells round the flood keep their heights
 *   only if no level beside them now raises one. Only a lake too wide for
 *   the band fails, and then the flood runs again over the pits' whole
 *   basins, which hold all the water there is, leaving nothing out.
 * - Receivers: the local ones, except in and beside the flood, where it's
 *   the steepest fall on the levels. A cell standing at its height whose
 *   local receiver does too drains to that same neighbour on the levels.
 * - Order: each cell's chain of receivers walked down to a cell already
 *   listed, then listed bottom up, so every cell comes after the one it
 *   drains to.
 *
 * Everything is adds, multiplies, divides, compares, and integer ops on
 * typed arrays, so a grid routes the same in every engine. The result is
 * plain data.
 */

/** A grid's drainage: plain typed arrays, indexed by cell (`row * size + column`). */
export interface Drainage {
	/** Cells along each side of the square grid. */
	readonly size: number;
	/** The neighbour each cell drains to, one of its eight, or -1 at an outlet. */
	readonly receivers: Int32Array;
	/**
	 * The level water reaches in each cell: its elevation, or more in a pit or
	 * on a flat, where it stands until it spills. Always above its receiver's.
	 */
	readonly levels: Float64Array;
	/** Drainage area: the rain of every cell that drains through each, its own included; one per cell unless rain was given. */
	readonly area: Float64Array;
	/** Every cell, each after the cell it drains to: downstream first. Walk it backwards to go upstream first. */
	readonly order: Int32Array;
	/** The cells where drainage leaves, each its own receiver's -1. */
	readonly outlets: Int32Array;
}

/**
 * How far above its lowest neighbour's level a flooded cell's level stands,
 * at the least, so a filled pit or flat drains outward from where it spills
 * rather than in index order. Heights a step apart by less than this are
 * flooded as though level.
 */
export const FLOOD_RISE = 1e-7;

/**
 * How far above its spill the flood looks for a pit's water. A lake's level
 * rises FLOOD_RISE a cell from where it spills, so this covers lakes a
 * thousand cells across; the check catches any wider, and the flood then
 * covers the pits' whole basins.
 */
const LAKE_BAND = 1000 * FLOOD_RISE;

/** Column and row steps to the eight neighbours, east first, counterclockwise: the odd steps are the diagonals. */
const STEP_COLUMNS = [1, 1, 0, -1, -1, -1, 0, 1];
const STEP_ROWS = [0, 1, 1, 1, 0, -1, -1, -1];
/** A diagonal neighbour is this much nearer per unit of drop than a straight one: 1 over the square root of 2, exactly rounded. */
const INVERSE_ROOT_TWO = Math.SQRT1_2;

/** A local receiver: an outlet's, and a pit's. */
const OUTLET = -1;
const PIT = -2;
/** The ocean's basin: the outlets'. */
const OCEAN = 0;
/**
 * Marks on a cell while routing: a candidate for the flood, beside one, a
 * candidate whose level is settled, and beside a candidate whose height isn't
 * a number, whose level, unlike every other's, is not at least its height, so
 * the cells beside it may fall to it on the levels though not on the heights.
 */
const CANDIDATE = 1;
const BESIDE = 2;
const SETTLED = 4;
const BESIDE_UNKNOWN = 8;

/**
 * Routes drainage on a grid of one size, over and over, allocating only to
 * grow its basin lists: erosion routes once an iteration. `receivers`,
 * `levels`, `order`, and `area` are its own and change with each call.
 */
export class DrainageRouter {
	public readonly size: number;
	public readonly receivers: Int32Array;
	public readonly levels: Float64Array;
	public readonly order: Int32Array;
	public readonly area: Float64Array;
	/** Each cell's steepest fall on the heights: a neighbour, OUTLET, or PIT. */
	private readonly local: Int32Array;
	/** Each cell's basin: OCEAN, or 1 up for the pits in the order the scan found them. */
	private readonly basin: Int32Array;
	/** A chain of receivers being walked. */
	private readonly chain: Int32Array;
	/** CANDIDATE, BESIDE, and SETTLED while routing; all clear between calls. */
	private readonly mark: Uint8Array;
	private readonly candidates: Int32Array;
	private readonly beside: Int32Array;
	/** The pits as the scan finds them; then the flood's FIFO. */
	private readonly queue: Int32Array;
	/** The lowest level offered each candidate so far. */
	private readonly offered: Float64Array;
	/** Index steps to the eight neighbours of a cell off the edge, in the order of STEP_COLUMNS. */
	private readonly offsets: Int32Array;
	/** A binary min-heap of cells, keyed by level, then by index; basins share it when spills are found. */
	private heapCells = new Int32Array(1024);
	private heapKeys = new Float64Array(1024);
	/**
	 * Per basin: its spill, the height its candidates stay under, where its
	 * passes start in the pass lists, whether it's done, and its last
	 * neighbour and that pass.
	 */
	private spill = new Float64Array(0);
	private limit = new Float64Array(0);
	private passStart = new Int32Array(0);
	private done = new Uint8Array(0);
	private partner = new Int32Array(0);
	private partnerPass = new Int32Array(0);
	/** Passes between pits, and between a pit and the ocean: the two basins and the height, then the same by basin. */
	private passLow = new Int32Array(0);
	private passHigh = new Int32Array(0);
	private passHeight = new Float64Array(0);
	private passTo = new Int32Array(0);
	private passToHeight = new Float64Array(0);
	private pits = 0;
	private passCount = 0;
	private candidateCount = 0;
	private besideCount = 0;

	constructor({ size }: { size: number }) {
		if (!Number.isInteger(size) || size < 1) throw new RangeError(`DrainageRouter: size must be a positive integer, got ${size}`);
		const cells = size * size;
		this.size = size;
		this.receivers = new Int32Array(cells);
		this.levels = new Float64Array(cells);
		this.order = new Int32Array(cells);
		this.area = new Float64Array(cells);
		this.local = new Int32Array(cells);
		this.basin = new Int32Array(cells);
		this.chain = new Int32Array(cells);
		this.mark = new Uint8Array(cells);
		this.candidates = new Int32Array(cells);
		this.beside = new Int32Array(cells);
		this.queue = new Int32Array(cells);
		this.offered = new Float64Array(cells);
		this.offsets = Int32Array.from(STEP_COLUMNS, (column, step) => column + STEP_ROWS[step] * size);
	}

	/** Fills `receivers`, `levels`, and `order` for `elevation`, draining to `outlets`. */
	public route(elevation: ArrayLike<number>, outlets: ArrayLike<number>): void {
		const cells = this.size * this.size;
		if (elevation.length !== cells) throw new RangeError(`DrainageRouter: expected ${cells} elevations, got ${elevation.length}`);
		if (outlets.length === 0) throw new RangeError('DrainageRouter: drainage needs at least one outlet');
		const basin = this.basin;
		basin.fill(-1);
		for (let index = 0; index < outlets.length; index += 1) {
			const outlet = outlets[index];
			if (!(outlet >= 0 && outlet < cells && Number.isInteger(outlet))) throw new RangeError(`DrainageRouter: outlet ${outlet} is not a cell`);
			if (basin[outlet] === OCEAN) throw new RangeError(`DrainageRouter: outlet ${outlet} is listed twice`);
			basin[outlet] = OCEAN;
		}
		this.levels.set(elevation);
		this.scanLocal(elevation);
		// An outlet drains nowhere, though a neighbour may lie below it.
		for (let index = 0; index < outlets.length; index += 1) this.local[outlets[index]] = OUTLET;
		this.findBasins();
		this.findPasses(elevation);
		this.findSpills();
		this.findCandidates(elevation, LAKE_BAND);
		if (!this.flood(elevation)) {
			this.clearFlood(elevation);
			this.findCandidates(elevation, Infinity);
			if (!this.flood(elevation)) throw new Error('DrainageRouter: the levels round the flood over every pit did not hold');
		}
		this.receivers.set(this.local);
		this.drainFlood(elevation);
		this.clearMarks();
		this.writeOrder();
	}

	/** Fills `area` from the last routing: each cell's rain (1 when none is given) plus everything upstream of it. */
	public accumulate(rain?: ArrayLike<number>): void {
		accumulateInto({ area: this.area, receivers: this.receivers, levels: this.levels, order: this.order, rain, caller: 'DrainageRouter.accumulate' });
	}

	/** Local receivers, by one scan in index order; the pits go in `queue`. Outlets are the caller's to set. */
	private scanLocal(elevation: ArrayLike<number>): void {
		const { size, local, basin, queue } = this;
		const last = size - 1;
		let pits = 0;
		for (let row = 0; row < size; row += 1) {
			const edgeRow = row === 0 || row === last;
			for (let column = 0; column < size; column += 1) {
				const cell = row * size + column;
				const receiver = edgeRow || column === 0 || column === last ? steepestFall(elevation, size, cell) : steepestFallInside(elevation, size, cell);
				if (receiver >= 0 && elevation[receiver] + FLOOD_RISE <= elevation[cell]) local[cell] = receiver;
				else if (basin[cell] !== OCEAN) {
					local[cell] = PIT;
					queue[pits] = cell;
					pits += 1;
				}
			}
		}
		this.pits = pits;
	}

	/** Each cell's basin, by walking its local receivers to a cell whose basin is known, then back up the walk. */
	private findBasins(): void {
		const { local, basin, chain, queue, pits } = this;
		const cells = this.size * this.size;
		for (let pit = 0; pit < pits; pit += 1) basin[queue[pit]] = pit + 1;
		for (let cell = 0; cell < cells; cell += 1) {
			if (basin[cell] >= 0) continue;
			let length = 0;
			let at = cell;
			while (basin[at] < 0) {
				chain[length] = at;
				length += 1;
				at = local[at];
			}
			const found = basin[at];
			while (length > 0) {
				length -= 1;
				basin[chain[length]] = found;
			}
		}
	}

	/**
	 * Every neighbouring pair of cells in two basins, as a pass at the higher
	 * of their heights, or infinitely high where a height isn't a number. A
	 * basin remembers its last neighbour, so a run of passes between the same
	 * two is listed once, at its lowest.
	 */
	private findPasses(elevation: ArrayLike<number>): void {
		const { size, basin } = this;
		const last = size - 1;
		const basins = this.pits + 1;
		this.growBasins(basins);
		this.partner.fill(-1, 0, basins);
		let count = 0;
		for (let row = 0; row < size; row += 1) {
			// A row adds at most four passes a cell.
			this.growPasses(count + 4 * size);
			const base = row * size;
			for (let column = 0; column < size; column += 1) {
				const cell = base + column;
				const a = basin[cell];
				const height = elevation[cell];
				// East, then north-west, north, and north-east: each neighbouring pair once.
				if (column < last && basin[cell + 1] !== a) count = this.addPass(count, a, basin[cell + 1], height, elevation[cell + 1]);
				if (row === last) continue;
				const above = cell + size;
				if (column > 0 && basin[above - 1] !== a) count = this.addPass(count, a, basin[above - 1], height, elevation[above - 1]);
				if (basin[above] !== a) count = this.addPass(count, a, basin[above], height, elevation[above]);
				if (column < last && basin[above + 1] !== a) count = this.addPass(count, a, basin[above + 1], height, elevation[above + 1]);
			}
		}
		this.passCount = count;
	}

	/** Lists the pass between basins `a` and `b` over cells of heights `first` and `second`; returns the new count. */
	private addPass(count: number, a: number, b: number, first: number, second: number): number {
		const height = first !== first || second !== second ? Infinity : first > second ? first : second;
		const partner = this.partner;
		let at = -1;
		if (partner[a] === b) at = this.partnerPass[a];
		else if (partner[b] === a) at = this.partnerPass[b];
		if (at >= 0) {
			if (height < this.passHeight[at]) this.passHeight[at] = height;
			return count;
		}
		this.passLow[count] = a;
		this.passHigh[count] = b;
		this.passHeight[count] = height;
		partner[a] = b;
		this.partnerPass[a] = count;
		partner[b] = a;
		this.partnerPass[b] = count;
		return count + 1;
	}

	/**
	 * Each pit's spill: over every way from it to the ocean, the lowest of
	 * the highest pass on the way. A widest-path Dijkstra from the ocean, over
	 * the basins' passes listed by basin.
	 */
	private findSpills(): void {
		const { passLow, passHigh, passHeight, passCount, passStart, spill, done } = this;
		const basins = this.pits + 1;
		this.growPasses(passCount);
		const { passTo, passToHeight } = this;
		passStart.fill(0, 0, basins + 1);
		for (let index = 0; index < passCount; index += 1) {
			passStart[passLow[index] + 1] += 1;
			passStart[passHigh[index] + 1] += 1;
		}
		for (let at = 0; at < basins; at += 1) passStart[at + 1] += passStart[at];
		// partnerPass is free now: each basin's next free slot.
		const next = this.partnerPass;
		for (let at = 0; at < basins; at += 1) next[at] = passStart[at];
		for (let index = 0; index < passCount; index += 1) {
			const a = passLow[index];
			const b = passHigh[index];
			const height = passHeight[index];
			passTo[next[a]] = b;
			passToHeight[next[a]] = height;
			next[a] += 1;
			passTo[next[b]] = a;
			passToHeight[next[b]] = height;
			next[b] += 1;
		}
		spill.fill(Infinity, 0, basins);
		done.fill(0, 0, basins);
		spill[OCEAN] = -Infinity;
		let heapSize = this.push(0, OCEAN, -Infinity);
		while (heapSize > 0) {
			const key = this.heapKeys[0];
			const from = this.heapCells[0];
			heapSize = this.pop(heapSize);
			if (done[from] === 1 || key !== spill[from]) continue;
			done[from] = 1;
			for (let index = passStart[from], end = passStart[from + 1]; index < end; index += 1) {
				const to = passTo[index];
				if (done[to] === 1) continue;
				const height = passToHeight[index];
				const value = height > key ? height : key;
				if (value < spill[to]) {
					spill[to] = value;
					heapSize = this.push(heapSize, to, value);
				}
			}
		}
	}

	/**
	 * The flood's candidates, each pit's cells under its limit, its spill and
	 * `band`, and every pit; and the cells beside them. The ocean's limit is
	 * below every height.
	 */
	private findCandidates(elevation: ArrayLike<number>, band: number): void {
		const { size, offsets, basin, local, spill, limit, mark, candidates, beside } = this;
		const cells = size * size;
		const last = size - 1;
		limit[OCEAN] = -Infinity;
		for (let id = 1; id <= this.pits; id += 1) limit[id] = spill[id] + band;
		let count = 0;
		for (let cell = 0; cell < cells; cell += 1) {
			if (elevation[cell] < limit[basin[cell]] || local[cell] === PIT) {
				mark[cell] = CANDIDATE;
				candidates[count] = cell;
				count += 1;
			}
		}
		let besideCount = 0;
		for (let index = 0; index < count; index += 1) {
			const cell = candidates[index];
			const unknown = !(elevation[cell] === elevation[cell]);
			const row = (cell / size) | 0;
			const column = cell - row * size;
			const inside = row > 0 && column > 0 && row < last && column < last;
			for (let step = 0; step < 8; step += 1) {
				let next: number;
				if (inside) next = cell + offsets[step];
				else {
					const nextColumn = column + STEP_COLUMNS[step];
					const nextRow = row + STEP_ROWS[step];
					if (nextColumn < 0 || nextRow < 0 || nextColumn > last || nextRow > last) continue;
					next = nextRow * size + nextColumn;
				}
				if (mark[next] === 0) {
					mark[next] = BESIDE;
					beside[besideCount] = next;
					besideCount += 1;
				}
				if (unknown && (mark[next] & BESIDE) !== 0) mark[next] |= BESIDE_UNKNOWN;
			}
		}
		this.candidateCount = count;
		this.besideCount = besideCount;
	}

	/**
	 * Floods the candidates from the cells beside them, which stand at their
	 * heights, in level order, each candidate's level settled the first time
	 * it leaves the heap or the FIFO. Returns whether the levels hold: every
	 * candidate settled under its limit, and the cells beside the flood still
	 * at their heights.
	 *
	 * The cells beside a lake in its own basin stand over its limit, so what
	 * they'd offer it is left out, and most of a lake fills from its spill
	 * through the FIFO alone. That's exact while every level settles under
	 * its limit, as nothing left out could have lowered one.
	 */
	private flood(elevation: ArrayLike<number>): boolean {
		const { size, offsets, mark, beside, besideCount, candidates, candidateCount, queue, offered, levels, local, limit, basin } = this;
		const last = size - 1;
		for (let index = 0; index < candidateCount; index += 1) offered[candidates[index]] = Infinity;
		for (let index = 0; index < besideCount; index += 1) this.offer(beside[index], elevation[beside[index]], elevation);
		let heapSize = 0;
		for (let index = 0; index < candidateCount; index += 1) {
			const cell = candidates[index];
			if (offered[cell] < Infinity) heapSize = this.push(heapSize, cell, offered[cell]);
		}
		let head = 0;
		let tail = 0;
		for (;;) {
			let cell: number;
			let level: number;
			if (head < tail && (heapSize === 0 || offered[queue[head]] <= this.heapKeys[0])) {
				// A cell enters the FIFO at most once, at the lowest level it's ever offered: levels settle in order, so nothing later undercuts it.
				cell = queue[head];
				head += 1;
				level = offered[cell];
			} else if (heapSize > 0) {
				level = this.heapKeys[0];
				cell = this.heapCells[0];
				heapSize = this.pop(heapSize);
				if ((mark[cell] & SETTLED) !== 0 || level !== offered[cell]) continue;
			} else break;
			mark[cell] |= SETTLED;
			levels[cell] = level;
			const raised = level + FLOOD_RISE;
			const row = (cell / size) | 0;
			const column = cell - row * size;
			const inside = row > 0 && column > 0 && row < last && column < last;
			for (let step = 0; step < 8; step += 1) {
				let next: number;
				if (inside) next = cell + offsets[step];
				else {
					const nextColumn = column + STEP_COLUMNS[step];
					const nextRow = row + STEP_ROWS[step];
					if (nextColumn < 0 || nextRow < 0 || nextColumn > last || nextRow > last) continue;
					next = nextRow * size + nextColumn;
				}
				if (mark[next] !== CANDIDATE) continue;
				const height = elevation[next];
				if (height > raised) {
					if (height < offered[next]) {
						offered[next] = height;
						heapSize = this.push(heapSize, next, height);
					}
				} else if (raised < offered[next]) {
					offered[next] = raised;
					queue[tail] = next;
					tail += 1;
				}
			}
		}
		for (let index = 0; index < candidateCount; index += 1) {
			const cell = candidates[index];
			const under = limit[basin[cell]];
			if ((mark[cell] & SETTLED) !== 0) {
				if (levels[cell] > under) return false;
			} else if (under < Infinity) {
				return false;
			} else {
				// Nothing was left out of this pit's flood, and it never reached the cell: it has no level, and no receiver.
				levels[cell] = NaN;
			}
		}
		// A cell beside the flood that drains to a cell outside it stands at its
		// height, a flood rise or more above that cell's. One draining into the
		// flood stands at its height only if no level beside it now raises it.
		for (let index = 0; index < besideCount; index += 1) {
			const cell = beside[index];
			const receiver = local[cell];
			if (receiver < 0 || (mark[receiver] & CANDIDATE) === 0) continue;
			const row = (cell / size) | 0;
			const column = cell - row * size;
			const inside = row > 0 && column > 0 && row < last && column < last;
			let lowest = Infinity;
			for (let step = 0; step < 8; step += 1) {
				let next: number;
				if (inside) next = cell + offsets[step];
				else {
					const nextColumn = column + STEP_COLUMNS[step];
					const nextRow = row + STEP_ROWS[step];
					if (nextColumn < 0 || nextRow < 0 || nextColumn > last || nextRow > last) continue;
					next = nextRow * size + nextColumn;
				}
				if (levels[next] < lowest) lowest = levels[next];
			}
			if (!(elevation[cell] >= lowest + FLOOD_RISE)) return false;
		}
		return true;
	}

	/**
	 * Offers `level` plus a flood rise, or a candidate's own height where
	 * that's higher, to the candidates beside `cell`, unless that's over the
	 * candidate's limit.
	 */
	private offer(cell: number, level: number, elevation: ArrayLike<number>): void {
		const { size, offsets, mark, offered, limit, basin } = this;
		const last = size - 1;
		const raised = level + FLOOD_RISE;
		const row = (cell / size) | 0;
		const column = cell - row * size;
		const inside = row > 0 && column > 0 && row < last && column < last;
		for (let step = 0; step < 8; step += 1) {
			let next: number;
			if (inside) next = cell + offsets[step];
			else {
				const nextColumn = column + STEP_COLUMNS[step];
				const nextRow = row + STEP_ROWS[step];
				if (nextColumn < 0 || nextRow < 0 || nextColumn > last || nextRow > last) continue;
				next = nextRow * size + nextColumn;
			}
			if (mark[next] !== CANDIDATE) continue;
			const height = elevation[next];
			const value = height > raised ? height : raised;
			if (value < offered[next] && value <= limit[basin[next]]) offered[next] = value;
		}
	}

	/** Undoes a flood whose check failed: the candidates' heights back as their levels, and every mark cleared. */
	private clearFlood(elevation: ArrayLike<number>): void {
		const { candidates, candidateCount, levels } = this;
		for (let index = 0; index < candidateCount; index += 1) levels[candidates[index]] = elevation[candidates[index]];
		this.clearMarks();
	}

	private clearMarks(): void {
		const { mark, candidates, candidateCount, beside, besideCount } = this;
		for (let index = 0; index < candidateCount; index += 1) mark[candidates[index]] = 0;
		for (let index = 0; index < besideCount; index += 1) mark[beside[index]] = 0;
	}

	/**
	 * Receivers by the steepest fall on the levels, for the candidates and the
	 * cells beside them that drain into the flood or lie beside a height that
	 * isn't a number.
	 */
	private drainFlood(elevation: ArrayLike<number>): void {
		const { size, local, mark, candidates, candidateCount, beside, besideCount, levels, receivers } = this;
		const last = size - 1;
		for (let index = 0; index < candidateCount + besideCount; index += 1) {
			const isCandidate = index < candidateCount;
			const cell = isCandidate ? candidates[index] : beside[index - candidateCount];
			const receiver = local[cell];
			if (receiver === OUTLET || (!isCandidate && (mark[receiver] & CANDIDATE) === 0 && (mark[cell] & BESIDE_UNKNOWN) === 0)) continue;
			const row = (cell / size) | 0;
			const column = cell - row * size;
			const fall = row > 0 && column > 0 && row < last && column < last ? steepestFallInside(levels, size, cell) : steepestFall(levels, size, cell);
			if (fall < 0) throw new RangeError(`DrainageRouter: cell ${cell} has no neighbour below it, so its elevation, ${elevation[cell]}, or a neighbour's isn't a number`);
			receivers[cell] = fall;
		}
	}

	/** Downstream first: each cell's chain of receivers walked down to a cell already listed, then listed bottom up. */
	private writeOrder(): void {
		const { receivers, chain, order } = this;
		// mark is clear between calls; here it marks the cells listed.
		const listed = this.mark;
		const cells = this.size * this.size;
		let count = 0;
		for (let cell = 0; cell < cells; cell += 1) {
			if (listed[cell] === 1) continue;
			let length = 0;
			let at = cell;
			while (at >= 0 && listed[at] === 0) {
				chain[length] = at;
				length += 1;
				at = receivers[at];
			}
			while (length > 0) {
				length -= 1;
				const next = chain[length];
				listed[next] = 1;
				order[count] = next;
				count += 1;
			}
		}
		listed.fill(0);
	}

	private push(heapSize: number, cell: number, key: number): number {
		if (heapSize === this.heapCells.length) {
			const cells = new Int32Array(2 * heapSize);
			cells.set(this.heapCells);
			this.heapCells = cells;
			const keys = new Float64Array(2 * heapSize);
			keys.set(this.heapKeys);
			this.heapKeys = keys;
		}
		const cells = this.heapCells;
		const keys = this.heapKeys;
		let at = heapSize;
		while (at > 0) {
			const parent = (at - 1) >> 1;
			const parentKey = keys[parent];
			if (parentKey < key || (parentKey === key && cells[parent] < cell)) break;
			cells[at] = cells[parent];
			keys[at] = parentKey;
			at = parent;
		}
		cells[at] = cell;
		keys[at] = key;
		return heapSize + 1;
	}

	/** Removes the heap's top, read beforehand; returns the new size. */
	private pop(heapSize: number): number {
		const cells = this.heapCells;
		const keys = this.heapKeys;
		const size = heapSize - 1;
		if (size > 0) {
			const cell = cells[size];
			const key = keys[size];
			let at = 0;
			for (;;) {
				let child = 2 * at + 1;
				if (child >= size) break;
				const right = child + 1;
				if (right < size && (keys[right] < keys[child] || (keys[right] === keys[child] && cells[right] < cells[child]))) child = right;
				const childKey = keys[child];
				if (key < childKey || (key === childKey && cell < cells[child])) break;
				cells[at] = cells[child];
				keys[at] = childKey;
				at = child;
			}
			cells[at] = cell;
			keys[at] = key;
		}
		return size;
	}

	private growBasins(count: number): void {
		if (this.spill.length >= count) return;
		const capacity = Math.max(64, 2 * count);
		this.spill = new Float64Array(capacity);
		this.limit = new Float64Array(capacity);
		this.passStart = new Int32Array(capacity + 1);
		this.done = new Uint8Array(capacity);
		this.partner = new Int32Array(capacity);
		this.partnerPass = new Int32Array(capacity);
	}

	private growPasses(count: number): void {
		if (this.passLow.length >= count) return;
		const capacity = Math.max(1024, 2 * count);
		const low = new Int32Array(capacity);
		low.set(this.passLow);
		this.passLow = low;
		const high = new Int32Array(capacity);
		high.set(this.passHigh);
		this.passHigh = high;
		const height = new Float64Array(capacity);
		height.set(this.passHeight);
		this.passHeight = height;
		this.passTo = new Int32Array(2 * capacity);
		this.passToHeight = new Float64Array(2 * capacity);
	}
}

/**
 * The neighbour `cell` falls to most steeply on `values`, ties to the lower
 * index, or -1 when none lies below it. Works anywhere on the grid.
 */
function steepestFall(values: ArrayLike<number>, size: number, cell: number): number {
	const last = size - 1;
	const level = values[cell];
	const row = (cell / size) | 0;
	const column = cell - row * size;
	let receiver = -1;
	let steepest = 0;
	for (let step = 0; step < 8; step += 1) {
		const nextColumn = column + STEP_COLUMNS[step];
		const nextRow = row + STEP_ROWS[step];
		if (nextColumn < 0 || nextRow < 0 || nextColumn > last || nextRow > last) continue;
		const next = nextRow * size + nextColumn;
		const drop = level - values[next];
		if (drop > 0) {
			const fall = (step & 1) === 1 ? drop * INVERSE_ROOT_TWO : drop;
			if (fall > steepest || (fall === steepest && next < receiver)) {
				steepest = fall;
				receiver = next;
			}
		}
	}
	return receiver;
}

/**
 * `steepestFall` for a cell off the edge, unrolled: the neighbours are taken
 * lowest index first, so keeping only a strictly steeper fall keeps the lower
 * index on a tie.
 */
function steepestFallInside(values: ArrayLike<number>, size: number, cell: number): number {
	const level = values[cell];
	const below = cell - size;
	const above = cell + size;
	let receiver = -1;
	let steepest = 0;
	let fall = (level - values[below - 1]) * INVERSE_ROOT_TWO;
	if (fall > steepest) { steepest = fall; receiver = below - 1; }
	fall = level - values[below];
	if (fall > steepest) { steepest = fall; receiver = below; }
	fall = (level - values[below + 1]) * INVERSE_ROOT_TWO;
	if (fall > steepest) { steepest = fall; receiver = below + 1; }
	fall = level - values[cell - 1];
	if (fall > steepest) { steepest = fall; receiver = cell - 1; }
	fall = level - values[cell + 1];
	if (fall > steepest) { steepest = fall; receiver = cell + 1; }
	fall = (level - values[above - 1]) * INVERSE_ROOT_TWO;
	if (fall > steepest) { steepest = fall; receiver = above - 1; }
	fall = level - values[above];
	if (fall > steepest) { steepest = fall; receiver = above; }
	fall = (level - values[above + 1]) * INVERSE_ROOT_TWO;
	if (fall > steepest) receiver = above + 1;
	return receiver;
}

/**
 * Each cell's rain (1 when none is given) plus everything upstream of it,
 * into `area`. With no rain the areas are whole numbers, summed exactly in
 * any order, so it walks `order` upstream first. With rain each cell sums
 * its donors highest level first, ties highest index first, so the rounding
 * never depends on the order a routing lists cells in.
 */
function accumulateInto({ area, receivers, levels, order, rain, caller }: {
	area: Float64Array; receivers: ArrayLike<number>; levels: ArrayLike<number>; order: ArrayLike<number>; rain?: ArrayLike<number>; caller: string;
}): void {
	const cells = area.length;
	if (rain !== undefined && rain.length !== cells) throw new RangeError(`${caller}: expected ${cells} rain values, got ${rain.length}`);
	if (rain === undefined) {
		area.fill(1);
		for (let index = cells - 1; index >= 0; index -= 1) {
			const cell = order[index];
			const receiver = receivers[cell];
			if (receiver >= 0) area[receiver] += area[cell];
		}
		return;
	}
	// Each cell's donors, highest index first.
	const start = new Int32Array(cells + 1);
	for (let cell = 0; cell < cells; cell += 1) if (receivers[cell] >= 0) start[receivers[cell] + 1] += 1;
	for (let cell = 0; cell < cells; cell += 1) start[cell + 1] += start[cell];
	const donors = new Int32Array(start[cells]);
	const next = start.slice(0, cells);
	for (let cell = cells - 1; cell >= 0; cell -= 1) {
		const receiver = receivers[cell];
		if (receiver >= 0) {
			donors[next[receiver]] = cell;
			next[receiver] += 1;
		}
	}
	for (let index = cells - 1; index >= 0; index -= 1) {
		const cell = order[index];
		const from = start[cell];
		const to = start[cell + 1];
		// Highest level first, keeping index order among equal levels.
		for (let at = from + 1; at < to; at += 1) {
			const donor = donors[at];
			const level = levels[donor];
			let into = at;
			while (into > from && levels[donors[into - 1]] < level) {
				donors[into] = donors[into - 1];
				into -= 1;
			}
			donors[into] = donor;
		}
		let sum = rain[cell];
		for (let at = from; at < to; at += 1) sum += area[donors[at]];
		area[cell] = sum;
	}
}

/**
 * Drainage area over a routing already made, with rain weighting each cell:
 * the water stage's rain-weighted area over the land's receivers and order.
 * Returns a new array and leaves the drainage alone.
 */
export function accumulateArea({ drainage, rain }: { drainage: Pick<Drainage, 'receivers' | 'levels' | 'order'>; rain?: ArrayLike<number> }): Float64Array {
	const area = new Float64Array(drainage.receivers.length);
	accumulateInto({ area, receivers: drainage.receivers, levels: drainage.levels, order: drainage.order, rain, caller: 'accumulateArea' });
	return area;
}

export interface DrainageOptions {
	/** Cells along each side of the square grid. */
	size: number;
	/** Per cell, row by row. */
	elevation: ArrayLike<number>;
	/** The cells drainage leaves by; at least one, none listed twice. */
	outlets: ArrayLike<number>;
	/** Rain per cell for the area; one each when left out. */
	rain?: ArrayLike<number>;
	/** A router for this size to route with; its arrays become the result's, so it mustn't route again while the result is in use. */
	router?: DrainageRouter;
}

/** A grid's drainage: routed to the outlets, then accumulated. */
export function routeDrainage({ size, elevation, outlets, rain, router }: DrainageOptions): Drainage {
	const routing = router ?? new DrainageRouter({ size });
	if (routing.size !== size) throw new RangeError(`routeDrainage: the router is for size ${routing.size}, not ${size}`);
	routing.route(elevation, outlets);
	routing.accumulate(rain);
	return { size, receivers: routing.receivers, levels: routing.levels, area: routing.area, order: routing.order, outlets: Int32Array.from(outlets) };
}
