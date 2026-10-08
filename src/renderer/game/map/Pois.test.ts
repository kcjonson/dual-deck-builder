import poisFile from '../data/pois.json';
import type { MapParamSet } from './MapParams';
import { checkPois } from './PoiChecks';
import { FACTIONS, POI_TUNING, PoiTuning, lengthOf, readPoiTuning } from './PoiData';
import { PoiOutcome, closes, deadEnds, placePois, routeGroups } from './Pois';
import { checkRoadNetwork } from './RoadChecks';
import { StepRules } from './RoadGrowth';
import { RoadNetwork, isApproach, roadEnd } from './RoadNetwork';
import { FakeTerrainOptions, StraightRoad, fakeTerrain, paramsFor, pipelineStream, straightNetwork } from './roadTesting';

const RADIUS = 1000;
const METRO = 150;

/** Just inside the rim, where growth ends a road leaving the area. */
const RIM = RADIUS - 1e-3;

/** Highways in pairs 25 degrees apart, four pairs round the compound, each to the rim. */
const PAIRS: StraightRoad[] = [0, 25, 90, 115, 180, 205, 270, 295].map((bearing) => ({ bearing, length: RIM }));

/** Four highways, each forking at `at` along it into itself and a back road 25 degrees off it, also to the rim. */
function forks(at: number): StraightRoad[] {
	const roads: StraightRoad[] = [];
	[0, 90, 180, 270].forEach((bearing) => {
		const highway = roads.length;
		roads.push({ bearing, length: RIM });
		roads.push({ bearing: bearing + 25, length: 400, ending: 'end', from: { road: highway, at } });
	});
	return roads;
}

/** Parsed JSON a test changes at any depth. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/** The shipped tuning with some of it changed. */
function tuningWith(change: (json: Json) => void): PoiTuning {
	const json = JSON.parse(JSON.stringify(poisFile));
	change(json);
	return readPoiTuning(json, 'PoiTuning');
}

function place(network: RoadNetwork, {
	seed = 1, attempt = 0, terrain = {}, tuning, set = {},
}: { seed?: number; attempt?: number; terrain?: FakeTerrainOptions; tuning?: PoiTuning; set?: Partial<MapParamSet> } = {}) {
	const params = paramsFor({ seed, radius: RADIUS, metroSize: METRO / RADIUS, strongholds: 2, routesTarget: 3, roadClearance: 24, ...set });
	const land = fakeTerrain({ radius: RADIUS, metroRadius: METRO, ...terrain });
	const outcome = placePois({ terrain: land, params, network, rng: pipelineStream(seed, 'pois', attempt), tuning });
	return { params, terrain: land, outcome };
}

function placed(outcome: PoiOutcome) {
	if (!outcome.placed) throw new Error(`sector ${outcome.sector} failed`);
	return outcome.map;
}

/** The highway out of the metro a stretch's route leaves the compound on. */
function highwayOf(network: RoadNetwork, stretch: number): number {
	let at = stretch;
	while (network.stretches[at].parent >= 0) at = network.stretches[at].parent;
	return network.stretches[at].road;
}

describe('routeGroups', () => {
	it('puts roads that split at the compound in different groups', () => {
		const network = straightNetwork(PAIRS);
		const keys = routeGroups(network, 400);
		const outer = (road: number) => network.roads[road].stretches[1];
		expect(keys[outer(0)]).not.toBe(keys[outer(1)]);
	});

	it('keys everything past a fork beyond the home area to the stretch that leaves it, and splits a fork inside it', () => {
		const network = straightNetwork(forks(500));
		const [street, inner, onward] = network.roads[0].stretches;
		const branch = network.roads[1].stretches[0];
		const beyond = routeGroups(network, 400);
		expect(beyond[onward]).toBe(inner);
		expect(beyond[branch]).toBe(inner);
		const within = routeGroups(network, 600);
		expect(within[onward]).not.toBe(within[branch]);
		// Stretches inside the home area key themselves.
		expect(within[inner]).toBe(inner);
		expect(within[street]).toBe(street);
	});
});

