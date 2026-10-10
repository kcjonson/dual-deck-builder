import { Rng } from '../core/Rng';
import { LandGrid, cellAt, cellCentre } from './LandGrid';
import { NATURAL_LAKE, RESERVOIR } from './Lakes';
import { MapParamSet, MapParams, resolveMapParams } from './MapParams';
import { validateMapParams } from './ParamValidator';
import { RIVER_WIDTH, RiverLines } from './Rivers';
import { Terrain, generateTerrain } from './Terrain';
import { FLATS, Water, WaterSurface, generateWater, waterFromSurface } from './Water';

const paramsFor = (set: MapParamSet): MapParams => validateMapParams(resolveMapParams(set).params).params;
/** The terrain stream as the pipeline forks it, and water's nested in it. */
const terrainStream = (seed: number) => new Rng({ seed }).fork('map', 0).fork('terrain', 0);

/** Erosion makes a terrain dear to build, so each set's land and water are built once a file. */
const lands = new Map<string, Terrain>();
const waters = new Map<string, Water>();
function landFor(set: MapParamSet): Terrain {
	const key = JSON.stringify(set);
	let land = lands.get(key);
	if (!land) {
		const params = paramsFor(set);
		land = generateTerrain({ params, rng: terrainStream(params.seed) });
		lands.set(key, land);
	}
	return land;
}
function waterFor(set: MapParamSet, attempt = 0): Water {
	const key = JSON.stringify([set, attempt]);
	let water = waters.get(key);
	if (!water) {
		const params = paramsFor(set);
		water = generateWater({ params, terrain: landFor(set), rng: terrainStream(params.seed).fork('water', attempt) });
		waters.set(key, water);
	}
	return water;
}

/** The environments at their defaults, a closed basin, and the wettest and driest corners, at radius 800. */
const SETS: [string, MapParamSet][] = [
	['Mixed', { seed: 7, radius: 800 }],
	['High Desert', { seed: 3, environment: 'highDesert', radius: 800 }],
	['Rust Belt', { seed: 11, environment: 'rustBelt', radius: 800 }],
	['Floodlands', { seed: 5, environment: 'floodlands', radius: 800 }],
	['Badlands', { seed: 13, environment: 'badlands', radius: 800 }],
	['a closed basin', { seed: 17, environment: 'floodlands', radius: 800, rivers: 0 }],
	['the wettest, densest corner', { seed: 19, radius: 800, aridity: 1, riverDensity: 1, riverMeander: 1, lakes: 8, mountainCoverage: 0 }],
	['the driest, most rugged corner', { seed: 23, radius: 800, aridity: 0, riverDensity: 0, ruggedness: 1, mountainCoverage: 1 }],
];

/**
 * The longest run of drawn river inside the disc that keeps within a degree
 * of the heading it started on, world units: what reads as ruler-straight.
 */
function longestStraight(lines: RiverLines, radius: number): number {
	let longest = 0;
	for (let river = 0; river + 1 < lines.offsets.length; river += 1) {
		let run = 0;
		let heading: number | null = null;
		for (let point = lines.offsets[river]; point + 1 < lines.offsets[river + 1]; point += 1) {
			const [ax, ay] = [lines.points[2 * point], lines.points[2 * point + 1]];
			const dx = lines.points[2 * point + 2] - ax;
			const dy = lines.points[2 * point + 3] - ay;
			const angle = Math.atan2(dy, dx) * 180 / Math.PI;
			if (Math.hypot(ax, ay) > radius) {
				heading = null;
				continue;
			}
			if (heading !== null && Math.abs(((angle - heading + 540) % 360) - 180) < 1) run += Math.hypot(dx, dy);
			else {
				run = Math.hypot(dx, dy);
				heading = angle;
			}
			longest = Math.max(longest, run);
		}
	}
	return longest;
}

function riverLine(lines: RiverLines, river: number): number[] {
	return Array.from(lines.points.subarray(2 * lines.offsets[river], 2 * lines.offsets[river + 1]));
}

/** The world units from (px, py) to the nearest point of a flat polyline. */
function distanceTo(line: readonly number[], px: number, py: number): number {
	let nearest = Infinity;
	for (let index = 0; index + 3 < line.length; index += 2) {
		const [ax, ay, bx, by] = line.slice(index, index + 4);
		const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
		const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / lengthSquared)) : 0;
		nearest = Math.min(nearest, Math.hypot(ax + (bx - ax) * t - px, ay + (by - ay) * t - py));
	}
	return nearest;
}

