import {
	ENTRY_CAPACITY,
	EVENT_THRESHOLD_MS,
	HitchObserver,
	ObserverConstructorLike,
	createHitchObserver,
	describeScript,
	longFrameFromEntry,
	slowEventFromEntry,
} from './hitchObserver';
import { DEFAULT_WINDOW_SIZE } from '../rendering/FrameTimer';

/**
 * A scripted `PerformanceObserver`: it records what each instance was asked to
 * observe and lets a test deliver entries to it, which is all the real one does
 * from this module's point of view.
 */
type Entry = Parameters<typeof longFrameFromEntry>[0];

function fakeObserver(supportedEntryTypes: string[]) {
	const instances: { options: { type: string; buffered?: boolean; durationThreshold?: number } | null; callback: (list: { getEntries(): Entry[] }) => void; disconnected: boolean }[] = [];
	const Observer = class {
		static readonly supportedEntryTypes = supportedEntryTypes;
		private readonly instance: (typeof instances)[number];
		constructor(callback: (list: { getEntries(): Entry[] }) => void) {
			this.instance = { options: null, callback, disconnected: false };
			instances.push(this.instance);
		}
		observe(options: { type: string; buffered?: boolean; durationThreshold?: number }): void {
			this.instance.options = options;
		}
		disconnect(): void {
			this.instance.disconnected = true;
		}
	} as unknown as ObserverConstructorLike;

	function deliver(type: string, entries: Entry[]): void {
		const instance = instances.find((candidate) => candidate.options?.type === type);
		if (!instance) throw new Error(`nothing observes ${type}`);
		instance.callback({ getEntries: () => entries });
	}

	return { Observer, instances, deliver };
}

function loaf(startTime: number, duration: number, extra: Partial<Entry> = {}): Entry {
	return { entryType: 'long-animation-frame', name: 'long-animation-frame', startTime, duration, blockingDuration: duration - 50, scripts: [], ...extra };
}

function event(name: string, startTime: number, duration: number, processingStart: number, processingEnd: number): Entry {
	return { entryType: 'event', name, startTime, duration, processingStart, processingEnd };
}

describe('feature detection (R15.29, R15.42)', () => {
	it('has nothing without a PerformanceObserver', () => {
		expect(createHitchObserver({})).toBeNull();
	});

	it('has nothing where none of the three entry types is supported', () => {
		expect(createHitchObserver({ PerformanceObserver: fakeObserver(['mark', 'measure']).Observer })).toBeNull();
	});

	it('prefers LoAF and asks for the event threshold, buffered, in current Chromium', () => {
		const { Observer, instances } = fakeObserver(['long-animation-frame', 'longtask', 'event']);
		const observer = createHitchObserver({ PerformanceObserver: Observer });

		expect(observer?.longFrameSource).toBe('long-animation-frame');
		expect(instances.map((instance) => instance.options)).toEqual([
			{ type: 'long-animation-frame', buffered: true },
			{ type: 'event', buffered: true, durationThreshold: EVENT_THRESHOLD_MS },
		]);
	});

	it('falls back to long tasks where LoAF is absent, as in Electron 25', () => {
		const { Observer, instances } = fakeObserver(['longtask', 'event']);

		expect(createHitchObserver({ PerformanceObserver: Observer })?.longFrameSource).toBe('longtask');
		expect(instances[0].options?.type).toBe('longtask');
	});

	it('reports null for a block whose entry type is unsupported, never zero (R13.5)', () => {
		const observer = createHitchObserver({ PerformanceObserver: fakeObserver(['event']).Observer });

		expect(observer?.stats(0)).toEqual({
			longFrames: null,
			slowEvents: { thresholdMs: EVENT_THRESHOLD_MS, count: 0, saturated: false, maxMs: null, worst: null },
		});
	});

	it('disconnects every subscription', () => {
		const { Observer, instances } = fakeObserver(['long-animation-frame', 'event']);
		createHitchObserver({ PerformanceObserver: Observer })?.disconnect();

		expect(instances.every((instance) => instance.disconnected)).toBe(true);
	});
});

