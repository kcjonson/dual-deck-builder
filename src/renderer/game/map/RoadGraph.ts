import { chaikin } from './Geometry';
import { simplify } from './Rivers';
import { impassableAlong, polylineBridges, polylineLength, roadClashes, RoadGround } from './RoadChecks';
import { EdgeCostField, MOVES, MOVE_X, MOVE_Y, NEIGHBOURS, OPPOSITE, moveBetween } from './RoadCost';
import type { RoadCells } from './RoadLinks';
import { ROAD_CLASSES, RoadNode, RoadNodeKind, RoadStretch } from './RoadNetwork';

/**
 * Map 8, the road graph (Area Map Generation, 5. Roads, Geometry): the road
 * links' moves on the land grid turned into the network's nodes and
 * stretches. A node is the compound, a place, a junction, the metro's edge, a
 * class change, a dead end, or a roadside point splitting a long stretch;
 * a stretch is the road between two nodes, traced as cells, simplified, and
 * smoothed with its nodes and both ends of every bridge held still. Paths
 * that crossed share a cell, so they share a junction and the network is
 * planar. Every node but the compound stands on a cell centre, at least a
 * cell from any other, so no two junctions are closer than a cell; the
 * compound stands at the origin, where its four cells meet.
 *
 * A smoothed stretch has to stay passable and keep clear of every other;
 * one that doesn't falls back to its simplified line, then to its cells,
 * which the edge cost field already proved.
 */

export const ROAD_GRAPH = {
	/** Douglas-Peucker's tolerance on a stretch's cells, as a share of a cell. */
	simplify: 0.6,
	/** Chaikin passes after simplifying. */
	smoothing: 2,
	/** A stretch longer than this many world units is split at roadside nodes into pieces no longer. */
	longest: 140,
} as const;

export interface RoadGraphStats {
	/** Stretches as smoothed, simplified only, and left as cells, after the checks. */
	smoothed: number;
	simplified: number;
	cells: number;
	/** Diagonal moves dropped for closing a triangle with two road moves. */
	triangles: number;
}

export interface RoadGraph {
	readonly nodes: readonly RoadNode[];
	readonly stretches: readonly RoadStretch[];
	readonly stats: RoadGraphStats;
}

export interface RoadGraphOptions {
	readonly cells: RoadCells;
	readonly terrain: RoadGround;
}

/**
 * Leaves each cell at most one road move into the compound's four cells,
 * its best class, ties to the first direction, so each of the compound's
 * roads leaves it once.
 */
function oneWayIn({ classes, compound, placeAt, field }: { classes: Int8Array; compound: readonly number[]; placeAt: Int32Array; field: EdgeCostField }): void {
	const { offsets } = field;
	const done = new Set<number>();
	for (const inner of compound) {
		for (let direction = 0; direction < NEIGHBOURS; direction += 1) {
			const cell = inner + offsets[direction];
			if (placeAt[cell] === 0 || done.has(cell)) continue;
			done.add(cell);
			const ins: number[] = [];
			for (let toward = 0; toward < NEIGHBOURS; toward += 1) {
				const edge = field.edge(cell, toward);
				if (placeAt[cell + offsets[toward]] === 0 && classes[edge] >= 0) ins.push(edge);
			}
			if (ins.length < 2) continue;
			const rank = ins.reduce((best, edge) => (classes[edge] < best ? classes[edge] : best), classes[ins[0]]);
			ins.forEach((edge, index) => {
				classes[edge] = index === 0 ? rank : -1;
			});
		}
	}
}

/** Detail levels a stretch's geometry falls back through. */
const SMOOTHED = 2;
const SIMPLIFIED = 1;
const CELLS = 0;

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const floor = Math.floor;

interface Trace {
	readonly from: number;
	readonly to: number;
	readonly rank: number;
	/** Its cells, end to end. */
	readonly cells: number[];
}

