import type { MapState } from './MapState';
import { readMapState } from './MapState';
import { POI_REFILL_DAYS, POI_SHARES, nightsToNextShare, poiState, poiStocks, readPoiStocks, refillPois, scaledYield, sharesLeft, takeShare } from './PoiStock';

const YIELDS = Object.freeze({ food: 6, water: 4, fuel: 1, scrap: 0 });

/** The map state after `nights` day ends. */
function nightsLater(map: MapState, nights: number): MapState {
	let next = map;
	for (let night = 0; night < nights; night += 1) next = readMapState(refillPois(next), 'map');
	return next;
}

/** The map state after `runs` runs reach the POI on one day. */
function runsTo(map: MapState, poi: number, runs: number): MapState {
	let next = map;
	for (let run = 0; run < runs; run += 1) next = readMapState(takeShare({ map: next, poi }), 'map');
	return next;
}

describe('POI stock', () => {
	it('holds three runs\' worth at every POI until one is taken from', () => {
		expect(POI_SHARES).toBe(3);
		expect(sharesLeft({ map: {}, poi: 4 })).toBe(3);
		expect(poiState(3)).toBe('unvisited');
		expect(nightsToNextShare({ map: {}, poi: 4 })).toBeNull();
	});

	it('takes a share a run, looted after one and two, depleted after three, and nothing from a depleted POI', () => {
		const once = runsTo({}, 4, 1);
		expect([sharesLeft({ map: once, poi: 4 }), poiState(sharesLeft({ map: once, poi: 4 }))]).toEqual([2, 'looted']);
		const twice = runsTo(once, 4, 1);
		expect([sharesLeft({ map: twice, poi: 4 }), poiState(sharesLeft({ map: twice, poi: 4 }))]).toEqual([1, 'looted']);
		const depleted = runsTo(twice, 4, 1);
		expect([sharesLeft({ map: depleted, poi: 4 }), poiState(sharesLeft({ map: depleted, poi: 4 }))]).toEqual([0, 'depleted']);
		expect(takeShare({ map: depleted, poi: 4 })).toBe(depleted);
		// Every other POI is untouched
		expect(sharesLeft({ map: depleted, poi: 3 })).toBe(3);
	});

	it('keeps each POI once, in POI order, and the rest of the map state as it was', () => {
		const map = runsTo(runsTo(runsTo({ fog: [1, 2] }, 9, 1), 2, 2), 9, 1);
		expect(poiStocks(map)).toEqual([{ poi: 2, left: 1, nights: 0 }, { poi: 9, left: 1, nights: 0 }]);
		expect(map.fog).toEqual([1, 2]);
	});

	it('scales a yield by the shares left, rounding up, to nothing when depleted', () => {
		expect(scaledYield({ yields: YIELDS, shares: 3 })).toBe(YIELDS);
		expect(scaledYield({ yields: YIELDS, shares: 2 })).toEqual({ food: 4, water: 3, fuel: 1, scrap: 0 });
		expect(scaledYield({ yields: YIELDS, shares: 1 })).toEqual({ food: 2, water: 2, fuel: 1, scrap: 0 });
		expect(scaledYield({ yields: YIELDS, shares: 0 })).toEqual({ food: 0, water: 0, fuel: 0, scrap: 0 });
	});

	it('refills a depleted POI a share at a time, full again 20 nights on, and drops it from the map state then', () => {
		expect(POI_REFILL_DAYS).toBe(20);
		const depleted = runsTo({}, 4, 3);
		const shares = Array.from({ length: 21 }, (_, nights) => sharesLeft({ map: nightsLater(depleted, nights), poi: 4 }));
		expect(shares.indexOf(1)).toBe(7);
		expect(shares.indexOf(2)).toBe(14);
		expect(shares.indexOf(3)).toBe(20);
		expect(nightsLater(depleted, 20)).toEqual({});
		expect(nightsLater(depleted, 19)).toEqual({ pois: [{ poi: 4, left: 0, nights: 19 }] });
	});

	it('says how many nights until the next share comes back', () => {
		const depleted = runsTo({}, 4, 3);
		expect([0, 6, 7, 13, 14, 19].map(nights => nightsToNextShare({ map: nightsLater(depleted, nights), poi: 4 }))).toEqual([7, 1, 7, 1, 6, 1]);
		expect(nightsToNextShare({ map: runsTo({}, 4, 1), poi: 4 })).toBe(7);
	});

	it('starts the refill over from the run that takes the next share', () => {
		const looted = nightsLater(runsTo({}, 4, 1), 5);
		expect(sharesLeft({ map: looted, poi: 4 })).toBe(2);
		const again = runsTo(looted, 4, 1);
		expect(poiStocks(again)).toEqual([{ poi: 4, left: 1, nights: 0 }]);
		// A share back since the last run counts toward what the next one takes
		const refilled = runsTo(nightsLater(runsTo({}, 4, 2), 7), 4, 1);
		expect(poiStocks(refilled)).toEqual([{ poi: 4, left: 1, nights: 0 }]);
	});

	it('leaves a map state with nothing taken alone overnight', () => {
		const map = readMapState({ fog: [1] }, 'map');
		expect(refillPois(map)).toBe(map);
	});

	it.each([
		['not a list', {}, 'map.pois must be an array, got {}'],
		['an unknown field', [{ poi: 1, left: 1, nights: 0, stock: 3 }], 'map.pois[0] has an unknown field "stock"'],
		['a POI twice', [{ poi: 1, left: 1, nights: 0 }, { poi: 1, left: 2, nights: 0 }], 'map.pois[1].poi must come after the entry above it (1), got 1'],
		['POIs out of order', [{ poi: 3, left: 1, nights: 0 }, { poi: 1, left: 2, nights: 0 }], 'map.pois[1].poi must come after the entry above it (3), got 1'],
		['a full POI', [{ poi: 1, left: 3, nights: 0 }], 'map.pois[0].left must be an integer from 0 to 2, got 3'],
		['a POI past the night it fills up', [{ poi: 1, left: 2, nights: 7 }], 'map.pois[0].nights must be an integer from 0 to 6, got 7'],
		['a depleted POI past the night it fills up', [{ poi: 1, left: 0, nights: 20 }], 'map.pois[0].nights must be an integer from 0 to 19, got 20'],
	])('refuses saved stock with %s', (_label, pois, message) => {
		expect(() => readMapState({ pois }, 'map')).toThrow(message);
	});

	it('reads saved stock back as written', () => {
		const pois = [{ poi: 0, left: 0, nights: 19 }, { poi: 7, left: 2, nights: 6 }];
		expect(readPoiStocks(pois, 'pois')).toEqual(pois);
		expect(poiStocks(readMapState(JSON.parse(JSON.stringify({ pois })), 'map'))).toEqual(pois);
	});
});
