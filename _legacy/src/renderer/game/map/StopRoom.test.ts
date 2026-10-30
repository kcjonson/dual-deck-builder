import type { Route } from './RouteTree';
import { STOP_TUNING } from './StopData';
import { SHARED, NO_OWNER, bandFor, legOwners, legRoom, ownRoadNeed, packAlong } from './StopRoom';

const route = (legs: number[]): Route => ({ legs, length: 0, hours: 0 });

describe('stop room', () => {
	it('needs the fight floor or half the band, whichever is more, by tier', () => {
		expect([1, 2, 3, 4, 5].map((tier) => ownRoadNeed(tier, STOP_TUNING))).toEqual([2, 2, 2, 3, 3]);
		const fightHeavy = { bands: STOP_TUNING.bands.map((band) => ({ ...band, fights: { min: 3, max: 3 } })) };
		expect(ownRoadNeed(1, fightHeavy)).toBe(3);
		expect(bandFor(9, STOP_TUNING)).toBe(STOP_TUNING.bands[4]);
	});

	it('packs as many points as fit, gap apart, stepping past junctions', () => {
		expect(packAlong({ from: 0, to: 30, gap: 10, joins: [], clear: 8 })).toEqual([0, 10, 20, 30]);
		expect(packAlong({ from: 0, to: 30, gap: 10, joins: [12], clear: 8 })).toEqual([0, 20, 30]);
		expect(packAlong({ from: 0, to: 30, gap: 10, joins: [3, 12], clear: 8 })).toEqual([20, 30]);
		expect(packAlong({ from: 0, to: 30, gap: 10, joins: [], clear: 8, limit: 2 })).toEqual([0, 10]);
		expect(packAlong({ from: 5, to: 4, gap: 10, joins: [], clear: 8 })).toEqual([]);
	});

	it('gives a leg its usable road over the gap, rounded down, where no junction is in the way', () => {
		const tuning = STOP_TUNING;
		// 15 clear at each end: 70 leaves 40, one stop at 40 apart, three at 12.
		expect(legRoom({ length: 70, joins: [], gap: 40, tuning })).toBe(1);
		expect(legRoom({ length: 70, joins: [], gap: 12, tuning })).toBe(3);
		expect(legRoom({ length: 110, joins: [], gap: 40, tuning })).toBe(2);
		expect(legRoom({ length: 0, joins: [], gap: 12, tuning })).toBe(0);
		// A junction in the middle of a short leg takes its room.
		expect(legRoom({ length: 42, joins: [21], gap: 12, tuning })).toBe(0);
		for (let length = 1; length < 400; length += 7) {
			const ends = Math.min(15, length / 4);
			expect(legRoom({ length, joins: [], gap: 12, tuning })).toBe(Math.max(0, Math.floor((length - 2 * ends) / 12)));
		}
	});

	it('gives a leg to the one POI whose routes use it, and marks the rest', () => {
		const owners = legOwners(5, [[route([0, 1]), route([0, 2])], [route([0, 3])]]);
		expect([...owners]).toEqual([SHARED, 0, 0, 1, NO_OWNER]);
	});
});
