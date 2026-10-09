import { Rng } from '../core/Rng';
import { Drainage, FLOOD_RISE } from './Drainage';
import { LandSurface, TERRACES, generateLand, moistureLevel, placeOutlets, startRadii } from './Land';
import { LandGrid, cellCentre, landGridFor } from './LandGrid';
import { MapParamSet, resolveMapParams } from './MapParams';
import { validateMapParams } from './ParamValidator';
import { RELIEF } from './Terrain';

const paramsFor = (set: MapParamSet) => validateMapParams(resolveMapParams(set).params).params;

/** The land as the pipeline's terrain stream builds it, each set built once a file. */
const built = new Map<string, LandSurface>();
function landFor(set: MapParamSet, stageAttempt = 0): LandSurface {
	const key = JSON.stringify([set, stageAttempt]);
	let land = built.get(key);
	if (!land) {
		const params = paramsFor(set);
		land = generateLand({ params, rng: new Rng({ seed: params.seed }).fork('map', 0).fork('terrain', stageAttempt) });
		built.set(key, land);
	}
	return land;
}

/** FNV-1a over a typed array's bytes, read as little-endian words: a pin that any one bit moves. */
function hashOf(values: Float64Array | Int32Array): number {
	const view = new DataView(values.buffer, values.byteOffset, values.byteLength);
	let hash = 0x811c9dc5;
	for (let offset = 0; offset < values.byteLength; offset += 4) {
		hash ^= view.getUint32(offset, true);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

/** Each cell's distance from the compound, and the cells inside `radius`. */
function cellsWithin(grid: LandGrid, radius: number): number[] {
	const cells: number[] = [];
	for (let row = 0; row < grid.size; row += 1) {
		for (let column = 0; column < grid.size; column += 1) {
			if (Math.hypot(cellCentre(grid, column), cellCentre(grid, row)) <= radius) cells.push(row * grid.size + column);
		}
	}
	return cells;
}

/** The outlet each cell drains to, found downstream first through `order`. */
function outletsReached(drainage: Drainage): Int32Array {
	const reached = new Int32Array(drainage.receivers.length).fill(-1);
	drainage.order.forEach((cell) => {
		const receiver = drainage.receivers[cell];
		reached[cell] = receiver < 0 ? cell : reached[receiver];
	});
	return reached;
}

const SETS: MapParamSet[] = [
	{ seed: 2183746551, radius: 800 },
	{ seed: 17, environment: 'highDesert', rivers: 0, radius: 600 },
	{ seed: 18, environment: 'floodlands', rivers: 6, radius: 600 },
	{ seed: 19, mountainCoverage: 1, ruggedness: 1, aridity: 0, radius: 600, metroSize: 0.08 },
];

describe('generateLand', () => {
	describe('drainage', () => {
		it.each(SETS.map((set, index) => [index, set] as const))('drains every cell to an outlet, downhill on the water levels, in set %i', (_index, set) => {
			const { drainage, elevation, grid } = landFor(set);
			const reached = outletsReached(drainage);
			const outlets = Array.from(drainage.outlets);
			let standing = 0;
			reached.forEach((outlet, cell) => {
				expect(outlets).toContain(outlet);
				const receiver = drainage.receivers[cell];
				if (receiver < 0) return;
				expect(drainage.levels[cell]).toBeGreaterThanOrEqual(drainage.levels[receiver] + FLOOD_RISE);
				if (drainage.levels[cell] > elevation[cell]) standing += 1;
			});
			// Erosion fills its own pits, so water stands in almost none: the
			// last few of the coarse pass's, and where the metro was flattened.
			expect(standing / reached.length).toBeLessThan(0.02);
			expect(drainage.size).toBe(grid.size);
			expect(outlets.reduce((sum, outlet) => sum + drainage.area[outlet], 0)).toBe(grid.size * grid.size);
		});

		it('leaves only by the outlets, `rivers` of them on the grid\'s edge', () => {
			const land = landFor(SETS[2]);
			const { size } = land.grid;
			expect(land.closedBasin).toBe(false);
			expect(land.drainage.outlets).toHaveLength(6);
			land.drainage.outlets.forEach((outlet) => {
				const row = Math.floor(outlet / size);
				const column = outlet % size;
				expect(row === 0 || column === 0 || row === size - 1 || column === size - 1).toBe(true);
			});
			expect(land.drainage.receivers.filter((receiver) => receiver < 0)).toHaveLength(6);
		});

		it('drains a closed basin, with no rivers, to one sink inside the disc', () => {
			const land = landFor(SETS[1]);
			expect(land.closedBasin).toBe(true);
			expect(land.drainage.outlets).toHaveLength(1);
			const [sink] = land.drainage.outlets;
			const distance = Math.hypot(cellCentre(land.grid, sink % land.grid.size), cellCentre(land.grid, Math.floor(sink / land.grid.size)));
			expect(Math.abs(distance - 0.55 * 600)).toBeLessThan(land.grid.cellSize);
			expect(land.drainage.area[sink]).toBe(land.grid.size * land.grid.size);
			expect(land.elevation[sink]).toBe(0);
		});
	});

	describe('outlets', () => {
		const grid = landGridFor(1000);
		const perimeter = 4 * (grid.size - 1);
		/** How far round the edge, counterclockwise from the south-west corner, a cell on it is. */
		const along = (cell: number) => {
			const side = grid.size - 1;
			const row = Math.floor(cell / grid.size);
			const column = cell % grid.size;
			if (row === 0 && column < side) return column;
			if (column === side && row < side) return side + row;
			if (row === side && column > 0) return 3 * side - column;
			return 4 * side - row;
		};

		it('spreads them round the edge, never closer than half their even spacing', () => {
			for (let count = 1; count <= 6; count += 1) {
				for (let seed = 1; seed <= 20; seed += 1) {
					const { outlets, closedBasin } = placeOutlets({ grid, count, radius: 1000, rng: new Rng({ seed }) });
					expect(closedBasin).toBe(false);
					expect(new Set(outlets).size).toBe(count);
					const positions = Array.from(outlets, along).sort((a, b) => a - b);
					positions.forEach((position, index) => {
						const next = index + 1 < count ? positions[index + 1] : positions[0] + perimeter;
						if (count > 1) expect(next - position).toBeGreaterThanOrEqual(0.5 * perimeter / count - 1);
					});
				}
			}
		});

		it('draws the same outlets from the same stream', () => {
			const first = placeOutlets({ grid, count: 3, radius: 1000, rng: new Rng({ seed: 9 }) });
			const again = placeOutlets({ grid, count: 3, radius: 1000, rng: new Rng({ seed: 9 }) });
			expect(Array.from(again.outlets)).toEqual(Array.from(first.outlets));
		});
	});

	describe('the metro', () => {
		it.each(SETS.map((set, index) => [index, set] as const))('is flat, in set %i', (_index, set) => {
			const land = landFor(set);
			const params = paramsFor(set);
			const { metroRadius } = startRadii(params);
			const { grid, elevation } = land;
			const metro = cellsWithin(grid, metroRadius);
			const heights = metro.map((cell) => elevation[cell]);
			expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.03);
			const size = grid.size;
			metro.forEach((cell) => {
				const slopeX = (elevation[cell + 1] - elevation[cell - 1]) / (2 * grid.cellSize);
				const slopeY = (elevation[cell + size] - elevation[cell - size]) / (2 * grid.cellSize);
				expect(Math.hypot(slopeX, slopeY) * RELIEF).toBeLessThan(0.4);
			});
			metro.forEach((cell) => expect(land.mountains[cell]).toBe(0));
		});
	});

	describe('terraces', () => {
		const dryMap = { seed: 23, environment: 'highDesert', radius: 600 } as const;

		it('leave the land alone at an aridity of 0.4 and up', () => {
			expect(moistureLevel(TERRACES.below)).toBe(0.4);
			const reference = Array.from(landFor({ ...dryMap, aridity: 0.8 }).elevation);
			[0.4, 0.55].forEach((aridity) => expect(Array.from(landFor({ ...dryMap, aridity }).elevation)).toEqual(reference));
		});

		it('pull a dry map toward benches, without changing which way it drains', () => {
			const wet = landFor({ ...dryMap, aridity: 0.8 });
			const dry = landFor({ ...dryMap, aridity: 0.15 });
			const { metroRadius, blendRadius } = startRadii(paramsFor(dryMap));
			const outside = cellsWithin(wet.grid, 2 * wet.grid.halfExtent).filter((cell) => {
				const x = cellCentre(wet.grid, cell % wet.grid.size);
				const y = cellCentre(wet.grid, Math.floor(cell / wet.grid.size));
				return Math.hypot(x, y) > blendRadius + wet.grid.cellSize;
			});
			let moved = 0;
			let rerouted = 0;
			outside.forEach((cell) => {
				moved += Math.abs(dry.elevation[cell] - wet.elevation[cell]);
				if (dry.drainage.receivers[cell] !== wet.drainage.receivers[cell]) rerouted += 1;
			});
			expect(moved / outside.length).toBeGreaterThan(0.002);
			// Terracing is the same pull everywhere, so a higher cell stays higher.
			// It squeezes heights together on a bench, though, and neighbours it
			// brings within FLOOD_RISE of each other flood as though level.
			expect(rerouted / outside.length).toBeLessThan(0.001);
			expect(metroRadius).toBeLessThan(blendRadius);
			// On a bench, most of a step's height sits within a short way of its floor.
			const benchFloors = (land: LandSurface) => outside.filter((cell) => {
				const within = land.elevation[cell] * TERRACES.steps % 1;
				return within < 0.25;
			}).length / outside.length;
			expect(benchFloors(dry)).toBeGreaterThan(benchFloors(wet) + 0.1);
		});
	});

	describe('determinism', () => {
		// What a seed's land is belongs to what the seed means, so the grid is
		// pinned outright, as the PRNG's draws are. Erosion is adds,
		// multiplies, divides, compares, and square roots, which ECMAScript
		// rounds exactly, so these hold in every engine. A change here moves
		// every map, and with it the roads.
		it('erodes the pinned land', () => {
			const mixed = landFor(SETS[0]);
			expect(hashOf(mixed.elevation)).toBe(PINNED.mixed.elevation);
			expect(hashOf(mixed.drainage.receivers)).toBe(PINNED.mixed.receivers);
			expect([mixed.elevation[0], mixed.elevation[12345], mixed.elevation[mixed.elevation.length - 1]]).toEqual(PINNED.mixed.samples);
			const basin = landFor(SETS[1]);
			expect(hashOf(basin.elevation)).toBe(PINNED.basin.elevation);
			expect(hashOf(basin.drainage.receivers)).toBe(PINNED.basin.receivers);
			expect(Array.from(basin.drainage.outlets)).toEqual(PINNED.basin.outlets);
		});

		it('erodes the same land from a fresh copy of the module, and other land on another stage attempt', () => {
			const set = SETS[3];
			const first = landFor(set);
			let isolated: typeof generateLand | null = null;
			jest.isolateModules(() => {
				isolated = (jest.requireActual('./Land') as typeof import('./Land')).generateLand;
			});
			if (!isolated) throw new Error('Land did not load');
			const params = paramsFor(set);
			const fresh = (isolated as typeof generateLand)({ params, rng: new Rng({ seed: params.seed }).fork('map', 0).fork('terrain', 0) });
			expect(hashOf(fresh.elevation)).toBe(hashOf(first.elevation));
			expect(hashOf(landFor(set, 1).elevation)).not.toBe(hashOf(first.elevation));
		});

		it('reads only the parameters that shape the land', () => {
			const base = landFor({ seed: 31, radius: 600 });
			const elsewhere = landFor({ seed: 31, radius: 600, towns: 11, hotspots: 6, contamination: 0.9, lakes: 7, highways: 9, dressing: 0.1 });
			expect(hashOf(elsewhere.elevation)).toBe(hashOf(base.elevation));
		});
	});
});

// Computed in a separate Node process from the Jest run that checks them.
const PINNED = {
	mixed: { elevation: 3357751489, receivers: 715691246, samples: [0.04858431699313396, 0.027119907154759818, 0.1031469795877068] },
	basin: { elevation: 1636773231, receivers: 794035463, outlets: [7295] },
};
