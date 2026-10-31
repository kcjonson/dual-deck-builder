import type { Rng } from '../core/Rng';
import { pointAlong, polylineLength } from './Geometry';
import type { LandSurface } from './Land';
import { cellCentre } from './LandGrid';
import { featureRoots, placeNames } from './PlaceNames';
import type { Places } from './Places';
import { STRONGHOLD_TYPE } from './PoiData';
import type { PoiLayer } from './Pois';
import type { RoadNetwork } from './RoadNetwork';
import type { WaterSurface } from './Water';

/**
 * Label candidates (Area Map Generation, 11. Dressing): every name the
 * atlas could print, with a priority. Generation knows no font, so it places
 * nothing: the view sets each candidate highest priority first with a
 * collision box at its own size and zoom, and drops one that can't fit
 * rather than overlap it. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/dressing.md.
 */

export type MapLabelKind = 'metro' | 'town' | 'village' | 'river' | 'range' | 'lake' | 'reservoir' | 'pass' | 'shield' | 'poi' | 'stronghold';

export interface MapLabel {
	readonly kind: MapLabelKind;
	readonly text: string;
	/** Set highest first. A kind's base priority, plus under 1 for its size among its kind. */
	readonly priority: number;
	/** Its anchor: a point label's point, or the middle of a line label's path. */
	readonly x: number;
	readonly y: number;
	/** What a line label is set along, flat x0, y0, ...: a stretch of a river's course, or a range's long axis. Empty for a point label. */
	readonly path: readonly number[];
	/**
	 * What it names: a place's id for the metro, a town, or a village; a
	 * river's index in the water's rivers, a lake's in its lakes; a range's
	 * index in `ranges`; a pass's in the network's passes; a highway's number
	 * from 0 for a shield; a POI's index in the POI layer.
	 */
	readonly ref: number;
}

/** A range of mountains or hills: the land cells where the range mask is past half, in one piece. */
export interface MapRange {
	readonly name: string;
	/** Land cells in it. */
	readonly cells: number;
	/** Its middle, and its long axis through it as a unit vector. */
	readonly x: number;
	readonly y: number;
	readonly ux: number;
	readonly uy: number;
}

/**
 * Base priorities, each kind's: the metro over everything, then what play
 * needs (strongholds, POIs), then towns, highways, and the land's big
 * features, villages, and passes last.
 */
export const LABEL_PRIORITY: { readonly [Kind in MapLabelKind]: number } = {
	metro: 100,
	stronghold: 95,
	poi: 90,
	town: 80,
	shield: 70,
	range: 65,
	reservoir: 60,
	lake: 60,
	river: 55,
	village: 50,
	pass: 40,
};

/**
 * - Rivers draining `named` times the stream threshold or more where they
 *   end, with `least` world units of course inside `inside` of the radius,
 *   are named: a river at `big` times the threshold, else a creek. One is
 *   labelled from `label` times the threshold over the dressing scale, a
 *   candidate every `every` world units of course inside, each set along
 *   `half` world units either side of its anchor.
 * - Lakes whose middle is inside `inside` of the radius, of `named` cells or
 *   more, are named, and labelled from `label` cells over the scale.
 * - Ranges of `named` cells or more inside `inside` of the radius are named,
 *   mountains where their peak's elevation is `peak` or more (`peak` times
 *   `RELIEF` world units), hills under it; labelled from `label` cells over the
 *   scale, along their long axis `spread` standard deviations either side of
 *   the middle, kept inside `inside` of the radius.
 * - Every pass is named and labelled while there's any dressing.
 * - Shields: each highway's stretches outside the metro, one a stretch,
 *   `spacing` of the radius apart along its number, the rim's first.
 */
export const LABELS = {
	rivers: { named: 4, big: 25, least: 120, inside: 0.92, label: 8, every: 450, half: 90 },
	lakes: { inside: 0.95, named: 3, label: 6 },
	ranges: { named: 30, inside: 0.95, peak: 0.55, label: 60, spread: 1.6 },
	shields: { spacing: 0.35 },
} as const;

export interface MapLabelOptions {
	readonly radius: number;
	readonly land: Pick<LandSurface, 'grid' | 'elevation' | 'mountains'>;
	readonly water: Pick<WaterSurface, 'grid' | 'threshold' | 'rivers' | 'lines' | 'lakes' | 'lakeOf'>;
	readonly places: Pick<Places, 'metro' | 'towns' | 'villages'>;
	readonly network: Pick<RoadNetwork, 'stretches' | 'passes'>;
	readonly pois: Pick<PoiLayer, 'pois'>;
	/** Each POI's name, in the layer's order. */
	readonly poiNames: readonly string[];
	/** Each highway's route number, by its number from 0. */
	readonly routeNumbers: readonly number[];
	/** `dressing` over its default: features too small for it go unlabelled, and none at 0. */
	readonly scale: number;
	/** The names stream. */
	readonly rng: Rng;
}

