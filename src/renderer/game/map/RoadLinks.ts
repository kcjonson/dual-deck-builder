import type { Rng } from '../core/Rng';
import { unitVector } from './Geometry';
import { EdgeCostField, MOVES, MOVE_X, MOVE_Y, NEIGHBOURS, OPPOSITE, moveBetween } from './RoadCost';
import type { Terrain } from './Terrain';
import { createTerrainSample } from './Terrain';

/**
 * Map 7, road links (Area Map Generation, 5. Roads): least-cost paths
 * between places over the edge cost field, laid as moves between land
 * cells. Highways first, from each highway exit to the compound through the
 * best town near its bearing, then back roads along the Gabriel graph's
 * links over every place, shortest first. A link joining places the roads
 * don't yet connect always goes in; one between places already connected
 * goes in only where the roads between them run longer than its own path by
 * the detour factor `loops` sets (Galin et al.'s test). Then a few spur
 * trails into the high country from villages, and back roads give out to
 * trails where they cross rough country, by `trailShare`.
 *
 * Every search is A* over the field's moves, bounded to an ellipse round its
 * two ends. Existing road is a little cheaper than new ground, so roads
 * merge into trunks, and ground beside a road dearer, so a road joins
 * another or keeps its distance. A move never crosses a road's diagonal, or a
 * bridge two cells long another over the same cell, and never closes a
 * triangle with two road moves, so where two paths meet they share a cell,
 * and the graph (RoadGraph.ts) makes it a junction. Ties go to the
 * lower cell index, and every number is adds, multiplies, divides, compares,
 * and square roots, so a seed's roads are the same in every engine.
 * Starting values are provisional calls, listed in
 * docs/AI_TECHNICAL_DECISIONS/road-network.md.
 */

export type RoadPlaceKind = 'compound' | 'town' | 'village' | 'crossroads' | 'exit';

/** A place the roads join, as the places stage lists it. */
export interface RoadPlace {
	/** Its id in the places list; the compound is 0. */
	readonly id: number;
	readonly kind: RoadPlaceKind;
	readonly x: number;
	readonly y: number;
	/** An exit's: a highway leaves the area there, rather than a back road. */
	readonly highway?: boolean;
}

export const ROAD_LINKS = {
	/** Searches stay inside an ellipse round a link's ends, its straight span times `bound` plus `boundSlack` cells. */
	bound: 1.7,
	boundSlack: 3,
	/** A search that finds nothing inside its ellipse tries again in one this many times wider. */
	widen: 2.5,
	/** Candidate back roads: Gabriel pairs of places under this share of the radius apart, exits never with exits. */
	longest: 0.45,
	/** The Gabriel test's circle, as a share of the diametral circle's area, so a place right on its edge doesn't knock a link out. */
	gabriel: 0.92,
	/** Existing road costs this share of new ground's to drive... */
	reuse: 0.75,
	/** ...and existing highway this share, to a highway, so highways merge into trunks. */
	highwayReuse: 0.7,
	/** Ground right beside a road costs this many times its own. */
	beside: 1.6,
	/** The detour factor: a link between connected places goes in past a detour of `detour.none` at `loops` 0 to `detour.all` at 1. */
	detour: { none: 1.9, all: 1.1 },
	/** A highway runs through the best town within `degrees` of its exit's bearing, between `inner` and `outer` of the radius out. */
	highwayTown: { degrees: 24, inner: 0.25, outer: 0.9 },
	/** A back road's run through rough country this long or longer is a trail: `none` world units at `trailShare` 0 to `all` at 1. */
	trailRun: { none: 150, all: 15 },
	/**
	 * Spur trails: a village takes one with chance `chance`, toward the highest
	 * open ground `near` to `far` world units off at `bearings` bearings and
	 * `rings` distances, at least `rise` of elevation above it, if a trail
	 * there runs no longer than `longest`.
	 */
	spurs: { chance: 0.55, near: 60, far: 140, bearings: 16, rings: 3, rise: 0.12, longest: 200 },
	/** A path's highest cell is a pass where the ranges' mask is `ranges` or more and it stands `rise` above both ends, `spacing` world units from any other. */
	pass: { ranges: 0.5, rise: 0.05, spacing: 30 },
} as const;

export interface RoadLinkStats {
	/** Searches run, and cells they expanded. */
	searches: number;
	expanded: number;
	highways: number;
	/** Back road candidates, and how each went. */
	candidates: number;
	joined: number;
	looped: number;
	skipped: number;
	failed: number;
	/** Places still cut off after the links, joined to the network by their cheapest way. */
	stragglers: number;
	spurs: number;
	/** Places no road reaches, by id. */
	unreached: number[];
}

