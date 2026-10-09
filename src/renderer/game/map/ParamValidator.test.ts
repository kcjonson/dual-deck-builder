import { ENVIRONMENTS, ENVIRONMENT_PRESETS, Environment, MAP_PARAMETERS, MapParamSet, MapParams, NUMBER_PARAMS, resolveMapParams } from './MapParams';
import { describeClamp, validateMapParamSet, validateMapParams } from './ParamValidator';

/** Mixed's defaults with some values swapped in. */
const params = (values: Partial<MapParams> = {}): MapParams => ({ ...resolveMapParams({ seed: 7 }).params, ...values });

describe('validateMapParams', () => {
	it.each(ENVIRONMENTS)('passes %s defaults through untouched', (environment) => {
		const { params: defaults } = resolveMapParams({ seed: 7, environment });
		const result = validateMapParams(defaults);
		expect(result.clamps).toEqual([]);
		expect(result.params).toEqual(defaults);
	});

	it('clamps each value into its tuning range and reports it', () => {
		const result = validateMapParams(params({ radius: 2000, aridity: -0.2, towns: 13 }));
		expect(result.params).toMatchObject({ radius: 1600, aridity: 0, towns: 12 });
		expect(result.clamps).toEqual([
			{ param: 'radius', from: 2000, to: 1600, reason: 'tuning range 600 to 1600' },
			{ param: 'aridity', from: -0.2, to: 0, reason: 'tuning range 0 to 1' },
			{ param: 'towns', from: 13, to: 12, reason: 'tuning range 0 to 12' },
		]);
	});

	it('rounds whole-number parameters and leaves fractional ones be', () => {
		const result = validateMapParams(params({ rivers: 2.4, lakes: 2.5, aridity: 0.333, villages: 40.6, highways: 12.6, loops: 0.333 }));
		expect(result.params).toMatchObject({ rivers: 2, lakes: 3, aridity: 0.333, villages: 40, highways: 9, loops: 0.333 });
		expect(result.clamps).toEqual([
			{ param: 'rivers', from: 2.4, to: 2, reason: 'whole number' },
			{ param: 'lakes', from: 2.5, to: 3, reason: 'whole number' },
			{ param: 'villages', from: 40.6, to: 40, reason: 'tuning range 0 to 40' },
			{ param: 'highways', from: 12.6, to: 9, reason: 'tuning range 3 to 9' },
		]);
	});

	it('clamps the realistic map\'s new parameters into their tuning ranges', () => {
		const result = validateMapParams(params({ riverDensity: 1.2, villages: -3, roadDensity: -0.1, loops: 2, routeSplit: 0.1 }));
		expect(result.params).toMatchObject({ riverDensity: 1, villages: 0, roadDensity: 0, loops: 1, routeSplit: 0.3 });
		expect(result.clamps.map(describeClamp)).toEqual([
			'riverDensity lowered to 1 (tuning range 0 to 1)',
			'villages raised to 0 (tuning range 0 to 40)',
			'roadDensity raised to 0 (tuning range 0 to 1)',
			'loops lowered to 1 (tuning range 0 to 1)',
			'routeSplit raised to 0.3 (tuning range 0.3 to 0.7)',
		]);
	});

	// Only strongholds, highways, and separation constrain each other. Rivers 0
	// is a closed basin, which still has streams and can hold reservoirs.
	it('takes every corner of the water, settlement, road, and route parameters\' ranges together', () => {
		const names = ['rivers', 'riverDensity', 'lakes', 'towns', 'villages', 'roadDensity', 'loops', 'brokenHighways', 'routeSplit'] as const;
		const failures: string[] = [];
		for (let corner = 0; corner < 2 ** names.length; corner += 1) {
			const values: Partial<MapParams> = {};
			names.forEach((name, bit) => {
				const { tuning } = MAP_PARAMETERS[name];
				values[name] = corner & (1 << bit) ? tuning.max : tuning.min;
			});
			if (validateMapParams(params(values)).clamps.length > 0) failures.push(JSON.stringify(values));
		}
		expect(failures).toEqual([]);
	});

	it('puts the environment\'s default in place of a value that isn\'t a number', () => {
		const rivers = ENVIRONMENT_PRESETS.floodlands.rivers;
		const result = validateMapParams(params({ environment: 'floodlands', rivers: NaN, radius: Infinity }));
		expect(result.params).toMatchObject({ rivers, radius: MAP_PARAMETERS.radius.default });
		expect(result.clamps.map(({ param, to, reason }) => [param, to, reason])).toEqual([
			['radius', MAP_PARAMETERS.radius.default, 'not a number'],
			['rivers', rivers, 'not a number'],
		]);
	});

	it.each(['tundra', 'constructor'])('swaps an unknown environment, %p, for Mixed', (name) => {
		const result = validateMapParams(params({ environment: name as Environment }));
		expect(result.params.environment).toBe('mixed');
		expect(result.clamps).toEqual([{ param: 'environment', from: name, to: 'mixed', reason: 'unknown environment' }]);
	});

	it.each([
		[-1, 4294967295],
		[2 ** 32 + 5, 5],
		[12.9, 12],
		[NaN, 0],
	])('wraps seed %p to uint32 as the PRNG coerces it: %p', (from, to) => {
		const result = validateMapParams(params({ seed: from }));
		expect(result.params.seed).toBe(to);
		expect(result.clamps).toEqual([{ param: 'seed', from, to, reason: 'uint32' }]);
	});

	it.each([0, 1, 2183746551, 4294967295])('leaves seed %p alone', (seed) => {
		expect(validateMapParams(params({ seed })).clamps).toEqual([]);
	});

	describe('combinations', () => {
		it('raises highways to strongholds + 2', () => {
			const result = validateMapParams(params({ strongholds: 4, highways: 3 }));
			expect(result.params.highways).toBe(6);
			expect(result.clamps.map(describeClamp)).toEqual(['highways raised to 6 (strongholds + 2)']);
		});

		it('leaves highways be once there are two more than strongholds', () => {
			expect(validateMapParams(params({ strongholds: 5, highways: 7 })).clamps).toEqual([]);
		});

		it('lowers strongholds when even the most highways can\'t make room', () => {
			const result = validateMapParams(params({ strongholds: 8, highways: 6 }));
			expect(result.params).toMatchObject({ strongholds: 7, highways: 9 });
			expect(result.clamps.map(describeClamp)).toEqual([
				'strongholds lowered to 7 (highways max - 2)',
				'highways raised to 9 (strongholds + 2)',
			]);
		});

		it.each([
			[9, 60, 40],
			[8, 50, 45],
			[7, 60, 51],
		])('fits %p highway exits round the rim by lowering separation %p to %p', (highways, highwaySeparation, to) => {
			const result = validateMapParams(params({ highways, highwaySeparation }));
			expect(result.params.highwaySeparation).toBe(to);
			expect(result.clamps).toEqual([{ param: 'highwaySeparation', from: highwaySeparation, to, reason: '360 / highways' }]);
		});

		it('fits the separation to the highways the strongholds rule raised', () => {
			const result = validateMapParams(params({ strongholds: 7, highways: 3, highwaySeparation: 50 }));
			expect(result.params).toMatchObject({ highways: 9, highwaySeparation: 40 });
			expect(result.clamps.map(describeClamp)).toEqual([
				'highways raised to 9 (strongholds + 2)',
				'highwaySeparation lowered to 40 (360 / highways)',
			]);
		});

		it('returns a valid combination from anything, which a second pass leaves alone', () => {
			const failures: string[] = [];
			for (let strongholds = 1; strongholds <= 9; strongholds += 1) {
				for (let highways = 2; highways <= 10; highways += 1) {
					for (let highwaySeparation = 15; highwaySeparation <= 65; highwaySeparation += 5) {
						const input = { strongholds, highways, highwaySeparation };
						const valid = validateMapParams(params(input)).params;
						const inRange = NUMBER_PARAMS.every((name) => {
							const { tuning } = MAP_PARAMETERS[name];
							return valid[name] >= tuning.min && valid[name] <= tuning.max;
						});
						const fits = valid.highways >= valid.strongholds + 2 && valid.highways * valid.highwaySeparation <= 360;
						const settled = validateMapParams(valid).clamps.length === 0;
						if (!inRange || !fits || !settled) failures.push(JSON.stringify(input));
					}
				}
			}
			expect(failures).toEqual([]);
		});

		it('keeps every combination of campaign values inside the campaign ranges', () => {
			const campaignValues = (name: 'strongholds' | 'highways' | 'highwaySeparation') => {
				const { min, max } = MAP_PARAMETERS[name].campaign;
				return Array.from({ length: max - min + 1 }, (_, index) => min + index);
			};
			const failures: string[] = [];
			for (const strongholds of campaignValues('strongholds')) {
				for (const highways of campaignValues('highways')) {
					for (const highwaySeparation of campaignValues('highwaySeparation')) {
						const valid = validateMapParams(params({ strongholds, highways, highwaySeparation })).params;
						const outside = (['strongholds', 'highways', 'highwaySeparation'] as const).filter((name) => {
							const { min, max } = MAP_PARAMETERS[name].campaign;
							return valid[name] < min || valid[name] > max;
						});
						if (outside.length > 0) failures.push(`${JSON.stringify({ strongholds, highways, highwaySeparation })}: ${outside.join(', ')}`);
					}
				}
			}
			expect(failures).toEqual([]);
		});
	});

	it('leaves its input alone and copies stop tables through', () => {
		const stopTables = { trail: { hazard: 2 } };
		const input = params({ radius: 5000, stopTables });
		const result = validateMapParams(input);
		stopTables.trail.hazard = 7;
		expect(input.radius).toBe(5000);
		expect(result.params.stopTables).toStrictEqual({ trail: { hazard: 2 } });
	});

	it('throws on stop tables JSON can\'t hold, naming the path, since there\'s nothing to clamp them to', () => {
		expect(() => validateMapParams(params({ stopTables: { trail: { hazard: NaN } } }))).toThrow(
			new RangeError('stopTables.trail.hazard must be a finite number, got NaN'),
		);
	});
});

