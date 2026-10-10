import { Rng } from '../core/Rng';
import { unitVector } from './Geometry';
import { generateHazards } from './Hazards';
import { RELIEF, startRadii } from './Land';
import { LandGrid, cellAt, cellCentre, landGridFor } from './LandGrid';
import { MapParamSet, MapParams, resolveMapParams } from './MapParams';
import { validateMapParams } from './ParamValidator';
import { NAME_ENDINGS, NAME_STARTS, placeNames } from './PlaceNames';
import {
	CROSSROADS, EXITS, Places, RIVER_CLEARANCE, RUIN_SIZE, SETTLED, SETTLEMENT_SPACING, SUITABILITY,
	distanceField, exitBearings, generatePlaces, placeList, ruinsOf, suitabilityField,
} from './Places';
import { Terrain, generateTerrain } from './Terrain';
import { CRATER_GAP } from './TerrainSites';
import { Water, WaterSurface, generateWater } from './Water';

const paramsFor = (set: MapParamSet): MapParams => validateMapParams(resolveMapParams(set).params).params;
/** The streams as the pipeline nests them on a first attempt. */
const waterStream = (seed: number) => new Rng({ seed }).fork('map', 0).fork('terrain', 0).fork('water', 0);
const placesStream = (seed: number, attempt = 0) => waterStream(seed).fork('hazards', 0).fork('places', attempt);

interface Built {
	readonly params: MapParams;
	readonly water: Water;
	/** The land with its water and hazards, what places read. */
	readonly terrain: Terrain;
	readonly places: Places;
}

/** Erosion makes a terrain dear to build, so each set's stages are built once a file. Params that only places read can differ over the same land. */
const lands = new Map<string, { water: Water; terrain: Terrain }>();
function build(set: MapParamSet, overrides: Partial<MapParams> = {}, attempt = 0): Built {
	const key = JSON.stringify(set);
	let land = lands.get(key);
	const base = paramsFor(set);
	if (!land) {
		const terrain = generateTerrain({ params: base, rng: new Rng({ seed: base.seed }).fork('map', 0).fork('terrain', 0) });
		const water = generateWater({ params: base, terrain, rng: waterStream(base.seed) });
		const hazards = generateHazards({ params: base, terrain: water.terrain, rng: waterStream(base.seed).fork('hazards', 0) });
		land = { water, terrain: hazards.terrain };
		lands.set(key, land);
	}
	const params = paramsFor({ ...set, ...overrides });
	return { params, ...land, places: generatePlaces({ params, terrain: land.terrain, water: land.water, rng: placesStream(params.seed, attempt) }) };
}

/** The environments at their defaults, the most towns and villages, and the most rugged corner, at radius 800 and 1000. */
const SETS: [string, MapParamSet][] = [
	['Mixed', { seed: 7, radius: 800 }],
	['High Desert', { seed: 3, environment: 'highDesert', radius: 800 }],
	['Rust Belt', { seed: 11, environment: 'rustBelt', radius: 1000 }],
	['Floodlands', { seed: 5, environment: 'floodlands', radius: 800 }],
	['Badlands', { seed: 13, environment: 'badlands', radius: 800, hotspots: 6 }],
	['the most places', { seed: 23, radius: 1000, towns: 12, villages: 40, hotspots: 6 }],
];

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Degrees counterclockwise from `from` to `to`, 0 up to 360. */
const arc = (from: number, to: number) => (((to - from) % 360) + 360) % 360;
/** Degrees between two bearings either way round, 0 to 180. */
const apart = (a: number, b: number) => Math.min(arc(a, b), arc(b, a));

/**
 * A flood fill from the metro over 4-unit cells whose centres aren't
 * impassable, rivers aside, since roads bridge them: whether it reaches each
 * point given.
 */
