import { snapToStep } from '../../engine/ui/stepGrid';
import { Rng } from '../core/Rng';
import { MAP_PARAMETERS, MapParams, NUMBER_PARAMS, NumberParam, NumberParamSpec, ParamRange, environmentDefaults } from './MapParams';
import { ValidatedMapParams, validateMapParams } from './ParamValidator';

/**
 * The finished game's parameters for a seed (Area Map Generation,
 * Randomising for the finished game): the environment an even pick from its
 * campaign values, then each number drawn around that environment's value,
 * validated so generation can run on them with the same seed.
 *
 * Each parameter draws on its own fork of the seed's `params` stream, named
 * by its key, the environment included. A parameter's draw depends on the
 * seed, its key, its campaign range and step, and the value it centres on,
 * never on the other rows or their order, so adding, removing, reordering,
 * or retuning a parameter moves no other parameter's draw. What comes back
 * is less independent than the draws:
 *
 * - The validator raises `highways` to `strongholds` + 2, in about one roll
 *   in five, so retuning strongholds moves highways.
 * - Every number centres on the environment's value, so retuning an
 *   environment's value, or a table default it inherits, moves that
 *   parameter's rolls on that environment.
 * - The environment pick indexes `ENVIRONMENTS`, so adding, removing, or
 *   reordering an environment changes which one a seed picks, and with it
 *   every number.
 */
export function rollParams(seed: number): MapParams {
	return rollParamsWithClamps(seed).params;
}

/**
 * `rollParams` with what the validator changed, for the Map Lab's "Roll
 * campaign params" preview to list.
 */
export function rollParamsWithClamps(seed: number): ValidatedMapParams {
	const root = new Rng({ seed });
	const stream = root.fork('params');
	const environment = stream.fork('environment').pick(MAP_PARAMETERS.environment.campaign);
	const defaults = environmentDefaults(environment);
	const values = {} as Record<NumberParam, number>;
	for (const name of NUMBER_PARAMS) values[name] = rollAround(stream.fork(name), MAP_PARAMETERS[name], defaults[name]);
	return validateMapParams({ seed: root.seed, environment, ...values });
}

/** Where a parameter's roll can land. */
export interface RollBounds extends ParamRange {
	/** The value the roll centres on, held inside the campaign range. Half the draws fall either side of it. */
	readonly centre: number;
}

/** A roll around `value` (the environment's): half the campaign range either side of it, cut to the campaign range. */
export function rollBounds({ campaign }: NumberParamSpec, value: number): RollBounds {
	const centre = Math.min(campaign.max, Math.max(campaign.min, value));
	const reach = (campaign.max - campaign.min) / 2;
	return { min: Math.max(campaign.min, centre - reach), centre, max: Math.min(campaign.max, centre + reach) };
}

/**
 * A draw split at its centre: half the draws fall below it and half above,
 * whatever room each side has. Each half is a triangle, likeliest at the
 * centre and thinning to nothing at its bound, so a side with little room
 * packs its half close to the centre, and a centre on an end of the campaign
 * range puts half the draws exactly on that end. u1 + u2 - 1 is a triangle
 * on (-1, 1) peaking at 0, and each sign is stretched to its own side, in
 * plain arithmetic, the same in every engine. Snapped to the step, so a roll
 * reads like a slider value.
 */
function rollAround(stream: Rng, spec: NumberParamSpec, value: number): number {
	const { min, centre, max } = rollBounds(spec, value);
	const offset = stream.float() + stream.float() - 1;
	const drawn = offset < 0 ? centre + offset * (centre - min) : centre + offset * (max - centre);
	return snapToStep({ ...spec.campaign, step: spec.step }, drawn);
}
