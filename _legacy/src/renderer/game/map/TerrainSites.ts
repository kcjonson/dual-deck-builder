import { Rng } from '../core/Rng';

/**
 * Hotspots (Area Map Generation, Pipeline, 3. Biomes, hazards, and cost),
 * the blast sites and spills that leave craters and contamination, and the
 * ruins' shape. Hotspots are dart-thrown, a Poisson-disc sample: candidates
 * drawn uniformly over a ring of the disc, in its bounding square and redrawn
 * until inside, each kept only if it's far enough from those kept before it.
 * Placement is plain arithmetic, with no square root or trig to differ
 * between engines.
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

/** A patch of ruins: the metro around the compound, a town, or a village. */
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

/** Candidates tried per hotspot before it's left out. */
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
/** World units of clear ground kept between a crater's edge and a town's, a village's, or a lake's. */
export const CRATER_GAP = 20;

export interface HotspotPlacement {
	/** The `hotspots` stream. */
	rng: Rng;
	count: number;
	/** The map's radius, world units. */
	radius: number;
	/** Where crater centres may go. */
	ring: Ring;
	/** Whether a crater of `craterRadius` at (x, y) suits the land there; anywhere when left out. */
	suits?: (x: number, y: number, craterRadius: number) => boolean;
}

/**
 * Up to `count` hotspots, each `HOTSPOT_SPACING` of the radius from the
 * others, centred in the ring, where the land suits them. A hotspot draws
 * its crater, plume, and strength first, then candidates, two draws each;
 * one that finds no room in `PLACEMENT_ATTEMPTS` candidates is left out,
 * which the spacing makes vanishingly rare across the tuning ranges.
 */
export function placeHotspots({ rng, count, radius, ring, suits }: HotspotPlacement): Hotspot[] {
	const spacing = HOTSPOT_SPACING * radius;
	const spacingSquared = spacing * spacing;
	const hotspots: Hotspot[] = [];
	for (let index = 0; index < count; index += 1) {
		const craterRadius = between(rng, CRATER_RADIUS);
		const plumeRadius = craterRadius * between(rng, PLUME_SCALE);
		const strength = between(rng, PLUME_STRENGTH);
		const point = throwDart(rng, ring, (x, y) => hotspots.every((other) => distanceSquared(x, y, other) >= spacingSquared) && (suits?.(x, y, craterRadius) ?? true));
		if (point) hotspots.push({ x: point.x, y: point.y, craterRadius, plumeRadius, strength });
	}
	return hotspots;
}

/**
 * The first of `PLACEMENT_ATTEMPTS` hotspot candidates in the ring that
 * `fits`, or null. Each candidate is drawn in the bounding square, two
 * draws, until it lands in the ring; an empty ring has no candidates.
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
