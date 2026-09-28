import { invert, isTranslateOnly, transformPoint } from '../draw/geometry';
import { snapClipRect } from '../coords/snapping';
import { layerOrdinal } from '../draw/layers';
import type { Component } from '../components/Component';

export interface HitTestOptions {
	/**
	 * A subtree the walk treats as absent: neither target nor occluder. The
	 * drag service passes its ghost here (R9.12b).
	 */
	exclude?: Component | null;
	/**
	 * `dpr * uiScale`, the ratio the draw API snapped the last frame's clips
	 * at (R7.8a), so a point hits exactly the pixels a clip kept. 1 when absent.
	 */
	ratio?: number;
}

/**
 * R9.4 and R3.28: the topmost component under a viewport point, walking what
 * `renderTree` paints in the order it paints it.
 *
 * The walk visits every root in paint order, and within each one a
 * component's own box before its children and children in `renderOrder`,
 * exactly as the render walk submits them. A hit replaces the best so far
 * when its effective layer is at least as high, so within one layer the last
 * submitted wins and a higher layer wins whatever came after it: that is
 * paint order reversed, without sorting anything.
 *
 * Per component, mirroring the render walk: invisible or zero-opacity
 * subtrees are skipped whole (R3.27), `pointerEvents: none` skips the subtree
 * (R8.29), the point is carried into the content box by removing the origin
 * and inverting the transform (R8.26), and children see it with the content
 * offset added back (R4.11) and only inside the component's clip (R4.12). A
 * promotion resets the clip (R4.8), so a popup declared inside a clipped
 * panel is hit outside the panel's box. Descent continues past a clip that
 * excludes the point, because a promoted descendant may still be hit;
 * everything else below it is out of the running.
 *
 * Under a pure translation a clip is tested as `pushClip` leaves it, its
 * screen edges snapped to device pixels (R7.8a), which is what
 * `containsScreenPoint` does too; under any other transform, in local space.
 *
 * `auto` and `unit` components are targets when `containsPoint` holds;
 * `unit` stops the descent and `passthrough` is never a target itself.
 * Disabled components are targets like any other: they occlude, and the
 * dispatcher decides what they receive (R9.5).
 */
export function hitTest(
	roots: readonly Component[],
	screenX: number,
	screenY: number,
	{ exclude = null, ratio = 1 }: HitTestOptions = {},
): Component | null {
	const walk = new HitWalk(exclude, ratio, screenX, screenY);
	for (const root of roots) walk.visit(root, screenX, screenY, 0, 0, true, true, -1);
	return walk.best;
}

class HitWalk {
	public best: Component | null = null;
	private bestOrdinal = -1;

	constructor(
		private readonly exclude: Component | null,
		private readonly ratio: number,
		private readonly screenX: number,
		private readonly screenY: number,
	) {}

	/**
	 * @param px The point in the parent's content space, after its content offset
	 * @param ox The screen position of that space's origin, meaningful while `translated`
	 * @param translated Whether everything above is a pure translation
	 * @param inClip Whether the point is inside every clip that applies here
	 * @param parentOrdinal The parent's effective layer ordinal; -1 above a root
	 */
	public visit(
		component: Component,
		px: number,
		py: number,
		ox: number,
		oy: number,
		translated: boolean,
		inClip: boolean,
		parentOrdinal: number,
	): void {
		if (!component.visible || component.opacity <= 0) return;
		const pointerEvents = component.pointerEvents;
		if (pointerEvents === 'none' || component === this.exclude) return;

		// R3.6: max(own, inherited), with a root starting from `base`.
		const inherited = parentOrdinal < 0 ? 0 : parentOrdinal;
		const own = component.layer;
		const ownOrdinal = own === null ? -1 : layerOrdinal(own);
		const ordinal = ownOrdinal > inherited ? ownOrdinal : inherited;
		// A root is never promoted: there is no inherited clip to reset.
		const clipped = parentOrdinal >= 0 && ownOrdinal > inherited ? true : inClip;

		const margin = component.margin;
		const originX = component.x + margin.left;
		const originY = component.y + margin.top;
		let lx = px - originX;
		let ly = py - originY;
		let sx = ox + originX;
		let sy = oy + originY;
		let pure = translated;
		const matrix = component.transformMatrix;
		if (matrix) {
			if (pure && isTranslateOnly(matrix)) {
				sx += matrix[4];
				sy += matrix[5];
			} else {
				pure = false;
			}
			const inverse = invert(matrix);
			// A zero scale collapses the box to a line: nothing in it can be hit.
			if (!inverse) return;
			const local = transformPoint(inverse, lx, ly);
			lx = local.x;
			ly = local.y;
		}

		if (pointerEvents !== 'passthrough' && clipped && ordinal >= this.bestOrdinal && component.containsPoint(lx, ly)) {
			this.best = component;
			this.bestOrdinal = ordinal;
		}
		if (pointerEvents === 'unit') return;

		const children = component.renderOrder;
		if (children.length === 0) return;

		let childClip = clipped;
		if (childClip && component.clipsChildren) {
			const clip = component.clipRect;
			if (pure) {
				const snapped = snapClipRect({
					minX: sx + clip.x,
					minY: sy + clip.y,
					maxX: sx + clip.x + clip.width,
					maxY: sy + clip.y + clip.height,
				}, this.ratio);
				childClip = this.screenX >= snapped.minX && this.screenX < snapped.maxX
					&& this.screenY >= snapped.minY && this.screenY < snapped.maxY;
			} else {
				childClip = lx >= clip.x && lx < clip.x + clip.width && ly >= clip.y && ly < clip.y + clip.height;
			}
		}
		const offset = component.contentOffset;
		for (let index = 0; index < children.length; index++) {
			this.visit(children[index], lx + offset.x, ly + offset.y, sx - offset.x, sy - offset.y, pure, childClip, ordinal);
		}
	}
}
