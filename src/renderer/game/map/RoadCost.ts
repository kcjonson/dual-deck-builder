import { RELIEF } from './Land';
import { LandGrid, cellCentre } from './LandGrid';
import { lerp } from './MapMath';
import type { RiverLines } from './Rivers';
import { ROAD_CLASSES, RoadClass } from './RoadNetwork';
import { MOVE_COST, METRO_BRIDGES, Terrain } from './Terrain';

/**
 * The road links' per-map edge cost field (Area Map Generation, 3. Biomes,
 * hazards, and cost, and 5. Roads): what each move between neighbouring land
 * cells costs a road of each class, worked out once per move and read by
 * every path search after, so `Terrain.moveCost` stays out of the searches'
 * inner loop (water-and-biomes.md, What Maps 6 to 8 get).
 *
 * A move runs between two cell centres, eight ways to a neighbour, or
 * straight on two cells where it bridges a river over the cell between,
 * whose centre is in the water: a broad river can leave no dry centre either
 * side close enough for a single step. Each move keeps the parts of
 * its cost no class changes: its length, the grade along it, the slope across
 * it at its middle, its bridges as a sum of their lengths' factors, and
 * whether it's blocked. A class weights them as `moveCost` does, so the field
 * and `moveCost` agree on every move the field leaves open. The field is
 * stricter: a move through a square where anything impassable could stand
 * (rough country, a lake's shore, a river, a crater) is sampled every half
 * unit, and is blocked where a sample is impassable, bar river water under
 * one of its bridges. `moveCost` reads only a move's end and middle.
 *
 * A move is worked out the first time a search asks for it, so moves no
 * search reaches cost nothing. Every part is adds, multiplies, divides,
 * compares, and square roots, so the field is the same in every engine,
 * whichever order searches fill it in.
 */

/**
 * The moves: the eight to a neighbour, east first and counterclockwise, then
 * the four bridges two cells straight on, east, north, west, and south.
 */
export const MOVE_X = [1, 1, 0, -1, -1, -1, 0, 1, 2, 0, -2, 0] as const;
export const MOVE_Y = [0, 1, 1, 1, 0, -1, -1, -1, 0, 2, 0, -2] as const;
export const MOVES = 12;
/** The moves to a neighbour come first. */
export const NEIGHBOURS = 8;
/** Each move's way back. */
export const OPPOSITE = [4, 5, 6, 7, 0, 1, 2, 3, 10, 11, 8, 9] as const;
/** Moves a cell files: the forward ones, east, north-east, north, north-west, and the bridges east and north. */
const SLOTS = 6;
const SLOT_OF = [0, 1, 2, 3, -1, -1, -1, -1, 4, 5, -1, -1] as const;
const SLOT_MOVE = [0, 1, 2, 3, 8, 9] as const;
/** The move by (dx + 2) * 5 + (dy + 2), -1 for none. */
const MOVE_BY_STEP = new Int8Array(25).fill(-1);
MOVE_X.forEach((dx, move) => {
	MOVE_BY_STEP[(dx + 2) * 5 + MOVE_Y[move] + 2] = move;
});

/** The move from a cell to the one `dx` columns and `dy` rows off, -1 for none. */
export function moveBetween(dx: number, dy: number): number {
	return dx < -2 || dx > 2 || dy < -2 || dy > 2 ? -1 : MOVE_BY_STEP[(dx + 2) * 5 + dy + 2];
}

/** World units between the samples a move through possibly impassable ground is checked at. */
export const SAMPLE_SPACING = 0.5;
/** World units past a river's water its squares count as near it, for the samples. */
const RIVER_MARGIN = 1;
/** Cell centres keep this far inside the rim, so every road stays in the disc. */
const RIM_INSET = 0.5;

const BLOCKED = Infinity;
/** What could stand in a square, as bits: rough country, so cliffs; a lake; a river; a crater; or a corner that isn't open, so anything. */
const ROUGH = 1;
const LAKE = 2;
const RIVER = 4;
const CRATER = 8;
const ANYTHING = 16;
/** The move crosses a river outside the metro, on a bridge. */
const BRIDGED = 1;
/** Too steep for a highway or back road. */
const STEEP = 2;

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;

