import { TextMetricsService, layoutRequest } from './TextMetricsService';
import { layoutText } from './TextLayout';
import { committedFontAtlas, syntheticFontAtlas } from './testing';

function service(capacity?: number): TextMetricsService {
	const text = new TextMetricsService({ capacity });
	text.addAtlas({ name: 'body', atlas: syntheticFontAtlas() });
	return text;
}

describe('TextMetricsService', () => {
	it('measures from the layout it would draw (R2.14, R6.8)', () => {
		const text = service();
		const measured = text.measure({ text: 'AbA', font: 'body', size: 16 });
		const drawn = text.layout({ text: 'AbA', font: 'body', size: 16 });
		expect(measured).toEqual({ width: 26, height: 20, lines: 1, lineWidths: [26], advances: [10, 16, 26] });
		expect(drawn?.width).toBe(measured.width);
	});

	it('reports wrapped lines, their widths and lines * lineHeight (R6.13)', () => {
		const measured = service().measure({ text: 'AA AA AA', font: 'body', size: 16, wrap: 'word', maxWidth: 50 });
		expect(measured).toMatchObject({ width: 44, height: 40, lines: 2, lineWidths: [44, 20] });
	});

	it('refuses a font with no atlas rather than estimating', () => {
		expect(() => service().measure({ text: 'A', font: 'mono', size: 16 })).toThrow("no atlas is loaded for font 'mono'");
		expect(service().layout({ text: 'A', font: 'mono', size: 16 })).toBeNull();
	});

	it('caches a layout and hands the same one back (R6.12)', () => {
		const text = service();
		const first = text.layout({ text: 'Ab', font: 'body', size: 16 });
		const second = text.layout({ text: 'Ab', font: 'body', size: 16 });
		expect(second).toBe(first);
		expect(text.hits).toBe(1);
		expect(text.misses).toBe(1);
	});

	it('keys on every input a layout depends on', () => {
		const text = service();
		const base = { text: 'Ab', font: 'body', size: 16 };
		const variants = [
			base,
			{ ...base, text: 'Ab ' },
			{ ...base, size: 17 },
			{ ...base, letterSpacing: 0.1 },
			{ ...base, textTransform: 'uppercase' as const },
			{ ...base, wrap: 'word' as const, maxWidth: 10 },
			{ ...base, wrap: 'word' as const, maxWidth: 11 },
			{ ...base, overflow: 'ellipsis' as const, maxWidth: 10 },
			{ ...base, lineHeight: 2 },
		];
		const layouts = new Set(variants.map((variant) => text.layout(variant)));
		expect(layouts.size).toBe(variants.length);
	});

	it('shares an entry between runs a width cannot affect', () => {
		const text = service();
		const unboxed = text.layout({ text: 'Ab', font: 'body', size: 16 });
		// No wrap and no ellipsis: the box width is not read.
		const boxed = text.layout({ text: 'Ab', font: 'body', size: 16, box: { x: 5, y: 5, width: 3, height: 3 } });
		expect(boxed).toBe(unboxed);
	});

	it('evicts the least recently used layout past its capacity', () => {
		const text = service(2);
		const a = text.layout({ text: 'A', font: 'body', size: 16 });
		text.layout({ text: 'b', font: 'body', size: 16 });
		// Touch 'A' so 'b' is the oldest.
		text.layout({ text: 'A', font: 'body', size: 16 });
		text.layout({ text: 'x', font: 'body', size: 16 });
		expect(text.cacheSize).toBe(2);
		expect(text.layout({ text: 'A', font: 'body', size: 16 })).toBe(a);
		const misses = text.misses;
		text.layout({ text: 'b', font: 'body', size: 16 });
		expect(text.misses).toBe(misses + 1);
	});

	it('empties the cache when an atlas loads (R6.12)', () => {
		const text = service();
		const before = text.layout({ text: 'A', font: 'body', size: 16 });
		text.addAtlas({ name: 'body', atlas: committedFontAtlas('body') });
		const after = text.layout({ text: 'A', font: 'body', size: 16 });
		expect(after).not.toBe(before);
		expect(after?.atlas).toBe(committedFontAtlas('body'));
		expect(text.names).toEqual(['body']);
	});
});

describe('layoutRequest', () => {
	it('wraps at maxWidth, else at the box width, and reads the box height only for a wrapped ellipsis', () => {
		const box = { x: 0, y: 0, width: 100, height: 40 };
		const common = { text: 'A', font: 'body', size: 16 };
		expect(layoutRequest({ ...common, box, wrap: 'word' })).toMatchObject({ maxWidth: 100, maxHeight: null });
		expect(layoutRequest({ ...common, box, wrap: 'word', maxWidth: 60 })).toMatchObject({ maxWidth: 60 });
		expect(layoutRequest({ ...common, box, wrap: 'word', overflow: 'ellipsis' })).toMatchObject({ maxHeight: 40 });
		expect(layoutRequest({ ...common, box, overflow: 'ellipsis' })).toMatchObject({ maxWidth: 100, maxHeight: null });
		expect(layoutRequest({ ...common, box, overflow: 'clip' })).toMatchObject({ maxWidth: null, overflow: 'visible' });
	});

	it('lays the same text out the same way as the iteration it hands to', () => {
		const atlas = syntheticFontAtlas();
		const request = layoutRequest({ text: 'AA AA', font: 'body', size: 16, wrap: 'word', maxWidth: 30 });
		expect(layoutText(atlas, request).lines).toHaveLength(2);
	});
});
