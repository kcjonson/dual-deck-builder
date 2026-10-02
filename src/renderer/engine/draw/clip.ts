import { ClipRect, Mat2D } from './geometry';

/**
 * The three-state clip of R4.2, and the resolved value a command carries.
 *
 * `empty` is a state and not a degenerate rect because R4.2 exists to stop the
 * two from meeting: worldsim's fully hidden nested region became fully
 * unclipped when an empty intersection collapsed into the "no clip" encoding.
 * A discriminated union cannot express that mistake, and `ResolvedClip` below
 * excludes `empty` from the union entirely, so no backend can be written that
 * mistakes one for the other.
 *
 * `none` stays a distinct kind rather than being folded into `UNCLIPPED_RECT`
 * because R3.12's promotion test asks whether a promoted popup emitted with no
 * clip. The rect is what a backend uploads; the kind is what the test reads.
 *
 * Everything here is screen space, logical pixels. The conversion from local
 * space happens once, at push, in the draw API (R4.7).
 */

/**
 * R4.1's all-covering rect, used verbatim rather than as a private encoding so
 * that a draw under `none` and a draw under a clip go down the same path.
 */
export const UNCLIPPED_RECT: ClipRect = {
	minX: -1e8,
	minY: -1e8,
	maxX: 1e8,
	maxY: 1e8,
};

/**
 * R4.14's per-draw rounded-clip parameters. Only the innermost rounded clip is
 * carried; outer rounded clips contribute their bounding rect to the
 * intersection and nothing else, which is the documented approximation.
 */
export interface RoundedClip {
	readonly rect: ClipRect;
	readonly radius: number;
}

export type ClipState =
	| { readonly kind: 'none' }
	| { readonly kind: 'rect'; readonly rect: ClipRect; readonly rounded: RoundedClip | null }
	| { readonly kind: 'empty' };

/** What a command carries. `empty` is not a member: such a draw is dropped. */
export type ResolvedClip = Exclude<ClipState, { kind: 'empty' }>;

export const CLIP_NONE: ClipState = { kind: 'none' };
export const CLIP_EMPTY: ClipState = { kind: 'empty' };

/** The rect a backend uploads for any resolved state (R4.1). */
export function clipRectOf(clip: ResolvedClip): ClipRect {
	return clip.kind === 'none' ? UNCLIPPED_RECT : clip.rect;
}

/**
 * R4.3: nesting is intersection. The degenerate test uses `>=` because R4.4's
 * fragment test is half-open, so a rect whose max is at or below its min keeps
 * nothing and is `empty`, not a zero-area rect that a backend might still
 * upload.
 */
export function intersectClip(
	current: ClipState,
	rect: ClipRect,
	rounded: RoundedClip | null,
	ratio = 1,
): ClipState {
	if (current.kind === 'empty') return CLIP_EMPTY;

	const merged: ClipRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	if (!intersectClipRectInto(current, rect, merged)) return CLIP_EMPTY;

	const inherited = current.kind === 'rect' ? current.rounded : null;
	const kept = keptRoundedClip(merged, rounded, inherited, ratio);
	return { kind: 'rect', rect: merged, rounded: kept === 'nested' ? rounded : kept };
}

/**
 * R4.14's choice of the one rounded clip a level carries, from its merged
 * rect, its own rounded clip, and the one it inherits. A rounded clip that
 * takes nothing off the merged rect (`roundedClipCuts`) is dropped: there it
 * is exactly its bounding rect, which is already in the intersection, so
 * dropping it changes no pixel and spares the second SDF. Of the ones left
 * the innermost wins; `nested` means both cut, so the inherited one degrades
 * to its bounding rect (the documented approximation, and the warning) and
 * the own one is carried.
 */
