import type { DrawApi } from '../draw/DrawApi';
import {
	ClipRect,
	IDENTITY,
	Mat2D,
	RGBA,
	Rect,
	Vec2,
	concat,
	invert,
	isTranslateOnly,
	transformBoxInto,
	transformPoint,
	translation,
} from '../draw/geometry';
import { snapClipRect } from '../coords/snapping';
import { LayerName, ROOT_LAYER, layerOrdinal } from '../draw/layers';
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
import type { AnyUiEvent, UiActionEvent, UiDragEvent, UiFocusEvent, UiKeyEvent, UiPointerEvent, UiWheelEvent } from '../input/events';
import type { FocusDirection, FocusGroupConfig } from '../input/FocusManager';
import { HotkeyTable } from '../input/HotkeyTable';
import type { RootTier } from '../input/Dispatcher';
import { TooltipInput, TooltipSpec, normalizeTooltip } from '../services/tooltipSpec';
import type { StateFlags } from '../style/look';
import { tokens } from '../theme/tokens';

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
 * Layout's sizing modes, tooltips and the drag callbacks arrive with
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
	/** Clips only once width and height are both positive. */
	overflow?: Overflow;
	/** Fired after a layout in which this component's bounds changed, including the first (R8.21). */
	onLayout?: (bounds: Rect) => void;
	/** Shown by the tooltip service on hover (R12.22). */
	tooltip?: TooltipInput | null;
	/** A press here is not consumed by an open popup's outside-press close (R9.13). */
	popupTrigger?: boolean;
	/** R9.18: takes focus from a press, Tab, arrows, or `focus()`. */
	focusable?: boolean;
	/** R9.18: above 0 comes first in Tab order, ascending; below 0 is focusable but never a Tab stop. */
	tabIndex?: number;
	/** R9.29: one Tab stop whose focusable descendants the arrows move between. `true` is both axes, no wrap. */
	focusGroup?: boolean | Partial<FocusGroupConfig>;
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

export interface RootMountOptions {
	/** Where the root sits in paint and hit order; the overlay service passes `overlay`. */
	tier?: RootTier;
}

