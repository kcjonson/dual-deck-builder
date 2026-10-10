import { pointSegmentDistanceSquared, segmentDistanceSquared, segmentsMeet } from './Geometry';
import { ROAD_CLASSES, RoadBridge, RoadNetwork, RoadStretch } from './RoadNetwork';
import { MOVE_COST, METRO_BRIDGES, Terrain } from './Terrain';

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;
const min = Math.min;
const max = Math.max;

/**
 * Checks a road network against the guarantees the roads keep (Area Map
 * Generation, Guarantees 3, real roads), from the network's plain data and
 * the land alone, so the map validator can check a loaded map as well as one
 * just generated: planarity and clearance by a sweep over every pair of
 * polylines through grid buckets, passability every half unit along each
 * whole polyline, bridges, the disc, and that every node reaches the
 * compound. The road graph (RoadGraph.ts) holds its geometry to the same
 * rules with the same functions.
 */

export type RoadRule = 'structure' | 'disc' | 'passable' | 'bridges' | 'crossing' | 'clearance' | 'reach';

export interface RoadViolation {
	readonly rule: RoadRule;
	/** What broke and where: stretch and point indices, and coordinates. */
	readonly detail: string;
}

/** World units two stretches keep apart, tapering to nothing toward a node they share. */
export const ROAD_CLEARANCE = 2;
/** Near a node two stretches share, they need only this times the farther one's distance from it, up to the clearance. */
export const NODE_TAPER = 0.25;
/** Two stretches ending on one node leave it at least 20 degrees apart: the cosine. */
export const NODE_COS = 0.9396926207859084;
/** World units between the samples a polyline is checked at for impassable ground. */
export const PASSABLE_SPACING = 0.5;

/** What the checks read of the land. */
export type RoadGround = Pick<Terrain, 'radius' | 'metro' | 'obstacle' | 'bridgeSpans'>;

export interface RoadCheckOptions {
	network: RoadNetwork;
	terrain: RoadGround;
	/** Stops after this many violations. */
	limit?: number;
}

/**
 * Every rule the network breaks, up to `limit`:
 *
 * - structure: node 0 is the compound at the origin; each stretch runs
 *   between two different nodes, from the one to the other, with its class,
 *   its length, and its bridges in order along it.
 * - disc: every point is inside the disc.
 * - passable: no sample every half unit along a polyline is impassable, bar
 *   river water under one of the stretch's bridges.
 * - bridges: a stretch's bridges are where its polyline crosses rivers outside
 *   the metro, each no longer than the longest bridge.
 * - crossing and clearance: two stretches meet only at a node they both end
 *   on, leaving it 20 degrees apart or more, and otherwise keep
 *   `ROAD_CLEARANCE` apart, less near a node they share; a stretch never
 *   touches itself.
 * - reach: every node reaches the compound.
 */
export function checkRoadNetwork({ network, terrain, limit = 20 }: RoadCheckOptions): RoadViolation[] {
	const violations: RoadViolation[] = [];
	const report = (rule: RoadRule, detail: string) => {
		if (violations.length < limit) violations.push({ rule, detail });
	};
	checkStructure(network, report);
	if (violations.length > 0) return violations;
	checkGround(network, terrain, report);
	checkPairs(network, report);
	checkReach(network, report);
	return violations;
}

type Report = (rule: RoadRule, detail: string) => void;

function checkStructure({ nodes, stretches, broken }: RoadNetwork, report: Report): void {
	if (nodes.length === 0 || nodes[0].kind !== 'compound' || nodes[0].x !== 0 || nodes[0].y !== 0) {
		report('structure', 'node 0 is not the compound at the origin');
		return;
	}
	nodes.forEach((node, id) => {
		if (id > 0 && node.kind === 'compound') report('structure', `node ${id} is a second compound`);
	});
	[...stretches, ...broken].forEach((stretch, index) => {
		const id = index < stretches.length ? `stretch ${index}` : `broken span ${index - stretches.length}`;
		const { from, to, points, bridges } = stretch;
		if (!(from >= 0 && from < nodes.length && to >= 0 && to < nodes.length && from !== to)) {
			report('structure', `${id} runs between nodes ${from} and ${to}`);
			return;
		}
		if (!ROAD_CLASSES.includes(stretch.roadClass)) report('structure', `${id} has class ${stretch.roadClass}`);
		if (points.length < 4 || points.length % 2 !== 0 || points.some((value) => !Number.isFinite(value))) {
			report('structure', `${id} has ${points.length} coordinates`);
			return;
		}
		if (points[0] !== nodes[from].x || points[1] !== nodes[from].y) report('structure', `${id} doesn't start at node ${from}`);
		if (points[points.length - 2] !== nodes[to].x || points[points.length - 1] !== nodes[to].y) report('structure', `${id} doesn't end at node ${to}`);
		const length = polylineLength(points);
		if (!(Math.abs(length - stretch.length) <= 1e-9 * length + 1e-9)) report('structure', `${id} is ${length} long, not the ${stretch.length} it says`);
		let last = 0;
		bridges.forEach(({ start, end }, bridge) => {
			if (!(start >= last && end > start && end <= length)) report('structure', `${id}'s bridge ${bridge} runs from ${start} to ${end}, out of order or off its ${length} units`);
			last = end;
		});
	});
}

