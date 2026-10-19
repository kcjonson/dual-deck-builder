import type { MapParams } from './MapParams';
import { STRONGHOLD_TYPE } from './PoiData';
import type { PoiLayer } from './Pois';
import type { RoadNetwork } from './RoadNetwork';
import { Route, routesTo } from './RouteTree';
import { STOP_TUNING, StopTuning, StopType, isCalm, isFight } from './StopData';
import { DAYLIGHT_TIERS, bandFor, junctionsAlong, legEnds, legOwners, nodeDegrees, runHours } from './StopRoom';
import type { StopLayer } from './Stops';

/**
 * Checks a map's stops against the rules they keep (Area Map Generation, 9.
 * Stops, and guarantees 10 and 11), from the map's data alone, so a loaded
 * map checks the way a fresh one does. Placement keeps every rule as it
 * goes; this walks every route to every POI again. It reports every problem
 * it finds, never stopping at a limit, since the stops stage retries only
 * itself and keeps the attempt with the fewest. A route reads its stops from
 * game stage 0; a dormant extra only ever adds a calm stop, which breaks no
 * rule, so the rules that hold at stage 0 hold at every stage.
 */

export type StopRule = 'placement' | 'clearance' | 'fights' | 'calm' | 'finds' | 'daylight' | 'floor' | 'fightBand' | 'extras' | 'band' | 'ownRoad';

/** Rules a map may miss, reported in the layer's failures rather than failing the stage. */
const SOFT_RULES: readonly StopRule[] = ['band', 'ownRoad'];

