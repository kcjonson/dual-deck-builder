import { BIOMES, Biome } from './Biome';
import type { MapParams } from './MapParams';
import { FACTIONS, Factions, POI_TUNING, PoiTuning, STRONGHOLD_TYPE } from './PoiData';
import type { PoiLayer } from './Pois';
import { ROAD_CLASSES, RoadClass } from './RoadNetwork';
import { routesTo } from './RouteTree';
import { ROUTE_TUNING, RouteTuning, STOP_TUNING, StopTuning, StopType, isFight } from './StopData';
import type { LegProfile, StopLayer } from './Stops';

/**
 * Route descriptors (Area Map Generation, Routes): for each POI, one per
 * route, what the run route screen shows of it. A name from its own road's
 * dominant class and biome, the least known leg on it, its fuel, its hours
 * out, at the objective, and home, when it would be back against dark, its
 * stops as far as they're known, and its risk. Read from plain data alone,
 * the POI layer and the stop layer, so it works on a map from the worker or
 * one regenerated on load. Knowledge is saved state, so it's passed in;
 * until fog (DDB-294) every leg is charted. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/stops-and-routes.md.
 */

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const ceil = Math.ceil;

/** What's known of a leg, least first. */
export const LEG_KNOWLEDGE = ['uncharted', 'rumored', 'charted'] as const;
export type LegKnowledge = (typeof LEG_KNOWLEDGE)[number];

/** A stop as a route shows it. */
export interface KnownStop {
	readonly id: number;
	readonly leg: number;
	/** Its share of its leg, 0 at the inner end to 1 at the outer. */
	readonly at: number;
	/** Null where only that a stop is there is known: a rumored leg's, or the next stop past charted and rumored road. */
	readonly type: StopType | null;
	/** A known fight's skulls; 0 otherwise. */
	readonly skulls: number;
}

/** A run's hours: out (driving and stops), at the objective, and home down the cleared road. */
export interface RouteHours {
	readonly out: number;
	readonly objective: number;
	readonly home: number;
}

export interface RouteDescriptor {
	readonly poi: number;
	/** Its place among the POI's routes, quickest first. */
	readonly route: number;
	/** Leg ids from the compound out. */
	readonly legs: readonly number[];
	/** "Route 9 highway", "Back roads", "Through the mire". */
	readonly name: string;
	/** The class and biome most of its own road is, past where it parts from the POI's other routes. */
	readonly roadClass: RoadClass;
	readonly biome: Biome;
	/** Its least known leg. */
	readonly knowledge: LegKnowledge;
	/** World units. */
	readonly length: number;
	/** Paid at departure, out and back. */
	readonly fuel: number;
	readonly hours: RouteHours;
	/** Hour of the day the run would be home, leaving at dawn... */
	readonly back: number;
	/** ...and dark falls. */
	readonly dark: number;
	/** `dark - back`: daylight to spare, below 0 past dark. */
	readonly spare: number;
	/** In driving order, as far as they're known. */
	readonly stops: readonly KnownStop[];
	/** Its worst known fight's skulls; 0 with no fight known. */
	readonly risk: number;
	/** Whether a leg on it isn't charted, so its hours are estimates, settled on the drive. */
	readonly estimated: boolean;
}

/** A generated map, as the descriptors read it: a generation's products and params, or anything holding the same. */
export interface RouteMap {
	readonly params: Pick<MapParams, 'daylightHours' | 'stopDensity'>;
	readonly products: {
		readonly pois: PoiLayer;
		readonly stops: StopLayer;
	};
}

export interface DescribeOptions {
	/** What's known of each leg: every leg charted when left out. */
	readonly knowledge?: (leg: number) => LegKnowledge;
	readonly tuning?: RouteTuning;
	readonly stopTuning?: StopTuning;
}

