import { pointSegmentDistanceSquared, segmentDistanceSquared, segmentsMeet } from './Geometry';
import { ROAD_CLASSES, RoadNetwork, RoadStretch, classRank } from './RoadNetwork';
import { JUNCTION_COS, JUNCTION_TAPER, OUTWARD_SHARE, isPassable } from './RoadGrowth';
import type { Terrain } from './Terrain';

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;
const min = Math.min;
const max = Math.max;

/**
 * Checks a drivable network against the guarantees growth keeps (Area Map
 * Generation, Guarantees 2, 3, and 8, and the tree the routes walk), from the
 * network's plain data alone, so it can check a loaded map as well as one
 * just grown. Growth keeps every rule as it lays each step; this looks again
 * by other means (every pair of nearby segments, through grid buckets of its
 * own rather than growth's spatial hash, and the tree from its links), which
 * is what the property tests and the map validator lean on.
 */

export type RoadRule = 'structure' | 'outward' | 'disc' | 'passable' | 'crossing' | 'clearance' | 'junctionAngle';

export interface RoadViolation {
	readonly rule: RoadRule;
	/** What broke and where: stretch and point indices, and coordinates. */
	readonly detail: string;
}

export interface RoadCheckOptions {
	network: RoadNetwork;
	terrain: Pick<Terrain, 'radius' | 'hotspots' | 'obstacle' | 'onBridge'>;
	/** What growth kept: its `clearance`. */
	clearance: number;
	/** Stops after this many violations. */
	limit?: number;
}

/**
 * Every rule the network breaks, up to `limit`:
 *
 * - structure: node 0 is the compound; each stretch runs between its nodes
 *   and follows on from its parent; every parent chain ends at a city street
 *   from the compound on a highway out of the metro, so the stretches are
 *   trees; roads are chains of stretches; classes never upgrade outward,
 *   highways branch into back roads or highways, back roads into back roads
 *   or trails, and trails don't branch; nodes have the stretches their kind
 *   says.
 * - outward: every segment gains at least `OUTWARD_SHARE` of its length in
 *   distance from the compound, so every road runs away from it throughout.
 * - disc: every point is inside the disc.
 * - passable: no segment crosses a crater or, sampled as growth samples,
 *   impassable ground, bar river water under a bridge (`isPassable`).
 * - crossing and clearance: segments of different roads keep
 *   `clearance` apart, except near a junction the two share, where the gap
 *   tapers as growth's does and they touch only at the junction; segments of
 *   one road touch only where they join.
 * - junctionAngle: a branch leaves its junction at least 20 degrees from its
 *   parent's way in, carried on through the junction, and from its way on.
 */
export function checkRoadNetwork({ network, terrain, clearance, limit = 20 }: RoadCheckOptions): RoadViolation[] {
	const violations: RoadViolation[] = [];
	const report = (rule: RoadRule, detail: string) => {
		if (violations.length < limit) violations.push({ rule, detail });
	};
	checkStructure(network, report);
	if (violations.length > 0) return violations;
	checkSegments(network, terrain, report);
	checkPairs(network, clearance, report);
	checkJunctions(network, report);
	return violations;
}

type Report = (rule: RoadRule, detail: string) => void;

