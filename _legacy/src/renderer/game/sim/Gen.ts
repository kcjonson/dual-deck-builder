import { routeOffers } from '../campaign/MapRoutes';
import type { RouteStop, RunRoute } from '../campaign/SupplyRoutes';
import { generateAreaMap } from '../map/AreaMapPipeline';
import { AREA_MAP_GENERATOR_VERSION } from '../map/GeneratorVersion';
import { MapPipelineError } from '../map/MapPipeline';
import { describeMap } from '../map/RouteDescriptors';
import { rollParams } from '../map/RollParams';
import type { RingCount } from '../map/Pois';
import type { RoadNetwork } from '../map/RoadNetwork';
import type { Leg } from '../map/RouteTree';
import { STOP_TUNING, StopTuning, StopType, TierBand } from '../map/StopData';
import { junctionsAlong, legRoom, nodeDegrees } from '../map/StopRoom';
import { Rate, Spread, mean, rate, spread } from './Measures';
import type { SimConfig } from './SimConfig';

/**
 * The balance sim's generator audit (Balance Simulation, gen): campaign maps
 * made from `rollParams` seeds as founding makes them, every route to every
 * POI read the way a run gets it (`routeOffers`), and what the rules in Runs
 * and Encounters ask of a route measured on each: stops against its tier's
 * band, fights and the fight floor, stop types and the ones no run can
 * resolve yet, skulls, hours, own road, and the nearest neighbor's reach.
 */

export interface GenCell {
	/** `map-<seed>` */
	readonly name: string;
	readonly seed: number;
}

/** A map for each seed from the config's, `maps` of them. */
export function genCells(config: SimConfig): GenCell[] {
	return Array.from({ length: config.maps }, (_, index) => ({ name: `map-${config.seed + index}`, seed: config.seed + index }));
}

/** A stop as the corpus keeps it: the run's, with the type the map placed. */
export type CorpusStop = RouteStop & { readonly type: StopType };

/** A route as the corpus keeps it, for `runs`: the run's route, its stops typed, and what the audit found on it. */
export interface CorpusRoute extends Omit<RunRoute, 'legs'> {
	readonly map: number;
	readonly poi: number;
	readonly tier: number;
	readonly legs: readonly (Omit<RunRoute['legs'][number], 'stops'> & { readonly stops: readonly CorpusStop[] })[];
	readonly audit: RouteAudit;
}

/** What the audit found on one route. */
export interface RouteAudit {
	readonly stops: number;
	readonly fights: number;
	/** Stops the run takes as a quiet stretch, where nothing happens: none, while the stops stage places only what the run resolves. */
	readonly empty: number;
	readonly skulls: readonly number[];
	/** Out (driving and stops), at the objective, and home. */
	readonly hours: number;
	readonly pastDark: boolean;
	/** Legs no other POI's routes use. */
	readonly ownLegs: readonly string[];
	readonly ownLength: number;
	readonly ownStops: number;
	readonly ownFights: number;
	/** The stops its own road has room for, leg by leg, at the stops stage's tight gap. */
	readonly ownCapacity: number;
	readonly lastLeg: { readonly length: number; readonly stops: number; readonly capacity: number };
	/** The POI whose routes share the most road with this POI's, and the worst one of its routes' runs for this route. */
	readonly neighbor: { readonly poi: number; readonly route: string; readonly sharedLength: number; readonly cleared: readonly string[]; readonly fightsLeft: number } | null;
}

/** One seed's map, audited: its routes, or why no map came of it. */
export interface GenMap {
	readonly seed: number;
	readonly generatorVersion: number;
	/** Why no map came of the seed, or null. */
	readonly failed: string | null;
	readonly environment: string | null;
	/** What the stops stage couldn't keep, and the stops the daylight check took off. */
	readonly stopFailures: readonly string[];
	readonly thinned: number;
	/** POIs each ring aimed for and seated, strongholds not counted. */
	readonly rings: readonly RingCount[];
	readonly routes: readonly CorpusRoute[];
}

