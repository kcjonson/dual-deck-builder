import type { Rng } from '../core/Rng';
import { LandGrid, cellCentre } from './LandGrid';

/**
 * Lakes (Area Map Generation, Pipeline, 2. Water): reservoirs, each held
 * behind a dam on a river and filled to a level that floods the valley
 * upstream and its side branches, and natural lakes where the eroded land
 * holds water in a pit and the country is wet. Both are cells of the land
 * grid under a water level, and the map reads their water off a depth field
 * per cell, the level less the land, whose bilinear zero is the shore.
 *
 * Plain arithmetic throughout, so a seed's lakes are the same in every
 * engine. Starting values are provisional calls for the Map Lab, listed in
 * docs/AI_TECHNICAL_DECISIONS/water-and-biomes.md.
 */

export type LakeKind = 'reservoir' | 'natural';

/** Where a reservoir's dam holds its river back: a natural site for a POI. */
export interface Dam {
	/** The dam's cell's centre. */
	readonly x: number;
	readonly y: number;
	/** The way the river leaves through it, a unit vector: the dam runs square across it. */
	readonly towardX: number;
	readonly towardY: number;
}

export interface Lake {
	readonly kind: LakeKind;
	/** Its water level, as elevation. */
	readonly level: number;
	/** Land cells under it. */
	readonly cells: number;
	/** The centre of its cells, world units. */
	readonly x: number;
	readonly y: number;
	/** A reservoir's dam; null for a natural lake. */
	readonly dam: Dam | null;
}

/**
 * Reservoirs: dams on river cells whose drainage area is `area` times the
 * stream threshold, so on rivers big enough to be worth damming and not the
 * main stems; in a valley at least `valley` world units deep across the
 * river; `spacing` of the radius apart, inside `outer` of it. Each floods
 * between `cells` land cells, to a target drawn between them, `depth` world
 * units deep at the dam. Candidates are tried in a shuffled order, up to
 * `tries` floods' worth.
 */
export const RESERVOIR = {
	area: { min: 3, max: 80 },
	valley: 0.8,
	spacing: 0.25,
	outer: 0.88,
	cells: { min: 30, max: 220 },
	depth: { min: 0.5, max: 30 },
	tries: 120,
} as const;

/**
 * Natural lakes: pits in the eroded land, cells whose water level stands
 * more than `wet` above them, joined through their neighbours, that hold at
 * least `cells` cells, stand `depth` world units deep somewhere, and lie in
 * country whose moisture before the rivers averages `moisture` or more.
 */
export const NATURAL_LAKE = { wet: 0.01, depth: 0.25, cells: 4, moisture: 0.55 } as const;

/** The depth field just past a shore, as elevation: the shore sits that far short of the dry cell's centre. */
const SHORE = 0.002;

/** Column and row steps to the eight neighbours. */
const STEP_COLUMNS = [1, 1, 0, -1, -1, -1, 0, 1];
const STEP_ROWS = [0, 1, 1, 1, 0, -1, -1, -1];

// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;

/** Where lakes stand, as they're made: each cell's lake, -1 for none, and its water level. */
export interface LakeCells {
	readonly lakeOf: Int32Array;
	readonly level: Float64Array;
	readonly lakes: Lake[];
}

export function emptyLakeCells(cells: number): LakeCells {
	return { lakeOf: new Int32Array(cells).fill(-1), level: new Float64Array(cells), lakes: [] };
}

export interface NaturalLakeOptions {
	readonly grid: LandGrid;
	readonly elevation: Float64Array;
	/** The land's own drainage levels: where one stands above the land, water stands in a pit until it spills. */
	readonly levels: Float64Array;
	/** The moisture of each cell before the rivers. */
	readonly moisture: ArrayLike<number>;
	/** Vertical scale: world units elevation 1 stands. */
	readonly relief: number;
	/**
	 * Cells no lake may cover: the metro, towns, craters, the grid's edge. A
	 * pit touching one stays dry. The cells round each lake made are marked
	 * too, so no lake made after it touches it.
	 */
	readonly blocked: Uint8Array;
	readonly into: LakeCells;
}

