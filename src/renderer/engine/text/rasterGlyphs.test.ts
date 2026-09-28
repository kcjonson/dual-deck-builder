import { GlyphCanvasContext, RASTER_PHASES, RASTER_RANGE_THRESHOLD, planRasterGlyphs, rasterCanvasSize, rasterPen, rasterPixelSize, rasterizeGlyphs, screenRange, wantsRasterGlyphs } from './rasterGlyphs';
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

describe('rasterPen', () => {
	const at = (pen: number) => ({ ...rasterPen(pen, { pixel: 0, phase: 0 }) });

	it('puts a pen on its nearest quarter pixel, as a whole pixel and a phase', () => {
		expect(RASTER_PHASES).toBe(4);
		expect(at(10)).toEqual({ pixel: 10, phase: 0 });
		expect(at(14.375)).toEqual({ pixel: 14, phase: 2 });
		expect(at(18.75)).toEqual({ pixel: 18, phase: 3 });
		expect(at(18.9)).toEqual({ pixel: 19, phase: 0 });
		expect(at(-0.3)).toEqual({ pixel: -1, phase: 3 });
	});

	it('keeps a 2.5 px advance 2.5 px, where whole pixels would alternate 2 and 3', () => {
		const pens = [4.19, 6.69, 9.19].map(at).map(({ pixel, phase }) => pixel + phase / RASTER_PHASES);
		expect(pens[1] - pens[0]).toBe(2.5);
		expect(pens[2] - pens[1]).toBe(2.5);
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

	it('rounds each plane out to whole device pixels from the pen, plus a column for the phases', () => {
		// `A` is 0.625 em wide and 0.75 em tall above the baseline: 5 by 6 at 8 px.
		const a = planRasterGlyphs(syntheticFontAtlas(), 8).cells.get(0x41);
		expect(a).toMatchObject({ left: 0, top: -6, width: 6, height: 6, stride: 7 });
		// At 7 px it is 4.375 by 5.25, rounded out to 5 by 6.
		const small = planRasterGlyphs(syntheticFontAtlas(), 7).cells.get(0x41);
		expect(small).toMatchObject({ left: 0, top: -6, width: 6, height: 6 });
	});

	it('packs the committed body face without overlap, inside the atlas, with a gutter', () => {
		const plan = planRasterGlyphs(committedFontAtlas('body'), 8);
		expect(plan.cells.size).toBeGreaterThan(150);
		expect(plan.width).toBeLessThanOrEqual(512);
		const cells = [...plan.cells.values()];
		// Every phase of every glyph is a box of its own.
		const boxes = cells.flatMap((cell) => Array.from({ length: RASTER_PHASES }, (_, phase) => ({ ...cell, x: cell.x + phase * cell.stride })));
		for (const cell of boxes) {
			expect(cell.x).toBeGreaterThanOrEqual(1);
			expect(cell.y).toBeGreaterThanOrEqual(1);
			expect(cell.x + cell.width).toBeLessThanOrEqual(plan.width - 1);
			expect(cell.y + cell.height).toBeLessThanOrEqual(plan.height - 1);
		}
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				const a = boxes[i];
				const b = boxes[j];
				const apart = a.x + a.width + 1 <= b.x || b.x + b.width + 1 <= a.x || a.y + a.height + 1 <= b.y || b.y + b.height + 1 <= a.y;
				expect(apart).toBe(true);
			}
		}
	});
});

describe('rasterizeGlyphs', () => {
	/**
	 * A fake canvas that records the calls and, for `getImageData`, returns an
	 * oversampled image with one fully covered subsample column per glyph at
	 * its pen, so the box filter's phases can be read back.
	 */
	function fakeCanvas(plan: ReturnType<typeof planRasterGlyphs>) {
		const calls: string[] = [];
		const size = rasterCanvasSize(plan);
		const context: GlyphCanvasContext = {
			font: '',
			fillStyle: '',
			textBaseline: 'top',
			textAlign: 'center',
			setTransform: (a, b, c, d, e, f) => calls.push(`transform ${a} ${b} ${c} ${d} ${e} ${f}`),
			clearRect: (x, y, width, height) => calls.push(`clear ${x} ${y} ${width} ${height}`),
			save: () => undefined,
			restore: () => undefined,
			beginPath: () => undefined,
			rect: (x, y, width, height) => calls.push(`clip ${x} ${y} ${width} ${height}`),
			clip: () => undefined,
			fillText: (text, x, y) => calls.push(`text ${text} ${x} ${y}`),
			getImageData: (x, y, width, height) => {
				const data = new Uint8ClampedArray(width * height * 4);
				for (const cell of plan.cells.values()) {
					const column = (cell.x - cell.left) * RASTER_PHASES;
					for (let row = cell.y; row < cell.y + cell.height; row++) data[(row * width + column) * 4 + 3] = 255;
				}
				return { data };
			},
		};
		return { context, calls, size };
	}

	it('draws each glyph once, in white, oversampled, at its cell with its pen on a whole texel', () => {
		const plan = planRasterGlyphs(syntheticFontAtlas(), 8);
		const { context, calls, size } = fakeCanvas(plan);
		rasterizeGlyphs(context, plan, 'ddb-synthetic');
		expect(size).toEqual({ width: plan.width * RASTER_PHASES, height: plan.height });
		expect(context.font).toBe('8px "ddb-synthetic"');
		expect(context.fillStyle).toBe('#ffffff');
		expect(context.textBaseline).toBe('alphabetic');
		expect(context.textAlign).toBe('left');
		expect(calls).toContain(`clear 0 0 ${size.width} ${size.height}`);
		expect(calls).toContain(`transform ${RASTER_PHASES} 0 0 1 0 0`);
		const a = plan.cells.get(0x41);
		if (!a) throw new Error('no cell for A');
		expect(calls).toContain(`clip ${a.x} ${a.y} ${a.width} ${a.height}`);
		expect(calls).toContain(`text A ${a.x - a.left} ${a.y - a.top}`);
		expect(calls.filter((call) => call.startsWith('text'))).toHaveLength(plan.cells.size);
	});

	it('box-filters each glyph into its phases, each a quarter pixel further right', () => {
		const plan = planRasterGlyphs(syntheticFontAtlas(), 8);
		const texels = rasterizeGlyphs(fakeCanvas(plan).context, plan, 'ddb-synthetic');
		expect(texels.length).toBe(plan.width * plan.height * 4);
		const a = plan.cells.get(0x41);
		if (!a) throw new Error('no cell for A');
		const row = a.y + 2;
		const alpha = (x: number) => texels[(row * plan.width + x) * 4 + 3];
		// One covered subsample at the pen: a quarter of the pen's column in
		// every phase, since each phase moves it one subsample within that column.
		for (let phase = 0; phase < RASTER_PHASES; phase++) {
			const x = a.x + phase * a.stride - a.left;
			expect(alpha(x)).toBe(64);
			expect(alpha(x + 1)).toBe(0);
		}
		// Premultiplied white.
		const offset = (row * plan.width + a.x - a.left) * 4;
		expect([...texels.slice(offset, offset + 4)]).toEqual([64, 64, 64, 64]);
	});

	it('draws a substitute with the outline the atlas holds for it', () => {
		const plan = planRasterGlyphs(syntheticFontAtlas(), 8);
		const { context, calls } = fakeCanvas(plan);
		rasterizeGlyphs(context, plan, 'ddb-synthetic');
		const replacement = plan.cells.get(0xFFFD);
		if (!replacement) throw new Error('no cell for U+FFFD');
		expect(calls).toContain(`text ? ${replacement.x - replacement.left} ${replacement.y - replacement.top}`);
	});
});
