import { ClipRect, Rect, transformBoxInto } from '../draw/geometry';
import type { Component } from './Component';

/** R12.20's two placements for what a scroller brings into view. */
export type ScrollBlock = 'nearest' | 'center';

/**
 * What a scroller is asked to bring into view (R12.20), in its content
 * space, where its children sit before the scroll moves them.
 */
export interface RevealRequest {
	/** The component's content box. */
	box: Rect;
	/** What it draws now, the box included; the box when absent. */
	ink?: Rect;
	block?: ScrollBlock;
}

export interface RevealOptions {
	block?: ScrollBlock;
	/** The one ancestor that scrolls; absent, every scroller from the component up does, innermost first. */
	scroller?: Component;
}

/** A stretch of one axis, from `start` to `end`. */
export interface Span {
	start: number;
	end: number;
}

export interface RevealDeltaOptions {
	/** The component's content box. */
	box: Span;
	/** What it draws now, which may reach past the box on either side. */
	ink: Span;
	/** What the scroller shows: its clip. */
	view: Span;
	block: ScrollBlock;
}

/** In logical pixels: closer than this, a reveal is where it should be, so rounding never moves a settled view. */
export const REVEAL_EPSILON = 1e-6;

/**
 * R12.20's walk: brings `component`'s box and `revealInk` into view in its
 * scrolling ancestors, innermost first, or in `scroller` alone. Both are
 * carried up a level at a time, through each transform, origin, and content
 * offset, so every ancestor gets them in its content space, and each clip on
 * the way cuts them to what it lets through: an outer scroller never scrolls
 * for ink an inner clip hides, and once a clip has cut the box away nothing
 * further up can bring it back. Past a promoted layer the walk goes on, since
 * the layer still moves with every scroller above it, but the clips above no
 * longer cut it: a promotion resets the clip (R4.8).
 */
export function revealInAncestors(component: Component, { block = 'nearest', scroller }: RevealOptions = {}): void {
	const box: ClipRect = { minX: 0, minY: 0, maxX: component.width, maxY: component.height };
	const drawn = component.revealInk;
	// Ink it can't measure counts as no bound, so the box still shows
	const ink: ClipRect = drawn === null || !isFiniteRect(drawn) ? { ...box } : {
		minX: Math.min(drawn.x, box.minX),
		minY: Math.min(drawn.y, box.minY),
		maxX: Math.max(drawn.x + drawn.width, box.maxX),
		maxY: Math.max(drawn.y + drawn.height, box.maxY),
	};
	let clipped = true;
	for (let node = component, parent = node.parent; parent; node = parent, parent = parent.parent) {
		if (node.promoted) clipped = false;
		lift(node, box);
		lift(node, ink);
		if (!scroller || parent === scroller) parent.scrollRectIntoView({ box: rectOf(box), ink: rectOf(ink), block });
		if (parent === scroller) return;
		const offset = parent.contentOffset;
		shift(box, -offset.x, -offset.y);
		shift(ink, -offset.x, -offset.y);
		if (!clipped || !parent.clipsChildren) continue;
		const clip = parent.clipRect;
		cut(box, clip);
		if (box.minX > box.maxX || box.minY > box.maxY) return;
		cut(ink, clip);
	}
}

/**
 * R12.20's rule along one axis, worded here for y: how far to scroll so
 * `view` shows `box` and `ink`, the ink counted as at least the box, all
 * three in one space where scrolling by `d` moves the content by `-d`. Never
 * a non-finite number, and 0, not a rounding error, when nothing needs to move.
 */
export function revealDelta({ box, ink, view, block }: RevealDeltaOptions): number {
	// The sum is non-finite when any term is, so one test catches a NaN or an infinity anywhere.
	if (!Number.isFinite(box.start + box.end + ink.start + ink.end + view.start + view.end)) return 0;
	const room = view.end - view.start;
	const size = box.end - box.start;
	const inkStart = Math.min(ink.start, box.start);
	const inkEnd = Math.max(ink.end, box.end);
	const boxCentred = (box.start + box.end - view.start - view.end) / 2;
	let delta: number;
	if (inkEnd - inkStart <= room + REVEAL_EPSILON) {
		// Every delta from `least` to `most` shows all of the ink: nearest
		// stays put if it can, center starts from the box centred.
		const least = inkEnd - view.end;
		const most = inkStart - view.start;
		delta = Math.min(Math.max(block === 'center' ? boxCentred : 0, least), most);
	} else if (size <= room + REVEAL_EPSILON) {
		// The box whole, with half the slack above it, or all of the ink
		// above when that needs less, or more when the ink below does.
		const slack = Math.max(room - size, 0);
		const lead = Math.min(box.start - inkStart, Math.max(slack - (inkEnd - box.end), slack / 2));
		delta = box.start - lead - view.start;
	} else if (block === 'center') {
		delta = boxCentred;
	} else {
		// The top at the view's top, under the ink above it unless that would hide the top.
		const above = box.start - inkStart;
		delta = box.start - (above < room - REVEAL_EPSILON ? above : 0) - view.start;
	}
	return Number.isFinite(delta) && Math.abs(delta) >= REVEAL_EPSILON ? delta : 0;
}

/** From `node`'s content box into its parent's content space: its transform, then its origin. */
function lift(node: Component, box: ClipRect): void {
	const matrix = node.transformMatrix;
	if (matrix) transformBoxInto(matrix, box.minX, box.minY, box.maxX, box.maxY, box);
	shift(box, node.originX, node.originY);
}

function shift(box: ClipRect, dx: number, dy: number): void {
	box.minX += dx;
	box.maxX += dx;
	box.minY += dy;
	box.maxY += dy;
}

/** What of `box` lies inside `clip`; inverted on an axis where nothing does. */
function cut(box: ClipRect, clip: Rect): void {
	box.minX = Math.max(box.minX, clip.x);
	box.minY = Math.max(box.minY, clip.y);
	box.maxX = Math.min(box.maxX, clip.x + clip.width);
	box.maxY = Math.min(box.maxY, clip.y + clip.height);
}

function rectOf(box: ClipRect): Rect {
	return { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY };
}

function isFiniteRect({ x, y, width, height }: Rect): boolean {
	return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height);
}
