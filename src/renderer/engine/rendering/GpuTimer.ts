import type { GpuStats } from './FrameTimer';
import { nearestRankP99 } from './frameStats';
import type { Renderer } from './Renderer';

/**
 * R13.16 to R13.19 and R15.24: GPU time per frame, measured as one
 * `TIME_ELAPSED_EXT` query per submission pass and read back without ever
 * waiting for it.
 *
 * The backend calls four methods and nothing else: `beginFrame` and `endFrame`
 * around the frame, `beginPass` and `endPass` around each GPU submission (the
 * clear, each sort domain's flush). That is the whole seam, kept that narrow
 * because the backend's encoder path is being rewritten (DDB-64) and a timer
 * threaded through it would have to be rewritten with it.
 *
 * What it will not do:
 *
 * - Nest. The extension allows one active query, and R13.16 forbids nesting
 *   besides; a pass opened inside a pass is refused and said once.
 * - Wait. A frame's queries are polled no sooner than MIN_TIMER_LATENCY_FRAMES
 *   later (R13.17), oldest first, and polling stops at the first frame whose
 *   last query is not available: queries complete in submission order, so
 *   nothing newer can be ready either. One availability read per pending
 *   frame per frame, one result read per query once, and one disjoint read
 *   per frame that resolved anything: the calls R15.22 permits, and only these.
 * - Report a single spanning query. `gpu.spanMs` stays null: a span would have
 *   to nest the per-pass queries, and the timestamp query that could stand in
 *   for it (`queryCounterEXT`) is zero-bit on most Chromium platforms.
 *
 * Where the extension is absent (Firefox, Safari, SwiftShader in CI) it falls
 * back to R15.23's fence: one `fenceSync` per frame, polled with a zero
 * timeout from the next frame on, reported as `latencyMs` and never as `ms`
 * (R13.19). The latency is observed at the poll, so it is an upper bound
 * quantised to the frame interval: a GPU keeping up reads about one frame, a
 * GPU falling behind reads two or more. That is what it is good for.
 *
 * Everything here is development tooling (R13.2). The pages construct it
 * inside `if (__DEV_TOOLS__)` so a production bundle neither carries it nor
 * issues a query (R15.22).
 */

/** Opaque GPU objects; the device decides what they are. */
export type GpuQuery = object;
export type GpuFence = object;

/**
 * The calls the timer makes, and only those, so a test can drive it with a
 * scripted device and so the WebGL spelling lives in one place.
 */
export interface GpuQueryDevice {
	/** Whether `TIME_ELAPSED_EXT` queries exist on the current context. */
	readonly timerQuery: boolean;
	createQuery(): GpuQuery | null;
	beginTimeElapsed(query: GpuQuery): void;
	endTimeElapsed(): void;
	/** `QUERY_RESULT_AVAILABLE`. */
	queryAvailable(query: GpuQuery): boolean;
	/** `QUERY_RESULT`, in nanoseconds. Only called once available. */
	queryResultNs(query: GpuQuery): number;
	/** `GPU_DISJOINT_EXT`. Reading it clears it. */
	disjoint(): boolean;
	/** `fenceSync` plus the `flush` R15.23 requires, or null when it cannot. */
	fence(): GpuFence | null;
	/** `clientWaitSync` with a zero timeout. */
	fenceSignalled(fence: GpuFence): boolean;
	deleteFence(fence: GpuFence): void;
}

/** R13.17: a result is read at least this many frames after it was issued. */
export const MIN_TIMER_LATENCY_FRAMES = 2;

/** R15.23: a fence never signals within the task that created it. */
export const MIN_FENCE_LATENCY_FRAMES = 1;

/**
 * Frames in flight before the timer stops issuing new ones. A driver that never
 * makes results available would otherwise grow the queue and the query pool
 * without bound; past this the frame is skipped. That is also the steady state
 * of an unthrottled capture, where the page runs thousands of frames a second
 * and Chromium hands results back a few frames at a time, so there the window
 * holds a sample of frames rather than every one. Said here rather than
 * warned, because it is not a fault.
 */
export const MAX_PENDING_FRAMES = 8;

