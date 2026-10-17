import { buildLine, formatBuildLabel } from './buildLabel';

describe('formatBuildLabel', () => {
	it('shows the build number and SHA', () => {
		expect(formatBuildLabel({ sha: '2f8d7a7', number: '142' })).toBe('build 142 - 2f8d7a7');
	});

	it('shows the SHA alone without a build number', () => {
		expect(formatBuildLabel({ sha: '2f8d7a7', number: null })).toBe('2f8d7a7');
	});

	it('shows nothing without a SHA', () => {
		expect(formatBuildLabel({ sha: null, number: null })).toBeNull();
		expect(formatBuildLabel({ sha: null, number: '142' })).toBeNull();
	});
});

describe('buildLine', () => {
	it('names the build number and commit a deploy defines', () => {
		expect(buildLine({ sha: '2f8d7a7', number: '142' })).toBe('BUILD 142 - 2f8d7a7');
		expect(buildLine({ sha: '2f8d7a7', number: null })).toBe('BUILD 2f8d7a7');
	});

	it('says development build where none is defined, so baselines hold across commits', () => {
		expect(buildLine({ sha: null, number: null })).toBe('DEVELOPMENT BUILD');
	});
});
