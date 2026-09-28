import { join } from 'path';
import * as fontkit from 'fontkit';
import { extractGposKerning, type GposLookup, type KerningFont, type PairValue } from './gpos-kerning';

const FONTS_DIR = join(__dirname, '../src/assets/fonts');

/** Glyph ids for the synthetic faces: A=1 V=2 T=3 o=4 acute (a mark)=5. */
const GLYPH_IDS = new Map([[0x41, 1], [0x56, 2], [0x54, 3], [0x6F, 4], [0x301, 5]]);

function advance(xAdvance: number): PairValue {
	return { value1: { xAdvance }, value2: {} };
}

function lookup(subTables: unknown[], { lookupType = 2, ignoreMarks = false } = {}): GposLookup {
	return { lookupType, flags: { markAttachmentType: 0, flags: { ignoreMarks } }, subTables };
}

/** A=V kerned by a format 1 pair set. */
const FORMAT_1 = {
	version: 1,
	coverage: { version: 1, glyphs: [1] },
	pairSets: [[{ secondGlyph: 2, ...advance(-80) }]],
};

/**
 * Class kerning: class 1 on the left is {T}, class 1 on the right is {o, A};
 * everything else is class 0, whose row and column hold 0.
 */
const FORMAT_2 = {
	version: 2,
	coverage: { version: 2, rangeRecords: [{ start: 1, end: 3, startCoverageIndex: 0 }] },
	classDef1: { version: 1, startGlyph: 3, classValueArray: [1] },
	classDef2: { version: 2, classRangeRecord: [{ start: 1, end: 1, class: 1 }, { start: 4, end: 4, class: 1 }] },
	class1Count: 2,
	class2Count: 2,
	classRecords: [[advance(0), advance(0)], [advance(0), advance(-120)]],
};

function syntheticFont({ lookups, kernLookups = lookups.map((_, index) => index), script = 'latn', gdef }: {
	lookups: GposLookup[];
	kernLookups?: number[];
	script?: string;
	gdef?: KerningFont['GDEF'];
}): KerningFont {
	return {
		unitsPerEm: 1000,
		glyphForCodePoint: (codePoint) => ({ id: GLYPH_IDS.get(codePoint) ?? 0 }),
		GPOS: {
			scriptList: [{ tag: script, script: { defaultLangSys: { reqFeatureIndex: 0xFFFF, featureIndexes: [0, 1] } } }],
			featureList: [
				{ tag: 'mark', feature: { lookupListIndexes: [] } },
				{ tag: 'kern', feature: { lookupListIndexes: kernLookups } },
			],
			lookupList: lookups,
		},
		GDEF: gdef,
	};
}

const LETTERS = [0x41, 0x56, 0x54, 0x6F];

describe('extractGposKerning: pair adjustment', () => {
	it('reads format 1 pair sets and format 2 class records, in em', () => {
		const { hasKernFeature, pairs } = extractGposKerning({
			font: syntheticFont({ lookups: [lookup([FORMAT_1, FORMAT_2])] }),
			codePoints: LETTERS,
		});
		expect(hasKernFeature).toBe(true);
		expect(pairs).toEqual([
			{ unicode1: 0x41, unicode2: 0x56, advance: -0.08 },
			{ unicode1: 0x54, unicode2: 0x41, advance: -0.12 },
			{ unicode1: 0x54, unicode2: 0x6F, advance: -0.12 },
		]);
	});

	it('lets the first subtable that applies win, falling through a format 1 miss', () => {
		// A is covered by both. A,V is in the pair set; A,o is not, so it falls to
		// the class subtable, where A is class 0 and kerns nothing.
		const classKernsA = { ...FORMAT_2, classDef1: { version: 1, startGlyph: 1, classValueArray: [1, 0, 1] } };
		const { pairs } = extractGposKerning({
			font: syntheticFont({ lookups: [lookup([FORMAT_1, classKernsA])] }),
			codePoints: LETTERS,
		});
		expect(pairs).toContainEqual({ unicode1: 0x41, unicode2: 0x56, advance: -0.08 });
		expect(pairs).toContainEqual({ unicode1: 0x41, unicode2: 0x6F, advance: -0.12 });
	});

	it('sums adjustments across lookups and unwraps extension lookups', () => {
		const extension = { lookupType: 2, extension: FORMAT_1 };
		const { pairs } = extractGposKerning({
			font: syntheticFont({ lookups: [lookup([FORMAT_1]), lookup([extension], { lookupType: 9 })] }),
			codePoints: LETTERS,
		});
		expect(pairs).toEqual([{ unicode1: 0x41, unicode2: 0x56, advance: -0.16 }]);
	});

	it('uses only the lookups the kern feature names', () => {
		const { pairs } = extractGposKerning({
			font: syntheticFont({ lookups: [lookup([FORMAT_1]), lookup([FORMAT_2])], kernLookups: [1] }),
			codePoints: LETTERS,
		});
		expect(pairs.map((pair) => pair.unicode1)).toEqual([0x54, 0x54]);
	});

	it('reports a contextual kern lookup as skipped', () => {
		const { pairs, skippedLookups } = extractGposKerning({
			font: syntheticFont({ lookups: [lookup([FORMAT_1]), lookup([{}], { lookupType: 8 })] }),
			codePoints: LETTERS,
		});
		expect(pairs).toHaveLength(1);
		expect(skippedLookups).toEqual([{ index: 1, lookupType: 8 }]);
	});

	it('skips glyphs a lookup ignores', () => {
		const kernsMark = { ...FORMAT_1, pairSets: [[{ secondGlyph: 5, ...advance(-30) }]] };
		const gdef = { glyphClassDef: { version: 2 as const, classRangeRecord: [{ start: 5, end: 5, class: 3 }] } };
		const codePoints = [0x41, 0x301];
		expect(extractGposKerning({ font: syntheticFont({ lookups: [lookup([kernsMark])], gdef }), codePoints }).pairs)
			.toEqual([{ unicode1: 0x41, unicode2: 0x301, advance: -0.03 }]);
		expect(extractGposKerning({ font: syntheticFont({ lookups: [lookup([kernsMark], { ignoreMarks: true })], gdef }), codePoints }).pairs)
			.toEqual([]);
	});

	it('fails on an adjustment the atlas cannot express', () => {
		const placement = { ...FORMAT_1, pairSets: [[{ secondGlyph: 2, value1: {}, value2: { xPlacement: -40 } }]] };
		expect(() => extractGposKerning({ font: syntheticFont({ lookups: [lookup([placement])] }), codePoints: LETTERS }))
			.toThrow(/cannot express/);
	});
});

