import type { Rng } from '../core/Rng';
import { Vector, chaikin, pointAlong, pointSegmentDistanceSquared, polylineLength, unitVector } from './Geometry';
import { RELIEF } from './Land';
import { LandGrid, cellAt, cellCentre } from './LandGrid';
import { NodeHeap } from './NodeHeap';
import { simplify } from './Rivers';
import type { RoadBridge } from './RoadNetwork';
import type { Obstacle, WaterKind } from './Terrain';

/**
 * Rail lines (Area Map Generation, 11. Dressing): long gentle curves from
 * rim to rim along the valleys, bridging rivers. Drawn with the rail
 * pattern, never as a road, and never driven: nothing but the view reads
 * them. The decision record is docs/AI_TECHNICAL_DECISIONS/dressing.md.
 */

export interface RailLine {
	/** From the rim to the rim, flat: x0, y0, x1, y1, ... */
	readonly points: readonly number[];
	/** World units along it. */
	readonly length: number;
	/** Where it crosses rivers: each deck as world units along its line from its first point, in order. */
	readonly bridges: readonly RoadBridge[];
}

/**
 * - The search runs on a grid `coarse` land cells to one, inside `inset`
 *   coarse cells of the rim. A cell is open where nothing a rail can't
 *   cross stands at its centre or at the centres of the land cells under it.
 * - A move costs its length times one plus `grade` times its grade squared,
 *   times one plus `valley` times how far it stands above the low ground
 *   (the water's lowland, 1 on a valley floor), plus `ranges` times the
 *   range mask, plus `bridge` world units for each end on a river, so a
 *   line crosses a river rather than running along it. A diagonal move
 *   needs both cells beside it open. Within `apart` coarse cells of an
 *   earlier line, the move costs `apartCost` times as much, so lines keep
 *   apart, even down one valley, but can still cross. Past `rim.band` of
 *   the radius it costs `rim.cost` times more, so a line crosses the rim
 *   at its ends rather than running round it; the last try goes without
 *   that, since it can leave no way across but back on itself.
 * - Each line's ends are rim points, the second `across` degrees round from
 *   the first: the search runs from any open cell just inside the rim within
 *   `spread` degrees of one end's bearing, in `step`-degree steps, to any
 *   within `spread` of the other's, so a line leaves the map the way it
 *   arrives rather than hooking round to a set point. The lines' first ends
 *   are spread evenly round half the rim from a drawn bearing.
 * - The path is simplified to `tolerance` coarse cells and cut by Chaikin
 *   `passes` times; where the curve clips a lake, crater, or cliff (sampled
 *   every `sample` world units) or puts a deck past `longestDeck` world
 *   units over a river, the next tolerance down is tried, then the cells
 *   themselves. Bridges are merged across gaps under `deckGap`.
 * - A line is dropped, and drawn again, up to `tries` times in all, its
 *   second end drawn afresh and, after the first try, its first turned up
 *   to `turn` degrees either way, where it finds no way, where it doubles
 *   back (its heading, read every `hairpin.step` world units, turns past
 *   `hairpin.dot`, about 150 degrees, within `hairpin.window`), or where
 *   it runs within `beside.reach` world units of an earlier line for more
 *   than `beside.most`, read every `beside.step`.
 */
export const RAIL_LINES = {
	coarse: 2,
	inset: 1,
	grade: 400,
	valley: 1.5,
	ranges: 4,
	bridge: 40,
	apart: 6,
	apartCost: 6,
	rim: { band: 0.88, cost: 3 },
	hairpin: { window: 200, dot: -0.85, step: 20 },
	beside: { reach: 30, most: 300, step: 10 },
	tries: 6,
	turn: 25,
	across: { least: 140, most: 220 },
	spread: 25,
	step: 2.5,
	tolerance: [2, 1, 0.5],
	passes: 4,
	sample: 1,
	deckGap: 2,
	longestDeck: 30,
} as const;

/** What the rails ask of the land: what stands at a point, its height, and its water. */
export interface RailGround {
	readonly radius: number;
	elevation(x: number, y: number): number;
	obstacle(x: number, y: number): Obstacle | null;
	waterAt(x: number, y: number): WaterKind | null;
}

