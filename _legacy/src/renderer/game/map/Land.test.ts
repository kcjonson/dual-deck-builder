import { Rng } from '../core/Rng';
import { Drainage } from './Drainage';
import { LandSurface, METRO_GRADE, METRO_RELIEF, RELIEF, TERRACES, generateLand, moistureLevel, placeOutlets, startRadii, terraceHeight, terracePull, terraceSlope } from './Land';
import { LandGrid, cellCentre, landGridFor } from './LandGrid';
import { MapParamSet, resolveMapParams } from './MapParams';
import { validateMapParams } from './ParamValidator';

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

/** For each cell, the first cell its drainage reaches at `radius` or more from the compound, or its outlet if none, found downstream first. */
function exitsPast(land: LandSurface, radius: number): Int32Array {
	const { grid, drainage } = land;
	const exits = new Int32Array(drainage.receivers.length);
	drainage.order.forEach((cell) => {
		const receiver = drainage.receivers[cell];
		const outside = Math.hypot(cellCentre(grid, cell % grid.size), cellCentre(grid, Math.floor(cell / grid.size))) >= radius;
		exits[cell] = outside || receiver < 0 ? cell : exits[receiver];
	});
	return exits;
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

/** The share of a land's cells where water stands, above the land. */
function standingShare({ drainage, elevation }: LandSurface): number {
	let standing = 0;
	elevation.forEach((height, cell) => {
		if (drainage.levels[cell] > height) standing += 1;
	});
	return standing / elevation.length;
}

/**
 * The tuning range's hardest corners for the metro, beside the sets above:
 * ranges all round it at the smallest and largest radii and metros, with
 * the most rivers and none.
 */
const METRO_CORNERS: MapParamSet[] = [
	{ seed: 3, radius: 1600, metroSize: 0.25, rivers: 6, ruggedness: 1, mountainCoverage: 1, aridity: 0.05 },
	{ seed: 2183746551, radius: 600, metroSize: 0.08, rivers: 6, ruggedness: 1, mountainCoverage: 1, aridity: 0.05 },
	{ seed: 3, radius: 1000, rivers: 0, ruggedness: 1, mountainCoverage: 1, aridity: 0.05 },
	{ seed: 2, radius: 1600, metroSize: 0.25, mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1 },
	{ seed: 1, radius: 600, metroSize: 0.08, mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1, rivers: 0 },
];

describe('generateLand', () => {
	describe('drainage', () => {
		it.each(SETS.map((set, index) => [index, set] as const))('drains every cell to an outlet, downhill on the water levels, in set %i', (_index, set) => {
			const { drainage, grid } = landFor(set);
			const reached = outletsReached(drainage);
			const outlets = Array.from(drainage.outlets);
			reached.forEach((outlet, cell) => {
				expect(outlets).toContain(outlet);
				const receiver = drainage.receivers[cell];
				if (receiver >= 0) expect(drainage.levels[cell]).toBeGreaterThan(drainage.levels[receiver]);
			});
			expect(drainage.size).toBe(grid.size);
			expect(outlets.reduce((sum, outlet) => sum + drainage.area[outlet], 0)).toBe(grid.size * grid.size);
		});

		// Erosion fills most of its own pits, but 40 iterations at half size
		// leave some basins behind the ranges, most in the frame outside the
		// disc, and the most on dry rugged maps with one outlet (High Desert,
		// Badlands). They're the water stage's natural lakes; terrain-erosion.md
		// has the shares over 90 maps.
		it('leaves water standing in few cells, on every environment', () => {
			const shares = (['mixed', 'highDesert', 'rustBelt', 'floodlands', 'badlands'] as const).flatMap((environment) => [7, 42]
				.map((seed) => standingShare(landFor({ seed, environment, radius: 800 }))));
			shares.forEach((share) => expect(share).toBeLessThan(0.1));
			const sorted = [...shares].sort((a, b) => a - b);
			expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(0.02);
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
		it.each([...SETS, ...METRO_CORNERS].map((set, index) => [index, set] as const))('is flat and dry, with no water standing round it, in set %i', (_index, set) => {
			const land = landFor(set);
			const params = paramsFor(set);
			const { metroRadius, blendRadius } = startRadii(params);
			const { grid, elevation, drainage } = land;
			const metro = cellsWithin(grid, metroRadius);
			const size = grid.size;
			// The metro keeps METRO_RELIEF of its height above where its water
			// leaves at most, and no cell stood higher than the land's peak.
			let peak = 0;
			elevation.forEach((height) => {
				if (height > peak) peak = height;
			});
			const heights = metro.map((cell) => elevation[cell]);
			expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(METRO_RELIEF * peak);
			metro.forEach((cell) => {
				const slopeX = (elevation[cell + 1] - elevation[cell - 1]) / (2 * grid.cellSize);
				const slopeY = (elevation[cell + size] - elevation[cell - size]) / (2 * grid.cellSize);
				// Capped cell to cell at METRO_GRADE; the cells at its edge reach into the blend ring.
				expect(Math.hypot(slopeX, slopeY) * RELIEF).toBeLessThan(1.5 * METRO_GRADE);
				expect(land.mountains[cell]).toBe(0);
			});
			cellsWithin(grid, blendRadius).forEach((cell) => expect(drainage.levels[cell]).toBe(elevation[cell]));
		});

		it('keeps every way water left the metro open, so a river crossing it still crosses it', () => {
			// A metro a river crosses, on a map whose flattening lowers it a long way.
			const land = landFor(METRO_CORNERS[0]);
			const { metroRadius } = startRadii(paramsFor(METRO_CORNERS[0]));
			const metro = new Set(cellsWithin(land.grid, metroRadius));
			const leaving = [...metro].filter((cell) => !metro.has(land.drainage.receivers[cell]));
			expect(leaving.length).toBeGreaterThan(0);
			expect(Math.max(...[...metro].map((cell) => land.drainage.area[cell]))).toBeGreaterThan(metro.size);

			// The land under this metro drains it two ways, north-east and
			// south-east, past the blend ring. Flattening keeps the ring's inner
			// edge lower than its outer, which dammed the north-east way until
			// the old ways out were lowered through the ring with it.
			const twoWays = { seed: 2, environment: 'rustBelt', radius: 1000 } as const;
			const twoWayLand = landFor(twoWays);
			const radii = startRadii(paramsFor(twoWays));
			const exits = exitsPast(twoWayLand, radii.blendRadius);
			const counts = new Map<number, number>();
			const twoWayMetro = cellsWithin(twoWayLand.grid, radii.metroRadius);
			twoWayMetro.forEach((cell) => counts.set(exits[cell], (counts.get(exits[cell]) ?? 0) + 1));
			const large = [...counts.values()].filter((count) => count >= 0.05 * twoWayMetro.length);
			expect(large.length).toBeGreaterThanOrEqual(2);
		});
	});

	describe('terraces', () => {
		it('pull nothing at an aridity of 0.4 and up, and all they pull at 0.1 and under', () => {
			expect(moistureLevel(TERRACES.below)).toBe(0.4);
			[0.4, 0.55, 1].forEach((aridity) => expect(terracePull(moistureLevel(aridity))).toBe(0));
			[0, 0.1].forEach((aridity) => expect(terracePull(moistureLevel(aridity))).toBe(TERRACES.strength));
			expect(terracePull(moistureLevel(0.25))).toBeGreaterThan(0);
			expect(terracePull(moistureLevel(0.25))).toBeLessThan(TERRACES.strength);
		});

		it('keep heights in order, so land drains the same way terraced or not, and gather them onto benches', () => {
			const pull = TERRACES.strength;
			const step = 1e-4;
			let floors = 0;
			let terracedFloors = 0;
			let previous = -Infinity;
			for (let height = 0; height <= 1; height += step) {
				const terraced = terraceHeight(height, pull);
				expect(terraced).toBeGreaterThan(previous);
				previous = terraced;
				// The slope a terraced sample is scaled by is this function's derivative.
				const difference = (terraceHeight(height + 1e-7, pull) - terraceHeight(height - 1e-7, pull)) / 2e-7;
				expect(Math.abs(terraceSlope(height, pull) - difference)).toBeLessThan(1e-5);
				if (height * TERRACES.steps % 1 < 0.25) floors += 1;
				if (terraced * TERRACES.steps % 1 < 0.25) terracedFloors += 1;
				expect(terraceHeight(height, 0)).toBe(height);
			}
			// On a bench, most of a step's height sits within a short way of its floor.
			expect(terracedFloors).toBeGreaterThan(floors * 1.4);
		});

		it('leave the land grid alone, which is the same at any aridity: Terrain terraces what it samples', () => {
			const dryMap = { seed: 23, environment: 'highDesert', radius: 600 } as const;
			const wet = landFor({ ...dryMap, aridity: 0.8 });
			[0.05, 0.25].forEach((aridity) => {
				const dry = landFor({ ...dryMap, aridity });
				expect(Array.from(dry.elevation)).toEqual(Array.from(wet.elevation));
				expect(Array.from(dry.drainage.receivers)).toEqual(Array.from(wet.drainage.receivers));
			});
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
	mixed: { elevation: 3720184255, receivers: 1777173059, samples: [0.047842042086173125, 0.03163131726515936, 0.10045555445444558] },
	basin: { elevation: 3301805954, receivers: 1575174816, outlets: [7295] },
};
