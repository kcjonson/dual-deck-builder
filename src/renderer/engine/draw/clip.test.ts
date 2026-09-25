import {
	CLIP_EMPTY,
	CLIP_NONE,
	ClipState,
	UNCLIPPED_RECT,
	clipRectOf,
	hasRoundedClip,
	intersectClip,
	resolveClip,
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
		expect(resolveClip(nested)).toBeNull();
	});

	it('drops the draw for empty and keeps the kind for none', () => {
		expect(resolveClip(CLIP_EMPTY)).toBeNull();
		expect(resolveClip(CLIP_NONE)).toEqual({ kind: 'none' });
	});

	it('gives an unclipped draw R4.1 all-covering rect', () => {
		const resolved = resolveClip(CLIP_NONE);
		expect(resolved).not.toBeNull();
		expect(clipRectOf(resolved as Exclude<ClipState, { kind: 'empty' }>)).toEqual(UNCLIPPED_RECT);
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

		it('keeps an ancestor radius through a plain rect push', () => {
			const outer = intersectClip(CLIP_NONE, rounded.rect, rounded);
			const inner = intersectClip(outer, rect(20, 20, 40, 40), null);
			expect(inner).toEqual({ kind: 'rect', rect: rect(20, 20, 40, 40), rounded });
		});
	});
});
