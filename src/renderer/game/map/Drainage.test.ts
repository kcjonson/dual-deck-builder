import { Rng } from '../core/Rng';
import { Drainage, DrainageRouter, FLOOD_RISE, routeDrainage } from './Drainage';

/** Heights for a square grid from a function of column and row, row 0 the southern edge. */
function heights(size: number, height: (column: number, row: number) => number): Float64Array {
	const values = new Float64Array(size * size);
	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) values[row * size + column] = height(column, row);
	}
	return values;
}

/** Whether two cells of a grid `size` across touch, diagonals included. */
function neighbours(size: number, a: number, b: number): boolean {
	const rowA = Math.floor(a / size);
	const rowB = Math.floor(b / size);
	return a !== b && Math.abs(rowA - rowB) <= 1 && Math.abs((a - rowA * size) - (b - rowB * size)) <= 1;
}

/** The outlet each cell's drainage reaches, following receivers, or -1 if it loops or runs out of steps. */
function outletOf(drainage: Drainage, cell: number): number {
	let at = cell;
	for (let step = 0; step <= drainage.receivers.length; step += 1) {
		const receiver = drainage.receivers[at];
		if (receiver < 0) return at;
		at = receiver;
	}
	return -1;
}

/** Checks every drainage keeps: receivers are neighbours, levels fall to them, the order is downstream first, and every cell reaches an outlet. */
function expectDrainageShape(drainage: Drainage, elevation: Float64Array): void {
	const { size, receivers, levels, order, outlets } = drainage;
	const cells = size * size;
	const place = new Int32Array(cells).fill(-1);
	order.forEach((cell, index) => {
		place[cell] = index;
	});
	expect(new Set(order).size).toBe(cells);
	for (let cell = 0; cell < cells; cell += 1) {
		const receiver = receivers[cell];
		expect(levels[cell]).toBeGreaterThanOrEqual(elevation[cell]);
		if (receiver < 0) {
			expect(Array.from(outlets)).toContain(cell);
			expect(levels[cell]).toBe(elevation[cell]);
			continue;
		}
		expect(neighbours(size, cell, receiver)).toBe(true);
		expect(levels[cell]).toBeGreaterThanOrEqual(levels[receiver] + FLOOD_RISE);
		expect(place[cell]).toBeGreaterThan(place[receiver]);
		expect(outlets).toContain(outletOf(drainage, cell));
	}
}

