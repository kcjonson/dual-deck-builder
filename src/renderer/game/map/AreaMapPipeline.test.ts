import { Rng } from '../core/Rng';
import { ROADS_STAGE, ROUTE_TREE_STAGE, areaMapPipeline, generateAreaMap } from './AreaMapPipeline';
import { routesTo } from './RouteTree';
import { generateRoads, standInPlaces } from './Roads';
import { createTerrainSample, generateTerrain } from './Terrain';
import { generateWater } from './Water';
import { paramsFor } from './roadTesting';

describe('the area map pipeline', () => {
	const params = paramsFor({ seed: 11, environment: 'rustBelt', radius: 800 });
	const map = generateAreaMap({ params });
	const terrainStream = new Rng({ seed: 11 }).fork('map', 0).fork('terrain', 0);
	const waterStream = terrainStream.fork('water', 0);
	const roadsStream = waterStream.fork('roads', 0);

	it('runs terrain, water, the roads, the route tree, then the POIs, each first time on its nested stream', () => {
		expect(areaMapPipeline().stageNames).toEqual(['terrain', 'water', 'roads', 'routeTree', 'pois']);
		expect(map.attempts).toEqual({ terrain: 0, water: 0, roads: 0, routeTree: 0, pois: 0 });
		expect(map.mapAttempt).toBe(0);
		const treeStream = roadsStream.fork('routeTree', 0);
		expect(map.streams).toEqual({
			terrain: terrainStream.seed,
			water: waterStream.seed,
			roads: roadsStream.seed,
			routeTree: treeStream.seed,
			pois: treeStream.fork('pois', 0).seed,
		});
		const terrain = map.products.water.terrain;
		const roads = generateRoads({ terrain, rivers: map.products.water.lines, params, places: standInPlaces({ terrain, params, rng: roadsStream }), rng: roadsStream });
		expect(map.products.roads.network).toEqual(roads.network);
	});

	it('leaves the terrain on the stream it always had, the first stage\'s, and lays the water stage\'s over it', () => {
		const before = generateTerrain({ params, rng: terrainStream });
		const water = generateWater({ params, terrain: before, rng: waterStream });
		const sample = createTerrainSample();
		const again = createTerrainSample();
		for (const [x, y] of [[0, 0], [310, -120], [-500, 410], [640, 220]]) {
			map.products.terrain.sample(x, y, sample);
			before.sample(x, y, again);
			expect(sample).toEqual(again);
			map.products.water.terrain.sample(x, y, sample);
			water.terrain.sample(x, y, again);
			expect(sample).toEqual(again);
		}
		expect(map.products.water.terrain.water).toBe(map.products.water);
		expect(map.products.terrain.water).toBeNull();
	});

	it('makes the same map from the same params, and hands back the params it ran on', () => {
		const again = generateAreaMap({ params });
		expect(again.products.roads.network).toEqual(map.products.roads.network);
		expect(again.products.water.surface.lines).toEqual(map.products.water.surface.lines);
		expect(again.streams).toEqual(map.streams);
		expect(again.params).toBe(params);
		expect(generateAreaMap({ params: { ...params, seed: 12 } }).products.roads.network).not.toEqual(map.products.roads.network);
	});

	it('checks the roads with the network checks over the land with its water, so a broken network fails the stage', () => {
		const { products } = map;
		const { network } = products.roads;
		expect(ROADS_STAGE.check?.(products.roads, { input: params, products })).toEqual([]);
		// One stretch flung far past the rim.
		const flung = { ...network, stretches: network.stretches.map((stretch, id) => (id === 3 ? { ...stretch, points: stretch.points.map((value) => value * 10) } : stretch)) };
		const problems = ROADS_STAGE.check?.({ ...products.roads, network: flung }, { input: params, products }) ?? [];
		expect(problems.length).toBeGreaterThan(0);
		problems.forEach((problem) => expect(problem).toMatch(/^(structure|disc|passable|bridges|crossing|clearance|reach|loops): ./));
		// Too few loops for the POIs fails it too.
		expect(ROADS_STAGE.check?.(products.roads, { input: { ...params, poiDensity: 20 }, products })).toEqual([expect.stringMatching(/^loops: /)]);
	});

	it('seats a stronghold in every sector and places POIs with two or three routes each, strict, on the roads\' loops', () => {
		const { pois, routeTree } = map.products;
		expect(pois.failures).toEqual([]);
		expect(pois.strongholds).toHaveLength(params.strongholds);
		expect(routeTree.meetingPoints.length).toBeGreaterThan(pois.pois.length);
		const placed = pois.pois.length - params.strongholds;
		expect(placed).toBeGreaterThanOrEqual(Math.round(0.9 * pois.rings.reduce((sum, { target }) => sum + target, 0)));
		pois.pois.forEach((poi) => {
			expect(poi.arrivals.length).toBeGreaterThanOrEqual(2);
			expect(poi.arrivals.length).toBeLessThanOrEqual(3);
			expect(routesTo(pois, poi)).toHaveLength(poi.arrivals.length);
		});
		expect(ROUTE_TREE_STAGE.attempts).toBe(1);
	});

	it('reruns the roads on their next stream when the accept hook rejects them, leaving terrain and water be', () => {
		let rejections = 0;
		const retried = generateAreaMap({ params, accept: (_map, { stage }) => (stage === 'roads' && rejections++ === 0 ? ['not this one'] : []) });
		expect(retried.attempts).toEqual({ terrain: 0, water: 0, roads: 1, routeTree: 0, pois: 0 });
		expect(retried.timings.terrain.runs).toBe(1);
		expect(retried.timings.water.runs).toBe(1);
		expect(retried.timings.roads.runs).toBe(2);
		expect(retried.streams.roads).toBe(waterStream.fork('roads', 1).seed);
		expect(retried.products.roads.network).not.toEqual(map.products.roads.network);
	});

	it('reruns the water on its next stream when the accept hook rejects it, on the same land', () => {
		let rejections = 0;
		const retried = generateAreaMap({ params, accept: (_map, { stage }) => (stage === 'water' && rejections++ === 0 ? ['not this one'] : []) });
		expect(retried.attempts).toEqual({ terrain: 0, water: 1, roads: 0, routeTree: 0, pois: 0 });
		expect(retried.timings.terrain.runs).toBe(1);
		expect(retried.streams.water).toBe(terrainStream.fork('water', 1).seed);
		expect(retried.products.terrain.surface.elevation).toEqual(map.products.terrain.surface.elevation);
		expect(retried.products.water.surface.lines.points).not.toEqual(map.products.water.surface.lines.points);
	});
});
