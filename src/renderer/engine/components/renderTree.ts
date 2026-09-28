import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import { tokens } from '../theme/tokens';
import type { Component } from './Component';

/**
 * The framework's render walk (R3.11, R8.1): depth-first, each component's own
 * draws before its children, children in `renderOrder` (R3.12).
 *
 * Per component, in this order: its origin (position plus margin), its
 * transform (R8.26), its opacity (R3.25), its layer and, when that raises it,
 * the clip reset of R3.8; then `render`; then, around the children only, its
 * clip in its own unscrolled space and its content offset inside that clip,
 * so the clip stays put while the content moves (R4.9, R4.10); then, after
 * the children, the focus ring when the component shows focus (R11.12).
 *
 * Invisible components and components at zero opacity are skipped whole
 * (R3.27). Nothing is pushed for a default: a component at the origin with no
 * transform, full opacity and an inherited layer costs one `render` call.
 */
export function renderTree(component: Component, draw: DrawApi): void {
	if (!component.visible) return;
	const opacity = component.opacity;
	if (opacity <= 0) return;

	const margin = component.margin;
	const originX = component.x + margin.left;
	const originY = component.y + margin.top;
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

	component.render(draw);

	const children = component.renderOrder;
	if (children.length > 0) {
		// Read once, so a child that resizes this component mid-walk cannot
		// leave the push and the pop disagreeing.
		const clips = component.clipsChildren;
		if (clips) draw.pushClip(component.clipRect);
		const offset = component.contentOffset;
		const scrolled = offset.x !== 0 || offset.y !== 0;
		if (scrolled) draw.pushTranslate(-offset.x, -offset.y);

		for (let index = 0; index < children.length; index++) {
			renderTree(children[index], draw);
		}

		if (scrolled) draw.popTransform();
		if (clips) draw.popClip();
	}

	if (component.focusVisible && component.effectivelyEnabled) drawFocusRing(component, draw);

	if (promotes) draw.popClip();
	if (layered) draw.popLayer();
	if (fades) draw.popOpacity();
	if (matrix) draw.popTransform();
	if (translated) draw.popTransform();
}

const CLEAR: RGBA = [0, 0, 0, 0];

/**
 * R11.12's sixth layer: a `focus_ring_width` accent outline `focus_ring_offset`
 * outside the content box, drawn after the children so nothing inside covers
 * it and independent of every other state, so a keyboard player never loses
 * it to a hover. Drawn only while `focusVisible` (R9.23), so a pointer never
 * shows it. The state-layer resolution (DDB-84) may move it into the
 * component's own style.
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
