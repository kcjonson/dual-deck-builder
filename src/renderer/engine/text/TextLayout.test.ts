import { TextLayout, TextLayoutRequest, layoutText } from './TextLayout';
import { committedFontAtlas, syntheticFontAtlas } from './testing';

/**
 * Chapter 6.3 and 6.4 over the synthetic atlas, whose advances at 16 px are
 * whole pixels: A 10, b 8, space 4, x 8, ? 8, - 6, soft hyphen 6, ellipsis
 * 16; A then b kerns by -2, b then the soft hyphen by -1. Line height 20,
 * ascent 16, descent 4.
 */

const atlas = syntheticFontAtlas();

function layout(text: string, extra: Partial<TextLayoutRequest> = {}): TextLayout {
	return layoutText(atlas, { text, font: 'body', size: 16, ...extra });
}

/** Each line as its glyphs' characters and pen positions. */
function lines(result: TextLayout): { text: string; xs: number[]; width: number }[] {
	return result.lines.map((line) => ({
		text: line.glyphs.map((placed) => String.fromCodePoint(placed.glyph.codePoint)).join(''),
		xs: line.glyphs.map((placed) => placed.x),
		width: line.width,
	}));
}

describe('the glyph iteration (R6.8, R6.9)', () => {
	it('advances by each glyph, kerned by the atlas pairs', () => {
		const result = layout('AbA');
		// A at 0, b at 10 - 2, A at 8 + 8.
		expect(lines(result)).toEqual([{ text: 'AbA', xs: [0, 8, 16], width: 26 }]);
		expect(result.width).toBe(26);
		expect(result.advances).toEqual([10, 16, 26]);
	});

	it('adds letter spacing between glyphs only, never after the last', () => {
		// 0.25 em at 16 px is 4 px.
		const result = layout('AAA', { letterSpacing: 0.25 });
		expect(lines(result)[0]).toEqual({ text: 'AAA', xs: [0, 14, 28], width: 38 });
	});

	it('uppercases before anything is looked up', () => {
		// Lowercase 'a' is not in the atlas; uppercased it is 'A'.
		expect(lines(layout('aa', { textTransform: 'uppercase' }))[0].text).toBe('AA');
	});

	it('measures and draws an absent code point as the fallback glyph, never as nothing (R6.3)', () => {
		// The synthetic face has no U+FFFD, so the loader stood '?' in for it.
		const result = layout('AzA');
		expect(lines(result)[0]).toEqual({ text: 'A\uFFFDA', xs: [0, 10, 18], width: 28 });
		expect(result.lines[0].glyphs[1].glyph.plane).not.toBeNull();
		expect(result.quadCount).toBe(3);
	});

	it('places a blank but draws no quad for it', () => {
		const result = layout('A A');
		expect(lines(result)[0].xs).toEqual([0, 10, 14]);
		expect(result.quadCount).toBe(2);
	});

	it('advances a tab as a space', () => {
		expect(layout('A\tA').width).toBe(24);
	});

	it('skips a zero-width space, a word joiner and a BOM entirely, kerning across them', () => {
		for (const ignorable of ['​', '⁠', '﻿', '­']) {
			const result = layout(`A${ignorable}b`, { letterSpacing: 0.25 });
			// No glyph and no letter spacing for the ignorable; A-b still kerns.
			expect(lines(result)[0]).toEqual({ text: 'Ab', xs: [0, 12], width: 20 });
			expect(result.advances).toEqual([10, 10, 20]);
		}
	});

	it('kerns across a mid-line soft hyphen in a committed face that kerns against it', () => {
		// Barlow's kerning table has pairs on both sides of U+00AD; mid-line the
		// soft hyphen is invisible, so the pair that counts is the one across it.
		const barlow = committedFontAtlas('display');
		const across = layoutText(barlow, { text: 'V­A', font: 'display', size: 48 });
		const plain = layoutText(barlow, { text: 'VA', font: 'display', size: 48 });
		expect(barlow.kerning(0x56, 0x41)).not.toBe(0);
		expect(barlow.kerning(0x56, 0xAD)).not.toBe(0);
		expect(across.lines[0].glyphs.map((placed) => placed.x)).toEqual(plain.lines[0].glyphs.map((placed) => placed.x));
		expect(across.width).toBe(plain.width);

		// At a line end the soft hyphen shows, and there its own pair applies.
		const broken = layoutText(barlow, { text: 'V­A', font: 'display', size: 48, wrap: 'word', maxWidth: 30 });
		const [v, hyphen] = broken.lines[0].glyphs;
		expect(hyphen.glyph.codePoint).toBe(0xAD);
		expect(hyphen.x).toBeCloseTo((v.glyph.advance + barlow.kerning(0x56, 0xAD)) * 48, 10);
	});

	it('is one line with the face line height for empty text', () => {
		const result = layout('');
		expect(result.lines).toHaveLength(1);
		expect(result.width).toBe(0);
		expect(result.height).toBe(20);
	});

	it('scales the face metrics by size and takes a line height override (R6.10)', () => {
		const result = layout('A', { size: 32, lineHeight: 1.5 });
		expect(result.ascent).toBe(32);
		expect(result.descent).toBe(8);
		expect(result.lineHeight).toBe(48);
	});
});

