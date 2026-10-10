import { Rng } from '../core/Rng';
import { BIOMES, BIOME_COSTS, Biome } from './Biome';
import { cellCentre, landGridFor } from './LandGrid';
import { MapParamSet, MapParams, resolveMapParams } from './MapParams';
import { validateMapParams } from './ParamValidator';
import { generateLand, moistureLevel, terraceHeight, terracePull } from './Land';
import { CLIFF_GRADE, RELIEF, SLOPE_COST, Terrain, TerrainSample, WaterLayer, createTerrainSample, generateTerrain, terrainFromSurface } from './Terrain';
import { TOWN_CRATER_GAP, TOWN_SPACING } from './TerrainSites';

/** The terrain stream as the pipeline forks it: `root.fork('map', mapAttempt).fork('terrain', stageAttempt)`. */
const terrainStream = (seed: number, stageAttempt = 0) => new Rng({ seed }).fork('map', 0).fork('terrain', stageAttempt);

const paramsFor = (set: MapParamSet): MapParams => validateMapParams(resolveMapParams(set).params).params;

function buildTerrain(set: MapParamSet, stageAttempt = 0): Terrain {
	const params = paramsFor(set);
	return generateTerrain({ params, rng: terrainStream(params.seed, stageAttempt) });
}

/** Erosion makes a terrain dear to build, so each set is built once a file; sampling one never changes it. */
const built = new Map<string, Terrain>();
function terrainFor(set: MapParamSet, stageAttempt = 0): Terrain {
	const key = JSON.stringify([set, stageAttempt]);
	let terrain = built.get(key);
	if (!terrain) {
		terrain = buildTerrain(set, stageAttempt);
		built.set(key, terrain);
	}
	return terrain;
}

/** Points on a square grid of `cells` across the disc, inside it. */
function gridInside(radius: number, cells: number): [number, number][] {
	const points: [number, number][] = [];
	for (let row = 0; row < cells; row += 1) {
		for (let column = 0; column < cells; column += 1) {
			const x = ((column + 0.5) / cells * 2 - 1) * radius;
			const y = ((row + 0.5) / cells * 2 - 1) * radius;
			if (x * x + y * y <= radius * radius) points.push([x, y]);
		}
	}
	return points;
}

/** Points between `inner` and `outer`, on rings and bearings. */
function polar(inner: number, outer: number, rings: number, bearings: number): [number, number][] {
	const points: [number, number][] = [];
	for (let ring = 0; ring <= rings; ring += 1) {
		const distance = inner + (outer - inner) * ring / rings;
		for (let bearing = 0; bearing < bearings; bearing += 1) {
			const angle = (bearing + 0.5 * (ring % 2)) / bearings * 2 * Math.PI;
			points.push([distance * Math.cos(angle), distance * Math.sin(angle)]);
		}
	}
	return points;
}

const SEEDS = Array.from({ length: 2 }, (_, index) => (index * 2654435761 + 12345) >>> 0);

/**
 * Parameter sets across the tuning ranges: the corners that push hardest on
 * the start (most rugged, most mountainous, driest, most toxic, most
 * hotspots, the smallest and largest metros and maps), then random sets
 * where each world parameter is at an end of its range half the time.
 */
function sampledParamSets(count: number): MapParamSet[] {
	const extremes: MapParamSet[] = [
		{ seed: 1, mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1, hotspots: 6, towns: 12, metroSize: 0.08, radius: 600 },
		{ seed: 2, mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1, hotspots: 6, towns: 12, metroSize: 0.25, radius: 1600 },
		{ seed: 3, mountainCoverage: 1, ruggedness: 1, aridity: 1, contamination: 1, hotspots: 6, towns: 12, metroSize: 0.08, radius: 1600 },
		{ seed: 4, mountainCoverage: 0, ruggedness: 1, aridity: 0, contamination: 1, hotspots: 6, towns: 12, metroSize: 0.25, radius: 600 },
		{ seed: 5, mountainCoverage: 0, ruggedness: 0, aridity: 1, contamination: 0, hotspots: 0, towns: 0, metroSize: 0.08, radius: 600 },
	];
	const rng = new Rng({ seed: 2024 });
	const pick = (min: number, max: number) => {
		const draw = rng.float();
		return draw < 0.25 ? min : draw < 0.5 ? max : min + (max - min) * rng.float();
	};
	const random = Array.from({ length: count }, (): MapParamSet => ({
		seed: rng.next(),
		environment: rng.pick(['highDesert', 'rustBelt', 'floodlands', 'badlands', 'mixed'] as const),
		radius: pick(600, 1600),
		aridity: pick(0, 1),
		mountainCoverage: pick(0, 1),
		ruggedness: pick(0, 1),
		contamination: pick(0, 1),
		hotspots: Math.round(pick(0, 6)),
		metroSize: pick(0.08, 0.25),
		towns: Math.round(pick(0, 12)),
	}));
	return [...extremes, ...random];
}

const PARAM_SETS = sampledParamSets(10);

