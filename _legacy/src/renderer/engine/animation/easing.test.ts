import { tokens } from '../theme/tokens';
import { cubicBezier, linear, resolveEase } from './easing';

describe('cubicBezier', () => {
	it('pins the ends and returns linear for a straight curve', () => {
		const ease = cubicBezier([0.4, 0, 0.2, 1]);
		expect(ease(0)).toBe(0);
		expect(ease(1)).toBe(1);
		expect(ease(-0.5)).toBe(0);
		expect(ease(1.5)).toBe(1);
		expect(cubicBezier([0.25, 0.25, 0.75, 0.75])).toBe(linear);
	});

	it('agrees with a plain bisection solve of the standard ease', () => {
		// Reference values from solving x(t) by 100 rounds of bisection.
		const ease = cubicBezier([0.4, 0, 0.2, 1]);
		expect(ease(0.25)).toBeCloseTo(0.236587, 5);
		expect(ease(0.5)).toBeCloseTo(0.775561, 5);
		expect(ease(0.75)).toBeCloseTo(0.959368, 5);
	});

	it('is monotonic for the token curves', () => {
		for (const points of [tokens.motion.ease_standard, tokens.motion.ease_emphasized]) {
			const ease = cubicBezier(points);
			let previous = 0;
			for (let step = 1; step <= 100; step++) {
				const value = ease(step / 100);
				expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
				previous = value;
			}
		}
	});

	it('rejects x control points outside [0, 1]', () => {
		expect(() => cubicBezier([1.2, 0, 0.2, 1])).toThrow('x control points');
	});
});

describe('resolveEase', () => {
	it('builds each control-point array once and passes functions through', () => {
		expect(resolveEase(tokens.motion.ease_standard)).toBe(resolveEase(tokens.motion.ease_standard));
		const custom = (progress: number): number => progress * progress;
		expect(resolveEase(custom)).toBe(custom);
	});
});
