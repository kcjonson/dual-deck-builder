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
	ParamGroup,
	environmentDefaults,
	resolveMapParams,
} from './MapParams';
import { rollBounds } from './RollParams';
import { inside, onGrid } from './testing';

/** A row of the spec's tables: tuning min and max, default, campaign min and max. */
type SpecRow = readonly [number, number, number, number, number];

/**
 * Area Map Generation's Map parameters tables, row for row in their order.
 * Retuning changes the spec, the table, and this together.
 */
const SPEC_TABLES: { readonly [Group in ParamGroup]: Readonly<Partial<Record<NumberParam, SpecRow>>> } = {
	world: {
		radius: [600, 1600, 1000, 800, 1200],
		aridity: [0, 1, 0.5, 0.1, 0.9],
		mountainCoverage: [0, 1, 0.25, 0.05, 0.45],
		ruggedness: [0, 1, 0.5, 0.15, 0.85],
		rivers: [0, 6, 2, 0, 5],
		riverDensity: [0, 1, 0.5, 0.3, 0.7],
		riverMeander: [0, 1, 0.5, 0.2, 0.8],
		lakes: [0, 8, 2, 0, 6],
		contamination: [0, 1, 0.3, 0.1, 0.7],
		hotspots: [0, 6, 3, 1, 5],
		metroSize: [0.08, 0.25, 0.15, 0.12, 0.2],
		towns: [0, 12, 5, 2, 9],
		villages: [0, 40, 20, 12, 28],
	},
	network: {
		highways: [3, 9, 6, 5, 7],
		highwaySeparation: [20, 60, 35, 25, 45],
		roadDensity: [0, 1, 0.5, 0.35, 0.65],
		loops: [0, 1, 0.5, 0.3, 0.7],
		curviness: [0, 1, 0.5, 0.25, 0.75],
		trailShare: [0, 1, 0.5, 0.25, 0.75],
		brokenHighways: [0, 4, 2, 1, 4],
	},
	gameplay: {
		strongholds: [2, 8, 4, 3, 5],
		poiDensity: [0.5, 2, 1, 0.8, 1.2],
		routesTarget: [2, 3, 3, 3, 3],
		routeSplit: [0.3, 0.7, 0.5, 0.5, 0.5],
		startingReveal: [1, 2, 1, 1, 1],
		stopDensity: [0.5, 2, 1, 0.8, 1.2],
		dangerCurve: [0.5, 2, 1, 0.9, 1.1],
		driverFinds: [1, 4, 2, 2, 2],
		daylightHours: [10, 16, 14, 13, 15],
		travelPace: [0.5, 2, 1, 0.9, 1.1],
	},
	dressing: {
		dressing: [0, 1, 0.6, 0.4, 0.8],
		streetGrids: [0, 1, 0.7, 0.5, 0.9],
		railLines: [0, 4, 1, 0, 3],
	},
};

/** Area Map Generation's Environments table: what each environment sets, blanks left out. */
const SPEC_ENVIRONMENTS: { readonly [Name in Environment]: Readonly<Partial<Record<NumberParam, number>>> } = {
	highDesert: {
		aridity: 0.15, mountainCoverage: 0.35, ruggedness: 0.65, rivers: 1, riverDensity: 0.35, riverMeander: 0.3, lakes: 0,
		contamination: 0.2, hotspots: 2, towns: 3, villages: 14, roadDensity: 0.4, loops: 0.4, curviness: 0.4,
	},
	rustBelt: {
		aridity: 0.55, mountainCoverage: 0.15, ruggedness: 0.35, rivers: 3, contamination: 0.45, hotspots: 4, metroSize: 0.18,
		towns: 8, villages: 26, roadDensity: 0.6, loops: 0.6, trailShare: 0.35, brokenHighways: 3, streetGrids: 0.85, railLines: 2,
	},
	floodlands: {
		aridity: 0.85, mountainCoverage: 0.1, ruggedness: 0.25, rivers: 4, riverDensity: 0.65, riverMeander: 0.75, lakes: 5,
		contamination: 0.4, curviness: 0.6,
	},
	badlands: {
		aridity: 0.3, mountainCoverage: 0.35, ruggedness: 0.8, rivers: 1, riverDensity: 0.4, lakes: 1, contamination: 0.6, hotspots: 4,
		towns: 3, villages: 14, roadDensity: 0.4, loops: 0.4, curviness: 0.65, trailShare: 0.7,
	},
	mixed: {},
};

