/**
 * R13.38's sampler, in the page. The rule wants a script that drives a fixed
 * list of scenarios, samples the snapshot N times per scenario after a settle
 * period, and writes `perf-results/<label>.json` as
 * `[ { "scenario", "samples": [snapshot...] } ]`. The driving and the writing
 * belong to the harness outside the page; the sampling has to happen inside it,
 * one sample per frame, and this is that half. A harness awaits this once per
 * scenario and writes the array it collects.
 *
 * The settle period is counted in frames rather than milliseconds because what
 * it is waiting for is the window filling with frames from the scene under
 * test: a capture that starts sampling immediately after a scene mounts reports
 * the mount cost as the scene's p99.
 *
 * Generic over the snapshot type so this module imports nothing and can be
 * tested with a counter for a clock and an array for a scheduler (R13.4).
 *
 * What this cannot do is R13.38's other half, turning vsync and frame capping
 * off. In a browser that is a launch flag (`--disable-frame-rate-limit
 * --disable-gpu-vsync`), not an in-page call, so a captured frame time here is
 * a vsync-paced one and the harness has to say so.
 */

export interface ScenarioCapture<TSnapshot> {
	scenario: string;
	samples: TSnapshot[];
}

export interface PerfCaptureOptions<TSnapshot> {
	/** Scenario label, written straight into the R13.38 record. */
	scenario: string;
	snapshot: () => TSnapshot;
	/** Frames to let pass before the first sample. */
	settleFrames?: number;
	/** Samples to take, one per frame. */
	samples?: number;
	/** Frame scheduler. Defaults to requestAnimationFrame. */
	schedule?: (callback: () => void) => void;
}

/** Long enough for a 120-frame window to hold only the scene under test. */
export const DEFAULT_SETTLE_FRAMES = 120;

/** One full window of samples, each a window's worth of frames wide. */
export const DEFAULT_SAMPLE_COUNT = 120;

export function capturePerfSamples<TSnapshot>({
	scenario,
	snapshot,
	settleFrames = DEFAULT_SETTLE_FRAMES,
	samples = DEFAULT_SAMPLE_COUNT,
	schedule = (callback: () => void) => {
		requestAnimationFrame(() => callback());
	},
}: PerfCaptureOptions<TSnapshot>): Promise<ScenarioCapture<TSnapshot>> {
	const wanted = Math.max(1, Math.floor(samples));
	const settle = Math.max(0, Math.floor(settleFrames));
	const collected: TSnapshot[] = [];
	let remainingSettle = settle;

	return new Promise<ScenarioCapture<TSnapshot>>((resolve, reject) => {
		const step = (): void => {
			try {
				if (remainingSettle > 0) {
					remainingSettle--;
				} else {
					collected.push(snapshot());
					if (collected.length >= wanted) {
						resolve({ scenario, samples: collected });
						return;
					}
				}
			} catch (error) {
				reject(error);
				return;
			}
			schedule(step);
		};

		schedule(step);
	});
}
