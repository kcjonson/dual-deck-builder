/**
 * Drainage on the land grid (Area Map Generation, Pipeline, 1. Terrain, and
 * 2. Water): which way every cell drains, and how much drains through it.
 *
 * Routing is a priority flood from the outlets (Barnes et al. 2014): the
 * outlets go into a queue keyed by elevation, and the lowest cell in the
 * queue claims each of its eight neighbours not yet reached, which then
 * drain to it. A neighbour enters the queue at its own elevation, or just
 * above the cell that claimed it where that's higher, so a pit or a flat
 * fills as it's reached and drains out over its spill point, outward from
 * it, without a separate fill. That entry is the cell's water level, and
 * each cell's is above the one it drains to, so water runs downhill
 * everywhere on the levels; where a level stands above the land, water
 * stands in a pit until it spills. Every cell is reached from an outlet, so
 * every cell drains to one, and the order cells leave the queue lists each
 * after the cell it drains to: downstream first. Ties break by cell index,
 * so the routing never depends on how the queue is built.
 *
 * Everything is adds, compares, and integer ops on typed arrays, so a grid
 * routes the same in every engine. The result is plain data.
 */

/** A grid's drainage: plain typed arrays, indexed by cell (`row * size + column`). */
export interface Drainage {
	/** Cells along each side of the square grid. */
	readonly size: number;
	/** The neighbour each cell drains to, one of its eight, or -1 at an outlet. */
	readonly receivers: Int32Array;
	/**
	 * The level water reaches in each cell: its elevation, or more in a pit or
	 * on a flat, where it stands until it spills. Always above its receiver's
	 * level, by `FLOOD_RISE` at the least.
	 */
	readonly levels: Float64Array;
	/** Drainage area: the rain of every cell that drains through each, its own included; one per cell unless rain was given. */
	readonly area: Float64Array;
	/** Every cell, outlets first and each after the cell it drains to: downstream first. Walk it backwards to go upstream first. */
	readonly order: Int32Array;
	/** The cells where drainage leaves, each its own receiver's -1. */
	readonly outlets: Int32Array;
}

/**
 * How far above the cell that claimed it a flooded cell enters the queue,
 * at the least, so a filled pit or flat drains outward from where it spills
 * rather than in index order. Elevations a step apart from each other by
 * less than this are flooded as though level.
 */
export const FLOOD_RISE = 1e-7;

/** Column and row steps to the eight neighbours, east first, counterclockwise. */
const STEP_COLUMNS = [1, 1, 0, -1, -1, -1, 0, 1];
const STEP_ROWS = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Routes drainage on a grid of one size, over and over, without allocating:
 * erosion routes once an iteration. `receivers`, `levels`, `order`, and
 * `area` are its own and change with each call.
 */
export class DrainageRouter {
	public readonly size: number;
	public readonly receivers: Int32Array;
	public readonly levels: Float64Array;
	public readonly order: Int32Array;
	public readonly area: Float64Array;
	private readonly reached: Uint8Array;
	/** A binary min-heap of cells, keyed by flood level, then by index. */
	private readonly heapCells: Int32Array;
	private readonly heapKeys: Float64Array;
	private heapSize = 0;

	constructor({ size }: { size: number }) {
		if (!Number.isInteger(size) || size < 1) throw new RangeError(`DrainageRouter: size must be a positive integer, got ${size}`);
		const cells = size * size;
		this.size = size;
		this.receivers = new Int32Array(cells);
		this.levels = new Float64Array(cells);
		this.order = new Int32Array(cells);
		this.area = new Float64Array(cells);
		this.reached = new Uint8Array(cells);
		this.heapCells = new Int32Array(cells);
		this.heapKeys = new Float64Array(cells);
	}

	/** Fills `receivers`, `levels`, and `order` for `elevation`, flooding from `outlets`. */
	public route(elevation: ArrayLike<number>, outlets: ArrayLike<number>): void {
		const size = this.size;
		const cells = size * size;
		if (elevation.length !== cells) throw new RangeError(`DrainageRouter: expected ${cells} elevations, got ${elevation.length}`);
		if (outlets.length === 0) throw new RangeError('DrainageRouter: drainage needs at least one outlet');
		const receivers = this.receivers;
		const levels = this.levels;
		const order = this.order;
		const reached = this.reached;
		reached.fill(0);
		this.heapSize = 0;
		for (let index = 0; index < outlets.length; index += 1) {
			const outlet = outlets[index];
			if (!(outlet >= 0 && outlet < cells && Number.isInteger(outlet))) throw new RangeError(`DrainageRouter: outlet ${outlet} is not a cell`);
			if (reached[outlet] === 1) throw new RangeError(`DrainageRouter: outlet ${outlet} is listed twice`);
			reached[outlet] = 1;
			receivers[outlet] = -1;
			levels[outlet] = elevation[outlet];
			this.push(outlet, elevation[outlet]);
		}
		let count = 0;
		while (this.heapSize > 0) {
			const level = this.heapKeys[0];
			const cell = this.pop();
			order[count] = cell;
			count += 1;
			const row = (cell / size) | 0;
			const column = cell - row * size;
			const raised = level + FLOOD_RISE;
			for (let step = 0; step < 8; step += 1) {
				const nextColumn = column + STEP_COLUMNS[step];
				const nextRow = row + STEP_ROWS[step];
				if (nextColumn < 0 || nextRow < 0 || nextColumn >= size || nextRow >= size) continue;
				const next = nextRow * size + nextColumn;
				if (reached[next] === 1) continue;
				reached[next] = 1;
				receivers[next] = cell;
				const height = elevation[next];
				const nextLevel = height > raised ? height : raised;
				levels[next] = nextLevel;
				this.push(next, nextLevel);
			}
		}
	}

	/** Fills `area` from the last routing: each cell's rain (1 when none is given) plus everything upstream of it. */
	public accumulate(rain?: ArrayLike<number>): void {
		const area = this.area;
		const order = this.order;
		const receivers = this.receivers;
		const cells = area.length;
		if (rain !== undefined && rain.length !== cells) throw new RangeError(`DrainageRouter: expected ${cells} rain values, got ${rain.length}`);
		if (rain === undefined) area.fill(1);
		else for (let cell = 0; cell < cells; cell += 1) area[cell] = rain[cell];
		for (let index = cells - 1; index >= 0; index -= 1) {
			const cell = order[index];
			const receiver = receivers[cell];
			if (receiver >= 0) area[receiver] += area[cell];
		}
	}

	private push(cell: number, key: number): void {
		const cells = this.heapCells;
		const keys = this.heapKeys;
		let at = this.heapSize;
		this.heapSize += 1;
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
	}

	private pop(): number {
		const cells = this.heapCells;
		const keys = this.heapKeys;
		const top = cells[0];
		this.heapSize -= 1;
		const size = this.heapSize;
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
		return top;
	}
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
}

/** A grid's drainage: routed by priority flood from the outlets, then accumulated. */
export function routeDrainage({ size, elevation, outlets, rain }: DrainageOptions): Drainage {
	const router = new DrainageRouter({ size });
	router.route(elevation, outlets);
	router.accumulate(rain);
	return { size, receivers: router.receivers, levels: router.levels, area: router.area, order: router.order, outlets: Int32Array.from(outlets) };
}