describe('the window', () => {
	function observed(): { observer: HitchObserver; deliver: (type: string, entries: Entry[]) => void } {
		const { Observer, deliver } = fakeObserver(['long-animation-frame', 'event']);
		return { observer: new HitchObserver({ PerformanceObserver: Observer }), deliver };
	}

	it('counts only what started inside it, and names the longest', () => {
		const { observer, deliver } = observed();
		deliver('long-animation-frame', [loaf(100, 120), loaf(1000, 60), loaf(1500, 90)]);

		expect(observer.stats(900).longFrames).toEqual({
			source: 'long-animation-frame',
			count: 2,
			saturated: false,
			maxMs: 90,
			blockingMs: 10 + 40,
			worst: { startMs: 1500, durationMs: 90, blockingMs: 40, script: null },
		});
	});

	it('counts nothing when there is no window yet', () => {
		const { observer, deliver } = observed();
		deliver('long-animation-frame', [loaf(100, 120)]);
		deliver('event', [event('pointerdown', 100, 40, 110, 130)]);

		expect(observer.stats(null).longFrames).toMatchObject({ count: 0, maxMs: null, worst: null });
		expect(observer.stats(null).slowEvents).toMatchObject({ count: 0, maxMs: null, worst: null });
	});

	it('names the slowest input with its three phases', () => {
		const { observer, deliver } = observed();
		deliver('event', [event('keydown', 500, 24, 502, 510), event('pointerdown', 600, 48, 612, 640)]);

		expect(observer.stats(0).slowEvents).toEqual({
			thresholdMs: EVENT_THRESHOLD_MS,
			count: 2,
			saturated: false,
			maxMs: 48,
			worst: { name: 'pointerdown', startMs: 600, durationMs: 48, inputDelayMs: 12, processingMs: 28, presentationMs: 8 },
		});
	});

	it('holds twice the frame window, so a window of nothing but long frames still fits', () => {
		expect(ENTRY_CAPACITY).toBe(2 * DEFAULT_WINDOW_SIZE);
	});

	it('keeps a bounded number of entries, and says so when it dropped one still in the window', () => {
		const { observer, deliver } = observed();
		const entries = Array.from({ length: ENTRY_CAPACITY + 10 }, (_, index) => loaf(index * 100, 60 + index));
		deliver('long-animation-frame', entries);

		const all = observer.stats(0).longFrames;
		expect(all?.count).toBe(ENTRY_CAPACITY);
		expect(all?.saturated).toBe(true);
		expect(all?.maxMs).toBe(60 + ENTRY_CAPACITY + 9);

		// The ten overwritten entries started at 0 to 900; a window opening
		// after them lost nothing and is exact.
		expect(observer.stats(1000).longFrames?.saturated).toBe(false);
		expect(observer.stats(900).longFrames?.saturated).toBe(true);
	});
});

describe('entry conversion', () => {
	it('attributes a long animation frame to its longest script', () => {
		const frame = longFrameFromEntry(loaf(0, 80, {
			scripts: [
				{ duration: 5, invoker: 'FrameRequestCallback', sourceURL: 'http://localhost:8080/main.js', sourceFunctionName: 'loop', sourceCharPosition: 10 },
				{ duration: 60, invoker: 'CANVAS.onpointerdown', sourceURL: 'http://localhost:8080/main.js?v=1', sourceFunctionName: 'handlePointer', sourceCharPosition: 4521 },
			],
		}));

		expect(frame.script).toBe('handlePointer (CANVAS.onpointerdown) main.js:4521');
		expect(frame.blockingMs).toBe(30);
	});

	it('takes a long task\'s blocking time as the part past 50 ms, with no script', () => {
		expect(longFrameFromEntry({ entryType: 'longtask', name: 'self', startTime: 10, duration: 75 })).toEqual({
			startMs: 10, durationMs: 75, blockingMs: 25, script: null,
		});
	});

	it('describes a script with whatever LoAF supplied', () => {
		expect(describeScript({ duration: 1 })).toBe('(anonymous)');
		expect(describeScript({ duration: 1, invoker: 'TimerHandler:setTimeout', sourceURL: 'https://example.test/a/b.js', sourceCharPosition: -1 }))
			.toBe('(anonymous) (TimerHandler:setTimeout) a/b.js');
	});

	it('never reports a negative presentation delay from the platform\'s 8 ms rounding', () => {
		expect(slowEventFromEntry(event('click', 100, 16, 101, 118)).presentationMs).toBe(0);
	});
});