describe('deadEnds', () => {
	it('finds roads that ended blocked, a highway blocked as it left the metro among them, and not exits or junctions', () => {
		const network = straightNetwork([
			{ bearing: 0, length: RIM },
			{ bearing: 90, length: 600, ending: 'end' },
			{ bearing: 180, length: METRO, ending: 'metroEdge' },
			{ bearing: 20, length: 300, ending: 'end', from: { road: 0, at: 400 } },
		]);
		const ends = deadEnds(network);
		expect(ends.map((stretch) => network.nodes[network.stretches[stretch].to].kind).sort()).toEqual(['end', 'end', 'metroEdge']);
		expect(ends).toContain(network.roads[2].stretches[0]);
		expect(ends).not.toContain(network.roads[0].stretches[network.roads[0].stretches.length - 1]);
	});
});

describe('closes', () => {
	it('holds while the site stays ahead of the segment\'s end, so the distance to it only falls', () => {
		expect(closes(0, 0, 10, 0, 30, 0)).toBe(true);
		expect(closes(0, 0, 10, 0, 10, 5)).toBe(true);
		expect(closes(0, 0, 10, 0, 9, 5)).toBe(false);
		expect(closes(0, 0, 0, 0, 5, 5)).toBe(false);
	});
});

describe('StepRules.fromNetwork', () => {
	it('registers every road and its segments, so a stranger is kept clear of and kin taper at their junction', () => {
		const network = straightNetwork(forks(500));
		const rules = StepRules.fromNetwork({ network, terrain: fakeTerrain(), clearance: 24 });
		// A segment 10 units from highway 0 well out along it, as a road no one meets: a stranger.
		rules.setRoad(99, 4, 0, 0);
		expect(rules.blocker(99, 700, 10, 720, 10)).toBe('stranger');
		// Highway 0's branch meets it at its junction, so it may leave from there, at 20 degrees or more.
		const { x, y } = network.nodes[network.roads[1].from];
		expect(rules.blocker(1, x, y, x + 20, y + 10)).toBe('none');
		expect(rules.blocker(1, x, y, x + 20, y + 5)).toBe('kin');
	});

	it('registers approaches to one POI as meeting there, so each keeps the rules against the rest as laid', () => {
		const { outcome } = place(straightNetwork(PAIRS));
		const map = placed(outcome);
		const rules = StepRules.fromNetwork({ network: map.network, terrain: fakeTerrain(), clearance: 24 });
		for (const { approaches } of [...map.strongholds, ...map.pois]) {
			for (const road of approaches) {
				const points = map.network.stretches[map.network.roads[road].stretches[0]].points;
				for (let point = 0; point + 3 < points.length; point += 2) {
					expect(rules.blocker(road, points[point], points[point + 1], points[point + 2], points[point + 3])).toBe('none');
				}
			}
		}
	});

	it('lets two approaches to one POI touch there at 20 degrees or more, but not a road bound elsewhere', () => {
		const rules = new StepRules({ terrain: fakeTerrain(), clearance: 24 });
		rules.setRoad(0, -1, 0, 0);
		rules.index.add(0, 0, 900, 0, 0);
		const toward = (degrees: number): [number, number, number, number] => {
			const radians = degrees * Math.PI / 180;
			return [600 + 20 * Math.cos(radians), 200 + 20 * Math.sin(radians), 600, 200];
		};
		rules.setRoad(1, 0, 500, 0);
		rules.setGoal(1, 7, 600, 200);
		rules.index.add(...toward(-90), 1);
		rules.setRoad(2, 0, 700, 0);
		rules.setGoal(2, 7, 600, 200);
		expect(rules.blocker(2, ...toward(-60))).toBe('none');
		expect(rules.blocker(2, ...toward(-80))).toBe('kin');
		rules.setGoal(2, 8, 600, 200);
		expect(rules.blocker(2, ...toward(-60))).toBe('stranger');
	});
});