/**
 * R13.18: a sample more than this multiple of its CPU frame time is invalid.
 * The frame time it is held against is the larger of the frame's own interval
 * and the median of the recent ones: after a hitch, rAF often fires a short
 * catch-up frame, and a normal GPU sample on that frame would trip 3x its
 * interval. Those are exactly the samples beside a hitch, which is what p99
 * is there to see, so judging them by their own interval alone biases the
 * window low. The median keeps the guard against worldsim's 352 ms reading on
 * an 8 ms frame.
 */
export const INVALID_FRAME_MULTIPLE = 3;

/** Recent CPU frame intervals the 3x rule takes its median over. */
export const REFERENCE_FRAME_COUNT = 31;

/** Resolved samples kept for the window statistics, as FrameTimer keeps frames. */
export const GPU_WINDOW_SIZE = 120;

export type GpuTimerSource = 'timerQuery' | 'fence';

interface PendingFrame {
	index: number;
	startMs: number;
	/** Interval to the next frame start (R13.8); null until that frame begins. */
	frameMs: number | null;
	queries: GpuQuery[];
	fence: GpuFence | null;
	submittedMs: number;
}

interface GpuSample {
	ms: number;
	valid: boolean;
	passes: number[];
}

export interface GpuTimerOptions {
	device: GpuQueryDevice;
	/** Monotonic ms, the FrameTimer's clock. */
	now?: () => number;
	enabled?: boolean;
}

export class GpuTimer {
	private readonly device: GpuQueryDevice;
	private readonly now: () => number;
	private active: boolean;

	private readonly pending: PendingFrame[] = [];
	private readonly pool: GpuQuery[] = [];
	private current: PendingFrame | null = null;
	/** The newest frame begun, recorded or not, so its interval can be closed. */
	private previousStartMs: number | null = null;
	private previousPending: PendingFrame | null = null;
	private openQuery: GpuQuery | null = null;
	private frameIndex = 0;

	private readonly intervals: number[] = [];
	private intervalIndex = 0;
	private readonly ring: (GpuSample | null)[] = new Array<GpuSample | null>(GPU_WINDOW_SIZE).fill(null);
	private writeIndex = 0;
	private newest: GpuSample | null = null;
	private latencyMs: number | null = null;
	private invalidCount = 0;
	private readonly warned = new Set<string>();

	constructor({ device, now = () => performance.now(), enabled = true }: GpuTimerOptions) {
		this.device = device;
		this.now = now;
		this.active = enabled;
	}

	/** Which measurement this device can take; null while disabled. */
	get source(): GpuTimerSource | null {
		if (!this.active) return null;
		return this.device.timerQuery ? 'timerQuery' : 'fence';
	}

	/** R13.2's runtime toggle. Turning it off drops everything in flight. */
	get enabled(): boolean {
		return this.active;
	}

	set enabled(value: boolean) {
		if (value === this.active) return;
		this.active = value;
		this.discardPending(false);
		this.clearWindow();
	}

	beginFrame(): void {
		const startMs = this.now();
		if (this.openQuery !== null) this.endPass();
		if (this.current !== null) this.endFrame();

		if (this.previousStartMs !== null) {
			const intervalMs = startMs - this.previousStartMs;
			if (this.previousPending !== null) this.previousPending.frameMs = intervalMs;
			if (this.intervals.length < REFERENCE_FRAME_COUNT) this.intervals.push(intervalMs);
			else this.intervals[this.intervalIndex] = intervalMs;
			this.intervalIndex = (this.intervalIndex + 1) % REFERENCE_FRAME_COUNT;
		}
		this.previousStartMs = startMs;
		this.previousPending = null;
		const index = this.frameIndex++;

		const source = this.source;
		if (source === null) return;
		this.poll(source, index, startMs);

		if (this.pending.length >= MAX_PENDING_FRAMES) return;
		this.current = { index, startMs, frameMs: null, queries: [], fence: null, submittedMs: startMs };
		this.previousPending = this.current;
	}

	beginPass(): void {
		if (this.current === null || !this.device.timerQuery) return;
		if (this.openQuery !== null) {
			this.warnOnce('a pass began inside a pass; timer queries cannot nest (R13.16)');
			return;
		}
		const query = this.pool.pop() ?? this.device.createQuery();
		if (query === null) return;
		this.device.beginTimeElapsed(query);
		this.openQuery = query;
	}

