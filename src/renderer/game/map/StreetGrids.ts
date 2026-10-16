import type { Rng } from '../core/Rng';
import { Vector, unitVector } from './Geometry';
import type { Places } from './Places';
import type { Obstacle } from './Terrain';

/**
 * Street grids (Area Map Generation, 11. Dressing): each town and village a
 * grid of blocks at a rotation of its own, the metro several districts at
 * different angles that meet along the old district lines between them.
 * Blocks that didn't survive are rubble. Drawing only: nothing reads a grid
 * but the view. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/dressing.md.
 */

export type DistrictKind = 'metro' | 'town' | 'village';

/** One grid of blocks: a town's, a village's, or one district of the metro. */
export interface StreetDistrict {
	/** The place it belongs to, by its id in the places list: the metro is 0. */
	readonly place: number;
	readonly kind: DistrictKind;
	/** A corner of its blocks, where two of its streets cross, world units. */
	readonly x: number;
	readonly y: number;
	/** Along its streets one way, a unit vector; the cross streets run along (-uy, ux). */
	readonly ux: number;
	readonly uy: number;
	/** World units from one street to the next, so a block is this square less the street. */
	readonly spacing: number;
	/** Standing blocks' centres, x, y per block. */
	readonly blocks: Float64Array;
	/** Rubble blocks' centres, x, y per block. */
	readonly rubble: Float64Array;
}

/**
 * - `spacing`: world units between streets, from `wide` at `streetGrids` 0
 *   to `narrow` at 1.
 * - `survival`: a block's chance of standing at the ruin's middle, from
 *   `least` at `streetGrids` 0 to `most` at 1, falling by `fall` times the
 *   square of its share of the way to the ruin's edge.
 * - `edge`: the ruin's edge, drawn per block between 1 less and 1 more than
 *   half `edge` of the ruin's radius, so it's ragged.
 * - `districts`: the metro's, `base` plus one per `per` world units of its
 *   radius, at most `most`; the first at the middle within `centre` of the
 *   radius, the rest `inner` to `outer` of it out, evenly round and jittered
 *   by up to `jitter` of the gap between them. Their grids' angles are
 *   spread evenly over a quarter turn from a drawn one, in a shuffled order,
 *   each jittered by up to `jitter` of the step, so any two differ by at
 *   least half a step.
 * - `line`: world units either side of the line between two districts that
 *   no block reaches, so their streets meet along it.
 *
 * Every block a road or rail runs through, however little of it, is street.
 */
export const STREET_GRIDS = {
	spacing: { wide: 14, narrow: 8 },
	survival: { least: 0.3, most: 0.9, fall: 0.6 },
	edge: 0.3,
	districts: { base: 2, per: 50, most: 7, centre: 0.15, inner: 0.45, outer: 0.8, jitter: 0.25 },
	line: 2,
} as const;

/** What the grids ask of the land: what stands at a point, and whether a river's water lies near it. */
export interface GridGround {
	obstacle(x: number, y: number): Obstacle | null;
	nearRiver(x: number, y: number, reach: number): boolean;
}

export interface StreetGridOptions {
	readonly places: Pick<Places, 'metro' | 'towns' | 'villages'>;
	/** Lines that run through a grid, roads and rails: every block one crosses is street. */
	readonly lines: readonly { readonly points: readonly number[] }[];
	readonly ground: GridGround;
	/** `streetGrids`. */
	readonly built: number;
	/** How much of each ruin's radius its grid covers, 0 to 1: `dressing`'s share of its default, capped at 1. */
	readonly cover: number;
	/** The grids' stream; each ruin forks its own from it by its id. */
	readonly rng: Rng;
}

// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const floor = Math.floor;
const sqrt = Math.sqrt;

/** Every ruin's grid, the metro's districts first, then the towns', then the villages', each in its places-list order. */
export function streetGrids({ places, lines, ground, built, cover, rng }: StreetGridOptions): StreetDistrict[] {
	if (cover <= 0) return [];
	const spacing = STREET_GRIDS.spacing.wide + (STREET_GRIDS.spacing.narrow - STREET_GRIDS.spacing.wide) * built;
	const survival = STREET_GRIDS.survival.least + (STREET_GRIDS.survival.most - STREET_GRIDS.survival.least) * built;
	const ruins: Ruin[] = [
		{ place: places.metro.id, kind: 'metro', x: places.metro.x, y: places.metro.y, radius: places.metro.radius * cover },
		...places.towns.map(({ id, x, y, radius }): Ruin => ({ place: id, kind: 'town', x, y, radius: radius * cover })),
		...places.villages.map(({ id, x, y, radius }): Ruin => ({ place: id, kind: 'village', x, y, radius: radius * cover })),
	];
	const districts: StreetDistrict[] = [];
	for (const ruin of ruins) {
		const own = rng.fork('ruin', ruin.place);
		const seeds = ruin.kind === 'metro' ? metroSeeds(ruin, own) : [{ x: ruin.x, y: ruin.y, angle: own.float() * 90 }];
		const near = lines.filter(({ points }) => reaches(points, ruin));
		seeds.forEach((seed, index) => {
			const district = layDistrict({ ruin, seeds, index, spacing, survival, near, ground, rng: own.fork('district', index) });
			if (district.blocks.length + district.rubble.length > 0) districts.push(district);
		});
	}
	return districts;
}

