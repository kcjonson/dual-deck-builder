import type { JsonObject } from '../core/Json';
import { freezeJson, readObject } from './JsonReader';

/**
 * Stand-in for the area map's saved state until its types exist (DDB-275):
 * the gameplay map and what's changed on it since (Area Map Generation,
 * Saving). Opaque JSON for now, frozen all the way down.
 */
export type MapState = Readonly<JsonObject>;

export const EMPTY_MAP: MapState = Object.freeze({});

/** The map state as a frozen copy: any JSON object. */
export function readMapState(value: unknown, path: string): MapState {
	return readObject(freezeJson(value, path), path) as MapState;
}
