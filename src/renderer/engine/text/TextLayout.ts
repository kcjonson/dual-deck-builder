import type { TextOverflow, TextTransform, TextWrap } from '../draw/commands';
import type { FontAtlas, FontGlyph } from './FontAtlas';

/**
 * Chapter 6's glyph iteration: one walk over a string that places every glyph,
 * breaks lines, and truncates, and that both measurement and rendering read
 * (R6.8). Nothing here draws or measures on its own terms; `measureText`
 * summarises a `TextLayout` and the encoder writes quads from the same one, so
 * the two cannot disagree about an advance, a kerning pair, a letter space or
 * a break.
 *
 * Units: logical pixels, x from the start of each line, glyph plane bounds
 * relative to the pen on the baseline (y down), as `FontAtlas` normalises them.
 * Where a line sits in a box is `textPlacement.ts`'s business, not this file's.
 *
 * What the iteration does, in order:
 * - R6.9's transform (uppercase) before anything is looked up, so measurement
 *   and rendering see the same code points;
 * - a hard newline always breaks (R6.13); a carriage return is dropped;
 * - U+0009 advances as a space;
 * - default-ignorable code points (soft hyphen, zero-width space, word joiner,
 *   BOM) place no glyph, take no letter spacing, and do not interrupt kerning:
 *   their neighbours are kerned across them, as HarfBuzz does. A soft hyphen
 *   is a break opportunity, and when a line breaks there its hyphen glyph is
 *   shown at the line end, kerned against the glyph before it (Barlow carries
 *   32 such pairs, which are only right in that position);
 * - a code point the atlas does not cover renders and measures as U+FFFD, or
 *   `?` in a face without it (R6.3), never as nothing;
 * - kerning (R6.9) from the atlas's pairs, keyed on the glyphs' code points;
 * - letter spacing between glyphs only, never after the last on a line.
 */

/** R6.9's letter spacing is in em, like the `letterSpacing` tokens; a request scales it by `size`. */
export interface TextLayoutRequest {
	text: string;
	font: string;
	/** Logical pixels (R6.10). */
	size: number;
	/** Em, added between glyphs. */
	letterSpacing?: number;
	textTransform?: TextTransform;
	wrap?: TextWrap;
	overflow?: TextOverflow;
	/** The wrap width, and the width an ellipsis truncates to. Null or absent is unbounded. */
	maxWidth?: number | null;
	/** The box height R6.14's ellipsis truncates wrapped lines to. Null or absent is unbounded. */
	maxHeight?: number | null;
	/** Line height as a multiple of `size`; absent is the face's own (R6.10). */
	lineHeight?: number | null;
}

export interface LaidOutGlyph {
	readonly glyph: FontGlyph;
	/** Pen x of this glyph, from the start of its line, logical pixels. */
	readonly x: number;
}

export interface TextLine {
	/** Every glyph placed on the line, blanks included; `glyph.plane` is null for a blank. */
	readonly glyphs: readonly LaidOutGlyph[];
	/**
	 * The line's advance width: the pen after its last glyph, without the
	 * spaces a soft break leaves hanging at its end.
	 */
	readonly width: number;
	/** The line ends at a soft hyphen, whose hyphen glyph is its last. */
	readonly hyphenated: boolean;
}

export interface TextLayout {
	readonly atlas: FontAtlas;
	readonly size: number;
	readonly lines: readonly TextLine[];
	/** The widest line (R6.13). */
	readonly width: number;
	/** `lines * lineHeight` (R6.13). */
	readonly height: number;
	/** Pixels between baselines. */
	readonly lineHeight: number;
	/** The face's ascender and descender at this size, both positive (R6.11). */
	readonly ascent: number;
	readonly descent: number;
	/**
	 * R2.14's caret positions: for each code point of the transformed text, the
	 * pen x within its line after it. An ignorable code point repeats the pen
	 * before it; a newline, and a space dropped at a break, read as the start
	 * of the line that follows.
	 */
	readonly advances: readonly number[];
	/** Glyphs with an image, which is one quad each. */
	readonly quadCount: number;
	/** Whether R6.14's ellipsis cut anything. */
	readonly truncated: boolean;
}

const TAB = 0x09;
const LINE_FEED = 0x0A;
const CARRIAGE_RETURN = 0x0D;
const SPACE = 0x20;
const HYPHEN_MINUS = 0x2D;
const QUESTION_MARK = 0x3F;
const SOFT_HYPHEN = 0xAD;
const HYPHEN = 0x2010;
const ZERO_WIDTH_SPACE = 0x200B;
const WORD_JOINER = 0x2060;
const BYTE_ORDER_MARK = 0xFEFF;
const ELLIPSIS = 0x2026;
const REPLACEMENT = 0xFFFD;