/** Builds the network's nodes and stretches from the road links' moves (Map 8). */
export function buildRoadGraph({ cells, terrain }: RoadGraphOptions): RoadGraph {
	const { field, placeAt, places } = cells;
	const size = field.size;
	const classes = cells.classes.slice();
	const stats: RoadGraphStats = { smoothed: 0, simplified: 0, cells: 0, triangles: dropTriangles(classes, field) };
	const compound = compoundCells(placeAt, size);
	oneWayIn({ classes, compound, placeAt, field });
	const metro = terrain.metro.radius;
	const metroSquared = metro * metro;
	const insideMetro = (cell: number) => {
		const x = field.x(cell);
		const y = field.y(cell);
		return x * x + y * y <= metroSquared;
	};

	// Each cell's road moves as a bit per direction, bar moves between the compound's own cells.
	const mask = new Uint16Array(size * size);
	for (let edge = 0; edge < classes.length; edge += 1) {
		if (classes[edge] < 0) continue;
		const { cell, direction } = field.ends(edge);
		const next = cell + field.offsets[direction];
		if (placeAt[cell] === 0 && placeAt[next] === 0) continue;
		mask[cell] |= 1 << direction;
		mask[next] |= 1 << OPPOSITE[direction];
	}
	const neighbours = (cell: number): { next: number; rank: number }[] => {
		const found: { next: number; rank: number }[] = [];
		const bits = mask[cell];
		for (let direction = 0; direction < MOVES; direction += 1) {
			if ((bits & (1 << direction)) !== 0) found.push({ next: cell + field.offsets[direction], rank: classes[field.edge(cell, direction)] });
		}
		return found;
	};
	const kindOf = (cell: number): RoadNodeKind | null => {
		const place = placeAt[cell];
		if (place === 0) return 'compound';
		if (place > 0) return places[place].kind === 'compound' ? 'junction' : places[place].kind;
		const around = neighbours(cell);
		if (around.length === 0) return null;
		if (around.length >= 3) return 'junction';
		if (around.length === 1) return 'end';
		if (insideMetro(cell) && around.some(({ next }) => !insideMetro(next))) return 'metroEdge';
		if (around[0].rank !== around[1].rank) return 'classChange';
		return null;
	};

	const nodes: RoadNode[] = [{ kind: 'compound', x: 0, y: 0, place: 0 }];
	const nodeAt = new Int32Array(size * size).fill(-1);
	for (let cell = 0; cell < size * size; cell += 1) {
		if (placeAt[cell] === 0) {
			nodeAt[cell] = 0;
			continue;
		}
		if (mask[cell] === 0) continue;
		const kind = kindOf(cell);
		if (kind === null) continue;
		nodeAt[cell] = nodes.length;
		const place = placeAt[cell];
		nodes.push(place > 0 ? { kind, x: field.x(cell), y: field.y(cell), place: places[place].id } : { kind, x: field.x(cell), y: field.y(cell) });
	}

	// Walk every road from each node to the next, each move once.
	const walked = new Uint8Array(classes.length);
	const traces: Trace[] = [];
	const starts: number[] = [...compound];
	for (let cell = 0; cell < size * size; cell += 1) if (nodeAt[cell] > 0) starts.push(cell);
	starts.sort((a, b) => nodeAt[a] - nodeAt[b] || a - b);
	for (const start of starts) {
		for (let direction = 0; direction < MOVES; direction += 1) {
			if ((mask[start] & (1 << direction)) === 0) continue;
			const first = field.edge(start, direction);
			if (walked[first] === 1) continue;
			const next = start + field.offsets[direction];
			walked[first] = 1;
			const trace = [start, next];
			let previous = start;
			let at = next;
			while (nodeAt[at] < 0) {
				const onward = neighbours(at).find(({ next: candidate }) => candidate !== previous && walked[field.edge(at, directionOf(at, candidate, size))] === 0);
				if (onward === undefined) break;
				walked[field.edge(at, directionOf(at, onward.next, size))] = 1;
				previous = at;
				at = onward.next;
				trace.push(at);
			}
			if (nodeAt[at] < 0) continue;
			traces.push({ from: nodeAt[start], to: nodeAt[at], rank: classes[first], cells: trace });
		}
	}

	// A loop back to its own node is split at its middle, so every stretch joins two nodes.
	const split: Trace[] = [];
	for (const trace of traces) {
		if (trace.from !== trace.to || trace.cells.length < 3) {
			if (trace.from !== trace.to) split.push(trace);
			continue;
		}
		const middle = floor(trace.cells.length / 2);
		const cell = trace.cells[middle];
		const node = nodes.length;
		nodes.push({ kind: 'roadside', x: field.x(cell), y: field.y(cell) });
		nodeAt[cell] = node;
		split.push({ from: trace.from, to: node, rank: trace.rank, cells: trace.cells.slice(0, middle + 1) });
		split.push({ from: node, to: trace.to, rank: trace.rank, cells: trace.cells.slice(middle) });
	}

	const lines = split.map((trace) => traceLines(trace, nodes, field, size));
	const levels = new Int8Array(lines.length).fill(SMOOTHED);
	const bridgesOf = lines.map((line) => line.map((points) => polylineBridges(terrain, points)));
	// Down a level until passable; the cells always are, since the field sampled every move that could cross anything.
	const settle = (id: number) => {
		while (levels[id] > CELLS && impassableAlong(terrain, lines[id][levels[id]], bridgesOf[id][levels[id]]) >= 0) levels[id] -= 1;
	};
	lines.forEach((_line, id) => settle(id));
	for (let changed = true; changed;) {
		changed = false;
		const clashes = roadClashes({ nodes, stretches: split.map((trace, id) => ({ from: trace.from, to: trace.to, points: lines[id][levels[id]] })) });
		const clashing = new Set<number>();
		for (const { a, b } of clashes) {
			clashing.add(a);
			clashing.add(b);
		}
		for (const id of clashing) {
			if (levels[id] === CELLS) continue;
			levels[id] -= 1;
			settle(id);
			changed = true;
		}
	}
	levels.forEach((level) => {
		if (level === SMOOTHED) stats.smoothed += 1;
		else if (level === SIMPLIFIED) stats.simplified += 1;
		else stats.cells += 1;
	});

	const stretches: RoadStretch[] = [];
	split.forEach((trace, id) => {
		const points = lines[id][levels[id]];
		const roadClass = ROAD_CLASSES[trace.rank];
		for (const piece of splitLong(points, bridgesOf[id][levels[id]])) {
			const from = piece.first ? trace.from : nodes.length - 1;
			let to = trace.to;
			if (!piece.last) {
				to = nodes.length;
				nodes.push({ kind: 'roadside', x: piece.points[piece.points.length - 2], y: piece.points[piece.points.length - 1] });
			}
			stretches.push(stretchOf({ from, to, roadClass, points: piece.points, terrain, metroSquared }));
		}
	});
	return { nodes, stretches, stats };
}

