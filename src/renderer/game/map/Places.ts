import type { Rng } from '../core/Rng';
import { unitVector } from './Geometry';
import { RELIEF, startRadii } from './Land';
import { LandGrid, cellCentre } from './LandGrid';
import { smooth01 } from './MapMath';
import type { MapParams } from './MapParams';
import { placeNames } from './PlaceNames';
import type { Terrain } from './Terrain';
import { CRATER_GAP, Hotspot } from './TerrainSites';
import type { Water } from './Water';

/**
 * Stage 4 of area map generation, places (Area Map Generation, Pipeline, 4.
 * Settlements), after the water and the hazards, on the `places` stream:
 *
 * - the metro, the ruins round the compound, `metroSize` of the radius;
 * - towns and villages where real ones are, taken best first by a
 *   suitability score per land cell (`suitabilityField`), towns a quarter of
 *   the radius apart and villages a tenth, each named;
 * - crossroads, unnamed, Poisson-spaced over usable land by `roadDensity`,
 *   where county roads will meet;
 * - exits at the rim: the `highways`, `highwaySeparation` apart, each slid
 *   to the gentlest ground nearby, and a back-road exit in each wide gap
 *   between them.
 *
 * Every place stands where a road from the metro surely reaches it: a flood
 * fill from the metro over the squares between land cell centres that no
 * rough ground, crater, or lake reaches into (rivers are bridged), so road
 * links (Maps 7 and 8) can join them all. The output is plain, frozen data
 * that crosses the worker boundary as it is. Each feature draws on its own
 * fork of the stream (`suitability`, `towns`, `villages`, `exits`,
 * `crossroads`, `names`), so retuning one never moves another's draws.
 * Everything is adds, multiplies, divides, compares, and square roots.
 * Starting values are provisional calls, listed in
 * docs/AI_TECHNICAL_DECISIONS/places.md.
 */

export type PlaceKind = 'metro' | 'town' | 'village' | 'crossroads' | 'exit';

interface PlaceBase {
	/** Its index in `placeList`: the metro 0, then towns, villages, crossroads, and exits. */
	readonly id: number;
	/** World units, the compound at the origin. */
	readonly x: number;
	readonly y: number;
}

/** The ruined city round the compound. */
export interface Metro extends PlaceBase {
	readonly kind: 'metro';
	/** World units of ruins. */
	readonly radius: number;
}

/** A ruined town or village, named. */
export interface Settlement extends PlaceBase {
	readonly kind: 'town' | 'village';
	/** World units of ruins round its centre. */
	readonly radius: number;
	readonly name: string;
	/** Its cell's suitability score, what it was picked on: higher is better ground. */
	readonly suitability: number;
}

/** An unnamed place county roads meet at. */
export interface Crossroads extends PlaceBase {
	readonly kind: 'crossroads';
}

/** Where a road leaves the area, just inside the rim. */
export interface Exit extends PlaceBase {
	readonly kind: 'exit';
	/** Degrees counterclockwise from east (+x), 0 up to 360. */
	readonly bearing: number;
	/** A highway leaves here; otherwise a back road. */
	readonly highway: boolean;
}

export type Place = Metro | Settlement | Crossroads | Exit;

/** The places stage's output: plain data, frozen. */
export interface Places {
	readonly metro: Metro;
	/** Best ground first. */
	readonly towns: readonly Settlement[];
	readonly villages: readonly Settlement[];
	readonly crossroads: readonly Crossroads[];
	/** Highway exits first, counterclockwise from the first, then back-road exits in the same order. */
	readonly exits: readonly Exit[];
}

/**
 * Settlement spacing as a share of the radius: towns about a quarter of it
 * apart, villages a tenth, and a village that far from a town too.
 */
export const SETTLEMENT_SPACING = { town: 0.25, village: 0.1 } as const;
/**
 * Ruins round a settlement: a share of the metro's radius between `min` and
 * `max`, drawn on its kind's fork, and never under `floor` world units.
 */
