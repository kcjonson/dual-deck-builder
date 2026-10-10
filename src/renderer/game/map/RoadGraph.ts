import { chaikin, pointAlong, polylineLength } from './Geometry';
import { simplify } from './Rivers';
import { impassableAlong, polylineBridges, roadClashes, RoadGround } from './RoadChecks';
import { EdgeCostField, MOVES, MOVE_X, MOVE_Y, NEIGHBOURS, OPPOSITE, moveBetween } from './RoadCost';
import type { RoadCells } from './RoadLinks';
import { ROAD_CLASSES, RoadNode, RoadNodeKind, RoadStretch } from './RoadNetwork';

/**
 * Map 8, the road graph (Area Map Generation, 5. Roads, Geometry): the road
 * links' moves on the land grid turned into the network's nodes and
 * stretches. A node is the compound, a place, a junction, the metro's edge, a
 * class change, a dead end, or a roadside point splitting a long stretch;
 * a stretch is the road between two nodes, traced as cells, relaxed,
 * simplified, and smoothed with its nodes and both ends of every bridge held
 * still. Paths that crossed share a cell, so they share a junction and the
 * network is planar. Every node but the compound and roadside points stands
 * on a cell centre, so no two junctions are closer than a cell; the compound
 * stands at the origin, where its four cells meet.
 *
 * A smoothed stretch has to stay passable and keep clear of every other,
 * which each run between holds settles on its own. A smoothed run that
 * clips something is held at the cell nearest where it does, and its two
 * halves smoothed again, so only the cells by the trouble stay cells and a
 * road along a bank stays smooth past it. A run that clashes with another
 * falls back: to its line smoothed without the relaxing, then simplified
 * without smoothing, then its cells, which the edge cost field already
 * proved. A run out of the compound has one more, through the centre of the
 * cell it leaves by, since the line from the origin to the next cell isn't
 * one the field proved.
 */

export const ROAD_GRAPH = {
	/** Douglas-Peucker's tolerance on a stretch's cells, as a share of a cell. */
	simplify: 0.6,
	/** Chaikin passes after simplifying. */
	smoothing: 2,
	/** Passes of a quarter, half, quarter average over a stretch's cells before it's simplified, which takes out steps back and forth between two rows. */
	relaxing: 2,
	/** A stretch longer than this many world units is split at roadside nodes into pieces no longer. */
	longest: 140,
} as const;

export interface RoadGraphStats {
	/** Runs between holds left at each level, best first: smoothed, smoothed without the relaxing, simplified, and as cells, the last counting the compound's fallback too. */
	smoothed: number;
	unaveraged: number;
	simplified: number;
	cells: number;
	/** Runs left as cells three moves long or more: a stair step on the map. */
	stairs: number;
	/** Holds put where a smoothed run clipped something. */
	splits: number;
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
 * roads leaves it once. The move kept takes a highway's number from any it
 * replaced.
 */
function oneWayIn({ classes, highways, compound, placeAt, field }: { classes: Int8Array; highways: Int16Array; compound: readonly number[]; placeAt: Int32Array; field: EdgeCostField }): void {
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
			const highway = ins.find((edge) => highways[edge] >= 0);
			ins.forEach((edge, index) => {
				classes[edge] = index === 0 ? rank : -1;
			});
			if (highways[ins[0]] < 0 && highway !== undefined) highways[ins[0]] = highways[highway];
		}
	}
}

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const floor = Math.floor;

interface Trace {
	readonly from: number;
	readonly to: number;
	readonly rank: number;
	/** A highway's number, -1 on any other class. */
	readonly highway: number;
	/** Its cells, end to end. */
	readonly cells: number[];
}

/** A trace's run between two holds, by the index of each among its cells, with its line at each detail level, best first, each from the one hold to the other. */
interface Run {
	readonly first: number;
	readonly last: number;
	readonly levels: readonly number[][];
}

