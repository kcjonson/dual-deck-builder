import { LineOrigin, TextPlacement, decorationOffset, layoutInk, lineOrigin } from './textPlacement';
import { layoutText } from './TextLayout';
import { syntheticFontAtlas } from './testing';

/**
 * The synthetic atlas at 16 px: line height 20, ascent 16, descent 4, so the
 * half-leading is zero. With a 1.5 line height (24 px) it is 2 px.
 */

const atlas = syntheticFontAtlas();

function origins(text: string, placement: TextPlacement, lineHeight?: number): LineOrigin[] {
	const layout = layoutText(atlas, { text, font: 'body', size: 16, lineHeight });
	return layout.lines.map((_, line) => ({ ...lineOrigin(layout, placement, line, { x: 0, y: 0 }) }));
}

describe('lineOrigin', () => {
	it('reads a bare position as the anchor and the first baseline (R2.13)', () => {
		expect(origins('AA', { position: { x: 5, y: 30 } })).toEqual([{ x: 5, y: 30 }]);
	});

	it('aligns each line on its own width against the anchor or the box (R6.15)', () => {
		expect(origins('AA\nA', { position: { x: 100, y: 0 }, align: 'right' }).map((origin) => origin.x)).toEqual([80, 90]);
		expect(origins('AA\nA', { box: { x: 0, y: 0, width: 100, height: 50 }, align: 'center' }).map((origin) => origin.x)).toEqual([40, 45]);
	});

	it('puts the first line box on the box top, half-leading included', () => {
		expect(origins('A', { box: { x: 0, y: 10, width: 100, height: 50 } })[0].y).toBe(26);
		expect(origins('A', { box: { x: 0, y: 10, width: 100, height: 50 } }, 1.5)[0].y).toBe(28);
	});

	it('centres on the face ascent and descent, not on the glyphs (R6.11)', () => {
		// Box 10 to 60: the 20 px ascent-plus-descent block centred starts at
		// 25, so the baseline is 25 + 16.
		expect(origins('A', { box: { x: 0, y: 10, width: 100, height: 50 }, verticalAlign: 'middle' })[0].y).toBe(41);
		// Descenders or not, the baseline is the same: the glyphs have no say.
		expect(origins('x', { box: { x: 0, y: 10, width: 100, height: 50 }, verticalAlign: 'middle' })[0].y).toBe(41);
		// Two lines: the block from the first ascent to the last descent is 40.
		expect(origins('A\nA', { box: { x: 0, y: 10, width: 100, height: 50 }, verticalAlign: 'middle' }).map((origin) => origin.y)).toEqual([31, 51]);
		// At a position, the block is centred on its y.
		expect(origins('A', { position: { x: 0, y: 50 }, verticalAlign: 'middle' })[0].y).toBe(56);
		// A taller line height moves nothing: leading is not part of the block.
		expect(origins('A', { box: { x: 0, y: 10, width: 100, height: 50 }, verticalAlign: 'middle' }, 1.5)[0].y).toBe(41);
	});

	it('puts the last line box on the box bottom', () => {
		expect(origins('A\nA', { box: { x: 0, y: 10, width: 100, height: 50 }, verticalAlign: 'bottom' }).map((origin) => origin.y)).toEqual([36, 56]);
	});

	it('puts a line box top on a position for top and its bottom for bottom', () => {
		expect(origins('A', { position: { x: 0, y: 50 }, verticalAlign: 'top' })[0].y).toBe(66);
		expect(origins('A', { position: { x: 0, y: 50 }, verticalAlign: 'bottom' })[0].y).toBe(46);
	});
});

describe('layoutInk and decorations', () => {
	it('bounds every glyph quad, and leaves out blanks', () => {
		const layout = layoutText(atlas, { text: 'A x', font: 'body', size: 16 });
		// A: 0..10 x -12..0, x at 14: 14..22 x -8..0.
		expect(layoutInk(layout, { position: { x: 100, y: 50 } })).toEqual({ x: 100, y: 38, width: 22, height: 12 });
	});

	it('is null for a run that draws nothing', () => {
		const layout = layoutText(atlas, { text: '   ', font: 'body', size: 16 });
		expect(layoutInk(layout, { position: { x: 0, y: 0 } })).toBeNull();
	});

	it('puts the underline at the face position and the strike at half the x-height, and bounds them', () => {
		const layout = layoutText(atlas, { text: 'A', font: 'body', size: 16 });
		expect(decorationOffset(layout, 'underline')).toBe(2);
		expect(decorationOffset(layout, 'strike')).toBe(-4);
		expect(decorationOffset(layout, 'none')).toBeNull();
		expect(layoutInk(layout, { position: { x: 0, y: 50 } }, 'underline')).toEqual({ x: 0, y: 38, width: 10, height: 14.5 });
	});
});