function centreOf(grid: LandGrid, cell: number): [number, number] {
	return [cellCentre(grid, cell % grid.size), cellCentre(grid, Math.floor(cell / grid.size))];
}

/**
 * The land joined to lake `id`, outside it, and under its level, that its
 * dam's wall doesn't hold back: where its water would run over a saddle.
 * Cells are joined side by side, or corner to corner where the four round
 * the corner average under the level. The wall runs `RESERVOIR.wall` cells
 * each side of the dam, square to its outflow, and holds what's on its line
 * or below it from the lake cells on its line or above it.
 */
function spills(surface: WaterSurface, elevation: Float64Array, id: number, dam: number): number[] {
	const size = surface.grid.size;
	const level = surface.lakes[id].level;
	const below = surface.receivers[dam];
	const [towardColumn, towardRow] = [(below % size) - (dam % size), Math.floor(below / size) - Math.floor(dam / size)];
	const span = towardColumn !== 0 && towardRow !== 0 ? 2 * RESERVOIR.wall : RESERVOIR.wall;
	const place = (cell: number) => {
		const dx = (cell % size) - (dam % size);
		const dy = Math.floor(cell / size) - Math.floor(dam / size);
		return { ahead: dx * towardColumn + dy * towardRow, across: Math.abs(dy * towardColumn - dx * towardRow) };
	};
	const out: number[] = [];
	lakeCells(surface, id).forEach((cell) => {
		const from = place(cell);
		const behind = cell === dam || (from.ahead <= 0 && from.across <= span);
		for (let dy = -1; dy <= 1; dy += 1) {
			for (let dx = -1; dx <= 1; dx += 1) {
				const next = cell + dy * size + dx;
				if (next === cell || surface.lakeOf[next] === id || !(elevation[next] < level)) continue;
				const corner = (elevation[cell] + elevation[next] + elevation[cell + dx] + elevation[cell + dy * size]) / 4;
				if (dx !== 0 && dy !== 0 && !(corner < level - 0.002)) continue;
				const to = place(next);
				if (behind && to.ahead >= 0 && to.across <= span) continue;
				out.push(next);
			}
		}
	});
	return out;
}

/** Cells under lake `id`, or under any lake when it's left out. */
function lakeCells(surface: WaterSurface, id?: number): number[] {
	return Array.from(surface.lakeOf.keys()).filter((cell) => (id === undefined ? surface.lakeOf[cell] >= 0 : surface.lakeOf[cell] === id));
}