/** The road links as moves on the land grid, which RoadGraph.ts turns into nodes and stretches. */
export interface RoadCells {
	readonly field: EdgeCostField;
	readonly places: readonly RoadPlace[];
	/** Per move, the best class of the roads along it as a rank (0 highway, 1 back road, 2 trail), -1 where there's none. */
	readonly classes: Int8Array;
	/** Per move, the highway laid along it first, counted in the order the highway exits come in the places list from 0; -1 for none. */
	readonly highways: Int16Array;
	/** Per place, the cell it stands on, -1 for one with nowhere to stand; the compound's is the first of its four. */
	readonly placeCells: Int32Array;
	/** Per cell, the place standing on it, -1 for none. The compound stands on the four cells round the origin. */
	readonly placeAt: Int32Array;
	/** Cells where spur trails stop. */
	readonly spurEnds: readonly number[];
	/** The highest cells of roads over ranges. */
	readonly passes: readonly { readonly x: number; readonly y: number }[];
	readonly stats: RoadLinkStats;
}

export interface RoadLinkOptions {
	readonly field: EdgeCostField;
	/** The land with its water: rough country for the trails, and the ranges for passes and spurs. */
	readonly terrain: Pick<Terrain, 'radius' | 'rough' | 'sample'>;
	/** Index 0 the compound at the origin, then every other place, ids as listed. */
	readonly places: readonly RoadPlace[];
	readonly loops: number;
	readonly trailShare: number;
	/** The roads stage's stream: spurs draw on its `spur` forks, one per village. */
	readonly rng: Rng;
}

const HIGHWAY = 0;
const BACK_ROAD = 1;
const TRAIL = 2;

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;

/** Lays every road link over the field (Map 7). */
export function buildRoadCells(options: RoadLinkOptions): RoadCells {
	return new RoadBuilder(options).build();
}

interface Ends {
	/** Cells a search may start on, or end on. */
	readonly cells: readonly number[];
	/** The place's point, the ellipse's focus and the heuristic's aim... */
	readonly x: number;
	readonly y: number;
	/** ...and how far its cells' centres lie from it at most. */
	readonly reach: number;
}

class RoadBuilder {
	private readonly field: EdgeCostField;
	private readonly terrain: RoadLinkOptions['terrain'];
	private readonly places: readonly RoadPlace[];
	private readonly rng: Rng;
	private readonly size: number;
	private readonly cellSize: number;
	private readonly columnX: Float64Array;
	private readonly rowY: Float64Array;
	private readonly detour: number;
	private readonly trailRun: number;

	private readonly classes: Int8Array;
	private readonly highways: Int16Array;
	/** Per cell, a bit for each move a road leaves it by. */
	private readonly roadMask: Uint16Array;
	/** Per cell, 1 where a road bridges over it east to west, 2 north to south. */
	private readonly leaps: Uint8Array;
	/** Per cell, 1 on or beside a road. */
	private readonly near: Uint8Array;
	private readonly placeCells: Int32Array;
	private readonly placeAt: Int32Array;
	private readonly ends: (Ends | null)[];
	private readonly unionParent: Int32Array;
	/** Per cell, 1 rough, 0 not, -1 not looked at yet. */
	private readonly roughCells: Int8Array;
	private readonly spurEnds: number[] = [];
	private readonly passes: { x: number; y: number }[] = [];
	private readonly stats: RoadLinkStats = {
		searches: 0, expanded: 0, highways: 0, candidates: 0, joined: 0, looped: 0, skipped: 0, failed: 0, stragglers: 0, spurs: 0, unreached: [],
	};

	// The searches' scratch, reused: a cell's score is good while its stamp is the search's.
	private readonly score: Float64Array;
	private readonly came: Int32Array;
	private readonly seen: Uint32Array;
	private readonly done: Uint32Array;
	private readonly goal: Uint32Array;
	private stamp = 0;
	private heapKeys = new Float64Array(4096);
	private heapCells = new Int32Array(4096);
	private heapSize = 0;
	private readonly sample = createTerrainSample();

