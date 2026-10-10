import { MeshEdge, meshFrom, randomMesh } from './meshTesting';
import { MeetingPoint, ROAD_CLASS_SPEEDS, buildLegs, buildRouteTree, hoursFor, legPoints, routesTo, splitNode, splitsInTime } from './RouteTree';

const tree = (network: ReturnType<typeof meshFrom>, { travelPace = 1, routeSplit = 0.5 } = {}) => buildRouteTree({ network, travelPace, routeSplit });

/** Every node's way home as its nodes, outward from the compound. */
const wayHome = (parentNode: Int32Array, node: number) => {
	const nodes: number[] = [];
	for (let at = node; at >= 0; at = parentNode[at]) nodes.unshift(at);
	return nodes;
};

describe('the route tree', () => {
	// A square of four places, the compound at one corner; 3 is as far from home either way round.
	const square: [number, number][] = [[0, 0], [100, 0], [0, 100], [100, 100]];

	it('takes each place\'s quickest way home, at the classes\' speeds', () => {
		const network = meshFrom({ nodes: square, edges: [[0, 1], [0, 2, 'highway'], [1, 3], [2, 3, 'highway']] });
		const { parentNode, parentStretch, hours, depth } = tree(network);
		expect(Array.from(parentNode)).toEqual([-1, 0, 0, 2]);
		expect(Array.from(parentStretch)).toEqual([-1, 0, 1, 3]);
		expect(Array.from(depth)).toEqual([0, 1, 1, 2]);
		expect(hours[3]).toBeCloseTo(200 / ROAD_CLASS_SPEEDS.highway, 12);
		expect(hours[1]).toBeCloseTo(100 / ROAD_CLASS_SPEEDS.backRoad, 12);
	});

	it('breaks a tie to the lower stretch id, however the stretches are listed', () => {
		const first = meshFrom({ nodes: square, edges: [[0, 1], [0, 2], [1, 3], [2, 3]] });
		expect(tree(first).parentStretch[3]).toBe(2);
		expect(tree(first).parentNode[3]).toBe(1);
		const swapped = meshFrom({ nodes: square, edges: [[0, 1], [0, 2], [2, 3], [1, 3]] });
		expect(tree(swapped).parentStretch[3]).toBe(2);
		expect(tree(swapped).parentNode[3]).toBe(2);
		// Points running either way round don't matter.
		const reversed = meshFrom({ nodes: square, edges: [[1, 0], [2, 0], [3, 1], [3, 2]] });
		expect(Array.from(tree(reversed).parentNode)).toEqual([-1, 0, 0, 1]);
	});

	it('scales hours by the travel pace without moving the tree', () => {
		const network = randomMesh({ seed: 5, radius: 600 });
		const slow = tree(network, { travelPace: 2 });
		const usual = tree(network);
		expect(slow.parentStretch).toEqual(usual.parentStretch);
		usual.hours.forEach((hours, node) => expect(slow.hours[node]).toBeCloseTo(2 * hours, 9));
		expect(hoursFor(260, 'highway', 1)).toBe(1);
		expect(hoursFor(90, 'trail', 2)).toBe(2);
	});

	it('leaves a place the roads don\'t reach without a way home', () => {
		const network = meshFrom({ nodes: [...square, [500, 500], [600, 500]], edges: [[0, 1], [0, 2], [1, 3], [2, 3], [4, 5]] });
		const { parentNode, hours, depth, meetingPoints } = tree(network);
		expect(parentNode[4]).toBe(-1);
		expect(hours[4]).toBe(Infinity);
		expect(depth[5]).toBe(-1);
		expect(splitNode(tree(network), 3, 4)).toBe(-1);
		expect(meetingPoints.every(({ from }) => from.every((node) => node < 4))).toBe(true);
	});

	describe('over random meshes with loops', () => {
		const meshes = Array.from({ length: 30 }, (_, index) => randomMesh({ seed: 100 + index, radius: 400 + 20 * index }));

		it('gives every place a way home that ends at the compound, and the ways home are a tree', () => {
			for (const network of meshes) {
				const { parentNode, parentStretch, depth, hours, stretchHours } = tree(network);
				for (let node = 1; node < network.nodes.length; node += 1) {
					const parent = parentNode[node];
					expect(parent).toBeGreaterThanOrEqual(0);
					const { from, to } = network.stretches[parentStretch[node]];
					expect([from, to].sort()).toEqual([node, parent].sort());
					expect(depth[node]).toBe(depth[parent] + 1);
					expect(hours[node]).toBeCloseTo(hours[parent] + stretchHours[parentStretch[node]], 9);
					expect(wayHome(parentNode, node)[0]).toBe(0);
				}
			}
		});

		it('finds the quickest: no stretch would bring a place home sooner', () => {
			for (const network of meshes) {
				const { hours, stretchHours } = tree(network);
				network.stretches.forEach(({ from, to }, id) => {
					expect(hours[to]).toBeLessThanOrEqual(hours[from] + stretchHours[id] + 1e-9);
					expect(hours[from]).toBeLessThanOrEqual(hours[to] + stretchHours[id] + 1e-9);
				});
			}
		});

		it('finds meeting points, every one off the ways home and split in time', () => {
			let found = 0;
			for (const network of meshes) {
				const routeTree = tree(network);
				const used = new Set(Array.from(routeTree.parentStretch).filter((stretch) => stretch >= 0));
				for (const point of routeTree.meetingPoints) {
					found += 1;
					if (point.stretch >= 0) {
						expect(used.has(point.stretch)).toBe(false);
						expect(point.via).toEqual([point.stretch, point.stretch]);
					}
					for (let a = 0; a < point.from.length; a += 1) {
						for (let b = a + 1; b < point.from.length; b += 1) expect(splitsInTime(routeTree, point.from[a], point.from[b], 0.5)).toBe(true);
					}
				}
			}
			expect(found).toBeGreaterThan(30 * 20);
		});

		it('takes no draws: the same network always makes the same tree', () => {
			const network = meshes[3];
			expect(tree(network)).toEqual(tree(network));
		});
	});
});

