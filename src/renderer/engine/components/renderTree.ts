import { SUBTREE_INK_OUTSET } from '../draw/bounds';
import type { DrawApi } from '../draw/DrawApi';
import { ClipRect, RGBA, intersects, transformBoxInto } from '../draw/geometry';
import { tokens } from '../theme/tokens';
import type { Component } from './Component';

/**
 * The framework's render walk (R3.11, R8.1): depth-first, each component's own
 * draws before its children, children in `renderOrder` (R3.12).
 *
 * Per component, in this order: its origin (position, anchor placement,
 * margin), its transform (R8.26), its opacity (R3.25), its layer and, when
 * that raises it, the clip reset of R3.8; then `render`; then, around the
 * children only, its clip in its own unscrolled space and its content offset
 * inside that clip, so the clip stays put while the content moves (R4.9,
 * R4.10); then, after the children, the focus ring when the component shows
 * focus (R11.12).
 *
 * Invisible components and components at zero opacity are skipped whole
 * (R3.27). So is a subtree whose cached ink bound (`subtreeInk`) misses the
 * current clip: every group in it would be culled (R4.2a), so the walk adds
 * the groups it asked for on its last walk to `culled` and does not enter it.
 * A subtree is never skipped before it has been walked and counted once,
 * and any change to it forgets the count.
 *
 * Nothing is pushed for a default: a component at the origin with no
 * transform, full opacity and an inherited layer costs one `render` call.
 */
export function renderTree(component: Component, draw: DrawApi): void {
	if (!component.visible) return;
	const opacity = component.opacity;
	if (opacity <= 0) return;

	const counted = component.walkedGroupCount;
	if (counted >= 0 && missesClip(component, draw)) {
		draw.cullGroups(counted);
		return;
	}
	const requestedBefore = draw.groupsRequested;

	const originX = component.originX;
	const originY = component.originY;
	const translated = originX !== 0 || originY !== 0;
	if (translated) draw.pushTranslate(originX, originY);

	const matrix = component.transformMatrix;
	if (matrix) draw.pushTransform(matrix);

	const fades = opacity < 1;
	if (fades) draw.pushOpacity(opacity);

	const layer = component.layer;
	const layered = layer !== null && layer !== draw.layer;
	const promotes = layered && component.promoted;
	if (layered) draw.pushLayer(layer);
	if (promotes) draw.pushClipReset();

	const audits = draw.auditsInk;
	if (audits) draw.setInkBound(component.ownInkBound);
	component.render(draw);
	if (audits) draw.setInkBound(null);

	const children = component.renderOrder;
	if (children.length > 0) {
		// Read once, so a child that resizes this component mid-walk cannot
		// leave the push and the pop disagreeing.
		const clips = component.clipsChildren;
		if (clips) {
			const radius = component.clipRadius;
			if (radius > 0) draw.pushClipRounded(component.clipRect, radius);
			else draw.pushClip(component.clipRect);
		}
		const offset = component.contentOffset;
		const scrolled = offset.x !== 0 || offset.y !== 0;
		if (scrolled) draw.pushTranslate(-offset.x, -offset.y);

		for (let index = 0; index < children.length; index++) {
			renderTree(children[index], draw);
		}

		if (scrolled) draw.popTransform();
		if (clips) draw.popClip();
	}

	if (component.focusVisible && component.effectivelyEnabled && !component.drawsOwnFocusRing) {
		if (audits) draw.setInkBound(component.ownInkBound);
		drawFocusRing(component, draw);
		if (audits) draw.setInkBound(null);
	}

	if (promotes) draw.popClip();
	if (layered) draw.popLayer();
	if (fades) draw.popOpacity();
	if (matrix) draw.popTransform();
	if (translated) draw.popTransform();

	component.walkedGroupCount = draw.groupsRequested - requestedBefore;
}

/** Reused by `missesClip`, which runs per component per frame. */
const screenInk: ClipRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * Whether everything `component`'s subtree can draw, placed by the current
 * transform and grown by the most any group's cull ink grows, misses the
 * current clip. Never under `none`, and never for a subtree with no bound
 * (a layer that may promote past the clip, an unmeasured text).
 */
function missesClip(component: Component, draw: DrawApi): boolean {
	const clip = draw.clip;
	if (clip.kind === 'none') return false;
	const ink = component.subtreeInk;
	if (ink === null) return false;
	if (clip.kind === 'empty') return true;
	const ratio = draw.devicePixelScale;
	const outset = SUBTREE_INK_OUTSET / (ratio > 0 ? ratio : 1);
	const screen = transformBoxInto(draw.transform, ink.minX, ink.minY, ink.maxX, ink.maxY, screenInk);
	screen.minX -= outset;
	screen.minY -= outset;
	screen.maxX += outset;
	screen.maxY += outset;
	return !intersects(screen, clip.rect);
}

const CLEAR: RGBA = [0, 0, 0, 0];

/**
 * R11.12's sixth layer: a `focus_ring_width` accent outline `focus_ring_offset`
 * outside the content box, drawn after the children so nothing inside covers
 * it and independent of every other state, so a keyboard player never loses
 * it to a hover. Drawn only while `focusVisible` (R9.23), so a pointer never
 * shows it, and only for a component that does not draw its own ring from
 * its state layers (`drawsOwnFocusRing`): the fallback that gives cards,
 * vehicles, and any other focusable without a resolved look a ring.
 */
function drawFocusRing(component: Component, draw: DrawApi): void {
	const offset = tokens.control.focus_ring_offset;
	draw.drawRect({
		id: component.id !== null ? `${component.id}.focus_ring` : undefined,
		rect: {
			x: -offset,
			y: -offset,
			width: component.width + offset * 2,
			height: component.height + offset * 2,
		},
		radius: tokens.radius.radius_ui + offset,
		// A rect with no fill is white (R2.8's default); the ring is border only.
		fill: CLEAR,
		border: { color: tokens.color.accent, width: tokens.control.focus_ring_width, position: 'outside' },
	});
}
