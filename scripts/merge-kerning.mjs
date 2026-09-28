// Writes a face's GPOS pair kerning into the atlas JSON msdf-atlas-gen just
// wrote (DDB-182; the generator reads only the legacy kern table). Run by
// scripts/build-fonts.{sh,ps1} after each atlas:
//
//   node scripts/merge-kerning.mjs <face.ttf> <atlas.json>
//
// Only the "kerning" array is rewritten; the rest of the file keeps the
// generator's bytes, since re-serialising its 17-digit floats would churn every
// glyph. Pairs cover the code points the atlas holds and nothing else. A face
// without a GPOS kern feature leaves the file untouched. Running it twice gives
// the same file.
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import * as fontkit from 'fontkit';
import { extractGposKerning } from './gpos-kerning.ts';

const [fontPath, atlasPath] = process.argv.slice(2);
if (!fontPath || !atlasPath) {
	console.error('Usage: node scripts/merge-kerning.mjs <face.ttf> <atlas.json>');
	process.exit(1);
}

const text = readFileSync(atlasPath, 'utf8');
const atlas = JSON.parse(text);
const font = fontkit.openSync(fontPath);
const { hasKernFeature, pairs, skippedLookups } = extractGposKerning({
	font,
	codePoints: atlas.glyphs.map((glyph) => glyph.unicode),
});

for (const { index, lookupType } of skippedLookups) {
	console.warn(`${atlasPath}: kern lookup ${index} is type ${lookupType}, not pair adjustment; left out`);
}
if (!hasKernFeature) {
	console.log(`${atlasPath}: face has no GPOS kern feature, kerning left as generated (${atlas.kerning.length} pairs)`);
	process.exit(0);
}

const KERNING_TAIL = /,"kerning":\[[^\]]*\]\}\n?$/;
if (!KERNING_TAIL.test(text)) {
	throw new Error(`${atlasPath}: expected the file to end with the "kerning" array, as msdf-atlas-gen writes it`);
}
const kerning = pairs.map(({ unicode1, unicode2, advance }) => ({ unicode1, unicode2, advance }));
const merged = text.replace(KERNING_TAIL, `,"kerning":${JSON.stringify(kerning)}}\n`);

const check = JSON.parse(merged);
if (!isDeepStrictEqual({ ...check, kerning: atlas.kerning }, atlas) || !isDeepStrictEqual(check.kerning, kerning)) {
	throw new Error(`${atlasPath}: merging kerning changed more than the kerning array`);
}

writeFileSync(atlasPath, merged);
console.log(`${atlasPath}: ${pairs.length} GPOS kerning pairs`);
