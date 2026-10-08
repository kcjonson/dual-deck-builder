import {
	ENVIRONMENTS,
	ENVIRONMENT_PRESETS,
	Environment,
	MAP_PARAMETERS,
	MapParamSet,
	NUMBER_PARAMS,
	NumberParam,
	PARAM_GROUPS,
	PARAM_NAMES,
	environmentDefaults,
	resolveMapParams,
} from './MapParams';
import { rollBounds } from './RollParams';
import { inside, onGrid } from './testing';

describe('MAP_PARAMETERS', () => {
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

	it.each(PARAM_NAMES)('%s has a label', (name) => {
		expect(MAP_PARAMETERS[name].label.length).toBeGreaterThan(0);
	});

	it('has parameters in every group', () => {
		for (const { group } of PARAM_GROUPS) {
			expect(PARAM_NAMES.some((name) => MAP_PARAMETERS[name].group === group)).toBe(true);
		}
	});

	it('offers the spec\'s environments once each, defaults to Mixed, and rolls from all of them', () => {
		const { options, campaign, kind } = MAP_PARAMETERS.environment;
		expect(kind).toBe('enum');
		expect(options.map(({ label }) => label)).toEqual(['High Desert', 'Rust Belt', 'Floodlands', 'Badlands', 'Mixed']);
		expect(new Set(ENVIRONMENTS).size).toBe(ENVIRONMENTS.length);
		expect(MAP_PARAMETERS.environment.default).toBe('mixed');
		expect(campaign).toBe(ENVIRONMENTS);
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

	it.each(NUMBER_PARAMS)('%s has each campaign end within a roll\'s reach of some environment', (name) => {
		const spec = MAP_PARAMETERS[name];
		const bounds = ENVIRONMENTS.map((environment) => rollBounds(spec, environmentDefaults(environment)[name]));
		expect(Math.min(...bounds.map(({ min }) => min))).toBeCloseTo(spec.campaign.min, 9);
		expect(Math.max(...bounds.map(({ max }) => max))).toBeCloseTo(spec.campaign.max, 9);
	});

	// Half an environment's rolls land either side of its value, so a value on
	// an end of its campaign range puts half or more exactly on that end. These
	// are the ones that do it on purpose.
	const ON_AN_END: readonly (readonly [Environment, NumberParam])[] = [
		// Most High Desert maps have no lakes: about two in three.
		['highDesert', 'lakes'],
	];

	it('keeps every environment\'s value a step inside its campaign range, but for the ones on an end on purpose', () => {
		const onAnEnd: (readonly [Environment, NumberParam])[] = [];
		for (const environment of ENVIRONMENTS) {
			const values = environmentDefaults(environment);
			for (const name of NUMBER_PARAMS) {
				const { campaign, step } = MAP_PARAMETERS[name];
				// A one-value range rolls that value every time: it's pinned, not piled up.
				if (campaign.min === campaign.max) continue;
				const room = Math.min(values[name] - campaign.min, campaign.max - values[name]);
				if (room < step - 1e-9) onAnEnd.push([environment, name]);
			}
		}
		expect(onAnEnd).toEqual(ON_AN_END);
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

	it('copies stop tables when set and leaves the key out when not', () => {
		const stopTables = { highway: { raiders: 3, checkpoint: 2 } };
		const { params } = resolveMapParams({ seed: 1, stopTables });
		stopTables.highway.raiders = 9;
		expect(params.stopTables).toEqual({ highway: { raiders: 3, checkpoint: 2 } });
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
