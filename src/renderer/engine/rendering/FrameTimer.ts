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
 *   application's per-frame work. `flush` is narrower than R13.7's "GPU
 *   submission" and has to be read that way: the renderer is immediate mode, so
 *   every primitive submits to GL at its draw site inside `render`, and the
 *   batched text flush is the only submission the frame defers. It is measured
 *   rather than folded into `render` because it is the number the phase 1
 *   batcher has to beat. It undercounts, and by how much depends on the screen:
 *   `Renderer.enableScissor` and `disableScissor` flush pending text before they
 *   touch GL state, and `Panel` and `Layer` call those while the render tree is
 *   being walked, so on any screen with a clipped panel most of the text has
 *   already submitted inside `render` and the `flush` section only sees the
 *   tail. Read a low `flush` next to the clip count, not on its own.
 * - `input` is null. This engine dispatches input straight from DOM listeners
 *   on the canvas, so input handling happens between frames, not in a phase of
 *   one; a section here would read 0 forever while real input cost lands
 *   invisibly outside the loop. Attributing it needs a PerformanceObserver on
 *   `event` entries, which the chapter 13 mapping table names and phase 0 does
 *   not build.
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

export interface GpuStats {
	ms: number | null;
	valid: boolean | null;
	passes: number[] | null;
	spanMs: number | null;
	latencyMs: number | null;
}

/**
 * What the immediate-mode renderer can actually count today, under names that
 * say exactly what they count. This is deliberately not `batcher` (R13.12):
 * there is no batcher until phase 1, `glDrawCalls` is one increment per
 * `drawElements` or `drawArrays` at its call site, and `vertices` is the count
 * each call site reports for itself. Naming either of them `apiDraws` or
 * `gpuDraws` would publish R13.12's field names over numbers that do not mean
 * what those names promise.
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
	/** R13.12's counters arrive with the batcher in phase 1. */
	batcher: null;
	memory: { usedBytes: number | null };
	renderer: RendererCounters;
	sanity: FrameSanity;
	liveness: LivenessStats;
}

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

	constructor({ budgetMs = DEFAULT_BUDGET_MS, windowSize = DEFAULT_WINDOW_SIZE } = {}) {
		this.budgetMs = budgetMs;
		this.windowSize = Math.max(1, Math.floor(windowSize));
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
		const startMs = performance.now();
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
		}

		this.lastFrameStartMs = startMs;
		// Wall clock beside the monotonic one, because a consumer asking whether
		// the loop is alive compares against its own Date.now(), not against a
		// performance timeline whose origin it cannot see.
		this.lastFrameStartWallMs = Date.now();
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
		this.openSection = { name, startMs: performance.now() };
	}

	public endSection(name: SectionName): void {
		const open = this.openSection;
		if (open === null || open.name !== name) {
			this.warnOnce(`section "${name}" closed without being the open section`);
			return;
		}
		this.openSection = null;
		this.pendingSections[name] = performance.now() - open.startMs;
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
	 */
	public snapshot({ scene = null }: { scene?: string | null } = {}): PerfSnapshot {
		const stats = frameWindowStats({
			frames: this.orderedFrames(),
			budgetMs: this.budgetMs,
			windowSize: this.windowSize,
		});

		const sections = {} as Record<SectionName, SectionStats | null>;
		for (const name of SECTION_NAMES) {
			sections[name] = stats.sections[name] ?? null;
		}

		this.requestMemorySample();

		return {
			timestamp: Date.now(),
			scene,
			frame: stats.frame,
			sections,
			// GPU timing is phase 7. Null throughout rather than zero or false:
			// nothing has been measured, and `valid: false` would read as a
			// measurement that failed its R13.18 check.
			gpu: { ms: null, valid: null, passes: null, spanMs: null, latencyMs: null },
			batcher: null,
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
					: Date.now() - this.lastFrameStartWallMs,
			},
		};
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

		const now = Date.now();
		if (now - this.memoryRequestedAtMs < MEMORY_SAMPLE_INTERVAL_MS) return;

		const measure = (performance as PerformanceWithMemoryMeasure).measureUserAgentSpecificMemory;
		if (typeof measure !== 'function') return;

		this.memoryRequestedAtMs = now;
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
