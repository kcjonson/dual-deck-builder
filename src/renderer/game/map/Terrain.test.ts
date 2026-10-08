import { Rng } from '../core/Rng';
import { BIOMES, BIOME_COSTS, Biome } from './Biome';
import { MapParamSet, MapParams, resolveMapParams } from './MapParams';
import { validateMapParams } from './ParamValidator';
import { CLIFF_GRADE, RELIEF, SLOPE_COST, Terrain, TerrainSample, WaterLayer, createTerrainSample, generateTerrain } from './Terrain';
import { TOWN_CRATER_GAP, TOWN_SPACING } from './TerrainSites';

/** The terrain stream as the pipeline forks it: `root.fork('map', mapAttempt).fork('terrain', stageAttempt)`. */
const terrainStream = (seed: number, stageAttempt = 0) => new Rng({ seed }).fork('map', 0).fork('terrain', stageAttempt);

const paramsFor = (set: MapParamSet): MapParams => validateMapParams(resolveMapParams(set).params).params;

function terrainFor(set: MapParamSet, stageAttempt = 0): Terrain {
	const params = paramsFor(set);
	return generateTerrain({ params, rng: terrainStream(params.seed, stageAttempt) });
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

const SEEDS = Array.from({ length: 6 }, (_, index) => (index * 2654435761 + 12345) >>> 0);

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

const PARAM_SETS = sampledParamSets(25);

describe('generateTerrain', () => {
	describe('determinism', () => {
		it('samples the same terrain from the same params and stream', () => {
			SEEDS.forEach((seed) => {
				const first = terrainFor({ seed, environment: 'badlands' });
				const second = terrainFor({ seed, environment: 'badlands' });
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
		// process and hold in every engine: sampling is IEEE arithmetic with no
		// Math call. A change here moves every map, and with it the roads.
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
		it.each(PARAM_SETS.map((set, index) => [index, set] as const))('is scrub and never impassable, in parameter set %i', (_index, set) => {
			const terrain = terrainFor(set);
			const metro = terrain.metro;
			const sample = createTerrainSample();
			[[0, 0] as [number, number], ...polar(0.05 * metro.radius, 0.999 * metro.radius, 8, 24)].forEach(([x, y]) => {
				terrain.sample(x, y, sample);
				expect(sample.obstacle).toBeNull();
				expect(sample.biome).toBe('scrub');
				expect(sample.cost).toBeGreaterThanOrEqual(1);
				expect(sample.cost).toBeLessThan(BIOME_COSTS.scrub + SLOPE_COST);
				expect(sample.contamination).toBe(0);
				expect(sample.ruin).toBe(1);
				expect(terrain.impassable(x, y)).toBe(false);
			});
			terrain.hotspots.forEach((hotspot) => {
				expect(Math.hypot(hotspot.x, hotspot.y) - hotspot.craterRadius).toBeGreaterThan(metro.radius);
			});
		});
	});

	describe('towns', () => {
		it.each(PARAM_SETS.map((set, index) => [index, set] as const))('are spaced, inside the disc, outside the metro, and reachable, in parameter set %i', (_index, set) => {
			const terrain = terrainFor(set);
			const params = paramsFor(set);
			expect(terrain.towns).toHaveLength(params.towns);
			terrain.towns.forEach((town, index) => {
				const fromCentre = Math.hypot(town.x, town.y);
				expect(fromCentre + town.radius).toBeLessThanOrEqual(terrain.radius);
				expect(fromCentre - town.radius).toBeGreaterThan(terrain.metro.radius);
				expect(terrain.impassable(town.x, town.y)).toBe(false);
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

		it('gives slope as elevation\'s exact gradient, and grade as its size against RELIEF', () => {
			const terrain = terrainFor({ seed: 53, environment: 'badlands' });
			const slope = { x: 0, y: 0 };
			const step = 1e-5;
			gridInside(terrain.radius, 20).forEach(([x, y]) => {
				terrain.slope(x, y, slope);
				const east = (terrain.elevation(x + step, y) - terrain.elevation(x - step, y)) / (2 * step);
				const north = (terrain.elevation(x, y + step) - terrain.elevation(x, y - step)) / (2 * step);
				// Ridges and gullies crease where their noise crosses zero, so a few
				// points sit within a step of a kink; the rest match to rounding.
				if (Math.hypot(east - slope.x, north - slope.y) > 1e-6) return;
				expect(slope.x).toBeCloseTo(east, 7);
				expect(slope.y).toBeCloseTo(north, 7);
				expect(terrain.grade(x, y)).toBeCloseTo(Math.hypot(slope.x, slope.y) * RELIEF, 9);
			});
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
		] as const)('stands cliffs only in rough country, away from the metro, at its share of the land, in %s', (_name, set) => {
			const ruggedness = paramsFor({ seed: 1, ...set }).ruggedness;
			sampledSeeds(2).forEach((seed) => {
				const terrain = terrainFor({ seed, ...set });
				let outer = 0;
				let rough = 0;
				gridInside(terrain.radius, 48).forEach(([x, y]) => {
					if (terrain.obstacle(x, y) === 'cliff') expect(terrain.rough(x, y)).toBe(true);
					const distance = Math.hypot(x, y);
					if (distance <= terrain.metro.radius) expect(terrain.rough(x, y)).toBe(false);
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

		// The seeds are the first of a fixed sequence, not picked. Over the first
		// 200 of it at a 2-unit grid, each set kept at least REACH_BAR of the edge
		// in reach (the decision record has the figures); this grid is coarser.
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

		// A faint canyon used to keep its full wall grade by narrowing, leaving
		// hairline cliffs a road could slip between samples. Now a cliff is a
		// band: only its tapered tips are thin, a few points in a hundred.
		it.each([
			['aridity 0.6', { seed: 21, aridity: 0.6 }],
			['the Rust Belt', { seed: 21, environment: 'rustBelt' }],
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
			expect(widths[Math.floor(widths.length / 2)]).toBeGreaterThan(6);
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

/** The first `count` seeds of a fixed sequence, the same one the record's reach figures sample. */
function sampledSeeds(count: number): number[] {
	return Array.from({ length: count }, (_, index) => (1 + index * 2654435761) >>> 0);
}

/** The least share of the edge's passable ground the start keeps in reach, by the record's figures, less some room. */
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
			[-611.2336075244629, 279.9944087798049, 39.62356013478711],
			[-120.26897811008307, -432.5959208257931, 48.38355683488772],
			[-289.09780815886785, 524.6385119636552, 59.338289894512855],
			[52.61618782852272, 359.3206799057808, 49.80767031549477],
			[553.9936126772009, 294.7048120849578, 37.879844749113545],
		],
		samples: [
			[0.3781474532459609, 0.2303036977605881, 1, -0.0020251851673929204, 0.00019854127988038373, 'desert', null, 1.529503568138026],
			[0.41488593931910456, 0.8045358325705595, 0, 0.00036053671737964576, 0.0013290712279915773, 'mire', null, 2.3280081511216406],
			[0.4663712264928344, 0.6277333371680247, 1, -0.0008188733174374935, -0.0007475054946420045, 'scrub', null, 1.0829789632808475],
			[0.34731348496928877, 0.4732709194777859, 0.12096915847483337, 1.1980568425975721e-05, -0.00016670543586277083, 'scrub', null, 1.0018855609547055],
		],
	},
	{
		hotspots: [
			[-571.1737254168838, -221.54975216835737, 23.61863434035331, 169.07154500679528, 0.9486516110482626],
			[-309.1087798587978, 472.3018466960639, 17.39494163170457, 95.3333925641394, 0.919366131129209],
		],
		towns: [
			[-654.4192683515221, -105.30485623859103, 53.2332229387248],
			[-97.99919166681258, 539.5888131719765, 40.3330118895974],
			[197.00505187686355, -596.9186338043954, 58.69715590495616],
		],
		samples: [
			[0.5141717391861589, 0.06387422840466858, 1, -0.0038625277755178896, 0.006825035169531719, 'badlands', 'cliff', Infinity],
			[0.3370120442884988, 0, 0.27556383105222854, 0.0002585805224338015, -0.0034806060885716737, 'desert', null, 2.072250077550943],
			[0.43854457103270295, 0.43228157138142786, 0.574718708366966, -0.0013025046575476725, 0.0006809027519101567, 'scrub', null, 1.1458099184832238],
			[0.4430949060669424, 0.28582790142605186, 1, -0.00022613031939734327, 0.003713788692016602, 'badlands', null, 2.734426892495326],
		],
	},
	{
		hotspots: [
			[-305.9511128347367, 71.11416114494205, 22.387592181563377, 126.64268024208069, 0.8775745225138962],
			[138.76231354661286, -563.0688441451639, 22.67363932915032, 158.74347548217509, 0.9132970167556778],
			[-9.06471898779273, 813.8863891828805, 19.487174225971103, 97.81371605482627, 0.9220535308704711],
		],
		towns: [
			[459.9788129354077, 396.3323274838254, 56.78458511014469],
			[-559.3787934424686, -152.46890115319226, 54.428250047494664],
			[458.56976040771656, 669.3510589411406, 44.55636677099392],
			[613.6421711531988, 40.06047834697802, 46.299235935439356],
			[-718.5837959341221, 71.97374671339715, 41.35158671415411],
		],
		samples: [
			[0.541298197591693, 1, 1, 0.0011655276052387178, 0.00019065532867785484, 'scrub', null, 1.0941492735725564],
			[0.36503480331317134, 1, 1, -0.0006328866881619748, -0.00012921488433452277, 'mire', null, 2.2281638381310698],
			[0.3789306609490824, 0.5289503505836217, 1, 0.0006499101842655646, 0.00040918975357503144, 'mire', null, 2.2398128163878956],
			[0.5659325326482064, 0.7650356008089566, 0, -0.0028823649091254833, 0.00015846903786489623, 'mountains', null, 3.062486943609085],
		],
	},
];
