import {
	ENVIRONMENTS,
	ENVIRONMENT_PRESETS,
	MAP_PARAMETERS,
	MapParamSet,
	NUMBER_PARAMS,
	NumberParam,
	PARAM_GROUPS,
	PARAM_NAMES,
	ParamRange,
	environmentDefaults,
	resolveMapParams,
} from './MapParams';
import { validateMapParams } from './ParamValidator';

const inside = (value: number, range: ParamRange) => value >= range.min && value <= range.max;
/** Whether a value is a whole number of steps, allowing for float error (0.35 / 0.05 is 6.999...). */
const onGrid = (value: number, step: number) => Math.abs(value / step - Math.round(value / step)) < 1e-9;

describe('MAP_PARAMETERS', () => {
	it('has a row for every parameter but the seed and stop tables', () => {
		const { params } = resolveMapParams({ seed: 1 });
		const rows = Object.keys(params).filter((key) => key !== 'seed');
		expect([...rows].sort()).toEqual([...PARAM_NAMES].sort());
	});

	it('lists the number parameters in table order, after the environment', () => {
		expect(PARAM_NAMES[0]).toBe('environment');
		expect(NUMBER_PARAMS).toEqual(PARAM_NAMES.slice(1));
	});

	it.each(NUMBER_PARAMS)('%s keeps its default and campaign range inside its tuning range', (name) => {
		const { tuning, campaign, default: fallback } = MAP_PARAMETERS[name];
		expect(tuning.min).toBeLessThan(tuning.max);
		expect(inside(fallback, tuning)).toBe(true);
		expect(campaign.min).toBeLessThanOrEqual(campaign.max);
		expect(inside(campaign.min, tuning) && inside(campaign.max, tuning)).toBe(true);
		expect(inside(fallback, campaign)).toBe(true);
	});

	it.each(NUMBER_PARAMS)('%s puts every bound and its default on its step grid', (name) => {
		const { kind, step, tuning, campaign, default: fallback } = MAP_PARAMETERS[name];
		const values = [tuning.min, tuning.max, campaign.min, campaign.max, fallback];
		expect(step).toBeGreaterThan(0);
		if (kind === 'int') expect([step, ...values].every(Number.isInteger)).toBe(true);
		expect(values.filter((value) => !onGrid(value, step))).toEqual([]);
	});

	it.each(PARAM_NAMES)('%s has a label and a group with a heading', (name) => {
		const spec = MAP_PARAMETERS[name];
		expect(spec.label.length).toBeGreaterThan(0);
		expect(PARAM_GROUPS.map(({ group }) => group)).toContain(spec.group);
	});

	it('has parameters in every group', () => {
		for (const { group } of PARAM_GROUPS) {
			expect(PARAM_NAMES.some((name) => MAP_PARAMETERS[name].group === group)).toBe(true);
		}
	});

	it('offers every environment once, defaults to Mixed, and rolls from known ones', () => {
		const { options, campaign, kind } = MAP_PARAMETERS.environment;
		expect(kind).toBe('enum');
		expect(options.map(({ value }) => value)).toEqual([...ENVIRONMENTS]);
		expect(options.map(({ label }) => label)).toEqual(['High Desert', 'Rust Belt', 'Floodlands', 'Badlands', 'Mixed']);
		expect(MAP_PARAMETERS.environment.default).toBe('mixed');
		expect(campaign.length).toBeGreaterThan(0);
		expect(campaign.every((value) => ENVIRONMENTS.includes(value))).toBe(true);
	});
});