export interface RailLineOptions {
	readonly ground: RailGround;
	/** The land grid, and per land cell the range mask, the water's lowland, and its drainage area, river at `threshold` and more. */
	readonly grid: LandGrid;
	readonly mountains: ArrayLike<number>;
	readonly lowland: ArrayLike<number>;
	readonly area: ArrayLike<number>;
	readonly threshold: number;
	/** Lines to lay; fewer where the land leaves no way across. */
	readonly count: number;
	/** The rails' stream; each line forks its own from it by its index. */
	readonly rng: Rng;
}

// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const floor = Math.floor;
const sqrt = Math.sqrt;
const SQRT2 = Math.SQRT2;

/** Up to `count` rail lines, each searched on the land the ones before it left. */
export function railLines({ ground, grid, mountains, lowland, area, threshold, count, rng }: RailLineOptions): RailLine[] {
	if (count <= 0) return [];
	const field = new RailField({ ground, grid, mountains, lowland, area, threshold });
	const spin = rng.float() * 360;
	const lines: RailLine[] = [];
	for (let index = 0; index < count; index += 1) {
		const own = rng.fork('rail', index);
		const first = spin + 180 * index / count;
		for (let attempt = 0; attempt < RAIL_LINES.tries; attempt += 1) {
			// The first try keeps the first bearing; how many draws a try takes depends only on which try it is.
			const turned = first + (attempt === 0 ? 0 : (own.float() * 2 - 1) * RAIL_LINES.turn);
			const second = first + RAIL_LINES.across.least + (RAIL_LINES.across.most - RAIL_LINES.across.least) * own.float();
			const line = field.lay({ from: turned, to: second, rim: attempt < RAIL_LINES.tries - 1 });
			if (line === null) continue;
			lines.push(line);
			break;
		}
	}
	return lines;
}

/** A cell a line can start or end on, just inside the rim, and the rim point beyond it. */
interface RimEnd {
	readonly cell: number;
	readonly rimX: number;
	readonly rimY: number;
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;

/** The coarse grid the rails are searched on, and the lines laid on it so far. */
class RailField {
	private readonly ground: RailGround;
	private readonly size: number;
	private readonly cellSize: number;
	private readonly halfExtent: number;
	/** Per coarse cell: its centre's height in world units, the range mask, how far above the low ground, river (1, any of its land cells) or not, open (1) or not. */
	private readonly height: Float64Array;
	private readonly mask: Float64Array;
	private readonly above: Float64Array;
	private readonly river: Uint8Array;
	private readonly open: Uint8Array;
	/** Per coarse cell, 1 within `apart` cells of a line laid already. */
	private readonly crowded: Uint8Array;
	/** Per coarse cell, 1 past `rim.band` of the radius. */
	private readonly outer: Uint8Array;
	/** What a move past the rim band costs times, for the line being laid. */
	private rimCost = 1;
	/** The lines laid so far. */
	private readonly laid: (readonly number[])[] = [];

	constructor({ ground, grid, mountains, lowland, area, threshold }: Omit<RailLineOptions, 'count' | 'rng'>) {
		this.ground = ground;
		this.size = floor(grid.size / RAIL_LINES.coarse);
		this.cellSize = grid.cellSize * RAIL_LINES.coarse;
		this.halfExtent = grid.halfExtent;
		const cells = this.size * this.size;
		this.height = new Float64Array(cells);
		this.mask = new Float64Array(cells);
		this.above = new Float64Array(cells);
		this.river = new Uint8Array(cells);
		this.open = new Uint8Array(cells);
		this.crowded = new Uint8Array(cells);
		this.outer = new Uint8Array(cells);
		const band = RAIL_LINES.rim.band * ground.radius;
		const reach = ground.radius - RAIL_LINES.inset * this.cellSize;
		for (let row = 0; row < this.size; row += 1) {
			const y = this.centre(row);
			for (let column = 0; column < this.size; column += 1) {
				const x = this.centre(column);
				const cell = row * this.size + column;
				// Past the reach a cell stays closed, so nothing about it is needed.
				if (x * x + y * y > reach * reach) continue;
				const under = cellAt(grid, x, y);
				this.height[cell] = ground.elevation(x, y) * RELIEF;
				this.mask[cell] = under < 0 ? 0 : mountains[under];
				this.above[cell] = under < 0 ? 1 : 1 - lowland[under];
				const obstacle = ground.obstacle(x, y);
				const land = row * RAIL_LINES.coarse * grid.size + column * RAIL_LINES.coarse;
				let river = 0;
				let clear = obstacle === null || obstacle === 'river';
				for (let down = 0; down < RAIL_LINES.coarse; down += 1) {
					for (let across = 0; across < RAIL_LINES.coarse; across += 1) {
						const under = land + down * grid.size + across;
						if (area[under] >= threshold) river = 1;
						const blocked = clear ? ground.obstacle(cellCentre(grid, under % grid.size), cellCentre(grid, floor(under / grid.size))) : null;
						if (blocked !== null && blocked !== 'river') clear = false;
					}
				}
				this.river[cell] = river;
				this.open[cell] = clear ? 1 : 0;
				this.outer[cell] = x * x + y * y > band * band ? 1 : 0;
			}
		}
	}

