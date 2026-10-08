import { Rng } from '../core/Rng';
import { checkRoadNetwork } from './RoadChecks';
import {
	BRANCH_ANGLE, CANDIDATE_HEADINGS, JUNCTION_TAPER, OUTWARD_SHARE, PASSABLE_SPACING, ROAD_CLASS_RULES, STEP_LENGTH,
	StepRules, TipQueue, candidateTurns, growRoads, isOutward, isPassable, turnScale,
} from './RoadGrowth';
import { ROAD_CLASSES, RoadNetwork } from './RoadNetwork';
import { departure, fakeTerrain, growMap, paramsFor, pipelineStream, roadLines } from './roadTesting';

const FLAT = fakeTerrain();

/** Growth on a fake terrain from the given departures, on seed `seed`'s growth stream. */
function growOn(terrain: ReturnType<typeof fakeTerrain>, departures: ReturnType<typeof departure>[], set: Parameters<typeof paramsFor>[0], growthSeed = set.seed) {
	const params = paramsFor({ radius: terrain.radius, ...set });
	return growRoads({ terrain, params, highways: departures, rng: pipelineStream(growthSeed, 'growth') });
}

/** Every point of every stretch on `road`. */
function pointsOf(network: RoadNetwork, road: number): [number, number][] {
	const points: [number, number][] = [];
	network.roads[road].stretches.forEach((id) => {
		const flat = network.stretches[id].points;
		for (let point = 0; point < flat.length; point += 2) points.push([flat[point], flat[point + 1]]);
	});
	return points;
}

/** A step of `length` from (x, 0) far out, at `degrees` off the radial. */
function stepOff(degrees: number, x = 100000, length = STEP_LENGTH): [number, number, number, number] {
	const radians = degrees * Math.PI / 180;
	return [x, 0, x + length * Math.cos(radians), length * Math.sin(radians)];
}

