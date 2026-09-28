import { Component } from '../components/Component';
import { Text } from '../components/Text';
import { Panel } from '../ui/Panel';
import { Stack } from '../components/Stack';
import { Input } from '../ui/Input';
import { Checkable } from '../ui/Checkbox';
import { CLIP_NONE, ClipState, intersectClip } from '../draw/clip';
import { ClipRect, IDENTITY, Mat2D, RGBA, Rect, concat, isTranslateOnly, transformedBounds, translation } from '../draw/geometry';
import { LayerName, ROOT_LAYER, layerOrdinal } from '../draw/layers';
import { snapClipRect } from '../coords/snapping';

/**
 * Serializes the live component tree to the JSON document of R13.22-R13.24.
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
 * Backed on every node since the component base (DDB-73): margin, zIndex, the
 * effective layer, enabled, the effective opacity, inkBounds, and every
 * R11.11 state flag (the base carries them all since DDB-84). Backed where a
 * component has them: clip, contentOffset, transform, text, value, style.
 *
 * `focusable` is backed since DDB-76 but not emitted, for the same reason as
 * `pointerEvents` below: the lint reads it as "interactive", and reporting it
 * would wake rules 6 and 7 on every Button in the gallery, which is a call
 * for whoever settles what "interactive" means there.
 *
 * `pointerEvents` is backed but deliberately not emitted. R13.22 does not name
 * it, and the lint reads it as "interactive" for rules 6 and 7 (R13.25.6),
 * while R8.29 makes `auto` the default for every leaf: emitting it would count
 * every label and swatch as a hit target and take the gallery from 0 to 72
 * target-size and unreachable-interactive findings, none of them a control.
 * What "interactive" should mean there is an open spec question, not a
 * serializer one.
 *
 * The walk mirrors `renderTree` step for step: origin (position plus margin),
 * transform, opacity, layer and the clip reset a promotion brings (R3.8,
 * R4.8), then, around the children only, the clip in the component's own
 * unscrolled space and the content offset inside it (R4.9, R4.10). So
 * `screenBounds`, `clip`, `layer` and `opacity` are what the renderer applied.
 * The clip arithmetic is the draw API's own (`intersectClip`,
 * `transformedBounds`, and under a translation `snapClipRect` at the
 * viewport's ratio, R7.8a), including R4.2's `empty` state, reported as a
 * zero-sized rect rather than dropped: a node clipped away entirely has a
 * clip, and it contains nothing.
 *
 * R13.21 says the snapshot is taken after layout has run for the frame. The
 * read hook does NOT run layout, and does not measure text either: a reader
 * must not mutate the tree it observes. Read the snapshot after at least one
 * rendered frame.
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

export interface SnapshotEdges {
	top: number;
	right: number;
	bottom: number;
	left: number;
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

/** R11.11's flags minus `enabled`, which is its own field. */
export interface SnapshotState {
	hovered: boolean;
	pressed: boolean;
	focused: boolean;
	focusVisible: boolean;
	selected: boolean;
	open: boolean;
	active: boolean;
	dropActive: boolean;
	/** A checkbox, toggle, or radio's value (R12.9, R12.35): `mixed` for an indeterminate checkbox. Absent elsewhere. */
	checked?: boolean | 'mixed';
}

export interface SnapshotTransform {
	rotate: number;
	scale: number | [number, number];
	translate: [number, number];
	origin: [number, number];
}

export interface SnapshotTextMeasure {
	w: number;
	h: number;
	lines: number;
}

export interface SnapshotText {
	content: string;
	/** The laid-out extent, absent until something has measured it. */
	measured?: SnapshotTextMeasure;
	/** What happened to a text that ran past its box; absent with `measured`. */
	overflow?: 'none' | 'clip' | 'ellipsis' | 'visible';
	/** The wrap mode it was laid out with, which the lint's text-overflow rule reads. */
	wrap: 'none' | 'word';
}

