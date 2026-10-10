import { RoadGround, RoadRule, checkRoadNetwork, impassableAlong, polylineBridges, polylineLength, roadClashes } from './RoadChecks';
import type { RoadNetwork, RoadNode, RoadStretch } from './RoadNetwork';
import { fakeGround } from './roadTesting';
import type { Obstacle } from './Terrain';

/** A stretch along `points`, with its length worked out. */
function stretch(from: number, to: number, points: number[], roadClass: RoadStretch['roadClass'] = 'backRoad'): RoadStretch {
	return { roadClass, from, to, length: polylineLength(points), points, bridges: [], street: false };
}

/**
 * A square loop out of the compound, (0, 0) to (0, 300) to (300, 300) to
 * (300, 0) and home, and a spur from (300, 300) to a dead end at (400, 400).
 */
function valid(): { nodes: RoadNode[]; stretches: RoadStretch[]; broken: RoadStretch[]; passes: RoadNetwork['passes'] } {
	return {
		nodes: [
			{ kind: 'compound', x: 0, y: 0, place: 0 },
			{ kind: 'junction', x: 0, y: 300 },
			{ kind: 'town', x: 300, y: 300, place: 1 },
			{ kind: 'crossroads', x: 300, y: 0, place: 2 },
			{ kind: 'end', x: 400, y: 400 },
		],
		stretches: [
			stretch(0, 1, [0, 0, 0, 150, 0, 300], 'highway'),
			stretch(1, 2, [0, 300, 150, 300, 300, 300]),
			stretch(2, 3, [300, 300, 300, 150, 300, 0]),
			stretch(3, 0, [300, 0, 150, 0, 0, 0]),
			stretch(2, 4, [300, 300, 400, 400], 'trail'),
		],
		broken: [],
		passes: [],
	};
}

const ground = fakeGround();
const rules = (network: RoadNetwork, terrain: RoadGround = ground): RoadRule[] => checkRoadNetwork({ network, terrain }).map(({ rule }) => rule);

describe('checkRoadNetwork', () => {
	it('passes a network with a loop that keeps every rule', () => {
		expect(checkRoadNetwork({ network: valid(), terrain: ground })).toEqual([]);
	});

	it('finds broken structure: no compound at the origin, a stretch off its nodes, a wrong length, a loop on one node, bridges out of order', () => {
		const moved = valid();
		moved.nodes[0] = { kind: 'compound', x: 1, y: 0 };
		expect(rules(moved)).toEqual(['structure']);
		const off = valid();
		off.stretches[1] = stretch(1, 2, [0, 301, 150, 300, 300, 300]);
		expect(rules(off)).toContain('structure');
		const long = valid();
		long.stretches[4] = { ...long.stretches[4], length: 10 };
		expect(rules(long)).toEqual(['structure']);
		const loop = valid();
		loop.stretches.push(stretch(4, 4, [400, 400, 410, 400, 400, 400]));
		expect(rules(loop)).toEqual(['structure']);
		const bridges = valid();
		bridges.stretches[1] = { ...bridges.stretches[1], bridges: [{ start: 100, end: 110 }, { start: 50, end: 60 }] };
		expect(rules(bridges)).toEqual(['structure']);
	});

	it('finds a point outside the disc', () => {
		// The dead end at (400, 400) is 565.7 out.
		expect(rules(valid(), fakeGround({ radius: 566 }))).toEqual([]);
		expect(rules(valid(), fakeGround({ radius: 565 }))).toEqual(['disc']);
	});

	it('finds impassable ground between the polyline\'s points, sampled every half unit', () => {
		// A wall a unit thick across the middle of the top road, between its points.
		expect(rules(valid(), fakeGround({ wall: (x, y) => x > 100 && x < 101 && y > 290 }))).toEqual(['passable']);
		// The same wall across nothing.
		expect(rules(valid(), fakeGround({ wall: (x, y) => x > 100 && x < 101 && y > 310 }))).toEqual([]);
	});

	it('finds stretches that cross, that come closer than the clearance, and that leave a node they share too close together', () => {
		const crossing = valid();
		crossing.stretches.push(stretch(1, 3, [0, 300, 300, 0]), stretch(0, 2, [0, 0, 300, 300]));
		expect(rules(crossing)).toContain('crossing');

		const close = valid();
		// Beside the top road a unit away, sharing neither of its nodes.
		close.nodes.push({ kind: 'end', x: 50, y: 301 }, { kind: 'end', x: 250, y: 301 });
		close.stretches.push(stretch(5, 6, [50, 301, 250, 301]));
		expect(rules(close)).toContain('clearance');

		const narrow = valid();
		// A second road out of the compound five degrees off the first.
		narrow.nodes.push({ kind: 'end', x: 26, y: 300 });
		narrow.stretches.push(stretch(0, 5, [0, 0, 26, 300]));
		expect(rules(narrow)).toContain('crossing');
		// Twenty-five degrees apart is room enough.
		const wide = valid();
		wide.nodes.push({ kind: 'end', x: 250 * Math.tan(25 * Math.PI / 180), y: 250 });
		wide.stretches.push(stretch(0, 5, [0, 0, wide.nodes[5].x, wide.nodes[5].y]));
		expect(roadClashes(wide)).toEqual([]);
	});

	it('finds a stretch that touches itself', () => {
		const looped = valid();
		looped.stretches[4] = stretch(2, 4, [300, 300, 350, 350, 350, 320, 320, 350, 400, 400]);
		expect(rules(looped)).toContain('crossing');
	});

	it('finds a node that doesn\'t reach the compound', () => {
		const cut = valid();
		cut.nodes.push({ kind: 'end', x: -100, y: -100 }, { kind: 'end', x: -200, y: -100 });
		cut.stretches.push(stretch(5, 6, [-100, -100, -200, -100]));
		expect(rules(cut)).toEqual(['reach', 'reach']);
	});
});

