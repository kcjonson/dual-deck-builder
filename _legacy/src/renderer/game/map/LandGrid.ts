/**
 * The square grid the area map's land is generated on (Area Map Generation,
 * World space): a fifth wider than the disc each way, about 9.4 world units
 * a cell, so the disc is a window onto a larger country and rivers and
 * ranges run past its rim. Cells run row by row from the south-west corner:
 * cell `row * size + column` is centred at
 * (-halfExtent + (column + 0.5) * cellSize, -halfExtent + (row + 0.5) * cellSize).
 */
export interface LandGrid {
	/** Cells along each side, always even, so a grid of half the size covers it two cells to one. */
	readonly size: number;
	/** World units across a cell. */
	readonly cellSize: number;
	/** World units from the compound to each edge. */
	readonly halfExtent: number;
}

/** The grid reaches this many times the disc's radius from the compound each way. */
export const GRID_REACH = 1.2;
/** Cells along a side per world unit of radius: 256 at radius 1000, about 9.4 units a cell. */
export const CELLS_PER_RADIUS = 0.256;

// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const floor = Math.floor;
const round = Math.round;

/** The grid for a disc of `radius`: an even number of cells, scaled with the radius so cells stay about the same size. */
export function landGridFor(radius: number): LandGrid {
	const size = 2 * round(radius * CELLS_PER_RADIUS / 2);
	const halfExtent = GRID_REACH * radius;
	return { size, cellSize: 2 * halfExtent / size, halfExtent };
}

/** The grid half the size over the same square, for erosion's coarse pass. */
export function coarseGrid(grid: LandGrid): LandGrid {
	return { size: grid.size / 2, cellSize: grid.cellSize * 2, halfExtent: grid.halfExtent };
}

/** World x of a column's centres, or y of a row's. */
export function cellCentre(grid: LandGrid, index: number): number {
	return -grid.halfExtent + (index + 0.5) * grid.cellSize;
}

/** The cell holding (x, y), or -1 off the grid or for a coordinate that isn't a number. */
export function cellAt(grid: LandGrid, x: number, y: number): number {
	const column = floor((x + grid.halfExtent) / grid.cellSize);
	const row = floor((y + grid.halfExtent) / grid.cellSize);
	if (!(column >= 0 && row >= 0 && column < grid.size && row < grid.size)) return -1;
	return row * grid.size + column;
}

/**
 * Reads a per-cell field at any point. `bicubic` is Catmull-Rom through the
 * cell centres, smooth in value and slope, so hill shading and slopes show no
 * facets; it leaves its exact gradient in `gradientX` and `gradientY`, per
 * world unit. Catmull-Rom needs a centre either side of the two it runs
 * between, so it covers the square out to the second centre from each edge
 * and holds the value there past it, its gradient across the edge 0 and
 * along it the edge's. `bilinear`, for fields nothing differentiates, runs
 * out to the outermost centres and holds the edge value past them. A
 * coordinate that isn't a number reads as the low edge. Sampling is adds,
 * multiplies, and compares, and allocates nothing.
 */
export class GridSampler {
	/** The gradient the last `bicubic` call left, per world unit east... */
	public gradientX = 0;
	/** ...and north. */
	public gradientY = 0;

	private readonly size: number;
	private readonly cellSize: number;
	private readonly halfExtent: number;
	private readonly values: ArrayLike<number>;

	constructor({ grid, values }: { grid: LandGrid; values: ArrayLike<number> }) {
		if (values.length !== grid.size * grid.size) throw new RangeError(`GridSampler: expected ${grid.size * grid.size} values, got ${values.length}`);
		if (grid.size < 4) throw new RangeError(`GridSampler: a grid needs 4 cells a side for bicubic sampling, got ${grid.size}`);
		this.size = grid.size;
		this.cellSize = grid.cellSize;
		this.halfExtent = grid.halfExtent;
		this.values = values;
	}

