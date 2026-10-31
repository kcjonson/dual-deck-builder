import { Rng } from '../core/Rng';
import { Drainage, DrainageRouter, FLOOD_RISE, accumulateArea, routeDrainage } from './Drainage';

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

/**
 * The neighbour a cell falls to fastest per unit of distance on the levels,
 * ties to the lower index: what the routing has to pick.
 */
function steepestBelow({ size, levels }: Drainage, cell: number): number {
	const row = Math.floor(cell / size);
	const column = cell - row * size;
	let best = -1;
	let steepest = 0;
	for (let rowStep = -1; rowStep <= 1; rowStep += 1) {
		for (let columnStep = -1; columnStep <= 1; columnStep += 1) {
			const nextRow = row + rowStep;
			const nextColumn = column + columnStep;
			if ((rowStep === 0 && columnStep === 0) || nextRow < 0 || nextColumn < 0 || nextRow >= size || nextColumn >= size) continue;
			const next = nextRow * size + nextColumn;
			const drop = levels[cell] - levels[next];
			if (!(drop > 0)) continue;
			const fall = rowStep !== 0 && columnStep !== 0 ? drop * Math.SQRT1_2 : drop;
			if (fall > steepest || (fall === steepest && next < best)) {
				steepest = fall;
				best = next;
			}
		}
	}
	return best;
}

/**
 * The routing by its definition, to hold the router to: a priority flood from
 * the outlets, each cell entering at its own height or a flood rise above the
 * cell that reached it, whichever is higher, and settled the first time it's
 * the lowest reached, ties to the lower index, found by scanning every cell;
 * then each cell's steepest fall on the levels. Its order is the flood's, and
 * its area sums each cell into its receiver walking that order backwards.
 */
function floodByDefinition(size: number, elevation: ArrayLike<number>, outlets: number[], rain?: ArrayLike<number>) {
	const cells = size * size;
	const levels = new Float64Array(cells);
	const reached = new Uint8Array(cells);
	const settled = new Uint8Array(cells);
	outlets.forEach((outlet) => {
		levels[outlet] = elevation[outlet];
		reached[outlet] = 1;
	});
	const order: number[] = [];
	for (;;) {
		let cell = -1;
		for (let at = 0; at < cells; at += 1) {
			if (reached[at] === 1 && settled[at] === 0 && (cell < 0 || levels[at] < levels[cell])) cell = at;
		}
		if (cell < 0) break;
		settled[cell] = 1;
		order.push(cell);
		const raised = levels[cell] + FLOOD_RISE;
		const row = Math.floor(cell / size);
		const column = cell - row * size;
		for (let rowStep = -1; rowStep <= 1; rowStep += 1) {
			for (let columnStep = -1; columnStep <= 1; columnStep += 1) {
				const nextRow = row + rowStep;
				const nextColumn = column + columnStep;
				if (nextRow < 0 || nextColumn < 0 || nextRow >= size || nextColumn >= size) continue;
				const next = nextRow * size + nextColumn;
				if (reached[next] === 1) continue;
				reached[next] = 1;
				levels[next] = elevation[next] > raised ? elevation[next] : raised;
			}
		}
	}
	const drainage = { size, levels } as Drainage;
	const receivers = Int32Array.from({ length: cells }, (_, cell) => (outlets.includes(cell) ? -1 : steepestBelow(drainage, cell)));
	const area = Float64Array.from({ length: cells }, (_, cell) => (rain ? rain[cell] : 1));
	for (let index = order.length - 1; index >= 0; index -= 1) {
		const receiver = receivers[order[index]];
		if (receiver >= 0) area[receiver] += area[order[index]];
	}
	return { levels, receivers, area };
}

/** The router's drainage against floodByDefinition's: the same levels, receivers, and areas to the bit, with and without rain. */
function expectSameAsDefinition(size: number, elevation: Float64Array, outlets: number[], rain: Float64Array): void {
	const drainage = routeDrainage({ size, elevation, outlets });
	const definition = floodByDefinition(size, elevation, outlets);
	expect(Array.from(drainage.levels)).toEqual(Array.from(definition.levels));
	expect(Array.from(drainage.receivers)).toEqual(Array.from(definition.receivers));
	expect(Array.from(drainage.area)).toEqual(Array.from(definition.area));
	expect(Array.from(accumulateArea({ drainage, rain }))).toEqual(Array.from(floodByDefinition(size, elevation, outlets, rain).area));
	expectDrainageShape(drainage, elevation);
}

