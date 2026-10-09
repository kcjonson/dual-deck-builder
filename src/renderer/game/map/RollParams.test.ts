import { Rng } from '../core/Rng';
import { ENVIRONMENTS, MAP_PARAMETERS, MapParams, NUMBER_PARAMS, NumberParam, environmentDefaults } from './MapParams';
import { ParamClamp } from './ParamValidator';
import { rollBounds, rollParams, rollParamsWithClamps } from './RollParams';
import { onGrid } from './testing';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** `rollParams` loaded fresh over a table whose number parameters are `names`, in that order. */
function rollParamsOver(names: readonly NumberParam[]): typeof rollParams {
	let isolated: typeof rollParams | null = null;
	jest.isolateModules(() => {
		const table = jest.requireActual('./MapParams') as typeof import('./MapParams');
		jest.doMock('./MapParams', () => ({ ...table, NUMBER_PARAMS: names }));
		isolated = (jest.requireActual('./RollParams') as typeof import('./RollParams')).rollParams;
	});
	jest.dontMock('./MapParams');
	if (!isolated) throw new Error('RollParams did not load');
	return isolated;
}

/** A thousand seeds spread over the uint32 range. */
const SEEDS = Array.from({ length: 1000 }, (_, index) => (index * 2654435761) >>> 0);

