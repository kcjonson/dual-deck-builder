import { HairlineRectOptions, snapClipRect, snapHairlineRect, snapTextOrigin, snapToDevice } from './snapping';
import { devicePixelsFromCss, resolveViewport } from './viewport';

/** Device rows a logical span [top, top + height) covers fully, at `ratio`. */
function deviceRows(top: number, height: number, ratio: number): number[] {
	const rows: number[] = [];
	for (let row = Math.ceil(top * ratio - 1e-9); row + 1 <= (top + height) * ratio + 1e-9; row++) rows.push(row);
	return rows;
}

describe('the logical viewport is defined from the framebuffer (R7.2, R7.5)', () => {
	it('1440 by 882 at ratio 2 is a 2880 by 1764 framebuffer', () => {
		const viewport = resolveViewport({ framebufferWidth: 2880, framebufferHeight: 1764, dpr: 2 });
		expect(viewport).toMatchObject({ width: 1440, height: 882, ratio: 2 });
		// A rect at logical (10, 10) covers device (20, 20).
		expect(10 * viewport.ratio).toBe(20);
	});

	it('UI scale 1.25 at dpr 1 gives the 1152 by 705.6 logical viewport of chapter 7', () => {
		const viewport = resolveViewport({ framebufferWidth: 1440, framebufferHeight: 882, dpr: 1, uiScale: 1.25 });
		expect(viewport.ratio).toBe(1.25);
		expect(viewport.width).toBe(1152);
		expect(viewport.height).toBeCloseTo(705.6, 10);
		// A text run origin snaps to multiples of 0.8 logical pixels.
		expect(snapTextOrigin(10.3, 10.5, viewport.ratio)).toEqual({ x: 10.4, y: 10.4 });
	});

	it('rounds the fallback backing store where assignment used to truncate (R15.4)', () => {
		// 1153 CSS pixels at 1.25 is 1441.25 device pixels.
		expect(devicePixelsFromCss(1153, 1.25)).toBe(1441);
		// 1155 at 1.25 is 1443.75: truncation said 1443.
		expect(devicePixelsFromCss(1155, 1.25)).toBe(1444);
		expect(devicePixelsFromCss(0, 2)).toBe(1);

		const viewport = resolveViewport({ framebufferWidth: 1441, framebufferHeight: 1103, dpr: 1.25 });
		// The projection and the clip rects divide the same device pixels by the same ratio.
		expect(viewport.width * viewport.ratio).toBeCloseTo(1441, 10);
	});

	it('refuses a ratio that would divide by zero', () => {
		expect(() => resolveViewport({ framebufferWidth: 1, framebufferHeight: 1, dpr: 0 })).toThrow(/positive/);
	});
});

/** A hairline the test expects to snap. */
function hairline(options: HairlineRectOptions) {
	const snapped = snapHairlineRect(options);
	if (!snapped) throw new Error('expected the rect to snap');
	return snapped;
}

describe('pixel snapping (R7.7 to R7.8a)', () => {
	it('is exactly Math.round at ratio 1', () => {
		for (const value of [0, 0.5, 1.5, -0.5, 10.4999, 123.5, 7.25]) {
			expect(snapToDevice(value, 1)).toBe(Math.round(value));
		}
	});

	it('snaps to half pixels at ratio 2', () => {
		expect(snapToDevice(10.4, 2)).toBe(10.5);
		expect(snapToDevice(10.2, 2)).toBe(10);
	});

	it('puts a 1 px border at y 10.4 on device rows 21 and 22 at ratio 2', () => {
		const { rect, borderWidth } = hairline({ rect: { x: 0, y: 10.4, width: 100, height: 20 }, borderWidth: 1, ratio: 2 });
		expect(deviceRows(rect.y, borderWidth, 2)).toEqual([21, 22]);
	});

	it('puts the same border on row 10 at ratio 1', () => {
		const { rect, borderWidth } = hairline({ rect: { x: 0, y: 10.4, width: 100, height: 20 }, borderWidth: 1, ratio: 1 });
		expect(deviceRows(rect.y, borderWidth, 1)).toEqual([10]);
	});

	it('snaps a 1.3 px border at ratio 1 to one device row', () => {
		const { borderWidth } = hairline({ rect: { x: 0, y: 0, width: 10, height: 10 }, borderWidth: 1.3, ratio: 1 });
		expect(borderWidth).toBe(1);
	});

	it('moves each edge by under half a device pixel and the size by at most one', () => {
		const rect = { x: 3.3, y: 7.7, width: 50.45, height: 20.2 };
		const snapped = hairline({ rect, borderWidth: 0.5, ratio: 1.5 }).rect;
		expect(Math.abs(snapped.x - rect.x) * 1.5).toBeLessThanOrEqual(0.5);
		expect(Math.abs(snapped.y - rect.y) * 1.5).toBeLessThanOrEqual(0.5);
		expect(Math.abs(snapped.width - rect.width) * 1.5).toBeLessThanOrEqual(1);
		expect(Math.abs(snapped.height - rect.height) * 1.5).toBeLessThanOrEqual(1);
	});

	it('leaves heavy borders and rounded corners to the coverage ramp', () => {
		expect(snapHairlineRect({ rect: { x: 0, y: 0, width: 10, height: 10 }, borderWidth: 2, ratio: 1 })).toBeNull();
		expect(snapHairlineRect({ rect: { x: 0, y: 0, width: 10, height: 10 }, borderWidth: 1, radius: 4, ratio: 1 })).toBeNull();
	});

	it('snaps clip edges so two abutting clips share one device edge', () => {
		const left = snapClipRect({ minX: 0, minY: 0, maxX: 10.3, maxY: 5 }, 2);
		const right = snapClipRect({ minX: 10.3, minY: 0, maxX: 20, maxY: 5 }, 2);
		expect(left.maxX).toBe(right.minX);
		expect(left.maxX * 2).toBe(21);
	});
});
