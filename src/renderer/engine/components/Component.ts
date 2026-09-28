import type { DrawApi } from '../draw/DrawApi';
import { Mat2D, RGBA, Rect, Vec2, concat, invert, isTranslateOnly, transformPoint, translation } from '../draw/geometry';
import { snapClipRect } from '../coords/snapping';
import { LayerName, ROOT_LAYER, layerOrdinal } from '../draw/layers';
import { Style } from '../types/Style';
import {
	ComponentTransform,
	IDENTITY_TRANSFORM,
	MarginInput,
	Sides,
	TransformInput,
	ZERO_SIDES,
	normalizeSides,
	normalizeTransform,
	transformMatrix,
} from './componentGeometry';
import type { MountContext } from './MountContext';
import {
	AnchorInput,
	Axis,
	AxisLimits,
	CrossAlign,
	Fraction2,
	Positioned,
	Size,
	SizeMode,
	TOP_LEFT,
	normalizeAnchor,
} from './layoutTypes';
import type { AnyUiEvent, UiKeyEvent, UiPointerEvent, UiWheelEvent } from '../input/events';

/**
 * R8.29. `auto`: this box is a target and children are hit-tested.
 * `passthrough`: children only. `unit`: this box only, the walk does not
 * descend. `none`: neither.
 */
export type PointerEvents = 'auto' | 'passthrough' | 'unit' | 'none';

export type Overflow = 'visible' | 'hidden';

/**
 * R13.22's `style`: the colours a component draws with, after whatever state
 * it is in has been applied. A key is absent when the component draws nothing
 * of that kind.
 */
export interface ResolvedColors {
	fill?: RGBA;
	text?: RGBA;
	border?: RGBA;
}

/** The four corners of a content box in screen space, clockwise from top-left. */
export type Quad = readonly [Vec2, Vec2, Vec2, Vec2];

/**
 * Named constructor arguments shared by every component (R8.2, R8.23).
 * Layout's sizing modes, focus, tooltips and the event callbacks arrive with
 * the phase that owns them (chapters 9 to 12).
 */
export interface ComponentOptions {
	id?: string;
	/** `position`: the margin box's origin in the parent's content box (R8.10). */
	x?: number;
	y?: number;
	/** `size`: the content size (R8.11). */
	width?: number;
	height?: number;
	visible?: boolean;
	enabled?: boolean;
	opacity?: number;
	/** Null or absent inherits the parent's layer (R3.6). */
	layer?: LayerName | null;
	zIndex?: number;
	margin?: MarginInput;
	transform?: TransformInput;
	pointerEvents?: PointerEvents;
	/** Only valid when width and height are set. */
	overflow?: Overflow;
	style?: Style;
	/** Fired after a layout in which this component's bounds changed, including the first (R8.21). */
	onLayout?: (bounds: Rect) => void;
	/** R10.1's sizing modes. Absent takes the kind's default: `fixed`, or `hug` for text and stacks without a size. */
	widthMode?: SizeMode;
	heightMode?: SizeMode;
	/** This component's share of a parent stack's main-axis leftover when it is `fill` (R10.3). Default 1. */
	fillWeight?: number;
	/** Clamps on the resolved content size, per axis (R10.4). */
	minSize?: AxisLimits;
	maxSize?: AxisLimits;
	/** Width over height: an axis the parent does not assign is resolved from the one it does (R10.4). */
	aspectRatio?: number;
	/** Overrides the parent stack's `crossAlign` for this child (R10.4). */
	alignSelf?: CrossAlign;
	/** `absolute` leaves the parent stack's flow and is placed by `anchor` and `pivot` (R10.15). */
	positioned?: Positioned;
	/** A point of the parent's content box, as fractions or a named shorthand (R10.15). Default `topLeft`. */
	anchor?: AnchorInput;
	/** The point of this component's margin box placed on the anchor. Defaults to `anchor`. */
	pivot?: AnchorInput;
}

export type PointerCallback = (event: UiPointerEvent) => void;
export type WheelCallback = (event: UiWheelEvent) => void;
export type KeyCallback = (event: UiKeyEvent) => void;

/**
 * Keyed reconciliation callbacks (R8.27). `remove` may return a promise to
 * run an exit animation: the child stays in the list, still drawn, after the
 * reconciled children and out of key matching, until the promise settles.
 */
export interface ReconcileOptions<Item, Child extends Component> {
	key: (item: Item) => string;
	create: (item: Item) => Child;
	update?: (child: Child, item: Item) => void;
	remove?: (child: Child) => void | Promise<void>;
}

const RECONCILE_KEY = Symbol('reconcileKey');

/**
 * The one interface for everything in the tree (R8.1): leaves, containers and
 * composite widgets alike.
 *
 * `render` emits this component's own draws in its content box's local space,
 * origin top-left, and nothing else. The framework's walk (`renderTree`)
 * positions it, applies its transform, opacity and layer, then visits its
 * children in `renderOrder`, clipped and offset as `clipsChildren` and
 * `contentOffset` say. No component renders its children itself.
 */
export abstract class Component {
	protected componentType = 'Component';
	protected children: Component[] = [];

	private readonly componentId: string | null = null;
	private positionX = 0;
	private positionY = 0;
	private contentWidth = 0;
	private contentHeight = 0;
	/**
	 * The size this component was given, by construction or a setter, which
	 * a layout assignment never overwrites: what a component with no content
	 * to measure hugs to (R10.5).
	 */
	private givenWidth = 0;
	private givenHeight = 0;
	private ownVisible = true;
	private ownEnabled = true;
	private ownOpacity = 1;
	private ownLayer: LayerName | null = null;
	private ownZIndex = 0;
	private ownMargin: Sides = ZERO_SIDES;
	private ownTransform: ComponentTransform = IDENTITY_TRANSFORM;
	private ownPointerEvents: PointerEvents;
	private ownOverflow: Overflow = 'visible';
	private hoverState = false;
	private focusState = false;
	private parentComponent: Component | null = null;
	private mountContext: MountContext | null = null;
	/** This subtree has to be laid out: set here and on every ancestor up to the boundary (R8.18). */
	private needsLayout = false;
	/** The bounds the last layout reported through `onLayout`; null until one ran. */
	private laidOutBounds: Rect | null = null;
	private ownedByParent = false;
	/** R3.13's render-order view; null when a child or a zIndex changed. */
	private orderView: readonly Component[] | null = null;
	private [RECONCILE_KEY]: string | undefined;
	/** Removed by `reconcileChildren` and still drawn while its exit runs. */
	private exiting = false;
	private ownWidthMode: SizeMode;
	private ownHeightMode: SizeMode;
	private ownFillWeight = 1;
	private ownMinSize: AxisLimits = NO_LIMITS;
	private ownMaxSize: AxisLimits = NO_LIMITS;
	private ownAspectRatio: number | null = null;
	private ownAlignSelf: CrossAlign | null = null;
	private ownPositioned: Positioned = 'flow';
	private ownAnchor: Fraction2 = TOP_LEFT;
	private ownPivot: Fraction2 | null = null;
	/**
	 * Where the parent's anchor placement moved the margin box, on top of
	 * `position` (R10.15). Zero for a flow child of a stack, which receives its
	 * placement through `position` itself (R10.11).
	 */
	private anchorShiftX = 0;
	private anchorShiftY = 0;