	/** A line from the rim at bearing `from` to the rim at bearing `to`, kept off the rim between them when `rim`, or null where none fits. */
	public lay({ from, to, rim }: { from: number; to: number; rim: boolean }): RailLine | null {
		this.rimCost = rim ? 1 + RAIL_LINES.rim.cost : 1;
		const starts = this.endsAt(from);
		const ends = this.endsAt(to);
		if (starts.length === 0 || ends.length === 0 || starts.some(({ cell }) => ends.some((end) => end.cell === cell))) return null;
		const cells = this.search(starts, ends);
		if (cells === null) return null;
		const start = starts.find(({ cell }) => cell === cells[0]) as RimEnd;
		const end = ends.find(({ cell }) => cell === cells[cells.length - 1]) as RimEnd;
		const path: number[] = [start.rimX, start.rimY];
		for (const cell of cells) path.push(this.centre(cell % this.size), this.centre(floor(cell / this.size)));
		path.push(end.rimX, end.rimY);
		const points = this.smooth(path);
		if (points === null || hairpin(points) || this.beside(points)) return null;
		this.mark(cells);
		this.laid.push(points);
		return Object.freeze({ points: Object.freeze(points), length: polylineLength(points), bridges: Object.freeze(this.bridges(points)) });
	}

	private centre(index: number): number {
		return -this.halfExtent + (index + 0.5) * this.cellSize;
	}

	/** The open cells just inside the rim within `spread` degrees of a bearing, each with the rim point beyond it, each cell once. */
	private endsAt(bearing: number): RimEnd[] {
		const towards: Vector = { x: 0, y: 0 };
		const inside = this.ground.radius - (RAIL_LINES.inset + 0.75) * this.cellSize;
		const ends: RimEnd[] = [];
		for (let turn = -RAIL_LINES.spread; turn <= RAIL_LINES.spread; turn += RAIL_LINES.step) {
			unitVector(bearing + turn, towards);
			const cell = this.cellOf(towards.x * inside, towards.y * inside);
			if (cell < 0 || this.open[cell] === 0 || this.river[cell] === 1 || ends.some((end) => end.cell === cell)) continue;
			ends.push({ cell, rimX: towards.x * this.ground.radius, rimY: towards.y * this.ground.radius });
		}
		return ends;
	}

	private cellOf(x: number, y: number): number {
		return cellAt({ size: this.size, cellSize: this.cellSize, halfExtent: this.halfExtent }, x, y);
	}

