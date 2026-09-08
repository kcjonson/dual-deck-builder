import { FrameTimer, MAX_DELTA_SECONDS, SECTION_NAMES } from './FrameTimer';

/**
 * The live half of the timer, driven by a fake clock so a frame can be made to
 * take exactly 20 ms. The statistics it reports are frameStats' business and
 * are tested there; what is proved here is the wiring: which interval becomes a
 * frame, which spans become sections, that a nested section is refused rather
 * than silently overlapped (R13.7), and that the snapshot carries R13.11's
 * field names.
 */

let clockMs = 0;

function advance(ms: number): void {
	clockMs += ms;
}

beforeEach(() => {
	clockMs = 0;
	jest.spyOn(performance, 'now').mockImplementation(() => clockMs);
});

afterEach(() => {
	jest.restoreAllMocks();
});

/** One whole frame: open it, spend the given ms in each section, close it. */
function runFrame(timer: FrameTimer, { updateMs = 0, renderMs = 0, flushMs = 0 } = {}): number {
	const delta = timer.beginFrame();

	timer.beginSection('update');
	advance(updateMs);
	timer.endSection('update');

	timer.beginSection('render');
	advance(renderMs);
	timer.endSection('render');

	timer.beginSection('flush');
	advance(flushMs);
	timer.endSection('flush');

	timer.endFrame();
	return delta;
}

describe('the delta handed to update (R13.9)', () => {
	it('is zero on the first frame, because there is no previous frame start', () => {
		const timer = new FrameTimer();

		expect(timer.beginFrame()).toBe(0);
	});

	it('is the interval between consecutive frame starts, in seconds', () => {
		const timer = new FrameTimer();
		timer.beginFrame();
		advance(16);

		expect(timer.beginFrame()).toBeCloseTo(0.016, 6);
	});

	it('is clamped, so a backgrounded tab does not hand update a ten second step', () => {
		const timer = new FrameTimer();
		timer.beginFrame();
		advance(10000);

		expect(timer.beginFrame()).toBe(MAX_DELTA_SECONDS);
	});
});

describe('frame time is the interval between frame starts (R13.8)', () => {
	it('records the interval, not the work inside it', () => {
		const timer = new FrameTimer();
		runFrame(timer, { updateMs: 2, renderMs: 3 });
		advance(15); // idle until the next frame starts: 20 ms between starts
		runFrame(timer);

		expect(timer.snapshot().frame.ms).toBe(20);
	});

	it("completes a frame's record only when the next frame begins", () => {
		const timer = new FrameTimer();
		runFrame(timer, { updateMs: 2, renderMs: 3 });

		// One frame has started and ended, but no second start has happened, so
		// there is no interval yet and nothing to report.
		expect(timer.snapshot().frame.ms).toBeNull();
	});

	it('stores the sections measured inside the interval it reports', () => {
		const timer = new FrameTimer();
		runFrame(timer, { updateMs: 2, renderMs: 3, flushMs: 1 });
		advance(14);
		runFrame(timer, { updateMs: 9, renderMs: 9, flushMs: 9 });

		const { sections } = timer.snapshot();

		expect(sections.update).toEqual({ ms: 2, maxMs: 2 });
		expect(sections.render).toEqual({ ms: 3, maxMs: 3 });
		expect(sections.flush).toEqual({ ms: 1, maxMs: 1 });
	});
});