describe('generateTerrain', () => {
	describe('determinism', () => {
		it('samples the same terrain from the same params and stream', () => {
			SEEDS.forEach((seed) => {
				const first = buildTerrain({ seed, environment: 'badlands' });
				const second = buildTerrain({ seed, environment: 'badlands' });
				expect(second.hotspots).toEqual(first.hotspots);
				expect(second.towns).toEqual(first.towns);
				const a = createTerrainSample();
				const b = createTerrainSample();
				gridInside(first.radius, 12).forEach(([x, y]) => expect(second.sample(x, y, b)).toEqual(first.sample(x, y, a)));
			});
		});

		it('samples the same values in any order, and from a fresh copy of the module', () => {
			const set = { seed: 77, environment: 'highDesert' } as const;
			const terrain = terrainFor(set);
			const points = gridInside(terrain.radius, 16);
			const forward = points.map(([x, y]) => [terrain.elevation(x, y), terrain.moisture(x, y), terrain.travelCost(x, y)]);
			const backward = [...points].reverse().map(([x, y]) => [terrain.travelCost(x, y), terrain.moisture(x, y), terrain.elevation(x, y)]).reverse();
			expect(backward.map(([cost, moisture, elevation]) => [elevation, moisture, cost])).toEqual(forward);

			let isolated: typeof generateTerrain | null = null;
			jest.isolateModules(() => {
				isolated = (jest.requireActual('./Terrain') as typeof import('./Terrain')).generateTerrain;
			});
			if (!isolated) throw new Error('Terrain did not load');
			const fresh = (isolated as typeof generateTerrain)({ params: paramsFor(set), rng: terrainStream(77) });
			expect(points.map(([x, y]) => [fresh.elevation(x, y), fresh.moisture(x, y), fresh.travelCost(x, y)])).toEqual(forward);
		});

		// What a seed's terrain is belongs to what the seed means, so a few
		// samples are pinned, as the PRNG's are. They were computed in another
		// process and hold in every engine: erosion and sampling are IEEE
		// arithmetic and square roots, which ECMAScript rounds exactly, with no
		// other Math call. A change here moves every map, and with it the roads.
		it('samples the pinned terrain for three seeds', () => {
			expect(pinnedSummary(terrainFor({ seed: 2183746551 }))).toEqual(PINNED[0]);
			expect(pinnedSummary(terrainFor({ seed: 7, environment: 'highDesert' }))).toEqual(PINNED[1]);
			expect(pinnedSummary(terrainFor({ seed: 4294967295, environment: 'floodlands' }))).toEqual(PINNED[2]);
		});

		it('builds different terrain on another stage attempt', () => {
			const first = terrainFor({ seed: 9 });
			const retried = terrainFor({ seed: 9 }, 1);
			const points = gridInside(first.radius, 8);
			expect(points.filter(([x, y]) => first.elevation(x, y) !== retried.elevation(x, y)).length).toBeGreaterThan(points.length / 2);
		});

		it('keeps each feature on its own stream, so towns and hotspots never move the land', () => {
			const base = terrainFor({ seed: 31 });
			const moreTowns = terrainFor({ seed: 31, towns: 11 });
			const moreHotspots = terrainFor({ seed: 31, hotspots: 6 });
			gridInside(base.radius, 10).forEach(([x, y]) => {
				expect(moreTowns.elevation(x, y)).toBe(base.elevation(x, y));
				expect(moreTowns.contamination(x, y)).toBe(base.contamination(x, y));
				expect(moreHotspots.elevation(x, y)).toBe(base.elevation(x, y));
				expect(moreHotspots.moisture(x, y)).toBe(base.moisture(x, y));
			});
			expect(moreHotspots.hotspots.slice(0, base.hotspots.length)).toEqual(base.hotspots);
		});
	});

	describe('the start', () => {
		it.each(PARAM_SETS.map((set, index) => [index, set] as const))('is flat scrub and never impassable, in parameter set %i', (_index, set) => {
			const terrain = terrainFor(set);
			const metro = terrain.metro;
			const sample = createTerrainSample();
			[[0, 0] as [number, number], ...polar(0.05 * metro.radius, 0.999 * metro.radius, 8, 24)].forEach(([x, y]) => {
				terrain.sample(x, y, sample);
				expect(sample.obstacle).toBeNull();
				expect(sample.biome).toBe('scrub');
				// The flattest ground on the map, even at the tuning range's steepest corners.
				expect(sample.grade).toBeLessThan(0.4);
				expect(sample.cost).toBeGreaterThanOrEqual(1);
				expect(sample.cost).toBeLessThan(BIOME_COSTS.scrub + SLOPE_COST * 0.16);
				expect(sample.contamination).toBe(0);
				expect(sample.ruin).toBe(1);
				expect(terrain.impassable(x, y)).toBe(false);
				expect(terrain.surelyReachable(x, y)).toBe(true);
			});
			terrain.hotspots.forEach((hotspot) => {
				expect(Math.hypot(hotspot.x, hotspot.y) - hotspot.craterRadius).toBeGreaterThan(metro.radius);
			});
		});
	});

	describe('towns', () => {
		it.each(PARAM_SETS.map((set, index) => [index, set] as const))('are spaced, inside the disc, outside the metro, and surely reachable, in parameter set %i', (_index, set) => {
			const terrain = terrainFor(set);
			const params = paramsFor(set);
			expect(terrain.towns).toHaveLength(params.towns);
			terrain.towns.forEach((town, index) => {
				const fromCentre = Math.hypot(town.x, town.y);
				expect(fromCentre + town.radius).toBeLessThanOrEqual(terrain.radius);
				expect(fromCentre - town.radius).toBeGreaterThan(terrain.metro.radius);
				expect(terrain.impassable(town.x, town.y)).toBe(false);
				expect(terrain.surelyReachable(town.x, town.y)).toBe(true);
				expect(terrain.ruin(town.x, town.y)).toBe(1);
				terrain.hotspots.forEach((hotspot) => {
					expect(Math.hypot(town.x - hotspot.x, town.y - hotspot.y)).toBeGreaterThanOrEqual(hotspot.craterRadius + town.radius + TOWN_CRATER_GAP);
				});
				terrain.towns.slice(index + 1).forEach((other) => {
					expect(Math.hypot(town.x - other.x, town.y - other.y)).toBeGreaterThanOrEqual(TOWN_SPACING * terrain.radius);
				});
			});
		});
	});

	describe('towns at the edge of the tuning range', () => {
		// Where most of the ring is rough or cut off, and placed towns crowd
		// the rest, candidates from the reached cells still find every town
		// room, with the shuffled walk over those cells as the last resort.
		const corner: MapParamSet = { seed: 0, mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1, hotspots: 6, towns: 12, metroSize: 0.25, radius: 600 };
		it.each([
			['the most crowded corner', corner, 6],
			['the most crowded corner with no hotspots', { ...corner, hotspots: 0 }, 2],
			['the most crowded corner with a mid-sized metro', { ...corner, metroSize: 0.15 }, 2],
			['the most crowded corner at the largest radius', { ...corner, radius: 1600 }, 2],
		] as const)('places every town asked for, each where a road from the metro reaches, at %s', (_name, set, seeds) => {
			sampledSeeds(seeds).forEach((seed) => {
				const terrain = terrainFor({ ...set, seed });
				expect(terrain.towns).toHaveLength(12);
				terrain.towns.forEach((town) => expect(terrain.surelyReachable(town.x, town.y)).toBe(true));
			});
		});
	});

	describe('hotspots', () => {
		it('places every one asked for, each a crater in a plume of contamination', () => {
			PARAM_SETS.forEach((set) => {
				const terrain = terrainFor(set);
				expect(terrain.hotspots).toHaveLength(paramsFor(set).hotspots);
				terrain.hotspots.forEach((hotspot) => {
					expect(terrain.obstacle(hotspot.x, hotspot.y)).toBe('crater');
					expect(terrain.travelCost(hotspot.x, hotspot.y)).toBe(Infinity);
					expect(terrain.contamination(hotspot.x, hotspot.y)).toBeGreaterThanOrEqual(hotspot.strength);
					expect(terrain.obstacle(hotspot.x + hotspot.craterRadius * 1.01, hotspot.y)).not.toBe('crater');
				});
			});
		});
	});

	describe('biomes', () => {
		const shares = (set: MapParamSet): Record<Biome, number> => {
			const terrain = terrainFor(set);
			const counts = Object.fromEntries(BIOMES.map((biome) => [biome, 0])) as Record<Biome, number>;
			const points = gridInside(terrain.radius, 40);
			points.forEach(([x, y]) => {
				counts[terrain.biome(x, y)] += 1;
			});
			BIOMES.forEach((biome) => {
				counts[biome] /= points.length;
			});
			return counts;
		};

		it.each([
			['scrub', { seed: 3 }],
			['desert', { seed: 3, aridity: 0 }],
			['mire', { seed: 3, aridity: 1, contamination: 1, mountainCoverage: 0 }],
			['badlands', { seed: 3, aridity: 0.3, ruggedness: 1, contamination: 1 }],
			['canyons', { seed: 3, aridity: 0, ruggedness: 1 }],
			['mountains', { seed: 3, mountainCoverage: 0.5 }],
		] as const)('makes %s where the parameters call for it', (biome, set) => {
			expect(shares(set)[biome]).toBeGreaterThan(0.02);
		});

		it.each([
			['mountains', { seed: 3, mountainCoverage: 0 }],
			['canyons', { seed: 3, aridity: 0.7 }],
			['badlands', { seed: 3, ruggedness: 0 }],
		] as const)('makes no %s when the parameter that makes them is off', (biome, set) => {
			expect(shares(set)[biome]).toBe(0);
		});

		it('gives each environment its character', () => {
			const desert = shares({ seed: 5, environment: 'highDesert' });
			const flood = shares({ seed: 5, environment: 'floodlands' });
			const bad = shares({ seed: 5, environment: 'badlands' });
			expect(desert.desert).toBeGreaterThan(flood.desert);
			expect(flood.mire).toBeGreaterThan(desert.mire);
			expect(bad.badlands).toBeGreaterThan(flood.badlands);
			expect(desert.canyons + bad.canyons).toBeGreaterThan(flood.canyons);
		});
	});

	describe('fields', () => {
		it('keeps every field in its range', () => {
			PARAM_SETS.slice(0, 6).forEach((set) => {
				const terrain = terrainFor(set);
				const sample = createTerrainSample();
				gridInside(terrain.radius, 14).forEach(([x, y]) => {
					terrain.sample(x, y, sample);
					[sample.elevation, sample.moisture, sample.contamination, sample.mountains, sample.canyons, sample.badlands, sample.ruin].forEach((value) => {
						expect(value).toBeGreaterThanOrEqual(0);
						expect(value).toBeLessThanOrEqual(1);
					});
					expect(sample.grade).toBeGreaterThanOrEqual(0);
				});
			});
		});

		it('gives mountains the share of the country that mountainCoverage asks for', () => {
			[0.15, 0.4, 0.8].forEach((coverage) => {
				const terrain = terrainFor({ seed: 41, mountainCoverage: coverage });
				const outer = gridInside(terrain.radius, 48).filter(([x, y]) => Math.hypot(x, y) >= 0.5 * terrain.radius);
				const share = outer.filter(([x, y]) => terrain.biome(x, y) === 'mountains').length / outer.length;
				expect(share).toBeGreaterThan(coverage - 0.08);
				expect(share).toBeLessThan(coverage + 0.08);
			});
		});

		it('makes the share of the country contamination asks for toxic, and hotspots add to it', () => {
			[0.1, 0.5, 0.9].forEach((level) => {
				const clean = terrainFor({ seed: 43, contamination: level, hotspots: 0 });
				const outer = gridInside(clean.radius, 48).filter(([x, y]) => Math.hypot(x, y) >= 0.5 * clean.radius);
				const share = outer.filter(([x, y]) => clean.contamination(x, y) >= 0.5).length / outer.length;
				expect(share).toBeGreaterThan(level - 0.08);
				expect(share).toBeLessThan(level + 0.08);
				const spilled = terrainFor({ seed: 43, contamination: level, hotspots: 6 });
				outer.forEach(([x, y]) => expect(spilled.contamination(x, y)).toBeGreaterThanOrEqual(clean.contamination(x, y)));
			});
		});

		it('runs wetter as aridity rises, following the spec\'s 0 dry to 1 wet', () => {
			const meanMoisture = (aridity: number) => {
				const terrain = terrainFor({ seed: 47, aridity });
				const points = gridInside(terrain.radius, 24);
				return points.reduce((sum, [x, y]) => sum + terrain.moisture(x, y), 0) / points.length;
			};
			const dry = meanMoisture(0.1);
			const middling = meanMoisture(0.5);
			const wet = meanMoisture(0.9);
			expect(dry).toBeLessThan(middling);
			expect(middling).toBeLessThan(wet);
		});

		it.each([
			['the Badlands', { seed: 53, environment: 'badlands' }],
			['the High Desert', { seed: 53, environment: 'highDesert' }],
			['the most rugged corner', { seed: 53, mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1 }],
		] as const)('gives slope as elevation\'s exact gradient, and grade as its size against RELIEF, in %s', (_name, set) => {
			const terrain = terrainFor(set);
			const slope = { x: 0, y: 0 };
			// Large enough to stay clear of rounding. A crease shows as a jump in
			// slope, (east - 2 here + west) / step, that stays as the step
			// shrinks; curvature shows as curvature times the step, here under
			// 1e-7 even where a dry map's terrace risers bend hardest.
			const step = 1e-6;
			const crease = 1e-6;
			// The eroded grid is sampled bicubic, smooth in value and slope,
			// terraces are smoothsteps of it, and range country's fine relief
			// is plain fractal noise, so the land has no crease anywhere but
			// where it's held to 0 or 1, which these grids miss: a point within
			// a step of a crease is counted rather than checked, and none may be.
			const points = gridInside(terrain.radius, 20);
			let creased = 0;
			points.forEach(([x, y]) => {
				const here = terrain.elevation(x, y);
				const east = terrain.elevation(x + step, y);
				const west = terrain.elevation(x - step, y);
				const north = terrain.elevation(x, y + step);
				const south = terrain.elevation(x, y - step);
				if (Math.abs(east - 2 * here + west) / step > crease || Math.abs(north - 2 * here + south) / step > crease) {
					creased += 1;
					return;
				}
				terrain.slope(x, y, slope);
				expect(Math.abs(slope.x - (east - west) / (2 * step))).toBeLessThan(1e-7);
				expect(Math.abs(slope.y - (north - south) / (2 * step))).toBeLessThan(1e-7);
				expect(terrain.grade(x, y)).toBeCloseTo(Math.hypot(slope.x, slope.y) * RELIEF, 9);
			});
			expect(creased).toBe(0);
		});

		it('builds the same terrain over land grown elsewhere, and refuses land grown for another map', () => {
			const set = { seed: 63, radius: 800 };
			const params = paramsFor(set);
			const surface = generateLand({ params, rng: terrainStream(params.seed) });
			const rebuilt = terrainFromSurface({ params, rng: terrainStream(params.seed), surface });
			const built = terrainFor(set);
			const a = createTerrainSample();
			const b = createTerrainSample();
			gridInside(params.radius, 10).forEach(([x, y]) => expect(rebuilt.sample(x, y, b)).toEqual(built.sample(x, y, a)));
			expect(rebuilt.towns).toEqual(built.towns);
			expect(() => terrainFromSurface({ params: paramsFor({ ...set, radius: 900 }), rng: terrainStream(params.seed), surface })).toThrow(RangeError);
			const short = { ...surface, mountains: new Float64Array(10) };
			expect(() => terrainFromSurface({ params, rng: terrainStream(params.seed), surface: short })).toThrow(RangeError);
			const otherDrainage = { ...surface, drainage: { ...surface.drainage, size: surface.grid.size + 2 } };
			expect(() => terrainFromSurface({ params, rng: terrainStream(params.seed), surface: otherDrainage })).toThrow(RangeError);
		});

		it('terraces a dry map as it samples it, the same pull everywhere past the blend ring and none in the metro', () => {
			// No ranges, so no fine relief goes on after the terraces.
			const set = { seed: 23, environment: 'highDesert', radius: 600, mountainCoverage: 0 } as const;
			const dry = terrainFor({ ...set, aridity: 0.05 });
			const wet = terrainFor({ ...set, aridity: 0.8 });
			const pull = terracePull(moistureLevel(0.05));
			expect(pull).toBeGreaterThan(0);
			let terraced = 0;
			let moved = 0;
			gridInside(dry.radius, 60).forEach(([x, y]) => {
				const ground = wet.elevation(x, y);
				const distance = Math.hypot(x, y);
				if (distance < dry.metro.radius) expect(dry.elevation(x, y)).toBe(ground);
				if (distance <= dry.blendRadius || ground <= 0 || ground >= 1) return;
				expect(dry.elevation(x, y)).toBe(terraceHeight(ground, pull));
				terraced += 1;
				if (dry.elevation(x, y) !== ground) moved += 1;
			});
			expect(terraced).toBeGreaterThan(1000);
			expect(moved / terraced).toBeGreaterThan(0.9);
		});

		it('hands out its land frozen, its arrays the stages\' to read and never write', () => {
			const { surface } = terrainFor({ seed: 61, radius: 800 });
			expect(Object.isFrozen(surface)).toBe(true);
			expect(Object.isFrozen(surface.grid)).toBe(true);
			expect(Object.isFrozen(surface.drainage)).toBe(true);
		});

		it('keeps low, wet ground the same share of a map however rugged it is', () => {
			const mireShare = (ruggedness: number) => {
				const terrain = terrainFor({ seed: 11, environment: 'floodlands', radius: 800, ruggedness });
				const points = gridInside(terrain.radius, 40);
				return points.filter(([x, y]) => terrain.biome(x, y) === 'mire').length / points.length;
			};
			const gentle = mireShare(0.15);
			const rugged = mireShare(0.85);
			expect(gentle).toBeGreaterThan(0.2);
			expect(Math.abs(gentle - rugged)).toBeLessThan(0.05);
		});

		it('reads the eroded land: elevation at a cell centre clear of the ranges is the grid\'s, and the grid and its drainage are there for the water stage', () => {
			const terrain = terrainFor({ seed: 61, radius: 800 });
			const { grid, elevation, mountains, drainage } = terrain.surface;
			expect(grid).toEqual(landGridFor(800));
			expect(drainage.receivers).toHaveLength(grid.size * grid.size);
			let checked = 0;
			for (let row = 2; row < grid.size - 2; row += 7) {
				for (let column = 2; column < grid.size - 2; column += 7) {
					let ranges = 0;
					for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) ranges += mountains[(row + dy) * grid.size + column + dx];
					if (ranges !== 0) continue;
					expect(terrain.elevation(cellCentre(grid, column), cellCentre(grid, row))).toBeCloseTo(elevation[row * grid.size + column], 12);
					checked += 1;
				}
			}
			expect(checked).toBeGreaterThan(200);
		});

		it('fills ruins: the metro and every town at 1, open country at 0', () => {
			const terrain = terrainFor({ seed: 59, towns: 8 });
			expect(terrain.ruin(0, 0)).toBe(1);
			terrain.towns.forEach((town) => expect(terrain.ruin(town.x + town.radius * 0.9, town.y)).toBe(1));
			const far = gridInside(terrain.radius, 30).filter(([x, y]) => [terrain.metro, ...terrain.towns].every((ruin) => Math.hypot(x - ruin.x, y - ruin.y) >= 2 * ruin.radius));
			far.forEach(([x, y]) => expect(terrain.ruin(x, y)).toBe(0));
		});
	});

	describe('impassability and cost', () => {
		it.each(PARAM_SETS.slice(0, 6).map((set, index) => [index, set] as const))('agree with each other and with sample, in parameter set %i', (_index, set) => {
			const terrain = terrainFor(set);
			const sample = createTerrainSample();
			const slope = { x: 0, y: 0 };
			let passable = 0;
			gridInside(terrain.radius, 18).forEach(([x, y]) => {
				terrain.sample(x, y, sample);
				const obstacle = terrain.obstacle(x, y);
				const cost = terrain.travelCost(x, y);
				expect(sample.obstacle).toBe(obstacle);
				expect(sample.cost).toBe(cost);
				expect(terrain.impassable(x, y)).toBe(obstacle !== null);
				expect(sample.elevation).toBe(terrain.elevation(x, y));
				expect(sample.moisture).toBe(terrain.moisture(x, y));
				expect(sample.contamination).toBe(terrain.contamination(x, y));
				expect(sample.biome).toBe(terrain.biome(x, y));
				expect(sample.grade).toBe(terrain.grade(x, y));
				expect(sample.ruin).toBe(terrain.ruin(x, y));
				terrain.slope(x, y, slope);
				expect([sample.slopeX, sample.slopeY]).toEqual([slope.x, slope.y]);

				const inCrater = terrain.hotspots.some((hotspot) => Math.hypot(x - hotspot.x, y - hotspot.y) < hotspot.craterRadius);
				if (inCrater) expect(obstacle).toBe('crater');
				else expect(obstacle).toBe(sample.grade >= CLIFF_GRADE && terrain.rough(x, y) ? 'cliff' : null);
				if (obstacle === null) {
					passable += 1;
					expect(Number.isFinite(cost)).toBe(true);
					expect(cost).toBeGreaterThanOrEqual(BIOME_COSTS[sample.biome]);
					if (sample.grade < CLIFF_GRADE) expect(cost).toBeLessThan(BIOME_COSTS[sample.biome] + SLOPE_COST);
				} else {
					expect(cost).toBe(Infinity);
				}
			});
			expect(passable).toBeGreaterThan(0);
		});

		it.each([
			['the most rugged corner', { mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1, radius: 600 }],
			['the most rugged corner with the smallest metro', { mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1, radius: 600, metroSize: 0.08 }],
			['the Badlands', { environment: 'badlands', radius: 600 }],
		] as const)('stands cliffs only in rough country, past the relief radius, at its share of the land, in %s', (_name, set) => {
			const ruggedness = paramsFor({ seed: 1, ...set }).ruggedness;
			sampledSeeds(2).forEach((seed) => {
				const terrain = terrainFor({ seed, ...set });
				let outer = 0;
				let rough = 0;
				gridInside(terrain.radius, 48).forEach(([x, y]) => {
					if (terrain.obstacle(x, y) === 'cliff') expect(terrain.rough(x, y)).toBe(true);
					const distance = Math.hypot(x, y);
					if (distance < terrain.reliefRadius) expect(terrain.rough(x, y)).toBe(false);
					if (distance >= 0.5 * terrain.radius) {
						outer += 1;
						if (terrain.rough(x, y)) rough += 1;
					}
				});
				const share = 0.1 + 0.25 * ruggedness;
				expect(rough / outer).toBeGreaterThan(share - 0.08);
				expect(rough / outer).toBeLessThan(share + 0.08);
			});
		});

		// The seeds are the first of a fixed sequence, not picked. terrain-erosion.md
		// has how much of the edge the start reaches over more of them.
		it.each([
			['the most rugged corner', { mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1, radius: 600 }],
			['the most rugged corner with the smallest metro', { mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1, radius: 600, metroSize: 0.08 }],
			['the Badlands', { environment: 'badlands', radius: 600 }],
		] as const)('keeps the start in reach of most of the edge, and of every town, in %s', (_name, set) => {
			sampledSeeds(2).forEach((seed) => {
				const terrain = terrainFor({ seed, ...set });
				const { edgeShare, townsReached } = reachFromMetro(terrain, 4);
				expect(edgeShare).toBeGreaterThan(REACH_BAR);
				expect(townsReached).toBe(terrain.towns.length);
			});
		});

		// A cliff is steep ground in rough country, and eroded slopes are steep
		// across cells nine units wide, so a cliff is a band a road can't slip
		// through between samples, every half unit: only its tapered tips are
		// thin. On a dry map a cliff is mostly a terrace's riser, which is
		// narrower than the slope it steepens, about five units at the median.
		it.each([
			['aridity 0.6', { seed: 21, aridity: 0.6 }],
			['the Badlands', { seed: 21, environment: 'badlands' }],
			['the High Desert', { seed: 21, environment: 'highDesert' }],
			['a dry, rugged map', { seed: 22, aridity: 0.35, ruggedness: 1 }],
		] as const)('makes cliffs bands across the slope, not hairlines, in %s', (_name, set) => {
			const terrain = terrainFor(set);
			const sample = createTerrainSample();
			const widths: number[] = [];
			gridInside(terrain.radius, 150).forEach(([x, y]) => {
				terrain.sample(x, y, sample);
				if (sample.obstacle === 'cliff') widths.push(bandWidth(terrain, x, y, sample.slopeX, sample.slopeY));
			});
			expect(widths.length).toBeGreaterThan(50);
			widths.sort((a, b) => a - b);
			expect(widths.filter((width) => width < 2).length / widths.length).toBeLessThan(0.08);
			expect(widths[Math.floor(widths.length / 2)]).toBeGreaterThan(4);
		});
	});

	describe('water', () => {
		const lake: WaterLayer = { isWater: (x, y) => Math.hypot(x - 450, y) < 120 };

		it('adds water to what is impassable and what it costs, through withWater', () => {
			const dry = terrainFor({ seed: 67, hotspots: 0 });
			const wet = dry.withWater(lake);
			expect(dry.water).toBeNull();
			expect(wet.water).toBe(lake);
			expect(wet.radius).toBe(dry.radius);
			expect(wet.towns).toBe(dry.towns);
			const sample = createTerrainSample();
			gridInside(dry.radius, 30).forEach(([x, y]) => {
				expect(wet.elevation(x, y)).toBe(dry.elevation(x, y));
				expect(wet.biome(x, y)).toBe(dry.biome(x, y));
				if (lake.isWater(x, y)) {
					expect(wet.obstacle(x, y)).toBe('water');
					expect(wet.impassable(x, y)).toBe(true);
					expect(wet.travelCost(x, y)).toBe(Infinity);
					expect(wet.sample(x, y, sample)).toMatchObject({ obstacle: 'water', cost: Infinity });
				} else {
					expect(wet.obstacle(x, y)).toBe(dry.obstacle(x, y));
					expect(wet.travelCost(x, y)).toBe(dry.travelCost(x, y));
				}
				expect(dry.obstacle(x, y)).not.toBe('water');
			});
		});

		it('calls a crater a crater even under water', () => {
			const terrain = terrainFor({ seed: 71, hotspots: 3 });
			const flooded = terrain.withWater({ isWater: () => true });
			const [hotspot] = terrain.hotspots;
			expect(flooded.obstacle(hotspot.x, hotspot.y)).toBe('crater');
			expect(flooded.sample(hotspot.x, hotspot.y, createTerrainSample()).obstacle).toBe('crater');
			expect(flooded.obstacle(0, 0)).toBe('water');
		});
	});

	it('answers contains for the disc', () => {
		const terrain = terrainFor({ seed: 73, radius: 800 });
		expect(terrain.contains(0, 0)).toBe(true);
		expect(terrain.contains(800, 0)).toBe(true);
		expect(terrain.contains(600, 600)).toBe(false);
	});
});

