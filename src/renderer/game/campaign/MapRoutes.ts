import { POI_TUNING, PoiTuning } from '../map/PoiData';
import type { RoadClass } from '../map/RoadNetwork';
import { DescribeOptions, RouteDescriptor, RouteMap, describeMap, poiNames } from '../map/RouteDescriptors';
import { ROAD_CLASSES } from '../map/RoadNetwork';
import { isFight } from '../map/StopData';
import type { LegProfile } from '../map/Stops';
import type { Skulls } from './Encounters';
import { RouteDestination, RouteLeg, RouteStop, RunRoute, YIELD_RESOURCES, YieldResource } from './SupplyRoutes';

/**
 * The area map's routes in the run loop's route model (SupplyRoutes.ts):
 * every route to every POI, with its legs, their stops, and its
 * descriptor's fuel, hours, and risk. Fights stay fights with their skulls;
 * every other stop is a quiet stretch until the run has screens for events,
 * finds, garages, and hazards. A destination yields what its POI type does,
 * meds aside until a run can carry them. `routesOnOffer` (SupplyRun.ts)
 * reads them. The decision records are
 * docs/AI_TECHNICAL_DECISIONS/stops-and-routes.md and area-map-route-pick.md.
 */

/** A POI's destination id in the route model, `poi-<poi>`. */
export function destinationId(poi: number): string {
	return `poi-${poi}`;
}

/** The id of a POI's route, its place among the POI's routes, quickest first: `route-<poi>-<route>`. */
export function routeId(poi: number, route: number): string {
	return `route-${poi}-${route}`;
}

/**
 * Every route on the map as the run takes it, POI by POI, each POI's
 * quickest first. Ids come from the map's own: `poi-<poi>`,
 * `route-<poi>-<route>`, `leg-<leg>`, and `stop-<stop>`, so a map gives the
 * same routes however often it's asked. A run carries every stop on its
 * legs, whatever the route card knows of them; `knowledge` changes only
 * the hours, which estimate what isn't charted. Hours are rounded to
 * tenths and lengths to whole units, as the run shows them. Risk is the
 * route card's, its worst known fight, and 1, the objective's, with none.
 */
export function routeOffers(map: RouteMap, options: OfferOptions = {}): readonly RunRoute[] {
	return Object.freeze(offersByPoi(map, describeMap(map, options), options).flat());
}

export interface OfferOptions extends DescribeOptions {
	/** The shipped POI tuning, whose types' yields a destination yields, when left out. */
	readonly poiTuning?: PoiTuning;
}

/** Each POI's routes, from its descriptors. */
function offersByPoi(map: RouteMap, described: readonly (readonly RouteDescriptor[])[], { poiTuning = POI_TUNING }: OfferOptions): RunRoute[][] {
	const { pois } = map.products;
	const { types } = poiTuning;
	const names = poiNames(pois);
	return described.map((routes, poi) => {
		const { tier, type } = pois.pois[poi];
		// A stronghold yields by its own rules, none of which exist yet.
		const yields = types[type]?.yields ?? {};
		const destination: RouteDestination = Object.freeze({
			id: destinationId(poi),
			name: names[poi],
			tier,
			yield: Object.freeze(Object.fromEntries(YIELD_RESOURCES.map((resource) => [resource, yields[resource] ?? 0])) as Record<YieldResource, number>),
		});
		return routes.map((descriptor) => runRoute({ descriptor, destination, map }));
	});
}

function runRoute({ descriptor, destination, map }: { descriptor: RouteDescriptor; destination: RouteDestination; map: RouteMap }): RunRoute {
	const { pois, stops } = map.products;
	const legs = descriptor.legs.map((leg): RouteLeg => {
		const profile = stops.legs[leg];
		const { length, hours } = pois.legs[leg];
		return Object.freeze({
			id: `leg-${leg}`,
			roadClass: dominantClass(profile),
			length: Math.round(length),
			hours: tenths(hours),
			stops: Object.freeze(profile.stops.map((id): RouteStop => {
				const { type, at, skulls } = stops.stops[id];
				return Object.freeze(isFight(type)
					? { id: `stop-${id}`, kind: 'fight' as const, at: hundredths(at), skulls: skulls as Skulls }
					: { id: `stop-${id}`, kind: 'quiet' as const, at: hundredths(at) });
			})),
		});
	});
	return Object.freeze({
		id: routeId(descriptor.poi, descriptor.route),
		name: descriptor.name,
		destination,
		legs: Object.freeze(legs),
		fuel: descriptor.fuel,
		hours: Object.freeze({ out: tenths(descriptor.hours.out), objective: tenths(descriptor.hours.objective), home: tenths(descriptor.hours.home) }),
		risk: (descriptor.risk < 1 ? 1 : descriptor.risk) as Skulls,
	});
}

function dominantClass({ classLengths }: LegProfile): RoadClass {
	return ROAD_CLASSES.reduce((best, next) => (classLengths[next] > classLengths[best] ? next : best));
}

const tenths = (hours: number): number => Math.round(hours * 10) / 10;
const hundredths = (share: number): number => Math.round(share * 100) / 100;