/** One map, made and audited. */
export function playGenCell({ cell }: { config: SimConfig; cell: GenCell }): GenMap {
	const params = rollParams(cell.seed);
	let map: ReturnType<typeof generateAreaMap>;
	try {
		map = generateAreaMap({ params, debug: false });
	} catch (error) {
		if (!(error instanceof MapPipelineError)) throw error;
		return { seed: cell.seed, generatorVersion: AREA_MAP_GENERATOR_VERSION, failed: error.message, environment: params.environment, stopFailures: [], thinned: 0, rings: [], routes: [] };
	}
	const { pois, stops } = map.products;
	const described = describeMap(map).flat();
	const offers = routeOffers(map);
	const legOf = (id: string): number => Number(id.slice('leg-'.length));
	const degrees = nodeDegrees(map.products.roads.network);
	const roomOf = (id: string): number => legCapacity({ network: map.products.roads.network, leg: pois.legs[legOf(id)], degrees });
	const stopOf = (id: string): number => Number(id.slice('stop-'.length));

	// Which POIs' routes use each leg, and each POI's legs.
	const users: Set<number>[] = pois.legs.map(() => new Set());
	const poiLegs: Set<number>[] = pois.pois.map(() => new Set());
	described.forEach(({ poi, legs }) => legs.forEach(leg => {
		users[leg].add(poi);
		poiLegs[poi].add(leg);
	}));
	const neighbors = pois.pois.map((_, poi) => nearestNeighbor({ poi, poiLegs, legLength: (leg) => pois.legs[leg].length }));
	const routesOf = new Map<string, { route: RunRoute; stops: Set<string> }[]>();
	for (const route of offers) {
		const list = routesOf.get(route.destination.id) ?? [];
		list.push({ route, stops: new Set(route.legs.flatMap(leg => leg.stops.map(stop => stop.id))) });
		routesOf.set(route.destination.id, list);
	}

	const routes = offers.map((route, index): CorpusRoute => {
		// routeOffers is describeMap's routes in the same order, POI by POI
		const descriptor = described[index];
		const { poi } = descriptor;
		if (route.destination.id !== `poi-${poi}`) throw new Error(`${route.id} isn't the route describeMap gave at ${index}`);
		const tier = route.destination.tier;
		const all = route.legs.flatMap(leg => leg.stops);
		const own = route.legs.filter(leg => users[legOf(leg.id)].size === 1);
		const ownStops = own.flatMap(leg => leg.stops);
		const last = route.legs[route.legs.length - 1];
		const neighbor = neighbors[poi];
		let worst: RouteAudit['neighbor'] = null;
		if (neighbor !== null) {
			for (const { route: theirs, stops: theirStops } of routesOf.get(`poi-${neighbor.poi}`) ?? []) {
				const cleared = all.filter(stop => theirStops.has(stop.id));
				if (worst === null || cleared.length > worst.cleared.length) {
					worst = {
						poi: neighbor.poi,
						route: theirs.id,
						sharedLength: neighbor.sharedLength,
						cleared: cleared.map(stop => stop.id),
						fightsLeft: all.filter(stop => stop.kind === 'fight' && !cleared.includes(stop)).length,
					};
				}
			}
		}
		return {
			...route,
			map: cell.seed,
			poi,
			tier,
			legs: route.legs.map(leg => ({ ...leg, stops: leg.stops.map(stop => ({ ...stop, type: stops.stops[stopOf(stop.id)].type })) })),
			audit: {
				stops: all.length,
				fights: all.filter(stop => stop.kind === 'fight').length,
				empty: all.filter(stop => stop.kind === 'quiet').length,
				skulls: all.flatMap(stop => (stop.kind === 'fight' ? [stop.skulls] : [])),
				hours: route.hours.out + route.hours.objective + route.hours.home,
				pastDark: descriptor.spare < 0,
				ownLegs: own.map(leg => leg.id),
				ownLength: own.reduce((sum, leg) => sum + pois.legs[legOf(leg.id)].length, 0),
				ownStops: ownStops.length,
				ownFights: ownStops.filter(stop => stop.kind === 'fight').length,
				ownCapacity: own.reduce((sum, leg) => sum + roomOf(leg.id), 0),
				lastLeg: { length: pois.legs[legOf(last.id)].length, stops: last.stops.length, capacity: roomOf(last.id) },
				neighbor: worst,
			},
		};
	});
	return { seed: cell.seed, generatorVersion: AREA_MAP_GENERATOR_VERSION, failed: null, environment: params.environment, stopFailures: stops.failures, thinned: stops.thinned, rings: pois.rings, routes };
}