function checkGround({ stretches }: RoadNetwork, terrain: RoadGround, report: Report): void {
	const radiusSquared = terrain.radius * terrain.radius;
	const bridged = terrain.metro.radius + METRO_BRIDGES;
	const bridgedSquared = bridged * bridged;
	stretches.forEach(({ points, bridges }, id) => {
		for (let point = 0; point < points.length; point += 2) {
			const x = points[point];
			const y = points[point + 1];
			if (x * x + y * y > radiusSquared) report('disc', `stretch ${id} point ${point / 2} (${x}, ${y}) is outside the disc`);
		}
		const found = polylineBridges(terrain, points);
		const longest = MOVE_COST.longestBridge + 2 * MOVE_COST.bridgeSlack;
		if (found.length !== bridges.length || found.some((bridge, index) => !(Math.abs(bridge.start - bridges[index].start) <= 1e-6 && Math.abs(bridge.end - bridges[index].end) <= 1e-6))) {
			report('bridges', `stretch ${id} records ${bridges.length} bridges, but its polyline crosses rivers at ${found.length}`);
		}
		bridges.forEach(({ start, end }, bridge) => {
			const { x, y } = pointAlong(points, 0.5 * (start + end));
			if (x * x + y * y > bridgedSquared && !(end - start <= longest + 1e-9)) report('bridges', `stretch ${id}'s bridge ${bridge} runs ${end - start} units, past the longest`);
		});
		const blocked = impassableAlong(terrain, points, bridges);
		if (blocked >= 0) report('passable', `stretch ${id} is impassable ${blocked.toFixed(2)} units along, at ${describePoint(points, blocked)}`);
	});
}

function checkReach({ nodes, stretches }: RoadNetwork, report: Report): void {
	const linked: number[][] = nodes.map(() => []);
	stretches.forEach(({ from, to }) => {
		linked[from].push(to);
		linked[to].push(from);
	});
	const reached = new Uint8Array(nodes.length);
	reached[0] = 1;
	const stack = [0];
	while (stack.length > 0) {
		for (const next of linked[stack.pop() as number]) {
			if (reached[next] === 1) continue;
			reached[next] = 1;
			stack.push(next);
		}
	}
	reached.forEach((value, id) => {
		if (value === 0) report('reach', `node ${id}, a ${nodes[id].kind} at (${nodes[id].x}, ${nodes[id].y}), doesn't reach the compound`);
	});
}

/** World units along a flat polyline. */
export function polylineLength(points: readonly number[]): number {
	let length = 0;
	for (let point = 0; point + 3 < points.length; point += 2) {
		const dx = points[point + 2] - points[point];
		const dy = points[point + 3] - points[point + 1];
		length += sqrt(dx * dx + dy * dy);
	}
	return length;
}

const spans: number[] = [];

/**
 * A polyline's bridges, over the whole line rather than a segment at a time:
 * each river it crosses with a bridge no longer than the longest, or any
 * bridge in the metro, its deck reaching the bridge's span either side of the
 * crossing and a little past, as world units along the line from its first
 * point. Decks that meet or overlap are one bridge.
 */
export function polylineBridges(terrain: Pick<RoadGround, 'bridgeSpans'>, points: readonly number[]): RoadBridge[] {
	const decks: { start: number; end: number }[] = [];
	let along = 0;
	for (let point = 0; point + 3 < points.length; point += 2) {
		const x0 = points[point];
		const y0 = points[point + 1];
		const x1 = points[point + 2];
		const y1 = points[point + 3];
		const length = sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
		const count = terrain.bridgeSpans(x0, y0, x1, y1, spans);
		for (let span = 0; span < count; span += 1) decks.push({ start: along + spans[2 * span] * length, end: along + spans[2 * span + 1] * length });
		along += length;
	}
	decks.sort((a, b) => a.start - b.start);
	const merged: RoadBridge[] = [];
	for (const deck of decks) {
		const start = deck.start < 0 ? 0 : deck.start;
		const end = deck.end > along ? along : deck.end;
		const last = merged[merged.length - 1];
		if (last !== undefined && start <= last.end) merged[merged.length - 1] = { start: last.start, end: end > last.end ? end : last.end };
		else merged.push({ start, end });
	}
	return merged;
}

