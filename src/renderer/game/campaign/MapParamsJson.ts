import { describeValue } from '../core/Json';
import { ReaderTypeError, freezeJson, readFields, readNumber, readObject, readOneOf, readSeed } from '../core/JsonReader';
import {
	ENVIRONMENTS,
	Environment,
	MAP_PARAMETERS,
	MAP_PARAM_KEYS,
	MapParamSet,
	MapParams,
	NUMBER_PARAMS,
	StopTables,
	environmentDefaults
} from '../map/MapParams';
import { describeClamp, validateMapParams } from '../map/ParamValidator';

/** The keys a parameter set may leave out: all but the seed. */
const SET_OPTIONAL_KEYS = MAP_PARAM_KEYS.filter((key): key is Exclude<keyof MapParams, 'seed'> => key !== 'seed');

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
		seed: readSeed(fields.seed, `${path}.seed`),
		environment: readOneOf(fields.environment, `${path}.environment`, ENVIRONMENTS)
	} as MapParams;
	for (const name of NUMBER_PARAMS) params[name] = readNumber(fields[name], `${path}.${name}`);
	if (fields.stopTables !== undefined) params.stopTables = readStopTables(fields.stopTables, `${path}.stopTables`);
	const frozen = Object.freeze(params);
	checkedParams.add(frozen);
	return frozen;
}

/**
 * A parameter set given in code, such as the Map Lab's, read as strictly as
 * a save: a plain object holding a uint32 seed and any of a known
 * environment, finite numbers for the parameters, and stop tables as an
 * object of JSON, each its own, and nothing else. Values outside their
 * ranges are kept for the validator to clamp. The set comes back with its
 * keys in `MAP_PARAM_KEYS` order, any left undefined dropped, and a frozen
 * copy of its stop tables.
 */
export function readMapParamSet(value: unknown, path: string): MapParamSet {
	const fields = readFields(value, path, ['seed'], SET_OPTIONAL_KEYS);
	const set: MapParamSet = { seed: readSeed(fields.seed, `${path}.seed`) };
	if (fields.environment !== undefined) set.environment = readOneOf(fields.environment, `${path}.environment`, ENVIRONMENTS);
	for (const name of NUMBER_PARAMS) {
		if (fields[name] !== undefined) set[name] = readNumber(fields[name], `${path}.${name}`);
	}
	if (fields.stopTables !== undefined) set.stopTables = readStopTables(fields.stopTables, `${path}.stopTables`);
	return set;
}

export interface RepairedMapParams {
	params: MapParams;
	/** One line per parameter repaired or kept outside today's ranges; empty when the saved params needed none. */
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
 * for a new map, with a warning that names the saved value, what a new map
 * would take, and why. The map was made with those values, and terrain and
 * dressing are regenerated from them on load around the saved roads, so a
 * clamped radius or mountain coverage would draw ground that no longer fits
 * them.
 */
export function repairMapParams(value: unknown, path: string): RepairedMapParams {
	const saved = readObject(value, path);
	const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(saved, key);
	const warnings: string[] = [];
	if (!has('seed')) throw new ReaderTypeError(`${path}.seed is missing`);
	const params = { seed: readSeed(saved.seed, `${path}.seed`) } as MapParams;

	const fallback = MAP_PARAMETERS.environment.default;
	if (!has('environment')) {
		params.environment = fallback;
		warnings.push(`${path}.environment was missing; took ${fallback}`);
	} else if (typeof saved.environment !== 'string') {
		throw new ReaderTypeError(`${path}.environment must be a string, got ${describeValue(saved.environment)}`);
	} else if ((ENVIRONMENTS as readonly string[]).includes(saved.environment)) {
		params.environment = saved.environment as Environment;
	} else {
		params.environment = fallback;
		warnings.push(`${path}.environment ${describeValue(saved.environment)} isn't an environment; took ${fallback}`);
	}

	const defaults = environmentDefaults(params.environment);
	for (const name of NUMBER_PARAMS) params[name] = has(name) ? readNumber(saved[name], `${path}.${name}`) : defaults[name];
	if (has('stopTables')) params.stopTables = readStopTables(saved.stopTables, `${path}.stopTables`);

	// One warning a parameter. A value can be clamped twice (into its range, then by a combination rule), so a
	// warning lists every clamp the Map Lab would show, in order.
	const validated = validateMapParams(params);
	for (const name of NUMBER_PARAMS) {
		const kept = params[name];
		const clamped = validated.params[name] !== kept;
		const clamps = validated.clamps.filter(clamp => clamp.param === name).map(describeClamp).join(', then ');
		if (!has(name)) {
			const note = clamped ? `, which a new map wouldn't keep: ${clamps}` : '';
			warnings.push(`${path}.${name} was missing; took ${kept}, the ${params.environment} default${note}`);
		} else if (clamped) {
			warnings.push(`${path}.${clamps} for a new map; this one keeps the ${kept} it was made with`);
		}
	}

	for (const key of Object.keys(saved)) {
		if (!(MAP_PARAM_KEYS as readonly string[]).includes(key)) warnings.push(`${path}.${key} isn't a map parameter; dropped it`);
	}
	return { params, warnings };
}

function readStopTables(value: unknown, path: string): StopTables {
	return readObject(freezeJson(value, path), path) as StopTables;
}
