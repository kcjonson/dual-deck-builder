import { copyJson, describeValue } from '../core/Json';
import defaultPreset from '../data/mapPresets/default.json';
import { ENVIRONMENTS, Environment, MAP_PARAM_KEYS, MapParamSet, NUMBER_PARAMS, StopTables } from './MapParams';

/**
 * Parameter sets kept as JSON in `data/mapPresets/` (Area Map Generation,
 * The Map Lab). A preset is a `MapParamSet`: the seed, the environment, and
 * only the values that override the environment, so whatever it leaves out
 * follows the environment's defaults. A complete `MapParams` is a preset too.
 */
export interface MapPreset {
	/** The file's name, without `.json`. */
	readonly name: string;
	readonly params: Readonly<MapParamSet>;
}

/**
 * A preset from its parsed JSON, sharing nothing with it. Throws on anything
 * that isn't a parameter set, naming every problem at once: unknown keys
 * included, so a misspelt parameter can't be silently dropped, and anything
 * JSON can't write back the same, such as the Infinity that `1e999` parses
 * to or a Date in the stop tables. Values outside their ranges are kept: the
 * validator clamps and reports them.
 *
 * Presets are written by hand or by the Map Lab, so an unknown key is a
 * mistake to fix. Campaign saves don't load through here: their params are
 * repaired on load (`repairMapParams`), which drops an unknown key with a
 * warning, since the table will lose parameters while it settles.
 */
export function readMapPreset(json: unknown): MapParamSet {
	if (!isObject(json)) throw new Error(`Invalid map preset: expected a JSON object, got ${describeValue(json)}`);
	const problems: string[] = [];
	for (const key of Object.keys(json)) {
		if (!(MAP_PARAM_KEYS as readonly string[]).includes(key)) problems.push(`unknown parameter "${key}"`);
	}
	if (json.seed === undefined) problems.push('seed is missing');
	else checkNumber(json.seed, 'seed', problems);
	if (json.environment !== undefined && !ENVIRONMENTS.includes(json.environment as Environment)) {
		problems.push(`environment must be one of ${ENVIRONMENTS.join(', ')}, got ${describeValue(json.environment)}`);
	}
	for (const name of NUMBER_PARAMS) {
		if (json[name] !== undefined) checkNumber(json[name], name, problems);
	}
	let stopTables: StopTables | undefined;
	if (json.stopTables !== undefined) {
		if (isObject(json.stopTables)) stopTables = copyJson(json.stopTables, 'stopTables', problems) as StopTables;
		else problems.push(`stopTables must be an object, got ${describeValue(json.stopTables)}`);
	}
	if (problems.length > 0) throw new Error(`Invalid map preset: ${problems.join('; ')}`);
	const set = ordered(json as MapParamSet);
	if (stopTables !== undefined) set.stopTables = stopTables;
	return set;
}

/** A preset from its JSON text, with or without a byte order mark. */
export function parseMapPreset(text: string): MapParamSet {
	let json: unknown;
	try {
		json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	} catch (error) {
		throw new SyntaxError(`Invalid map preset: ${(error as Error).message}`);
	}
	return readMapPreset(json);
}

/**
 * A parameter set as preset JSON: seed, environment, then the table's order,
 * tab-indented. Throws on a set `readMapPreset` would refuse, so what it
 * writes reads back the same, and NaN or Infinity is never written as null.
 */
export function serializeMapPreset(set: MapParamSet): string {
	return `${JSON.stringify(readMapPreset(set), null, '\t')}\n`;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pushes what's wrong with a preset's number, if anything: another type, or NaN or Infinity. */
function checkNumber(value: unknown, name: string, problems: string[]): void {
	if (typeof value !== 'number') problems.push(`${name} must be a number, got ${describeValue(value)}`);
	else if (!Number.isFinite(value)) problems.push(`${name} must be a finite number, got ${describeValue(value)}`);
}

/** The set's keys in the order a preset file lists them, absent ones left out. */
function ordered(set: MapParamSet): MapParamSet {
	const copy: Record<string, unknown> = {};
	for (const key of MAP_PARAM_KEYS) {
		if (set[key] !== undefined) copy[key] = set[key];
	}
	return copy as MapParamSet;
}

/** `value` and everything in it frozen. */
function freezeDeep<Value>(value: Value): Value {
	if (typeof value === 'object' && value !== null) {
		for (const item of Object.values(value)) freezeDeep(item);
		Object.freeze(value);
	}
	return value;
}

/**
 * The presets in the repo, frozen through. A file added there is listed here
 * too; a test holds the two together. `readMapPreset(preset.params)` gives an
 * editable copy: a preset's params assign to a `MapParamSet`, but writing to
 * them throws.
 */
export const MAP_PRESETS: readonly MapPreset[] = freezeDeep([
	{ name: 'default', params: readMapPreset(defaultPreset) },
]);