/**
 * The first point along a polyline, as world units from its start, where a
 * sample every half unit lands on impassable ground, bar river water under
 * one of `bridges`; -1 where none does. Every segment's ends are sampled.
 */
export function impassableAlong(terrain: Pick<RoadGround, 'obstacle'>, points: readonly number[], bridges: readonly RoadBridge[]): number {
	let along = 0;
	for (let point = 0; point + 3 < points.length; point += 2) {
		const x0 = points[point];
		const y0 = points[point + 1];
		const dx = points[point + 2] - x0;
		const dy = points[point + 3] - y0;
		const length = sqrt(dx * dx + dy * dy);
		const samples = floor(length / PASSABLE_SPACING) + 1;
		for (let sample = point === 0 ? 0 : 1; sample <= samples; sample += 1) {
			const share = sample / samples;
			const obstacle = terrain.obstacle(x0 + dx * share, y0 + dy * share);
			if (obstacle === null) continue;
			const at = along + length * share;
			if (obstacle === 'river' && bridges.some(({ start, end }) => at >= start && at <= end)) continue;
			return at;
		}
		along += length;
	}
	return -1;
}

function describePoint(points: readonly number[], along: number): string {
	const { x, y } = pointAlong(points, along);
	return `(${x.toFixed(2)}, ${y.toFixed(2)})`;
}

/** The point `along` world units along a flat polyline from its start, held to its ends. */
export function pointAlong(points: readonly number[], along: number): { x: number; y: number } {
	let walked = 0;
	for (let point = 0; point + 3 < points.length; point += 2) {
		const dx = points[point + 2] - points[point];
		const dy = points[point + 3] - points[point + 1];
		const length = sqrt(dx * dx + dy * dy);
		if (walked + length >= along) {
			const share = length > 0 && along > walked ? (along - walked) / length : 0;
			return { x: points[point] + dx * share, y: points[point + 1] + dy * share };
		}
		walked += length;
	}
	return { x: points[points.length - 2], y: points[points.length - 1] };
}

interface Segment {
	readonly stretch: number;
	/** Its index along its stretch. */
	readonly index: number;
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
	readonly minX: number;
	readonly maxX: number;
	readonly minY: number;
	readonly maxY: number;
}

/** A pair of stretches the planarity sweep found breaking a rule. */
export interface RoadClash {
	readonly rule: 'crossing' | 'clearance';
	readonly a: number;
	readonly b: number;
	readonly detail: string;
}

function checkPairs(network: RoadNetwork, report: Report): void {
	for (const { rule, detail } of roadClashes(network)) report(rule, detail);
}

/**
 * Every pair of segments within `ROAD_CLEARANCE` of each other, found through
 * grid buckets, against the rules: segments of one stretch touch only where
 * they join; two stretches meet only at a node both end on, leaving it 20
 * degrees apart or more, and otherwise keep the clearance, tapering to
 * nothing toward a node they share.
 */
export function roadClashes({ nodes, stretches }: { nodes: RoadNetwork['nodes']; stretches: readonly Pick<RoadStretch, 'from' | 'to' | 'points'>[] }): RoadClash[] {
	const clearance = ROAD_CLEARANCE;
	const segments: Segment[] = [];
	stretches.forEach(({ points }, stretch) => {
		for (let point = 0; point + 3 < points.length; point += 2) {
			const [x0, y0, x1, y1] = [points[point], points[point + 1], points[point + 2], points[point + 3]];
			segments.push({ stretch, index: point / 2, x0, y0, x1, y1, minX: min(x0, x1), maxX: max(x0, x1), minY: min(y0, y1), maxY: max(y0, y1) });
		}
	});
	const clashes: RoadClash[] = [];
	if (segments.length === 0) return clashes;
	const size = 16;
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
	const columns = floor((right - left) / size) + 1;
	const rows = floor((top - bottom) / size) + 1;
	const starts = new Int32Array(columns * rows + 1);
	const columnOf = (x: number) => floor((x - left) / size);
	const rowOf = (y: number) => floor((y - bottom) / size);
	const eachCell = (segment: Segment, grow: number, visit: (cell: number) => void) => {
		for (let row = rowOf(segment.minY - grow); row <= rowOf(segment.maxY + grow); row += 1) {
			for (let column = columnOf(segment.minX - grow); column <= columnOf(segment.maxX + grow); column += 1) visit(row * columns + column);
		}
	};
	segments.forEach((segment) => eachCell(segment, 0, (cell) => {
		starts[cell + 1] += 1;
	}));
	for (let cell = 0; cell < columns * rows; cell += 1) starts[cell + 1] += starts[cell];
	const filled = starts.slice(0, columns * rows);
	const filed = new Int32Array(starts[columns * rows]);
	segments.forEach((segment, id) => eachCell(segment, 0, (cell) => {
		filed[filled[cell]] = id;
		filled[cell] += 1;
	}));
	const seen = new Int32Array(segments.length).fill(-1);
	const reported = new Set<string>();
	segments.forEach((a, first) => {
		eachCell(a, clearance, (cell) => {
			for (let entry = starts[cell]; entry < starts[cell + 1]; entry += 1) {
				const second = filed[entry];
				if (second <= first || seen[second] === first) continue;
				seen[second] = first;
				const clash = checkPair(nodes, stretches, a, segments[second]);
				if (clash === null) continue;
				const key = `${clash.a} ${clash.b} ${clash.rule}`;
				if (reported.has(key)) continue;
				reported.add(key);
				clashes.push(clash);
			}
		});
	});
	return clashes;
}