describe('validateMapParamSet', () => {
	it.each(['tundra', 'constructor'])('refuses %p as an environment, which only the validator alone swaps for Mixed', (name) => {
		expect(() => validateMapParamSet({ seed: 1, environment: name as Environment })).toThrow(
			new RangeError(`environment must be one of highDesert, rustBelt, floodlands, badlands, mixed, got "${name}"`),
		);
	});

	it('resolves and validates in one call, as the validator does', () => {
		const set: MapParamSet = { seed: -1, environment: 'badlands', radius: 5000, strongholds: 5, highways: 4 };
		const result = validateMapParamSet(set);
		expect({ params: result.params, clamps: result.clamps }).toEqual(validateMapParams(resolveMapParams(set).params));
	});

	it('marks every value the validator changed as clamped, whoever set it', () => {
		// rivers is a NaN override, highways a default the strongholds rule raises.
		const { params, sources } = validateMapParamSet({ seed: 7, environment: 'floodlands', rivers: NaN, strongholds: 5 });
		expect(params).toMatchObject({ rivers: ENVIRONMENT_PRESETS.floodlands.rivers, highways: 7 });
		expect(sources).toMatchObject({ rivers: 'clamped', highways: 'clamped', strongholds: 'override' });
	});

	it('keeps where every other value came from', () => {
		const set: MapParamSet = { seed: 7, environment: 'floodlands', towns: 13, curviness: 0.3 };
		const { sources } = validateMapParamSet(set);
		const resolved = resolveMapParams(set).sources;
		expect(sources.towns).toBe('clamped');
		expect(NUMBER_PARAMS.filter((name) => name !== 'towns' && sources[name] !== resolved[name])).toEqual([]);
		expect(sources).toMatchObject({ curviness: 'override', aridity: 'environment', radius: 'default' });
	});

	it('marks no parameter clamped for a seed it wraps', () => {
		const { sources, clamps } = validateMapParamSet({ seed: 2 ** 32 + 3 });
		expect(clamps.map(({ param }) => param)).toEqual(['seed']);
		expect(Object.values(sources)).not.toContain('clamped');
	});
});