describe('placePois', () => {
	it('gives every site two or more approaches from different highways, each ending at it, and nothing leaving it', () => {
		const { params, terrain, outcome } = place(straightNetwork(PAIRS));
		const map = placed(outcome);
		expect(map.strongholds).toHaveLength(2);
		expect(map.pois.length).toBeGreaterThan(0);
		expect(checkRoadNetwork({ network: map.network, terrain, clearance: params.roadClearance })).toEqual([]);
		expect(checkPois({ map, routesTarget: params.routesTarget })).toEqual([]);
		for (const site of [...map.strongholds, ...map.pois]) {
			const node = map.network.nodes[site.node];
			expect(node.kind).toBe('poi');
			expect(map.network.stretches.some((stretch) => stretch.from === site.node)).toBe(false);
			const highways = site.approaches.map((road) => {
				expect(roadEnd(map.network, road)).toBe(site.node);
				expect(isApproach(map.network, road)).toBe(true);
				return highwayOf(map.network, map.network.roads[road].stretches[0]);
			});
			expect(new Set(highways).size).toBe(highways.length);
			expect(highways.length).toBeGreaterThanOrEqual(2);
			expect(highways.length).toBeLessThanOrEqual(params.routesTarget);
		}
	});

	it('keeps growth\'s network inside its own: every grown node, and every grown stretch\'s points, are still there', () => {
		const network = straightNetwork(PAIRS);
		const map = placed(place(network).outcome);
		network.nodes.forEach((node, id) => expect(map.network.nodes[id]).toEqual(node));
		network.roads.forEach((road, id) => {
			const before = road.stretches.flatMap((stretch, place) => network.stretches[stretch].points.slice(place === 0 ? 0 : 2));
			const after: number[] = [];
			map.network.roads[id].stretches.forEach((stretch) => {
				const points = map.network.stretches[stretch].points;
				after.push(...(after.length === 0 ? points : points.slice(2)));
			});
			expect(after).toEqual(before);
		});
	});

	it('fails the stage when a sector\'s roads all split past the home area, and seats it once the home area takes in the split', () => {
		const network = straightNetwork(forks(500));
		// Home reaches 150 + 0.25 x 1000 = 400 along the roads: each fork is one group.
		const narrow = place(network).outcome;
		expect(narrow.placed).toBe(false);
		if (!narrow.placed) expect(narrow.sector).toBe(0);
		const wide = place(network, { tuning: tuningWith((json) => { json.approaches.home = 0.45; }) });
		const map = placed(wide.outcome);
		expect(map.homeReach).toBe(METRO + 450);
		expect(checkPois({ map, routesTarget: wide.params.routesTarget })).toEqual([]);
	});

	it('seats in each sector the faction not yet placed whose land the site suits best', () => {
		const mire = placed(place(straightNetwork(PAIRS), { terrain: { biome: () => 'mire' } }).outcome);
		expect(mire.strongholds[0].faction).toBe('mireCrawlers');
		const desert = placed(place(straightNetwork(PAIRS), { terrain: { biome: () => 'desert' } }).outcome);
		expect(desert.strongholds.map(({ faction }) => faction).sort()).toEqual(['duneStriders', 'sunChasers']);
		for (const map of [mire, desert]) {
			expect(new Set(map.strongholds.map(({ faction }) => faction)).size).toBe(map.strongholds.length);
			map.strongholds.forEach(({ faction }) => expect(FACTIONS[faction]).toBeDefined());
		}
	});

	it('puts each stronghold in the outer band, one in each sector', () => {
		const { outcome } = place(straightNetwork(PAIRS), { set: { strongholds: 4 } });
		const map = placed(outcome);
		const { band } = POI_TUNING.strongholds;
		expect(map.strongholds.map(({ sector }) => sector)).toEqual([0, 1, 2, 3]);
		// Sectors are 90 degrees wide, counterclockwise from a rotation the stream draws.
		const rotation = pipelineStream(1, 'pois').fork('sectors').float() * 90;
		map.strongholds.forEach(({ node, sector }) => {
			const { x, y } = map.network.nodes[node];
			const distance = Math.hypot(x, y);
			expect(distance).toBeGreaterThanOrEqual(band.inner * RADIUS - 1e-9);
			expect(distance).toBeLessThanOrEqual(band.outer * RADIUS + 1e-9);
			const into = ((Math.atan2(y, x) * 180 / Math.PI - rotation - sector * 90) % 360 + 360) % 360;
			expect(into).toBeLessThanOrEqual(90 + 1e-9);
		});
	});

	it('types a POI by where it lands', () => {
		const tuning = tuningWith((json) => {
			json.placement = [{ types: ['hospital'], where: [{ ruinAtLeast: 0.5 }] }, { types: ['farm'], where: [{}] }];
			json.types = { hospital: json.types.hospital, farm: json.types.farm };
		});
		const map = placed(place(straightNetwork(PAIRS), { tuning, terrain: { ruin: (x) => (x > 0 ? 1 : 0) } }).outcome);
		expect(map.pois.length).toBeGreaterThan(2);
		for (const poi of map.pois) expect(poi.type).toBe(map.network.nodes[poi.node].x > 0 ? 'hospital' : 'farm');
	});

	it('aims each ring at its target times poiDensity, and puts each POI in its ring', () => {
		const { outer, targets } = POI_TUNING.rings;
		for (const poiDensity of [0.5, 2]) {
			const { outcome } = place(straightNetwork(PAIRS), { set: { poiDensity } });
			const map = placed(outcome);
			expect(outcome.stats.pois.targets).toEqual(targets.map((target) => Math.round(target * poiDensity)));
			outcome.stats.pois.placed.forEach((count, ring) => expect(count).toBeLessThanOrEqual(outcome.stats.pois.targets[ring]));
			const width = (outer * RADIUS - METRO) / targets.length;
			for (const poi of map.pois) {
				const { x, y } = map.network.nodes[poi.node];
				const distance = Math.hypot(x, y);
				expect(distance).toBeGreaterThanOrEqual(METRO + width * poi.ring - 1e-9);
				expect(distance).toBeLessThanOrEqual(METRO + width * (poi.ring + 1) + 1e-9);
			}
		}
	});

	it('keeps sites the spacing apart and clear of every road', () => {
		const { params, outcome } = place(straightNetwork(PAIRS));
		const map = placed(outcome);
		const spacing = lengthOf(POI_TUNING.sites.spacing, RADIUS, params.roadClearance);
		const sites = [...map.strongholds, ...map.pois].map(({ node }) => map.network.nodes[node]);
		sites.forEach((a, first) => sites.slice(first + 1).forEach((b) => expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(spacing)));
	});

	it('steps approaches no nearer the compound than where they leave their road, and lands each on its site', () => {
		const map = placed(place(straightNetwork(PAIRS)).outcome);
		for (const site of [...map.strongholds, ...map.pois]) {
			const node = map.network.nodes[site.node];
			for (const road of site.approaches) {
				const { points, from } = map.network.stretches[map.network.roads[road].stretches[0]];
				const start = Math.hypot(map.network.nodes[from].x, map.network.nodes[from].y);
				for (let point = 0; point < points.length; point += 2) expect(Math.hypot(points[point], points[point + 1])).toBeGreaterThanOrEqual(start * (1 - 1e-9));
				expect(points.slice(-2)).toEqual([node.x, node.y]);
			}
		}
	});

	it('is deterministic, the stream decides, and nothing reads Math.random', () => {
		const network = straightNetwork(PAIRS);
		const random = jest.spyOn(Math, 'random');
		const first = place(network).outcome;
		expect(random).not.toHaveBeenCalled();
		random.mockRestore();
		expect(place(network).outcome).toEqual(first);
		expect(place(network, { attempt: 1 }).outcome).not.toEqual(first);
	});
});