/** The compound's four cells, round the origin. */
function compoundCells(placeAt: Int32Array, size: number): number[] {
	const middle = size / 2;
	return [(middle - 1) * size + middle - 1, (middle - 1) * size + middle, middle * size + middle - 1, middle * size + middle].filter((cell) => placeAt[cell] === 0);
}

function directionOf(cell: number, next: number, size: number): number {
	const dx = (next % size) - (cell % size);
	const dy = floor(next / size) - floor(cell / size);
	return moveBetween(dx, dy);
}

/**
 * Drops each diagonal road move that closes a triangle with two orthogonal
 * road moves round its square, handing its class on to them, so two roads
 * meeting at a corner share a cell rather than make a loop a cell across.
 * Returns how many it dropped.
 */
function dropTriangles(classes: Int8Array, field: EdgeCostField): number {
	const { offsets, size } = field;
	let dropped = 0;
	for (let cell = 0; cell < size * size; cell += 1) {
		for (const direction of [1, 3]) {
			const diagonal = field.edge(cell, direction);
			const rank = classes[diagonal];
			if (rank < 0) continue;
			const next = cell + offsets[direction];
			const side = cell + MOVE_X[direction];
			const above = cell + MOVE_Y[direction] * size;
			// Round by the side: cell to side, then side up to next; or up first, then across.
			const viaSide = [field.edge(cell, directionOf(cell, side, size)), field.edge(side, directionOf(side, next, size))];
			const viaAbove = [field.edge(cell, directionOf(cell, above, size)), field.edge(above, directionOf(above, next, size))];
			const round = [viaSide, viaAbove].find((edges) => edges.every((edge) => classes[edge] >= 0));
			if (round === undefined) continue;
			classes[diagonal] = -1;
			round.forEach((edge) => {
				if (rank < classes[edge]) classes[edge] = rank;
			});
			dropped += 1;
		}
	}
	return dropped;
}