	/** A* from any of `starts` to any of `goals` over open cells, ties to the lower cell: the cells in order, or null when nothing joins them. */
	private search(starts: readonly RimEnd[], goals: readonly RimEnd[]): number[] | null {
		const size = this.size;
		const cells = size * size;
		const cost = new Float64Array(cells).fill(Infinity);
		const came = new Int32Array(cells).fill(-1);
		const done = new Uint8Array(cells);
		const heap = new NodeHeap(8 * cells + 1);
		const goal = new Uint8Array(cells);
		for (const { cell } of goals) goal[cell] = 1;
		// The straight distance to the nearest goal, which never overestimates; worked out once a cell.
		const guesses = new Float64Array(cells).fill(-1);
		const heuristic = (cell: number): number => {
			if (guesses[cell] >= 0) return guesses[cell];
			let nearest = Infinity;
			for (const end of goals) {
				const dx = (cell % size) - (end.cell % size);
				const dy = floor(cell / size) - floor(end.cell / size);
				const squared = dx * dx + dy * dy;
				if (squared < nearest) nearest = squared;
			}
			guesses[cell] = sqrt(nearest) * this.cellSize;
			return guesses[cell];
		};
		for (const { cell } of starts) {
			cost[cell] = 0;
			heap.push(cell, heuristic(cell));
		}
		let reachedGoal = -1;
		while (heap.size > 0) {
			const cell = heap.pop();
			if (done[cell] === 1) continue;
			done[cell] = 1;
			if (goal[cell] === 1) {
				reachedGoal = cell;
				break;
			}
			const column = cell % size;
			const row = floor(cell / size);
			for (const [dx, dy] of NEIGHBOURS) {
				const nextColumn = column + dx;
				const nextRow = row + dy;
				if (nextColumn < 0 || nextRow < 0 || nextColumn >= size || nextRow >= size) continue;
				const next = nextRow * size + nextColumn;
				if (done[next] === 1 || this.open[next] === 0) continue;
				const diagonal = dx !== 0 && dy !== 0;
				if (diagonal && (this.open[row * size + nextColumn] === 0 || this.open[nextRow * size + column] === 0)) continue;
				const step = this.moveCost(cell, next, diagonal);
				const reached = cost[cell] + step;
				if (reached < cost[next]) {
					cost[next] = reached;
					came[next] = cell;
					heap.push(next, reached + heuristic(next));
				}
			}
		}
		if (reachedGoal < 0) return null;
		const path: number[] = [];
		for (let cell = reachedGoal; cell !== -1; cell = came[cell]) path.push(cell);
		return path.reverse();
	}

	private moveCost(from: number, to: number, diagonal: boolean): number {
		const length = (diagonal ? SQRT2 : 1) * this.cellSize;
		const grade = (this.height[to] - this.height[from]) / length;
		const above = (this.above[from] + this.above[to]) / 2;
		const mask = (this.mask[from] + this.mask[to]) / 2;
		let step = length * (1 + RAIL_LINES.grade * grade * grade) * (1 + RAIL_LINES.valley * above) + RAIL_LINES.ranges * mask * length;
		step += RAIL_LINES.bridge * (this.river[from] + this.river[to]);
		if (this.crowded[from] > 0 || this.crowded[to] > 0) step *= RAIL_LINES.apartCost;
		if (this.outer[from] > 0 || this.outer[to] > 0) step *= this.rimCost;
		return step;
	}

	/** The path as a gentle curve: the smoothest that keeps off lakes, craters, and cliffs, or null if not even its cells do. */
	private smooth(path: readonly number[]): number[] | null {
		for (const tolerance of RAIL_LINES.tolerance) {
			let points = simplify(path, tolerance * this.cellSize);
			for (let pass = 0; pass < RAIL_LINES.passes; pass += 1) points = chaikin(points);
			if (this.clear(points) && this.bridges(points).every(({ start, end }) => end - start <= RAIL_LINES.longestDeck)) return points;
		}
		return this.clear(path) ? path.slice() : null;
	}

	/** Whether nothing a rail can't cross lies on the line, sampled every `sample` world units. */
	private clear(points: readonly number[]): boolean {
		const reach = this.ground.radius + 1e-9;
		for (let index = 0; index + 3 < points.length; index += 2) {
			const ax = points[index];
			const ay = points[index + 1];
			const dx = points[index + 2] - ax;
			const dy = points[index + 3] - ay;
			const steps = floor(sqrt(dx * dx + dy * dy) / RAIL_LINES.sample) + 1;
			for (let at = 0; at <= steps; at += 1) {
				const x = ax + dx * at / steps;
				const y = ay + dy * at / steps;
				if (x * x + y * y > reach * reach) return false;
				const obstacle = this.ground.obstacle(x, y);
				if (obstacle !== null && obstacle !== 'river') return false;
			}
		}
		return true;
	}

