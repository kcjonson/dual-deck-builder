import { Rng } from '../core/Rng';
import { areaMapPipeline, generateAreaMap, growthStage } from './AreaMapPipeline';
import { planHighways } from './Highways';
import { createTerrainSample, generateTerrain } from './Terrain';
import { paramsFor } from './roadTesting';

describe('the area map pipeline', () => {
	const params = paramsFor({ seed: 11, environment: 'rustBelt', radius: 800 });
	const map = generateAreaMap({ params });
	const terrainStream = new Rng({ seed: 11 }).fork('map', 0).fork('terrain', 0);

	it('runs terrain, then the highways and growth, each first time on its nested stream', () => {
		expect(areaMapPipeline().stageNames).toEqual(['terrain', 'highways', 'growth']);
		expect(map.attempts).toEqual({ terrain: 0, highways: 0, growth: 0 });
		expect(map.mapAttempt).toBe(0);
		const highwaysStream = terrainStream.fork('highways', 0);
		expect(map.streams).toEqual({ terrain: terrainStream.seed, highways: highwaysStream.seed, growth: highwaysStream.fork('growth', 0).seed });
		expect(map.products.highways).toEqual(planHighways({ terrain: map.products.terrain, params, rng: highwaysStream }));
	});

	it('leaves the terrain on the stream it always had, the first stage\'s', () => {
		const before = generateTerrain({ params, rng: terrainStream });
		const sample = createTerrainSample();
		const again = createTerrainSample();
		for (const [x, y] of [[0, 0], [310, -120], [-500, 410], [640, 220]]) {
			map.products.terrain.sample(x, y, sample);
			before.sample(x, y, again);
			expect(sample).toEqual(again);
		}
	});

	it('makes the same map from the same params, and hands back the params it ran on', () => {
		const again = generateAreaMap({ params });
		expect(again.products.growth.network).toEqual(map.products.growth.network);
		expect(again.streams).toEqual(map.streams);
		expect(again.params).toBe(params);
		expect(generateAreaMap({ params: { ...params, seed: 12 } }).products.growth.network).not.toEqual(map.products.growth.network);
	});

	it('checks growth with the network checks, so a broken network fails the stage', () => {
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

	it('reruns growth on its next stream when the accept hook rejects it, leaving terrain and the highways be', () => {
		let rejections = 0;
		const retried = generateAreaMap({ params, accept: (_map, { stage }) => (stage === 'growth' && rejections++ === 0 ? ['not this one'] : []) });
		expect(retried.attempts).toEqual({ terrain: 0, highways: 0, growth: 1 });
		expect(retried.timings.terrain.runs).toBe(1);
		expect(retried.timings.highways.runs).toBe(1);
		expect(retried.timings.growth.runs).toBe(2);
		expect(retried.streams.growth).toBe(terrainStream.fork('highways', 0).fork('growth', 1).seed);
		expect(retried.products.growth.network).not.toEqual(map.products.growth.network);
	});
});