	endPass(): void {
		const query = this.openQuery;
		if (query === null) return;
		this.device.endTimeElapsed();
		this.openQuery = null;
		// A pass the frame was dropped during (a toggle mid-frame) goes back to the pool.
		if (this.current !== null) this.current.queries.push(query);
		else this.pool.push(query);
	}

	endFrame(): void {
		if (this.openQuery !== null) {
			this.warnOnce('the frame ended with a pass still open');
			this.endPass();
		}
		const frame = this.current;
		if (frame === null) return;
		this.current = null;

		if (!this.device.timerQuery) {
			frame.fence = this.device.fence();
			frame.submittedMs = this.now();
			if (frame.fence === null) return;
		} else if (frame.queries.length === 0) {
			return;
		}
		this.pending.push(frame);
	}

	/**
	 * R13.18's third case: the context was lost, so every query and fence in
	 * flight is gone with it. Those frames count as invalid; nothing on the old
	 * context is deleted, since there is nothing left to delete.
	 */
	contextLost(): void {
		this.discardPending(true);
		this.pool.length = 0;
		this.openQuery = null;
		this.current = null;
		this.previousPending = null;
	}

	/**
	 * R13.16 to R13.19's `gpu` block, plus the window figures a capture reads.
	 * `ms`, `valid` and `passes` are the newest resolved sample, which is two or
	 * more frames old by construction. The window figures cover valid samples
	 * only (R13.18); `invalidCount` says how many were left out.
	 */
	get stats(): GpuStats {
		const source = this.source;
		const valid: number[] = [];
		for (const sample of this.ring) if (sample !== null && sample.valid) valid.push(sample.ms);
		valid.sort((a, b) => a - b);
		const timed = source === 'timerQuery';
		return {
			ms: timed && this.newest !== null ? this.newest.ms : null,
			valid: timed && this.newest !== null ? this.newest.valid : null,
			passes: timed && this.newest !== null ? this.newest.passes : null,
			spanMs: null,
			latencyMs: source === 'fence' ? this.latencyMs : null,
			source,
			p99Ms: timed ? nearestRankP99(valid) : null,
			maxMs: timed && valid.length > 0 ? valid[valid.length - 1] : null,
			sampleCount: valid.length,
			invalidCount: this.invalidCount,
		};
	}

	private poll(source: GpuTimerSource, index: number, nowMs: number): void {
		if (source === 'fence') {
			this.pollFences(index, nowMs);
			return;
		}

		let ready = 0;
		for (; ready < this.pending.length; ready++) {
			const frame = this.pending[ready];
			if (index - frame.index < MIN_TIMER_LATENCY_FRAMES) break;
			const last = frame.queries[frame.queries.length - 1];
			if (last === undefined || !this.device.queryAvailable(last)) break;
		}
		if (ready === 0) return;

		// Read after availability, before trusting any result: a disjoint event
		// anywhere in the span makes every result in it suspect (R13.18).
		const disjoint = this.device.disjoint();
		const medianFrameMs = [...this.intervals].sort((a, b) => a - b)[this.intervals.length >> 1] ?? 0;
		for (const frame of this.pending.splice(0, ready)) {
			const passes: number[] = [];
			let ms = 0;
			for (const query of frame.queries) {
				const passMs = this.device.queryResultNs(query) / 1e6;
				passes.push(passMs);
				ms += passMs;
				this.pool.push(query);
			}
			const overFrame = frame.frameMs !== null
				&& ms > Math.max(frame.frameMs, medianFrameMs) * INVALID_FRAME_MULTIPLE;
			this.record({ ms, passes, valid: !disjoint && !overFrame });
		}
	}

	private pollFences(index: number, nowMs: number): void {
		while (this.pending.length > 0) {
			const frame = this.pending[0];
			if (index - frame.index < MIN_FENCE_LATENCY_FRAMES) return;
			const fence = frame.fence as GpuFence;
			if (!this.device.fenceSignalled(fence)) return;
			this.pending.shift();
			this.device.deleteFence(fence);
			this.latencyMs = nowMs - frame.submittedMs;
		}
	}

	private record(sample: GpuSample): void {
		this.newest = sample;
		this.ring[this.writeIndex] = sample;
		this.writeIndex = (this.writeIndex + 1) % GPU_WINDOW_SIZE;
		if (!sample.valid) this.invalidCount++;
	}

