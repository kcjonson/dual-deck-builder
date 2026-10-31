import {
	STOP_COOLDOWN_DAYS, clearPoi, clearStop, clearedAfter, clearedPois, daysUntilBack, isPoiCleared, readClearedPois, readStopStates, stopCooldowns, stopState,
} from './MapClearing';
import { readMapState } from './MapState';

/** DDB-336: what runs have cleared on the area map, and how stops come back. */

describe('clearing stops', () => {
	it('clears a stop on the day a run resolves it, keeping its roll, and keeps the entries in stop order', () => {
		let map = clearStop({ map: {}, stop: 9, day: 3 });
		map = clearStop({ map, stop: 2, day: 4 });
		expect(map).toEqual({ stops: [{ stop: 2, roll: 0, cleared: 4 }, { stop: 9, roll: 0, cleared: 3 }] });
		expect(stopState({ map, stop: 9 })).toEqual({ stop: 9, roll: 0, cleared: 3 });
		expect(stopState({ map, stop: 5 })).toEqual({ stop: 5, roll: 0, cleared: null });
	});

	it('brings a stop back the night its cooldown is up, a roll higher, and leaves the rest', () => {
		const map = { fog: [1], stops: [{ stop: 1, roll: 0, cleared: 3 }, { stop: 4, roll: 2, cleared: 5 }, { stop: 6, roll: 1, cleared: null }] };
		// Cleared on day 3, so back at the dawn of day 8: the night after day 7
		expect(stopCooldowns({ map, day: 3 + STOP_COOLDOWN_DAYS - 2 })).toBe(map);
		expect(stopCooldowns({ map, day: 3 + STOP_COOLDOWN_DAYS - 1 })).toEqual({
			fog: [1],
			stops: [{ stop: 1, roll: 1, cleared: null }, { stop: 4, roll: 2, cleared: 5 }, { stop: 6, roll: 1, cleared: null }],
		});
	});

	it('clears a stop that came back at its new roll', () => {
		const back = stopCooldowns({ map: clearStop({ map: {}, stop: 3, day: 1 }), day: 1 + STOP_COOLDOWN_DAYS });
		expect(clearStop({ map: back, stop: 3, day: 9 })).toEqual({ stops: [{ stop: 3, roll: 1, cleared: 9 }] });
	});

	it('counts the days until a stop is back', () => {
		const map = clearStop({ map: {}, stop: 3, day: 2 });
		expect(daysUntilBack({ map, stop: 3, day: 2 })).toBe(STOP_COOLDOWN_DAYS);
		expect(daysUntilBack({ map, stop: 3, day: 2 + STOP_COOLDOWN_DAYS - 1 })).toBe(1);
		expect(daysUntilBack({ map, stop: 4, day: 2 })).toBeNull();
	});
});

describe('clearing POIs', () => {
	it('clears a POI for good, once, in order, and never brings it back overnight', () => {
		let map = clearPoi({ map: {}, poi: 7 });
		map = clearPoi({ map, poi: 2 });
		expect(clearPoi({ map, poi: 7 })).toBe(map);
		expect(clearedPois(map)).toEqual([2, 7]);
		expect([isPoiCleared({ map, poi: 2 }), isPoiCleared({ map, poi: 3 })]).toEqual([true, false]);
		expect(stopCooldowns({ map, day: 400 })).toBe(map);
	});
});

describe('reading what runs cleared', () => {
	it.each([
		['a stop out of order', [{ stop: 4, roll: 1, cleared: null }, { stop: 2, roll: 1, cleared: null }], 'map.stops[1].stop must come after the entry above it (4), got 2'],
		['a stop twice', [{ stop: 4, roll: 1, cleared: null }, { stop: 4, roll: 0, cleared: 2 }], 'map.stops[1].stop must come after the entry above it (4), got 4'],
		['an entry that says nothing', [{ stop: 4, roll: 0, cleared: null }], 'map.stops[0] is neither cleared nor rolled again, which is no entry at all'],
		['a cleared day before the first', [{ stop: 4, roll: 0, cleared: 0 }], 'map.stops[0].cleared must be an integer >= 1, got 0'],
		['a field it doesn\'t know', [{ stop: 4, roll: 1, cleared: null, rolls: 2 }], 'map.stops[0] has an unknown field "rolls"'],
	])('refuses %s', (_label, stops, message) => {
		expect(() => readStopStates(stops, 'map.stops')).toThrow(message);
		expect(() => readMapState({ stops }, 'map')).toThrow(message);
	});

	it('refuses an empty list, which is the field left out, and the POI stock clearing replaced', () => {
		expect(() => readMapState({ stops: [] }, 'map')).toThrow("map.stops is empty; with nothing in it, it's left out");
		expect(() => readMapState({ clearedPois: [] }, 'map')).toThrow("map.clearedPois is empty; with nothing in it, it's left out");
		expect(() => readMapState({ pois: [{ poi: 1, left: 0, nights: 0 }] }, 'map')).toThrow('map.pois is the POI stock version 12 replaced with clearedPois');
	});

	it('finds a stop cleared after a day, which no run could have done by then', () => {
		const map = { stops: [{ stop: 1, roll: 0, cleared: 3 }, { stop: 2, roll: 0, cleared: 6 }] };
		expect(clearedAfter({ map, day: 6 })).toBeNull();
		expect(clearedAfter({ map, day: 5 })).toEqual({ stop: 2, roll: 0, cleared: 6 });
	});

	it('refuses cleared POIs out of order or twice', () => {
		expect(() => readClearedPois([3, 1], 'map.clearedPois')).toThrow('map.clearedPois[1] must come after the POI above it (3), got 1');
		expect(() => readMapState({ clearedPois: [3, 3] }, 'map')).toThrow('map.clearedPois[1] must come after the POI above it (3), got 3');
	});
});