describe('rollParams', () => {
	let rolls: MapParams[];
	let clamps: (readonly ParamClamp[])[];
	const rollsOf = (environment: string) => rolls.filter((params) => params.environment === environment);

	beforeAll(() => {
		const rolled = SEEDS.map((seed) => rollParamsWithClamps(seed));
		rolls = rolled.map(({ params }) => params);
		clamps = rolled.map((roll) => roll.clamps);
	});

	it('rolls the same params for the same seed, with or without the clamps', () => {
		SEEDS.slice(0, 20).forEach((seed, index) => expect(rollParams(seed)).toEqual(rolls[index]));
	});

	// What a seed rolls is part of what the seed means, so it's pinned like the
	// PRNG's goldens, and retuning can move it on purpose: update it in the same
	// change. A parameter's campaign range or step, Floodlands' value for it, or
	// a table default Floodlands inherits (towns, say) moves that parameter;
	// strongholds moves highways too; a change to how snapToStep rounds can move
	// any value; and a change to the list of environments can move all of it.
	// Retuning a default terrain reads (mountain coverage, say) moves
	// Terrain.test's pinned samples as well, so re-pin those in the same change.
	// A renamed parameter draws on a fork of its new name, so it moves too.
	it('rolls the pinned params for the default preset\'s seed', () => {
		expect(rollParams(2183746551)).toEqual({
			seed: 2183746551, environment: 'floodlands',
			radius: 950, aridity: 0.9, mountainCoverage: 0.15, ruggedness: 0.15, rivers: 2, riverDensity: 0.55, riverMeander: 0.7,
			lakes: 4, contamination: 0.35, hotspots: 5, metroSize: 0.17, towns: 5, villages: 17,
			highways: 6, highwaySeparation: 33, roadDensity: 0.65, loops: 0.45, curviness: 0.45, trailShare: 0.4, brokenHighways: 2,
			strongholds: 4, poiDensity: 0.9, routesTarget: 3, routeSplit: 0.5, startingReveal: 1, stopDensity: 0.9, dangerCurve: 1.1,
			driverFinds: 2, daylightHours: 14, travelPace: 1,
			dressing: 0.55, streetGrids: 0.8, railLines: 1,
		});
	});

	it('keeps the seed for generation to run on', () => {
		expect(rolls.map(({ seed }) => seed)).toEqual(SEEDS);
	});

	it('picks the environment on its own fork of the seed\'s params stream', () => {
		SEEDS.slice(0, 100).forEach((seed, index) => {
			const stream = new Rng({ seed }).fork('params').fork('environment');
			expect(rolls[index].environment).toBe(stream.pick(MAP_PARAMETERS.environment.campaign));
		});
	});

	// Each parameter draws on its own fork, named by its key, so a draw never
	// depends on the table's shape: the Map Lab can add, drop, reorder, and
	// retune parameters without moving any other parameter's draw. What
	// rollParams returns has three couplings, which these leave out: the
	// validator raises highways to strongholds + 2, every number centres on the
	// environment's value, and the environment pick indexes ENVIRONMENTS.
	describe('draws each parameter independently of the others', () => {
		const sample = SEEDS.slice(0, 10);

		it('rolls the same params whatever order the table lists them in', () => {
			const reordered = rollParamsOver([...NUMBER_PARAMS].reverse());
			sample.forEach((seed, index) => expect(reordered(seed)).toEqual(rolls[index]));
		});

		it.each(['radius', 'aridity', 'villages', 'dressing'] as const)('rolls every other parameter the same without %s', (removed) => {
			const without = rollParamsOver(NUMBER_PARAMS.filter((name) => name !== removed));
			sample.forEach((seed, index) => {
				const expected: Partial<MapParams> = { ...rolls[index] };
				delete expected[removed];
				expect(without(seed)).toEqual(expected);
			});
		});

		// Strongholds and highways stay out of the swap: the validator raises
		// highways to fit strongholds, so those two move each other by design,
		// and highway separation follows highways.
		it.each(NUMBER_PARAMS.filter((name) => name !== 'strongholds' && name !== 'highways'))(
			'leaves every other parameter\'s roll alone when %s\'s campaign range changes',
			(name) => {
				const { campaign, tuning } = MAP_PARAMETERS[name];
				// Pinned to an end of the tuning range the campaign range leaves out, so this one's roll changes.
				const end = campaign.max < tuning.max ? tuning.max : tuning.min;
				const replaced = jest.replaceProperty(MAP_PARAMETERS[name], 'campaign', { min: end, max: end });
				try {
					sample.forEach((seed, index) => {
						const params = rollParams(seed);
						expect(params[name]).not.toBe(rolls[index][name]);
						expect({ ...params, [name]: 0 }).toEqual({ ...rolls[index], [name]: 0 });
					});
				} finally {
					replaced.restore();
				}
			},
		);
	});

	it('rolls different params for different seeds', () => {
		const distinct = new Set(rolls.map((params) => JSON.stringify({ ...params, seed: 0 })));
		expect(distinct.size).toBeGreaterThan(rolls.length * 0.99);
	});

	it('lands every value inside its campaign range and on its step grid', () => {
		const failures: string[] = [];
		for (const params of rolls) {
			if (!MAP_PARAMETERS.environment.campaign.includes(params.environment)) failures.push(`${params.seed}: environment ${params.environment}`);
			for (const name of NUMBER_PARAMS) {
				const { campaign, step } = MAP_PARAMETERS[name];
				const value = params[name];
				if (value < campaign.min || value > campaign.max || !onGrid(value, step)) failures.push(`${params.seed}: ${name} ${value}`);
			}
		}
		expect(failures).toEqual([]);
	});

	it('lands every value within its bounds round the environment\'s, give or take the snap to its step', () => {
		const failures: string[] = [];
		for (const params of rolls) {
			const centres = environmentDefaults(params.environment);
			for (const name of NUMBER_PARAMS) {
				const spec = MAP_PARAMETERS[name];
				const { min, max } = rollBounds(spec, centres[name]);
				const slack = spec.step / 2 + 1e-9;
				if (params[name] < min - slack || params[name] > max + slack) failures.push(`${params.seed}: ${name} ${params[name]} outside ${min} to ${max}`);
			}
		}
		expect(failures).toEqual([]);
	});

	it('reports the validator\'s only change to a roll, highways raised to strongholds + 2, in about one roll in five', () => {
		const others = clamps.flat().filter(({ param, reason }) => param !== 'highways' || reason !== 'strongholds + 2');
		expect(others).toEqual([]);
		clamps.forEach((list, index) => {
			for (const { to } of list) expect(to).toBe(rolls[index].strongholds + 2);
		});
		const share = clamps.filter((list) => list.length > 0).length / clamps.length;
		expect(share).toBeGreaterThan(0.15);
		expect(share).toBeLessThan(0.25);
	});

	it('writes values as the Map Lab shows them, with no float noise', () => {
		expect(JSON.stringify(rolls)).not.toMatch(/\d\.\d{3,}/);
	});

	it('rolls every environment', () => {
		for (const environment of ENVIRONMENTS) {
			expect(rollsOf(environment).length).toBeGreaterThan(rolls.length / ENVIRONMENTS.length / 2);
		}
	});

	it('centres each value on its environment\'s default', () => {
		const failures: string[] = [];
		for (const environment of ENVIRONMENTS) {
			const defaults = environmentDefaults(environment);
			const rolled = rollsOf(environment);
			for (const name of NUMBER_PARAMS) {
				const values = rolled.map((params) => params[name]).sort((a, b) => a - b);
				const median = values[Math.floor(values.length / 2)];
				if (Math.abs(median - defaults[name]) > MAP_PARAMETERS[name].step + 1e-9) {
					failures.push(`${environment} ${name}: median ${median}, default ${defaults[name]}`);
				}
			}
		}
		expect(failures).toEqual([]);
	});

	it('spreads values either side of the default', () => {
		for (const name of ['radius', 'aridity', 'highwaySeparation', 'poiDensity'] as const) {
			const values = rolls.map((params) => params[name]);
			expect(Math.min(...values)).toBeLessThan(MAP_PARAMETERS[name].default);
			expect(Math.max(...values)).toBeGreaterThan(MAP_PARAMETERS[name].default);
		}
	});

	it('keeps each environment\'s character', () => {
		const aridity = (environment: string) => mean(rollsOf(environment).map((params) => params.aridity));
		expect(aridity('highDesert')).toBeLessThan(aridity('mixed'));
		expect(aridity('mixed')).toBeLessThan(aridity('floodlands'));
		const ruggedness = (environment: string) => mean(rollsOf(environment).map((params) => params.ruggedness));
		expect(ruggedness('badlands')).toBeGreaterThan(ruggedness('mixed'));
		for (const name of ['villages', 'roadDensity', 'loops'] as const) {
			const average = (environment: string) => mean(rollsOf(environment).map((params) => params[name]));
			expect(average('highDesert')).toBeLessThan(average('mixed'));
			expect(average('mixed')).toBeLessThan(average('rustBelt'));
		}
	});

	it('rolls routeSplit at the spec\'s half every time, a balance knob with one campaign value', () => {
		expect(new Set(rolls.map(({ routeSplit }) => routeSplit))).toEqual(new Set([0.5]));
	});

	it('never calls Math.random', () => {
		const random = jest.spyOn(Math, 'random');
		try {
			rollParams(2183746551);
			expect(random).not.toHaveBeenCalled();
		} finally {
			random.mockRestore();
		}
	});
});

describe('rollBounds', () => {
	it('reaches half the campaign range either side of the value', () => {
		expect(rollBounds(MAP_PARAMETERS.radius, 1000)).toEqual({ min: 800, centre: 1000, max: 1200 });
		expect(rollBounds(MAP_PARAMETERS.hotspots, 3)).toEqual({ min: 1, centre: 3, max: 5 });
	});

	it('stops at the campaign range, leaving a value near an end less room on that side', () => {
		expect(rollBounds(MAP_PARAMETERS.brokenHighways, 3)).toEqual({ min: 1.5, centre: 3, max: 4 });
		expect(rollBounds(MAP_PARAMETERS.lakes, 0)).toEqual({ min: 0, centre: 0, max: 3 });
	});

	it('holds a value outside the campaign range at its end', () => {
		expect(rollBounds(MAP_PARAMETERS.towns, 12)).toEqual({ min: 5.5, centre: 9, max: 9 });
	});
});