/** Each of a POI's routes described, quickest first. */
export function describeRoutes(map: RouteMap, poi: number, { knowledge = () => 'charted', tuning = ROUTE_TUNING, stopTuning = STOP_TUNING }: DescribeOptions = {}): RouteDescriptor[] {
	const { pois, stops } = map.products;
	const routes = routesTo(pois, pois.pois[poi]);
	const objective = pois.pois[poi].type === STRONGHOLD_TYPE ? stopTuning.objectiveHours.stronghold : stopTuning.objectiveHours.poi;
	const dark = tuning.dawn + map.params.daylightHours;
	const described = routes.map((route, place) => {
		const others = new Set(routes.flatMap((other, index) => (index === place ? [] : other.legs)));
		const own = route.legs.filter((leg) => !others.has(leg));
		const { roadClass, biome, name } = nameOf(own.map((leg) => stops.legs[leg]), tuning);
		const known: KnownStop[] = [];
		let stopHours = 0;
		let least: LegKnowledge = 'charted';
		let nextShown = false;
		for (const leg of route.legs) {
			// Past the first uncharted leg nothing is known: a direction and the next stop.
			const state: LegKnowledge = least === 'uncharted' ? 'uncharted' : knowledge(leg);
			if (LEG_KNOWLEDGE.indexOf(state) < LEG_KNOWLEDGE.indexOf(least)) least = state;
			const ids = stops.legs[leg].stops;
			if (state === 'charted') {
				for (const id of ids) {
					const { type, skulls, at } = stops.stops[id];
					known.push({ id, leg, at, type, skulls });
					stopHours += stopTuning.types[type].hours;
				}
			} else if (state === 'rumored') {
				for (const id of ids) known.push({ id, leg, at: stops.stops[id].at, type: null, skulls: 0 });
				stopHours += ids.length * tuning.unknownStopHours;
			} else {
				if (!nextShown && ids.length > 0) {
					known.push({ id: ids[0], leg, at: stops.stops[ids[0]].at, type: null, skulls: 0 });
					nextShown = true;
				}
				stopHours += expectedStops(stops.legs[leg], map.params.stopDensity, stopTuning) * tuning.unknownStopHours;
			}
		}
		const hours: RouteHours = { out: route.hours + stopHours, objective, home: route.hours };
		const back = tuning.dawn + hours.out + hours.objective + hours.home;
		return {
			poi,
			route: place,
			legs: route.legs,
			name,
			roadClass,
			biome,
			knowledge: least,
			length: route.length,
			fuel: fuelFor(route.length, tuning),
			hours,
			back,
			dark,
			spare: dark - back,
			stops: known,
			risk: known.reduce((worst, { type, skulls }) => (type !== null && isFight(type) && skulls > worst ? skulls : worst), 0),
			estimated: least !== 'charted',
		};
	});
	return disambiguate(described, map.products, poi);
}

/** Every POI's routes described, by POI. */
export function describeMap(map: RouteMap, options: DescribeOptions = {}): RouteDescriptor[][] {
	return map.products.pois.pois.map((_poi, index) => describeRoutes(map, index, options));
}

/** Fuel for a route of this length, out and back: a unit per `unitsPerFuel` of road, at least one. */
export function fuelFor(length: number, tuning: RouteTuning = ROUTE_TUNING): number {
	const fuel = ceil(length / tuning.unitsPerFuel);
	return fuel < 1 ? 1 : fuel;
}

/** Stops a leg would hold at its road's spacing, for an estimate where they aren't known. */
function expectedStops({ classLengths }: LegProfile, stopDensity: number, { spacing }: StopTuning): number {
	let expected = 0;
	for (const roadClass of ROAD_CLASSES) expected += classLengths[roadClass] / spacing[roadClass];
	return expected * stopDensity;
}

/**
 * A route's name from its own legs: a biome's where one covers `biomeShare`
 * of them and has a name, or else its dominant class's, a highway's
 * numbered by its road.
 */
