import { describeValue } from '../core/Json';
import { ReaderRangeError, readArray, readFields, readInteger, readNumber, readObject, readOneOf, readText } from '../core/JsonReader';
import { Rng } from '../core/Rng';
import { ROAD_CLASSES, RoadClass } from '../map/RoadNetwork';
import type { Skulls } from './Encounters';

/**
 * Routes for the MVP supply run (DDB-454), in the shape the area map will
 * hand them over: a POI (Map 10), its routes, each an ordered list of legs
 * of the route tree (Map 9) carrying their stops (Map 12), and each route's
 * descriptor, its fuel, hours, and risk (Map 14). Area Map Generation, The
 * route tree, POIs, Stops, and Routes. `supplyRoutes` stands in for the map
 * until it exists, and `routesOnOffer` (SupplyRun.ts) is the one caller to
 * swap. Decision record: docs/AI_TECHNICAL_DECISIONS/mvp-supply-run.md.
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

/** The point of interest a route arrives at. */
export interface RouteDestination {
	readonly id: string;
	readonly name: string;
	/** 1 to 5, from its quickest route's hours. */
	readonly tier: number;
}

/** A run's hours: out (driving and stops), at the objective, and home down the cleared road. */
export interface RouteHours {
	readonly out: number;
	readonly objective: number;
	readonly home: number;
}

