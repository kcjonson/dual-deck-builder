import { GlyphCanvasContext, RASTER_RANGE_THRESHOLD, evenWordPens, planRasterGlyphs, rasterPixelSize, rasterizeGlyphs, screenRange, wantsRasterGlyphs } from './rasterGlyphs';
import { committedFontAtlas, syntheticFontAtlas } from './testing';

describe('R6.4a threshold', () => {
	const atlas = syntheticFontAtlas();

	it('measures the screen range as range times size times ratio over the atlas em', () => {
		expect(screenRange(atlas, 12, 1)).toBe(2);
		expect(screenRange(atlas, 9, 1)).toBe(1.5);
		expect(screenRange(atlas, 8, 2)).toBeCloseTo(8 / 3, 10);
	});

	it('sends 8 px to the fallback at ratio 1 and keeps 9 px, which sits exactly on the threshold', () => {
		expect(wantsRasterGlyphs(atlas, 8, 1)).toBe(true);
		expect(wantsRasterGlyphs(atlas, 9, 1)).toBe(false);
		expect(screenRange(atlas, 9, 1)).toBe(RASTER_RANGE_THRESHOLD);
	});

	it('keeps 8 px on the distance field at ratio 2, where it is 16 device pixels', () => {
		expect(wantsRasterGlyphs(atlas, 8, 2)).toBe(false);
		expect(wantsRasterGlyphs(atlas, 4, 2)).toBe(true);
	});
});

describe('evenWordPens', () => {
	function even(pens: number[]): number[] {
		const out = new Float64Array(pens.length);
		evenWordPens(Float64Array.from(pens), pens.length, out, new Uint8Array(pens.length * 2));
		return Array.from(out);
	}

	it('rounds a single pen', () => {
		expect(even([10.6])).toEqual([11]);
	});

	it('rounds both ends and gives every gap its advance rounded down or up', () => {
		const pens = [0.3, 4.7, 9.1, 13.3, 17.9];
		const result = even(pens);
		expect(result[0]).toBe(0);
		expect(result[4]).toBe(18);
		for (let gap = 0; gap < 4; gap++) {
			const advance = pens[gap + 1] - pens[gap];
			expect([Math.floor(advance), Math.ceil(advance)]).toContain(result[gap + 1] - result[gap]);
		}
	});

	it('gives the spare pixels to the advances with the largest fractions, not to whichever pen crosses a half', () => {
		// Advances alternate 4.4 and 4.2 ("abab" and an a). Rounding each pen
		// gives gaps 4, 5, 4, 4: the extra pixel after a b, by phase alone.
		const pens = [0, 4.4, 8.6, 13, 17.2];
		expect(pens.map(Math.round)).toEqual([0, 4, 9, 13, 17]);
		expect(even(pens)).toEqual([0, 5, 9, 13, 17]);
		// Two spare pixels among three 0.4 advances go to 0.4 ones, never to a 0.2 one.
		const longer = even([0, 4.4, 8.6, 13, 17.2, 21.6, 25.8]);
		const gaps = longer.slice(1).map((pen, index) => pen - longer[index]);
		expect(gaps.filter((gap, index) => gap === 5 && index % 2 === 1)).toEqual([]);
		expect(gaps.filter((gap) => gap === 5)).toHaveLength(2);
	});

	it('keeps every pen within a pixel of the layout for a long word', () => {
		const pens = Array.from({ length: 20 }, (_, index) => 3.3 + index * 4.37 + (index % 3) * 0.05);
		const result = even(pens);
		result.forEach((pen, index) => expect(Math.abs(pen - pens[index])).toBeLessThan(1));
		// Squeezed-then-stretched fractions, which unconstrained apportionment drifts several pixels on.
		const lopsided = [0];
		for (let index = 0; index < 20; index++) lopsided.push(lopsided[index] + (index < 10 ? 4.4 : 4.6));
		even(lopsided).forEach((pen, index) => expect(Math.abs(pen - lopsided[index])).toBeLessThan(1));
	});
});

describe('rasterPixelSize', () => {
	it('rounds the device font size to a quarter pixel, so a zoom reuses a few atlases', () => {
		expect(rasterPixelSize(8, 1)).toBe(8);
		expect(rasterPixelSize(8, 0.625)).toBe(5);
		expect(rasterPixelSize(9, 0.8)).toBe(7.25);
		expect(rasterPixelSize(9, 0.81)).toBe(7.25);
		expect(rasterPixelSize(0.01, 1)).toBe(0.25);
	});
});

