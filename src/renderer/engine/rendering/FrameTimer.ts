import type { DrawStats } from '../draw';
import type { DeviceInfo } from './deviceInfo';
import type { TrackColor, TrackEmitter, TrackMode } from '../debug/devtoolsTracks';
import type { HitchSource, HitchStats } from '../debug/hitchObserver';
import type { FrameRecord, FrameStats, FrameSanity, SectionStats } from './frameStats';
import { frameWindowStats } from './frameStats';

/**
 * The frame timer of R13.7 to R13.11: disjoint named sections, a rolling window
 * of the last N frames, and the JSON snapshot `window.__perf.snapshot()`
 * returns. It replaces PerformanceMonitor, which timed the frame interval and
 * nothing inside it, and it carries that class's draw counters because they are
 * per-frame counters reset at frame start and a second per-frame collector
 * beside this one would be the parallel path the ground rules forbid.
 *
 * What this engine can honestly measure, and what it reports null (R13.5, and
 * the rule that null means "not measurable here", never zero):
 *
 * - `update`, `render` and `flush` are real. The frame loop brackets them, they
 *   cannot overlap (see `beginSection`), and together they are the whole of the
 *   application's per-frame work. `flush` is R13.7's GPU submission: a draw
 *   call resolves state onto a command and nothing reaches GL until a sort
 *   domain ends, and only an explicit barrier or `endFrame` ends one (R3.20).
 *   No screen calls `flush` mid-walk, so `render` is the tree walk and `flush`
 *   is the whole frame's submission. Section numbers from before DDB-55 phase 1
 *   are not comparable: shapes used to submit at their draw sites, so `render`
 *   held nearly all of the frame's GL work.
 * - `input` is null. This engine dispatches input straight from DOM listeners
 *   on the canvas, so input handling happens between frames, not in a phase of
 *   one; a section here would read 0 forever while real input cost lands
 *   invisibly outside the loop. Slow input is attributed instead by the
 *   `event` observer behind `hitches` (R15.29), which sees only input over
 *   16 ms and so cannot stand in for a per-frame section.
 * - `layout` is null. There is no layout phase: `Layer.layout()` is called by
 *   screens when they choose, inside their update or their render, so there is
 *   no disjoint span to bracket. Chapter 10's layout pass is phase 3.
 * - `present` is null. rAF is vsync-paced, so the wait shows up as a late next
 *   frame rather than as a measurable call, exactly as the chapter 13 mapping
 *   table describes for the browser.
 *
 * The window itself is pre-sized and written circularly, so a frame write
 * neither grows nor shifts an array (R13.1). The per-frame record is a fresh
 * object rather than a reused one: reuse would mean clearing stale section keys
 * on every frame, and a section that was not measured has to stay absent rather
 * than read 0.
 */

/** R13.9. Browsers background a tab for seconds; a window drag stalls a frame. */
export const MAX_DELTA_SECONDS = 0.25;

/** The 60 FPS target the developer overlay has always displayed. */
export const DEFAULT_BUDGET_MS = 1000 / 60;

/** R13.10 names 120 as the default. The old monitor kept 60. */
export const DEFAULT_WINDOW_SIZE = 120;

/** R13.7's minimum set, in the order the snapshot emits them. */
export const SECTION_NAMES = ['input', 'update', 'layout', 'render', 'flush', 'present'] as const;

export type SectionName = (typeof SECTION_NAMES)[number];

/**
 * R13.11's `gpu` block. The first five fields are normative; the rest are
 * additive, so a capture can tabulate GPU time the way it tabulates frame time
 * without re-deriving a distribution from samples that lag the frame.
 */
