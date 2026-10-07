import { Rng } from '../core/Rng';
import { ENVIRONMENTS, MAP_PARAMETERS, MapParams, NUMBER_PARAMS, NumberParam, environmentDefaults } from './MapParams';
import { validateMapParams } from './ParamValidator';
import { rollParams } from './RollParams';

const onGrid = (value: number, step: number) => Math.abs(value / step - Math.round(value / step)) < 1e-9;
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
	const rollsOf = (environment: string) => rolls.filter((params) => params.environment === environment);

	beforeAll(() => {
		rolls = SEEDS.map((seed) => rollParams(seed));
	});

	it('rolls the same params for the same seed', () => {
		SEEDS.forEach((seed, index) => expect(rollParams(seed)).toEqual(rolls[index]));
	});

	// What a seed rolls is part of what the seed means, so it's pinned like the
	// PRNG's goldens. Retuning a campaign range, or Floodlands' values, can move
	// that parameter's value here on purpose: update it in the same change.
	it('rolls the pinned params for the default preset\'s seed', () => {
		expect(rollParams(2183746551)).toEqual({
			seed: 2183746551, environment: 'floodlands',
			radius: 950, aridity: 0.9, mountainCoverage: 0.1, ruggedness: 0.15, rivers: 3, riverMeander: 0.7, lakes: 5,
			contamination: 0.35, hotspots: 5, metroSize: 0.17, towns: 5,
			highways: 6, highwaySeparation: 33, curviness: 0.45, branchiness: 0.5, trailShare: 0.4, roadClearance: 22,
			strongholds: 4, poiDensity: 0.9, routesTarget: 3, startingReveal: 1, stopDensity: 0.9, dangerCurve: 1.1,
			driverFinds: 2, daylightHours: 14, travelPace: 1,
			sceneryDensity: 0.6, streetGrids: 0.8, countyRoads: 0.55, brokenHighways: 2, railLines: 1, farmTracks: 0.55,
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

	// Each parameter rolls on its own fork, named by its key, so a roll never
	// depends on the table's shape: the Map Lab can add, drop, reorder, and
	// retune parameters without moving any other parameter's roll.
	describe('rolls each parameter independently of the others', () => {
		const sample = SEEDS.slice(0, 100);

		it('rolls the same params whatever order the table lists them in', () => {
			const reordered = rollParamsOver([...NUMBER_PARAMS].reverse());
			sample.forEach((seed, index) => expect(reordered(seed)).toEqual(rolls[index]));
		});

		it.each(['radius', 'aridity', 'roadClearance', 'farmTracks'] as const)('rolls every other parameter the same without %s', (removed) => {
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

	it('lands every value inside its campaign range and on its step grid, already valid', () => {
		const failures: string[] = [];
		for (const params of rolls) {
			if (!MAP_PARAMETERS.environment.campaign.includes(params.environment)) failures.push(`${params.seed}: environment ${params.environment}`);
			for (const name of NUMBER_PARAMS) {
				const { campaign, step } = MAP_PARAMETERS[name];
				const value = params[name];
				if (value < campaign.min || value > campaign.max || !onGrid(value, step)) failures.push(`${params.seed}: ${name} ${value}`);
			}
			if (validateMapParams(params).clamps.length > 0) failures.push(`${params.seed}: clamped`);
		}
		expect(failures).toEqual([]);
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
