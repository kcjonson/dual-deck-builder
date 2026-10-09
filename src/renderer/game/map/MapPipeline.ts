import { Rng } from '../core/Rng';

/**
 * The area map generator's pipeline runner (Area Map Generation, Seeds and
 * determinism, and Validation and retries): stages in order, each on a
 * stream nested in its upstream's winning stream, each checked, retried, and
 * timed. Plain and synchronous, so the same code runs in the generation
 * worker, in-process under Jest, and in Node scripts. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/map-pipeline-worker.md.
 */

/** Attempts a stage gets in one map attempt, before the map restarts or, for a local-retry stage, before it gives up. */
export const STAGE_ATTEMPTS = 8;
/** Map attempts on one seed before a debug build throws and a release build takes the next seed. */
export const MAP_ATTEMPTS = 32;
/** Seeds a release build tries, the one asked for and those after it, before it throws too. */
export const SEED_ATTEMPTS = 4;

/** What a stage's checks or the accept hook found wrong with its output. Empty passes. */
export type Problems = readonly string[];

/** One attempt at one stage: what progress reports and the accept hook is told. */
export interface StageAttempt {
	readonly stage: string;
	/** The stage's place in the pipeline, from 0, and how many stages there are. */
	readonly index: number;
	readonly count: number;
	/** This stage's attempt, from 0, counted afresh in each map attempt. */
	readonly attempt: number;
	readonly mapAttempt: number;
	/** The root seed this map attempt runs on. */
	readonly seed: number;
}

/** A stage's upstream, as its run and its checks see it. */
export interface StageInputs<Input, Upstream> {
	/** What the whole pipeline was given: for the area map, its validated params. */
	readonly input: Input;
	/** Every earlier stage's winning output, by stage name. */
	readonly products: Upstream;
}

export interface StageContext<Input, Upstream> extends StageInputs<Input, Upstream> {
	/** This attempt's stream: the upstream's winning stream forked with the stage's name and attempt. */
	readonly rng: Rng;
}

/**
 * A stage: its output from its upstream and its own stream, and its own
 * checks. Methods rather than function properties, so a stage written for a
 * narrower upstream still fits a pipeline whose upstream carries more.
 */
export interface MapStage<Input, Upstream, Name extends string, Product> {
	/** Names its stream and its output; unique in a pipeline. */
	readonly name: Name;
	/**
	 * Retries only itself and never restarts the map (stops and dressing).
	 * Past its cap a debug build throws and a release build logs and keeps
	 * its best attempt, the one with the fewest problems.
	 */
	readonly localRetry?: boolean;
	run(context: StageContext<Input, Upstream>): Product;
	/** What's wrong with the output, nothing when it passes. */
	check?(product: Product, inputs: StageInputs<Input, Upstream>): Problems;
}

/** Called after a stage's own checks pass; anything it returns rejects the stage's output, as a failed check would. */
export type AcceptHook<Products> = (map: Readonly<Partial<Products>>, stage: StageAttempt) => Problems;

export interface PipelineRunOptions<Input, Products> {
	/** The root seed; every stream forks from it. */
	readonly seed: number;
	readonly input: Input;
	readonly accept?: AcceptHook<Products>;
	/** Told as each stage attempt starts. */
	readonly onProgress?: (stage: StageAttempt) => void;
	/** Debug builds throw past a cap; release builds log and carry on. `__DEV_TOOLS__` when left out. */
	readonly debug?: boolean;
	/** Where a release build's warnings go: console.warn when left out. */
	readonly warn?: (message: string) => void;
	/** Milliseconds, for timings: performance.now when left out. */
	readonly now?: () => number;
}

export interface StageTiming {
	/** Every attempt this stage ran, across every map attempt and seed. */
	readonly runs: number;
	/** Spent in its run... */
	readonly milliseconds: number;
	/** ...and in its checks and the accept hook. */
	readonly checkMilliseconds: number;
}

/** An attempt that failed its checks or the accept hook. */
export interface StageFailure extends StageAttempt {
	readonly problems: Problems;
}

