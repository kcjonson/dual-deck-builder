import type { JsonObject } from '../core/Json';
import { ReaderRangeError, freezeJson, readFields, readInteger, readObject, readValueAt } from '../core/JsonReader';

/**
 * What's changed on the area map since it was made (Area Map Generation,
 * What changes after generation, and Saving): stop state, POI stock, fog.
 * Opaque JSON until those exist, frozen all the way down. The map itself
 * isn't saved yet: a load makes it again from the seed, the params, and the
 * campaign's `MapAttempts`, until saves keep its lines (DDB-436).
 */
export type MapState = Readonly<JsonObject>;

/**
 * Where a campaign's map sits among its seed's attempts: the map attempt,
 * and each stage's winning attempt by stage name. Streams nest, each stage's
 * forking from the winning stream of the stage before it, so every one of
 * them is needed; with the seed and the params, they make the map again
 * (map-pipeline-worker.md, What a save needs from it). Fixed at founding.
 */
export interface MapAttempts {
	readonly map: number;
	readonly stages: Readonly<Record<string, number>>;
}

/** Stage names as the pipeline writes them: `terrain`, `routeTree`. */
const STAGE_NAME = /^[a-z][A-Za-z0-9]*$/;
const UINT32_MAX = 0xffffffff;

/** Map attempts the reader made: checked and frozen, so they can't have changed since. */
const checkedAttempts = new WeakSet<object>();

export const EMPTY_MAP: MapState = Object.freeze({});

/**
 * Map attempts as a frozen copy, or null for a campaign built without
 * generating a map, as tests build them, which has none to make again. Any
 * stage names read here; making the map again checks them against the
 * pipeline, which knows its own.
 */
export function readMapAttempts(value: unknown, path: string): Readonly<MapAttempts> | null {
	if (value === null) return null;
	if (typeof value === 'object' && checkedAttempts.has(value)) return value as MapAttempts;
	const fields = readFields(value, path, ['map', 'stages']);
	const map = readInteger(readValueAt(fields, 'map', `${path}.map`), `${path}.map`, { min: 0, max: UINT32_MAX });
	const given = readObject(readValueAt(fields, 'stages', `${path}.stages`), `${path}.stages`);
	const names = Object.keys(given);
	if (names.length === 0) throw new ReaderRangeError(`${path}.stages must hold every stage's attempt, got none`);
	const stages: Record<string, number> = {};
	for (const name of names) {
		if (!STAGE_NAME.test(name)) throw new ReaderRangeError(`${path}.stages has ${JSON.stringify(name)}, which isn't a stage name`);
		const at = `${path}.stages.${name}`;
		stages[name] = readInteger(readValueAt(given, name, at), at, { min: 0, max: UINT32_MAX });
	}
	const attempts: MapAttempts = Object.freeze({ map, stages: Object.freeze(stages) });
	checkedAttempts.add(attempts);
	return attempts;
}

/** The map state as a frozen copy: any JSON object. */
export function readMapState(value: unknown, path: string): MapState {
	return readObject(freezeJson(value, path), path) as MapState;
}