	constructor({ field, terrain, places, loops, trailShare, rng }: RoadLinkOptions) {
		if (places.length === 0 || places[0].kind !== 'compound') throw new RangeError('buildRoadCells: place 0 must be the compound');
		this.field = field;
		this.terrain = terrain;
		this.places = places;
		this.rng = rng;
		const size = field.size;
		this.size = size;
		this.cellSize = field.grid.cellSize;
		this.columnX = Float64Array.from({ length: size }, (_value, column) => field.x(column));
		this.rowY = Float64Array.from({ length: size }, (_value, row) => field.y(row * size));
		this.detour = ROAD_LINKS.detour.none + (ROAD_LINKS.detour.all - ROAD_LINKS.detour.none) * loops;
		this.trailRun = ROAD_LINKS.trailRun.none + (ROAD_LINKS.trailRun.all - ROAD_LINKS.trailRun.none) * trailShare;
		const cells = size * size;
		this.classes = new Int8Array(field.edges).fill(-1);
		this.highways = new Int16Array(field.edges).fill(-1);
		this.roadMask = new Uint16Array(cells);
		this.leaps = new Uint8Array(cells);
		this.near = new Uint8Array(cells);
		this.roughCells = new Int8Array(cells).fill(-1);
		this.score = new Float64Array(cells);
		this.came = new Int32Array(cells);
		this.seen = new Uint32Array(cells);
		this.done = new Uint32Array(cells);
		this.goal = new Uint32Array(cells);
		this.placeCells = new Int32Array(places.length).fill(-1);
		this.placeAt = new Int32Array(cells).fill(-1);
		this.unionParent = Int32Array.from(places, (_place, id) => id);
		this.ends = places.map((place, id) => this.attach(place, id));
	}

	public build(): RoadCells {
		this.layHighways();
		this.layBackRoads();
		this.joinStragglers();
		this.laySpurs();
		const root = this.find(0);
		this.places.forEach((_place, id) => {
			if (this.find(id) !== root) this.stats.unreached.push(id);
		});
		return {
			field: this.field,
			places: this.places,
			classes: this.classes,
			highways: this.highways,
			placeCells: this.placeCells,
			placeAt: this.placeAt,
			spurEnds: this.spurEnds,
			passes: this.passes,
			stats: this.stats,
		};
	}

	/**
	 * Where a place stands on the grid: the compound on the four cells round
	 * the origin, any other place on the open cell nearest its point, its own
	 * or a neighbour, that no other place stands on.
	 */
	private attach(place: RoadPlace, id: number): Ends | null {
		const { field, size } = this;
		if (id === 0) {
			const middle = size / 2;
			const cells = [(middle - 1) * size + middle - 1, (middle - 1) * size + middle, middle * size + middle - 1, middle * size + middle];
			cells.forEach((cell) => {
				this.placeAt[cell] = 0;
			});
			this.placeCells[0] = cells[0];
			return { cells, x: 0, y: 0, reach: sqrt(0.5) * this.cellSize };
		}
		const home = field.cellAt(place.x, place.y);
		if (home < 0) return null;
		const candidates: { cell: number; distance: number }[] = [];
		for (let dy = -1; dy <= 1; dy += 1) {
			for (let dx = -1; dx <= 1; dx += 1) {
				const cell = home + dy * size + dx;
				const ox = field.x(cell) - place.x;
				const oy = field.y(cell) - place.y;
				candidates.push({ cell, distance: ox * ox + oy * oy });
			}
		}
		candidates.sort((a, b) => a.distance - b.distance || a.cell - b.cell);
		const chosen = candidates.find(({ cell }) => field.open[cell] === 1 && this.placeAt[cell] < 0);
		if (chosen === undefined) return null;
		this.placeAt[chosen.cell] = id;
		this.placeCells[id] = chosen.cell;
		return { cells: [chosen.cell], x: place.x, y: place.y, reach: sqrt(chosen.distance) };
	}

