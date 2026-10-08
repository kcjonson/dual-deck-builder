import { StepRange, decimalsOf, snapToStep } from './stepGrid';

describe('snapToStep', () => {
	const tenths: StepRange = { min: 0, max: 1, step: 0.1 };

	it('snaps to the nearest step from min, clamped to the range', () => {
		expect(snapToStep(tenths, 0.34)).toBe(0.3);
		expect(snapToStep(tenths, 0.36)).toBe(0.4);
		expect(snapToStep(tenths, 1.4)).toBe(1);
		expect(snapToStep(tenths, -0.2)).toBe(0);
		expect(snapToStep({ min: 5, max: 20, step: 5 }, 12)).toBe(10);
		expect(snapToStep({ min: 1, max: 9, step: 2 }, 4.2)).toBe(5);
	});

	it('leaves no float noise on a decimal step', () => {
		expect(snapToStep(tenths, 0.29)).toBe(0.3);
		expect(snapToStep({ min: 0.1, max: 0.9, step: 0.05 }, 0.351)).toBe(0.35);
		expect(snapToStep({ min: 0.08, max: 0.25, step: 0.01 }, 0.1749)).toBe(0.17);
		expect(snapToStep({ min: 0, max: 1, step: 1e-7 }, 3.4e-7)).toBe(3e-7);
	});

	it('only clamps when continuous', () => {
		expect(snapToStep({ min: 0, max: 100, step: 0 }, 12.345)).toBe(12.345);
		expect(snapToStep({ min: 0, max: 100, step: 0 }, 150)).toBe(100);
	});

	it('gives min for a value that isn\'t a number, and min for a range whose max is below it', () => {
		expect(snapToStep(tenths, Number.NaN)).toBe(0);
		expect(snapToStep(tenths, Number.POSITIVE_INFINITY)).toBe(0);
		expect(snapToStep({ min: 5, max: 2, step: 1 }, 9)).toBe(5);
	});

	it('keeps every digit of a step written with an exponent', () => {
		expect(snapToStep({ min: 0, max: 1, step: 1.125e-7 }, 1.2e-7)).toBe(1.125e-7);
		expect(snapToStep({ min: 0, max: 1, step: 1.5e-7 }, 3.1e-7)).toBe(3e-7);
	});

	it('snaps on a step finer than toFixed can write', () => {
		expect(snapToStep({ min: 0, max: 1, step: 1e-99 }, 0.5)).toBeCloseTo(0.5, 12);
	});
});

describe('decimalsOf', () => {
	it.each([
		[5, 0],
		[50, 0],
		[0.5, 1],
		[0.25, 2],
		[0.05, 2],
		[0.01, 2],
		[1e-7, 7],
		[1.5e-7, 8],
		[1.125e-7, 10],
		[1e21, 0],
		[1.5e21, 0],
	])('gives %p %p decimal places', (step, places) => {
		expect(decimalsOf(step)).toBe(places);
	});
});
