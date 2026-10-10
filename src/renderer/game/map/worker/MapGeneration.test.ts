import { AreaMapStageName, generateAreaMap } from '../AreaMapPipeline';
import { MapPipelineError, StageAttempt, StageFailure } from '../MapPipeline';
import { paramsFor } from '../roadTesting';
import { MapGeneration, MapGenerationCancelled } from './MapGeneration';
import * as protocol from './mapGenerationProtocol';
import { describeGeneration, summarizeGeneration } from './mapGenerationHook';

const params = paramsFor({ seed: 9, environment: 'highDesert', radius: 700 });
const expected = generateAreaMap({ params });

/** Stands in for a dedicated worker: records what the client does, and lets a test reply or fail it. */
class FakeWorker {
	public onmessage: ((event: { data: protocol.WorkerReply }) => void) | null = null;
	public onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
	public onmessageerror: (() => void) | null = null;
	public readonly posted: unknown[] = [];
	public terminated = 0;

	public postMessage(message: unknown): void {
		this.posted.push(message);
	}

	public terminate(): void {
		this.terminated += 1;
	}

	public reply(data: protocol.WorkerReply): void {
		this.onmessage?.({ data });
	}

	public fail(message: string): jest.Mock {
		const preventDefault = jest.fn();
		this.onerror?.({ message, preventDefault });
		return preventDefault;
	}
}

/** Where the generation ends up, without a rejection going unhandled while a test looks elsewhere. */
function outcome(generation: MapGeneration): Promise<unknown> {
	return generation.result.then((map) => map, (error: unknown) => error);
}

const terrainAttempt: StageAttempt<AreaMapStageName> = { stage: 'terrain', index: 0, count: 4, attempt: 0, mapAttempt: 0, seed: 9 };

