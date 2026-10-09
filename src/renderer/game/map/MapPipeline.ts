import { Rng } from '../core/Rng';

/**
 * The area map generator's pipeline runner (Area Map Generation, Seeds and
 * determinism, and Validation and retries): stages in order, each on a
 * stream nested in its upstream's winning stream, each checked, retried, and
 * timed. Plain and synchronous, so the same code runs in the generation
 * worker, in-process under Jest, and in Node scripts. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/map-pipeline-worker.md.
 */

/** Attempts a stage gets, unless it sets its own, before it escalates, restarts the map, or gives up. */
export const STAGE_ATTEMPTS = 8;
/** Map attempts on one seed before the run throws, in every build; founding answers that with the next seed. */
export const MAP_ATTEMPTS = 32;

/** What a stage's checks or the accept hook found wrong with its output. Empty passes. */
export type Problems = readonly string[];

/** A pipeline's stage names, from its products. */
export type StageName<Products> = Extract<keyof Products, string>;

/** One attempt at one stage: what progress reports and the accept hook is told. */
export interface StageAttempt<Name extends string = string> {
	readonly stage: Name;
	/** The stage's place in the pipeline, from 0, and how many stages there are. */
	readonly index: number;
	readonly count: number;
	/** This stage's attempt, from 0, counted afresh whenever its upstream changes. */
	readonly attempt: number;
	readonly mapAttempt: number;
	/** The root seed every stream forks from. */
	readonly seed: number;
}

/** A stage's upstream, as its run and its checks see it. */
export interface StageInputs<Input, Upstream> {
	/** What the whole pipeline was given: for the area map, its validated params. */
	readonly input: Input;
	/** Every earlier stage's winning output, by stage name: a record of this stage's own, which later stages never write to. */
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
	 * Attempts it gets before it's out of them: `STAGE_ATTEMPTS` when left
	 * out. 1 for a stage that takes no draws (the route tree, the tiers),
	 * whose every attempt would be the same.
	 */
	readonly attempts?: number;
	/**
	 * An upstream stage to rerun on its next attempt once this one is out of
	 * attempts, instead of restarting the map: POIs that can't seat their
	 * strongholds rerun the roads. The stages between rerun after it on fresh
	 * streams, and this one counts its attempts from 0 again. When the
	 * upstream stage is out of attempts too, its own `escalate` applies, and
	 * past the last the map restarts. Never a local-retry stage, nor set on one.
	 */
	readonly escalate?: StageName<Upstream>;
	/**
	 * Retries only itself and never restarts the map (stops and dressing).
	 * Past its cap a debug build throws and a release build logs and keeps
	 * its best attempt, the one with the fewest problems, the earliest on a
	 * tie. So its checks report every problem they find: a check that stops
	 * counting at a limit can't rank two attempts past it.
	 */
	readonly localRetry?: boolean;
	run(context: StageContext<Input, Upstream>): Product;
	/** What's wrong with the output, nothing when it passes. */
	check?(product: Product, inputs: StageInputs<Input, Upstream>): Problems;
}

/** Called after a stage's own checks pass; anything it returns rejects the stage's output, as a failed check would. */
export type AcceptHook<Products> = (map: Readonly<Partial<Products>>, stage: StageAttempt<StageName<Products>>) => Problems;

export interface PipelineRunOptions<Input, Products> {
	/** The root seed; every stream forks from it. */
	readonly seed: number;
	readonly input: Input;
	readonly accept?: AcceptHook<Products>;
	/** Told as each stage attempt starts. */
	readonly onProgress?: (stage: StageAttempt<StageName<Products>>) => void;
	/** Past a local-retry stage's cap, debug builds throw and release builds log and carry on. `__DEV_TOOLS__` when left out. */
	readonly debug?: boolean;
	/** Where a release build's warnings go: console.warn when left out. */
	readonly warn?: (message: string) => void;
	/** Milliseconds, for timings: performance.now when left out. */
	readonly now?: () => number;
}

export interface StageTiming {
	/** Every attempt this stage ran, across every map attempt. */
	readonly runs: number;
	/** Spent in its run... */
	readonly milliseconds: number;
	/** ...and in its checks and the accept hook. */
	readonly checkMilliseconds: number;
}

/** An attempt that failed its checks or the accept hook. */
export interface StageFailure<Name extends string = string> extends StageAttempt<Name> {
	readonly problems: Problems;
}

export interface PipelineResult<Products> {
	readonly products: Products;
	readonly mapAttempt: number;
	/** Each stage's winning attempt, in the winning map attempt. */
	readonly attempts: { readonly [Name in keyof Products]: number };
	/** Each stage's winning stream, as its seed: `new Rng({ seed })` replays it. */
	readonly streams: { readonly [Name in keyof Products]: number };
	readonly timings: { readonly [Name in keyof Products]: StageTiming };
	/** Every failed attempt, in the order they ran. */
	readonly failures: readonly StageFailure<StageName<Products>>[];
	/** Local-retry stages a release build kept at their best attempt after every attempt failed. */
	readonly keptFailing: readonly StageName<Products>[];
	/** The whole run. */
	readonly milliseconds: number;
}