describe('extractGposKerning: selection and order', () => {
	it('falls back to the DFLT script', () => {
		const { pairs } = extractGposKerning({
			font: syntheticFont({ lookups: [lookup([FORMAT_1])], script: 'DFLT' }),
			codePoints: LETTERS,
		});
		expect(pairs).toHaveLength(1);
	});

	it('says so when the face has no kern feature', () => {
		const font = syntheticFont({ lookups: [lookup([FORMAT_1])], kernLookups: [] });
		expect(extractGposKerning({ font, codePoints: LETTERS })).toEqual({ hasKernFeature: false, pairs: [], skippedLookups: [] });
		expect(extractGposKerning({ font: { ...font, GPOS: undefined }, codePoints: LETTERS }).hasKernFeature).toBe(false);
	});

	it('ignores code points the face lacks, duplicates, and input order', () => {
		const font = syntheticFont({ lookups: [lookup([FORMAT_1, FORMAT_2])] });
		const forward = extractGposKerning({ font, codePoints: LETTERS });
		const shuffled = extractGposKerning({ font, codePoints: [0x6F, 0x2603, 0x41, 0x54, 0x41, 0x56] });
		expect(shuffled).toEqual(forward);
	});
});

describe('extractGposKerning: committed faces', () => {
	function openFace(path: string): KerningFont {
		return fontkit.openSync(join(FONTS_DIR, path)) as unknown as KerningFont;
	}

	it('matches fontkit\'s own shaper for every letter pair in Barlow Condensed', () => {
		const font = fontkit.openSync(join(FONTS_DIR, 'barlow-condensed/BarlowCondensed-SemiBold.ttf')) as fontkit.Font;
		const letters: number[] = [];
		for (let cp = 0x41; cp <= 0x5A; cp++) letters.push(cp, cp + 0x20);
		const extracted = new Map(extractGposKerning({ font: font as unknown as KerningFont, codePoints: letters }).pairs
			.map((pair) => [`${pair.unicode1},${pair.unicode2}`, pair.advance * font.unitsPerEm]));

		let compared = 0;
		for (const left of letters) {
			for (const right of letters) {
				const run = font.layout(String.fromCodePoint(left, right));
				// A ligature or contextual substitution is not a pair of these two glyphs.
				if (run.glyphs.length !== 2 || run.glyphs[0].id !== font.glyphForCodePoint(left).id) continue;
				const shaped = run.positions[0].xAdvance - run.glyphs[0].advanceWidth;
				expect([String.fromCodePoint(left, right), extracted.get(`${left},${right}`) ?? 0])
					.toEqual([String.fromCodePoint(left, right), shaped]);
				compared++;
			}
		}
		expect(compared).toBeGreaterThan(2500);
		expect(extracted.size).toBeGreaterThan(300);
	});

	it('finds no kern feature in Open Sans 3.000 or JetBrains Mono', () => {
		for (const path of ['open-sans/OpenSans-Regular.ttf', 'jetbrains-mono/JetBrainsMono-Regular.ttf']) {
			expect(extractGposKerning({ font: openFace(path), codePoints: LETTERS }).hasKernFeature).toBe(false);
		}
	});
});
