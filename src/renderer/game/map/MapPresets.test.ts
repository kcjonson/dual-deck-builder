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

	it('is frozen through, so nothing can edit a shipped preset in place', () => {
		const unfrozen: string[] = [];
		const walk = (value: unknown, path: string): void => {
			if (typeof value !== 'object' || value === null) return;
			if (!Object.isFrozen(value)) unfrozen.push(path);
			for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
		};
		walk(MAP_PRESETS, 'MAP_PRESETS');
		expect(unfrozen).toEqual([]);
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
		['no seed', '{"environment": "mixed"}', 'seed must be a finite number'],
		['a seed that isn\'t a number', '{"seed": "2183746551"}', 'seed must be a finite number'],
		['a seed past what a number holds', '{"seed": 1e999}', 'seed must be a finite number'],
		['an unknown environment', '{"seed": 1, "environment": "tundra"}', 'environment must be one of highDesert, rustBelt'],
		['a misspelt parameter', '{"seed": 1, "rivres": 4}', 'unknown parameter "rivres"'],
		['a parameter that isn\'t a number', '{"seed": 1, "rivers": null}', 'rivers must be a finite number'],
		['a parameter past what a number holds', '{"seed": 1, "radius": -1e999}', 'radius must be a finite number'],
		['stop tables that aren\'t an object', '{"seed": 1, "stopTables": []}', 'stopTables must be an object'],
		['a stop weight past what a number holds', '{"seed": 1, "stopTables": {"trail": {"wreck": [1, 1e999]}}}', 'stopTables.trail.wreck[1] must be a finite number'],
	])('rejects a preset with %s', (_case, text, message) => {
		expect(() => parseMapPreset(text)).toThrow(message);
	});

	it('rejects NaN and Infinity in a set read from code', () => {
		expect(() => readMapPreset({ seed: 1, rivers: NaN, aridity: Infinity })).toThrow(
			'Invalid map preset: aridity must be a finite number; rivers must be a finite number',
		);
	});

	it('names every problem at once', () => {
		expect(() => readMapPreset({ seed: 'x', rivres: 4, lakes: '2' })).toThrow(
			'Invalid map preset: unknown parameter "rivres"; seed must be a finite number; lakes must be a finite number',
		);
	});

	it('shares no stop tables with what it read', () => {
		const json = { seed: 1, stopTables: { trail: { wreck: 1 } } };
		const set = readMapPreset(json);
		json.stopTables.trail.wreck = 5;
		expect(set.stopTables).toEqual({ trail: { wreck: 1 } });
	});

	it('names text that isn\'t JSON as an invalid preset', () => {
		expect(() => parseMapPreset('{"seed": 1,')).toThrow(SyntaxError);
		expect(() => parseMapPreset('{"seed": 1,')).toThrow(/^Invalid map preset: /);
	});

	it('reads text that starts with a byte order mark', () => {
		expect(parseMapPreset('\uFEFF{"seed": 12, "rivers": 3}')).toEqual({ seed: 12, rivers: 3 });
	});

	it.each([
		['NaN', { seed: 1, rivers: NaN }, 'rivers must be a finite number'],
		['Infinity', { seed: 1, radius: Infinity }, 'radius must be a finite number'],
		['a NaN seed', { seed: NaN }, 'seed must be a finite number'],
		['NaN in the stop tables', { seed: 1, stopTables: { trail: { wreck: NaN } } }, 'stopTables.trail.wreck must be a finite number'],
	])('refuses to write %s rather than write null', (_case, set, message) => {
		expect(() => serializeMapPreset(set as MapParamSet)).toThrow(message);
	});
});