export interface MapNames {
	/** The metro's name, as a place, not in capitals. */
	readonly metro: string;
	/** Every named range. */
	readonly ranges: readonly MapRange[];
	readonly labels: readonly MapLabel[];
}

// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const floor = Math.floor;
const sqrt = Math.sqrt;

/**
 * The metro's name, the land's named features, and every label candidate,
 * highest priority first, ties in the order they're listed here. Every
 * feature is named whatever the dressing scale, the same way every time,
 * so a name never changes with how much of the map is dressed.
 */
export function mapLabels(options: MapLabelOptions): MapNames {
	const { radius, places, network, pois, poiNames, routeNumbers, scale, rng } = options;
	const metro = placeNames(rng.fork('metro'), { taken: [...places.towns, ...places.villages].map(({ name }) => name) })();
	const roots = featureRoots(rng.fork('features'));
	const rivers = namedRivers(options).map((river) => ({ ...river, name: `${roots()} ${river.area >= LABELS.rivers.big * options.water.threshold ? 'River' : 'Creek'}` }));
	const lakes = namedLakes(options).map((lake) => ({ ...lake, name: lake.reservoir ? `${roots()} Reservoir` : `Lake ${roots()}` }));
	const found = namedRanges(options);
	const ranges: MapRange[] = found.map(({ cells, x, y, ux, uy, mountains }) => Object.freeze({ name: `${roots()} ${mountains ? 'Mountains' : 'Hills'}`, cells, x, y, ux, uy }));
	const passes = network.passes.map(() => `${roots()} Pass`);

	const labels: MapLabel[] = [];
	const point = (kind: MapLabelKind, text: string, size: number, x: number, y: number, ref: number) => labels.push({ kind, text, priority: LABEL_PRIORITY[kind] + size, x, y, path: [], ref });
	point('metro', metro.toUpperCase(), 0, places.metro.x, places.metro.y, places.metro.id);
	pois.pois.forEach(({ type, site }, index) => point(type === STRONGHOLD_TYPE ? 'stronghold' : 'poi', poiNames[index], 0, site.x, site.y, index));
	const largestTown = Math.max(1, ...places.towns.map(({ radius: ruins }) => ruins));
	places.towns.forEach(({ id, x, y, name, radius: ruins }) => point('town', name, share(ruins, largestTown), x, y, id));
	shields({ network, radius, routeNumbers }).forEach(({ x, y, highway, rank }) => point('shield', String(routeNumbers[highway]), rank, x, y, highway));

	if (scale > 0) {
		const largestRange = Math.max(1, ...ranges.map(({ cells }) => cells));
		ranges.forEach(({ name, cells, x, y, ux, uy }, index) => {
			if (cells * scale < LABELS.ranges.label) return;
			labels.push({ kind: 'range', text: name, priority: LABEL_PRIORITY.range + share(cells, largestRange), x, y, path: rangeAxis({ x, y, ux, uy, sigma: found[index].sigma, radius }), ref: index });
		});
		const largestLake = Math.max(1, ...lakes.map(({ cells }) => cells));
		lakes.forEach(({ name, cells, x, y, reservoir, index }) => {
			if (cells * scale >= LABELS.lakes.label) point(reservoir ? 'reservoir' : 'lake', name, share(cells, largestLake), x, y, index);
		});
		const largestRiver = Math.max(1, ...rivers.map(({ area }) => area));
		rivers.forEach(({ name, area, course, index }) => {
			if (area * scale < LABELS.rivers.label * options.water.threshold) return;
			for (const { x, y, path } of riverAnchors(course)) labels.push({ kind: 'river', text: name, priority: LABEL_PRIORITY.river + share(area, largestRiver), x, y, path, ref: index });
		});
	}
	const largestVillage = Math.max(1, ...places.villages.map(({ radius: ruins }) => ruins));
	places.villages.forEach(({ id, x, y, name, radius: ruins }) => point('village', name, share(ruins, largestVillage), x, y, id));
	if (scale > 0) network.passes.forEach(({ x, y }, index) => point('pass', passes[index], 0, x, y, index));

	const ordered = labels.map((label, index) => ({ label, index })).sort((a, b) => b.label.priority - a.label.priority || a.index - b.index);
	return Object.freeze({
		metro,
		ranges: Object.freeze(ranges),
		labels: Object.freeze(ordered.map(({ label }) => Object.freeze({ ...label, path: Object.freeze(label.path) }))),
	});
}

/** Under 1, larger for a larger one of its kind: a label's size among its kind. */
function share(size: number, largest: number): number {
	return 0.99 * size / largest;
}

interface NamedRiver {
	readonly index: number;
	readonly area: number;
	/** Its longest run inside the labels' reach, flat x0, y0, ... */
	readonly course: number[];
}

