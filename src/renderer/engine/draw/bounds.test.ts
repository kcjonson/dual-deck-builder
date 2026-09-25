import { circleInk, lineInk, pointsInk, rectInk, screenInk, shadowInk } from './bounds';
import { IDENTITY, Rect, translation } from './geometry';

const RED = [1, 0, 0, 1] as const;

/** A bound is only useful if it never sits inside the shape it describes. */
function contains(outer: Rect, inner: Rect): boolean {
	return (
		outer.x <= inner.x &&
		outer.y <= inner.y &&
		outer.x + outer.width >= inner.x + inner.width &&
		outer.y + outer.height >= inner.y + inner.height
	);
}

describe('bounds (R4.2a)', () => {
	const shape: Rect = { x: 10, y: 20, width: 30, height: 40 };

	describe('rectInk', () => {
		it('is the rect itself with no border', () => {
			expect(rectInk(shape, undefined)).toEqual(shape);
		});

		it('ignores an inside border, which occupies the shape interior (R5.7)', () => {
			expect(rectInk(shape, { color: RED, width: 4, position: 'inside' })).toEqual(shape);
		});

		it('grows by half the width for a centre border and the full width for an outside one', () => {
			expect(rectInk(shape, { color: RED, width: 4, position: 'center' })).toEqual({
				x: 8,
				y: 18,
				width: 34,
				height: 44,
			});
			expect(rectInk(shape, { color: RED, width: 4, position: 'outside' })).toEqual({
				x: 6,
				y: 16,
				width: 38,
				height: 48,
			});
		});
	});

	describe('shadowInk (R5.11)', () => {
		it('offsets, spreads, and pads by three sigma', () => {
			const ink = shadowInk(shape, { color: RED, blur: 8, spread: 2, offset: { x: 0, y: 4 } });
			// pad = spread 2 + blur 8 * 1.5 = 14
			expect(ink).toEqual({ x: -4, y: 10, width: 58, height: 68 });
			expect(contains(ink, { ...shape, y: shape.y + 4 })).toBe(true);
		});

		it('is the owner rect when every shadow field is defaulted', () => {
			expect(shadowInk(shape, { color: RED })).toEqual(shape);
		});
	});

	it('bounds a circle by its radius plus any outward border', () => {
		expect(circleInk({ x: 50, y: 50 }, 10, { color: RED, width: 2, position: 'outside' })).toEqual({
			x: 38,
			y: 38,
			width: 24,
			height: 24,
		});
	});

	it('bounds a line by half its width on every side, which covers a round cap', () => {
		expect(lineInk({ x: 0, y: 0 }, { x: 100, y: 0 }, 6)).toEqual({
			x: -3,
			y: -3,
			width: 106,
			height: 6,
		});
	});

	describe('pointsInk', () => {
		it('is the hull of the points for a filled polygon', () => {
			const ink = pointsInk([{ x: 5, y: 5 }, { x: 25, y: 9 }, { x: 12, y: 30 }], 0);
			expect(ink).toEqual({ x: 5, y: 5, width: 20, height: 25 });
		});

		it('takes the extremes wherever they fall in the list', () => {
			const ink = pointsInk([{ x: 10, y: 10 }, { x: -5, y: 40 }, { x: 30, y: -2 }], 0);
			expect(ink).toEqual({ x: -5, y: -2, width: 35, height: 42 });
		});

		it('grows the hull by half a stroke width for a polyline', () => {
			expect(pointsInk([{ x: 0, y: 0 }, { x: 10, y: 0 }], 4)).toEqual({
				x: -2,
				y: -2,
				width: 14,
				height: 4,
			});
		});

		it('has no bound at all for an empty point list, so nothing is culled on a guess', () => {
			expect(pointsInk([], 2)).toBeNull();
		});
	});

	describe('screenInk', () => {
		it('inflates by one device pixel for R5.7 coverage', () => {
			expect(screenInk(shape, IDENTITY, 1)).toEqual({ minX: 9, minY: 19, maxX: 41, maxY: 61 });
		});

		it('inflates by less at a higher ratio, because a device pixel is smaller', () => {
			expect(screenInk(shape, IDENTITY, 2)).toEqual({ minX: 9.5, minY: 19.5, maxX: 40.5, maxY: 60.5 });
		});

		it('applies the transform before the inflation', () => {
			expect(screenInk(shape, translation(100, 200), 1)).toEqual({
				minX: 109,
				minY: 219,
				maxX: 141,
				maxY: 261,
			});
		});
	});
});