describe('meeting points', () => {
	// A trunk from the compound to node 1, forking to 2 and 3, joined again by a stretch from 2 to 3.
	const fork = (trunk: number, routeSplit: number) => tree(meshFrom({
		nodes: [[0, 0], [trunk, 0], [trunk + 100, 50], [trunk + 100, -50]],
		edges: [[0, 1], [1, 2], [1, 3], [2, 3]],
	}), { routeSplit });

	it('is a stretch no way home uses whose ends\' ways home split by routeSplit of the shorter\'s hours', () => {
		// The ways home of 2 and 3 split at node 1, 400 units out of about 512: too late at a half...
		expect(fork(400, 0.5).meetingPoints).toEqual([]);
		// ...in time at 0.8.
		expect(fork(400, 0.8).meetingPoints).toEqual([{ stretch: 3, node: -1, from: [2, 3], via: [3, 3] }]);
		// A short trunk splits early enough at a half.
		expect(fork(50, 0.5).meetingPoints.map(({ stretch }) => stretch)).toEqual([3]);
	});

	it('splits at exactly routeSplit, but not past it', () => {
		const routeTree = fork(400, 0.5);
		const shorter = Math.min(routeTree.hours[2], routeTree.hours[3]);
		const at = routeTree.hours[1] / shorter;
		expect(splitsInTime(routeTree, 2, 3, at)).toBe(true);
		expect(splitsInTime(routeTree, 2, 3, at * (1 - 1e-9))).toBe(false);
	});

	it('never joins a place to one on its own way home, unless that\'s the compound', () => {
		// 1 to 2 doubled: the second runs beside the first, and 1 is on 2's way home.
		const doubled = tree(meshFrom({ nodes: [[0, 0], [200, 0], [400, 0]], edges: [[0, 1], [1, 2], [1, 2]] }));
		expect(doubled.meetingPoints).toEqual([]);
		const home = tree(meshFrom({ nodes: [[0, 0], [200, 0]], edges: [[0, 1], [0, 1]] }));
		expect(home.meetingPoints).toEqual([{ stretch: 1, node: -1, from: [0, 1], via: [1, 1] }]);
	});

	// Three spokes from the compound, and a leaf beyond them joined to all three.
	const spokes: [number, number][] = [[0, 0], [300, 0], [300, 200], [300, -200], [500, 0]];
	const spokeEdges: MeshEdge[] = [[0, 1], [0, 2], [0, 3], [1, 4], [2, 4], [3, 4]];

	it('is a leaf place with exactly three roads, whose ways home split pairwise in time: a three-way point', () => {
		const routeTree = tree(meshFrom({ nodes: spokes, edges: spokeEdges }));
		expect(routeTree.parentNode[4]).toBe(1);
		expect(routeTree.meetingPoints).toEqual([
			{ stretch: 4, node: -1, from: [2, 4], via: [4, 4] },
			{ stretch: 5, node: -1, from: [3, 4], via: [5, 5] },
			{ stretch: -1, node: 4, from: [1, 2, 3], via: [3, 4, 5] },
		]);
	});

	it('isn\'t a three-way point when two of its roads come from one neighbour', () => {
		// Two roads from 1 into the leaf, and one from 2: three roads, but two of the routes would share a way home.
		const doubled = tree(meshFrom({ nodes: spokes, edges: [[0, 1], [0, 2], [0, 3], [1, 4], [1, 4], [2, 4]] }));
		expect(doubled.meetingPoints.some(({ node }) => node === 4)).toBe(false);
	});

	it('isn\'t a three-way point with a fourth road, or a way home through it', () => {
		const fourth = tree(meshFrom({ nodes: [...spokes, [300, 400]], edges: [...spokeEdges, [5, 4], [0, 5]] }));
		expect(fourth.meetingPoints.some(({ node }) => node === 4)).toBe(false);
		// A place beyond the leaf whose way home runs through it.
		const through = tree(meshFrom({ nodes: [...spokes, [700, 0]], edges: [...spokeEdges, [4, 5]] }));
		expect(through.meetingPoints.some(({ node }) => node === 4)).toBe(false);
	});
});

