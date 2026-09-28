import { FontAtlasError, MIN_RANGE_TO_SIZE_RATIO, parseFontAtlas } from './FontAtlas';

interface GlyphJson {
	unicode?: unknown;
	advance?: unknown;
	planeBounds?: unknown;
	atlasBounds?: unknown;
}

/** A minimal top-origin msdf-atlas-gen file: a space, an 'A' and a '-'. */
function atlasJson(overrides: {
	atlas?: Record<string, unknown>;
	metrics?: Record<string, unknown>;
	glyphs?: GlyphJson[];
	kerning?: unknown[];
} = {}): Record<string, unknown> {
	return {
		atlas: {
			type: 'mtsdf',
			distanceRange: 8,
			distanceRangeMiddle: 0,
			size: 48,
			width: 128,
			height: 64,
			yOrigin: 'top',
			...overrides.atlas,
		},
		name: 'Test Face',
		metrics: {
			emSize: 1,
			lineHeight: 1.25,
			ascender: -0.9,
			descender: 0.25,
			underlineY: 0.1,
			underlineThickness: 0.05,
			...overrides.metrics,
		},
		glyphs: overrides.glyphs ?? [
			{ unicode: 0x20, advance: 0.25 },
			{
				unicode: 0x41,
				advance: 0.6,
				planeBounds: { left: -0.05, top: -0.8, right: 0.65, bottom: 0.1 },
				atlasBounds: { left: 0.5, top: 0.5, right: 34.5, bottom: 43.5 },
			},
			{
				unicode: 0x2D,
				advance: 0.3,
				planeBounds: { left: 0, top: -0.35, right: 0.3, bottom: -0.2 },
				atlasBounds: { left: 40.5, top: 0.5, right: 55.5, bottom: 8.5 },
			},
		],
		kerning: overrides.kerning ?? [],
	};
}

function parse(json: unknown): { atlas: ReturnType<typeof parseFontAtlas>; warnings: string[] } {
	const warnings: string[] = [];
	const atlas = parseFontAtlas({ json, source: 'test', warn: (message) => warnings.push(message) });
	return { atlas, warnings };
}

describe('parseFontAtlas: structure (R6.2)', () => {
	it('reads a well-formed file with no warnings', () => {
		const { atlas, warnings } = parse(atlasJson());
		expect(warnings).toEqual([]);
		expect(atlas.name).toBe('Test Face');
		expect(atlas.type).toBe('mtsdf');
		expect(atlas.size).toBe(48);
		expect(atlas.distanceRange).toBe(8);
		expect(atlas.distanceRangeMiddle).toBe(0);
		expect(atlas.width).toBe(128);
		expect(atlas.height).toBe(64);
	});

	it.each([
		['the root is not an object', []],
		['atlas is missing', { ...atlasJson(), atlas: undefined }],
		['metrics is missing', { ...atlasJson(), metrics: undefined }],
		['glyphs is missing', { ...atlasJson(), glyphs: undefined }],
		['kerning is missing', { ...atlasJson(), kerning: undefined }],
		['the type is a mask', atlasJson({ atlas: { type: 'hardmask' } })],
		['the size is zero', atlasJson({ atlas: { size: 0 } })],
		['the width is fractional', atlasJson({ atlas: { width: 127.5 } })],
		['the height is a string', atlasJson({ atlas: { height: '64' } })],
		['distanceRange is missing', atlasJson({ atlas: { distanceRange: undefined } })],
		['distanceRangeMiddle is missing', atlasJson({ atlas: { distanceRangeMiddle: undefined } })],
		['yOrigin is missing', atlasJson({ atlas: { yOrigin: undefined } })],
		['yOrigin is unknown', atlasJson({ atlas: { yOrigin: 'middle' } })],
		['emSize is zero', atlasJson({ metrics: { emSize: 0 } })],
		['lineHeight is missing', atlasJson({ metrics: { lineHeight: undefined } })],
		['ascender is not finite', atlasJson({ metrics: { ascender: Number.NaN } })],
		['descender is missing', atlasJson({ metrics: { descender: undefined } })],
	])('throws when %s', (_, json) => {
		expect(() => parse(json)).toThrow(FontAtlasError);
	});

	it('names the file in the error', () => {
		expect(() => parseFontAtlas({ json: {}, source: 'open-sans-regular' }))
			.toThrow('Font atlas open-sans-regular: missing "atlas"');
	});

	it('enforces R6.4a: 32 px per em needs a range of at least 32/6', () => {
		expect(() => parse(atlasJson({ atlas: { size: 32, distanceRange: 4 } }))).toThrow(/R6\.4a/);
		expect(() => parse(atlasJson({ atlas: { size: 32, distanceRange: 6 } }))).not.toThrow();
		expect(() => parse(atlasJson({ atlas: { size: 48, distanceRange: 48 * MIN_RANGE_TO_SIZE_RATIO } })))
			.not.toThrow();
	});

	it('treats underline metrics as optional', () => {
		const { atlas } = parse(atlasJson({ metrics: { underlineY: undefined, underlineThickness: undefined } }));
		expect(atlas.metrics.underlineY).toBeNull();
		expect(atlas.metrics.underlineThickness).toBeNull();
	});
});

