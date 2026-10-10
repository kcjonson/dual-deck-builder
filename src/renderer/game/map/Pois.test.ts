import { Rng } from '../core/Rng';
import { ROUTE_TREE_STAGE, generateAreaMap, poisStage } from './AreaMapPipeline';
import type { Biome } from './Biome';
import type { MapParams } from './MapParams';
import { MapPipeline } from './MapPipeline';
import { FakeGroundOptions, fakeGround, meshFrom, randomMesh } from './meshTesting';
import { checkPoiLayer } from './PoiChecks';
import { FACTIONS, POI_TUNING, PoiResource, PoiTuning, STRONGHOLD_TYPE } from './PoiData';
import { PoiGround, PoiLayer, Sectors, placePois, stepSectors } from './Pois';
import type { RoadNetwork } from './RoadNetwork';
import { RouteTree, buildRouteTree, routesTo } from './RouteTree';
import { paramsFor } from './roadTesting';

interface PlaceOptions {
	seed?: number;
	ground?: PoiGround;
	strongholds?: number;
	poiDensity?: number;
	routeSplit?: number;
	tuning?: PoiTuning;
}

function place(network: RoadNetwork, { seed = 1, ground = fakeGround(), strongholds = 4, poiDensity = 1, routeSplit = 0.5, tuning }: PlaceOptions = {}): { tree: RouteTree; layer: PoiLayer } {
	const tree = buildRouteTree({ network, travelPace: 1, routeSplit });
	return { tree, layer: placePois({ network, tree, ground, params: { strongholds, poiDensity }, rng: new Rng({ seed }), tuning }) };
}

/** Land of one biome everywhere. */
const all = (biome: Biome, options: FakeGroundOptions = {}) => fakeGround({ ...options, biome: () => biome });

const distance = ({ x, y }: { x: number; y: number }) => Math.sqrt(x * x + y * y);