	constructor(options?: ComponentOptions) {
		this.ownPointerEvents = this.defaultPointerEvents;
		this.ownWidthMode = options?.widthMode ?? this.defaultSizeMode(options?.width);
		this.ownHeightMode = options?.heightMode ?? this.defaultSizeMode(options?.height);
		if (!options) return;
		if (options.id !== undefined) this.componentId = options.id;
		if (options.x !== undefined) this.positionX = options.x;
		if (options.y !== undefined) this.positionY = options.y;
		if (options.width !== undefined) this.contentWidth = options.width;
		if (options.height !== undefined) this.contentHeight = options.height;
		this.givenWidth = this.contentWidth;
		this.givenHeight = this.contentHeight;
		if (options.visible !== undefined) this.ownVisible = options.visible;
		if (options.enabled !== undefined) this.ownEnabled = options.enabled;
		if (options.opacity !== undefined) this.ownOpacity = options.opacity;
		if (options.layer !== undefined) this.ownLayer = options.layer;
		if (options.zIndex !== undefined) this.ownZIndex = options.zIndex;
		if (options.margin !== undefined) this.ownMargin = normalizeSides(options.margin);
		if (options.transform !== undefined) this.ownTransform = normalizeTransform(options.transform);
		if (options.pointerEvents !== undefined) this.ownPointerEvents = options.pointerEvents;
		if (options.overflow !== undefined) this.setOverflow(options.overflow);
		if (options.onLayout) this.onLayout = options.onLayout;
		if (options.fillWeight !== undefined) this.ownFillWeight = options.fillWeight;
		if (options.minSize !== undefined) this.ownMinSize = { ...options.minSize };
		if (options.maxSize !== undefined) this.ownMaxSize = { ...options.maxSize };
		if (options.aspectRatio !== undefined) this.ownAspectRatio = options.aspectRatio;
		if (options.alignSelf !== undefined) this.ownAlignSelf = options.alignSelf;
		if (options.positioned !== undefined) this.ownPositioned = options.positioned;
		if (options.anchor !== undefined) this.ownAnchor = normalizeAnchor(options.anchor);
		if (options.pivot !== undefined) this.ownPivot = normalizeAnchor(options.pivot);
		if (options.style) this.applyStyle(options.style);
	}

	/** R8.2's layout callback. A property, as every callback is (R8.25). */
	public onLayout: ((bounds: Rect) => void) | null = null;

	// R8.2's input callbacks. `handleEvent` runs the one matching an event
	// before the component's own handling; focus and drag callbacks arrive
	// with DDB-76 and DDB-77.
	public onPointerDown: PointerCallback | null = null;
	public onPointerUp: PointerCallback | null = null;
	public onPointerMove: PointerCallback | null = null;
	public onPointerEnter: PointerCallback | null = null;
	public onPointerLeave: PointerCallback | null = null;
	public onClick: PointerCallback | null = null;
	public onContextMenu: PointerCallback | null = null;
	public onWheel: WheelCallback | null = null;
	public onKeyDown: KeyCallback | null = null;
	public onKeyUp: KeyCallback | null = null;

	/**
	 * Whether a press here, or on a descendant, may start a drag (R9.12a).
	 * Only then does moving past the drag threshold cancel the click; a
	 * press elsewhere clicks wherever it wandered, as long as it is released
	 * on the same component. DDB-77's drag service sets it through
	 * `context.drag.start`; until then it is set by hand.
	 */
	public dragSource = false;

	/**
	 * R8.29's per-type default: `auto` for leaves and widgets. Containers say
	 * `passthrough` and composite widgets `unit` by overriding this.
	 */
	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	/**
	 * R10.1's per-kind default for an axis given its constructed size: `fixed`
	 * for everything but text and stacks, which hug an axis given no size.
	 */
	protected defaultSizeMode(_size: number | undefined): SizeMode {
		return 'fixed';
	}

	protected applyStyle(style: Style): void {
		if (style.visibility !== undefined) {
			this.ownVisible = style.visibility === 'visible';
		}
		if (style.display !== undefined) {
			this.ownVisible = style.display !== 'none';
		}
	}

	protected parseSize(size: string | number): number {
		if (typeof size === 'number') return size;
		if (typeof size === 'string' && size.endsWith('px')) {
			return parseFloat(size.slice(0, -2));
		}
		return parseFloat(size as string) || 0;
	}

	// -- identity (R8.4) ------------------------------------------------------

	/** Stable name for tests, the tree snapshot, and the layout lint; null when unset. */
	public get id(): string | null {
		return this.componentId;
	}

	public getComponentType(): string {
		return this.componentType;
	}

	// -- own draws (R8.1) -----------------------------------------------------

	/**
	 * This component's own draws, in its content box's local space. Called by
	 * the walk with the transform, opacity and layer already applied.
	 */
	public render(_draw: DrawApi): void {
		// A plain container draws nothing of its own.
	}

	// -- geometry (R8.10 to R8.13, R8.26) -------------------------------------

	public get x(): number {
		return this.positionX;
	}

	public set x(value: number) {
		this.positionX = value;
	}

	public get y(): number {
		return this.positionY;
	}

	public set y(value: number) {
		this.positionY = value;
	}