/** The stops a leg has room for at the stops stage's tight gap, clear of its ends and junctions, by the room math the POI and stops stages share. */
export function legCapacity({ network, leg, degrees = nodeDegrees(network), tuning = STOP_TUNING }: { network: RoadNetwork; leg: Pick<Leg, 'pieces' | 'length'>; degrees?: Int32Array; tuning?: Pick<StopTuning, 'clearance' | 'tightGap'> }): number {
	return legRoom({ length: leg.length, joins: junctionsAlong({ network, leg, degrees }), gap: tuning.tightGap, tuning });
}

/** The other POI whose routes share the most road with this one's, the lower index on a tie; null with none sharing any. */
function nearestNeighbor({ poi, poiLegs, legLength }: { poi: number; poiLegs: readonly Set<number>[]; legLength: (leg: number) => number }): { poi: number; sharedLength: number } | null {
	let best: { poi: number; sharedLength: number } | null = null;
	poiLegs.forEach((legs, other) => {
		if (other === poi) return;
		let sharedLength = 0;
		for (const leg of legs) if (poiLegs[poi].has(leg)) sharedLength += legLength(leg);
		if (sharedLength > 0 && (best === null || sharedLength > best.sharedLength)) best = { poi: other, sharedLength };
	});
	return best;
}

/** A tier's routes measured against its band (Balance Simulation, gen). */
export interface GenTierRow {
	readonly tier: number;
	readonly routes: number;
	readonly band: TierBand;
	readonly stops: Spread;
	readonly inBand: Rate;
	readonly belowBand: Rate;
	readonly fights: Spread;
	readonly noFight: Rate;
	readonly fightFloorMet: Rate;
	/** Over every stop on the tier's routes, a stop on two routes counted on each. */
	readonly empty: Rate;
	readonly types: Readonly<Partial<Record<StopType, number>>>;
	readonly skulls: Spread;
	readonly hours: number | null;
	readonly pastDark: Rate;
	/** Own road's share of a route's stops, over routes with stops. */
	readonly ownShare: number | null;
	readonly ownStops: Spread;
	/** Routes whose own road holds their fight floor in fights. */
	readonly floorOnOwnRoad: Rate;
	/** Routes whose own road holds at least half their band's minimum in stops. */
	readonly halfBandOnOwnRoad: Rate;
	/** Routes whose own road has room for half their band's minimum, their floor fights among them. */
	readonly ownRoomForBoth: Rate;
	/** Routes whose own road is their last leg alone. */
	readonly ownIsLastLeg: Rate;
	/** Routes whose last leg has no room for a stop. */
	readonly lastLegNoRoom: Rate;
	readonly ownCapacity: Spread;
	readonly lastLegCapacity: Spread;
	readonly lastLegStops: Spread;
	/** Share of a route's stops its nearest neighbor's run leaves cleared, over routes with stops and a neighbor. */
	readonly neighborCleared: number | null;
	/** Routes left with no fight the day after their neighbor's run, over routes with a fight. */
	readonly neighborTakesEveryFight: Rate;
}

/** Every map's routes, measured by destination tier. */
export interface GenSummary {
	readonly maps: number;
	readonly failedMaps: readonly number[];
	readonly stopFailures: number;
	readonly thinned: number;
	/** Placed types no run can resolve yet, by type, over every map's routes. */
	readonly unresolved: Readonly<Partial<Record<StopType, number>>>;
	/** By ring, the POIs every map aimed for and seated, and the fewest and most a map seated. */
	readonly rings: readonly GenRingRow[];
	readonly tiers: readonly GenTierRow[];
}

export interface GenRingRow {
	readonly ring: number;
	readonly target: number;
	readonly placed: number;
	/** Seated POIs tier 4 since tiers 1 to 3 would leave them past dark with only their fight floor. */
	readonly promoted: number;
	readonly perMap: Spread;
}

