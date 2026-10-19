import type { RoadNetwork } from './RoadNetwork';
import type { Leg, Route } from './RouteTree';
import { FIGHT_TYPES, STOP_TIERS, StopTuning, TierBand } from './StopData';

/**
 * How many stops a stretch of route tree has room for, as the stops stage
 * spaces them (Area Map Generation, 9. Stops): clear of a leg's ends and of
 * junctions partway along it, `gap` apart, and half a gap in from the ends'
 * clearance, so a leg of `usable` road holds `usable / gap` rounded down
 * where no junction is in the way. The POI stage seats a POI only where each
 * of its routes' own road has room for its need at `tightGap` (stage 7), and
 * the stops stage places on the same room, so the two can't disagree.
 */

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const ceil = Math.ceil;

/** Slack for a junction's clearance, which `join + clear` can miss by a rounding. */
const CLEAR_SLACK = 1e-9;

/** A destination tier's band; tiers past the tables' read as the last. */
export function bandFor(tier: number, tuning: Pick<StopTuning, 'bands'>): TierBand {
	const index = tier < 1 ? 0 : tier > STOP_TIERS ? STOP_TIERS - 1 : tier - 1;
	return tuning.bands[index];
}

/** What a route's own road has to hold: its fight floor, and at least half its band's minimum, whichever is more. */
export function ownRoadNeed(tier: number, tuning: Pick<StopTuning, 'bands'>): number {
	const { stops, fights } = bandFor(tier, tuning);
	const half = ceil(stops.min / 2);
	return fights.min > half ? fights.min : half;
}

/** POIs in tiers up to this have to be reachable and left in daylight (guarantee 10). */
export const DAYLIGHT_TIERS = 3;

/** An estimated run, as the daylight check (guarantee 10) counts it: out and home along the route, its stops, and the objective. */
export function runHours({ routeHours, stopHours, objectiveHours }: { routeHours: number; stopHours: number; objectiveHours: number }): number {
	return 2 * routeHours + stopHours + objectiveHours;
}

/**
 * The least run a route of this tier can have once the daylight check has
 * shed all it may: its fight floor and nothing else, each fight the
 * costliest a fight can be, so the stops stage can always thin to it.
 */
export function floorRunHours({ routeHours, tier, objectiveHours, tuning }: { routeHours: number; tier: number; objectiveHours: number; tuning: Pick<StopTuning, 'bands' | 'types'> }): number {
	let fightHours = 0;
	for (const type of FIGHT_TYPES) if (tuning.types[type].hours > fightHours) fightHours = tuning.types[type].hours;
	return runHours({ routeHours, stopHours: bandFor(tier, tuning).fights.min * fightHours, objectiveHours });
}

/** World units a stop keeps from either end of a leg this long: the clearance, or a quarter of a short leg. */
export function legEnds(length: number, { clearance }: Pick<StopTuning, 'clearance'>): number {
	return clearance.ends < 0.25 * length ? clearance.ends : 0.25 * length;
}

/**
 * The most points of [from, to] at least `gap` apart and `clear` from every
 * junction, packed from `from`, at most `limit`: the earliest point that
 * clears, then the earliest `gap` past it, and so on, which is as many as
 * any spacing fits.
 */
export function packAlong({ from, to, gap, joins, clear, limit = Infinity }: { from: number; to: number; gap: number; joins: readonly number[]; clear: number; limit?: number }): number[] {
	const out: number[] = [];
	let at = from;
	while (out.length < limit) {
		const clearAt = firstClear({ at, to, joins, clear });
		if (clearAt === null) break;
		out.push(clearAt);
		at = clearAt + gap;
	}
	return out;
}

/** The least point of [at, to] `clear` from every junction; null when there's none. */
function firstClear({ at, to, joins, clear }: { at: number; to: number; joins: readonly number[]; clear: number }): number | null {
	let point = at;
	for (let moved = true; moved;) {
		moved = false;
		for (const join of joins) {
			if (point > join - clear + CLEAR_SLACK && point < join + clear - CLEAR_SLACK) {
				point = join + clear;
				moved = true;
			}
		}
	}
	return point <= to ? point : null;
}

/** The span of a leg a stop `gap` from its neighbours can stand in: half a gap in from the ends' clearance. */
export function legSpan(length: number, gap: number, tuning: Pick<StopTuning, 'clearance'>): { from: number; to: number } {
	const ends = legEnds(length, tuning);
	return { from: ends + gap / 2, to: length - ends - gap / 2 };
}