describe('wrapping (R6.13)', () => {
	it('breaks at a hard newline whether or not it wraps', () => {
		const result = layout('A\nbb');
		expect(lines(result).map((line) => line.text)).toEqual(['A', 'bb']);
		expect(result.height).toBe(40);
		expect(result.advances).toEqual([10, 0, 8, 16]);
	});

	it('fills lines greedily and hangs the space at each break', () => {
		// 'AA AA AA' is 20 + 4 + 20 + 4 + 20; 50 px holds two words.
		const result = layout('AA AA AA', { wrap: 'word', maxWidth: 50 });
		expect(lines(result).map((line) => [line.text, line.width])).toEqual([['AA AA ', 44], ['AA', 20]]);
		expect(result.width).toBe(44);
		expect(result.height).toBe(40);
	});

	it('fits a line measured at exactly the wrap width', () => {
		expect(layout('AA AA', { wrap: 'word', maxWidth: 44 }).lines).toHaveLength(1);
	});

	it('drops leading spaces on a continuation line', () => {
		const result = layout('AA   AA', { wrap: 'word', maxWidth: 30 });
		expect(lines(result).map((line) => line.text)).toEqual(['AA   ', 'AA']);
		expect(result.lines[1].glyphs[0].x).toBe(0);
	});

	it('keeps a first line\'s leading spaces with its first word rather than breaking into an empty line', () => {
		const result = layout('   AAAAAA', { wrap: 'word', maxWidth: 30 });
		expect(lines(result).map((line) => [line.text, line.width])).toEqual([['   AAAAAA', 72]]);
		expect(result.height).toBe(20);
		// Still breaks once the line has ink.
		expect(lines(layout('  AA AA', { wrap: 'word', maxWidth: 30 })).map((line) => line.text)).toEqual(['  AA ', 'AA']);
	});

	it('puts a word wider than the width on its own line and lets it overflow', () => {
		const result = layout('A AAAAAA A', { wrap: 'word', maxWidth: 30 });
		expect(lines(result).map((line) => [line.text, line.width])).toEqual([['A ', 10], ['AAAAAA ', 60], ['A', 10]]);
	});

	it('never breaks at a no-break space', () => {
		const result = layout('AA AA', { wrap: 'word', maxWidth: 25 });
		expect(result.lines).toHaveLength(1);
	});

	it('breaks after a zero-width space', () => {
		const result = layout('AA​AA', { wrap: 'word', maxWidth: 25 });
		expect(lines(result).map((line) => line.text)).toEqual(['AA', 'AA']);
	});

	it('breaks after a hyphen followed by a letter, and not before a space or at the end', () => {
		expect(lines(layout('AA-AA', { wrap: 'word', maxWidth: 30 })).map((line) => line.text)).toEqual(['AA-', 'AA']);
		expect(layout('AA- AA', { wrap: 'word', maxWidth: 28 }).lines).toHaveLength(2);
		expect(lines(layout('AA- AA', { wrap: 'word', maxWidth: 28 }))[0].text).toBe('AA- ');
	});

	it('shows a soft hyphen only where a line breaks at it, kerned against the glyph before it', () => {
		const result = layout('Ab­Ab', { wrap: 'word', maxWidth: 25 });
		expect(lines(result)).toEqual([
			// A 0, b 8 (kerned), soft hyphen at 16 - 1.
			{ text: 'Ab­', xs: [0, 8, 15], width: 21 },
			{ text: 'Ab', xs: [0, 8], width: 16 },
		]);
		expect(result.lines[0].hyphenated).toBe(true);
	});

	it('does not break without a width', () => {
		expect(layout('AA AA AA', { wrap: 'word' }).lines).toHaveLength(1);
		expect(layout('AA AA AA', { maxWidth: 10 }).lines).toHaveLength(1);
	});

	it('breaks between graphemes of a script written without spaces', () => {
		// Han is not in the atlas, so each renders as the fallback, 8 px.
		const result = layout('一二三四', { wrap: 'word', maxWidth: 20 });
		expect(result.lines.map((line) => line.glyphs.length)).toEqual([2, 2]);
	});
});

