import { TRACK_GROUP, TRACK_NAME, chromiumMajor, createDevToolsTracks, selectTrackMode } from './devtoolsTracks';

const CHROME_136 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const ELECTRON_25 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) dual-deck-builder/0.1.0 Chrome/114.0.5735.289 Electron/25.9.8 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('chromiumMajor', () => {
	it('prefers the Chromium client hint brand', () => {
		expect(chromiumMajor({
			userAgent: CHROME_136,
			userAgentData: { brands: [{ brand: 'Not.A/Brand', version: '99' }, { brand: 'Chromium', version: '137' }] },
		})).toBe(137);
	});

	it('falls back to the Chrome token, which Electron carries', () => {
		expect(chromiumMajor({ userAgent: CHROME_136 })).toBe(136);
		expect(chromiumMajor({ userAgent: ELECTRON_25 })).toBe(114);
	});

	it('answers null for a browser that is not Chromium', () => {
		expect(chromiumMajor({ userAgent: FIREFOX })).toBeNull();
		expect(chromiumMajor({ userAgent: SAFARI })).toBeNull();
		expect(chromiumMajor(undefined)).toBeNull();
	});
});

describe('selectTrackMode (R15.42)', () => {
	it('uses the six-argument timeStamp from Chromium 134', () => {
		expect(selectTrackMode(134)).toBe('console.timeStamp');
	});

	it('uses performance.measure with detail.devtools from 128 to 133', () => {
		expect(selectTrackMode(128)).toBe('performance.measure');
		expect(selectTrackMode(133)).toBe('performance.measure');
	});

	it('has nothing for Electron 25 or a non-Chromium browser', () => {
		expect(selectTrackMode(114)).toBeNull();
		expect(selectTrackMode(null)).toBeNull();
	});
});

describe('createDevToolsTracks', () => {
	it('emits a six-argument timeStamp on the engine track', () => {
		const timeStamp = jest.fn();
		const tracks = createDevToolsTracks({ navigator: { userAgent: CHROME_136 }, console: { timeStamp } });
		expect(tracks?.mode).toBe('console.timeStamp');
		tracks?.emit('render', 10, 12.5, 'secondary');
		expect(timeStamp).toHaveBeenCalledWith('render', 10, 12.5, TRACK_NAME, TRACK_GROUP, 'secondary');
	});

	it('clears each measure straight after making it, so the buffer does not grow', () => {
		const measure = jest.fn();
		const clearMeasures = jest.fn();
		const tracks = createDevToolsTracks({
			navigator: { userAgent: CHROME_136.replace('136', '130') },
			performance: { measure, clearMeasures },
		});
		expect(tracks?.mode).toBe('performance.measure');
		tracks?.emit('flush', 1, 2, 'tertiary');
		expect(measure).toHaveBeenCalledWith('flush', {
			start: 1,
			end: 2,
			detail: { devtools: { dataType: 'track-entry', track: TRACK_NAME, trackGroup: TRACK_GROUP, color: 'tertiary' } },
		});
		expect(clearMeasures).toHaveBeenCalledWith('flush');
	});

	it('returns null on Electron 25, Firefox, and a runtime missing the call', () => {
		expect(createDevToolsTracks({ navigator: { userAgent: ELECTRON_25 }, console: { timeStamp: jest.fn() } })).toBeNull();
		expect(createDevToolsTracks({ navigator: { userAgent: FIREFOX }, console: { timeStamp: jest.fn() } })).toBeNull();
		expect(createDevToolsTracks({ navigator: { userAgent: CHROME_136 }, console: {} })).toBeNull();
	});
});
