import { formatBuildLabel } from './buildLabel';

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
