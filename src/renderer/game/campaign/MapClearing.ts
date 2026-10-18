import type { JsonObject, JsonValue } from '../core/Json';
import { ReaderRangeError, readArray, readFields, readInteger } from '../core/JsonReader';
import type { MapState } from './MapState';

/**
 * What runs have cleared on the area map (Runs and Encounters, Clearing):
 * each stop a run resolves is cleared for `STOP_COOLDOWN_DAYS`, then comes
 * back with its contents rerolled, and a POI a run reaches is cleared for
 * the rest of the campaign. Both are the map state's: `stops`, an entry for
 * each stop cleared now or rolled again since, in stop order, and
 * `clearedPois`, the POIs cleared, in order. A stop with no entry has never
 * been cleared, and rolls at 0. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/stop-clearing.md.
 */

/** Days a cleared stop stays cleared: one cleared on day 3 is back at the dawn of day 8. */
export const STOP_COOLDOWN_DAYS = 5;

/** A stop runs have cleared: still cleared since `cleared`, or back and rolled again, `cleared` null. */
export interface StopState {
	/** Its index in the map's stops. */
	readonly stop: number;
	/** How many times it's come back: what its contents roll at (`rollStop`). */
	readonly roll: number;
	/** The day a run cleared it, while it's still cleared. */
	readonly cleared: number | null;
}

/**
 * The map state's stop states, read strictly: each stop once, in order, and
 * no entry that says what no entry would (roll 0 and not cleared).
 */
export function readStopStates(value: unknown, path: string): readonly StopState[] {
	let previous = -1;
	return readArray(value, path).map((entry, index): StopState => {
		const at = `${path}[${index}]`;
		const fields = readFields(entry, at, ['stop', 'roll', 'cleared']);
		const stop = readInteger(fields.stop, `${at}.stop`, { min: 0 });
		if (stop <= previous) throw new ReaderRangeError(`${at}.stop must come after the entry above it (${previous}), got ${stop}`);
		previous = stop;
		const roll = readInteger(fields.roll, `${at}.roll`, { min: 0 });
		const cleared = fields.cleared === null ? null : readInteger(fields.cleared, `${at}.cleared`, { min: 1 });
		if (roll === 0 && cleared === null) throw new ReaderRangeError(`${at} is neither cleared nor rolled again, which is no entry at all`);
		return { stop, roll, cleared };
	});
}

/** The map state's cleared POIs, read strictly: each once, in order. */
export function readClearedPois(value: unknown, path: string): readonly number[] {
	let previous = -1;
	return readArray(value, path).map((entry, index) => {
		const poi = readInteger(entry, `${path}[${index}]`, { min: 0 });
		if (poi <= previous) throw new ReaderRangeError(`${path}[${index}] must come after the POI above it (${previous}), got ${poi}`);
		previous = poi;
		return poi;
	});
}

/** Every stop with a state, in stop order. The map state has been read (`readMapState`), so they're well formed. */
export function stopStates(map: MapState): readonly StopState[] {
	return (map.stops ?? []) as unknown as readonly StopState[];
}

/** A stop's state, roll 0 and not cleared when it has no entry. */
export function stopState({ map, stop }: { map: MapState; stop: number }): StopState {
	return stopStates(map).find((entry) => entry.stop === stop) ?? { stop, roll: 0, cleared: null };
}

/** Days until a cleared stop comes back, counted from `day`, or null when it isn't cleared. */
export function daysUntilBack({ map, stop, day }: { map: MapState; stop: number; day: number }): number | null {
	const { cleared } = stopState({ map, stop });
	return cleared === null ? null : Math.max(1, cleared + STOP_COOLDOWN_DAYS - day);
}

/** A run resolved the stop on `day`: it's cleared from then, at the roll it had. */
export function clearStop({ map, stop, day }: { map: MapState; stop: number; day: number }): MapState {
	const { roll } = stopState({ map, stop });
	const others = stopStates(map).filter((entry) => entry.stop !== stop);
	return withField(map, 'stops', [...others, { stop, roll, cleared: day }].sort((a, b) => a.stop - b.stop));
}

/**
 * Overnight (the day end's `stopCooldowns`), the night after `day`: every
 * stop whose cooldown is up by the next dawn comes back, its roll up one.
 */
export function stopCooldowns({ map, day }: { map: MapState; day: number }): MapState {
	const states = stopStates(map);
	if (!states.some(({ cleared }) => cleared !== null && day + 1 >= cleared + STOP_COOLDOWN_DAYS)) return map;
	return withField(map, 'stops', states.map((entry) => (
		entry.cleared !== null && day + 1 >= entry.cleared + STOP_COOLDOWN_DAYS ? { ...entry, roll: entry.roll + 1, cleared: null } : entry
	)));
}

/** The POIs runs have cleared, in order. */
export function clearedPois(map: MapState): readonly number[] {
	return (map.clearedPois ?? []) as unknown as readonly number[];
}

export function isPoiCleared({ map, poi }: { map: MapState; poi: number }): boolean {
	return clearedPois(map).includes(poi);
}

/** A run reached the POI: it's cleared for the rest of the campaign. */
export function clearPoi({ map, poi }: { map: MapState; poi: number }): MapState {
	if (isPoiCleared({ map, poi })) return map;
	return withField(map, 'clearedPois', [...clearedPois(map), poi].sort((a, b) => a - b));
}

/** The map state with `key` set to plain copies of `entries`, or left out when there are none, so an untouched map reads as `{}`. */
function withField(map: MapState, key: 'stops' | 'clearedPois', entries: readonly (StopState | number)[]): MapState {
	const rest: JsonObject = Object.fromEntries(Object.entries(map).filter(([field]) => field !== key));
	if (entries.length === 0) return rest;
	return { ...rest, [key]: entries.map((entry) => (typeof entry === 'number' ? entry : { ...entry })) as JsonValue[] };
}