export const RUIN_SIZE = {
	town: { min: 0.25, max: 0.4, floor: 20 },
	village: { min: 0.08, max: 0.14, floor: 8 },
} as const;
/**
 * Where settlements go: their centres this share of their own spacing past
 * the metro's edge, and their ruins outside the blend radius and inside
 * `outer` of the radius.
 */
export const SETTLED = { metroGap: 0.8, outer: 0.92 } as const;
/**
 * The suitability score, per land cell:
 *
 * - `flat` for level ground, falling to nothing at a grade of `flatGrade`;
 * - `valley` times the water's low ground, the valley floor;
 * - `river` beside a river or lake, falling to nothing `riverReach` world
 *   units off, half as much for a creek at the stream threshold as for a
 *   river `riverSize` steps of the square root of its area's multiple of it
 *   or more, and three quarters for a lake;
 * - `confluence` near where two rivers join, falling to nothing at
 *   `confluenceReach`;
 * - less `height` a unit of elevation and `ranges` of the range mask;
 * - none at all where the range mask reaches `heart`;
 * - plus `noise` of an even draw per cell.
 */
export const SUITABILITY = {
	flat: 1.2, flatGrade: 0.25,
	valley: 0.6,
	river: 1.1, riverReach: 60, riverSize: 4, lake: 0.75,
	confluence: 0.6, confluenceReach: 90,
	height: 0.8,
	ranges: 1.2, heart: 0.5,
	noise: 0.4,
} as const;
/** World units a place's centre keeps from a river's water. */
export const RIVER_CLEARANCE = 4;
/**
 * Crossroads: `sparse` world units apart at `roadDensity` 0 to `dense` at 1;
 * `others` of that from towns, villages, and exits, and `metro` of it past
 * the metro's edge; on ground no steeper than `grade`, outside the ranges'
 * heart, inside `outer` of the radius.
 */
export const CROSSROADS = { sparse: 140, dense: 70, others: 0.75, metro: 0.5, grade: 0.6, outer: 0.93 } as const;
/**
 * Exits: `inset` of the radius in from the rim. Each slides up to `slide`
 * degrees either way, in `step`s, to the gentlest ground, its grade averaged
 * there and a cell further in, paying `penalty` of grade a degree it slides,
 * and never so far it could come within `highwaySeparation` of the next.
 * A back-road exit goes in each gap between highway exits `backGap` degrees
 * wide or more, at least `backClearance` from either side.
 */
export const EXITS = { inset: 0.015, slide: 8, step: 1, penalty: 0.0175, backGap: 30, backClearance: 12 } as const;
/** Jittered sets of bearings drawn, at most, for one that keeps `highwaySeparation`, before the last is pulled in to fit. */
const BEARING_DRAWS = 16;

// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;
const SQRT2 = Math.SQRT2;

export interface PlacesOptions {
	readonly params: MapParams;
	/** The land with its water and hazards: the hazards stage's `hazards.terrain`. */
	readonly terrain: Terrain;
	/** The water stage's: its routing, low ground, lakes, and where its rivers run. */
	readonly water: Pick<Water, 'surface' | 'nearRiver'>;
	/** The stage's stream, nested in the hazards' winning one; places fork it by feature and never draw from it directly. */
	readonly rng: Rng;
}

/** Stage 4: the metro, towns and villages, crossroads, and exits. */
export function generatePlaces({ params, terrain, water, rng }: PlacesOptions): Places {
	const site = new SiteField({ params, terrain, water, rng: rng.fork('suitability') });
	const { metroRadius } = startRadii(params);
	const towns = site.settle({ kind: 'town', count: params.towns, rng: rng.fork('towns'), others: [] });
	const villages = site.settle({ kind: 'village', count: params.villages, rng: rng.fork('villages'), others: towns });
	const names = placeNames(rng.fork('names'));
	const exits = placeExits({ params, terrain, rng: rng.fork('exits') });
	const crossroads = site.crossroads({ rng: rng.fork('crossroads'), others: [...towns, ...villages, ...exits] });
	let id = 1;
	const settled = (kind: 'town' | 'village') => ({ x, y, radius, suitability }: Spot): Settlement => ({ id: id++, kind, x, y, radius, name: names(), suitability });
	const townPlaces = towns.map(settled('town'));
	const villagePlaces = villages.map(settled('village'));
	const crossroadPlaces = crossroads.map(({ x, y }): Crossroads => ({ id: id++, kind: 'crossroads', x, y }));
	const exitPlaces = exits.map(({ x, y, bearing, highway }): Exit => ({ id: id++, kind: 'exit', x, y, bearing, highway }));
	return freezePlaces({
		metro: { id: 0, kind: 'metro', x: 0, y: 0, radius: metroRadius },
		towns: townPlaces,
		villages: villagePlaces,
		crossroads: crossroadPlaces,
		exits: exitPlaces,
	});
}

