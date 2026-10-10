import type { RouteYield } from '../../campaign/SupplyRoutes';
import { POI_TUNING, STRONGHOLD_TYPE } from '../../map/PoiData';
import type { KnownStop, RouteDescriptor } from '../../map/RouteDescriptors';
import { STOP_TUNING, StopType, isFight } from '../../map/StopData';
import { countOf } from '../main-menu/campaignText';
import { yieldText } from '../run/runText';
import type { PlannedPoi } from './planningMap';

/** What the area map and run route screens say about POIs and their routes (DDB-43, DDB-319). */

/** Why a stronghold's Plan a run here is off. */
export const STRONGHOLD_NOT_YET = 'Not yet. Taking a stronghold needs an assault, and none can be planned yet.';

/** Under the stops in order: the run treats every stop but a fight as a quiet stretch for now. */
export const QUIET_STOPS = 'Only fights stop the convoy for now; the rest pass as quiet stretches.';

/** "General store", "Stronghold". */
export function poiTypeText(type: string): string {
	if (type === STRONGHOLD_TYPE) return 'Stronghold';
	return POI_TUNING.types[type]?.label ?? type;
}

/** "General store, tier 1". */
export function poiKindText(poi: Pick<PlannedPoi, 'type' | 'tier'>): string {
	return `${poiTypeText(poi.type)}, tier ${poi.tier}`;
}

/** "Yields 6 food and 4 water.", or a stronghold's line. */
export function poiYieldText({ stronghold, yields }: { stronghold: boolean; yields: RouteYield | null }): string {
	if (stronghold || !yields) return 'Its stores go to whoever takes it.';
	return `Yields ${yieldText(yields)}.`;
}

/** Hours to a tenth: "5.2 h". */
export function hoursText(hours: number): string {
	return `${Math.round(hours * 10) / 10} h`;
}

/** "2 routes, the quickest 3.1 h out.", or "No routes." */
export function routesText(poi: Pick<PlannedPoi, 'routes'>): string {
	const [quickest] = poi.routes;
	if (!quickest) return 'No routes.';
	return `${countOf(poi.routes.length, 'route')}, the quickest ${hoursText(quickest.hours.out)} out.`;
}

/** "Home by dark on 2 of 3 routes.", or "No route gets home by dark." */
export function darkText(poi: Pick<PlannedPoi, 'routes'>): string {
	const home = poi.routes.filter(({ spare }) => spare >= 0).length;
	if (home === 0) return 'No route gets home by dark.';
	return `Home by dark on ${home} of ${poi.routes.length} route${poi.routes.length === 1 ? '' : 's'}.`;
}

/** A time of day from hours past midnight, to the minute: 17.5 is "17:30"; one past midnight is the next morning's, "01:15". */
export function clockText(hours: number): string {
	const minutes = Math.round(hours * 60);
	const hour = Math.floor(minutes / 60) % 24;
	const minute = minutes % 60;
	return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "Home by 17:30, 2.5 h before dark.", "Home by 21:40, 1.7 h after dark.", or "Home at dark, 20:00." */
export function homeByText({ back, spare, dark }: Pick<RouteDescriptor, 'back' | 'spare' | 'dark'>): string {
	const margin = Math.round(Math.abs(spare) * 10) / 10;
	if (margin === 0) return `Home at dark, ${clockText(dark)}.`;
	return `Home by ${clockText(back)}, ${margin} h ${spare > 0 ? 'before' : 'after'} dark.`;
}

/** The route card's mono line: "charted / 4 stops / 5.2 h out / fuel 4 / risk 2 of 3", the hours marked as estimates off charted road. */
export function routeDetail(route: Pick<RouteDescriptor, 'knowledge' | 'stops' | 'hours' | 'fuel' | 'risk' | 'estimated'>): string {
	const hours = `${route.estimated ? 'about ' : ''}${hoursText(route.hours.out)} out`;
	return [route.knowledge, countOf(route.stops.length, 'stop'), hours, `fuel ${route.fuel}`, `risk ${route.risk} of 3`].join(' / ');
}

const STOP_TAGS: Readonly<Record<StopType, string>> = {
	ambush: 'FIGHT',
	warband: 'WARBAND',
	checkpoint: 'CHECKPOINT',
	wreck: 'WRECK',
	distress: 'DISTRESS',
	garage: 'GARAGE',
	hazard: 'HAZARD',
	findDriver: 'FIND',
	findSettlers: 'FIND',
	findVehicle: 'FIND',
	findCards: 'FIND',
	findSupplies: 'FIND',
};

/** A stop's short tag, what kind of stop it is at a glance; "?" where its type isn't known. */
export function stopTag({ type }: Pick<KnownStop, 'type'>): string {
	return type === null ? '?' : STOP_TAGS[type];
}

/** "Raider ambush, 2 skulls", "Roadside garage", or "Unknown stop". */
export function stopText({ type, skulls }: Pick<KnownStop, 'type' | 'skulls'>): string {
	if (type === null) return 'Unknown stop';
	const label = STOP_TUNING.types[type].label;
	return isFight(type) ? `${label}, ${countOf(skulls, 'skull')}` : label;
}
