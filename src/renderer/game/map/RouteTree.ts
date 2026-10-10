import { polylineLength } from './Geometry';
import type { RoadClass, RoadNetwork } from './RoadNetwork';

/**
 * Stage 6 of area map generation, the route tree (Area Map Generation, 6. The
 * route tree, and 7's meeting points): every place's way home, its quickest
 * route to the compound over the road network, and the meeting points where
 * two or three ways home end. Once POIs are placed, `buildLegs` prunes the
 * tree to what their routes use and cuts it into legs, and `routesTo` lists a
 * POI's routes as legs from the compound.
 *
 * The tree takes no draws and reads only the road network, so POIs never move
 * it. Stretches are undirected here: a way home drives a stretch whichever way
 * its points run. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/route-tree-and-pois.md.
 */

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;

/** World units an hour by class at `travelPace` 1 (realistic-map.md, provisional call 6). */
export const ROAD_CLASS_SPEEDS: { readonly [Name in RoadClass]: number } = {
	highway: 260,
	backRoad: 160,
	trail: 90,
};

/** Hours to drive `length` world units of a class at `travelPace`, which multiplies hours per unit for every class. */
export function hoursFor(length: number, roadClass: RoadClass, travelPace: number): number {
	return length / ROAD_CLASS_SPEEDS[roadClass] * travelPace;
}

/**
 * Where two or three ways home end, so a POI can go: a stretch no way home
 * uses whose two ends' ways home split early enough, or a leaf place with
 * exactly three roads whose three ways home split pairwise early enough.
 */
export interface MeetingPoint {
	/** The stretch, for a meeting point on one; -1 for a three-way point. */
	readonly stretch: number;
	/** The leaf place, for a three-way point; -1 for one on a stretch. */
	readonly node: number;
	/** The nodes its routes arrive from: the stretch's `from` and `to`, or the leaf's three neighbours by stretch id. */
	readonly from: readonly number[];
	/** The stretch each arrives on, in the same order: the stretch itself twice, or the leaf's three. */
	readonly via: readonly number[];
}

/** The route tree as plain data, which crosses the worker boundary by structured clone. */
export interface RouteTree {
	/** Per node, the stretch its way home leaves on; -1 for the compound and for a node the roads don't reach. */
	readonly parentStretch: Int32Array;
	/** Per node, the next node on its way home; -1 likewise. */
	readonly parentNode: Int32Array;
	/** Per node, stretches on its way home: 0 for the compound, -1 unreached. */
	readonly depth: Int32Array;
	/** Per node, hours home along its way home at the map's travel pace; Infinity unreached. */
	readonly hours: Float64Array;
	/** Per stretch, its length in world units... */
	readonly lengths: Float64Array;
	/** ...and the hours to drive it. */
	readonly stretchHours: Float64Array;
	/** Meeting points on stretches by stretch id, then three-way points by node id. */
	readonly meetingPoints: readonly MeetingPoint[];
}

export interface RouteTreeOptions {
	readonly network: RoadNetwork;
	readonly travelPace: number;
	/** How far along the shorter of two ways home they may still share road, as a share of its hours. */
	readonly routeSplit: number;
}

/**
 * Every node's way home by Dijkstra over the stretches at their classes'
 * speeds, from the compound, node 0. Ties go to the lower stretch id, so the
 * tree doesn't hang on the heap's order. Hours are found at travel pace 1 and
 * scaled after, so the pace can't tip a tie either.
 */
