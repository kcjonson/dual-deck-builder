import type { MapParams } from './MapParams';
import { STRONGHOLD_TYPE } from './PoiData';
import type { PoiLayer } from './Pois';
import type { RoadNetwork } from './RoadNetwork';
import { Route, routesTo } from './RouteTree';
import { STOP_TUNING, StopTuning, StopType, isCalm, isFight } from './StopData';
import { DAYLIGHT_TIERS, StopLayer, junctionsAlong, nodeDegrees } from './Stops';

/**
 * Checks a map's stops against the rules they keep (Area Map Generation, 9.
 * Stops, and guarantee 10), from the map's data alone, so a loaded map
 * checks the way a fresh one does. Placement keeps every rule as it goes;
 * this walks every route to every POI again. It reports every problem it
 * finds, never stopping at a limit, since the stops stage retries only
 * itself and keeps the attempt with the fewest.
 */

export type StopRule = 'placement' | 'clearance' | 'fights' | 'calm' | 'finds' | 'daylight';

export interface StopViolation {
	readonly rule: StopRule;
	readonly detail: string;
}

export interface StopCheckOptions {
	readonly network: RoadNetwork;
	readonly layer: PoiLayer;
	readonly stops: StopLayer;
	readonly params: Pick<MapParams, 'driverFinds' | 'daylightHours'>;
	readonly tuning?: StopTuning;
}

/**
 * Every rule broken:
 *
 * - placement: one profile a leg; each stop on its leg, inside it, at its
 *   share of it, listed by its leg in driving order, its id its place.
 * - clearance: each stop keeps its clearance from its leg's ends, and from
 *   every junction partway along it (a node where three or more roads meet).
 * - fights: no route has more than two fights in a row.
 * - calm: every three stops in a row on a route hold a non-fight, neither a
 *   fight nor a checkpoint.
 * - finds: at least driverFinds Find: driver stops on legs in the floor's
 *   tiers, wherever the map has such a leg.
 * - daylight: every POI in tiers 1 to 3 has a route whose estimated run fits
 *   in daylightHours, unless its quickest route runs past dark with no stops
 *   at all, which the layer lists in its failures (guarantee 10).
 */
export function checkStopLayer({ network, layer, stops, params, tuning = STOP_TUNING }: StopCheckOptions): StopViolation[] {
	const violations: StopViolation[] = [];
	const report = (rule: StopRule, detail: string) => violations.push({ rule, detail });
	checkPlacement(layer, stops, report);
	checkClearance({ network, layer, stops, tuning, report });
	layer.pois.forEach((poi, index) => {
		const routes = routesTo(layer, poi);
		routes.forEach((route, place) => {
			const types = typesAlong(stops, route);
			for (let at = 2; at < types.length; at += 1) {
				const window = types.slice(at - 2, at + 1);
				if (window.every(isFight)) report('fights', `poi ${index} route ${place}: stops ${at - 2} to ${at} are all fights`);
				if (!window.some(isCalm)) report('calm', `poi ${index} route ${place}: stops ${at - 2} to ${at} hold no non-fight (${window.join(', ')})`);
			}
		});
		if (poi.tier > DAYLIGHT_TIERS || routes.length === 0) return;
		const objective = poi.type === STRONGHOLD_TYPE ? tuning.objectiveHours.stronghold : tuning.objectiveHours.poi;
		const estimates = routes.map((route) => 2 * route.hours + objective + typesAlong(stops, route).reduce((sum, type) => sum + tuning.types[type].hours, 0));
		if (estimates.some((hours) => hours <= params.daylightHours)) return;
		const bare = 2 * routes[0].hours + objective;
		if (bare > params.daylightHours && stops.failures.some((failure) => failure.startsWith(`poi ${index} `))) return;
		report('daylight', `poi ${index} (tier ${poi.tier}): its best route's estimated run takes ${Math.min(...estimates).toFixed(2)} hours, past daylightHours ${params.daylightHours}`);
	});
	const { floorTiers } = tuning.driverFinds;
	const floorLegs = stops.legs.filter(({ tier }) => tier <= floorTiers);
	if (floorLegs.length > 0) {
		const finds = floorLegs.reduce((sum, { stops: ids }) => sum + ids.filter((id) => stops.stops[id]?.type === 'findDriver').length, 0);
		if (finds < params.driverFinds) report('finds', `${finds} Find: driver stops in tiers 1 to ${floorTiers}, under driverFinds ${params.driverFinds}`);
	}
	return violations;
}

function checkPlacement(layer: PoiLayer, { stops, legs }: StopLayer, report: (rule: StopRule, detail: string) => void): void {
	if (legs.length !== layer.legs.length) report('placement', `${legs.length} leg profiles for ${layer.legs.length} legs`);
	stops.forEach((stop, index) => {
		if (stop.id !== index) report('placement', `stop ${index} has id ${stop.id}`);
		const leg = layer.legs[stop.leg];
		if (!leg) {
			report('placement', `stop ${index} is on leg ${stop.leg}, which the map doesn't have`);
			return;
		}
		if (!(stop.along > 0 && stop.along < leg.length)) report('placement', `stop ${index} is ${stop.along} along leg ${stop.leg}, outside its ${leg.length}`);
		if (Math.abs(stop.at * leg.length - stop.along) > 1e-6 * (1 + leg.length)) report('placement', `stop ${index}'s share ${stop.at} isn't ${stop.along} of ${leg.length}`);
		if (!legs[stop.leg]?.stops.includes(index)) report('placement', `stop ${index} isn't listed on leg ${stop.leg}`);
	});
	legs.forEach(({ stops: ids }, leg) => {
		ids.forEach((id, place) => {
			if (stops[id]?.leg !== leg) report('placement', `leg ${leg} lists stop ${id}, which is on leg ${stops[id]?.leg}`);
			if (place > 0 && !(stops[id]?.along > stops[ids[place - 1]]?.along)) report('placement', `leg ${leg}'s stops ${ids[place - 1]} and ${id} aren't in driving order`);
		});
	});
}

function checkClearance({ network, layer, stops, tuning, report }: { network: RoadNetwork; layer: PoiLayer; stops: StopLayer; tuning: StopTuning; report: (rule: StopRule, detail: string) => void }): void {
	const degrees = nodeDegrees(network);
	const { clearance } = tuning;
	const slack = 1e-9;
	layer.legs.forEach((leg, id) => {
		const ids = stops.legs[id]?.stops ?? [];
		if (ids.length === 0) return;
		const ends = clearance.ends < 0.25 * leg.length ? clearance.ends : 0.25 * leg.length;
		const joins = junctionsAlong({ network, leg, degrees });
		for (const stopId of ids) {
			const along = stops.stops[stopId]?.along;
			if (along === undefined) continue;
			if (along < ends - slack || along > leg.length - ends + slack) report('clearance', `stop ${stopId} is ${along.toFixed(2)} along leg ${id}, inside its ${ends.toFixed(2)} from an end`);
			for (const join of joins) {
				if (Math.abs(along - join) < clearance.junctions - slack) report('clearance', `stop ${stopId} is ${Math.abs(along - join).toFixed(2)} from a junction ${join.toFixed(2)} along leg ${id}`);
			}
		}
	});
}

/** Every stop's type along a route, in the order a run meets them. */
export function typesAlong({ stops, legs }: StopLayer, route: Route): StopType[] {
	const types: StopType[] = [];
	for (const leg of route.legs) for (const id of legs[leg]?.stops ?? []) types.push(stops[id].type);
	return types;
}
