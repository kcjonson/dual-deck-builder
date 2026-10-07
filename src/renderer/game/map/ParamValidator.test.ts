import { ENVIRONMENTS, Environment, MAP_PARAMETERS, MapParams, NUMBER_PARAMS, resolveMapParams } from './MapParams';
import { describeClamp, validateMapParams } from './ParamValidator';

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
		const result = validateMapParams(params({ rivers: 2.4, lakes: 2.5, aridity: 0.333, highways: 12.6 }));
		expect(result.params).toMatchObject({ rivers: 2, lakes: 3, aridity: 0.333, highways: 9 });
		expect(result.clamps).toEqual([
			{ param: 'rivers', from: 2.4, to: 2, reason: 'whole number' },
			{ param: 'lakes', from: 2.5, to: 3, reason: 'whole number' },
			{ param: 'highways', from: 12.6, to: 9, reason: 'tuning range 3 to 9' },
		]);
	});

	it('puts the environment\'s default in place of a value that isn\'t a number', () => {
		const result = validateMapParams(params({ environment: 'floodlands', rivers: NaN, radius: Infinity }));
		expect(result.params).toMatchObject({ rivers: 5, radius: 1000 });
		expect(result.clamps.map(({ param, to, reason }) => [param, to, reason])).toEqual([
			['radius', 1000, 'not a number'],
			['rivers', 5, 'not a number'],
		]);
	});

	it('swaps an unknown environment for Mixed', () => {
		const result = validateMapParams(params({ environment: 'tundra' as Environment }));
		expect(result.params.environment).toBe('mixed');
		expect(result.clamps).toEqual([{ param: 'environment', from: 'tundra', to: 'mixed', reason: 'unknown environment' }]);
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
		])('fits %p highways round the metro by lowering separation %p to %p', (highways, highwaySeparation, to) => {
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

	it('leaves its input alone and passes stop tables through', () => {
		const stopTables = { trail: { hazard: 2 } };
		const input = params({ radius: 5000, stopTables });
		const result = validateMapParams(input);
		expect(input.radius).toBe(5000);
		expect(result.params.stopTables).toBe(stopTables);
	});
});

describe('describeClamp', () => {
	it('words a raise, a drop, and a replacement', () => {
		expect(describeClamp({ param: 'highways', from: 3, to: 6, reason: 'strongholds + 2' })).toBe('highways raised to 6 (strongholds + 2)');
		expect(describeClamp({ param: 'radius', from: 2000, to: 1600, reason: 'tuning range 600 to 1600' })).toBe('radius lowered to 1600 (tuning range 600 to 1600)');
		expect(describeClamp({ param: 'environment', from: 'tundra', to: 'mixed', reason: 'unknown environment' })).toBe('environment set to mixed (unknown environment)');
		expect(describeClamp({ param: 'rivers', from: NaN, to: 2, reason: 'not a number' })).toBe('rivers set to 2 (not a number)');
	});
});
