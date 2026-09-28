import { Layer } from '../components/Layer';
import { Component } from '../components/Component';
import { Panel } from '../ui/Panel';
import { Stack } from '../components/Stack';
import { Input } from '../ui/Input';
import { CLIP_NONE, ClipState, intersectClip } from '../draw/clip';
import { snapClipRect } from '../coords/snapping';

/**
 * Serializes the live Layer tree to the JSON document of R13.22-R13.24.
 *
 * Pure function over the tree: no GL context, no DOM, no window. The roots and
 * the viewport are arguments so the same code runs in Jest and in the browser
 * (R13.4, R14.1).
 *
 * Every coordinate is a logical pixel, origin top-left (R7.1). Device pixels
 * and devicePixelRatio never appear here (R7.2).
 *
 * The omission rule (R13.22): a field the engine cannot back is left out of the
 * object entirely, never emitted as 0, false, '' or a plausible default. `null`
 * means "the field applies but the value is unknown". `id` is the one field
 * that is always present, because R13.22 states it is null when unset.
 *
 * Deliberately absent, because no backing property exists in this engine:
 * margin, zIndex, layer, opacity, transform, focusable, inkBounds, style,
 * text.measured, and state.{pressed,focusVisible,selected,open,active,dropActive}.
 * Emitting zIndex: 0 in particular would silently change what the layout lint's
 * sibling-overlap rule exempts.
 *
 * Clips are reported as the intersection of every clipping ancestor, which is
 * what R13.22's "effective values" asks for, computed by the draw API's own
 * clip stack arithmetic (`intersectClip`, R4.2 and R4.3) from the same
 * `clipsChildren` fact the render walk pushes from, each rect snapped to the
 * device grid at the viewport's ratio as `pushClip` snaps it under a
 * translation (R7.8a). So the reported clip is the one the renderer applied,
 * including R4.2's `empty` state, which is reported as a zero-sized rect rather than dropped: a node
 * clipped away entirely has a clip, and it contains nothing.
 *
 * R13.21 says the snapshot is taken after layout has run for the frame. This
 * engine has no layout phase in the frame loop; a Text sizes itself from the
 * metrics service when its content changes, and one built before the draw API
 * could measure sizes itself on its first render. The read hook does NOT run
 * layout: a reader must not mutate the tree it observes. Read the snapshot
 * after at least one rendered frame.
 */

export interface SnapshotRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SnapshotPoint {
	x: number;
	y: number;
}

export interface SnapshotViewport {
	width: number;
	height: number;
	/**
	 * `dpr * uiScale` (R7.2), which the clips snap at. Read, never reported:
	 * the document's viewport stays logical. 1 when absent, the draw API's own
	 * default.
	 */
	ratio?: number;
}

export interface SnapshotState {
	hovered: boolean;
	focused: boolean;
}

/**
 * A stack container's flow: not a field R13.22 names, but R13.25.1's
 * sibling-overlap allowance ("beyond what a negative stack gap allows") needs
 * the gap, and the direction says which axis it applies to.
 */
export interface SnapshotStack {
	direction: 'vertical' | 'horizontal';
	gap: number;
}

export interface SnapshotNode {
	id: string | null;
	type: string;
	bounds: SnapshotRect;
	screenBounds: SnapshotRect;
	visible: boolean;
	clip?: SnapshotRect;
	contentOffset?: SnapshotPoint;
	enabled?: boolean;
	state?: SnapshotState;
	value?: string;
	stack?: SnapshotStack;
	/**
	 * The owning component's own drawings (R8.1, R3.18), absent when it has
	 * none. Not a field R13.22 names: R13.22 describes the tree R8.6 allows,
	 * where a container never inserts a background or a content layer, and
	 * this engine's composites do. Reporting them as `children` says they are
	 * siblings of what the caller added, which is what R13.25's
	 * sibling-overlap rule then reports.
	 */
	parts?: SnapshotNode[];
	children: SnapshotNode[];
}

export interface SnapshotDocument {
	viewport: SnapshotViewport;
	roots: SnapshotNode[];
}

/**
 * A tree deeper than this is a cycle the ancestor check missed, or a structure
 * no screen has. Stop rather than blow the stack inside the frame (R13.24).
 */
const MAX_DEPTH = 256;

const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

interface WalkContext {
	offsetX: number;
	offsetY: number;
	/** Effective clip contributed by ancestors, in logical space (R4.2's three states). */
	clip: ClipState;
	/** R7.2's ratio, for R7.8a's clip snap. */
	ratio: number;
}

/**
 * Non-finite geometry is reported as 0 rather than NaN or null. NaN does not
 * survive JSON, and a null coordinate would force every consumer to a nullable
 * type. Zero is also self-announcing: a NaN width lands on the lint's
 * zero-or-negative-size rule instead of disappearing.
 */
function finite(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Ids reach here from application code, so they can be any runtime value.
 * Anything that is not a string becomes null, and unpaired surrogates are
 * replaced so the document survives JSON.stringify (R13.24).
 */
function safeId(value: unknown): string | null {
	if (typeof value !== 'string') return null;

	let sanitized = '';
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
		const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;

		if (isHighSurrogate) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				sanitized += value[index] + value[index + 1];
				index++;
				continue;
			}
		}

		sanitized += isHighSurrogate || isLowSurrogate ? REPLACEMENT_CHARACTER : value[index];
	}

	return sanitized;
}