function checkStructure({ nodes, roads, stretches }: RoadNetwork, report: Report): void {
	if (nodes.length === 0 || nodes[0].kind !== 'compound' || nodes[0].x !== 0 || nodes[0].y !== 0) {
		report('structure', 'node 0 is not the compound at the origin');
		return;
	}
	const ins = new Array<number>(nodes.length).fill(0);
	const outs = new Array<number>(nodes.length).fill(0);
	nodes.forEach((node, id) => {
		if (id > 0 && node.kind === 'compound') report('structure', `node ${id} is a second compound`);
	});
	stretches.forEach((stretch, id) => {
		const { from, to, points, parent, road } = stretch;
		if (!(from >= 0 && from < nodes.length && to >= 0 && to < nodes.length && from !== to)) {
			report('structure', `stretch ${id} runs between nodes ${from} and ${to}`);
			return;
		}
		outs[from] += 1;
		ins[to] += 1;
		if (!ROAD_CLASSES.includes(stretch.roadClass)) report('structure', `stretch ${id} has class ${stretch.roadClass}`);
		if (points.length < 4 || points.length % 2 !== 0 || points.some((value) => !Number.isFinite(value))) {
			report('structure', `stretch ${id} has ${points.length} coordinates`);
			return;
		}
		if (points[0] !== nodes[from].x || points[1] !== nodes[from].y) report('structure', `stretch ${id} doesn't start at node ${from}`);
		if (points[points.length - 2] !== nodes[to].x || points[points.length - 1] !== nodes[to].y) report('structure', `stretch ${id} doesn't end at node ${to}`);
		if (!(road >= 0 && road < roads.length) || !roads[road].stretches.includes(id)) report('structure', `stretch ${id} isn't listed by its road ${road}`);
		if (nodes[from].kind === 'compound') {
			if (parent !== -1) report('structure', `stretch ${id} starts at the compound but has parent ${parent}`);
		} else if (!(parent >= 0 && parent < stretches.length) || stretches[parent].to !== from) {
			report('structure', `stretch ${id} has parent ${parent}, which doesn't end where it starts`);
		}
	});

	// Every parent chain ends at a city street, within as many links as there are stretches: no cycles.
	stretches.forEach((stretch, id) => {
		let at = id;
		let links = 0;
		while (stretches[at].parent !== -1 && links <= stretches.length) {
			at = stretches[at].parent;
			if (!(at >= 0 && at < stretches.length)) return;
			links += 1;
		}
		if (links > stretches.length) {
			report('structure', `stretch ${id}'s parent chain loops`);
			return;
		}
		const root = roads[stretches[at].road];
		if (nodes[stretches[at].from].kind !== 'compound' || root === undefined || root.parent !== -1 || root.roadClass !== 'highway') {
			report('structure', `stretch ${id}'s parent chain ends at stretch ${at}, not a highway's city street`);
		}
	});

	roads.forEach((road, id) => {
		const chain = road.stretches;
		if (chain.length === 0) {
			report('structure', `road ${id} has no stretches`);
			return;
		}
		chain.forEach((stretchId, place) => {
			const stretch = stretches[stretchId];
			if (stretch === undefined || stretch.road !== id) {
				report('structure', `road ${id} lists stretch ${stretchId}, which isn't its`);
				return;
			}
			if (place > 0) {
				if (stretch.parent !== chain[place - 1]) report('structure', `road ${id}'s stretch ${stretchId} doesn't follow on from ${chain[place - 1]}`);
				if (classRank(stretch.roadClass) < classRank(stretches[chain[place - 1]].roadClass)) {
					report('structure', `road ${id} upgrades to ${stretch.roadClass} at stretch ${stretchId}`);
				}
			}
		});
		const first = stretches[chain[0]];
		if (first === undefined) return;
		if (road.from !== first.from) report('structure', `road ${id} starts at node ${road.from}, its first stretch at ${first.from}`);
		if (road.roadClass !== first.roadClass) report('structure', `road ${id} is a ${road.roadClass}, its first stretch a ${first.roadClass}`);
		if (road.parent === -1) {
			if (nodes[road.from].kind !== 'compound' || road.roadClass !== 'highway') report('structure', `road ${id} has no parent but isn't a highway from the compound`);
			return;
		}
		const junction = stretches[first.parent];
		if (junction === undefined || junction.road !== road.parent) {
			report('structure', `road ${id} branches from road ${road.parent}, but its first stretch follows on from another`);
			return;
		}
		const allowed = junction.roadClass === 'highway' ? ['highway', 'backRoad'] : junction.roadClass === 'backRoad' ? ['backRoad', 'trail'] : [];
		if (!allowed.includes(road.roadClass)) report('structure', `road ${id}, a ${road.roadClass}, branches from a ${junction.roadClass}`);
	});

	const roots = roads.filter((road) => road.parent === -1).length;
	nodes.forEach((node, id) => {
		const [inward, outward] = [ins[id], outs[id]];
		// A highway blocked as it leaves the metro ends at its metro edge.
		const fits = node.kind === 'compound' ? inward === 0 && outward === roots
			: node.kind === 'metroEdge' ? inward === 1 && outward <= 1
				: node.kind === 'classChange' ? inward === 1 && outward === 1
					: node.kind === 'junction' ? inward === 1 && outward >= 1 && outward <= 2
						: inward === 1 && outward === 0;
		if (!fits) report('structure', `node ${id}, a ${node.kind}, has ${inward} stretches in and ${outward} out`);
	});
}

