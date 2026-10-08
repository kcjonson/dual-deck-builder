import { ENVIRONMENTS, Environment, MAP_PARAMETERS, MapParams, NUMBER_PARAMS, StopTables, environmentDefaults } from '../map/MapParams';
import { describeClamp, validateMapParams } from '../map/ParamValidator';
import { describeValue, freezeJson, readFields, readInteger, readNumber, readObject, readOneOf } from './JsonReader';

const UINT32_MAX = 0xffffffff;

/** Every key a params object can hold. */
const PARAM_KEYS: readonly string[] = ['seed', 'environment', ...NUMBER_PARAMS, 'stopTables'];

/** Params `readMapParams` made: checked, frozen, and in order, so they can't have changed since. */
const checkedParams = new WeakSet<object>();

/**
 * A campaign's map params, the resolved parameters its map was made from
 * (Area Map Generation, Saving): every parameter there with the right type,
 * a uint32 seed, a known environment, and nothing extra. Ranges and the
 * validator's combination rules aren't checked here: founding validates
 * params before it makes a map, and a campaign keeps the values its map was
 * made with even after the table's ranges move (see `repairMapParams`).
 * They come back frozen with their keys in the table's order, so the same
 * params always write the same JSON.
 */
export function readMapParams(value: unknown, path: string): Readonly<MapParams> {
	if (typeof value === 'object' && value !== null && checkedParams.has(value)) return value as Readonly<MapParams>;
	const fields = readFields(value, path, ['seed', 'environment', ...NUMBER_PARAMS], ['stopTables']);
	const params = {
		seed: readInteger(fields.seed, `${path}.seed`, { min: 0, max: UINT32_MAX }),
		environment: readOneOf(fields.environment, `${path}.environment`, ENVIRONMENTS)
	} as MapParams;
	for (const name of NUMBER_PARAMS) params[name] = readNumber(fields[name], `${path}.${name}`);
	if (fields.stopTables !== undefined) params.stopTables = readStopTables(fields.stopTables, `${path}.stopTables`);
	const frozen = Object.freeze(params);
	checkedParams.add(frozen);
	return frozen;
}

export interface RepairedMapParams {
	params: MapParams;
	/** One line per repair, naming the parameter; empty when the saved params needed none. */
	warnings: string[];
}

/**
 * A save's map params, repaired where the parameter table has moved on
 * since the save was written, as it will while the Map Lab settles it.
 *
 * Corruption still throws: params that aren't an object, a seed that isn't
 * a uint32, or a parameter with the wrong JSON type. Drift is repaired, each
 * repair a warning: a missing environment, or one that no longer exists,
 * becomes Mixed; a missing parameter takes its environment's default; an
 * unknown one is dropped.
 *
 * Values are kept as saved, even where today's validator would clamp them
 * for a new map, with a warning each. The map was made with those values,
 * and terrain and scenery are regenerated from them on load around the
 * saved roads, so a clamped radius or mountain coverage would draw ground
 * that no longer fits them.
 */
export function repairMapParams(value: unknown, path: string): RepairedMapParams {
	const saved = readObject(value, path);
	const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(saved, key);
	const warnings: string[] = [];
	if (!has('seed')) throw new TypeError(`${path}.seed is missing`);
	const params = { seed: readInteger(saved.seed, `${path}.seed`, { min: 0, max: UINT32_MAX }) } as MapParams;

	const fallback = MAP_PARAMETERS.environment.default;
	if (!has('environment')) {
		params.environment = fallback;
		warnings.push(`${path}.environment was missing; took ${fallback}`);
	} else if (typeof saved.environment !== 'string') {
		throw new TypeError(`${path}.environment must be a string, got ${describeValue(saved.environment)}`);
	} else if ((ENVIRONMENTS as readonly string[]).includes(saved.environment)) {
		params.environment = saved.environment as Environment;
	} else {
		params.environment = fallback;
		warnings.push(`${path}.environment ${describeValue(saved.environment)} isn't an environment; took ${fallback}`);
	}

	const defaults = environmentDefaults(params.environment);
	for (const name of NUMBER_PARAMS) {
		if (has(name)) {
			params[name] = readNumber(saved[name], `${path}.${name}`);
		} else {
			params[name] = defaults[name];
			warnings.push(`${path}.${name} was missing; took ${defaults[name]}, the ${params.environment} default`);
		}
	}
	if (has('stopTables')) params.stopTables = readStopTables(saved.stopTables, `${path}.stopTables`);
	for (const key of Object.keys(saved)) {
		if (!PARAM_KEYS.includes(key)) warnings.push(`${path}.${key} isn't a map parameter; dropped it`);
	}

	for (const clamp of validateMapParams(params).clamps) {
		warnings.push(`${path}.${describeClamp(clamp)} for a new map; this one keeps the ${clamp.from} it was made with`);
	}
	return { params, warnings };
}

function readStopTables(value: unknown, path: string): StopTables {
	return readObject(freezeJson(value, path), path) as StopTables;
}