/** Rivers big enough to name with course enough inside the disc, biggest first, ties by index. */
function namedRivers({ radius, water }: MapLabelOptions): NamedRiver[] {
	const { rivers, lines, threshold } = water;
	const reach = LABELS.rivers.inside * radius;
	const named: NamedRiver[] = [];
	rivers.forEach(({ area }, index) => {
		if (area < LABELS.rivers.named * threshold) return;
		let best: number[] = [];
		let run: number[] = [];
		for (let point = lines.offsets[index]; point < lines.offsets[index + 1]; point += 1) {
			const x = lines.points[2 * point];
			const y = lines.points[2 * point + 1];
			if (x * x + y * y <= reach * reach) {
				run.push(x, y);
				continue;
			}
			if (polylineLength(run) > polylineLength(best)) best = run;
			run = [];
		}
		if (polylineLength(run) > polylineLength(best)) best = run;
		if (polylineLength(best) >= LABELS.rivers.least) named.push({ index, area, course: best });
	});
	return named.sort((a, b) => b.area - a.area || a.index - b.index);
}

/** A candidate every `every` world units along a river's course, each set along `half` either side of its anchor. */
function riverAnchors(course: readonly number[]): { x: number; y: number; path: number[] }[] {
	const length = polylineLength(course);
	const count = Math.max(1, floor(length / LABELS.rivers.every));
	const at = { x: 0, y: 0 };
	const anchors: { x: number; y: number; path: number[] }[] = [];
	for (let index = 0; index < count; index += 1) {
		const middle = length * (index + 0.5) / count;
		pointAlong(course, middle, at);
		anchors.push({ x: at.x, y: at.y, path: sliceOf(course, middle - LABELS.rivers.half, middle + LABELS.rivers.half) });
	}
	return anchors;
}

/** The part of a polyline from `start` to `end` world units along it, clamped to its ends. */
export function sliceOf(points: readonly number[], start: number, end: number): number[] {
	const from = start < 0 ? 0 : start;
	const at = { x: 0, y: 0 };
	pointAlong(points, from, at);
	const slice = [at.x, at.y];
	let travelled = 0;
	for (let index = 0; index + 3 < points.length; index += 2) {
		const dx = points[index + 2] - points[index];
		const dy = points[index + 3] - points[index + 1];
		travelled += sqrt(dx * dx + dy * dy);
		if (travelled <= from) continue;
		if (travelled >= end) break;
		slice.push(points[index + 2], points[index + 3]);
	}
	pointAlong(points, end, at);
	slice.push(at.x, at.y);
	return slice;
}

interface NamedLake {
	readonly index: number;
	readonly cells: number;
	readonly reservoir: boolean;
	/** Its cell nearest the middle of its cells, so the label sits on its water. */
	readonly x: number;
	readonly y: number;
}

/** Lakes big enough to name with their middle inside the disc, in the water's order. */
function namedLakes({ radius, water }: MapLabelOptions): NamedLake[] {
	const { lakes, lakeOf, grid } = water;
	const reach = LABELS.lakes.inside * radius;
	const nearest = lakes.map(() => ({ cell: -1, distance: Infinity }));
	for (let cell = 0; cell < lakeOf.length; cell += 1) {
		const lake = lakeOf[cell];
		if (lake < 0) continue;
		const dx = cellCentre(grid, cell % grid.size) - lakes[lake].x;
		const dy = cellCentre(grid, floor(cell / grid.size)) - lakes[lake].y;
		const distance = dx * dx + dy * dy;
		if (distance < nearest[lake].distance) nearest[lake] = { cell, distance };
	}
	const named: NamedLake[] = [];
	lakes.forEach(({ x, y, cells, dam }, index) => {
		if (x * x + y * y > reach * reach || cells < LABELS.lakes.named || nearest[index].cell < 0) return;
		const cell = nearest[index].cell;
		named.push({ index, cells, reservoir: dam !== null, x: cellCentre(grid, cell % grid.size), y: cellCentre(grid, floor(cell / grid.size)) });
	});
	return named;
}

interface FoundRange {
	readonly cells: number;
	readonly x: number;
	readonly y: number;
	readonly ux: number;
	readonly uy: number;
	/** How far its cells spread along its axis: the standard deviation, world units. */
	readonly sigma: number;
	readonly mountains: boolean;
}

/**
 * The ranges: pieces of land cells, side by side, where the range mask is
 * past half, inside the labels' reach; biggest first, ties by their first
 * cell. The long axis is the cells' principal axis, from their covariance.
 */