export interface GpuStats {
	/** Sum of the newest resolved frame's passes (R13.16). */
	ms: number | null;
	/** R13.18's validity of that frame; null when nothing was measured. */
	valid: boolean | null;
	passes: number[] | null;
	spanMs: number | null;
	/** R13.19's fence fallback: submission to observed completion, an upper bound. Never GPU time. */
	latencyMs: number | null;
	/** Which measurement produced the figures; null when there is no GPU timer. */
	source: 'timerQuery' | 'fence' | null;
	/** Over the valid samples in the window only (R13.18). */
	p99Ms: number | null;
	maxMs: number | null;
	sampleCount: number;
	/** Samples the window excluded as invalid, since the timer was last enabled. */
	invalidCount: number;
}

/** Nothing measured, which is not zero (R13.5). */
export const NO_GPU_STATS: Readonly<GpuStats> = {
	ms: null,
	valid: null,
	passes: null,
	spanMs: null,
	latencyMs: null,
	source: null,
	p99Ms: null,
	maxMs: null,
	sampleCount: 0,
	invalidCount: 0,
};

/**
 * What the GL backend counts at its own call sites: `glDrawCalls` is one
 * increment per `drawElements`, `vertices` the vertices that call drew, and
 * `textCharacters` the characters handed to it. Kept beside `batcher` rather
 * than replaced by it because the two are measured at different places, and
 * `batcher.gpuDraws` equalling `glDrawCalls` on the same frame is the R13.5
 * cross-check that the batcher's own count is honest.
 */
export interface RendererCounters {
	glDrawCalls: number;
	vertices: number;
	textCharacters: number;
}

/**
 * Whether the loop that filled the window is still running. Nothing else in the
 * snapshot answers that: `timestamp` is read fresh on every call while the ring
 * may be minutes stale, so a stopped loop keeps reporting the healthy window it
 * stopped in. Two snapshots taken a second apart settle it. Same `frameCount`
 * means no frame ran between them, and `newestSampleAgeMs` says how long ago the
 * newest sample in the window actually started, in wall-clock time.
 *
 * This is additive to R13.11's normative shape rather than a change to it.
 */
export interface LivenessStats {
	/** Frames begun since construction. Monotonic, never reset by a window wrap. */
	frameCount: number;
	/** Wall-clock ms since the newest frame started; null before the first frame. */
	newestSampleAgeMs: number | null;
}

/** R13.11. Field names are normative; consumers are shared across backends. */
export interface PerfSnapshot {
	timestamp: number;
	scene: string | null;
	frame: FrameStats;
	sections: Record<SectionName, SectionStats | null>;
	gpu: GpuStats;
	/**
	 * R13.12 to R13.15, for the last completed frame, from `DrawApi.getStats`.
	 * Null until a frame has been drawn, and on any caller that supplies none.
	 */
	batcher: DrawStats | null;
	memory: { usedBytes: number | null };
	renderer: RendererCounters;
	sanity: FrameSanity;
	liveness: LivenessStats;
	/**
	 * R13.20's renderer and GPU identity, R15.31's backend, and R15.3's
	 * detected features. Null on a caller that supplies none.
	 */
	device: DeviceInfo | null;
	/** R15.29's DevTools track and how it is emitted; null where R15.42 finds no support. */
	tracks: TrackMode | null;
	/**
	 * R15.29's long frames and slow input over the same frames as `frame`, from
	 * `PerformanceObserver`. Null where no observer was supplied (production,
	 * or a runtime with none of the entry types); inside, each block is null
	 * where its entry type is unsupported. Additive, as `tracks` was.
	 */
	hitches: HitchStats | null;
}

/**
 * A millisecond source. The timer takes its clocks rather than reading
 * `performance` and `Date` directly so a screenshot harness can step frames by
 * hand (R15.36) and a test can drive time without patching a host object whose
 * properties a runtime is free to make read-only.
 */
export type Clock = () => number;

/** `performance.now` needs its receiver, so both platform clocks are wrapped. */
const platformClock: Clock = () => performance.now();
const platformWallClock: Clock = () => Date.now();