export interface SnapshotStyle {
	fill?: number[];
	text?: number[];
	border?: number[];
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
	/** The margin box in the parent's content-box space. */
	bounds: SnapshotRect;
	/** The content box in the viewport, after offsets and transforms (its axis-aligned bounds under rotation). */
	screenBounds: SnapshotRect;
	margin?: SnapshotEdges;
	zIndex?: number;
	/** The effective layer (R3.6). */
	layer?: LayerName;
	visible: boolean;
	enabled?: boolean;
	/** The effective opacity (R3.25). */
	opacity?: number;
	clip?: SnapshotRect;
	contentOffset?: SnapshotPoint;
	transform?: SnapshotTransform;
	state?: SnapshotState;
	text?: SnapshotText;
	value?: string;
	style?: SnapshotStyle;
	/** The content box grown by `inkExtent`, in the viewport, before any clip (R8.8). */
	inkBounds?: SnapshotRect;
	stack?: SnapshotStack;
	/**
	 * The owning component's own drawings (R8.1, R3.18), absent when it has
	 * none. Not a field R13.22 names: R13.22 describes the tree R8.6 allows,
	 * where a composite draws its own parts, and Button, Input and the
	 * developer overlay still build theirs from marked children. Reporting
	 * them as `children` says they are siblings of what the caller added,
	 * which is what R13.25's sibling-overlap rule then reports.
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
	/** The parent's content space, scroll included, to the viewport. */
	matrix: Mat2D;
	/** Effective clip on the parent's children, in logical space (R4.2's three states). */
	clip: ClipState;
	/** The parent's effective layer; `base` above a root (R3.6). */
	layer: LayerName;
	/** The parent's effective opacity. */
	opacity: number;
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
 * replaced so the document survives JSON.stringify (R13.24). Text content goes
 * through the same path.
 */
function safeString(value: unknown): string | null {
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

function fromClipRect(rect: ClipRect): SnapshotRect {
	return { x: rect.minX, y: rect.minY, w: rect.maxX - rect.minX, h: rect.maxY - rect.minY };
}

function snapshotClip(clip: ClipState): SnapshotRect | undefined {
	if (clip.kind === 'none') return undefined;
	if (clip.kind === 'empty') return { x: 0, y: 0, w: 0, h: 0 };
	return fromClipRect(clip.rect);
}

/**
 * A local rect through `matrix`, with non-finite results zeroed rather than
 * propagated. Under a translation the size is carried over rather than
 * recovered as `max - min`, which drifts in the last bit and would make a
 * text measured to exactly its box read as a hair wider than it.
 */
function screenRect(matrix: Mat2D, rect: Rect): SnapshotRect {
	if (isTranslateOnly(matrix)) {
		return {
			x: finite(rect.x + matrix[4]),
			y: finite(rect.y + matrix[5]),
			w: finite(rect.width),
			h: finite(rect.height),
		};
	}
	const bounds = fromClipRect(transformedBounds(matrix, rect));
	return { x: finite(bounds.x), y: finite(bounds.y), w: finite(bounds.w), h: finite(bounds.h) };
}

/** A clip rect as `pushClip` leaves it: on the device grid under a translation (R7.8a). */
function pushedClip(matrix: Mat2D, rect: Rect, ratio: number): ClipRect {
	const bounds = transformedBounds(matrix, rect);
	return isTranslateOnly(matrix) ? snapClipRect(bounds, ratio) : bounds;
}

function color(value: RGBA | undefined): number[] | undefined {
	return value ? [finite(value[0]), finite(value[1]), finite(value[2]), finite(value[3])] : undefined;
}

function snapshotStyle(node: Component): SnapshotStyle | undefined {
	const colors = node.resolvedColors;
	if (!colors) return undefined;
	const style: SnapshotStyle = {};
	const fill = color(colors.fill);
	const text = color(colors.text);
	const border = color(colors.border);
	if (fill) style.fill = fill;
	if (text) style.text = text;
	if (border) style.border = border;
	return fill || text || border ? style : undefined;
}

function snapshotText(node: Text): SnapshotText {
	const text: SnapshotText = { content: safeString(node.getText()) ?? '', wrap: node.wrap };
	const metrics = node.currentMetrics;
	const outcome = node.overflowOutcome;
	if (metrics && outcome) {
		text.measured = { w: finite(metrics.width), h: finite(metrics.height), lines: finite(metrics.lines) };
		text.overflow = outcome;
	}
	return text;
}

function snapshotTransform(node: Component): SnapshotTransform | undefined {
	if (!node.transformMatrix) return undefined;
	const { rotate, scale, translate, origin } = node.transform;
	return {
		rotate: finite(rotate),
		scale: typeof scale === 'number' ? finite(scale) : [finite(scale[0]), finite(scale[1])],
		translate: [finite(translate[0]), finite(translate[1])],
		origin: [finite(origin[0]), finite(origin[1])],
	};
}

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
		serialized.id = safeString(node.id);
		serialized.type = typeof node.getComponentType === 'function' ? String(node.getComponentType()) : 'Unknown';

		// The placed margin box: position plus any anchor shift (R10.15).
		const x = finite(node.placedX);
		const y = finite(node.placedY);
		const w = finite(node.width);
		const h = finite(node.height);
		const margin = node.margin;
		const edges: SnapshotEdges = {
			top: finite(margin.top),
			right: finite(margin.right),
			bottom: finite(margin.bottom),
			left: finite(margin.left),
		};

		// Origin, then transform: `renderTree`'s order, and `localMatrix`'s,
		// from the one placed-origin accessor they all read.
		const origin = translation(finite(node.originX), finite(node.originY));
		const own = node.transformMatrix;
		const matrix = concat(context.matrix, own ? concat(origin, own) : origin);

		serialized.bounds = { x, y, w: w + edges.left + edges.right, h: h + edges.top + edges.bottom };
		serialized.screenBounds = screenRect(matrix, { x: 0, y: 0, width: w, height: h });
		serialized.margin = edges;
		serialized.zIndex = finite(node.zIndex);

		// R3.6: max(own, inherited). A raise resets the inherited clip for
		// this component's own draws as well as its children's (R3.8).
		const ownLayer = node.layer;
		const promoted = ownLayer !== null && layerOrdinal(ownLayer) > layerOrdinal(context.layer);
		const layer = promoted ? ownLayer : context.layer;
		const clip = promoted ? CLIP_NONE : context.clip;
		serialized.layer = layer;

		serialized.visible = node.visible === true;
		serialized.enabled = node.enabled === true;

		const opacity = context.opacity * finite(node.opacity);
		serialized.opacity = opacity;

		const reportedClip = snapshotClip(clip);
		if (reportedClip) serialized.clip = reportedClip;

		const offset = node.contentOffset;
		const offsetX = finite(offset?.x);
		const offsetY = finite(offset?.y);
		if ((node instanceof Panel && node.scrollable) || offsetX !== 0 || offsetY !== 0) {
			serialized.contentOffset = { x: offsetX, y: offsetY };
		}

		const transform = snapshotTransform(node);
		if (transform) serialized.transform = transform;

		const { hovered, pressed, focused, focusVisible, selected, open, active, dropActive } = node.stateFlags;
		serialized.state = { hovered, pressed, focused, focusVisible, selected, open, active, dropActive };
		if (node instanceof Checkable) serialized.state.checked = node.checkedState;

		if (node instanceof Text) serialized.text = snapshotText(node);
		if (node instanceof Input) serialized.value = safeString(node.getValue()) ?? '';
		if (node instanceof Stack) serialized.stack = { direction: node.direction, gap: finite(node.gap) };

		const style = snapshotStyle(node);
		if (style) serialized.style = style;

		serialized.inkBounds = screenRect(matrix, node.inkRect);

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
			if (Array.isArray(children) && children.length > 0) {
				// The clip is pushed in the unscrolled space and the content
				// offset applied inside it (R4.9, R4.10).
				const childContext: WalkContext = {
					matrix: offsetX !== 0 || offsetY !== 0 ? concat(matrix, translation(-offsetX, -offsetY)) : matrix,
					clip: node.clipsChildren ? intersectClip(clip, pushedClip(matrix, node.clipRect, context.ratio), null) : clip,
					layer,
					opacity,
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
 * @param roots Root components: the active screen plus any visible overlay.
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
	const rootContext: WalkContext = { matrix: IDENTITY, clip: CLIP_NONE, layer: ROOT_LAYER, opacity: 1, ratio };

	for (const root of roots) {
		if (!root) continue;
		document.roots.push(serializeNode(root, rootContext, new Set<Component>(), seen, 0));
	}

	return document;
}
