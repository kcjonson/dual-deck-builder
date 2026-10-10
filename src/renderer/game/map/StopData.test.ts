import routesFile from '../data/routes.json';
import stopTablesFile from '../data/stopTables.json';
import stopsFile from '../data/stops.json';
import { ReaderRangeError, ReaderTypeError } from '../core/JsonReader';
import { BIOMES } from './Biome';
import { ROAD_CLASSES } from './RoadNetwork';
import { NO_TERRITORY, STOP_TABLES, STOP_TYPES, StopType, isCalm, isFight, readRouteTuning, readStopTables, readStopTuning, stopTablesFor } from './StopData';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('stop tables', () => {
	it('read the shipped file, every class, biome, tier, and territory drawable', () => {
		for (const roadClass of ROAD_CLASSES) {
			for (const biome of BIOMES) {
				for (let tier = 1; tier <= 5; tier += 1) {
					const row = STOP_TABLES.rowOf(roadClass, biome, tier, NO_TERRITORY);
					expect(row).toBeGreaterThanOrEqual(0);
					expect(STOP_TYPES).toContain(STOP_TABLES.draw(row, 0.5, false));
					expect(isCalm(STOP_TABLES.draw(row, 0.5, true))).toBe(true);
				}
			}
		}
		expect(STOP_TABLES.rowOf('highway', 'scrub', 1, 'mireCrawlers')).toBe(-1);
	});

	it('draw each type in proportion to its weight: class times biome, tier, and territory', () => {
		const tables = readStopTables({
			classes: { highway: { ambush: 1, wreck: 3 }, backRoad: { wreck: 1 }, trail: { wreck: 1 } },
			biomes: { mire: { ambush: 3 } },
			tiers: { 1: { ambush: 0 } },
			territories: { none: {}, raiders: { ambush: 3 } },
		}, 'test');
		const row = tables.rowOf('highway', 'scrub', 2, 'none');
		// Cumulative: ambush [0, 1), then wreck [1, 4) of 4.
		expect(tables.draw(row, 0, false)).toBe('ambush');
		expect(tables.draw(row, 0.249, false)).toBe('ambush');
		expect(tables.draw(row, 0.25, false)).toBe('wreck');
		expect(tables.draw(row, 0.9999999, false)).toBe('wreck');
		// In mire, ambush is 3 of 6.
		expect(tables.draw(tables.rowOf('highway', 'mire', 2, 'none'), 0.49, false)).toBe('ambush');
		// At tier 1 there's no ambush to draw, and the calm draw never gives a fight.
		expect(tables.draw(tables.rowOf('highway', 'scrub', 1, 'none'), 0, false)).toBe('wreck');
		expect(tables.draw(row, 0, true)).toBe('wreck');
		// In a raiders' territory, ambush is 3 of 6.
		const raiders = tables.rowOf('highway', 'scrub', 2, 'raiders');
		expect(tables.draw(raiders, 0.49, false)).toBe('ambush');
		expect(tables.draw(raiders, 0.5, false)).toBe('wreck');
	});

	it('fail when read, not mid-map, on a row with nothing to draw or no non-fight to fall back on', () => {
		const noWeight = copy(stopTablesFile);
		noWeight.classes.trail = Object.fromEntries(STOP_TYPES.map((type) => [type, 0])) as typeof noWeight.classes.trail;
		expect(() => readStopTables(noWeight, 'stopTables')).toThrow(/stopTables: trail in scrub at tier 1 in territory none weighs nothing/);
		const fightsOnly = copy(stopTablesFile);
		fightsOnly.classes.highway = Object.fromEntries(STOP_TYPES.map((type) => [type, isFight(type) ? 1 : 0])) as typeof fightsOnly.classes.highway;
		expect(() => readStopTables(fightsOnly, 'stopTables')).toThrow(/weighs no non-fight/);
		// A biome that zeroes every calm type, only where it applies.
		const mire = copy(stopTablesFile) as unknown as { biomes: Record<string, Record<string, number>> };
		mire.biomes.mire = Object.fromEntries(STOP_TYPES.filter(isCalm).map((type) => [type, 0]));
		expect(() => readStopTables(mire, 'stopTables')).toThrow(/highway in mire at tier 1 in territory none weighs no non-fight/);
	});

	it('refuse an unknown type, class, biome, or tier, a negative weight, and tables with no unclaimed ground', () => {
		const at = (edit: (tables: Record<string, Record<string, unknown>>) => void) => {
			const tables = copy(stopTablesFile) as unknown as Record<string, Record<string, unknown>>;
			edit(tables);
			return () => readStopTables(tables, 'stopTables');
		};
		expect(at((tables) => { (tables.classes.highway as Record<string, number>).ambsuh = 1; })).toThrow(ReaderRangeError);
		expect(at((tables) => { tables.classes.dirtRoad = {}; })).toThrow(ReaderTypeError);
		expect(at((tables) => { tables.biomes.jungle = {}; })).toThrow(/stopTables.biomes.jungle must be one of/);
		expect(at((tables) => { tables.tiers['6'] = {}; })).toThrow(/stopTables.tiers.6 must be one of/);
		expect(at((tables) => { (tables.classes.highway as Record<string, number>).ambush = -1; })).toThrow(/at least 0/);
		expect(at((tables) => { tables.territories = { raiders: {} }; })).toThrow(/must have "none"/);
	});

	it('compile a map\'s own tables once, and stand in the shipped ones when it has none', () => {
		const own = copy(stopTablesFile);
		expect(stopTablesFor(undefined)).toBe(STOP_TABLES);
		const first = stopTablesFor(own);
		expect(stopTablesFor(own)).toBe(first);
		expect(first).not.toBe(STOP_TABLES);
	});
});

describe('stop types', () => {
	it('are fights, checkpoints, or calm', () => {
		const fights: StopType[] = STOP_TYPES.filter(isFight);
		expect(fights).toEqual(['ambush', 'warband']);
		expect(STOP_TYPES.filter((type) => !isCalm(type))).toEqual(['ambush', 'warband', 'checkpoint']);
	});
});

describe('the stops and routes tuning', () => {
	it('reads the shipped files', () => {
		expect(readStopTuning(stopsFile, 'StopTuning').types.ambush).toEqual({ label: 'Raider ambush', hours: 1 });
		expect(readRouteTuning(routesFile, 'RouteTuning').names.classes.highway).toBe('Route {road} highway');
	});

	it('refuses a missing type, a rate for each tier but one, and an unknown biome name', () => {
		const stops = copy(stopsFile) as unknown as { types: Record<string, unknown>; driverFinds: { rates: number[] }; jitter: number };
		delete stops.types.hazard;
		expect(() => readStopTuning(stops, 'StopTuning')).toThrow(/StopTuning.types.hazard is missing/);
		const rates = copy(stopsFile);
		rates.driverFinds.rates = [0, 0, 0];
		expect(() => readStopTuning(rates, 'StopTuning')).toThrow(/each of the 5 tiers/);
		const jitter = copy(stopsFile);
		jitter.jitter = 1.5;
		expect(() => readStopTuning(jitter, 'StopTuning')).toThrow(/share from 0 to 1/);
		const routes = copy(routesFile) as unknown as { names: { biomes: Record<string, string> } };
		routes.names.biomes.jungle = 'Through the jungle';
		expect(() => readRouteTuning(routes, 'RouteTuning')).toThrow(/must be one of/);
	});
});