export interface FrameTimerOptions {
	budgetMs?: number;
	windowSize?: number;
	/** Monotonic ms: frame intervals and section spans. */
	now?: Clock;
	/** Wall-clock ms: the snapshot timestamp and the liveness age. */
	wallNow?: Clock;
	/** R15.29: sections and frames mirrored to a DevTools track. Development builds only. */
	tracks?: TrackEmitter | null;
	/**
	 * R15.29: long frames and slow input from `PerformanceObserver`, read over
	 * the window's span. Development builds only. Its entries are on the
	 * `performance.now()` timeline, so it only lines up with a timer on the
	 * platform clock, which is the one both pages use.
	 */
	hitches?: HitchSource | null;
}

/** DevTools colours per section, so the three read apart at a glance. */
const SECTION_COLORS: Record<SectionName, TrackColor> = {
	input: 'primary-dark',
	update: 'primary',
	layout: 'secondary-dark',
	render: 'secondary',
	flush: 'tertiary',
	present: 'tertiary-dark',
};

interface MemoryMeasurement {
	bytes: number;
}

interface PerformanceWithMemoryMeasure extends Performance {
	measureUserAgentSpecificMemory?: () => Promise<MemoryMeasurement>;
}

/** Requesting a memory measurement more often than this is pointless: the API
 * is throttled by the user agent and the number moves on a GC, not on a frame. */
const MEMORY_SAMPLE_INTERVAL_MS = 1000;

export class FrameTimer {
	private readonly budgetMs: number;
	private readonly windowSize: number;
	private readonly now: Clock;
	private readonly wallNow: Clock;
	private readonly tracks: TrackEmitter | null;
	private readonly hitches: HitchSource | null;
	private readonly ring: (FrameRecord | null)[];
	private writeIndex = 0;
	private recorded = 0;

	private lastFrameStartMs: number | null = null;
	private lastFrameStartWallMs: number | null = null;
	private frameCount = 0;
	private pendingSections: Record<string, number> = {};
	private openSection: { name: string; startMs: number } | null = null;
	private readonly warned = new Set<string>();

	private drawCallsThisFrame = 0;
	private verticesThisFrame = 0;
	private textCharactersThisFrame = 0;
	private lastFrameDrawCalls = 0;
	private lastFrameVertices = 0;
	private lastFrameTextCharacters = 0;

	private memoryBytes: number | null = null;
	private memoryRequestedAtMs = 0;
	private memoryPending = false;

	constructor({
		budgetMs = DEFAULT_BUDGET_MS,
		windowSize = DEFAULT_WINDOW_SIZE,
		now = platformClock,
		wallNow = platformWallClock,
		tracks = null,
		hitches = null,
	}: FrameTimerOptions = {}) {
		this.budgetMs = budgetMs;
		this.windowSize = Math.max(1, Math.floor(windowSize));
		this.now = now;
		this.wallNow = wallNow;
		this.tracks = tracks;
		this.hitches = hitches;
		this.ring = new Array<FrameRecord | null>(this.windowSize).fill(null);
	}