	/**
	 * Where the margin box sits in the parent's content box: `position` plus
	 * the parent's anchor placement (R10.15). What the walk translates by.
	 */
	public get placedX(): number {
		return this.positionX + this.anchorShiftX;
	}

	public get placedY(): number {
		return this.positionY + this.anchorShiftY;
	}

	/**
	 * The content box's origin in the parent's content box: the placed margin
	 * box inset by the margin. The one answer the render walk, the hit test,
	 * `screenMatrix` and the snapshot all read, so none of them can place a
	 * component somewhere the others do not.
	 */
	public get originX(): number {
		return this.placedX + this.ownMargin.left;
	}

	public get originY(): number {
		return this.placedY + this.ownMargin.top;
	}

	/** Content width (R8.11). */
	public get width(): number {
		return this.contentWidth;
	}

	public set width(value: number) {
		this.givenWidth = value;
		if (this.contentWidth === value) return;
		this.contentWidth = value;
		this.invalidateLayout();
	}

	public get height(): number {
		return this.contentHeight;
	}

	public set height(value: number) {
		this.givenHeight = value;
		if (this.contentHeight === value) return;
		this.contentHeight = value;
		this.invalidateLayout();
	}

	public get margin(): Sides {
		return this.ownMargin;
	}

	public set margin(value: MarginInput) {
		this.ownMargin = normalizeSides(value);
		this.invalidateLayout();
	}

	/**
	 * The margin box in the parent's content box (R8.10, R8.11): what layout,
	 * the lint, and the snapshot report. Hit testing uses the content box.
	 */
	public get bounds(): Rect {
		const margin = this.ownMargin;
		return {
			x: this.placedX,
			y: this.placedY,
			width: this.contentWidth + margin.left + margin.right,
			height: this.contentHeight + margin.top + margin.bottom,
		};
	}

	/**
	 * R8.8: the furthest this component may draw outside its layout box
	 * (shadows, glows, focus rings). Ink overflow never affects layout or hit
	 * testing.
	 */
	public get inkExtent(): number {
		return 0;
	}

	/**
	 * The content box grown by `inkExtent` on every side, in local space: the
	 * most this component can cover, before any clip. Transformed by the
	 * screen matrix it is the snapshot's `inkBounds` (R13.22).
	 */
	public get inkRect(): Rect {
		const extent = Math.max(0, this.inkExtent);
		return { x: -extent, y: -extent, width: this.contentWidth + extent * 2, height: this.contentHeight + extent * 2 };
	}

	/** What this component's own draws are coloured with right now; null when it draws nothing (R13.22's `style`). */
	public get resolvedColors(): ResolvedColors | null {
		return null;
	}

	public get transform(): ComponentTransform {
		return this.ownTransform;
	}

	/** Layout ignores it (R8.26); it never invalidates anything but paint. */
	public set transform(value: TransformInput) {
		this.ownTransform = normalizeTransform(value);
	}

	/** The transform as a matrix over the content box, or null for identity. */
	public get transformMatrix(): Mat2D | null {
		return transformMatrix(this.ownTransform, this.contentWidth, this.contentHeight);
	}

	/**
	 * The offset R4.9 applies to children, independent of clipping: a scroll
	 * container reports its scroll position here.
	 */
	public get contentOffset(): Vec2 {
		return ORIGIN;
	}

	/**
	 * Local (content box) to parent content box: the margin-box origin (with
	 * any anchor placement), the margin inset, then this component's transform.
	 */
	private get localMatrix(): Mat2D {
		const origin = translation(this.originX, this.originY);
		const own = this.transformMatrix;
		return own ? concat(origin, own) : origin;
	}

	/**
	 * Content box to viewport logical pixels, through every ancestor's origin,
	 * content offset, and transform: exactly what the render walk pushes.
	 */
	public get screenMatrix(): Mat2D {
		const local = this.localMatrix;
		const parent = this.parentComponent;
		if (!parent) return local;
		const offset = parent.contentOffset;
		const parentMatrix = offset.x !== 0 || offset.y !== 0
			? concat(parent.screenMatrix, translation(-offset.x, -offset.y))
			: parent.screenMatrix;
		return concat(parentMatrix, local);
	}

	public localToScreen(point: Vec2): Vec2 {
		return transformPoint(this.screenMatrix, point.x, point.y);
	}

	/** Null when a zero scale somewhere above collapses the box to a line. */
	public screenToLocal(point: Vec2): Vec2 | null {
		const inverse = invert(this.screenMatrix);
		return inverse ? transformPoint(inverse, point.x, point.y) : null;
	}

	/** R8.13: the content box's corners on screen, clockwise from top-left. */
	public get screenQuad(): Quad {
		const matrix = this.screenMatrix;
		const width = this.contentWidth;
		const height = this.contentHeight;
		return [
			transformPoint(matrix, 0, 0),
			transformPoint(matrix, width, 0),
			transformPoint(matrix, width, height),
			transformPoint(matrix, 0, height),
		];
	}

	/** R8.13: the content box in viewport logical pixels; axis-aligned bounds under rotation. */
	public get screenBounds(): Rect {
		const quad = this.screenQuad;
		const minX = Math.min(quad[0].x, quad[1].x, quad[2].x, quad[3].x);
		const minY = Math.min(quad[0].y, quad[1].y, quad[2].y, quad[3].y);
		const maxX = Math.max(quad[0].x, quad[1].x, quad[2].x, quad[3].x);
		const maxY = Math.max(quad[0].y, quad[1].y, quad[2].y, quad[3].y);
		return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
	}

	/**
	 * R8.12: the content box, half-open. Non-rectangular components override
	 * this and only this.
	 */
	public containsPoint(localX: number, localY: number): boolean {
		return localX >= 0 && localX < this.contentWidth && localY >= 0 && localY < this.contentHeight;
	}