describe('MAP_PARAMETERS', () => {
	it('lists the number parameters in table order, after the environment', () => {
		expect(PARAM_NAMES[0]).toBe('environment');
		expect(NUMBER_PARAMS).toEqual(PARAM_NAMES.slice(1));
	});

	it('has the spec\'s groups and parameters, in its order', () => {
		expect(PARAM_GROUPS.map(({ label }) => label)).toEqual(['World', 'Road network', 'Gameplay', 'Dressing']);
		expect(MAP_PARAMETERS.environment.group).toBe('world');
		const rows = PARAM_GROUPS.flatMap(({ group }) => Object.keys(SPEC_TABLES[group]).map((name) => [group, name]));
		expect(NUMBER_PARAMS.map((name) => [MAP_PARAMETERS[name].group, name])).toEqual(rows);
	});

	it.each(PARAM_GROUPS.flatMap(({ group }) => Object.entries(SPEC_TABLES[group]) as [NumberParam, SpecRow][]))(
		'%s has the spec\'s tuning range, default, and campaign range',
		(name, [tuningMin, tuningMax, fallback, campaignMin, campaignMax]) => {
			const { tuning, campaign, default: tableDefault } = MAP_PARAMETERS[name];
			expect([tuning.min, tuning.max, tableDefault, campaign.min, campaign.max]).toEqual([tuningMin, tuningMax, fallback, campaignMin, campaignMax]);
		},
	);

	it('has none of the parameters the realistic map dropped or renamed', () => {
		const gone = ['branchiness', 'roadClearance', 'countyRoads', 'farmTracks', 'sceneryDensity'];
		expect(PARAM_NAMES.filter((name) => gone.includes(name))).toEqual([]);
	});

	it('takes whole numbers for counts, degrees, radius, and tiers, and fractions for the rest', () => {
		const counts = NUMBER_PARAMS.filter((name) => MAP_PARAMETERS[name].kind === 'int');
		expect(counts).toEqual([
			'radius', 'rivers', 'lakes', 'hotspots', 'towns', 'villages', 'highways', 'highwaySeparation', 'brokenHighways',
			'strongholds', 'routesTarget', 'startingReveal', 'driverFinds', 'railLines',
		]);
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

	it('sets what the spec\'s Environments table does, and nothing else', () => {
		expect(ENVIRONMENT_PRESETS).toEqual(SPEC_ENVIRONMENTS);
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

		it('Floodlands is the wettest, with the most rivers, streams, and lakes', () => {
			const others = ENVIRONMENTS.filter((environment) => environment !== 'floodlands').map(environmentDefaults);
			const floodlands = environmentDefaults('floodlands');
			for (const name of ['aridity', 'rivers', 'riverDensity', 'lakes'] as const) {
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

		it('Rust Belt is the most built up, with the densest, loopiest roads', () => {
			const others = ENVIRONMENTS.filter((environment) => environment !== 'rustBelt').map(environmentDefaults);
			const rustBelt = environmentDefaults('rustBelt');
			for (const name of ['towns', 'villages', 'roadDensity', 'loops', 'streetGrids', 'railLines'] as const) {
				expect(Math.max(...others.map((values) => values[name]))).toBeLessThan(rustBelt[name]);
			}
		});

		it('High Desert and Badlands are the emptiest, with the sparsest roads', () => {
			const others = (['rustBelt', 'floodlands', 'mixed'] as const).map(environmentDefaults);
			for (const environment of ['highDesert', 'badlands'] as const) {
				const values = environmentDefaults(environment);
				for (const name of ['towns', 'villages', 'roadDensity', 'loops'] as const) {
					expect(values[name]).toBeLessThan(Math.min(...others.map((other) => other[name])));
				}
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
		expect(params.stopTables).toStrictEqual({ highway: { raiders: 3, checkpoint: 2 } });
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

	// ENVIRONMENT_PRESETS inherits 'constructor' and 'toString' from Object, so a lookup alone would take them for Mixed.
	it.each(['tundra', 'constructor', 'toString', '__proto__'])('refuses %p as an environment', (name) => {
		const environment = name as Environment;
		const message = `environment must be one of highDesert, rustBelt, floodlands, badlands, mixed, got "${name}"`;
		expect(() => environmentDefaults(environment)).toThrow(RangeError);
		expect(() => environmentDefaults(environment)).toThrow(message);
		expect(() => resolveMapParams({ seed: 1, environment })).toThrow(message);
	});

	it('takes only a missing environment as Mixed, not a null one', () => {
		expect(resolveMapParams({ seed: 1, environment: undefined }).params.environment).toBe('mixed');
		expect(() => resolveMapParams({ seed: 1, environment: null as unknown as Environment })).toThrow(
			new RangeError('environment must be one of highDesert, rustBelt, floodlands, badlands, mixed, got null'),
		);
	});
});
