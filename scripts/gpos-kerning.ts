/**
 * Pair kerning from a face's GPOS table, for the atlas JSON's `kerning[]`
 * (R6.2, R6.9). msdf-atlas-gen v1.4 reads only the legacy `kern` table, and
 * the faces we ship keep their kerning in GPOS, so without this step the
 * atlases carry no pairs.
 *
 * Reads the lookups the `kern` feature names for Latin text and applies GPOS
 * pair adjustment (lookup type 2, formats 1 and 2, directly or through a type 9
 * extension) the way a shaper does for two adjacent glyphs: lookups in list
 * order, adjustments summed across lookups, the first subtable that applies
 * winning within one. Contextual kerning has no per-pair form and is reported
 * as skipped rather than approximated.
 *
 * The font is fontkit's parse, read through the structural types below.
 * scripts/merge-kerning.mjs runs this under Node's type stripping, so the file
 * stays erasable syntax (no enums, namespaces or parameter properties) and
 * imports nothing at runtime.
 */

/** A restructure LazyArray, or a plain array. */
type ListOf<T> = readonly T[] | { readonly length: number; toArray(): T[] };

export interface ValueRecord {
	readonly xPlacement?: number;
	readonly yPlacement?: number;
	readonly xAdvance?: number;
	readonly yAdvance?: number;
}

export interface PairValue {
	readonly value1: ValueRecord;
	readonly value2: ValueRecord;
}

export type Coverage =
	| { readonly version: 1; readonly glyphs: readonly number[] }
	| { readonly version: 2; readonly rangeRecords: readonly { start: number; end: number; startCoverageIndex: number }[] };

export type ClassDef =
	| { readonly version: 1; readonly startGlyph: number; readonly classValueArray: readonly number[] }
	| { readonly version: 2; readonly classRangeRecord: readonly { start: number; end: number; class: number }[] };

export interface PairPosFormat1 {
	readonly version: 1;
	readonly coverage: Coverage;
	readonly pairSets: ListOf<ListOf<PairValue & { readonly secondGlyph: number }>>;
}

export interface PairPosFormat2 {
	readonly version: 2;
	readonly coverage: Coverage;
	readonly classDef1: ClassDef;
	readonly classDef2: ClassDef;
	readonly class1Count: number;
	readonly class2Count: number;
	readonly classRecords: ListOf<ListOf<PairValue>>;
}

export interface ExtensionSubtable {
	readonly lookupType: number;
	readonly extension: unknown;
}

export interface GposLookup {
	readonly lookupType: number;
	readonly flags: {
		readonly markAttachmentType: number;
		readonly flags: { readonly ignoreBaseGlyphs?: boolean; readonly ignoreLigatures?: boolean; readonly ignoreMarks?: boolean };
	};
	readonly subTables: ListOf<unknown>;
}

export interface LangSys {
	readonly reqFeatureIndex: number;
	readonly featureIndexes: readonly number[];
}

export interface KerningFont {
	readonly unitsPerEm: number;
	glyphForCodePoint(codePoint: number): { readonly id: number };
	readonly GPOS?: {
		readonly scriptList: readonly { readonly tag: string; readonly script: { readonly defaultLangSys: LangSys | null } }[];
		readonly featureList: readonly { readonly tag: string; readonly feature: { readonly lookupListIndexes: readonly number[] } }[];
		readonly lookupList: ListOf<GposLookup>;
	};
	readonly GDEF?: { readonly glyphClassDef?: ClassDef | null; readonly markAttachClassDef?: ClassDef | null };
}

export interface KerningPair {
	readonly unicode1: number;
	readonly unicode2: number;
	/** Added to the first glyph's advance, em. */
	readonly advance: number;
}

export interface SkippedLookup {
	readonly index: number;
	readonly lookupType: number;
}

export interface KerningResult {
	/** False when the face has no GPOS `kern` feature for Latin text; the caller keeps whatever the generator wrote. */
	readonly hasKernFeature: boolean;
	/** Sorted by unicode1, then unicode2. Pairs that net to zero are left out. */
	readonly pairs: KerningPair[];
	/** Kern lookups other than pair adjustment, which a per-pair table cannot express. */
	readonly skippedLookups: SkippedLookup[];
}

const LOOKUP_PAIR_ADJUSTMENT = 2;
const LOOKUP_EXTENSION = 9;

const GLYPH_CLASS_BASE = 1;
const GLYPH_CLASS_LIGATURE = 2;
const GLYPH_CLASS_MARK = 3;