/** Every place in id order: the metro, then towns, villages, crossroads, and exits. */
export function placeList({ metro, towns, villages, crossroads, exits }: Places): Place[] {
	return [metro, ...towns, ...villages, ...crossroads, ...exits];
}

/** The ruins on the map: the metro, every town, and every village. */
export function ruinsOf({ metro, towns, villages }: Places): (Metro | Settlement)[] {
	return [metro, ...towns, ...villages];
}

/** Places frozen through, as the stage hands them out and as the client gets them back from the worker. */
export function freezePlaces({ metro, towns, villages, crossroads, exits }: Places): Places {
	const freezeAll = <T extends object>(list: readonly T[]): readonly T[] => Object.freeze(list.map((place) => Object.freeze({ ...place })));
	return Object.freeze({
		metro: Object.freeze({ ...metro }),
		towns: freezeAll(towns),
		villages: freezeAll(villages),
		crossroads: freezeAll(crossroads),
		exits: freezeAll(exits),
	});
}

/** A spot picked for a place, before it's named and numbered. */
interface Spot {
	readonly x: number;
	readonly y: number;
	readonly radius: number;
	readonly suitability: number;
}

/** A point another place keeps its spacing from. */
interface Point {
	readonly x: number;
	readonly y: number;
}

/**
 * Per land cell, what places are picked on: the suitability score, where a
 * road from the metro surely reaches, and how far the cell is from water.
 */
class SiteField {
	/** Per cell: the suitability score, -Infinity where no town or village may go. */
	public readonly suitability: Float64Array;
	/**
	 * Per cell: 1 where the four squares round its centre are reached from
	 * the metro, its centre keeps off river water, and it's outside the
	 * ranges' heart. Every place but an exit stands on one.
	 */
	public readonly usable: Uint8Array;
	private readonly params: MapParams;
	private readonly grid: LandGrid;
	private readonly grade: Float64Array;
	private readonly lakeDistance: Float64Array;
	private readonly hotspots: readonly Hotspot[];
	private readonly metroRadius: number;
	private readonly blendRadius: number;
	/** Cells with a score, best first, ties to the lower index. */
	private readonly order: Int32Array;