export function buildRouteTree({ network, travelPace, routeSplit }: RouteTreeOptions): RouteTree {
	const { nodes, stretches } = network;
	const nodeCount = nodes.length;
	const lengths = new Float64Array(stretches.length);
	const baseHours = new Float64Array(stretches.length);
	stretches.forEach(({ points, roadClass }, id) => {
		lengths[id] = polylineLength(points);
		baseHours[id] = hoursFor(lengths[id], roadClass, 1);
	});
	const incidence = incidenceOf(network);
	const parentStretch = new Int32Array(nodeCount).fill(-1);
	const parentNode = new Int32Array(nodeCount).fill(-1);
	const depth = new Int32Array(nodeCount).fill(-1);
	const base = new Float64Array(nodeCount).fill(Infinity);
	const settled = new Uint8Array(nodeCount);
	const heap = new NodeHeap(2 * stretches.length + 1);
	if (nodeCount > 0) {
		base[0] = 0;
		heap.push(0, 0);
	}
	while (heap.size > 0) {
		const node = heap.pop();
		if (settled[node] === 1) continue;
		settled[node] = 1;
		depth[node] = node === 0 ? 0 : depth[parentNode[node]] + 1;
		for (let entry = incidence.start[node]; entry < incidence.start[node + 1]; entry += 1) {
			const stretch = incidence.stretch[entry];
			const other = incidence.other[entry];
			if (settled[other] === 1) continue;
			const reach = base[node] + baseHours[stretch];
			if (reach < base[other] || (reach === base[other] && stretch < parentStretch[other])) {
				if (reach < base[other]) heap.push(other, reach);
				base[other] = reach;
				parentStretch[other] = stretch;
				parentNode[other] = node;
			}
		}
	}
	const hours = new Float64Array(nodeCount);
	for (let node = 0; node < nodeCount; node += 1) hours[node] = base[node] * travelPace;
	const stretchHours = new Float64Array(stretches.length);
	for (let stretch = 0; stretch < stretches.length; stretch += 1) stretchHours[stretch] = baseHours[stretch] * travelPace;
	const tree: Omit<RouteTree, 'meetingPoints'> = { parentStretch, parentNode, depth, hours, lengths, stretchHours };
	return { ...tree, meetingPoints: findMeetingPoints({ network, tree, incidence, routeSplit }) };
}

/** The node where the ways home of `a` and `b` part: the last they share. -1 when either is unreached. */
export function splitNode({ parentNode, depth }: Pick<RouteTree, 'parentNode' | 'depth'>, a: number, b: number): number {
	if (depth[a] < 0 || depth[b] < 0) return -1;
	let first = a;
	let second = b;
	while (depth[first] > depth[second]) first = parentNode[first];
	while (depth[second] > depth[first]) second = parentNode[second];
	while (first !== second) {
		first = parentNode[first];
		second = parentNode[second];
	}
	return first;
}

/**
 * Whether the ways home of `a` and `b` split no later than `routeSplit` of
 * the shorter one's hours (guarantee 5). One that runs through the other
 * splits where the other is, which passes only at the compound.
 */
export function splitsInTime(tree: Pick<RouteTree, 'parentNode' | 'depth' | 'hours'>, a: number, b: number, routeSplit: number): boolean {
	const split = splitNode(tree, a, b);
	if (split < 0) return false;
	const { hours } = tree;
	const shorter = hours[a] < hours[b] ? hours[a] : hours[b];
	return hours[split] <= routeSplit * shorter;
}

/** Each node's stretches, CSR style, by stretch id; a stretch from a node to itself is left out, since it's no road anywhere. */
interface Incidence {
	readonly start: Int32Array;
	readonly stretch: Int32Array;
	readonly other: Int32Array;
}

function incidenceOf({ nodes, stretches }: RoadNetwork): Incidence {
	const start = new Int32Array(nodes.length + 1);
	stretches.forEach(({ from, to }) => {
		if (from === to) return;
		start[from + 1] += 1;
		start[to + 1] += 1;
	});
	for (let node = 0; node < nodes.length; node += 1) start[node + 1] += start[node];
	const fill = start.slice(0, nodes.length);
	const stretch = new Int32Array(start[nodes.length]);
	const other = new Int32Array(start[nodes.length]);
	stretches.forEach(({ from, to }, id) => {
		if (from === to) return;
		stretch[fill[from]] = id;
		other[fill[from]] = to;
		fill[from] += 1;
		stretch[fill[to]] = id;
		other[fill[to]] = from;
		fill[to] += 1;
	});
	return { start, stretch, other };
}

