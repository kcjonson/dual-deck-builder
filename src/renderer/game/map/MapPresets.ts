import defaultPreset from '../data/mapPresets/default.json';
import { ENVIRONMENTS, Environment, MapParamSet, NUMBER_PARAMS } from './MapParams';

/**
 * Parameter sets kept as JSON in `data/mapPresets/` (Area Map Generation,
 * The Map Lab). A preset is a `MapParamSet`: the seed, the environment, and
 * only the values that override the environment, so whatever it leaves out
 * follows the environment's defaults. A complete `MapParams` is a preset too.
 */
export interface MapPreset {
	/** The file's name, without `.json`. */
	readonly name: string;
	readonly params: MapParamSet;
}

const PRESET_KEYS = new Set<string>(['seed', 'environment', ...NUMBER_PARAMS, 'stopTables']);

/**
 * A preset from its parsed JSON. Throws on anything that isn't a parameter
 * set, unknown keys included, so a misspelt parameter can't be silently
 * dropped. Values outside their ranges are kept: the validator clamps and
 * reports them.
 */
export function readMapPreset(json: unknown): MapParamSet {
	if (!isObject(json)) throw new Error('Invalid map preset: expected a JSON object');
	const problems: string[] = [];
	for (const key of Object.keys(json)) {
		if (!PRESET_KEYS.has(key)) problems.push(`unknown parameter "${key}"`);
	}
	if (typeof json.seed !== 'number') problems.push('seed must be a number');
	if (json.environment !== undefined && !ENVIRONMENTS.includes(json.environment as Environment)) {
		problems.push(`environment must be one of ${ENVIRONMENTS.join(', ')}`);
	}
	for (const name of NUMBER_PARAMS) {
		if (json[name] !== undefined && typeof json[name] !== 'number') problems.push(`${name} must be a number`);
	}
	if (json.stopTables !== undefined && !isObject(json.stopTables)) problems.push('stopTables must be an object');
	if (problems.length > 0) throw new Error(`Invalid map preset: ${problems.join('; ')}`);
	return ordered(json as MapParamSet);
}

/** A preset from its JSON text. */
export function parseMapPreset(text: string): MapParamSet {
	return readMapPreset(JSON.parse(text));
}

/** A parameter set as preset JSON: seed, environment, then the table's order, tab-indented. */
export function serializeMapPreset(set: MapParamSet): string {
	return `${JSON.stringify(ordered(set), null, '\t')}\n`;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The set's keys in the order a preset file lists them, absent ones left out. */
function ordered(set: MapParamSet): MapParamSet {
	const copy: MapParamSet = { seed: set.seed };
	if (set.environment !== undefined) copy.environment = set.environment;
	for (const name of NUMBER_PARAMS) {
		const value = set[name];
		if (value !== undefined) copy[name] = value;
	}
	if (set.stopTables !== undefined) copy.stopTables = set.stopTables;
	return copy;
}

/** The presets in the repo. A file added there is listed here too; a test holds the two together. */
export const MAP_PRESETS: readonly MapPreset[] = [
	{ name: 'default', params: readMapPreset(defaultPreset) },
];
