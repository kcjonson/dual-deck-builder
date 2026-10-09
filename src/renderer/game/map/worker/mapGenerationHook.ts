import { freshSeed } from '../../core/Rng';
import type { AreaMapStageName } from '../AreaMapPipeline';
import { MapParamSet, MapParams, resolveMapParams } from '../MapParams';
import type { StageTiming } from '../MapPipeline';
import { validateMapParams } from '../ParamValidator';
import { MapGeneration, MapGenerationResult } from './MapGeneration';

/**
 * Development-only `window.__map`, which makes area maps off the frame from
 * the console or a script driving the page. `await __map.generate({ seed: 7 })`
 * makes the map in a worker and logs where the time went; `__map.start(set)`
 * hands back the generation itself, to watch or cancel. Installed from Game's
 * `__DEV_TOOLS__` branch, so a production bundle carries neither it nor the
 * client it starts.
 */

export interface MapGenerationSummary {
	/** The params it ran on, the seed it came from among them. */
	readonly params: MapParams;
	readonly seed: number;
	readonly environment: string;
	readonly radius: number;
	readonly inWorker: boolean;
	/** From asking to having the map on this thread. */
	readonly wallMilliseconds: number;
	/** The pipeline, inside the worker. */
	readonly pipelineMilliseconds: number;
	readonly decodeMilliseconds: number;
	readonly stages: { readonly [Name in AreaMapStageName]: StageTiming };
	readonly attempts: { readonly [Name in AreaMapStageName]: number };
	readonly mapAttempt: number;
	readonly nodes: number;
	readonly stretches: number;
}

export interface MapGenerationApi {
	/**
	 * `set`'s map, a fresh seed's when left out, made in a worker, or on this
	 * thread for comparison with `inProcess`; its timings are logged and resolved.
	 */
	generate(set?: Partial<MapParamSet>, options?: { inProcess?: boolean }): Promise<MapGenerationSummary>;
	/** The same generation, handed back unawaited, so the console can watch its progress or cancel it. */
	start(set?: Partial<MapParamSet>, options?: { inProcess?: boolean }): MapGeneration;
}

interface MapHookWindow extends Window {
	__map?: MapGenerationApi;
}

export function installMapGenerationHook(): void {
	if (!__DEV_TOOLS__) return;
	if (typeof window === 'undefined') return;
	const start = (set: Partial<MapParamSet> = {}, { inProcess = false } = {}): MapGeneration => {
		const { params } = validateMapParams(resolveMapParams({ ...set, seed: set.seed ?? freshSeed() }).params);
		return new MapGeneration({
			params,
			spawn: inProcess ? () => null : undefined,
			onProgress: ({ stage, attempt, mapAttempt }) => console.debug(`Map generation: ${stage} attempt ${attempt}, map attempt ${mapAttempt}`),
		});
	};
	(window as MapHookWindow).__map = {
		start,
		generate: async (set, options) => {
			const summary = summarizeGeneration(await start(set, options).result);
			console.log(describeGeneration(summary));
			return summary;
		},
	};
}

export function summarizeGeneration(result: MapGenerationResult): MapGenerationSummary {
	const { params, products, timings } = result;
	return {
		params,
		seed: params.seed,
		environment: params.environment,
		radius: params.radius,
		inWorker: result.inWorker,
		wallMilliseconds: result.wallMilliseconds,
		pipelineMilliseconds: result.milliseconds,
		decodeMilliseconds: result.decodeMilliseconds,
		stages: timings,
		attempts: result.attempts,
		mapAttempt: result.mapAttempt,
		nodes: products.growth.network.nodes.length,
		stretches: products.growth.network.stretches.length,
	};
}

/** One log line: where the time went, stage by stage, and the attempts each took. */
export function describeGeneration(summary: MapGenerationSummary): string {
	const stages = (Object.keys(summary.stages) as AreaMapStageName[]).map((name) => {
		const { milliseconds, checkMilliseconds } = summary.stages[name];
		const checks = checkMilliseconds >= 0.05 ? ` + ${checkMilliseconds.toFixed(1)} checks` : '';
		return `${name} ${milliseconds.toFixed(1)}${checks} (attempt ${summary.attempts[name]})`;
	});
	const where = summary.inWorker ? 'in a worker' : 'in-process';
	return `Map generation, seed ${summary.seed} ${summary.environment} radius ${summary.radius}, ${where}: ${summary.wallMilliseconds.toFixed(1)} ms wall, `
		+ `pipeline ${summary.pipelineMilliseconds.toFixed(1)} ms (${stages.join(', ')}; map attempt ${summary.mapAttempt}), decode ${summary.decodeMilliseconds.toFixed(1)} ms; `
		+ `${summary.nodes} nodes, ${summary.stretches} stretches`;
}