describe('describeClamp', () => {
	it('words a raise, a drop, a replacement, and a wrapped seed', () => {
		expect(describeClamp({ param: 'highways', from: 3, to: 6, reason: 'strongholds + 2' })).toBe('highways raised to 6 (strongholds + 2)');
		expect(describeClamp({ param: 'radius', from: 2000, to: 1600, reason: 'tuning range 600 to 1600' })).toBe('radius lowered to 1600 (tuning range 600 to 1600)');
		expect(describeClamp({ param: 'environment', from: 'tundra', to: 'mixed', reason: 'unknown environment' })).toBe('environment set to mixed (unknown environment)');
		expect(describeClamp({ param: 'rivers', from: NaN, to: 2, reason: 'not a number' })).toBe('rivers set to 2 (not a number)');
		expect(describeClamp({ param: 'seed', from: -1, to: 4294967295, reason: 'uint32' })).toBe('seed wrapped to 4294967295 (uint32)');
		expect(describeClamp({ param: 'seed', from: 2 ** 32 + 5, to: 5, reason: 'uint32' })).toBe('seed wrapped to 5 (uint32)');
	});

	it.each([
		[NaN, 0, 'seed set to 0 (uint32)'],
		[Infinity, 0, 'seed set to 0 (uint32)'],
		[12.9, 12, 'seed lowered to 12 (uint32)'],
		[-0.5, 0, 'seed raised to 0 (uint32)'],
	])('words a seed of %p made %p as %p, wrapped only from outside uint32', (from, to, wording) => {
		expect(describeClamp({ param: 'seed', from, to, reason: 'uint32' })).toBe(wording);
	});

	it('words every seed clamp the validator makes', () => {
		const wordings = [NaN, 1.5, -1, 2 ** 32 + 5, Infinity].map((seed) => validateMapParams(params({ seed })).clamps.map(describeClamp));
		expect(wordings).toEqual([
			['seed set to 0 (uint32)'],
			['seed lowered to 1 (uint32)'],
			['seed wrapped to 4294967295 (uint32)'],
			['seed wrapped to 5 (uint32)'],
			['seed set to 0 (uint32)'],
		]);
	});
});