export interface EdgeCostOptions {
	/** The land with its water, what the roads are laid over. */
	readonly terrain: Terrain;
	/** The water's river lines, whose squares the samples cover; null on land without water. */
	readonly rivers: RiverLines | null;
	/** `curviness`, which scales how much a climb costs. */
	readonly curviness: number;
}

/**
 * The cost field over one map's land grid. Cells are `row * size + column`,
 * and each cell files six moves, its forward ones (east, north-east, north,
 * north-west, and the bridges east and north); `edge` finds a move's id from
 * either end.
 */
export class EdgeCostField {
	public readonly grid: LandGrid;
	public readonly size: number;
	/** Per cell: 1 where a road can pass through its centre, inside the disc and on passable ground. */
	public readonly open: Uint8Array;
	/** Per cell, its centre's elevation. */
	public readonly elevation: Float64Array;
	/** Cell index offsets of the moves. */
	public readonly offsets: Int32Array;
	/** Moves filed in all: six a cell. */
	public readonly edges: number;

	private readonly terrain: Terrain;
	private readonly bridgedSquared: number;
	/** Per square between cell centres, what impassable could stand in it as bits, so its moves are sampled for those. */
	private readonly hazards: Uint8Array;
	/** Per move: world units long... */
	private readonly lengths: Float64Array;
	/** ...the grade along it... */
	private readonly grades: Float64Array;
	/** ...the grade across it at its middle... */
	private readonly acrosses: Float64Array;
	/** ...its bridges' factors summed, NaN until worked out and Infinity where it's blocked... */
	private readonly bridgeUnits: Float64Array;
	/** ...and `BRIDGED` and `STEEP`. */
	private readonly flags: Uint8Array;
	private readonly gradeWeights: Float64Array;
	private readonly sideWeights: Float64Array;
	private readonly bridgeWeights: Float64Array;
	private readonly maxGrades: Float64Array;
	private readonly slope = { x: 0, y: 0 };
	private workedCount = 0;
	private readonly spans: number[] = [];

	constructor({ terrain, rivers, curviness }: EdgeCostOptions) {
		const { grid } = terrain.surface;
		const size = grid.size;
		this.grid = grid;
		this.size = size;
		this.terrain = terrain;
		const bridged = terrain.metro.radius + METRO_BRIDGES;
		this.bridgedSquared = bridged * bridged;
		this.offsets = Int32Array.from(MOVE_X.map((dx, direction) => MOVE_Y[direction] * size + dx));
		const gradeScale = lerp(MOVE_COST.curviness, curviness);
		this.gradeWeights = Float64Array.from(ROAD_CLASSES.map((roadClass) => MOVE_COST.grade[roadClass] * gradeScale));
		this.sideWeights = Float64Array.from(ROAD_CLASSES.map((roadClass) => MOVE_COST.side[roadClass]));
		this.bridgeWeights = Float64Array.from(ROAD_CLASSES.map((roadClass) => MOVE_COST.bridge[roadClass]));
		this.maxGrades = Float64Array.from(ROAD_CLASSES.map((roadClass) => MOVE_COST.maxGrade[roadClass]));

		const cells = size * size;
		this.open = new Uint8Array(cells);
		this.elevation = new Float64Array(cells);
		const reach = terrain.radius - RIM_INSET;
		const reachSquared = reach * reach;
		for (let row = 0; row < size; row += 1) {
			const y = cellCentre(grid, row);
			for (let column = 0; column < size; column += 1) {
				const x = cellCentre(grid, column);
				if (x * x + y * y >= reachSquared) continue;
				const cell = row * size + column;
				this.elevation[cell] = terrain.elevation(x, y);
				if (terrain.obstacle(x, y) === null) this.open[cell] = 1;
			}
		}
		this.hazards = hazardSquares({ terrain, rivers, open: this.open });
		const moves = cells * SLOTS;
		this.edges = moves;
		this.lengths = new Float64Array(moves);
		this.grades = new Float64Array(moves);
		this.acrosses = new Float64Array(moves);
		this.bridgeUnits = new Float64Array(moves).fill(NaN);
		this.flags = new Uint8Array(moves);
	}