/** Checks every drainage keeps: receivers are the steepest neighbour below, levels fall to them, the order is downstream first, and every cell reaches an outlet. */
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
		expect(levels[cell]).toBeGreaterThan(levels[receiver]);
		expect(receiver).toBe(steepestBelow(drainage, cell));
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

	it.each([
		['10 degrees north of east drains east', 10, 1],
		['35 degrees north of east drains north-east', 35, 1 + 12],
		['80 degrees north of east drains north', 80, 12],
		['55 degrees north of west drains north-west', 125, 12 - 1],
	] as const)('runs straight down a slope, not to whichever neighbour the flood reached first: a plane falling %s', (_name, degrees, step) => {
		// Heights falling toward (cos, sin) of the angle, the outlets along the low edges.
		const size = 12;
		const radians = degrees * Math.PI / 180;
		const fallX = Math.cos(radians);
		const fallY = Math.sin(radians);
		const elevation = heights(size, (column, row) => 100 - fallX * column - fallY * row);
		const outlets: number[] = [];
		for (let index = 0; index < size; index += 1) {
			outlets.push((size - 1) * size + index);
			if (index < size - 1) outlets.push(index * size + (fallX > 0 ? size - 1 : 0));
		}
		const drainage = routeDrainage({ size, elevation, outlets });
		expectDrainageShape(drainage, elevation);
		for (let row = 1; row < size - 2; row += 1) {
			for (let column = 2; column < size - 2; column += 1) {
				const cell = row * size + column;
				expect(drainage.receivers[cell] - cell).toBe(step);
			}
		}
	});

	it('refuses no outlets, an outlet listed twice or off the grid, and heights that do not fill it', () => {
		const flat = new Float64Array(9);
		expect(() => routeDrainage({ size: 3, elevation: flat, outlets: [] })).toThrow(RangeError);
		expect(() => routeDrainage({ size: 3, elevation: flat, outlets: [1, 1] })).toThrow(RangeError);
		expect(() => routeDrainage({ size: 3, elevation: flat, outlets: [9] })).toThrow(RangeError);
		expect(() => routeDrainage({ size: 3, elevation: new Float64Array(8), outlets: [0] })).toThrow(RangeError);
		expect(() => routeDrainage({ size: 3, elevation: flat, outlets: [0], rain: new Float64Array(4) })).toThrow(RangeError);
		expect(() => routeDrainage({ size: 3, elevation: flat, outlets: [0], router: new DrainageRouter({ size: 4 }) })).toThrow(RangeError);
		// An outlet's height that isn't a number leaves every level unknown and no cell anywhere to drain: a mistake to report, not a drainage to return.
		const broken = Float64Array.from([NaN, 1, 2, 1, 2, 3, 2, 3, 4]);
		expect(() => routeDrainage({ size: 3, elevation: broken, outlets: [0] })).toThrow(/outlet 0's height, NaN, isn't a number/);
		expect(() => routeDrainage({ size: 3, elevation: broken, outlets: [0] })).toThrow(RangeError);
	});
});