export type PointerCallback = (event: UiPointerEvent) => void;
/** A pointer click, or `activate` on a component that treats activation as a click (R12.7). */
export type ClickCallback = (event: UiPointerEvent | UiActionEvent) => void;
export type FocusCallback = (event: UiFocusEvent) => void;
export type WheelCallback = (event: UiWheelEvent) => void;
export type KeyCallback = (event: UiKeyEvent) => void;
export type DragCallback = (event: UiDragEvent) => void;

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
	private tooltipSpec: TooltipSpec | null = null;
	private hoverState = false;
	private focusState = false;
	private pressState = false;
	private focusVisibleState = false;
	private selectedState = false;
	private openState = false;
	private activeState = false;
	private dropActiveState = false;
	private ownFocusable = false;
	private ownTabIndex = 0;
	private ownFocusGroup: FocusGroupConfig | null = null;
	private groupActiveChild: Component | null = null;
	private hotkeyTable: HotkeyTable | null = null;
	/** Set while this component is a drag ghost (R9.12b): its travel in the parent's space. */
	private dragGhostOffset: Vec2 | null = null;
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
	/** `cachedMeasure`'s results since the last invalidation; null until first used. */
	private measureCache: Map<string, Size> | null = null;
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
	/**
	 * DDB-184's subtree ink cache. `placedInk` bounds everything this subtree
	 * can draw, in the parent's content space before the parent's scroll
	 * offset; `inkUnbounded` says nothing can bound it (a layer that may
	 * escape an ancestor's clip, a text not yet measured). Stale until
	 * `refreshInk` recomputes it; `invalidateInk` marks this component and
	 * every ancestor.
	 */
	private inkStale = true;
	private inkUnbounded = false;
	private readonly placedInk: ClipRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	/** Groups this subtree requested the last time the walk entered it; -1 until then and after any change. */
	private walkedGroups = -1;
	/** `clipRect` and `transformMatrix`, kept until the size, transform or drag offset changes; undefined when stale. */
	private clipRectCache: Rect | undefined = undefined;
	private matrixCache: Mat2D | null | undefined = undefined;

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
		if (options.tooltip !== undefined) this.tooltipSpec = normalizeTooltip(options.tooltip);
		if (options.popupTrigger !== undefined) this.popupTrigger = options.popupTrigger;
		if (options.focusable !== undefined) this.ownFocusable = options.focusable;
		if (options.tabIndex !== undefined) this.ownTabIndex = options.tabIndex;
		if (options.focusGroup !== undefined) this.ownFocusGroup = normalizeFocusGroup(options.focusGroup);
		if (options.fillWeight !== undefined) this.ownFillWeight = options.fillWeight;
		if (options.minSize !== undefined) this.ownMinSize = { ...options.minSize };
		if (options.maxSize !== undefined) this.ownMaxSize = { ...options.maxSize };
		if (options.aspectRatio !== undefined) this.ownAspectRatio = options.aspectRatio;
		if (options.alignSelf !== undefined) this.ownAlignSelf = options.alignSelf;
		if (options.positioned !== undefined) this.ownPositioned = options.positioned;
		if (options.anchor !== undefined) this.ownAnchor = normalizeAnchor(options.anchor);
		if (options.pivot !== undefined) this.ownPivot = normalizeAnchor(options.pivot);
	}

	/**
	 * R12.34: a focus group hears each press of one of its members (a click
	 * that counted, or an accepted `activate`) after the member has handled
	 * it, which is how a list selects the row that was clicked or activated.
	 * `Pressable` controls call it on their nearest focus-group ancestor;
	 * containers that are not groups ignore it.
	 */
	public memberPressed(_member: Component, _event: UiPointerEvent | UiActionEvent): void {
		// Not a focus group.
	}

	/** R8.2's layout callback. A property, as every callback is (R8.25). */
	public onLayout: ((bounds: Rect) => void) | null = null;

	// R8.2's input callbacks. `handleEvent` runs the one matching an event
	// before the component's own handling.
	public onPointerDown: PointerCallback | null = null;
	public onPointerUp: PointerCallback | null = null;
	public onPointerMove: PointerCallback | null = null;
	public onPointerEnter: PointerCallback | null = null;
	public onPointerLeave: PointerCallback | null = null;
	public onClick: ClickCallback | null = null;
	public onContextMenu: PointerCallback | null = null;
	public onWheel: WheelCallback | null = null;
	public onKeyDown: KeyCallback | null = null;
	public onKeyUp: KeyCallback | null = null;
	public onFocus: FocusCallback | null = null;
	public onBlur: FocusCallback | null = null;

	/**
	 * R9.26's explicit neighbours: where an arrow goes from here instead of
	 * the geometric search, when that component can take focus.
	 */
	public focusUp: Component | null = null;
	public focusDown: Component | null = null;
	public focusLeft: Component | null = null;
	public focusRight: Component | null = null;

	/** R9.16: Tab reaches this component while it is focused instead of moving focus. */
	public handlesTab = false;

	/**
	 * R9.15: a root that blocks what is beneath it. Hotkey tables of roots
	 * mounted before it, and the scene's table, never fire while it is
	 * mounted. The overlay service sets it on a modal's root.
	 */
	public modal = false;

	/** R9.12's drag events: enter, over, leave and drop on targets, end on the source. */
	public onDragEnter: DragCallback | null = null;
	public onDragOver: DragCallback | null = null;
	public onDragLeave: DragCallback | null = null;
	public onDrop: DragCallback | null = null;
	public onDragEnd: DragCallback | null = null;

	/**
	 * R9.13: a press on this component, or inside it, closes an open popup
	 * without being consumed, so one press moves from one open select to
	 * another. Selects, dropdown buttons, and anything else that opens a popup
	 * set it.
	 */
	public popupTrigger = false;

	/**
	 * R12.22: what the tooltip service shows while the pointer rests on this
	 * component, or on a descendant without a tooltip of its own. A string
	 * is a title.
	 */
	public get tooltip(): TooltipSpec | null {
		return this.tooltipSpec;
	}

	public set tooltip(value: TooltipInput | null) {
		this.tooltipSpec = normalizeTooltip(value);
	}

	/**
	 * R8.29's per-type default: `auto` for leaves and widgets. Containers say
	 * `passthrough` and composite widgets `unit` by overriding this.
	 */
	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	/**
	 * This component itself answers the pointer: a press, click, hover or
	 * drop-target callback is set on it. Widgets that act on pointer events
	 * in their own `handleEvent` override it to true.
	 *
	 * `pointerEvents` says whether the box takes hits, and R8.29 makes `auto`
	 * the default for every leaf, so a label takes hits as much as a button
	 * does. This is the other half, what the snapshot reports so the lint's
	 * rules 6 and 7 can tell a control from a label (R13.25.6, R13.25.7).
	 * Wheel and key callbacks are left out: a scroller is not a target, and
	 * keyboard reach is `focusable`'s question.
	 */
	public get handlesPointer(): boolean {
		return this.onPointerDown !== null
			|| this.onPointerUp !== null
			|| this.onPointerMove !== null
			|| this.onPointerEnter !== null
			|| this.onPointerLeave !== null
			|| this.onClick !== null
			|| this.onContextMenu !== null
			|| this.onDragEnter !== null
			|| this.onDragOver !== null
			|| this.onDrop !== null;
	}

	/**
	 * R10.1's per-kind default for an axis given its constructed size: `fixed`
	 * for everything but text and stacks, which hug an axis given no size.
	 */
	protected defaultSizeMode(_size: number | undefined): SizeMode {
		return 'fixed';
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
		if (this.positionX === value) return;
		this.positionX = value;
		this.invalidateInk();
	}

	public get y(): number {
		return this.positionY;
	}

	public set y(value: number) {
		if (this.positionY === value) return;
		this.positionY = value;
		this.invalidateInk();
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
		this.storeSize({ width: value, height: this.contentHeight, axes: 'width' });
	}

	public get height(): number {
		return this.contentHeight;
	}

	public set height(value: number) {
		this.storeSize({ width: this.contentWidth, height: value, axes: 'height' });
	}

	/**
	 * The one write path for a size the component is given (a constructor
	 * option aside): records it as given, so `measure` hugs it, and as the
	 * content size, and invalidates layout when either changed. `axes` limits
	 * which axes count as given. `setSize` reports a change through
	 * `onResized`; the single-axis accessors never have. Subclasses whose
	 * accessors mean something more (Text, Stack) call this rather than the
	 * base accessors.
	 */
	protected storeSize({ width, height, axes = 'both', notify = false }: StoreSizeOptions): void {
		const givesWidth = axes !== 'height';
		const givesHeight = axes !== 'width';
		const resized = this.contentWidth !== width || this.contentHeight !== height;
		const regiven = (givesWidth && this.givenWidth !== width) || (givesHeight && this.givenHeight !== height);
		if (givesWidth) this.givenWidth = width;
		if (givesHeight) this.givenHeight = height;
		this.contentWidth = width;
		this.contentHeight = height;
		if (resized) this.sizeChanged();
		if (resized || regiven) this.invalidateLayout();
		if (resized && notify) this.onResized();
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

	/**
	 * What the subtree cull (DDB-184) takes this component's own draws to
	 * cover, in local space: `inkRect`, or null when this component cannot
	 * bound its draws, which keeps every ancestor from being skipped on its
	 * account. The walk's focus ring is added on top. A subclass whose answer
	 * changes calls `invalidateInk`; anything that invalidates layout already
	 * does.
	 */
	protected get cullInk(): Rect | null {
		return this.inkRect;
	}

	/**
	 * `cullInk` grown by the walk's fallback focus ring while this component
	 * can show one: all this component itself draws, in local space, or null
	 * when that has no bound. The render walk hands it to the draw API's ink
	 * audit around `render` in development builds.
	 */
	public get ownInkBound(): Rect | null {
		const own = this.cullInk;
		if (own === null || !(this.ownFocusable || this.focusVisibleState)) return own;
		const ring = FOCUS_RING_EXTENT;
		return { x: own.x - ring, y: own.y - ring, width: own.width + ring * 2, height: own.height + ring * 2 };
	}

	/**
	 * Something that moves or grows what this subtree can draw changed: a
	 * position, size, transform, layer, content, or a child. Marks the cached
	 * ink stale here and on every ancestor, and forgets their group counts,
	 * so a changed subtree is walked once before it is skipped again. Always
	 * to the root rather than stopping at a stale ancestor, since a count can
	 * be taken while the ink is stale.
	 */
	protected invalidateInk(): void {
		this.inkStale = true;
		this.walkedGroups = -1;
		for (let node = this.parentComponent; node !== null; node = node.parentComponent) {
			node.inkStale = true;
			node.walkedGroups = -1;
		}
	}

	/**
	 * A conservative bound on everything this subtree draws, in the parent's
	 * content space before its scroll offset, or null when it has no bound.
	 * The render walk skips the subtree when this, through the current
	 * transform, misses the current clip (R4.2a). Recomputed only when stale;
	 * the returned rect is this component's own and is overwritten then.
	 */
	public get subtreeInk(): Readonly<ClipRect> | null {
		this.refreshInk();
		return this.inkUnbounded ? null : this.placedInk;
	}

	/**
	 * The render walk's: how many groups this subtree asked the draw API for
	 * the last time it was walked, which a skip adds to `culled` so that
	 * `apiDraws + culled` still counts every group (R4.2a). -1 when unknown,
	 * and a subtree is never skipped before it has been counted.
	 */
	public get walkedGroupCount(): number {
		return this.walkedGroups;
	}

	public set walkedGroupCount(count: number) {
		this.walkedGroups = count;
	}

	/**
	 * Own ink, grown by the walk's focus ring when this component can show
	 * one, unioned with every visible child's placed ink less the content
	 * offset, then placed by this component's origin and transform. Children
	 * are not intersected with this component's clip: the clip is snapped to
	 * device pixels at push, so the local rect is not quite what it keeps.
	 * Opacity is ignored, so a faded subtree is over-bounded, never under.
	 */
	private refreshInk(): void {
		if (!this.inkStale) return;
		this.inkStale = false;
		// A layer may be a promotion, which resets the clip (R4.8), so no
		// ancestor's clip bounds it.
		let unbounded = this.layer !== null;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		const own = unbounded ? null : this.ownInkBound;
		if (own === null) {
			unbounded = true;
		} else {
			minX = own.x;
			minY = own.y;
			maxX = own.x + own.width;
			maxY = own.y + own.height;
		}
		const children = this.children;
		if (!unbounded && children.length > 0) {
			const offset = this.contentOffset;
			for (let index = 0; index < children.length; index++) {
				const child = children[index];
				if (!child.ownVisible) continue;
				child.refreshInk();
				if (child.inkUnbounded) {
					unbounded = true;
					break;
				}
				const ink = child.placedInk;
				if (ink.minX - offset.x < minX) minX = ink.minX - offset.x;
				if (ink.minY - offset.y < minY) minY = ink.minY - offset.y;
				if (ink.maxX - offset.x > maxX) maxX = ink.maxX - offset.x;
				if (ink.maxY - offset.y > maxY) maxY = ink.maxY - offset.y;
			}
		}
		this.inkUnbounded = unbounded;
		if (unbounded) return;
		const placed = transformBoxInto(this.transformMatrix ?? IDENTITY, minX, minY, maxX, maxY, this.placedInk);
		const originX = this.originX;
		const originY = this.originY;
		placed.minX += originX;
		placed.minY += originY;
		placed.maxX += originX;
		placed.maxY += originY;
	}

	/** Something `computeClipRect` reads, other than the size, changed. */
	protected invalidateClip(): void {
		this.clipRectCache = undefined;
		this.invalidateInk();
	}

	/** The content size changed: what depends on it is stale. */
	private sizeChanged(): void {
		this.clipRectCache = undefined;
		this.matrixCache = undefined;
		this.invalidateInk();
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
		this.matrixCache = undefined;
		this.invalidateInk();
	}

	/**
	 * The transform as a matrix over the content box, or null for identity.
	 * A drag ghost's offset is applied outside `transform`, so a tween on
	 * `transform` keeps running while the ghost follows the pointer.
	 */
	public get transformMatrix(): Mat2D | null {
		if (this.matrixCache !== undefined) return this.matrixCache;
		const own = transformMatrix(this.ownTransform, this.contentWidth, this.contentHeight);
		const ghost = this.dragGhostOffset;
		let matrix = own;
		if (ghost) {
			const lift = translation(ghost.x, ghost.y);
			matrix = own ? concat(lift, own) : lift;
		}
		this.matrixCache = matrix;
		return matrix;
	}

	/**
	 * R9.12b: while the drag service moves this component as a ghost, its
	 * offset from where layout put it, in the parent's content space; null
	 * otherwise. A ghost draws and hit-tests on the `drag` layer with
	 * `pointerEvents: none` and moves by this offset, all without touching
	 * the component's own `layer`, `pointerEvents` or `transform`, which
	 * read back as the ghost values and are the author's again when the drag
	 * ends.
	 */
	public get dragOffset(): Vec2 | null {
		return this.dragGhostOffset;
	}

	/** The drag service's: sets or clears the ghost state. */
	public setDragOffset(offset: Vec2 | null): void {
		this.dragGhostOffset = offset;
		this.matrixCache = undefined;
		this.invalidateInk();
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

	/**
	 * `point` in this content box carried up into `ancestor`'s content box,
	 * written into `out`: `screenMatrix`'s chain stopped at `ancestor`, applied
	 * a level at a time so it builds no matrices, for a caller that runs every
	 * frame (an aim line, a follower). False, with `out` untouched, when
	 * `ancestor` isn't above this component.
	 */
	public localToAncestorInto(point: Vec2, ancestor: Component, out: Vec2): boolean {
		const at = LIFT_SCRATCH;
		at.x = point.x;
		at.y = point.y;
		if (ancestor !== this) {
			for (let node = liftIntoParent(this, at); node !== ancestor; node = liftIntoParent(node, at)) {
				if (!node) return false;
			}
		}
		out.x = at.x;
		out.y = at.y;
		return true;
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
		return this.pointerEvents === 'none' || (this.parentComponent?.pointerEventsBlocked ?? false);
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

	/**
	 * The clip in this component's local space: `computeClipRect`'s answer,
	 * kept until the size changes so the walk allocates none per frame, and
	 * frozen because every reader shares it.
	 */
	public get clipRect(): Rect {
		if (this.clipRectCache === undefined) this.clipRectCache = Object.freeze(this.computeClipRect());
		return this.clipRectCache;
	}

	/**
	 * The content box. An override may read the size and anything fixed at
	 * construction, since `clipRect` keeps the answer until the size changes;
	 * one that reads anything else calls `invalidateClip` when it changes.
	 */
	protected computeClipRect(): Rect {
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

	/** Own layer, or null to inherit (R3.6); at least `drag` while a drag ghost. */
	public get layer(): LayerName | null {
		const own = this.ownLayer;
		if (this.dragGhostOffset && (own === null || layerOrdinal(own) < layerOrdinal('drag'))) return 'drag';
		return own;
	}

	public set layer(value: LayerName | null) {
		if (this.ownLayer === value) return;
		this.ownLayer = value;
		this.invalidateInk();
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

	/** `none` while a drag ghost, so the hit walk sees through it. */
	public get pointerEvents(): PointerEvents {
		return this.dragGhostOffset ? 'none' : this.ownPointerEvents;
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
		const own = this.layer;
		return own !== null && layerOrdinal(own) > layerOrdinal(inherited) ? own : inherited;
	}

	/**
	 * Raised above its parent's effective layer, which resets the inherited
	 * clip for this subtree (R3.8, R4.8).
	 */
	public get promoted(): boolean {
		const own = this.layer;
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
		this.invalidateFocusOrder();
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
		const to = clampIndex(index, this.children.length);
		this.children.splice(to, 0, child);
		if (to === from) return this;
		this.orderView = null;
		this.invalidateFocusOrder();
		// Order is flow input for a stack (R10.18).
		this.invalidateLayout();
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
			this.forgetActiveChild(child);
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
		this.forgetActiveChild(child);
		this.invalidateFocusOrder();
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
	public mount(context: MountContext, { tier = 'scene' }: RootMountOptions = {}): void {
		if (this.mountContext) return;
		this.mountSubtree(context);
		// A root sizes its `fill` axes from the viewport, so the frame
		// re-lays it out when the viewport changes (R8.21).
		if (!this.parentComponent) context.frame.addRoot(this);
		// A root is hit-tested from here on, over the roots of its tier mounted
		// before it (R9.4, R3.15).
		if (!this.parentComponent) context.dispatcher.addRoot(this, tier);
		// The first layout after mount reports every component's bounds through
		// `onLayout`, so geometry is known before the first render (R8.21).
		this.invalidateLayout();
	}

	private mountSubtree(context: MountContext): void {
		if (this.mountContext) return;
		this.mountContext = context;
		this.markDirty();
		this.onMount(context);
		for (const child of this.children) child.mountSubtree(context);
	}

	/**
	 * Detaches this subtree from its rooted tree, bottom-up: the children,
	 * then the dispatcher's hold on it (a captor hears `pointercancel` here,
	 * R9.10), then `onUnmount`, then update requests, pending layout, and the
	 * tweens it owns. The framework's flags (hover, press, focus, and
	 * focus-visible) are cleared without callbacks (R9.21). A no-op when not
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
		this.pressState = false;
		this.focusVisibleState = false;
		this.dropActiveState = false;
		// Through the setter, so the cached matrix and ink drop the ghost's offset too.
		this.setDragOffset(null);
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
		// Whatever needs a layout can also move or grow ink, content included.
		this.invalidateInk();
		this.markDirty();
		const boundary = this.parentComponent ? this.parentComponent.markLayoutPath() : this;
		this.mountContext?.frame.scheduleLayout(boundary);
	}

	private markLayoutPath(): Component {
		this.markDirty();
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
			let shiftX = 0;
			let shiftY = 0;
			if (this.anchorsChild(child)) {
				const anchor = child.ownAnchor;
				const pivot = child.pivot;
				const margin = child.ownMargin;
				const width = child.contentWidth + margin.left + margin.right;
				const height = child.contentHeight + margin.top + margin.bottom;
				shiftX = box.x + anchor[0] * box.width - pivot[0] * width;
				shiftY = box.y + anchor[1] * box.height - pivot[1] * height;
			}
			if (child.anchorShiftX === shiftX && child.anchorShiftY === shiftY) continue;
			child.anchorShiftX = shiftX;
			child.anchorShiftY = shiftY;
			child.invalidateInk();
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
	 * The smallest this component can be on `axis` without overflowing its
	 * own content: how far a stack may shrink it when the row or column runs
	 * out of room (R10.7's shrink-to-fit, CSS min-content). A component with
	 * nothing to reflow cannot shrink below the size it was given.
	 */
	public minContentSize(axis: Axis): number {
		if (this.sizeMode(axis) === 'fixed') return this.sizeOn(axis);
		return axis === 'width' ? this.givenWidth : this.givenHeight;
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
		this.sizeChanged();
		this.onResized();
		// Only the parent's placement of this box can change (its anchors),
		// so the parent alone is laid out again, not everything up to its
		// boundary.
		const parent = this.parentComponent;
		if (parent) {
			parent.needsLayout = true;
			parent.mountContext?.frame.scheduleLayout(parent);
		}
	}

	/**
	 * Sets the content size as layout's result: no upward invalidation, and
	 * `onResized` when it changed, as for any other resize. Returns whether
	 * it changed.
	 */
	protected applyLayoutSize(width: number, height: number): boolean {
		if (this.contentWidth === width && this.contentHeight === height) return false;
		this.contentWidth = width;
		this.contentHeight = height;
		this.sizeChanged();
		this.needsLayout = true;
		this.onResized();
		return true;
	}

	/**
	 * Something this component's measurement reads changed: lay it out again
	 * and forget what it measured. An assignment does not come through here,
	 * since `measure` never reads an assigned size.
	 */
	private markDirty(): void {
		this.needsLayout = true;
		if (this.measureCache) this.measureCache.clear();
	}

	/**
	 * `compute`'s answer for `key`, remembered until this component is next
	 * invalidated. Nested hug stacks measure each other at the same
	 * constraints over and over in one pass; this keeps a pass linear.
	 */
	protected cachedMeasure(key: string, compute: () => Size): Size {
		let cache = this.measureCache;
		if (!cache) {
			cache = new Map();
			this.measureCache = cache;
		}
		const hit = cache.get(key);
		if (hit) return hit;
		const size = compute();
		cache.set(key, size);
		return size;
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
			case 'focus':
				this.onFocus?.(event);
				return;
			case 'blur':
				this.onBlur?.(event);
				return;
			case 'dragenter':
				this.onDragEnter?.(event);
				return;
			case 'dragover':
				this.onDragOver?.(event);
				return;
			case 'dragleave':
				this.onDragLeave?.(event);
				return;
			case 'drop':
				this.onDrop?.(event);
				return;
			case 'dragend':
				this.onDragEnd?.(event);
				return;
		}
	}

	/**
	 * R12.20's `scrollIntoView` with `block: nearest`: a scroller moves the
	 * least that brings `descendant`'s box inside its clip. The focus manager
	 * asks every ancestor of a component focused by keyboard or code, inner
	 * first, so focus never lands out of sight. Only scrollers act.
	 */
	public scrollIntoView(_descendant: Component): void {
		// Not a scroller.
	}

	/**
	 * R9.32: whether a wheel of these logical-pixel deltas would move this
	 * component's content. The dispatcher latches the innermost scroller under
	 * the pointer that answers true and sends it the wheel events.
	 */
	public canScroll(_deltaX: number, _deltaY: number): boolean {
		return false;
	}

	// -- interaction state (R11.11) --------------------------------------------

	/**
	 * The pointer is over it or over a descendant (R9.8). Maintained by the
	 * dispatcher, which calls `setHovered`.
	 */
	public get hovered(): boolean {
		return this.hoverState;
	}

	/** Keys come here first (R9.15). Maintained by the focus manager, which calls `setFocusState`. */
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
		this.onStateChange();
	}

	/**
	 * The focus manager's half of `focused` and `focusVisible`. It delivers
	 * the `focus` and `blur` events itself, in R9.22's order; nothing else
	 * should call this.
	 */
	public setFocusState(focused: boolean, visible: boolean): void {
		const focusVisible = focused && visible;
		if (this.focusState === focused && this.focusVisibleState === focusVisible) return;
		if (this.focusVisibleState !== focusVisible) this.invalidateInk();
		this.focusState = focused;
		this.focusVisibleState = focusVisible;
		this.onStateChange();
	}

	/**
	 * A press began on it and has not been released, cancelled, or left. The
	 * framework's flag: whoever routes the press sets it (the widget itself
	 * until the dispatcher owns presses).
	 */
	public get pressed(): boolean {
		return this.pressState;
	}

	public set pressed(pressed: boolean) {
		if (this.pressState === pressed) return;
		this.pressState = pressed;
		this.onStateChange();
	}

	/**
	 * Focus arrived by keyboard, so the ring shows (R9.23, R11.12 layer 6).
	 * Only the focus manager changes it, through `setFocusState`; it is only
	 * ever true while focused.
	 */
	public get focusVisible(): boolean {
		return this.focusVisibleState;
	}

	// -- focus (R9.18 to R9.29) -----------------------------------------------

	public get focusable(): boolean {
		return this.ownFocusable;
	}

	public set focusable(value: boolean) {
		if (this.ownFocusable === value) return;
		this.ownFocusable = value;
		this.invalidateInk();
		this.invalidateFocusOrder();
	}

	public get tabIndex(): number {
		return this.ownTabIndex;
	}

	public set tabIndex(value: number) {
		if (this.ownTabIndex === value) return;
		this.ownTabIndex = value;
		this.invalidateFocusOrder();
	}

	/** R9.29's configuration when this container is a focus group, else null. */
	public get focusGroup(): FocusGroupConfig | null {
		return this.ownFocusGroup;
	}

	public set focusGroup(value: boolean | Partial<FocusGroupConfig> | null) {
		this.ownFocusGroup = normalizeFocusGroup(value);
		this.invalidateFocusOrder();
	}

	/** The member Tab enters a focus group at: the last one focused (R9.29). The focus manager keeps it. */
	public get activeChild(): Component | null {
		return this.groupActiveChild;
	}

	public set activeChild(value: Component | null) {
		this.groupActiveChild = value;
	}

	/**
	 * True when this component draws its own focus ring from `focusVisible`
	 * as one of its R11.12 state layers (Button and TextInput do), so the render
	 * walk's token ring, the fallback for focusables without a resolved look,
	 * skips it and nothing gets two rings.
	 */
	public get drawsOwnFocusRing(): boolean {
		return false;
	}

	/**
	 * R9.15: this component takes text, so while it is focused it owns every
	 * key but Tab, Escape, and Ctrl or Cmd chords; no hotkey, activation, or
	 * arrow navigation sees them. Text fields override it.
	 */
	public get acceptsText(): boolean {
		return false;
	}

	/**
	 * The strings this component draws itself rather than through a Text
	 * node (a select's label, a menu's rows, a slider's value), for the tree
	 * snapshot's `labels` and so for the visual text record (DDB-206). Null
	 * when it draws no text of its own.
	 */
	public get drawnText(): readonly string[] | null {
		return null;
	}

	/** R9.18: focusable, mounted, and effectively visible and enabled. */
	public canReceiveFocus(): boolean {
		return this.ownFocusable && this.mountContext !== null && this.effectivelyVisible && this.effectivelyEnabled;
	}

	/** The explicit neighbour in `direction`, if one was set (R9.26). */
	public focusNeighbour(direction: FocusDirection): Component | null {
		switch (direction) {
			case 'up':
				return this.focusUp;
			case 'down':
				return this.focusDown;
			case 'left':
				return this.focusLeft;
			case 'right':
				return this.focusRight;
		}
	}

	/**
	 * This root's hotkey table (R9.15): searched after a key bubbles out of
	 * the focused component in this tree, and for the topmost roots when
	 * nothing is focused. Created on first use.
	 */
	public get hotkeys(): HotkeyTable {
		if (!this.hotkeyTable) this.hotkeyTable = new HotkeyTable();
		return this.hotkeyTable;
	}

	/** The table if one was ever created, for the dispatcher's search. */
	public get ownHotkeys(): HotkeyTable | null {
		return this.hotkeyTable;
	}

	/**
	 * A focus group here or above whose active child was `removed` or inside
	 * it lets go (R9.29), so a detached card is not kept alive and Tab enters
	 * the group at its first member instead.
	 */
	private forgetActiveChild(removed: Component): void {
		const active = this.groupActiveChild;
		if (active && (active === removed || removed.isAncestorOf(active))) this.groupActiveChild = null;
		this.parentComponent?.forgetActiveChild(removed);
	}

	private invalidateFocusOrder(): void {
		this.mountContext?.focus.invalidateOrder();
	}

	/** The component's own flags (R11.11): a chosen tab or row, an open menu, a field taking keys, a live drop target. */
	public get selected(): boolean {
		return this.selectedState;
	}

	public set selected(selected: boolean) {
		if (this.selectedState === selected) return;
		this.selectedState = selected;
		this.onStateChange();
	}

	public get open(): boolean {
		return this.openState;
	}

	public set open(open: boolean) {
		if (this.openState === open) return;
		this.openState = open;
		this.onStateChange();
	}

	public get active(): boolean {
		return this.activeState;
	}

	public set active(active: boolean) {
		if (this.activeState === active) return;
		this.activeState = active;
		this.onStateChange();
	}

	/** R9.12c: accepted the drag under the pointer and would take the drop. The drag service sets it. */
	public get dropActive(): boolean {
		return this.dropActiveState;
	}

	public set dropActive(dropActive: boolean) {
		if (this.dropActiveState === dropActive) return;
		this.dropActiveState = dropActive;
		this.onStateChange();
	}

	/**
	 * Every R11.11 flag at once, composing rather than ranked; `enabled` is
	 * the effective one, so a disabled ancestor disables the look too. What
	 * style resolution reads and the tree snapshot reports.
	 */
	public get stateFlags(): StateFlags {
		return {
			hovered: this.hoverState,
			pressed: this.pressState,
			focused: this.focusState,
			focusVisible: this.focusVisibleState,
			enabled: this.effectivelyEnabled,
			selected: this.selectedState,
			open: this.openState,
			active: this.activeState,
			dropActive: this.dropActiveState,
		};
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
			// its disabled style (R9.5). Focus moves off it at the end of the
			// frame's layout (R9.28).
			this.onDisabled();
		} else {
			this.onEnabled();
		}
		this.notifyEnabledChange();
		return this;
	}

	/**
	 * Effective enabled state is inherited, so a change reaches every
	 * descendant's look, and a press in progress anywhere beneath a newly
	 * disabled ancestor ends: the release will not be delivered to it (R9.5).
	 */
	private notifyEnabledChange(): void {
		if (!this.effectivelyEnabled) this.pressState = false;
		this.onStateChange();
		for (const child of this.children) child.notifyEnabledChange();
	}

	/**
	 * After any R11.11 flag changes, here or, for `enabled`, on an ancestor.
	 * Styled components re-resolve their look from `stateFlags` here.
	 */
	protected onStateChange(): void {
		// Override in subclasses
	}

	protected onHover(): void {
		// Override in subclasses
	}

	protected onUnhover(): void {
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
		this.storeSize({ width, height, notify: true });
		return this;
	}

	/** Called when `setSize` or a layout assignment changes the content size. */
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

	/**
	 * A mode, not a clip: it may be set before the box has a size, which a
	 * screen sizes from the viewport on mount. `clipsChildren` answers false
	 * while the box is zero-sized, which has nothing to clip to.
	 */
	public setOverflow(overflow: Overflow): this {
		this.ownOverflow = overflow;
		return this;
	}

	public getOverflow(): Overflow {
		return this.ownOverflow;
	}
}

const ORIGIN: Vec2 = Object.freeze({ x: 0, y: 0 });

/** How far the walk's fallback focus ring reaches past the content box (R11.12). */
const FOCUS_RING_EXTENT = tokens.control.focus_ring_offset + tokens.control.focus_ring_width;

function normalizeFocusGroup(value: boolean | Partial<FocusGroupConfig> | null): FocusGroupConfig | null {
	if (!value) return null;
	const config = value === true ? {} : value;
	return { orientation: config.orientation ?? 'both', wrap: config.wrap ?? false };
}

const NO_LIMITS: AxisLimits = Object.freeze({});

interface StoreSizeOptions {
	width: number;
	height: number;
	axes?: Axis | 'both';
	/** Fire `onResized` on a change, as `setSize` does. */
	notify?: boolean;
}

function clampIndex(index: number, length: number): number {
	return Math.max(0, Math.min(length, Math.floor(index)));
}

const LIFT_SCRATCH: Vec2 = { x: 0, y: 0 };

/**
 * One level of `screenMatrix`'s chain applied to a point in place: the
 * node's transform, its origin, then its parent's content offset. Returns
 * the parent, whose content box the point is now in, or null at the root.
 */
function liftIntoParent(node: Component, point: Vec2): Component | null {
	const matrix = node.transformMatrix;
	if (matrix) {
		const x = matrix[0] * point.x + matrix[2] * point.y + matrix[4];
		point.y = matrix[1] * point.x + matrix[3] * point.y + matrix[5];
		point.x = x;
	}
	point.x += node.originX;
	point.y += node.originY;
	const parent = node.parent;
	if (!parent) return null;
	const offset = parent.contentOffset;
	point.x -= offset.x;
	point.y -= offset.y;
	return parent;
}