export interface StopViolation {
	readonly rule: StopRule;
	readonly detail: string;
	/** A hard rule fails the stops stage; a soft one is only reported. */
	readonly hard: boolean;
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
 *   share of it, listed by its leg once, among its stops from stage 0 or its
 *   extras by its stage, in driving order, its id its place.
 * - clearance: each stop keeps its clearance from its leg's ends, and from
 *   every junction partway along it (a node where three or more roads meet).
 * - fights: no route has more than two fights in a row.
 * - calm: every three stops in a row on a route hold a non-fight, neither a
 *   fight nor a checkpoint.
 * - floor: every route holds its band's fight floor, and all of it on its
 *   own road, legs no other POI's routes use (guarantee 11). The one rule a
 *   kept attempt may never miss.
 * - fightBand: no route holds more fights than its band's most.
 * - extras: a dormant extra is calm, on a game stage the tuning has, and on
 *   a route's own last leg.
 * - finds: at least driverFinds Find: driver stops on legs in the floor's
 *   tiers, wherever the map has such a leg.
 * - daylight: every POI in tiers 1 to 3 has a route whose estimated run,
 *   every extra on, fits in daylightHours, unless its quickest route runs
 *   past dark with no stops at all, which the layer lists in its failures
 *   (guarantee 10).
 * - band, soft: every route's stops in its band.
 * - ownRoad, soft: every route's own road holds half its band's minimum.
 */
export function checkStopLayer({ network, layer, stops, params, tuning = STOP_TUNING }: StopCheckOptions): StopViolation[] {
	const violations: StopViolation[] = [];
	const report = (rule: StopRule, detail: string) => violations.push({ rule, detail, hard: !SOFT_RULES.includes(rule) });
	checkPlacement(layer, stops, report);
	checkClearance({ network, layer, stops, tuning, report });
	const routes = layer.pois.map((poi) => routesTo(layer, poi));
	const owners = legOwners(layer.legs.length, routes);
	const lastLegs = new Set(layer.pois.flatMap(({ arrivals }) => arrivals.map(({ leg }) => leg)));
	stops.legs.forEach(({ extras }, leg) => {
		for (const id of extras) {
			const stop = stops.stops[id];
			if (!stop) continue;
			if (!isCalm(stop.type)) report('extras', `stop ${id}, a dormant extra, is a ${stop.type}`);
			if (!tuning.extras.includes(stop.stage)) report('extras', `stop ${id}, a dormant extra, turns on at game stage ${stop.stage}, which the tuning doesn't have`);
			if (!lastLegs.has(leg)) report('extras', `stop ${id}, a dormant extra, is on leg ${leg}, no route's own last leg`);
		}
	});
	layer.pois.forEach((poi, index) => {
		const { stops: band, fights: fightBand } = bandFor(poi.tier, tuning);
		routes[index].forEach((route, place) => {
			const where = `poi ${index} route ${place}`;
			const types = typesAlong(stops, route);
			for (let at = 2; at < types.length; at += 1) {
				const window = types.slice(at - 2, at + 1);
				if (window.every(isFight)) report('fights', `${where}: stops ${at - 2} to ${at} are all fights`);
				if (!window.some(isCalm)) report('calm', `${where}: stops ${at - 2} to ${at} hold no non-fight (${window.join(', ')})`);
			}
			const fights = types.filter(isFight).length;
			let ownStops = 0;
			let ownFights = 0;
			for (const leg of route.legs) {
				if (owners[leg] !== index) continue;
				for (const id of stops.legs[leg]?.stops ?? []) {
					ownStops += 1;
					if (isFight(stops.stops[id].type)) ownFights += 1;
				}
			}
			if (fights < fightBand.min) report('floor', `${where}: ${fights} fights, under its floor of ${fightBand.min}`);
			else if (ownFights < fightBand.min) report('floor', `${where}: ${ownFights} fights on its own road, under its floor of ${fightBand.min}`);
			if (fights > fightBand.max) report('fightBand', `${where}: ${fights} fights, over its band's ${fightBand.max}`);
			if (types.length < band.min || types.length > band.max) report('band', `${where}: ${types.length} stops, outside its band of ${band.min} to ${band.max}`);
			if (ownStops < Math.ceil(band.min / 2)) report('ownRoad', `${where}: ${ownStops} stops on its own road, under half its band's ${band.min}`);
		});
		if (poi.tier > DAYLIGHT_TIERS || routes[index].length === 0) return;
		const objective = poi.type === STRONGHOLD_TYPE ? tuning.objectiveHours.stronghold : tuning.objectiveHours.poi;
		const estimates = routes[index].map((route) => runHours({ routeHours: route.hours, objectiveHours: objective, stopHours: typesAlong(stops, route, { extras: true }).reduce((sum, type) => sum + tuning.types[type].hours, 0) }));
		if (estimates.some((hours) => hours <= params.daylightHours)) return;
		const bare = 2 * routes[index][0].hours + objective;
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
	const listed = new Map<number, number>();
	legs.forEach(({ stops: ids, extras }) => {
		for (const id of [...ids, ...extras]) listed.set(id, (listed.get(id) ?? 0) + 1);
	});
	stops.forEach((stop, index) => {
		if (stop.id !== index) report('placement', `stop ${index} has id ${stop.id}`);
		const leg = layer.legs[stop.leg];
		if (!leg) {
			report('placement', `stop ${index} is on leg ${stop.leg}, which the map doesn't have`);
			return;
		}
		if (!(stop.along > 0 && stop.along < leg.length)) report('placement', `stop ${index} is ${stop.along} along leg ${stop.leg}, outside its ${leg.length}`);
		if (Math.abs(stop.at * leg.length - stop.along) > 1e-6 * (1 + leg.length)) report('placement', `stop ${index}'s share ${stop.at} isn't ${stop.along} of ${leg.length}`);
		const list = stop.stage === 0 ? legs[stop.leg]?.stops : legs[stop.leg]?.extras;
		if (!list?.includes(index)) report('placement', `stop ${index} isn't listed on leg ${stop.leg} among its ${stop.stage === 0 ? 'stops' : 'extras'}`);
		if ((listed.get(index) ?? 0) > 1) report('placement', `stop ${index} is listed ${listed.get(index)} times`);
	});
	legs.forEach(({ stops: ids, extras }, leg) => {
		const all = [...ids, ...extras].sort((a, b) => a - b);
		all.forEach((id, place) => {
			if (stops[id]?.leg !== leg) report('placement', `leg ${leg} lists stop ${id}, which is on leg ${stops[id]?.leg}`);
			if (place > 0 && !(stops[id]?.along > stops[all[place - 1]]?.along)) report('placement', `leg ${leg}'s stops ${all[place - 1]} and ${id} aren't in driving order`);
		});
	});
}

function checkClearance({ network, layer, stops, tuning, report }: { network: RoadNetwork; layer: PoiLayer; stops: StopLayer; tuning: StopTuning; report: (rule: StopRule, detail: string) => void }): void {
	const degrees = nodeDegrees(network);
	const { clearance } = tuning;
	const slack = 1e-9;
	layer.legs.forEach((leg, id) => {
		const ids = [...(stops.legs[id]?.stops ?? []), ...(stops.legs[id]?.extras ?? [])];
		if (ids.length === 0) return;
		const ends = legEnds(leg.length, tuning);
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

/** Every stop's type along a route, in the order a run meets them: from game stage 0, or with every dormant extra on. */
export function typesAlong({ stops, legs }: StopLayer, route: Route, { extras = false }: { extras?: boolean } = {}): StopType[] {
	const types: StopType[] = [];
	for (const leg of route.legs) {
		const profile = legs[leg];
		if (!profile) continue;
		const ids = extras ? [...profile.stops, ...profile.extras].sort((a, b) => a - b) : profile.stops;
		for (const id of ids) types.push(stops[id].type);
	}
	return types;
}

/** Whether a failing stops attempt may be kept past the cap: never with a route under its fight floor. */
export function keepableStops(problems: readonly string[]): boolean {
	return !problems.some((problem) => problem.startsWith('floor: '));
}
