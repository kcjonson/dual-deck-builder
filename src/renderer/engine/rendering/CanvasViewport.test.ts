import { CanvasViewport, ViewportCanvas, ViewportPlatform } from './CanvasViewport';

/**
 * Both of R15.4's paths, driven by hand: the device-pixel box Chromium and
 * Firefox report, and the WebKit fallback that rounds from CSS pixels. The
 * fallback is the live path on Safari, so it is exercised here rather than
 * left as code no test reaches.
 */

type ResizeCallback = (entries: ResizeObserverEntry[]) => void;

interface FakeWindow extends ViewportPlatform {
	devicePixelRatio: number;
	queries: string[];
	/** Fires the current resolution query's change listeners, as a monitor move would. */
	changeResolution(dpr: number): void;
	/** Delivers one observer entry for a CSS box and, when the platform has them, its device pixels. */
	resize(cssWidth: number, cssHeight: number, devicePixels?: { width: number; height: number }): void;
	observedBox: string | null;
}

function fakeWindow({ dpr, deviceBox }: { dpr: number; deviceBox: boolean }): FakeWindow {
	let callback: ResizeCallback | null = null;
	let listeners: (() => void)[] = [];
	const platform: FakeWindow = {
		devicePixelRatio: dpr,
		queries: [],
		observedBox: null,
		matchMedia(query: string) {
			platform.queries.push(query);
			const own: (() => void)[] = [];
			listeners = own;
			return {
				addEventListener: (_type: 'change', listener: () => void) => own.push(listener),
				removeEventListener: (_type: 'change', listener: () => void) => {
					const index = own.indexOf(listener);
					if (index >= 0) own.splice(index, 1);
				},
			};
		},
		ResizeObserver: class {
			constructor(observed: ResizeCallback) {
				callback = observed;
			}
			observe(_target: Element, options?: ResizeObserverOptions) {
				if (options?.box === 'device-pixel-content-box' && !deviceBox) {
					throw new TypeError("The provided value 'device-pixel-content-box' is not a valid enum value");
				}
				platform.observedBox = options?.box ?? null;
			}
			disconnect() {
				callback = null;
			}
			unobserve() {
				// Not used.
			}
		} as unknown as typeof ResizeObserver,
		changeResolution(next: number) {
			platform.devicePixelRatio = next;
			for (const listener of [...listeners]) listener();
		},
		resize(cssWidth, cssHeight, devicePixels) {
			const entry = {
				contentRect: { width: cssWidth, height: cssHeight },
				contentBoxSize: [{ inlineSize: cssWidth, blockSize: cssHeight }],
				devicePixelContentBoxSize: deviceBox && devicePixels
					? [{ inlineSize: devicePixels.width, blockSize: devicePixels.height }]
					: undefined,
			} as unknown as ResizeObserverEntry;
			callback?.([entry]);
		},
	};
	return platform;
}

function fakeCanvas(clientWidth: number, clientHeight: number): ViewportCanvas & { clientWidth: number; clientHeight: number } {
	return { width: 300, height: 150, clientWidth, clientHeight };
}

