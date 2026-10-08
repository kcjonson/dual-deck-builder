import { RoadRule, checkRoadNetwork } from './RoadChecks';
import { RoadNetwork, RoadNode, RoadStretch } from './RoadNetwork';
import { fakeTerrain } from './roadTesting';

const terrain = fakeTerrain();

const BRANCH = { x: Math.sin(40 * Math.PI / 180) * 100, y: Math.cos(40 * Math.PI / 180) * 100 };

/**
 * A highway north out of the metro, through a junction at (0, 300) to a
 * dead end at (0, 600), and a back road leaving the junction 40 degrees east
 * of it, two segments long.
 */
function valid(): { nodes: RoadNode[]; roads: RoadNetwork['roads'][number][]; stretches: RoadStretch[] } {
	const branchEnd = { x: 2 * BRANCH.x, y: 300 + 2 * BRANCH.y };
	return {
		nodes: [
			{ kind: 'compound', x: 0, y: 0 },
			{ kind: 'metroEdge', x: 0, y: 100 },
			{ kind: 'junction', x: 0, y: 300 },
			{ kind: 'end', x: 0, y: 600 },
			{ kind: 'end', x: branchEnd.x, y: branchEnd.y },
		],
		roads: [
			{ roadClass: 'highway', parent: -1, from: 0, stretches: [0, 1, 2] },
			{ roadClass: 'backRoad', parent: 0, from: 2, stretches: [3] },
		],
		stretches: [
			{ road: 0, roadClass: 'highway', from: 0, to: 1, parent: -1, points: [0, 0, 0, 100] },
			{ road: 0, roadClass: 'highway', from: 1, to: 2, parent: 0, points: [0, 100, 0, 200, 0, 300] },
			{ road: 0, roadClass: 'highway', from: 2, to: 3, parent: 1, points: [0, 300, 0, 400, 0, 500, 0, 600] },
			{ road: 1, roadClass: 'backRoad', from: 2, to: 4, parent: 1, points: [0, 300, BRANCH.x, 300 + BRANCH.y, branchEnd.x, branchEnd.y] },
		],
	};
}

const rules = (network: RoadNetwork, clearance = 24, options: Partial<Parameters<typeof checkRoadNetwork>[0]> = {}): RoadRule[] =>
	checkRoadNetwork({ network, terrain, clearance, ...options }).map(({ rule }) => rule);

/** The branch with its far end moved to (x, y). */
function branchTo(x: number, y: number) {
	const network = valid();
	network.nodes[4] = { kind: 'end', x, y };
	network.stretches[3] = { ...network.stretches[3], points: [0, 300, BRANCH.x, 300 + BRANCH.y, x, y] };
	return network;
}

