/**
 * R13.10's rolling-window statistics, as a pure function over an array of frame
 * records (R13.4). It imports nothing, reads no clock, and touches no DOM, so
 * the same code runs in Jest over a hand-built array and in the browser over
 * the live ring: the number a test asserts is the number a capture reads.
 *
 * Nothing here averages. R13.6 is the reason: worldsim's 120 FPS average hid
 * p99 hitches of 64 ms for weeks. Every frame figure reported is a value picked
 * out of the input rather than computed from it, so a test can assert exact
 * float equality; the only arithmetic is the sanity sum.
 *
 * Absence is not zero (R13.5). An empty window reports null for every frame
 * figure rather than 0 ms, and a section nothing measured is absent from
 * `sections` rather than present at 0.
 *
 * The spike counts have a documented failure mode, which R13.5 requires of every
 * metric. Frame time is the interval between frame starts (R13.8) and therefore
 * includes the vsync wait, so a vsync-paced run at exactly the refresh rate
 * straddles a budget of 1000/60 by design: its intervals scatter a few tenths of
 * a millisecond either side of 16.67, and a strict `> budget` test called two
 * frames in five a spike on a run with nothing wrong with it. The counts are
 * therefore taken past a tolerance (SPIKE_TOLERANCE_FRACTION, floored at
 * COARSE_CLOCK_TICK_MS), which makes them count real overruns and not pacing
 * jitter. What they still cannot do is separate a frame that overran because the
 * application was slow from one that overran because the compositor made it
 * wait; attributing that needs `present`, which is null on this backend. Read a
 * spike count beside the section maxima, never alone. The histogram is not
 * tolerated: its buckets are R13.10's, and shifting their edges would publish a
 * distribution under normative names that no longer means what the names say.
 */

export interface FrameRecord {
	/** Interval from the previous frame's start to this one's, ms (R13.8). */
	frameMs: number;
	/**
	 * Duration in ms of each section measured during that interval (R13.7).
	 * A section that was not measured is absent, never present at 0.
	 */
	sections: Readonly<Record<string, number>>;
}

/**
 * `performance.now()` is coarsened to 100 microseconds in a page that is not
 * cross-origin isolated, so on such a page no interval is finer than this. It is
 * the floor under the spike tolerance so that a small budget cannot produce a
 * tolerance narrower than the clock that measured the frame.
 */
export const COARSE_CLOCK_TICK_MS = 0.1;

/** A frame has to overrun by this much of the budget before it counts as a spike. */
export const SPIKE_TOLERANCE_FRACTION = 0.05;

export interface SectionStats {
	/** The last frame's value; null when the last frame did not measure it. */
	ms: number | null;
	/** The largest value across the window: R13.10's per-window section max. */
	maxMs: number;
}

export interface FrameStats {
	ms: number | null;
	minMs: number | null;
	maxMs: number | null;
	p99Ms: number | null;
	/** Counts for < half budget, < budget, < 2x budget, worse. */
	histogram: [number, number, number, number];
	/** Frames past budget plus the tolerance; see the header's failure mode. */
	spikesOverBudget: number;
	/** Frames past twice budget plus the tolerance. */
	spikesOver2xBudget: number;
	budgetMs: number;
	/** The configured N, which is a capacity and not a count. */
	windowSize: number;
	/**
	 * Frames actually in the window, which is what every figure above was taken
	 * over. It is below `windowSize` until the window fills, and a p99 over four
	 * frames beside a bare "windowSize: 120" reads as a p99 over 120.
	 */
	sampleCount: number;
}

/**
 * R13.5 demands a sanity check per metric, and the one the frame timer owes is
 * that its sections are disjoint and inside the frame they claim to describe.
 * `unaccountedMs` is normally large and positive: the interval between frame
 * starts includes the browser's own work and the vsync wait, neither of which
 * is a section. `framesWithSectionsOverSpan` above zero is the actual failure,
 * because sections summing past their own frame span means they overlapped or
 * the span is being measured wrong.
 */
export interface FrameSanity {
	frameMs: number | null;
	sectionsMs: number | null;
	unaccountedMs: number | null;
	framesWithSectionsOverSpan: number;
}