	/**
	 * Whether a viewport point lands on this component: effectively visible,
	 * not faded to zero (R3.27), not under `pointerEvents: none`, inside its own
	 * content box through the inverse transform, and inside every clipping
	 * ancestor up to a layer promotion, which resets the clip (R4.8, R4.12).
	 *
	 * One component's geometry only: paint order, occlusion, `unit` and
	 * `passthrough`, and disabled state are the dispatcher's hit walk
	 * (`hitTest`), which is what decides where an event goes.
	 */
	public containsScreenPoint(screenX: number, screenY: number): boolean {
		if (!this.effectivelyVisible || this.effectiveOpacity <= 0 || this.pointerEventsBlocked) return false;
		const local = this.screenToLocal({ x: screenX, y: screenY });
		if (!local || !this.containsPoint(local.x, local.y)) return false;
		return this.insideAncestorClips(screenX, screenY);
	}

	/** `pointerEvents: none` here or on any ancestor. */
	private get pointerEventsBlocked(): boolean {
		return this.ownPointerEvents === 'none' || (this.parentComponent?.pointerEventsBlocked ?? false);
	}

	private insideAncestorClips(screenX: number, screenY: number, ratio = this.clipRatio): boolean {
		const ancestor = this.parentComponent;
		if (!ancestor || this.promoted) return true;
		if (ancestor.clipsChildren && !ancestor.containsInClip(screenX, screenY, ratio)) return false;
		return ancestor.insideAncestorClips(screenX, screenY, ratio);
	}

	/** The ratio the draw API snapped the last frame's clips at (R7.2), 1 while unmounted. */
	private get clipRatio(): number {
		return this.mountContext?.draw.devicePixelScale ?? 1;
	}

	/**
	 * R4.4's half-open test against this component's clip as `pushClip` leaves
	 * it: under a translation, its screen edges snapped at `ratio` (R7.8a), so
	 * a point hits exactly the pixels the clip kept; otherwise in local space.
	 */
	private containsInClip(screenX: number, screenY: number, ratio: number): boolean {
		const matrix = this.screenMatrix;
		const clip = this.clipRect;
		if (isTranslateOnly(matrix)) {
			const snapped = snapClipRect({
				minX: clip.x + matrix[4],
				minY: clip.y + matrix[5],
				maxX: clip.x + clip.width + matrix[4],
				maxY: clip.y + clip.height + matrix[5],
			}, ratio);
			return screenX >= snapped.minX && screenX < snapped.maxX && screenY >= snapped.minY && screenY < snapped.maxY;
		}
		const local = this.screenToLocal({ x: screenX, y: screenY });
		if (!local) return false;
		return local.x >= clip.x && local.x < clip.x + clip.width && local.y >= clip.y && local.y < clip.y + clip.height;
	}

	// -- clipping (chapter 4) -------------------------------------------------

	public get overflow(): Overflow {
		return this.ownOverflow;
	}

	public set overflow(value: Overflow) {
		this.setOverflow(value);
	}

	/**
	 * Whether the walk clips this component's children to `clipRect`. The one
	 * fact rendering, hit testing and the snapshot all read. A zero-sized box
	 * clips nothing.
	 */
	public get clipsChildren(): boolean {
		return this.ownOverflow === 'hidden' && this.contentWidth > 0 && this.contentHeight > 0;
	}

	/** The clip in this component's local space: its content box. */
	public get clipRect(): Rect {
		return { x: 0, y: 0, width: this.contentWidth, height: this.contentHeight };
	}

	// -- state and its effective values (R8.2, R8.3) --------------------------

	public get visible(): boolean {
		return this.ownVisible;
	}

	public set visible(value: boolean) {
		if (this.ownVisible === value) return;
		this.ownVisible = value;
		this.invalidateLayout();
	}

	public get enabled(): boolean {
		return this.ownEnabled;
	}

	public set enabled(value: boolean) {
		this.setEnabled(value);
	}

	/** Own opacity in [0, 1]; the walk multiplies it down the tree (R3.25). */
	public get opacity(): number {
		return this.ownOpacity;
	}

	public set opacity(value: number) {
		this.ownOpacity = value;
	}

	/** Own layer, or null to inherit (R3.6). */
	public get layer(): LayerName | null {
		return this.ownLayer;
	}

	public set layer(value: LayerName | null) {
		this.ownLayer = value;
	}

	/** Local order among siblings (R3.12). Marks the parent's order view and nothing else. */
	public get zIndex(): number {
		return this.ownZIndex;
	}

	public set zIndex(value: number) {
		if (this.ownZIndex === value) return;
		this.ownZIndex = value;
		if (this.parentComponent) this.parentComponent.orderView = null;
	}

	public get pointerEvents(): PointerEvents {
		return this.ownPointerEvents;
	}

	public set pointerEvents(value: PointerEvents) {
		this.ownPointerEvents = value;
	}

	/** Visible, and so is every ancestor. */
	public get effectivelyVisible(): boolean {
		return this.visible && (this.parentComponent?.effectivelyVisible ?? true);
	}

	/** Enabled, and so is every ancestor: a disabled container disables its subtree for input. */
	public get effectivelyEnabled(): boolean {
		return this.enabled && (this.parentComponent?.effectivelyEnabled ?? true);
	}

	/** The product of own and ancestor opacities. */
	public get effectiveOpacity(): number {
		return this.ownOpacity * (this.parentComponent?.effectiveOpacity ?? 1);
	}

	/** `max(own, parent's effective)`, `base` at a root (R3.6). */
	public get effectiveLayer(): LayerName {
		const inherited = this.parentComponent ? this.parentComponent.effectiveLayer : ROOT_LAYER;
		const own = this.ownLayer;
		return own !== null && layerOrdinal(own) > layerOrdinal(inherited) ? own : inherited;
	}

	/**
	 * Raised above its parent's effective layer, which resets the inherited
	 * clip for this subtree (R3.8, R4.8).
	 */
	public get promoted(): boolean {
		const own = this.ownLayer;
		if (own === null) return false;
		const inherited = this.parentComponent ? this.parentComponent.effectiveLayer : ROOT_LAYER;
		return layerOrdinal(own) > layerOrdinal(inherited);
	}

	// -- tree (R8.4 to R8.7, R8.27) -------------------------------------------

	public get parent(): Component | null {
		return this.parentComponent;
	}

	public get root(): Component {
		return this.parentComponent ? this.parentComponent.root : this;
	}

	/**
	 * True when this component is one of its parent's own drawings rather than
	 * a child a caller added. R8.8 lets a composite build its visuals from
	 * child shapes; this mark is what tells the lint the two apart.
	 */
	public get isPart(): boolean {
		return this.ownedByParent;
	}