/** The land's pits that hold water, as natural lakes, in cell order of each pit's first cell. */
export function naturalLakes({ grid, elevation, levels, moisture, relief, blocked, into }: NaturalLakeOptions): void {
	const size = grid.size;
	const cells = size * size;
	const wet = NATURAL_LAKE.wet / relief;
	const deep = NATURAL_LAKE.depth / relief;
	const seen = new Uint8Array(cells);
	const members: number[] = [];
	for (let first = 0; first < cells; first += 1) {
		if (seen[first] === 1 || !(levels[first] - elevation[first] > wet)) continue;
		members.length = 0;
		members.push(first);
		seen[first] = 1;
		let touchesBlocked = false;
		let deepest = 0;
		let wetness = 0;
		for (let at = 0; at < members.length; at += 1) {
			const cell = members[at];
			if (blocked[cell] === 1) touchesBlocked = true;
			const depth = levels[cell] - elevation[cell];
			if (depth > deepest) deepest = depth;
			wetness += moisture[cell];
			forEachNeighbour(size, cell, (next) => {
				if (seen[next] === 0 && levels[next] - elevation[next] > wet) {
					seen[next] = 1;
					members.push(next);
				}
			});
		}
		if (touchesBlocked || members.length < NATURAL_LAKE.cells || deepest < deep || wetness < NATURAL_LAKE.moisture * members.length) continue;
		let level = 0;
		for (const cell of members) if (levels[cell] > level) level = levels[cell];
		addLake({ grid, into, members, kind: 'natural', level, levels, dam: null });
		blockAround(size, members, blocked);
	}
}

export interface ReservoirOptions {
	readonly grid: LandGrid;
	readonly elevation: Float64Array;
	/** The water stage's routing: each cell's downstream neighbour, -1 where drainage leaves. */
	readonly receivers: Int32Array;
	/** Rain-weighted drainage area per cell. */
	readonly area: Float64Array;
	readonly threshold: number;
	/** How many to place: `lakes`. */
	readonly count: number;
	/** The map's radius, and the nearest a dam may sit to the compound. */
	readonly radius: number;
	readonly inner: number;
	readonly relief: number;
	readonly blocked: Uint8Array;
	/** The `reservoirs` fork of the water stream. */
	readonly rng: Rng;
	readonly into: LakeCells;
}

/**
 * Up to `count` reservoirs. Each candidate dam is a river cell in a valley;
 * its lake is every cell upstream of it, through the routing, lower than
 * the water level and reached through cells lower than it, so the water
 * floods up the valley and its side branches and never spills over a ridge
 * or downstream. The level is the highest that keeps the lake within its
 * drawn size and clear of blocked cells and other lakes, found by halving.
 */
export function placeReservoirs(options: ReservoirOptions): void {
	const { grid, elevation, receivers, area, threshold, count, radius, inner, relief, blocked, rng, into } = options;
	if (count <= 0) return;
	const size = grid.size;
	const cells = size * size;
	const donors = donorLists(receivers);
	const candidates: number[] = [];
	const innerSquared = inner * inner;
	const outer = RESERVOIR.outer * radius;
	const outerSquared = outer * outer;
	const valley = RESERVOIR.valley / relief;
	for (let row = 1; row < size - 1; row += 1) {
		const y = cellCentre(grid, row);
		for (let column = 1; column < size - 1; column += 1) {
			const cell = row * size + column;
			if (!(area[cell] >= RESERVOIR.area.min * threshold && area[cell] <= RESERVOIR.area.max * threshold)) continue;
			if (blocked[cell] === 1 || into.lakeOf[cell] >= 0 || receivers[cell] < 0) continue;
			const x = cellCentre(grid, column);
			const distanceSquared = x * x + y * y;
			if (distanceSquared < innerSquared || distanceSquared > outerSquared) continue;
			if (valleyDepth(elevation, size, cell) >= valley) candidates.push(cell);
		}
	}
	if (candidates.length === 0) return;
	rng.shuffle(candidates);
	const spacing = RESERVOIR.spacing * radius;
	const flood = new Flood({ cells, elevation, donors, blocked, lakeOf: into.lakeOf });
	const dams: { x: number; y: number }[] = [];
	let tries = 0;
	for (let index = 0; index < candidates.length && dams.length < count && tries < RESERVOIR.tries; index += 1) {
		const dam = candidates[index];
		const row = (dam / size) | 0;
		const x = cellCentre(grid, dam - row * size);
		const y = cellCentre(grid, row);
		if (dams.some((other) => (other.x - x) * (other.x - x) + (other.y - y) * (other.y - y) < spacing * spacing)) continue;
		tries += 1;
		const target = Math.round(RESERVOIR.cells.min + (RESERVOIR.cells.max - RESERVOIR.cells.min) * rng.float());
		const level = flood.highestLevel(dam, elevation[dam] + RESERVOIR.depth.max / relief, target);
		if (level - elevation[dam] < RESERVOIR.depth.min / relief) continue;
		const members = flood.cellsAt(dam, level);
		if (members === null || members.length < RESERVOIR.cells.min) continue;
		const receiver = receivers[dam];
		const receiverRow = (receiver / size) | 0;
		let towardX = cellCentre(grid, receiver - receiverRow * size) - x;
		let towardY = cellCentre(grid, receiverRow) - y;
		const length = sqrt(towardX * towardX + towardY * towardY);
		towardX /= length;
		towardY /= length;
		addLake({ grid, into, members, kind: 'reservoir', level, levels: null, dam: { x, y, towardX, towardY } });
		blockAround(size, members, blocked);
		dams.push({ x, y });
	}
}

