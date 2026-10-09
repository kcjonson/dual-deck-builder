import { ReaderRangeError, ReaderTypeError } from '../core/JsonReader';
import { MAP_PARAM_KEYS, MapParamSet } from '../map/MapParams';
import { rollParams } from '../map/RollParams';
import { readMapParamSet, readMapParams } from './MapParamsJson';

describe('readMapParamSet', () => {
	it('keeps what the set holds in the order presets and saves write it, dropping keys left undefined', () => {
		const set = readMapParamSet({ stopTables: {}, towns: 9, radius: undefined, environment: 'rustBelt', seed: 7 }, 'mapParams');

		expect(Object.keys(set)).toEqual(['seed', 'environment', 'towns', 'stopTables']);
		expect(Object.keys(set)).toEqual(MAP_PARAM_KEYS.filter(key => key in set));
	});

	it('keeps values outside their ranges for the validator to clamp', () => {
		expect(readMapParamSet({ seed: 7, radius: 5000, highways: 1.5 }, 'mapParams')).toEqual({ seed: 7, radius: 5000, highways: 1.5 });
	});

	it('holds a frozen copy of the stop tables', () => {
		const stopTables = { highway: { raider_ambush: 2 } };
		const set = readMapParamSet({ seed: 7, stopTables }, 'mapParams');
		stopTables.highway.raider_ambush = 9;

		expect(set.stopTables).toStrictEqual({ highway: { raider_ambush: 2 } });
		expect(Object.isFrozen(set.stopTables?.highway)).toBe(true);
	});

	it('throws reader errors, so a value can be told from a bug', () => {
		expect(() => readMapParamSet({ seed: 7, rivers: '2' } as unknown as MapParamSet, 'mapParams')).toThrow(ReaderTypeError);
		expect(() => readMapParamSet({ seed: -7 }, 'mapParams')).toThrow(ReaderRangeError);
	});
});

describe('readMapParams', () => {
	it('needs every parameter, and refuses one left undefined as a value rather than dropping it', () => {
		const withoutTowns: Record<string, unknown> = { ...rollParams(7) };
		delete withoutTowns.towns;

		expect(() => readMapParams(withoutTowns, 'mapParams')).toThrow('mapParams.towns is missing');
		expect(() => readMapParams({ ...rollParams(7), environment: undefined }, 'mapParams')).toThrow('mapParams.environment must be a string, got undefined');
		expect(() => readMapParams({ ...rollParams(7), towns: undefined }, 'mapParams')).toThrow('mapParams.towns must be a number, got undefined');
	});
});