	/**
	 * From each highway exit to the compound, through the best town within
	 * `highwayTown.degrees` of its bearing: the first such town in the list,
	 * which comes best ground first. Existing highway is cheaper to a highway,
	 * so the later ones merge into the earlier near the city. Each move keeps
	 * the first highway laid along it, by its exit's order among the highway
	 * exits.
	 */
	private layHighways(): void {
		const { places, terrain } = this;
		const { degrees, inner, outer } = ROAD_LINKS.highwayTown;
		const within = unitVector(degrees, { x: 0, y: 0 }).x;
		const radius = terrain.radius;
		let highway = -1;
		places.forEach((exit, id) => {
			if (exit.kind !== 'exit' || exit.highway !== true) return;
			highway += 1;
			if (this.ends[id] === null) return;
			const exitDistance = sqrt(exit.x * exit.x + exit.y * exit.y);
			const town = places.findIndex((place, townId) => {
				if (place.kind !== 'town' || this.ends[townId] === null) return false;
				const distance = sqrt(place.x * place.x + place.y * place.y);
				if (distance < inner * radius || distance > outer * radius) return false;
				return (place.x * exit.x + place.y * exit.y) / (distance * exitDistance) >= within;
			});
			const legs: [number, number][] = town >= 0 ? [[id, town], [town, 0]] : [[id, 0]];
			let laid = legs.every(([from, to]) => this.link(from, to, HIGHWAY, highway));
			if (!laid && town >= 0) laid = this.link(id, 0, HIGHWAY, highway);
			if (laid) this.stats.highways += 1;
		});
	}

	/**
	 * The Gabriel graph's links over every place, shortest first, ties by the
	 * places' ids: a link joining places not yet connected always goes in,
	 * one between connected places only past the detour.
	 */
	private layBackRoads(): void {
		const links = this.candidateLinks();
		this.stats.candidates = links.length;
		for (const { a, b, span } of links) {
			if (this.find(a) !== this.find(b)) {
				if (this.link(a, b, BACK_ROAD) || this.link(a, b, TRAIL)) this.stats.joined += 1;
				else this.stats.failed += 1;
				continue;
			}
			// The path can't be shorter than the straight span, so roads within the detour of that need no search.
			const limit = this.detour * (ROAD_LINKS.bound * span + 2 * ROAD_LINKS.boundSlack * this.cellSize);
			const around = this.networkDistance(a, b, limit);
			if (around <= this.detour * span) {
				this.stats.skipped += 1;
				continue;
			}
			const path = this.search(a, b, BACK_ROAD, ROAD_LINKS.bound);
			if (path === null) {
				this.stats.failed += 1;
				continue;
			}
			if (around <= this.detour * this.pathLength(path)) {
				this.stats.skipped += 1;
				continue;
			}
			this.lay(path, BACK_ROAD);
			this.stats.looped += 1;
		}
	}

	/** Places still cut off after the links join the network by their cheapest way to any road the compound reaches. */
	private joinStragglers(): void {
		const root = this.find(0);
		this.places.forEach((_place, id) => {
			if (this.find(id) === root || this.ends[id] === null) return;
			const reached = this.reachedRoads();
			for (const rank of [BACK_ROAD, TRAIL]) {
				const path = this.searchTo(id, reached, rank);
				if (path === null) continue;
				this.lay(path, rank);
				this.unite(id, 0);
				this.stats.stragglers += 1;
				return;
			}
		});
	}

	/**
	 * Spur trails into the high country from villages near it, to passes,
	 * mines, and lookouts: each village draws on its own `spur` fork whether it
	 * takes one, and the bearings it looks along.
	 */
	private laySpurs(): void {
		const { field, places } = this;
		const { chance, near, far, bearings, rings, rise, longest } = ROAD_LINKS.spurs;
		const direction = { x: 0, y: 0 };
		places.forEach((village, id) => {
			if (village.kind !== 'village' || this.ends[id] === null) return;
			const draws = this.rng.fork('spur', id);
			if (draws.float() >= chance) return;
			const turn = draws.float() * 360 / bearings;
			const start = this.placeCells[id];
			let target = -1;
			let highest = field.elevation[start] + rise;
			for (let bearing = 0; bearing < bearings; bearing += 1) {
				unitVector(turn + bearing * 360 / bearings, direction);
				for (let ring = 0; ring < rings; ring += 1) {
					const distance = near + (far - near) * ring / (rings - 1);
					const cell = field.cellAt(village.x + direction.x * distance, village.y + direction.y * distance);
					if (cell < 0 || field.open[cell] === 0 || this.near[cell] === 1 || this.placeAt[cell] >= 0) continue;
					const height = field.elevation[cell];
					if (height > highest || (height === highest && target >= 0 && cell < target)) {
						highest = height;
						target = cell;
					}
				}
			}
			if (target < 0) return;
			const ends: Ends = { cells: [target], x: field.x(target), y: field.y(target), reach: 0 };
			const path = this.searchBetween(ends, this.ends[id] as Ends, TRAIL, ROAD_LINKS.bound);
			if (path === null || this.pathLength(path) > longest) return;
			this.lay(path, TRAIL);
			this.spurEnds.push(target);
			this.stats.spurs += 1;
		});
	}