/** Marks the cells round a lake's, its eight neighbours each, blocked, so the lakes made after it keep a cell of land from it. */
function blockAround(size: number, members: readonly number[], blocked: Uint8Array): void {
	for (const cell of members) forEachNeighbour(size, cell, (next) => {
		blocked[next] = 1;
	});
}

/**
 * How deep a valley `cell` lies in: how far it sits below the lower of the
 * two cells three away on either side, across whichever of the four
 * directions cuts deepest. 0 on a slope or a ridge.
 */
export function valleyDepth(elevation: ArrayLike<number>, size: number, cell: number, reach = 3): number {
	const row = (cell / size) | 0;
	const column = cell - row * size;
	if (row < reach || column < reach || row >= size - reach || column >= size - reach) return 0;
	let deepest = 0;
	const steps = [reach, reach * size, reach * (size + 1), reach * (size - 1)];
	for (let direction = 0; direction < 4; direction += 1) {
		const ahead = elevation[cell + steps[direction]];
		const behind = elevation[cell - steps[direction]];
		const depth = (ahead < behind ? ahead : behind) - elevation[cell];
		if (depth > deepest) deepest = depth;
	}
	return deepest;
}

/**
 * Every cell's water, as a depth field: under a lake, its level less the
 * land; just past its shore, the level less the land there, at most
 * -`SHORE`; elsewhere -1. Its bilinear zero is the shore, which follows the
 * land's contour at the level between a lake's cells and its dry neighbours.
 */
export function lakeDepthField({ grid, elevation, lakes }: { grid: LandGrid; elevation: Float64Array; lakes: LakeCells }): Float32Array {
	const size = grid.size;
	const { lakeOf, level } = lakes;
	const depth = new Float32Array(size * size).fill(-1);
	for (let cell = 0; cell < depth.length; cell += 1) {
		if (lakeOf[cell] < 0) continue;
		const under = level[cell] - elevation[cell];
		depth[cell] = under > SHORE ? under : SHORE;
	}
	for (let cell = 0; cell < depth.length; cell += 1) {
		if (lakeOf[cell] < 0) continue;
		const surface = level[cell];
		forEachNeighbour(size, cell, (next) => {
			if (lakeOf[next] >= 0) return;
			const above = surface - elevation[next];
			const shore = above < -SHORE ? above : -SHORE;
			if (shore > depth[next]) depth[next] = shore;
		});
	}
	return depth;
}

function addLake({ grid, into, members, kind, level, levels, dam }: {
	grid: LandGrid; into: LakeCells; members: readonly number[]; kind: LakeKind; level: number; levels: Float64Array | null; dam: Dam | null;
}): void {
	const id = into.lakes.length;
	let sumX = 0;
	let sumY = 0;
	for (const cell of members) {
		const row = (cell / grid.size) | 0;
		sumX += cellCentre(grid, cell - row * grid.size);
		sumY += cellCentre(grid, row);
		into.lakeOf[cell] = id;
		into.level[cell] = levels ? levels[cell] : level;
	}
	into.lakes.push({ kind, level, cells: members.length, x: sumX / members.length, y: sumY / members.length, dam });
}

