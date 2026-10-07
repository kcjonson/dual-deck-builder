import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { MapParamSet, NUMBER_PARAMS, resolveMapParams } from './MapParams';
import { MAP_PRESETS, parseMapPreset, readMapPreset, serializeMapPreset } from './MapPresets';
import { validateMapParams } from './ParamValidator';

const PRESET_DIR = join(__dirname, '..', 'data', 'mapPresets');

describe('MAP_PRESETS', () => {
	const presets = MAP_PRESETS.map((preset) => [preset.name, preset] as const);

	it('lists every file in data/mapPresets and nothing else', () => {
		const files = readdirSync(PRESET_DIR)
			.filter((file) => file.endsWith('.json'))
			.map((file) => file.slice(0, -'.json'.length));
		expect(MAP_PRESETS.map(({ name }) => name).sort()).toEqual(files.sort());
	});

	it('ships a default preset on Mixed', () => {
		const preset = MAP_PRESETS.find(({ name }) => name === 'default');
		expect(preset?.params.environment).toBe('mixed');
	});

	it.each(presets)('%s validates with no clamps', (_name, preset) => {
		const { params } = resolveMapParams(preset.params);
		expect(validateMapParams(params).clamps).toEqual([]);
	});

	it.each(presets)('%s reads the same from its file as from the bundle', (name, preset) => {
		const text = readFileSync(join(PRESET_DIR, `${name}.json`), 'utf8');
		expect(parseMapPreset(text)).toEqual(preset.params);
	});
});

describe('preset JSON', () => {
	it('round-trips a sparse set, leaving out what it doesn\'t set', () => {
		const set: MapParamSet = { seed: 9, environment: 'floodlands', rivers: 4, roadClearance: 30, stopTables: { trail: { hazard: 2 } } };
		const text = serializeMapPreset(set);
		expect(parseMapPreset(text)).toEqual(set);
		expect(Object.keys(JSON.parse(text))).toEqual(['seed', 'environment', 'rivers', 'roadClearance', 'stopTables']);
	});

	it('round-trips complete params, every value an override', () => {
		const { params } = resolveMapParams({ seed: 3, environment: 'badlands' });
		const set = parseMapPreset(serializeMapPreset(params));
		expect(set).toEqual(params);
		const { sources } = resolveMapParams(set);
		expect(NUMBER_PARAMS.filter((name) => sources[name] !== 'override')).toEqual([]);
	});

	it('writes the seed and environment first, then the table\'s order, tab-indented', () => {
		const text = serializeMapPreset({ farmTracks: 0.2, radius: 900, environment: 'rustBelt', seed: 5 });
		expect(text).toBe('{\n\t"seed": 5,\n\t"environment": "rustBelt",\n\t"radius": 900,\n\t"farmTracks": 0.2\n}\n');
	});

	it('leaves the environment out when the set does, which resolves to Mixed', () => {
		const set = parseMapPreset('{"seed": 12}');
		expect(set).toEqual({ seed: 12 });
		expect(resolveMapParams(set).params.environment).toBe('mixed');
	});

	it('keeps values outside their ranges for the validator to report', () => {
		const set = parseMapPreset('{"seed": 1, "highways": 40, "aridity": -1}');
		expect(set).toEqual({ seed: 1, highways: 40, aridity: -1 });
		const { clamps } = validateMapParams(resolveMapParams(set).params);
		expect(clamps.map(({ param }) => param)).toEqual(['aridity', 'highways']);
	});

	it.each([
		['an array', '[1, 2]', 'expected a JSON object'],
		['no seed', '{"environment": "mixed"}', 'seed must be a number'],
		['a seed that isn\'t a number', '{"seed": "2183746551"}', 'seed must be a number'],
		['an unknown environment', '{"seed": 1, "environment": "tundra"}', 'environment must be one of highDesert, rustBelt'],
		['a misspelt parameter', '{"seed": 1, "rivres": 4}', 'unknown parameter "rivres"'],
		['a parameter that isn\'t a number', '{"seed": 1, "rivers": null}', 'rivers must be a number'],
		['stop tables that aren\'t an object', '{"seed": 1, "stopTables": []}', 'stopTables must be an object'],
	])('rejects a preset with %s', (_case, text, message) => {
		expect(() => parseMapPreset(text)).toThrow(message);
	});

	it('names every problem at once', () => {
		expect(() => readMapPreset({ seed: 'x', rivres: 4, lakes: '2' })).toThrow(
			'Invalid map preset: unknown parameter "rivres"; seed must be a number; lakes must be a number',
		);
	});

	it('throws on text that isn\'t JSON', () => {
		expect(() => parseMapPreset('{"seed": 1,')).toThrow(SyntaxError);
	});
});