	/** Lays a link between two places, if a path exists, and joins them; false when none does. */
	private link(a: number, b: number, rank: number, highway = -1): boolean {
		if (this.ends[a] === null || this.ends[b] === null) return false;
		const path = this.search(a, b, rank, ROAD_LINKS.bound) ?? this.search(a, b, rank, ROAD_LINKS.bound * ROAD_LINKS.widen);
		if (path === null) return false;
		this.lay(path, rank, highway);
		this.unite(a, b);
		return true;
	}

	/** Gabriel pairs of places under `longest` of the radius apart, exits never with exits, shortest first. */
	private candidateLinks(): { a: number; b: number; span: number }[] {
		const places = this.places;
		const longest = ROAD_LINKS.longest * this.terrain.radius;
		const bucket = longest / 2;
		const buckets = new Map<number, number[]>();
		const keyOf = (column: number, row: number) => row * 4096 + column;
		const usable = places.map((_place, id) => this.ends[id] !== null);
		places.forEach((place, id) => {
			if (!usable[id]) return;
			const key = keyOf(floor(place.x / bucket) + 2048, floor(place.y / bucket) + 2048);
			const list = buckets.get(key);
			if (list) list.push(id);
			else buckets.set(key, [id]);
		});
		const links: { a: number; b: number; span: number }[] = [];
		for (let a = 0; a < places.length; a += 1) {
			if (!usable[a]) continue;
			for (let b = a + 1; b < places.length; b += 1) {
				if (!usable[b] || (places[a].kind === 'exit' && places[b].kind === 'exit')) continue;
				const dx = places[b].x - places[a].x;
				const dy = places[b].y - places[a].y;
				const squared = dx * dx + dy * dy;
				if (squared > longest * longest) continue;
				const mx = places[a].x + 0.5 * dx;
				const my = places[a].y + 0.5 * dy;
				const inside = 0.25 * squared * ROAD_LINKS.gabriel;
				const reach = sqrt(0.25 * squared);
				let gabriel = true;
				for (let row = floor((my - reach) / bucket); row <= floor((my + reach) / bucket) && gabriel; row += 1) {
					for (let column = floor((mx - reach) / bucket); column <= floor((mx + reach) / bucket) && gabriel; column += 1) {
						for (const other of buckets.get(keyOf(column + 2048, row + 2048)) ?? []) {
							if (other === a || other === b) continue;
							const ox = places[other].x - mx;
							const oy = places[other].y - my;
							if (ox * ox + oy * oy < inside) {
								gabriel = false;
								break;
							}
						}
					}
				}
				if (gabriel) links.push({ a, b, span: sqrt(squared) });
			}
		}
		return links.sort((first, second) => first.span - second.span || first.a - second.a || first.b - second.b);
	}

	/** The cheapest path from place `a` to place `b` for a class, in an ellipse `bound` times their span, or null. */
	private search(a: number, b: number, rank: number, bound: number): number[] | null {
		return this.searchBetween(this.ends[a] as Ends, this.ends[b] as Ends, rank, bound);
	}

	private searchBetween(from: Ends, to: Ends, rank: number, bound: number): number[] | null {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const limit = bound * sqrt(dx * dx + dy * dy) + ROAD_LINKS.boundSlack * this.cellSize + from.reach + to.reach;
		return this.astar(from, to, rank, limit);
	}

