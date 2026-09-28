import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { LAYER_NAMES } from '../draw/layers';
import { tokens } from './tokens';

type TokenEntry = {
	value?: unknown;
	alias?: string;
	css?: string;
	cssOnly?: boolean;
	description?: string;
};
type TokenSource = Record<string, Record<string, TokenEntry>>;
type RGBA = readonly [number, number, number, number];

const repoRoot = resolve(__dirname, '../../../..');
const generatorPath = join(repoRoot, 'scripts/generate-tokens.mjs');
const sourcePath = join(__dirname, 'tokens.json');
const modulePath = join(__dirname, 'tokens.ts');

function readSource(): TokenSource {
	const parsed = JSON.parse(readFileSync(sourcePath, 'utf8')) as Record<string, unknown>;
	const categories: TokenSource = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (!key.startsWith('$')) categories[key] = value as Record<string, TokenEntry>;
	}
	return categories;
}

function runGenerator(args: string[]) {
	return spawnSync(process.execPath, [generatorPath, ...args], { encoding: 'utf8' });
}

const generated = tokens as unknown as Record<string, Record<string, unknown>>;

function moduleValue(reference: string): unknown {
	const [category, name] = reference.split('.');
	return generated[category]?.[name];
}

/** Replaces nested `{ alias }` objects with the module's value for that token. */
function expectedValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(expectedValue);
	if (typeof value === 'object' && value !== null) {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record);
		if (keys.length === 1 && typeof record.alias === 'string') return moduleValue(record.alias);
		return Object.fromEntries(keys.map((key) => [key, expectedValue(record[key])]));
	}
	return value;
}

function luminance([red, green, blue]: RGBA): number {
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

describe('tokens.ts (R11.2)', () => {
	it('equals a fresh generation from tokens.json; run `npm run tokens` if this fails', () => {
		const result = runGenerator(['--stdout']);
		expect(result.stderr).toBe('');
		expect(result.status).toBe(0);
		expect(readFileSync(modulePath, 'utf8')).toBe(result.stdout);
	});

	it('carries every token of the file with the same value, and css-only tokens nowhere', () => {
		const source = readSource();
		expect(Object.keys(generated)).toEqual(Object.keys(source));
		for (const [category, entries] of Object.entries(source)) {
			const numericNames = Object.keys(entries).filter((name) => entries[name].cssOnly !== true);
			expect(Object.keys(generated[category])).toEqual(numericNames);
			for (const [name, entry] of Object.entries(entries)) {
				if (entry.cssOnly === true) {
					expect(generated[category]).not.toHaveProperty(name);
				} else if (entry.alias !== undefined) {
					expect(generated[category][name]).toEqual(moduleValue(entry.alias));
				} else {
					expect(generated[category][name]).toEqual(expectedValue(entry.value));
				}
			}
		}
	});

	it('has at least one css-only token, so the skip path is exercised', () => {
		const source = readSource();
		const cssOnly = Object.values(source).flatMap((entries) => Object.values(entries).filter((entry) => entry.cssOnly));
		expect(cssOnly.length).toBeGreaterThan(0);
	});
});

describe('generator rejects a bad token file', () => {
	let directory: string;

	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), 'tokens-test-'));
	});

	afterAll(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	function generateFrom(mutate: (source: TokenSource) => void) {
		const source = readSource();
		mutate(source);
		const path = join(directory, 'tokens.json');
		writeFileSync(path, JSON.stringify(source));
		return runGenerator(['--input', path, '--stdout']);
	}

	const cases: Array<[string, (source: TokenSource) => void, RegExp]> = [
		[
			'a colour whose floats disagree with its css form',
			(source) => {
				source.color.accent.value = [1, 0, 0, 1];
			},
			/color\.accent: value .* does not match css/,
		],
		[
			'an easing whose control points disagree with its css form',
			(source) => {
				source.motion.ease_standard.value = [0.4, 0, 1, 1];
			},
			/motion\.ease_standard: value .* does not match css/,
		],
		[
			'an unknown category',
			(source) => {
				source.zIndex = { z_card: { value: 3 } };
			},
			/unknown category "zIndex"/,
		],
		[
			'a missing required category',
			(source) => {
				delete source.control;
			},
			/missing required category "control"/,
		],
		[
			'a leaf name used twice',
			(source) => {
				source.space.accent = { value: 4 };
			},
			/leaf name "accent" is already used by color\.accent/,
		],
		[
			'an alias to nothing',
			(source) => {
				source.radius.radius_ui = { alias: 'radius.r_huge' };
			},
			/radius\.radius_ui: alias "radius\.r_huge" names no token/,
		],
		[
			'an alias cycle',
			(source) => {
				source.radius.radius_ui = { alias: 'radius.radius_panel' };
				source.radius.radius_panel = { alias: 'radius.radius_ui' };
			},
			/alias cycle/,
		],
		[
			'a token with both a value and an alias',
			(source) => {
				source.radius.r_sm = { value: 2, alias: 'radius.r_md' };
			},
			/exactly one of value and alias/,
		],
		[
			'a non-numeric value in a numeric category',
			(source) => {
				source.space.space_1 = { value: '4px' };
			},
			/space\.space_1: expected a number/,
		],
	];

	it.each(cases)('%s', (_label, mutate, message) => {
		const result = generateFrom(mutate);
		expect(result.status).toBe(2);
		expect(result.stdout).toBe('');
		expect(result.stderr).toMatch(message);
	});
});