/** Each cell's donors, the cells that drain to it, as lists packed end to end. */
function donorLists(receivers: Int32Array): { starts: Int32Array; donors: Int32Array } {
	const cells = receivers.length;
	const starts = new Int32Array(cells + 1);
	for (let cell = 0; cell < cells; cell += 1) {
		if (receivers[cell] >= 0) starts[receivers[cell] + 1] += 1;
	}
	for (let cell = 0; cell < cells; cell += 1) starts[cell + 1] += starts[cell];
	const donors = new Int32Array(starts[cells]);
	const cursor = starts.slice(0, cells);
	for (let cell = 0; cell < cells; cell += 1) {
		const receiver = receivers[cell];
		if (receiver >= 0) donors[cursor[receiver]++] = cell;
	}
	return { starts, donors };
}

/** Floods upstream of a dam, reusing its buffers. */
class Flood {
	private readonly elevation: Float64Array;
	private readonly starts: Int32Array;
	private readonly donors: Int32Array;
	private readonly blocked: Uint8Array;
	private readonly lakeOf: Int32Array;
	private readonly stack: Int32Array;
	private readonly found: number[] = [];

	constructor({ cells, elevation, donors, blocked, lakeOf }: { cells: number; elevation: Float64Array; donors: { starts: Int32Array; donors: Int32Array }; blocked: Uint8Array; lakeOf: Int32Array }) {
		this.elevation = elevation;
		this.starts = donors.starts;
		this.donors = donors.donors;
		this.blocked = blocked;
		this.lakeOf = lakeOf;
		this.stack = new Int32Array(cells);
	}

	/**
	 * The highest level, up to `top`, whose lake stays at `target` cells or
	 * fewer and clear of blocked cells and other lakes, to within a
	 * hundred-thousandth of elevation, by halving: a higher level only ever
	 * floods more. The dam's own height when even the least water is too much.
	 */
	public highestLevel(dam: number, top: number, target: number): number {
		let low = this.elevation[dam];
		let high = top;
		if (this.count(dam, high, target) >= 0) return high;
		for (let step = 0; step < 24 && high - low > 1e-5; step += 1) {
			const middle = 0.5 * (low + high);
			if (this.count(dam, middle, target) >= 0) low = middle;
			else high = middle;
		}
		return low;
	}

	/** The lake's cells at `level`, dam first, or null when it reaches a blocked cell or another lake. */
	public cellsAt(dam: number, level: number): number[] | null {
		return this.count(dam, level, Infinity) >= 0 ? this.found.slice() : null;
	}

	/** How many cells the lake at `level` covers, or -1 when that's more than `limit` or it reaches a blocked cell or another lake. */
	private count(dam: number, level: number, limit: number): number {
		const { elevation, starts, donors, blocked, lakeOf, stack, found } = this;
		found.length = 0;
		if (!(elevation[dam] < level)) return 0;
		let top = 0;
		stack[top++] = dam;
		while (top > 0) {
			const cell = stack[--top];
			if (blocked[cell] === 1 || lakeOf[cell] >= 0) return -1;
			found.push(cell);
			if (found.length > limit) return -1;
			for (let at = starts[cell]; at < starts[cell + 1]; at += 1) {
				const donor = donors[at];
				if (elevation[donor] < level) stack[top++] = donor;
			}
		}
		return found.length;
	}
}

/** Calls `visit` with each of the eight neighbours of `cell` on a grid `size` across. */
function forEachNeighbour(size: number, cell: number, visit: (next: number) => void): void {
	const row = (cell / size) | 0;
	const column = cell - row * size;
	for (let step = 0; step < 8; step += 1) {
		const nextColumn = column + STEP_COLUMNS[step];
		const nextRow = row + STEP_ROWS[step];
		if (nextColumn < 0 || nextRow < 0 || nextColumn >= size || nextRow >= size) continue;
		visit(nextRow * size + nextColumn);
	}
}
