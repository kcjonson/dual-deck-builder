import type { Rng } from '../core/Rng';
import { unitVector } from './Geometry';
import type { MapParams } from './MapParams';
import type { Exit } from './Places';
import { ROAD_CLASS_RULES, driftKnots } from './RoadGrowth';
import type { Ruin } from './TerrainSites';

/**
 * Where outward growth's highways leave the metro, toward the places stage's
 * highway exits, and how each one's preferred heading drifts along its
 * length, by the highway class's drift scaled by curviness, so 0 is
 * ruler-straight. A stand-in until road links (Maps 7 and 8) run highways
 * from the exits to the compound instead.
 */

/** One highway leaving the metro. */
export interface HighwayDeparture {
	/** Degrees counterclockwise from east (+x), 0 up to 360. */
	readonly bearing: number;
	/** Where it leaves the metro: the metro's edge on its bearing. The city street from the compound runs straight out to here. */
	readonly x: number;
	readonly y: number;
	/**
	 * Degrees its preferred heading strays from its bearing at knots
	 * `DRIFT_SPACING` apart along it from the metro's edge, eased between
	 * (`driftAt`). The first is 0, so it leaves on its bearing.
	 */
	readonly drift: readonly number[];
}

export interface DepartureOptions {
	/** The map's radius and its metro: the terrain's. */
	terrain: { readonly radius: number; readonly metro: Ruin };
	/** Validated. */
	params: MapParams;
	/** The places stage's exits; only the highways' are read. */
	exits: readonly Exit[];
	/** Each highway's drift draws on this stream's `drift` fork at its index, so one's drift never moves another's. */
	rng: Rng;
}

/** A departure for each highway exit, in the exits' order, each on the metro's edge on its exit's bearing, with its drift. */
export function highwayDepartures({ terrain, params, exits, rng }: DepartureOptions): HighwayDeparture[] {
	const metroRadius = terrain.metro.radius;
	const direction = { x: 0, y: 0 };
	return exits.filter((exit) => exit.highway).map(({ bearing }, index) => {
		unitVector(bearing, direction);
		return {
			bearing,
			x: direction.x * metroRadius,
			y: direction.y * metroRadius,
			drift: driftKnots({ rng: rng.fork('drift', index), span: terrain.radius - metroRadius, amplitude: ROAD_CLASS_RULES.highway.drift * params.curviness }),
		};
	});
}