describe('bridges along a polyline', () => {
	/** A river along x = 100, 4 units across, bridged square-on; nothing else in the way. */
	const river: RoadGround = {
		radius: 1000,
		metro: { x: 0, y: 0, radius: 10 },
		obstacle: (x: number): Obstacle | null => (Math.abs(x - 100) < 2 ? 'river' : null),
		bridgeSpans: (x0, _y0, x1, _y1, spans) => {
			if ((x0 - 100) * (x1 - 100) >= 0) return 0;
			const length = Math.abs(x1 - x0);
			const along = (100 - x0) / (x1 - x0);
			spans[0] = along - 3 / length;
			spans[1] = along + 3 / length;
			return 1;
		},
	};

	it('find each deck over the whole line, across a point near the water, and the samples pass under it', () => {
		// A point a unit past the river: the deck runs on into the next segment.
		const points = [50, 0, 101, 0, 150, 0];
		const bridges = polylineBridges(river, points);
		expect(bridges).toHaveLength(1);
		expect(bridges[0].start).toBeCloseTo(47, 9);
		expect(bridges[0].end).toBeCloseTo(53, 9);
		expect(impassableAlong(river, points, bridges)).toBe(-1);
		// A segment at a time, the deck would stop at the point, and the water past it would be impassable.
		expect(impassableAlong(river, points, [{ start: 47, end: 51 }])).toBeGreaterThan(51);
		expect(impassableAlong(river, points, [])).toBeGreaterThan(48);
	});

	it('are checked against the stretch\'s own', () => {
		const network: RoadNetwork = {
			nodes: [{ kind: 'compound', x: 0, y: 0 }, { kind: 'end', x: 150, y: 0 }],
			stretches: [stretch(0, 1, [0, 0, 101, 0, 150, 0])],
			broken: [],
			passes: [],
		};
		expect(checkRoadNetwork({ network, terrain: river }).map(({ rule }) => rule)).toEqual(['bridges', 'passable']);
		const bridged = { ...network, stretches: [{ ...network.stretches[0], bridges: polylineBridges(river, network.stretches[0].points) }] };
		expect(checkRoadNetwork({ network: bridged, terrain: river })).toEqual([]);
	});
});