	/**
	 * Opens a frame and returns the delta for `update`, in seconds, clamped to
	 * MAX_DELTA_SECONDS (R13.9). The clamp lives here rather than in each entry
	 * point's loop because there are two loops and one of them would eventually
	 * forget it.
	 *
	 * The frame that just ended is what gets recorded, not the one starting:
	 * frame time is the interval between consecutive frame starts (R13.8), so a
	 * frame's sample is only complete once the next frame begins. The newest
	 * entry in the window is therefore always the previous frame, and the
	 * sections stored with it are the sections measured inside that interval.
	 */
	public beginFrame(): number {
		const startMs = this.now();
		let deltaSeconds = 0;

		if (this.openSection !== null) {
			this.warnOnce(`section "${this.openSection.name}" was still open at the frame end`);
		}

		if (this.lastFrameStartMs !== null) {
			const frameMs = startMs - this.lastFrameStartMs;
			this.ring[this.writeIndex] = { frameMs, sections: this.pendingSections };
			this.writeIndex = (this.writeIndex + 1) % this.windowSize;
			if (this.recorded < this.windowSize) this.recorded++;
			deltaSeconds = Math.min(frameMs / 1000, MAX_DELTA_SECONDS);
			this.tracks?.emit('frame', this.lastFrameStartMs, startMs, frameMs > this.budgetMs ? 'error' : 'primary-light');
		}

		this.lastFrameStartMs = startMs;
		// Wall clock beside the monotonic one, because a consumer asking whether
		// the loop is alive compares against its own Date.now(), not against a
		// performance timeline whose origin it cannot see.
		this.lastFrameStartWallMs = this.wallNow();
		this.frameCount++;
		this.pendingSections = {};
		this.openSection = null;
		this.drawCallsThisFrame = 0;
		this.verticesThisFrame = 0;
		this.textCharactersThisFrame = 0;

		return deltaSeconds;
	}

	/** Publishes this frame's counters for the snapshot and the overlay to read. */
	public endFrame(): void {
		this.lastFrameDrawCalls = this.drawCallsThisFrame;
		this.lastFrameVertices = this.verticesThisFrame;
		this.lastFrameTextCharacters = this.textCharactersThisFrame;
	}

	/**
	 * R13.7's sections are disjoint, and this makes them disjoint by
	 * construction rather than by convention: a second section opened while one
	 * is running is refused, not nested. Worldsim's `inputHandleMs` quietly
	 * contained update and the dashboard drew the two as siblings.
	 */
	public beginSection(name: SectionName): void {
		if (this.openSection !== null) {
			this.warnOnce(`section "${name}" opened inside "${this.openSection.name}"; sections must be disjoint (R13.7)`);
			return;
		}
		this.openSection = { name, startMs: this.now() };
	}

	public endSection(name: SectionName): void {
		const open = this.openSection;
		if (open === null || open.name !== name) {
			this.warnOnce(`section "${name}" closed without being the open section`);
			return;
		}
		this.openSection = null;
		const endMs = this.now();
		this.pendingSections[name] = endMs - open.startMs;
		this.tracks?.emit(name, open.startMs, endMs, SECTION_COLORS[name]);
	}

	/**
	 * One GL draw submission, with the vertex count its call site reports.
	 * @param vertexCount Vertices in this submission.
	 */
	public recordDrawCall(vertexCount: number): void {
		this.drawCallsThisFrame++;
		this.verticesThisFrame += vertexCount;
	}

	/** @param characterCount Characters handed to the text renderer. */
	public recordTextCharacters(characterCount: number): void {
		this.textCharactersThisFrame += characterCount;
	}

	/** The frame budget the window buckets and spike counts are measured against. */
	public get budget(): number {
		return this.budgetMs;
	}