/** DFLT is the fallback for a face with no Latin script record. */
const SCRIPT_PREFERENCE = ['latn', 'DFLT'];

/** LangSys `reqFeatureIndex` when there is no required feature. */
const NO_REQUIRED_FEATURE = 0xFFFF;

/** Resolves one pair within one subtable; null when the subtable does not apply, so the next is tried. */
type PairResolver = (left: number, right: number) => PairValue | null;

interface PairLookup {
	readonly index: number;
	readonly ignores: (glyph: number) => boolean;
	readonly subtables: readonly PairResolver[];
}

/**
 * Kerning for every ordered pair of `codePoints` the face maps to a glyph.
 * The code points are deduplicated and sorted, so the output depends only on
 * the face and the set, never on the order they came in.
 */
export function extractGposKerning({ font, codePoints }: { font: KerningFont; codePoints: Iterable<number> }): KerningResult {
	const found = kernLookups(font);
	if (found === null) return { hasKernFeature: false, pairs: [], skippedLookups: [] };

	const glyphs = [...new Set(codePoints)]
		.sort((a, b) => a - b)
		.map((codePoint) => ({ codePoint, glyph: font.glyphForCodePoint(codePoint).id }))
		.filter(({ glyph }) => glyph !== 0);

	const pairs: KerningPair[] = [];
	for (const left of glyphs) {
		for (const right of glyphs) {
			const units = pairAdjustment({ lookups: found.lookups, left: left.glyph, right: right.glyph });
			if (units !== 0) pairs.push({ unicode1: left.codePoint, unicode2: right.codePoint, advance: units / font.unitsPerEm });
		}
	}
	return { hasKernFeature: true, pairs, skippedLookups: found.skippedLookups };
}

function pairAdjustment({ lookups, left, right }: { lookups: readonly PairLookup[]; left: number; right: number }): number {
	let total = 0;
	for (const lookup of lookups) {
		if (lookup.ignores(left) || lookup.ignores(right)) continue;
		for (const resolve of lookup.subtables) {
			const value = resolve(left, right);
			if (value === null) continue;
			total += firstAdvance({ value, lookup: lookup.index, left, right });
			break;
		}
	}
	return total;
}

/**
 * The atlas models kerning as a change to the distance between two pen
 * positions, which is the first glyph's x advance and nothing else. A value
 * that moves a glyph any other way fails the build instead of being dropped.
 */
function firstAdvance({ value, lookup, left, right }: { value: PairValue; lookup: number; left: number; right: number }): number {
	const others = [
		value.value1.xPlacement, value.value1.yPlacement, value.value1.yAdvance,
		value.value2.xPlacement, value.value2.yPlacement, value.value2.xAdvance, value.value2.yAdvance,
	];
	if (others.some((adjustment) => adjustment !== undefined && adjustment !== 0)) {
		throw new Error(`GPOS lookup ${lookup} adjusts more than the first glyph's x advance for glyphs ${left}, ${right}; kerning[] cannot express that`);
	}
	return value.value1.xAdvance ?? 0;
}

function kernLookups(font: KerningFont): { lookups: PairLookup[]; skippedLookups: SkippedLookup[] } | null {
	const gpos = font.GPOS;
	if (!gpos) return null;

	const langSys = SCRIPT_PREFERENCE
		.map((tag) => gpos.scriptList.find((record) => record.tag === tag)?.script.defaultLangSys ?? null)
		.find((candidate) => candidate !== null);
	if (!langSys) return null;

	const featureIndexes = langSys.reqFeatureIndex === NO_REQUIRED_FEATURE
		? langSys.featureIndexes
		: [langSys.reqFeatureIndex, ...langSys.featureIndexes];
	const lookupIndexes = new Set<number>();
	for (const featureIndex of featureIndexes) {
		const feature = gpos.featureList[featureIndex];
		if (feature?.tag !== 'kern') continue;
		for (const index of feature.feature.lookupListIndexes) lookupIndexes.add(index);
	}
	if (lookupIndexes.size === 0) return null;

	const lookupList = toArray(gpos.lookupList);
	const lookups: PairLookup[] = [];
	const skippedLookups: SkippedLookup[] = [];
	for (const index of [...lookupIndexes].sort((a, b) => a - b)) {
		const lookup = lookupList[index];
		let lookupType = lookup.lookupType;
		const subtables: PairResolver[] = [];
		for (const raw of toArray(lookup.subTables)) {
			let subtable = raw;
			if (lookup.lookupType === LOOKUP_EXTENSION) {
				lookupType = (raw as ExtensionSubtable).lookupType;
				subtable = (raw as ExtensionSubtable).extension;
			}
			if (lookupType === LOOKUP_PAIR_ADJUSTMENT) subtables.push(pairResolver(subtable as PairPosFormat1 | PairPosFormat2));
		}
		if (lookupType !== LOOKUP_PAIR_ADJUSTMENT) {
			skippedLookups.push({ index, lookupType });
			continue;
		}
		lookups.push({ index, subtables, ignores: glyphFilter({ lookup, gdef: font.GDEF }) });
	}
	return { lookups, skippedLookups };
}