export interface FrameWindowStats {
	frame: FrameStats;
	/** Keyed by section name; only sections some frame in the window measured. */
	sections: Record<string, SectionStats>;
	sanity: FrameSanity;
}

export interface FrameWindowStatsOptions {
	/** Oldest first. Longer than `windowSize` is fine: the tail is what counts. */
	frames: readonly FrameRecord[];
	budgetMs: number;
	windowSize: number;
}

/**
 * p99 by nearest rank over the samples present, so a window holding fewer than
 * N frames still answers rather than waiting to fill: index ceil(0.99n) - 1 of
 * the ascending sort, which is the second-worst frame at n = 120 and the only
 * frame at n = 1. An interpolated percentile would invent a frame time that
 * never happened, and the point of p99 here is to name a frame that did.
 */
function percentile99(sorted: readonly number[]): number | null {
	if (sorted.length === 0) return null;
	const rank = Math.ceil(sorted.length * 0.99) - 1;
	return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function sumSections(sections: Readonly<Record<string, number>>): number | null {
	const names = Object.keys(sections);
	if (names.length === 0) return null;
	let total = 0;
	for (const name of names) total += sections[name];
	return total;
}

export function frameWindowStats({ frames, budgetMs, windowSize }: FrameWindowStatsOptions): FrameWindowStats {
	const size = Math.max(0, Math.floor(windowSize));
	const samples = frames.length > size ? frames.slice(frames.length - size) : frames;

	const histogram: [number, number, number, number] = [0, 0, 0, 0];
	const sections: Record<string, SectionStats> = {};
	const halfBudgetMs = budgetMs / 2;
	const doubleBudgetMs = budgetMs * 2;
	const spikeToleranceMs = Math.max(budgetMs * SPIKE_TOLERANCE_FRACTION, COARSE_CLOCK_TICK_MS);
	let minMs: number | null = null;
	let maxMs: number | null = null;
	let spikesOverBudget = 0;
	let spikesOver2xBudget = 0;
	let framesWithSectionsOverSpan = 0;

	for (const record of samples) {
		const ms = record.frameMs;
		if (minMs === null || ms < minMs) minMs = ms;
		if (maxMs === null || ms > maxMs) maxMs = ms;

		if (ms < halfBudgetMs) histogram[0]++;
		else if (ms < budgetMs) histogram[1]++;
		else if (ms < doubleBudgetMs) histogram[2]++;
		else histogram[3]++;

		// Past the tolerance, not merely past the budget: the interval carries the
		// vsync wait, so a healthy paced frame lands either side of the budget.
		if (ms > budgetMs + spikeToleranceMs) spikesOverBudget++;
		if (ms > doubleBudgetMs + spikeToleranceMs) spikesOver2xBudget++;

		for (const name of Object.keys(record.sections)) {
			const value = record.sections[name];
			const existing = sections[name];
			if (existing === undefined) sections[name] = { ms: null, maxMs: value };
			else if (value > existing.maxMs) existing.maxMs = value;
		}

		const sectionsMs = sumSections(record.sections);
		if (sectionsMs !== null && sectionsMs > ms) framesWithSectionsOverSpan++;
	}

	const last = samples.length > 0 ? samples[samples.length - 1] : null;
	for (const name of Object.keys(sections)) {
		const value = last !== null ? last.sections[name] : undefined;
		sections[name].ms = value === undefined ? null : value;
	}

	const sorted = samples.map((record) => record.frameMs).sort((a, b) => a - b);
	const lastSectionsMs = last !== null ? sumSections(last.sections) : null;

	return {
		frame: {
			ms: last !== null ? last.frameMs : null,
			minMs,
			maxMs,
			p99Ms: percentile99(sorted),
			histogram,
			spikesOverBudget,
			spikesOver2xBudget,
			budgetMs,
			windowSize: size,
			sampleCount: samples.length,
		},
		sections,
		sanity: {
			frameMs: last !== null ? last.frameMs : null,
			sectionsMs: lastSectionsMs,
			unaccountedMs: last !== null && lastSectionsMs !== null ? last.frameMs - lastSectionsMs : null,
			framesWithSectionsOverSpan,
		},
	};
}