	/** The insertion-ordered children, exactly as added (R8.6). */
	public getChildren(): Component[] {
		return this.children;
	}

	/** The children list the tree walkers read; same as `getChildren` now that nothing redirects it. */
	public get debugChildren(): readonly Component[] {
		return this.children;
	}

	/**
	 * R3.12 and R3.13: children stable-sorted by `zIndex`, as a separate view.
	 * When every child is at zIndex 0, which is the common case, the view is
	 * the children list itself and costs nothing.
	 */
	public get renderOrder(): readonly Component[] {
		if (this.orderView) return this.orderView;
		const children = this.children;
		let sorted = false;
		for (let index = 0; index < children.length; index++) {
			if (children[index].ownZIndex !== 0) {
				sorted = true;
				break;
			}
		}
		this.orderView = sorted
			? children
				.map((child, index) => ({ child, index }))
				.sort((a, b) => a.child.ownZIndex - b.child.ownZIndex || a.index - b.index)
				.map((entry) => entry.child)
			: children;
		return this.orderView;
	}

	public addChild(child: Component): this {
		return this.insertChild(this.children.length, child);
	}

	/**
	 * Inserts at `index`. A child already under this parent moves instead,
	 * keeping its state (R8.5); a child under another parent is detached from
	 * it first.
	 */
	public insertChild(index: number, child: Component): this {
		// A child under itself or its own descendant is a parent loop, and
		// every upward walk (root, screenMatrix, effective values) would
		// recurse without end.
		if (child === this || child.isAncestorOf(this)) {
			throw new Error(`insertChild: ${child.componentType} cannot be added under itself or its own descendant`);
		}
		if (child.parentComponent === this) {
			// Re-adding an exiting child keeps it (R8.27's exit is abandoned).
			child.exiting = false;
			this.moveChild(child, index);
			return this;
		}
		const previousParent = child.parentComponent;
		if (previousParent) {
			// R8.5: a move within one root keeps the subtree mounted; a move
			// across roots is a removal first.
			const sameRoot = previousParent.root === this.root;
			previousParent.detachChild(child);
			if (!sameRoot) child.unmount();
		}
		child.parentComponent = this;
		// The mark belongs to the edge, not the node: a layer that was once
		// someone's part and is re-added as an ordinary child is an ordinary
		// child, or rule 1's sibling pairing would never see it again.
		child.ownedByParent = false;
		this.children.splice(clampIndex(index, this.children.length), 0, child);
		this.orderView = null;
		// R8.15: adding to a mounted parent mounts at once.
		if (this.mountContext && !child.mountContext) child.mount(this.mountContext);
		this.invalidateLayout();
		child.onParentChanged();
		return this;
	}

	/**
	 * Called after this component is inserted under a new parent. A size a
	 * previous parent's layout assigned is that parent's; a text re-fits here.
	 */
	protected onParentChanged(): void {
		// Override in subclasses
	}

	private isAncestorOf(node: Component): boolean {
		const parent = node.parentComponent;
		return parent !== null && (parent === this || this.isAncestorOf(parent));
	}

	/** One of this component's own drawings (R8.8), marked for the lint. */
	public addPart(child: Component): this {
		this.addChild(child);
		child.ownedByParent = true;
		return this;
	}

	/**
	 * Moves a child to `index` without detaching it: no unmount, hover and
	 * focus kept (R8.5). Out-of-range indices clamp.
	 */
	public moveChild(child: Component, index: number): this {
		const from = this.children.indexOf(child);
		if (from === -1) return this;
		this.children.splice(from, 1);
		this.children.splice(clampIndex(index, this.children.length), 0, child);
		this.orderView = null;
		return this;
	}

	/** Detaches and unmounts the subtree (R8.7). */
	public removeChild(child: Component): boolean {
		if (!this.detachChild(child)) return false;
		child.unmount();
		return true;
	}

	/** Removes and unmounts every child. */
	public clearChildren(): void {
		const removed = this.children;
		this.children = [];
		this.orderView = null;
		for (const child of removed) {
			child.parentComponent = null;
			child.ownedByParent = false;
			child.unmount();
		}
		this.invalidateLayout();
	}

	private detachChild(child: Component): boolean {
		const index = this.children.indexOf(child);
		if (index === -1) return false;
		this.children.splice(index, 1);
		this.orderView = null;
		child.parentComponent = null;
		// Like the part mark, key and exit belong to the edge: a keyed child
		// moved elsewhere is not the new parent's reconciled child.
		child.ownedByParent = false;
		child[RECONCILE_KEY] = undefined;
		child.exiting = false;
		this.invalidateLayout();
		return true;
	}

	/**
	 * R8.27: a keyed diff of this component's children against `items`.
	 * Children this call created are tracked by key; kept keys are updated in
	 * place and moved into item order without unmounting, new keys are
	 * created, and keys no longer present are removed. A removal whose
	 * `remove` returns a promise stays in the list, drawn after everything
	 * else and out of key matching, so its exit animation shows, and is
	 * detached and unmounted when the promise settles, unless it was re-added
	 * somewhere in the meantime. Children added by other means are left alone
	 * and sort after the reconciled ones.
	 */
	public reconcileChildren<Item, Child extends Component>(
		items: readonly Item[],
		{ key, create, update, remove }: ReconcileOptions<Item, Child>,
	): void {
		const existing = new Map<string, Child>();
		for (const child of this.children) {
			const childKey = child[RECONCILE_KEY];
			if (childKey !== undefined && !child.exiting) existing.set(childKey, child as Child);
		}

		const ordered: Child[] = [];
		const keys: string[] = [];
		const seen = new Set<string>();
		for (const item of items) {
			const itemKey = key(item);
			if (seen.has(itemKey)) throw new Error(`reconcileChildren: duplicate key "${itemKey}"`);
			seen.add(itemKey);
			const child = existing.get(itemKey);
			if (child) update?.(child, item);
			ordered.push(child ?? create(item));
			keys.push(itemKey);
		}

		for (const [childKey, child] of existing) {
			if (seen.has(childKey)) continue;
			child[RECONCILE_KEY] = undefined;
			const pending = remove?.(child);
			if (!pending) {
				this.removeChild(child);
				continue;
			}
			child.exiting = true;
			this.moveChild(child, this.children.length);
			const finish = (): void => {
				// Only if it is still this list's exiting child: one re-added
				// elsewhere, or already removed, is not ours to unmount.
				if (child.parentComponent === this && child.exiting) this.removeChild(child);
			};
			pending.then(finish, finish);
		}

		ordered.forEach((child, index) => {
			if (child.parentComponent === this) this.moveChild(child, index);
			else this.insertChild(index, child);
			// After insertion, which clears a key a created child brought from elsewhere.
			child[RECONCILE_KEY] = keys[index];
		});
	}

