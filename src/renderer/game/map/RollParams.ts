import { Rng } from '../core/Rng';
import { MAP_PARAMETERS, MapParams, NUMBER_PARAMS, NumberParam, NumberParamSpec, environmentDefaults } from './MapParams';
import { validateMapParams } from './ParamValidator';

/**
 * The finished game's parameters for a seed (Area Map Generation,
 * Randomising for the finished game), drawn on the seed's `params` stream
 * with each parameter on its own fork of it, named by its key. A parameter's
 * roll depends on the seed, its name, its table row, and the environment,
 * never on the other rows or their order, so adding, removing, reordering,
 * or retuning a parameter moves no other parameter's roll. The environment
 * is an even pick from its campaign values, and each number rolls around
 * that environment's default. Validated before they're returned, so
 * generation can run on them with the same seed.
 */
export function rollParams(seed: number): MapParams {
	const root = new Rng({ seed });
	const stream = root.fork('params');
	const environment = stream.fork('environment').pick(MAP_PARAMETERS.environment.campaign);
	const defaults = environmentDefaults(environment);
	const values = {} as Record<NumberParam, number>;
	for (const name of NUMBER_PARAMS) values[name] = rollAround(stream.fork(name), MAP_PARAMETERS[name], defaults[name]);
	return validateMapParams({ seed: root.seed, environment, ...values }).params;
}

/**
 * A triangular draw inside the campaign range that peaks at `centre` and
 * reaches at most half the range either side of it, snapped to the step.
 * Two uniforms make the triangle in plain arithmetic, which every engine
 * computes the same.
 */
function rollAround(stream: Rng, { campaign, step }: NumberParamSpec, centre: number): number {
	const mode = Math.min(campaign.max, Math.max(campaign.min, centre));
	const reach = (campaign.max - campaign.min) / 2;
	const low = Math.max(campaign.min, mode - reach);
	const high = Math.min(campaign.max, mode + reach);
	const offset = stream.float() + stream.float() - 1;
	const value = offset < 0 ? mode + offset * (mode - low) : mode + offset * (high - mode);
	return Math.min(campaign.max, Math.max(campaign.min, snap(value, step)));
}

/** The nearest multiple of `step`, read back at the step's decimals so seven steps of 0.05 is 0.35, not 0.35000000000000003. */
function snap(value: number, step: number): number {
	const text = String(step);
	const point = text.indexOf('.');
	const decimals = point === -1 ? 0 : text.length - point - 1;
	return Number((Math.round(value / step) * step).toFixed(decimals));
}
