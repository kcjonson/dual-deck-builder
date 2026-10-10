import { describeValue } from '../core/Json';
import { ReaderRangeError, readArray, readFields, readInteger, readNumber, readObject, readOneOf, readText } from '../core/JsonReader';
import { ROAD_CLASSES, RoadClass } from '../map/RoadNetwork';
import type { Skulls } from './Encounters';

/**
 * The supply run's route model (DDB-454), the area map's routes as a run
 * takes them: a POI (Map 10), its routes, each an ordered list of legs of
 * the route tree (Map 9) carrying their stops (Map 12), and each route's
 * descriptor, its fuel, hours, and risk (Map 14). Area Map Generation, The
 * route tree, POIs, Stops, and Routes. `routeOffers` (MapRoutes.ts) builds
 * them from a generated map, and `routesOnOffer` (SupplyRun.ts) offers them.
 * Decision records: docs/AI_TECHNICAL_DECISIONS/mvp-supply-run.md and
 * area-map-route-pick.md.
 */

/** What a stop is, fixed when the map is made. Only these two so far; events, finds, garages, and hazards come later. */
export const STOP_KINDS = ['fight', 'quiet'] as const;
export type StopKind = (typeof STOP_KINDS)[number];

/**
 * Something waiting on a leg: a raider fight of 1 to 3 skulls, whose raiders
 * are rolled when the run gets there, or a quiet stretch where nothing
 * happens. `at` is how far along the leg it sits, 0 at its inner end to 1
 * at its outer.
 */
export type RouteStop =
	| { readonly id: string; readonly kind: 'fight'; readonly at: number; readonly skulls: Skulls }
	| { readonly id: string; readonly kind: 'quiet'; readonly at: number };

/** A piece of the route tree between places where routes split or end, driven outward, its stops in the order a run meets them. */
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

/** What a destination yields to a run that reaches it. */
export const YIELD_RESOURCES = ['food', 'water', 'fuel', 'scrap'] as const;
export type YieldResource = (typeof YIELD_RESOURCES)[number];
export type RouteYield = Readonly<Record<YieldResource, number>>;

/** The point of interest a route arrives at. */
export interface RouteDestination {
	readonly id: string;
	readonly name: string;
	/** 1 to 5, from its quickest route's hours. */
	readonly tier: number;
	/** Loaded into the run's cargo when it gets there: its POI type's yield (Map 10). */
	readonly yield: RouteYield;
}

/** A run's hours: out (driving and stops), at the objective, and home down the cleared road. */
export interface RouteHours {
	readonly out: number;
	readonly objective: number;
	readonly home: number;
}

/** One route to a POI with its descriptor, as the run route screen offers it and a run carries it. */
export interface RunRoute {
	readonly id: string;
	/** From its own road's dominant class or biome: "Route 9 highway", "Back roads", "Through the mire". */
	readonly name: string;
	readonly destination: RouteDestination;
	/** From the compound out, at least one, sharing their first legs with the POI's other routes until they split. */
	readonly legs: readonly RouteLeg[];
	/** Paid at departure. */
	readonly fuel: number;
	readonly hours: RouteHours;
	/** Its worst fight, in skulls. */
	readonly risk: Skulls;
}

/** Every stop on a route, in the order the run meets them. A run's `stop` counts along this. */
export function routeStops(route: RunRoute): readonly RouteStop[] {
	return route.legs.flatMap(leg => leg.stops);
}

/** A route as a save holds it, read back frozen. */
export function readRunRoute(value: unknown, path: string): RunRoute {
	const fields = readFields(value, path, ['id', 'name', 'destination', 'legs', 'fuel', 'hours', 'risk']);
	const legs = Array.from(readArray(fields.legs, `${path}.legs`), (leg, index) => readLeg(leg, `${path}.legs[${index}]`));
	if (legs.length === 0) throw new ReaderRangeError(`${path}.legs is empty; a route has a leg at least`);
	const destination = readFields(fields.destination, `${path}.destination`, ['id', 'name', 'tier', 'yield']);
	const yields = readFields(destination.yield, `${path}.destination.yield`, YIELD_RESOURCES);
	const hours = readFields(fields.hours, `${path}.hours`, ['out', 'objective', 'home']);
	return Object.freeze({
		id: readText(fields.id, `${path}.id`),
		name: readText(fields.name, `${path}.name`),
		destination: Object.freeze({
			id: readText(destination.id, `${path}.destination.id`),
			name: readText(destination.name, `${path}.destination.name`),
			tier: readInteger(destination.tier, `${path}.destination.tier`, { min: 1, max: 5 }),
			yield: Object.freeze(Object.fromEntries(YIELD_RESOURCES.map(resource => [
				resource,
				readInteger(yields[resource], `${path}.destination.yield.${resource}`, { min: 0 }),
			])) as Record<YieldResource, number>),
		}),
		legs: Object.freeze(legs),
		fuel: readInteger(fields.fuel, `${path}.fuel`, { min: 0 }),
		hours: Object.freeze({
			out: readAmount(hours.out, `${path}.hours.out`),
			objective: readAmount(hours.objective, `${path}.hours.objective`),
			home: readAmount(hours.home, `${path}.hours.home`),
		}),
		risk: readInteger(fields.risk, `${path}.risk`, { min: 1, max: 3 }) as Skulls,
	});
}

function readLeg(value: unknown, path: string): RouteLeg {
	const fields = readFields(value, path, ['id', 'roadClass', 'length', 'hours', 'stops']);
	const stops = Array.from(readArray(fields.stops, `${path}.stops`), (stop, index) => readStop(stop, `${path}.stops[${index}]`));
	stops.forEach((stop, index) => {
		if (index > 0 && stop.at < stops[index - 1].at) throw new ReaderRangeError(`${path}.stops[${index}].at ${stop.at} comes before the stop above it; a leg's stops are in driving order`);
	});
	return Object.freeze({
		id: readText(fields.id, `${path}.id`),
		roadClass: readOneOf(fields.roadClass, `${path}.roadClass`, ROAD_CLASSES),
		length: readAmount(fields.length, `${path}.length`),
		hours: readAmount(fields.hours, `${path}.hours`),
		stops: Object.freeze(stops),
	});
}

function readStop(value: unknown, path: string): RouteStop {
	const kind = readOneOf(readObject(value, path).kind, `${path}.kind`, STOP_KINDS);
	if (kind === 'quiet') {
		const fields = readFields(value, path, ['id', 'kind', 'at']);
		return Object.freeze({ id: readText(fields.id, `${path}.id`), kind, at: readFraction(fields.at, `${path}.at`) });
	}
	const fields = readFields(value, path, ['id', 'kind', 'at', 'skulls']);
	return Object.freeze({
		id: readText(fields.id, `${path}.id`),
		kind,
		at: readFraction(fields.at, `${path}.at`),
		skulls: readInteger(fields.skulls, `${path}.skulls`, { min: 1, max: 3 }) as Skulls,
	});
}

/** A finite amount from 0 up: hours, or a length. */
function readAmount(value: unknown, path: string): number {
	const amount = readNumber(value, path);
	if (!(amount >= 0)) throw new ReaderRangeError(`${path} must be 0 or more, got ${describeValue(amount)}`);
	return amount;
}

function readFraction(value: unknown, path: string): number {
	const fraction = readNumber(value, path);
	if (!(fraction >= 0 && fraction <= 1)) throw new ReaderRangeError(`${path} must be from 0 to 1, got ${describeValue(fraction)}`);
	return fraction;
}
