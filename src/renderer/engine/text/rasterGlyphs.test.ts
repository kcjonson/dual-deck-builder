import {
	GlyphCanvasContext,
	INK_REFERENCE_TEXT,
	INK_TOLERANCE,
	RASTER_GUTTER,
	RASTER_PHASES,
	RASTER_RANGE_THRESHOLD,
	drawInkSample,
	histogramInk,
	inkCurve,
	inkHistogram,
	rasterBlockWidth,
	rasterGlyphBox,
	rasterPen,
	rasterPixelSize,
	rasterizeGlyphs,
	screenRange,
	wantsRasterGlyphs,
} from './rasterGlyphs';
import { syntheticFontAtlas } from './testing';

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

describe('hysteresis', () => {
	it('keeps a run already on the raster there until its range passes the threshold by a tenth', () => {
		const atlas = syntheticFontAtlas();
		// 9.4 device px is a range of 1.567.
		expect(wantsRasterGlyphs(atlas, 9.4, 1)).toBe(false);
		expect(wantsRasterGlyphs(atlas, 9.4, 1, true)).toBe(true);
		expect(wantsRasterGlyphs(atlas, 9.7, 1, true)).toBe(false);
	});
});

describe('rasterGlyphBox', () => {
	it('rounds the plane out to whole device pixels from the pen, plus a column for the phases', () => {
		const atlas = syntheticFontAtlas();
		const a = atlas.glyph(0x41);
		if (!a) throw new Error('no A');
		// `A` is 0.625 em wide and 0.75 em tall above the baseline: 5 by 6 at 8 px.
		expect(rasterGlyphBox(a, 8)).toEqual({ left: 0, top: -6, width: 6, height: 6 });
		// At 7 px it is 4.375 by 5.25, rounded out to 5 by 6.
		expect(rasterGlyphBox(a, 7)).toEqual({ left: 0, top: -6, width: 6, height: 6 });
		expect(rasterBlockWidth({ left: 0, top: -6, width: 6, height: 6 })).toBe(RASTER_PHASES * 7);
	});

	it('has no box for a blank glyph', () => {
		const space = syntheticFontAtlas().glyph(0x20);
		if (!space) throw new Error('no space');
		expect(rasterGlyphBox(space, 8)).toBeNull();
	});
});

describe('rasterizeGlyphs', () => {
	/**
	 * A fake canvas that records the calls and, for `getImageData`, returns an
	 * oversampled image with the given subsample columns covered, so the box
	 * filter's phases and its containment can be read back.
	 */
	function fakeCanvas(covered: number[]) {
		const calls: string[] = [];
		const canvas = { width: 0, height: 0 };
		const context: GlyphCanvasContext = {
			canvas,
			font: '',
			fillStyle: '',
			textBaseline: 'top',
			textAlign: 'center',
			setTransform: (a, b, c, d, e, f) => calls.push(`transform ${a} ${b} ${c} ${d} ${e} ${f}`),
			clearRect: (x, y, width, height) => calls.push(`clear ${x} ${y} ${width} ${height}`),
			fillText: (text, x, y) => calls.push(`text ${text} ${x} ${y}`),
			getImageData: (x, y, width, height) => {
				calls.push(`read ${width} ${height}`);
				const data = new Uint8ClampedArray(width * height * 4);
				for (const column of covered) {
					for (let row = 0; row < height; row++) data[(row * width + column) * 4 + 3] = 255;
				}
				return { data };
			},
		};
		return { context, calls, canvas };
	}

	const box = { left: 0, top: -6, width: 6, height: 6 };
	const glyphs = [{ outlineCodePoint: 0x41, box }, { outlineCodePoint: 0x3F, box: { ...box, left: -1 } }];

	it('draws every glyph once, in white, oversampled, pens on whole texels a gap apart, and reads back once', () => {
		const { context, calls, canvas } = fakeCanvas([]);
		rasterizeGlyphs(context, glyphs, 8, 'ddb-test');
		// Two boxes of 6 and a gap of 2 after each, four times as wide.
		expect(canvas).toEqual({ width: 16 * RASTER_PHASES, height: 6 });
		expect(context.font).toBe('8px "ddb-test"');
		expect(context.fillStyle).toBe('#ffffff');
		expect(context.textBaseline).toBe('alphabetic');
		expect(context.textAlign).toBe('left');
		expect(calls).toContain(`transform ${RASTER_PHASES} 0 0 1 0 0`);
		expect(calls).toContain('text A 0 6');
		expect(calls).toContain('text ? 9 6');
		expect(calls.filter((call) => call.startsWith('read'))).toEqual([`read ${16 * RASTER_PHASES} 6`]);
	});

	it('box-filters each glyph into its phases, each a quarter pixel further right, blank outside its box', () => {
		// A covered subsample at A's pen (column 0) and a stray one in the gap after its box.
		const { context } = fakeCanvas([0, 6 * RASTER_PHASES + 1]);
		const [block, second] = rasterizeGlyphs(context, glyphs, 8, 'ddb-test');
		const width = rasterBlockWidth(box);
		expect(block.length).toBe(width * (box.height + RASTER_GUTTER) * 4);
		const alpha = (x: number, row = 2) => block[(row * width + x) * 4 + 3];
		for (let phase = 0; phase < RASTER_PHASES; phase++) {
			const x = phase * (box.width + RASTER_GUTTER);
			// One subsample of four, moved within the pen's pixel.
			expect(alpha(x)).toBe(64);
			expect(alpha(x + 1)).toBe(0);
			// The gutter column is blank.
			expect(alpha(x + box.width)).toBe(0);
		}
		// So is the gutter row.
		expect(alpha(0, box.height)).toBe(0);
		// The stray gap column reached neither block.
		expect(Math.max(...Array.from(second).filter((_, index) => index % 4 === 3))).toBe(0);
		// Premultiplied white.
		expect(Array.from(block.slice(2 * width * 4, 2 * width * 4 + 4))).toEqual([64, 64, 64, 64]);
	});

	it('draws each subsample through the ink curve before the box filter', () => {
		const { context } = fakeCanvas([0]);
		const halve = new Uint8Array(256).map((_, value) => value >> 1);
		const [block] = rasterizeGlyphs(context, glyphs, 8, 'ddb-test', halve);
		expect(block[2 * rasterBlockWidth(box) * 4 + 3]).toBe(32);
	});
});

