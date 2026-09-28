import { GlyphCanvasContext, RASTER_RANGE_THRESHOLD, planRasterGlyphs, rasterizeGlyphs, screenRange, wantsRasterGlyphs } from './rasterGlyphs';
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

describe('planRasterGlyphs', () => {
	it('gives every glyph with a plane a cell, and blanks none', () => {
		const plan = planRasterGlyphs(syntheticFontAtlas(), 8, 1);
		expect([...plan.cells.keys()].sort((a, b) => a - b)).toEqual([0x2D, 0x3F, 0x41, 0x62, 0x78, 0xAD, 0x2010, 0x2011, 0x2026, 0xFFFD]);
		expect(plan.cells.has(0x20)).toBe(false);
		expect(plan.pixelSize).toBe(8);
	});

	it('draws a substitute with the outline the atlas holds for it, not its own code point (R6.3)', () => {
		const plan = planRasterGlyphs(syntheticFontAtlas(), 8, 1);
		expect(plan.cells.get(0xFFFD)?.outlineCodePoint).toBe(0x3F);
		expect(plan.cells.get(0x2011)?.outlineCodePoint).toBe(0x2D);
		expect(plan.cells.get(0x41)?.outlineCodePoint).toBe(0x41);
	});

	it('rounds each plane out to whole device pixels from the pen', () => {
		// `A` is 0.625 em wide and 0.75 em tall above the baseline: 5 by 6 at 8 px.
		const a = planRasterGlyphs(syntheticFontAtlas(), 8, 1).cells.get(0x41);
		expect(a).toMatchObject({ left: 0, top: -6, width: 5, height: 6 });
		// At 7 px it is 4.375 by 5.25, rounded out to 5 by 6.
		const small = planRasterGlyphs(syntheticFontAtlas(), 7, 1).cells.get(0x41);
		expect(small).toMatchObject({ left: 0, top: -6, width: 5, height: 6 });
	});

	it('packs the committed body face without overlap, inside the atlas, with a gutter', () => {
		const plan = planRasterGlyphs(committedFontAtlas('body'), 8, 1);
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
		const plan = planRasterGlyphs(syntheticFontAtlas(), 8, 1);
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
