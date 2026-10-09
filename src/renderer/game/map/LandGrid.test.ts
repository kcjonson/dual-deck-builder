import { CELLS_PER_RADIUS, GRID_REACH, GridSampler, LandGrid, cellAt, cellCentre, coarseGrid, landGridFor } from './LandGrid';

/** A grid `size` cells a side over a square `2 * halfExtent` across. */
const gridOf = (size: number, halfExtent = size): LandGrid => ({ size, cellSize: 2 * halfExtent / size, halfExtent });

/** Values per cell from a function of the cell centre. */
function valuesOf(grid: LandGrid, field: (x: number, y: number) => number): Float64Array {
	const values = new Float64Array(grid.size * grid.size);
	for (let row = 0; row < grid.size; row += 1) {
		for (let column = 0; column < grid.size; column += 1) values[row * grid.size + column] = field(cellCentre(grid, column), cellCentre(grid, row));
	}
	return values;
}

describe('landGridFor', () => {
	it('reaches a fifth past the disc each way, 256 cells a side at radius 1000', () => {
		const grid = landGridFor(1000);
		expect(grid.size).toBe(256);
		expect(grid.halfExtent).toBe(GRID_REACH * 1000);
		expect(grid.cellSize).toBeCloseTo(9.375, 12);
	});

	it('scales the cells with the radius, so they stay about the same size, and keeps their number even', () => {
		[600, 800, 1000, 1200, 1600, 777].forEach((radius) => {
			const grid = landGridFor(radius);
			expect(grid.size % 2).toBe(0);
			expect(Math.abs(grid.size - radius * CELLS_PER_RADIUS)).toBeLessThanOrEqual(1);
			expect(grid.cellSize).toBeGreaterThan(9.3);
			expect(grid.cellSize).toBeLessThan(9.45);
			expect(grid.size * grid.cellSize).toBeCloseTo(2 * grid.halfExtent, 9);
		});
	});

	it('halves for the coarse pass over the same square', () => {
		const grid = landGridFor(1000);
		expect(coarseGrid(grid)).toEqual({ size: 128, cellSize: 18.75, halfExtent: 1200 });
	});
});

describe('cells', () => {
	const grid = gridOf(8, 40);

	it('numbers cells row by row from the south-west corner', () => {
		expect(cellCentre(grid, 0)).toBe(-35);
		expect(cellCentre(grid, 7)).toBe(35);
		expect(cellAt(grid, -39.9, -39.9)).toBe(0);
		expect(cellAt(grid, 39.9, -39.9)).toBe(7);
		expect(cellAt(grid, -39.9, 39.9)).toBe(56);
		expect(cellAt(grid, cellCentre(grid, 3), cellCentre(grid, 5))).toBe(5 * 8 + 3);
	});

	it('finds no cell off the grid', () => {
		expect(cellAt(grid, -40.1, 0)).toBe(-1);
		expect(cellAt(grid, 0, 40)).toBe(-1);
		expect(cellAt(grid, 40, 0)).toBe(-1);
	});
});

describe('GridSampler', () => {
	const grid = gridOf(12, 60);

	it('passes through every cell centre', () => {
		const values = valuesOf(grid, (x, y) => Math.sin(x / 7) * Math.cos(y / 5));
		const sampler = new GridSampler({ grid, values });
		for (let row = 1; row < grid.size - 2; row += 1) {
			for (let column = 1; column < grid.size - 2; column += 1) {
				expect(sampler.bicubic(cellCentre(grid, column), cellCentre(grid, row))).toBeCloseTo(values[row * grid.size + column], 12);
				expect(sampler.bilinear(cellCentre(grid, column), cellCentre(grid, row))).toBeCloseTo(values[row * grid.size + column], 12);
			}
		}
	});

	it('reproduces a plane exactly, value and gradient, between the centres', () => {
		const sampler = new GridSampler({ grid, values: valuesOf(grid, (x, y) => 0.25 + 0.01 * x - 0.03 * y) });
		[[1.3, -7.9], [-22.2, 14.1], [0, 0], [31.7, 30.1]].forEach(([x, y]) => {
			expect(sampler.bicubic(x, y)).toBeCloseTo(0.25 + 0.01 * x - 0.03 * y, 12);
			expect(sampler.gradientX).toBeCloseTo(0.01, 12);
			expect(sampler.gradientY).toBeCloseTo(-0.03, 12);
		});
	});

	it('gives the exact gradient of what it samples, smooth across cell edges', () => {
		const values = valuesOf(grid, (x, y) => Math.sin(x / 9) + Math.cos(y / 6) * Math.sin((x + y) / 13));
		const sampler = new GridSampler({ grid, values });
		const step = 1e-6;
		// Every point here sits on a line of cell centres, where the cubic pieces meet.
		[-35, -25, -5, 5, 15, 25].forEach((edge) => {
			[-30.3, -4.4, 12.7, 28.1].forEach((across) => {
				[[edge, across], [across, edge]].forEach(([x, y]) => {
					sampler.bicubic(x, y);
					const gradientX = sampler.gradientX;
					const gradientY = sampler.gradientY;
					const east = sampler.bicubic(x + step, y);
					const west = sampler.bicubic(x - step, y);
					const north = sampler.bicubic(x, y + step);
					const south = sampler.bicubic(x, y - step);
					expect(Math.abs((east - west) / (2 * step) - gradientX)).toBeLessThan(1e-7);
					expect(Math.abs((north - south) / (2 * step) - gradientY)).toBeLessThan(1e-7);
				});
			});
		});
	});

	it('holds its edge values past the outermost centres it can reach, flat there', () => {
		const sampler = new GridSampler({ grid, values: valuesOf(grid, (x, y) => x + 2 * y) });
		const inner = sampler.bicubic(cellCentre(grid, 1), 0);
		expect(sampler.bicubic(-1000, 0)).toBeCloseTo(inner, 12);
		expect(sampler.gradientX).toBe(0);
		expect(sampler.gradientY).toBeCloseTo(2, 12);
		expect(sampler.bilinear(-1000, -1000)).toBe(sampler.bilinear(cellCentre(grid, 0), cellCentre(grid, 0)));
	});

	it('reads a coordinate that isn\'t a number as the low edge, never as NaN', () => {
		const values = valuesOf(grid, (x, y) => 2 + x / 100 + y / 50);
		const sampler = new GridSampler({ grid, values });
		const edgeX = sampler.bicubic(-1000, 7);
		expect(sampler.bicubic(NaN, 7)).toBe(edgeX);
		expect(sampler.gradientX).toBe(0);
		expect(Number.isFinite(sampler.gradientY)).toBe(true);
		expect(Number.isFinite(sampler.bicubic(NaN, NaN))).toBe(true);
		expect(sampler.bilinear(NaN, 3)).toBe(sampler.bilinear(-1000, 3));
		expect(Number.isFinite(sampler.bilinear(NaN, NaN))).toBe(true);
		expect(cellAt(grid, NaN, 0)).toBe(-1);
		expect(cellAt(grid, 0, NaN)).toBe(-1);
	});

	it('refuses values that do not fill the grid, and grids too small to sample bicubic', () => {
		expect(() => new GridSampler({ grid, values: new Float64Array(10) })).toThrow(RangeError);
		expect(() => new GridSampler({ grid: gridOf(3), values: new Float64Array(9) })).toThrow(RangeError);
	});
});
