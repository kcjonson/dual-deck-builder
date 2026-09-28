import type { DrawApi } from '../draw/DrawApi';
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
 * R4.10).
 *
 * Invisible components and components at zero opacity are skipped whole
 * (R3.27). Nothing is pushed for a default: a component at the origin with no
 * transform, full opacity and an inherited layer costs one `render` call.
 */
export function renderTree(component: Component, draw: DrawApi): void {
	if (!component.visible) return;
	const opacity = component.opacity;
	if (opacity <= 0) return;

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

	if (promotes) draw.popClip();
	if (layered) draw.popLayer();
	if (fades) draw.popOpacity();
	if (matrix) draw.popTransform();
	if (translated) draw.popTransform();
}