/** The first `count` seeds of a fixed sequence, the same one the records' reach figures sample. */
function sampledSeeds(count: number): number[] {
	return Array.from({ length: count }, (_, index) => (1 + index * 2654435761) >>> 0);
}

/**
 * A floor for the share of the edge's passable ground the start keeps in
 * reach. Nothing guarantees it outright: a rough island can wall part of the
 * edge off against the rim.
 */
const REACH_BAR = 0.8;

/**
 * A flood fill from the metro over cells `cell` world units across, through
 * cells whose centres are passable: the share of the outer band (0.85 to 0.95
 * of the radius) it reaches, and how many towns it reaches.
 */
function reachFromMetro(terrain: Terrain, cell: number): { edgeShare: number; townsReached: number } {
	const radius = terrain.radius;
	const cells = Math.ceil(2 * radius / cell);
	const centre = (index: number) => (index + 0.5) * cell - radius;
	const open = new Uint8Array(cells * cells);
	const reached = new Uint8Array(cells * cells);
	const queue: number[] = [];
	for (let row = 0; row < cells; row += 1) {
		for (let column = 0; column < cells; column += 1) {
			const x = centre(column);
			const y = centre(row);
			if (!terrain.contains(x, y) || terrain.impassable(x, y)) continue;
			const index = row * cells + column;
			open[index] = 1;
			if (Math.hypot(x, y) <= terrain.metro.radius) {
				reached[index] = 1;
				queue.push(index);
			}
		}
	}
	while (queue.length > 0) {
		const index = queue.pop() as number;
		const column = index % cells;
		const neighbours = [column > 0 ? index - 1 : -1, column < cells - 1 ? index + 1 : -1, index - cells, index + cells];
		neighbours.forEach((next) => {
			if (next >= 0 && next < open.length && open[next] && !reached[next]) {
				reached[next] = 1;
				queue.push(next);
			}
		});
	}
	let band = 0;
	let inReach = 0;
	for (let row = 0; row < cells; row += 1) {
		for (let column = 0; column < cells; column += 1) {
			const distance = Math.hypot(centre(column), centre(row)) / radius;
			const index = row * cells + column;
			if (distance < 0.85 || distance > 0.95 || !open[index]) continue;
			band += 1;
			if (reached[index]) inReach += 1;
		}
	}
	const townsReached = terrain.towns.filter((town) => reached[Math.floor((town.y + radius) / cell) * cells + Math.floor((town.x + radius) / cell)] === 1).length;
	return { edgeShare: inReach / band, townsReached };
}