/** The most stops a leg this long, with these junctions along it, holds `gap` apart. */
export function legRoom({ length, joins, gap, tuning }: { length: number; joins: readonly number[]; gap: number; tuning: Pick<StopTuning, 'clearance'> }): number {
	if (!(length > 0)) return 0;
	const { from, to } = legSpan(length, gap, tuning);
	if (from > to) return 0;
	return packAlong({ from, to, gap, joins, clear: tuning.clearance.junctions }).length;
}

/** How many roads meet at each node: a stretch from a node to itself is no road. */
export function nodeDegrees({ nodes, stretches }: RoadNetwork): Int32Array {
	const degrees = new Int32Array(nodes.length);
	for (const { from, to } of stretches) {
		if (from === to) continue;
		degrees[from] += 1;
		degrees[to] += 1;
	}
	return degrees;
}

/**
 * World units along a leg of each junction partway along it: a node between
 * two of its pieces where three or more roads meet. A node where a leg only
 * changes stretch, at a class change or a roadside point, isn't one.
 */
export function junctionsAlong({ network, leg, degrees }: { network: RoadNetwork; leg: Pick<Leg, 'pieces'>; degrees: Int32Array }): number[] {
	const joins: number[] = [];
	let along = 0;
	const { pieces } = leg;
	for (let piece = 0; piece + 1 < pieces.length; piece += 1) {
		along += pieces[piece].length;
		const { from, to } = network.stretches[pieces[piece].stretch];
		if (degrees[pieces[piece].forward ? to : from] >= 3) joins.push(along);
	}
	return joins;
}

/**
 * The point of [from, to] nearest `target` that keeps `clear` from every
 * junction, the lower of two as near; null when there's none. The nearest
 * such point is the target itself, an end of the range, or a junction's
 * clearance either side, so those are all it tries.
 */
export function nearestClear({ target, from, to, joins, clear }: { target: number; from: number; to: number; joins: readonly number[]; clear: number }): number | null {
	const clears = (along: number) => along >= from && along <= to && joins.every((join) => (along - join) * (along - join) >= (clear - CLEAR_SLACK) * (clear - CLEAR_SLACK));
	const aim = target < from ? from : target > to ? to : target;
	let best: number | null = null;
	let bestOff = Infinity;
	for (const along of [aim, from, to, ...joins.flatMap((join) => [join - clear, join + clear])]) {
		if (!clears(along)) continue;
		const off = along < aim ? aim - along : along - aim;
		if (off < bestOff || (off === bestOff && best !== null && along < best)) {
			best = along;
			bestOff = off;
		}
	}
	return best;
}

/** No POI's routes use the leg. */
export const NO_OWNER = -1;
/** Two or more POIs' routes use it. */
export const SHARED = -2;

/** Each leg's POI, where only one POI's routes use it: its own road. `NO_OWNER` or `SHARED` otherwise. */
export function legOwners(legCount: number, routes: readonly (readonly Route[])[]): Int32Array {
	const owners = new Int32Array(legCount).fill(NO_OWNER);
	routes.forEach((poiRoutes, poi) => {
		for (const route of poiRoutes) {
			for (const leg of route.legs) owners[leg] = owners[leg] === NO_OWNER || owners[leg] === poi ? poi : SHARED;
		}
	});
	return owners;
}

/**
 * Each route's own road, legs no other POI's routes use, by POI and route,
 * and the stops it has room for at the tight gap: what the POI stage holds
 * every route to, and what the stops stage puts the route's need on.
 */
export function ownRoadRoom({ network, legs, routes, degrees, tuning }: {
	network: RoadNetwork;
	legs: readonly Leg[];
	routes: readonly (readonly Route[])[];
	degrees: Int32Array;
	tuning: Pick<StopTuning, 'clearance' | 'tightGap'>;
}): { own: number[][][]; room: number[][] } {
	const owners = legOwners(legs.length, routes);
	const rooms = new Map<number, number>();
	const roomOf = (leg: number): number => {
		let room = rooms.get(leg);
		if (room === undefined) {
			room = legRoom({ length: legs[leg].length, joins: junctionsAlong({ network, leg: legs[leg], degrees }), gap: tuning.tightGap, tuning });
			rooms.set(leg, room);
		}
		return room;
	};
	const own = routes.map((poiRoutes, poi) => poiRoutes.map((route) => route.legs.filter((leg) => owners[leg] === poi)));
	const room = own.map((poiOwn) => poiOwn.map((legIds) => legIds.reduce((sum, leg) => sum + roomOf(leg), 0)));
	return { own, room };
}
