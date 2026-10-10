import type { Campaign } from '../../campaign/Campaign';
import { AreaMapProgress, CampaignMaps } from '../../campaign/CampaignMaps';
import { destinationId } from '../../campaign/MapRoutes';
import { STRONGHOLD_TYPE } from '../../map/PoiData';
import type { RiverLines } from '../../map/Rivers';
import type { RoadNetwork } from '../../map/RoadNetwork';
import { RouteDescriptor, RouteMap, describeRoutes, poiNames } from '../../map/RouteDescriptors';
import { legPoints } from '../../map/RouteTree';
import { isFight } from '../../map/StopData';
import type { AreaMapData, MapMarker, MapRoute } from '../../ui/areaMap/layers';
import type { BakeTerrain } from '../../ui/areaMap/terrainBake';

/**
 * The campaign's area map as the area map and run route screens read it
 * (DDB-43, DDB-319), and the compound's Plan button: the routes and stops
 * the run loop takes (`routesOnOffer`), and the land and roads the view
 * draws. A generation (`getAreaMap`) holds all of it. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/area-map-route-pick.md.
 */

/** What the screens read of a generated map. */
export interface PlanningMap extends RouteMap {
	readonly products: RouteMap['products'] & {
		readonly water: { readonly terrain: BakeTerrain; readonly lines: RiverLines };
		readonly roads: { readonly network: RoadNetwork };
	};
}

export interface PlanningMapRequest {
	/** Told as each stage starts while the map is being made; never for a map already made. */
	onProgress?: (progress: AreaMapProgress) => void;
}

/** Where a campaign's map comes from: the session's map cache, or a test's stand-in. */
export interface PlanningMapSource {
	mapOf(campaign: Campaign, request?: PlanningMapRequest): Promise<PlanningMap>;
}

/**
 * The screens' way to a campaign's map. A map is made once a session
 * (`CampaignMaps`), but it comes back as a promise, so a screen mounted
 * after it was made still couldn't draw it, or enable a button for focus
 * to come back to, until a task later. So each campaign's map is kept here
 * once it has arrived, and `known` answers at mount. A campaign's map never
 * changes, so what's kept never goes stale; a campaign loaded again is
 * another instance, and waits once.
 */
export class PlanningMaps {
	/** The game's, over the session's map cache. */
	public static readonly shared = new PlanningMaps({ source: CampaignMaps.shared });

	private readonly source: PlanningMapSource;
	private readonly made = new WeakMap<Campaign, PlanningMap>();

	constructor({ source }: { source: PlanningMapSource }) {
		this.source = source;
	}

	/** The campaign's map if it has arrived, or null. */
	public known(campaign: Campaign): PlanningMap | null {
		return this.made.get(campaign) ?? null;
	}

	/** The campaign's map, made now if it hasn't been; rejects as the source does. */
	public async load(campaign: Campaign, request: PlanningMapRequest = {}): Promise<PlanningMap> {
		const known = this.made.get(campaign);
		if (known) return known;
		const map = await this.source.mapOf(campaign, request);
		this.made.set(campaign, map);
		return map;
	}
}

/** What the view draws of the map: the land with its water, the rivers, and the roads. */
export function viewData(map: PlanningMap): AreaMapData {
	const { water, roads } = map.products;
	return { terrain: water.terrain, network: roads.network, rivers: water.lines };
}

/** A POI as the planning screens show it. */
export interface PlannedPoi {
	/** Its index in the POI layer. */
	readonly poi: number;
	/** Its marker's id, and its routes' destination id: `poi-<poi>`. */
	readonly id: string;
	/** Its type and bearing until place names (`poiNames`). */
	readonly name: string;
	/** A key of the POI tuning's types, or `STRONGHOLD_TYPE`. */
	readonly type: string;
	readonly tier: number;
	readonly stronghold: boolean;
	readonly x: number;
	readonly y: number;
	/** Its routes, quickest first. */
	readonly routes: readonly RouteDescriptor[];
	/** No route gets a run there and home before dark (Racing the dark). */
	readonly pastDark: boolean;
}