function reachable(terrain: Terrain, points: readonly { x: number; y: number }[]): boolean[] {
	const cell = 4;
	const radius = terrain.radius;
	const cells = Math.ceil(2 * radius / cell);
	const centre = (index: number) => (index + 0.5) * cell - radius;
	const open = new Uint8Array(cells * cells);
	const reached = new Uint8Array(cells * cells);
	const queue: number[] = [];
	for (let row = 0; row < cells; row += 1) {
		for (let column = 0; column < cells; column += 1) {
			const [x, y] = [centre(column), centre(row)];
			const obstacle = terrain.obstacle(x, y);
			if (!terrain.contains(x, y) || (obstacle !== null && obstacle !== 'river')) continue;
			open[row * cells + column] = 1;
			if (Math.hypot(x, y) <= terrain.metro.radius) {
				reached[row * cells + column] = 1;
				queue.push(row * cells + column);
			}
		}
	}
	while (queue.length > 0) {
		const index = queue.pop() as number;
		const column = index % cells;
		[column > 0 ? index - 1 : -1, column < cells - 1 ? index + 1 : -1, index - cells, index + cells].forEach((next) => {
			if (next >= 0 && next < open.length && open[next] && !reached[next]) {
				reached[next] = 1;
				queue.push(next);
			}
		});
	}
	return points.map(({ x, y }) => reached[Math.floor((y + radius) / cell) * cells + Math.floor((x + radius) / cell)] === 1);
}

/** The ground an exit stands on, as the places stage scores it: the grade there and a cell further in, or Infinity where either is impassable. */
function exitGround(terrain: Terrain, bearing: number): number {
	const { x, y } = unitVector(bearing, { x: 0, y: 0 });
	const at1 = terrain.radius * (1 - EXITS.inset);
	const at2 = at1 - terrain.surface.grid.cellSize;
	const [x1, y1, x2, y2] = [x * at1, y * at1, x * at2, y * at2];
	if (terrain.obstacle(x1, y1) !== null || terrain.obstacle(x2, y2) !== null) return Infinity;
	return 0.5 * (terrain.grade(x1, y1) + terrain.grade(x2, y2));
}

