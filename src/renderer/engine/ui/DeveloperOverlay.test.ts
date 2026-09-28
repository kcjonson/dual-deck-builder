import { DeveloperOverlay, hitchLines } from './DeveloperOverlay';
import { FrameTimer } from '../rendering/FrameTimer';
import { EVENT_THRESHOLD_MS } from '../debug/hitchObserver';

function overlay(viewportWidth: number): DeveloperOverlay {
	return new DeveloperOverlay({ snapshot: () => new FrameTimer().snapshot(), viewportWidth });
}

describe('the overlay\'s anchor (R7.11)', () => {
	it('sits ten logical pixels in from the top-right corner of the viewport it was given', () => {
		const developerOverlay = overlay(1440);

		expect(developerOverlay.getX()).toBe(1440 - developerOverlay.getWidth() - 10);
		expect(developerOverlay.getY()).toBe(10);
	});

	it('follows a new viewport width rather than staying where the first one put it', () => {
		const developerOverlay = overlay(1440);
		developerOverlay.viewportWidth = 900;

		expect(developerOverlay.viewportWidth).toBe(900);
		expect(developerOverlay.getX()).toBe(900 - developerOverlay.getWidth() - 10);
	});
});

describe('hitchLines (R15.29)', () => {
	it('says n/a for both where nothing was observed, never zero (R13.5)', () => {
		expect(hitchLines(null)).toEqual(['Long frames: n/a', 'Slow input: n/a']);
	});

	it('reports a clean window as counted zeros, with the source and threshold', () => {
		expect(hitchLines({
			longFrames: { source: 'longtask', count: 0, maxMs: null, blockingMs: 0, worst: null },
			slowEvents: { thresholdMs: EVENT_THRESHOLD_MS, count: 0, maxMs: null, worst: null },
		})).toEqual(['Long frames: 0 (long tasks)', 'Slow input: 0 over 16ms']);
	});

	it('names the worst long frame\'s script and the slowest input\'s phases', () => {
		expect(hitchLines({
			longFrames: {
				source: 'long-animation-frame',
				count: 2,
				maxMs: 84,
				blockingMs: 40,
				worst: { startMs: 0, durationMs: 84, blockingMs: 34, script: 'handlePointer (CANVAS.onpointerdown) main.js:4521' },
			},
			slowEvents: {
				thresholdMs: EVENT_THRESHOLD_MS,
				count: 1,
				maxMs: 48,
				worst: { name: 'pointerdown', startMs: 0, durationMs: 48, inputDelayMs: 12, processingMs: 28, presentationMs: 8 },
			},
		})).toEqual([
			'Long frames: 2, max 84.0ms, blocking 40.0ms (LoAF)',
			'  worst: handlePointer (CANVAS.onpointerdown) main.js:4521',
			'Slow input: 1, max 48.0ms pointerdown (delay 12.0ms, handler 28.0ms)',
		]);
	});
});