describe('the router against the flood by definition', () => {
	/** A grid's outlets: one to three cells, on the edge or inside, drawn from `rng`. */
	function outletsFor(size: number, rng: Rng): number[] {
		const outlets = new Set<number>();
		const count = 1 + Math.floor(rng.float() * 3);
		while (outlets.size < count) outlets.add(Math.floor(rng.float() * size * size));
		return [...outlets];
	}

	it('routes random land the same, pits and all', () => {
		for (let seed = 1; seed <= 30; seed += 1) {
			const rng = new Rng({ seed });
			const size = 3 + (seed % 18);
			const elevation = heights(size, () => rng.float());
			expectSameAsDefinition(size, elevation, outletsFor(size, rng), heights(size, () => 0.5 + rng.float()));
		}
	});

	it('routes terraced land the same, its flats and plateaus filled outward from their spills', () => {
		for (let seed = 1; seed <= 30; seed += 1) {
			const rng = new Rng({ seed: 100 + seed });
			const size = 4 + (seed % 17);
			const elevation = heights(size, () => Math.floor(4 * rng.float()) / 4);
			expectSameAsDefinition(size, elevation, outletsFor(size, rng), heights(size, () => 0.5 + rng.float()));
		}
	});

	it('routes land whose neighbours lie less than a flood rise apart the same', () => {
		for (let seed = 1; seed <= 20; seed += 1) {
			const rng = new Rng({ seed: 200 + seed });
			const size = 5 + (seed % 12);
			const elevation = heights(size, (column, row) => 0.3 * (column + row) * FLOOD_RISE + Math.floor(3 * rng.float()) * FLOOD_RISE / 3);
			expectSameAsDefinition(size, elevation, outletsFor(size, rng), heights(size, () => 0.5 + rng.float()));
		}
	});

	it('floods a cell whose height isn\'t a number as it does a pit, to a flood rise above its lowest neighbour', () => {
		const rng = new Rng({ seed: 7 });
		const elevation = heights(9, () => rng.float());
		elevation[40] = NaN;
		const drainage = routeDrainage({ size: 9, elevation, outlets: [0] });
		const definition = floodByDefinition(9, elevation, [0]);
		expect(Array.from(drainage.levels)).toEqual(Array.from(definition.levels));
		expect(Array.from(drainage.receivers)).toEqual(Array.from(definition.receivers));
		expect(drainage.levels[40]).toBeGreaterThan(0);
	});

	it('floods a lake too wide for its spill\'s band over its whole basin, and still matches', () => {
		// A channel at height 0 winding back and forth through walls at 1, from
		// an outlet at its west end: over 1000 cells long, so its far end's water
		// stands more than 1000 flood rises above the spill. A cell beside the far
		// end stands just under that, and above the band the flood first looks in.
		const size = 48;
		const floor = (column: number, row: number) => {
			if (row % 2 === 1 && row <= size - 3 && column >= 1 && column <= size - 2) return true;
			if (row % 2 === 0 && row >= 2 && row <= size - 4) return column === ((row / 2) % 2 === 1 ? size - 2 : 1);
			return false;
		};
		const shore = (size - 2) * size + size - 2;
		const elevation = heights(size, (column, row) => (floor(column, row) ? 0 : 1));
		elevation[size] = 0;
		elevation[shore] = 1010 * FLOOD_RISE;
		const outlets = [size];
		const definition = floodByDefinition(size, elevation, outlets);
		expect(definition.levels[shore]).toBeGreaterThan(elevation[shore]);
		const rng = new Rng({ seed: 3 });
		expectSameAsDefinition(size, elevation, outlets, heights(size, () => 0.5 + rng.float()));
	});

	it('sums rain the same over any downstream-first order', () => {
		const rng = new Rng({ seed: 23 });
		const elevation = heights(14, () => Math.floor(6 * rng.float()) / 6);
		const rain = heights(14, () => 0.1 + rng.float());
		const drainage = routeDrainage({ size: 14, elevation, outlets: [0, 195] });
		// The cells by level, then index: downstream first too, as each level is above its receiver's.
		const byLevel = Int32Array.from(drainage.order).sort((a, b) => drainage.levels[a] - drainage.levels[b] || a - b);
		expect(Array.from(byLevel)).not.toEqual(Array.from(drainage.order));
		const area = accumulateArea({ drainage, rain });
		expect(Array.from(accumulateArea({ drainage: { ...drainage, order: byLevel }, rain }))).toEqual(Array.from(area));
	});
});

describe('accumulateArea', () => {
	it('weighs a routing already made by rain, into a new array, leaving the drainage alone', () => {
		const rng = new Rng({ seed: 17 });
		const elevation = heights(9, () => rng.float());
		const drainage = routeDrainage({ size: 9, elevation, outlets: [0, 80] });
		const before = Array.from(drainage.area);
		const rain = heights(9, (column, row) => 0.5 + 0.1 * (column + row));
		const area = accumulateArea({ drainage, rain });
		expect(Array.from(drainage.area)).toEqual(before);
		expect(Array.from(area)).toEqual(Array.from(routeDrainage({ size: 9, elevation, outlets: [0, 80], rain }).area));
		expect(Array.from(accumulateArea({ drainage }))).toEqual(before);
		expect(() => accumulateArea({ drainage, rain: new Float64Array(5) })).toThrow(/^accumulateArea: /);
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

	it('routes the same after a routing that threw partway as a fresh router does', () => {
		// A cell walled in by infinite heights never gets a level, so it has no
		// receiver, which the router finds only after it has flooded.
		const walled = heights(10, (column, row) => (Math.max(Math.abs(column - 5), Math.abs(row - 5)) === 1 ? Infinity : column + row));
		const router = new DrainageRouter({ size: 10 });
		expect(() => router.route(walled, [0])).toThrow(/no neighbour below it/);
		const rng = new Rng({ seed: 11 });
		const land = heights(10, () => Math.floor(5 * rng.float()) / 5);
		router.route(land, [0, 99]);
		router.accumulate();
		const fresh = routeDrainage({ size: 10, elevation: land, outlets: [0, 99] });
		expect(Array.from(router.receivers)).toEqual(Array.from(fresh.receivers));
		expect(Array.from(router.levels)).toEqual(Array.from(fresh.levels));
		expect(Array.from(router.order)).toEqual(Array.from(fresh.order));
		expect(Array.from(router.area)).toEqual(Array.from(fresh.area));
	});
});
