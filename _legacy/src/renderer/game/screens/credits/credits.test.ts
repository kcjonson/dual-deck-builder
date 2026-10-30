import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as fontkit from 'fontkit';
import { CREDITS } from './credits';

const FONTS = join(__dirname, '../../../../assets/fonts');
const ROOT = join(__dirname, '../../../../..');

const credited = CREDITS.flatMap((section) => section.entries).filter((entry) => entry.asset !== undefined);

describe('credits', () => {
	it('credits every bundled typeface and icon set', () => {
		const bundled = readdirSync(FONTS).filter((name) => statSync(join(FONTS, name)).isDirectory()).sort();
		expect(credited.map((entry) => entry.asset).sort()).toEqual(bundled);
	});

	it.each(credited.map((entry) => [entry.name, entry] as const))('quotes %s\'s copyright line and licence from its own file', (_name, entry) => {
		const directory = join(FONTS, entry.asset as string);
		const licenceFile = readdirSync(directory).find((name) => /^(OFL|LICENSE)\.txt$/.test(name));
		if (!licenceFile) throw new Error(`${entry.asset} ships no licence file`);
		const licence = readFileSync(join(directory, licenceFile), 'utf8');
		const [holder, kind] = entry.lines;
		if (licenceFile === 'OFL.txt') {
			expect(licence).toContain(holder);
			expect(kind).toBe('SIL Open Font License 1.1');
			expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
		} else {
			// The Apache text names no holder; the face's own copyright string does.
			expect(kind).toBe('Apache License 2.0');
			expect(licence).toContain('Apache License');
			expect(licence).toContain('Version 2.0');
			const face = readdirSync(directory).find((name) => name.endsWith('.ttf'));
			if (!face) throw new Error(`${entry.asset} ships no face`);
			const font = fontkit.openSync(join(directory, face)) as unknown as { copyright: string | null };
			expect(holder).toBeTruthy();
			expect(font.copyright).toContain(holder);
		}
	});

	it('names the licence the game itself ships under', () => {
		const line = CREDITS[0].entries.flatMap((entry) => entry.lines).find((text) => text.startsWith('Released under the '));
		const named = line?.match(/^Released under the (.+)\.$/)?.[1];
		const heading = readFileSync(join(ROOT, 'LICENSE'), 'utf8').split(/\r?\n/)[0];
		expect(named).toBeTruthy();
		expect(heading).toBe(`# ${named}`);
	});
});