	/** Depth-first search of this subtree by `id` (R8.4). */
	public findById(id: string): Component | null {
		if (this.componentId === id) return this;
		for (const child of this.children) {
			const found = child.findById(id);
			if (found) return found;
		}
		return null;
	}

	// -- lifecycle (R8.14 to R8.17, R8.28) ------------------------------------

	public get isMounted(): boolean {
		return this.mountContext !== null;
	}

	/** The services this component was mounted with; null while unmounted (R8.4). */
	public get context(): MountContext | null {
		return this.mountContext;
	}

	/**
	 * Attaches this subtree to a rooted tree, top-down: `onMount` here, then
	 * the children. A no-op when already mounted. Roots are mounted by their
	 * owner (a screen, the gallery host); everything else is mounted by
	 * `addChild` on a mounted parent.
	 */
	public mount(context: MountContext): void {
		if (this.mountContext) return;
		this.mountSubtree(context);
		// A root sizes its `fill` axes from the viewport, so the frame
		// re-lays it out when the viewport changes (R8.21).
		if (!this.parentComponent) context.frame.addRoot(this);
		// A root is hit-tested from here on, over the roots mounted before it (R9.4).
		if (!this.parentComponent) context.dispatcher.addRoot(this);
		// The first layout after mount reports every component's bounds through
		// `onLayout`, so geometry is known before the first render (R8.21).
		this.invalidateLayout();
	}

	private mountSubtree(context: MountContext): void {
		if (this.mountContext) return;
		this.mountContext = context;
		this.needsLayout = true;
		this.onMount(context);
		for (const child of this.children) child.mountSubtree(context);
	}

	/**
	 * Detaches this subtree from its rooted tree, bottom-up: the children,
	 * then the dispatcher's hold on it (a captor hears `pointercancel` here,
	 * R9.10), then `onUnmount`, then update requests, pending layout, and the
	 * tweens it owns. Hover and focus are cleared without callbacks (R9.21).
	 * A no-op when not
	 * mounted (R8.15).
	 */
	public unmount(): void {
		const context = this.mountContext;
		if (!context) return;
		for (const child of this.children) child.unmount();
		context.dispatcher.forget(this);
		this.onUnmount();
		context.frame.forget(this);
		context.animator.cancelOwnedBy(this);
		this.mountContext = null;
		this.laidOutBounds = null;
		this.hoverState = false;
		this.focusState = false;
	}

	/**
	 * Registration goes here, never in the constructor (R8.14). The context is
	 * also `this.context` from here until `onUnmount` returns.
	 */
	protected onMount(_context: MountContext): void {
		// Override in subclasses
	}

	/** Release what `onMount` registered beyond dispatcher state, update requests and owned tweens, which the base releases. */
	protected onUnmount(): void {
		// Override in subclasses
	}

	/**
	 * R8.17: `update(dt)` on the next frame, once. Ignored while unmounted,
	 * since nothing would run it.
	 */
	public requestUpdate(): void {
		this.mountContext?.frame.requestUpdate(this);
	}

	/**
	 * Called only on the frame after `requestUpdate`, in the update phase,
	 * before layout. Components that animate request again from here.
	 * @param _dt Seconds since the last frame, clamped (R13.9)
	 */
	public update(_dt: number): void {
		// Override in subclasses
	}

	/**
	 * Explicit size estimation, called by hand where a screen needs Text sizes
	 * before the first render. Phase 4's measure and assign replace it; it is
	 * not the frame's layout pass, which is `layoutSubtree`.
	 */
	public layout(): void {
		for (const child of this.children) {
			child.layout();
		}
	}

	/**
	 * R8.18: something that affects size or position changed. Marks this
	 * component and every ancestor up to the nearest relayout boundary, and
	 * hands the boundary to the frame's layout phase.
	 */
	public invalidateLayout(): void {
		this.needsLayout = true;
		const boundary = this.parentComponent ? this.parentComponent.markLayoutPath() : this;
		this.mountContext?.frame.scheduleLayout(boundary);
	}

	private markLayoutPath(): Component {
		this.needsLayout = true;
		if (this.isRelayoutBoundary || !this.parentComponent) return this;
		return this.parentComponent.markLayoutPath();
	}

	/**
	 * Whether this component's own size is independent of its children, so a
	 * change beneath it stops here: both sizing modes `fixed` (R8.18). A root
	 * is a boundary whatever its modes, since there is nothing above it.
	 */
	protected get isRelayoutBoundary(): boolean {
		return this.ownWidthMode === 'fixed' && this.ownHeightMode === 'fixed';
	}

	/**
	 * Positions and sizes this component's children. The frame's layout pass
	 * calls it top-down on dirty components; Stack implements chapter 10's
	 * passes here.
	 */
	protected layoutChildren(): void {
		// A plain container leaves its children where they were put.
	}

	/**
	 * The frame's layout pass over this subtree (R8.16, R8.18): a root sizes
	 * itself from the viewport on its `fill` axes (R8.21), dirty components lay
	 * out their children and place anchored ones (R10.15), top-down; invisible
	 * subtrees are skipped and stay dirty for when they are shown (R8.3);
	 * every component whose bounds changed hears `onLayout`.
	 */
	public layoutSubtree(): void {
		if (!this.visible) return;
		if (!this.parentComponent) this.sizeFromViewport();
		if (this.needsLayout) {
			this.needsLayout = false;
			this.layoutChildren();
			this.placeAnchoredChildren();
			for (const child of this.children) child.layoutSubtree();
		}
		this.reportLayout();
	}

