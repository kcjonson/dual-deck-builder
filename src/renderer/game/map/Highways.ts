import type { Rng } from '../core/Rng';
import { unitVector } from './Geometry';
import type { MapParams } from './MapParams';
import { ROAD_CLASS_RULES, driftKnots } from './RoadGrowth';
import type { Ruin } from './TerrainSites';

/**
 * Stage 2 of area map generation (Area Map Generation, Pipeline, 2. Highways
 * out of the metro): where the highways leave the metro, and how each one's
 * preferred heading drifts along its length, by the highway class's drift
 * scaled by curviness, so 0 is ruler-straight. Growth (stage 3) lays them.
 */

/** Jittered sets of bearings drawn, at most, for one that keeps highwaySeparation, before the last is pulled in to fit. */
const BEARING_DRAWS = 16;

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

export interface HighwayOptions {
	/** The map's radius and its metro: the terrain's. */
	terrain: { readonly radius: number; readonly metro: Ruin };
	/** Validated, so the separation fits the count. */
	params: MapParams;
	/** The stage's stream, root.fork('map', mapAttempt).fork('highways', stageAttempt). */
	rng: Rng;
}

/**
 * Stage 2: `highways` departures in counterclockwise order, each on the
 * metro's edge, with its drift. Bearings draw on the stream's `bearings`
 * fork and each highway's drift on `drift` at its index, so a highway's
 * drift never moves another's, nor its bearing.
 */
export function planHighways({ terrain, params, rng }: HighwayOptions): HighwayDeparture[] {
	const bearings = departureBearings({ count: params.highways, separation: params.highwaySeparation, rng: rng.fork('bearings') });
	const metroRadius = terrain.metro.radius;
	const direction = { x: 0, y: 0 };
	return bearings.map((bearing, index) => {
		unitVector(bearing, direction);
		return {
			bearing,
			x: direction.x * metroRadius,
			y: direction.y * metroRadius,
			drift: driftKnots({ rng: rng.fork('drift', index), span: terrain.radius - metroRadius, amplitude: ROAD_CLASS_RULES.highway.drift * params.curviness }),
		};
	});
}

/**
 * `count` bearings in degrees, 0 up to 360, counterclockwise: even spacing
 * turned by a random rotation, each jittered by up to a third of the gap,
 * every neighbouring pair at least `separation` apart. Up to `BEARING_DRAWS`
 * sets of jitter are drawn for one that keeps the separation; if none does,
 * the last is scaled down until it does, which even spacing always does
 * while `count` times `separation` is 360 or less.
 */
export function departureBearings({ count, separation, rng }: { count: number; separation: number; rng: Rng }): number[] {
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
	return jitter.map((offset, index) => {
		const bearing = rotation + index * gap + offset;
		return bearing < 0 ? bearing + 360 : bearing >= 360 ? bearing - 360 : bearing;
	});
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