function findMeetingPoints({ network, tree, incidence, routeSplit }: {
	network: RoadNetwork;
	tree: Omit<RouteTree, 'meetingPoints'>;
	incidence: Incidence;
	routeSplit: number;
}): MeetingPoint[] {
	const { nodes, stretches } = network;
	const { parentStretch, parentNode, depth } = tree;
	const onWayHome = new Uint8Array(stretches.length);
	const children = new Int32Array(nodes.length);
	for (let node = 0; node < nodes.length; node += 1) {
		if (parentStretch[node] < 0) continue;
		onWayHome[parentStretch[node]] = 1;
		children[parentNode[node]] += 1;
	}
	const points: MeetingPoint[] = [];
	stretches.forEach(({ from, to }, id) => {
		if (from === to || onWayHome[id] === 1) return;
		if (splitsInTime(tree, from, to, routeSplit)) points.push({ stretch: id, node: -1, from: [from, to], via: [id, id] });
	});
	for (let node = 1; node < nodes.length; node += 1) {
		if (depth[node] < 0 || children[node] > 0) continue;
		if (incidence.start[node + 1] - incidence.start[node] !== 3) continue;
		const first = incidence.start[node];
		const from = [incidence.other[first], incidence.other[first + 1], incidence.other[first + 2]];
		// Two roads from one neighbour would give two routes the same way home.
		if (from[0] === from[1] || from[0] === from[2] || from[1] === from[2]) continue;
		if (splitsInTime(tree, from[0], from[1], routeSplit) && splitsInTime(tree, from[0], from[2], routeSplit) && splitsInTime(tree, from[1], from[2], routeSplit)) {
			points.push({ stretch: -1, node, from, via: [incidence.stretch[first], incidence.stretch[first + 1], incidence.stretch[first + 2]] });
		}
	}
	return points;
}

/** A route into a POI: the way home of the node it arrives from, driven outward, then the road in. */
export interface Arrival {
	/** The node it arrives from. */
	readonly from: number;
	/** The stretch it drives into the POI... */
	readonly stretch: number;
	/** ...and how far along it from `from`: the whole stretch into a three-way POI, part of it into one partway along. */
	readonly length: number;
	/** Hours from the compound to the POI along it. */
	readonly hours: number;
	/** Its last leg, the one ending at the POI. */
	readonly leg: number;
}

/** A piece of road a leg drives, outward. */
export interface LegPiece {
	readonly stretch: number;
	/** Driven the way its points run, `from` to `to`, or against them. */
	readonly forward: boolean;
	/** World units driven from the end it enters at: the stretch's length, or less into a POI partway along it. */
	readonly length: number;
}

/**
 * A piece of the route tree between places where something happens to
 * routes: the compound, a place where routes split, or a POI. The unit
 * stops, knowledge, and hours work in. Driven one way only, outward.
 */
export interface Leg {
	/** The leg it carries on from, toward the compound; -1 for one leaving the compound. Parents come before their children. */
	readonly parent: number;
	/** The node it starts at: the compound or a place where routes split. */
	readonly from: number;
	/** The node it ends at: a place where routes split, a three-way POI's node, or -1 for a POI partway along a stretch. */
	readonly to: number;
	/** The POI it ends at, an index into the POIs it was built for; -1 when it ends where routes split. */
	readonly poi: number;
	readonly pieces: readonly LegPiece[];
	readonly length: number;
	readonly hours: number;
}

/** Where routes go, as `buildLegs` reads it: each POI's arrivals, without their legs. */
export interface Destination {
	readonly arrivals: readonly Omit<Arrival, 'leg'>[];
}

/**
 * The route tree pruned to what the POIs' routes use, cut into legs, and the
 * last leg of each arrival, by POI and arrival. Legs come out parents first,
 * from the compound, each place's branches in order: the tree on toward
 * higher node ids, then the arrivals leaving it by POI and arrival.
 */