describe('checkRoadNetwork', () => {
	it('passes a network that keeps every rule', () => {
		expect(checkRoadNetwork({ network: valid(), terrain, clearance: 24 })).toEqual([]);
	});

	it('finds a crossing', () => {
		expect(rules(branchTo(-50, 460))).toContain('crossing');
	});

	it('finds roads closer than the clearance away from their junction', () => {
		expect(rules(branchTo(10, 470))).toEqual(['clearance']);
		// The same gap passes once the clearance asks for less.
		expect(rules(branchTo(10, 470), 8)).toEqual([]);
	});

	it('finds a segment that gains too little distance from the compound', () => {
		const network = valid();
		network.nodes[3] = { kind: 'end', x: -300, y: 420 };
		network.stretches[2] = { ...network.stretches[2], points: [0, 300, 0, 400, -300, 420] };
		expect(rules(network)).toEqual(['outward']);
	});

	it('finds a point outside the disc', () => {
		const network = valid();
		network.nodes[3] = { kind: 'end', x: 0, y: 1001 };
		network.stretches[2] = { ...network.stretches[2], points: [0, 300, 0, 400, 0, 1001] };
		expect(rules(network)).toEqual(['disc']);
	});

	it('finds impassable ground on a segment', () => {
		// The crater reaches both of the highway's segments either side of (0, 200).
		const cratered = fakeTerrain({ hotspots: [{ x: 30, y: 200, craterRadius: 40, plumeRadius: 200, strength: 1 }] });
		expect(rules(valid(), 24, { terrain: cratered })).toEqual(['passable', 'passable']);
	});

	it('finds a branch leaving within 20 degrees of its parent', () => {
		const network = valid();
		const near = { x: Math.sin(10 * Math.PI / 180) * 100, y: Math.cos(10 * Math.PI / 180) * 100 };
		network.nodes[4] = { kind: 'end', x: 2 * near.x, y: 300 + 2 * near.y };
		network.stretches[3] = { ...network.stretches[3], points: [0, 300, near.x, 300 + near.y, 2 * near.x, 300 + 2 * near.y] };
		expect(rules(network)).toContain('junctionAngle');
	});

	it('measures a branch from its parent\'s way in when the parent ends at the junction', () => {
		// The highway, blocked right after branching, ends at its junction: the branch is the only stretch out.
		const endingAt = (degrees: number): RoadNetwork => {
			const off = { x: Math.sin(degrees * Math.PI / 180) * 100, y: Math.cos(degrees * Math.PI / 180) * 100 };
			return {
				nodes: [
					{ kind: 'compound', x: 0, y: 0 },
					{ kind: 'metroEdge', x: 0, y: 100 },
					{ kind: 'junction', x: 0, y: 300 },
					{ kind: 'end', x: 2 * off.x, y: 300 + 2 * off.y },
				],
				roads: [
					{ roadClass: 'highway', parent: -1, from: 0, stretches: [0, 1] },
					{ roadClass: 'backRoad', parent: 0, from: 2, stretches: [2] },
				],
				stretches: [
					{ road: 0, roadClass: 'highway', from: 0, to: 1, parent: -1, points: [0, 0, 0, 100] },
					{ road: 0, roadClass: 'highway', from: 1, to: 2, parent: 0, points: [0, 100, 0, 200, 0, 300] },
					{ road: 1, roadClass: 'backRoad', from: 2, to: 3, parent: 1, points: [0, 300, off.x, 300 + off.y, 2 * off.x, 300 + 2 * off.y] },
				],
			};
		};
		expect(rules(endingAt(10))).toEqual(['junctionAngle']);
		expect(rules(endingAt(40))).toEqual([]);
	});

	it('finds broken trees: a parent link that loops, a stretch off its node, a trail that branches', () => {
		const looped = valid();
		looped.stretches[1] = { ...looped.stretches[1], parent: 2 };
		expect(rules(looped)).toContain('structure');

		const adrift = valid();
		adrift.stretches[2] = { ...adrift.stretches[2], points: [0, 301, 0, 400, 0, 500, 0, 600] };
		expect(rules(adrift)).toContain('structure');

		const trail = valid();
		trail.roads[0] = { ...trail.roads[0], roadClass: 'trail' };
		trail.stretches = trail.stretches.map((stretch) => (stretch.road === 0 ? { ...stretch, roadClass: 'trail' } : stretch));
		expect(rules(trail)).toContain('structure');
	});

	describe('approaches', () => {
		const along = (distance: number) => ({ x: Math.sin(40 * Math.PI / 180) * distance, y: Math.cos(40 * Math.PI / 180) * distance });
		const EDGE = along(100);
		const JOIN = along(350);
		const FAR = along(600);
		const POI = { x: 120, y: 420 };

		/**
		 * Highway A north to a dead end at (0, 600), highway B 40 degrees east of
		 * it, and a POI at (120, 420) with an approach from each: from (0, 380) on
		 * A and from 350 along B, each splitting its highway's stretch there.
		 */
		function approached(second: number[] = [JOIN.x, JOIN.y, POI.x, POI.y]): RoadNetwork & { nodes: RoadNode[]; roads: RoadNetwork['roads'][number][]; stretches: RoadStretch[] } {
			return {
				nodes: [
					{ kind: 'compound', x: 0, y: 0 },
					{ kind: 'metroEdge', x: 0, y: 100 },
					{ kind: 'end', x: 0, y: 600 },
					{ kind: 'metroEdge', x: EDGE.x, y: EDGE.y },
					{ kind: 'end', x: FAR.x, y: FAR.y },
					{ kind: 'junction', x: 0, y: 380 },
					{ kind: 'junction', x: JOIN.x, y: JOIN.y },
					{ kind: 'poi', x: POI.x, y: POI.y },
				],
				roads: [
					{ roadClass: 'highway', parent: -1, from: 0, stretches: [0, 1, 2] },
					{ roadClass: 'highway', parent: -1, from: 0, stretches: [3, 4, 5] },
					{ roadClass: 'backRoad', parent: 0, from: 5, stretches: [6] },
					{ roadClass: 'trail', parent: 1, from: 6, stretches: [7] },
				],
				stretches: [
					{ road: 0, roadClass: 'highway', from: 0, to: 1, parent: -1, points: [0, 0, 0, 100] },
					{ road: 0, roadClass: 'highway', from: 1, to: 5, parent: 0, points: [0, 100, 0, 200, 0, 300, 0, 380] },
					{ road: 0, roadClass: 'highway', from: 5, to: 2, parent: 1, points: [0, 380, 0, 500, 0, 600] },
					{ road: 1, roadClass: 'highway', from: 0, to: 3, parent: -1, points: [0, 0, EDGE.x, EDGE.y] },
					{ road: 1, roadClass: 'highway', from: 3, to: 6, parent: 3, points: [EDGE.x, EDGE.y, JOIN.x, JOIN.y] },
					{ road: 1, roadClass: 'highway', from: 6, to: 4, parent: 4, points: [JOIN.x, JOIN.y, FAR.x, FAR.y] },
					{ road: 2, roadClass: 'backRoad', from: 5, to: 7, parent: 1, points: [0, 380, POI.x, POI.y] },
					{ road: 3, roadClass: 'trail', from: 6, to: 7, parent: 4, points: second },
				],
			};
		}

		it('passes approaches that come no nearer the compound than where they start, and meet only at their POI', () => {
			expect(checkRoadNetwork({ network: approached(), terrain, clearance: 24 })).toEqual([]);
		});

		it('finds an approach that comes nearer the compound than where it starts', () => {
			// Both segments reach the dip at (180, 250), 308 from the compound against the 350 it started at.
			expect(rules(approached([JOIN.x, JOIN.y, 180, 250, POI.x, POI.y]))).toEqual(['outward', 'outward']);
		});

		it('finds approaches that meet at their POI under 20 degrees apart', () => {
			// Two units off the first approach's line, 30 short of the POI: they come in 3 degrees apart.
			expect(rules(approached([JOIN.x, JOIN.y, 90, 412, POI.x, POI.y]))).toContain('crossing');
		});

		it('finds a POI something leaves, and an approach of the wrong kind', () => {
			const onward = approached();
			onward.nodes.push({ kind: 'end', x: 200, y: 600 });
			onward.roads.push({ roadClass: 'backRoad', parent: 2, from: 7, stretches: [8] });
			onward.stretches.push({ road: 4, roadClass: 'backRoad', from: 7, to: 8, parent: 6, points: [POI.x, POI.y, 200, 600] });
			expect(rules(onward)).toContain('structure');

			const highway = approached();
			highway.roads[2] = { ...highway.roads[2], roadClass: 'highway' };
			highway.stretches[6] = { ...highway.stretches[6], roadClass: 'highway' };
			expect(rules(highway)).toEqual(['structure']);
		});
	});

	it('stops at the limit it\'s given', () => {
		const network = branchTo(10, 470);
		network.stretches[2] = { ...network.stretches[2], points: [0, 300, 0, 400, 0, 500, 0, 600] };
		expect(checkRoadNetwork({ network, terrain, clearance: 24, limit: 1 })).toHaveLength(1);
	});
});
