import { AREA_MAP_GENERATOR_VERSION } from '../map/GeneratorVersion';
import { MapPipelineError } from '../map/MapPipeline';
import { rollParams } from '../map/RollParams';
import { MapGenerationCancelled } from '../map/worker/MapGeneration';
import * as protocol from '../map/worker/mapGenerationProtocol';
import type { DriverArchetype } from '../mechanics/Driver';
import { CampaignFounding, FOUNDING_SEEDS, FoundingGeneration, FoundingProgress, StartGeneration } from './CampaignFounding';
import { foundCampaign } from './Founding';
import { readMapParams } from './MapParamsJson';
import { foundTestCampaign, stubGeneration } from './__fixtures__/mapFixtures';

const SEED = 20261010;
const ARCHETYPES: readonly DriverArchetype[] = ['road_warrior', 'interceptor', 'mechanic', 'raider'];

/** How the runner gives up on a seed past the map cap. */
function exhausted(seed: number, kind: MapPipelineError['exhausted'] = 'map'): MapPipelineError {
	return new MapPipelineError({
		message: `MapPipeline: seed ${seed} failed 32 map attempts`,
		failure: { stage: 'roads', index: 4, count: 7, attempt: 7, mapAttempt: 31, seed, problems: ['loops: the roads close 30 loops, and the POIs need 34'] },
		exhausted: kind,
	});
}

function failed(error: unknown): FoundingGeneration {
	const result = Promise.reject(error);
	result.catch(() => undefined);
	return { result, cancel: () => undefined };
}

/**
 * Generations that give up on the first `failing` seeds they're asked for
 * and stub the rest, telling progress once for each as it starts.
 */
function givingUp(failing: number, error: (seed: number) => unknown = exhausted): { generate: StartGeneration; seeds: number[] } {
	const seeds: number[] = [];
	const generate: StartGeneration = (options) => {
		const { seed } = options.params;
		seeds.push(seed);
		options.onProgress?.({ stage: 'terrain', index: 0, count: 4, attempt: 0, mapAttempt: 0, seed });
		return seeds.length <= failing ? failed(error(seed)) : stubGeneration(options);
	};
	return { generate, seeds };
}

function outcome<T>(promise: Promise<T>): Promise<T | unknown> {
	return promise.then((value) => value, (error: unknown) => error);
}