	constructor({ params, terrain, water, rng }: PlacesOptions) {
		const { grid, elevation, mountains } = terrain.surface;
		const size = grid.size;
		const cells = size * size;
		const { metroRadius, blendRadius } = startRadii(params);
		this.params = params;
		this.grid = grid;
		this.hotspots = terrain.hotspots;
		this.metroRadius = metroRadius;
		this.blendRadius = blendRadius;
		this.grade = gradeField(grid, elevation);

		const { receivers, area, threshold, lakeOf, lowland } = water.surface;
		const isRiver = (cell: number) => area[cell] >= threshold && lakeOf[cell] < 0;
		const riverSources = new Float64Array(cells).fill(-1);
		const lakeSources = new Float64Array(cells).fill(-1);
		const joins = new Uint8Array(cells);
		for (let cell = 0; cell < cells; cell += 1) {
			if (lakeOf[cell] >= 0) {
				riverSources[cell] = SUITABILITY.lake;
				lakeSources[cell] = 1;
			} else if (isRiver(cell)) {
				const steps = (sqrt(area[cell] / threshold) - 1) / SUITABILITY.riverSize;
				riverSources[cell] = 0.5 + 0.5 * (steps > 1 ? 1 : steps);
				const receiver = receivers[cell];
				if (receiver >= 0 && isRiver(receiver) && joins[receiver] < 2) joins[receiver] += 1;
			}
		}
		const confluenceSources = new Float64Array(cells).fill(-1);
		for (let cell = 0; cell < cells; cell += 1) if (joins[cell] >= 2) confluenceSources[cell] = 1;
		const river = distanceField(grid, riverSources);
		const confluence = distanceField(grid, confluenceSources);
		this.lakeDistance = distanceField(grid, lakeSources).distance;

		const reached = reachedSquares({ grid, open: terrain.openSquares, lakeOf, hotspots: this.hotspots });
		const usable = new Uint8Array(cells);
		const suitability = new Float64Array(cells).fill(-Infinity);
		const noise = new Float64Array(cells);
		for (let cell = 0; cell < cells; cell += 1) noise[cell] = rng.float();
		const squares = size - 1;
		// Past this, no river's water comes within the clearance: its line strays under three cells from its cells, and the widest is 9 across.
		const riverNear = 5 * grid.cellSize + 10;
		const radiusSquared = params.radius * params.radius;
		for (let row = 1; row < size - 1; row += 1) {
			const y = cellCentre(grid, row);
			for (let column = 1; column < size - 1; column += 1) {
				const x = cellCentre(grid, column);
				if (x * x + y * y > radiusSquared) continue;
				const square = (row - 1) * squares + column - 1;
				if (!(reached[square] === 1 && reached[square + 1] === 1 && reached[square + squares] === 1 && reached[square + squares + 1] === 1)) continue;
				const cell = row * size + column;
				if (river.distance[cell] <= riverNear && water.nearRiver(x, y, RIVER_CLEARANCE)) continue;
				if (mountains[cell] >= SUITABILITY.heart) continue;
				usable[cell] = 1;
				let score = SUITABILITY.flat * (1 - smooth01(this.grade[cell] / SUITABILITY.flatGrade))
					+ SUITABILITY.valley * lowland[cell]
					- SUITABILITY.height * elevation[cell]
					- SUITABILITY.ranges * mountains[cell]
					+ SUITABILITY.noise * noise[cell];
				if (river.value[cell] > 0) score += SUITABILITY.river * river.value[cell] * (1 - smooth01(river.distance[cell] / SUITABILITY.riverReach));
				if (confluence.value[cell] > 0) score += SUITABILITY.confluence * (1 - smooth01(confluence.distance[cell] / SUITABILITY.confluenceReach));
				suitability[cell] = score;
			}
		}
		this.usable = usable;
		this.suitability = suitability;
		const ranked: number[] = [];
		for (let cell = 0; cell < cells; cell += 1) if (suitability[cell] > -Infinity) ranked.push(cell);
		ranked.sort((a, b) => suitability[b] - suitability[a] || a - b);
		this.order = Int32Array.from(ranked);
	}

	/**
	 * Up to `count` towns or villages, best cell first: each its kind's
	 * spacing from the others of its kind and from `others`, past the metro
	 * by `SETTLED.metroGap` of that, its ruins outside the blend radius and
	 * inside `SETTLED.outer` of the radius, `CRATER_GAP` clear of every crater,
	 * and clear of the lakes. Each one's ruins are drawn once it's placed;
	 * the checks use the largest its kind can draw, so the order a cell is
	 * looked at in never changes what fits there.
	 */
	public settle({ kind, count, rng, others }: { kind: 'town' | 'village'; count: number; rng: Rng; others: readonly Point[] }): Spot[] {
		const { grid, params, metroRadius } = this;
		const size = grid.size;
		const spacing = SETTLEMENT_SPACING[kind] * params.radius;
		const sizes = RUIN_SIZE[kind];
		const largest = Math.max(sizes.floor, metroRadius * sizes.max);
		const inner = Math.max(this.blendRadius + largest, metroRadius + SETTLED.metroGap * spacing);
		const outer = SETTLED.outer * params.radius - largest;
		const spacingSquared = spacing * spacing;
		const spots: Spot[] = [];
		for (let index = 0; index < this.order.length && spots.length < count; index += 1) {
			const cell = this.order[index];
			const x = cellCentre(grid, cell % size);
			const y = cellCentre(grid, floor(cell / size));
			const fromCentre = x * x + y * y;
			if (fromCentre < inner * inner || fromCentre > outer * outer) continue;
			if (this.lakeDistance[cell] < largest + grid.cellSize) continue;
			if (!this.clearOfCraters(x, y, largest)) continue;
			if (!farFrom(x, y, spots, spacingSquared) || !farFrom(x, y, others, spacingSquared)) continue;
			spots.push({ x, y, radius: 0, suitability: this.suitability[cell] });
		}
		return spots.map((spot) => ({ ...spot, radius: Math.max(sizes.floor, metroRadius * (sizes.min + (sizes.max - sizes.min) * rng.float())) }));
	}