interface Ruin {
	readonly place: number;
	readonly kind: DistrictKind;
	readonly x: number;
	readonly y: number;
	readonly radius: number;
}

interface DistrictSeed {
	readonly x: number;
	readonly y: number;
	/** Degrees, 0 up to 90: a grid looks the same turned a quarter. */
	readonly angle: number;
}

/** The metro's districts: where each grid is laid from, and its angle, each turned from every other's. */
function metroSeeds(ruin: Ruin, rng: Rng): DistrictSeed[] {
	const { base, per, most, centre, inner, outer, jitter } = STREET_GRIDS.districts;
	const count = Math.min(most, base + floor(ruin.radius / per));
	const towards: Vector = { x: 0, y: 0 };
	const spin = rng.float() * 360;
	const gap = 360 / (count - 1);
	const turn = rng.float() * 90;
	const turnStep = 90 / count;
	const turns = rng.shuffle([...Array(count).keys()]);
	const seeds: DistrictSeed[] = [];
	for (let index = 0; index < count; index += 1) {
		let x: number;
		let y: number;
		if (index === 0) {
			unitVector(rng.float() * 360, towards);
			const out = rng.float() * centre * ruin.radius;
			x = ruin.x + towards.x * out;
			y = ruin.y + towards.y * out;
		} else {
			unitVector(spin + gap * (index - 1 + (rng.float() - 0.5) * 2 * jitter), towards);
			const out = (inner + (outer - inner) * rng.float()) * ruin.radius;
			x = ruin.x + towards.x * out;
			y = ruin.y + towards.y * out;
		}
		const angle = turn + turnStep * (turns[index] + (rng.float() - 0.5) * 2 * jitter);
		seeds.push({ x, y, angle: ((angle % 90) + 90) % 90 });
	}
	return seeds;
}

/** Whether a road's polyline might come within the ruin's reach: its bounding box overlaps the reach's. */
function reaches(points: readonly number[], { x, y, radius }: Ruin): boolean {
	const reach = radius * (1 + STREET_GRIDS.edge);
	let left = Infinity;
	let right = -Infinity;
	let bottom = Infinity;
	let top = -Infinity;
	for (let index = 0; index < points.length; index += 2) {
		if (points[index] < left) left = points[index];
		if (points[index] > right) right = points[index];
		if (points[index + 1] < bottom) bottom = points[index + 1];
		if (points[index + 1] > top) top = points[index + 1];
	}
	return left < x + reach && right > x - reach && bottom < y + reach && top > y - reach;
}

/**
 * One grid: its blocks over the ruin, kept where the district is nearest its
 * own seed by `line` and more, where the land under it is dry and whole, and
 * where no road or rail runs through it; standing or rubble by the survival odds.
 */