describe('CampaignFounding', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('founds a campaign on the map it generates, in-process where there\'s no worker, keeping the map\'s attempts', async () => {
		const progress: FoundingProgress[] = [];
		const { campaign, map } = await new CampaignFounding({ seed: SEED, unlockedArchetypes: ARCHETYPES, onProgress: (attempt) => progress.push(attempt) }).result;

		expect(map.inWorker).toBe(false);
		expect(campaign.seed).toBe(SEED);
		expect(campaign.mapParams).toEqual(readMapParams(rollParams(SEED), 'mapParams'));
		expect(map.params).toEqual(campaign.mapParams);
		expect(campaign.generatorVersion).toBe(AREA_MAP_GENERATOR_VERSION);
		expect(campaign.mapAttempts).toEqual({ map: map.mapAttempt, stages: map.attempts });
		expect(progress[0]).toEqual({ stage: 'terrain', index: 0, count: progress[0].count, attempt: 0, mapAttempt: 0, seed: SEED, seedAttempt: 0 });
		expect(new Set(progress.map(({ stage }) => stage))).toEqual(new Set(Object.keys(map.attempts)));
		// It's the campaign foundCampaign makes on that map.
		expect(JSON.stringify(campaign)).toBe(JSON.stringify(foundCampaign({ seed: SEED, unlockedArchetypes: ARCHETYPES, map })));
	});

	it('checks its options before it generates anything', async () => {
		const generate = jest.fn(stubGeneration);
		expect(await outcome(new CampaignFounding({ seed: -1, unlockedArchetypes: ARCHETYPES, generate }).result))
			.toEqual(new RangeError('seed must be an integer from 0 to 4294967295, got -1'));
		expect(await outcome(new CampaignFounding({ seed: SEED, unlockedArchetypes: ['mechanic'], generate }).result)).toBeInstanceOf(RangeError);
		expect(generate).not.toHaveBeenCalled();
	});

	describe('when generation gives up on a seed', () => {
		it('starts over from the next seed in a release build, its params rolled and its pool dealt from it, so the campaign\'s seed reproduces it', async () => {
			const warn = jest.fn();
			const progress: FoundingProgress[] = [];
			const { generate, seeds } = givingUp(2);
			const { campaign } = await new CampaignFounding({ seed: SEED, unlockedArchetypes: ARCHETYPES, debug: false, generate, warn, onProgress: (attempt) => progress.push(attempt) }).result;

			expect(seeds).toEqual([SEED, SEED + 1, SEED + 2]);
			expect(progress.map(({ seed, seedAttempt }) => [seed, seedAttempt])).toEqual([[SEED, 0], [SEED + 1, 1], [SEED + 2, 2]]);
			expect(campaign.seed).toBe(SEED + 2);
			expect(campaign.mapParams).toEqual(readMapParams(rollParams(SEED + 2), 'mapParams'));
			expect(JSON.stringify(campaign)).toBe(JSON.stringify(foundTestCampaign({ seed: SEED + 2, unlockedArchetypes: ARCHETYPES })));
			expect(warn.mock.calls.map(([message]) => message)).toEqual([
				`CampaignFounding: no map on seed ${SEED} (MapPipeline: seed ${SEED} failed 32 map attempts); founding on seed ${SEED + 1}`,
				`CampaignFounding: no map on seed ${SEED + 1} (MapPipeline: seed ${SEED + 1} failed 32 map attempts); founding on seed ${SEED + 2}`,
			]);
		});

		it('wraps past the last uint32 seed to 0', async () => {
			const { generate, seeds } = givingUp(1);
			const { campaign } = await new CampaignFounding({ seed: 0xffffffff, unlockedArchetypes: ARCHETYPES, debug: false, generate, warn: () => undefined }).result;
			expect(seeds).toEqual([0xffffffff, 0]);
			expect(campaign.seed).toBe(0);
		});

		it(`lets the last failure stand after ${FOUNDING_SEEDS} seeds`, async () => {
			const warn = jest.fn();
			const { generate, seeds } = givingUp(Infinity);
			const error = await outcome(new CampaignFounding({ seed: SEED, unlockedArchetypes: ARCHETYPES, debug: false, generate, warn }).result);
			expect(seeds).toEqual([SEED, SEED + 1, SEED + 2, SEED + 3]);
			expect(error).toBeInstanceOf(MapPipelineError);
			expect((error as Error).message).toBe(`MapPipeline: seed ${SEED + 3} failed 32 map attempts`);
			expect(warn).toHaveBeenCalledTimes(FOUNDING_SEEDS - 1);
		});

		it('rethrows at once in a debug build, and in any build for params given rather than rolled', async () => {
			const debug = givingUp(1);
			expect(await outcome(new CampaignFounding({ seed: SEED, unlockedArchetypes: ARCHETYPES, debug: true, generate: debug.generate }).result)).toBeInstanceOf(MapPipelineError);
			expect(debug.seeds).toEqual([SEED]);

			const given = givingUp(1);
			const mapParams = { seed: SEED, environment: 'highDesert' as const, radius: 700 };
			expect(await outcome(new CampaignFounding({ seed: SEED, unlockedArchetypes: ARCHETYPES, mapParams, debug: false, generate: given.generate }).result)).toBeInstanceOf(MapPipelineError);
			expect(given.seeds).toEqual([SEED]);
		});

		it('moves seed for nothing but a map that gave up', async () => {
			for (const error of [exhausted(SEED, 'stage'), new TypeError('a stage bug')]) {
				const { generate, seeds } = givingUp(1, () => error);
				expect(await outcome(new CampaignFounding({ seed: SEED, unlockedArchetypes: ARCHETYPES, debug: false, generate }).result)).toBe(error);
				expect(seeds).toEqual([SEED]);
			}
		});
	});

	describe('cancelled', () => {
		it('cancels its generation and founds nothing, rejecting with MapGenerationCancelled', async () => {
			const cancels: jest.Mock[] = [];
			const generate: StartGeneration = (options) => {
				const generation = stubGeneration(options);
				const cancel = jest.fn(() => generation.cancel());
				cancels.push(cancel);
				return { result: generation.result, cancel };
			};
			const founding = new CampaignFounding({ seed: SEED, unlockedArchetypes: ARCHETYPES, generate });
			founding.cancel();
			founding.cancel();
			expect(await outcome(founding.result)).toBeInstanceOf(MapGenerationCancelled);
			expect(cancels).toHaveLength(1);
			expect(cancels[0]).toHaveBeenCalledTimes(1);
		});

		it('never runs a generation it cancels before it starts, in-process', async () => {
			const transfer = jest.spyOn(protocol, 'generateTransfer');
			const founding = new CampaignFounding({ seed: SEED, unlockedArchetypes: ARCHETYPES });
			founding.cancel();
			expect(await outcome(founding.result)).toBeInstanceOf(MapGenerationCancelled);
			await new Promise((resolve) => setTimeout(resolve, 5));
			expect(transfer).not.toHaveBeenCalled();
		});

		it('takes no next seed once cancelled', async () => {
			const { generate, seeds } = givingUp(1);
			const founding: CampaignFounding = new CampaignFounding({ seed: SEED, unlockedArchetypes: ARCHETYPES, debug: false, generate, warn: () => founding.cancel() });
			expect(await outcome(founding.result)).toBeInstanceOf(MapGenerationCancelled);
			expect(seeds).toEqual([SEED]);
		});

		it('founds nothing when the cancel comes too late to stop the generation', async () => {
			// A generation that can't be stopped any more, so its map still arrives.
			const generate: StartGeneration = (options) => ({ result: stubGeneration(options).result, cancel: () => undefined });
			const founding = new CampaignFounding({ seed: SEED, unlockedArchetypes: ARCHETYPES, generate });
			founding.cancel();
			expect(await outcome(founding.result)).toBeInstanceOf(MapGenerationCancelled);
		});
	});
});