	/**
	 * R8.21: a root's layout box is the viewport, so a root with a `fill` axis
	 * takes the viewport's logical size, less its margin, on that axis.
	 */
	private sizeFromViewport(): void {
		const context = this.mountContext;
		if (!context || (this.ownWidthMode !== 'fill' && this.ownHeightMode !== 'fill')) return;
		const { width, height } = context.viewport.logical;
		const margin = this.ownMargin;
		this.applyLayoutSize(
			this.ownWidthMode === 'fill' ? Math.max(width - margin.left - margin.right, 0) : this.contentWidth,
			this.ownHeightMode === 'fill' ? Math.max(height - margin.top - margin.bottom, 0) : this.contentHeight,
		);
	}

	/**
	 * R10.15: `origin = box.origin + anchor * box.size - pivot * child.size +
	 * position`, for every child this component anchors, against `anchorBox`.
	 * With the default `topLeft` anchor and pivot the shift is zero, so a
	 * child placed by hand stays exactly where `position` put it.
	 */
	private placeAnchoredChildren(): void {
		const box = this.anchorBox;
		for (const child of this.children) {
			if (!this.anchorsChild(child)) {
				child.anchorShiftX = 0;
				child.anchorShiftY = 0;
				continue;
			}
			const anchor = child.ownAnchor;
			const pivot = child.pivot;
			const margin = child.ownMargin;
			const width = child.contentWidth + margin.left + margin.right;
			const height = child.contentHeight + margin.top + margin.bottom;
			child.anchorShiftX = box.x + anchor[0] * box.width - pivot[0] * width;
			child.anchorShiftY = box.y + anchor[1] * box.height - pivot[1] * height;
		}
	}

	/** The box anchored children are placed against, in this component's local space. */
	protected get anchorBox(): Rect {
		return { x: 0, y: 0, width: this.contentWidth, height: this.contentHeight };
	}

	/**
	 * Whether `placeAnchoredChildren` places this child. Every child outside a
	 * stack (R10.15); a stack answers only for its `absolute` children.
	 */
	protected anchorsChild(_child: Component): boolean {
		return true;
	}

	// -- sizing (R8.1's layout protocol, R10.1, R10.4) -------------------------

	public get widthMode(): SizeMode {
		return this.ownWidthMode;
	}

	public set widthMode(value: SizeMode) {
		if (this.ownWidthMode === value) return;
		this.ownWidthMode = value;
		this.invalidateLayout();
	}

	public get heightMode(): SizeMode {
		return this.ownHeightMode;
	}

	public set heightMode(value: SizeMode) {
		if (this.ownHeightMode === value) return;
		this.ownHeightMode = value;
		this.invalidateLayout();
	}

	public sizeMode(axis: Axis): SizeMode {
		return axis === 'width' ? this.ownWidthMode : this.ownHeightMode;
	}

	/** Content size on one axis. */
	public sizeOn(axis: Axis): number {
		return axis === 'width' ? this.contentWidth : this.contentHeight;
	}

	public get fillWeight(): number {
		return this.ownFillWeight;
	}

	public set fillWeight(value: number) {
		if (this.ownFillWeight === value) return;
		this.ownFillWeight = value;
		this.invalidateLayout();
	}

	/** Explicit minimums; an absent axis falls back to `automaticMinSize` on a stack's main axis. */
	public get minSize(): AxisLimits {
		return this.ownMinSize;
	}

	public set minSize(value: AxisLimits) {
		this.ownMinSize = { ...value };
		this.invalidateLayout();
	}

	public get maxSize(): AxisLimits {
		return this.ownMaxSize;
	}

	public set maxSize(value: AxisLimits) {
		this.ownMaxSize = { ...value };
		this.invalidateLayout();
	}

	/** Width over height, or null. */
	public get aspectRatio(): number | null {
		return this.ownAspectRatio;
	}

	public set aspectRatio(value: number | null) {
		if (this.ownAspectRatio === value) return;
		this.ownAspectRatio = value;
		this.invalidateLayout();
	}

	public get alignSelf(): CrossAlign | null {
		return this.ownAlignSelf;
	}

	public set alignSelf(value: CrossAlign | null) {
		if (this.ownAlignSelf === value) return;
		this.ownAlignSelf = value;
		this.invalidateLayout();
	}

	public get positioned(): Positioned {
		return this.ownPositioned;
	}

	public set positioned(value: Positioned) {
		if (this.ownPositioned === value) return;
		this.ownPositioned = value;
		this.invalidateLayout();
	}

	public get anchor(): Fraction2 {
		return this.ownAnchor;
	}

	public set anchor(value: AnchorInput) {
		this.ownAnchor = normalizeAnchor(value);
		this.invalidateLayout();
	}

	/** The effective pivot: the authored one, or the anchor (R10.15). */
	public get pivot(): Fraction2 {
		return this.ownPivot ?? this.ownAnchor;
	}

	public set pivot(value: AnchorInput | null) {
		this.ownPivot = value === null ? null : normalizeAnchor(value);
		this.invalidateLayout();
	}

	/**
	 * The minimum a stack applies on its main axis when `minSize` leaves that
	 * axis unset: CSS `min-width: auto` (R10.4). Zero except for text.
	 */
	public automaticMinSize(_axis: Axis): number {
		return 0;
	}

	/**
	 * Whether this component resolves its children's sizes in its own layout
	 * (a stack). A child of one is assigned its size every pass and never
	 * sizes itself.
	 */
	public get sizesChildren(): boolean {
		return false;
	}

