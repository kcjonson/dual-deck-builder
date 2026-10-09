import { describeValue } from '../core/Json';
import { ReaderTypeError, freezeJson, readFields, readNumber, readObject, readOneOf, readSeed, readValueAt } from '../core/JsonReader';
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

type ParamKey = keyof MapParams;

interface ParamFields {
	readonly required: readonly ParamKey[];
	readonly optional: readonly ParamKey[];
}

function paramFields(required: readonly ParamKey[]): ParamFields {
	return { required, optional: MAP_PARAM_KEYS.filter(key => !required.includes(key)) };
}

/** A parameter set needs only its seed. */
const SET_FIELDS = paramFields(['seed']);
/** Params whole need every parameter; stop tables are absent when they're the shipped ones. */
const PARAMS_FIELDS = paramFields(MAP_PARAM_KEYS.filter(key => key !== 'stopTables'));

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
	const frozen = Object.freeze(readParams(value, path, PARAMS_FIELDS) as MapParams);
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
	return readParams(value, path, SET_FIELDS);
}

/**
 * Params with the required fields present, read in table order, each read
 * once (`readValueAt`), so a getter can neither throw past its path nor
 * answer differently the second time. A required field that's undefined is
 * refused as a value; an optional one is left out.
 */
function readParams(value: unknown, path: string, { required, optional }: ParamFields): MapParamSet {
	const fields = readFields(value, path, required, optional);
	const read = <Value>(key: ParamKey, reader: (field: unknown, at: string) => Value): Value | undefined => {
		const at = `${path}.${key}`;
		const field = readValueAt(fields, key, at);
		return field === undefined && !required.includes(key) ? undefined : reader(field, at);
	};
	const set: MapParamSet = { seed: readSeed(readValueAt(fields, 'seed', `${path}.seed`), `${path}.seed`) };
	const environment = read('environment', (field, at) => readOneOf(field, at, ENVIRONMENTS));
	if (environment !== undefined) set.environment = environment;
	for (const name of NUMBER_PARAMS) {
		const number = read(name, readNumber);
		if (number !== undefined) set[name] = number;
	}
	const stopTables = read('stopTables', readStopTables);
	if (stopTables !== undefined) set.stopTables = stopTables;
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
	const at = (key: string): unknown => readValueAt(saved, key, `${path}.${key}`);
	const warnings: string[] = [];
	if (!has('seed')) throw new ReaderTypeError(`${path}.seed is missing`);
	const params = { seed: readSeed(at('seed'), `${path}.seed`) } as MapParams;

	const fallback = MAP_PARAMETERS.environment.default;
	const environment = has('environment') ? at('environment') : undefined;
	if (!has('environment')) {
		params.environment = fallback;
		warnings.push(`${path}.environment was missing; took ${fallback}`);
	} else if (typeof environment !== 'string') {
		throw new ReaderTypeError(`${path}.environment must be a string, got ${describeValue(environment)}`);
	} else if ((ENVIRONMENTS as readonly string[]).includes(environment)) {
		params.environment = environment as Environment;
	} else {
		params.environment = fallback;
		warnings.push(`${path}.environment ${describeValue(environment)} isn't an environment; took ${fallback}`);
	}

	const defaults = environmentDefaults(params.environment);
	for (const name of NUMBER_PARAMS) params[name] = has(name) ? readNumber(at(name), `${path}.${name}`) : defaults[name];
	if (has('stopTables')) params.stopTables = readStopTables(at('stopTables'), `${path}.stopTables`);

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

/** An object first, so a NaN or a list for the tables says so, rather than what JSON makes of it. */
function readStopTables(value: unknown, path: string): StopTables {
	return freezeJson(readObject(value, path), path) as StopTables;
}
