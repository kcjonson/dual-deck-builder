import { capturePerfSamples } from './perfCapture';

/**
 * R13.38's sampler with the frame loop replaced by a queue, so "one sample per
 * frame after a settle period" is provable without a browser (R13.4).
 */

/** Runs whatever the sampler scheduled, until it stops scheduling. */
function drainFrames(pending: (() => void)[], limit = 1000): void {
	let ran = 0;
	while (pending.length > 0 && ran < limit) {
		const next = pending.shift();
		next?.();
		ran++;
	}
}

describe('capturing a scenario', () => {
	it('discards the settle frames and then samples one per frame', async () => {
		const pending: (() => void)[] = [];
		let frame = 0;
		const capture = capturePerfSamples({
			scenario: 'main-menu',
			snapshot: () => ({ frame }),
			settleFrames: 3,
			samples: 2,
			schedule: (callback) => {
				frame++;
				pending.push(callback);
			},
		});

		drainFrames(pending);

		// Frames 1 to 3 settle, so the samples come from frames 4 and 5.
		await expect(capture).resolves.toEqual({
			scenario: 'main-menu',
			samples: [{ frame: 4 }, { frame: 5 }],
		});
	});

	it('samples immediately when nothing needs to settle', async () => {
		const pending: (() => void)[] = [];
		const capture = capturePerfSamples({
			scenario: 'stress',
			snapshot: () => 'sample',
			settleFrames: 0,
			samples: 3,
			schedule: (callback) => pending.push(callback),
		});

		drainFrames(pending);

		await expect(capture).resolves.toEqual({ scenario: 'stress', samples: ['sample', 'sample', 'sample'] });
	});

	it('stops scheduling once it has what it was asked for', async () => {
		const pending: (() => void)[] = [];
		let scheduled = 0;
		const capture = capturePerfSamples({
			scenario: 'stress',
			snapshot: () => 1,
			settleFrames: 2,
			samples: 2,
			schedule: (callback) => {
				scheduled++;
				pending.push(callback);
			},
		});

		drainFrames(pending);
		await capture;

		expect(scheduled).toBe(4);
		expect(pending).toHaveLength(0);
	});

	it('takes at least one sample however few it is asked for', async () => {
		const pending: (() => void)[] = [];
		const capture = capturePerfSamples({
			scenario: 'edge',
			snapshot: () => 1,
			settleFrames: 0,
			samples: 0,
			schedule: (callback) => pending.push(callback),
		});

		drainFrames(pending);

		await expect(capture).resolves.toEqual({ scenario: 'edge', samples: [1] });
	});

	it('rejects rather than hanging when the snapshot throws', async () => {
		const pending: (() => void)[] = [];
		const capture = capturePerfSamples({
			scenario: 'broken',
			snapshot: () => {
				throw new Error('no timer');
			},
			settleFrames: 0,
			samples: 1,
			schedule: (callback) => pending.push(callback),
		});

		drainFrames(pending);

		await expect(capture).rejects.toThrow('no timer');
	});
});
