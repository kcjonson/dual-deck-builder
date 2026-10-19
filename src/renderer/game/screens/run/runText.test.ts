import { debriefMark } from './runText';

describe('debriefMark', () => {
	it('spends the one hero mark on an injured driver\'s tear first, then the destination the run cleared', () => {
		expect(debriefMark({ cleared: true, injured: true })).toBe('tear');
		expect(debriefMark({ cleared: false, injured: true })).toBe('tear');
		expect(debriefMark({ cleared: true, injured: false })).toBe('looted');
		expect(debriefMark({ cleared: false, injured: false })).toBeNull();
	});
});