describe('POIs and strongholds on the route tree', () => {
	const meshes = Array.from({ length: 30 }, (_, index) => randomMesh({ seed: 300 + index, spacing: 80 + index }));

	it('keeps guarantees 4 and 5, and every rule the checks know, on random meshes with loops', () => {
		for (const [index, network] of meshes.entries()) {
			const { tree, layer } = place(network, { seed: index });
			expect(checkPoiLayer({ network, tree, layer, params: { strongholds: 4, routeSplit: 0.5 }, radius: 1000 })).toEqual([]);
			expect(layer.failures).toEqual([]);
			for (const poi of layer.pois) {
				expect(poi.arrivals.length).toBeGreaterThanOrEqual(2);
				expect(poi.site.stretch >= 0 ? poi.arrivals.length === 2 : poi.arrivals.length === 3).toBe(true);
				// Quickest first.
				for (let place = 1; place < poi.arrivals.length; place += 1) expect(poi.arrivals[place].hours).toBeGreaterThanOrEqual(poi.arrivals[place - 1].hours);
				routesTo(layer, poi).forEach((route, place) => expect(route.hours).toBeCloseTo(poi.arrivals[place].hours, 9));
			}
		}
	});

	it('holds them at a tighter split too, with fewer meeting points to choose from', () => {
		const network = meshes[0];
		const loose = place(network, { routeSplit: 0.7 });
		const tight = place(network, { routeSplit: 0.3 });
		expect(tight.tree.meetingPoints.length).toBeLessThan(loose.tree.meetingPoints.length);
		expect(checkPoiLayer({ network, tree: tight.tree, layer: tight.layer, params: { strongholds: 4, routeSplit: 0.3 }, radius: 1000 })).toEqual([]);
	});

	describe('strongholds', () => {
		it('seats one per sector in the outer band, each a different faction, all tier 5', () => {
			for (const strongholds of [2, 3, 5, 8]) {
				const { layer } = place(meshes[strongholds], { strongholds });
				expect(layer.strongholds.map(({ sector }) => sector)).toEqual(Array.from({ length: strongholds }, (_, sector) => sector));
				expect(new Set(layer.strongholds.map(({ faction }) => faction)).size).toBe(strongholds);
				const sectors = new Sectors({ rotation: layer.sectorRotation, count: strongholds });
				for (const { poi, sector, faction } of layer.strongholds) {
					const { site, type, tier } = layer.pois[poi];
					expect(sectors.sectorOf(site.x, site.y)).toBe(sector);
					expect(distance(site)).toBeGreaterThanOrEqual(0.72 * 1000);
					expect(distance(site)).toBeLessThanOrEqual(0.97 * 1000);
					expect(type).toBe(STRONGHOLD_TYPE);
					expect(tier).toBe(5);
					expect(Object.keys(FACTIONS)).toContain(faction);
				}
			}
		});

		it('seats the faction whose land suits the site best: Mire-Crawlers in mire, a desert faction in desert', () => {
			expect(place(meshes[1], { ground: all('mire') }).layer.strongholds[0].faction).toBe('mireCrawlers');
			expect(['sunChasers', 'duneStriders']).toContain(place(meshes[1], { ground: all('desert') }).layer.strongholds[0].faction);
			// Ruined badlands suit the Rust Vultures.
			expect(place(meshes[1], { ground: all('badlands', { ruin: () => 1 }) }).layer.strongholds[0].faction).toBe('rustVultures');
		});

		it('fails a sector with no meeting point in the outer band', () => {
			const { layer } = place(randomMesh({ seed: 7, radius: 600 }));
			expect(layer.strongholds).toEqual([]);
			expect(layer.failures).toEqual([0, 1, 2, 3].map((sector) => `sector ${sector} has no free meeting point in the outer band`));
		});

		it('refuses more strongholds than there are factions', () => {
			const network = meshes[0];
			const tree = buildRouteTree({ network, travelPace: 1, routeSplit: 0.5 });
			const factions = { mireCrawlers: FACTIONS.mireCrawlers, sunChasers: FACTIONS.sunChasers };
			expect(() => placePois({ network, tree, ground: fakeGround(), params: { strongholds: 3, poiDensity: 1 }, rng: new Rng({ seed: 1 }), factions }))
				.toThrow('placePois: 3 strongholds need as many factions, got 2');
		});
	});

	describe('sectors', () => {
		it('start at their boundary and run counterclockwise to the next, by plain arithmetic', () => {
			const four = new Sectors({ rotation: 0, count: 4 });
			expect([[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -0.001]].map(([x, y]) => four.sectorOf(x, y))).toEqual([0, 0, 1, 2, 3, 3]);
			const turned = new Sectors({ rotation: 45, count: 4 });
			expect([[1, 0], [1, 1.1], [-1.1, 1], [0, -1]].map(([x, y]) => turned.sectorOf(x, y))).toEqual([3, 0, 1, 2]);
			// Two sectors, each a half: the boundaries are opposite.
			const two = new Sectors({ rotation: 90, count: 2 });
			expect([[0, 1], [-1, 0], [0, -1], [1, 0]].map(([x, y]) => two.sectorOf(x, y))).toEqual([0, 0, 1, 1]);
		});

		it('step the drawn rotation by a share of a sector until every sector holds a site', () => {
			// Two sites 160 degrees apart, both in sector 0 from a rotation of 5 degrees; a step of 22.5 parts them.
			const near = (degrees: number) => ({ x: Math.cos(degrees * Math.PI / 180), y: Math.sin(degrees * Math.PI / 180) });
			const stepped = stepSectors({ drawn: 5, count: 2, steps: 8, sites: [near(10), near(170)] });
			expect(stepped.every).toBe(true);
			expect(stepped.rotation).toBe(27.5);
			expect(stepped.sectors.sectorOf(near(10).x, near(10).y)).toBe(1);
			// Sites in one sector whatever the step: the drawn rotation back, and a failure to report.
			const crowded = stepSectors({ drawn: 5, count: 4, steps: 8, sites: [near(100), near(110)] });
			expect(crowded).toMatchObject({ rotation: 5, every: false });
		});
	});

	describe('POIs by ring', () => {
		it('aim each ring at its target times poiDensity, never past it, and ring a POI by its distance', () => {
			for (const poiDensity of [0.5, 1, 2]) {
				const { layer } = place(meshes[4], { poiDensity });
				expect(layer.rings.map(({ target }) => target)).toEqual(POI_TUNING.rings.targets.map((target) => Math.round(target * poiDensity)));
				layer.rings.forEach(({ target, placed }) => expect(placed).toBeLessThanOrEqual(target));
				const pois = layer.pois.filter(({ type }) => type !== STRONGHOLD_TYPE);
				expect(pois.length).toBe(layer.rings.reduce((sum, { placed }) => sum + placed, 0));
				for (const { site, ring, tier } of pois) {
					const share = (distance(site) - 150) / (0.95 * 1000 - 150);
					expect(ring).toBe(Math.min(3, Math.floor(share * 4)));
					expect(tier).toBe(ring + 1);
				}
			}
		});

		it('keep their spacing from each other and from strongholds', () => {
			const { layer } = place(meshes[5], { poiDensity: 2 });
			const spacing = POI_TUNING.sites.spacing * 1000;
			for (let first = 0; first < layer.pois.length; first += 1) {
				for (let second = first + 1; second < layer.pois.length; second += 1) {
					const a = layer.pois[first].site;
					const b = layer.pois[second].site;
					expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(spacing);
				}
			}
		});

		it('sit at most one to a stretch, never at a stretch\'s end, and a three-way POI at its leaf', () => {
			for (const network of meshes.slice(0, 10)) {
				const { tree, layer } = place(network, { poiDensity: 2 });
				const stretches = layer.pois.filter(({ site }) => site.stretch >= 0).map(({ site }) => site.stretch);
				expect(new Set(stretches).size).toBe(stretches.length);
				for (const { site } of layer.pois) {
					if (site.stretch >= 0) {
						expect(site.along).toBeGreaterThan(0);
						expect(site.along).toBeLessThan(tree.lengths[site.stretch]);
						expect(site.node).toBe(-1);
					} else {
						expect(tree.meetingPoints.some(({ node }) => node === site.node)).toBe(true);
						expect(network.nodes[site.node]).toMatchObject({ x: site.x, y: site.y });
					}
				}
			}
		});
	});

	describe('types', () => {
		const typeOf = (layer: PoiLayer) => layer.pois.filter(({ type }) => type !== STRONGHOLD_TYPE);
		const yields = (types: string[]) => new Set(types.flatMap((type) => Object.keys(POI_TUNING.types[type].yields)));

		it('come from where a POI lands', () => {
			// Ruins round (500, 0), mountains east of x = 300 otherwise, scrub elsewhere.
			const ground = fakeGround({
				ruin: (x, y) => ((x - 500) ** 2 + y ** 2 < 150 ** 2 ? 1 : 0),
				biome: (x) => (x > 300 ? 'mountains' : 'scrub'),
			});
			const { layer } = place(meshes[6], { ground, poiDensity: 2 });
			for (const { site, type, ring } of typeOf(layer)) {
				if (ring === 0) continue;
				if ((site.x - 500) ** 2 + site.y ** 2 < 150 ** 2) expect(['hospital', 'mall', 'school']).toContain(type);
				else if (site.x > 300) expect(['fuelDepot', 'truckStop', 'quarry', 'mine']).toContain(type);
				else expect(['fuelDepot', 'truckStop', 'farm', 'silo']).toContain(type);
			}
		});

		it('cover food, water, and fuel in the first ring before location does', () => {
			// Mountains everywhere make quarries and mines, which yield no food or water.
			for (const network of meshes.slice(0, 10)) {
				const { layer } = place(network, { ground: all('mountains') });
				const first = typeOf(layer).filter(({ ring }) => ring === 0).map(({ type }) => type);
				const covered = yields(first);
				for (const resource of POI_TUNING.cover) expect(covered.has(resource)).toBe(true);
				expect(layer.failures).toEqual([]);
			}
		});

		it('report a first ring too small to cover them', () => {
			const tuning: PoiTuning = { ...POI_TUNING, rings: { ...POI_TUNING.rings, targets: [1, 7, 9, 9] } };
			const { layer } = place(meshes[2], { ground: all('mountains'), tuning });
			const first = typeOf(layer).filter(({ ring }) => ring === 0);
			expect(first).toHaveLength(1);
			const missing = POI_TUNING.cover.filter((resource) => !yields([first[0].type]).has(resource as PoiResource));
			expect(missing.length).toBeGreaterThan(0);
			expect(layer.failures).toEqual([`the first ring's POIs yield no ${missing.join(', ')}`]);
		});
	});

	it('is deterministic from its stream, and a different stream places differently', () => {
		const network = meshes[8];
		expect(place(network, { seed: 4 }).layer).toEqual(place(network, { seed: 4 }).layer);
		expect(place(network, { seed: 5 }).layer.pois).not.toEqual(place(network, { seed: 4 }).layer.pois);
	});
});