/** FNV-1a over a typed array's bytes, read as little-endian words: a pin that any one bit moves. */
function hashOf(values: Float64Array | Float32Array | Int32Array): number {
	const view = new DataView(values.buffer, values.byteOffset, values.byteLength);
	let hash = 0x811c9dc5;
	for (let offset = 0; offset < values.byteLength; offset += 4) {
		hash ^= view.getUint32(offset, true);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

describe('generateWater', () => {
	describe('drainage', () => {
		it.each(SETS)('runs water downhill to where it leaves, the flats\' noise aside, in %s', (_name, set) => {
			const land = landFor(set);
			const { surface } = waterFor(set);
			const { elevation, drainage } = land.surface;
			const outlets = new Set(drainage.outlets);
			// Out of a pit water climbs to where it spills, the land's water level there; past that, the
			// routing's noise, under a hundredth of grade, is the most a receiver can stand above a cell.
			const allowance = 2 * FLATS.amplitude + 1e-4;
			for (let cell = 0; cell < surface.receivers.length; cell += 1) {
				const receiver = surface.receivers[cell];
				if (receiver < 0) {
					expect(outlets.has(cell)).toBe(true);
					continue;
				}
				expect(elevation[receiver]).toBeLessThanOrEqual(drainage.levels[cell] + allowance);
				// Rain gathers downstream: every cell's water passes on, with more joining it.
				expect(surface.area[receiver]).toBeGreaterThan(surface.area[cell]);
			}
			// Every cell drains to an outlet: a walk down from any reaches one.
			for (let cell = 0; cell < surface.receivers.length; cell += 97) {
				let at = cell;
				for (let steps = 0; surface.receivers[at] >= 0; steps += 1) {
					at = surface.receivers[at];
					expect(steps).toBeLessThan(surface.receivers.length);
				}
				expect(outlets.has(at)).toBe(true);
			}
		});

		it('breaks up the metro\'s flats, so rivers stop crossing it in ruler-straight runs', () => {
			const longestRun = (receivers: Int32Array, area: Float64Array, grid: LandGrid, radius: number) => {
				let longest = 0;
				receivers.forEach((receiver, cell) => {
					const [x, y] = centreOf(grid, cell);
					if (receiver < 0 || x * x + y * y > radius * radius || area[cell] < 20) return;
					const step = receiver - cell;
					let run = 1;
					for (let at = receiver; at >= 0 && receivers[at] - at === step; at = receivers[at]) run += 1;
					longest = Math.max(longest, run);
				});
				return longest;
			};
			// Metros that erode and fill dead flat: High Desert's seed 42, and the most rugged corner's.
			[{ seed: 42, environment: 'highDesert' } as const, { seed: 3, mountainCoverage: 1, ruggedness: 1 }].forEach((set) => {
				const land = landFor(set);
				const { surface } = waterFor(set);
				const { grid, drainage } = land.surface;
				const before = longestRun(drainage.receivers, drainage.area, grid, land.metro.radius);
				const after = longestRun(surface.receivers, surface.area, grid, land.metro.radius);
				expect(before).toBeGreaterThan(25);
				expect(after).toBeLessThan(0.7 * before);
			});
		});
	});

	describe('rivers', () => {
		it.each(SETS)('end every river at a confluence, in a lake, or where the drainage leaves, in %s', (_name, set) => {
			const land = landFor(set);
			const water = waterFor(set);
			const { surface } = water;
			const { grid } = surface;
			expect(water.rivers.length).toBeGreaterThan(5);
			water.rivers.forEach((river, id) => {
				const line = riverLine(water.lines, id);
				expect(line.length).toBeGreaterThanOrEqual(4);
				const [x, y] = line.slice(-2);
				if (river.end === 'confluence') {
					expect(river.into).not.toBe(id);
					expect(distanceTo(riverLine(water.lines, river.into), x, y)).toBeLessThan(1e-9);
				} else if (river.end === 'lake') {
					expect(water.lakes[river.into]).toBeDefined();
					expect(water.lakeDepth(x, y)).toBeGreaterThan(0);
				} else if (river.end === 'edge') {
					expect(land.surface.closedBasin).toBe(false);
					expect(Math.max(Math.abs(x), Math.abs(y))).toBeGreaterThan(grid.halfExtent - grid.cellSize);
				} else {
					expect(land.surface.closedBasin).toBe(true);
					expect(cellAt(grid, x, y)).toBe(land.surface.drainage.outlets[0]);
				}
				if (river.start === 'lake') expect(water.lakeDepth(line[0], line[1])).toBeGreaterThan(0);
				// A river ends on a lake's cell, but is as big as its own last cell, short of whatever else flows into the lake there.
				if (river.end === 'lake') expect(river.area).toBeLessThan(surface.area[cellAt(grid, x, y)]);
			});
		});

		it.each(SETS)('draws no river ruler-straight: nothing inside the disc runs five cells at one heading, in %s', (_name, set) => {
			const water = waterFor(set);
			expect(longestStraight(water.lines, paramsFor(set).radius)).toBeLessThan(5 * water.surface.grid.cellSize);
		});

		it.each(SETS)('widens rivers by their drainage, creeks to broad rivers, in %s', (_name, set) => {
			const { lines } = waterFor(set);
			let broadest = 0;
			for (let point = 0; point < lines.widths.length; point += 1) {
				expect(lines.widths[point]).toBeGreaterThanOrEqual(RIVER_WIDTH.min);
				expect(lines.widths[point]).toBeLessThanOrEqual(RIVER_WIDTH.max);
				broadest = Math.max(broadest, lines.widths[point]);
			}
			expect(broadest).toBeGreaterThan(3 * RIVER_WIDTH.min);
		});

		it('shows more of the drainage as streams at a higher riverDensity', () => {
			const sparse = waterFor({ seed: 29, radius: 800, riverDensity: 0 });
			const dense = waterFor({ seed: 29, radius: 800, riverDensity: 1 });
			expect(dense.lines.widths.length).toBeGreaterThan(1.5 * sparse.lines.widths.length);
			expect(dense.rivers.length).toBeGreaterThan(sparse.rivers.length);
		});

		it('wanders more on flat ground with riverMeander', () => {
			const lengthOf = (lines: RiverLines) => {
				let total = 0;
				for (let river = 0; river + 1 < lines.offsets.length; river += 1) {
					for (let point = lines.offsets[river]; point + 1 < lines.offsets[river + 1]; point += 1) {
						total += Math.hypot(lines.points[2 * point + 2] - lines.points[2 * point], lines.points[2 * point + 3] - lines.points[2 * point + 1]);
					}
				}
				return total;
			};
			const set = { seed: 31, environment: 'floodlands', radius: 800 } as const;
			const straight = lengthOf(waterFor({ ...set, riverMeander: 0 }).lines);
			const winding = lengthOf(waterFor({ ...set, riverMeander: 1 }).lines);
			expect(winding).toBeGreaterThan(1.02 * straight);
		});
	});

	describe('lakes', () => {
		it('makes a map with no standing water at lakes 0, and one where no river leaves at rivers 0', () => {
			const dry = waterFor({ seed: 5, environment: 'floodlands', radius: 800, lakes: 0 });
			expect(dry.lakes).toHaveLength(0);
			expect(lakeCells(dry.surface)).toHaveLength(0);
			expect(dry.rivers.some((river) => river.end === 'lake' || river.start === 'lake')).toBe(false);
			const basin = waterFor({ seed: 17, environment: 'floodlands', radius: 800, rivers: 0 });
			expect(basin.rivers.length).toBeGreaterThan(5);
			expect(basin.rivers.some((river) => river.end === 'edge')).toBe(false);
			expect(basin.rivers.some((river) => river.end === 'sink')).toBe(true);
		});

		it.each(SETS)('floods a reservoir upstream of its dam only, below its level, in %s', (_name, set) => {
			const land = landFor(set);
			const water = waterFor(set);
			const { surface } = water;
			const { grid } = surface;
			water.lakes.forEach((lake, id) => {
				if (!lake.dam) return;
				const dam = cellAt(grid, lake.dam.x, lake.dam.y);
				expect(surface.lakeOf[dam]).toBe(id);
				const cells = new Set(lakeCells(surface, id));
				expect(cells.size).toBe(lake.cells);
				expect(lake.cells).toBeGreaterThanOrEqual(RESERVOIR.cells.min);
				cells.forEach((cell) => {
					expect(land.surface.elevation[cell]).toBeLessThan(lake.level);
					let at = cell;
					for (let steps = 0; at !== dam; steps += 1) {
						expect(cells.has(at)).toBe(true);
						at = surface.receivers[at];
						expect(steps).toBeLessThan(cells.size);
					}
				});
				// Below the dam the river runs on, dry, and every lake cell is under water, a cell of land from any other lake.
				expect(surface.lakeDepth[surface.receivers[dam]]).toBeLessThan(0);
				// No land beside it stands under its level, but behind its dam's wall or across a corner too high for the water.
				expect(spills(surface, land.surface.elevation, id, dam)).toEqual([]);
				cells.forEach((cell) => {
					expect(surface.lakeDepth[cell]).toBeGreaterThan(0);
					const size = grid.size;
					for (let dy = -1; dy <= 1; dy += 1) {
						for (let dx = -1; dx <= 1; dx += 1) {
							const next = cell + dy * size + dx;
							if (surface.lakeOf[next] >= 0) expect(surface.lakeOf[next]).toBe(id);
						}
					}
				});
			});
		});

		it('places the reservoirs asked for, each dam a site inside the disc past the start', () => {
			const set = { seed: 37, environment: 'mixed', radius: 1000, lakes: 4 } as const;
			const land = landFor(set);
			const water = waterFor(set);
			const reservoirs = water.lakes.filter((lake) => lake.kind === 'reservoir');
			expect(reservoirs.length).toBeGreaterThanOrEqual(3);
			reservoirs.forEach(({ dam }) => {
				if (!dam) throw new Error('a reservoir has a dam');
				const distance = Math.hypot(dam.x, dam.y);
				expect(distance).toBeLessThanOrEqual(RESERVOIR.outer * land.radius);
				expect(distance).toBeGreaterThanOrEqual(land.reliefRadius);
				expect(water.surface.area[cellAt(water.surface.grid, dam.x, dam.y)]).toBeGreaterThanOrEqual(water.surface.threshold);
			});
		});

		it('fills the land\'s pits with natural lakes where the country is wet, and leaves a dry map\'s pits dry', () => {
			let natural = 0;
			// Rugged, wet maps, whose erosion leaves pits.
			[7, 41, 43].forEach((seed) => {
				const set = { seed, radius: 1000, aridity: 0.9 } as const;
				const land = landFor(set);
				const water = waterFor(set);
				water.lakes.forEach((lake, id) => {
					if (lake.kind !== 'natural') return;
					natural += 1;
					lakeCells(water.surface, id).forEach((cell) => {
						expect(land.surface.drainage.levels[cell]).toBeGreaterThan(land.surface.elevation[cell]);
						expect(water.surface.lakeDepth[cell]).toBeGreaterThan(0);
					});
				});
			});
			expect(natural).toBeGreaterThan(0);
			[3, 47, 53].forEach((seed) => {
				expect(waterFor({ seed, environment: 'highDesert', radius: 800 }).lakes.filter((lake) => lake.kind === 'natural')).toHaveLength(0);
			});
			expect(NATURAL_LAKE.moisture).toBeGreaterThan(0.5);
		});

		it.each(SETS)('keeps lakes off the metro, the towns, and the craters, in %s', (_name, set) => {
			const land = landFor(set);
			const { surface } = waterFor(set);
			lakeCells(surface).forEach((cell) => {
				const [x, y] = centreOf(surface.grid, cell);
				expect(Math.hypot(x, y)).toBeGreaterThan(land.blendRadius);
				land.towns.forEach((town) => expect(Math.hypot(x - town.x, y - town.y)).toBeGreaterThan(town.radius));
				land.hotspots.forEach((hotspot) => expect(Math.hypot(x - hotspot.x, y - hotspot.y)).toBeGreaterThan(hotspot.craterRadius));
			});
		});
	});

	describe('hazards', () => {
		it.each(SETS)('finds the craters, placed before the water, clear of every river, in %s', (_name, set) => {
			const land = landFor(set);
			const water = waterFor(set);
			land.hotspots.forEach(({ x, y, craterRadius }) => {
				for (let ring = 0; ring <= craterRadius; ring += 2) {
					for (let step = 0; step < 48; step += 1) {
						const angle = (step / 48) * 2 * Math.PI;
						expect(water.waterAt(x + ring * Math.cos(angle), y + ring * Math.sin(angle))).not.toBe('river');
					}
				}
			});
		});
	});

	describe('moisture and low ground', () => {
		it('makes the ground beside rivers wetter and lower than the country at large', () => {
			const set = { seed: 7, radius: 800 };
			const land = landFor(set);
			const { surface } = waterFor(set);
			const size = surface.grid.size;
			const beside: number[] = [];
			const all: number[] = [];
			const lowBeside: number[] = [];
			const lowAll: number[] = [];
			for (let cell = 0; cell < surface.area.length; cell += 1) {
				if (land.surface.mountains[cell] >= 0.5) continue;
				all.push(surface.moisture[cell]);
				lowAll.push(surface.lowland[cell]);
				const next = surface.receivers[cell];
				if (surface.area[cell] < surface.threshold && next >= 0 && surface.area[next] >= surface.threshold && Math.abs((next % size) - (cell % size)) <= 1) {
					beside.push(surface.moisture[cell]);
					lowBeside.push(surface.lowland[cell]);
				}
			}
			const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
			expect(beside.length).toBeGreaterThan(100);
			expect(mean(beside)).toBeGreaterThan(mean(all) + 0.05);
			expect(mean(lowBeside)).toBeGreaterThan(mean(lowAll));
		});

		it('keeps low, wet ground the same share of a map however rugged it is', () => {
			const mireShare = (ruggedness: number) => {
				const { terrain } = waterFor({ seed: 11, environment: 'floodlands', radius: 800, ruggedness });
				let inside = 0;
				let mire = 0;
				for (let row = 0; row < 40; row += 1) {
					for (let column = 0; column < 40; column += 1) {
						const x = ((column + 0.5) / 40 * 2 - 1) * terrain.radius;
						const y = ((row + 0.5) / 40 * 2 - 1) * terrain.radius;
						if (!terrain.contains(x, y)) continue;
						inside += 1;
						if (terrain.biome(x, y) === 'mire') mire += 1;
					}
				}
				return mire / inside;
			};
			const gentle = mireShare(0.15);
			const rugged = mireShare(0.85);
			expect(gentle).toBeGreaterThan(0.2);
			expect(Math.abs(gentle - rugged)).toBeLessThan(0.05);
		});

		it('runs wetter as aridity rises, following the spec\'s 0 dry to 1 wet', () => {
			const meanMoisture = (aridity: number) => {
				const { surface } = waterFor({ seed: 47, radius: 800, aridity });
				return surface.moisture.reduce((sum, value) => sum + value, 0) / surface.moisture.length;
			};
			expect(meanMoisture(0.1)).toBeLessThan(meanMoisture(0.5));
			expect(meanMoisture(0.5)).toBeLessThan(meanMoisture(0.9));
		});
	});

	describe('determinism', () => {
		// Computed in a separate Node process from the Jest run that checks them.
		it('makes the pinned water for two maps', () => {
			PINNED.forEach(({ set, moisture, lakeDepth, points, rivers, lakes }) => {
				const water = waterFor(set);
				expect(hashOf(water.surface.moisture)).toBe(moisture);
				expect(hashOf(water.surface.lakeDepth)).toBe(lakeDepth);
				expect(hashOf(water.lines.points)).toBe(points);
				expect(water.rivers.length).toBe(rivers);
				expect(water.lakes.map(({ kind, cells }) => `${kind} ${cells}`)).toEqual(lakes);
			});
		});

		it('makes the same water from the same land and stream, and other water on another stream', () => {
			const set = { seed: 7, radius: 800 };
			const params = paramsFor(set);
			const again = generateWater({ params, terrain: landFor(set), rng: terrainStream(params.seed).fork('water', 0) });
			const first = waterFor(set);
			expect(hashOf(again.lines.points)).toBe(hashOf(first.lines.points));
			expect(hashOf(again.surface.moisture)).toBe(hashOf(first.surface.moisture));
			expect(hashOf(waterFor(set, 1).lines.points)).not.toBe(hashOf(first.lines.points));
		});

		it('rebuilds the same water over the same land from its surface, and refuses a surface for another map', () => {
			const set = { seed: 11, environment: 'rustBelt', radius: 800 } as const;
			const water = waterFor(set);
			const rebuilt = waterFromSurface({ terrain: landFor(set), surface: structuredClone(water.surface) });
			const reach = landFor(set).radius;
			for (let x = -reach; x <= reach; x += reach / 9) {
				for (let y = -reach; y <= reach; y += reach / 9) {
					expect(rebuilt.waterAt(x, y)).toBe(water.waterAt(x, y));
					expect(rebuilt.moisture(x, y)).toBe(water.moisture(x, y));
					expect(rebuilt.terrain.biome(x, y)).toBe(water.terrain.biome(x, y));
					expect(rebuilt.riverCrossings(x, y, x + 20, y + 10)).toBe(water.riverCrossings(x, y, x + 20, y + 10));
				}
			}
			expect(Object.isFrozen(rebuilt.surface)).toBe(true);
			expect(() => waterFromSurface({ terrain: landFor({ seed: 11, radius: 900 }), surface: water.surface })).toThrow(RangeError);
			expect(() => waterFromSurface({ terrain: landFor(set), surface: { ...water.surface, moisture: new Float32Array(3) } })).toThrow(RangeError);
		});
	});
});

interface PinnedWater {
	readonly set: MapParamSet;
	readonly moisture: number;
	readonly lakeDepth: number;
	readonly points: number;
	readonly rivers: number;
	readonly lakes: string[];
}

const PINNED: PinnedWater[] = [
	{ set: { seed: 7, radius: 800 }, moisture: 170918580, lakeDepth: 121594240, points: 2984396213, rivers: 28, lakes: ['reservoir 166', 'reservoir 94'] },
	{ set: { seed: 17, environment: 'floodlands', radius: 800, rivers: 0 }, moisture: 3769450932, lakeDepth: 561159859, points: 4152388316, rivers: 43, lakes: ['reservoir 33', 'reservoir 87', 'reservoir 42', 'reservoir 177', 'reservoir 134'] },
];