	/**
	 * Crossroads dart-thrown over the usable cells, in an order shuffled from
	 * the stream: a cell's centre is kept when it's the crossroads spacing
	 * from every one kept before, `CROSSROADS.others` of it from `others`, and
	 * past the metro's edge by `CROSSROADS.metro` of it.
	 */
	public crossroads({ rng, others }: { rng: Rng; others: readonly Point[] }): Point[] {
		const { grid, params, metroRadius } = this;
		const size = grid.size;
		const spacing = CROSSROADS.sparse + (CROSSROADS.dense - CROSSROADS.sparse) * params.roadDensity;
		const inner = metroRadius + CROSSROADS.metro * spacing;
		const outer = CROSSROADS.outer * params.radius;
		const candidates: number[] = [];
		for (let cell = 0; cell < this.usable.length; cell += 1) {
			if (this.usable[cell] !== 1 || this.grade[cell] > CROSSROADS.grade) continue;
			const x = cellCentre(grid, cell % size);
			const y = cellCentre(grid, floor(cell / size));
			const fromCentre = x * x + y * y;
			if (fromCentre >= inner * inner && fromCentre <= outer * outer && this.clearOfCraters(x, y, 0)) candidates.push(cell);
		}
		rng.shuffle(candidates);
		const buckets = new SpacingBuckets({ extent: grid.halfExtent, spacing });
		const othersSquared = CROSSROADS.others * spacing * CROSSROADS.others * spacing;
		const kept: Point[] = [];
		for (const cell of candidates) {
			const x = cellCentre(grid, cell % size);
			const y = cellCentre(grid, floor(cell / size));
			if (!buckets.clear(x, y) || !farFrom(x, y, others, othersSquared)) continue;
			buckets.add(x, y);
			kept.push({ x, y });
		}
		return kept;
	}

	/** Whether ruins of `radius` at (x, y) keep `CRATER_GAP` from every crater. */
	private clearOfCraters(x: number, y: number, radius: number): boolean {
		for (const { x: cx, y: cy, craterRadius } of this.hotspots) {
			const clearance = craterRadius + radius + CRATER_GAP;
			if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < clearance * clearance) return false;
		}
		return true;
	}
}

/**
 * The suitability score per land cell for a map, -Infinity where no town or
 * village may go: what towns and villages are taken from, best first.
 */
export function suitabilityField(options: PlacesOptions): Float64Array {
	return new SiteField({ ...options, rng: options.rng.fork('suitability') }).suitability;
}

/**
 * Exits at the rim: the highways' first, counterclockwise, then a back road's
 * in each gap between them `EXITS.backGap` degrees wide or more.
 */