function layDistrict({ ruin, seeds, index, spacing, survival, near, ground, rng }: {
	ruin: Ruin; seeds: readonly DistrictSeed[]; index: number; spacing: number; survival: number;
	near: readonly { readonly points: readonly number[] }[]; ground: GridGround; rng: Rng;
}): StreetDistrict {
	const seed = seeds[index];
	const along: Vector = unitVector(seed.angle, { x: 0, y: 0 });
	const ux = along.x;
	const uy = along.y;
	// The cross streets run along (vx, vy).
	const vx = -uy;
	const vy = ux;
	const reach = ruin.radius * (1 + STREET_GRIDS.edge / 2);
	const span = floor(reach / spacing) + 2;
	const side = 2 * span;
	const streets = new Uint8Array(side * side);
	// Each road segment in block units, the grid's corner at (span, span).
	const across = (px: number, py: number): number => ((px - seed.x) * ux + (py - seed.y) * uy) / spacing + span;
	const up = (px: number, py: number): number => ((px - seed.x) * vx + (py - seed.y) * vy) / spacing + span;
	for (const { points } of near) {
		for (let point = 0; point + 3 < points.length; point += 2) {
			const [ax, ay, bx, by] = [points[point], points[point + 1], points[point + 2], points[point + 3]];
			markBlocks({ streets, side, from: across(ax, ay), fromUp: up(ax, ay), to: across(bx, by), toUp: up(bx, by) });
		}
	}
	const half = spacing / 2;
	const blocks: number[] = [];
	const rubble: number[] = [];
	const corner = [-half, -half, half, -half, half, half, -half, half];
	for (let row = 0; row < side; row += 1) {
		for (let column = 0; column < side; column += 1) {
			// Every block takes its two draws, so one block's fate never moves another's.
			const edgeDraw = rng.float();
			const standDraw = rng.float();
			if (streets[row * side + column] === 1) continue;
			const across = (column - span + 0.5) * spacing;
			const up = (row - span + 0.5) * spacing;
			const x = seed.x + ux * across + vx * up;
			const y = seed.y + uy * across + vy * up;
			const dx = x - ruin.x;
			const dy = y - ruin.y;
			const out = sqrt(dx * dx + dy * dy) / ruin.radius;
			if (out > 1 + STREET_GRIDS.edge * (edgeDraw - 0.5)) continue;
			let whole = ground.obstacle(x, y) === null && !ground.nearRiver(x, y, half);
			for (let at = 0; whole && at < corner.length; at += 2) {
				const cornerX = x + ux * corner[at] + vx * corner[at + 1];
				const cornerY = y + uy * corner[at] + vy * corner[at + 1];
				whole = ground.obstacle(cornerX, cornerY) === null && ownedBy({ seeds, index, x: cornerX, y: cornerY });
			}
			if (!whole) continue;
			const odds = survival * (1 - STREET_GRIDS.survival.fall * out * out);
			(standDraw < odds ? blocks : rubble).push(x, y);
		}
	}
	return Object.freeze({
		place: ruin.place, kind: ruin.kind, x: seed.x, y: seed.y, ux, uy, spacing, blocks: Float64Array.from(blocks), rubble: Float64Array.from(rubble),
	});
}

/**
 * Marks every block a segment runs through, walking it block by block
 * (Amanatides and Woo), so a road that clips a block's corner still makes it
 * street. Coordinates are in blocks; anything off the grid is left alone.
 */
function markBlocks({ streets, side, from, fromUp, to, toUp }: { streets: Uint8Array; side: number; from: number; fromUp: number; to: number; toUp: number }): void {
	let column = floor(from);
	let row = floor(fromUp);
	const lastColumn = floor(to);
	const lastRow = floor(toUp);
	const along = to - from;
	const rise = toUp - fromUp;
	const stepColumn = along > 0 ? 1 : -1;
	const stepRow = rise > 0 ? 1 : -1;
	// How far along the segment, 0 to 1, each block crossing takes, and where the next one is.
	const perColumn = along === 0 ? Infinity : stepColumn / along;
	const perRow = rise === 0 ? Infinity : stepRow / rise;
	let nextColumn = along === 0 ? Infinity : (along > 0 ? column + 1 - from : from - column) * perColumn;
	let nextRow = rise === 0 ? Infinity : (rise > 0 ? row + 1 - fromUp : fromUp - row) * perRow;
	const crossings = (lastColumn > column ? lastColumn - column : column - lastColumn) + (lastRow > row ? lastRow - row : row - lastRow);
	for (let crossing = 0; ; crossing += 1) {
		if (column >= 0 && row >= 0 && column < side && row < side) streets[row * side + column] = 1;
		if (crossing === crossings) break;
		if (nextColumn < nextRow) {
			column += stepColumn;
			nextColumn += perColumn;
		} else {
			row += stepRow;
			nextRow += perRow;
		}
	}
}

/** Whether (x, y) is nearer district `index`'s seed than any other's by `line` world units or more. */
function ownedBy({ seeds, index, x, y }: { seeds: readonly DistrictSeed[]; index: number; x: number; y: number }): boolean {
	if (seeds.length === 1) return true;
	const own = distance(seeds[index], x, y) + STREET_GRIDS.line;
	for (let other = 0; other < seeds.length; other += 1) {
		if (other !== index && distance(seeds[other], x, y) < own) return false;
	}
	return true;
}

function distance({ x, y }: { x: number; y: number }, px: number, py: number): number {
	const dx = px - x;
	const dy = py - y;
	return sqrt(dx * dx + dy * dy);
}
