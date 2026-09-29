import type { TextureHandle } from '../draw/commands';
import type { TextureOptions, TextureRegion } from '../gpu/TextureStore';
import type { GlyphCanvasContext } from '../text/rasterGlyphs';
import { TextMetricsService } from '../text/TextMetricsService';
import { syntheticFontAtlas } from '../text/testing';
import { RasterGlyphPage } from './RasterGlyphPage';

function blankCanvas(log: string[]): GlyphCanvasContext {
	const noop = () => undefined;
	return {
		canvas: { width: 0, height: 0 },
		font: '',
		fillStyle: '',
		textBaseline: 'alphabetic',
		textAlign: 'left',
		setTransform: noop,
		clearRect: noop,
		fillText: (text) => log.push(text),
		getImageData: (x, y, width, height) => ({ data: new Uint8Array(width * height * 4) }),
	};
}

function setup({ family = 'ddb-test' as string | null, budgetMs = 3, width = 256, height = 256, cost = 0 } = {}) {
	const created: TextureOptions[] = [];
	const writes: TextureRegion[] = [];
	const drawn: string[] = [];
	let clock = 0;
	let canvases = 0;
	const page = new RasterGlyphPage({
		textures: {
			create: (options) => {
				created.push(options);
				return { id: 7, width: options.width, height: options.height, label: options.label ?? null } as TextureHandle;
			},
			writeRegion: (handle, region) => {
				writes.push(region);
			},
		},
		familyOf: (font) => (font === 'body' ? family : null),
		createCanvas: () => {
			canvases += 1;
			return blankCanvas(drawn);
		},
		// Each rasterising pass costs `cost` ms.
		now: () => {
			clock += cost;
			return clock;
		},
		budgetMs,
		width,
		height,
	});
	const text = new TextMetricsService();
	text.addAtlas({ name: 'body', atlas: syntheticFontAtlas() });
	const layout = (value: string, size = 8) => {
		const result = text.layout({ text: value, font: 'body', size });
		if (!result) throw new Error('no layout');
		return result;
	};
	return { page, created, writes, drawn, layout, canvases: () => canvases };
}

describe('RasterGlyphPage (R6.4a)', () => {
	it('rasterises only the glyphs a run uses, once, into one page texture shared by every size', () => {
		const { page, created, writes, drawn, layout, canvases } = setup();
		page.beginFrame();
		const eight = page.glyphs('body', layout('AbA'), 8);
		expect(eight?.cells.size).toBe(2);
		expect(drawn).toEqual(['A', 'b']);
		// Already in: no more drawing.
		expect(page.glyphs('body', layout('bA'), 8)).toBe(eight);
		expect(drawn).toEqual(['A', 'b']);
		const seven = page.glyphs('body', layout('A'), 7);
		expect(seven?.texture).toBe(eight?.texture);
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({ content: 'color', immediate: true, keepSource: true });
		expect(canvases()).toBe(1);
		expect(writes).toHaveLength(3);
		expect(page.glyphsOnPage).toBe(3);
	});

	it('packs cells without overlap, inside the page, one write per glyph', () => {
		const { page, writes, layout } = setup();
		page.beginFrame();
		for (const size of [4, 5, 6, 7, 8, 8.5]) page.glyphs('body', layout('Abx?-'), size);
		for (const region of writes) {
			expect(region.x).toBeGreaterThanOrEqual(1);
			expect(region.y).toBeGreaterThanOrEqual(1);
			expect(region.x + region.width).toBeLessThanOrEqual(256);
			expect(region.y + region.height).toBeLessThanOrEqual(256);
		}
		for (let i = 0; i < writes.length; i++) {
			for (let j = i + 1; j < writes.length; j++) {
				const a = writes[i];
				const b = writes[j];
				const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
				expect(apart).toBe(true);
			}
		}
	});

	it('draws from the distance field while the role has no loaded face', () => {
		const { page, layout, created } = setup({ family: null });
		page.beginFrame();
		expect(page.glyphs('body', layout('A'), 8)).toBeNull();
		expect(created).toHaveLength(0);
	});

	it('spends its time budget, then leaves later runs on the field until the next frame', () => {
		const { page, layout } = setup({ budgetMs: 3, cost: 2 });
		page.beginFrame();
		expect(page.glyphs('body', layout('A'), 8)).not.toBeNull();
		expect(page.glyphs('body', layout('b'), 8)).not.toBeNull();
		// 4 ms spent: the next run with a missing glyph waits.
		expect(page.glyphs('body', layout('x'), 8)).toBeNull();
		// A run whose glyphs are all in still draws.
		expect(page.glyphs('body', layout('Ab'), 8)).not.toBeNull();
		page.beginFrame();
		expect(page.glyphs('body', layout('x'), 8)).not.toBeNull();
	});

	it('lifts the budget for the frame after a prewarm, and only that one', () => {
		const { page, layout } = setup({ budgetMs: 3, cost: 2 });
		page.prewarm();
		page.beginFrame();
		for (const value of ['A', 'b', 'x', '?']) expect(page.glyphs('body', layout(value), 8)).not.toBeNull();
		page.beginFrame();
		expect(page.glyphs('body', layout('-'), 8)).not.toBeNull();
		expect(page.glyphs('body', layout('A'), 7)).not.toBeNull();
		expect(page.glyphs('body', layout('b'), 7)).toBeNull();
	});

	it('starts over when full: the run that did not fit waits a frame on the field', () => {
		// Room for a few 8 px glyphs only.
		const { page, layout } = setup({ width: 64, height: 16 });
		page.beginFrame();
		expect(page.glyphs('body', layout('A'), 8)).not.toBeNull();
		expect(page.glyphs('body', layout('bx?'), 8)).toBeNull();
		expect(page.resets).toBe(0);
		page.beginFrame();
		expect(page.resets).toBe(1);
		expect(page.glyphsOnPage).toBe(0);
		expect(page.glyphs('body', layout('b'), 8)).not.toBeNull();
	});

	it('starts a size over when its role is loaded again with another atlas', () => {
		const { page, drawn } = setup();
		const text = new TextMetricsService();
		text.addAtlas({ name: 'body', atlas: syntheticFontAtlas() });
		const first = text.layout({ text: 'A', font: 'body', size: 8 });
		text.addAtlas({ name: 'body', atlas: syntheticFontAtlas() });
		const second = text.layout({ text: 'A', font: 'body', size: 8 });
		if (!first || !second) throw new Error('no layout');
		page.beginFrame();
		page.glyphs('body', first, 8);
		page.glyphs('body', second, 8);
		expect(drawn).toEqual(['A', 'A']);
	});
});