/** Builds the network's nodes and stretches from the road links' moves (Map 8). */
export function buildRoadGraph({ cells, terrain }: RoadGraphOptions): RoadGraph {
	const { field, placeAt, places } = cells;
	const size = field.size;
	const classes = cells.classes.slice();
	const highways = cells.highways.slice();
	const stats: RoadGraphStats = { smoothed: 0, unaveraged: 0, simplified: 0, cells: 0, stairs: 0, splits: 0, triangles: dropTriangles(classes, highways, field) };
	const compound = compoundCells(placeAt, size);
	oneWayIn({ classes, highways, compound, placeAt, field });
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
		if (place >= 0) {
			const { kind } = places[place];
			return kind === 'metro' ? 'compound' : kind;
		}
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
			const rank = classes[first];
			let highway = -1;
			for (let move = 0; rank === 0 && highway < 0 && move + 1 < trace.length; move += 1) highway = highways[field.edge(trace[move], directionOf(trace[move], trace[move + 1], size))];
			traces.push({ from: nodeAt[start], to: nodeAt[at], rank, highway, cells: trace });
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
		split.push({ ...trace, to: node, cells: trace.cells.slice(0, middle + 1) });
		split.push({ ...trace, from: node, cells: trace.cells.slice(middle) });
	}

	const raws = split.map((trace) => traceCells(trace, nodes, field));
	const runs = split.map((trace, id) => holdsOf(trace, field, size).map((hold, index, held) => (index + 1 < held.length ? makeRun(trace, raws[id], hold, held[index + 1], field) : null))
		.filter((run): run is Run => run !== null));
	const levels = runs.map((list) => list.map(() => 0));
	const lineOf = (id: number) => assemble(runs[id], levels[id]);
	const at = { x: 0, y: 0 };
	/**
	 * A run settled: smoothed if that's passable; where a smoothed run clips
	 * something, held at the cell nearest the trouble and both halves settled
	 * again; and otherwise down a level until passable. The cells always are,
	 * since the field sampled every move that could cross anything.
	 */
	const settle = (id: number, index: number) => {
		for (;;) {
			const run = runs[id][index];
			const level = levels[id][index];
			const points = run.levels[level];
			const clipped = impassableAlong(terrain, points, polylineBridges(terrain, points));
			if (clipped < 0) return;
			if (level === 0 && run.last - run.first >= 2) {
				pointAlong(points, clipped, at);
				const raw = raws[id];
				let hold = run.first + 1;
				let nearest = Infinity;
				for (let cell = run.first + 1; cell < run.last; cell += 1) {
					const dx = raw[2 * cell] - at.x;
					const dy = raw[2 * cell + 1] - at.y;
					if (dx * dx + dy * dy < nearest) {
						nearest = dx * dx + dy * dy;
						hold = cell;
					}
				}
				runs[id].splice(index, 1, makeRun(split[id], raw, run.first, hold, field), makeRun(split[id], raw, hold, run.last, field));
				levels[id].splice(index, 1, 0, 0);
				stats.splits += 1;
				settle(id, index + 1);
				continue;
			}
			if (level >= run.levels.length - 1) return;
			levels[id][index] += 1;
		}
	};
	runs.forEach((list, id) => {
		for (let index = list.length - 1; index >= 0; index -= 1) settle(id, index);
	});
	for (let changed = true; changed;) {
		changed = false;
		const lines = split.map((_trace, id) => lineOf(id));
		const clashes = roadClashes({ nodes, stretches: split.map((trace, id) => ({ from: trace.from, to: trace.to, points: lines[id] })) }, { bySegment: true });
		const degrade = new Set<string>();
		for (const { a, b, segmentA, segmentB } of clashes) {
			degrade.add(`${a} ${runAt(runs[a], levels[a], segmentA)}`);
			degrade.add(`${b} ${runAt(runs[b], levels[b], segmentB)}`);
		}
		for (const key of degrade) {
			const [id, index] = key.split(' ').map(Number);
			if (levels[id][index] >= runs[id][index].levels.length - 1) continue;
			levels[id][index] += 1;
			settle(id, index);
			changed = true;
		}
	}
	runs.forEach((list, id) => list.forEach((run, index) => {
		const level = levels[id][index];
		if (level === 0) stats.smoothed += 1;
		else if (level === 1) stats.unaveraged += 1;
		else if (level === 2) stats.simplified += 1;
		else stats.cells += 1;
		if (level >= 3 && run.last - run.first >= 3) stats.stairs += 1;
	}));

	const stretches: RoadStretch[] = [];
	split.forEach((trace, id) => {
		const points = lineOf(id);
		const roadClass = ROAD_CLASSES[trace.rank];
		for (const piece of splitLong(points, polylineBridges(terrain, points))) {
			const from = piece.first ? trace.from : nodes.length - 1;
			let to = trace.to;
			if (!piece.last) {
				to = nodes.length;
				nodes.push({ kind: 'roadside', x: piece.points[piece.points.length - 2], y: piece.points[piece.points.length - 1] });
			}
			stretches.push(stretchOf({ from, to, roadClass, highway: trace.highway, points: piece.points, terrain, metroSquared }));
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
 * road moves round its square, handing its class on to them, and its
 * highway's number where they have none, so two roads meeting at a corner
 * share a cell rather than make a loop a cell across. Returns how many it
 * dropped.
 */
function dropTriangles(classes: Int8Array, highways: Int16Array, field: EdgeCostField): number {
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
				if (highways[edge] < 0) highways[edge] = highways[diagonal];
			});
			dropped += 1;
		}
	}
	return dropped;
}

