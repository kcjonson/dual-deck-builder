import { Rng } from '../core/Rng';
import { routeDrainage } from './Drainage';
import { LandGrid, cellCentre } from './LandGrid';
import { SimplexNoise } from './Noise';
import { RIVER_THRESHOLD, RIVER_WIDTH, RiverIndex, RiverLines, riverPolylines, riverThreshold, riverWidth, simplify, traceRivers } from './Rivers';

/** A small grid: 32 cells of 10 units. */
const GRID: LandGrid = { size: 32, cellSize: 10, halfExtent: 160 };
const SIZE = GRID.size;

/**
 * A valley running south to an outlet on the south edge, its floor falling
 * southward and its sides rising either way, with side valleys every eight
 * rows: drainage gathers into one main river with tributaries.
 */
function valley(): { elevation: Float64Array; outlet: number } {
	const elevation = new Float64Array(SIZE * SIZE);
	const middle = SIZE / 2;
	for (let row = 0; row < SIZE; row += 1) {
		for (let column = 0; column < SIZE; column += 1) {
			const across = Math.abs(column - middle);
			const side = row % 8 === 4 ? 0.3 * across : across;
			elevation[row * SIZE + column] = 0.01 * row + 0.02 * side + 0.001 * ((row * 7 + column * 13) % 5);
		}
	}
	return { elevation, outlet: middle };
}

function riverOf(lines: RiverLines, river: number): number[] {
	return Array.from(lines.points.subarray(2 * lines.offsets[river], 2 * lines.offsets[river + 1]));
}

describe('riverThreshold and riverWidth', () => {
	it('sets the stream threshold by riverDensity, fewer streams at 0, more at 1', () => {
		expect(riverThreshold(0)).toBe(RIVER_THRESHOLD.sparse);
		expect(riverThreshold(1)).toBe(RIVER_THRESHOLD.dense);
		expect(riverThreshold(0.5)).toBeLessThan(riverThreshold(0.2));
	});

	it('makes a river a creek at the threshold, wider with the square root of its area, and never past the widest', () => {
		expect(riverWidth(300, 300)).toBe(RIVER_WIDTH.min);
		expect(riverWidth(4 * 300, 300)).toBeCloseTo(RIVER_WIDTH.min + RIVER_WIDTH.gain, 12);
		expect(riverWidth(16 * 300, 300)).toBeGreaterThan(riverWidth(4 * 300, 300));
		expect(riverWidth(1e9, 300)).toBe(RIVER_WIDTH.max);
	});
});