/**
 * The width of the cliff band through (x, y) across the slope there: out
 * along the gradient each way in half-unit steps until the ground stops
 * being a cliff, then halving in on where it stops.
 */
function bandWidth(terrain: Terrain, x: number, y: number, slopeX: number, slopeY: number): number {
	const length = Math.hypot(slopeX, slopeY);
	const ux = slopeX / length;
	const uy = slopeY / length;
	const isCliff = (along: number) => terrain.obstacle(x + ux * along, y + uy * along) === 'cliff';
	let width = 0;
	[1, -1].forEach((sign) => {
		let inside = 0;
		let outside = 0.5;
		while (outside < 80 && isCliff(sign * outside)) {
			inside = outside;
			outside += 0.5;
		}
		while (outside - inside > 0.05) {
			const middle = (inside + outside) / 2;
			if (isCliff(sign * middle)) inside = middle;
			else outside = middle;
		}
		width += (inside + outside) / 2;
	});
	return width;
}

interface PinnedSummary {
	readonly hotspots: number[][];
	readonly towns: number[][];
	readonly samples: (number | string | null)[][];
}

/** A terrain boiled down to its features and a few full samples, for pinning. */
function pinnedSummary(terrain: Terrain): PinnedSummary {
	const sample: TerrainSample = createTerrainSample();
	const radius = terrain.radius;
	return {
		hotspots: terrain.hotspots.map(({ x, y, craterRadius, plumeRadius, strength }) => [x, y, craterRadius, plumeRadius, strength]),
		towns: terrain.towns.map(({ x, y, radius: townRadius }) => [x, y, townRadius]),
		samples: [[0.31, -0.42], [-0.66, 0.12], [0.05, 0.77], [-0.5, -0.6]].map(([u, v]) => {
			terrain.sample(u * radius, v * radius, sample);
			return [sample.elevation, sample.moisture, sample.contamination, sample.slopeX, sample.slopeY, sample.biome, sample.obstacle, sample.cost];
		}),
	};
}

