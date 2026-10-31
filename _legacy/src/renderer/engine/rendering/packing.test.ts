import { fromHalf, toHalf, toUnorm8 } from './packing';

describe('toHalf', () => {
	it.each([
		[0, 0x0000],
		[-0, 0x8000],
		[1, 0x3c00],
		[-2, 0xc000],
		[0.5, 0x3800],
		[65504, 0x7bff],
		[2 ** -14, 0x0400],
		[2 ** -24, 0x0001],
	])('encodes %p exactly', (value, bits) => {
		expect(toHalf(value)).toBe(bits);
		expect(fromHalf(bits)).toBe(value);
	});

	it('keeps the values the uber shader carries in half floats exact', () => {
		// Border widths, snapped hairlines at ratios 1 to 3, style radii, blur.
		for (const value of [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 12, 12.5, 24, 0.25, 0.75, 1 / 1024, 8 / 512]) {
			expect(fromHalf(toHalf(value))).toBe(value);
		}
	});

	it('rounds to the nearest half float, ties to even', () => {
		// Between 1 and 2 the step is 1/1024.
		expect(fromHalf(toHalf(1 + 0.4 / 1024))).toBe(1);
		expect(fromHalf(toHalf(1 + 0.6 / 1024))).toBe(1 + 1 / 1024);
		expect(fromHalf(toHalf(1 + 0.5 / 1024))).toBe(1);
		expect(fromHalf(toHalf(1 + 1.5 / 1024))).toBe(1 + 2 / 1024);
		// A carry out of the mantissa moves to the next binade.
		expect(fromHalf(toHalf(2 - 0.25 / 1024))).toBe(2);
	});

	it('is within half a step of any value in range', () => {
		for (let index = 0; index < 2000; index++) {
			const value = (index * 7.31) % 900 + index / 997;
			const step = 2 ** (Math.floor(Math.log2(value)) - 10);
			expect(Math.abs(fromHalf(toHalf(value)) - value)).toBeLessThanOrEqual(step / 2);
		}
	});

	it('rounds subnormals and flushes what is below them to zero', () => {
		expect(toHalf(1.4 * 2 ** -24)).toBe(0x0001);
		expect(toHalf(2 ** -26)).toBe(0x0000);
		expect(toHalf(-3 * 2 ** -24)).toBe(0x8003);
	});

	it('overflows to infinity and keeps NaN', () => {
		expect(toHalf(70000)).toBe(0x7c00);
		expect(toHalf(-Infinity)).toBe(0xfc00);
		expect(Number.isNaN(fromHalf(toHalf(NaN)))).toBe(true);
	});
});

describe('toUnorm8', () => {
	it('rounds to the nearest of 256 levels and clamps', () => {
		expect(toUnorm8(0)).toBe(0);
		expect(toUnorm8(1)).toBe(255);
		expect(toUnorm8(0.5)).toBe(128);
		expect(toUnorm8(40 / 255)).toBe(40);
		expect(toUnorm8(-0.1)).toBe(0);
		expect(toUnorm8(1.2)).toBe(255);
		expect(toUnorm8(NaN)).toBe(0);
	});

	it('breaks a float32 tie to even, as the framebuffer write does', () => {
		// 0.3 * 255 is 76.5 in float32: an opaque 0.3 was always written as 76.
		expect(toUnorm8(0.3)).toBe(76);
		expect(toUnorm8(0.5)).toBe(128);
		expect(toUnorm8(1.5 / 255)).toBe(2);
		expect(toUnorm8(2.5 / 255)).toBe(2);
	});
});
