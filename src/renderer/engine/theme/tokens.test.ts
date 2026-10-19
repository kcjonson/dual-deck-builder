import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { LAYER_NAMES } from '../draw/layers';
import { themes, tokens } from './tokens';

type TokenEntry = {
	value?: unknown;
	alias?: string;
	css?: string;
	cssOnly?: boolean;
	description?: string;
};
type TokenSource = Record<string, Record<string, TokenEntry>>;
type ThemeFile = TokenSource & { themes?: Record<string, TokenSource> };
type RGBA = readonly [number, number, number, number];

const repoRoot = resolve(__dirname, '../../../..');
const generatorPath = join(repoRoot, 'scripts/generate-tokens.mjs');
const sourcePath = join(__dirname, 'tokens.json');
const modulePath = join(__dirname, 'tokens.ts');

/** The base theme's categories, without metadata or the themes object. */
function readSource(): TokenSource {
	const parsed = readFile();
	const categories: TokenSource = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (!key.startsWith('$') && key !== 'themes') categories[key] = value as Record<string, TokenEntry>;
	}
	return categories;
}

function readFile(): ThemeFile {
	return JSON.parse(readFileSync(sourcePath, 'utf8')) as ThemeFile;
}

function themesOf(source: ThemeFile): Record<string, TokenSource> {
	if (!source.themes) throw new Error('tokens.json has no themes');
	return source.themes;
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

/**
 * CIE76 distance a UI hue keeps from every legend colour. Around 2 is a just
 * noticeable difference; 20 reads as a different colour at a glance, which is
 * what "one hue, one meaning" needs.
 */
const MIN_LEGEND_DISTANCE = 20;

function hexToRgba(hex: string): RGBA {
	const channel = (offset: number) => parseInt(hex.slice(offset, offset + 2), 16) / 255;
	return [channel(1), channel(3), channel(5), 1];
}

/** sRGB to CIE L*a*b* under D65. */
function lab([red, green, blue]: RGBA): [number, number, number] {
	const linear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
	const [r, g, b] = [linear(red), linear(green), linear(blue)];
	const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
	const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
	const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
	return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function labDistance(a: RGBA, b: RGBA): number {
	const [l1, a1, b1] = lab(a);
	const [l2, a2, b2] = lab(b);
	return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function luminance([red, green, blue]: RGBA): number {
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

describe('tokens.ts (R11.2)', () => {
	it('equals a fresh generation from tokens.json; run `npm run tokens` if this fails', () => {
		const result = runGenerator(['--stdout']);
		expect(result.stderr).toBe('');
		expect(result.status).toBe(0);
		// A Windows checkout with autocrlf holds CRLF; the generator writes LF.
		expect(readFileSync(modulePath, 'utf8').replace(/\r\n/g, '\n')).toBe(result.stdout);
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

	function generateFrom(mutate: (source: ThemeFile) => void) {
		const source = readFile();
		mutate(source);
		const path = join(directory, 'tokens.json');
		writeFileSync(path, JSON.stringify(source));
		return runGenerator(['--input', path, '--stdout']);
	}

	const cases: Array<[string, (source: ThemeFile) => void, RegExp]> = [
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
			'an alias to an inherited property',
			(source) => {
				source.radius.radius_ui = { alias: 'radius.constructor' };
			},
			/radius\.radius_ui: alias "radius\.constructor" names no token/,
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
		[
			'a theme token the base does not have',
			(source) => {
				themesOf(source).atlas.color.sepia = { value: [0.5, 0.4, 0.3, 1] };
			},
			/themes\.atlas\.color\.sepia: the base has no token "sepia"/,
		],
		[
			'a theme re-valuing measurement',
			(source) => {
				themesOf(source).atlas.space = { space_1: { value: 5 } };
			},
			/themes\.atlas\.space: a theme re-values paint/,
		],
		[
			'a theme colour whose floats disagree with its css form',
			(source) => {
				themesOf(source).atlas.color.accent.value = [1, 0, 0, 1];
			},
			/color\.accent: value .* does not match css/,
		],
		[
			'a theme named after the base',
			(source) => {
				themesOf(source).dark = {};
			},
			/themes\.dark: "dark" is the base theme/,
		],
	];

	it.each(cases)('%s', (_label, mutate, message) => {
		const result = generateFrom(mutate);
		expect(result.status).toBe(2);
		expect(result.stdout).toBe('');
		expect(result.stderr).toMatch(message);
	});

	// Symlinks need a privilege on Windows; the guard's logic is platform-independent.
	(process.platform === 'win32' ? it.skip : it)('still runs when invoked through a symlinked path', () => {
		const link = join(directory, 'generate-tokens-link.mjs');
		symlinkSync(generatorPath, link);
		const result = spawnSync(process.execPath, [link, '--stdout'], { encoding: 'utf8' });
		expect(result.status).toBe(0);
		expect(result.stdout).toBe(readFileSync(modulePath, 'utf8').replace(/\r\n/g, '\n'));
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

	it('keeps data, ok, and crit a clear Lab distance from every battle screen legend colour', () => {
		// docs/design/battle-screen/index.html, "One hue, one meaning": drivers,
		// escort, raiders, structure, armor, HP, warnings, the rarity gems, and
		// the debuff and non-attack intent lavenders. The nearest today is data
		// to the debuff lavender at about 24.
		const legend = [
			'#f2a33a', '#3cc3c9', '#8f8a7e', '#d4513f', '#8fbf5c', '#a9bccd', '#e7727a',
			'#9b978c', '#6fb3e0', '#e0c14f', '#d06ad8', '#d3a6f0', '#c98ff0',
		];
		for (const hue of [color.data, color.status_ok, color.status_crit]) {
			const nearest = Math.min(...legend.map((entry) => labDistance(hue, hexToRgba(entry))));
			expect(nearest).toBeGreaterThanOrEqual(MIN_LEGEND_DISTANCE);
		}
	});

	it('uses the R11.7 radius scale with structural surfaces on one small value', () => {
		expect([radius.r_0, radius.r_xs, radius.r_sm, radius.r_md, radius.r_lg, radius.r_xl]).toEqual([0, 1, 2, 4, 8, 14]);
		expect(radius.r_pill).toBeGreaterThanOrEqual(999);
		expect(radius.radius_ui).toBe(radius.r_sm);
		expect(radius.radius_panel).toBe(radius.r_sm);
	});

	it('has three type roles with body bold falling back to display (R11.8)', () => {
		for (const role of [typography.role_display, typography.role_body, typography.role_mono]) {
			expect(role.weights.length).toBeGreaterThan(0);
		}
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

describe('atlas theme (UI Art Direction, Tokens)', () => {
	const { atlas, dark } = themes;
	const hex = (value: string, alpha = 1): RGBA => {
		const [red, green, blue] = hexToRgba(value);
		return [red, green, blue, alpha];
	};
	const near = (actual: readonly number[], expected: RGBA) => {
		expect(actual).toHaveLength(4);
		actual.forEach((channel, index) => expect(channel).toBeCloseTo(expected[index], 3));
	};
	const INK = '#23221F';
	const HIGHLIGHTER = '#F4DA4C';
	const TABLE = '#24211C';

	it('is the base theme under its own name, and the base is dark', () => {
		expect(dark).toBe(tokens);
	});

	it('has exactly the leaf names of the base in every category (R11.4)', () => {
		for (const category of Object.keys(dark) as Array<keyof typeof dark>) {
			expect(Object.keys(atlas[category])).toEqual(Object.keys(dark[category]));
		}
	});

	it('takes its surfaces and lines from the palette', () => {
		const { color } = atlas;
		near(color.bg_void, hex(TABLE));
		near(color.bg_base, hex('#EEE7D2'));
		near(color.bg_inset, hex('#E4DCC4'));
		near(color.bg_panel, hex('#F4EEDD'));
		near(color.bg_panel_raised, hex('#F6F1E4'));
		near(color.bg_hover, hex(INK, 0.045));
		near(color.bg_active, hex(HIGHLIGHTER, 0.35));
		near(color.bg_selection, hex(HIGHLIGHTER, 0.55));
		near(color.bg_pressed, hex(INK, 0.1));
		near(color.line_hairline, hex(INK, 0.14));
		near(color.line_edge, hex(INK, 0.4));
		near(color.line_strong, hex(INK, 0.9));
		near(color.scrim, hex(TABLE, 0.6));
		near(color.shadow, hex('#140F0A', 0.5));
		near(color.shadow_strong, hex('#140F0A', 0.75));
	});

	it('takes its accents, text, and status from the palette', () => {
		const { color } = atlas;
		near(color.accent, hex('#D86036'));
		near(color.accent_bright, hex('#E8703F'));
		near(color.accent_dim, hex('#682C1E'));
		near(color.accent_contrast, hex('#FFF8EE'));
		near(color.data, hex('#3E6F98'));
		near(color.data_bright, hex('#86AED3'));
		near(color.data_dim, hex('#AFCDE1'));
		near(color.text_bright, hex('#141311'));
		near(color.text, hex(INK));
		near(color.text_dim, hex('#5D5A52'));
		near(color.text_faint, hex('#6E6A61'));
		near(color.text_disabled, hex('#8E8778'));
		near(color.status_ok, hex('#4F6B3A'));
		near(color.status_crit, hex('#A3221B'));
	});

	it('keeps warn and info as aliases, so they follow the atlas accents (R11.6)', () => {
		expect(atlas.color.status_warn).toEqual(atlas.color.accent);
		expect(atlas.color.status_info).toEqual(atlas.color.data);
	});

	it('marks active things without light: both glows and the glow presets are transparent', () => {
		expect(atlas.color.accent_glow[3]).toBe(0);
		expect(atlas.color.data_glow[3]).toBe(0);
		expect(atlas.elevation.glow_accent.color[3]).toBe(0);
		expect(atlas.elevation.glow_data.color[3]).toBe(0);
	});

	it('is square-cornered by re-aliasing radius_ui and radius_panel to r_0 (R11.7)', () => {
		expect(atlas.radius.radius_ui).toBe(0);
		expect(atlas.radius.radius_panel).toBe(0);
		expect(dark.radius.radius_ui).toBe(dark.radius.r_sm);
	});

	it('carries the additions in both themes', () => {
		for (const theme of [atlas, dark]) {
			near(theme.color.driver_a, hex('#D86036'));
			near(theme.color.driver_a_casing, hex('#682C1E'));
			near(theme.color.driver_b, hex('#4FA6A3'));
			near(theme.color.driver_b_casing, hex('#1F6E6A'));
			near(theme.color.hand_highlighter, hex(HIGHLIGHTER));
			near(theme.color.hand_grease, hex('#C8372D'));
			near(theme.color.hatch_rust, hex('#B5643C'));
			near(theme.color.built_up, hex('#E5D4CC'));
			expect(theme.space.sheet_margin).toBe(14);
		}
	});

	it('leaves the dark theme as it was', () => {
		near(dark.color.bg_base, hex('#1A1C1E'));
		near(dark.color.accent, hex('#EFD25A'));
		expect(dark.color.accent_glow[3]).toBe(0.45);
	});

	it('re-values paint only, so layout is the same in both themes', () => {
		for (const category of ['space', 'borderWidth', 'fontSize', 'lineHeight', 'letterSpacing', 'motion', 'layer', 'typography', 'control'] as const) {
			expect(atlas[category]).toEqual(dark[category]);
		}
	});

	it('holds the measured contrasts: ink on paper, and paper text on highway for large text only', () => {
		const relative = (rgba: readonly number[]) => {
			const linear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
			return 0.2126 * linear(rgba[0]) + 0.7152 * linear(rgba[1]) + 0.0722 * linear(rgba[2]);
		};
		const contrast = (a: readonly number[], b: readonly number[]) => {
			const [light, deep] = [relative(a), relative(b)].sort((x, y) => y - x);
			return (light + 0.05) / (deep + 0.05);
		};
		expect(contrast(atlas.color.text, atlas.color.bg_panel)).toBeGreaterThan(13);
		expect(contrast(atlas.color.text_faint, atlas.color.bg_panel)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(atlas.color.status_crit, atlas.color.bg_panel)).toBeGreaterThan(6);
		expect(contrast(atlas.color.accent_contrast, atlas.color.accent)).toBeGreaterThanOrEqual(3);
	});
});