	/**
	 * A* from `from`'s cells to `to`'s, for road class `rank`, over cells
	 * inside the ellipse whose foci are the two places' points and whose
	 * distances to them sum to `limit` at most. The heuristic is the straight
	 * distance to `to`'s point, less its cells' reach, at the cheapest a road
	 * can cost per unit (existing road's), so it never overestimates. Ties go
	 * to the lower cell index. Returns the cells from start to goal, or null.
	 */
	private astar(from: Ends, to: Ends, rank: number, limit: number): number[] | null {
		const { field, size, classes, roadMask, near, columnX, rowY, score, came, seen, done, goal } = this;
		const offsets = field.offsets;
		const stamp = this.nextStamp();
		const unit = rank === HIGHWAY ? ROAD_LINKS.highwayReuse : ROAD_LINKS.reuse;
		const goalX = to.x;
		const goalY = to.y;
		const reach = to.reach;
		const heuristic = (x: number, y: number) => {
			const hx = x - goalX;
			const hy = y - goalY;
			const distance = sqrt(hx * hx + hy * hy) - reach;
			return distance > 0 ? unit * distance : 0;
		};
		for (const cell of to.cells) goal[cell] = stamp;
		this.heapSize = 0;
		for (const cell of from.cells) {
			seen[cell] = stamp;
			score[cell] = 0;
			came[cell] = -1;
			this.push(heuristic(columnX[cell % size], rowY[floor(cell / size)]), cell);
		}
		const fromX = from.x;
		const fromY = from.y;
		this.stats.searches += 1;
		let found = -1;
		while (this.heapSize > 0) {
			const cell = this.pop();
			if (done[cell] === stamp) continue;
			done[cell] = stamp;
			this.stats.expanded += 1;
			if (goal[cell] === stamp) {
				found = cell;
				break;
			}
			const column = cell % size;
			const row = (cell - column) / size;
			const base = score[cell];
			const mask = roadMask[cell];
			for (let direction = 0; direction < MOVES; direction += 1) {
				const next = cell + offsets[direction];
				if (done[next] === stamp) continue;
				const leap = direction >= NEIGHBOURS;
				// A bridge two cells long goes only over a cell in a river, and never across another over the same cell.
				if (leap && (field.open[(cell + next) / 2] === 1 || (this.leaps[(cell + next) / 2] & ((direction & 1) === 0 ? 2 : 1)) !== 0)) continue;
				const nextX = columnX[column + MOVE_X[direction]];
				const nextY = rowY[row + MOVE_Y[direction]];
				const ax = nextX - fromX;
				const ay = nextY - fromY;
				const bx = nextX - goalX;
				const by = nextY - goalY;
				if (sqrt(ax * ax + ay * ay) + sqrt(bx * bx + by * by) > limit) continue;
				const edge = field.edge(cell, direction);
				let cost = field.cost(edge, rank);
				if (cost === Infinity) continue;
				const onRoad = classes[edge];
				if (onRoad >= 0) {
					cost *= rank === HIGHWAY && onRoad === HIGHWAY ? ROAD_LINKS.highwayReuse : ROAD_LINKS.reuse;
				} else {
					if (!leap && (direction & 1) === 1 && this.crossesDiagonal(cell, direction, stamp)) continue;
					if (roadMask[next] !== 0) {
						if (!leap && mask !== 0 && this.closesTriangle(cell, direction, next)) continue;
					} else if (near[next] === 1) {
						cost *= ROAD_LINKS.beside;
					}
				}
				const reached = base + cost;
				if (seen[next] === stamp && !(reached < score[next])) continue;
				seen[next] = stamp;
				score[next] = reached;
				came[next] = cell;
				this.push(reached + heuristic(nextX, nextY), next);
			}
		}
		if (found < 0) return null;
		const path: number[] = [];
		for (let cell = found; cell >= 0; cell = came[cell]) path.push(cell);
		return path.reverse();
	}

	/** Dijkstra from place `id` to the nearest of the `targets` cells, for road class `rank`, unbounded. */
	private searchTo(id: number, targets: Uint8Array, rank: number): number[] | null {
		const start = this.ends[id] as Ends;
		const goal = this.goal;
		const stamp = this.stamp + 1;
		for (let cell = 0; cell < targets.length; cell += 1) if (targets[cell] === 1) goal[cell] = stamp;
		const to: Ends = { cells: [], x: start.x, y: start.y, reach: Infinity };
		return this.astarFrom(start, to, rank);
	}

	/** `astar` with the goal cells already stamped for the next search, no bound, and no heuristic. */
	private astarFrom(from: Ends, to: Ends, rank: number): number[] | null {
		return this.astar(from, to, rank, Infinity);
	}

	/** Per cell, 1 on a road the compound reaches. */
	private reachedRoads(): Uint8Array {
		const { field, size, roadMask } = this;
		const reached = new Uint8Array(size * size);
		const stack = [...(this.ends[0] as Ends).cells];
		stack.forEach((cell) => {
			reached[cell] = 1;
		});
		while (stack.length > 0) {
			const cell = stack.pop() as number;
			const mask = roadMask[cell];
			for (let direction = 0; direction < MOVES; direction += 1) {
				if ((mask & (1 << direction)) === 0) continue;
				const next = cell + field.offsets[direction];
				if (reached[next] === 1) continue;
				reached[next] = 1;
				stack.push(next);
			}
		}
		return reached;
	}

