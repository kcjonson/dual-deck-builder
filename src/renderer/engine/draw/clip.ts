import { ClipRect } from './geometry';

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

export function resolveClip(state: ClipState): ResolvedClip | null {
	return state.kind === 'empty' ? null : state;
}

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
): ClipState {
	if (current.kind === 'empty') return CLIP_EMPTY;

	const merged: ClipRect =
		current.kind === 'rect'
			? {
					minX: Math.max(current.rect.minX, rect.minX),
					minY: Math.max(current.rect.minY, rect.minY),
					maxX: Math.min(current.rect.maxX, rect.maxX),
					maxY: Math.min(current.rect.maxY, rect.maxY),
				}
			: rect;

	if (merged.minX >= merged.maxX || merged.minY >= merged.maxY) return CLIP_EMPTY;

	// R4.14: the innermost rounded clip wins; an outer one has already
	// contributed its bounding rect through `merged`.
	const innermost = rounded ?? (current.kind === 'rect' ? current.rounded : null);
	return { kind: 'rect', rect: merged, rounded: innermost };
}

export function hasRoundedClip(state: ClipState): boolean {
	return state.kind === 'rect' && state.rounded !== null;
}
