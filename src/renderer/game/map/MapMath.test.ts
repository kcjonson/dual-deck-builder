import { clamp01, lerp, quantileAbove, smooth01, smoothSlope } from './MapMath';

describe('smooth01', () => {
	it('eases from 0 to 1 over [0, 1], flat at both ends, and holds outside', () => {
		expect(smooth01(0)).toBe(0);
		expect(smooth01(0.5)).toBe(0.5);
		expect(smooth01(1)).toBe(1);
		expect(smooth01(-3)).toBe(0);
		expect(smooth01(7)).toBe(1);
		expect(smooth01(0.25)).toBeCloseTo(0.15625, 15);
		expect(smoothSlope(0)).toBe(0);
		expect(smoothSlope(1)).toBe(0);
		expect(smoothSlope(0.5)).toBe(1.5);
	});

	it('reads NaN as nothing, so a bad value can only switch a feature off', () => {
		expect(smooth01(NaN)).toBe(0);
		expect(smoothSlope(NaN)).toBe(0);
	});
});

describe('lerp and clamp01', () => {
	it('blend between a range\'s ends and hold a value to 0 to 1', () => {
		expect(lerp({ min: 2, max: 6 }, 0.25)).toBe(3);
		expect(clamp01(-0.5)).toBe(0);
		expect(clamp01(0.3)).toBe(0.3);
		expect(clamp01(1.5)).toBe(1);
	});
});

describe('quantileAbove', () => {
	it('is the value the share of values lies at or above, infinite at the ends', () => {
		const values = [5, 1, 4, 2, 3, 0, 9, 8, 7, 6];
		expect(quantileAbove(values, 0.3)).toBe(7);
		expect(values.filter((value) => value >= quantileAbove(values, 0.3))).toHaveLength(3);
		expect(quantileAbove(values, 0)).toBe(Infinity);
		expect(quantileAbove(values, 1)).toBe(-Infinity);
		expect(quantileAbove([], 0.5)).toBe(Infinity);
	});

	it('leaves the values it reads alone', () => {
		const values = Float64Array.of(3, 1, 2);
		quantileAbove(values, 0.5);
		expect(Array.from(values)).toEqual([3, 1, 2]);
	});
});
