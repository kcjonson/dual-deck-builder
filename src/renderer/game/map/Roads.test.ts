import { EdgeCostField } from './RoadCost';
import { Rng } from '../core/Rng';
import { polylineLength } from './Geometry';
import { ROAD_CLEARANCE, checkRoadNetwork, impassableAlong, polylineBridges, roadClashes } from './RoadChecks';
import { ROAD_GRAPH, buildRoadGraph, splitLong } from './RoadGraph';
import { ROAD_LINKS, RoadPlace, buildRoadCells } from './RoadLinks';
import { ROAD_CLASSES, RoadNetwork, RoadStretch, classRank, loopCount } from './RoadNetwork';
import { LOOPS_PER_PLACE, breakHighways, generateRoads, loopsNeeded, roadsProblems } from './Roads';
import { createTerrainSample } from './Terrain';
import { MapParamSet } from './MapParams';
import { fakeGround, landFor, riverOffDecks, roadMap, sampledRoadParamSets } from './roadTesting';

/** FNV-1a over a typed array's bytes, read as little-endian words: a pin that any one bit moves. */
function hashOf(values: Float64Array): number {
	const view = new DataView(values.buffer, values.byteOffset, values.byteLength);
	let hash = 0x811c9dc5;
	for (let offset = 0; offset < values.byteLength; offset += 4) {
		hash ^= view.getUint32(offset, true);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

/** Every node's place and every stretch's points end to end. */
function networkHash({ nodes, stretches }: RoadNetwork): number {
	const values: number[] = [];
	for (const { x, y } of nodes) values.push(x, y);
	for (const { points, from, to } of stretches) values.push(from, to, ...points);
	return hashOf(Float64Array.from(values));
}

const PINNED: [MapParamSet, { nodes: number; stretches: number; hash: number }][] = [
	[{ seed: 7, radius: 800 }, { nodes: 334, stretches: 460, hash: 3652141985 }],
	[{ seed: 17, environment: 'badlands', radius: 800 }, { nodes: 264, stretches: 330, hash: 121933891 }],
];

const SET: MapParamSet = { seed: 3, radius: 800 };
const land = landFor(SET);
const fieldFor = (curviness = land.params.curviness) => new EdgeCostField({ terrain: land.terrain, rivers: land.water.lines, curviness });
const { places } = land;
const cellsFor = (options: { loops?: number; trailShare?: number; places?: readonly RoadPlace[] } = {}) => buildRoadCells({
	field: fieldFor(), terrain: land.terrain, places: options.places ?? places, loops: options.loops ?? land.params.loops, trailShare: options.trailShare ?? land.params.trailShare, rng: land.rng,
});
const cells = cellsFor();
const graph = buildRoadGraph({ cells, terrain: land.terrain });

describe('road links', () => {
	it('join every place to the compound, with a highway from every highway exit and a road from every back-road exit', () => {
		expect(cells.stats.unreached).toEqual([]);
		const highwayExits = places.filter(({ kind, highway }) => kind === 'exit' && highway).length;
		expect(cells.stats.highways).toBe(highwayExits);
		expect(places.filter(({ kind, highway }) => kind === 'exit' && !highway).length).toBeGreaterThan(0);
		const exits = graph.nodes.flatMap((node, id) => (node.kind === 'exit' ? [id] : []));
		expect(exits).toHaveLength(places.filter(({ kind }) => kind === 'exit').length);
		exits.forEach((exit) => {
			const leaving = graph.stretches.filter(({ from, to }) => from === exit || to === exit);
			expect(leaving.length).toBeGreaterThan(0);
			if (places[graph.nodes[exit].place as number].highway) expect(leaving.some(({ roadClass }) => roadClass === 'highway')).toBe(true);
		});
	});

	it('build a link between places already joined only past the detour, so more go in as loops rises', () => {
		const few = cellsFor({ loops: 0 });
		const many = cellsFor({ loops: 1 });
		expect(many.stats.looped).toBeGreaterThan(few.stats.looped);
		expect(many.stats.skipped).toBeLessThan(few.stats.skipped);
		const loopsOf = (laid: typeof cells) => {
			const { nodes, stretches } = buildRoadGraph({ cells: laid, terrain: land.terrain });
			return loopCount({ nodes, stretches });
		};
		expect(loopsOf(many)).toBeGreaterThan(loopsOf(few));
		// Every link joining places not yet joined goes in whatever loops is.
		expect(many.stats.joined + many.stats.failed).toBe(few.stats.joined + few.stats.failed);
	});

	it('give out to trails across rough country, more readily as trailShare rises', () => {
		const trailUnits = (laid: typeof cells) => {
			let units = 0;
			laid.classes.forEach((rank, edge) => {
				if (rank === 2) units += laid.field.length(edge);
			});
			return units;
		};
		expect(trailUnits(cellsFor({ trailShare: 1 }))).toBeGreaterThan(trailUnits(cellsFor({ trailShare: 0 })));
	});

	it('never lay both diagonals of a square, or bridge over one cell both ways', () => {
		const { field, classes } = cells;
		const size = field.size;
		for (let cell = 0; cell + size + 1 < size * size; cell += 1) {
			const rising = classes[field.edge(cell, 1)];
			const falling = classes[field.edge(cell + 1, 3)];
			expect(rising >= 0 && falling >= 0).toBe(false);
			if (cell >= 1 && cell >= size) {
				const across = classes[field.edge(cell - 1, 8)];
				const along = classes[field.edge(cell - size, 9)];
				expect(across >= 0 && along >= 0).toBe(false);
			}
		}
	});

	it('run spur trails from villages into the high country, each stopping at a dead end', () => {
		const rugged = landFor({ seed: 5, radius: 800, ruggedness: 0.9, mountainCoverage: 0.5, villages: 30 });
		const laid = buildRoadCells({
			field: new EdgeCostField({ terrain: rugged.terrain, rivers: rugged.water.lines, curviness: rugged.params.curviness }),
			terrain: rugged.terrain, places: rugged.places, loops: rugged.params.loops, trailShare: rugged.params.trailShare, rng: rugged.rng,
		});
		expect(laid.stats.spurs).toBeGreaterThan(0);
		expect(laid.spurEnds).toHaveLength(laid.stats.spurs);
		const { nodes } = buildRoadGraph({ cells: laid, terrain: rugged.terrain });
		const field = laid.field;
		laid.spurEnds.forEach((cell) => {
			const node = nodes.find(({ x, y }) => x === field.x(cell) && y === field.y(cell));
			expect(['end', 'junction', 'classChange']).toContain(node?.kind);
		});
		expect(nodes.filter(({ kind }) => kind === 'end').length).toBeGreaterThan(0);
	});
});

describe('the road graph', () => {
	const { nodes, stretches } = graph;
	const { field } = cells;
	const cellSize = field.grid.cellSize;

	it('stands every node on a cell centre but the compound and roadside points, no two junctions closer than a cell', () => {
		expect(nodes[0]).toEqual({ kind: 'compound', x: 0, y: 0, place: 0 });
		const seen = new Set<number>();
		nodes.slice(1).forEach((node) => {
			if (node.kind === 'roadside') return;
			const cell = field.cellAt(node.x, node.y);
			expect(node.x).toBe(field.x(cell));
			expect(node.y).toBe(field.y(cell));
			expect(seen.has(cell)).toBe(false);
			seen.add(cell);
			// Distinct cells are a cell apart at least; the compound's nearest roads leave from beyond its own four.
			expect(node.x * node.x + node.y * node.y).toBeGreaterThanOrEqual(cellSize * cellSize);
		});
	});

	it('marks each node by what happens there', () => {
		const ends = nodes.map(() => [] as number[]);
		stretches.forEach(({ from, to }, id) => {
			ends[from].push(id);
			ends[to].push(id);
		});
		const placeIds = new Set(places.map(({ id }) => id));
		nodes.forEach((node, id) => {
			const meeting = ends[id];
			switch (node.kind) {
				case 'junction':
					expect(meeting.length).toBeGreaterThanOrEqual(3);
					break;
				case 'end':
					expect(meeting).toHaveLength(1);
					break;
				case 'classChange':
					expect(meeting).toHaveLength(2);
					expect(stretches[meeting[0]].roadClass).not.toBe(stretches[meeting[1]].roadClass);
					break;
				case 'metroEdge':
					expect(node.x * node.x + node.y * node.y).toBeLessThanOrEqual(land.terrain.metro.radius * land.terrain.metro.radius);
					break;
				case 'roadside':
					// A broken highway can leave one stretch at a roadside point; the graph alone leaves two.
					expect(meeting).toHaveLength(2);
					break;
				default:
					expect(placeIds.has(node.place as number)).toBe(true);
					expect(places[node.place as number].kind === 'metro' ? 'compound' : places[node.place as number].kind).toBe(node.kind);
			}
		});
		expect(nodes.filter(({ kind }) => kind === 'junction').length).toBeGreaterThan(50);
		expect(nodes.filter(({ kind }) => kind === 'roadside').length).toBeGreaterThan(0);
	});

	it('splits stretches longer than about 140 units at roadside points, and records their bridges and streets', () => {
		stretches.forEach(({ length, points, bridges, street }) => {
			expect(length).toBeLessThanOrEqual(ROAD_GRAPH.longest + 3 * cellSize);
			expect(bridges).toEqual(polylineBridges(land.terrain, points));
			let inside = true;
			for (let point = 0; point < points.length; point += 2) inside &&= points[point] ** 2 + points[point + 1] ** 2 <= land.terrain.metro.radius ** 2;
			expect(street).toBe(inside);
		});
		expect(stretches.some(({ bridges }) => bridges.length > 0)).toBe(true);
		expect(stretches.some(({ street }) => street)).toBe(true);
	});

	it('cuts a long line only where the whole line was sampled, so a sliver its samples stepped over stays stepped over', () => {
		// 301.3 units askew, cut into three at shares that aren't on the half-unit samples; a sliver a thousandth of a unit wide anywhere along the middle third.
		const line = [3, 7, 3 + 301.3 * 0.8, 7 + 301.3 * 0.6];
		let passed = 0;
		for (let along = 100; along < 200; along += 0.0137) {
			const sx = 3 + along * 0.8;
			const ground = fakeGround({ wall: (x) => Math.abs(x - sx) < 0.0005 });
			if (impassableAlong(ground, line, []) >= 0) continue;
			passed += 1;
			const pieces = splitLong(line, []);
			expect(pieces).toHaveLength(3);
			pieces.forEach(({ points }) => expect(impassableAlong(ground, points, [])).toBe(-1));
		}
		expect(passed).toBeGreaterThan(5000);
		// The pieces still split the line evenly, and its points stay where they were.
		const pieces = splitLong(line, []);
		pieces.forEach(({ points }) => expect(Math.abs(polylineLength(points) - 301.3 / 3)).toBeLessThanOrEqual(0.5));
		expect(pieces[1].points[0]).toBeCloseTo(3 + 0.8 * polylineLength(pieces[0].points), 9);
	});

	it('is planar, every stretch clear of the rest, and smoothed where it can be', () => {
		expect(roadClashes({ nodes, stretches })).toEqual([]);
		expect(ROAD_CLEARANCE).toBeGreaterThan(0);
		// Cells only where a smoothed line would clip something.
		const { smoothed, simplified, cells: left } = graph.stats;
		expect(left / (smoothed + simplified + left)).toBeLessThan(0.05);
		stretches.forEach(({ points, roadClass }) => {
			expect(points.length).toBeGreaterThanOrEqual(4);
			expect(ROAD_CLASSES).toContain(roadClass);
		});
	});

	it('marks passes at the high points of roads over ranges', () => {
		const sample = createTerrainSample();
		cells.passes.forEach(({ x, y }) => expect(land.terrain.sample(x, y, sample).mountains).toBeGreaterThanOrEqual(ROAD_LINKS.pass.ranges));
	});
});

describe('the roads stage', () => {
	it('crosses the metro\'s rivers rather than driving down them: Rust Belt 11 at radius 1200 ran its north highway 23 units down one', () => {
		const { network, terrain } = roadMap({ seed: 11, environment: 'rustBelt', radius: 1200 });
		expect(riverOffDecks(network, terrain)).toBe(0);
		// It still bridges them, free, where it crosses.
		const metro = terrain.metro.radius;
		expect(network.stretches.some(({ bridges, points }) => bridges.length > 0 && points[0] ** 2 + points[1] ** 2 < metro * metro)).toBe(true);
	});

	it('numbers each highway stretch by its exit\'s order among the highway exits, and nothing else', () => {
		const exits = places.filter(({ kind, highway }) => kind === 'exit' && highway).length;
		const numbers = new Set<number>();
		graph.stretches.forEach(({ roadClass, highway }) => {
			if (roadClass !== 'highway') {
				expect(highway).toBeUndefined();
				return;
			}
			expect(Number.isInteger(highway)).toBe(true);
			numbers.add(highway as number);
		});
		expect([...numbers].every((number) => number >= 0 && number < exits)).toBe(true);
		expect(numbers.size).toBe(exits);
	});

	const count = Number(process.env.ROAD_PROPERTY_MAPS ?? 6);

	it.each(sampledRoadParamSets(count).map((set, index) => [index, set] as const))('keeps every road guarantee on sampled map %i', (_index, set) => {
		const { network, roads, terrain, params } = roadMap(set);
		expect(checkRoadNetwork({ network, terrain })).toEqual([]);
		expect(riverOffDecks(network, terrain)).toBe(0);
		expect(roads.stats.links.unreached).toEqual([]);
		expect(loopCount(network)).toBeGreaterThanOrEqual(loopsNeeded(params, roads.stats.inland));
		expect(network.broken.length).toBeLessThanOrEqual(params.brokenHighways);
		network.broken.forEach(({ roadClass, length }) => {
			expect(roadClass).toBe('highway');
			expect(length).toBeGreaterThanOrEqual(70);
		});
		// Planarity holds with the broken spans back in, since they were part of it.
		expect(roadClashes({ nodes: network.nodes, stretches: [...network.stretches, ...network.broken] })).toEqual([]);
		network.stretches.forEach(({ roadClass }) => expect(classRank(roadClass)).toBeGreaterThanOrEqual(0));
	});

	it('never breaks the last highway out of a highway exit, though the span further in can break', () => {
		const highway = (from: number, to: number, points: number[], number = 0): RoadStretch => ({ roadClass: 'highway', from, to, length: polylineLength(points), points, bridges: [], street: false, highway: number });
		const backRoad = (from: number, to: number, points: number[]): RoadStretch => ({ roadClass: 'backRoad', from, to, length: polylineLength(points), points, bridges: [], street: false });
		const broken = ({ nodes, stretches, places, radius }: { nodes: RoadNetwork['nodes']; stretches: RoadStretch[]; places: RoadPlace[]; radius: number }) => breakHighways({ nodes, stretches, places, count: 2, radius, rng: new Rng({ seed: 1 }) }).broken;

		// Home, junctions 100 and 200 out, and a highway exit 300 out, on one highway, with a back road from the first junction round to the exit.
		const line: RoadNetwork['nodes'] = [{ kind: 'compound', x: 0, y: 0, place: 0 }, { kind: 'junction', x: 100, y: 0 }, { kind: 'junction', x: 200, y: 0 }, { kind: 'exit', x: 300, y: 0, place: 1 }];
		const inner = highway(1, 2, [100, 0, 200, 0]);
		const outer = highway(2, 3, [200, 0, 300, 0]);
		const lineStretches = [highway(0, 1, [0, 0, 100, 0]), inner, outer, backRoad(1, 3, [100, 0, 200, 40, 300, 0])];
		const exit: RoadPlace = { id: 1, kind: 'exit', x: 300, y: 0, highway: true };
		// Either span past 0.35 of the radius can break, but not both, which would cut the middle junction off; the outer is the exit's only highway, so the inner goes.
		expect(broken({ nodes: line, stretches: lineStretches, places: [exit], radius: 310 })).toEqual([inner]);
		// A back-road exit can lose its outer span.
		expect([[inner], [outer]]).toContainEqual(broken({ nodes: line, stretches: lineStretches, places: [{ ...exit, highway: false }], radius: 310 }));

		// Two highways into one exit from junctions off to either side, and a back road from Home: either can go, and once one has, the other is the exit's last.
		const fork: RoadNetwork['nodes'] = [{ kind: 'compound', x: 0, y: 0, place: 0 }, { kind: 'junction', x: 100, y: 50 }, { kind: 'junction', x: 100, y: -50 }, { kind: 'exit', x: 300, y: 0, place: 1 }];
		const forkStretches = [
			highway(0, 1, [0, 0, 100, 50]), highway(0, 2, [0, 0, 100, -50], 1),
			highway(1, 3, [100, 50, 300, 0]), highway(2, 3, [100, -50, 300, 0], 1),
			backRoad(0, 3, [0, 0, 150, -150, 300, 0]),
		];
		expect(broken({ nodes: fork, stretches: forkStretches, places: [exit], radius: 400 })).toHaveLength(1);
		expect(broken({ nodes: fork, stretches: forkStretches, places: [{ ...exit, highway: false }], radius: 400 })).toHaveLength(2);
	});

	it('fails on too few loops for the POIs, and on a place no road reaches', () => {
		const roads = generateRoads({ terrain: land.terrain, rivers: land.water.lines, params: land.params, places, rng: land.rng });
		expect(roadsProblems(roads, land.params)).toEqual([]);
		expect(roads.stats.inland).toBe(places.filter(({ kind }) => kind === 'town' || kind === 'village' || kind === 'crossroads').length);
		expect(loopsNeeded({ poiDensity: 2, strongholds: 8, loops: 0.5 }, 1000)).toBe(68);
		const crowded = { ...roads, stats: { ...roads.stats, inland: 10000 } };
		expect(roadsProblems(crowded, { poiDensity: 30, strongholds: 8, loops: 0.5 })).toEqual([`loops: the roads close ${roads.stats.loops} loops, and the POIs need 908`]);
		const cut = { ...roads, stats: { ...roads.stats, links: { ...roads.stats.links, unreached: [4, 9] } } };
		expect(roadsProblems(cut, land.params)[0]).toBe('reach: no road reaches places 4, 9');
	});

	it('asks no more loops than a map\'s towns, villages, and crossroads can close, so the high ranges\' few places pass', () => {
		// Past the first four places, three tenths of a loop a place at loops 0, rising to 0.6 from a third up.
		expect(LOOPS_PER_PLACE).toEqual({ first: 4, none: 0.3, rise: 0.9, most: 0.6 });
		expect(loopsNeeded({ poiDensity: 1, strongholds: 4, loops: 0.5 }, 13)).toBe(6);
		expect(loopsNeeded({ poiDensity: 1, strongholds: 4, loops: 0 }, 13)).toBe(3);
		expect(loopsNeeded({ poiDensity: 1, strongholds: 4, loops: 0.15 }, 13)).toBe(4);
		expect(loopsNeeded({ poiDensity: 1, strongholds: 4, loops: 1 }, 3)).toBe(0);
		// The campaign's corner, loops 0.3 and five strongholds at 1.2 times the ring targets, on 78 places, the fewest of 600 rolled maps: no cap.
		expect(loopsNeeded({ poiDensity: 1.2, strongholds: 5, loops: 0.3 }, 78)).toBe(41);
		// All mountains at radius 600: a few villages and crossroads, and the stage passes on them.
		const { network, roads, params } = roadMap({ seed: 1, radius: 600, mountainCoverage: 1, ruggedness: 1, roadDensity: 1 });
		expect(roads.stats.inland).toBeLessThan(20);
		const needed = loopsNeeded(params, roads.stats.inland);
		expect(needed).toBeLessThan(Math.ceil(params.poiDensity * 30) + params.strongholds);
		expect(loopCount(network)).toBeGreaterThanOrEqual(needed);
	});

	describe('determinism', () => {
		// Computed in a separate Node process from the Jest run that checks them.
		it.each(PINNED)('makes the pinned roads for %j', (set, pin) => {
			const { network } = roadMap(set);
			expect({ nodes: network.nodes.length, stretches: network.stretches.length, hash: networkHash(network) }).toEqual(pin);
		});

		it('makes the same roads from the same stream, and others from the next', () => {
			const first = generateRoads({ terrain: land.terrain, rivers: land.water.lines, params: land.params, places, rng: land.rng });
			const again = generateRoads({ terrain: land.terrain, rivers: land.water.lines, params: land.params, places, rng: land.rng });
			expect(networkHash(again.network)).toBe(networkHash(first.network));
			expect(again.network).toEqual(first.network);
			expect(again.network.stretches.length).toBe(graph.stretches.length - first.network.broken.length);
			const next = land.rng.fork('next');
			const other = generateRoads({ terrain: land.terrain, rivers: land.water.lines, params: land.params, places, rng: next });
			expect(networkHash(other.network)).not.toBe(networkHash(first.network));
		});
	});

});
