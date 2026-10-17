import { readFileSync } from 'fs';
import { join } from 'path';
import * as fontkit from 'fontkit';
import { extractGposKerning, type KerningFont } from '../../../../scripts/gpos-kerning';
import { parseFontAtlas } from './FontAtlas';
import { FONT_FACES } from './fontFaces';

// Parses the committed fonts with fontkit, a second or two idle; the 5 s default fails under a loaded machine.
jest.setTimeout(30_000);

/**
 * The committed atlases themselves, as scripts/build-fonts wrote them. These
 * are the checks a regenerated atlas has to pass before it is committed.
 */

const FONTS_DIR = join(__dirname, '../../../assets/fonts');

/**
 * charset.txt in the subset of msdf-atlas-gen's syntax it uses: hex code
 * points and `[first, last]` ranges, comma separated.
 */
function readCharset(): number[] {
	const text = readFileSync(join(FONTS_DIR, 'charset.txt'), 'utf8');
	const codePoints: number[] = [];
	for (const item of text.split(/,(?![^[]*\])/)) {
		const trimmed = item.trim();
		if (!trimmed) continue;
		const range = /^\[\s*(0x[0-9a-f]+)\s*,\s*(0x[0-9a-f]+)\s*\]$/i.exec(trimmed);
		if (range) {
			for (let cp = Number(range[1]); cp <= Number(range[2]); cp++) codePoints.push(cp);
		} else if (/^0x[0-9a-f]+$/i.test(trimmed)) {
			codePoints.push(Number(trimmed));
		} else {
			throw new Error(`charset.txt: cannot read ${JSON.stringify(trimmed)}`);
		}
	}
	return codePoints;
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): { width: number; height: number } {
	const bytes = readFileSync(path);
	expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe.each(FONT_FACES.map((face) => [face.face, face] as const))('committed atlas %s', (name, face) => {
	const warnings: string[] = [];
	const atlas = parseFontAtlas({ json: face.metrics, source: name, warn: (message) => warnings.push(message) });

	it('validates with no dropped glyphs or pairs', () => {
		expect(warnings).toEqual([]);
	});

	it('was built with the section 5 parameters: mtsdf, 48 px per em, range 8', () => {
		expect(atlas.type).toBe('mtsdf');
		expect(atlas.size).toBe(48);
		expect(atlas.distanceRange).toBe(8);
	});

	it('has a PNG the size its metrics describe', () => {
		expect(pngSize(join(FONTS_DIR, `${name}.png`))).toEqual({ width: atlas.width, height: atlas.height });
	});

	it('covers every code point in charset.txt (R6.3)', () => {
		const charset = readCharset();
		expect(charset.length).toBeGreaterThan(200);
		const missing = charset.filter((cp) => atlas.glyph(cp) === undefined).map((cp) => cp.toString(16));
		expect(missing).toEqual([]);
	});

	it('has sane vertical metrics', () => {
		expect(atlas.metrics.ascender).toBeGreaterThan(0.5);
		expect(atlas.metrics.descender).toBeGreaterThan(0);
		expect(atlas.metrics.lineHeight).toBeGreaterThanOrEqual(atlas.metrics.ascender + atlas.metrics.descender);
	});

	it('places a cap above the baseline and a descender below it', () => {
		const cap = atlas.glyph(0x48)?.plane;
		const descender = atlas.glyph(0x70)?.plane;
		expect(cap?.top).toBeLessThan(-0.5);
		expect(cap?.bottom).toBeGreaterThan(0);
		expect(cap?.bottom).toBeLessThan(0.1);
		expect(descender?.bottom).toBeGreaterThan(0.1);
	});

	it('has blank spaces and a visible fallback glyph', () => {
		expect(atlas.glyph(0x20)?.atlas).toBeNull();
		expect(atlas.glyph(0x20)?.advance).toBeGreaterThan(0);
		expect(atlas.glyph(0x3F)?.atlas).not.toBeNull();
		expect(atlas.glyph(0x200B)?.advance).toBe(0);
	});
});

/** Each atlas's source face, as scripts/build-fonts pairs them. */
const SOURCE_FACES: Readonly<Record<string, string>> = {
	'barlow-condensed-semibold': 'barlow-condensed/BarlowCondensed-SemiBold.ttf',
	'barlow-condensed-bold': 'barlow-condensed/BarlowCondensed-Bold.ttf',
	'open-sans-regular': 'open-sans/OpenSans-Regular.ttf',
	'open-sans-semibold': 'open-sans/OpenSans-SemiBold.ttf',
	'jetbrains-mono-regular': 'jetbrains-mono/JetBrainsMono-Regular.ttf',
};

describe('committed kerning (R6.9)', () => {
	const atlases = new Map(FONT_FACES.map((face) => [face.face, parseFontAtlas({ json: face.metrics, source: face.face })]));

	it.each(FONT_FACES.map((face) => [face.face, face] as const))('%s holds exactly what its face\'s GPOS kern feature gives', (name, face) => {
		const font = fontkit.openSync(join(FONTS_DIR, SOURCE_FACES[name])) as unknown as KerningFont;
		const metrics = face.metrics as { glyphs: { unicode: number }[]; kerning: unknown[] };
		const { pairs } = extractGposKerning({ font, codePoints: metrics.glyphs.map((glyph) => glyph.unicode) });
		expect(metrics.kerning).toEqual(pairs);
	});

	it.each([
		['barlow-condensed-semibold', { AV: -0.047, Ta: -0.068, LT: -0.067, HH: 0 }],
		['barlow-condensed-bold', { AV: -0.051, Ta: -0.069, LT: -0.064, HH: 0 }],
	])('kerns the classic pairs of display face %s', (name, expected) => {
		const display = atlases.get(name);
		const kern = (pair: string) => display?.kerning(pair.codePointAt(0) ?? 0, pair.codePointAt(1) ?? 0);
		expect(display?.kerningPairCount).toBeGreaterThan(1000);
		expect(Object.fromEntries(Object.keys(expected).map((pair) => [pair, kern(pair)]))).toEqual(expected);
	});

	// Open Sans is unkerned by decision (DDB-189): no OFL build kerns, and the mock renders the same unkerned face.
	it('has no pairs for Open Sans 3.000 or JetBrains Mono, whose faces carry no kerning', () => {
		expect(atlases.get('open-sans-regular')?.kerningPairCount).toBe(0);
		expect(atlases.get('open-sans-semibold')?.kerningPairCount).toBe(0);
		expect(atlases.get('jetbrains-mono-regular')?.kerningPairCount).toBe(0);
	});
});

describe('font roles', () => {
	it('names each role\'s base face after the role and its other weights <role>-<weight>', () => {
		expect(FONT_FACES.map((face) => [face.font, face.role, face.weight, face.face])).toEqual([
			['display', 'display', 600, 'barlow-condensed-semibold'],
			['display-700', 'display', 700, 'barlow-condensed-bold'],
			['body', 'body', 400, 'open-sans-regular'],
			['body-600', 'body', 600, 'open-sans-semibold'],
			['mono', 'mono', 400, 'jetbrains-mono-regular'],
		]);
	});

	it('ships an OFL licence beside each face', () => {
		for (const directory of ['barlow-condensed', 'open-sans', 'jetbrains-mono']) {
			expect(readFileSync(join(FONTS_DIR, directory, 'OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
		}
	});
});