describe('ellipsis (R6.14)', () => {
	it('truncates a single line at the last glyph that leaves room for the ellipsis', () => {
		// AAAA is 40; with a 34 px box, A A plus the 16 px ellipsis is 36, too
		// wide, so one A and the ellipsis (26) is what fits.
		const result = layout('AAAA', { overflow: 'ellipsis', maxWidth: 34 });
		expect(lines(result)).toEqual([{ text: 'A…', xs: [0, 10], width: 26 }]);
		expect(result.truncated).toBe(true);
	});

	it('spaces the ellipsis like any other glyph', () => {
		// 0.25 em is 4 px: A at 0, the ellipsis at 14, 30 wide; a second A would need 44.
		const result = layout('AAAA', { overflow: 'ellipsis', maxWidth: 40, letterSpacing: 0.25 });
		expect(lines(result)).toEqual([{ text: 'A\u2026', xs: [0, 14], width: 30 }]);
	});

	it('truncates a long line to the same prefix a fresh layout of it places', () => {
		const text = 'Ab '.repeat(400);
		const result = layout(text, { overflow: 'ellipsis', maxWidth: 300 });
		const [line] = result.lines;
		const kept = line.glyphs.slice(0, -1).map((placed) => String.fromCodePoint(placed.glyph.codePoint)).join('');
		const fresh = layout(kept);
		expect(line.glyphs.slice(0, -1).map((placed) => placed.x)).toEqual(fresh.lines[0].glyphs.map((placed) => placed.x));
		expect(line.width).toBeLessThanOrEqual(300);
		expect(line.width + 20).toBeGreaterThan(300);
	});

	it('leaves a line that fits alone', () => {
		const result = layout('AA', { overflow: 'ellipsis', maxWidth: 20 });
		expect(lines(result)[0].text).toBe('AA');
		expect(result.truncated).toBe(false);
	});

	it('drops the spaces a cut leaves before the ellipsis', () => {
		expect(lines(layout('AA AAAA', { overflow: 'ellipsis', maxWidth: 40 }))[0].text).toBe('AA…');
	});

	it('ellipsizes the last wrapped line that fits the box height', () => {
		const result = layout('AA AA AA AA AA', { wrap: 'word', overflow: 'ellipsis', maxWidth: 50, maxHeight: 45 });
		// Three lines, two of which fit in 45 px. The second keeps what leaves
		// room for the ellipsis: 'AA A' is 34, and 34 + 16 is the 50 px width.
		expect(lines(result).map((line) => line.text)).toEqual(['AA AA ', 'AA A…']);
		expect(result.height).toBe(40);
		expect(result.truncated).toBe(true);
	});
});

describe('committed faces', () => {
	it('lays every committed role out without a fallback glyph for the R6.3 ranges', () => {
		const sample = 'Fuel 42° — “quoted” … • · café';
		for (const role of ['display', 'body', 'mono'] as const) {
			const face = committedFontAtlas(role);
			const result = layoutText(face, { text: sample, font: role, size: 13 });
			const fallback = face.glyph(0xFFFD);
			for (const { glyph } of result.lines[0].glyphs) {
				expect(glyph === fallback && glyph.codePoint !== 0xFFFD).toBe(false);
			}
			expect(result.width).toBeGreaterThan(0);
		}
	});
});