/** One route to a POI with its descriptor, as the route pick offers it and a run carries it. */
export interface RunRoute {
	readonly id: string;
	/** From its dominant class: "Route 9 highway", "Back roads", "Through the hills". */
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

/** The leg a route's stop is on, by its place in `routeStops`. */
export function legOfStop({ route, stop }: { route: RunRoute; stop: number }): RouteLeg | null {
	let passed = 0;
	for (const leg of route.legs) {
		passed += leg.stops.length;
		if (stop < passed) return leg;
	}
	return null;
}

const POI_NAMES = [
	'Cinder Flats Pharmacy',
	'Old Mill Salvage Yard',
	'Route 9 Fuel Depot',
	'Dry Lake Water Plant',
	'Kessel Ridge Farms',
	'Ashgrove Mall',
	'Red Mesa Silos',
	"Saint Jude's Hospital",
	'Copper Wash Junkyard',
	'Halfway Truck Stop',
];

/** Route names by dominant class; a POI's routes take different ones. */
const ROUTE_NAMES: Readonly<Record<RoadClass, readonly string[]>> = {
	highway: ['Highway', 'Interstate', 'State highway'],
	backRoad: ['Back roads', 'Old county road', 'Farm roads'],
	trail: ['Through the hills', 'Canyon trail', 'Dry wash trail'],
};

/** Units an hour by class, realistic-map.md's provisional speeds. */
const CLASS_SPEEDS: Readonly<Record<RoadClass, number>> = { highway: 260, backRoad: 160, trail: 90 };

/** Hours a stop takes (Compound and Supply Runs, Racing the dark): a fight's starting value, and a quiet stretch's guess. */
const STOP_HOURS: Readonly<Record<StopKind, number>> = { fight: 1, quiet: 0.5 };
const OBJECTIVE_HOURS = 1;
/** Road a unit of fuel covers, out and back. */
const UNITS_PER_FUEL = 150;
/** At most this many stops a route, so a run fits an MVP sitting; at most two fights in a row and a non-fight in any three (Stops). */
const MAX_ROUTE_STOPS = 3;

/**
 * Today's destinations and their routes: two or three POIs, each with two
 * routes that leave the compound on one leg and split after it, as the
 * route tree's do before halfway. A POI's tier, 1 to 3, sets its routes'
 * fights: one to three on each route, the last one at the tier's skulls
 * and none worse, and three stops hold a quiet one. Drawn from
 * `fork('routes', day)` off the campaign's seed, so a day offers the same
 * routes however often it's asked, and the day never comes round again.
 * Throws on a seed or day `Rng.fork` won't take.
 */
export function supplyRoutes({ seed, day }: { seed: number; day: number }): readonly RunRoute[] {
	const rng = new Rng({ seed }).fork('routes', day);
	const count = rng.int(2, 3);
	const names = rng.shuffle([...POI_NAMES]);
	const tiers = rng.shuffle([1, 2, 3] as Skulls[]).slice(0, count).sort((a, b) => a - b);
	return Object.freeze(tiers.flatMap((tier, index) => {
		const destination: RouteDestination = Object.freeze({ id: `poi-${day}-${index + 1}`, name: names[index], tier });
		const prefix = `${day}-${index + 1}`;
		const trunk = mockLeg({ rng, id: `leg-${prefix}-1`, roadClass: 'highway', stops: [] });
		const classes = rng.shuffle([...ROAD_CLASSES]).slice(0, 2);
		return classes.map((roadClass, route) => mockRoute({ rng, id: `route-${prefix}-${route + 1}`, prefix: `${prefix}-${route + 2}`, destination, trunk, roadClass }));
	}));
}

/** A route: the trunk, then a leg or two of its own, and stops placed from the far end in, so its last stop is its hardest fight. */
function mockRoute({ rng, id, prefix, destination, trunk, roadClass }: {
	rng: Rng;
	id: string;
	prefix: string;
	destination: RouteDestination;
	trunk: RouteLeg;
	roadClass: RoadClass;
}): RunRoute {
	const risk = destination.tier as Skulls;
	const fights = risk === 1 ? 1 : rng.int(1, 2);
	const kinds: StopKind[] = Array.from({ length: fights }, () => 'fight');
	if (fights + 1 <= MAX_ROUTE_STOPS && rng.int(0, 1) === 1) kinds.splice(rng.int(0, kinds.length - 1), 0, 'quiet');
	const lastFight = kinds.lastIndexOf('fight');
	const specs = kinds.map((kind, index) => ({ kind, skulls: kind === 'fight' && index !== lastFight ? (rng.int(1, risk) as Skulls) : risk }));
	const perLeg = specs.length > 1 && rng.int(0, 1) === 1 ? [specs.slice(0, 1), specs.slice(1)] : [specs];
	const legs = perLeg.map((stops, leg) => mockLeg({ rng, id: `leg-${prefix}-${leg + 1}`, roadClass, stops }));
	const allLegs = [trunk, ...legs];
	const length = allLegs.reduce((total, leg) => total + leg.length, 0);
	const drive = allLegs.reduce((total, leg) => total + leg.hours, 0);
	const stopHours = kinds.reduce((total, kind) => total + STOP_HOURS[kind], 0);
	const names = ROUTE_NAMES[roadClass];
	const name = roadClass === 'highway' ? `Route ${rng.int(2, 99)} highway` : names[rng.int(0, names.length - 1)];
	return Object.freeze({
		id,
		name,
		destination,
		legs: Object.freeze(allLegs),
		fuel: Math.max(1, Math.ceil(length / UNITS_PER_FUEL)),
		hours: Object.freeze({ out: tenths(drive + stopHours), objective: OBJECTIVE_HOURS, home: tenths(drive) }),
		risk,
	});
}

/** A leg of `roadClass` with these stops spread along it, clear of both ends. */
function mockLeg({ rng, id, roadClass, stops }: { rng: Rng; id: string; roadClass: RoadClass; stops: readonly { kind: StopKind; skulls: Skulls }[] }): RouteLeg {
	const length = rng.int(80, 220);
	const placed = stops.map(({ kind, skulls }, index) => {
		const at = hundredths((index + 0.5 + (rng.float() - 0.5) * 0.6) / stops.length * 0.7 + 0.15);
		const stopId = `${id}-stop-${index + 1}`;
		return Object.freeze(kind === 'fight' ? { id: stopId, kind, at, skulls } : { id: stopId, kind, at });
	});
	return Object.freeze({ id, roadClass, length, hours: tenths(length / CLASS_SPEEDS[roadClass]), stops: Object.freeze(placed) });
}

const tenths = (hours: number): number => Math.round(hours * 10) / 10;
const hundredths = (fraction: number): number => Math.round(fraction * 100) / 100;

/** A route as a save holds it, read back frozen. */
export function readRunRoute(value: unknown, path: string): RunRoute {
	const fields = readFields(value, path, ['id', 'name', 'destination', 'legs', 'fuel', 'hours', 'risk']);
	const legs = Array.from(readArray(fields.legs, `${path}.legs`), (leg, index) => readLeg(leg, `${path}.legs[${index}]`));
	if (legs.length === 0) throw new ReaderRangeError(`${path}.legs is empty; a route has a leg at least`);
	const destination = readFields(fields.destination, `${path}.destination`, ['id', 'name', 'tier']);
	const hours = readFields(fields.hours, `${path}.hours`, ['out', 'objective', 'home']);
	return Object.freeze({
		id: readText(fields.id, `${path}.id`),
		name: readText(fields.name, `${path}.name`),
		destination: Object.freeze({
			id: readText(destination.id, `${path}.destination.id`),
			name: readText(destination.name, `${path}.destination.name`),
			tier: readInteger(destination.tier, `${path}.destination.tier`, { min: 1, max: 5 }),
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