export function keptRoundedClip<T extends RoundedClip>(
	merged: ClipRect,
	own: T | null,
	inherited: T | null,
	ratio: number,
): T | null | 'nested' {
	const ownCuts = own !== null && roundedClipCuts(own, merged, ratio);
	const inheritedCuts = inherited !== null && roundedClipCuts(inherited, merged, ratio);
	if (ownCuts && inheritedCuts) return 'nested';
	return ownCuts ? own : inheritedCuts ? inherited : null;
}

/**
 * Whether `rounded` takes anything off `rect` at device pixel ratio `ratio`:
 * whether some device pixel centre inside `rect` gets less than full
 * coverage from the shader's one-pixel ramp, which is full at
 * `d <= -0.5 / ratio`. A convex shape's signed distance is convex, so the
 * worst pixel centres are the four corner ones, half a device pixel in from
 * each edge, and testing those is exact for a rect on the device grid.
 */
export function roundedClipCuts(rounded: RoundedClip, rect: ClipRect, ratio: number): boolean {
	if (!(rounded.radius > 0)) return false;
	const half = 0.5 / (ratio > 0 ? ratio : 1);
	const middleX = (rect.minX + rect.maxX) / 2;
	const middleY = (rect.minY + rect.maxY) / 2;
	const left = Math.min(rect.minX + half, middleX);
	const right = Math.max(rect.maxX - half, middleX);
	const top = Math.min(rect.minY + half, middleY);
	const bottom = Math.max(rect.maxY - half, middleY);
	const { rect: box, radius } = rounded;
	return roundedBoxDistance(left, top, box, radius) > -half
		|| roundedBoxDistance(right, top, box, radius) > -half
		|| roundedBoxDistance(left, bottom, box, radius) > -half
		|| roundedBoxDistance(right, bottom, box, radius) > -half;
}

/**
 * `uber.frag`'s `sdRoundedBox` with one radius, clamped to the half extent
 * as the rounded clip table clamps it (R5.5): negative inside, in the box's
 * units.
 */
export function roundedBoxDistance(x: number, y: number, box: ClipRect, radius: number): number {
	return roundedRectDistance(x, y, box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY, radius);
}

/** `roundedBoxDistance` for a rect given by its corner and size. */
export function roundedRectDistance(x: number, y: number, left: number, top: number, width: number, height: number, radius: number): number {
	const halfWidth = width / 2;
	const halfHeight = height / 2;
	const r = Math.max(0, Math.min(radius, halfWidth, halfHeight));
	const qx = Math.abs(x - (left + halfWidth)) - halfWidth + r;
	const qy = Math.abs(y - (top + halfHeight)) - halfHeight + r;
	const outsideX = Math.max(qx, 0);
	const outsideY = Math.max(qy, 0);
	return Math.min(Math.max(qx, qy), 0) + Math.sqrt(outsideX * outsideX + outsideY * outsideY) - r;
}

/**
 * `intersectClip`'s rect arithmetic, into `out`, which the draw API's pooled
 * clip stack shares so the two cannot drift. `current` is `none` or `rect`.
 * False when the result keeps nothing and the state is `empty`.
 */
export function intersectClipRectInto(current: ClipState, rect: ClipRect, out: ClipRect): boolean {
	if (current.kind === 'rect') {
		out.minX = Math.max(current.rect.minX, rect.minX);
		out.minY = Math.max(current.rect.minY, rect.minY);
		out.maxX = Math.min(current.rect.maxX, rect.maxX);
		out.maxY = Math.min(current.rect.maxY, rect.maxY);
	} else {
		out.minX = rect.minX;
		out.minY = rect.minY;
		out.maxX = rect.maxX;
		out.maxY = rect.maxY;
	}
	return out.minX < out.maxX && out.minY < out.maxY;
}

export function hasRoundedClip(state: ClipState): boolean {
	return state.kind === 'rect' && state.rounded !== null;
}

/**
 * R4.14's radius in screen space: the smaller axis scale, so under a
 * non-uniform scale the corner never rounds past the narrower side's arc.
 */
export function clipRadiusScale(matrix: Mat2D): number {
	return Math.min(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3]));
}
