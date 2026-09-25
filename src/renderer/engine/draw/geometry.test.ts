import {
	IDENTITY,
	concat,
	copyColor,
	copyRect,
	copyVec2,
	inflate,
	intersects,
	isTranslateOnly,
	transformPoint,
	transformedBounds,
	translation,
} from './geometry';

describe('geometry', () => {
	it('concatenates outer after inner, so a child translate lands in the parent frame', () => {
		const parent = translation(100, 50);
		const child = translation(10, 5);
		expect(concat(parent, child)).toEqual([1, 0, 0, 1, 110, 55]);
	});

	it('scales a nested translate by the enclosing scale', () => {
		const scale = concat(IDENTITY, [2, 0, 0, 2, 0, 0]);
		expect(concat(scale, translation(10, 10))).toEqual([2, 0, 0, 2, 20, 20]);
	});

	it('transforms a point through the 2x3 in DOMMatrix order', () => {
		expect(transformPoint([0, 1, -1, 0, 5, 5], 10, 0)).toEqual({ x: 5, y: 15 });
	});

	describe('isTranslateOnly (R2.4)', () => {
		it('accepts any pure translation', () => {
			expect(isTranslateOnly(translation(-40, 900))).toBe(true);
		});

		it('rejects a scale and a rotation', () => {
			expect(isTranslateOnly([2, 0, 0, 2, 0, 0])).toBe(false);
			expect(isTranslateOnly([0, 1, -1, 0, 0, 0])).toBe(false);
		});

		it('is true again for a scale composed with its own inverse', () => {
			const composed = concat([2, 0, 0, 2, 0, 0], [0.5, 0, 0, 0.5, 0, 0]);
			expect(isTranslateOnly(composed)).toBe(true);
		});
	});

	describe('transformedBounds (R4.7)', () => {
		it('is exact under a translation', () => {
			const bounds = transformedBounds(translation(100, 200), { x: 10, y: 20, width: 30, height: 40 });
			expect(bounds).toEqual({ minX: 110, minY: 220, maxX: 140, maxY: 260 });
		});

		it('is the axis-aligned hull of the four corners under a rotation', () => {
			const quarterTurn = [0, 1, -1, 0, 0, 0] as const;
			const bounds = transformedBounds(quarterTurn, { x: 0, y: 0, width: 10, height: 4 });
			expect(bounds).toEqual({ minX: -4, minY: 0, maxX: 0, maxY: 10 });
		});
	});

	it('inflates on every side', () => {
		expect(inflate({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 2)).toEqual({
			minX: -2,
			minY: -2,
			maxX: 12,
			maxY: 12,
		});
	});

	describe('intersects', () => {
		it('is true for overlapping rects', () => {
			expect(
				intersects({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: 9, minY: 9, maxX: 20, maxY: 20 }),
			).toBe(true);
		});

		it('is false for rects that merely touch, matching R4.4 half-open edges', () => {
			expect(
				intersects({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: 10, minY: 0, maxX: 20, maxY: 10 }),
			).toBe(false);
		});
	});

	describe('copies', () => {
		it('detaches a rect from the caller so a reused object cannot rewrite a command', () => {
			const source = { x: 1, y: 2, width: 3, height: 4 };
			const copy = copyRect(source);
			source.x = 99;
			expect(copy.x).toBe(1);
		});

		it('detaches a point and a colour', () => {
			const point = { x: 1, y: 2 };
			const color: [number, number, number, number] = [0.1, 0.2, 0.3, 1];
			const copiedPoint = copyVec2(point);
			const copiedColor = copyColor(color);
			point.y = 99;
			color[3] = 0;
			expect(copiedPoint).toEqual({ x: 1, y: 2 });
			expect(copiedColor).toEqual([0.1, 0.2, 0.3, 1]);
		});
	});
});
