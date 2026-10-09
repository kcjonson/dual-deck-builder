import { Rng } from '../core/Rng';
import {
	MAP_ATTEMPTS, MapPipeline, MapPipelineError, MapStage, PipelineRunOptions, Problems, SEED_ATTEMPTS, STAGE_ATTEMPTS, StageAttempt,
} from './MapPipeline';

/** What a test stage makes: the stream it ran on and its first draw. */
interface Drawn {
	readonly stream: number;
	readonly value: number;
}

/** Decides an attempt's problems from where it is; nothing passes. */
type Script = (attempt: StageAttempt) => Problems;

interface Run {
	readonly stage: string;
	readonly stream: number;
	readonly upstream: object;
}

/**
 * Stages a, b, and c (and d when asked), each drawing once from its stream,
 * failing as its script says. The current attempt reaches the scripts
 * through progress, which the runner reports just before each run.
 */
function harness({ fails = {}, localRetry = [], extraDraws = 0, withD = false }: {
	fails?: Record<string, Script>;
	localRetry?: string[];
	extraDraws?: number;
	withD?: boolean;
} = {}) {
	let current: StageAttempt | null = null;
	const runs: Run[] = [];
	const progress: StageAttempt[] = [];
	const make = <Name extends string>(name: Name): MapStage<null, object, Name, Drawn> => ({
		name,
		localRetry: localRetry.includes(name),
		run: ({ rng, products }) => {
			runs.push({ stage: name, stream: rng.seed, upstream: products });
			const value = rng.next();
			for (let draw = 0; draw < extraDraws; draw += 1) rng.next();
			return { stream: rng.seed, value };
		},
		check: () => fails[name]?.(current as StageAttempt) ?? [],
	});
	const three = new MapPipeline<null>().stage(make('a')).stage(make('b')).stage(make('c'));
	const pipeline = withD ? three.stage(make('d')) : three;
	const warn = jest.fn();
	const run = (options: Partial<PipelineRunOptions<null, object>> = {}) => pipeline.run({
		seed: 7,
		input: null,
		debug: true,
		warn,
		...options,
		onProgress: (attempt) => {
			current = attempt;
			progress.push(attempt);
		},
	});
	return { run, runs, progress, warn };
}

/** The stream the runner should give a stage: the map attempt's, forked down the chain of winners. */
function stream(seed: number, mapAttempt: number, ...chain: [string, number][]): number {
	return chain.reduce((rng, [name, attempt]) => rng.fork(name, attempt), new Rng({ seed }).fork('map', mapAttempt)).seed;
}

/** Fails the stage's attempts listed, in the first map attempt on seed 7. */
const failing = (...attempts: number[]): Script => ({ attempt, mapAttempt, seed }) => (seed === 7 && mapAttempt === 0 && attempts.includes(attempt) ? [`attempt ${attempt} fails`] : []);
const always: Script = () => ['always fails'];