describe('routeDrainage', () => {
	it('runs every cell downhill to a neighbour, on to the outlet, downstream first', () => {
		const elevation = heights(6, (column, row) => column + 1.3 * row + 0.1 * ((column * 7 + row * 3) % 5));
		const drainage = routeDrainage({ size: 6, elevation, outlets: [0] });
		expectDrainageShape(drainage, elevation);
		drainage.receivers.forEach((receiver, cell) => {
			if (receiver >= 0) expect(elevation[receiver]).toBeLessThan(elevation[cell]);
		});
		expect(drainage.order[0]).toBe(0);
		expect(drainage.area[0]).toBe(36);
		// Nothing drains through the highest corner.
		expect(drainage.area[35]).toBe(1);
	});

	it('fills a pit as the flood reaches it and drains it over its spill, water standing in it', () => {
		// A plateau at 5 round a pit at 1, the outlet in the south-west corner.
		const elevation = heights(5, (column, row) => (column === 0 && row === 0 ? 0 : column === 2 && row === 2 ? 1 : 5));
		const drainage = routeDrainage({ size: 5, elevation, outlets: [0] });
		expectDrainageShape(drainage, elevation);
		const pit = 12;
		// The plateau floods at its own level, lowest index first, so the pit's
		// first neighbour to leave the queue is cell 6, which the outlet reached.
		expect(drainage.receivers[pit]).toBe(6);
		expect(drainage.levels[pit]).toBe(5 + FLOOD_RISE);
		expect(drainage.levels[pit]).toBeGreaterThan(elevation[pit]);
		expect(outletOf(drainage, pit)).toBe(0);
	});

	it('drains a closed basin to its one sink inside the grid', () => {
		const elevation = heights(7, (column, row) => Math.sqrt((column - 3) * (column - 3) + (row - 3) * (row - 3)));
		const sink = 3 * 7 + 3;
		const drainage = routeDrainage({ size: 7, elevation, outlets: [sink] });
		expectDrainageShape(drainage, elevation);
		expect(drainage.area[sink]).toBe(49);
		drainage.receivers.forEach((receiver, cell) => {
			if (receiver >= 0) expect(elevation[receiver]).toBeLessThan(elevation[cell]);
		});
	});

	it('leaves only by its outlets, each draining its own share', () => {
		const elevation = heights(8, (column, row) => Math.min(column + row, 14 - column - row) + 0.01 * column);
		const drainage = routeDrainage({ size: 8, elevation, outlets: [0, 63] });
		expectDrainageShape(drainage, elevation);
		expect(drainage.receivers.filter((receiver) => receiver < 0)).toHaveLength(2);
		expect(drainage.area[0] + drainage.area[63]).toBe(64);
		expect(drainage.area[0]).toBeGreaterThan(20);
		expect(drainage.area[63]).toBeGreaterThan(20);
	});

	it('breaks ties by cell index, never by the order the outlets are listed in', () => {
		// Two outlets at the same height either side of cell 1, on a flat.
		const flat = new Float64Array(9);
		const forward = routeDrainage({ size: 3, elevation: flat, outlets: [0, 2] });
		const backward = routeDrainage({ size: 3, elevation: flat, outlets: [2, 0] });
		expect(Array.from(backward.receivers)).toEqual(Array.from(forward.receivers));
		expect(Array.from(backward.order)).toEqual(Array.from(forward.order));
		// Cell 0 leaves the queue first, so it claims every neighbour it has.
		expect(forward.receivers[1]).toBe(0);
		expect(forward.receivers[3]).toBe(0);
		expect(forward.receivers[4]).toBe(0);
		expect(forward.receivers[5]).toBe(2);
		expectDrainageShape(forward, flat);
	});

	it('drains a flat outward from its outlet, rising a step a ring', () => {
		const flat = new Float64Array(25);
		const drainage = routeDrainage({ size: 5, elevation: flat, outlets: [12] });
		expectDrainageShape(drainage, flat);
		expect(drainage.levels[0]).toBe(2 * FLOOD_RISE);
		expect(drainage.levels[6]).toBe(FLOOD_RISE);
		expect(drainage.receivers[0]).toBe(6);
	});

	it('holds its shape over random land, and weighs area by rain', () => {
		const rng = new Rng({ seed: 41 });
		const elevation = heights(16, () => rng.float());
		const rain = heights(16, (column) => 1 + column);
		const drainage = routeDrainage({ size: 16, elevation, outlets: [0, 15, 200], rain });
		expectDrainageShape(drainage, elevation);
		const total = rain.reduce((sum, value) => sum + value, 0);
		expect(drainage.area[0] + drainage.area[15] + drainage.area[200]).toBeCloseTo(total, 9);
		drainage.receivers.forEach((receiver, cell) => {
			if (receiver >= 0) expect(drainage.area[receiver]).toBeGreaterThan(drainage.area[cell]);
		});
	});

	it('refuses no outlets, an outlet listed twice or off the grid, and heights that do not fill it', () => {
		const flat = new Float64Array(9);
		expect(() => routeDrainage({ size: 3, elevation: flat, outlets: [] })).toThrow(RangeError);
		expect(() => routeDrainage({ size: 3, elevation: flat, outlets: [1, 1] })).toThrow(RangeError);
		expect(() => routeDrainage({ size: 3, elevation: flat, outlets: [9] })).toThrow(RangeError);
		expect(() => routeDrainage({ size: 3, elevation: new Float64Array(8), outlets: [0] })).toThrow(RangeError);
		expect(() => routeDrainage({ size: 3, elevation: flat, outlets: [0], rain: new Float64Array(4) })).toThrow(RangeError);
	});
});

describe('DrainageRouter', () => {
	it('routes the same with a router reused across grids as with a fresh one', () => {
		const rng = new Rng({ seed: 5 });
		const first = heights(10, () => rng.float());
		const second = heights(10, () => rng.float());
		const router = new DrainageRouter({ size: 10 });
		router.route(first, [0, 99]);
		router.route(second, [0, 99]);
		router.accumulate();
		const fresh = routeDrainage({ size: 10, elevation: second, outlets: [0, 99] });
		expect(Array.from(router.receivers)).toEqual(Array.from(fresh.receivers));
		expect(Array.from(router.levels)).toEqual(Array.from(fresh.levels));
		expect(Array.from(router.order)).toEqual(Array.from(fresh.order));
		expect(Array.from(router.area)).toEqual(Array.from(fresh.area));
	});
});