const planned = new WeakMap<RouteMap, readonly PlannedPoi[]>();

/** Every POI on the map with its routes described, in the layer's order: strongholds first. Worked out once a map. */
export function plannedPois(map: RouteMap): readonly PlannedPoi[] {
	let pois = planned.get(map);
	if (!pois) {
		const layer = map.products.pois;
		const names = poiNames(layer);
		pois = Object.freeze(layer.pois.map(({ site, type, tier }, poi): PlannedPoi => {
			const routes = describeRoutes(map, poi);
			return Object.freeze({
				poi,
				id: destinationId(poi),
				name: names[poi],
				type,
				tier,
				stronghold: type === STRONGHOLD_TYPE,
				x: site.x,
				y: site.y,
				routes,
				pastDark: routes.every(({ spare }) => spare < 0),
			});
		}));
		planned.set(map, pois);
	}
	return pois;
}

/** The POIs nearest first: by tier, then by the quickest route's hours out, strongholds last. */
export function byDistance(pois: readonly PlannedPoi[]): PlannedPoi[] {
	const rank = (poi: PlannedPoi) => (poi.stronghold ? Infinity : poi.tier);
	const hours = (poi: PlannedPoi) => poi.routes[0]?.hours.out ?? Infinity;
	return [...pois].sort((a, b) => rank(a) - rank(b) || hours(a) - hours(b) || a.poi - b.poi);
}

/**
 * The map's markers: every POI with its tier as a badge, a night ring when
 * no route gets home by dark, and its name, the nearest placed first; the
 * strongholds with theirs, placed last.
 */
export function poiMarkers(pois: readonly PlannedPoi[]): MapMarker[] {
	const order = new Map(byDistance(pois).map((poi, index) => [poi, index]));
	return pois.map((poi) => ({
		id: poi.id,
		kind: poi.stronghold ? 'stronghold' : 'poi',
		x: poi.x,
		y: poi.y,
		label: poi.name,
		badge: poi.stronghold ? undefined : String(poi.tier),
		pastDark: !poi.stronghold && poi.pastDark,
		priority: order.get(poi) ?? 0,
	}));
}

/** A route's road from the compound out to its POI, world space, flat x0, y0, x1, y1, ... */
export function routePoints(map: PlanningMap, route: RouteDescriptor): number[] {
	const { network } = map.products.roads;
	const { legs } = map.products.pois;
	const points: number[] = [];
	for (const leg of route.legs) {
		const line = legPoints(network, legs[leg]);
		// Each leg starts where the one before it ended.
		for (let index = points.length === 0 ? 0 : 2; index < line.length; index += 1) points.push(line[index]);
	}
	return points;
}

/** A POI's routes for the view: each one's road, the picked one with its stops. */
export function mapRoutes(map: PlanningMap, routes: readonly RouteDescriptor[], picked: number): MapRoute[] {
	const { stops } = map.products.stops;
	return routes.map((route) => ({
		id: String(route.route),
		points: routePoints(map, route),
		picked: route.route === picked,
		stops: route.stops.map(({ id, type }) => ({ x: stops[id].x, y: stops[id].y, fight: type !== null && isFight(type) })),
	}));
}

/** The world rect round the compound, a POI, and its routes, which the run route screen frames (Area Map Generation, World space). */
export function routesBounds(map: PlanningMap, poi: PlannedPoi): { x: number; y: number; width: number; height: number } {
	let minX = Math.min(0, poi.x);
	let minY = Math.min(0, poi.y);
	let maxX = Math.max(0, poi.x);
	let maxY = Math.max(0, poi.y);
	for (const route of poi.routes) {
		const points = routePoints(map, route);
		for (let index = 0; index + 1 < points.length; index += 2) {
			minX = Math.min(minX, points[index]);
			maxX = Math.max(maxX, points[index]);
			minY = Math.min(minY, points[index + 1]);
			maxY = Math.max(maxY, points[index + 1]);
		}
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