	public bicubic(x: number, y: number): number {
		const size = this.size;
		const values = this.values;
		const fx = (x + this.halfExtent) / this.cellSize - 0.5;
		const fy = (y + this.halfExtent) / this.cellSize - 0.5;
		// The cell whose centre is at or before the point, kept a cell in from
		// each edge so all four rows and columns exist.
		let column = floor(fx);
		if (!(column >= 1)) column = 1;
		else if (column > size - 3) column = size - 3;
		let row = floor(fy);
		if (!(row >= 1)) row = 1;
		else if (row > size - 3) row = size - 3;
		let tx = fx - column;
		let ty = fy - row;
		let rateX = 1 / this.cellSize;
		let rateY = rateX;
		if (!(tx >= 0 && tx <= 1)) {
			tx = tx > 1 ? 1 : 0;
			rateX = 0;
		}
		if (!(ty >= 0 && ty <= 1)) {
			ty = ty > 1 ? 1 : 0;
			rateY = 0;
		}

		// Catmull-Rom weights for the four centres along each axis, and their derivatives.
		const tx2 = tx * tx;
		const tx3 = tx2 * tx;
		const wx0 = 0.5 * (2 * tx2 - tx - tx3);
		const wx1 = 0.5 * (2 - 5 * tx2 + 3 * tx3);
		const wx2 = 0.5 * (tx + 4 * tx2 - 3 * tx3);
		const wx3 = 0.5 * (tx3 - tx2);
		const dx0 = 0.5 * (4 * tx - 1 - 3 * tx2);
		const dx1 = 0.5 * (9 * tx2 - 10 * tx);
		const dx2 = 0.5 * (1 + 8 * tx - 9 * tx2);
		const dx3 = 0.5 * (3 * tx2 - 2 * tx);
		const ty2 = ty * ty;
		const ty3 = ty2 * ty;
		const wy0 = 0.5 * (2 * ty2 - ty - ty3);
		const wy1 = 0.5 * (2 - 5 * ty2 + 3 * ty3);
		const wy2 = 0.5 * (ty + 4 * ty2 - 3 * ty3);
		const wy3 = 0.5 * (ty3 - ty2);
		const dy0 = 0.5 * (4 * ty - 1 - 3 * ty2);
		const dy1 = 0.5 * (9 * ty2 - 10 * ty);
		const dy2 = 0.5 * (1 + 8 * ty - 9 * ty2);
		const dy3 = 0.5 * (3 * ty2 - 2 * ty);

		let at = (row - 1) * size + column - 1;
		let p0 = values[at];
		let p1 = values[at + 1];
		let p2 = values[at + 2];
		let p3 = values[at + 3];
		const row0 = wx0 * p0 + wx1 * p1 + wx2 * p2 + wx3 * p3;
		const slope0 = dx0 * p0 + dx1 * p1 + dx2 * p2 + dx3 * p3;
		at += size;
		p0 = values[at];
		p1 = values[at + 1];
		p2 = values[at + 2];
		p3 = values[at + 3];
		const row1 = wx0 * p0 + wx1 * p1 + wx2 * p2 + wx3 * p3;
		const slope1 = dx0 * p0 + dx1 * p1 + dx2 * p2 + dx3 * p3;
		at += size;
		p0 = values[at];
		p1 = values[at + 1];
		p2 = values[at + 2];
		p3 = values[at + 3];
		const row2 = wx0 * p0 + wx1 * p1 + wx2 * p2 + wx3 * p3;
		const slope2 = dx0 * p0 + dx1 * p1 + dx2 * p2 + dx3 * p3;
		at += size;
		p0 = values[at];
		p1 = values[at + 1];
		p2 = values[at + 2];
		p3 = values[at + 3];
		const row3 = wx0 * p0 + wx1 * p1 + wx2 * p2 + wx3 * p3;
		const slope3 = dx0 * p0 + dx1 * p1 + dx2 * p2 + dx3 * p3;

		this.gradientX = (wy0 * slope0 + wy1 * slope1 + wy2 * slope2 + wy3 * slope3) * rateX;
		this.gradientY = (dy0 * row0 + dy1 * row1 + dy2 * row2 + dy3 * row3) * rateY;
		return wy0 * row0 + wy1 * row1 + wy2 * row2 + wy3 * row3;
	}

	public bilinear(x: number, y: number): number {
		const size = this.size;
		const values = this.values;
		const fx = (x + this.halfExtent) / this.cellSize - 0.5;
		const fy = (y + this.halfExtent) / this.cellSize - 0.5;
		let column = floor(fx);
		if (!(column >= 0)) column = 0;
		else if (column > size - 2) column = size - 2;
		let row = floor(fy);
		if (!(row >= 0)) row = 0;
		else if (row > size - 2) row = size - 2;
		let tx = fx - column;
		let ty = fy - row;
		tx = tx > 1 ? 1 : tx >= 0 ? tx : 0;
		ty = ty > 1 ? 1 : ty >= 0 ? ty : 0;
		const at = row * size + column;
		const south = values[at] + (values[at + 1] - values[at]) * tx;
		const north = values[at + size] + (values[at + size + 1] - values[at + size]) * tx;
		return south + (north - south) * ty;
	}
}