/** Placed nowhere and kerned across. */
const IGNORABLE = new Set([SOFT_HYPHEN, ZERO_WIDTH_SPACE, WORD_JOINER, BYTE_ORDER_MARK, CARRIAGE_RETURN]);

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** R6.13's scripts written without spaces, which break between grapheme clusters. */
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/** One code point of a paragraph, resolved against the atlas. */
interface Item {
	readonly codePoint: number;
	/** Null for an ignorable, which places nothing. */
	readonly glyph: FontGlyph | null;
	/** A break may follow this code point (R6.13). */
	readonly breakAfter: boolean;
	/** Hangs at a soft break and is dropped at the start of a continuation line. */
	readonly space: boolean;
}

/** Where a line may end, and what it measures if it does. */
interface BreakCandidate {
	/** Index of the item the break follows. */
	index: number;
	/** Glyphs placed on the line up to and including `index`. */
	glyphCount: number;
	/** The line's width if it breaks here. */
	width: number;
	/** The hyphen glyph a soft hyphen shows at the line end, and its pen x. */
	hyphen: LaidOutGlyph | null;
}

/**
 * The pen of R6.8: advance, kerning and letter spacing, in the one place they
 * are added. `place` returns the glyph's x.
 */
class Pen {
	x = 0;
	/** Pen after the last glyph that is not a hanging space. */
	inkWidth = 0;
	private previous = -1;
	private count = 0;

	constructor(
		private readonly atlas: FontAtlas,
		readonly size: number,
		private readonly spacing: number,
	) {}

	reset(): void {
		this.x = 0;
		this.inkWidth = 0;
		this.previous = -1;
		this.count = 0;
	}

	/** Where `glyph` would go next, without placing it. */
	peek(glyph: FontGlyph): number {
		if (this.count === 0) return this.x;
		return this.x + this.spacing + this.atlas.kerning(this.previous, glyph.codePoint) * this.size;
	}

	place(glyph: FontGlyph, space: boolean): number {
		const x = this.peek(glyph);
		this.x = x + glyph.advance * this.size;
		if (!space) this.inkWidth = this.x;
		this.previous = glyph.codePoint;
		this.count += 1;
		return x;
	}
}

/**
 * Lays out `request` against `atlas`. Pure: the same request and atlas give
 * the same layout, which is what lets `TextMetricsService` cache it.
 */
export function layoutText(atlas: FontAtlas, request: TextLayoutRequest): TextLayout {
	const size = request.size;
	const transformed = request.textTransform === 'uppercase' ? request.text.toUpperCase() : request.text;
	const codePoints = Array.from(transformed, (char) => char.codePointAt(0) as number);
	const lineHeight = (request.lineHeight ?? atlas.metrics.lineHeight) * size;
	const wrapWidth = request.wrap === 'word' ? positiveOrInfinity(request.maxWidth) : Infinity;
	const ellipsis = request.overflow === 'ellipsis';

	const pen = new Pen(atlas, size, (request.letterSpacing ?? 0) * size);
	const fallback = atlas.glyph(REPLACEMENT) ?? atlas.glyph(QUESTION_MARK) ?? null;
	const lines: TextLine[] = [];
	const advances = new Array<number>(codePoints.length).fill(0);

	let paragraphStart = 0;
	for (let index = 0; index <= codePoints.length; index++) {
		if (index < codePoints.length && codePoints[index] !== LINE_FEED) continue;
		const items = resolveItems(atlas, fallback, codePoints, paragraphStart, index);
		breakParagraph({ items, offset: paragraphStart, pen, wrapWidth, atlas, lines, advances });
		paragraphStart = index + 1;
	}

	let truncated = false;
	if (ellipsis) {
		const maxWidth = positiveOrInfinity(request.maxWidth);
		const maxLines = request.wrap === 'word' && request.maxHeight !== null && request.maxHeight !== undefined
			? Math.max(1, Math.floor(request.maxHeight / lineHeight + 1e-6))
			: Infinity;
		if (lines.length > maxLines) {
			lines.length = maxLines;
			lines[maxLines - 1] = truncateLine({ line: lines[maxLines - 1], maxWidth, atlas, pen, force: true });
			truncated = true;
		}
		for (let line = 0; line < lines.length; line++) {
			if (lines[line].width > maxWidth + EPSILON) {
				lines[line] = truncateLine({ line: lines[line], maxWidth, atlas, pen, force: false });
				truncated = true;
			}
		}
	}

	let width = 0;
	let quadCount = 0;
	for (const line of lines) {
		width = Math.max(width, line.width);
		for (const placed of line.glyphs) if (placed.glyph.plane) quadCount += 1;
	}

	return {
		atlas,
		size,
		lines,
		width,
		height: lines.length * lineHeight,
		lineHeight,
		ascent: atlas.metrics.ascender * size,
		descent: atlas.metrics.descender * size,
		advances,
		quadCount,
		truncated,
	};
}

