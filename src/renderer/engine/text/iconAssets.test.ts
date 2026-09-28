import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { parseFontAtlas } from './FontAtlas';
import { ATLAS_ASSETS, FONT_FACES, ICON_ATLAS, ICON_ATLAS_ROLE } from './fontFaces';
import { ICON_CODE_POINTS } from './icons';

// Regenerates the icon table in a child process; the 5 s default fails under a loaded machine.
jest.setTimeout(30_000);

/**
 * The committed icon atlas and the generated `icons.ts` (R12.6), as
 * scripts/build-fonts wrote them.
 */

const repoRoot = resolve(__dirname, '../../../..');
const FONTS_DIR = join(repoRoot, 'src/assets/fonts');

function runGenerator(args: string[]) {
	return spawnSync(process.execPath, [join(repoRoot, 'scripts/generate-icons.mjs'), ...args], { encoding: 'utf8' });
}

function pngSize(path: string): { width: number; height: number } {
	const bytes = readFileSync(path);
	expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('committed icon atlas', () => {
	const warnings: string[] = [];
	const atlas = parseFontAtlas({ json: ICON_ATLAS.metrics, source: ICON_ATLAS.face, warn: (message) => warnings.push(message) });

	it('validates with no dropped glyphs', () => {
		expect(warnings).toEqual([]);
	});

	it('was built with the section 5 parameters: mtsdf, 48 px per em, range 8', () => {
		expect(atlas.type).toBe('mtsdf');
		expect(atlas.size).toBe(48);
		expect(atlas.distanceRange).toBe(8);
	});

	it('has a PNG the size its metrics describe', () => {
		expect(pngSize(join(FONTS_DIR, `${ICON_ATLAS.face}.png`))).toEqual({ width: atlas.width, height: atlas.height });
	});

	it('holds a drawable glyph for every icon icons.ts names, and nothing else', () => {
		const codePoints = Object.values(ICON_CODE_POINTS) as number[];
		for (const codePoint of codePoints) {
			expect(atlas.glyph(codePoint)?.atlas).not.toBeNull();
		}
		// The loader synthesizes blank spaces and format characters for every atlas.
		const drawable = [...atlas.codePoints].filter((cp) => atlas.glyph(cp)?.atlas !== null);
		expect(drawable.sort()).toEqual([...codePoints].sort());
	});

	it('puts the em square on the line: ascender 1, descender 0', () => {
		expect(atlas.metrics.ascender).toBe(1);
		expect(atlas.metrics.descender).toBeCloseTo(0);
		for (const codePoint of Object.values(ICON_CODE_POINTS)) {
			const plane = atlas.glyph(codePoint)?.plane;
			expect(plane?.top).toBeGreaterThan(-1.1);
			expect(plane?.bottom).toBeLessThan(0.1);
		}
	});

	it('is loaded after the three text faces under its own name', () => {
		expect(ATLAS_ASSETS).toEqual([...FONT_FACES, ICON_ATLAS]);
		expect(ICON_ATLAS.role).toBe(ICON_ATLAS_ROLE);
	});

	it('ships the icon font\'s Apache 2.0 licence beside it', () => {
		expect(readFileSync(join(FONTS_DIR, 'material-icons', 'LICENSE.txt'), 'utf8')).toContain('Apache License');
	});
});

describe('generate-icons', () => {
	it('matches the committed icons.ts (run scripts/build-fonts when icons.txt changes)', () => {
		const result = runGenerator(['--check']);
		expect(result.stderr).toBe('');
		expect(result.status).toBe(0);
	});

	it('prints the charset msdf-atlas-gen is given', () => {
		const result = runGenerator(['--charset']);
		expect(result.status).toBe(0);
		const charset = result.stdout.trim().split(', ').map(Number);
		expect(charset.sort()).toEqual((Object.values(ICON_CODE_POINTS) as number[]).sort());
	});

	describe('with another icon list', () => {
		let directory: string;
		beforeAll(() => {
			directory = mkdtempSync(join(tmpdir(), 'generate-icons-'));
		});
		afterAll(() => {
			rmSync(directory, { recursive: true, force: true });
		});

		function generateFrom(list: string) {
			const path = join(directory, 'icons.txt');
			writeFileSync(path, list);
			return runGenerator(['--input', path, '--stdout']);
		}

		it('sorts by name, skipping comments and blank lines', () => {
			const result = generateFrom('# comment\nshield\n\nbuild\n');
			expect(result.status).toBe(0);
			expect(result.stdout).toContain('\tbuild: 0xE869,\n\tshield: 0xE9E0,\n');
		});

		it('rejects a name the font does not have', () => {
			const result = generateFrom('shield\nnot_an_icon\n');
			expect(result.status).toBe(2);
			expect(result.stderr).toContain('not_an_icon is not in the icon font');
		});

		it('rejects a name listed twice', () => {
			const result = generateFrom('shield\nshield\n');
			expect(result.status).toBe(2);
			expect(result.stderr).toContain('listed twice');
		});
	});
});