describe('MapPipeline', () => {
	describe('streams', () => {
		it('nests each stage\'s stream in its upstream\'s winning one', () => {
			const { products, streams, attempts, mapAttempt, seed } = harness().run();
			expect({ seed, mapAttempt, attempts }).toEqual({ seed: 7, mapAttempt: 0, attempts: { a: 0, b: 0, c: 0 } });
			expect(streams).toEqual({
				a: stream(7, 0, ['a', 0]),
				b: stream(7, 0, ['a', 0], ['b', 0]),
				c: stream(7, 0, ['a', 0], ['b', 0], ['c', 0]),
			});
			expect(products.c).toEqual({ stream: streams.c, value: new Rng({ seed: streams.c }).next() });
		});

		it('gives a stage a stream that depends only on its upstream\'s winning streams, not on their draws or failed attempts', () => {
			const plain = harness({ fails: { b: failing(0) } }).run();
			const drawing = harness({ fails: { b: failing(0) }, extraDraws: 50 }).run();
			const failingMore = harness({ fails: { a: failing(0, 1), b: failing(0) } }).run();
			expect(plain.attempts).toEqual({ a: 0, b: 1, c: 0 });
			expect(plain.streams.c).toBe(stream(7, 0, ['a', 0], ['b', 1], ['c', 0]));
			// Upstream drawing more moves nothing below it.
			expect(drawing.streams).toEqual(plain.streams);
			// A rerun upstream does, and to exactly the chain of winners.
			expect(failingMore.streams.c).toBe(stream(7, 0, ['a', 2], ['b', 1], ['c', 0]));
		});

		it('counts attempts per stage from 0, so numbers never collide across stages', () => {
			const { run, runs } = harness({ fails: { a: failing(0), b: failing(0, 1), c: failing(0) } });
			const { attempts, failures, streams } = run();
			expect(attempts).toEqual({ a: 1, b: 2, c: 1 });
			expect(failures.map(({ stage, attempt }) => `${stage}${attempt}`)).toEqual(['a0', 'b0', 'b1', 'c0']);
			expect(failures[1].problems).toEqual(['attempt 0 fails']);
			// Every attempt ran on a stream of its own.
			expect(new Set(runs.map(({ stream: seed }) => seed)).size).toBe(runs.length);
			expect(runs.map(({ stage, stream: seed }) => ({ stage, seed }))).toEqual([
				{ stage: 'a', seed: stream(7, 0, ['a', 0]) },
				{ stage: 'a', seed: stream(7, 0, ['a', 1]) },
				{ stage: 'b', seed: stream(7, 0, ['a', 1], ['b', 0]) },
				{ stage: 'b', seed: stream(7, 0, ['a', 1], ['b', 1]) },
				{ stage: 'b', seed: stream(7, 0, ['a', 1], ['b', 2]) },
				{ stage: 'c', seed: stream(7, 0, ['a', 1], ['b', 2], ['c', 0]) },
				{ stage: 'c', seed: stream(7, 0, ['a', 1], ['b', 2], ['c', 1]) },
			]);
			expect(streams.c).toBe(runs[runs.length - 1].stream);
		});

		it('gives every later stage fresh streams after an upstream rerun or a map restart', () => {
			const first = harness().run();
			const rerun = harness({ fails: { a: failing(0) } }).run();
			expect(rerun.streams.b).not.toBe(first.streams.b);
			expect(rerun.streams.c).not.toBe(first.streams.c);

			// b runs out in map attempt 0, so map attempt 1 starts over on streams none of map 0's attempts used.
			const { run, runs } = harness({ fails: { b: ({ mapAttempt }) => (mapAttempt === 0 ? ['no'] : []) } });
			const restarted = run();
			expect(restarted.mapAttempt).toBe(1);
			expect(restarted.attempts).toEqual({ a: 0, b: 0, c: 0 });
			const used = new Set(runs.slice(0, 1 + STAGE_ATTEMPTS).map(({ stream: seed }) => seed));
			Object.values(restarted.streams).forEach((seed) => expect(used.has(seed)).toBe(false));
			expect(restarted.streams.c).toBe(stream(7, 1, ['a', 0], ['b', 0], ['c', 0]));
		});
	});

	describe('retries', () => {
		it('reruns a failing stage on its upstream\'s products, never recomputing them', () => {
			const { run, runs } = harness({ fails: { b: failing(0, 1, 2) } });
			const { products } = run();
			expect(runs.filter(({ stage }) => stage === 'a')).toHaveLength(1);
			const rerunsOfB = runs.filter(({ stage }) => stage === 'b');
			expect(rerunsOfB).toHaveLength(4);
			rerunsOfB.forEach(({ upstream }) => expect((upstream as { a: Drawn }).a).toBe(products.a));
		});

		it('restarts the whole map on its next attempt once a stage fails its eighth', () => {
			const { run, runs } = harness({ fails: { b: ({ mapAttempt }) => (mapAttempt < 2 ? ['no'] : []) } });
			const { mapAttempt, failures } = run();
			expect(mapAttempt).toBe(2);
			expect(failures).toHaveLength(2 * STAGE_ATTEMPTS);
			expect(failures.map(({ attempt }) => attempt)).toEqual([...Array(STAGE_ATTEMPTS).keys(), ...Array(STAGE_ATTEMPTS).keys()]);
			// a ran once a map attempt, b eight times in each failed one.
			expect(runs.filter(({ stage }) => stage === 'a')).toHaveLength(3);
			expect(runs.filter(({ stage }) => stage === 'b')).toHaveLength(2 * STAGE_ATTEMPTS + 1);
		});

		it('lets the accept hook reject a stage\'s output after its own checks, as a failure of that stage', () => {
			const calls: { stages: string[]; attempt: StageAttempt }[] = [];
			const { attempts, failures } = harness({ fails: { c: failing(0) } }).run({
				accept: (map, attempt) => {
					calls.push({ stages: Object.keys(map), attempt });
					return attempt.stage === 'b' && attempt.attempt < 2 ? [`rejected b${attempt.attempt}`] : [];
				},
			});
			expect(attempts).toEqual({ a: 0, b: 2, c: 1 });
			expect(failures.map(({ stage, attempt, problems }) => `${stage}${attempt}: ${problems.join()}`)).toEqual([
				'b0: rejected b0', 'b1: rejected b1', 'c0: attempt 0 fails',
			]);
			// Called with the map so far, this stage's output in it, and never after a failed check.
			expect(calls.map(({ stages, attempt }) => `${attempt.stage}${attempt.attempt}: ${stages.join()}`)).toEqual([
				'a0: a', 'b0: a,b', 'b1: a,b', 'b2: a,b', 'c1: a,b,c',
			]);
			expect(calls[1].attempt).toEqual({ stage: 'b', index: 1, count: 3, attempt: 0, mapAttempt: 0, seed: 7 });
		});
	});

	describe('caps', () => {
		it('throws in a debug build when the map runs out of attempts, naming the last failure', () => {
			const { run, runs } = harness({ fails: { b: always } });
			let thrown: unknown = null;
			try {
				run();
			} catch (error) {
				thrown = error;
			}
			expect(thrown).toBeInstanceOf(MapPipelineError);
			const { failure, message } = thrown as MapPipelineError;
			expect(failure).toEqual({ stage: 'b', index: 1, count: 3, attempt: STAGE_ATTEMPTS - 1, mapAttempt: MAP_ATTEMPTS - 1, seed: 7, problems: ['always fails'] });
			expect(message).toContain(`seed 7 failed ${MAP_ATTEMPTS} map attempts`);
			expect(runs.filter(({ stage }) => stage === 'b')).toHaveLength(STAGE_ATTEMPTS * MAP_ATTEMPTS);
		});

		it('takes the next seed in a release build, and says so', () => {
			const { run, warn } = harness({ fails: { b: ({ seed }) => (seed === 7 ? ['seed 7 never works'] : []) } });
			const { seed, mapAttempt, streams } = run({ debug: false });
			expect(seed).toBe(8);
			expect(mapAttempt).toBe(0);
			expect(streams.c).toBe(stream(8, 0, ['a', 0], ['b', 0], ['c', 0]));
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls[0][0]).toMatch(/seed 7 failed 32 map attempts.*Taking seed 8/);
		});

		it('wraps the next seed round uint32, and gives up in release too after every seed it may try', () => {
			const { run, warn } = harness({ fails: { b: always } });
			expect(() => run({ debug: false, seed: 0xffffffff })).toThrow(MapPipelineError);
			expect(warn).toHaveBeenCalledTimes(SEED_ATTEMPTS - 1);
			expect(warn.mock.calls[0][0]).toMatch(/Taking seed 0\./);
		});

		it('follows the build: __DEV_TOOLS__ is a debug build', () => {
			const { run } = harness({ fails: { b: always } });
			expect(() => run({ debug: undefined })).toThrow(MapPipelineError);
		});

		it('retries a local-retry stage alone, never restarting the map', () => {
			const { run, runs } = harness({ fails: { c: failing(0, 1, 2, 3, 4, 5, 6) }, localRetry: ['c'] });
			const { attempts, mapAttempt, keptFailing } = run();
			expect(attempts).toEqual({ a: 0, b: 0, c: 7 });
			expect(mapAttempt).toBe(0);
			expect(keptFailing).toEqual([]);
			expect(runs.filter(({ stage }) => stage !== 'c')).toHaveLength(2);
		});

		it('throws past a local-retry stage\'s cap in a debug build, without restarting the map', () => {
			const { run, runs } = harness({ fails: { c: always }, localRetry: ['c'] });
			expect(() => run()).toThrow(/c \(attempt 7, map attempt 0\): always fails after 8 attempts/);
			expect(runs.filter(({ stage }) => stage === 'a')).toHaveLength(1);
		});

		it('keeps a local-retry stage\'s best attempt in a release build, and later stages nest in it', () => {
			// Attempt 5 has the fewest problems; attempt 6 ties it and loses to the earlier.
			const fewest = ({ attempt }: StageAttempt) => (attempt === 5 || attempt === 6 ? ['one'] : ['one', 'two']);
			const { run, warn, runs } = harness({ fails: { c: fewest }, localRetry: ['c'], withD: true });
			const result = run({ debug: false });
			expect(result.attempts).toEqual({ a: 0, b: 0, c: 5, d: 0 });
			expect(result.keptFailing).toEqual(['c']);
			expect(result.mapAttempt).toBe(0);
			expect(result.products.c).toEqual({ stream: stream(7, 0, ['a', 0], ['b', 0], ['c', 5]), value: expect.any(Number) });
			expect((result.streams as Record<string, number>).d).toBe(stream(7, 0, ['a', 0], ['b', 0], ['c', 5], ['d', 0]));
			expect(runs.filter(({ stage }) => stage === 'c')).toHaveLength(STAGE_ATTEMPTS);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls[0][0]).toMatch(/keeping attempt 5/);
		});
	});

	it('reports progress as each attempt starts, and times every run and check', () => {
		let clock = 0;
		const { run, progress } = harness({ fails: { b: failing(0) } });
		const { timings, milliseconds } = run({ now: () => (clock += 1) });
		expect(progress.map(({ stage, index, count, attempt }) => `${stage} ${index}/${count} attempt ${attempt}`)).toEqual([
			'a 0/3 attempt 0', 'b 1/3 attempt 0', 'b 1/3 attempt 1', 'c 2/3 attempt 0',
		]);
		// Each attempt reads the clock three times: before its run, after it, and after its checks.
		expect(timings).toEqual({
			a: { runs: 1, milliseconds: 1, checkMilliseconds: 1 },
			b: { runs: 2, milliseconds: 2, checkMilliseconds: 2 },
			c: { runs: 1, milliseconds: 1, checkMilliseconds: 1 },
		});
		expect(milliseconds).toBe(3 * 4 + 1);
	});

	it('makes the same map from the same seed and input, and another from another seed', () => {
		const fixed = () => {
			let clock = 0;
			return harness({ fails: { a: failing(1), b: failing(0) } }).run({ now: () => (clock += 1) });
		};
		expect(fixed()).toEqual(fixed());
		expect(harness().run({ seed: 8 }).streams).not.toEqual(harness().run().streams);
	});

	it('refuses two stages with one name', () => {
		const stage: MapStage<null, object, 'a', number> = { name: 'a', run: () => 1 };
		expect(() => new MapPipeline<null>().stage(stage).stage(stage)).toThrow(RangeError);
		expect(new MapPipeline<null>().stage(stage).stageNames).toEqual(['a']);
	});
});