export interface PipelineResult<Products> {
	readonly products: Products;
	/** The seed the map came from: the one asked for, or past the map cap in a release build, one after it. */
	readonly seed: number;
	readonly mapAttempt: number;
	/** Each stage's winning attempt, in the winning map attempt. */
	readonly attempts: { readonly [Name in keyof Products]: number };
	/** Each stage's winning stream, as its seed: `new Rng({ seed })` replays it. */
	readonly streams: { readonly [Name in keyof Products]: number };
	readonly timings: { readonly [Name in keyof Products]: StageTiming };
	/** Every failed attempt, in the order they ran. */
	readonly failures: readonly StageFailure[];
	/** Local-retry stages a release build kept at their best attempt after every attempt failed. */
	readonly keptFailing: readonly (keyof Products & string)[];
	/** The whole run. */
	readonly milliseconds: number;
}

/** A debug build past a cap, or any build past every seed it may try. */
export class MapPipelineError extends Error {
	public readonly failure: StageFailure;

	constructor({ message, failure }: { message: string; failure: StageFailure }) {
		super(message);
		this.name = 'MapPipelineError';
		this.failure = failure;
	}
}

type AnyStage<Input> = MapStage<Input, object, string, unknown>;
type EmptyProducts = Record<never, never>;
type AnyProducts = Record<string, unknown>;
type RunOptions<Input> = PipelineRunOptions<Input, AnyProducts>;

interface MutableTiming {
	runs: number;
	milliseconds: number;
	checkMilliseconds: number;
}

/** A map attempt that ran out on a stage that restarts the map. */
interface MapOutcome {
	readonly failure: StageFailure | null;
}

/**
 * An ordered list of stages, built a stage at a time so each stage's
 * upstream is typed: `new MapPipeline<MapParams>().stage(terrain).stage(water)`.
 * Immutable; `stage` returns a new pipeline.
 */
export class MapPipeline<Input, Products extends object = EmptyProducts> {
	private readonly list: readonly AnyStage<Input>[];

	constructor({ stages = [] }: { stages?: readonly AnyStage<Input>[] } = {}) {
		this.list = stages;
	}

	public get stageNames(): readonly string[] {
		return this.list.map(({ name }) => name);
	}

	/** This pipeline with `stage` after its last. */
	public stage<Name extends string, Product>(stage: MapStage<Input, Products, Name, Product>): MapPipeline<Input, Products & { readonly [Key in Name]: Product }> {
		if (this.list.some(({ name }) => name === stage.name)) throw new RangeError(`MapPipeline: a stage named ${stage.name} is already in the pipeline`);
		return new MapPipeline({ stages: [...this.list, stage as AnyStage<Input>] });
	}

	public run(options: PipelineRunOptions<Input, Products>): PipelineResult<Products> {
		// The run works in records keyed by stage name; the builder's types are what make them Products.
		const run = new PipelineRun({ stages: this.list, options: options as unknown as RunOptions<Input> });
		return run.run() as unknown as PipelineResult<Products>;
	}
}

/** One call to `MapPipeline.run`: its state across seeds, map attempts, and stage attempts. */
class PipelineRun<Input> {
	private readonly stages: readonly AnyStage<Input>[];
	private readonly input: Input;
	private readonly accept: AcceptHook<AnyProducts> | undefined;
	private readonly onProgress: ((stage: StageAttempt) => void) | undefined;
	private readonly debug: boolean;
	private readonly warn: (message: string) => void;
	private readonly now: () => number;
	private readonly seed: number;

	private readonly timings: Record<string, MutableTiming> = {};
	private readonly failures: StageFailure[] = [];
	private products: AnyProducts = {};
	private attempts: Record<string, number> = {};
	private streams: Record<string, number> = {};
	private keptFailing: string[] = [];

	constructor({ stages, options }: { stages: readonly AnyStage<Input>[]; options: RunOptions<Input> }) {
		this.stages = stages;
		this.input = options.input;
		this.accept = options.accept;
		this.onProgress = options.onProgress;
		this.debug = options.debug ?? __DEV_TOOLS__;
		this.warn = options.warn ?? ((message) => console.warn(message));
		this.now = options.now ?? (() => performance.now());
		this.seed = options.seed >>> 0;
		for (const { name } of stages) this.timings[name] = { runs: 0, milliseconds: 0, checkMilliseconds: 0 };
	}

