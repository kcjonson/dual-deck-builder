import { JsonObject, JsonValue, describeValue, freezeJson, readObject } from './JsonReader';

/**
 * Stand-in for the area map's resolved parameters until `MapParams`
 * (DDB-287, `src/renderer/game/map/MapParams.ts`) is on main: a JSON object
 * holding at least the seed. The real type is flat JSON with the seed in
 * it, so params saved against this stand-in read the same once it's swapped.
 */
export interface MapParams {
	readonly seed: number;
	readonly [name: string]: JsonValue;
}

/**
 * Stand-in for the area map's saved state until its types exist (DDB-275):
 * the gameplay map and what's changed on it since (Area Map Generation,
 * Saving). Opaque JSON for now.
 */
export type MapState = JsonObject;

export const EMPTY_MAP: MapState = Object.freeze({});

/** The params as a frozen copy: a JSON object with a number for a seed. */
export function readMapParams(value: unknown, path: string): MapParams {
	const params = readObject(freezeJson(value, path), path);
	if (typeof params.seed !== 'number') throw new TypeError(`${path}.seed must be a number, got ${describeValue(params.seed)}`);
	return params as MapParams;
}

/** The map state as a frozen copy: any JSON object. */
export function readMapState(value: unknown, path: string): MapState {
	return readObject(freezeJson(value, path), path) as MapState;
}
