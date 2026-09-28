/**
 * The validated, normalised form of one msdf-atlas-gen metrics file (R6.2).
 *
 * The schema is msdf-atlas-gen's JSON and nothing else; a generator with a
 * different format goes through a converter first, so this is the one shape
 * validated. Everything is normalised on the way in so that no consumer has to
 * know which `yOrigin` or `emSize` the file was written with:
 *
 * - lengths are per em (divided by `metrics.emSize`);
 * - y points down, matching the engine's logical pixels: plane bounds are
 *   relative to the pen position on the baseline, so a glyph above the
 *   baseline has a negative top; atlas bounds are texels from the image's
 *   top-left corner;
 * - `ascender` and `descender` are both positive distances from the baseline.
 *
 * Importable without a DOM (R14.1): this module never touches an image.
 */

export type DistanceFieldType = 'msdf' | 'mtsdf' | 'sdf' | 'psdf';

const DISTANCE_FIELD_TYPES: readonly DistanceFieldType[] = ['msdf', 'mtsdf', 'sdf', 'psdf'];

/**
 * R6.4a: `pxrange / emSize` of at least 1/6, which keeps the screen-space range
 * at 2 device pixels for 12 px text at ratio 1. Checked here as well as in the
 * build script's flags so an atlas regenerated with other parameters fails on
 * load rather than rendering soft small text.
 */
export const MIN_RANGE_TO_SIZE_RATIO = 1 / 6;

export interface GlyphBounds {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface FontGlyph {
	readonly codePoint: number;
	/** Horizontal pen advance, em. */
	readonly advance: number;
	/** Quad placement, em, y down, relative to the pen on the baseline. Null for a blank glyph. */
	readonly plane: GlyphBounds | null;
	/** Texels in the atlas image, y down from the top-left corner. Null for a blank glyph. */
	readonly atlas: GlyphBounds | null;
}

export interface FontMetrics {
	/** The file's em size before normalisation; everything below is already divided by it. */
	readonly emSize: number;
	readonly lineHeight: number;
	/** Distance above the baseline, positive. */
	readonly ascender: number;
	/** Distance below the baseline, positive. */
	readonly descender: number;
	/** Underline centre, y down from the baseline. Null when the file has none. */
	readonly underlineY: number | null;
	readonly underlineThickness: number | null;
}

export class FontAtlasError extends Error {
	constructor(source: string, problem: string) {
		super(`Font atlas ${source}: ${problem}`);
		this.name = 'FontAtlasError';
	}
}

/**
 * Widths of the typographic spaces, for a face that lacks them (JetBrains Mono
 * and Barlow Condensed carry none). Each is synthesized as a blank glyph of its
 * defined width rather than copied from U+0020, since the point of an em or
 * figure space is its width: `em` is a fraction of the em, `glyph` borrows the
 * advance of another code point (figure space is a digit wide, punctuation
 * space a full stop). Thin and hair space have no single standard; these are
 * the common typesetting values.
 */
export const SPACE_WIDTHS: ReadonlyMap<number, { readonly em: number } | { readonly glyph: number }> = new Map([
	[0x2002, { em: 1 / 2 }],
	[0x2003, { em: 1 }],
	[0x2004, { em: 1 / 3 }],
	[0x2005, { em: 1 / 4 }],
	[0x2006, { em: 1 / 6 }],
	[0x2007, { glyph: 0x0030 }],
	[0x2008, { glyph: 0x002E }],
	[0x2009, { em: 1 / 5 }],
	[0x200A, { em: 1 / 10 }],
]);

/**
 * Stand-ins for visible code points the charset asks for but a face does not
 * carry, tried in order, used only when the face lacks the code point itself.
 * Each is the glyph a typesetter would substitute (a non-breaking hyphen is a
 * hyphen that does not break; breaking is the wrap's business, R6.13, not the
 * glyph's). Without these the R6.3 punctuation would render as the fallback
 * glyph in faces that simply omit it: Open Sans 3.000 has no U+2010. Barlow
 * Condensed has no U+FFFD either, which R6.3 lets fall back to `?`.
 */
export const CODE_POINT_SUBSTITUTES: ReadonlyMap<number, readonly number[]> = new Map([
	[0x2010, [0x002D]],
	[0x2011, [0x2010, 0x002D]],
	[0x2012, [0x2013]],
	[0x2015, [0x2014]],
	[0x201B, [0x2018]],
	[0x201F, [0x201D]],
	[0x202F, [0x2009, 0x00A0]],
	[0xFFFD, [0x003F]],
]);

/**
 * Format characters that must occupy no space whatever the face says. They are
 * break controls for the wrap (R6.13), never visible; JetBrains Mono gives
 * U+200B a full cell advance, which would open a gap at every zero-width space.
 * Present or absent in the face, each resolves to a blank zero-advance glyph.
 */
export const ZERO_WIDTH_CODE_POINTS: readonly number[] = [0x200B, 0x2060, 0xFEFF];

export type FontAtlasWarn = (message: string) => void;

interface FontAtlasOptions {
	name: string | null;
	type: DistanceFieldType;
	distanceRange: number;
	distanceRangeMiddle: number;
	size: number;
	width: number;
	height: number;
	metrics: FontMetrics;
	glyphs: Map<number, FontGlyph>;
	kerning: Map<number, number>;
}

export class FontAtlas {
	readonly name: string | null;
	readonly type: DistanceFieldType;
	/** Distance range in atlas texels (msdf-atlas-gen's `distanceRange`, the `-pxrange` flag). */
	readonly distanceRange: number;
	readonly distanceRangeMiddle: number;
	/** Atlas texels per em (the `-size` flag). */
	readonly size: number;
	readonly width: number;
	readonly height: number;
	readonly metrics: FontMetrics;
	private readonly glyphs: Map<number, FontGlyph>;
	private readonly kerningPairs: Map<number, number>;