	/**
	 * R8.1's `measure`: the content size this component takes with at most the
	 * given space, before its parent's clamps. `definite` names an axis the
	 * parent will assign exactly (a stretched cross axis), so the other axis
	 * is measured at that size. A component with no content to measure
	 * reports the size it was given, not one a layout assigned it, so a box
	 * that was stretched once does not keep the stretch.
	 */
	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
		return {
			width: definite === 'width' ? availableWidth : this.givenWidth,
			height: definite === 'height' ? availableHeight : this.givenHeight,
		};
	}

	/**
	 * R8.1's `assignSize` (worldsim's `setLayoutSize`): the parent resolves this
	 * component's content size for the current pass. NaN keeps an axis. It
	 * never changes a sizing mode (R10.5) and does not invalidate upward, since
	 * the parent doing the assigning is already laying out; a changed size
	 * marks this subtree so its own children follow.
	 */
	public assignSize(width: number, height: number): void {
		this.applyLayoutSize(
			Number.isNaN(width) ? this.contentWidth : width,
			Number.isNaN(height) ? this.contentHeight : height,
		);
	}

	/**
	 * Sets this component's own size from inside its own layout (a hug stack
	 * with no stack above it). Nothing to mark here, since this layout is the
	 * one running; the parent is invalidated, since it may anchor this box or
	 * read its size to place something else.
	 */
	protected resizeInLayout(width: number, height: number): void {
		if (this.contentWidth === width && this.contentHeight === height) return;
		this.contentWidth = width;
		this.contentHeight = height;
		this.parentComponent?.invalidateLayout();
	}

	/** Sets the content size as layout's result: no upward invalidation. Returns whether it changed. */
	protected applyLayoutSize(width: number, height: number): boolean {
		if (this.contentWidth === width && this.contentHeight === height) return false;
		this.contentWidth = width;
		this.contentHeight = height;
		this.needsLayout = true;
		return true;
	}

	private reportLayout(): void {
		const bounds = this.bounds;
		const previous = this.laidOutBounds;
		if (previous && previous.x === bounds.x && previous.y === bounds.y
			&& previous.width === bounds.width && previous.height === bounds.height) {
			return;
		}
		this.laidOutBounds = bounds;
		this.onLayout?.(bounds);
	}

	// -- input (R8.1, R8.2, chapter 9) ----------------------------------------

	/**
	 * Every event the dispatcher delivers to this component, as target or as
	 * an ancestor it bubbles through (R9.6). The base runs the matching
	 * callback property; composites override, call this first, then do their
	 * own handling. `event.consume()` stops the bubble.
	 */
	public handleEvent(event: AnyUiEvent): void {
		switch (event.type) {
			case 'pointerdown':
				this.onPointerDown?.(event);
				return;
			case 'pointerup':
				this.onPointerUp?.(event);
				return;
			case 'pointermove':
				this.onPointerMove?.(event);
				return;
			case 'pointerenter':
				this.onPointerEnter?.(event);
				return;
			case 'pointerleave':
				this.onPointerLeave?.(event);
				return;
			case 'click':
				this.onClick?.(event);
				return;
			case 'contextmenu':
				this.onContextMenu?.(event);
				return;
			case 'wheel':
				this.onWheel?.(event);
				return;
			case 'keydown':
				this.onKeyDown?.(event);
				return;
			case 'keyup':
				this.onKeyUp?.(event);
				return;
		}
	}

	/**
	 * R9.32: whether a wheel of these logical-pixel deltas would move this
	 * component's content. The dispatcher latches the innermost scroller under
	 * the pointer that answers true and sends it the wheel events.
	 */
	public canScroll(_deltaX: number, _deltaY: number): boolean {
		return false;
	}

	// -- interaction state ----------------------------------------------------

	/**
	 * The pointer is over it or over a descendant (R9.8). Maintained by the
	 * dispatcher, which calls `setHovered`.
	 */
	public get hovered(): boolean {
		return this.hoverState;
	}

	public get focused(): boolean {
		return this.focusState;
	}

	public isHovered(): boolean {
		return this.hoverState;
	}

	public setHovered(hovered: boolean): void {
		if (this.hoverState === hovered) return;
		this.hoverState = hovered;
		if (hovered) this.onHover();
		else this.onUnhover();
	}

	public isFocused(): boolean {
		return this.focusState;
	}

	public setFocused(focused: boolean): void {
		if (this.focusState === focused) return;
		this.focusState = focused;
		if (focused) this.onFocus();
		else this.onBlur();
	}

	public isEnabled(): boolean {
		return this.enabled;
	}

	public setEnabled(enabled: boolean): this {
		if (this.ownEnabled === enabled) return this;
		this.ownEnabled = enabled;
		if (!enabled) {
			// Hover is the dispatcher's containment state and stays true under
			// the pointer (R9.8); a disabled component shows it only through
			// its disabled style (R9.5).
			this.setFocused(false);
			this.onDisabled();
		} else {
			this.onEnabled();
		}
		return this;
	}

	protected onHover(): void {
		// Override in subclasses
	}

	protected onUnhover(): void {
		// Override in subclasses
	}

	protected onFocus(): void {
		// Override in subclasses
	}

	protected onBlur(): void {
		// Override in subclasses
	}

	protected onEnabled(): void {
		// Override in subclasses
	}

	protected onDisabled(): void {
		// Override in subclasses
	}

	// -- legacy method-style accessors (R8.23's codemod renames these) --------

	public setX(x: number): this {
		this.x = x;
		return this;
	}

	public setY(y: number): this {
		this.y = y;
		return this;
	}

	public setPosition(x: number, y: number): this {
		this.x = x;
		this.y = y;
		return this;
	}

	public setWidth(width: number): this {
		this.width = width;
		return this;
	}

	public setHeight(height: number): this {
		this.height = height;
		return this;
	}

	public setSize(width: number, height: number): this {
		const changed = this.contentWidth !== width || this.contentHeight !== height;
		this.width = width;
		this.height = height;
		if (changed) this.onResized();
		return this;
	}

	/** Called when `setSize` changes the size. */
	protected onResized(): void {
		// Override in subclasses
	}

	public setVisible(visible: boolean): this {
		this.visible = visible;
		return this;
	}

	public getX(): number {
		return this.x;
	}

	public getY(): number {
		return this.y;
	}

	public getWidth(): number {
		return this.width;
	}

	public getHeight(): number {
		return this.height;
	}

	public isVisible(): boolean {
		return this.visible;
	}

	/** Requires width and height to be set; a zero-sized box has nothing to clip to. */
	public setOverflow(overflow: Overflow): this {
		if (overflow === 'hidden' && (this.contentWidth <= 0 || this.contentHeight <= 0)) {
			console.warn(`${this.componentType}: overflow requires both width and height to be set`);
			return this;
		}
		this.ownOverflow = overflow;
		return this;
	}

	public getOverflow(): Overflow {
		return this.ownOverflow;
	}
}

const ORIGIN: Vec2 = Object.freeze({ x: 0, y: 0 });

const NO_LIMITS: AxisLimits = Object.freeze({});

function clampIndex(index: number, length: number): number {
	return Math.max(0, Math.min(length, Math.floor(index)));
}
