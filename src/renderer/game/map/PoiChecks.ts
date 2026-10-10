import type { MapParams } from './MapParams';
import { POI_TUNING, PoiTuning, STRONGHOLD_TYPE } from './PoiData';
import { PoiLayer, Sectors } from './Pois';
import type { RoadNetwork } from './RoadNetwork';
import { RouteTree, routesTo, splitsInTime } from './RouteTree';

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;

/**
 * Checks the route tree and the POIs over a road network against the
 * guarantees they keep (Area Map Generation, Guarantees 2, 4, 5, 6, and 8),
 * from the map's data alone, so a loaded map checks the way a fresh one does.
 * Placement keeps every rule as it goes; this looks again from the other
 * side, walking every route, which is what the tests and the map validator
 * lean on.
 */

export type PoiRule = 'tree' | 'destination' | 'choice' | 'legs' | 'spacing' | 'sectors';

export interface PoiViolation {
	readonly rule: PoiRule;
	readonly detail: string;
}

export interface PoiCheckOptions {
	readonly network: RoadNetwork;
	readonly tree: RouteTree;
	readonly layer: PoiLayer;
	readonly params: Pick<MapParams, 'strongholds' | 'routeSplit'>;
	readonly radius: number;
	readonly tuning?: PoiTuning;
	/** Stops after this many. */
	readonly limit?: number;
}

/**
 * Every rule broken, up to `limit`:
 *
 * - tree: every node's way home steps to a node one stretch nearer home,
 *   along a stretch that joins the two, and ends at the compound, so the ways
 *   home are a tree (guarantee 2).
 * - destination: a POI partway along a stretch sits inside it, on a stretch
 *   no way home uses and no other POI is on, and arrives from both its ends;
 *   one at a node sits on a leaf whose every road is one of its arrivals; and
 *   no route passes through any POI (guarantee 4).
 * - choice: two or three arrivals, from different nodes, whose ways home
 *   split pairwise by `routeSplit` of the shorter one's hours (guarantee 5).
 * - legs: each route's legs run from the compound, each on from the last,
 *   piece after piece, and end at the POI.
 * - spacing: POIs keep the sites' spacing, and strongholds theirs (guarantee 8).
 * - sectors: one stronghold in each sector of the saved rotation, in the
 *   outer band (guarantee 6).
 */
export function checkPoiLayer({ network, tree, layer, params, radius, tuning = POI_TUNING, limit = 20 }: PoiCheckOptions): PoiViolation[] {
	const violations: PoiViolation[] = [];
	const report = (rule: PoiRule, detail: string) => {
		if (violations.length < limit) violations.push({ rule, detail });
	};
	checkTree(network, tree, report);
	if (violations.length > 0) return violations;
	checkDestinations(network, tree, layer, params.routeSplit, report);
	checkLegs(network, layer, report);
	checkSpacing(layer, radius, tuning, report);
	checkSectors(layer, params.strongholds, radius, tuning, report);
	return violations;
}

type Report = (rule: PoiRule, detail: string) => void;

function checkTree({ nodes, stretches }: RoadNetwork, { parentNode, parentStretch, depth }: RouteTree, report: Report): void {
	if (parentNode[0] !== -1 || depth[0] !== 0) report('tree', 'the compound has a way home of its own');
	for (let node = 1; node < nodes.length; node += 1) {
		const parent = parentNode[node];
		if (parent < 0) {
			report('tree', `node ${node} has no way home`);
			continue;
		}
		const stretch = stretches[parentStretch[node]];
		const joins = stretch !== undefined && ((stretch.from === node && stretch.to === parent) || (stretch.to === node && stretch.from === parent));
		if (!joins) report('tree', `node ${node}'s way home leaves on stretch ${parentStretch[node]}, which doesn't join it to node ${parent}`);
		if (depth[parent] !== depth[node] - 1) report('tree', `node ${node} is ${depth[node]} stretches from home, its next node ${depth[parent]}`);
	}
}