describe('traceRivers', () => {
	const { elevation, outlet } = valley();
	const drainage = routeDrainage({ size: SIZE, elevation, outlets: [outlet] });
	const threshold = 12;
	const noLakes = new Int32Array(SIZE * SIZE).fill(-1);

	it('traces every river cell into one chain, a main river to the outlet and tributaries to their confluences', () => {
		const chains = traceRivers({ receivers: drainage.receivers, area: drainage.area, threshold, lakeOf: noLakes, closedBasin: false });
		const seen = new Int32Array(SIZE * SIZE);
		chains.forEach((chain) => {
			chain.cells.forEach((cell, index) => {
				if (index < chain.cells.length - 1 || chain.end === 'edge') seen[cell] += 1;
				if (index > 0) expect(chain.cells[index]).toBe(drainage.receivers[chain.cells[index - 1]]);
			});
			expect(chain.start).toBe('source');
			if (chain.end === 'confluence') {
				const into = chains[chain.into];
				expect(into.cells).toContain(chain.cells[chain.cells.length - 1]);
			}
		});
		for (let cell = 0; cell < SIZE * SIZE; cell += 1) expect(seen[cell]).toBe(drainage.area[cell] >= threshold ? 1 : 0);
		const toEdge = chains.filter((chain) => chain.end === 'edge');
		expect(toEdge).toHaveLength(1);
		expect(toEdge[0].cells[toEdge[0].cells.length - 1]).toBe(outlet);
		expect(chains.filter((chain) => chain.end === 'confluence').length).toBeGreaterThan(1);
	});

	it('carries a river on at a confluence from its biggest tributary', () => {
		const chains = traceRivers({ receivers: drainage.receivers, area: drainage.area, threshold, lakeOf: noLakes, closedBasin: false });
		chains.filter((chain) => chain.end === 'confluence').forEach((chain) => {
			const meeting = chain.cells[chain.cells.length - 1];
			const joined = chains[chain.into];
			const before = joined.cells[joined.cells.indexOf(meeting) - 1];
			if (before !== undefined) expect(drainage.area[before]).toBeGreaterThanOrEqual(drainage.area[chain.cells[chain.cells.length - 2]]);
		});
	});

	it('ends a river in a lake, starts one where the lake drains, and calls a closed basin\'s outlet its sink', () => {
		// The main river's cells a third of the way down, under a lake.
		const lakeOf = new Int32Array(SIZE * SIZE).fill(-1);
		const middle = SIZE / 2;
		for (let row = 12; row <= 14; row += 1) for (let column = middle - 1; column <= middle + 1; column += 1) lakeOf[row * SIZE + column] = 0;
		const chains = traceRivers({ receivers: drainage.receivers, area: drainage.area, threshold, lakeOf, closedBasin: true });
		const intoLake = chains.filter((chain) => chain.end === 'lake');
		expect(intoLake.length).toBeGreaterThan(0);
		intoLake.forEach((chain) => {
			expect(chain.into).toBe(0);
			expect(lakeOf[chain.cells[chain.cells.length - 1]]).toBe(0);
			chain.cells.slice(0, -1).forEach((cell) => expect(lakeOf[cell]).toBe(-1));
		});
		const fromLake = chains.filter((chain) => chain.start === 'lake');
		expect(fromLake).toHaveLength(1);
		expect(lakeOf[fromLake[0].cells[0]]).toBe(0);
		expect(fromLake[0].end).toBe('sink');
		expect(chains.some((chain) => chain.end === 'edge')).toBe(false);
	});
});

describe('riverPolylines', () => {
	const { elevation, outlet } = valley();
	const drainage = routeDrainage({ size: SIZE, elevation, outlets: [outlet] });
	const chains = traceRivers({ receivers: drainage.receivers, area: drainage.area, threshold: 12, lakeOf: new Int32Array(SIZE * SIZE).fill(-1), closedBasin: false });
	const noise = new SimplexNoise({ rng: new Rng({ seed: 3 }) });
	const lines = riverPolylines({ grid: GRID, chains, area: drainage.area, threshold: 12, elevation, meander: 1, noise, relief: 100 });

	it('packs a line per river, a width per point, every river joining the one it meets', () => {
		expect(lines.offsets).toHaveLength(chains.length + 1);
		expect(lines.points).toHaveLength(2 * lines.widths.length);
		chains.forEach((chain, river) => {
			const line = riverOf(lines, river);
			expect(line.length).toBeGreaterThanOrEqual(4);
			// A river starts on its first cell's centre.
			const first = chain.cells[0];
			expect(line[0]).toBe(cellCentre(GRID, first % SIZE));
			expect(line[1]).toBe(cellCentre(GRID, Math.floor(first / SIZE)));
			if (chain.end !== 'confluence') return;
			// Its last point lies on the line of the river it joins.
			const target = riverOf(lines, chain.into);
			const [px, py] = line.slice(-2);
			let nearest = Infinity;
			for (let index = 0; index + 3 < target.length; index += 2) {
				const [ax, ay, bx, by] = target.slice(index, index + 4);
				const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
				nearest = Math.min(nearest, Math.hypot(ax + (bx - ax) * t - px, ay + (by - ay) * t - py));
			}
			expect(nearest).toBeLessThan(1e-9);
		});
	});

	it('widens a river downstream, from a creek at its source', () => {
		chains.forEach((_chain, river) => {
			const widths = Array.from(lines.widths.subarray(lines.offsets[river], lines.offsets[river + 1]));
			expect(widths[0]).toBe(RIVER_WIDTH.min);
			widths.forEach((width, index) => {
				expect(width).toBeGreaterThanOrEqual(RIVER_WIDTH.min);
				expect(width).toBeLessThanOrEqual(RIVER_WIDTH.max);
				if (index > 0) expect(width).toBeGreaterThanOrEqual(widths[index - 1] - 1e-12);
			});
		});
	});

	it('meanders with riverMeander on flat ground, and runs straight without it', () => {
		const straight = riverPolylines({ grid: GRID, chains, area: drainage.area, threshold: 12, elevation: new Float64Array(SIZE * SIZE), meander: 0, noise, relief: 100 });
		const wandering = riverPolylines({ grid: GRID, chains, area: drainage.area, threshold: 12, elevation: new Float64Array(SIZE * SIZE), meander: 1, noise, relief: 100 });
		const length = (packed: RiverLines) => {
			let total = 0;
			for (let river = 0; river + 1 < packed.offsets.length; river += 1) {
				for (let point = packed.offsets[river]; point + 1 < packed.offsets[river + 1]; point += 1) {
					total += Math.hypot(packed.points[2 * point + 2] - packed.points[2 * point], packed.points[2 * point + 3] - packed.points[2 * point + 1]);
				}
			}
			return total;
		};
		expect(length(wandering)).toBeGreaterThan(1.01 * length(straight));
	});
});