function checkSegments({ stretches }: RoadNetwork, terrain: RoadCheckOptions['terrain'], report: Report): void {
	const radiusSquared = terrain.radius * terrain.radius;
	stretches.forEach(({ points }, id) => {
		for (let point = 0; point < points.length; point += 2) {
			const x = points[point];
			const y = points[point + 1];
			if (x * x + y * y > radiusSquared) report('disc', `stretch ${id} point ${point / 2} (${x}, ${y}) is outside the disc`);
		}
		for (let point = 0; point + 3 < points.length; point += 2) {
			const [x0, y0, x1, y1] = [points[point], points[point + 1], points[point + 2], points[point + 3]];
			const length = sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
			if (!(sqrt(x1 * x1 + y1 * y1) - sqrt(x0 * x0 + y0 * y0) >= OUTWARD_SHARE * length)) {
				report('outward', `stretch ${id} segment ${point / 2} from (${x0}, ${y0}) to (${x1}, ${y1}) gains too little`);
			}
			if (!isPassable(terrain, x0, y0, x1, y1)) report('passable', `stretch ${id} segment ${point / 2} from (${x0}, ${y0}) to (${x1}, ${y1}) crosses impassable ground`);
		}
	});
}

interface Segment {
	readonly stretch: number;
	readonly road: number;
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
	readonly minX: number;
	readonly maxX: number;
	readonly minY: number;
	readonly maxY: number;
}

/**
 * Every pair of segments within `clearance` of each other against the
 * clearance rule, found through grid buckets of the checker's own: each
 * segment is filed in the cells its box covers, and looks for partners in the
 * cells its box covers grown by the clearance.
 */
function checkPairs(network: RoadNetwork, clearance: number, report: Report): void {
	const segments: Segment[] = [];
	network.stretches.forEach(({ points, road }, stretch) => {
		for (let point = 0; point + 3 < points.length; point += 2) {
			const [x0, y0, x1, y1] = [points[point], points[point + 1], points[point + 2], points[point + 3]];
			segments.push({
				stretch, road, x0, y0, x1, y1,
				minX: min(x0, x1), maxX: max(x0, x1), minY: min(y0, y1), maxY: max(y0, y1),
			});
		}
	});
	const size = max(clearance, 32);
	let left = Infinity;
	let bottom = Infinity;
	let right = -Infinity;
	let top = -Infinity;
	segments.forEach((segment) => {
		left = min(left, segment.minX - clearance);
		bottom = min(bottom, segment.minY - clearance);
		right = max(right, segment.maxX + clearance);
		top = max(top, segment.maxY + clearance);
	});
	if (segments.length === 0) return;
	const columns = floor((right - left) / size) + 1;
	const rows = floor((top - bottom) / size) + 1;
	const cells: number[][] = Array.from({ length: columns * rows }, () => []);
	const columnOf = (x: number) => floor((x - left) / size);
	const rowOf = (y: number) => floor((y - bottom) / size);
	segments.forEach((segment, id) => {
		for (let row = rowOf(segment.minY); row <= rowOf(segment.maxY); row += 1) {
			for (let column = columnOf(segment.minX); column <= columnOf(segment.maxX); column += 1) cells[row * columns + column].push(id);
		}
	});
	const seen = new Int32Array(segments.length).fill(-1);
	segments.forEach((a, first) => {
		for (let row = rowOf(a.minY - clearance); row <= rowOf(a.maxY + clearance); row += 1) {
			for (let column = columnOf(a.minX - clearance); column <= columnOf(a.maxX + clearance); column += 1) {
				for (const second of cells[row * columns + column]) {
					if (second <= first || seen[second] === first) continue;
					seen[second] = first;
					checkPair(network, clearance, a, segments[second], report);
				}
			}
		}
	});
}

