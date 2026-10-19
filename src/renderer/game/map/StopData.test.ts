import routesFile from '../data/routes.json';
import stopTablesFile from '../data/stopTables.json';
import stopsFile from '../data/stops.json';
import { ReaderRangeError, ReaderTypeError } from '../core/JsonReader';
import { BIOMES } from './Biome';
import { ROAD_CLASSES } from './RoadNetwork';
import { CompiledStopTables, NO_TERRITORY, RESOLVABLE_STOP_TYPES, STOP_TABLES, STOP_TYPES, StopType, isCalm, isFight, isResolvable, compileStopTables, readRouteTuning, readStopTuning, stopTablesFor } from './StopData';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('stop tables', () => {
	it('read the shipped file, every class, biome, tier, and territory drawable as a fight and as a calm stop the run resolves', () => {
		for (const roadClass of ROAD_CLASSES) {
			for (const biome of BIOMES) {
				for (let tier = 1; tier <= 5; tier += 1) {
					const row = STOP_TABLES.rowOf({ roadClass, biome, tier, territory: NO_TERRITORY });
					expect(row).toBeGreaterThanOrEqual(0);
					for (const draw of [0, 0.25, 0.5, 0.75, 0.999]) {
						const fight = STOP_TABLES.draw({ row, draw, fight: true });
						const calm = STOP_TABLES.draw({ row, draw, fight: false });
						expect([isFight(fight), isResolvable(fight)]).toEqual([true, true]);
						expect([isCalm(calm), isResolvable(calm)]).toEqual([true, true]);
					}
				}
			}
		}
		// A territory the tables don't have, or a tier past 5, is a bug, not a row.
		expect(() => STOP_TABLES.rowOf({ roadClass: 'highway', biome: 'scrub', tier: 1, territory: 'mireCrawlers' })).toThrow(/no territory "mireCrawlers"/);
		expect(() => STOP_TABLES.rowOf({ roadClass: 'highway', biome: 'scrub', tier: 6, territory: NO_TERRITORY })).toThrow(/tier/);
	});

	it('draw each type in proportion to its weight: class times biome, tier, and territory', () => {
		const tables = compileStopTables({
			classes: { highway: { findCards: 1, wreck: 3, ambush: 1, warband: 3 }, backRoad: { wreck: 1, ambush: 1 }, trail: { wreck: 1, ambush: 1 } },
			biomes: { mire: { findCards: 3 } },
			tiers: { 1: { warband: 0 } },
			territories: { none: {}, raiders: { findCards: 3 } },
		}, 'test');
		const at = (biome: 'scrub' | 'mire', tier: number, territory = 'none') => tables.rowOf({ roadClass: 'highway', biome, tier, territory });
		const pick = (row: number, draw: number, fight = false) => tables.draw({ row, draw, fight });
		const row = at('scrub', 2);
		// Cumulative among the calm, in type order: wreck [0, 3), then findCards [3, 4) of 4.
		expect(pick(row, 0)).toBe('wreck');
		expect(pick(row, 0.749)).toBe('wreck');
		expect(pick(row, 0.75)).toBe('findCards');
		expect(pick(row, 0.9999999)).toBe('findCards');
		// Among the fights: ambush 1 to warband 3.
		expect(pick(row, 0.24, true)).toBe('ambush');
		expect(pick(row, 0.25, true)).toBe('warband');
		// In mire, findCards is 3 of 6, and the fight draw never gives a calm stop.
		expect(pick(at('mire', 2), 0.49)).toBe('wreck');
		expect(pick(at('mire', 2), 0.5)).toBe('findCards');
		expect(pick(at('mire', 2), 0.99, true)).toBe('warband');
		// At tier 1 there's no warband to draw.
		expect(pick(at('scrub', 1), 0.99, true)).toBe('ambush');
		// In a raiders' territory, findCards is 3 of 6.
		const raiders = at('scrub', 2, 'raiders');
		expect(pick(raiders, 0.49)).toBe('wreck');
		expect(pick(raiders, 0.5)).toBe('findCards');
	});

	it('weigh a type the run cannot resolve at nothing, whatever the tables give it', () => {
		const tables = { classes: { highway: { ambush: 1, garage: 100, wreck: 1 }, backRoad: { ambush: 1, wreck: 1 }, trail: { ambush: 1, wreck: 1 } }, biomes: {}, tiers: {}, territories: { none: {} } };
		const row = STOP_TABLES.rowOf({ roadClass: 'highway', biome: 'scrub', tier: 2, territory: NO_TERRITORY });
		const compiled = new CompiledStopTables({ tables, path: 'test' });
		for (const draw of [0, 0.5, 0.99]) expect(compiled.draw({ row, draw, fight: false })).toBe('wreck');
		// With garage resolvable, it takes most of the calm draws.
		const withGarage = new CompiledStopTables({ tables, path: 'test', resolvable: [...RESOLVABLE_STOP_TYPES, 'garage'] });
		expect(withGarage.draw({ row, draw: 0.5, fight: false })).toBe('garage');
		expect(STOP_TYPES.filter(isResolvable)).toEqual(['ambush', 'warband', 'wreck', 'distress', 'findDriver', 'findCards', 'findSupplies']);
	});

	it('fail when read, not mid-map, on a row with nothing to draw or no non-fight to fall back on', () => {
		const noWeight = copy(stopTablesFile);
		noWeight.classes.trail = Object.fromEntries(STOP_TYPES.map((type) => [type, 0])) as typeof noWeight.classes.trail;
		expect(() => compileStopTables(noWeight, 'stopTables')).toThrow(/stopTables: trail in scrub at tier 1 in territory none weighs no fight the run resolves/);
		const fightsOnly = copy(stopTablesFile);
		fightsOnly.classes.highway = Object.fromEntries(STOP_TYPES.map((type) => [type, isFight(type) ? 1 : 0])) as typeof fightsOnly.classes.highway;
		expect(() => compileStopTables(fightsOnly, 'stopTables')).toThrow(/weighs no non-fight the run resolves/);
		// Calm weight only on types the run can't resolve is none.
		const unresolved = copy(stopTablesFile);
		unresolved.classes.highway = Object.fromEntries(STOP_TYPES.map((type) => [type, isFight(type) || !isResolvable(type) ? 1 : 0])) as typeof unresolved.classes.highway;
		expect(() => compileStopTables(unresolved, 'stopTables')).toThrow(/highway in scrub at tier 1 in territory none weighs no non-fight the run resolves/);
		// A biome that zeroes every calm type, only where it applies.
		const mire = copy(stopTablesFile) as unknown as { biomes: Record<string, Record<string, number>> };
		mire.biomes.mire = Object.fromEntries(STOP_TYPES.filter(isCalm).map((type) => [type, 0]));
		expect(() => compileStopTables(mire, 'stopTables')).toThrow(/highway in mire at tier 1 in territory none weighs no non-fight/);
	});

	it('refuse an unknown type, class, biome, or tier, a negative weight, and tables with no unclaimed ground', () => {
		const at = (edit: (tables: Record<string, Record<string, unknown>>) => void) => {
			const tables = copy(stopTablesFile) as unknown as Record<string, Record<string, unknown>>;
			edit(tables);
			return () => compileStopTables(tables, 'stopTables');
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
		expect(readRouteTuning(routesFile, 'RouteTuning').names.classes.highway).toBe('Route {number} highway');
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
		const noFloor = copy(stopsFile);
		noFloor.bands['1'].fights.min = 0;
		expect(() => readStopTuning(noFloor, 'StopTuning')).toThrow(/StopTuning.bands.1.fights.min is the fight floor/);
		const crowded = copy(stopsFile);
		crowded.bands['2'].fights.max = 5;
		expect(() => readStopTuning(crowded, 'StopTuning')).toThrow(/more than the band's 4 stops/);
		const heavyFloor = copy(stopsFile);
		heavyFloor.bands['3'].fights.min = 5;
		heavyFloor.bands['3'].fights.max = 5;
		expect(() => readStopTuning(heavyFloor, 'StopTuning')).toThrow(/StopTuning.bands.3.fights.min 5 is more than the band's least 4 stops/);
		const tight = copy(stopsFile);
		tight.tightGap = 50;
		expect(() => readStopTuning(tight, 'StopTuning')).toThrow(/tightGap must be at most minGap/);
		const routes = copy(routesFile) as unknown as { names: { biomes: Record<string, string> } };
		routes.names.biomes.jungle = 'Through the jungle';
		expect(() => readRouteTuning(routes, 'RouteTuning')).toThrow(/must be one of/);
	});
});