/**
 * The run gave up. `map`: every map attempt on the seed failed, in any
 * build, which founding answers with the next seed (map-pipeline-worker.md).
 * `stage`: a local-retry stage ran out of attempts in a debug build.
 */
export class MapPipelineError extends Error {
	public readonly failure: StageFailure;
	public readonly exhausted: 'map' | 'stage';

	constructor({ message, failure, exhausted }: { message: string; failure: StageFailure; exhausted: 'map' | 'stage' }) {
		super(message);
		this.name = 'MapPipelineError';
		this.failure = failure;
		this.exhausted = exhausted;
	}
}

type AnyProducts = Record<string, unknown>;
type AnyStage<Input> = MapStage<Input, AnyProducts, string, unknown>;
type EmptyProducts = Record<never, never>;
type RunOptions<Input> = PipelineRunOptions<Input, AnyProducts>;

interface MutableTiming {
	runs: number;
	milliseconds: number;
	checkMilliseconds: number;
}

/** A stage's winning attempt, or the attempt a release build kept for a local-retry stage. */
interface Winner {
	readonly attempt: number;
	readonly rng: Rng;
	readonly product: unknown;
	readonly kept: boolean;
}

/** How one map attempt ended: its stages' winners, or the failure that restarts the map. */
type MapOutcome = { readonly winners: readonly Winner[]; readonly failure: null } | { readonly winners: null; readonly failure: StageFailure };

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

	/** This pipeline with `stage` after its last. Throws on a repeated name, a bad attempt count, or an escalation it can't make. */
	public stage<Name extends string, Product>(stage: MapStage<Input, Products, Name, Product>): MapPipeline<Input, Products & { readonly [Key in Name]: Product }> {
		const { name, attempts, escalate, localRetry } = stage;
		if (this.list.some((earlier) => earlier.name === name)) throw new RangeError(`MapPipeline: a stage named ${name} is already in the pipeline`);
		if (attempts !== undefined && !(Number.isInteger(attempts) && attempts >= 1)) throw new RangeError(`MapPipeline: ${name} needs at least one attempt, got ${attempts}`);
		if (escalate !== undefined) {
			const target = this.list.find((earlier) => earlier.name === escalate);
			if (!target) throw new RangeError(`MapPipeline: ${name} escalates to ${escalate}, which isn't upstream of it`);
			if (localRetry || target.localRetry) throw new RangeError(`MapPipeline: ${name} escalates to ${escalate}, but a local-retry stage only retries itself`);
		}
		return new MapPipeline({ stages: [...this.list, stage as unknown as AnyStage<Input>] });
	}

	public run(options: PipelineRunOptions<Input, Products>): PipelineResult<Products> {
		// The run works in records keyed by stage name; the builder's types are what make them Products.
		const run = new PipelineRun({ stages: this.list, options: options as unknown as RunOptions<Input> });
		return run.run() as unknown as PipelineResult<Products>;
	}
}