describe('simplify', () => {
	it('drops points on a straight run, keeps a corner, and keeps both ends', () => {
		expect(simplify([0, 0, 1, 0, 2, 0, 3, 0], 0.1)).toEqual([0, 0, 3, 0]);
		expect(simplify([0, 0, 1, 0, 2, 0, 2, 1, 2, 2], 0.1)).toEqual([0, 0, 2, 0, 2, 2]);
		expect(simplify([0, 0, 1, 0.05, 2, 0], 0.1)).toEqual([0, 0, 2, 0]);
		expect(simplify([0, 0, 5, 5], 1)).toEqual([0, 0, 5, 5]);
	});
});

describe('RiverIndex', () => {
	// One river north along x = 0, 4 wide at its south end and 8 at its north.
	const lines: RiverLines = { points: Float64Array.of(0, -50, 0, 50), widths: Float64Array.of(4, 8), offsets: Uint32Array.of(0, 2) };
	const index = new RiverIndex({ lines, extent: 200, bucket: 16 });

	it('holds water within half the river\'s width of its centreline, the width running between its ends', () => {
		expect(index.contains(1.9, -50)).toBe(true);
		expect(index.contains(2.1, -50)).toBe(false);
		expect(index.contains(2.9, 0)).toBe(true);
		expect(index.contains(3.1, 0)).toBe(false);
		expect(index.contains(0, 53)).toBe(true);
		expect(index.contains(0, 60)).toBe(false);
		expect(index.contains(150, 150)).toBe(false);
	});

	it('finds where a move crosses a centreline: how far along, the width there, and how square-on', () => {
		expect(index.crossings(-10, 0, 10, 0)).toBe(1);
		expect(index.crossing(0)).toEqual({ along: 0.5, width: 6, sine: 1 });
		expect(index.crossings(-10, -10, 30, 30)).toBe(1);
		expect(index.crossing(0).along).toBeCloseTo(0.25, 12);
		expect(index.crossing(0).sine).toBeCloseTo(Math.SQRT1_2, 12);
		// Along it, short of it, and past its end, it crosses nothing.
		expect(index.crossings(0, -40, 0, 40)).toBe(0);
		expect(index.crossings(-10, 0, -1, 0)).toBe(0);
		expect(index.crossings(-10, 60, 10, 60)).toBe(0);
	});
});
