import { copyJson } from '../core/Json';
import {
	ENVIRONMENTS,
	MAP_PARAMETERS,
	MapParamSet,
	MapParams,
	NUMBER_PARAMS,
	NumberParam,
	ParamSource,
	environmentDefaults,
	resolveMapParams,
} from './MapParams';

/** One value the validator changed, for the Map Lab's readout. */
export interface ParamClamp {
	readonly param: NumberParam | 'seed' | 'environment';
	readonly from: number | string;
	readonly to: number | string;
	/** Why, in a few words: "tuning range 3 to 9", "strongholds + 2". */
	readonly reason: string;
}

export interface ValidatedMapParams {
	readonly params: MapParams;
	/** In the order they were applied; empty when the params were already valid. */
	readonly clamps: readonly ParamClamp[];
}

/**
 * The parameter validator (Area Map Generation, Validation and retries),
 * which runs before generation. It wraps the seed to uint32 the way the PRNG
 * coerces it, so the map a seed makes doesn't change; replaces an unknown
 * environment with Mixed and a number that isn't one with the environment's
 * default; rounds whole-number parameters and clamps every value into its
 * tuning range; then clamps the combinations the generator can't honour.
 * Stop tables are copied through for the stops stage to check.
 */
export function validateMapParams(params: MapParams): ValidatedMapParams {
	const valid: MapParams = { ...params };
	if (params.stopTables !== undefined) valid.stopTables = copyJson(params.stopTables, 'stopTables');
	const clamps: ParamClamp[] = [];
	const change = <Name extends ParamClamp['param']>(param: Name, to: MapParams[Name], reason: string) => {
		clamps.push({ param, from: valid[param], to, reason });
		valid[param] = to;
	};

	const seed = valid.seed >>> 0;
	if (seed !== valid.seed) change('seed', seed, 'uint32');

	if (!ENVIRONMENTS.includes(valid.environment)) change('environment', MAP_PARAMETERS.environment.default, 'unknown environment');

	for (const name of NUMBER_PARAMS) {
		const { kind, tuning } = MAP_PARAMETERS[name];
		const value = valid[name];
		if (!Number.isFinite(value)) {
			change(name, environmentDefaults(valid.environment)[name], 'not a number');
			continue;
		}
		const whole = kind === 'int' ? Math.round(value) : value;
		const clamped = Math.min(tuning.max, Math.max(tuning.min, whole));
		if (clamped !== whole) change(name, clamped, `tuning range ${tuning.min} to ${tuning.max}`);
		else if (whole !== value) change(name, clamped, 'whole number');
	}

	// Strongholds are placed one per sector, each needing two approaches from
	// different branches (stage 5); two highways more than strongholds keeps a
	// sector without them rare. Raise highways, and when even the most can't
	// cover it, lower strongholds first (an open question in the spec).
	const highwaysMax = MAP_PARAMETERS.highways.tuning.max;
	if (valid.strongholds + 2 > highwaysMax) change('strongholds', highwaysMax - 2, 'highways max - 2');
	if (valid.highways < valid.strongholds + 2) change('highways', valid.strongholds + 2, 'strongholds + 2');

	// n departures at least s degrees from their neighbours only fit round the
	// metro while n * s is 360 or less.
	const separationMax = Math.floor(360 / valid.highways);
	if (valid.highwaySeparation > separationMax) change('highwaySeparation', separationMax, '360 / highways');

	return { params: valid, clamps };
}

/** Where a validated value came from: where it was set, or 'clamped' when the validator changed it. */
export type ValidatedParamSource = ParamSource | 'clamped';

export interface ValidatedParamSet extends ValidatedMapParams {
	/** Per number parameter, for the values in `params`. */
	readonly sources: Readonly<Record<NumberParam, ValidatedParamSource>>;
}

/**
 * A parameter set resolved and validated in one call, as the Map Lab shows
 * it: the params generation runs on, the clamps, and where each value came
 * from. A value the validator changed is 'clamped' whoever set it, so a
 * replaced override or a default a combination rule moved is never shown as
 * the set's own.
 *
 * The set's environment must be one: resolving throws a RangeError on a name
 * that isn't, where `validateMapParams` swaps it for Mixed. A set read with
 * `readMapPreset` always has a known one.
 */
export function validateMapParamSet(set: MapParamSet): ValidatedParamSet {
	const resolved = resolveMapParams(set);
	const { params, clamps } = validateMapParams(resolved.params);
	const sources: Record<NumberParam, ValidatedParamSource> = { ...resolved.sources };
	for (const { param } of clamps) {
		if (param !== 'seed' && param !== 'environment') sources[param] = 'clamped';
	}
	return { params, clamps, sources };
}

/** A clamp as the Map Lab's readout words it: "highways raised to 6 (strongholds + 2)", "seed wrapped to 5 (uint32)". */
export function describeClamp({ param, from, to, reason }: ParamClamp): string {
	const comparable = typeof from === 'number' && typeof to === 'number' && Number.isFinite(from);
	const verb = param === 'seed' ? 'wrapped' : comparable ? (to > from ? 'raised' : 'lowered') : 'set';
	return `${param} ${verb} to ${to} (${reason})`;
}
