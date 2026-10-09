/**
 * Drainage on the land grid (Area Map Generation, Pipeline, 1. Terrain, and
 * 2. Water): which way every cell drains, and how much drains through it.
 *
 * Routing is a priority flood from the outlets (Barnes et al. 2014): the
 * outlets go into a queue keyed by elevation, and the lowest cell in the
 * queue leaves it next, putting each of its eight neighbours not yet reached
 * into the queue. A neighbour enters at its own elevation, or just above the
 * cell that reached it where that's higher, so a pit or a flat fills as it's
 * reached and drains out over its spill point, outward from it, without a
 * separate fill. That entry is the cell's water level. When a cell leaves
 * the queue it drains to whichever neighbour that left before it falls
 * furthest per unit of distance on the levels: steepest descent, so drainage
 * runs straight down a slope rather than toward whichever neighbour the
 * flood reached first, which favours the diagonals. Every neighbour lower
 * than a cell has left the queue by then, so every cell drains to one below
 * it, water runs downhill everywhere on the levels, and where a level stands
 * above the land, water stands in a pit until it spills. Every cell is
 * reached from an outlet, so every cell drains to one, and the order cells
 * leave the queue lists each after the cell it drains to: downstream first.
 * Ties break by cell index, so the routing never depends on how the queue
 * is built.
 *
 * Everything is adds, divides, compares, and integer ops on typed arrays, so
 * a grid routes the same in every engine. The result is plain data.
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
	/** Every cell, outlets first and each after the cell it drains to: downstream first. Walk it backwards to go upstream first. */
	readonly order: Int32Array;
	/** The cells where drainage leaves, each its own receiver's -1. */
	readonly outlets: Int32Array;
}

/**
 * How far above the cell that reached it a flooded cell enters the queue, at
 * the least, so a filled pit or flat drains outward from where it spills
 * rather than in index order. Elevations a step apart from each other by
 * less than this are flooded as though level.
 */
export const FLOOD_RISE = 1e-7;

/** Column and row steps to the eight neighbours, east first, counterclockwise: the odd steps are the diagonals. */
const STEP_COLUMNS = [1, 1, 0, -1, -1, -1, 0, 1];
const STEP_ROWS = [0, 1, 1, 1, 0, -1, -1, -1];
/** A diagonal neighbour is this much nearer per unit of drop than a straight one: 1 over the square root of 2, exactly rounded. */
const INVERSE_ROOT_TWO = Math.SQRT1_2;

/** Where a cell is in a routing: not reached, in the queue (an outlet or not), or gone from it. */
const UNREACHED = 0;
const QUEUED = 1;
const QUEUED_OUTLET = 2;
const LEFT = 3;

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
	private readonly state: Uint8Array;
	/** Index steps to the eight neighbours of a cell off the edge, in the order of STEP_COLUMNS. */
	private readonly offsets: Int32Array;
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
		this.state = new Uint8Array(cells);
		this.offsets = Int32Array.from(STEP_COLUMNS, (column, step) => column + STEP_ROWS[step] * size);
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
		const state = this.state;
		state.fill(UNREACHED);
		this.heapSize = 0;
		for (let index = 0; index < outlets.length; index += 1) {
			const outlet = outlets[index];
			if (!(outlet >= 0 && outlet < cells && Number.isInteger(outlet))) throw new RangeError(`DrainageRouter: outlet ${outlet} is not a cell`);
			if (state[outlet] !== UNREACHED) throw new RangeError(`DrainageRouter: outlet ${outlet} is listed twice`);
			state[outlet] = QUEUED_OUTLET;
			levels[outlet] = elevation[outlet];
			this.push(outlet, elevation[outlet]);
		}
		const offsets = this.offsets;
		let count = 0;
		while (this.heapSize > 0) {
			const level = this.heapKeys[0];
			const cell = this.pop();
			order[count] = cell;
			count += 1;
			const row = (cell / size) | 0;
			const column = cell - row * size;
			// Cells off the edge have every neighbour, so they skip the bounds checks.
			const interior = row > 0 && column > 0 && row < size - 1 && column < size - 1;
			const raised = level + FLOOD_RISE;
			let receiver = -1;
			let steepest = 0;
			for (let step = 0; step < 8; step += 1) {
				let next: number;
				if (interior) {
					next = cell + offsets[step];
				} else {
					const nextColumn = column + STEP_COLUMNS[step];
					const nextRow = row + STEP_ROWS[step];
					if (nextColumn < 0 || nextRow < 0 || nextColumn >= size || nextRow >= size) continue;
					next = nextRow * size + nextColumn;
				}
				const nextState = state[next];
				if (nextState === LEFT) {
					const drop = level - levels[next];
					if (drop > 0) {
						const fall = (step & 1) === 1 ? drop * INVERSE_ROOT_TWO : drop;
						if (fall > steepest || (fall === steepest && next < receiver)) {
							steepest = fall;
							receiver = next;
						}
					}
				} else if (nextState === UNREACHED) {
					state[next] = QUEUED;
					const height = elevation[next];
					const nextLevel = height > raised ? height : raised;
					levels[next] = nextLevel;
					this.push(next, nextLevel);
				}
			}
			// An outlet drains nowhere; any other cell has at least the neighbour that reached it below it.
			receivers[cell] = state[cell] === QUEUED_OUTLET ? -1 : receiver;
			state[cell] = LEFT;
		}
	}

	/** Fills `area` from the last routing: each cell's rain (1 when none is given) plus everything upstream of it. */
	public accumulate(rain?: ArrayLike<number>): void {
		accumulateInto({ area: this.area, receivers: this.receivers, order: this.order, rain });
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

/** Each cell's rain (1 when none is given) plus everything upstream of it, into `area`, walking `order` upstream first. */
function accumulateInto({ area, receivers, order, rain }: { area: Float64Array; receivers: ArrayLike<number>; order: ArrayLike<number>; rain?: ArrayLike<number> }): void {
	const cells = area.length;
	if (rain !== undefined && rain.length !== cells) throw new RangeError(`accumulateArea: expected ${cells} rain values, got ${rain.length}`);
	if (rain === undefined) area.fill(1);
	else for (let cell = 0; cell < cells; cell += 1) area[cell] = rain[cell];
	for (let index = cells - 1; index >= 0; index -= 1) {
		const cell = order[index];
		const receiver = receivers[cell];
		if (receiver >= 0) area[receiver] += area[cell];
	}
}

/**
 * Drainage area over a routing already made, with rain weighting each cell:
 * the water stage's rain-weighted area over the land's receivers and order.
 * Returns a new array and leaves the drainage alone.
 */
export function accumulateArea({ drainage, rain }: { drainage: Pick<Drainage, 'receivers' | 'order'>; rain?: ArrayLike<number> }): Float64Array {
	const area = new Float64Array(drainage.receivers.length);
	accumulateInto({ area, receivers: drainage.receivers, order: drainage.order, rain });
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

/** A grid's drainage: routed by priority flood from the outlets, then accumulated. */
export function routeDrainage({ size, elevation, outlets, rain, router }: DrainageOptions): Drainage {
	const routing = router ?? new DrainageRouter({ size });
	if (routing.size !== size) throw new RangeError(`routeDrainage: the router is for size ${routing.size}, not ${size}`);
	routing.route(elevation, outlets);
	routing.accumulate(rain);
	return { size, receivers: routing.receivers, levels: routing.levels, area: routing.area, order: routing.order, outlets: Int32Array.from(outlets) };
}
