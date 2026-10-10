import { Rng } from '../core/Rng';
import type { RoadClass } from '../map/RoadNetwork';
import { DescribeOptions, RouteDescriptor, RouteMap, describeMap, poiNames } from '../map/RouteDescriptors';
import { ROAD_CLASSES } from '../map/RoadNetwork';
import { isFight } from '../map/StopData';
import type { LegProfile } from '../map/Stops';

/**
 * The area map's routes in the run loop's route model (DDB-454's
 * `routesOnOffer`): every route to every POI, with its legs, their stops,
 * and its descriptor's fuel, hours, and risk. Fights stay fights with their
 * skulls; every other stop is a quiet stretch until the run has screens for
 * events, finds, garages, and hazards. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/stops-and-routes.md.
 *
 * The route model below matches SupplyRoutes.ts on DDB-454's branch field
 * for field, and gives way to its types once that merges.
 */

export type Skulls = 1 | 2 | 3;

export type RouteStop =
	| { readonly id: string; readonly kind: 'fight'; readonly at: number; readonly skulls: Skulls }
	| { readonly id: string; readonly kind: 'quiet'; readonly at: number };

export interface RouteLeg {
	readonly id: string;
	/** The class most of it is. */
	readonly roadClass: RoadClass;
	/** World units. */
	readonly length: number;
	/** Driving it, without its stops. */
	readonly hours: number;
	readonly stops: readonly RouteStop[];
}

export interface RouteDestination {
	readonly id: string;
	readonly name: string;
	/** 1 to 5. */
	readonly tier: number;
}

export interface RunRouteHours {
	readonly out: number;
	readonly objective: number;
	readonly home: number;
}

export interface RunRoute {
	readonly id: string;
	readonly name: string;
	readonly destination: RouteDestination;
	readonly legs: readonly RouteLeg[];
	readonly fuel: number;
	readonly hours: RunRouteHours;
	/** Its worst fight, in skulls. */
	readonly risk: Skulls;
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
export function routeOffers(map: RouteMap, options: DescribeOptions = {}): readonly RunRoute[] {
	const { pois } = map.products;
	const names = poiNames(pois);
	return Object.freeze(describeMap(map, options).flatMap((routes, poi) => {
		const destination: RouteDestination = Object.freeze({ id: `poi-${poi}`, name: names[poi], tier: pois.pois[poi].tier });
		return routes.map((descriptor) => runRoute({ descriptor, destination, map }));
	}));
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
		id: `route-${descriptor.poi}-${descriptor.route}`,
		name: descriptor.name,
		destination,
		legs: Object.freeze(legs),
		fuel: descriptor.fuel,
		hours: Object.freeze({ out: tenths(descriptor.hours.out), objective: tenths(descriptor.hours.objective), home: tenths(descriptor.hours.home) }),
		risk: (descriptor.risk < 1 ? 1 : descriptor.risk) as Skulls,
	});
}

/** Destinations a day offers at most, and the tiers its others come from (a tier 1 one is always among them). */
const DAY_DESTINATIONS = 3;
const DAY_TIERS = [2, 3];

/**
 * A day's offer from the map's routes, until the area map screen picks
 * POIs (DDB-43): a tier 1 destination and up to two from tiers 2 and 3,
 * drawn from `fork('routes', day)` off the campaign's seed, each with every
 * route it has. Only destinations a run can reach and leave by dark, on at
 * least one route, are offered, since a run has no night yet; strongholds
 * never are. Throws on a seed or day `Rng.fork` won't take.
 */
export function offersForDay({ routes, seed, day, daylightHours }: {
	routes: readonly RunRoute[];
	seed: number;
	day: number;
	daylightHours: number;
}): readonly RunRoute[] {
	const rng = new Rng({ seed }).fork('routes', day);
	const byDestination = new Map<string, RunRoute[]>();
	for (const route of routes) byDestination.set(route.destination.id, [...(byDestination.get(route.destination.id) ?? []), route]);
	const homeByDark = (offered: readonly RunRoute[]) => offered.some(({ hours }) => hours.out + hours.objective + hours.home <= daylightHours);
	const open = [...byDestination.values()].filter((offered) => offered[0].destination.tier <= 3 && homeByDark(offered));
	const first = open.filter((offered) => offered[0].destination.tier === 1);
	const rest = open.filter((offered) => DAY_TIERS.includes(offered[0].destination.tier));
	const picked: RunRoute[][] = [];
	if (first.length > 0) picked.push(first[rng.int(0, first.length - 1)]);
	const others = rng.shuffle([...rest]).slice(0, DAY_DESTINATIONS - picked.length);
	return Object.freeze([...picked, ...others].flat());
}

function dominantClass({ classLengths }: LegProfile): RoadClass {
	return ROAD_CLASSES.reduce((best, next) => (classLengths[next] > classLengths[best] ? next : best));
}

const tenths = (hours: number): number => Math.round(hours * 10) / 10;
const hundredths = (share: number): number => Math.round(share * 100) / 100;
