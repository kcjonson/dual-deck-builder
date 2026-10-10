import { Rng } from '../core/Rng';
import { MAP_ATTEMPTS, MapPipeline, MapPipelineError, MapStage, PipelineRunOptions, Problems, STAGE_ATTEMPTS, StageAttempt } from './MapPipeline';

/** What a test stage makes: the stream it ran on and its first draw. */
interface Drawn {
	readonly stream: number;
	readonly value: number;
}

type Drawns = Record<string, Drawn>;

/** Decides an attempt's problems from where it is and what's upstream; nothing passes. */
type Script = (attempt: StageAttempt, upstream: Drawns) => Problems;

interface Spec {
	readonly name: string;
	readonly fails?: Script;
	readonly localRetry?: boolean;
	readonly attempts?: number;
	readonly escalate?: string;
}

interface Run {
	readonly stage: string;
	readonly stream: number;
	readonly attempt: StageAttempt;
	readonly upstream: Drawns;
}

/** Stages a, b, and c, with whatever each one's spec adds. */
const abc = (specs: Record<string, Omit<Spec, 'name'>> = {}): Spec[] => ['a', 'b', 'c'].map((name) => ({ name, ...specs[name] }));

/**
 * A pipeline of stages that each draw once from their stream (and `extraDraws`
 * more), failing as their scripts say. The current attempt reaches the
 * scripts through progress, which the runner reports just before each run.
 */