function placeExits({ params, terrain, rng }: { params: MapParams; terrain: Terrain; rng: Rng }): Omit<Exit, 'id' | 'kind'>[] {
	const separation = params.highwaySeparation;
	const bearings = exitBearings({ count: params.highways, separation, rng: rng.fork('bearings') });
	const count = bearings.length;
	const ground = new RimGround({ terrain, radius: params.radius });
	const highways = bearings.map((bearing, index) => {
		const before = arc(bearings[(index + count - 1) % count], bearing);
		const after = arc(bearing, bearings[(index + 1) % count]);
		// Each exit slides at most half the slack toward a neighbour, so two sliding toward each other still keep the separation.
		const back = Math.min(EXITS.slide, Math.max(0, (count > 1 ? before - separation : Infinity) / 2));
		const ahead = Math.min(EXITS.slide, Math.max(0, (count > 1 ? after - separation : Infinity) / 2));
		return ground.gentlest(bearing, back, ahead);
	});
	const backRoads: number[] = [];
	if (count > 1) {
		highways.forEach((from, index) => {
			const to = highways[(index + 1) % count];
			const gap = arc(from, to);
			if (gap < EXITS.backGap) return;
			const room = gap / 2 - EXITS.backClearance;
			const target = from + gap / 2 + (rng.fork('back', index).float() * 2 - 1) * 0.5 * room;
			const back = Math.min(EXITS.slide, target - (from + EXITS.backClearance));
			const ahead = Math.min(EXITS.slide, from + gap - EXITS.backClearance - target);
			backRoads.push(ground.gentlest(normalised(target), back, ahead));
		});
	}
	return [
		...highways.map((bearing) => ({ ...ground.at(bearing), bearing, highway: true })),
		...backRoads.map((bearing) => ({ ...ground.at(bearing), bearing, highway: false })),
	];
}

/**
 * `count` bearings in degrees, 0 up to 360, counterclockwise: even spacing
 * turned by a random rotation, each jittered by up to a third of the gap,
 * every neighbouring pair at least `separation` apart. Up to `BEARING_DRAWS`
 * sets of jitter are drawn for one that keeps the separation; if none does,
 * the last is scaled down until it does, which even spacing always does
 * while `count` times `separation` is 360 or less.
 */
export function exitBearings({ count, separation, rng }: { count: number; separation: number; rng: Rng }): number[] {
	const gap = 360 / count;
	const reach = gap / 3;
	const slack = Math.max(0, gap - separation);
	const rotation = rng.float() * gap;
	const jitter: number[] = new Array(count).fill(0);
	let squeeze = Infinity;
	for (let draw = 0; draw < BEARING_DRAWS && squeeze > slack; draw += 1) {
		for (let index = 0; index < count; index += 1) jitter[index] = (rng.float() * 2 - 1) * reach;
		squeeze = worstSqueeze(jitter);
	}
	if (squeeze > slack) {
		const scale = slack / squeeze;
		for (let index = 0; index < count; index += 1) jitter[index] *= scale;
	}
	return jitter.map((offset, index) => normalised(rotation + index * gap + offset));
}

/** How much jitter narrows the tightest gap: the largest fall from one bearing's jitter to the next's, round the circle. */
function worstSqueeze(jitter: readonly number[]): number {
	let worst = -Infinity;
	for (let index = 0; index < jitter.length; index += 1) {
		const fall = jitter[index] - jitter[(index + 1) % jitter.length];
		if (fall > worst) worst = fall;
	}
	return worst;
}

/** The ground just inside the rim, by bearing: where an exit is, and how gentle and passable the ground there is. */
class RimGround {
	private readonly terrain: Terrain;
	private readonly at1: number;
	private readonly at2: number;
	private readonly direction = { x: 0, y: 0 };

	constructor({ terrain, radius }: { terrain: Terrain; radius: number }) {
		this.terrain = terrain;
		this.at1 = radius * (1 - EXITS.inset);
		this.at2 = this.at1 - terrain.surface.grid.cellSize;
	}

	/** The exit's point on `bearing`. */
	public at(bearing: number): { x: number; y: number } {
		unitVector(bearing, this.direction);
		return { x: this.direction.x * this.at1, y: this.direction.y * this.at1 };
	}

	/**
	 * The bearing within `back` degrees clockwise and `ahead` counterclockwise
	 * of `bearing`, on `EXITS.step`s from it, whose ground is gentlest less
	 * `EXITS.penalty` a degree slid, over passable ground; `bearing` itself
	 * when none is passable.
	 */
	public gentlest(bearing: number, back: number, ahead: number): number {
		let best = bearing;
		let bestCost = Infinity;
		const first = -floor(back / EXITS.step);
		const last = floor(ahead / EXITS.step);
		for (let step = first; step <= last; step += 1) {
			const offset = step * EXITS.step;
			const candidate = normalised(bearing + offset);
			const grade = this.grade(candidate);
			const cost = grade + EXITS.penalty * (offset < 0 ? -offset : offset);
			if (cost < bestCost) {
				bestCost = cost;
				best = candidate;
			}
		}
		return best;
	}