	/** Where the line runs over river water, as decks along it, merged across short gaps. */
	private bridges(points: readonly number[]): RoadBridge[] {
		const decks: { start: number; end: number }[] = [];
		let along = 0;
		for (let index = 0; index + 3 < points.length; index += 2) {
			const ax = points[index];
			const ay = points[index + 1];
			const dx = points[index + 2] - ax;
			const dy = points[index + 3] - ay;
			const length = sqrt(dx * dx + dy * dy);
			const steps = floor(length / RAIL_LINES.sample) + 1;
			for (let at = 0; at <= steps; at += 1) {
				if (this.ground.waterAt(ax + dx * at / steps, ay + dy * at / steps) !== 'river') continue;
				const distance = along + length * at / steps;
				const last = decks[decks.length - 1];
				if (last && distance - last.end <= RAIL_LINES.deckGap) last.end = distance;
				else decks.push({ start: distance, end: distance });
			}
			along += length;
		}
		return decks.map((deck) => Object.freeze(deck));
	}

	/** Whether a line runs within `beside.reach` of one laid already for more than `beside.most`. */
	private beside(points: readonly number[]): boolean {
		if (this.laid.length === 0) return false;
		const { reach, most, step } = RAIL_LINES.beside;
		const at = { x: 0, y: 0 };
		const length = polylineLength(points);
		let near = 0;
		for (let along = 0; along <= length; along += step) {
			pointAlong(points, along, at);
			if (this.laid.some((line) => nearLine(line, at.x, at.y, reach))) near += step;
			if (near > most) return true;
		}
		return false;
	}

	/** Marks the cells within `apart` of a laid line, so the next keeps its distance. */
	private mark(cells: readonly number[]): void {
		const size = this.size;
		const apart = RAIL_LINES.apart;
		for (const cell of cells) {
			const column = cell % size;
			const row = floor(cell / size);
			for (let dy = -apart; dy <= apart; dy += 1) {
				for (let dx = -apart; dx <= apart; dx += 1) {
					const x = column + dx;
					const y = row + dy;
					if (x >= 0 && y >= 0 && x < size && y < size && dx * dx + dy * dy <= apart * apart) this.crowded[y * size + x] = 1;
				}
			}
		}
	}
}

/** Whether a line doubles back: its direction, read every `hairpin.step` world units, turns past `hairpin.dot` within `hairpin.window`. */
function hairpin(points: readonly number[]): boolean {
	const { window, dot, step } = RAIL_LINES.hairpin;
	const length = polylineLength(points);
	const at = { x: 0, y: 0 };
	const headings: number[] = [];
	let lastX = points[0];
	let lastY = points[1];
	for (let along = step; along <= length; along += step) {
		pointAlong(points, along, at);
		const dx = at.x - lastX;
		const dy = at.y - lastY;
		const norm = sqrt(dx * dx + dy * dy);
		headings.push(norm > 0 ? dx / norm : 0, norm > 0 ? dy / norm : 0);
		lastX = at.x;
		lastY = at.y;
	}
	const reach = floor(window / step);
	for (let index = 0; index < headings.length; index += 2) {
		for (let ahead = 1; ahead <= reach && index + 2 * ahead < headings.length; ahead += 1) {
			if (headings[index] * headings[index + 2 * ahead] + headings[index + 1] * headings[index + 2 * ahead + 1] < dot) return true;
		}
	}
	return false;
}

/** Whether (x, y) lies within `reach` of a polyline. */
function nearLine(points: readonly number[], x: number, y: number, reach: number): boolean {
	const squared = reach * reach;
	for (let index = 0; index + 3 < points.length; index += 2) {
		const ax = points[index];
		const ay = points[index + 1];
		const bx = points[index + 2];
		const by = points[index + 3];
		// Segments whose box is out of reach can't be near.
		if ((ax < bx ? ax : bx) > x + reach || (ax > bx ? ax : bx) < x - reach || (ay < by ? ay : by) > y + reach || (ay > by ? ay : by) < y - reach) continue;
		if (pointSegmentDistanceSquared(x, y, ax, ay, bx, by) <= squared) return true;
	}
	return false;
}
