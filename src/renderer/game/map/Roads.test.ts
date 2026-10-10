import { EdgeCostField } from './RoadCost';
import { ROAD_CLEARANCE, checkRoadNetwork, polylineBridges, roadClashes } from './RoadChecks';
import { ROAD_GRAPH, buildRoadGraph } from './RoadGraph';
import { ROAD_LINKS, RoadPlace, buildRoadCells } from './RoadLinks';
import { ROAD_CLASSES, RoadNetwork, classRank, loopCount } from './RoadNetwork';
import { generateRoads, loopsNeeded, roadsProblems, standInPlaces } from './Roads';
import { createTerrainSample } from './Terrain';
import { MapParamSet } from './MapParams';
import { landFor, roadMap, sampledRoadParamSets } from './roadTesting';

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
	[{ seed: 7, radius: 800 }, { nodes: 328, stretches: 438, hash: 782260726 }],
	[{ seed: 17, environment: 'badlands', radius: 800 }, { nodes: 294, stretches: 372, hash: 27410876 }],
];

const SET: MapParamSet = { seed: 3, radius: 800 };
const land = landFor(SET);
const fieldFor = (curviness = land.params.curviness) => new EdgeCostField({ terrain: land.terrain, rivers: land.water.lines, curviness });
const places = standInPlaces({ terrain: land.terrain, params: land.params, rng: land.rng });
const cellsFor = (options: { loops?: number; trailShare?: number; places?: readonly RoadPlace[] } = {}) => buildRoadCells({
	field: fieldFor(), terrain: land.terrain, places: options.places ?? places, loops: options.loops ?? land.params.loops, trailShare: options.trailShare ?? land.params.trailShare, rng: land.rng,
});
const cells = cellsFor();
const graph = buildRoadGraph({ cells, terrain: land.terrain });

describe('road links', () => {
	it('join every place to the compound, with a highway from every highway exit', () => {
		expect(cells.stats.unreached).toEqual([]);
		expect(cells.stats.highways).toBe(places.filter(({ kind, highway }) => kind === 'exit' && highway).length);
		const exits = graph.nodes.flatMap((node, id) => (node.kind === 'exit' ? [id] : []));
		exits.forEach((exit) => expect(graph.stretches.some(({ from, to, roadClass }) => (from === exit || to === exit) && roadClass === 'highway')).toBe(true));
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
		// The stand-in has no villages, so the crossroads in the ranges stand in for them.
		const rugged = landFor({ seed: 5, radius: 800, ruggedness: 0.9, mountainCoverage: 0.5 });
		const villages = standInPlaces({ terrain: rugged.terrain, params: rugged.params, rng: rugged.rng })
			.map((place): RoadPlace => (place.kind === 'crossroads' ? { ...place, kind: 'village' } : place));
		const laid = buildRoadCells({
			field: new EdgeCostField({ terrain: rugged.terrain, rivers: rugged.water.lines, curviness: rugged.params.curviness }),
			terrain: rugged.terrain, places: villages, loops: rugged.params.loops, trailShare: rugged.params.trailShare, rng: rugged.rng,
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
					expect(places[node.place as number].kind === 'compound' ? 'compound' : places[node.place as number].kind).toBe(node.kind);
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
	const count = Number(process.env.ROAD_PROPERTY_MAPS ?? 6);

	it.each(sampledRoadParamSets(count).map((set, index) => [index, set] as const))('keeps every road guarantee on sampled map %i', (_index, set) => {
		const { network, roads, terrain, params } = roadMap(set);
		expect(checkRoadNetwork({ network, terrain })).toEqual([]);
		expect(roads.stats.links.unreached).toEqual([]);
		expect(loopCount(network)).toBeGreaterThanOrEqual(loopsNeeded(params));
		expect(network.broken.length).toBeLessThanOrEqual(params.brokenHighways);
		network.broken.forEach(({ roadClass, length }) => {
			expect(roadClass).toBe('highway');
			expect(length).toBeGreaterThanOrEqual(70);
		});
		// Planarity holds with the broken spans back in, since they were part of it.
		expect(roadClashes({ nodes: network.nodes, stretches: [...network.stretches, ...network.broken] })).toEqual([]);
		network.stretches.forEach(({ roadClass }) => expect(classRank(roadClass)).toBeGreaterThanOrEqual(0));
	});

	it('fails on too few loops for the POIs, and on a place no road reaches', () => {
		const roads = generateRoads({ terrain: land.terrain, rivers: land.water.lines, params: land.params, places, rng: land.rng });
		expect(roadsProblems(roads, land.params)).toEqual([]);
		const needed = loopsNeeded({ poiDensity: 2, strongholds: 8 });
		expect(needed).toBe(68);
		expect(roadsProblems(roads, { poiDensity: 30, strongholds: 8 })).toEqual([`loops: the roads close ${roads.stats.loops} loops, and the POIs need 908`]);
		const cut = { ...roads, stats: { ...roads.stats, links: { ...roads.stats.links, unreached: [4, 9] } } };
		expect(roadsProblems(cut, land.params)[0]).toBe('reach: no road reaches places 4, 9');
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
			const other = generateRoads({ terrain: land.terrain, rivers: land.water.lines, params: land.params, places: standInPlaces({ terrain: land.terrain, params: land.params, rng: next }), rng: next });
			expect(networkHash(other.network)).not.toBe(networkHash(first.network));
		});
	});

});