/** One call to `MapPipeline.run`: its state across map attempts and stage attempts. */
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
		const root = new Rng({ seed: this.seed });
		let failure: StageFailure | null = null;
		for (let mapAttempt = 0; mapAttempt < MAP_ATTEMPTS; mapAttempt += 1) {
			const outcome = this.runMap({ map: root.fork('map', mapAttempt), mapAttempt });
			if (outcome.failure === null) return this.result({ winners: outcome.winners, mapAttempt, started });
			failure = outcome.failure;
		}
		// Every map attempt failed, so the last left its failure.
		const last = failure as StageFailure;
		throw new MapPipelineError({
			message: `MapPipeline: seed ${this.seed} failed ${MAP_ATTEMPTS} map attempts; the last ran out on ${describeFailure(last)}`,
			failure: last,
			exhausted: 'map',
		});
	}

	/**
	 * One map attempt: every stage in order, each on the stream nested in its
	 * upstream's winner. A stage out of attempts escalates to the stage it
	 * names, which reruns on its next attempt with everything after it, or
	 * ends the map attempt.
	 */
	private runMap({ map, mapAttempt }: { map: Rng; mapAttempt: number }): MapOutcome {
		const count = this.stages.length;
		const winners: (Winner | null)[] = new Array(count).fill(null);
		/** Each stage's next attempt under its current upstream. */
		const next: number[] = new Array(count).fill(0);
		let index = 0;
		while (index < count) {
			const stage = this.stages[index];
			const upstream = index === 0 ? map : (winners[index - 1] as Winner).rng;
			const products: AnyProducts = {};
			for (let earlier = 0; earlier < index; earlier += 1) products[this.stages[earlier].name] = (winners[earlier] as Winner).product;
			const { winner, best, last } = this.runStage({ index, upstream, products, from: next[index], mapAttempt });
			if (winner) {
				winners[index] = winner;
				next[index] = winner.attempt + 1;
				index += 1;
				continue;
			}
			next[index] = attemptsOf(stage);
			if (stage.localRetry) {
				const message = `MapPipeline: ${describeFailure(last)} after ${attemptsOf(stage)} attempts`;
				if (this.debug) throw new MapPipelineError({ message, failure: last, exhausted: 'stage' });
				this.warn(`${message}; keeping attempt ${best.attempt}`);
				winners[index] = { ...best, kept: true };
				index += 1;
				continue;
			}
			const target = this.escalation(index, next);
			if (target < 0) return { winners: null, failure: last };
			for (let rerun = target; rerun < count; rerun += 1) winners[rerun] = null;
			for (let below = target + 1; below < count; below += 1) next[below] = 0;
			index = target;
		}
		return { winners: winners as Winner[], failure: null };
	}

	/** Where a stage out of attempts goes: the stage it escalates to, or past any that are out too, theirs; -1 restarts the map. */
	private escalation(index: number, next: readonly number[]): number {
		let target = this.indexOf(this.stages[index].escalate);
		while (target >= 0 && next[target] >= attemptsOf(this.stages[target])) target = this.indexOf(this.stages[target].escalate);
		return target;
	}

	private indexOf(name: string | undefined): number {
		return name === undefined ? -1 : this.stages.findIndex((stage) => stage.name === name);
	}

	/** A stage's attempts from `from` until one passes or it's out of them, keeping the best failure for a local-retry stage. */
	private runStage({ index, upstream, products, from, mapAttempt }: { index: number; upstream: Rng; products: AnyProducts; from: number; mapAttempt: number }): {
		winner: Winner | null;
		best: Winner;
		last: StageFailure;
	} {
		const stage = this.stages[index];
		let best: (Winner & { problems: Problems }) | null = null;
		let last: StageFailure | null = null;
		for (let attempt = from; attempt < attemptsOf(stage); attempt += 1) {
			const progress: StageAttempt = { stage: stage.name, index, count: this.stages.length, attempt, mapAttempt, seed: this.seed };
			this.onProgress?.(progress);
			// fork reads only the parent's seed, so the draws a stage made from its stream never move its children's.
			const rng = upstream.fork(stage.name, attempt);
			const { product, problems } = this.attempt({ stage, rng, products, progress });
			if (problems.length === 0) return { winner: { attempt, rng, product, kept: false }, best: best as Winner, last: last as StageFailure };
			last = { ...progress, problems };
			this.failures.push(last);
			if (best === null || problems.length < best.problems.length) best = { attempt, rng, product, kept: false, problems };
		}
		// A stage is only run with an attempt left, so at least one failed here.
		return { winner: null, best: best as Winner, last: last as StageFailure };
	}

	/** One attempt at one stage: its run, then its checks, then the accept hook if they passed, each timed. */
	private attempt({ stage, rng, products, progress }: { stage: AnyStage<Input>; rng: Rng; products: AnyProducts; progress: StageAttempt }): { product: unknown; problems: Problems } {
		const timing = this.timings[stage.name];
		const inputs: StageInputs<Input, AnyProducts> = { input: this.input, products };
		const started = this.now();
		const product = stage.run({ ...inputs, rng });
		const ran = this.now();
		let problems: Problems = stage.check?.(product, inputs) ?? [];
		if (problems.length === 0 && this.accept) problems = this.accept({ ...products, [stage.name]: product }, progress);
		timing.runs += 1;
		timing.milliseconds += ran - started;
		timing.checkMilliseconds += this.now() - ran;
		return { product, problems };
	}

	private result({ winners, mapAttempt, started }: { winners: readonly Winner[]; mapAttempt: number; started: number }): PipelineResult<AnyProducts> {
		const products: AnyProducts = {};
		const attempts: Record<string, number> = {};
		const streams: Record<string, number> = {};
		const keptFailing: string[] = [];
		this.stages.forEach(({ name }, index) => {
			const winner = winners[index];
			products[name] = winner.product;
			attempts[name] = winner.attempt;
			streams[name] = winner.rng.seed;
			if (winner.kept) keptFailing.push(name);
		});
		return {
			products,
			mapAttempt,
			attempts,
			streams,
			timings: this.timings,
			failures: this.failures,
			keptFailing,
			milliseconds: this.now() - started,
		};
	}
}

function attemptsOf(stage: AnyStage<unknown>): number {
	return stage.attempts ?? STAGE_ATTEMPTS;
}

function describeFailure({ stage, attempt, mapAttempt, problems }: StageFailure): string {
	const shown = problems.slice(0, 3).join('; ');
	const more = problems.length > 3 ? ` and ${problems.length - 3} more` : '';
	return `${stage} (attempt ${attempt}, map attempt ${mapAttempt}): ${shown}${more}`;
}