	private discardPending(lost: boolean): void {
		for (const frame of this.pending) {
			if (lost) {
				if (frame.queries.length > 0) this.invalidCount++;
				continue;
			}
			for (const query of frame.queries) this.pool.push(query);
			if (frame.fence !== null) this.device.deleteFence(frame.fence);
		}
		this.pending.length = 0;
		if (this.current !== null && !lost) for (const query of this.current.queries) this.pool.push(query);
		this.current = null;
		this.previousPending = null;
	}

	private clearWindow(): void {
		this.ring.fill(null);
		this.writeIndex = 0;
		this.newest = null;
		this.latencyMs = null;
		this.invalidCount = 0;
	}

	/** R13.44: never per frame. */
	private warnOnce(message: string): void {
		if (this.warned.has(message)) return;
		this.warned.add(message);
		console.warn(`GpuTimer: ${message}`);
	}
}

/** `EXT_disjoint_timer_query_webgl2`, which lib.dom does not declare. */
interface DisjointTimerQueryExtension {
	readonly TIME_ELAPSED_EXT: number;
	readonly GPU_DISJOINT_EXT: number;
}

/** The WebGL2 spelling of `GpuQueryDevice`. Re-acquires the extension on restore. */
export class WebGL2QueryDevice implements GpuQueryDevice {
	private readonly gl: WebGL2RenderingContext;
	private extension: DisjointTimerQueryExtension | null = null;

	constructor({ gl }: { gl: WebGL2RenderingContext }) {
		this.gl = gl;
		this.acquire();
	}

	get timerQuery(): boolean {
		return this.extension !== null;
	}

	/** At creation and on a restored context only: `getExtension` is not a frame call. */
	acquire(): void {
		this.extension = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as DisjointTimerQueryExtension | null;
	}

	createQuery(): GpuQuery | null {
		return this.gl.createQuery();
	}

	beginTimeElapsed(query: GpuQuery): void {
		this.gl.beginQuery((this.extension as DisjointTimerQueryExtension).TIME_ELAPSED_EXT, query as WebGLQuery);
	}

	endTimeElapsed(): void {
		this.gl.endQuery((this.extension as DisjointTimerQueryExtension).TIME_ELAPSED_EXT);
	}

	queryAvailable(query: GpuQuery): boolean {
		return this.gl.getQueryParameter(query as WebGLQuery, this.gl.QUERY_RESULT_AVAILABLE) === true;
	}

	queryResultNs(query: GpuQuery): number {
		return this.gl.getQueryParameter(query as WebGLQuery, this.gl.QUERY_RESULT) as number;
	}

	disjoint(): boolean {
		return this.gl.getParameter((this.extension as DisjointTimerQueryExtension).GPU_DISJOINT_EXT) === true;
	}

	fence(): GpuFence | null {
		const sync = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
		// R15.23: an unflushed fence may never reach the GPU while the page idles.
		this.gl.flush();
		return sync;
	}

	fenceSignalled(fence: GpuFence): boolean {
		const status = this.gl.clientWaitSync(fence as WebGLSync, 0, 0);
		return status === this.gl.ALREADY_SIGNALED || status === this.gl.CONDITION_SATISFIED;
	}

	deleteFence(fence: GpuFence): void {
		this.gl.deleteSync(fence as WebGLSync);
	}
}

/**
 * The timer both pages build, wired to the renderer's context listeners so a
 * lost context invalidates what was in flight and a restored one re-acquires
 * the extension. Development builds only; the pages reach this through a
 * `require` inside `if (__DEV_TOOLS__)`.
 *
 * Built disabled. On ANGLE Metal every timed pass costs a render pass break,
 * which lengthened an unthrottled main menu frame from about 4.9 to 6.9 ms, so
 * leaving it on in every development session would break R13.1 for a number
 * nobody is reading. The F5 overlay turns it on while shown, and a GPU capture
 * turns it on through `window.__perf.gpuTimer(true)` (R13.2's runtime toggle).
 */
export function createGpuTimer(renderer: Renderer): GpuTimer {
	const device = new WebGL2QueryDevice({ gl: renderer.getContext() });
	const timer = new GpuTimer({ device, enabled: false });
	renderer.addContextListener({
		lost: () => timer.contextLost(),
		restored: () => device.acquire(),
	});
	return timer;
}