describe('sections are disjoint by construction (R13.7)', () => {
	it('refuses a section opened inside another and keeps the outer measurement', () => {
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
		const timer = new FrameTimer();

		timer.beginFrame();
		timer.beginSection('update');
		advance(1);
		timer.beginSection('render');
		advance(3);
		timer.endSection('update');
		timer.endFrame();
		advance(10);
		timer.beginFrame();

		const { sections } = timer.snapshot();

		expect(sections.update?.ms).toBe(4);
		expect(sections.render).toBeNull();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('complains once rather than sixty times a second (R13.44)', () => {
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
		const timer = new FrameTimer();

		for (let frame = 0; frame < 10; frame++) {
			timer.beginFrame();
			timer.beginSection('update');
			timer.beginSection('render');
			timer.endSection('update');
			timer.endFrame();
			advance(16);
		}

		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('ignores a close that does not match the open section', () => {
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
		const timer = new FrameTimer();

		timer.beginFrame();
		timer.beginSection('update');
		advance(2);
		timer.endSection('render');
		timer.endFrame();
		advance(10);
		timer.beginFrame();

		expect(timer.snapshot().sections.render).toBeNull();
		expect(warn).toHaveBeenCalled();
	});

	it('reports the sanity sum of the sections against the frame span', () => {
		const timer = new FrameTimer();
		runFrame(timer, { updateMs: 2, renderMs: 3, flushMs: 1 });
		advance(14);
		runFrame(timer);

		const { sanity } = timer.snapshot();

		expect(sanity.frameMs).toBe(20);
		expect(sanity.sectionsMs).toBe(6);
		expect(sanity.unaccountedMs).toBe(14);
		expect(sanity.framesWithSectionsOverSpan).toBe(0);
	});
});

describe('the rolling window (R13.10)', () => {
	it('defaults to 120 frames', () => {
		const timer = new FrameTimer();

		expect(timer.snapshot().frame.windowSize).toBe(120);
	});

	it('keeps the last N frames once it has wrapped', () => {
		const timer = new FrameTimer({ windowSize: 3, budgetMs: 10 });

		for (const frameMs of [40, 40, 40, 8, 9, 12]) {
			timer.beginFrame();
			timer.endFrame();
			advance(frameMs);
		}
		timer.beginFrame(); // closes the 12 ms frame

		const { frame } = timer.snapshot();

		expect(frame.histogram.reduce((sum, count) => sum + count, 0)).toBe(3);
		expect(frame.maxMs).toBe(12);
		expect(frame.minMs).toBe(8);
	});
});

describe('the draw counters', () => {
	it('reports the frame just ended and resets at the next frame start', () => {
		const timer = new FrameTimer();

		timer.beginFrame();
		timer.recordDrawCall(4);
		timer.recordDrawCall(6);
		timer.recordTextCharacters(11);
		timer.endFrame();

		expect(timer.snapshot().renderer).toEqual({ glDrawCalls: 2, vertices: 10, textCharacters: 11 });

		advance(16);
		timer.beginFrame();
		timer.endFrame();

		expect(timer.snapshot().renderer).toEqual({ glDrawCalls: 0, vertices: 0, textCharacters: 0 });
	});
});

describe('liveness, which nothing else in the snapshot answers', () => {
	/**
	 * `timestamp` is read fresh on every snapshot while the ring can be minutes
	 * stale, so a frozen loop reports the healthy window it froze in. A rAF
	 * throttled by an occluded tab did exactly that twice during this task.
	 */
	it('counts every frame begun, monotonically past a window wrap', () => {
		const timer = new FrameTimer({ windowSize: 2 });

		for (let frame = 0; frame < 5; frame++) {
			advance(16);
			runFrame(timer);
		}

		expect(timer.snapshot().liveness.frameCount).toBe(5);
	});

	it('ages the newest sample against the wall clock, so a stopped loop shows', () => {
		let wallMs = 1_000_000;
		jest.spyOn(Date, 'now').mockImplementation(() => wallMs);
		const timer = new FrameTimer();

		advance(16);
		runFrame(timer);
		const live = timer.snapshot().liveness;

		// The loop stops here: the clock moves on and nothing calls beginFrame.
		wallMs += 2000;
		const stalled = timer.snapshot().liveness;

		expect(live.newestSampleAgeMs).toBe(0);
		expect(stalled.newestSampleAgeMs).toBe(2000);
		expect(stalled.frameCount).toBe(live.frameCount);
	});

	it('reports a null age before any frame has started', () => {
		const timer = new FrameTimer();

		expect(timer.snapshot().liveness).toEqual({ frameCount: 0, newestSampleAgeMs: null });
	});
});

describe('the snapshot shape (R13.11)', () => {
	// Built inside the tests rather than at describe scope, because the fake
	// clock is installed per test.
	function capture() {
		const timer = new FrameTimer();
		runFrame(timer, { updateMs: 2, renderMs: 3 });
		advance(15);
		runFrame(timer, { updateMs: 1, renderMs: 1 });
		return { timer, snapshot: timer.snapshot({ scene: 'combat' }) };
	}

	it('carries the normative top-level fields, and adds after them', () => {
		const { snapshot } = capture();

		expect(Object.keys(snapshot)).toEqual([
			'timestamp', 'scene', 'frame', 'sections', 'gpu', 'batcher', 'memory', 'renderer', 'sanity',
			'liveness',
		]);
	});

	it('carries the normative frame fields, and adds after them', () => {
		const { snapshot } = capture();

		expect(Object.keys(snapshot.frame)).toEqual([
			'ms', 'minMs', 'maxMs', 'p99Ms', 'histogram',
			'spikesOverBudget', 'spikesOver2xBudget', 'budgetMs', 'windowSize',
			'sampleCount',
		]);
	});

	it('carries R13.7\'s six section names, measured or not', () => {
		const { snapshot } = capture();

		expect(Object.keys(snapshot.sections)).toEqual([...SECTION_NAMES]);
	});

	it('carries the normative gpu fields, all null until phase 7', () => {
		const { snapshot } = capture();

		expect(snapshot.gpu).toEqual({ ms: null, valid: null, passes: null, spanMs: null, latencyMs: null });
	});

	it('reports null, never zero, for what this platform cannot measure (R13.5)', () => {
		const { snapshot } = capture();

		expect(snapshot.sections.input).toBeNull();
		expect(snapshot.sections.layout).toBeNull();
		expect(snapshot.sections.present).toBeNull();
		expect(snapshot.memory.usedBytes).toBeNull();
	});

	it('leaves the batcher a placeholder rather than inventing counters (R13.12)', () => {
		const { snapshot } = capture();

		expect(snapshot.batcher).toBeNull();
	});

	it('carries the scene so a capture can group per scene', () => {
		const { timer, snapshot } = capture();

		expect(snapshot.scene).toBe('combat');
		expect(timer.snapshot().scene).toBeNull();
	});

	it('survives JSON round-tripping, which is how a harness reads it (R13.3)', () => {
		const { snapshot } = capture();

		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
	});
});