/**
 * A trace's polyline at each detail level, cells, simplified, and smoothed,
 * from its first node to its last. The compound's cell gives way to the
 * origin. Nodes and both ends of every bridge are held still: each run
 * between holds is simplified and smoothed on its own, and a bridge's move
 * stays straight.
 */
function traceLines(trace: Trace, nodes: readonly RoadNode[], field: RoadCells['field'], size: number): number[][] {
	const { cells } = trace;
	const raw: number[] = [];
	cells.forEach((cell, index) => {
		if (index === 0) raw.push(nodes[trace.from].x, nodes[trace.from].y);
		else if (index === cells.length - 1) raw.push(nodes[trace.to].x, nodes[trace.to].y);
		else raw.push(field.x(cell), field.y(cell));
	});
	const holds = new Set<number>([0, cells.length - 1]);
	for (let move = 0; move + 1 < cells.length; move += 1) {
		if (field.bridged(field.edge(cells[move], directionOf(cells[move], cells[move + 1], size)))) {
			holds.add(move);
			holds.add(move + 1);
		}
	}
	const held = [...holds].sort((a, b) => a - b);
	const tolerance = ROAD_GRAPH.simplify * field.grid.cellSize;
	const simplified: number[] = [raw[0], raw[1]];
	const smoothed: number[] = [raw[0], raw[1]];
	for (let hold = 0; hold + 1 < held.length; hold += 1) {
		const run = raw.slice(2 * held[hold], 2 * held[hold + 1] + 2);
		const simple = simplify(run, tolerance);
		let smooth = simple;
		for (let pass = 0; pass < ROAD_GRAPH.smoothing; pass += 1) smooth = chaikin(smooth);
		for (let point = 2; point < simple.length; point += 1) simplified.push(simple[point]);
		for (let point = 2; point < smooth.length; point += 1) smoothed.push(smooth[point]);
	}
	return [raw, simplified, smoothed];
}

interface Piece {
	readonly points: number[];
	readonly first: boolean;
	readonly last: boolean;
}

/**
 * A polyline longer than `ROAD_GRAPH.longest` cut at the points nearest even
 * shares of its length into pieces about that long or less, never on a
 * bridge: the roadside nodes.
 */
function splitLong(points: readonly number[], bridges: readonly { start: number; end: number }[]): Piece[] {
	const length = polylineLength(points);
	const parts = Math.ceil(length / ROAD_GRAPH.longest);
	const count = points.length / 2;
	if (parts <= 1 || count < 3) return [{ points: points.slice(), first: true, last: true }];
	const along = new Float64Array(count);
	for (let point = 1; point < count; point += 1) {
		const dx = points[2 * point] - points[2 * point - 2];
		const dy = points[2 * point + 1] - points[2 * point - 1];
		along[point] = along[point - 1] + Math.sqrt(dx * dx + dy * dy);
	}
	const cuts: number[] = [];
	let previous = 0;
	for (let part = 1; part < parts; part += 1) {
		const target = length * part / parts;
		let best = -1;
		for (let point = previous + 1; point < count - 1; point += 1) {
			if (bridges.some(({ start, end }) => along[point] >= start && along[point] <= end)) continue;
			if (best < 0 || Math.abs(along[point] - target) < Math.abs(along[best] - target)) best = point;
		}
		if (best < 0) break;
		cuts.push(best);
		previous = best;
	}
	const pieces: Piece[] = [];
	let start = 0;
	[...cuts, count - 1].forEach((end, index, all) => {
		pieces.push({ points: points.slice(2 * start, 2 * end + 2), first: index === 0, last: index === all.length - 1 });
		start = end;
	});
	return pieces;
}

function stretchOf({ from, to, roadClass, points, terrain, metroSquared }: {
	from: number; to: number; roadClass: RoadStretch['roadClass']; points: number[]; terrain: RoadGround; metroSquared: number;
}): RoadStretch {
	let street = true;
	for (let point = 0; point < points.length && street; point += 2) street = points[point] * points[point] + points[point + 1] * points[point + 1] <= metroSquared;
	return { roadClass, from, to, length: polylineLength(points), points, bridges: polylineBridges(terrain, points), street };
}
