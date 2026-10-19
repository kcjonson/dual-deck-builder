import { RAIDER_PROFILES } from '../mechanics/Raiders';
import { fightCells, playFightCell, playRun } from './Fights';
import { rate } from './Measures';
import { simConfig } from './SimConfig';

describe('balance sim fights', () => {
	beforeAll(() => {
		// Drivers log every draw, and the AIs think aloud
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
		jest.spyOn(console, 'info').mockImplementation(() => undefined);
		jest.spyOn(console, 'debug').mockImplementation(() => undefined);
	});

	afterAll(() => jest.restoreAllMocks());

	const config = simConfig({ seed: 7, runs: 2, crews: [['road_warrior', 'interceptor']], routes: [[2]] });

	test('one crew against one encounter on a fixed seed comes out the same every time', async () => {
		const [cell] = fightCells(config);
		const { battle, ...run } = await playRun({ config, cell, index: 0 });
		expect(battle.isBattleWon()).toBe(true);
		expect(run).toEqual({
			outcome: 'home',
			firstSeat: 'road_warrior',
			swapped: false,
			turns: 2,
			down: false,
			hpLost: 9 / 65,
			structureLost: 9 / 130,
			injuryDays: 1,
			raidersKilled: 1,
		});
	});

	test('a pair swaps seats on the odd run, and the cell measures both', async () => {
		const row = await playFightCell({ config, cell: fightCells(config)[0] });
		expect(row).toMatchObject({ cell: 'road_warrior+interceptor:2', runs: 2, turns: 2.5, injuryDays: 2, raidersKilled: 1 });
		expect(row.won).toMatchObject({ count: 2, of: 2, rate: 1, high: 1 });
		expect(row.bySeat?.map(seat => seat.of)).toEqual([1, 1]);
		expect(row.down).toMatchObject({ count: 0, of: 2 });
	});

	test('tuning comes in through the config and leaves the shipped profiles alone', () => {
		const tuned = simConfig({ raiders: { rust_buggy: { hitpoints: 10, vehicleStats: { armor: 0 } } }, encounters: { road_gang: { raiders: ['rust_buggy', 'rust_buggy', 'rust_buggy'] } } });
		expect(tuned.raiders.rust_buggy.hitpoints).toBe(10);
		expect(tuned.raiders.rust_buggy.vehicleStats).toEqual({ ...RAIDER_PROFILES.rust_buggy.vehicleStats, armor: 0 });
		expect(RAIDER_PROFILES.rust_buggy.hitpoints).not.toBe(10);
		expect(tuned.encounters.road_gang).toHaveLength(3);
		expect(() => simConfig({ encounters: { road_gang: { raiders: ['tank' as never] } } })).toThrow(RangeError);
	});

	test('a crew is one driver or two of different archetypes, as load out seats them', () => {
		expect(() => simConfig({ crews: [['road_warrior', 'road_warrior']] })).toThrow(RangeError);
		expect(() => simConfig({ crews: [[]] })).toThrow(RangeError);
		expect(() => simConfig({ routes: [[]] })).toThrow(RangeError);
		expect(() => simConfig({ encounters: { road_gang: { raiders: [] } } })).toThrow(RangeError);
	});

	test('the same pair on two decks gets a cell name apiece', () => {
		const twoDecks = simConfig({ crews: [['road_warrior', 'interceptor'], [{ archetype: 'road_warrior', deck: { ramming_speed: 8 } }, 'interceptor']], routes: [[1]] });
		expect(fightCells(twoDecks).map(cell => cell.name)).toEqual(['road_warrior+interceptor#0:1', 'road_warrior+interceptor#1:1']);
	});

	test('a rate carries its count and a 90% interval', () => {
		const { low, high } = rate(50, 100);
		expect(low).toBeCloseTo(0.419, 3);
		expect(high).toBeCloseTo(0.581, 3);
		expect(rate(0, 0).rate).toBeNull();
	});
});