	/**
	 * World units between two places over the roads laid so far, or Infinity
	 * past `limit`: Dijkstra over road moves, each its length.
	 */
	private networkDistance(a: number, b: number, limit: number): number {
		const { field, roadMask, score, seen, done, goal } = this;
		const stamp = this.nextStamp();
		this.heapSize = 0;
		for (const cell of (this.ends[b] as Ends).cells) goal[cell] = stamp;
		for (const cell of (this.ends[a] as Ends).cells) {
			seen[cell] = stamp;
			score[cell] = 0;
			this.push(0, cell);
		}
		while (this.heapSize > 0) {
			const distance = this.heapKeys[0];
			const cell = this.pop();
			if (done[cell] === stamp) continue;
			if (distance > limit) return Infinity;
			if (goal[cell] === stamp) return distance;
			done[cell] = stamp;
			const mask = roadMask[cell];
			for (let direction = 0; direction < MOVES; direction += 1) {
				if ((mask & (1 << direction)) === 0) continue;
				const next = cell + field.offsets[direction];
				if (done[next] === stamp) continue;
				const reached = distance + field.length(field.edge(cell, direction));
				if (seen[next] === stamp && !(reached < score[next])) continue;
				seen[next] = stamp;
				score[next] = reached;
				this.push(reached, next);
			}
		}
		return Infinity;
	}

	/**
	 * Lays a path as road of class `rank`. A back road gives out to a trail
	 * along a run through rough country `trailRun` long or more. Each move keeps
	 * the best class laid along it, and the first highway, and the highest
	 * cell of a road over a range is a pass.
	 */
	private lay(path: readonly number[], rank: number, highway = -1): void {
		const { field, classes, highways, roadMask } = this;
		const moves = path.length - 1;
		const ranks = new Int8Array(moves).fill(rank);
		if (rank === BACK_ROAD) this.trailRuns(path, ranks);
		for (let move = 0; move < moves; move += 1) {
			const cell = path[move];
			const next = path[move + 1];
			const direction = this.directionOf(cell, next);
			const edge = field.edge(cell, direction);
			if (classes[edge] < 0 || ranks[move] < classes[edge]) classes[edge] = ranks[move];
			if (highway >= 0 && highways[edge] < 0) highways[edge] = highway;
			roadMask[cell] |= 1 << direction;
			roadMask[next] |= 1 << OPPOSITE[direction];
			if (direction >= NEIGHBOURS) this.leaps[(cell + next) / 2] |= (direction & 1) === 0 ? 1 : 2;
			this.markNear(cell);
			this.markNear(next);
		}
		if (rank !== TRAIL) this.findPass(path);
	}

	/** Marks the moves along runs of rough country `trailRun` long or more as trail. */
	private trailRuns(path: readonly number[], ranks: Int8Array): void {
		const { field } = this;
		let start = -1;
		let length = 0;
		const close = (end: number) => {
			if (start >= 0 && length >= this.trailRun) ranks.fill(TRAIL, start, end);
			start = -1;
			length = 0;
		};
		for (let move = 0; move < ranks.length; move += 1) {
			const cell = path[move];
			const next = path[move + 1];
			if (this.rough(cell) || this.rough(next)) {
				if (start < 0) start = move;
				length += field.length(field.edge(cell, this.directionOf(cell, next)));
			} else {
				close(move);
			}
		}
		close(ranks.length);
	}

	/** A path's highest cell, if it's in the ranges and stands above both ends, as a pass. */
	private findPass(path: readonly number[]): void {
		const { field, terrain } = this;
		const { ranges, rise, spacing } = ROAD_LINKS.pass;
		let highest = path[0];
		for (const cell of path) if (field.elevation[cell] > field.elevation[highest]) highest = cell;
		const ends = Math.max(field.elevation[path[0]], field.elevation[path[path.length - 1]]);
		if (!(field.elevation[highest] >= ends + rise)) return;
		const x = field.x(highest);
		const y = field.y(highest);
		if (terrain.sample(x, y, this.sample).mountains < ranges) return;
		if (this.passes.some((pass) => (pass.x - x) * (pass.x - x) + (pass.y - y) * (pass.y - y) < spacing * spacing)) return;
		this.passes.push({ x, y });
	}

	private rough(cell: number): boolean {
		let rough = this.roughCells[cell];
		if (rough < 0) {
			rough = this.terrain.rough(this.field.x(cell), this.field.y(cell)) ? 1 : 0;
			this.roughCells[cell] = rough;
		}
		return rough === 1;
	}