	/** The grade averaged at the exit's point and a cell further in, or Infinity where either is impassable. */
	private grade(bearing: number): number {
		const { terrain, direction } = this;
		unitVector(bearing, direction);
		const x1 = direction.x * this.at1;
		const y1 = direction.y * this.at1;
		const x2 = direction.x * this.at2;
		const y2 = direction.y * this.at2;
		if (terrain.obstacle(x1, y1) !== null || terrain.obstacle(x2, y2) !== null) return Infinity;
		return 0.5 * (terrain.grade(x1, y1) + terrain.grade(x2, y2));
	}
}

/** Degrees counterclockwise from `from` round to `to`, 0 up to 360. */
function arc(from: number, to: number): number {
	return normalised(to - from);
}

function normalised(bearing: number): number {
	const turned = bearing % 360;
	return turned < 0 ? turned + 360 : turned;
}

function farFrom(x: number, y: number, points: readonly Point[], squared: number): boolean {
	for (let index = 0; index < points.length; index += 1) {
		const dx = x - points[index].x;
		const dy = y - points[index].y;
		if (dx * dx + dy * dy < squared) return false;
	}
	return true;
}

/** Per cell, the grade of the eroded land, rise over run, from its neighbours either side. */
function gradeField(grid: LandGrid, elevation: Float64Array): Float64Array {
	const size = grid.size;
	const grade = new Float64Array(size * size);
	const toGrade = RELIEF / grid.cellSize;
	for (let row = 0; row < size; row += 1) {
		const below = row > 0 ? row - 1 : row;
		const above = row < size - 1 ? row + 1 : row;
		for (let column = 0; column < size; column += 1) {
			const left = column > 0 ? column - 1 : column;
			const right = column < size - 1 ? column + 1 : column;
			const slopeX = (elevation[row * size + right] - elevation[row * size + left]) / (right - left) * toGrade;
			const slopeY = (elevation[above * size + column] - elevation[below * size + column]) / (above - below) * toGrade;
			grade[row * size + column] = sqrt(slopeX * slopeX + slopeY * slopeY);
		}
	}
	return grade;
}

/**
 * Per cell, world units to the nearest source cell's centre, and that
 * source's value: a two-pass chamfer distance over the eight neighbours,
 * a cell across or a cell's diagonal, within a few percent of the straight
 * distance. Sources are cells whose value is 0 or more; with none, every
 * distance is Infinity and every value -1.
 */
export function distanceField(grid: LandGrid, sources: Float64Array): { distance: Float64Array; value: Float64Array } {
	const size = grid.size;
	const across = grid.cellSize;
	const diagonal = grid.cellSize * SQRT2;
	const distance = new Float64Array(size * size).fill(Infinity);
	const value = new Float64Array(size * size).fill(-1);
	for (let cell = 0; cell < sources.length; cell += 1) {
		if (sources[cell] >= 0) {
			distance[cell] = 0;
			value[cell] = sources[cell];
		}
	}
	const relax = (cell: number, from: number, step: number) => {
		const through = distance[from] + step;
		if (through < distance[cell]) {
			distance[cell] = through;
			value[cell] = value[from];
		}
	};
	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) {
			const cell = row * size + column;
			if (column > 0) relax(cell, cell - 1, across);
			if (row > 0) {
				relax(cell, cell - size, across);
				if (column > 0) relax(cell, cell - size - 1, diagonal);
				if (column < size - 1) relax(cell, cell - size + 1, diagonal);
			}
		}
	}
	for (let row = size - 1; row >= 0; row -= 1) {
		for (let column = size - 1; column >= 0; column -= 1) {
			const cell = row * size + column;
			if (column < size - 1) relax(cell, cell + 1, across);
			if (row < size - 1) {
				relax(cell, cell + size, across);
				if (column < size - 1) relax(cell, cell + size + 1, diagonal);
				if (column > 0) relax(cell, cell + size - 1, diagonal);
			}
		}
	}
	return { distance, value };
}