describe('parseFontAtlas: glyph validation (R6.2)', () => {
	it('keeps a glyph with neither bounds as a blank glyph', () => {
		const { atlas, warnings } = parse(atlasJson());
		expect(warnings).toEqual([]);
		expect(atlas.glyph(0x20)).toEqual({ codePoint: 0x20, advance: 0.25, plane: null, atlas: null });
	});

	it.each([
		['only planeBounds', { unicode: 0x42, advance: 0.6, planeBounds: { left: 0, top: -0.7, right: 0.5, bottom: 0 } }, /has planeBounds but not atlasBounds/],
		['only atlasBounds', { unicode: 0x42, advance: 0.6, atlasBounds: { left: 0, top: 0, right: 10, bottom: 10 } }, /has atlasBounds but not planeBounds/],
		['malformed planeBounds', { unicode: 0x42, advance: 0.6, planeBounds: { left: 0 }, atlasBounds: { left: 0, top: 0, right: 10, bottom: 10 } }, /malformed planeBounds/],
		['malformed atlasBounds', { unicode: 0x42, advance: 0.6, planeBounds: { left: 0, top: -0.7, right: 0.5, bottom: 0 }, atlasBounds: 'full cell' }, /malformed atlasBounds/],
		['atlasBounds past the atlas edge', { unicode: 0x42, advance: 0.6, planeBounds: { left: 0, top: -0.7, right: 0.5, bottom: 0 }, atlasBounds: { left: 100, top: 0, right: 140, bottom: 10 } }, /outside the 128x64 atlas/],
		['inverted planeBounds', { unicode: 0x42, advance: 0.6, planeBounds: { left: 0.5, top: -0.7, right: 0, bottom: 0 }, atlasBounds: { left: 0, top: 0, right: 10, bottom: 10 } }, /inverted planeBounds/],
		['no advance', { unicode: 0x42 }, /has no advance/],
		['no code point', { advance: 0.6 }, /unicode must be a code point/],
		['a code point past U+10FFFF', { unicode: 0x110000, advance: 0.6 }, /unicode must be a code point/],
	])('drops a glyph with %s and warns, rather than inventing bounds', (_, glyph, reason) => {
		const { atlas, warnings } = parse(atlasJson({ glyphs: [...(atlasJson().glyphs as GlyphJson[]), glyph] }));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/^Font atlas test: dropped glyphs\[3\]: /);
		expect(warnings[0]).toMatch(reason);
		expect(atlas.glyph(0x42)).toBeUndefined();
		expect(atlas.glyph(0x41)).toBeDefined();
	});

	it('keeps the first of two glyphs for one code point', () => {
		const glyphs = atlasJson().glyphs as GlyphJson[];
		const { atlas, warnings } = parse(atlasJson({ glyphs: [...glyphs, { unicode: 0x41, advance: 9 }] }));
		expect(warnings).toEqual(['Font atlas test: dropped glyphs[3]: duplicate code point U+0041']);
		expect(atlas.glyph(0x41)?.advance).toBe(0.6);
	});
});