describe('the step rules', () => {
	describe('outward', () => {
		it('takes a step that gains cos(65 degrees) of its length in distance from the compound, and no less', () => {
			expect(OUTWARD_SHARE).toBeCloseTo(Math.cos(65 * Math.PI / 180), 15);
			expect(isOutward(...stepOff(0))).toBe(true);
			expect(isOutward(...stepOff(64.9))).toBe(true);
			expect(isOutward(...stepOff(65.1))).toBe(false);
			expect(isOutward(...stepOff(90))).toBe(false);
			expect(isOutward(...stepOff(180))).toBe(false);
		});

		it('measures the gain end to end, so near the compound a step that starts across the radial can still pass', () => {
			// From (100, 0) at 66 degrees off the radial, the radial swings toward the step as it goes.
			const [x0, y0, x1, y1] = stepOff(66, 100);
			expect(Math.hypot(x1, y1) - Math.hypot(x0, y0)).toBeGreaterThanOrEqual(OUTWARD_SHARE * STEP_LENGTH);
			expect(isOutward(x0, y0, x1, y1)).toBe(true);
		});
	});

	describe('passable', () => {
		const crater = { x: 0, y: 500, craterRadius: 20, plumeRadius: 100, strength: 1 };
		const terrain = fakeTerrain({ hotspots: [crater] });

		it('turns down a step that only grazes a crater, exactly, even where the samples would miss it', () => {
			// 0.001 inside the rim: the chord through the crater is 0.4 long, shorter than the sample spacing.
			expect(isPassable(terrain, -30, 519.999, 30, 519.999)).toBe(false);
			expect(isPassable(terrain, -30, 520.001, 30, 520.001)).toBe(true);
		});

		it('samples cliffs and water every PASSABLE_SPACING, so a sliver a little wider than that blocks a step', () => {
			const sliver = fakeTerrain({ wall: (x) => x >= 10 && x < 10 + 1.2 * PASSABLE_SPACING });
			expect(isPassable(sliver, 0, 300, 20, 300)).toBe(false);
			expect(isPassable(sliver, 0, 300, 9.9, 300)).toBe(true);
		});
	});

	describe('clearance', () => {
		/** Road 0 a highway out of the metro; roads 1 and 2 its branches, strangers to each other. */
		function rulesWithRoads(clearance = 24) {
			const rules = new StepRules({ terrain: FLAT, clearance });
			rules.setRoad(0, -1, 0, 0);
			rules.setRoad(1, 0, 0, 300);
			rules.setRoad(2, 0, 0, 500);
			return rules;
		}

		it('keeps roadClearance from a road it doesn\'t meet', () => {
			const rules = rulesWithRoads();
			rules.index.add(100, 400, 100, 420, 1);
			expect(rules.blocker(2, 123.9, 400, 140, 420)).toBe('stranger');
			expect(rules.blocker(2, 124.1, 400, 140, 420)).toBe('none');
			expect(rules.broken(2, 123.9, 400, 140, 420)).toBe('clearance');
		});

		it('never counts a road\'s own segments', () => {
			const rules = rulesWithRoads();
			rules.index.add(100, 400, 100, 420, 1);
			expect(rules.clear(1, 100, 420, 101, 440)).toBe(true);
		});

		it('tapers the gap near a junction the two share, to nothing at the junction', () => {
			const rules = rulesWithRoads();
			// Road 0 runs on through road 1's junction at (0, 300).
			rules.index.add(0, 300, 0, 400, 0);
			// A segment 80 units out from the junction needs JUNCTION_TAPER of its distance from it.
			const need = (offset: number) => JUNCTION_TAPER * Math.hypot(offset, 80);
			expect(need(20)).toBeLessThan(24);
			expect(rules.blocker(1, 20, 380, 20, 400)).toBe('kin');
			expect(20).toBeLessThan(need(20));
			expect(rules.blocker(1, 21, 380, 21, 400)).toBe('none');
			expect(21).toBeGreaterThan(need(21));
			// Road 2 is no kin of road 1's, so the full clearance holds against it.
			rules.index.add(40, 300, 40, 400, 2);
			expect(rules.blocker(1, 60, 380, 60, 400)).toBe('stranger');
		});

		it('lets kin touch only at their junction, leaving it at 20 degrees or more', () => {
			const rules = rulesWithRoads();
			rules.index.add(0, 300, 0, 320, 0);
			const leaving = (degrees: number) => {
				const radians = (90 - degrees) * Math.PI / 180;
				return [0, 300, 20 * Math.cos(radians), 300 + 20 * Math.sin(radians)] as const;
			};
			expect(rules.clear(1, ...leaving(25))).toBe(true);
			expect(rules.clear(1, ...leaving(15))).toBe(false);
			// Touching anywhere but the junction is a crossing.
			expect(rules.clear(1, 0, 310, 20, 330)).toBe(false);
		});

		it('lets the highways out of the metro meet at the compound and taper apart from it', () => {
			const rules = rulesWithRoads();
			rules.setRoad(3, -1, 0, 0);
			rules.index.add(0, 0, 0, 100, 0);
			// 100 units out a highway needs JUNCTION_TAPER * 100 = 25 > clearance, so the full 24.
			expect(rules.clear(3, 23, 100, 23, 120)).toBe(false);
			expect(rules.clear(3, 25, 100, 25, 120)).toBe(true);
			// 40 units out it needs only 10.
			expect(rules.clear(3, 11, 40, 15, 59.6)).toBe(true);
		});
	});

	it('keeps steps inside the disc', () => {
		const rules = new StepRules({ terrain: FLAT, clearance: 24 });
		rules.setRoad(0, -1, 0, 0);
		expect(rules.broken(0, 990, 0, 1001, 0)).toBe('disc');
		expect(rules.broken(0, 980, 0, 1000, 0)).toBeNull();
	});
});