/** One pair of segments against the clearance rule. */
function checkPair({ nodes, roads }: RoadNetwork, clearance: number, a: Segment, b: Segment, report: Report): void {
	if (b.minY > a.maxY + clearance || a.minY > b.maxY + clearance || b.minX > a.maxX + clearance || a.minX > b.maxX + clearance) return;
	const distanceSquared = segmentDistanceSquared(a.x0, a.y0, a.x1, a.y1, b.x0, b.y0, b.x1, b.y1);
	if (distanceSquared >= clearance * clearance) return;
	const where = () => `stretches ${a.stretch} and ${b.stretch}, near (${a.x1}, ${a.y1})`;
	const apart = () => sqrt(distanceSquared).toFixed(3);
	const meet = () => segmentsMeet(a.x0, a.y0, a.x1, a.y1, b.x0, b.y0, b.x1, b.y1);
	if (a.road === b.road) {
		const joined = (a.x1 === b.x0 && a.y1 === b.y0) || (b.x1 === a.x0 && b.y1 === a.y0);
		if (!joined && meet()) report('crossing', `road ${a.road} touches itself at ${where()}`);
		return;
	}
	const junction = sharedJunction(roads, a.road, b.road);
	if (junction < 0) {
		report(meet() ? 'crossing' : 'clearance', `roads ${a.road} and ${b.road} are ${apart()} apart at ${where()}`);
		return;
	}
	const { x, y } = nodes[junction];
	const gap = min(clearance, JUNCTION_TAPER * sqrt(max(
		pointSegmentDistanceSquared(x, y, a.x0, a.y0, a.x1, a.y1),
		pointSegmentDistanceSquared(x, y, b.x0, b.y0, b.x1, b.y1),
	)));
	if (gap > 0) {
		if (distanceSquared < gap * gap) {
			report(meet() ? 'crossing' : 'clearance', `roads ${a.road} and ${b.road}, meeting at node ${junction}, are ${apart()} apart at ${where()}, under ${gap.toFixed(3)}`);
		}
		return;
	}
	if (!meetAtAngle(x, y, a, b)) report('crossing', `roads ${a.road} and ${b.road} meet at node ${junction} other than end to end at 20 degrees or more, at ${where()}`);
}

/** The node two roads share: a branch's junction on its parent, or the compound for two highways out of the metro. -1 for none. */
function sharedJunction(roads: RoadNetwork['roads'], a: number, b: number): number {
	if (roads[a].parent === b) return roads[a].from;
	if (roads[b].parent === a) return roads[b].from;
	if (roads[a].parent === -1 && roads[b].parent === -1) return 0;
	return -1;
}

/** Whether two segments both end exactly at (x, y) and leave it at least 20 degrees apart. */
function meetAtAngle(x: number, y: number, a: Segment, b: Segment): boolean {
	const aStarts = a.x0 === x && a.y0 === y;
	const bStarts = b.x0 === x && b.y0 === y;
	if (!aStarts && !(a.x1 === x && a.y1 === y)) return false;
	if (!bStarts && !(b.x1 === x && b.y1 === y)) return false;
	return cosine((aStarts ? a.x1 : a.x0) - x, (aStarts ? a.y1 : a.y0) - y, (bStarts ? b.x1 : b.x0) - x, (bStarts ? b.y1 : b.y0) - y) <= JUNCTION_COS;
}

/**
 * Guarantee 8: at every junction, each branch leaves at least 20 degrees
 * from the direction its parent came in on, carried on through the junction,
 * and from the direction the parent goes on in, where it does. A parent can
 * end at its junction, blocked right after branching, and then its way in is
 * the only parent direction there is.
 */
function checkJunctions({ nodes, stretches }: RoadNetwork, report: Report): void {
	const into: (RoadStretch | undefined)[] = [];
	const from: RoadStretch[][] = nodes.map(() => []);
	stretches.forEach((stretch) => {
		into[stretch.to] = stretch;
		from[stretch.from].push(stretch);
	});
	nodes.forEach((node, id) => {
		if (node.kind !== 'junction') return;
		const inward = into[id];
		if (inward === undefined) return;
		const leaving = from[id];
		const onward = leaving.find((stretch) => stretch.road === inward.road);
		const inPoints = inward.points;
		// The way in, pointing on through the junction.
		const inX = node.x - inPoints[inPoints.length - 4];
		const inY = node.y - inPoints[inPoints.length - 3];
		leaving.filter((stretch) => stretch.road !== inward.road).forEach((branch) => {
			const branchX = branch.points[2] - node.x;
			const branchY = branch.points[3] - node.y;
			const sides: [string, number, number][] = [['way in', inX, inY]];
			if (onward !== undefined) sides.push(['way on', onward.points[2] - node.x, onward.points[3] - node.y]);
			sides.forEach(([side, x, y]) => {
				if (cosine(branchX, branchY, x, y) > JUNCTION_COS) report('junctionAngle', `road ${branch.road} leaves node ${id} within 20 degrees of its parent ${side}`);
			});
		});
	});
}

function cosine(ax: number, ay: number, bx: number, by: number): number {
	return (ax * bx + ay * by) / sqrt((ax * ax + ay * ay) * (bx * bx + by * by));
}
