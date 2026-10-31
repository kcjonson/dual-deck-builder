import { Rng } from '../core/Rng';
import { routeDrainage } from './Drainage';
import { NATURAL_LAKE, RESERVOIR, emptyLakeCells, lakeDepthField, naturalLakes, placeReservoirs, valleyDepth } from './Lakes';
import { LandGrid, cellAt } from './LandGrid';

/** A grid of 64 cells of 10 units, elevation 1 standing 100 world units. */
const GRID: LandGrid = { size: 64, cellSize: 10, halfExtent: 320 };
const SIZE = GRID.size;
const RELIEF = 100;

/**
 * A valley draining south to an outlet on the south edge: its floor falls
 * 0.4 world units a cell, its sides rise 3 a cell either way, and a side
 * valley joins it from the east at row 40.
 */
function valley(): { elevation: Float64Array; outlet: number } {
	const elevation = new Float64Array(SIZE * SIZE);
	const middle = SIZE / 2;
	for (let row = 0; row < SIZE; row += 1) {
		for (let column = 0; column < SIZE; column += 1) {
			const across = Math.abs(column - middle);
			const side = column > middle && Math.abs(row - 40) < 2 ? 0.2 * across : across;
			elevation[row * SIZE + column] = (0.4 * row + 3 * side) / RELIEF + 1e-6 * ((row * 7 + column * 13) % 5);
		}
	}
	return { elevation, outlet: middle };
}

/** The cells of lake `id`, by the depth field and the lake cells. */
function cellsOf(lakeOf: Int32Array, id: number): number[] {
	return Array.from(lakeOf.keys()).filter((cell) => lakeOf[cell] === id);
}

/** Whether water at `level` runs between neighbouring cells: side by side, or corner to corner where the four cells round the corner average under it. */
function joined(elevation: Float64Array, cell: number, next: number, level: number): boolean {
	const [column, row, nextColumn, nextRow] = [cell % SIZE, Math.floor(cell / SIZE), next % SIZE, Math.floor(next / SIZE)];
	if (column === nextColumn || row === nextRow) return true;
	return (elevation[cell] + elevation[next] + elevation[row * SIZE + nextColumn] + elevation[nextRow * SIZE + column]) / 4 < level - 0.002;
}

/**
 * The land beside lake `id`, joined to it, outside it, and under its level,
 * that its dam's wall doesn't hold back: where its water would run over a
 * saddle. The wall runs `RESERVOIR.wall` cells each side of the dam, square
 * to its outflow, and holds what's on its line or below it from the lake
 * cells on its line or above it.
 */
function spills(lakeOf: Int32Array, elevation: Float64Array, id: number, level: number, dam: { cell: number; towardColumn: number; towardRow: number } | null): number[] {
	const span = dam && dam.towardColumn !== 0 && dam.towardRow !== 0 ? 2 * RESERVOIR.wall : RESERVOIR.wall;
	const place = (cell: number) => {
		if (!dam) return { ahead: -1, across: Infinity };
		const dx = (cell % SIZE) - (dam.cell % SIZE);
		const dy = Math.floor(cell / SIZE) - Math.floor(dam.cell / SIZE);
		return { ahead: dx * dam.towardColumn + dy * dam.towardRow, across: Math.abs(dy * dam.towardColumn - dx * dam.towardRow) };
	};
	const out: number[] = [];
	cellsOf(lakeOf, id).forEach((cell) => {
		const from = place(cell);
		const behind = cell === dam?.cell || (from.ahead <= 0 && from.across <= span);
		for (let dy = -1; dy <= 1; dy += 1) {
			for (let dx = -1; dx <= 1; dx += 1) {
				const next = cell + dy * SIZE + dx;
				if (next === cell || lakeOf[next] === id || !(elevation[next] < level) || !joined(elevation, cell, next, level)) continue;
				const to = place(next);
				if (behind && to.ahead >= 0 && to.across <= span) continue;
				out.push(next);
			}
		}
	});
	return out;
}

