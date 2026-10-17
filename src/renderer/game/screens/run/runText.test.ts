import { debriefMark } from './runText';

describe('debriefMark', () => {
	it('spends the one hero mark on a depleted destination first, then an injured driver\'s tear, then a looted destination', () => {
		expect(debriefMark({ destination: 'depleted', injured: true })).toBe('depleted');
		expect(debriefMark({ destination: 'looted', injured: true })).toBe('tear');
		expect(debriefMark({ destination: null, injured: true })).toBe('tear');
		expect(debriefMark({ destination: 'looted', injured: false })).toBe('looted');
		expect(debriefMark({ destination: 'unvisited', injured: false })).toBeNull();
		expect(debriefMark({ destination: null, injured: false })).toBeNull();
	});
});
