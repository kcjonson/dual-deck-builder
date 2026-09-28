/**
 * R15.29's second half: `PerformanceObserver` subscriptions that attribute
 * hitches and slow input, which the frame timer's sections cannot see because
 * they sit outside the frame loop (13.8's mapping table).
 *
 * - `long-animation-frame` (Chromium 123+): a rendering update that took over
 *   50 ms, with its blocking time and the scripts that ran in it, source
 *   location included. This is the one that says whose code a hitch was.
 * - `longtask`, only where LoAF is absent (Electron 25 is Chromium 114 until
 *   DDB-22): a task over 50 ms, with no script attribution. Both are counted
 *   as long frames and the snapshot names which one it was, since the two do
 *   not measure the same span: a long task is one task, a long animation frame
 *   is every task and callback up to the paint.
 * - `event` with `durationThreshold` 16, the platform minimum: input whose
 *   delivery, handler and next paint together took over a frame. Durations are
 *   rounded to 8 ms by the platform, so a figure here is coarse by design.
 *
 * Why this is not the frame timer's `input` section: `event` entries exist only
 * for input slower than the threshold, so a section built from them would read
 * zero on every frame whose input was merely fast, which is the lie R13.5
 * forbids. `input` stays null, and slow input is reported here with its own
 * name and its own failure mode.
 *
 * Entries land in bounded rings from the observer's callback, which runs
 * between frames; nothing here runs inside the frame loop. `stats(sinceMs)`
 * reads the rings over a window the caller chooses on the `performance.now()`
 * timeline, which is how `FrameTimer` reports hitches over the same frames as
 * the rest of its snapshot.
 *
 * Feature detection is `PerformanceObserver.supportedEntryTypes`; an entry
 * type this runtime lacks reports null, never zero (R13.5). Firefox and Safari
 * support `event` and neither long-frame type.
 */

export type LongFrameSource = 'long-animation-frame' | 'longtask';

export interface LongFrameEntry {
	/** On the `performance.now()` timeline. */
	startMs: number;
	durationMs: number;
	/** LoAF's `blockingDuration`; for a long task, the part past 50 ms. */
	blockingMs: number;
	/**
	 * The longest script in the frame as `function (invoker) file:char`, or null
	 * for a long task or a frame whose time was not in script (style, layout,
	 * paint, or a GPU wait).
	 */
	script: string | null;
}

export interface LongFrameStats {
	source: LongFrameSource;
	/** Long frames that started inside the window. */
	count: number;
	/** Null when the window held none. */
	maxMs: number | null;
	blockingMs: number;
	/** The longest one in the window. */
	worst: LongFrameEntry | null;
}

export interface SlowEventEntry {
	/** `pointerdown`, `keydown`, `click` and so on. */
	name: string;
	startMs: number;
	/** Input to next paint, rounded to 8 ms by the platform. */
	durationMs: number;
	/** Input to handler start. */
	inputDelayMs: number;
	/** Handler start to handler end. */
	processingMs: number;
	/** Handler end to the next paint. */
	presentationMs: number;
}

export interface SlowEventStats {
	/** The `durationThreshold` asked for, so a reader knows what "slow" meant. */
	thresholdMs: number;
	count: number;
	maxMs: number | null;
	worst: SlowEventEntry | null;
}

/** Additive to R13.11's snapshot. A block is null where its entry types are unsupported. */
export interface HitchStats {
	longFrames: LongFrameStats | null;
	slowEvents: SlowEventStats | null;
}

/** What `FrameTimer` needs of this, so the timer stays DOM-free. */
export interface HitchSource {
	stats(sinceMs: number | null): HitchStats;
}

/** The longtask threshold, which LoAF's `blockingDuration` is measured past too. */
export const LONG_TASK_MS = 50;

/** R15.29 and 13.8's mapping table; 16 is the smallest threshold the platform honours. */
export const EVENT_THRESHOLD_MS = 16;

/** Per ring. A window holds a couple of seconds, and a hitch storm past this is already the finding. */
export const ENTRY_CAPACITY = 64;

interface ScriptTimingLike {
	duration: number;
	invoker?: string;
	sourceURL?: string;
	sourceFunctionName?: string;
	sourceCharPosition?: number;
}

interface EntryLike {
	entryType: string;
	name: string;
	startTime: number;
	duration: number;
	blockingDuration?: number;
	scripts?: readonly ScriptTimingLike[];
	processingStart?: number;
	processingEnd?: number;
}

interface ObserverListLike {
	getEntries(): readonly EntryLike[];
}

interface ObserverLike {
	observe(options: { type: string; buffered?: boolean; durationThreshold?: number }): void;
	disconnect(): void;
}

export interface ObserverConstructorLike {
	new (callback: (list: ObserverListLike) => void): ObserverLike;
	readonly supportedEntryTypes?: readonly string[];
}

export interface HitchEnvironment {
	PerformanceObserver?: ObserverConstructorLike;
}

/** A fixed-size ring, written in place so a hitch storm cannot grow memory. */
class EntryRing<T> {
	private readonly entries: (T | null)[];
	private writeIndex = 0;

	constructor(capacity: number) {
		this.entries = new Array<T | null>(capacity).fill(null);
	}

	push(entry: T): void {
		this.entries[this.writeIndex] = entry;
		this.writeIndex = (this.writeIndex + 1) % this.entries.length;
	}

	*[Symbol.iterator](): Iterator<T> {
		for (const entry of this.entries) if (entry !== null) yield entry;
	}
}

