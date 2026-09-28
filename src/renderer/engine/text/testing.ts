import { FontAtlas, parseFontAtlas } from './FontAtlas';
import { FONT_FACES, FontRole } from './fontFaces';

/**
 * Fixtures for tests that lay text out in Node (R14.1). Nothing in the game
 * imports this file.
 */

const parsed = new Map<FontRole, FontAtlas>();

/** A committed face's metrics, parsed once per role; a `FontAtlas` is immutable. */
export function committedFontAtlas(role: FontRole): FontAtlas {
	let atlas = parsed.get(role);
	if (!atlas) {
		const face = FONT_FACES.find((candidate) => candidate.role === role);
		if (!face) throw new Error(`no committed face for role '${role}'`);
		atlas = parseFontAtlas({ json: face.metrics, source: face.face, warn: () => undefined });
		parsed.set(role, atlas);
	}
	return atlas;
}

/**
 * A small hand-written atlas whose numbers are exact in binary at the sizes
 * the tests use, so a test can state a pen position as a literal. Em-relative
 * as msdf-atlas-gen writes it with `emSize` 1, y down from the top.
 *
 * - `A` 0.625 em, `b` 0.5, space 0.25, `x` 0.5, `?` 0.5, `-` and the soft
 *   hyphen 0.375, the ellipsis 1; U+00A0 a blank 0.25. Every glyph's plane
 *   starts at the pen and ends at its advance.
 * - Two kerning pairs: `A` then `b` -0.125 em, `b` then the soft hyphen
 *   -0.0625 em.
 * - Ascender 1, descender 0.25, line height 1.25; underline 0.125 below the
 *   baseline; x-height 0.5.
 * - Glyph n's atlas cell is 30 by 60 texels at x = 32n in a 512 by 64 image.
 */
export function syntheticFontAtlas(): FontAtlas {
	const glyph = (unicode: number, advance: number, top: number, cell: number) => ({
		unicode,
		advance,
		planeBounds: { left: 0, top, right: advance, bottom: 0 },
		atlasBounds: { left: cell * 32, top: 0, right: cell * 32 + 30, bottom: 60 },
	});
	return parseFontAtlas({
		source: 'synthetic',
		json: {
			atlas: { type: 'mtsdf', distanceRange: 8, distanceRangeMiddle: 0, size: 48, width: 512, height: 64, yOrigin: 'top' },
			metrics: { emSize: 1, lineHeight: 1.25, ascender: -1, descender: 0.25, underlineY: 0.125, underlineThickness: 0.0625 },
			glyphs: [
				{ unicode: 0x20, advance: 0.25 },
				{ unicode: 0xA0, advance: 0.25 },
				glyph(0x41, 0.625, -0.75, 0),
				glyph(0x62, 0.5, -0.75, 1),
				glyph(0x78, 0.5, -0.5, 2),
				glyph(0x3F, 0.5, -0.75, 3),
				glyph(0x2D, 0.375, -0.375, 4),
				glyph(0xAD, 0.375, -0.375, 5),
				glyph(0x2026, 1, -0.125, 6),
			],
			kerning: [
				{ unicode1: 0x41, unicode2: 0x62, advance: -0.125 },
				{ unicode1: 0x62, unicode2: 0xAD, advance: -0.0625 },
			],
		},
	});
}