/** A trace's cells as a flat line, its first and last at its nodes, the compound's cell giving way to the origin. */
function traceCells(trace: Trace, nodes: readonly RoadNode[], field: RoadCells['field']): number[] {
	const { cells } = trace;
	const raw: number[] = [];
	cells.forEach((cell, index) => {
		if (index === 0) raw.push(nodes[trace.from].x, nodes[trace.from].y);
		else if (index === cells.length - 1) raw.push(nodes[trace.to].x, nodes[trace.to].y);
		else raw.push(field.x(cell), field.y(cell));
	});
	return raw;
}

/** Where a trace is held, by index among its cells: its ends and both ends of every bridge, which so stays straight. */
function holdsOf(trace: Trace, field: RoadCells['field'], size: number): number[] {
	const { cells } = trace;
	const holds = new Set<number>([0, cells.length - 1]);
	for (let move = 0; move + 1 < cells.length; move += 1) {
		if (field.bridged(field.edge(cells[move], directionOf(cells[move], cells[move + 1], size)))) {
			holds.add(move);
			holds.add(move + 1);
		}
	}
	return [...holds].sort((a, b) => a - b);
}

/**
 * A run of a trace's cells from one hold to the next at every detail level:
 * relaxed, simplified, and smoothed; simplified and smoothed; simplified;
 * and its cells. A run out of the compound gets a last level through the
 * centre of the cell it leaves by.
 */
function makeRun(trace: Trace, raw: readonly number[], first: number, last: number, field: RoadCells['field']): Run {
	const tolerance = ROAD_GRAPH.simplify * field.grid.cellSize;
	const smooth = (line: number[]) => {
		let out = line;
		for (let pass = 0; pass < ROAD_GRAPH.smoothing; pass += 1) out = chaikin(out);
		return out;
	};
	const run = raw.slice(2 * first, 2 * last + 2);
	let relaxedRun = run;
	for (let pass = 0; pass < ROAD_GRAPH.relaxing; pass += 1) relaxedRun = relaxed(relaxedRun);
	const simple = simplify(run, tolerance);
	const levels = [smooth(simplify(relaxedRun, tolerance)), smooth(simple), simple, run];
	const { cells } = trace;
	if (first === 0 && trace.from === 0) levels.push([run[0], run[1], field.x(cells[0]), field.y(cells[0]), ...run.slice(2)]);
	else if (last === cells.length - 1 && trace.to === 0) levels.push([...run.slice(0, run.length - 2), field.x(cells[last]), field.y(cells[last]), run[run.length - 2], run[run.length - 1]]);
	return { first, last, levels };
}

/** A trace's line from its runs at their levels, each joint once. */
function assemble(runs: readonly Run[], levels: readonly number[]): number[] {
	const line: number[] = [];
	runs.forEach(({ levels: lines }, run) => {
		const points = lines[levels[run]];
		for (let point = run === 0 ? 0 : 2; point < points.length; point += 1) line.push(points[point]);
	});
	return line;
}

/** The run a segment of a trace's assembled line belongs to, by the segment's index along the line. */
function runAt(runs: readonly Run[], levels: readonly number[], segment: number): number {
	let passed = 0;
	for (let run = 0; run < runs.length; run += 1) {
		passed += runs[run].levels[levels[run]].length / 2 - 1;
		if (segment < passed) return run;
	}
	return runs.length - 1;
}