describe('ENVIRONMENT_PRESETS', () => {
	const entries = ENVIRONMENTS.flatMap((environment) =>
		(Object.entries(ENVIRONMENT_PRESETS[environment]) as [NumberParam, number][]).map(
			([name, value]) => [environment, name, value] as const,
		),
	);

	it('has one for every environment, and Mixed sets nothing', () => {
		expect(Object.keys(ENVIRONMENT_PRESETS).sort()).toEqual([...ENVIRONMENTS].sort());
		expect(ENVIRONMENT_PRESETS.mixed).toEqual({});
		for (const name of NUMBER_PARAMS) expect(environmentDefaults('mixed')[name]).toBe(MAP_PARAMETERS[name].default);
	});

	it.each(entries)('%s sets %s to %p: no gameplay, inside the campaign range, on the grid, not the default', (_environment, name, value) => {
		expect(NUMBER_PARAMS).toContain(name);
		const { group, kind, step, campaign, default: fallback } = MAP_PARAMETERS[name];
		expect(group).not.toBe('gameplay');
		expect(inside(value, campaign)).toBe(true);
		expect(onGrid(value, step)).toBe(true);
		if (kind === 'int') expect(Number.isInteger(value)).toBe(true);
		expect(value).not.toBe(fallback);
	});

	// A roll reaches at most half the campaign range either side of the
	// environment's value, so these are the ends rollParams can get to.
	it.each(NUMBER_PARAMS)('%s has each campaign end within a roll\'s reach of some environment', (name) => {
		const { campaign } = MAP_PARAMETERS[name];
		const reach = (campaign.max - campaign.min) / 2;
		const centres = ENVIRONMENTS.map((environment) => environmentDefaults(environment)[name]);
		expect(Math.min(...centres) - reach).toBeLessThanOrEqual(campaign.min + 1e-9);
		expect(Math.max(...centres) + reach).toBeGreaterThanOrEqual(campaign.max - 1e-9);
	});

	it.each(ENVIRONMENTS)('%s defaults validate with no clamps', (environment) => {
		const { params } = resolveMapParams({ seed: 1, environment });
		expect(validateMapParams(params).clamps).toEqual([]);
	});

	describe('reads the spec', () => {
		const mixed = environmentDefaults('mixed');

		it('High Desert is drier than Mixed, with less water', () => {
			const desert = environmentDefaults('highDesert');
			expect(desert.aridity).toBeLessThan(mixed.aridity);
			expect(desert.rivers + desert.lakes).toBeLessThan(mixed.rivers + mixed.lakes);
		});

		it('Floodlands is the wettest, with the most rivers and lakes', () => {
			const others = ENVIRONMENTS.filter((environment) => environment !== 'floodlands').map(environmentDefaults);
			const floodlands = environmentDefaults('floodlands');
			for (const name of ['aridity', 'rivers', 'lakes'] as const) {
				expect(Math.max(...others.map((values) => values[name]))).toBeLessThan(floodlands[name]);
			}
		});

		it('Badlands is the roughest and most contaminated', () => {
			const others = ENVIRONMENTS.filter((environment) => environment !== 'badlands').map(environmentDefaults);
			const badlands = environmentDefaults('badlands');
			for (const name of ['ruggedness', 'contamination', 'trailShare'] as const) {
				expect(Math.max(...others.map((values) => values[name]))).toBeLessThan(badlands[name]);
			}
		});

		it('Rust Belt is the most built up', () => {
			const others = ENVIRONMENTS.filter((environment) => environment !== 'rustBelt').map(environmentDefaults);
			const rustBelt = environmentDefaults('rustBelt');
			for (const name of ['towns', 'streetGrids', 'railLines'] as const) {
				expect(Math.max(...others.map((values) => values[name]))).toBeLessThan(rustBelt[name]);
			}
		});
	});
});

describe('resolveMapParams', () => {
	it('fills a bare seed from the table on Mixed', () => {
		const { params, sources } = resolveMapParams({ seed: 42 });
		expect(params.seed).toBe(42);
		expect(params.environment).toBe('mixed');
		for (const name of NUMBER_PARAMS) {
			expect(params[name]).toBe(MAP_PARAMETERS[name].default);
			expect(sources[name]).toBe('default');
		}
	});

	it('takes the environment\'s values and marks them as its own', () => {
		const { params, sources } = resolveMapParams({ seed: 42, environment: 'floodlands' });
		const preset = ENVIRONMENT_PRESETS.floodlands;
		for (const name of NUMBER_PARAMS) {
			const fromPreset = preset[name];
			expect(params[name]).toBe(fromPreset ?? MAP_PARAMETERS[name].default);
			expect(sources[name]).toBe(fromPreset === undefined ? 'default' : 'environment');
		}
	});

	it('lets an override win over the environment and the table, and says so', () => {
		const set: MapParamSet = { seed: 42, environment: 'floodlands', rivers: 1, strongholds: 6, lakes: 6 };
		const { params, sources } = resolveMapParams(set);
		expect(params).toMatchObject({ rivers: 1, strongholds: 6, lakes: 6 });
		// lakes matches Floodlands' own value, but it was set, so it stays an override.
		expect(sources).toMatchObject({ rivers: 'override', strongholds: 'override', lakes: 'override' });
		expect(sources.aridity).toBe('environment');
		expect(sources.radius).toBe('default');
	});

	it('keeps stop tables when set and leaves the key out when not', () => {
		const stopTables = { highway: { raiders: 3, checkpoint: 2 } };
		expect(resolveMapParams({ seed: 1, stopTables }).params.stopTables).toBe(stopTables);
		expect(Object.keys(resolveMapParams({ seed: 1 }).params)).not.toContain('stopTables');
	});

	it('leaves the set alone and returns plain JSON', () => {
		const set: MapParamSet = { seed: 9, environment: 'badlands', towns: 7, stopTables: { trail: { wreck: 1 } } };
		const copy = JSON.parse(JSON.stringify(set));
		const { params } = resolveMapParams(set);
		expect(set).toEqual(copy);
		expect(JSON.parse(JSON.stringify(params))).toEqual(params);
	});

	it('gives each environment its defaults', () => {
		for (const environment of ENVIRONMENTS) {
			const { params } = resolveMapParams({ seed: 1, environment });
			expect(params).toMatchObject(environmentDefaults(environment));
		}
	});
});
