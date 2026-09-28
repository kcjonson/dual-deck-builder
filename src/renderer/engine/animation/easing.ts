/** A CSS `cubic-bezier(x1, y1, x2, y2)`, the shape of the motion tokens' eases (R11.13). */
export type CubicBezierPoints = readonly [number, number, number, number];

/** Maps linear progress in [0, 1] to eased progress; 0 and 1 map to themselves. */
export type EaseFunction = (progress: number) => number;

export type Ease = CubicBezierPoints | EaseFunction;

export const linear: EaseFunction = (progress) => progress;

const NEWTON_ITERATIONS = 8;
const BISECTION_ITERATIONS = 32;
const EPSILON = 1e-7;

/**
 * The curve as CSS evaluates it: solve x(t) = progress for the curve parameter
 * t, then return y(t). Newton's method converges in a few steps on the usual
 * curves; bisection catches the flat spots where the slope is near zero.
 */
export function cubicBezier([x1, y1, x2, y2]: CubicBezierPoints): EaseFunction {
	if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
		throw new Error(`cubicBezier: x control points must be in [0, 1], got ${x1} and ${x2}`);
	}
	if (x1 === y1 && x2 === y2) return linear;

	// Polynomial coefficients of each axis, from the control points with
	// P0 = (0, 0) and P3 = (1, 1).
	const cx = 3 * x1;
	const bx = 3 * (x2 - x1) - cx;
	const ax = 1 - cx - bx;
	const cy = 3 * y1;
	const by = 3 * (y2 - y1) - cy;
	const ay = 1 - cy - by;

	const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
	const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
	const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;

	const solveT = (x: number): number => {
		let t = x;
		for (let i = 0; i < NEWTON_ITERATIONS; i++) {
			const error = sampleX(t) - x;
			if (Math.abs(error) < EPSILON) return t;
			const slope = slopeX(t);
			if (Math.abs(slope) < EPSILON) break;
			t -= error / slope;
		}
		let low = 0;
		let high = 1;
		t = x;
		for (let i = 0; i < BISECTION_ITERATIONS; i++) {
			const sample = sampleX(t);
			if (Math.abs(sample - x) < EPSILON) return t;
			if (sample < x) low = t;
			else high = t;
			t = (low + high) / 2;
		}
		return t;
	};

	return (progress) => {
		if (progress <= 0) return 0;
		if (progress >= 1) return 1;
		return sampleY(solveT(progress));
	};
}

const curves = new WeakMap<CubicBezierPoints, EaseFunction>();

/**
 * Resolves an ease to a function, building each control-point curve once: the
 * tokens are shared arrays, so every tween on `ease_standard` reuses one.
 */
export function resolveEase(ease: Ease): EaseFunction {
	if (typeof ease === 'function') return ease;
	let curve = curves.get(ease);
	if (!curve) {
		curve = cubicBezier(ease);
		curves.set(ease, curve);
	}
	return curve;
}