describe('planRasterGlyphs', () => {
	it('gives every glyph with a plane a cell, and blanks none', () => {
		const plan = planRasterGlyphs(syntheticFontAtlas(), 8);
		expect([...plan.cells.keys()].sort((a, b) => a - b)).toEqual([0x2D, 0x3F, 0x41, 0x62, 0x78, 0xAD, 0x2010, 0x2011, 0x2026, 0xFFFD]);
		expect(plan.cells.has(0x20)).toBe(false);
		expect(plan.pixelSize).toBe(8);
	});

	it('draws a substitute with the outline the atlas holds for it, not its own code point (R6.3)', () => {
		const plan = planRasterGlyphs(syntheticFontAtlas(), 8);
		expect(plan.cells.get(0xFFFD)?.outlineCodePoint).toBe(0x3F);
		expect(plan.cells.get(0x2011)?.outlineCodePoint).toBe(0x2D);
		expect(plan.cells.get(0x41)?.outlineCodePoint).toBe(0x41);
	});

	it('rounds each plane out to whole device pixels from the pen', () => {
		// `A` is 0.625 em wide and 0.75 em tall above the baseline: 5 by 6 at 8 px.
		const a = planRasterGlyphs(syntheticFontAtlas(), 8).cells.get(0x41);
		expect(a).toMatchObject({ left: 0, top: -6, width: 5, height: 6 });
		// At 7 px it is 4.375 by 5.25, rounded out to 5 by 6.
		const small = planRasterGlyphs(syntheticFontAtlas(), 7).cells.get(0x41);
		expect(small).toMatchObject({ left: 0, top: -6, width: 5, height: 6 });
	});

	it('packs the committed body face without overlap, inside the atlas, with a gutter', () => {
		const plan = planRasterGlyphs(committedFontAtlas('body'), 8);
		expect(plan.cells.size).toBeGreaterThan(150);
		expect(plan.width).toBeLessThanOrEqual(512);
		const cells = [...plan.cells.values()];
		for (const cell of cells) {
			expect(cell.x).toBeGreaterThanOrEqual(1);
			expect(cell.y).toBeGreaterThanOrEqual(1);
			expect(cell.x + cell.width).toBeLessThanOrEqual(plan.width - 1);
			expect(cell.y + cell.height).toBeLessThanOrEqual(plan.height - 1);
		}
		for (let i = 0; i < cells.length; i++) {
			for (let j = i + 1; j < cells.length; j++) {
				const a = cells[i];
				const b = cells[j];
				const apart = a.x + a.width + 1 <= b.x || b.x + b.width + 1 <= a.x || a.y + a.height + 1 <= b.y || b.y + b.height + 1 <= a.y;
				expect(apart).toBe(true);
			}
		}
	});
});

describe('rasterizeGlyphs', () => {
	it('draws each glyph in white at its cell, with its pen on a whole texel, clipped to the cell', () => {
		const plan = planRasterGlyphs(syntheticFontAtlas(), 8);
		const calls: string[] = [];
		const context: GlyphCanvasContext = {
			font: '',
			fillStyle: '',
			textBaseline: 'top',
			textAlign: 'center',
			clearRect: (x, y, width, height) => calls.push(`clear ${x} ${y} ${width} ${height}`),
			save: () => undefined,
			restore: () => undefined,
			beginPath: () => undefined,
			rect: (x, y, width, height) => calls.push(`clip ${x} ${y} ${width} ${height}`),
			clip: () => undefined,
			fillText: (text, x, y) => calls.push(`text ${text} ${x} ${y}`),
		};
		rasterizeGlyphs(context, plan, 'ddb-synthetic');
		expect(context.font).toBe('8px "ddb-synthetic"');
		expect(context.fillStyle).toBe('#ffffff');
		expect(context.textBaseline).toBe('alphabetic');
		expect(context.textAlign).toBe('left');
		expect(calls[0]).toBe(`clear 0 0 ${plan.width} ${plan.height}`);
		const a = plan.cells.get(0x41);
		if (!a) throw new Error('no cell for A');
		expect(calls).toContain(`clip ${a.x} ${a.y} ${a.width} ${a.height}`);
		expect(calls).toContain(`text A ${a.x - a.left} ${a.y - a.top}`);
		expect(calls.filter((call) => call.startsWith('text'))).toHaveLength(plan.cells.size);
	});
});
