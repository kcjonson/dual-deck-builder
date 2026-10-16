import type { JsonObject } from '../core/Json';
import { ReaderRangeError, readArray, readFields, readInteger } from '../core/JsonReader';
import type { PoiState } from '../map/PoiData';
import type { MapState } from './MapState';
import { RouteYield, YIELD_RESOURCES } from './SupplyRoutes';

/**
 * What's left at each POI (Compound and Supply Runs, POIs): a POI holds
 * `POI_SHARES` runs' worth, each run that reaches it takes one, and the
 * shares come back over `POI_REFILL_DAYS` nights from the last run, evenly,
 * so a POI picked clean is full again that many nights later. It's the map
 * state's `pois`, one entry for each POI that isn't full, in POI order; a
 * POI with none is full. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/poi-depletion.md.
 */

/** Runs a full POI holds: the third leaves it depleted. */
export const POI_SHARES = 3;

/** Nights a depleted POI takes to fill up again, a share coming back every third of them. */
export const POI_REFILL_DAYS = 20;

/** A POI that isn't full: its shares after the last run took one, and the nights since. */
export interface PoiStock {
	/** Its index in the map's POI layer. */
	readonly poi: number;
	/** Shares the last run left, 0 to `POI_SHARES - 1`. */
	readonly left: number;
	/** Nights since that run, short of the night it'd be full. */
	readonly nights: number;
}

/**
 * The map state's POI stock, read strictly: each POI once, in order, its
 * shares short of full, and its nights short of the night it fills up,
 * when it'd have been dropped.
 */
export function readPoiStocks(value: unknown, path: string): readonly PoiStock[] {
	let previous = -1;
	return readArray(value, path).map((entry, index): PoiStock => {
		const at = `${path}[${index}]`;
		const fields = readFields(entry, at, ['poi', 'left', 'nights']);
		const poi = readInteger(fields.poi, `${at}.poi`, { min: 0 });
		if (poi <= previous) throw new ReaderRangeError(`${at}.poi must come after the entry above it (${previous}), got ${poi}`);
		previous = poi;
		const left = readInteger(fields.left, `${at}.left`, { min: 0, max: POI_SHARES - 1 });
		const nights = readInteger(fields.nights, `${at}.nights`, { min: 0, max: nightsToFill(left) - 1 });
		return { poi, left, nights };
	});
}

/** The POIs that aren't full, in POI order. The map state has been read (`readMapState`), so its `pois` are well formed. */
export function poiStocks(map: MapState): readonly PoiStock[] {
	return (map.pois ?? []) as unknown as readonly PoiStock[];
}

/** Shares a POI holds now, `POI_SHARES` when it's full. */
export function sharesLeft({ map, poi }: { map: MapState; poi: number }): number {
	const stock = poiStocks(map).find((entry) => entry.poi === poi);
	return stock ? sharesOf(stock) : POI_SHARES;
}

/** Unvisited when full, depleted with nothing left, looted between. */
export function poiState(shares: number): PoiState {
	if (shares >= POI_SHARES) return 'unvisited';
	return shares <= 0 ? 'depleted' : 'looted';
}

/**
 * Nights until a POI has a share more, or null when it's full: a share
 * comes back on each night the refill passes another third of
 * `POI_REFILL_DAYS` since the last run.
 */
export function nightsToNextShare({ map, poi }: { map: MapState; poi: number }): number | null {
	const stock = poiStocks(map).find((entry) => entry.poi === poi);
	if (!stock) return null;
	const back = Math.floor((stock.nights * POI_SHARES) / POI_REFILL_DAYS) + 1;
	return Math.ceil((back * POI_REFILL_DAYS) / POI_SHARES) - stock.nights;
}

/**
 * A run reached the POI and took a share: what's left now, less one, and
 * the refill starting over from tonight. A depleted POI has nothing to take
 * and is left as it was.
 */
export function takeShare({ map, poi }: { map: MapState; poi: number }): MapState {
	const shares = sharesLeft({ map, poi });
	if (shares <= 0) return map;
	const others = poiStocks(map).filter((entry) => entry.poi !== poi);
	return withStocks(map, [...others, { poi, left: shares - 1, nights: 0 }].sort((a, b) => a.poi - b.poi));
}

/** Overnight (the day end's `poiRefills`): a night more on every POI that isn't full, and the ones full again dropped. */
export function refillPois(map: MapState): MapState {
	const stocks = poiStocks(map);
	if (stocks.length === 0) return map;
	return withStocks(map, stocks
		.map((stock) => ({ ...stock, nights: stock.nights + 1 }))
		.filter((stock) => sharesOf(stock) < POI_SHARES));
}

/** A yield with `shares` of `POI_SHARES` left: each resource scaled, rounded up, so a POI with anything left gives some of everything it yields. */
export function scaledYield({ yields, shares }: { yields: RouteYield; shares: number }): RouteYield {
	if (shares >= POI_SHARES) return yields;
	const kept = Math.max(0, shares);
	return Object.freeze(Object.fromEntries(YIELD_RESOURCES.map((resource) => [resource, Math.ceil((yields[resource] * kept) / POI_SHARES)])) as Record<keyof RouteYield, number>);
}

function sharesOf({ left, nights }: PoiStock): number {
	return Math.min(POI_SHARES, left + Math.floor((nights * POI_SHARES) / POI_REFILL_DAYS));
}

/** Nights from a run that left `left` shares until the POI is full: 20 from depleted. */
function nightsToFill(left: number): number {
	return Math.ceil(((POI_SHARES - left) * POI_REFILL_DAYS) / POI_SHARES);
}

/** The map state with these stocks, `pois` left out when every POI is full, so a map back to full reads as one never touched. */
function withStocks(map: MapState, stocks: readonly PoiStock[]): MapState {
	const rest: JsonObject = Object.fromEntries(Object.entries(map).filter(([key]) => key !== 'pois'));
	return stocks.length === 0 ? rest : { ...rest, pois: stocks.map((stock) => ({ ...stock })) };
}