function harness({ stages = abc(), extraDraws = 0 }: { stages?: Spec[]; extraDraws?: number } = {}) {
	let current: StageAttempt | null = null;
	const runs: Run[] = [];
	const progress: StageAttempt[] = [];
	let pipeline = new MapPipeline<null, Drawns>();
	for (const { name, fails, localRetry, attempts, escalate } of stages) {
		const stage: MapStage<null, Drawns, string, Drawn> = {
			name,
			localRetry,
			attempts,
			escalate,
			run: ({ rng, products }) => {
				runs.push({ stage: name, stream: rng.seed, attempt: current as StageAttempt, upstream: products });
				const value = rng.next();
				for (let draw = 0; draw < extraDraws; draw += 1) rng.next();
				return { stream: rng.seed, value };
			},
			check: (_product, { products }) => fails?.(current as StageAttempt, products) ?? [],
		};
		pipeline = pipeline.stage(stage) as unknown as MapPipeline<null, Drawns>;
	}
	const warn = jest.fn();
	const run = (options: Partial<PipelineRunOptions<null, Drawns>> = {}) => pipeline.run({
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
	const runsOf = (name: string) => runs.filter(({ stage }) => stage === name);
	return { run, runs, runsOf, progress, warn };
}

/** The stream the runner should give a stage: the map attempt's, forked down the chain of winners. */
function stream(seed: number, mapAttempt: number, ...chain: [string, number][]): number {
	return chain.reduce((rng, [name, attempt]) => rng.fork(name, attempt), new Rng({ seed }).fork('map', mapAttempt)).seed;
}

/** Fails the stage's attempts listed, in the first map attempt. */
const failing = (...attempts: number[]): Script => ({ attempt, mapAttempt }) => (mapAttempt === 0 && attempts.includes(attempt) ? [`attempt ${attempt} fails`] : []);
const always: Script = () => ['always fails'];

function thrown(action: () => unknown): unknown {
	try {
		action();
	} catch (error) {
		return error;
	}
	return null;
}

describe('MapPipeline', () => {
	describe('streams', () => {
		it('nests each stage\'s stream in its upstream\'s winning one', () => {
			const { products, streams, attempts, mapAttempt } = harness().run();
			expect({ mapAttempt, attempts }).toEqual({ mapAttempt: 0, attempts: { a: 0, b: 0, c: 0 } });
			expect(streams).toEqual({
				a: stream(7, 0, ['a', 0]),
				b: stream(7, 0, ['a', 0], ['b', 0]),
				c: stream(7, 0, ['a', 0], ['b', 0], ['c', 0]),
			});
			expect(products.c).toEqual({ stream: streams.c, value: new Rng({ seed: streams.c }).next() });
		});

		it('gives a stage a stream that depends only on its upstream\'s winning streams, not on their draws or failed attempts', () => {
			const plain = harness({ stages: abc({ b: { fails: failing(0) } }) }).run();
			const drawing = harness({ stages: abc({ b: { fails: failing(0) } }), extraDraws: 50 }).run();
			const failingMore = harness({ stages: abc({ a: { fails: failing(0, 1) }, b: { fails: failing(0) } }) }).run();
			expect(plain.attempts).toEqual({ a: 0, b: 1, c: 0 });
			expect(plain.streams.c).toBe(stream(7, 0, ['a', 0], ['b', 1], ['c', 0]));
			// Upstream drawing more moves nothing below it.
			expect(drawing.streams).toEqual(plain.streams);
			// A rerun upstream does, and to exactly the chain of winners.
			expect(failingMore.streams.c).toBe(stream(7, 0, ['a', 2], ['b', 1], ['c', 0]));
		});

		it('counts attempts per stage from 0, so numbers never collide across stages, even names that nest', () => {
			const { run, runs } = harness({ stages: ['a', 'ab', 'map'].map((name) => ({ name, fails: failing(0) })) });
			const { attempts, failures, streams } = run();
			expect(attempts).toEqual({ a: 1, ab: 1, map: 1 });
			expect(failures.map(({ stage, attempt }) => `${stage}${attempt}`)).toEqual(['a0', 'ab0', 'map0']);
			expect(runs.map(({ stage, stream: seed }) => ({ stage, seed }))).toEqual([
				{ stage: 'a', seed: stream(7, 0, ['a', 0]) },
				{ stage: 'a', seed: stream(7, 0, ['a', 1]) },
				{ stage: 'ab', seed: stream(7, 0, ['a', 1], ['ab', 0]) },
				{ stage: 'ab', seed: stream(7, 0, ['a', 1], ['ab', 1]) },
				{ stage: 'map', seed: stream(7, 0, ['a', 1], ['ab', 1], ['map', 0]) },
				{ stage: 'map', seed: stream(7, 0, ['a', 1], ['ab', 1], ['map', 1]) },
			]);
			expect(new Set(runs.map(({ stream: seed }) => seed)).size).toBe(runs.length);
			expect(streams.map).toBe(runs[runs.length - 1].stream);
		});

		it('gives every later stage fresh streams after an upstream rerun or a map restart', () => {
			const first = harness().run();
			const rerun = harness({ stages: abc({ a: { fails: failing(0) } }) }).run();
			expect(rerun.streams.b).not.toBe(first.streams.b);
			expect(rerun.streams.c).not.toBe(first.streams.c);

			// b runs out in map attempt 0, so map attempt 1 starts over on streams none of map 0's attempts used.
			const { run, runs } = harness({ stages: abc({ b: { fails: ({ mapAttempt }) => (mapAttempt === 0 ? ['no'] : []) } }) });
			const restarted = run();
			expect(restarted.mapAttempt).toBe(1);
			expect(restarted.attempts).toEqual({ a: 0, b: 0, c: 0 });
			const used = new Set(runs.slice(0, 1 + STAGE_ATTEMPTS).map(({ stream: seed }) => seed));
			Object.values(restarted.streams).forEach((seed) => expect(used.has(seed)).toBe(false));
			expect(restarted.streams.c).toBe(stream(7, 1, ['a', 0], ['b', 0], ['c', 0]));
		});

		it('never gives two attempts one stream, across every map attempt of a seed', () => {
			const { run, runs } = harness({ stages: abc({ b: { fails: always } }) });
			expect(thrown(() => run())).toBeInstanceOf(MapPipelineError);
			expect(runs).toHaveLength(MAP_ATTEMPTS * (1 + STAGE_ATTEMPTS));
			expect(new Set(runs.map(({ stream: seed }) => seed)).size).toBe(runs.length);
		});
	});

	describe('retries', () => {
		it('reruns a failing stage on its upstream\'s products, never recomputing them, and hands each stage a record of its own', () => {
			const { run, runsOf } = harness({ stages: abc({ b: { fails: failing(0, 1, 2) } }) });
			const { products } = run();
			expect(runsOf('a')).toHaveLength(1);
			expect(runsOf('b')).toHaveLength(4);
			runsOf('b').forEach(({ upstream }) => expect(upstream.a).toBe(products.a));
			// What a stage was handed holds its upstream and never gains what came after.
			expect(Object.keys(runsOf('a')[0].upstream)).toEqual([]);
			expect(Object.keys(runsOf('b')[0].upstream)).toEqual(['a']);
			expect(Object.keys(runsOf('c')[0].upstream)).toEqual(['a', 'b']);
		});

		it('restarts the whole map on its next attempt once a stage fails its eighth', () => {
			const { run, runsOf } = harness({ stages: abc({ b: { fails: ({ mapAttempt }) => (mapAttempt < 2 ? ['no'] : []) } }) });
			const { mapAttempt, failures } = run();
			expect(mapAttempt).toBe(2);
			expect(failures).toHaveLength(2 * STAGE_ATTEMPTS);
			expect(failures.map(({ attempt }) => attempt)).toEqual([...Array(STAGE_ATTEMPTS).keys(), ...Array(STAGE_ATTEMPTS).keys()]);
			expect(runsOf('a')).toHaveLength(3);
			expect(runsOf('b')).toHaveLength(2 * STAGE_ATTEMPTS + 1);
		});

		it('lets the accept hook reject a stage\'s output after its own checks, as a failure of that stage', () => {
			const calls: { stages: string[]; attempt: StageAttempt }[] = [];
			const { attempts, failures } = harness({ stages: abc({ c: { fails: failing(0) } }) }).run({
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

		it('lets a stage throw: a stage that throws has a bug, which no retry would fix', () => {
			const boom: MapStage<null, object, 'boom', number> = { name: 'boom', run: () => { throw new TypeError('stage bug'); } };
			expect(() => new MapPipeline<null>().stage(boom).run({ seed: 1, input: null, debug: false })).toThrow(TypeError);
		});
	});

	describe('attempts and escalation', () => {
		it('gives a stage the attempts it asks for: one for a stage whose every attempt would be the same', () => {
			const { run, runsOf } = harness({ stages: abc({ b: { attempts: 1, fails: ({ mapAttempt }) => (mapAttempt === 0 ? ['no'] : []) } }) });
			const { mapAttempt, failures } = run();
			expect(mapAttempt).toBe(1);
			expect(failures.map(({ stage, attempt, mapAttempt: map }) => `${stage}${attempt}@${map}`)).toEqual(['b0@0']);
			expect(runsOf('a')).toHaveLength(2);
		});

		it('reruns the stage a stage escalates to on its next attempt, and everything after it, instead of restarting the map', () => {
			// d can't work under b's first attempt, as POIs that can't seat their strongholds can't under one road network.
			const underFirstB = stream(7, 0, ['a', 0], ['b', 0]);
			const { run, runsOf } = harness({
				stages: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd', escalate: 'b', fails: (_attempt, upstream) => (upstream.b.stream === underFirstB ? ['no sites'] : []) }],
			});
			const { attempts, mapAttempt, streams, failures } = run();
			expect(mapAttempt).toBe(0);
			expect(attempts).toEqual({ a: 0, b: 1, c: 0, d: 0 });
			expect(streams.d).toBe(stream(7, 0, ['a', 0], ['b', 1], ['c', 0], ['d', 0]));
			expect(runsOf('a')).toHaveLength(1);
			expect(runsOf('b').map(({ attempt }) => attempt.attempt)).toEqual([0, 1]);
			// c reran after b, on a fresh stream from attempt 0, and d counted from 0 again.
			expect(runsOf('c').map(({ stream: seed }) => seed)).toEqual([stream(7, 0, ['a', 0], ['b', 0], ['c', 0]), stream(7, 0, ['a', 0], ['b', 1], ['c', 0])]);
			expect(runsOf('d').map(({ attempt }) => attempt.attempt)).toEqual([...Array(STAGE_ATTEMPTS).keys(), 0]);
			expect(failures).toHaveLength(STAGE_ATTEMPTS);
		});

		it('climbs to the next escalation when the stage it escalates to is out of attempts too, and past the last restarts the map', () => {
			const firstA = stream(7, 0, ['a', 0]);
			// b has one attempt and escalates to a; c escalates to b, and can't work under a's first attempt.
			const climbing = harness({
				stages: [{ name: 'a' }, { name: 'b', attempts: 1, escalate: 'a' }, { name: 'c', escalate: 'b', fails: (_attempt, upstream) => (upstream.a.stream === firstA ? ['no'] : []) }],
			});
			const climbed = climbing.run();
			expect({ mapAttempt: climbed.mapAttempt, attempts: climbed.attempts }).toEqual({ mapAttempt: 0, attempts: { a: 1, b: 0, c: 0 } });
			expect(climbing.runsOf('c')).toHaveLength(STAGE_ATTEMPTS + 1);

			// b has two attempts and escalates nowhere, so once c has failed under both, the map restarts.
			const restarting = harness({
				stages: [{ name: 'a' }, { name: 'b', attempts: 2 }, { name: 'c', escalate: 'b', fails: ({ mapAttempt }) => (mapAttempt === 0 ? ['no'] : []) }],
			});
			const restarted = restarting.run();
			expect(restarted.mapAttempt).toBe(1);
			expect(restarting.runsOf('b').filter(({ attempt }) => attempt.mapAttempt === 0)).toHaveLength(2);
			expect(restarting.runsOf('c').filter(({ attempt }) => attempt.mapAttempt === 0)).toHaveLength(2 * STAGE_ATTEMPTS);
		});

		it('refuses an escalation it can\'t make, and a stage with no attempts', () => {
			const plain = (name: string, extra: Partial<MapStage<null, Drawns, string, number>> = {}): MapStage<null, Drawns, string, number> => ({ name, run: () => 1, ...extra });
			const ab = new MapPipeline<null, Drawns>().stage(plain('a')).stage(plain('b')) as unknown as MapPipeline<null, Drawns>;
			expect(() => ab.stage(plain('c', { escalate: 'z' }))).toThrow(/isn't upstream/);
			expect(() => ab.stage(plain('c', { escalate: 'c' }))).toThrow(/isn't upstream/);
			const local = ab.stage(plain('stops', { localRetry: true })) as unknown as MapPipeline<null, Drawns>;
			expect(() => local.stage(plain('dressing', { escalate: 'stops' }))).toThrow(/local-retry/);
			expect(() => ab.stage(plain('stops', { localRetry: true, escalate: 'a' }))).toThrow(/local-retry/);
			expect(() => ab.stage(plain('c', { attempts: 0 }))).toThrow(RangeError);
			expect(() => ab.stage(plain('c', { attempts: 1.5 }))).toThrow(RangeError);
		});
	});

	describe('caps', () => {
		it('throws when the map runs out of attempts, naming the last failure, in a debug build and a release build alike', () => {
			for (const debug of [true, false]) {
				const { run, runsOf, warn } = harness({ stages: abc({ b: { fails: always } }) });
				const error = thrown(() => run({ debug }));
				expect(error).toBeInstanceOf(MapPipelineError);
				const { failure, exhausted, message } = error as MapPipelineError;
				expect(exhausted).toBe('map');
				expect(failure).toEqual({ stage: 'b', index: 1, count: 3, attempt: STAGE_ATTEMPTS - 1, mapAttempt: MAP_ATTEMPTS - 1, seed: 7, problems: ['always fails'] });
				expect(message).toContain(`seed 7 failed ${MAP_ATTEMPTS} map attempts`);
				expect(runsOf('b')).toHaveLength(STAGE_ATTEMPTS * MAP_ATTEMPTS);
				// The seed it was given is the only one it runs; taking another is founding's call.
				expect(new Set(runsOf('b').map(({ attempt }) => attempt.seed))).toEqual(new Set([7]));
				expect(warn).not.toHaveBeenCalled();
			}
		});

		it('retries a local-retry stage alone, never restarting the map', () => {
			const { run, runs } = harness({ stages: abc({ c: { localRetry: true, fails: failing(0, 1, 2, 3, 4, 5, 6) } }) });
			const { attempts, mapAttempt, keptFailing } = run();
			expect(attempts).toEqual({ a: 0, b: 0, c: 7 });
			expect(mapAttempt).toBe(0);
			expect(keptFailing).toEqual([]);
			expect(runs.filter(({ stage }) => stage !== 'c')).toHaveLength(2);
		});

		it('throws past a local-retry stage\'s cap in a debug build, which __DEV_TOOLS__ makes the default, without restarting the map', () => {
			const { run, runsOf } = harness({ stages: abc({ c: { localRetry: true, fails: always } }) });
			const error = thrown(() => run({ debug: undefined }));
			expect(error).toBeInstanceOf(MapPipelineError);
			expect((error as MapPipelineError).exhausted).toBe('stage');
			expect((error as Error).message).toMatch(/c \(attempt 7, map attempt 0\): always fails after 8 attempts/);
			expect(runsOf('a')).toHaveLength(1);
		});

		it('keeps a local-retry stage\'s best attempt in a release build, and later stages nest in it', () => {
			// Attempt 5 has the fewest problems; attempt 6 ties it and loses to the earlier.
			const fewest: Script = ({ attempt }) => (attempt === 5 || attempt === 6 ? ['one'] : ['one', 'two']);
			const { run, warn, runsOf } = harness({ stages: [...abc({ c: { localRetry: true, fails: fewest } }), { name: 'd' }] });
			const result = run({ debug: false });
			expect(result.attempts).toEqual({ a: 0, b: 0, c: 5, d: 0 });
			expect(result.keptFailing).toEqual(['c']);
			expect(result.mapAttempt).toBe(0);
			expect(result.products.c).toEqual({ stream: stream(7, 0, ['a', 0], ['b', 0], ['c', 5]), value: expect.any(Number) });
			expect(result.streams.d).toBe(stream(7, 0, ['a', 0], ['b', 0], ['c', 5], ['d', 0]));
			expect(runsOf('c')).toHaveLength(STAGE_ATTEMPTS);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls[0][0]).toMatch(/keeping attempt 5/);
		});
	});

	describe('replay', () => {
		it('makes a map again from its map attempt and stage attempts, each stage run once on the attempt that won it', () => {
			// b runs out in map attempt 0 and wins its third in map attempt 1, so the replay has to land on both.
			const scripted = (stages?: Spec[]) => harness({ stages: stages ?? abc({ a: { fails: failing(1) }, b: { fails: ({ mapAttempt, attempt }) => (mapAttempt === 0 || attempt < 2 ? ['no'] : []) } }) });
			const made = scripted().run();
			expect({ mapAttempt: made.mapAttempt, attempts: made.attempts }).toEqual({ mapAttempt: 1, attempts: { a: 0, b: 2, c: 0 } });

			const { run, runs, progress } = scripted();
			const replayed = run({ replay: { mapAttempt: made.mapAttempt, attempts: made.attempts } });
			expect(replayed.products).toEqual(made.products);
			expect(replayed.streams).toEqual(made.streams);
			expect({ mapAttempt: replayed.mapAttempt, attempts: replayed.attempts, failures: replayed.failures, keptFailing: replayed.keptFailing })
				.toEqual({ mapAttempt: 1, attempts: made.attempts, failures: [], keptFailing: [] });
			expect(runs.map(({ stage, stream: seed }) => ({ stage, seed }))).toEqual(['a', 'b', 'c'].map((stage) => ({ stage, seed: made.streams[stage] })));
			expect(progress.map(({ stage, index, attempt, mapAttempt }) => `${stage} ${index} attempt ${attempt} map ${mapAttempt}`)).toEqual([
				'a 0 attempt 0 map 1', 'b 1 attempt 2 map 1', 'c 2 attempt 0 map 1',
			]);
			expect(Object.values(replayed.timings).map(({ runs: count }) => count)).toEqual([1, 1, 1]);

			// Escalation reruns stages under a new upstream; the attempts the run kept still name the streams.
			const underFirstB = stream(7, 0, ['a', 0], ['b', 0]);
			const escalating = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd', escalate: 'b', fails: (_attempt: StageAttempt, upstream: Drawns) => (upstream.b.stream === underFirstB ? ['no sites'] : []) }];
			const escalated = scripted(escalating).run();
			expect(escalated.attempts).toEqual({ a: 0, b: 1, c: 0, d: 0 });
			expect(scripted(escalating).run({ replay: { mapAttempt: 0, attempts: escalated.attempts } }).streams).toEqual(escalated.streams);
		});

		it('checks nothing and calls no accept hook, since the attempts it replays passed them', () => {
			const made = harness().run();
			const accept = jest.fn(() => ['rejected']);
			const failingNow = harness({ stages: abc({ a: { fails: always }, b: { fails: always }, c: { fails: always } }) });
			const replayed = failingNow.run({ accept, replay: { mapAttempt: 0, attempts: made.attempts } });
			expect(replayed.products).toEqual(made.products);
			expect(accept).not.toHaveBeenCalled();
			expect(replayed.failures).toEqual([]);
			expect(Object.values(replayed.timings).map(({ checkMilliseconds }) => checkMilliseconds)).toEqual([0, 0, 0]);
		});

		it('refuses attempts that don\'t fit the pipeline, before running anything', () => {
			const { run, runs } = harness({ stages: abc({ b: { attempts: 2 } }) });
			const replay = (mapAttempt: number, attempts: Record<string, number>) => () => run({ replay: { mapAttempt, attempts } });
			expect(replay(0, { a: 0, b: 0 })).toThrow("MapPipeline: can't replay without c's attempt");
			expect(replay(0, { a: 0, b: 0, c: 0, z: 1 })).toThrow("MapPipeline: can't replay an attempt for z, which isn't a stage of this pipeline");
			expect(replay(0, { a: STAGE_ATTEMPTS, b: 0, c: 0 })).toThrow(`MapPipeline: can't replay a on attempt ${STAGE_ATTEMPTS}; it has ${STAGE_ATTEMPTS}`);
			expect(replay(0, { a: 0, b: 2, c: 0 })).toThrow("MapPipeline: can't replay b on attempt 2; it has 2");
			expect(replay(0, { a: 0, b: 0, c: 1.5 })).toThrow(RangeError);
			expect(replay(0, { a: -1, b: 0, c: 0 })).toThrow(RangeError);
			expect(replay(MAP_ATTEMPTS, { a: 0, b: 0, c: 0 })).toThrow(`MapPipeline: can't replay map attempt ${MAP_ATTEMPTS}; a run makes 0 to ${MAP_ATTEMPTS - 1}`);
			expect(replay(0.5, { a: 0, b: 0, c: 0 })).toThrow(RangeError);
			expect(runs).toEqual([]);
		});
	});

	it('reports progress as each attempt starts, and times every run and check', () => {
		let clock = 0;
		const { run, progress } = harness({ stages: abc({ b: { fails: failing(0) } }) });
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

	it('makes the same map from the same seed and input, from a fresh pipeline or the same one again, and another from another seed', () => {
		const clock = () => {
			let now = 0;
			return () => (now += 1);
		};
		const scripted = () => harness({ stages: abc({ a: { fails: failing(1) }, b: { fails: ({ mapAttempt, attempt }) => (mapAttempt === 0 || attempt < 2 ? ['no'] : []) } }) });
		const first = scripted().run({ now: clock() });
		expect(scripted().run({ now: clock() })).toEqual(first);
		const reused = scripted();
		expect(reused.run({ now: clock() })).toEqual(first);
		expect(reused.run({ now: clock() })).toEqual(first);
		expect(harness().run({ seed: 8 }).streams).not.toEqual(harness().run().streams);
		// Seeds wrap to uint32 the way the PRNG does.
		expect(harness().run({ seed: 7 + 2 ** 32 }).streams).toEqual(harness().run().streams);
	});

	it('refuses two stages with one name', () => {
		const stage: MapStage<null, object, 'a', number> = { name: 'a', run: () => 1 };
		expect(() => new MapPipeline<null>().stage(stage).stage(stage)).toThrow(RangeError);
		expect(new MapPipeline<null>().stage(stage).stageNames).toEqual(['a']);
	});
});