	/** The move from `cell` in `direction` (0 to 11): its id, filed under whichever end it leaves forward. */
	public edge(cell: number, direction: number): number {
		const slot = SLOT_OF[direction];
		return slot >= 0 ? cell * SLOTS + slot : (cell + this.offsets[direction]) * SLOTS + SLOT_OF[OPPOSITE[direction]];
	}

	/** The cell a move is filed under, and the way it leaves it forward. */
	public ends(edge: number): { cell: number; direction: number } {
		const cell = floor(edge / SLOTS);
		return { cell, direction: SLOT_MOVE[edge - cell * SLOTS] };
	}

	/** What the move costs a road of class `rank` (0 highway, 1 back road, 2 trail): Infinity where it's blocked or too steep. */
	public cost(edge: number, rank: number): number {
		let units = this.bridgeUnits[edge];
		if (units !== units) units = this.work(edge);
		if (units === BLOCKED) return BLOCKED;
		const grade = this.grades[edge];
		if (grade > this.maxGrades[rank]) return BLOCKED;
		const across = this.acrosses[edge];
		return this.lengths[edge] * (1 + this.gradeWeights[rank] * grade * grade + this.sideWeights[rank] * across * across) + this.bridgeWeights[rank] * units;
	}

	/** `cost` by class name. */
	public costFor(edge: number, roadClass: RoadClass): number {
		return this.cost(edge, ROAD_CLASSES.indexOf(roadClass));
	}

	/** World units the move runs. */
	public length(edge: number): number {
		if (this.bridgeUnits[edge] !== this.bridgeUnits[edge]) this.work(edge);
		return this.lengths[edge];
	}

	/** True where the move crosses a river outside the metro, on a bridge. */
	public bridged(edge: number): boolean {
		if (this.bridgeUnits[edge] !== this.bridgeUnits[edge]) this.work(edge);
		return (this.flags[edge] & BRIDGED) !== 0;
	}

	/** The grade along the move, rise over run. */
	public grade(edge: number): number {
		if (this.bridgeUnits[edge] !== this.bridgeUnits[edge]) this.work(edge);
		return this.grades[edge];
	}

	/** World x of a cell's centre... */
	public x(cell: number): number {
		return cellCentre(this.grid, cell % this.size);
	}

	/** ...and y. */
	public y(cell: number): number {
		return cellCentre(this.grid, floor(cell / this.size));
	}

	/** The cell holding (x, y), or -1 off the grid. */
	public cellAt(x: number, y: number): number {
		const { grid, size } = this;
		const column = floor((x + grid.halfExtent) / grid.cellSize);
		const row = floor((y + grid.halfExtent) / grid.cellSize);
		if (!(column >= 0 && row >= 0 && column < size && row < size)) return -1;
		return row * size + column;
	}

	/** How many moves have been worked out, for the stats. */
	public get worked(): number {
		return this.workedCount;
	}

