import type { AreaMapGeneration } from '../AreaMapPipeline';
import type { MapParams } from '../MapParams';
import type { StageAttempt } from '../MapPipeline';
import { AreaMapTransfer, WorkerReply, decodeAreaMap, errorFromReply, generateTransfer } from './mapGenerationProtocol';
import { spawnMapWorker } from './spawnMapWorker';

/**
 * One area map generation, off the frame: a worker of its own, which ends
 * when the map comes back or the generation is cancelled. Where there's no
 * Worker (Jest, or a spawn that gives none) it runs in-process instead, a
 * task after construction, through the same transfer format, so the result
 * is the same either way.
 *
 *   const generation = new MapGeneration({ params, onProgress });
 *   const map = await generation.result;
 */

export interface MapGenerationResult extends AreaMapGeneration {
	/** Whether a worker made it. */
	readonly inWorker: boolean;
	/** From construction to the result: starting the worker, the pipeline, the messages, and the decode. */
	readonly wallMilliseconds: number;
	/** Unpacking on this thread, the terrain's rebuild included. */
	readonly decodeMilliseconds: number;
}

export interface MapGenerationOptions {
	/** Resolved and validated. Generation starts from `params.seed`. */
	readonly params: MapParams;
	/** Told as each stage attempt starts. */
	readonly onProgress?: (progress: StageAttempt) => void;
	/** Starts the worker, or gives null to run in-process. `spawnMapWorker` when left out; never called where there's no Worker. */
	readonly spawn?: () => Worker | null;
	/** Milliseconds, for the timings: performance.now when left out. */
	readonly now?: () => number;
}

/** What `result` rejects with after `cancel`. */
export class MapGenerationCancelled extends Error {
	constructor() {
		super('MapGeneration: cancelled');
		this.name = 'MapGenerationCancelled';
	}
}

export class MapGeneration {
	/** The map, or the error that stopped it; rejects with MapGenerationCancelled after `cancel`. */
	public readonly result: Promise<MapGenerationResult>;

	private readonly params: MapParams;
	private readonly onProgress: ((progress: StageAttempt) => void) | undefined;
	private readonly now: () => number;
	private readonly started: number;
	private readonly worker: Worker | null;
	private pending: ReturnType<typeof setTimeout> | null = null;
	private finished = false;
	private resolveResult: (result: MapGenerationResult) => void = () => undefined;
	private rejectResult: (error: unknown) => void = () => undefined;

	constructor({ params, onProgress, spawn = spawnMapWorker, now = () => performance.now() }: MapGenerationOptions) {
		this.params = params;
		this.onProgress = onProgress;
		this.now = now;
		this.started = now();
		this.result = new Promise<MapGenerationResult>((resolve, reject) => {
			this.resolveResult = resolve;
			this.rejectResult = reject;
		});
		this.worker = typeof Worker === 'undefined' ? null : startWorker(spawn);
		if (this.worker) this.runInWorker(this.worker);
		else this.pending = setTimeout(() => this.runInProcess(), 0);
	}

	public get inWorker(): boolean {
		return this.worker !== null;
	}

	/** Whether the result has settled, by a map, an error, or `cancel`. */
	public get settled(): boolean {
		return this.finished;
	}

	/** Stops the generation, terminating its worker, and rejects `result` with MapGenerationCancelled. Nothing once it has settled. */
	public cancel(): void {
		if (this.finished) return;
		this.finish();
		this.rejectResult(new MapGenerationCancelled());
	}

	private runInWorker(worker: Worker): void {
		worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
			if (this.finished) return;
			if (data.type === 'progress') this.onProgress?.(data.progress);
			else if (data.type === 'done') this.complete(data.map);
			else this.fail(errorFromReply(data));
		};
		worker.onerror = (event: ErrorEvent) => {
			event.preventDefault();
			this.fail(new Error(`MapGeneration: the worker failed: ${event.message || 'its script did not load'}`));
		};
		worker.onmessageerror = () => this.fail(new Error('MapGeneration: a reply from the worker could not be read'));
		worker.postMessage({ params: this.params });
	}

	private runInProcess(): void {
		this.pending = null;
		let map: AreaMapTransfer;
		try {
			map = generateTransfer({ params: this.params, onProgress: (progress) => this.onProgress?.(progress) }).map;
		} catch (error) {
			this.fail(error);
			return;
		}
		// A progress callback can cancel mid-run, which nothing in-process can interrupt.
		if (!this.finished) this.complete(map);
	}

	private complete(transfer: AreaMapTransfer): void {
		const decoding = this.now();
		let map: AreaMapGeneration;
		try {
			map = decodeAreaMap(transfer);
		} catch (error) {
			this.fail(error);
			return;
		}
		const done = this.now();
		this.finish();
		this.resolveResult({ ...map, inWorker: this.inWorker, wallMilliseconds: done - this.started, decodeMilliseconds: done - decoding });
	}

	private fail(error: unknown): void {
		if (this.finished) return;
		this.finish();
		this.rejectResult(error);
	}

	private finish(): void {
		this.finished = true;
		if (this.pending !== null) clearTimeout(this.pending);
		this.pending = null;
		this.worker?.terminate();
	}
}

/** The spawned worker, or null when the platform refused one, so the map is still made, in-process. */
function startWorker(spawn: () => Worker | null): Worker | null {
	try {
		return spawn();
	} catch (error) {
		console.warn('MapGeneration: could not start a worker, generating in-process', error);
		return null;
	}
}
