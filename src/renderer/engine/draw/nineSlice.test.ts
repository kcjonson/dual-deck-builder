import type { NineSlice, TextureHandle } from './commands';
import type { Rect } from './geometry';
import { NineSliceImage, createNineSliceGrid, nineSliceCellCount, nineSliceGrid } from './nineSlice';

const TEXTURE: TextureHandle = { id: 7, width: 32, height: 16, label: 'frame' };

function grid(rect: Rect, slice: NineSlice, extra: Partial<NineSliceImage> = {}) {
	const image: NineSliceImage = { rect, texture: TEXTURE, sourceRect: null, sourceSpace: 'pixels', ...extra };
	const out = nineSliceGrid(image, slice, createNineSliceGrid());
	return {
		x: Array.from(out.x),
		y: Array.from(out.y),
		u: Array.from(out.u),
		v: Array.from(out.v),
		columns: Array.from(out.columns.subarray(0, out.columnCount)),
		rows: Array.from(out.rows.subarray(0, out.rowCount)),
		cells: nineSliceCellCount(out),
	};
}

describe('nineSliceGrid (R5.19)', () => {
	it('keeps corners at one logical pixel per texel and stretches the rest', () => {
		const result = grid({ x: 10, y: 20, width: 100, height: 40 }, { top: 4, right: 8, bottom: 2, left: 6 });
		expect(result.x).toEqual([10, 16, 102, 110]);
		expect(result.y).toEqual([20, 24, 58, 60]);
		expect(result.u).toEqual([0, 6 / 32, 24 / 32, 1]);
		expect(result.v).toEqual([0, 4 / 16, 14 / 16, 1]);
		expect(result.cells).toBe(9);
	});

	it('measures the insets from a pixel source rect', () => {
		const result = grid({ x: 0, y: 0, width: 50, height: 50 }, { top: 2, right: 2, bottom: 2, left: 2 }, {
			sourceRect: { x: 16, y: 4, width: 12, height: 8 },
		});
		expect(result.u).toEqual([16 / 32, 18 / 32, 26 / 32, 28 / 32]);
		expect(result.v).toEqual([4 / 16, 6 / 16, 10 / 16, 12 / 16]);
	});

	it('reads a UV source rect in texture space and the insets still in texels', () => {
		const result = grid({ x: 0, y: 0, width: 50, height: 50 }, { top: 2, right: 2, bottom: 2, left: 2 }, {
			sourceRect: { x: 0.5, y: 0, width: 0.5, height: 1 },
			sourceSpace: 'uv',
		});
		expect(result.u).toEqual([0.5, 18 / 32, 30 / 32, 1]);
		expect(result.x).toEqual([0, 2, 48, 50]);
	});

	it('scales every corner by one factor when the destination is smaller than two corners', () => {
		// Width fits 24 of 32 corner pixels (0.75), height fits all of them, so
		// both axes take 0.75 and the corners keep their aspect.
		const result = grid({ x: 0, y: 0, width: 24, height: 100 }, { top: 8, right: 16, bottom: 8, left: 16 });
		expect(result.x).toEqual([0, 12, 12, 24]);
		expect(result.y).toEqual([0, 6, 94, 100]);
		expect(result.columns).toEqual([0, 2]);
		expect(result.cells).toBe(6);
		// The texture side is not scaled: the whole corner is squeezed into the smaller cell.
		expect(result.u).toEqual([0, 0.5, 0.5, 1]);
	});

	it('fits insets that cross inside the source, per axis', () => {
		const result = grid({ x: 0, y: 0, width: 100, height: 100 }, { top: 0, right: 30, bottom: 0, left: 10 });
		// 40 texels of inset in a 32 texel source: scaled by 0.8 to 8 and 24.
		expect(result.u).toEqual([0, 0.25, 0.25, 1]);
		expect(result.x).toEqual([0, 8, 76, 100]);
	});

	it('skips the cells a zero inset leaves without area', () => {
		const result = grid({ x: 0, y: 0, width: 60, height: 30 }, { top: 0, right: 5, bottom: 0, left: 5 });
		expect(result.columns).toEqual([0, 1, 2]);
		expect(result.rows).toEqual([1]);
		expect(result.cells).toBe(3);
	});

	it('treats a negative inset as zero', () => {
		const result = grid({ x: 0, y: 0, width: 60, height: 30 }, { top: -3, right: 0, bottom: 0, left: -1 });
		expect(result.x).toEqual([0, 0, 60, 60]);
		expect(result.y).toEqual([0, 0, 30, 30]);
		expect(result.cells).toBe(1);
	});

	it('mirrors a negative-extent destination as an unsliced draw does, corners unscaled', () => {
		const result = grid({ x: 110, y: 60, width: -100, height: -40 }, { top: 4, right: 8, bottom: 2, left: 6 });
		// Edges run leftward and upward: the left inset lands at the right.
		expect(result.x).toEqual([110, 104, 18, 10]);
		expect(result.y).toEqual([60, 56, 22, 20]);
		expect(result.u).toEqual([0, 6 / 32, 24 / 32, 1]);
		expect(result.cells).toBe(9);
	});

	it('scales corners by the size of a negative extent, not by zero', () => {
		const result = grid({ x: 24, y: 0, width: -24, height: 100 }, { top: 8, right: 16, bottom: 8, left: 16 });
		expect(result.x).toEqual([24, 12, 12, 0]);
		expect(result.cells).toBe(6);
	});

	it('draws nothing for an empty destination', () => {
		expect(grid({ x: 0, y: 0, width: 0, height: 30 }, { top: 4, right: 4, bottom: 4, left: 4 }).cells).toBe(0);
	});
});