	/** Works the move out, stores its parts, and returns its bridges' factors, Infinity where it's blocked. */
	private work(edge: number): number {
		const size = this.size;
		const from = floor(edge / SLOTS);
		const direction = SLOT_MOVE[edge - from * SLOTS];
		const to = from + this.offsets[direction];
		const leap = direction >= NEIGHBOURS;
		const fromColumn = from % size;
		const toColumn = fromColumn + MOVE_X[direction];
		const x0 = cellCentre(this.grid, fromColumn);
		const y0 = cellCentre(this.grid, floor(from / size));
		const x1 = cellCentre(this.grid, toColumn);
		const y1 = cellCentre(this.grid, floor(to / size));
		const dx = x1 - x0;
		const dy = y1 - y0;
		const length = sqrt(dx * dx + dy * dy);
		this.lengths[edge] = length;
		this.workedCount += 1;
		if (this.open[from] === 0 || this.open[to] === 0 || toColumn < 0 || toColumn >= size) return this.block(edge);
		// A bridge two cells long only where a step can't do: over a cell whose centre is in the river.
		if (leap && this.open[from + (to - from) / 2] === 1) return this.block(edge);
		const terrain = this.terrain;
		const water = terrain.water;
		let units = 0;
		let flags = 0;
		const crossings = water === null ? 0 : water.riverCrossings(x0, y0, x1, y1);
		for (let index = 0; index < crossings; index += 1) {
			const { along, width, sine } = (water as NonNullable<Terrain['water']>).riverCrossing(index);
			const cx = x0 + dx * along;
			const cy = y0 + dy * along;
			if (cx * cx + cy * cy <= this.bridgedSquared) continue;
			if (!(width <= MOVE_COST.longestBridge * sine)) return this.block(edge);
			units += 1 + width / sine / MOVE_COST.bridgeSpan;
			flags |= BRIDGED;
		}
		const middle = terrain.obstacle(x0 + 0.5 * dx, y0 + 0.5 * dy);
		if (middle !== null && !(middle === 'river' && units > 0)) return this.block(edge);
		if (leap && middle !== 'river') return this.block(edge);
		const hazards = leap ? ANYTHING : this.hazardsOf(from, direction);
		if (hazards !== 0 && !this.clear(x0, y0, x1, y1, length, hazards)) return this.block(edge);
		const climb = this.elevation[to] - this.elevation[from];
		const grade = (climb < 0 ? -climb : climb) * RELIEF / length;
		terrain.slope(x0 + 0.5 * dx, y0 + 0.5 * dy, this.slope);
		this.grades[edge] = grade;
		this.acrosses[edge] = (this.slope.y * dx - this.slope.x * dy) * RELIEF / length;
		if (grade > MOVE_COST.maxGrade.backRoad) flags |= STEEP;
		this.flags[edge] = flags;
		this.bridgeUnits[edge] = units;
		return units;
	}

	private block(edge: number): number {
		this.bridgeUnits[edge] = BLOCKED;
		return BLOCKED;
	}

	/** What impassable could stand in the squares the move from `cell` in forward `direction` runs through, as bits. */
	private hazardsOf(cell: number, direction: number): number {
		const squares = this.size - 1;
		const column = cell % this.size;
		const row = floor(cell / this.size);
		const hazards = this.hazards;
		const at = (squareColumn: number, squareRow: number) => (squareColumn >= 0 && squareRow >= 0 && squareColumn < squares && squareRow < squares
			? hazards[squareRow * squares + squareColumn] : ANYTHING);
		switch (direction) {
			case 0:
				return at(column, row - 1) | at(column, row);
			case 1:
				return at(column, row);
			case 2:
				return at(column - 1, row) | at(column, row);
			default:
				return at(column - 1, row);
		}
	}

	/**
	 * True when no sample along the move, every half unit, is impassable, bar
	 * river water under one of its bridges. Each sample asks only after what
	 * could stand in the move's squares (`hazards`), in `obstacle`'s terms.
	 */
	private clear(x0: number, y0: number, x1: number, y1: number, length: number, hazards: number): boolean {
		const terrain = this.terrain;
		const spans = this.spans;
		const bridges = (hazards & (RIVER | ANYTHING)) !== 0 ? terrain.bridgeSpans(x0, y0, x1, y1, spans) : 0;
		const samples = floor(length / SAMPLE_SPACING) + 1;
		const anything = (hazards & ANYTHING) !== 0;
		const craters = (hazards & CRATER) !== 0 ? terrain.hotspots : [];
		const wet = (hazards & (LAKE | RIVER)) !== 0;
		const rough = (hazards & ROUGH) !== 0;
		for (let sample = 1; sample < samples; sample += 1) {
			const along = sample / samples;
			const x = x0 + (x1 - x0) * along;
			const y = y0 + (y1 - y0) * along;
			let river = false;
			if (anything) {
				const obstacle = terrain.obstacle(x, y);
				if (obstacle === null) continue;
				if (obstacle !== 'river') return false;
				river = true;
			} else {
				for (const crater of craters) {
					const cx = x - crater.x;
					const cy = y - crater.y;
					if (cx * cx + cy * cy < crater.craterRadius * crater.craterRadius) return false;
				}
				if (wet) {
					const kind = terrain.waterAt(x, y);
					if (kind === 'lake') return false;
					river = kind === 'river' && x * x + y * y > this.bridgedSquared;
				}
				if (!river && rough && terrain.cliff(x, y)) return false;
			}
			if (!river) continue;
			let bridged = false;
			for (let span = 0; span < bridges && !bridged; span += 1) bridged = along >= spans[2 * span] && along <= spans[2 * span + 1];
			if (!bridged) return false;
		}
		return true;
	}
}