export function buildLegs({ network, tree, destinations }: {
	network: RoadNetwork;
	tree: RouteTree;
	destinations: readonly Destination[];
}): { legs: Leg[]; lastLegs: number[][] } {
	const { stretches } = network;
	const { parentNode, parentStretch, lengths, stretchHours } = tree;
	const nodeCount = parentNode.length;
	const used = new Uint8Array(nodeCount);
	const leaving: { poi: number; arrival: number }[][] = Array.from({ length: nodeCount }, () => []);
	destinations.forEach(({ arrivals }, poi) => {
		arrivals.forEach(({ from }, arrival) => {
			leaving[from].push({ poi, arrival });
			for (let node = from; node >= 0 && used[node] === 0; node = parentNode[node]) used[node] = 1;
		});
	});
	const branches: number[][] = Array.from({ length: nodeCount }, () => []);
	for (let node = 1; node < nodeCount; node += 1) if (used[node] === 1 && parentNode[node] >= 0) branches[parentNode[node]].push(node);
	const outgoing = (node: number) => branches[node].length + leaving[node].length;

	const legs: Leg[] = [];
	const lastLegs: number[][] = destinations.map(({ arrivals }) => arrivals.map(() => -1));
	const pieceInto = (poi: number, arrival: number): { piece: LegPiece; hours: number; to: number } => {
		const { stretch, from, length } = destinations[poi].arrivals[arrival];
		const { from: start, to: end } = stretches[stretch];
		const forward = start === from;
		const whole = length >= lengths[stretch];
		return {
			piece: { stretch, forward, length },
			hours: whole ? stretchHours[stretch] : stretchHours[stretch] * (length / lengths[stretch]),
			// A three-way POI sits on the node the stretch runs to; one partway along has none.
			to: whole ? (forward ? end : start) : -1,
		};
	};
	// Each queued branch: the leg it carries on from, the node it leaves, and either the tree onward to a node or an arrival.
	const queue: { parent: number; node: number; next: number; poi: number; arrival: number }[] = [];
	const enqueue = (parent: number, node: number) => {
		for (const next of branches[node]) queue.push({ parent, node, next, poi: -1, arrival: -1 });
		for (const { poi, arrival } of leaving[node]) queue.push({ parent, node, next: -1, poi, arrival });
	};
	if (nodeCount > 0) enqueue(-1, 0);
	for (let head = 0; head < queue.length; head += 1) {
		const { parent, node, poi, arrival } = queue[head];
		let { next } = queue[head];
		const pieces: LegPiece[] = [];
		let length = 0;
		let hours = 0;
		let at = node;
		let endPoi = poi;
		let endArrival = arrival;
		while (next >= 0) {
			const stretch = parentStretch[next];
			pieces.push({ stretch, forward: stretches[stretch].from === at, length: lengths[stretch] });
			length += lengths[stretch];
			hours += stretchHours[stretch];
			at = next;
			next = -1;
			if (outgoing(at) === 1) {
				if (branches[at].length === 1) next = branches[at][0];
				else ({ poi: endPoi, arrival: endArrival } = leaving[at][0]);
			}
		}
		const id = legs.length;
		if (endPoi < 0) {
			legs.push({ parent, from: node, to: at, poi: -1, pieces, length, hours });
			enqueue(id, at);
			continue;
		}
		const into = pieceInto(endPoi, endArrival);
		pieces.push(into.piece);
		legs.push({ parent, from: node, to: into.to, poi: endPoi, pieces, length: length + into.piece.length, hours: hours + into.hours });
		lastLegs[endPoi][endArrival] = id;
	}
	return { legs, lastLegs };
}

/** One route to a POI: its legs from the compound out, and their totals. */
export interface Route {
	/** Leg ids, the compound's first, the one into the POI last. */
	readonly legs: readonly number[];
	readonly length: number;
	readonly hours: number;
}