function namedRanges({ radius, land }: MapLabelOptions): FoundRange[] {
	const { grid, mountains, elevation } = land;
	const size = grid.size;
	const reach = LABELS.ranges.inside * radius;
	const inRange = (cell: number): boolean => {
		if (mountains[cell] < 0.5) return false;
		const x = cellCentre(grid, cell % size);
		const y = cellCentre(grid, floor(cell / size));
		return x * x + y * y <= reach * reach;
	};
	const seen = new Uint8Array(size * size);
	const found: (FoundRange & { first: number })[] = [];
	const stack: number[] = [];
	const visit = (next: number): void => {
		if (seen[next] === 1 || !inRange(next)) return;
		seen[next] = 1;
		stack.push(next);
	};
	for (let first = 0; first < size * size; first += 1) {
		if (seen[first] === 1 || !inRange(first)) continue;
		seen[first] = 1;
		stack.push(first);
		let count = 0;
		let sumX = 0;
		let sumY = 0;
		let sumXX = 0;
		let sumXY = 0;
		let sumYY = 0;
		let peak = -Infinity;
		while (stack.length > 0) {
			const cell = stack.pop() as number;
			const column = cell % size;
			const row = floor(cell / size);
			const x = cellCentre(grid, column);
			const y = cellCentre(grid, row);
			count += 1;
			sumX += x;
			sumY += y;
			sumXX += x * x;
			sumXY += x * y;
			sumYY += y * y;
			if (elevation[cell] > peak) peak = elevation[cell];
			if (column > 0) visit(cell - 1);
			if (column < size - 1) visit(cell + 1);
			if (row > 0) visit(cell - size);
			if (row < size - 1) visit(cell + size);
		}
		if (count < LABELS.ranges.named) continue;
		const x = sumX / count;
		const y = sumY / count;
		const xx = sumXX / count - x * x;
		const xy = sumXY / count - x * y;
		const yy = sumYY / count - y * y;
		// The covariance's larger eigenvalue and its eigenvector: the long axis.
		const half = (xx - yy) / 2;
		const major = (xx + yy) / 2 + sqrt(half * half + xy * xy);
		let ux = xy;
		let uy = major - xx;
		if (ux * ux + uy * uy < 1e-12) {
			ux = xx >= yy ? 1 : 0;
			uy = xx >= yy ? 0 : 1;
		}
		const norm = sqrt(ux * ux + uy * uy);
		// Read west to east, or south to north when it runs north and south.
		const flip = ux < 0 || (ux === 0 && uy < 0) ? -1 : 1;
		const mountains = peak >= LABELS.ranges.peak;
		found.push({ first, cells: count, x, y, ux: flip * ux / norm, uy: flip * uy / norm, sigma: sqrt(major), mountains });
	}
	return found.sort((a, b) => b.cells - a.cells || a.first - b.first).map(({ first: _first, ...range }) => range);
}

/** A range's label path: its long axis, `spread` standard deviations either side of its middle, drawn in until both ends are inside the reach. */
function rangeAxis({ x, y, ux, uy, sigma, radius }: { x: number; y: number; ux: number; uy: number; sigma: number; radius: number }): number[] {
	const reach = LABELS.ranges.inside * radius;
	let half = LABELS.ranges.spread * sigma;
	const inside = (along: number): boolean => {
		const px = x + ux * along;
		const py = y + uy * along;
		return px * px + py * py <= reach * reach;
	};
	while (half > 1 && !(inside(half) && inside(-half))) half *= 0.9;
	return [x - ux * half, y - uy * half, x + ux * half, y + uy * half];
}

/** Shield candidates: each highway's stretches outside the metro, one a stretch, `spacing` of the radius apart along a number, the rim's first. */
function shields({ network, radius, routeNumbers }: { network: Pick<RoadNetwork, 'stretches'>; radius: number; routeNumbers: readonly number[] }): { x: number; y: number; highway: number; rank: number }[] {
	const spacing = LABELS.shields.spacing * radius;
	const at = { x: 0, y: 0 };
	const out: { x: number; y: number; highway: number; rank: number }[] = [];
	routeNumbers.forEach((_number, highway) => {
		const candidates: { x: number; y: number; out: number; id: number }[] = [];
		network.stretches.forEach(({ highway: own, street, points, length }, id) => {
			if (own !== highway || street) return;
			pointAlong(points, length / 2, at);
			candidates.push({ x: at.x, y: at.y, out: at.x * at.x + at.y * at.y, id });
		});
		candidates.sort((a, b) => b.out - a.out || a.id - b.id);
		const kept: { x: number; y: number }[] = [];
		for (const candidate of candidates) {
			if (kept.some(({ x, y }) => (x - candidate.x) * (x - candidate.x) + (y - candidate.y) * (y - candidate.y) < spacing * spacing)) continue;
			kept.push(candidate);
		}
		kept.forEach(({ x, y }, rank) => out.push({ x, y, highway, rank: 0.99 / (rank + 1) }));
	});
	return out;
}