function checkDestinations(network: RoadNetwork, tree: RouteTree, layer: PoiLayer, routeSplit: number, report: Report): void {
	const { stretches } = network;
	const onWayHome = new Uint8Array(stretches.length);
	const isParent = new Uint8Array(network.nodes.length);
	for (let node = 1; node < network.nodes.length; node += 1) {
		if (tree.parentStretch[node] < 0) continue;
		onWayHome[tree.parentStretch[node]] = 1;
		isParent[tree.parentNode[node]] = 1;
	}
	const poiOnStretch = new Int32Array(stretches.length).fill(-1);
	const poiAtNode = new Int32Array(network.nodes.length).fill(-1);
	layer.pois.forEach(({ site }, poi) => {
		if (site.stretch >= 0) {
			if (poiOnStretch[site.stretch] >= 0) report('destination', `POIs ${poiOnStretch[site.stretch]} and ${poi} share stretch ${site.stretch}`);
			poiOnStretch[site.stretch] = poi;
		} else if (site.node >= 0) {
			poiAtNode[site.node] = poi;
		}
	});
	const roadsAt = new Int32Array(network.nodes.length);
	stretches.forEach(({ from, to }) => {
		if (from === to) return;
		roadsAt[from] += 1;
		roadsAt[to] += 1;
	});

	layer.pois.forEach(({ site, arrivals }, poi) => {
		if (site.stretch >= 0) {
			const stretch = stretches[site.stretch];
			if (!(site.along > 0 && site.along < tree.lengths[site.stretch])) report('destination', `POI ${poi} is ${site.along} along stretch ${site.stretch}, not inside it`);
			if (onWayHome[site.stretch] === 1) report('destination', `POI ${poi} is on stretch ${site.stretch}, which a way home uses`);
			const ends = arrivals.map(({ from }) => from).sort((a, b) => a - b);
			const expected = [stretch.from, stretch.to].sort((a, b) => a - b);
			if (ends.length !== 2 || ends[0] !== expected[0] || ends[1] !== expected[1] || arrivals.some(({ stretch: via }) => via !== site.stretch)) {
				report('destination', `POI ${poi} on stretch ${site.stretch} doesn't arrive from both its ends along it`);
			}
		} else {
			const node = site.node;
			if (!(node > 0) || isParent[node] === 1) report('destination', `POI ${poi} is on node ${node}, which a way home passes through`);
			else if (roadsAt[node] !== arrivals.length || arrivals.some(({ stretch }) => stretches[stretch].from !== node && stretches[stretch].to !== node)) {
				report('destination', `POI ${poi} on node ${node} has ${roadsAt[node]} roads but ${arrivals.length} arrivals along them`);
			}
		}
		if (arrivals.length < 2 || arrivals.length > 3) report('choice', `POI ${poi} has ${arrivals.length} routes`);
		for (let first = 0; first < arrivals.length; first += 1) {
			for (let second = first + 1; second < arrivals.length; second += 1) {
				const a = arrivals[first].from;
				const b = arrivals[second].from;
				if (a === b) report('choice', `POI ${poi}'s routes ${first} and ${second} both arrive from node ${a}`);
				else if (!splitsInTime(tree, a, b, routeSplit)) report('choice', `POI ${poi}'s routes from nodes ${a} and ${b} share road past ${routeSplit} of the shorter's hours`);
			}
		}
		// No route passes a POI: no node on its way out is a POI's, and no stretch on it holds one.
		for (const { from } of arrivals) {
			for (let node = from; node >= 0; node = tree.parentNode[node]) {
				if (poiAtNode[node] >= 0) report('destination', `POI ${poi}'s route from node ${from} passes POI ${poiAtNode[node]} at node ${node}`);
				const stretch = tree.parentStretch[node];
				if (stretch >= 0 && poiOnStretch[stretch] >= 0) report('destination', `POI ${poi}'s route from node ${from} passes POI ${poiOnStretch[stretch]} on stretch ${stretch}`);
			}
		}
	});
}

function checkLegs(network: RoadNetwork, layer: PoiLayer, report: Report): void {
	const { legs } = layer;
	legs.forEach((leg, id) => {
		if (leg.parent >= id) report('legs', `leg ${id} carries on from leg ${leg.parent}, which comes after it`);
		const start = leg.parent < 0 ? 0 : legs[leg.parent].to;
		if (leg.from !== start) report('legs', `leg ${id} starts at node ${leg.from}, not where it carries on from, node ${start}`);
		let at = leg.from;
		leg.pieces.forEach(({ stretch, forward }, place) => {
			const { from, to } = network.stretches[stretch];
			const enters = forward ? from : to;
			if (enters !== at) report('legs', `leg ${id}'s piece ${place} enters stretch ${stretch} at node ${enters}, not ${at}`);
			at = forward ? to : from;
		});
	});
	layer.pois.forEach((poi, index) => {
		routesTo(layer, poi).forEach((route, place) => {
			const last = legs[route.legs[route.legs.length - 1]];
			if (legs[route.legs[0]].parent !== -1) report('legs', `POI ${index}'s route ${place} doesn't start at the compound`);
			if (last.poi !== index) report('legs', `POI ${index}'s route ${place} ends at POI ${last.poi}`);
			const final = last.pieces[last.pieces.length - 1];
			if (final.stretch !== poi.arrivals[place].stretch) report('legs', `POI ${index}'s route ${place} ends on stretch ${final.stretch}, not its arrival's`);
		});
	});
}

function checkSpacing({ pois }: PoiLayer, radius: number, tuning: PoiTuning, report: Report): void {
	const spacing = tuning.sites.spacing * radius;
	const strongholdSpacing = tuning.strongholds.spacing * radius;
	for (let first = 0; first < pois.length; first += 1) {
		for (let second = first + 1; second < pois.length; second += 1) {
			const a = pois[first];
			const b = pois[second];
			const both = a.type === STRONGHOLD_TYPE && b.type === STRONGHOLD_TYPE;
			const least = both && strongholdSpacing > spacing ? strongholdSpacing : spacing;
			const dx = a.site.x - b.site.x;
			const dy = a.site.y - b.site.y;
			if (dx * dx + dy * dy < least * least) report('spacing', `POIs ${first} and ${second} are ${sqrt(dx * dx + dy * dy).toFixed(1)} apart, under ${least.toFixed(1)}`);
		}
	}
}

function checkSectors({ pois, strongholds, sectorRotation }: PoiLayer, count: number, radius: number, tuning: PoiTuning, report: Report): void {
	const sectors = new Sectors({ rotation: sectorRotation, count });
	const seated = new Int32Array(count);
	const { inner, outer } = tuning.strongholds.band;
	for (const { poi, sector } of strongholds) {
		const { x, y } = pois[poi].site;
		const at = sectors.sectorOf(x, y);
		if (at !== sector) report('sectors', `the stronghold at POI ${poi} is in sector ${at}, not ${sector}`);
		seated[at] += 1;
		const distance = sqrt(x * x + y * y);
		if (distance < inner * radius || distance > outer * radius) report('sectors', `the stronghold at POI ${poi} is ${distance.toFixed(1)} out, outside the outer band`);
	}
	seated.forEach((holds, sector) => {
		if (holds !== 1) report('sectors', `sector ${sector} has ${holds} strongholds`);
	});
}