	public run(): PipelineResult<AnyProducts> {
		const started = this.now();
		for (let seedAttempt = 0; seedAttempt < SEED_ATTEMPTS; seedAttempt += 1) {
			const seed = (this.seed + seedAttempt) >>> 0;
			const root = new Rng({ seed });
			let failure: StageFailure | null = null;
			for (let mapAttempt = 0; mapAttempt < MAP_ATTEMPTS; mapAttempt += 1) {
				failure = this.runMap({ map: root.fork('map', mapAttempt), mapAttempt, seed }).failure;
				if (failure === null) {
					return {
						products: this.products,
						seed,
						mapAttempt,
						attempts: this.attempts,
						streams: this.streams,
						timings: this.timings,
						failures: this.failures,
						keptFailing: this.keptFailing,
						milliseconds: this.now() - started,
					};
				}
			}
			// Every map attempt failed, so the last left its failure.
			const last = failure as StageFailure;
			const message = `MapPipeline: seed ${seed} failed ${MAP_ATTEMPTS} map attempts; the last ran out on ${describeFailure(last)}`;
			if (this.debug || seedAttempt === SEED_ATTEMPTS - 1) throw new MapPipelineError({ message, failure: last });
			this.warn(`${message}. Taking seed ${(seed + 1) >>> 0}.`);
		}
		// The loop returns or throws on its last seed.
		throw new Error('MapPipeline: unreachable');
	}

	/** One map attempt: every stage in order, each on the stream nested in its upstream's winner. */
	private runMap({ map, mapAttempt, seed }: { map: Rng; mapAttempt: number; seed: number }): MapOutcome {
		this.products = {};
		this.attempts = {};
		this.streams = {};
		this.keptFailing = [];
		let upstream = map;
		for (let index = 0; index < this.stages.length; index += 1) {
			const stage = this.stages[index];
			let best: { attempt: number; rng: Rng; product: unknown; problems: Problems } | null = null;
			let winner: { attempt: number; rng: Rng; product: unknown } | null = null;
			let last: StageFailure | null = null;
			for (let attempt = 0; attempt < STAGE_ATTEMPTS && winner === null; attempt += 1) {
				const progress: StageAttempt = { stage: stage.name, index, count: this.stages.length, attempt, mapAttempt, seed };
				this.onProgress?.(progress);
				// fork reads only the parent's seed, so the draws a stage made from its stream never move its children's.
				const rng = upstream.fork(stage.name, attempt);
				const { product, problems } = this.attempt({ stage, rng, progress });
				if (problems.length === 0) {
					winner = { attempt, rng, product };
				} else {
					last = { ...progress, problems };
					this.failures.push(last);
					if (best === null || problems.length < best.problems.length) best = { attempt, rng, product, problems };
				}
			}
			if (winner === null) {
				const failure = last as StageFailure;
				if (!stage.localRetry) return { failure };
				const message = `MapPipeline: ${describeFailure(failure)} after ${STAGE_ATTEMPTS} attempts`;
				if (this.debug) throw new MapPipelineError({ message, failure });
				const kept = best as { attempt: number; rng: Rng; product: unknown };
				this.warn(`${message}; keeping attempt ${kept.attempt}`);
				this.keptFailing.push(stage.name);
				winner = kept;
			}
			this.products[stage.name] = winner.product;
			this.attempts[stage.name] = winner.attempt;
			this.streams[stage.name] = winner.rng.seed;
			upstream = winner.rng;
		}
		return { failure: null };
	}

	/** One attempt at one stage: its run, then its checks, then the accept hook if they passed, each timed. */
	private attempt({ stage, rng, progress }: { stage: AnyStage<Input>; rng: Rng; progress: StageAttempt }): { product: unknown; problems: Problems } {
		const timing = this.timings[stage.name];
		const inputs: StageInputs<Input, object> = { input: this.input, products: this.products };
		const started = this.now();
		const product = stage.run({ ...inputs, rng });
		const ran = this.now();
		let problems: Problems = stage.check?.(product, inputs) ?? [];
		if (problems.length === 0 && this.accept) problems = this.accept({ ...this.products, [stage.name]: product }, progress);
		timing.runs += 1;
		timing.milliseconds += ran - started;
		timing.checkMilliseconds += this.now() - ran;
		return { product, problems };
	}
}

function describeFailure({ stage, attempt, mapAttempt, problems }: StageFailure): string {
	const shown = problems.slice(0, 3).join('; ');
	const more = problems.length > 3 ? ` and ${problems.length - 3} more` : '';
	return `${stage} (attempt ${attempt}, map attempt ${mapAttempt}): ${shown}${more}`;
}