	constructor({
		name,
		type,
		distanceRange,
		distanceRangeMiddle,
		size,
		width,
		height,
		metrics,
		glyphs,
		kerning,
	}: FontAtlasOptions) {
		this.name = name;
		this.type = type;
		this.distanceRange = distanceRange;
		this.distanceRangeMiddle = distanceRangeMiddle;
		this.size = size;
		this.width = width;
		this.height = height;
		this.metrics = metrics;
		this.glyphs = glyphs;
		this.kerningPairs = kerning;
	}

	get glyphCount(): number {
		return this.glyphs.size;
	}

	get codePoints(): IterableIterator<number> {
		return this.glyphs.keys();
	}

	get kerningPairCount(): number {
		return this.kerningPairs.size;
	}

	/** Undefined when neither the face nor a substitute covers the code point; the fallback glyph policy (R6.3) is the caller's. */
	glyph(codePoint: number): FontGlyph | undefined {
		return this.glyphs.get(codePoint);
	}

	/** Extra advance between a pair, em; 0 when the pair is not kerned. */
	kerning(left: number, right: number): number {
		return this.kerningPairs.get(kerningKey(left, right)) ?? 0;
	}
}

const CODE_POINT_LIMIT = 0x110000;

function kerningKey(left: number, right: number): number {
	return left * CODE_POINT_LIMIT + right;
}

interface ParseFontAtlasOptions {
	/** The parsed JSON, untrusted. */
	json: unknown;
	/** Names the file in errors and warnings. */
	source: string;
	/** Receives one message per dropped glyph or kerning pair. Defaults to console.warn. */
	warn?: FontAtlasWarn;
}

/**
 * R6.2's validation on load. Structural problems (a missing section, a field of
 * the wrong type, an unknown `yOrigin`, a range below R6.4a) throw
 * `FontAtlasError`, because an atlas that cannot be read is a build defect, not
 * something to render around. A single bad glyph is dropped with a warning
 * instead, so the text falls back to the fallback glyph (R6.3) rather than to
 * a full-cell quad that samples its neighbours, which is the worldsim bug R6.2
 * names.
 *
 * A glyph with neither bounds is a blank glyph (a space: advance only, nothing
 * to draw) and is kept; msdf-atlas-gen writes every whitespace glyph that way.
 * A glyph with only one of the two is malformed and is dropped.
 */
export function parseFontAtlas({ json, source, warn = defaultWarn }: ParseFontAtlasOptions): FontAtlas {
	const fail = (problem: string): never => {
		throw new FontAtlasError(source, problem);
	};

	const root = asRecord(json) ?? fail('not a JSON object');
	const atlas = asRecord(root.atlas) ?? fail('missing "atlas"');
	const metrics = asRecord(root.metrics) ?? fail('missing "metrics"');
	if (!Array.isArray(root.glyphs)) fail('missing "glyphs" array');
	if (!Array.isArray(root.kerning)) fail('missing "kerning" array');

	const type = atlas.type;
	if (typeof type !== 'string' || !DISTANCE_FIELD_TYPES.includes(type as DistanceFieldType)) {
		fail(`atlas.type must be one of ${DISTANCE_FIELD_TYPES.join(', ')}, got ${JSON.stringify(type)}`);
	}
	const size = positiveNumber(atlas.size) ?? fail('atlas.size must be a positive number');
	const width = positiveInteger(atlas.width) ?? fail('atlas.width must be a positive integer');
	const height = positiveInteger(atlas.height) ?? fail('atlas.height must be a positive integer');
	const distanceRange = positiveNumber(atlas.distanceRange) ?? fail('atlas.distanceRange must be a positive number');
	const distanceRangeMiddle = finiteNumber(atlas.distanceRangeMiddle)
		?? fail('atlas.distanceRangeMiddle must be a number');
	const yOrigin = atlas.yOrigin;
	if (yOrigin !== 'top' && yOrigin !== 'bottom') {
		fail(`atlas.yOrigin must be "top" or "bottom", got ${JSON.stringify(yOrigin)}`);
	}
	if (distanceRange / size < MIN_RANGE_TO_SIZE_RATIO) {
		fail(`distanceRange ${distanceRange} over size ${size} is below R6.4a's minimum ratio of 1/6`);
	}

	const emSize = positiveNumber(metrics.emSize) ?? fail('metrics.emSize must be a positive number');
	const lineHeight = positiveNumber(metrics.lineHeight) ?? fail('metrics.lineHeight must be a positive number');
	const rawAscender = finiteNumber(metrics.ascender) ?? fail('metrics.ascender must be a number');
	const rawDescender = finiteNumber(metrics.descender) ?? fail('metrics.descender must be a number');
	const rawUnderlineY = finiteNumber(metrics.underlineY);
	const rawUnderlineThickness = finiteNumber(metrics.underlineThickness);

	// y down is the normalised convention; a bottom-origin file is flipped.
	const flip = yOrigin === 'bottom' ? -1 : 1;

	const normalisedMetrics: FontMetrics = {
		emSize,
		lineHeight: lineHeight / emSize,
		ascender: (-flip * rawAscender) / emSize,
		descender: (flip * rawDescender) / emSize,
		underlineY: rawUnderlineY === null ? null : (flip * rawUnderlineY) / emSize,
		underlineThickness: rawUnderlineThickness === null ? null : rawUnderlineThickness / emSize,
	};

	const glyphs = new Map<number, FontGlyph>();
	(root.glyphs as unknown[]).forEach((entry, index) => {
		const glyph = parseGlyph({ entry, flip, emSize, width, height });
		if (typeof glyph === 'string') {
			warn(`Font atlas ${source}: dropped glyphs[${index}]: ${glyph}`);
			return;
		}
		if (glyphs.has(glyph.codePoint)) {
			warn(`Font atlas ${source}: dropped glyphs[${index}]: duplicate code point U+${hex(glyph.codePoint)}`);
			return;
		}
		glyphs.set(glyph.codePoint, glyph);
	});

	const kerning = new Map<number, number>();
	(root.kerning as unknown[]).forEach((entry, index) => {
		const pair = asRecord(entry);
		const left = pair ? codePoint(pair.unicode1) : null;
		const right = pair ? codePoint(pair.unicode2) : null;
		const advance = pair ? finiteNumber(pair.advance) : null;
		if (left === null || right === null || advance === null) {
			warn(`Font atlas ${source}: dropped kerning[${index}]: needs unicode1, unicode2 and advance`);
			return;
		}
		kerning.set(kerningKey(left, right), advance / emSize);
	});

	applySubstitutes(glyphs);

	return new FontAtlas({
		name: typeof root.name === 'string' ? root.name : null,
		type: type as DistanceFieldType,
		distanceRange,
		distanceRangeMiddle,
		size,
		width,
		height,
		metrics: normalisedMetrics,
		glyphs,
		kerning,
	});
}

interface ParseGlyphOptions {
	entry: unknown;
	flip: number;
	emSize: number;
	width: number;
	height: number;
}

/** A glyph, or the reason it was dropped. */
function parseGlyph({ entry, flip, emSize, width, height }: ParseGlyphOptions): FontGlyph | string {
	const glyph = asRecord(entry);
	if (!glyph) return 'not an object';
	const cp = codePoint(glyph.unicode);
	if (cp === null) return 'unicode must be a code point';
	const advance = finiteNumber(glyph.advance);
	if (advance === null) return `U+${hex(cp)} has no advance`;

	const hasPlane = glyph.planeBounds !== undefined;
	const hasAtlas = glyph.atlasBounds !== undefined;
	if (!hasPlane && !hasAtlas) {
		return { codePoint: cp, advance: advance / emSize, plane: null, atlas: null };
	}
	if (!hasPlane || !hasAtlas) {
		return `U+${hex(cp)} has ${hasPlane ? 'planeBounds' : 'atlasBounds'} but not ${hasPlane ? 'atlasBounds' : 'planeBounds'}`;
	}

	const rawPlane = bounds(glyph.planeBounds);
	const rawAtlas = bounds(glyph.atlasBounds);
	if (!rawPlane) return `U+${hex(cp)} has malformed planeBounds`;
	if (!rawAtlas) return `U+${hex(cp)} has malformed atlasBounds`;

	const plane: GlyphBounds = {
		left: rawPlane.left / emSize,
		right: rawPlane.right / emSize,
		top: (flip * rawPlane.top) / emSize,
		bottom: (flip * rawPlane.bottom) / emSize,
	};
	const atlas: GlyphBounds = flip === 1
		? rawAtlas
		: { left: rawAtlas.left, right: rawAtlas.right, top: height - rawAtlas.top, bottom: height - rawAtlas.bottom };

	if (plane.left > plane.right || plane.top > plane.bottom) {
		return `U+${hex(cp)} has inverted planeBounds`;
	}
	if (atlas.left > atlas.right || atlas.top > atlas.bottom) {
		return `U+${hex(cp)} has inverted atlasBounds`;
	}
	if (atlas.left < 0 || atlas.top < 0 || atlas.right > width || atlas.bottom > height) {
		return `U+${hex(cp)} atlasBounds fall outside the ${width}x${height} atlas`;
	}

	return { codePoint: cp, advance: advance / emSize, plane, atlas };
}

function applySubstitutes(glyphs: Map<number, FontGlyph>): void {
	// Spaces first, so U+202F can fall back to a synthesized thin space.
	for (const [target, width] of SPACE_WIDTHS) {
		if (glyphs.has(target)) continue;
		const advance = 'em' in width ? width.em : glyphs.get(width.glyph)?.advance;
		if (advance !== undefined) glyphs.set(target, { codePoint: target, advance, plane: null, atlas: null });
	}
	// Resolved in insertion order so a substitute may itself be substituted
	// (U+2011 tries U+2010, which a face may only have through U+002D).
	for (const [target, candidates] of CODE_POINT_SUBSTITUTES) {
		if (glyphs.has(target)) continue;
		for (const candidate of candidates) {
			const source = glyphs.get(candidate);
			if (source) {
				glyphs.set(target, { ...source, codePoint: target });
				break;
			}
		}
	}
	for (const cp of ZERO_WIDTH_CODE_POINTS) {
		glyphs.set(cp, { codePoint: cp, advance: 0, plane: null, atlas: null });
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
	const number = finiteNumber(value);
	return number !== null && number > 0 ? number : null;
}

function positiveInteger(value: unknown): number | null {
	const number = positiveNumber(value);
	return number !== null && Number.isInteger(number) ? number : null;
}

function codePoint(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < CODE_POINT_LIMIT
		? value
		: null;
}

function bounds(value: unknown): GlyphBounds | null {
	const record = asRecord(value);
	if (!record) return null;
	const left = finiteNumber(record.left);
	const top = finiteNumber(record.top);
	const right = finiteNumber(record.right);
	const bottom = finiteNumber(record.bottom);
	if (left === null || top === null || right === null || bottom === null) return null;
	return { left, top, right, bottom };
}

function hex(cp: number): string {
	return cp.toString(16).toUpperCase().padStart(4, '0');
}

function defaultWarn(message: string): void {
	console.warn(message);
}
