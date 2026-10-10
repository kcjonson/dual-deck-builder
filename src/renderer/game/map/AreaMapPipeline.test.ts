import { Rng } from '../core/Rng';
import { ROUTE_TREE_STAGE, areaMapPipeline, generateAreaMap, growthStage } from './AreaMapPipeline';
import { generateHazards } from './Hazards';
import { generatePlaces } from './Places';
import { createTerrainSample, generateTerrain } from './Terrain';
import { generateWater } from './Water';
import { paramsFor } from './roadTesting';

describe('the area map pipeline', () => {
	const params = paramsFor({ seed: 11, environment: 'rustBelt', radius: 800 });
	const map = generateAreaMap({ params });
	const terrainStream = new Rng({ seed: 11 }).fork('map', 0).fork('terrain', 0);
	const waterStream = terrainStream.fork('water', 0);
	const hazardsStream = waterStream.fork('hazards', 0);
	const placesStream = hazardsStream.fork('places', 0);

	it('runs terrain, water, hazards, places, growth, then the route tree, the POIs, and the stops, each first time on its nested stream', () => {
		expect(areaMapPipeline().stageNames).toEqual(['terrain', 'water', 'hazards', 'places', 'growth', 'routeTree', 'pois', 'stops']);
		expect(map.attempts).toEqual({ terrain: 0, water: 0, hazards: 0, places: 0, growth: 0, routeTree: 0, pois: 0, stops: 0 });
		expect(map.mapAttempt).toBe(0);
		const growthStream = placesStream.fork('growth', 0);
		const routeTreeStream = growthStream.fork('routeTree', 0);
		expect(map.streams).toEqual({
			terrain: terrainStream.seed,
			water: waterStream.seed,
			hazards: hazardsStream.seed,
			places: placesStream.seed,
			growth: growthStream.seed,
			routeTree: routeTreeStream.seed,
			pois: routeTreeStream.fork('pois', 0).seed,
			stops: routeTreeStream.fork('pois', 0).fork('stops', 0).seed,
		});
		const { water, hazards, places } = map.products;
		expect(hazards.hotspots).toEqual(generateHazards({ params, terrain: water.terrain, rng: hazardsStream }).hotspots);
		expect(places).toEqual(generatePlaces({ params, terrain: hazards.terrain, water, rng: placesStream }));
	});

	it('leaves the terrain on the stream it always had, the first stage\'s, and lays the water and then the hazards over it', () => {
		const before = generateTerrain({ params, rng: terrainStream });
		const water = generateWater({ params, terrain: before, rng: waterStream });
		const hazards = generateHazards({ params, terrain: water.terrain, rng: hazardsStream });
		const sample = createTerrainSample();
		const again = createTerrainSample();
		for (const [x, y] of [[0, 0], [310, -120], [-500, 410], [640, 220]]) {
			map.products.terrain.sample(x, y, sample);
			before.sample(x, y, again);
			expect(sample).toEqual(again);
			map.products.hazards.terrain.sample(x, y, sample);
			hazards.terrain.sample(x, y, again);
			expect(sample).toEqual(again);
		}
		expect(map.products.water.terrain.water).toBe(map.products.water);
		expect(map.products.water.terrain.hazards).toBeNull();
		expect(map.products.hazards.terrain.water).toBe(map.products.water);
		expect(map.products.hazards.terrain.hazards).toBe(map.products.hazards);
		expect(map.products.terrain.water).toBeNull();
	});

	it('makes the same map from the same params, and hands back the params it ran on', () => {
		const again = generateAreaMap({ params });
		expect(again.products.growth.network).toEqual(map.products.growth.network);
		expect(again.products.places).toEqual(map.products.places);
		expect(again.products.water.surface.lines).toEqual(map.products.water.surface.lines);
		expect(again.streams).toEqual(map.streams);
		expect(again.params).toBe(params);
		expect(generateAreaMap({ params: { ...params, seed: 12 } }).products.growth.network).not.toEqual(map.products.growth.network);
	});

	it('grows a highway toward each highway exit', () => {
		const highways = map.products.places.exits.filter((exit) => exit.highway);
		const roots = map.products.growth.network.roads.filter((road) => road.parent === -1);
		expect(roots).toHaveLength(highways.length);
		roots.forEach((road, index) => {
			const { points } = map.products.growth.network.stretches[road.stretches[0]];
			const { bearing } = highways[index];
			const radians = (bearing * Math.PI) / 180;
			const length = Math.hypot(points[2], points[3]);
			expect(points[2] / length).toBeCloseTo(Math.cos(radians), 9);
			expect(points[3] / length).toBeCloseTo(Math.sin(radians), 9);
		});
	});

	it('checks growth with the network checks over the land with its water and hazards, so a broken network fails the stage', () => {
		const { products } = map;
		const { network } = products.growth;
		const stage = growthStage();
		expect(stage.check?.(products.growth, { input: params, products })).toEqual([]);
		// One stretch flung far past the rim.
		const flung = { ...network, stretches: network.stretches.map((stretch, id) => (id === 3 ? { ...stretch, points: stretch.points.map((value) => value * 10) } : stretch)) };
		const problems = stage.check?.({ ...products.growth, network: flung }, { input: params, products }) ?? [];
		expect(problems.length).toBeGreaterThan(0);
		problems.forEach((problem) => expect(problem).toMatch(/^(structure|outward|disc|passable|crossing|clearance|junctionAngle): ./));
	});

	it("gives the route tree one attempt, since it takes no draws, and lets the POIs report what growth's tree of roads can't give them", () => {
		expect(ROUTE_TREE_STAGE.attempts).toBe(1);
		// Growth grows trees, so no stretch is off every way home and no leaf has three roads.
		expect(map.products.routeTree.meetingPoints).toEqual([]);
		const { pois } = map.products;
		expect(pois.pois).toEqual([]);
		expect(pois.failures).toContain('sector 0 has no free meeting point in the outer band');
		expect(pois.failures.length).toBe(params.strongholds + 1);
		expect(map.timings.pois.runs).toBe(1);
		// With no POIs there are no legs, so the stops place nothing and pass.
		expect(map.products.stops).toMatchObject({ stops: [], legs: [], failures: [] });
		expect(map.timings.stops.runs).toBe(1);
	});

	it('reruns growth on its next stream when the accept hook rejects it, leaving the stages before it be', () => {
		let rejections = 0;
		const retried = generateAreaMap({ params, accept: (_map, { stage }) => (stage === 'growth' && rejections++ === 0 ? ['not this one'] : []) });
		expect(retried.attempts).toEqual({ terrain: 0, water: 0, hazards: 0, places: 0, growth: 1, routeTree: 0, pois: 0, stops: 0 });
		expect(retried.timings.terrain.runs).toBe(1);
		expect(retried.timings.water.runs).toBe(1);
		expect(retried.timings.hazards.runs).toBe(1);
		expect(retried.timings.places.runs).toBe(1);
		expect(retried.timings.growth.runs).toBe(2);
		expect(retried.streams.growth).toBe(placesStream.fork('growth', 1).seed);
		expect(retried.products.growth.network).not.toEqual(map.products.growth.network);
	});

	it('reruns the places on their next stream when the accept hook rejects them, on the same land, water, and hazards', () => {
		let rejections = 0;
		const retried = generateAreaMap({ params, accept: (_map, { stage }) => (stage === 'places' && rejections++ === 0 ? ['not this one'] : []) });
		expect(retried.attempts).toEqual({ terrain: 0, water: 0, hazards: 0, places: 1, growth: 0, routeTree: 0, pois: 0, stops: 0 });
		expect(retried.streams.places).toBe(hazardsStream.fork('places', 1).seed);
		expect(retried.products.hazards.hotspots).toEqual(map.products.hazards.hotspots);
		expect(retried.products.places).not.toEqual(map.products.places);
	});

	it('reruns the water on its next stream when the accept hook rejects it, on the same land', () => {
		let rejections = 0;
		const retried = generateAreaMap({ params, accept: (_map, { stage }) => (stage === 'water' && rejections++ === 0 ? ['not this one'] : []) });
		expect(retried.attempts).toEqual({ terrain: 0, water: 1, hazards: 0, places: 0, growth: 0, routeTree: 0, pois: 0, stops: 0 });
		expect(retried.timings.terrain.runs).toBe(1);
		expect(retried.streams.water).toBe(terrainStream.fork('water', 1).seed);
		expect(retried.products.terrain.surface.elevation).toEqual(map.products.terrain.surface.elevation);
		expect(retried.products.water.surface.lines.points).not.toEqual(map.products.water.surface.lines.points);
	});
});
