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
 * (Area Map Generation, Saving), held exactly: every parameter there with
 * the right type, nothing extra, and nothing the validator would change.
 * Founding resolves and validates params before it builds a campaign, and a
 * save's params go through `repairMapParams` before they reach this. They
 * come back frozen with their keys in the table's order, so the same params
 * always write the same JSON.
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
	const { clamps } = validateMapParams(params);
	if (clamps.length > 0) {
		throw new RangeError(`${path} must be valid as they are, but the validator would change them: ${clamps.map(describeClamp).join('; ')}`);
	}
	const frozen = Object.freeze(params);
	checkedParams.add(frozen);
	return frozen;
}

/**
 * A save's map params made valid again, since the table gains and loses
 * parameters and moves ranges while the Map Lab settles it. Corruption
 * still throws: params that aren't an object, a seed that isn't a uint32, or
 * a parameter with the wrong JSON type. Drift is repaired and reported to
 * `onWarning`: a missing environment, or one that no longer exists, becomes
 * Mixed; a missing parameter takes its environment's default; an unknown one
 * is dropped; and a value out of range is clamped. The rest stays as saved.
 */
export function repairMapParams(value: unknown, path: string, onWarning: (warning: string) => void): MapParams {
	const saved = readObject(value, path);
	const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(saved, key);
	if (!has('seed')) throw new TypeError(`${path}.seed is missing`);
	const params = { seed: readInteger(saved.seed, `${path}.seed`, { min: 0, max: UINT32_MAX }) } as MapParams;

	const fallback = MAP_PARAMETERS.environment.default;
	if (!has('environment')) {
		params.environment = fallback;
		onWarning(`${path}.environment was missing; took ${fallback}`);
	} else if (typeof saved.environment !== 'string') {
		throw new TypeError(`${path}.environment must be a string, got ${describeValue(saved.environment)}`);
	} else if ((ENVIRONMENTS as readonly string[]).includes(saved.environment)) {
		params.environment = saved.environment as Environment;
	} else {
		params.environment = fallback;
		onWarning(`${path}.environment ${describeValue(saved.environment)} isn't an environment; took ${fallback}`);
	}

	const defaults = environmentDefaults(params.environment);
	for (const name of NUMBER_PARAMS) {
		if (has(name)) {
			params[name] = readNumber(saved[name], `${path}.${name}`);
		} else {
			params[name] = defaults[name];
			onWarning(`${path}.${name} was missing; took ${defaults[name]}, the ${params.environment} default`);
		}
	}
	if (has('stopTables')) params.stopTables = readStopTables(saved.stopTables, `${path}.stopTables`);
	for (const key of Object.keys(saved)) {
		if (!PARAM_KEYS.includes(key)) onWarning(`${path}.${key} isn't a map parameter; dropped it`);
	}

	const { params: valid, clamps } = validateMapParams(params);
	for (const clamp of clamps) onWarning(`${path}: ${describeClamp(clamp)}`);
	return valid;
}

function readStopTables(value: unknown, path: string): StopTables {
	return readObject(freezeJson(value, path), path) as StopTables;
}
