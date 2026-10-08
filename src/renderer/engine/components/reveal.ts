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
	const ink: ClipRect = drawn === null ? { ...box } : {
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