/**
 * Each of a POI's routes as its legs from the compound, in its arrivals'
 * order, quickest first: walk parent legs from each arrival's last leg.
 */
export function routesTo({ legs }: { readonly legs: readonly Leg[] }, { arrivals }: { readonly arrivals: readonly Arrival[] }): Route[] {
	return arrivals.map(({ leg }) => {
		const chain: number[] = [];
		let length = 0;
		let hours = 0;
		for (let at = leg; at >= 0; at = legs[at].parent) {
			chain.push(at);
			length += legs[at].length;
			hours += legs[at].hours;
		}
		return { legs: chain.reverse(), length, hours };
	});
}

/** A leg's road as one polyline, flat x0, y0, x1, y1, ..., outward from its first node. */
export function legPoints(network: RoadNetwork, { pieces }: Pick<Leg, 'pieces'>): number[] {
	const line: number[] = [];
	for (const { stretch, forward, length } of pieces) {
		const points = forward ? network.stretches[stretch].points : reversed(network.stretches[stretch].points);
		const piece = cutAt(points, length);
		for (let index = line.length === 0 ? 0 : 2; index < piece.length; index += 1) line.push(piece[index]);
	}
	return line;
}

/** A polyline up to `distance` along it, ending on the point there; the whole of it at or past its length. */
function cutAt(points: readonly number[], distance: number): number[] {
	const cut: number[] = [points[0], points[1]];
	let travelled = 0;
	for (let index = 0; index + 3 < points.length; index += 2) {
		const dx = points[index + 2] - points[index];
		const dy = points[index + 3] - points[index + 1];
		const segment = sqrt(dx * dx + dy * dy);
		if (travelled + segment >= distance) {
			if (travelled + segment === distance || segment === 0) cut.push(points[index + 2], points[index + 3]);
			else cut.push(points[index] + dx * (distance - travelled) / segment, points[index + 1] + dy * (distance - travelled) / segment);
			return cut;
		}
		travelled += segment;
		cut.push(points[index + 2], points[index + 3]);
	}
	return cut;
}

function reversed(points: readonly number[]): number[] {
	const out: number[] = [];
	for (let index = points.length - 2; index >= 0; index -= 2) out.push(points[index], points[index + 1]);
	return out;
}

/** A binary min-heap of nodes keyed by hours, ties to the lower node, in typed arrays sized for every push a run makes. */
class NodeHeap {
	private readonly keys: Float64Array;
	private readonly nodes: Int32Array;
	private count = 0;

	constructor(capacity: number) {
		this.keys = new Float64Array(capacity);
		this.nodes = new Int32Array(capacity);
	}

	public get size(): number {
		return this.count;
	}

	public push(node: number, key: number): void {
		let at = this.count;
		this.count += 1;
		while (at > 0) {
			const up = (at - 1) >> 1;
			if (!this.before(key, node, this.keys[up], this.nodes[up])) break;
			this.keys[at] = this.keys[up];
			this.nodes[at] = this.nodes[up];
			at = up;
		}
		this.keys[at] = key;
		this.nodes[at] = node;
	}

	public pop(): number {
		const top = this.nodes[0];
		this.count -= 1;
		const key = this.keys[this.count];
		const node = this.nodes[this.count];
		let at = 0;
		for (;;) {
			let child = 2 * at + 1;
			if (child >= this.count) break;
			if (child + 1 < this.count && this.before(this.keys[child + 1], this.nodes[child + 1], this.keys[child], this.nodes[child])) child += 1;
			if (!this.before(this.keys[child], this.nodes[child], key, node)) break;
			this.keys[at] = this.keys[child];
			this.nodes[at] = this.nodes[child];
			at = child;
		}
		this.keys[at] = key;
		this.nodes[at] = node;
		return top;
	}

	private before(key: number, node: number, otherKey: number, otherNode: number): boolean {
		return key < otherKey || (key === otherKey && node < otherNode);
	}
}