describe('legs and routes', () => {
	// The three-spoke mesh, with a trunk: 0 to 1, then 1 forks to 2 and 3, which close a loop with 4.
	const nodes: [number, number][] = [[0, 0], [100, 0], [300, 150], [300, -150], [500, 0], [300, 0]];
	const network = meshFrom({ nodes, edges: [[0, 1, 'highway'], [1, 2], [1, 3], [2, 4], [4, 3], [1, 5], [5, 4]] });
	const routeTree = tree(network, { routeSplit: 0.9 });
	const meetingPoint = (match: (point: MeetingPoint) => boolean): MeetingPoint => {
		const point = routeTree.meetingPoints.find(match);
		if (point === undefined) throw new Error('no such meeting point');
		return point;
	};

	it('cuts the pruned tree at the compound, where routes split, and the POIs', () => {
		// A three-way POI at node 4 (a leaf with three roads), and nothing else.
		const point = meetingPoint(({ node }) => node === 4);
		const arrivals = point.from.map((from, index) => ({
			from, stretch: point.via[index], length: routeTree.lengths[point.via[index]], hours: routeTree.hours[from] + routeTree.stretchHours[point.via[index]],
		}));
		const { legs, lastLegs } = buildLegs({ network, tree: routeTree, destinations: [{ arrivals }] });
		// The trunk to 1, where three routes split, then a leg from 1 into the POI along each.
		expect(legs.map(({ parent, from, to, poi }) => ({ parent, from, to, poi }))).toEqual([
			{ parent: -1, from: 0, to: 1, poi: -1 },
			{ parent: 0, from: 1, to: 4, poi: 0 },
			{ parent: 0, from: 1, to: 4, poi: 0 },
			{ parent: 0, from: 1, to: 4, poi: 0 },
		]);
		expect(legs[1].pieces).toEqual([{ stretch: 1, forward: true, length: routeTree.lengths[1] }, { stretch: 3, forward: true, length: routeTree.lengths[3] }]);
		expect(legs[2].pieces).toEqual([{ stretch: 2, forward: true, length: routeTree.lengths[2] }, { stretch: 4, forward: false, length: routeTree.lengths[4] }]);
		const poi = { arrivals: arrivals.map((arrival, index) => ({ ...arrival, leg: lastLegs[0][index] })) };
		const routes = routesTo({ legs }, poi);
		expect(routes.map(({ legs: chain }) => chain)).toEqual(poi.arrivals.map(({ leg }) => [0, leg]));
		routes.forEach((route, index) => expect(route.hours).toBeCloseTo(poi.arrivals[index].hours, 9));
		expect(legPoints(network, legs[2])).toEqual([100, 0, 300, -150, 500, 0]);
	});

	it('ends a leg partway along a stretch for a POI there, and keeps a leg whole where only one route goes on', () => {
		const { stretch } = meetingPoint((point) => point.stretch >= 0);
		const { from, to } = network.stretches[stretch];
		const along = routeTree.lengths[stretch] / 4;
		const arrivals = [
			{ from, stretch, length: along, hours: routeTree.hours[from] + routeTree.stretchHours[stretch] / 4 },
			{ from: to, stretch, length: routeTree.lengths[stretch] - along, hours: routeTree.hours[to] + routeTree.stretchHours[stretch] * 3 / 4 },
		];
		const { legs, lastLegs } = buildLegs({ network, tree: routeTree, destinations: [{ arrivals }] });
		const last = legs[lastLegs[0][0]];
		expect(last.to).toBe(-1);
		expect(last.pieces[last.pieces.length - 1]).toEqual({ stretch, forward: true, length: along });
		const line = legPoints(network, last);
		expect(line[line.length - 2]).toBeCloseTo(nodes[from][0] + (nodes[to][0] - nodes[from][0]) / 4, 9);
		// Every node a leg passes without ending has exactly one way on.
		for (const leg of legs) expect(leg.pieces.length).toBeGreaterThan(0);
		const routes = routesTo({ legs }, { arrivals: arrivals.map((arrival, index) => ({ ...arrival, leg: lastLegs[0][index] })) });
		expect(routes.every(({ legs: chain }) => legs[chain[0]].from === 0)).toBe(true);
		routes.forEach((route, index) => expect(route.hours).toBeCloseTo(arrivals[index].hours, 9));
	});
});