describe('parseFontAtlas: normalisation', () => {
	it('keeps a top-origin file as it is, with a positive ascender', () => {
		const { atlas } = parse(atlasJson());
		expect(atlas.metrics).toEqual({
			emSize: 1,
			lineHeight: 1.25,
			ascender: 0.9,
			descender: 0.25,
			underlineY: 0.1,
			underlineThickness: 0.05,
		});
		expect(atlas.glyph(0x41)).toEqual({
			codePoint: 0x41,
			advance: 0.6,
			plane: { left: -0.05, top: -0.8, right: 0.65, bottom: 0.1 },
			atlas: { left: 0.5, top: 0.5, right: 34.5, bottom: 43.5 },
		});
	});

	it('flips a bottom-origin file into the same y-down values (yOrigin honoured)', () => {
		const bottomOrigin = atlasJson({
			atlas: { yOrigin: 'bottom' },
			metrics: { ascender: 0.9, descender: -0.25, underlineY: -0.1 },
			glyphs: [{
				unicode: 0x41,
				advance: 0.6,
				planeBounds: { left: -0.05, top: 0.8, right: 0.65, bottom: -0.1 },
				atlasBounds: { left: 0.5, top: 63.5, right: 34.5, bottom: 20.5 },
			}],
		});
		const top = parse(atlasJson()).atlas;
		const bottom = parse(bottomOrigin).atlas;
		expect(bottom.metrics).toEqual(top.metrics);
		expect(bottom.glyph(0x41)).toEqual(top.glyph(0x41));
	});

	it('divides every length by emSize', () => {
		const { atlas } = parse(atlasJson({
			metrics: { emSize: 2, lineHeight: 2.5, ascender: -1.8, descender: 0.5, underlineY: 0.2, underlineThickness: 0.1 },
			glyphs: [{
				unicode: 0x41,
				advance: 1.2,
				planeBounds: { left: -0.1, top: -1.6, right: 1.3, bottom: 0.2 },
				atlasBounds: { left: 0.5, top: 0.5, right: 34.5, bottom: 43.5 },
			}],
			kerning: [{ unicode1: 0x41, unicode2: 0x41, advance: -0.2 }],
		}));
		expect(atlas.metrics.lineHeight).toBe(1.25);
		expect(atlas.metrics.ascender).toBe(0.9);
		expect(atlas.metrics.descender).toBe(0.25);
		expect(atlas.glyph(0x41)?.advance).toBe(0.6);
		expect(atlas.glyph(0x41)?.plane).toEqual({ left: -0.05, top: -0.8, right: 0.65, bottom: 0.1 });
		// Texel bounds are not lengths in em and stay as they are.
		expect(atlas.glyph(0x41)?.atlas).toEqual({ left: 0.5, top: 0.5, right: 34.5, bottom: 43.5 });
		expect(atlas.kerning(0x41, 0x41)).toBe(-0.1);
	});
});

describe('parseFontAtlas: kerning', () => {
	it('looks pairs up in order and returns 0 for an unkerned pair', () => {
		const { atlas, warnings } = parse(atlasJson({
			kerning: [{ unicode1: 0x41, unicode2: 0x2D, advance: -0.04 }],
		}));
		expect(warnings).toEqual([]);
		expect(atlas.kerningPairCount).toBe(1);
		expect(atlas.kerning(0x41, 0x2D)).toBe(-0.04);
		expect(atlas.kerning(0x2D, 0x41)).toBe(0);
	});

	it('drops a malformed pair with a warning', () => {
		const { atlas, warnings } = parse(atlasJson({
			kerning: [{ unicode1: 0x41, advance: -0.04 }, { unicode1: 0x41, unicode2: 0x41, advance: 'tight' }],
		}));
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toMatch(/dropped kerning\[0\]/);
		expect(atlas.kerningPairCount).toBe(0);
	});

	it('drops a pair naming a code point the atlas has no glyph for', () => {
		const { atlas, warnings } = parse(atlasJson({
			kerning: [
				{ unicode1: 0x41, unicode2: 0x56, advance: -0.05 },
				// U+2010 resolves through a substitute, but the face itself never had it.
				{ unicode1: 0x2010, unicode2: 0x41, advance: -0.02 },
			],
		}));
		expect(warnings).toEqual([
			'Font atlas test: dropped kerning[0]: U+0056 is not in the atlas',
			'Font atlas test: dropped kerning[1]: U+2010 is not in the atlas',
		]);
		expect(atlas.kerningPairCount).toBe(0);
		expect(atlas.kerning(0x2010, 0x41)).toBe(0);
	});

	it('keeps the first of two entries for the same pair', () => {
		const { atlas, warnings } = parse(atlasJson({
			kerning: [
				{ unicode1: 0x41, unicode2: 0x2D, advance: -0.04 },
				{ unicode1: 0x41, unicode2: 0x2D, advance: -0.08 },
			],
		}));
		expect(warnings).toEqual(['Font atlas test: dropped kerning[1]: duplicate pair U+0041 U+002D']);
		expect(atlas.kerning(0x41, 0x2D)).toBe(-0.04);
	});
});

