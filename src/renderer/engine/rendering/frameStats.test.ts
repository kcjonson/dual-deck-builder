import { frameWindowStats, COARSE_CLOCK_TICK_MS, SPIKE_TOLERANCE_FRACTION } from './frameStats';
import type { FrameRecord } from './frameStats';

/**
 * R13.10's seven outputs over a known array, with no DOM and no clock, which is
 * the point of splitting the statistics out of the timer (R13.4).
 *
 * The fixture uses a 10 ms budget so the bucket edges are 5, 10 and 20 and the
 * arithmetic is readable. Every frame figure is a value lifted out of the input
 * rather than computed from it, so these assertions are exact.
 */

const budgetMs = 10;

/**
 * Six frames: one under half budget, two under budget, two over, one past
 * double. Sections are chosen so no frame's sections sum past its own span.
 */
const fixture: FrameRecord[] = [
	{ frameMs: 4, sections: { update: 1, render: 2 } },
	{ frameMs: 9, sections: { update: 0.5, render: 3 } },
	{ frameMs: 10, sections: { update: 4, render: 1 } },
	{ frameMs: 15, sections: { update: 1, render: 9 } },
	{ frameMs: 25, sections: { update: 2, render: 20 } },
	{ frameMs: 8, sections: { update: 1.5, render: 2.5 } },
];

function stats(frames: FrameRecord[], windowSize = 120) {
	return frameWindowStats({ frames, budgetMs, windowSize });
}

describe('the frame window (R13.10)', () => {
	const result = stats(fixture);

	it('reports the last frame, not an average', () => {
		expect(result.frame.ms).toBe(8);
	});

	it('reports the window minimum and maximum', () => {
		expect(result.frame.minMs).toBe(4);
		expect(result.frame.maxMs).toBe(25);
	});

	it('reports p99 by nearest rank, which at six samples is the worst frame', () => {
		expect(result.frame.p99Ms).toBe(25);
	});

	it('buckets the window under half budget, under budget, under 2x, worse', () => {
		expect(result.frame.histogram).toEqual([1, 2, 2, 1]);
	});

	it('counts the histogram over the samples present', () => {
		const total = result.frame.histogram.reduce((sum, count) => sum + count, 0);

		expect(total).toBe(fixture.length);
	});

	it('counts spikes over budget and over twice budget', () => {
		expect(result.frame.spikesOverBudget).toBe(2);
		expect(result.frame.spikesOver2xBudget).toBe(1);
	});

	it('echoes the budget and the configured window size', () => {
		expect(result.frame.budgetMs).toBe(10);
		expect(result.frame.windowSize).toBe(120);
	});

	it('says how many frames the figures were actually taken over', () => {
		// windowSize is a capacity; a p99 over six frames published beside a bare
		// "windowSize: 120" reads as a p99 over 120.
		expect(result.frame.sampleCount).toBe(fixture.length);
		expect(result.frame.sampleCount).toBe(
			result.frame.histogram.reduce((sum, count) => sum + count, 0),
		);
	});
});

describe('the per-window section maximum (R13.10, the item worldsim lacked)', () => {
	const result = stats(fixture);

	it('reports the last frame value and the window maximum for each section', () => {
		expect(result.sections.update).toEqual({ ms: 1.5, maxMs: 4 });
		expect(result.sections.render).toEqual({ ms: 2.5, maxMs: 20 });
	});

	it('attributes a single-frame hitch from the snapshot alone', () => {
		// The 25 ms frame is the window maximum and render's 20 ms is the
		// window's section maximum, so the offender is named without a trace.
		expect(result.frame.maxMs).toBe(25);
		expect(result.sections.render.maxMs).toBe(20);
	});

	it('never invents a section nothing measured', () => {
		expect(result.sections.input).toBeUndefined();
		expect(result.sections.layout).toBeUndefined();
	});

	it('reports a null last value for a section the last frame did not measure', () => {
		const result = stats([
			{ frameMs: 10, sections: { flush: 3 } },
			{ frameMs: 10, sections: {} },
		]);

		expect(result.sections.flush).toEqual({ ms: null, maxMs: 3 });
	});
});

describe('bucket and spike edges', () => {
	it('puts a frame exactly on an edge in the bucket above it', () => {
		const result = stats([
			{ frameMs: 5, sections: {} },
			{ frameMs: 10, sections: {} },
			{ frameMs: 20, sections: {} },
		]);

		expect(result.frame.histogram).toEqual([0, 1, 1, 1]);
	});

	it('counts a spike only when the frame is strictly over', () => {
		const result = stats([
			{ frameMs: 10, sections: {} },
			{ frameMs: 20, sections: {} },
		]);

		expect(result.frame.spikesOverBudget).toBe(1);
		expect(result.frame.spikesOver2xBudget).toBe(0);
	});

	/**
	 * The interval carries the vsync wait (R13.8), so a run paced at exactly the
	 * refresh rate scatters either side of a budget of 1000/60 and a strict
	 * `> budget` test called 46 to 68 frames in 120 a spike on every screen of a
	 * perfectly smooth capture.
	 */
	it('does not call pacing jitter a spike', () => {
		const tolerance = 10 * SPIKE_TOLERANCE_FRACTION;
		const result = stats([
			{ frameMs: 10 + tolerance, sections: {} },
			{ frameMs: 10 + tolerance + 0.01, sections: {} },
			{ frameMs: 20 + tolerance, sections: {} },
			{ frameMs: 20 + tolerance + 0.01, sections: {} },
		]);

		expect(result.frame.spikesOverBudget).toBe(3);
		expect(result.frame.spikesOver2xBudget).toBe(1);
	});

	it('floors the tolerance at the coarse clock tick, so a small budget keeps one', () => {
		// 5 percent of a 1 ms budget is finer than the 0.1 ms performance.now()
		// reports on a page that is not cross-origin isolated.
		const frames = [
			{ frameMs: 1 + COARSE_CLOCK_TICK_MS, sections: {} },
			{ frameMs: 1 + COARSE_CLOCK_TICK_MS + 0.01, sections: {} },
		];

		const result = frameWindowStats({ frames, budgetMs: 1, windowSize: 120 });

		expect(result.frame.spikesOverBudget).toBe(1);
	});
});

