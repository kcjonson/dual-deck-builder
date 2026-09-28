/**
 * @jest-environment jsdom
 */
import { DeveloperOverlay, hitchLines } from './DeveloperOverlay';
import { FrameTimer } from '../rendering/FrameTimer';
import { EVENT_THRESHOLD_MS } from '../debug/hitchObserver';
import { DrawApi, RecordingBackend } from '../draw';
import { RendererContext } from '../rendering/RendererContext';
import { committedFontAtlas } from '../text/testing';
import { Layer } from '../components/Layer';
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';

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

describe('the overlay paints above every screen draw (R3.21)', () => {
	let backend: RecordingBackend;
	let draw: DrawApi;

	beforeEach(() => {
		backend = new RecordingBackend({ maxFrames: 1 });
		backend.loadFontAtlas({
			name: 'body',
			atlas: committedFontAtlas('body'),
			texture: { id: 1, width: 1, height: 1, label: null },
		});
		draw = new DrawApi({ backend });
		RendererContext.getInstance().draw = draw;
	});

	/**
	 * The main menu's shape: a background, then a title where the overlay
	 * sits. Order inside one domain is by layer, then submission (R3.10), so
	 * submitting last only wins against `base` content; this checks the
	 * overlay is a later domain, which wins against every layer.
	 */
	function frame(developerOverlay: DeveloperOverlay): void {
		const screen = new Layer({ id: 'screen', width: 1440, height: 882 });
		screen.addChild(new Rectangle({ id: 'screen_background', width: 1440, height: 882 }));
		screen.addChild(new Text('Dual Deckbuilder', { id: 'title', x: 1000, y: 20 }));

		draw.beginFrame({ viewport: { width: 1440, height: 882 }, ratio: 1 });
		screen.render();
		developerOverlay.update();
		developerOverlay.render();
		draw.endFrame();
	}

	it('submits the screen as a finished domain before any overlay draw', () => {
		const developerOverlay = overlay(1440);
		developerOverlay.toggle();
		frame(developerOverlay);

		const [screenDomain, overlayDomain, ...rest] = backend.batches;
		expect(rest).toEqual([]);
		expect(screenDomain.reason).toBe('barrier');
		expect(screenDomain.commands.map((command) => command.id)).toEqual(['screen_background', 'title']);
		// Background panel and readout, nothing of the screen's.
		expect(overlayDomain.commands.length).toBeGreaterThanOrEqual(2);
		expect(overlayDomain.commands.map((command) => command.id)).not.toContain('title');
	});

	it('adds no barrier while hidden, so the frame is what it was without an overlay', () => {
		frame(overlay(1440));

		expect(backend.batches).toHaveLength(1);
		expect(backend.batches[0].reason).toBe('endFrame');
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
