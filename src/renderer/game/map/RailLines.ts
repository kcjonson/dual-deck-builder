import type { Rng } from '../core/Rng';
import { Vector, chaikin, pointAlong, polylineLength, unitVector } from './Geometry';
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
 *   at its ends rather than running round it.
 * - Each line's ends are rim points, the second `across` degrees round from
 *   the first, each the lowest of the bearings `spread` degrees either side
 *   in `step`-degree steps; the lines' first ends are spread evenly round
 *   half the rim from a drawn bearing.
 * - The path is simplified to `tolerance` coarse cells and cut by Chaikin
 *   `passes` times; where the curve clips a lake, crater, or cliff (sampled
 *   every `sample` world units) or puts a deck past `longestDeck` world
 *   units over a river, the next tolerance down is tried, then the cells
 *   themselves. Bridges are merged across gaps under `deckGap`.
 * - A line whose heading turns past `hairpin.dot` (the cosine between its
 *   direction at two points up to `hairpin.window` world units apart, -0.85
 *   being about 150 degrees) is dropped, and its second end drawn again, up to `tries`
 *   times.
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
	tries: 3,
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
			const second = first + RAIL_LINES.across.least + (RAIL_LINES.across.most - RAIL_LINES.across.least) * own.float();
			const line = field.lay(first, second);
			if (line === null) continue;
			lines.push(line);
			break;
		}
	}
	return lines;
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
				this.open[cell] = x * x + y * y <= reach * reach && clear ? 1 : 0;
				this.outer[cell] = x * x + y * y > band * band ? 1 : 0;
			}
		}
	}

	/** A line from the rim at bearing `from` to the rim at bearing `to`, or null where none fits. */
	public lay(from: number, to: number): RailLine | null {
		const start = this.endAt(from);
		const end = this.endAt(to);
		if (start === null || end === null || start.cell === end.cell) return null;
		const cells = this.search(start.cell, end.cell);
		if (cells === null) return null;
		const path: number[] = [start.rimX, start.rimY];
		for (const cell of cells) path.push(this.centre(cell % this.size), this.centre(floor(cell / this.size)));
		path.push(end.rimX, end.rimY);
		const points = this.smooth(path);
		if (points === null || hairpin(points)) return null;
		this.mark(cells);
		return Object.freeze({ points: Object.freeze(points), length: polylineLength(points), bridges: Object.freeze(this.bridges(points)) });
	}

	private centre(index: number): number {
		return -this.halfExtent + (index + 0.5) * this.cellSize;
	}

	/** The lowest open cell just inside the rim within `spread` degrees of a bearing, and the rim point beyond it. */
	private endAt(bearing: number): { cell: number; rimX: number; rimY: number } | null {
		const towards: Vector = { x: 0, y: 0 };
		const inside = this.ground.radius - (RAIL_LINES.inset + 0.75) * this.cellSize;
		let best: { cell: number; rimX: number; rimY: number } | null = null;
		let lowest = Infinity;
		// Out from the bearing asked for, either way in turn, so a tie goes to the nearer.
		for (let offset = 0; offset <= 2 * RAIL_LINES.spread / RAIL_LINES.step; offset += 1) {
			const turn = (offset % 2 === 0 ? 1 : -1) * floor((offset + 1) / 2) * RAIL_LINES.step;
			unitVector(bearing + turn, towards);
			const cell = this.cellOf(towards.x * inside, towards.y * inside);
			if (cell < 0 || this.open[cell] === 0 || this.river[cell] === 1) continue;
			if (this.height[cell] < lowest) {
				lowest = this.height[cell];
				best = { cell, rimX: towards.x * this.ground.radius, rimY: towards.y * this.ground.radius };
			}
		}
		return best;
	}

	private cellOf(x: number, y: number): number {
		return cellAt({ size: this.size, cellSize: this.cellSize, halfExtent: this.halfExtent }, x, y);
	}

	/** A* from cell to cell over open cells, ties to the lower cell: the cells in order, or null when nothing joins them. */
	private search(from: number, to: number): number[] | null {
		const size = this.size;
		const cells = size * size;
		const cost = new Float64Array(cells).fill(Infinity);
		const came = new Int32Array(cells).fill(-1);
		const done = new Uint8Array(cells);
		const heap = new NodeHeap(8 * cells + 1);
		const goalX = to % size;
		const goalY = floor(to / size);
		const heuristic = (cell: number): number => {
			const dx = (cell % size) - goalX;
			const dy = floor(cell / size) - goalY;
			return sqrt(dx * dx + dy * dy) * this.cellSize;
		};
		cost[from] = 0;
		heap.push(from, heuristic(from));
		while (heap.size > 0) {
			const cell = heap.pop();
			if (done[cell] === 1) continue;
			done[cell] = 1;
			if (cell === to) break;
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
		if (done[to] === 0) return null;
		const path: number[] = [];
		for (let cell = to; cell !== -1; cell = came[cell]) path.push(cell);
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
		if (this.outer[from] > 0 || this.outer[to] > 0) step *= 1 + RAIL_LINES.rim.cost;
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