describe('growth', () => {
	it('proposes headings evenly across the class\'s turn limit, scaled by curviness', () => {
		[0, 0.5, 1].forEach((curviness) => {
			ROAD_CLASSES.forEach((roadClass) => {
				const turns = candidateTurns(roadClass, curviness);
				const limit = ROAD_CLASS_RULES[roadClass].turnLimit * turnScale(curviness);
				expect(turns).toHaveLength(CANDIDATE_HEADINGS);
				expect(turns[0]).toBeCloseTo(-limit, 12);
				expect(turns[turns.length - 1]).toBeCloseTo(limit, 12);
				expect(turns).toContain(0);
			});
		});
		expect(candidateTurns('highway', 0.5)[CANDIDATE_HEADINGS - 1]).toBe(10);
		expect(candidateTurns('backRoad', 0.5)[CANDIDATE_HEADINGS - 1]).toBe(18);
		expect(candidateTurns('trail', 0.5)[CANDIDATE_HEADINGS - 1]).toBe(28);
	});

	it('steers by travel cost, keeping off ground that costs more', () => {
		const set = { seed: 11, branchiness: 0 };
		const westDear = fakeTerrain({ cost: (x) => 1 + Math.max(0, -x) });
		const eastDear = fakeTerrain({ cost: (x) => 1 + Math.max(0, x) });
		const west = growOn(westDear, [departure(90, 150)], set).network;
		const east = growOn(eastDear, [departure(90, 150)], set).network;
		pointsOf(west, 0).forEach(([x]) => expect(x).toBeGreaterThan(-0.5));
		pointsOf(east, 0).forEach(([x]) => expect(x).toBeLessThan(0.5));
	});

	it('follows its preferred heading as it drifts', () => {
		const set = { seed: 12, branchiness: 0 };
		const left = growOn(FLAT, [departure(90, 150, [0, 30, 30])], set).network;
		const right = growOn(FLAT, [departure(90, 150, [0, -30, -30])], set).network;
		const end = (network: RoadNetwork) => pointsOf(network, 0)[pointsOf(network, 0).length - 1];
		expect(end(left)[0]).toBeLessThan(-200);
		expect(end(right)[0]).toBeGreaterThan(200);
	});

	it('draws its noise from the growth stream: the same stream grows the same roads, another stream others', () => {
		const set = { seed: 13 };
		const departures = [departure(10, 150), departure(130, 150), departure(250, 150)];
		const first = growOn(FLAT, departures, set).network;
		expect(growOn(FLAT, departures, set).network).toEqual(first);
		expect(growOn(FLAT, departures, set, 14).network).not.toEqual(first);
	});

	it('leaves the area at the rim: every highway on open ground ends at an exit there', () => {
		const { network } = growOn(FLAT, [departure(0, 150), departure(120, 150), departure(240, 150)], { seed: 15, branchiness: 0 });
		[0, 1, 2].forEach((road) => {
			const last = network.roads[road].stretches[network.roads[road].stretches.length - 1];
			const node = network.nodes[network.stretches[last].to];
			expect(node.kind).toBe('exit');
			expect(Math.hypot(node.x, node.y)).toBeLessThanOrEqual(1000);
			expect(Math.hypot(node.x, node.y)).toBeGreaterThan(1000 - 1e-5);
		});
	});

	it('ends a road where every heading is blocked, as a dead end', () => {
		const walled = fakeTerrain({ wall: (_x, y) => y > 400 && y < 430 });
		const { network, stats } = growOn(walled, [departure(90, 150)], { seed: 16, branchiness: 0 });
		const points = pointsOf(network, 0);
		const [, tipY] = points[points.length - 1];
		expect(tipY).toBeLessThanOrEqual(400);
		expect(tipY).toBeGreaterThan(400 - STEP_LENGTH);
		expect(network.nodes[network.stretches[network.roads[0].stretches[network.roads[0].stretches.length - 1]].to].kind).toBe('end');
		expect(stats.ends.blocked).toBeGreaterThanOrEqual(1);
	});

	it('branches on the side with more open room', () => {
		// A highway north with impassable ground 30 units to its west, which the room probes reach at any branch angle.
		// Its first branch, with nothing else grown to the east yet, goes east every time.
		const walled = fakeTerrain({ wall: (x) => x < -30 });
		let branches = 0;
		for (let seed = 31; seed < 43; seed += 1) {
			const { network } = growOn(walled, [departure(90, 150)], { seed, branchiness: 1 });
			const first = network.roads.filter((road) => road.parent === 0)
				.sort((a, b) => network.nodes[a.from].y - network.nodes[b.from].y)[0];
			if (first === undefined) continue;
			const points = network.stretches[first.stretches[0]].points;
			expect(points[2]).toBeGreaterThan(points[0]);
			branches += 1;
		}
		expect(branches).toBeGreaterThan(8);
	});

	it('branches highways into back roads and the rare interchange, back roads into back roads and trails, and never trails', () => {
		const { network } = growMap({ seed: 18, branchiness: 1 });
		network.roads.forEach((road) => {
			if (road.parent < 0) return;
			const at = network.stretches[network.stretches[road.stretches[0]].parent].roadClass;
			expect(at).not.toBe('trail');
			expect(at === 'highway' ? ['backRoad', 'highway'] : ['backRoad', 'trail']).toContain(road.roadClass);
		});
		expect(network.roads.filter((road) => road.parent >= 0 && road.roadClass === 'backRoad').length).toBeGreaterThan(5);
	});

	it('degrades a back road to a trail in rough ground, more readily with trailShare, and never upgrades', () => {
		const dear = fakeTerrain({ cost: (x, y) => (Math.hypot(x, y) > 450 ? 2.5 : 1) });
		const grow = (trailShare: number) => growOn(dear, [departure(30, 150), departure(150, 150), departure(270, 150)], { seed: 19, branchiness: 1, trailShare }).network;
		// trailShare 1 degrades at a running cost of 1.7, 0 only past 3.2, more than this ground ever costs.
		const ready = grow(1);
		const degraded = ready.stretches.filter((stretch) => stretch.roadClass === 'trail' && ready.roads[stretch.road].roadClass === 'backRoad');
		expect(degraded.length).toBeGreaterThan(0);
		degraded.forEach(({ from }) => {
			expect(ready.nodes[from].kind).toBe('classChange');
			expect(Math.hypot(ready.nodes[from].x, ready.nodes[from].y)).toBeGreaterThan(450);
		});
		ready.roads.forEach((road) => {
			const ranks = road.stretches.map((id) => ROAD_CLASSES.indexOf(ready.stretches[id].roadClass));
			ranks.forEach((rank, place) => expect(rank).toBeGreaterThanOrEqual(ranks[Math.max(0, place - 1)]));
		});
		const reluctant = grow(0);
		expect(reluctant.nodes.filter((node) => node.kind === 'classChange')).toHaveLength(0);
		expect(reluctant.stretches.filter((stretch) => stretch.roadClass === 'trail' && reluctant.roads[stretch.road].roadClass === 'backRoad')).toHaveLength(0);
	});

	it('ends a road at its class\'s longest', () => {
		const { network } = growMap({ seed: 20, radius: 1600, branchiness: 1 });
		roadLines(network).forEach(({ points, classes }) => {
			let run = 0;
			classes.forEach((roadClass, segment) => {
				run = segment > 0 && classes[segment - 1] === roadClass ? run : 0;
				run += Math.hypot(points[2 * segment + 2] - points[2 * segment], points[2 * segment + 3] - points[2 * segment + 1]);
				expect(run).toBeLessThan(ROAD_CLASS_RULES[roadClass].maxLength + STEP_LENGTH);
			});
		});
	});

	it('sends a branch off at 20 to 55 degrees from the way its parent came in', () => {
		const { network } = growMap({ seed: 21, branchiness: 1 });
		let branches = 0;
		network.roads.forEach((road) => {
			if (road.parent < 0) return;
			const inward = network.stretches[network.stretches[road.stretches[0]].parent].points;
			const first = network.stretches[road.stretches[0]].points;
			const inX = inward[inward.length - 2] - inward[inward.length - 4];
			const inY = inward[inward.length - 1] - inward[inward.length - 3];
			const angle = Math.acos((inX * (first[2] - first[0]) + inY * (first[3] - first[1])) / (Math.hypot(inX, inY) * Math.hypot(first[2] - first[0], first[3] - first[1]))) * 180 / Math.PI;
			expect(angle).toBeGreaterThan(BRANCH_ANGLE.min - 1e-9);
			expect(angle).toBeLessThan(BRANCH_ANGLE.max + 1e-9);
			branches += 1;
		});
		expect(branches).toBeGreaterThan(5);
	});

	it('smooths most stretches into curves that keep the rules, nodes held still', () => {
		const { network, stats, terrain, params } = growMap({ seed: 22 });
		expect(stats.stretches.smoothed).toBeGreaterThan(4 * stats.stretches.unsmoothed);
		expect(checkRoadNetwork({ network, terrain, clearance: params.roadClearance })).toEqual([]);
		// Two passes of Chaikin turn a stretch of n steps' n + 1 points into 4n - 2, the ends among them.
		const long = network.stretches.filter((stretch) => stretch.points.length > 4);
		const curved = long.filter((stretch) => {
			const count = stretch.points.length / 2;
			return (count + 2) % 4 === 0 && count > 4;
		});
		expect(curved.length).toBeGreaterThan(0.8 * long.length);
	});

	it('grows the same network from the same seed and parameters, and from a fresh copy of the modules', () => {
		const set = { seed: 25, environment: 'badlands' as const };
		const first = growMap(set).network;
		expect(growMap(set).network).toEqual(first);
		expect(growMap({ ...set, seed: 26 }).network).not.toEqual(first);
		expect(growMap(set, { growthAttempt: 1 }).network).not.toEqual(first);
		let fresh: typeof growMap | null = null;
		jest.isolateModules(() => {
			fresh = (jest.requireActual('./roadTesting') as typeof import('./roadTesting')).growMap;
		});
		if (!fresh) throw new Error('roadTesting did not load');
		expect((fresh as typeof growMap)(set).network).toEqual(first);
	});

	it('returns plain data: JSON round trips it, numbers and all', () => {
		const { network } = growMap({ seed: 23 });
		expect(JSON.parse(JSON.stringify(network))).toEqual(network);
		network.stretches.forEach((stretch) => stretch.points.forEach((value) => expect(Number.isFinite(value)).toBe(true)));
	});

	it('keeps off water: steps never cross the water layer', () => {
		const lake = { isWater: (x: number, y: number) => Math.hypot(x - 300, y - 200) < 140 };
		const { network, terrain, params } = growMap({ seed: 24, branchiness: 1 }, { water: lake });
		expect(checkRoadNetwork({ network, terrain, clearance: params.roadClearance })).toEqual([]);
		network.stretches.forEach(({ points }) => {
			for (let point = 0; point < points.length; point += 2) expect(lake.isWater(points[point], points[point + 1])).toBe(false);
		});
	});
});

describe('TipQueue', () => {
	it('pops the nearest tip first, ties to the lower id, and takes a road back with a new key', () => {
		const queue = new TipQueue();
		[[3, 50], [1, 70], [4, 50], [0, 20], [2, 90]].forEach(([id, key]) => queue.push(id, key));
		const order: number[] = [];
		let regrown = false;
		while (queue.size > 0) {
			const id = queue.pop();
			order.push(id);
			if (id === 0 && !regrown) {
				queue.push(0, 80);
				regrown = true;
			}
		}
		expect(order).toEqual([0, 3, 4, 1, 0, 2]);
	});

	it('orders as a sorted list would, over many keys', () => {
		const rng = new Rng({ seed: 5 });
		const queue = new TipQueue();
		const keys = Array.from({ length: 300 }, () => Math.floor(rng.float() * 50));
		keys.forEach((key, id) => queue.push(id, key));
		const order: number[] = [];
		while (queue.size > 0) order.push(queue.pop());
		const sorted = keys.map((key, id) => ({ key, id })).sort((a, b) => a.key - b.key || a.id - b.id).map(({ id }) => id);
		expect(order).toEqual(sorted);
	});
});