/**
 * Which squares between land cell centres a road from the metro surely
 * reaches: a flood fill from the square holding the compound through the
 * terrain's open squares (no rough ground, wholly inside the disc) that no
 * crater reaches into and that have no lake cell at a corner. 1 where
 * reached. Rivers are bridged, so they don't stop it. Exact for cliffs,
 * craters, and lakes: a lake's shore lies between its cells and their dry
 * neighbours, so a square with four dry corners holds no lake.
 */
export function reachedSquares({ grid, open, lakeOf, hotspots }: { grid: LandGrid; open: Uint8Array; lakeOf: Int16Array; hotspots: readonly Hotspot[] }): Uint8Array {
	const size = grid.size;
	const squares = size - 1;
	const passable = Uint8Array.from(open);
	for (let row = 0; row < squares; row += 1) {
		const bottom = cellCentre(grid, row);
		const top = cellCentre(grid, row + 1);
		for (let column = 0; column < squares; column += 1) {
			const square = row * squares + column;
			if (passable[square] !== 1) continue;
			const corner = row * size + column;
			if (lakeOf[corner] >= 0 || lakeOf[corner + 1] >= 0 || lakeOf[corner + size] >= 0 || lakeOf[corner + size + 1] >= 0) {
				passable[square] = 0;
				continue;
			}
			const left = cellCentre(grid, column);
			const right = cellCentre(grid, column + 1);
			for (const { x, y, craterRadius } of hotspots) {
				const nearX = x < left ? left : x > right ? right : x;
				const nearY = y < bottom ? bottom : y > top ? top : y;
				if ((nearX - x) * (nearX - x) + (nearY - y) * (nearY - y) < craterRadius * craterRadius) {
					passable[square] = 0;
					break;
				}
			}
		}
	}
	const reached = new Uint8Array(squares * squares);
	const middle = floor(grid.halfExtent / grid.cellSize - 0.5);
	const start = middle * squares + middle;
	if (passable[start] !== 1) return reached;
	const stack = [start];
	reached[start] = 1;
	while (stack.length > 0) {
		const square = stack.pop() as number;
		const column = square % squares;
		const neighbours = [column > 0 ? square - 1 : -1, column < squares - 1 ? square + 1 : -1, square - squares, square + squares];
		for (const next of neighbours) {
			if (next >= 0 && next < passable.length && passable[next] === 1 && reached[next] === 0) {
				reached[next] = 1;
				stack.push(next);
			}
		}
	}
	return reached;
}

/** Points filed in square buckets as wide as their spacing, so a check looks at the nine buckets round a point. */
class SpacingBuckets {
	private readonly origin: number;
	private readonly width: number;
	private readonly columns: number;
	private readonly spacingSquared: number;
	private readonly buckets = new Map<number, Point[]>();

	constructor({ extent, spacing }: { extent: number; spacing: number }) {
		this.origin = -extent;
		this.width = spacing;
		this.columns = Math.ceil((2 * extent) / spacing) + 1;
		this.spacingSquared = spacing * spacing;
	}

	public clear(x: number, y: number): boolean {
		const column = this.column(x);
		const row = this.column(y);
		for (let dy = -1; dy <= 1; dy += 1) {
			for (let dx = -1; dx <= 1; dx += 1) {
				const bucket = this.buckets.get((row + dy) * this.columns + column + dx);
				if (bucket && !farFrom(x, y, bucket, this.spacingSquared)) return false;
			}
		}
		return true;
	}

	public add(x: number, y: number): void {
		const key = this.column(y) * this.columns + this.column(x);
		const bucket = this.buckets.get(key);
		if (bucket) bucket.push({ x, y });
		else this.buckets.set(key, [{ x, y }]);
	}

	private column(value: number): number {
		return floor((value - this.origin) / this.width);
	}
}