function nameOf(legs: readonly LegProfile[], { names }: RouteTuning): { roadClass: RoadClass; biome: Biome; name: string } {
	const classLengths = Object.fromEntries(ROAD_CLASSES.map((roadClass) => [roadClass, 0])) as Record<RoadClass, number>;
	const biomeLengths = Object.fromEntries(BIOMES.map((biome) => [biome, 0])) as Record<Biome, number>;
	let total = 0;
	let highwayRoad = -1;
	let mostHighway = 0;
	for (const leg of legs) {
		for (const roadClass of ROAD_CLASSES) {
			classLengths[roadClass] += leg.classLengths[roadClass];
			total += leg.classLengths[roadClass];
		}
		for (const biome of BIOMES) biomeLengths[biome] += leg.biomeLengths[biome];
		if (leg.highwayRoad >= 0 && leg.classLengths.highway > mostHighway) {
			highwayRoad = leg.highwayRoad;
			mostHighway = leg.classLengths.highway;
		}
	}
	const roadClass = ROAD_CLASSES.reduce((best, next) => (classLengths[next] > classLengths[best] ? next : best));
	const biome = BIOMES.reduce((best, next) => (biomeLengths[next] > biomeLengths[best] ? next : best));
	const biomeName = names.biomes[biome];
	if (biomeName !== undefined && total > 0 && biomeLengths[biome] >= names.biomeShare * total) return { roadClass, biome, name: biomeName };
	const name = names.classes[roadClass].replace('{road}', highwayRoad >= 0 ? String(highwayRoad + 1) : '').replace(/\s+/g, ' ').trim();
	return { roadClass, biome, name };
}

/**
 * Routes to one POI that came out with the same name get the side they come
 * in from, "Back roads from the north", from the POI to the middle of each
 * one's last leg; any still alike get their letter.
 */
function disambiguate(routes: RouteDescriptor[], { pois, stops }: RouteMap['products'], poi: number): RouteDescriptor[] {
	const { site } = pois.pois[poi];
	const named = routes.map((route) => {
		if (routes.filter(({ name }) => name === route.name).length < 2) return route;
		const last = stops.legs[route.legs[route.legs.length - 1]];
		return { ...route, name: `${route.name} from the ${compass(last.midX - site.x, last.midY - site.y)}` };
	});
	return named.map((route) => {
		if (named.filter(({ name }) => name === route.name).length < 2) return route;
		return { ...route, name: `${route.name} ${String.fromCharCode(65 + route.route)}` };
	});
}

/** tan(22.5 degrees): where a bearing turns from a point of the compass to the one between. */
const EIGHTH = 0.41421356237309503;

/** The point of the compass a direction is nearest, by plain arithmetic: x east, y north. */
export function compass(dx: number, dy: number): string {
	const ax = dx < 0 ? -dx : dx;
	const ay = dy < 0 ? -dy : dy;
	if (ay <= ax * EIGHTH) return dx < 0 ? 'west' : 'east';
	if (ax <= ay * EIGHTH) return dy < 0 ? 'south' : 'north';
	return `${dy < 0 ? 'south' : 'north'}-${dx < 0 ? 'west' : 'east'}`;
}

/**
 * A POI's name until place names come from the names stream: its type's
 * label and its bearing from the compound, "Hospital, north-east", or a
 * stronghold's faction's, "Mire-Crawlers stronghold". A name another POI
 * already took gets a number.
 */
export function poiNames(layer: PoiLayer, { tuning = POI_TUNING, factions = FACTIONS }: { tuning?: PoiTuning; factions?: Factions } = {}): string[] {
	const seen = new Map<string, number>();
	return layer.pois.map(({ type, site }, index) => {
		const stronghold = layer.strongholds.find(({ poi }) => poi === index);
		const base = stronghold ? `${factions[stronghold.faction]?.label ?? stronghold.faction} stronghold` : `${tuning.types[type]?.label ?? type}, ${compass(site.x, site.y)}`;
		const count = (seen.get(base) ?? 0) + 1;
		seen.set(base, count);
		return count === 1 ? base : `${base} ${count}`;
	});
}