/** Decodes a subtable once into lookups keyed by glyph, instead of walking restructure's lazy arrays per pair. */
function pairResolver(subtable: PairPosFormat1 | PairPosFormat2): PairResolver {
	const covered = coverageGlyphs(subtable.coverage);
	if (subtable.version === 1) {
		const pairSets = toArray(subtable.pairSets);
		const byFirst = new Map<number, Map<number, PairValue>>();
		covered.forEach((glyph, coverageIndex) => {
			const seconds = new Map<number, PairValue>();
			for (const pair of toArray(pairSets[coverageIndex])) {
				// A shaper takes the first record for a second glyph.
				if (!seconds.has(pair.secondGlyph)) seconds.set(pair.secondGlyph, pair);
			}
			byFirst.set(glyph, seconds);
		});
		return (left, right) => byFirst.get(left)?.get(right) ?? null;
	}
	if (subtable.version === 2) {
		const firsts = new Set(covered);
		const records = toArray(subtable.classRecords).map((row) => toArray(row));
		const { classDef1, classDef2, class1Count, class2Count } = subtable;
		return (left, right) => {
			if (!firsts.has(left)) return null;
			const class1 = classOf(classDef1, left);
			const class2 = classOf(classDef2, right);
			return class1 < class1Count && class2 < class2Count ? records[class1][class2] : null;
		};
	}
	throw new Error(`Unknown GPOS pair adjustment format ${(subtable as { version: unknown }).version}`);
}

/**
 * A lookup never sees the glyphs its flags skip, so a shaper would kern across
 * them to the next glyph; as an isolated pair that is no kerning at all.
 */
function glyphFilter({ lookup, gdef }: { lookup: GposLookup; gdef: KerningFont['GDEF'] }): (glyph: number) => boolean {
	const { markAttachmentType, flags } = lookup.flags;
	const glyphClassDef = gdef?.glyphClassDef ?? null;
	const markAttachClassDef = gdef?.markAttachClassDef ?? null;
	if (!glyphClassDef) return () => false;
	return (glyph) => {
		const glyphClass = classOf(glyphClassDef, glyph);
		if (glyphClass === GLYPH_CLASS_BASE) return flags.ignoreBaseGlyphs === true;
		if (glyphClass === GLYPH_CLASS_LIGATURE) return flags.ignoreLigatures === true;
		if (glyphClass !== GLYPH_CLASS_MARK) return false;
		if (flags.ignoreMarks === true) return true;
		return markAttachmentType !== 0 && markAttachClassDef !== null && classOf(markAttachClassDef, glyph) !== markAttachmentType;
	};
}

/** Covered glyphs in coverage-index order. */
function coverageGlyphs(coverage: Coverage): number[] {
	if (coverage.version === 1) return [...coverage.glyphs];
	const glyphs: number[] = [];
	for (const range of coverage.rangeRecords) {
		for (let glyph = range.start; glyph <= range.end; glyph++) glyphs[range.startCoverageIndex + glyph - range.start] = glyph;
	}
	return glyphs;
}

/** A glyph the definition does not list is class 0. */
function classOf(classDef: ClassDef, glyph: number): number {
	if (classDef.version === 1) {
		const offset = glyph - classDef.startGlyph;
		return offset >= 0 && offset < classDef.classValueArray.length ? classDef.classValueArray[offset] : 0;
	}
	for (const range of classDef.classRangeRecord) {
		if (glyph >= range.start && glyph <= range.end) return range.class;
	}
	return 0;
}

function toArray<T>(list: ListOf<T>): readonly T[] {
	return Array.isArray(list) ? list : (list as { toArray(): T[] }).toArray();
}