describe('suitabilityField', () => {
	/**
	 * A flat map at radius 600 the test lays out itself: a river down x = 150
	 * with a tributary joining it from the east along y = -100, a slope west
	 * of x = -250 climbing 0.3 a unit, a range's heart north of y = 350, and a
	 * lake round (-150, -350).
	 */
	function syntheticMap() {
		const radius = 600;
		const grid = landGridFor(radius);
		const size = grid.size;
		const cells = size * size;
		const elevation = new Float64Array(cells).fill(0.05);
		const mountains = new Float64Array(cells);
		const receivers = new Int32Array(cells).fill(-1);
		const area = new Float64Array(cells).fill(1);
		const lakeOf = new Int16Array(cells).fill(-1);
		const lowland = new Float32Array(cells).fill(0.5);
		const threshold = 100;
		const riverColumn = cellAt(grid, 150, 0) % size;
		const tributaryRow = Math.floor(cellAt(grid, 0, -100) / size);
		for (let row = 0; row < size; row += 1) {
			const y = cellCentre(grid, row);
			for (let column = 0; column < size; column += 1) {
				const x = cellCentre(grid, column);
				const cell = row * size + column;
				if (x < -250) elevation[cell] = 0.05 + (-250 - x) * 0.3 / RELIEF;
				if (y > 350) mountains[cell] = 0.8;
				if (Math.hypot(x + 150, y + 350) < 40) lakeOf[cell] = 0;
				if (column === riverColumn) {
					area[cell] = 4 * threshold;
					receivers[cell] = row > 0 ? cell - size : -1;
				} else if (row === tributaryRow && x > 150 && x < 400) {
					area[cell] = 2 * threshold;
					receivers[cell] = cell - 1;
				}
			}
		}
		const riverX = cellCentre(grid, riverColumn);
		const tributaryY = cellCentre(grid, tributaryRow);
		const surface = { elevation, mountains, grid };
		const terrain = { radius, surface, hotspots: [], openSquares: new Uint8Array((size - 1) * (size - 1)).fill(1) } as unknown as Terrain;
		const water = {
			surface: { grid, receivers, area, threshold, lakeOf, lowland } as unknown as WaterSurface,
			nearRiver: (x: number, y: number, reach: number) => Math.abs(x - riverX) < 1.5 + reach || (Math.abs(y - tributaryY) < 1 + reach && x > riverX && x < 400),
		};
		const params = paramsFor({ seed: 1, radius, metroSize: 0.08 });
		const field = suitabilityField({ params, terrain, water, rng: new Rng({ seed: 4 }) });
		const scoreAt = (x: number, y: number) => field[cellAt(grid, x, y)];
		const mean = (points: [number, number][]) => points.reduce((sum, [x, y]) => sum + scoreAt(x, y), 0) / points.length;
		return { grid, field, scoreAt, mean, riverX, tributaryY };
	}

	it('ranks a flat valley floor by a confluence first, then beside a river, then open country, then a slope', () => {
		const { mean, riverX, tributaryY } = syntheticMap();
		const along = (x: number, from: number, to: number): [number, number][] => Array.from({ length: 8 }, (_, index) => [x, from + (to - from) * index / 7]);
		const confluence = mean([[riverX + 12, tributaryY + 12], [riverX - 12, tributaryY - 12], [riverX - 12, tributaryY + 12], [riverX + 20, tributaryY - 15], [riverX - 20, tributaryY]]);
		const riverside = mean([...along(riverX + 12, 120, 300), ...along(riverX - 12, 120, 300)]);
		const open = mean([...along(-120, 50, 300), ...along(-40, 120, 300)]);
		const slope = mean([...along(-400, -200, 300), ...along(-330, -200, 300)]);
		expect(confluence).toBeGreaterThan(riverside + 0.2);
		expect(riverside).toBeGreaterThan(open + 0.3);
		expect(open).toBeGreaterThan(slope + 0.5);
	});

	it('falls off with distance from the river, with height, and with the range mask', () => {
		const { mean, riverX } = syntheticMap();
		const column = (x: number): [number, number][] => Array.from({ length: 12 }, (_, index) => [x, 100 + 20 * index]);
		const near = mean(column(riverX + 15));
		const middling = mean(column(riverX + 30));
		const far = mean(column(riverX + 110));
		expect(near).toBeGreaterThan(middling);
		expect(middling).toBeGreaterThan(far);
		// Higher on the same slope scores lower: further west is higher.
		expect(mean(column(-300))).toBeGreaterThan(mean(column(-450)));
	});

	it('scores nothing on water, by a river, in the ranges\' heart, or past the rim', () => {
		const { scoreAt, riverX, tributaryY } = syntheticMap();
		expect(scoreAt(riverX, 200)).toBe(-Infinity);
		expect(scoreAt(riverX + RIVER_CLEARANCE, 200)).toBe(-Infinity);
		expect(scoreAt(250, tributaryY)).toBe(-Infinity);
		expect(scoreAt(-150, -350)).toBe(-Infinity);
		expect(scoreAt(-150, -320)).toBe(-Infinity);
		expect(scoreAt(0, 450)).toBe(-Infinity);
		expect(scoreAt(0, 380)).toBe(-Infinity);
		expect(scoreAt(600, 150)).toBe(-Infinity);
		expect(scoreAt(-100, 200)).toBeGreaterThan(-Infinity);
	});

	it('adds only a little noise: identical open ground scores within the noise weight', () => {
		const { scoreAt } = syntheticMap();
		const scores = Array.from({ length: 30 }, (_, index) => scoreAt(-240 + 10 * index, 200));
		expect(Math.max(...scores) - Math.min(...scores)).toBeLessThanOrEqual(SUITABILITY.noise);
		expect(new Set(scores).size).toBeGreaterThan(20);
	});
});

describe('distanceField', () => {
	it('measures a cell across or a diagonal from each source, carrying the nearer source\'s value', () => {
		const grid: LandGrid = { size: 9, cellSize: 2, halfExtent: 9 };
		const sources = new Float64Array(81).fill(-1);
		sources[4 * 9 + 4] = 0.5;
		sources[0] = 0.9;
		const { distance, value } = distanceField(grid, sources);
		expect(distance[4 * 9 + 4]).toBe(0);
		expect(distance[4 * 9 + 7]).toBe(6);
		expect(distance[7 * 9 + 7]).toBeCloseTo(6 * Math.SQRT2, 12);
		expect(value[4 * 9 + 7]).toBe(0.5);
		expect(value[9 + 1]).toBe(0.9);
		expect(distanceField(grid, new Float64Array(81).fill(-1)).distance[40]).toBe(Infinity);
	});
});