/**
 * One pass of a quarter, half, quarter average over a flat polyline's inner
 * points, its ends held: a step back and forth between two rows of cells,
 * which no simplifying takes out, averages to the line between them.
 */
function relaxed(points: readonly number[]): number[] {
	const out = points.slice();
	for (let point = 2; point + 2 < points.length; point += 2) {
		out[point] = 0.25 * points[point - 2] + 0.5 * points[point] + 0.25 * points[point + 2];
		out[point + 1] = 0.25 * points[point - 1] + 0.5 * points[point + 1] + 0.25 * points[point + 3];
	}
	return out;
}

interface Piece {
	readonly points: number[];
	readonly first: boolean;
	readonly last: boolean;
}

/**
 * A polyline longer than `ROAD_GRAPH.longest` cut into pieces about that
 * long or less at even shares of its length, the roadside nodes: on a point
 * of the line within a world unit of the share, or else a point put there on
 * its segment, which leaves the line where it was. A share on a bridge moves
 * to the nearer end of its deck.
 */
function splitLong(points: readonly number[], bridges: readonly { start: number; end: number }[]): Piece[] {
	const length = polylineLength(points);
	const parts = Math.ceil(length / ROAD_GRAPH.longest);
	const count = points.length / 2;
	if (parts <= 1) return [{ points: points.slice(), first: true, last: true }];
	const along = new Float64Array(count);
	for (let point = 1; point < count; point += 1) {
		const dx = points[2 * point] - points[2 * point - 2];
		const dy = points[2 * point + 1] - points[2 * point - 1];
		along[point] = along[point - 1] + Math.sqrt(dx * dx + dy * dy);
	}
	const cuts: number[] = [];
	for (let part = 1; part < parts; part += 1) {
		let target = length * part / parts;
		const deck = bridges.find(({ start, end }) => target >= start && target <= end);
		if (deck !== undefined) target = target - deck.start < deck.end - target ? deck.start : deck.end;
		const previous = cuts.length > 0 ? cuts[cuts.length - 1] : 0;
		if (target - previous >= 1 && length - target >= 1) cuts.push(target);
	}
	const pieces: Piece[] = [];
	let piece: number[] = [points[0], points[1]];
	let cut = 0;
	for (let point = 1; point < count; point += 1) {
		while (cut < cuts.length && cuts[cut] < along[point] - 1) {
			const share = (cuts[cut] - along[point - 1]) / (along[point] - along[point - 1]);
			const x = points[2 * point - 2] + (points[2 * point] - points[2 * point - 2]) * share;
			const y = points[2 * point - 1] + (points[2 * point + 1] - points[2 * point - 1]) * share;
			const last = piece.length;
			// Within a unit of the point before, the cut moves onto it.
			if (cuts[cut] - along[point - 1] < 1 && last > 2) {
				pieces.push({ points: piece, first: pieces.length === 0, last: false });
				piece = [piece[last - 2], piece[last - 1]];
			} else {
				piece.push(x, y);
				pieces.push({ points: piece, first: pieces.length === 0, last: false });
				piece = [x, y];
			}
			cut += 1;
		}
		piece.push(points[2 * point], points[2 * point + 1]);
		if (cut < cuts.length && cuts[cut] <= along[point] && point < count - 1) {
			pieces.push({ points: piece, first: pieces.length === 0, last: false });
			piece = [points[2 * point], points[2 * point + 1]];
			cut += 1;
		}
	}
	pieces.push({ points: piece, first: pieces.length === 0, last: true });
	return pieces;
}

function stretchOf({ from, to, roadClass, highway, points, terrain, metroSquared }: {
	from: number; to: number; roadClass: RoadStretch['roadClass']; highway: number; points: number[]; terrain: RoadGround; metroSquared: number;
}): RoadStretch {
	let street = true;
	for (let point = 0; point < points.length && street; point += 2) street = points[point] * points[point] + points[point + 1] * points[point + 1] <= metroSquared;
	const stretch: RoadStretch = { roadClass, from, to, length: polylineLength(points), points, bridges: polylineBridges(terrain, points), street };
	return roadClass === 'highway' && highway >= 0 ? { ...stretch, highway } : stretch;
}