function snapshotClip(clip: ClipState): SnapshotRect | undefined {
	if (clip.kind === 'none') return undefined;
	if (clip.kind === 'empty') return { x: 0, y: 0, w: 0, h: 0 };
	const { minX, minY, maxX, maxY } = clip.rect;
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Re-accumulates offsets, content offsets and clips along the render walk's
 * path (`renderTree`), so screenBounds and clip are what was drawn, scroll
 * included. Transforms are not applied yet; the R13.22 schema that carries
 * them is DDB-80's.
 */
function serializeNode(
	node: Component,
	context: WalkContext,
	ancestors: Set<Component>,
	seen: Set<Component>,
	depth: number,
): SnapshotNode {
	// Filled in place so a throw partway through still reports the id, bounds
	// and children already computed instead of a blank node.
	const serialized: SnapshotNode = {
		id: null,
		type: 'Unserializable',
		bounds: { x: 0, y: 0, w: 0, h: 0 },
		screenBounds: { x: 0, y: 0, w: 0, h: 0 },
		visible: true,
		children: [],
	};

	try {
		// `bounds` rather than `x` and `y`: an anchored child's placement
		// (R10.15) is its position plus the anchor's shift.
		const x = finite(node.bounds.x);
		const y = finite(node.bounds.y);
		const w = finite(node.width);
		const h = finite(node.height);
		const screenX = context.offsetX + x;
		const screenY = context.offsetY + y;

		serialized.id = safeId(node.id);
		serialized.type = typeof node.getComponentType === 'function' ? String(node.getComponentType()) : 'Unknown';
		serialized.bounds = { x, y, w, h };
		serialized.screenBounds = { x: screenX, y: screenY, w, h };
		serialized.visible = node.isVisible() === true;

		const clip = snapshotClip(context.clip);
		if (clip) serialized.clip = clip;

		const panel = node instanceof Panel ? node : null;
		const scroll = panel ? panel.getScrollOffset() : null;

		if (panel && panel.scrollable && scroll) {
			serialized.contentOffset = { x: finite(scroll.x), y: finite(scroll.y) };
		}

		// Containers report no interaction state, as before the base class
		// merge; DDB-80's schema reports it on every node.
		if (!(node instanceof Layer)) {
			serialized.enabled = node.isEnabled();
			serialized.state = { hovered: node.isHovered(), focused: node.isFocused() };
		}

		if (node instanceof Input) {
			serialized.value = node.getValue();
		}

		if (node instanceof Stack) {
			serialized.stack = { direction: node.direction, gap: finite(node.gap) };
		}

		const innerClip = node.clipsChildren
			? intersectClip(context.clip, snapClipRect({ minX: screenX, minY: screenY, maxX: screenX + w, maxY: screenY + h }, context.ratio), null)
			: context.clip;

		// `ancestors` is per-path and catches cycles. `seen` is walk-wide and
		// catches the other shape: addChild detaches from a previous parent,
		// but the array getChildren returns can still be pushed to directly,
		// so one instance can sit in two children arrays and a diamond
		// expands exponentially. A repeat is emitted once more as a
		// childless stub rather than re-expanded, because an OOM inside the
		// frame is a worse failure than the throw R13.24 forbids.
		if (depth >= MAX_DEPTH || ancestors.has(node) || seen.has(node)) return serialized;

		seen.add(node);
		ancestors.add(node);
		try {
			const children = node.debugChildren;
			if (Array.isArray(children)) {
				// The walk pushes the clip in the unscrolled space and applies the
				// content offset inside it (R4.9, R4.10).
				const offset = node.contentOffset;
				const childContext: WalkContext = {
					offsetX: screenX - finite(offset?.x),
					offsetY: screenY - finite(offset?.y),
					clip: innerClip,
					ratio: context.ratio,
				};
				for (const child of children) {
					if (!child) continue;
					const serializedChild = serializeNode(child, childContext, ancestors, seen, depth + 1);
					if (child.isPart === true) {
						if (!serialized.parts) serialized.parts = [];
						serialized.parts.push(serializedChild);
					} else {
						serialized.children.push(serializedChild);
					}
				}
			}
		} finally {
			ancestors.delete(node);
		}

		return serialized;
	} catch {
		// The node the serializer already knows is broken is the node most
		// worth looking at, and R13.27 makes the lint skip invisible subtrees
		// whole, so a degraded node reports itself visible. The type is the
		// marker that the rest of the object is partial.
		serialized.type = 'Unserializable';
		serialized.visible = true;
		return serialized;
	}
}

/**
 * Serialize the roots to the R13.23 document.
 * @param roots Root layers: the active screen plus any visible overlay.
 * @param viewport Logical viewport size in CSS pixels.
 */
export function treeSnapshot(roots: readonly Component[], viewport: SnapshotViewport): SnapshotDocument {
	const document: SnapshotDocument = {
		viewport: { width: finite(viewport?.width), height: finite(viewport?.height) },
		roots: [],
	};

	if (!Array.isArray(roots)) return document;

	// Walk-wide, so a node shared between two roots is expanded once.
	const seen = new Set<Component>();
	const ratio = typeof viewport?.ratio === 'number' && Number.isFinite(viewport.ratio) && viewport.ratio > 0 ? viewport.ratio : 1;

	for (const root of roots) {
		if (!root) continue;
		document.roots.push(serializeNode(root, { offsetX: 0, offsetY: 0, clip: CLIP_NONE, ratio }, new Set<Component>(), seen, 0));
	}

	return document;
}
