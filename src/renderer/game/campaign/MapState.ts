import type { JsonObject } from '../core/Json';
import { freezeJson, readObject } from '../core/JsonReader';

/**
 * Stand-in for the area map's saved state until its types exist (DDB-275):
 * the gameplay map and what's changed on it since (Area Map Generation,
 * Saving). Opaque JSON for now, frozen all the way down.
 *
 * Once the generator makes maps, this also holds the map attempt and every
 * stage's winning attempt, which the pipeline returns. A load redraws the
 * land and the dressing from their streams, and streams nest: each stage's
 * forks from the winning stream of the stage before it, so the dressing's
 * hangs from every attempt above it (map-pipeline-worker.md).
 */
export type MapState = Readonly<JsonObject>;

export const EMPTY_MAP: MapState = Object.freeze({});

/** The map state as a frozen copy: any JSON object. */
export function readMapState(value: unknown, path: string): MapState {
	return readObject(freezeJson(value, path), path) as MapState;
}