describe('the POI stage in the pipeline', () => {
	const params: MapParams = paramsFor({ seed: 21, strongholds: 4 });
	const looped = randomMesh({ seed: 31 });
	const treeOnly = randomMesh({ seed: 31, loops: 0, diagonals: 0 });

	/** A pipeline over synthetic roads: each run of the roads stage hands back the next network, the last one again past the end. */
	const pipeline = (networks: RoadNetwork[], strict: boolean) => {
		let runs = 0;
		return new MapPipeline<MapParams>()
			.stage({ name: 'water', run: () => ({ terrain: fakeGround() }) })
			.stage({ name: 'growth', run: () => ({ network: networks[Math.min(runs++, networks.length - 1)] }) })
			.stage(ROUTE_TREE_STAGE)
			.stage(poisStage({ strict }));
	};

	it('escalates to the roads when strict and no rotation seats every stronghold', () => {
		const result = pipeline([treeOnly, looped], true).run({ seed: params.seed, input: params, debug: true });
		expect(result.attempts).toEqual({ water: 0, growth: 1, routeTree: 0, pois: 0 });
		expect(result.timings.pois.runs).toBe(9);
		expect(result.failures.filter(({ stage }) => stage === 'pois')).toHaveLength(8);
		expect(result.failures[0].problems).toContain('sector 0 has no free meeting point in the outer band');
		expect(result.products.pois.strongholds).toHaveLength(4);
	});

	it('passes when lenient, with what it missed in its failures', () => {
		const result = pipeline([treeOnly, looped], false).run({ seed: params.seed, input: params, debug: true });
		expect(result.attempts).toEqual({ water: 0, growth: 0, routeTree: 0, pois: 0 });
		expect(result.products.routeTree.meetingPoints).toEqual([]);
		expect(result.products.pois.failures).toHaveLength(5);
	});

	it('never moves the route tree: POIs at poiDensity\'s ends leave every way home as it was', () => {
		const sparse = pipeline([looped], true).run({ seed: params.seed, input: { ...params, poiDensity: 0.5 }, debug: true });
		const dense = pipeline([looped], true).run({ seed: params.seed, input: { ...params, poiDensity: 2 }, debug: true });
		expect(dense.products.routeTree).toEqual(sparse.products.routeTree);
		expect(dense.products.pois.pois.length).toBeGreaterThan(sparse.products.pois.pois.length);
		// And on the area map itself.
		const set = { seed: 9, radius: 700 };
		const low = generateAreaMap({ params: paramsFor({ ...set, poiDensity: 0.5 }) });
		const high = generateAreaMap({ params: paramsFor({ ...set, poiDensity: 2 }) });
		expect(high.products.routeTree).toEqual(low.products.routeTree);
	});

	it('puts one POI on a hand-built mesh\'s one meeting point, with its two routes', () => {
		// A loop out from the compound: roads to (300, 250) and (300, -250), on to (600, 0) from the first, and the second joined to it.
		const network = meshFrom({ nodes: [[0, 0], [300, 250], [300, -250], [600, 0]], edges: [[0, 1], [0, 2], [1, 3], [2, 3]] });
		const tuning: PoiTuning = { ...POI_TUNING, rings: { ...POI_TUNING.rings, targets: [0, 1, 1, 1] }, cover: [] };
		const { tree, layer } = place(network, { strongholds: 2, tuning });
		// 3 is as quick home through 1 as through 2, so the lower stretch takes it home and the other is the meeting point.
		expect(tree.parentStretch[3]).toBe(2);
		expect(tree.meetingPoints).toEqual([{ stretch: 3, node: -1, from: [2, 3], via: [3, 3] }]);
		// Nothing reaches the outer band, so neither sector seats a stronghold.
		expect(layer.failures).toEqual(['sector 0 has no free meeting point in the outer band', 'sector 1 has no free meeting point in the outer band']);
		expect(layer.pois).toHaveLength(1);
		const [poi] = layer.pois;
		expect(poi.site.stretch).toBe(3);
		expect(poi.arrivals.map(({ from }) => from).sort()).toEqual([2, 3]);
		// One leg each, from the compound: through 1 to 3 then back along the stretch, and through 2.
		expect(layer.legs.map(({ from, poi: end, pieces }) => ({ from, end, stretches: pieces.map(({ stretch }) => stretch) })))
			.toEqual([{ from: 0, end: 0, stretches: [0, 2, 3] }, { from: 0, end: 0, stretches: [1, 3] }]);
		expect(routesTo(layer, poi).map(({ legs }) => legs.length)).toEqual([1, 1]);
	});
});