describe('weight against the distance field (DDB-217)', () => {
	/** A histogram of `count` subsamples at each of the given coverages. */
	function histogramOf(coverages: number[], count = 100): Uint32Array {
		const histogram = new Uint32Array(256);
		for (const coverage of coverages) histogram[coverage] += count;
		return histogram;
	}

	it('draws the reference word the way glyphs are drawn, once, and reads it back', () => {
		const calls: string[] = [];
		const canvas = { width: 0, height: 0 };
		const context: GlyphCanvasContext = {
			canvas,
			font: '',
			fillStyle: '',
			textBaseline: 'top',
			textAlign: 'center',
			setTransform: (a, b, c, d) => calls.push(`transform ${a} ${b} ${c} ${d}`),
			clearRect: () => undefined,
			fillText: (text) => calls.push(`text ${text}`),
			getImageData: (x, y, width, height) => {
				calls.push(`read ${width} ${height}`);
				return { data: new Uint8Array(width * height * 4) };
			},
		};
		drawInkSample(context, 'ddb-test', 8, 7.5);
		expect(context.font).toBe('8px "ddb-test"');
		expect(context.fillStyle).toBe('#ffffff');
		expect(context.textBaseline).toBe('alphabetic');
		expect(calls).toContain(`transform ${RASTER_PHASES} 0 0 1`);
		expect(calls.filter((call) => call.startsWith('text'))).toEqual([`text ${INK_REFERENCE_TEXT}`]);
		// The word's advance and an em to spare, four times as wide.
		expect(calls).toContain(`read ${(7.5 + 1) * 8 * RASTER_PHASES} ${8 * 2 + 4}`);
	});

	it('counts ink after the box filter, a subsample at a time', () => {
		const histogram = inkHistogram([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 51]);
		expect(histogram[255]).toBe(2);
		expect(histogram[51]).toBe(1);
		expect(histogramInk(histogram)).toBeCloseTo(2.2 / RASTER_PHASES);
	});

	it('keeps a platform within the tolerance as it draws', () => {
		const histogram = histogramOf([255, 128]);
		const ink = histogramInk(histogram);
		expect(inkCurve(histogram, ink * (1 + INK_TOLERANCE * 0.9))).toBeNull();
		expect(inkCurve(histogram, ink * (1 - INK_TOLERANCE * 0.9))).toBeNull();
		expect(inkCurve(new Uint32Array(256), 10)).toBeNull();
	});

	it('brings a heavier platform to the field with a power curve that keeps full coverage full', () => {
		const histogram = histogramOf([255, 200, 128, 60, 20]);
		const target = histogramInk(histogram) / 1.3;
		const curve = inkCurve(histogram, target);
		if (!curve) throw new Error('expected a curve');
		expect(curve[0]).toBe(0);
		expect(curve[255]).toBe(255);
		expect(curve[128]).toBeLessThan(128);
		let ink = 0;
		for (let value = 0; value < 256; value++) ink += histogram[value] * curve[value] / 255;
		expect(ink / RASTER_PHASES / target).toBeCloseTo(1, 2);
	});

	it('thickens a lighter one the same way', () => {
		const histogram = histogramOf([255, 128, 60]);
		const curve = inkCurve(histogram, histogramInk(histogram) * 1.2);
		expect(curve?.[128]).toBeGreaterThan(128);
		expect(curve?.[255]).toBe(255);
	});
});