/** `onPointerDown (event-listener) main.js:1234`, from whatever LoAF supplied. */
export function describeScript(script: ScriptTimingLike): string {
	const name = script.sourceFunctionName || '(anonymous)';
	const invoker = script.invoker ? ` (${script.invoker})` : '';
	// The path alone: the origin is the dev server on every entry.
	const file = (script.sourceURL ?? '').replace(/^[a-z]+:\/\/[^/]+\//i, '').split(/[?#]/)[0];
	const location = file ? ` ${file}${script.sourceCharPosition !== undefined && script.sourceCharPosition >= 0 ? `:${script.sourceCharPosition}` : ''}` : '';
	return `${name}${invoker}${location}`;
}

export function longFrameFromEntry(entry: EntryLike): LongFrameEntry {
	if (entry.entryType === 'long-animation-frame') {
		let longest: ScriptTimingLike | null = null;
		for (const script of entry.scripts ?? []) {
			if (longest === null || script.duration > longest.duration) longest = script;
		}
		return {
			startMs: entry.startTime,
			durationMs: entry.duration,
			blockingMs: entry.blockingDuration ?? Math.max(0, entry.duration - LONG_TASK_MS),
			script: longest === null ? null : describeScript(longest),
		};
	}
	return {
		startMs: entry.startTime,
		durationMs: entry.duration,
		blockingMs: Math.max(0, entry.duration - LONG_TASK_MS),
		script: null,
	};
}

export function slowEventFromEntry(entry: EntryLike): SlowEventEntry {
	const processingStart = entry.processingStart ?? entry.startTime;
	const processingEnd = entry.processingEnd ?? processingStart;
	return {
		name: entry.name,
		startMs: entry.startTime,
		durationMs: entry.duration,
		inputDelayMs: processingStart - entry.startTime,
		processingMs: processingEnd - processingStart,
		// Clamped because `duration` is rounded to 8 ms and can land short of processingEnd.
		presentationMs: Math.max(0, entry.startTime + entry.duration - processingEnd),
	};
}

export class HitchObserver implements HitchSource {
	readonly longFrameSource: LongFrameSource | null;
	readonly observesEvents: boolean;
	private readonly longFrames = new EntryRing<LongFrameEntry>(ENTRY_CAPACITY);
	private readonly slowEvents = new EntryRing<SlowEventEntry>(ENTRY_CAPACITY);
	private readonly observers: ObserverLike[] = [];

	constructor({ PerformanceObserver: Observer }: { PerformanceObserver: ObserverConstructorLike }) {
		const supported = Observer.supportedEntryTypes ?? [];
		this.longFrameSource = supported.includes('long-animation-frame')
			? 'long-animation-frame'
			: supported.includes('longtask') ? 'longtask' : null;
		this.observesEvents = supported.includes('event');

		if (this.longFrameSource !== null) {
			this.subscribe(Observer, { type: this.longFrameSource, buffered: true }, (entry) => {
				this.longFrames.push(longFrameFromEntry(entry));
			});
		}
		if (this.observesEvents) {
			this.subscribe(Observer, { type: 'event', buffered: true, durationThreshold: EVENT_THRESHOLD_MS }, (entry) => {
				this.slowEvents.push(slowEventFromEntry(entry));
			});
		}
	}

	/**
	 * Hitches whose start falls at or after `sinceMs`, on the `performance.now()`
	 * timeline. Null means no window yet, which counts nothing rather than
	 * everything since the page loaded.
	 */
	stats(sinceMs: number | null): HitchStats {
		return {
			longFrames: this.longFrameSource === null ? null : this.longFrameStats(sinceMs),
			slowEvents: this.observesEvents ? this.slowEventStats(sinceMs) : null,
		};
	}

	disconnect(): void {
		for (const observer of this.observers) observer.disconnect();
		this.observers.length = 0;
	}

	private longFrameStats(sinceMs: number | null): LongFrameStats {
		let count = 0;
		let blockingMs = 0;
		let worst: LongFrameEntry | null = null;
		if (sinceMs !== null) {
			for (const entry of this.longFrames) {
				if (entry.startMs < sinceMs) continue;
				count++;
				blockingMs += entry.blockingMs;
				if (worst === null || entry.durationMs > worst.durationMs) worst = entry;
			}
		}
		return {
			source: this.longFrameSource as LongFrameSource,
			count,
			maxMs: worst?.durationMs ?? null,
			blockingMs,
			worst,
		};
	}

	private slowEventStats(sinceMs: number | null): SlowEventStats {
		let count = 0;
		let worst: SlowEventEntry | null = null;
		if (sinceMs !== null) {
			for (const entry of this.slowEvents) {
				if (entry.startMs < sinceMs) continue;
				count++;
				if (worst === null || entry.durationMs > worst.durationMs) worst = entry;
			}
		}
		return { thresholdMs: EVENT_THRESHOLD_MS, count, maxMs: worst?.durationMs ?? null, worst };
	}

	private subscribe(
		Observer: ObserverConstructorLike,
		options: { type: string; buffered: boolean; durationThreshold?: number },
		record: (entry: EntryLike) => void,
	): void {
		const observer = new Observer((list) => {
			for (const entry of list.getEntries()) record(entry);
		});
		observer.observe(options);
		this.observers.push(observer);
	}
}

/**
 * The observer this runtime supports, or null where there is no
 * `PerformanceObserver` or it offers none of the three entry types. The
 * environment is an argument so detection is testable without a browser.
 */
export function createHitchObserver(environment: HitchEnvironment = globalThis as HitchEnvironment): HitchObserver | null {
	const Observer = environment.PerformanceObserver;
	if (typeof Observer !== 'function') return null;
	const supported = Observer.supportedEntryTypes ?? [];
	if (!['long-animation-frame', 'longtask', 'event'].some((type) => supported.includes(type))) return null;
	return new HitchObserver({ PerformanceObserver: Observer });
}
