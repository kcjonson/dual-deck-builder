import { wrappedLineCount } from './DeveloperSectionPanel';

describe('wrappedLineCount', () => {
	it('breaks where the next item would pass the width, as FlowWrap does', () => {
		expect(wrappedLineCount([200, 200, 200], 640, 20)).toBe(1);
		expect(wrappedLineCount([200, 200, 200], 639, 20)).toBe(2);
		expect(wrappedLineCount([424, 200, 200], 640, 24)).toBe(2);
	});

	it('gives an item wider than the width a line of its own', () => {
		expect(wrappedLineCount([500, 100], 300, 10)).toBe(2);
	});

	it('counts no lines for no items', () => {
		expect(wrappedLineCount([], 300, 10)).toBe(0);
	});
});
