import { Rng } from '../core/Rng';

/**
 * The terrain's point features (Area Map Generation, Pipeline, 1. Terrain):
 * hotspots, the blast sites and spills that leave craters and contamination,
 * and towns, the smaller ruins out past the metro. Both are dart-thrown, a
 * Poisson-disc sample: candidates drawn uniformly over a ring of the disc,
 * each kept only if it's far enough from those kept before it.
 *
 * Candidates are drawn in the disc's bounding square and redrawn until they
 * land in the ring, so placement is plain arithmetic, with no square root or
 * trig to differ between engines. Each feature draws on its own stream, so
 * the order other features draw in never moves it.
 */

/** A blast site or spill: an impassable crater in a plume of contamination. */
export interface Hotspot {
	readonly x: number;
	readonly y: number;
	/** World units; the crater, impassable, is everything nearer the centre than this. */
	readonly craterRadius: number;
	/** World units; contamination reaches this far, strongest at the centre. */
	readonly plumeRadius: number;
	/** The plume's contamination at the centre, 0 to 1. */
	readonly strength: number;
}

/** A patch of ruins: the metro around the compound, or a town. */
export interface Ruin {
	readonly x: number;
	readonly y: number;
	/** World units. */
	readonly radius: number;
}

export interface Ring {
	/** World units from the compound; candidates land at this distance or more... */
	readonly inner: number;
	/** ...and at this distance or less. */
	readonly outer: number;
}

/** Candidates tried per feature before it's left out. */
export const PLACEMENT_ATTEMPTS = 48;

/** Crater radius, world units. */
const CRATER_RADIUS = { min: 14, max: 26 };
/** Plume radius as a multiple of the crater's. */
const PLUME_SCALE = { min: 5, max: 8 };
const PLUME_STRENGTH = { min: 0.75, max: 1 };
/** Hotspots at least this share of the map's radius apart, so blasts spread over the map. */
export const HOTSPOT_SPACING = 0.25;
/** The largest crater, for keeping craters clear of the start. */
export const MAX_CRATER_RADIUS = CRATER_RADIUS.max;

/** A town's radius as a share of the metro's, and the smallest it can be in world units. */
const TOWN_RADIUS = { min: 0.25, max: 0.4, floor: 20 };
/** Town centres at least this share of the map's radius apart: the Poisson-disc spacing. */
export const TOWN_SPACING = 0.22;
/** World units of clear ground kept between a town's edge and a crater's. */
export const TOWN_CRATER_GAP = 20;

export interface HotspotPlacement {
	/** The `hotspots` stream. */
	rng: Rng;
	count: number;
	/** The map's radius, world units. */
	radius: number;
	/** Where crater centres may go. */
	ring: Ring;
}

/**
 * Up to `count` hotspots, each `HOTSPOT_SPACING` of the radius from the
 * others, centred in the ring. A hotspot draws its crater, plume, and
 * strength first, then candidates, two draws each; one that finds no room in
 * `PLACEMENT_ATTEMPTS` candidates is left out, which the spacing makes
 * vanishingly rare across the tuning ranges.
 */
export function placeHotspots({ rng, count, radius, ring }: HotspotPlacement): Hotspot[] {
	const spacing = HOTSPOT_SPACING * radius;
	const spacingSquared = spacing * spacing;
	const hotspots: Hotspot[] = [];
	for (let index = 0; index < count; index += 1) {
		const craterRadius = between(rng, CRATER_RADIUS);
		const plumeRadius = craterRadius * between(rng, PLUME_SCALE);
		const strength = between(rng, PLUME_STRENGTH);
		const point = throwDart(rng, ring, (x, y) => hotspots.every((other) => distanceSquared(x, y, other) >= spacingSquared));
		if (point) hotspots.push({ x: point.x, y: point.y, craterRadius, plumeRadius, strength });
	}
	return hotspots;
}

export interface TownPlacement {
	/** The `towns` stream. */
	rng: Rng;
	count: number;
	/** The map's radius, world units. */
	radius: number;
	/** The metro's radius, which sizes towns. */
	metroRadius: number;
	/** Where towns may go, edges included: centres land a town's radius inside it. */
	ring: Ring;
	/** Craters keep towns `TOWN_CRATER_GAP` clear of them. */
	hotspots: readonly Hotspot[];
	/** Whether a town may stand at (x, y); `strict` is the first half of its candidates, which also asks for good ground. */
	suits(x: number, y: number, strict: boolean): boolean;
}

/**
 * Up to `count` towns, centres `TOWN_SPACING` of the radius apart, inside the
 * ring and clear of craters. A town draws its size, then candidates: for the
 * first half of `PLACEMENT_ATTEMPTS` the ground has to suit it strictly, then
 * only loosely, and a town that finds no room is left out.
 */
export function placeTowns({ rng, count, radius, metroRadius, ring, hotspots, suits }: TownPlacement): Ruin[] {
	const spacing = TOWN_SPACING * radius;
	const spacingSquared = spacing * spacing;
	const towns: Ruin[] = [];
	for (let index = 0; index < count; index += 1) {
		const townRadius = Math.max(TOWN_RADIUS.floor, metroRadius * between(rng, TOWN_RADIUS));
		const townRing = { inner: ring.inner + townRadius, outer: ring.outer - townRadius };
		let attempt = 0;
		const point = throwDart(rng, townRing, (x, y) => {
			const strict = attempt < PLACEMENT_ATTEMPTS / 2;
			attempt += 1;
			return towns.every((other) => distanceSquared(x, y, other) >= spacingSquared)
				&& hotspots.every((hotspot) => {
					const clearance = hotspot.craterRadius + townRadius + TOWN_CRATER_GAP;
					return distanceSquared(x, y, hotspot) >= clearance * clearance;
				})
				&& suits(x, y, strict);
		});
		if (point) towns.push({ x: point.x, y: point.y, radius: townRadius });
	}
	return towns;
}

/**
 * The first of `PLACEMENT_ATTEMPTS` candidates in the ring that `fits`, or
 * null. Each candidate is drawn in the bounding square, two draws, until it
 * lands in the ring; an empty ring has no candidates.
 */
function throwDart(rng: Rng, { inner, outer }: Ring, fits: (x: number, y: number) => boolean): { x: number; y: number } | null {
	if (!(outer > 0 && inner < outer)) return null;
	const innerSquared = inner > 0 ? inner * inner : 0;
	const outerSquared = outer * outer;
	for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt += 1) {
		let x: number;
		let y: number;
		let squared: number;
		do {
			x = (rng.float() * 2 - 1) * outer;
			y = (rng.float() * 2 - 1) * outer;
			squared = x * x + y * y;
		} while (squared < innerSquared || squared > outerSquared);
		if (fits(x, y)) return { x, y };
	}
	return null;
}

function between(rng: Rng, { min, max }: { min: number; max: number }): number {
	return min + (max - min) * rng.float();
}

function distanceSquared(x: number, y: number, point: { x: number; y: number }): number {
	const dx = x - point.x;
	const dy = y - point.y;
	return dx * dx + dy * dy;
}
