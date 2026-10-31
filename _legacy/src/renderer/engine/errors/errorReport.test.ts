import { describeError, describeErrorEvent, formatDetails, sameFailure, shortenFrame } from './errorReport';

const BASE = 'https://example.test/playtest/';

function withStack(error: Error, stack: string): Error {
	error.stack = stack;
	return error;
}

describe('describeError', () => {
	it('takes the name and message, and drops the V8 header from the stack', () => {
		const error = withStack(new TypeError('x is undefined'), [
			'TypeError: x is undefined',
			`    at Screen.onMount (${BASE}main.3f2a.js:2:1234)`,
			`    at ScreenManager.swap (${BASE}main.3f2a.js:2:5678)`,
		].join('\n'));
		expect(describeError({ error, source: 'error', base: BASE })).toEqual({
			source: 'error',
			message: 'TypeError: x is undefined',
			stack: ['at Screen.onMount (main.3f2a.js:2:1234)', 'at ScreenManager.swap (main.3f2a.js:2:5678)'],
			count: 1,
		});
	});

	it('drops a header that names the class the error was built as, not its name', () => {
		const error = withStack(new Error('atlas missing'), 'Error: atlas missing\n    at load (main.js:1:1)');
		error.name = 'FontAtlasError';
		const report = describeError({ error, source: 'startup', base: BASE });
		expect(report.message).toBe('FontAtlasError: atlas missing');
		expect(report.stack).toEqual(['at load (main.js:1:1)']);
	});

	it('drops every line of a header whose message spans lines', () => {
		const error = withStack(new Error('first\nsecond'), 'Error: first\nsecond\n    at f (main.js:1:1)');
		const report = describeError({ error, source: 'error', base: BASE });
		expect(report.message).toBe('Error: first\nsecond');
		expect(report.stack).toEqual(['at f (main.js:1:1)']);
	});

	it('keeps the first frame of a stack with no header (Firefox, Safari)', () => {
		const error = withStack(new Error('boom'), `onUpdate@${BASE}main.js:2:10\nframe@${BASE}main.js:2:20\n`);
		expect(describeError({ error, source: 'error', base: BASE }).stack).toEqual(['onUpdate@main.js:2:10', 'frame@main.js:2:20']);
	});

	it('names an error with no message by its name alone', () => {
		const error = withStack(new RangeError(), 'RangeError\n    at f (main.js:1:1)');
		const report = describeError({ error, source: 'error', base: BASE });
		expect(report.message).toBe('RangeError');
		expect(report.stack).toEqual(['at f (main.js:1:1)']);
	});

	it('prints a rejection that is not an Error', () => {
		expect(describeError({ error: 'no save slot', source: 'rejection', base: BASE }).message).toBe('no save slot');
		expect(describeError({ error: { code: 7 }, source: 'rejection', base: BASE }).message).toBe('{"code":7}');
		expect(describeError({ error: undefined, source: 'rejection', base: BASE }).message).toBe('undefined');
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(describeError({ error: cyclic, source: 'rejection', base: BASE }).message).toBe('[object Object]');
		expect(describeError({ error: 'x', source: 'rejection', base: BASE }).stack).toEqual([]);
	});
});

describe('describeErrorEvent', () => {
	it('describes the thrown value when the event carries it', () => {
		const error = withStack(new Error('boom'), 'Error: boom\n    at f (main.js:1:1)');
		const event = { error, message: 'Uncaught Error: boom', filename: `${BASE}main.js`, lineno: 1, colno: 1 } as ErrorEvent;
		expect(describeErrorEvent({ event, base: BASE }).message).toBe('Error: boom');
	});

	it('falls back to the message and location when the browser withholds the error', () => {
		const event = { error: null, message: 'Script error.', filename: `${BASE}main.js`, lineno: 3, colno: 9 } as ErrorEvent;
		expect(describeErrorEvent({ event, base: BASE })).toEqual({ source: 'error', message: 'Script error.', stack: ['at main.js:3:9'], count: 1 });
	});
});

describe('shortenFrame', () => {
	it('cuts the page base and the dev build prefix', () => {
		expect(shortenFrame({ frame: `    at f (${BASE}main.js:1:2)`, base: BASE })).toBe('at f (main.js:1:2)');
		expect(shortenFrame({ frame: 'at f (webpack-internal:///./src/index.ts:3:4)', base: 'http://localhost:9000/' })).toBe('at f (./src/index.ts:3:4)');
	});

	it('leaves the frame alone with no base', () => {
		expect(shortenFrame({ frame: 'at f (file:///app/main.js:1:2)', base: '' })).toBe('at f (file:///app/main.js:1:2)');
	});
});

describe('sameFailure', () => {
	it('matches the same source, message and top frame', () => {
		const a = { source: 'error' as const, message: 'Error: x', stack: ['at f (a.js:1:1)', 'at g'], count: 1 };
		expect(sameFailure(a, { ...a, stack: ['at f (a.js:1:1)', 'at h'] })).toBe(true);
		expect(sameFailure(a, { ...a, stack: ['at k (a.js:9:9)'] })).toBe(false);
		expect(sameFailure(a, { ...a, source: 'rejection' })).toBe(false);
	});
});

describe('formatDetails', () => {
	it('lists every report in full, then the build, page, browser and time', () => {
		const text = formatDetails({
			reports: [
				{ source: 'error', message: 'Error: boom', stack: ['at f (main.js:1:1)'], count: 3 },
				{ source: 'rejection', message: 'no save', stack: [], count: 1 },
			],
			build: 'build 142 - 2f8d7a7',
			page: 'https://example.test/playtest/',
			userAgent: 'TestBrowser/1',
			time: '2026-10-19T00:00:00.000Z',
		});
		expect(text).toBe([
			'Uncaught error (x3)',
			'Error: boom',
			'    at f (main.js:1:1)',
			'Unhandled promise rejection',
			'no save',
			'',
			'Build: build 142 - 2f8d7a7',
			'Page: https://example.test/playtest/',
			'Browser: TestBrowser/1',
			'Time: 2026-10-19T00:00:00.000Z',
		].join('\n'));
	});
});