/** Whether lake `id`'s cells are one piece, joined as `joined` joins them. */
function onePiece(lakeOf: Int32Array, elevation: Float64Array, id: number, level: number): boolean {
	const cells = cellsOf(lakeOf, id);
	const seen = new Set([cells[0]]);
	const queue = [cells[0]];
	while (queue.length > 0) {
		const cell = queue.pop() as number;
		for (let dy = -1; dy <= 1; dy += 1) {
			for (let dx = -1; dx <= 1; dx += 1) {
				const next = cell + dy * SIZE + dx;
				if (lakeOf[next] !== id || seen.has(next) || !joined(elevation, cell, next, level)) continue;
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return seen.size === cells.length;
}

describe('valleyDepth', () => {
	it('measures how far a cell lies below the lower of the cells three away either side, across the deepest direction', () => {
		const { elevation } = valley();
		const floor = 30 * SIZE + SIZE / 2;
		expect(valleyDepth(elevation, SIZE, floor) * RELIEF).toBeCloseTo(9, 3);
		// On the valley's side the land only climbs one way.
		expect(valleyDepth(elevation, SIZE, floor + 6)).toBeLessThan(1e-4);
		// Too near the edge to measure.
		expect(valleyDepth(elevation, SIZE, 1 * SIZE + 10)).toBe(0);
	});
});

describe('placeReservoirs', () => {
	const { elevation, outlet } = valley();
	const routed = routeDrainage({ size: SIZE, elevation, outlets: [outlet] });
	const place = (options: { count: number; blocked?: Uint8Array; seed?: number }) => {
		const lakes = emptyLakeCells(SIZE * SIZE);
		placeReservoirs({
			grid: GRID, elevation, receivers: routed.receivers, area: routed.area, threshold: 20, count: options.count, radius: 270, inner: 0,
			relief: RELIEF, blocked: options.blocked ?? new Uint8Array(SIZE * SIZE), rng: new Rng({ seed: options.seed ?? 1 }), into: lakes,
		});
		return lakes;
	};

	it('dams a river in a valley and floods it upstream only, up the valley and its side branch, to one level', () => {
		const lakes = place({ count: 1 });
		expect(lakes.lakes).toHaveLength(1);
		const [lake] = lakes.lakes;
		expect(lake.kind).toBe('reservoir');
		if (!lake.dam) throw new Error('a reservoir has a dam');
		const dam = cellAt(GRID, lake.dam.x, lake.dam.y);
		const cells = cellsOf(lakes.lakeOf, 0);
		expect(cells).toHaveLength(lake.cells);
		expect(lake.cells).toBeGreaterThanOrEqual(RESERVOIR.cells.min);
		expect(lake.cells).toBeLessThanOrEqual(RESERVOIR.cells.max);
		const depth = (lake.level - elevation[dam]) * RELIEF;
		expect(depth).toBeGreaterThanOrEqual(RESERVOIR.depth.min);
		expect(depth).toBeLessThanOrEqual(RESERVOIR.depth.max);
		cells.forEach((cell) => {
			expect(elevation[cell]).toBeLessThan(lake.level);
			expect(lakes.level[cell]).toBe(lake.level);
			// Every cell of it drains to the dam through the lake.
			let at = cell;
			while (at !== dam) {
				expect(lakes.lakeOf[at]).toBe(0);
				at = routed.receivers[at];
			}
		});
		// Below the dam the river runs on dry, and the dam lets it out the way it ran.
		expect(lakes.lakeOf[routed.receivers[dam]]).toBe(-1);
		const below = routed.receivers[dam];
		expect(Math.hypot(lake.dam.towardX, lake.dam.towardY)).toBeCloseTo(1, 12);
		expect(lake.dam.towardX * ((below % SIZE) - (dam % SIZE)) + lake.dam.towardY * (Math.floor(below / SIZE) - Math.floor(dam / SIZE))).toBeGreaterThan(0);
		// One piece, and held: nothing beside it under its level but behind the wall.
		expect(onePiece(lakes.lakeOf, elevation, 0, lake.level)).toBe(true);
		const toward = { cell: dam, towardColumn: (below % SIZE) - (dam % SIZE), towardRow: Math.floor(below / SIZE) - Math.floor(dam / SIZE) };
		expect(spills(lakes.lakeOf, elevation, 0, lake.level, toward)).toEqual([]);
	});

	it('stops the water at the lowest saddle out of its valley, short of spilling over it', () => {
		// Up the valley, a col in its east wall at rows 57 to 59, half a unit over the floor at row 58, and past it a channel east to an outlet of its own.
		const { elevation: land, outlet: south } = valley();
		const middle = SIZE / 2;
		const col = (0.4 * 58 + 0.5) / RELIEF;
		for (let row = 57; row <= 59; row += 1) {
			for (let column = middle + 1; column < SIZE; column += 1) land[row * SIZE + column] = col - 0.2 * (column - middle - 1) / RELIEF;
		}
		const east = 58 * SIZE + SIZE - 1;
		const drained = routeDrainage({ size: SIZE, elevation: land, outlets: [south, east] });
		let held = 0;
		for (let seed = 1; seed <= 8; seed += 1) {
			const lakes = emptyLakeCells(SIZE * SIZE);
			placeReservoirs({
				grid: GRID, elevation: land, receivers: drained.receivers, area: drained.area, threshold: 20, count: 1, radius: 270, inner: 0,
				relief: RELIEF, blocked: new Uint8Array(SIZE * SIZE), rng: new Rng({ seed }), into: lakes,
			});
			lakes.lakes.forEach((lake, id) => {
				if (!lake.dam) return;
				const dam = cellAt(GRID, lake.dam.x, lake.dam.y);
				const below = drained.receivers[dam];
				const toward = { cell: dam, towardColumn: (below % SIZE) - (dam % SIZE), towardRow: Math.floor(below / SIZE) - Math.floor(dam / SIZE) };
				expect(spills(lakes.lakeOf, land, id, lake.level, toward)).toEqual([]);
				// A lake that reaches the col's rows from below them stands no higher than the col.
				if (cellsOf(lakes.lakeOf, id).some((cell) => Math.floor(cell / SIZE) >= 57) && Math.floor(dam / SIZE) < 57) {
					expect(lake.level).toBeLessThanOrEqual(col);
					held += 1;
				}
			});
		}
		expect(held).toBeGreaterThan(0);
	});

	it('places no reservoir where every candidate is blocked, and none when asked for none', () => {
		expect(place({ count: 0 }).lakes).toHaveLength(0);
		expect(place({ count: 3, blocked: new Uint8Array(SIZE * SIZE).fill(1) }).lakes).toHaveLength(0);
	});

	it('keeps its lake off blocked ground rather than stopping the water at it', () => {
		const first = place({ count: 1 });
		const blocked = new Uint8Array(SIZE * SIZE);
		// Block the far end of the lake it made.
		const cells = cellsOf(first.lakeOf, 0);
		blocked[cells[cells.length - 1]] = 1;
		// Placing marks the ground round each lake it makes, so it's handed a copy.
		const lakes = place({ count: 1, blocked: blocked.slice() });
		expect(lakes.lakes).toHaveLength(1);
		lakes.lakes.forEach((_lake, id) => cellsOf(lakes.lakeOf, id).forEach((cell) => expect(blocked[cell]).toBe(0)));
	});
});

describe('naturalLakes', () => {
	/** A plane tilted south with a bowl 3 world units deep in it: a pit the drainage fills to its spill. */
	function bowl(): { elevation: Float64Array; levels: Float64Array } {
		const elevation = new Float64Array(SIZE * SIZE);
		for (let row = 0; row < SIZE; row += 1) {
			for (let column = 0; column < SIZE; column += 1) {
				const distance = Math.hypot(column - 32, row - 40);
				elevation[row * SIZE + column] = (0.2 * row - (distance < 5 ? 3 * (1 - distance / 5) : 0)) / RELIEF;
			}
		}
		const { levels } = routeDrainage({ size: SIZE, elevation, outlets: [32] });
		return { elevation, levels: Float64Array.from(levels) };
	}

	const find = ({ moisture, blocked }: { moisture: number; blocked?: Uint8Array }) => {
		const { elevation, levels } = bowl();
		const lakes = emptyLakeCells(SIZE * SIZE);
		naturalLakes({ grid: GRID, elevation, levels, moisture: new Float64Array(SIZE * SIZE).fill(moisture), relief: RELIEF, blocked: blocked ?? new Uint8Array(SIZE * SIZE), into: lakes });
		return { lakes, elevation, levels };
	};

	it('makes a pit in wet country a lake at the level it fills to', () => {
		const { lakes, elevation, levels } = find({ moisture: 0.8 });
		expect(lakes.lakes).toHaveLength(1);
		const [lake] = lakes.lakes;
		expect(lake.kind).toBe('natural');
		expect(lake.dam).toBeNull();
		const cells = cellsOf(lakes.lakeOf, 0);
		expect(cells.length).toBeGreaterThanOrEqual(NATURAL_LAKE.cells);
		cells.forEach((cell) => {
			expect(levels[cell]).toBeGreaterThan(elevation[cell]);
			expect(lakes.level[cell]).toBe(levels[cell]);
		});
		// Joined side by side, so it draws as one piece.
		const seen = new Set([cells[0]]);
		const queue = [cells[0]];
		while (queue.length > 0) {
			const cell = queue.pop() as number;
			[cell + 1, cell - 1, cell + SIZE, cell - SIZE].forEach((next) => {
				if (lakes.lakeOf[next] === 0 && !seen.has(next)) {
					seen.add(next);
					queue.push(next);
				}
			});
		}
		expect(seen.size).toBe(cells.length);
		// Round the bowl's middle, at (5, 85).
		expect(Math.hypot(lake.x - 5, lake.y - 85)).toBeLessThan(20);
	});

	it('leaves a pit dry where the country is dry, or where it touches blocked ground', () => {
		expect(find({ moisture: 0.3 }).lakes.lakes).toHaveLength(0);
		const blocked = new Uint8Array(SIZE * SIZE);
		blocked[40 * SIZE + 32] = 1;
		expect(find({ moisture: 0.8, blocked }).lakes.lakes).toHaveLength(0);
	});
});

describe('lakeDepthField', () => {
	it('stands above 0 on a lake\'s cells, the level less the land, and below it everywhere else, its zero the shore', () => {
		const { elevation, outlet } = valley();
		const routed = routeDrainage({ size: SIZE, elevation, outlets: [outlet] });
		const lakes = emptyLakeCells(SIZE * SIZE);
		placeReservoirs({
			grid: GRID, elevation, receivers: routed.receivers, area: routed.area, threshold: 20, count: 1, radius: 270, inner: 0,
			relief: RELIEF, blocked: new Uint8Array(SIZE * SIZE), rng: new Rng({ seed: 1 }), into: lakes,
		});
		const depth = lakeDepthField({ grid: GRID, elevation, lakes });
		for (let cell = 0; cell < depth.length; cell += 1) {
			if (lakes.lakeOf[cell] >= 0) {
				expect(depth[cell]).toBeGreaterThan(0);
				expect(depth[cell]).toBeCloseTo(Math.max(0.002, lakes.level[cell] - elevation[cell]), 6);
			} else {
				expect(depth[cell]).toBeLessThan(0);
			}
		}
	});
});