/** The gen report: every map's routes by destination tier, against the config's bands. */
export function summarizeGen({ config, maps }: { config: SimConfig; maps: readonly GenMap[] }): GenSummary {
	const routes = maps.flatMap(map => map.routes);
	const tiers = [...new Set(routes.map(route => route.tier))].sort((a, b) => a - b);
	const unresolved: Partial<Record<StopType, number>> = {};
	for (const route of routes) {
		for (const stop of route.legs.flatMap(leg => leg.stops)) if (stop.kind === 'quiet') unresolved[stop.type] = (unresolved[stop.type] ?? 0) + 1;
	}
	return {
		maps: maps.length,
		failedMaps: maps.filter(map => map.failed !== null).map(map => map.seed),
		stopFailures: maps.reduce((sum, map) => sum + map.stopFailures.length, 0),
		thinned: maps.reduce((sum, map) => sum + map.thinned, 0),
		unresolved,
		rings: ringRows(maps.filter(map => map.failed === null)),
		tiers: tiers.map(tier => tierRow({ tier, band: config.bands[tier], routes: routes.filter(route => route.tier === tier) })),
	};
}

function ringRows(maps: readonly GenMap[]): GenRingRow[] {
	const count = maps.reduce((most, map) => Math.max(most, map.rings.length), 0);
	return Array.from({ length: count }, (_, ring) => ({
		ring,
		target: maps.reduce((sum, map) => sum + (map.rings[ring]?.target ?? 0), 0),
		placed: maps.reduce((sum, map) => sum + (map.rings[ring]?.placed ?? 0), 0),
		promoted: maps.reduce((sum, map) => sum + (map.rings[ring]?.promoted ?? 0), 0),
		perMap: spread(maps.map(map => map.rings[ring]?.placed ?? 0)),
	}));
}

function tierRow({ tier, band, routes }: { tier: number; band: TierBand; routes: readonly CorpusRoute[] }): GenTierRow {
	const audits = routes.map(route => route.audit);
	const count = (test: (audit: RouteAudit) => boolean, over: readonly RouteAudit[] = audits): Rate => rate(over.filter(test).length, over.length);
	const types: Partial<Record<StopType, number>> = {};
	for (const stop of routes.flatMap(route => route.legs.flatMap(leg => leg.stops))) types[stop.type] = (types[stop.type] ?? 0) + 1;
	// From the config's bands, so a tuning that moves a band moves its half too
	const halfBand = Math.ceil(band.stops.min / 2);
	const withStops = audits.filter(audit => audit.stops > 0);
	const withNeighbor = withStops.filter(audit => audit.neighbor !== null);
	const totalStops = audits.reduce((sum, audit) => sum + audit.stops, 0);
	return {
		tier,
		routes: routes.length,
		band,
		stops: spread(audits.map(audit => audit.stops)),
		inBand: count(audit => audit.stops >= band.stops.min && audit.stops <= band.stops.max),
		belowBand: count(audit => audit.stops < band.stops.min),
		fights: spread(audits.map(audit => audit.fights)),
		noFight: count(audit => audit.fights === 0),
		fightFloorMet: count(audit => audit.fights >= band.fights.min),
		empty: rate(audits.reduce((sum, audit) => sum + audit.empty, 0), totalStops),
		types,
		skulls: spread(audits.flatMap(audit => audit.skulls)),
		hours: mean(audits.map(audit => audit.hours)),
		pastDark: count(audit => audit.pastDark),
		ownShare: mean(withStops.map(audit => audit.ownStops / audit.stops)),
		ownStops: spread(audits.map(audit => audit.ownStops)),
		floorOnOwnRoad: count(audit => audit.ownFights >= band.fights.min),
		halfBandOnOwnRoad: count(audit => audit.ownStops >= halfBand),
		ownRoomForBoth: count(audit => audit.ownCapacity >= Math.max(halfBand, band.fights.min)),
		ownIsLastLeg: rate(routes.filter(route => route.audit.ownLegs.length === 1 && route.audit.ownLegs[0] === route.legs[route.legs.length - 1].id).length, routes.length),
		lastLegNoRoom: count(audit => audit.lastLeg.capacity === 0),
		ownCapacity: spread(audits.map(audit => audit.ownCapacity)),
		lastLegCapacity: spread(audits.map(audit => audit.lastLeg.capacity)),
		lastLegStops: spread(audits.map(audit => audit.lastLeg.stops)),
		neighborCleared: mean(withNeighbor.map(audit => (audit.neighbor as NonNullable<RouteAudit['neighbor']>).cleared.length / audit.stops)),
		neighborTakesEveryFight: count(audit => audit.neighbor !== null && audit.neighbor.fightsLeft === 0, audits.filter(audit => audit.fights > 0)),
	};
}