const PINNED: PinnedSummary[] = [
	{
		hotspots: [
			[-758.1085036508739, -420.25429238565266, 24.26668080687523, 170.86543934150302, 0.8493960338528268],
			[734.8639287985861, 36.80910598486662, 16.805179963819683, 134.2954313099183, 0.9258736568735912],
			[775.6379151251167, -363.70398136787117, 19.911374516785145, 118.08024964814892, 0.7573065051692538],
		],
		towns: [
			[-26.25829516723752, 554.316593721509, 39.62356013478711],
			[541.0198035240173, 250.92307560145855, 52.41111501061823],
			[-361.13680229336023, -4.433866869658232, 38.113515063305385],
			[329.4148037135601, 462.3349857740104, 39.913091365015134],
			[-521.0830130055547, -475.9570165351033, 58.13928025541827],
		],
		samples: [
			[0.538998224276135, 0.5997013527942647, 0, -0.006977997719128252, 0.003503712585958265, 'mountains', null, 4.329053621594843],
			[0.0393764274759362, 0.4053041595062714, 1, 0.00017848472102936, 0.00008694236229541667, 'scrub', null, 1.0011824731000731],
			[0.015044944984509144, 0.8252026667201403, 0.9048120042699062, -0.00002065279119463914, -0.00015042328272223116, 'mire', null, 2.200691611053072],
			[0.07009501868459986, 0.6126720524894984, 0, -0.0005370097704476285, 0.0005224739318085673, 'scrub', null, 1.0168407550892715],
		],
	},
	{
		hotspots: [
			[-571.1737254168838, -221.54975216835737, 23.61863434035331, 169.07154500679528, 0.9486516110482626],
			[-309.1087798587978, 472.3018466960639, 17.39494163170457, 95.3333925641394, 0.919366131129209],
		],
		towns: [
			[253.29307275637984, -666.9714190587401, 53.2332229387248],
			[-104.92646691203117, 449.87333304062486, 57.15542222606018],
			[-224.6831512749195, -583.4892020709813, 40.76793423446361],
		],
		samples: [
			[0.022961597028416457, 0.004910323738882255, 0.9883711656152957, 0.0009374453546605137, 0.00017812403994521737, 'badlands', null, 1.8273159589974295],
			[0.5794511254436154, 0, 0, -0.001156033402486766, 0.0007041404126588923, 'mountains', null, 2.554966808452137],
			[0.012662426595949974, 0, 1, -0.00003247547472547858, 0.00001307275851059814, 'canyons', null, 1.5000367666042116],
			[0.31761764040198703, 0, 0, 0.01616521524969314, -0.01234285772264014, 'mountains', 'cliff', Infinity],
		],
	},
	{
		hotspots: [
			[-305.9511128347367, 71.11416114494205, 22.387592181563377, 126.64268024208069, 0.8775745225138962],
			[138.76231354661286, -563.0688441451639, 22.67363932915032, 158.74347548217509, 0.9132970167556778],
			[-9.06471898779273, 813.8863891828805, 19.487174225971103, 97.81371605482627, 0.9220535308704711],
		],
		towns: [
			[292.4865979626775, -731.0327410176396, 56.78458511014469],
			[-501.2923129796982, 174.55748349055648, 38.606643261155114],
			[-118.1718448586762, -485.8499503992498, 44.55636677099392],
			[344.2202191017568, 7.166647609323263, 56.83652717212681],
			[-512.5123083740473, -196.28148622438312, 54.370626888703555],
		],
		samples: [
			[0.025327316494020983, 1, 0.007502314534302878, 0.00005611358727836297, 0.0002911524606080273, 'mire', null, 2.202637554699861],
			[0.03769169458824089, 0.9183383750850114, 0, -0.0005056219950456032, -0.0001974093725955641, 'mire', null, 2.2088387218678744],
			[0.15879628391204983, 0.9700731785432873, 0.1737213188223352, 0.009263156518615062, -0.002387928046190513, 'mountains', null, 5.245248071264319],
			[0.0378412142773962, 0.8249086007236212, 0, 0.00006514133223657272, -0.00008620753896227685, 'mire', null, 2.200350253988185],
		],
	},
];
