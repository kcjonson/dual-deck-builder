import { PoiMap, closes } from './Pois';
import type { RoadNetwork } from './RoadNetwork';

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;

/**
 * Checks stage 5's output against the guarantees it owns (Area Map
 * Generation, Guarantees 4 and 5), from the plain data alone, so the map
 * validator can check a loaded map as well as one just placed. Run
 * `checkRoadNetwork` alongside for the roads' own rules, approaches included.
 */

export type PoiRule = 'site' | 'deadEnd' | 'approaches' | 'routes';

export interface PoiViolation {
	readonly rule: PoiRule;
	readonly detail: string;
}

export interface PoiCheckOptions {
	map: PoiMap;
	/** Approaches a site may have at most: `routesTarget`. */
	routesTarget: number;
	/** Stops after this many violations. */
	limit?: number;
}

/**
 * Every rule stage 5's output breaks, up to `limit`:
 *
 * - site: every POI and stronghold has a `poi` node of its own, and every
 *   `poi` node is one of them.
 * - deadEnd (guarantee 4): nothing leaves a site's node, so there's no
 *   driving from one objective on to another.
 * - approaches: a site's approaches are exactly the roads ending at its
 *   node, two to `routesTarget` of them, each one stretch leaving a grown
 *   road (never another approach) and closing on the site all along it.
 * - routes (guarantee 5): a route is an approach and the walk up parents
 *   from it to the compound, and any two routes to a site share only
 *   stretches that end inside the home area, measured along the roads.
 */
export function checkPois({ map, routesTarget, limit = 20 }: PoiCheckOptions): PoiViolation[] {
	const violations: PoiViolation[] = [];
	const report = (rule: PoiRule, detail: string) => {
		if (violations.length < limit) violations.push({ rule, detail });
	};
	const { network, strongholds, pois, homeReach } = map;
	const { nodes, roads, stretches } = network;
	const sites = [
		...strongholds.map(({ node, approaches }, index) => ({ name: `stronghold ${index}`, node, approaches })),
		...pois.map(({ node, approaches }, index) => ({ name: `POI ${index}`, node, approaches })),
	];
	const owners = new Map<number, string>();
	for (const { name, node } of sites) {
		if (!(node >= 0 && node < nodes.length) || nodes[node].kind !== 'poi') report('site', `${name}'s node ${node} isn't a poi node`);
		else if (owners.has(node)) report('site', `${name} shares node ${node} with ${owners.get(node)}`);
		else owners.set(node, name);
	}
	nodes.forEach((node, id) => {
		if (node.kind === 'poi' && !owners.has(id)) report('site', `poi node ${id} is no site's`);
	});

	const leaving = new Map<number, number>();
	for (const stretch of stretches) leaving.set(stretch.from, (leaving.get(stretch.from) ?? 0) + 1);
	const endingAt = new Map<number, number[]>();
	roads.forEach((road, id) => {
		const end = stretches[road.stretches[road.stretches.length - 1]].to;
		const list = endingAt.get(end) ?? [];
		list.push(id);
		endingAt.set(end, list);
	});
	const isApproach = (road: number) => nodes[stretches[roads[road].stretches[roads[road].stretches.length - 1]].to].kind === 'poi';
	const reached = roadDistances(network);

	for (const { name, node, approaches } of sites) {
		if (!owners.has(node) || owners.get(node) !== name) continue;
		if ((leaving.get(node) ?? 0) > 0) report('deadEnd', `${leaving.get(node)} stretches leave ${name}'s node ${node}`);
		const arriving = [...(endingAt.get(node) ?? [])].sort((a, b) => a - b);
		if (arriving.join() !== [...approaches].sort((a, b) => a - b).join()) {
			report('approaches', `${name} lists approaches ${approaches.join(', ')}, but roads ${arriving.join(', ')} end at it`);
		}
		if (approaches.length < 2 || approaches.length > routesTarget) report('approaches', `${name} has ${approaches.length} approaches, not 2 to ${routesTarget}`);
		const routes: Set<number>[] = [];
		for (const approach of approaches) {
			const road = roads[approach];
			if (road === undefined || road.stretches.length !== 1 || road.parent < 0 || isApproach(road.parent)) {
				report('approaches', `${name}'s approach ${approach} isn't one stretch leaving a grown road`);
				continue;
			}
			const points = stretches[road.stretches[0]].points;
			for (let point = 0; point + 3 < points.length; point += 2) {
				if (!closes(points[point], points[point + 1], points[point + 2], points[point + 3], nodes[node].x, nodes[node].y)) {
					report('approaches', `${name}'s approach ${approach} turns away from it at segment ${point / 2}`);
					break;
				}
			}
			routes.push(route(network, road.stretches[0]));
		}
		for (let first = 0; first < routes.length; first += 1) {
			for (let second = first + 1; second < routes.length; second += 1) {
				for (const stretch of routes[first]) {
					if (routes[second].has(stretch) && reached[stretches[stretch].to] > homeReach) {
						report('routes', `${name}'s routes by approaches ${approaches[first]} and ${approaches[second]} share stretch ${stretch}, which ends ${reached[stretches[stretch].to].toFixed(1)} along the roads, past the home area's ${homeReach.toFixed(1)}`);
					}
				}
			}
		}
	}
	return violations;
}

/** A route's stretches: `stretch` and every one up its parents to the compound. */
export function route(network: RoadNetwork, stretch: number): Set<number> {
	const stretches = new Set<number>();
	for (let at = stretch; at >= 0 && !stretches.has(at); at = network.stretches[at].parent) stretches.add(at);
	return stretches;
}

/** Each node's distance from the compound along the roads, by the parent links; -1 where none reaches. */
export function roadDistances({ nodes, stretches }: RoadNetwork): Float64Array {
	const reached = new Float64Array(nodes.length).fill(-1);
	reached[0] = 0;
	const done = new Uint8Array(stretches.length);
	const settle = (id: number, depth: number): void => {
		if (done[id] === 1 || depth > stretches.length) return;
		const { parent, from, to, points } = stretches[id];
		if (parent >= 0) settle(parent, depth + 1);
		done[id] = 1;
		if (reached[from] < 0) return;
		let length = 0;
		for (let point = 0; point + 3 < points.length; point += 2) {
			const dx = points[point + 2] - points[point];
			const dy = points[point + 3] - points[point + 1];
			length += sqrt(dx * dx + dy * dy);
		}
		reached[to] = reached[from] + length;
	};
	for (let id = 0; id < stretches.length; id += 1) settle(id, 0);
	return reached;
}