describe('exitBearings', () => {
	/** The gaps between neighbouring bearings, counterclockwise round the circle. */
	function gaps(bearings: readonly number[]): number[] {
		const sorted = [...bearings].sort((a, b) => a - b);
		return sorted.map((bearing, index) => (index + 1 < sorted.length ? sorted[index + 1] : sorted[0] + 360) - bearing);
	}

	it('keeps every pair of neighbours at least the separation apart, across counts and separations', () => {
		for (let count = 3; count <= 9; count += 1) {
			const most = Math.floor(360 / count);
			[20, 35, Math.min(60, most), most].forEach((separation) => {
				for (let seed = 0; seed < 40; seed += 1) {
					const bearings = exitBearings({ count, separation, rng: new Rng({ seed }) });
					expect(bearings).toHaveLength(count);
					bearings.forEach((bearing) => {
						expect(bearing).toBeGreaterThanOrEqual(0);
						expect(bearing).toBeLessThan(360);
					});
					gaps(bearings).forEach((gap) => expect(gap).toBeGreaterThan(separation - 1e-9));
				}
			});
		}
	});

	it('jitters each bearing by up to a third of the gap, so neighbours sit irregularly', () => {
		let uneven = 0;
		for (let seed = 0; seed < 50; seed += 1) {
			const bearings = exitBearings({ count: 6, separation: 35, rng: new Rng({ seed }) });
			bearings.forEach((bearing, index) => {
				const offset = ((bearing - bearings[0] - index * 60) % 360 + 540) % 360 - 180;
				expect(Math.abs(offset)).toBeLessThanOrEqual(2 * 20 + 1e-9);
			});
			if (gaps(bearings).some((gap) => Math.abs(gap - 60) > 5)) uneven += 1;
		}
		expect(uneven).toBeGreaterThan(40);
	});

	it('spaces them evenly when the separation leaves no room to jitter', () => {
		const bearings = exitBearings({ count: 6, separation: 60, rng: new Rng({ seed: 3 }) });
		gaps(bearings).forEach((gap) => expect(gap).toBeCloseTo(60, 9));
	});
});

