import { checkRoadNetwork } from './RoadChecks';
import { BRANCH_ANGLE, ROAD_CLASS_RULES, turnScale } from './RoadGrowth';
import { GrownMap, degreesBetween, growMap, roadLines, sampledRoadParamSets } from './roadTesting';

/**
 * Growth's properties over seeds and parameters sampled across their tuning
 * ranges (Area Map Generation, Testing). CI grows a few dozen maps; set
 * ROAD_PROPERTY_MAPS to grow more, which is how the record's thousands were
 * run:
 *
 *   ROAD_PROPERTY_MAPS=2000 npx jest RoadGrowth.property --coverage=false
 *
 * scripts/road-growth.mjs check runs the network checks alone, faster.
 */
const MAPS = Number(process.env.ROAD_PROPERTY_MAPS ?? 24);
const SETS = sampledRoadParamSets(MAPS);

describe('growth across the tuning ranges', () => {
	it.each(SETS.map((set, index) => [index, set] as const))('keeps every rule in map %i', (index, set) => {
		const map = growMap(set);
		const { network, terrain, clearance } = map;

		// Passable, outward, inside the disc, no crossings, clearance, junction
		// angles, and the trees: every stretch's parent chain ends at a highway's
		// city street from the compound, without a loop. Growth's own check is
		// the same, and the runner would retry a network that failed it, so the
		// first attempt has to be the one that won.
		expect(checkRoadNetwork({ network, terrain, clearance, limit: 5 })).toEqual([]);
		expect(map.attempts.growth).toBe(0);
		expect(map.mapAttempt).toBe(0);

		expectHighwaysFromDepartures(map);
		expectTurnsWithinLimits(map);
		expectBranchAngles(map);
		expectParentChains(map);

		// Determinism, on a few: the same map again, and another from the next seed.
		if (index % 6 === 0) {
			expect(growMap(set).network).toEqual(network);
			expect(growMap({ ...set, seed: (set.seed + 1) >>> 0 }).network).not.toEqual(network);
		}
	});
});

/** The first roads are the highways out of the metro, one per departure, each a city street out to it. */
function expectHighwaysFromDepartures({ network, highways }: GrownMap): void {
	highways.forEach((departure, id) => {
		const road = network.roads[id];
		expect(road.parent).toBe(-1);
		expect(road.roadClass).toBe('highway');
		expect(road.from).toBe(0);
		const street = network.stretches[road.stretches[0]];
		expect(street.points).toEqual([0, 0, departure.x, departure.y]);
		expect(network.nodes[street.to].kind === 'metroEdge' || network.nodes[street.to].kind === 'end').toBe(true);
	});
	expect(network.roads.filter((road) => road.parent === -1)).toHaveLength(highways.length);
}

/** Every bend along a road is within the turn limit of the class it bends into, as curviness scales it. */
function expectTurnsWithinLimits({ network, params }: GrownMap): void {
	const scale = turnScale(params.curviness);
	roadLines(network).forEach(({ points, classes }) => {
		for (let segment = 1; segment < classes.length; segment += 1) {
			const at = 2 * segment;
			const turn = degreesBetween(points[at] - points[at - 2], points[at + 1] - points[at - 1], points[at + 2] - points[at], points[at + 3] - points[at + 1]);
			expect(turn).toBeLessThan(ROAD_CLASS_RULES[classes[segment]].turnLimit * scale + 1e-6);
		}
	});
}

/** Each branch leaves 20 to 55 degrees from the way its parent came into the junction. */
function expectBranchAngles({ network }: GrownMap): void {
	network.roads.forEach((road) => {
		if (road.parent < 0) return;
		const inward = network.stretches[network.stretches[road.stretches[0]].parent].points;
		const first = network.stretches[road.stretches[0]].points;
		const angle = degreesBetween(
			inward[inward.length - 2] - inward[inward.length - 4], inward[inward.length - 1] - inward[inward.length - 3],
			first[2] - first[0], first[3] - first[1],
		);
		expect(angle).toBeGreaterThan(BRANCH_ANGLE.min - 1e-6);
		expect(angle).toBeLessThan(BRANCH_ANGLE.max + 1e-6);
	});
}

/** Walking parent links from any stretch reaches a highway root, in fewer links than there are stretches. */
function expectParentChains({ network }: GrownMap): void {
	network.stretches.forEach((_stretch, id) => {
		let at = id;
		let links = 0;
		while (network.stretches[at].parent !== -1) {
			at = network.stretches[at].parent;
			links += 1;
			expect(links).toBeLessThan(network.stretches.length);
		}
		expect(network.nodes[network.stretches[at].from].kind).toBe('compound');
		expect(network.roads[network.stretches[at].road].parent).toBe(-1);
	});
}