describe('parseFontAtlas: coverage completion (R6.3)', () => {
	it('substitutes an absent hyphen with the hyphen-minus', () => {
		const { atlas } = parse(atlasJson());
		expect(atlas.glyph(0x2010)).toEqual({ ...atlas.glyph(0x2D), codePoint: 0x2010 });
		// U+2011 tries U+2010 first, which only exists here as a substitute itself.
		expect(atlas.glyph(0x2011)?.advance).toBe(0.3);
	});

	it('never replaces a glyph the face has', () => {
		const glyphs = [...(atlasJson().glyphs as GlyphJson[]), { unicode: 0x2010, advance: 0.28 }];
		const { atlas } = parse(atlasJson({ glyphs }));
		expect(atlas.glyph(0x2010)?.advance).toBe(0.28);
	});

	it('leaves a code point absent when no substitute exists either', () => {
		const { atlas } = parse(atlasJson());
		// U+2012 falls back to the en dash, which this face lacks too.
		expect(atlas.glyph(0x2012)).toBeUndefined();
	});

	describe('typographic spaces the face lacks', () => {
		const withDigitAndStop = (): GlyphJson[] => [
			...(atlasJson().glyphs as GlyphJson[]),
			{ unicode: 0x30, advance: 0.55 },
			{ unicode: 0x2E, advance: 0.22 },
		];
		const blank = (cp: number, advance: number) => ({ codePoint: cp, advance, plane: null, atlas: null });

		it.each([
			['en space', 0x2002, 1 / 2],
			['em space', 0x2003, 1],
			['three-per-em space', 0x2004, 1 / 3],
			['four-per-em space', 0x2005, 1 / 4],
			['six-per-em space', 0x2006, 1 / 6],
			['thin space', 0x2009, 1 / 5],
			['hair space', 0x200A, 1 / 10],
		])('synthesizes the %s at its fraction of the em, not the word space', (_, cp, width) => {
			const { atlas } = parse(atlasJson({ glyphs: withDigitAndStop() }));
			expect(atlas.glyph(cp)).toEqual(blank(cp, width));
		});

		it('makes the figure space a digit wide', () => {
			const { atlas } = parse(atlasJson({ glyphs: withDigitAndStop() }));
			expect(atlas.glyph(0x2007)).toEqual(blank(0x2007, 0.55));
		});

		it('makes the punctuation space a full stop wide', () => {
			const { atlas } = parse(atlasJson({ glyphs: withDigitAndStop() }));
			expect(atlas.glyph(0x2008)).toEqual(blank(0x2008, 0.22));
		});

		it('leaves the figure space absent when the face has no digit to measure', () => {
			const { atlas } = parse(atlasJson());
			expect(atlas.glyph(0x2007)).toBeUndefined();
		});

		it('keeps a space the face has at the face\'s width', () => {
			const glyphs = [...withDigitAndStop(), { unicode: 0x2003, advance: 0.9 }];
			const { atlas } = parse(atlasJson({ glyphs }));
			expect(atlas.glyph(0x2003)?.advance).toBe(0.9);
		});

		it('gives the narrow no-break space the synthesized thin space', () => {
			const { atlas } = parse(atlasJson());
			expect(atlas.glyph(0x202F)).toEqual(blank(0x202F, 1 / 5));
		});
	});

	it('makes format characters zero-width even when the face gives them an advance', () => {
		const glyphs = [...(atlasJson().glyphs as GlyphJson[]), { unicode: 0x200B, advance: 0.6 }];
		const { atlas } = parse(atlasJson({ glyphs }));
		for (const cp of [0x200B, 0x2060, 0xFEFF]) {
			expect(atlas.glyph(cp)).toEqual({ codePoint: cp, advance: 0, plane: null, atlas: null });
		}
	});
});