describe('starting theme (11.2)', () => {
	const { color, radius, control, fontSize, space, motion, typography, layer } = tokens;

	it('names the R11.3 control tokens', () => {
		const required = [
			'control_h_sm',
			'control_h_md',
			'control_h_lg',
			'icon_sm',
			'icon_md',
			'icon_lg',
			'focus_ring_width',
			'focus_ring_offset',
			'drag_threshold_mouse',
			'drag_threshold_touch',
			'tooltip_delay',
			'hover_move_tolerance',
		];
		for (const name of required) expect(control).toHaveProperty(name);
	});

	it('orders five surfaces from deepest to most raised with inset below panel (R11.5)', () => {
		const ladder = [color.bg_void, color.bg_base, color.bg_panel, color.bg_panel_raised].map(luminance);
		expect([...ladder].sort((low, high) => low - high)).toEqual(ladder);
		expect(luminance(color.bg_inset)).toBeLessThan(luminance(color.bg_panel));
		expect(luminance(color.bg_inset)).toBeGreaterThan(luminance(color.bg_void));
	});

	it('draws three line weights in one tint at 0.10, 0.20, 0.36 (R11.5)', () => {
		expect([color.line_hairline[3], color.line_edge[3], color.line_strong[3]]).toEqual([0.1, 0.2, 0.36]);
		expect(color.line_edge.slice(0, 3)).toEqual(color.line_hairline.slice(0, 3));
		expect(color.line_strong.slice(0, 3)).toEqual(color.line_hairline.slice(0, 3));
		expect(color.line_hairline.slice(0, 3)).not.toEqual([1, 1, 1]);
	});

	it('has two accents, warm and cool, with warn and info as aliases (R11.6)', () => {
		expect(color.accent[0]).toBeGreaterThan(color.accent[2]);
		expect(color.data[2]).toBeGreaterThan(color.data[0]);
		expect(color.status_warn).toEqual(color.accent);
		expect(color.status_info).toEqual(color.data);
		expect(color.accent_glow[3]).toBe(0.45);
		expect(color.accent_glow.slice(0, 3)).toEqual(color.accent.slice(0, 3));
	});

	it('uses the R11.7 radius scale with structural surfaces on one small value', () => {
		expect([radius.r_0, radius.r_xs, radius.r_sm, radius.r_md, radius.r_lg, radius.r_xl]).toEqual([0, 1, 2, 4, 8, 14]);
		expect(radius.r_pill).toBeGreaterThanOrEqual(999);
		expect(radius.radius_ui).toBe(radius.r_sm);
		expect(radius.radius_panel).toBe(radius.r_sm);
	});

	it('has three type roles with body bold falling back to display (R11.8)', () => {
		expect(typography.role_display.weights).toContain(typography.weight_bold);
		expect(typography.role_body.boldRole).toBe('display');
		expect(typography.role_body.size).toBe(13);
		expect(typography.role_body.lineHeight).toBe(1.4);
		expect(typography.role_display.titleLetterSpacing).toBe(0.08);
		expect(typography.role_mono.letterSpacing).toBe(0.16);
	});

	it('derives control geometry from the spacing scale (R11.9, R11.10)', () => {
		expect([control.control_h_sm, control.control_h_md, control.control_h_lg]).toEqual([26, 34, 46]);
		expect([control.control_fs_sm, control.control_fs_md, control.control_fs_lg]).toEqual([13, 15, 18]);
		expect(control.inset_field).toBe(space.space_3);
		expect(control.inset_row).toBe(space.space_2);
		expect([space.space_0_5, space.space_1, space.space_1_5]).toEqual([2, 4, 6]);
	});

	it('defines no text size below 11 px (R6.4a)', () => {
		expect(Math.min(...Object.values(fontSize))).toBeGreaterThanOrEqual(11);
	});

	it('has the R11.13 motion values', () => {
		expect([motion.dur_fast, motion.dur, motion.dur_slow]).toEqual([120, 200, 360]);
		expect(motion.ease_standard).toEqual([0.4, 0, 0.2, 1]);
		expect(motion.ease_emphasized).toEqual([0.16, 1, 0.3, 1]);
	});

	it('names every layer of the chapter 3 ladder, in order', () => {
		expect(Object.values(layer)).toEqual([...LAYER_NAMES]);
	});
});