/** Floating-point slack on a fit test, so a string measured at exactly the box width fits it. */
const EPSILON = 1e-6;

function positiveOrInfinity(value: number | null | undefined): number {
	return value === null || value === undefined || !(value >= 0) ? Infinity : value;
}

function resolveItems(
	atlas: FontAtlas,
	fallback: FontGlyph | null,
	codePoints: readonly number[],
	start: number,
	end: number,
): Item[] {
	const graphemeBreaks = noSpaceBreaks(codePoints, start, end);
	const items: Item[] = [];
	for (let index = start; index < end; index++) {
		const codePoint = codePoints[index];
		const next = index + 1 < end ? codePoints[index + 1] : -1;
		const ignorable = IGNORABLE.has(codePoint);
		const glyph = ignorable
			? null
			: atlas.glyph(codePoint === TAB ? SPACE : codePoint) ?? fallback;
		items.push({
			codePoint,
			glyph,
			breakAfter: breaksAfter(codePoint, next) || (graphemeBreaks?.has(index + 1) ?? false),
			space: codePoint === SPACE || codePoint === TAB,
		});
	}
	return items;
}

/** R6.13's normative break opportunities, plus the soft hyphen. */
function breaksAfter(codePoint: number, next: number): boolean {
	switch (codePoint) {
		case SPACE:
		case TAB:
		case ZERO_WIDTH_SPACE:
		case SOFT_HYPHEN:
			return true;
		case HYPHEN_MINUS:
		case HYPHEN:
			return next >= 0 && LETTER_OR_DIGIT.test(String.fromCodePoint(next));
		default:
			return false;
	}
}

/**
 * Grapheme cluster boundaries inside runs of scripts written without spaces
 * (R6.13's SHOULD), as indices a break may precede. Null for the usual
 * paragraph, which has none of those scripts and never pays for a segmenter.
 * `Intl.Segmenter` supplies the clusters only; it is never the source of the
 * other break opportunities, which it would get wrong (R6.13).
 */
function noSpaceBreaks(codePoints: readonly number[], start: number, end: number): Set<number> | null {
	let found = false;
	for (let index = start; index < end && !found; index++) {
		found = NO_SPACE_SCRIPT.test(String.fromCodePoint(codePoints[index]));
	}
	if (!found) return null;

	const text = String.fromCodePoint(...codePoints.slice(start, end));
	const boundaries: number[] = [];
	if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
		// Segment indices are UTF-16 offsets; convert to code point indices.
		const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
		let codeUnit = 0;
		let codePoint = start;
		for (const { index } of segmenter.segment(text)) {
			while (codeUnit < index) {
				codeUnit += (codePoints[codePoint] as number) > 0xFFFF ? 2 : 1;
				codePoint += 1;
			}
			boundaries.push(codePoint);
		}
	} else {
		for (let index = start; index < end; index++) {
			if (!/\p{M}/u.test(String.fromCodePoint(codePoints[index]))) boundaries.push(index);
		}
	}

	const breaks = new Set<number>();
	for (const boundary of boundaries) {
		if (boundary <= start || boundary >= end) continue;
		const before = String.fromCodePoint(codePoints[boundary - 1]);
		const after = String.fromCodePoint(codePoints[boundary]);
		if (NO_SPACE_SCRIPT.test(before) || NO_SPACE_SCRIPT.test(after)) breaks.add(boundary);
	}
	return breaks;
}

interface BreakParagraphOptions {
	items: readonly Item[];
	/** Index of the paragraph's first code point in the whole text. */
	offset: number;
	pen: Pen;
	wrapWidth: number;
	atlas: FontAtlas;
	lines: TextLine[];
	advances: number[];
}

/**
 * R6.13's greedy fill over one paragraph. The pen that decides where a line
 * breaks is the pen that places its glyphs: a line is the prefix of what was
 * placed while scanning it, so the widths the break decision compared are the
 * widths the line is drawn at. After a break the pen restarts at the next
 * line's first code point, with no kerning carried across the break.
 */