describe('generatePlaces', () => {
	describe('towns and villages', () => {
		it.each(SETS)('places every one asked for, named, spaced, outside the metro, inside the rim, in %s', (_name, set) => {
			const { params, places } = build(set);
			const { metroRadius, blendRadius } = startRadii(params);
			expect(places.towns).toHaveLength(params.towns);
			expect(places.villages).toHaveLength(params.villages);
			const settlements = [...places.towns, ...places.villages];
			settlements.forEach((place) => {
				const spacing = SETTLEMENT_SPACING[place.kind] * params.radius;
				const sizes = RUIN_SIZE[place.kind];
				const fromCentre = Math.hypot(place.x, place.y);
				expect(place.radius).toBeGreaterThanOrEqual(Math.max(sizes.floor, metroRadius * sizes.min));
				expect(place.radius).toBeLessThanOrEqual(Math.max(sizes.floor, metroRadius * sizes.max));
				expect(fromCentre - place.radius).toBeGreaterThanOrEqual(blendRadius);
				expect(fromCentre).toBeGreaterThanOrEqual(metroRadius + SETTLED.metroGap * spacing);
				expect(fromCentre + place.radius).toBeLessThanOrEqual(SETTLED.outer * params.radius);
				expect(place.name.length).toBeGreaterThan(0);
				const others = place.kind === 'town' ? places.towns : settlements;
				others.forEach((other) => {
					if (other !== place) expect(distance(place, other)).toBeGreaterThanOrEqual(spacing);
				});
			});
			expect(new Set(settlements.map(({ name }) => name)).size).toBe(settlements.length);
		});

		it.each(SETS)('takes them best first, on better ground than the land at large, in %s', (_name, set) => {
			const { params, terrain, water, places } = build(set);
			const field = suitabilityField({ params, terrain, water, rng: placesStream(params.seed) });
			const { grid } = terrain.surface;
			places.towns.forEach((town, index) => {
				expect(field[cellAt(grid, town.x, town.y)]).toBe(town.suitability);
				if (index > 0) expect(town.suitability).toBeLessThanOrEqual(places.towns[index - 1].suitability);
			});
			// Towns sit on better ground than the land at large: above the median of every scored cell.
			const scored = Array.from(field).filter((score) => score > -Infinity).sort((a, b) => a - b);
			const median = scored[Math.floor(scored.length / 2)];
			places.towns.forEach((town) => expect(town.suitability).toBeGreaterThan(median));
		});

		it.each(SETS)('keeps every place off the water, clear of the craters, out of the ranges\' heart, and where a road from the metro reaches it, in %s', (_name, set) => {
			const { terrain, places } = build(set);
			const { grid, mountains } = terrain.surface;
			const settled = [...places.towns, ...places.villages, ...places.crossroads];
			settled.forEach((place) => {
				const radius = 'radius' in place ? place.radius : 0;
				expect(terrain.waterAt(place.x, place.y)).toBeNull();
				for (let step = 0; step < 16; step += 1) {
					const angle = (step / 16) * 2 * Math.PI;
					expect(terrain.waterAt(place.x + 0.95 * RIVER_CLEARANCE * Math.cos(angle), place.y + 0.95 * RIVER_CLEARANCE * Math.sin(angle))).toBeNull();
					// The ruins keep off the lakes: no lake cell's centre under them.
					if (radius > 0) expect(terrain.water?.lakeDepth(place.x + radius * Math.cos(angle), place.y + radius * Math.sin(angle)) ?? -1).toBeLessThan(0);
				}
				expect(mountains[cellAt(grid, place.x, place.y)]).toBeLessThan(SUITABILITY.heart);
				terrain.hotspots.forEach((hotspot) => expect(distance(place, hotspot)).toBeGreaterThanOrEqual(hotspot.craterRadius + radius + CRATER_GAP));
			});
			expect(reachable(terrain, settled).every(Boolean)).toBe(true);
		});

		// Range country covers the whole map past the metro here, and its heart takes no town, so what room there is goes to the few that fit.
		it('places fewer than asked where the land has no room, never more, and still keeps every rule', () => {
			const crowded = { seed: 0, mountainCoverage: 1, ruggedness: 1, aridity: 0, contamination: 1, hotspots: 6, towns: 12, villages: 40, metroSize: 0.25, radius: 600 };
			const { params, terrain, places } = build(crowded);
			expect(places.towns.length).toBeLessThan(params.towns);
			expect(places.villages.length).toBeLessThan(params.villages);
			const settled = [...places.towns, ...places.villages, ...places.crossroads];
			settled.forEach((place) => expect(terrain.obstacle(place.x, place.y)).toBeNull());
			expect(reachable(terrain, settled).every(Boolean)).toBe(true);
		});
	});

	describe('crossroads', () => {
		it.each(SETS)('spaces them by roadDensity, apart from the other places and the metro, inside the rim, on gentle ground, in %s', (_name, set) => {
			const { params, terrain, places } = build(set);
			const spacing = CROSSROADS.sparse + (CROSSROADS.dense - CROSSROADS.sparse) * params.roadDensity;
			const others = [...places.towns, ...places.villages, ...places.exits];
			places.crossroads.forEach((crossroads, index) => {
				const fromCentre = Math.hypot(crossroads.x, crossroads.y);
				expect(fromCentre).toBeGreaterThanOrEqual(startRadii(params).metroRadius + CROSSROADS.metro * spacing);
				expect(fromCentre).toBeLessThanOrEqual(CROSSROADS.outer * params.radius);
				places.crossroads.slice(index + 1).forEach((other) => expect(distance(crossroads, other)).toBeGreaterThanOrEqual(spacing));
				others.forEach((other) => expect(distance(crossroads, other)).toBeGreaterThanOrEqual(CROSSROADS.others * spacing));
				expect(terrain.obstacle(crossroads.x, crossroads.y)).toBeNull();
			});
		});

		it('packs about as many as the spacing allows, four times as many at roadDensity 1 as at 0', () => {
			const set = SETS[2][1];
			const counts = [0, 0.5, 1].map((roadDensity) => build(set, { roadDensity }).places.crossroads.length);
			expect(counts[0]).toBeLessThan(counts[1]);
			expect(counts[1]).toBeLessThan(counts[2]);
			expect(counts[2] / counts[0]).toBeGreaterThan(2.5);
			expect(counts[2] / counts[0]).toBeLessThan(4.5);
			// Dart throwing to a jam covers about 0.55 of the land with discs of half the spacing, about 0.7 a spacing squared each; the usable land is under the disc.
			const { params } = build(set);
			const disc = Math.PI * (CROSSROADS.outer * params.radius) ** 2;
			[0, 1].forEach((roadDensity, index) => {
				const spacing = CROSSROADS.sparse + (CROSSROADS.dense - CROSSROADS.sparse) * roadDensity;
				expect(counts[2 * index] * spacing * spacing / disc).toBeLessThan(0.75);
				expect(counts[2 * index] * spacing * spacing / disc).toBeGreaterThan(0.25);
			});
		});
	});

	describe('exits', () => {
		it.each(SETS)('puts the highways\' exits at the rim, highwaySeparation apart, and a back road\'s in each wide gap, in %s', (_name, set) => {
			const { params, places } = build(set);
			const highways = places.exits.filter((exit) => exit.highway);
			const backRoads = places.exits.filter((exit) => !exit.highway);
			expect(highways).toHaveLength(params.highways);
			expect(places.exits.slice(0, highways.length)).toEqual(highways);
			highways.forEach((exit, index) => {
				const next = highways[(index + 1) % highways.length];
				expect(arc(exit.bearing, next.bearing)).toBeGreaterThanOrEqual(params.highwaySeparation - 1e-9);
				const inGap = backRoads.filter((back) => arc(exit.bearing, back.bearing) < arc(exit.bearing, next.bearing));
				expect(inGap).toHaveLength(arc(exit.bearing, next.bearing) >= EXITS.backGap ? 1 : 0);
			});
			backRoads.forEach((back) => highways.forEach((exit) => expect(apart(back.bearing, exit.bearing)).toBeGreaterThanOrEqual(EXITS.backClearance - 1e-9)));
			places.exits.forEach((exit) => {
				expect(Math.hypot(exit.x, exit.y)).toBeCloseTo(params.radius * (1 - EXITS.inset), 9);
				expect(exit.x).toBeCloseTo(params.radius * (1 - EXITS.inset) * Math.cos(exit.bearing * Math.PI / 180), 9);
			});
		});

		it.each(SETS)('slides each highway exit to gentler ground than its bearing\'s, on passable ground, in %s', (_name, set) => {
			const { params, terrain, places } = build(set);
			const drawn = exitBearings({ count: params.highways, separation: params.highwaySeparation, rng: placesStream(params.seed).fork('exits').fork('bearings') });
			const highways = places.exits.filter((exit) => exit.highway);
			highways.forEach((exit, index) => {
				const slid = apart(exit.bearing, drawn[index]);
				expect(slid).toBeLessThanOrEqual(EXITS.slide + 1e-9);
				const here = exitGround(terrain, exit.bearing);
				expect(here).toBeLessThan(Infinity);
				expect(here + EXITS.penalty * slid).toBeLessThanOrEqual(exitGround(terrain, drawn[index]) + 1e-12);
			});
		});

		it('leaves the ground at the exits gentler than the rim at large, over the sets', () => {
			let exits = 0;
			let rim = 0;
			let exitCount = 0;
			let rimCount = 0;
			SETS.forEach(([, set]) => {
				const { terrain, places } = build(set);
				places.exits.forEach(({ bearing }) => {
					exits += exitGround(terrain, bearing);
					exitCount += 1;
				});
				for (let bearing = 0; bearing < 360; bearing += 1) {
					const ground = exitGround(terrain, bearing);
					if (ground === Infinity) continue;
					rim += ground;
					rimCount += 1;
				}
			});
			expect(exits / exitCount).toBeLessThan(0.8 * (rim / rimCount));
		});
	});

	describe('as data', () => {
		it('numbers every place by its index in the list, the metro first, and freezes them', () => {
			const { params, places } = build(SETS[0][1]);
			const list = placeList(places);
			list.forEach((place, index) => expect(place.id).toBe(index));
			expect(list[0]).toEqual({ id: 0, kind: 'metro', x: 0, y: 0, radius: startRadii(params).metroRadius });
			expect(list.map(({ kind }) => kind)).toEqual([
				'metro', ...places.towns.map(() => 'town'), ...places.villages.map(() => 'village'), ...places.crossroads.map(() => 'crossroads'), ...places.exits.map(() => 'exit'),
			]);
			expect(ruinsOf(places)).toEqual([places.metro, ...places.towns, ...places.villages]);
			expect(Object.isFrozen(places)).toBe(true);
			expect(Object.isFrozen(places.crossroads)).toBe(true);
			expect(Object.isFrozen(places.exits[0])).toBe(true);
			expect(structuredClone(places)).toEqual(places);
		});

		it('makes the same places from the same stream, others from another, and moves no other feature when one is asked for more', () => {
			const set = SETS[0][1];
			expect(build(set).places).toEqual(build(set).places);
			expect(build(set, {}, 1).places).not.toEqual(build(set).places);
			const more = build(set, { villages: 30 }).places;
			const base = build(set).places;
			expect(more.towns).toEqual(base.towns);
			expect(more.exits.map(({ bearing }) => bearing)).toEqual(base.exits.map(({ bearing }) => bearing));
		});

		// Computed in a separate Node process from the Jest run that checks them, through the whole pipeline.
		it('makes the pinned places for two maps', () => {
			PINNED.forEach(({ set, places: hash, hotspots, counts, towns }) => {
				const { places, terrain } = build(set);
				const coordinates = Float64Array.from(placeList(places).flatMap((place) => [place.x, place.y, place.kind === 'exit' ? place.bearing : place.kind === 'crossroads' ? 0 : place.radius]));
				expect(hashOf(coordinates)).toBe(hash);
				expect(hashOf(Float64Array.from(terrain.hotspots.flatMap(({ x, y, craterRadius, plumeRadius, strength }) => [x, y, craterRadius, plumeRadius, strength])))).toBe(hotspots);
				expect([places.towns.length, places.villages.length, places.crossroads.length, places.exits.length]).toEqual(counts);
				expect(places.towns.map(({ name }) => name)).toEqual(towns);
			});
		});
	});
});

