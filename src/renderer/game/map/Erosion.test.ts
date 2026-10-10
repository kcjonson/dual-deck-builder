import { Rng } from '../core/Rng';
import { DrainageRouter } from './Drainage';
import { downsample, erode, upsample } from './Erosion';

/** Heights for a square grid from a function of column and row, row 0 the southern edge. */
function heights(size: number, height: (column: number, row: number) => number): Float64Array {
	const values = new Float64Array(size * size);
	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) values[row * size + column] = height(column, row);
	}
	return values;
}

/** The distance in cells from a cell to its receiver: 1, or the square root of 2 to a diagonal. */
function stepTo(size: number, cell: number, receiver: number): number {
	const step = Math.abs(cell - receiver);
	return step === 1 || step === size ? 1 : Math.SQRT2;
}

describe('erode', () => {
	it('lifts every cell but the outlets by dt U an iteration when nothing erodes', () => {
		const elevation = heights(5, (column, row) => column + row);
		const uplift = heights(5, (column) => 0.1 * column);
		erode({ size: 5, elevation, uplift, outlets: [0], iterations: 3, timeStep: 2, erodibility: 0, diffusion: 0 });
		elevation.forEach((height, cell) => {
			const column = cell % 5;
			const row = Math.floor(cell / 5);
			expect(height).toBeCloseTo(cell === 0 ? 0 : column + row + 3 * 2 * 0.1 * column, 12);
		});
	});

	it('holds the outlets at their height', () => {
		const rng = new Rng({ seed: 3 });
		const elevation = heights(6, () => rng.float());
		const before = [elevation[0], elevation[35]];
		erode({ size: 6, elevation, uplift: new Float64Array(36).fill(0.2), outlets: [0, 35], iterations: 10, timeStep: 1, erodibility: 0.3, diffusion: 0.1 });
		expect([elevation[0], elevation[35]]).toEqual(before);
	});

	it('settles to stream power\'s steady state: each cell U d / (K sqrt(area)) above the cell it drains to', () => {
		const size = 8;
		const rng = new Rng({ seed: 8 });
		const elevation = heights(size, (column, row) => 0.05 * (column + row) + 0.01 * rng.float());
		const uplift = 0.01;
		const erodibility = 0.5;
		const router = erode({
			size, elevation, uplift: new Float64Array(size * size).fill(uplift), outlets: [0],
			iterations: 400, timeStep: 1, erodibility, diffusion: 0,
		});
		router.receivers.forEach((receiver, cell) => {
			if (receiver < 0) return;
			const expected = uplift * stepTo(size, cell, receiver) / (erodibility * Math.sqrt(router.area[cell]));
			expect(Math.abs(elevation[cell] - elevation[receiver] - expected)).toBeLessThan(1e-9);
			// So every cell stands above the one it drains to: water runs downhill.
			expect(elevation[cell]).toBeGreaterThan(elevation[receiver]);
		});
	});

	it('updates downstream first, each cell cut toward its receiver\'s new height by the square root of its area, never past it', () => {
		// A ramp down to outlets along the west edge.
		const size = 6;
		const start = heights(size, (column, row) => column + 0.01 * row);
		const elevation = Float64Array.from(start);
		const timeStep = 1.5;
		const erodibility = 0.4;
		const router = erode({ size, elevation, uplift: new Float64Array(size * size), outlets: [0, 6, 12, 18, 24, 30], iterations: 1, timeStep, erodibility, diffusion: 0 });
		const expected = Float64Array.from(start);
		router.order.forEach((cell) => {
			const receiver = router.receivers[cell];
			if (receiver < 0) return;
			const flow = timeStep * erodibility * Math.sqrt(router.area[cell]) / stepTo(size, cell, receiver);
			expected[cell] = (start[cell] + flow * expected[receiver]) / (1 + flow);
		});
		for (let cell = 0; cell < size * size; cell += 1) {
			expect(elevation[cell]).toBeCloseTo(expected[cell], 12);
			const receiver = router.receivers[cell];
			if (receiver < 0) continue;
			expect(elevation[cell]).toBeLessThan(start[cell]);
			expect(elevation[cell]).toBeGreaterThan(elevation[receiver]);
		}
	});

	it('smooths a spike with hillslope diffusion, a share of the four-neighbour Laplacian', () => {
		const elevation = new Float64Array(25);
		elevation[12] = 1;
		erode({ size: 5, elevation, uplift: new Float64Array(25), outlets: [0], iterations: 1, timeStep: 1, erodibility: 0, diffusion: 0.2 });
		expect(elevation[12]).toBeCloseTo(1 - 4 * 0.2, 12);
		[7, 11, 13, 17].forEach((cell) => expect(elevation[cell]).toBeCloseTo(0.2, 12));
		[6, 8, 16, 18].forEach((cell) => expect(elevation[cell]).toBe(0));
	});

	it('erodes the same with a router it is given as with its own', () => {
		const rng = new Rng({ seed: 13 });
		const start = heights(10, () => rng.float());
		const uplift = heights(10, () => 0.1 * rng.float());
		const options = { size: 10, uplift, outlets: [0, 9], iterations: 5, timeStep: 1.2, erodibility: 0.11, diffusion: 0.02 };
		const own = Float64Array.from(start);
		erode({ ...options, elevation: own });
		const given = Float64Array.from(start);
		const router = new DrainageRouter({ size: 10 });
		router.route(heights(10, () => 1), [5]);
		expect(erode({ ...options, elevation: given, router })).toBe(router);
		expect(Array.from(given)).toEqual(Array.from(own));
	});

	it('refuses arrays that do not fill the grid, unstable diffusion, and a router for another size', () => {
		const flat = new Float64Array(16);
		const base = { size: 4, elevation: flat, uplift: flat, outlets: [0], iterations: 1, timeStep: 1, erodibility: 0.1, diffusion: 0.1 };
		expect(() => erode({ ...base, uplift: new Float64Array(9) })).toThrow(RangeError);
		expect(() => erode({ ...base, diffusion: 0.3 })).toThrow(RangeError);
		expect(() => erode({ ...base, router: new DrainageRouter({ size: 5 }) })).toThrow(RangeError);
	});
});

describe('downsample and upsample', () => {
	it('averages each two by two into one cell', () => {
		const fine = heights(4, (column, row) => column + 10 * row);
		expect(Array.from(downsample(fine, 4))).toEqual([5.5, 7.5, 25.5, 27.5]);
		expect(() => downsample(new Float64Array(9), 3)).toThrow(RangeError);
	});

	it('interpolates between the coarse centres and holds the edges', () => {
		const coarse = heights(4, (column, row) => 2 * column - row);
		const fine = upsample(coarse, 4);
		// A fine centre sits a quarter of a coarse cell off a coarse centre, so a plane comes back as itself inside.
		for (let row = 1; row < 7; row += 1) {
			for (let column = 1; column < 7; column += 1) {
				expect(fine[row * 8 + column]).toBeCloseTo(2 * (column / 2 - 0.25) - (row / 2 - 0.25), 12);
			}
		}
		expect(fine[0]).toBe(coarse[0]);
		expect(fine[63]).toBe(coarse[15]);
		expect(Array.from(downsample(upsample(new Float64Array(16).fill(3), 4), 8))).toEqual(new Array(16).fill(3));
	});
});