/**
 * Per square between cell centres, counted from the square whose lower-left
 * corner is cell 0's centre: what impassable could stand in it, as bits. A
 * cliff needs rough country, which reads bilinear off the cells, so it can
 * only stand in a square with a rough corner; a lake likewise needs a corner
 * under water. Rivers mark the squares their water, and a little more,
 * reaches into, and craters theirs. Anything could stand in a square with a
 * corner that isn't open.
 */
function hazardSquares({ terrain, rivers, open }: { terrain: Terrain; rivers: RiverLines | null; open: Uint8Array }): Uint8Array {
	const { grid } = terrain.surface;
	const size = grid.size;
	const squares = size - 1;
	const hazards = new Uint8Array(squares * squares);
	const risky = new Uint8Array(size * size);
	const water = terrain.water;
	for (let row = 0; row < size; row += 1) {
		const y = cellCentre(grid, row);
		for (let column = 0; column < size; column += 1) {
			const cell = row * size + column;
			const x = cellCentre(grid, column);
			risky[cell] = (open[cell] === 0 ? ANYTHING : 0) | (terrain.rough(x, y) ? ROUGH : 0) | (water !== null && water.lakeDepth(x, y) > -0.001 ? LAKE : 0);
		}
	}
	for (let row = 0; row < squares; row += 1) {
		for (let column = 0; column < squares; column += 1) {
			const cell = row * size + column;
			hazards[row * squares + column] = risky[cell] | risky[cell + 1] | risky[cell + size] | risky[cell + size + 1];
		}
	}
	const mark = (minX: number, minY: number, maxX: number, maxY: number, bit: number) => {
		const first = floor((minX + grid.halfExtent) / grid.cellSize - 0.5);
		const last = floor((maxX + grid.halfExtent) / grid.cellSize - 0.5);
		const bottom = floor((minY + grid.halfExtent) / grid.cellSize - 0.5);
		const top = floor((maxY + grid.halfExtent) / grid.cellSize - 0.5);
		for (let row = bottom < 0 ? 0 : bottom; row <= top && row < squares; row += 1) {
			for (let column = first < 0 ? 0 : first; column <= last && column < squares; column += 1) hazards[row * squares + column] |= bit;
		}
	};
	if (rivers !== null) {
		const { points, widths, offsets } = rivers;
		for (let river = 0; river + 1 < offsets.length; river += 1) {
			for (let point = offsets[river]; point + 1 < offsets[river + 1]; point += 1) {
				const reach = 0.5 * (widths[point] > widths[point + 1] ? widths[point] : widths[point + 1]) + RIVER_MARGIN;
				const ax = points[2 * point];
				const ay = points[2 * point + 1];
				const bx = points[2 * point + 2];
				const by = points[2 * point + 3];
				mark((ax < bx ? ax : bx) - reach, (ay < by ? ay : by) - reach, (ax < bx ? bx : ax) + reach, (ay < by ? by : ay) + reach, RIVER);
			}
		}
	}
	for (const { x, y, craterRadius } of terrain.hotspots) {
		const reach = craterRadius + RIVER_MARGIN;
		mark(x - reach, y - reach, x + reach, y + reach, CRATER);
	}
	return hazards;
}