describe('the disjointness sanity check (R13.5, R13.7)', () => {
	it('reports what the last frame accounted for and what it did not', () => {
		const result = stats(fixture);

		expect(result.sanity.frameMs).toBe(8);
		expect(result.sanity.sectionsMs).toBe(4);
		expect(result.sanity.unaccountedMs).toBe(4);
	});

	it('finds no frame whose sections outran its span in a healthy window', () => {
		expect(stats(fixture).sanity.framesWithSectionsOverSpan).toBe(0);
	});

	it('counts a frame whose sections sum past the frame span', () => {
		const result = stats([
			{ frameMs: 5, sections: { update: 3, render: 4 } },
			{ frameMs: 10, sections: { update: 1, render: 2 } },
		]);

		expect(result.sanity.framesWithSectionsOverSpan).toBe(1);
	});

	it('reports null rather than zero when the last frame measured nothing', () => {
		const result = stats([{ frameMs: 10, sections: {} }]);

		expect(result.sanity.sectionsMs).toBeNull();
		expect(result.sanity.unaccountedMs).toBeNull();
	});
});

describe('an empty window', () => {
	const result = stats([]);

	it('reports null for every frame figure rather than zero (R13.5)', () => {
		expect(result.frame.ms).toBeNull();
		expect(result.frame.minMs).toBeNull();
		expect(result.frame.maxMs).toBeNull();
		expect(result.frame.p99Ms).toBeNull();
	});

	it('reports no samples rather than the capacity it was given', () => {
		expect(result.frame.windowSize).toBe(120);
		expect(result.frame.sampleCount).toBe(0);
	});

	it('reports empty counts and no sections', () => {
		expect(result.frame.histogram).toEqual([0, 0, 0, 0]);
		expect(result.frame.spikesOverBudget).toBe(0);
		expect(result.frame.spikesOver2xBudget).toBe(0);
		expect(result.sections).toEqual({});
	});

	it('reports null sanity figures and no overlapping frames', () => {
		expect(result.sanity).toEqual({
			frameMs: null,
			sectionsMs: null,
			unaccountedMs: null,
			framesWithSectionsOverSpan: 0,
		});
	});
});

describe('a single frame', () => {
	const result = stats([{ frameMs: 12, sections: { update: 2 } }]);

	it('is its own last, minimum, maximum and p99', () => {
		expect(result.frame.ms).toBe(12);
		expect(result.frame.minMs).toBe(12);
		expect(result.frame.maxMs).toBe(12);
		expect(result.frame.p99Ms).toBe(12);
	});

	it('buckets and counts that one frame', () => {
		expect(result.frame.histogram).toEqual([0, 0, 1, 0]);
		expect(result.frame.spikesOverBudget).toBe(1);
		expect(result.frame.spikesOver2xBudget).toBe(0);
	});

	it('reports its section as both the last value and the window maximum', () => {
		expect(result.sections.update).toEqual({ ms: 2, maxMs: 2 });
	});
});

describe('fewer frames than the window size', () => {
	const result = stats(fixture.slice(0, 3), 120);

	it('answers over the samples present rather than waiting to fill', () => {
		expect(result.frame.ms).toBe(10);
		expect(result.frame.minMs).toBe(4);
		expect(result.frame.maxMs).toBe(10);
		expect(result.frame.p99Ms).toBe(10);
	});

	it('still reports the configured N, so a consumer can see the window is short', () => {
		expect(result.frame.windowSize).toBe(120);
		expect(result.frame.sampleCount).toBe(3);
		expect(result.frame.histogram.reduce((sum, count) => sum + count, 0)).toBe(3);
	});
});

describe('a window that has wrapped', () => {
	const result = stats(fixture, 3);

	it('reads the last N frames and forgets the rest', () => {
		expect(result.frame.ms).toBe(8);
		expect(result.frame.minMs).toBe(8);
		expect(result.frame.maxMs).toBe(25);
		expect(result.frame.histogram).toEqual([0, 1, 1, 1]);
	});

	it('drops the evicted frames out of the section maxima too', () => {
		// update peaked at 4 in the third frame, which the window no longer holds.
		expect(result.sections.update).toEqual({ ms: 1.5, maxMs: 2 });
		expect(result.sections.render).toEqual({ ms: 2.5, maxMs: 20 });
	});

	it('reports the window size it actually used', () => {
		expect(result.frame.windowSize).toBe(3);
		expect(result.frame.sampleCount).toBe(3);
		expect(result.frame.histogram.reduce((sum, count) => sum + count, 0)).toBe(3);
	});
});