	private markNear(cell: number): void {
		const { near, field } = this;
		near[cell] = 1;
		for (let direction = 0; direction < NEIGHBOURS; direction += 1) near[cell + field.offsets[direction]] = 1;
	}

	/**
	 * Whether the diagonal move from `cell` in `direction` would cross the
	 * square's other diagonal: a road's, or the search's own path's last two
	 * moves, which a zigzag round a blocked square's side could make.
	 */
	private crossesDiagonal(cell: number, direction: number, stamp: number): boolean {
		const side = cell + MOVE_X[direction];
		const across = moveBetween(-MOVE_X[direction], MOVE_Y[direction]);
		if ((this.roadMask[side] & (1 << across)) !== 0) return true;
		const above = cell + MOVE_Y[direction] * this.size;
		const back = this.came[cell];
		if (back === side) return this.seen[side] === stamp && this.came[side] === above;
		if (back === above) return this.seen[above] === stamp && this.came[above] === side;
		return false;
	}

	/** Whether the move from `cell` to `next`, both on roads, would close a triangle with two road moves. */
	private closesTriangle(cell: number, direction: number, next: number): boolean {
		const mask = this.roadMask[cell];
		const nextMask = this.roadMask[next];
		for (let other = 0; other < NEIGHBOURS; other += 1) {
			if (other === direction || (mask & (1 << other)) === 0) continue;
			const dx = MOVE_X[other] - MOVE_X[direction];
			const dy = MOVE_Y[other] - MOVE_Y[direction];
			if (dx < -1 || dx > 1 || dy < -1 || dy > 1) continue;
			if ((nextMask & (1 << moveBetween(dx, dy))) !== 0) return true;
		}
		return false;
	}

	private directionOf(cell: number, next: number): number {
		const size = this.size;
		const dx = (next % size) - (cell % size);
		const dy = floor(next / size) - floor(cell / size);
		return moveBetween(dx, dy);
	}

	private pathLength(path: readonly number[]): number {
		let length = 0;
		for (let move = 0; move + 1 < path.length; move += 1) length += this.field.length(this.field.edge(path[move], this.directionOf(path[move], path[move + 1])));
		return length;
	}

	private find(id: number): number {
		const parent = this.unionParent;
		let root = id;
		while (parent[root] !== root) root = parent[root];
		while (parent[id] !== root) {
			const next = parent[id];
			parent[id] = root;
			id = next;
		}
		return root;
	}

	private unite(a: number, b: number): void {
		const rootA = this.find(a);
		const rootB = this.find(b);
		// The lower id keeps the root, so the compound's piece is always rooted at 0.
		if (rootA < rootB) this.unionParent[rootB] = rootA;
		else if (rootB < rootA) this.unionParent[rootA] = rootB;
	}

	private nextStamp(): number {
		this.stamp += 1;
		return this.stamp;
	}

	/** Pushes `cell` keyed `key`; the heap orders by key, then by cell, so ties never hang on the heap's own order. */
	private push(key: number, cell: number): void {
		if (this.heapSize === this.heapKeys.length) {
			const keys = new Float64Array(this.heapKeys.length * 2);
			keys.set(this.heapKeys);
			this.heapKeys = keys;
			const cells = new Int32Array(this.heapCells.length * 2);
			cells.set(this.heapCells);
			this.heapCells = cells;
		}
		const keys = this.heapKeys;
		const cells = this.heapCells;
		let at = this.heapSize;
		this.heapSize += 1;
		while (at > 0) {
			const parent = (at - 1) >> 1;
			if (keys[parent] < key || (keys[parent] === key && cells[parent] < cell)) break;
			keys[at] = keys[parent];
			cells[at] = cells[parent];
			at = parent;
		}
		keys[at] = key;
		cells[at] = cell;
	}

	private pop(): number {
		const keys = this.heapKeys;
		const cells = this.heapCells;
		const top = cells[0];
		this.heapSize -= 1;
		const count = this.heapSize;
		if (count > 0) {
			const key = keys[count];
			const cell = cells[count];
			let at = 0;
			for (;;) {
				let child = 2 * at + 1;
				if (child >= count) break;
				if (child + 1 < count && (keys[child + 1] < keys[child] || (keys[child + 1] === keys[child] && cells[child + 1] < cells[child]))) child += 1;
				if (keys[child] > key || (keys[child] === key && cells[child] > cell)) break;
				keys[at] = keys[child];
				cells[at] = cells[child];
				at = child;
			}
			keys[at] = key;
			cells[at] = cell;
		}
		return top;
	}
}
