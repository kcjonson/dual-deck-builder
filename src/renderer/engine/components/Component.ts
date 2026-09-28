import type { DrawApi } from '../draw/DrawApi';
import { Mat2D, Rect, Vec2, concat, invert, transformPoint, translation } from '../draw/geometry';
import { LayerName, ROOT_LAYER, layerOrdinal } from '../draw/layers';
import { InputSystem } from '../input/InputSystem';
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

/**
 * R8.29. `auto`: this box is a target and children are hit-tested.
 * `passthrough`: children only. `unit`: this box only, the walk does not
 * descend. `none`: neither.
 */
export type PointerEvents = 'auto' | 'passthrough' | 'unit' | 'none';

export type Overflow = 'visible' | 'hidden';

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
}

/**
 * Keyed reconciliation callbacks (R8.27). `remove` may defer the unmount by
 * returning a promise, so an exit animation can finish first; the child is out
 * of the children list at once either way.
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
	private ownedByParent = false;
	/** R3.13's render-order view; null when a child or a zIndex changed. */
	private orderView: readonly Component[] | null = null;
	private [RECONCILE_KEY]: string | undefined;

	constructor(options?: ComponentOptions) {
		this.ownPointerEvents = this.defaultPointerEvents;
		if (!options) return;
		if (options.id !== undefined) this.componentId = options.id;
		if (options.x !== undefined) this.positionX = options.x;
		if (options.y !== undefined) this.positionY = options.y;
		if (options.width !== undefined) this.contentWidth = options.width;
		if (options.height !== undefined) this.contentHeight = options.height;
		if (options.visible !== undefined) this.ownVisible = options.visible;
		if (options.enabled !== undefined) this.ownEnabled = options.enabled;
		if (options.opacity !== undefined) this.ownOpacity = options.opacity;
		if (options.layer !== undefined) this.ownLayer = options.layer;
		if (options.zIndex !== undefined) this.ownZIndex = options.zIndex;
		if (options.margin !== undefined) this.ownMargin = normalizeSides(options.margin);
		if (options.transform !== undefined) this.ownTransform = normalizeTransform(options.transform);
		if (options.pointerEvents !== undefined) this.ownPointerEvents = options.pointerEvents;
		if (options.overflow !== undefined) this.setOverflow(options.overflow);
		if (options.style) this.applyStyle(options.style);
	}

	/**
	 * R8.29's per-type default: `auto` for leaves and widgets. Containers say
	 * `passthrough` and composite widgets `unit` by overriding this.
	 */
	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
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

	/** Content width (R8.11). */
	public get width(): number {
		return this.contentWidth;
	}

	public set width(value: number) {
		this.contentWidth = value;
	}

	public get height(): number {
		return this.contentHeight;
	}

	public set height(value: number) {
		this.contentHeight = value;
	}

	public get margin(): Sides {
		return this.ownMargin;
	}

	public set margin(value: MarginInput) {
		this.ownMargin = normalizeSides(value);
	}

	/**
	 * The margin box in the parent's content box (R8.10, R8.11): what layout,
	 * the lint, and the snapshot report. Hit testing uses the content box.
	 */
	public get bounds(): Rect {
		const margin = this.ownMargin;
		return {
			x: this.positionX,
			y: this.positionY,
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
	 * Local (content box) to parent content box: the margin-box origin, the
	 * margin inset, then this component's transform.
	 */
	private get localMatrix(): Mat2D {
		const origin = translation(this.positionX + this.ownMargin.left, this.positionY + this.ownMargin.top);
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
	 * Paint order and occlusion are the dispatcher's (DDB-75); this answers
	 * for one component.
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

	private insideAncestorClips(screenX: number, screenY: number): boolean {
		const ancestor = this.parentComponent;
		if (!ancestor || this.promoted) return true;
		if (ancestor.clipsChildren) {
			const local = ancestor.screenToLocal({ x: screenX, y: screenY });
			if (!local) return false;
			const clip = ancestor.clipRect;
			if (local.x < clip.x || local.x >= clip.x + clip.width || local.y < clip.y || local.y >= clip.y + clip.height) {
				return false;
			}
		}
		return ancestor.insideAncestorClips(screenX, screenY);
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
		this.ownVisible = value;
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
		if (child.parentComponent === this) {
			this.moveChild(child, index);
			return this;
		}
		if (child.parentComponent) child.parentComponent.detachChild(child);
		child.parentComponent = this;
		// The mark belongs to the edge, not the node: a layer that was once
		// someone's part and is re-added as an ordinary child is an ordinary
		// child, or rule 1's sibling pairing would never see it again.
		child.ownedByParent = false;
		this.children.splice(clampIndex(index, this.children.length), 0, child);
		this.orderView = null;
		return this;
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
	}

	private detachChild(child: Component): boolean {
		const index = this.children.indexOf(child);
		if (index === -1) return false;
		this.children.splice(index, 1);
		this.orderView = null;
		child.parentComponent = null;
		child.ownedByParent = false;
		return true;
	}

	/**
	 * R8.27: a keyed diff of this component's children against `items`.
	 * Children this call created are tracked by key; kept keys are updated in
	 * place and moved into item order without unmounting, new keys are
	 * created, and keys no longer present leave the list at once and unmount
	 * once `remove` settles. Children added by other means are left alone and
	 * sort after the reconciled ones.
	 */
	public reconcileChildren<Item, Child extends Component>(
		items: readonly Item[],
		{ key, create, update, remove }: ReconcileOptions<Item, Child>,
	): void {
		const existing = new Map<string, Child>();
		for (const child of this.children) {
			const childKey = child[RECONCILE_KEY];
			if (childKey !== undefined) existing.set(childKey, child as Child);
		}

		const ordered: Child[] = [];
		const seen = new Set<string>();
		for (const item of items) {
			const itemKey = key(item);
			if (seen.has(itemKey)) throw new Error(`reconcileChildren: duplicate key "${itemKey}"`);
			seen.add(itemKey);
			let child = existing.get(itemKey);
			if (child) {
				update?.(child, item);
			} else {
				child = create(item);
				child[RECONCILE_KEY] = itemKey;
			}
			ordered.push(child);
		}

		for (const [childKey, child] of existing) {
			if (seen.has(childKey)) continue;
			this.detachChild(child);
			child[RECONCILE_KEY] = undefined;
			const pending = remove?.(child);
			if (pending) {
				pending.then(() => child.unmount(), () => child.unmount());
			} else {
				child.unmount();
			}
		}

		ordered.forEach((child, index) => {
			if (child.parentComponent === this) this.moveChild(child, index);
			else this.insertChild(index, child);
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

	// -- lifecycle ------------------------------------------------------------

	/**
	 * Update method for game logic
	 * @param dt Time since last update in seconds
	 */
	public update(dt: number): void {
		for (const child of this.children) {
			child.update(dt);
		}
	}

	/**
	 * Explicit size estimation, called by hand where a screen needs Text sizes
	 * before the first render. Phase 4's measure and assign replace it.
	 */
	public layout(): void {
		for (const child of this.children) {
			child.layout();
		}
	}

	/**
	 * Releases what the component registered, bottom-up. Safe to call on a
	 * subtree that was never registered.
	 */
	public unmount(): void {
		for (const child of this.children) {
			child.unmount();
		}
		InputSystem.unregisterComponent(this);
	}

	// -- interaction state ----------------------------------------------------

	/** The pointer is over it. Framework-maintained once the dispatcher lands (DDB-75). */
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
			this.setHovered(false);
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

function clampIndex(index: number, length: number): number {
	return Math.max(0, Math.min(length, Math.floor(index)));
}
