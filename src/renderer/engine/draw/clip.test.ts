import {
	CLIP_EMPTY,
	CLIP_NONE,
	ClipState,
	UNCLIPPED_RECT,
	clipRectOf,
	hasRoundedClip,
	intersectClip,
	intersectClipRectInto,
	keptRoundedClip,
	roundedBoxDistance,
	roundedClipCuts,
} from './clip';
import { ClipRect } from './geometry';

const rect = (minX: number, minY: number, maxX: number, maxY: number): ClipRect => ({
	minX,
	minY,
	maxX,
	maxY,
});

describe('clip (R4.2, R4.3, R4.14)', () => {
	it('takes the pushed rect when nothing is clipping yet', () => {
		const state = intersectClip(CLIP_NONE, rect(0, 0, 100, 100), null);
		expect(state).toEqual({ kind: 'rect', rect: rect(0, 0, 100, 100), rounded: null });
	});

	it('intersects a nested rect with its parent', () => {
		const outer = intersectClip(CLIP_NONE, rect(0, 0, 100, 100), null);
		const inner = intersectClip(outer, rect(50, 50, 200, 200), null);
		expect(inner).toEqual({ kind: 'rect', rect: rect(50, 50, 100, 100), rounded: null });
	});

	it('takes the tighter edge on every side, so a wider child cannot widen its parent', () => {
		const outer = intersectClip(CLIP_NONE, rect(20, 30, 80, 90), null);
		const inner = intersectClip(outer, rect(-500, -500, 500, 500), null);
		expect(inner).toEqual({ kind: 'rect', rect: rect(20, 30, 80, 90), rounded: null });
	});

	it('yields empty for a disjoint intersection', () => {
		const outer = intersectClip(CLIP_NONE, rect(0, 0, 100, 100), null);
		expect(intersectClip(outer, rect(200, 200, 300, 300), null)).toEqual(CLIP_EMPTY);
	});

	it('yields empty for a zero-area intersection, because R4.4 is half-open', () => {
		const outer = intersectClip(CLIP_NONE, rect(0, 0, 100, 100), null);
		expect(intersectClip(outer, rect(100, 0, 200, 100), null)).toEqual(CLIP_EMPTY);
	});

	it('stays empty under any later push and never collapses to none', () => {
		const nested = intersectClip(CLIP_EMPTY, rect(-1000, -1000, 1000, 1000), null);
		expect(nested).toEqual(CLIP_EMPTY);
	});

	it('gives an unclipped draw R4.1 all-covering rect', () => {
		expect(clipRectOf(CLIP_NONE as Exclude<ClipState, { kind: 'empty' }>)).toEqual(UNCLIPPED_RECT);
	});

	it('intersects in place with the same arithmetic, the half-open edge included', () => {
		const outer = intersectClip(CLIP_NONE, rect(0, 0, 100, 100), null);
		const out = rect(0, 0, 0, 0);
		expect(intersectClipRectInto(outer, rect(50, -10, 200, 60), out)).toBe(true);
		expect(out).toEqual(rect(50, 0, 100, 60));
		expect(intersectClipRectInto(outer, rect(100, 0, 200, 100), out)).toBe(false);
		expect(intersectClipRectInto(CLIP_NONE, rect(5, 6, 7, 8), out)).toBe(true);
		expect(out).toEqual(rect(5, 6, 7, 8));
	});

	describe('rounded nesting (R4.14)', () => {
		const rounded = { rect: rect(0, 0, 100, 100), radius: 8 };

		it('carries the rounded parameters of the only rounded clip', () => {
			const state = intersectClip(CLIP_NONE, rounded.rect, rounded);
			expect(hasRoundedClip(state)).toBe(true);
			expect(state).toEqual({ kind: 'rect', rect: rect(0, 0, 100, 100), rounded });
		});

		it('keeps the innermost radius and lets the outer contribute only its rect', () => {
			const outer = intersectClip(CLIP_NONE, rounded.rect, rounded);
			const innerRounded = { rect: rect(10, 10, 60, 60), radius: 3 };
			const inner = intersectClip(outer, innerRounded.rect, innerRounded);
			expect(inner).toEqual({ kind: 'rect', rect: rect(10, 10, 60, 60), rounded: innerRounded });
		});

		it('keeps an ancestor radius through a plain rect push that reaches its corner', () => {
			const outer = intersectClip(CLIP_NONE, rounded.rect, rounded);
			const inner = intersectClip(outer, rect(0, 4, 40, 40), null);
			expect(inner).toEqual({ kind: 'rect', rect: rect(0, 4, 40, 40), rounded });
			const corner = intersectClip(outer, rect(-10, -10, 40, 40), null);
			expect(corner).toEqual({ kind: 'rect', rect: rect(0, 0, 40, 40), rounded });
		});

		it('drops an ancestor radius where the merged rect is clear of its corners, which is exact', () => {
			const outer = intersectClip(CLIP_NONE, rounded.rect, rounded);
			expect(intersectClip(outer, rect(20, 20, 40, 40), null)).toEqual({ kind: 'rect', rect: rect(20, 20, 40, 40), rounded: null });
			// The corner pixel centre (2.5, 2.5) is 7.78 from the arc's centre (8, 8): 0.22 inside, within the half-pixel ramp.
			expect(intersectClip(outer, rect(2, 2, 40, 40), null)).toEqual({ kind: 'rect', rect: rect(2, 2, 40, 40), rounded });
			// (3.5, 3.5) is 6.36 from it, 1.64 inside, past the half-pixel ramp.
			expect(intersectClip(outer, rect(3, 3, 40, 40), null)).toEqual({ kind: 'rect', rect: rect(3, 3, 40, 40), rounded: null });
		});

		it('drops a rounded clip of radius 0, and its own radius when a smaller outer rect keeps it off the corners', () => {
			const square = { rect: rect(0, 0, 100, 100), radius: 0 };
			expect(intersectClip(CLIP_NONE, square.rect, square)).toEqual({ kind: 'rect', rect: square.rect, rounded: null });
			const outer = intersectClip(CLIP_NONE, rect(20, 20, 80, 80), null);
			expect(intersectClip(outer, rounded.rect, rounded)).toEqual({ kind: 'rect', rect: rect(20, 20, 80, 80), rounded: null });
		});

		it('reports nesting only when both rounded clips cut the merged rect', () => {
			const inner = { rect: rect(0, 0, 50, 50), radius: 4 };
			expect(keptRoundedClip(rect(0, 0, 50, 50), inner, rounded, 1)).toBe('nested');
			const clear = { rect: rect(20, 20, 50, 50), radius: 4 };
			expect(keptRoundedClip(rect(20, 20, 50, 50), clear, rounded, 1)).toBe(clear);
		});

		it('measures the ramp in device pixels: a higher ratio keeps a radius a lower one drops', () => {
			const seven = { rect: rect(0, 0, 100, 100), radius: 7 };
			const merged = rect(2, 2, 40, 40);
			// Ratio 1: the corner pixel centre (2.5, 2.5) is 0.64 inside the arc, at full coverage.
			expect(roundedClipCuts(seven, merged, 1)).toBe(false);
			// Ratio 4: (2.125, 2.125) is 0.11 inside, within the quarter-pixel ramp.
			expect(roundedClipCuts(seven, merged, 4)).toBe(true);
		});

		it('tests the pixel centres a rect off the device grid actually keeps', () => {
			// The first centre inside x >= 2.2 is 2.5, 0.22 inside the arc: partial coverage.
			expect(roundedClipCuts(rounded, rect(2.2, 2.2, 40, 40), 1)).toBe(true);
			// A rect holding no pixel centre has nothing to cut.
			expect(roundedClipCuts(rounded, rect(0.6, 0.6, 1.4, 1.4), 1)).toBe(false);
		});

		it('matches the shader\'s rounded box distance', () => {
			const box = rect(0, 0, 100, 50);
			expect(roundedBoxDistance(50, 25, box, 10)).toBe(-25);
			expect(roundedBoxDistance(0, 25, box, 10)).toBe(0);
			expect(roundedBoxDistance(0, 0, box, 10)).toBeCloseTo(10 * Math.SQRT2 - 10);
			// The radius clamps to the half extent (R5.5).
			expect(roundedBoxDistance(50, 0, box, 1000)).toBeCloseTo(0);
		});
	});
});