/** One pair of segments against the rules, or null where they keep them. */
function checkPair(nodes: RoadNetwork['nodes'], stretches: readonly Pick<RoadStretch, 'from' | 'to' | 'points'>[], a: Segment, b: Segment): RoadClash | null {
	const clearance = ROAD_CLEARANCE;
	if (b.minY > a.maxY + clearance || a.minY > b.maxY + clearance || b.minX > a.maxX + clearance || a.minX > b.maxX + clearance) return null;
	const distanceSquared = segmentDistanceSquared(a.x0, a.y0, a.x1, a.y1, b.x0, b.y0, b.x1, b.y1);
	if (distanceSquared >= clearance * clearance) return null;
	const where = `stretches ${a.stretch} and ${b.stretch}, segments ${a.index} and ${b.index}, near (${a.x1.toFixed(2)}, ${a.y1.toFixed(2)})`;
	const meet = () => segmentsMeet(a.x0, a.y0, a.x1, a.y1, b.x0, b.y0, b.x1, b.y1);
	if (a.stretch === b.stretch) {
		if (a.index + 1 === b.index || b.index + 1 === a.index) return null;
		const { from, to } = stretches[a.stretch];
		// A loop's two ends meet at its node.
		if (from === to && ((a.index === 0 && b.x1 === a.x0 && b.y1 === a.y0) || (b.index === 0 && a.x1 === b.x0 && a.y1 === b.y0))) return null;
		return meet() ? { rule: 'crossing', a: a.stretch, b: b.stretch, detail: `a stretch touches itself at ${where}` } : null;
	}
	const first = stretches[a.stretch];
	const second = stretches[b.stretch];
	const shared = [first.from, first.to].filter((node) => node === second.from || node === second.to);
	const apart = sqrt(distanceSquared).toFixed(3);
	if (shared.length === 0) {
		return { rule: meet() ? 'crossing' : 'clearance', a: a.stretch, b: b.stretch, detail: `${apart} apart at ${where}` };
	}
	let gap = clearance;
	let at = shared[0];
	for (const node of shared) {
		const { x, y } = nodes[node];
		const reach = min(clearance, NODE_TAPER * sqrt(max(
			pointSegmentDistanceSquared(x, y, a.x0, a.y0, a.x1, a.y1),
			pointSegmentDistanceSquared(x, y, b.x0, b.y0, b.x1, b.y1),
		)));
		if (reach < gap) {
			gap = reach;
			at = node;
		}
	}
	if (gap > 0) {
		if (distanceSquared < gap * gap) return { rule: meet() ? 'crossing' : 'clearance', a: a.stretch, b: b.stretch, detail: `${apart} apart, under ${gap.toFixed(3)} near node ${at}, at ${where}` };
		return null;
	}
	const { x, y } = nodes[at];
	return meetAtAngle(x, y, a, b) ? null : { rule: 'crossing', a: a.stretch, b: b.stretch, detail: `meet at node ${at} other than end to end 20 degrees apart, at ${where}` };
}

/** Whether two segments both end exactly at (x, y) and leave it at least 20 degrees apart. */
function meetAtAngle(x: number, y: number, a: Segment, b: Segment): boolean {
	const aStarts = a.x0 === x && a.y0 === y;
	const bStarts = b.x0 === x && b.y0 === y;
	if (!aStarts && !(a.x1 === x && a.y1 === y)) return false;
	if (!bStarts && !(b.x1 === x && b.y1 === y)) return false;
	const ax = (aStarts ? a.x1 : a.x0) - x;
	const ay = (aStarts ? a.y1 : a.y0) - y;
	const bx = (bStarts ? b.x1 : b.x0) - x;
	const by = (bStarts ? b.y1 : b.y0) - y;
	return (ax * bx + ay * by) / sqrt((ax * ax + ay * ay) * (bx * bx + by * by)) <= NODE_COS;
}