describe('placeNames', () => {
	it('hands out names no two alike, from the word lists, the same from the same stream', () => {
		const names = placeNames(new Rng({ seed: 8 }));
		const drawn = Array.from({ length: 200 }, () => names());
		expect(new Set(drawn).size).toBe(200);
		drawn.forEach((name) => expect(NAME_STARTS.some((start) => name.startsWith(start))).toBe(true));
		const again = placeNames(new Rng({ seed: 8 }));
		expect(Array.from({ length: 200 }, () => again())).toEqual(drawn);
		expect(NAME_ENDINGS.length * NAME_STARTS.length).toBeGreaterThan(700);
	});

	it('numbers a name once every pairing is taken, rather than looping forever', () => {
		const names = placeNames(new Rng({ seed: 9 }));
		const drawn = Array.from({ length: NAME_STARTS.length * NAME_ENDINGS.length + 20 }, () => names());
		expect(new Set(drawn).size).toBe(drawn.length);
		expect(drawn.some((name) => / \d+$/.test(name))).toBe(true);
	});
});

function hashOf(values: Float64Array): number {
	const view = new DataView(values.buffer, values.byteOffset, values.byteLength);
	let hash = 0x811c9dc5;
	for (let offset = 0; offset + 4 <= values.byteLength; offset += 4) {
		hash ^= view.getUint32(offset, true);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

interface PinnedPlaces {
	readonly set: MapParamSet;
	readonly places: number;
	readonly hotspots: number;
	readonly counts: number[];
	readonly towns: string[];
}

const PINNED: PinnedPlaces[] = [
	{ set: { seed: 7, radius: 800 }, places: 1282691387, hotspots: 1026844018, counts: [5, 20, 83, 12], towns: ['Copper Center', 'Copperfield', 'Red Crossing', 'Copperburg', 'Kettleburg'] },
	{ set: { seed: 29, environment: 'rustBelt', radius: 1000 }, places: 381667960, hotspots: 1773523043, counts: [8, 26, 140, 12], towns: ['Salt Falls', 'Cedarford', 'Ironburg', 'Highby', 'Oakby', 'Wolfdale', 'Coldwood', 'Kettlehaven'] },
];