	/**
	 * R13.11's snapshot. Everything a capture or the overlay reads comes through
	 * here, so what a person sees on the F5 overlay and what an agent reads from
	 * `window.__perf` cannot drift apart.
	 *
	 * @param scene Active screen or scene name, so captures group per scene.
	 * @param batcher The draw API's counters. The timer does not own the draw
	 *   API, so the page that owns both hands them over.
	 * @param gpu The GPU timer's figures (R13.16), from the page that built it.
	 */
	public snapshot({
		scene = null,
		batcher = null,
		device = null,
		gpu = null,
	}: {
		scene?: string | null;
		batcher?: DrawStats | null;
		device?: DeviceInfo | null;
		gpu?: GpuStats | null;
	} = {}): PerfSnapshot {
		const frames = this.orderedFrames();
		const stats = frameWindowStats({
			frames,
			budgetMs: this.budgetMs,
			windowSize: this.windowSize,
		});

		const sections = {} as Record<SectionName, SectionStats | null>;
		for (const name of SECTION_NAMES) {
			sections[name] = stats.sections[name] ?? null;
		}

		this.requestMemorySample();

		return {
			timestamp: this.wallNow(),
			scene,
			frame: stats.frame,
			sections,
			// Null throughout without a timer rather than zero or false: nothing
			// was measured, and `valid: false` would read as a measurement that
			// failed its R13.18 check.
			gpu: gpu ?? { ...NO_GPU_STATS },
			batcher,
			memory: { usedBytes: this.memoryBytes },
			renderer: {
				glDrawCalls: this.lastFrameDrawCalls,
				vertices: this.lastFrameVertices,
				textCharacters: this.lastFrameTextCharacters,
			},
			sanity: stats.sanity,
			liveness: {
				frameCount: this.frameCount,
				newestSampleAgeMs: this.lastFrameStartWallMs === null
					? null
					: this.wallNow() - this.lastFrameStartWallMs,
			},
			device,
			tracks: this.tracks?.mode ?? null,
			hitches: this.hitches?.stats(this.windowStartMs(frames)) ?? null,
		};
	}

	/**
	 * Where the window's oldest frame started, on the timer's clock. The records
	 * are consecutive intervals ending at the newest frame start, so their sum
	 * walks back to it exactly. Null before the first frame.
	 */
	private windowStartMs(frames: readonly FrameRecord[]): number | null {
		if (this.lastFrameStartMs === null) return null;
		let startMs = this.lastFrameStartMs;
		for (const frame of frames) startMs -= frame.frameMs;
		return startMs;
	}

	/** Oldest first, which is the order frameWindowStats reads. */
	private orderedFrames(): FrameRecord[] {
		const frames: FrameRecord[] = [];
		const start = this.recorded < this.windowSize ? 0 : this.writeIndex;
		for (let offset = 0; offset < this.recorded; offset++) {
			const record = this.ring[(start + offset) % this.windowSize];
			if (record !== null) frames.push(record);
		}
		return frames;
	}

	/**
	 * `performance.measureUserAgentSpecificMemory` is the only honest number the
	 * platform offers (the chapter 13 mapping table), and it is asynchronous and
	 * requires cross-origin isolation. A snapshot cannot await it, so each
	 * snapshot kicks one off at most once a second and reports the last result
	 * that landed; until one does, `usedBytes` stays null rather than 0.
	 * `performance.memory.usedJSHeapSize` is not used: it is non-standard,
	 * Chromium-only, and quantised, and a number that looks measured but is not
	 * comparable is worse than null.
	 *
	 * The dev server sends the COOP and COEP headers that make the page isolated,
	 * so this reports there. It resolves on a garbage collection rather than on a
	 * request, though, so a capture shorter than the first collection sees null
	 * throughout and that is the field's documented failure mode, not a fault.
	 */
	private requestMemorySample(): void {
		if (this.memoryPending) return;
		if (typeof window === 'undefined' || !window.crossOriginIsolated) return;

		const sampledAtMs = this.wallNow();
		if (sampledAtMs - this.memoryRequestedAtMs < MEMORY_SAMPLE_INTERVAL_MS) return;

		const measure = (performance as PerformanceWithMemoryMeasure).measureUserAgentSpecificMemory;
		if (typeof measure !== 'function') return;

		this.memoryRequestedAtMs = sampledAtMs;
		this.memoryPending = true;
		measure.call(performance)
			.then((result) => {
				this.memoryBytes = result.bytes;
			})
			.catch(() => {
				this.memoryBytes = null;
			})
			.finally(() => {
				this.memoryPending = false;
			});
	}

	/**
	 * R13.44 forbids per-frame logging, and a misused section would misuse
	 * itself sixty times a second, so each distinct complaint is said once.
	 */
	private warnOnce(message: string): void {
		if (this.warned.has(message)) return;
		this.warned.add(message);
		console.warn(`FrameTimer: ${message}`);
	}
}