function breakParagraph({ items, offset, pen, wrapWidth, atlas, lines, advances }: BreakParagraphOptions): void {
	const softHyphenGlyph = atlas.glyph(SOFT_HYPHEN) ?? atlas.glyph(HYPHEN_MINUS) ?? null;
	let start = 0;
	let continuation = false;

	do {
		// Leading spaces on a continuation line are dropped (R6.13); their caret
		// position is the new line's start.
		if (continuation) {
			while (start < items.length && items[start].space) advances[offset + start++] = 0;
		}

		pen.reset();
		const placed: LaidOutGlyph[] = [];
		const candidates: BreakCandidate[] = [];
		let chosen: BreakCandidate | null = null;
		let index = start;

		for (; index < items.length; index++) {
			const item = items[index];
			if (item.glyph) {
				const x = pen.place(item.glyph, item.space);
				placed.push({ glyph: item.glyph, x });
				if (!item.space && pen.x > wrapWidth + EPSILON && candidates.length > 0) {
					chosen = choose(candidates, wrapWidth);
					break;
				}
			}
			if (item.breakAfter && index + 1 < items.length) {
				candidates.push(candidate({ index, item, pen, placed, softHyphenGlyph }));
			}
		}

		if (chosen) {
			const glyphs = placed.slice(0, chosen.glyphCount);
			if (chosen.hyphen) glyphs.push(chosen.hyphen);
			lines.push({ glyphs, width: chosen.width, hyphenated: chosen.hyphen !== null });
			writeAdvances({ items, offset, start, end: chosen.index + 1, placed, advances, size: pen.size });
			start = chosen.index + 1;
			continuation = true;
		} else {
			lines.push({ glyphs: placed, width: pen.x, hyphenated: false });
			writeAdvances({ items, offset, start, end: items.length, placed, advances, size: pen.size });
			start = items.length;
		}
	} while (start < items.length);
}

function candidate({ index, item, pen, placed, softHyphenGlyph }: {
	index: number;
	item: Item;
	pen: Pen;
	placed: readonly LaidOutGlyph[];
	softHyphenGlyph: FontGlyph | null;
}): BreakCandidate {
	if (item.codePoint === SOFT_HYPHEN && softHyphenGlyph) {
		const x = pen.peek(softHyphenGlyph);
		return {
			index,
			glyphCount: placed.length,
			width: x + softHyphenGlyph.advance * pen.size,
			hyphen: { glyph: softHyphenGlyph, x },
		};
	}
	return { index, glyphCount: placed.length, width: pen.inkWidth, hyphen: null };
}

/**
 * The last break that fits, or, when none does, the first: a word wider than
 * the wrap width goes on its own line and overflows it (R6.13).
 */
function choose(candidates: readonly BreakCandidate[], wrapWidth: number): BreakCandidate {
	for (let index = candidates.length - 1; index >= 0; index--) {
		if (candidates[index].width <= wrapWidth + EPSILON) return candidates[index];
	}
	return candidates[0];
}

function writeAdvances({ items, offset, start, end, placed, advances, size }: {
	items: readonly Item[];
	offset: number;
	start: number;
	end: number;
	placed: readonly LaidOutGlyph[];
	advances: number[];
	size: number;
}): void {
	let pen = 0;
	let glyph = 0;
	for (let index = start; index < end; index++) {
		const item = items[index];
		if (item.glyph && glyph < placed.length) {
			const laid = placed[glyph++];
			pen = laid.x + laid.glyph.advance * size;
		}
		advances[offset + index] = pen;
	}
}

interface TruncateOptions {
	line: TextLine;
	maxWidth: number;
	atlas: FontAtlas;
	pen: Pen;
	/** Append the ellipsis even when the line fits, because lines after it were cut. */
	force: boolean;
}

/**
 * R6.14: keep the longest prefix of the line that leaves room for the
 * ellipsis glyph within `maxWidth`, dropping spaces the cut leaves at its end,
 * and place the ellipsis after it. The prefix is re-placed through the pen, so
 * the ellipsis is kerned and spaced like any other glyph.
 */
function truncateLine({ line, maxWidth, atlas, pen, force }: TruncateOptions): TextLine {
	const ellipsisGlyph = atlas.glyph(ELLIPSIS);
	if (!ellipsisGlyph) return line;
	// A soft hyphen shown at the line end is not content; the ellipsis replaces it.
	const content = line.hyphenated ? line.glyphs.slice(0, -1) : line.glyphs;

	for (let keep = force ? content.length : content.length - 1; keep >= 0; keep--) {
		let end = keep;
		while (end > 0 && isSpace(content[end - 1].glyph)) end -= 1;
		pen.reset();
		const glyphs: LaidOutGlyph[] = [];
		for (let index = 0; index < end; index++) {
			glyphs.push({ glyph: content[index].glyph, x: pen.place(content[index].glyph, false) });
		}
		const x = pen.place(ellipsisGlyph, false);
		if (pen.x <= maxWidth + EPSILON || end === 0) {
			glyphs.push({ glyph: ellipsisGlyph, x });
			return { glyphs, width: pen.x, hyphenated: false };
		}
	}
	return line;
}

function isSpace(glyph: FontGlyph): boolean {
	return glyph.codePoint === SPACE || glyph.codePoint === TAB;
}