describe('CanvasViewport (R15.4, R7.3, R7.11)', () => {
	it('sizes the backing store at construction, before any frame', () => {
		const canvas = fakeCanvas(1440, 882);
		const viewport = new CanvasViewport({ canvas, platform: fakeWindow({ dpr: 2, deviceBox: true }) });
		expect([canvas.width, canvas.height]).toEqual([2880, 1764]);
		expect(viewport.frame).toEqual({ viewport: { width: 1440, height: 882 }, ratio: 2 });
	});

	it('takes the exact device pixels when the platform reports them', () => {
		const canvas = fakeCanvas(1440, 882);
		const platform = fakeWindow({ dpr: 1.25, deviceBox: true });
		const viewport = new CanvasViewport({ canvas, platform });
		expect(platform.observedBox).toBe('device-pixel-content-box');

		// 1153 CSS pixels that the browser rasterised at 1442 device pixels,
		// which rounding (1441) would not have guessed.
		platform.resize(1153, 800, { width: 1442, height: 1000 });
		expect(viewport.commit()).toBe(true);
		expect(canvas.width).toBe(1442);
		expect(viewport.state).toMatchObject({ framebufferWidth: 1442, width: 1442 / 1.25, ratio: 1.25 });
	});

	it('rounds from CSS pixels where the device-pixel box is not implemented', () => {
		const canvas = fakeCanvas(1440, 882);
		const platform = fakeWindow({ dpr: 1.25, deviceBox: false });
		const viewport = new CanvasViewport({ canvas, platform });
		expect(platform.observedBox).toBe('content-box');

		platform.resize(1155, 800);
		viewport.commit();
		// 1443.75 rounds to 1444; `canvas.width = 1155 * 1.25` would have truncated to 1443.
		expect(canvas.width).toBe(1444);
		expect(viewport.state.width).toBeCloseTo(1155.2, 10);
	});

	it('holds a measurement until commit, then tells every listener once', () => {
		const canvas = fakeCanvas(800, 600);
		const platform = fakeWindow({ dpr: 1, deviceBox: true });
		const viewport = new CanvasViewport({ canvas, platform });
		const heard: number[] = [];
		viewport.onChange((state) => heard.push(state.width));

		platform.resize(1024, 768, { width: 1024, height: 768 });
		platform.resize(1280, 720, { width: 1280, height: 720 });
		expect(canvas.width).toBe(800);
		expect(viewport.state.width).toBe(800);

		expect(viewport.commit()).toBe(true);
		expect(heard).toEqual([1280]);
		expect(viewport.commit()).toBe(false);
	});

	it('ignores a report of the size it already has', () => {
		const canvas = fakeCanvas(800, 600);
		const platform = fakeWindow({ dpr: 1, deviceBox: true });
		const viewport = new CanvasViewport({ canvas, platform });
		const listener = jest.fn();
		viewport.onChange(listener);

		// The observer's initial report, after the constructor already measured.
		platform.resize(800, 600, { width: 800, height: 600 });
		expect(viewport.commit()).toBe(false);
		expect(listener).not.toHaveBeenCalled();
	});

	it('re-divides the same device pixels when zoom changes only the ratio', () => {
		const canvas = fakeCanvas(1000, 500);
		const platform = fakeWindow({ dpr: 1, deviceBox: true });
		const viewport = new CanvasViewport({ canvas, platform });
		expect(platform.queries).toEqual(['(resolution: 1dppx)']);

		platform.changeResolution(2);
		viewport.commit();
		expect(canvas.width).toBe(1000);
		expect(viewport.state).toMatchObject({ width: 500, height: 250, ratio: 2 });
		// Re-registered for the new ratio, since the old query only matched 1dppx.
		expect(platform.queries).toEqual(['(resolution: 1dppx)', '(resolution: 2dppx)']);

		platform.changeResolution(1.5);
		expect(platform.queries.at(-1)).toBe('(resolution: 1.5dppx)');
	});

	it('rounds again from CSS pixels on a ratio change without the device-pixel box', () => {
		const canvas = fakeCanvas(1000, 500);
		const platform = fakeWindow({ dpr: 1, deviceBox: false });
		const viewport = new CanvasViewport({ canvas, platform });

		platform.changeResolution(1.5);
		viewport.commit();
		expect([canvas.width, canvas.height]).toEqual([1500, 750]);
		expect(viewport.state).toMatchObject({ width: 1000, height: 500, ratio: 1.5 });
	});

	it('works with no ResizeObserver at all, through the resolution query', () => {
		const canvas = fakeCanvas(640, 480);
		const platform = { ...fakeWindow({ dpr: 1, deviceBox: false }), ResizeObserver: undefined };
		const viewport = new CanvasViewport({ canvas, platform });
		expect(viewport.state.width).toBe(640);
	});

	it('scales the logical viewport by uiScale (R7.5)', () => {
		const canvas = fakeCanvas(1440, 882);
		const viewport = new CanvasViewport({ canvas, platform: fakeWindow({ dpr: 1, deviceBox: true }), uiScale: 1.25 });
		expect(canvas.width).toBe(1440);
		expect(viewport.state).toMatchObject({ width: 1152, ratio: 1.25 });
	});
});