describe('MapGeneration', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('with no Worker, as under Jest', () => {
		it('generates in-process, a task after it\'s made, through the worker\'s transfer format', async () => {
			expect(typeof Worker).toBe('undefined');
			const progress: StageAttempt[] = [];
			const spawn = jest.fn(() => null);
			const generation = new MapGeneration({ params, onProgress: (attempt) => progress.push(attempt), spawn });
			expect(progress).toEqual([]);
			expect(generation.inWorker).toBe(false);
			const map = await generation.result;
			expect(spawn).not.toHaveBeenCalled();
			expect(generation.settled).toBe(true);
			expect(map.inWorker).toBe(false);
			expect(map.params).toBe(params);
			expect(map.products.growth).toEqual(expected.products.growth);
			expect(map.products.highways).toEqual(expected.products.highways);
			expect(map.streams).toEqual(expected.streams);
			expect(map.attempts).toEqual({ terrain: 0, water: 0, highways: 0, growth: 0 });
			expect(progress.map(({ stage, attempt }) => `${stage} ${attempt}`)).toEqual(['terrain 0', 'water 0', 'highways 0', 'growth 0']);
			expect(map.wallMilliseconds).toBeGreaterThanOrEqual(map.decodeMilliseconds);
		});

		it('never starts once cancelled, and rejects with MapGenerationCancelled', async () => {
			const transfer = jest.spyOn(protocol, 'generateTransfer');
			const generation = new MapGeneration({ params });
			generation.cancel();
			generation.cancel();
			expect(await outcome(generation)).toBeInstanceOf(MapGenerationCancelled);
			// The task it would have run has gone.
			await new Promise((resolve) => setTimeout(resolve, 5));
			expect(transfer).not.toHaveBeenCalled();
		});

		it('leaves no unhandled rejection behind a cancel nobody awaits', async () => {
			const unhandled = jest.fn();
			process.on('unhandledRejection', unhandled);
			try {
				new MapGeneration({ params }).cancel();
				await new Promise((resolve) => setTimeout(resolve, 10));
				expect(unhandled).not.toHaveBeenCalled();
			} finally {
				process.off('unhandledRejection', unhandled);
			}
		});

		it('rejects with what the pipeline threw', async () => {
			const failure: StageFailure = { stage: 'growth', index: 2, count: 3, attempt: 7, mapAttempt: 31, seed: 9, problems: ['disc'] };
			jest.spyOn(protocol, 'generateTransfer').mockImplementation(() => {
				throw new MapPipelineError({ message: 'ran out', failure, exhausted: 'map' });
			});
			const error = await outcome(new MapGeneration({ params }));
			expect(error).toBeInstanceOf(MapPipelineError);
			expect((error as MapPipelineError).failure).toBe(failure);
			expect((error as MapPipelineError).exhausted).toBe('map');
		});
	});

	describe('in a worker', () => {
		const globals = globalThis as unknown as { Worker?: unknown };
		beforeEach(() => {
			globals.Worker = FakeWorker;
		});
		afterEach(() => {
			delete globals.Worker;
		});

		function start(onProgress?: (attempt: StageAttempt) => void) {
			const worker = new FakeWorker();
			const generation = new MapGeneration({ params, onProgress, spawn: () => worker as unknown as Worker });
			return { worker, generation };
		}

		it('posts the params, passes progress on, decodes the map, and ends the worker', async () => {
			const progress: StageAttempt[] = [];
			const { worker, generation } = start((attempt) => progress.push(attempt));
			expect(generation.inWorker).toBe(true);
			expect(worker.posted).toEqual([{ params }]);
			worker.reply({ type: 'progress', progress: terrainAttempt });
			expect(progress).toEqual([terrainAttempt]);
			// A map of its own to send, since sending detaches the land's arrays.
			const { map: transfer, buffers } = protocol.encodeAreaMap(generateAreaMap({ params }));
			worker.reply({ type: 'done', map: structuredClone(transfer, { transfer: buffers }) });
			// Transferred, not copied: the sender's buffers are detached.
			expect(buffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
			const map = await generation.result;
			expect(map.inWorker).toBe(true);
			expect(map.products.growth).toEqual(expected.products.growth);
			expect(Array.from(map.products.terrain.surface.elevation)).toEqual(Array.from(expected.products.terrain.surface.elevation));
			expect(Array.from(map.products.water.lines.points)).toEqual(Array.from(expected.products.water.lines.points));
			expect(worker.terminated).toBe(1);
			// Anything after the end is ignored.
			worker.reply({ type: 'progress', progress: terrainAttempt });
			expect(progress).toHaveLength(1);
		});

		it('rejects with the worker\'s error, a MapPipelineError when the pipeline gave up', async () => {
			const failure: StageFailure = { stage: 'highways', index: 1, count: 3, attempt: 7, mapAttempt: 31, seed: 9, problems: ['none'] };
			const { worker, generation } = start();
			worker.reply({ type: 'failed', message: 'ran out', stack: 'at the worker', pipeline: { failure, exhausted: 'map' } });
			const error = await outcome(generation);
			expect(error).toBeInstanceOf(MapPipelineError);
			expect((error as MapPipelineError).failure).toEqual(failure);
			expect((error as MapPipelineError).exhausted).toBe('map');
			expect((error as Error).stack).toBe('at the worker');
			expect(worker.terminated).toBe(1);
		});

		it('generates in-process when the worker fails before it replies, as one whose chunk never loaded does', async () => {
			const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
			const { worker, generation } = start();
			expect(worker.fail('')).toHaveBeenCalled();
			expect(worker.terminated).toBe(1);
			expect(generation.inWorker).toBe(false);
			// The worker it gave up on can't settle the result any more.
			worker.reply({ type: 'failed', message: 'late', stack: null, pipeline: null });
			const map = await generation.result;
			expect(map.inWorker).toBe(false);
			expect(map.products.growth).toEqual(expected.products.growth);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0][0])).toMatch(/failed before it replied \(its script did not load\)/);
			expect(worker.terminated).toBe(1);
		});

		it('rejects when the worker fails after it has replied', async () => {
			const { worker, generation } = start();
			worker.reply({ type: 'progress', progress: terrainAttempt });
			worker.fail('out of memory');
			expect(String(await outcome(generation))).toMatch(/the worker failed: out of memory/);
			expect(worker.terminated).toBe(1);
		});

		it('terminates the worker on cancel and ignores what it sends after', async () => {
			const { worker, generation } = start();
			generation.cancel();
			expect(worker.terminated).toBe(1);
			worker.reply({ type: 'done', map: protocol.encodeAreaMap(expected).map });
			expect(await outcome(generation)).toBeInstanceOf(MapGenerationCancelled);
			generation.cancel();
			expect(worker.terminated).toBe(1);
		});

		it('generates in-process when the platform refuses a worker', async () => {
			const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
			const generation = new MapGeneration({ params, spawn: () => { throw new Error('SecurityError'); } });
			expect(generation.inWorker).toBe(false);
			const map = await generation.result;
			expect(map.products.growth).toEqual(expected.products.growth);
			expect(warn).toHaveBeenCalledTimes(1);
		});
	});

	it('sums a generation up in one line for the dev hook', async () => {
		const summary = summarizeGeneration(await new MapGeneration({ params }).result);
		expect(summary).toMatchObject({ seed: 9, environment: 'highDesert', radius: 700, inWorker: false, attempts: { terrain: 0, water: 0, highways: 0, growth: 0 }, mapAttempt: 0 });
		expect(summary.nodes).toBe(expected.products.growth.network.nodes.length);
		const line = describeGeneration(summary);
		expect(line).toMatch(/^Map generation, seed 9 highDesert radius 700, in-process: [\d.]+ ms wall, pipeline [\d.]+ ms \(terrain [\d.]+( \+ [\d.]+ checks)? \(attempt 0\), water [\d.]+( \+ [\d.]+ checks)? \(attempt 0\), highways/);
		expect(line).toMatch(/growth [\d.]+ \+ [\d.]+ checks \(attempt 0\); map attempt 0\), decode [\d.]+ ms; \d+ nodes, \d+ stretches$/);
	});
});
