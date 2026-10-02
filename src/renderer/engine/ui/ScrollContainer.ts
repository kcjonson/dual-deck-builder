import { Component, ComponentOptions, PointerEvents, ResolvedColors } from '../components/Component';
import type { Sides } from '../components/componentGeometry';
import type { Axis, Size } from '../components/layoutTypes';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA, Rect, Vec2 } from '../draw/geometry';
import type { AnyUiEvent, UiKeyEvent } from '../input/events';
import {
	StyleAcceptance,
	StyleObject,
	StyleProperty,
	resolveColor,
	resolveLength,
	resolvePadding,
	validateStyle,
} from '../style/styleObject';
import { tokens } from '../theme/tokens';
import { SCROLLBAR_GUTTER, Scrollbar } from './Scrollbar';

export type ScrollBlock = 'nearest' | 'center';

export interface ScrollIntoViewOptions {
	/** `nearest` (default) moves the least; `center` centres the component in the viewport. */
	block?: ScrollBlock;
}

export interface ScrollContainerOptions extends Omit<ComponentOptions, 'style'> {
	/** The scrollable height; absent, it is the content child's height after layout. */
	contentHeight?: number;
	/** After every change of the scroll position, by a user or by code. */
	onScroll?: (offset: number) => void;
	/** R11.14's closed set: an optional background box and the content inset (`padding`). */
	style?: StyleObject;
}

const SCROLL_STYLE: StyleAcceptance = {
	component: 'ScrollContainer',
	properties: new Set<StyleProperty>(['backgroundColor', 'borderColor', 'borderWidth', 'borderRadius', 'padding']),
	states: new Set(),
};

const NO_PADDING: Sides = { top: 0, right: 0, bottom: 0, left: 0 };

interface ScrollBox {
	fill: RGBA | null;
	border: RGBA;
	borderWidth: number;
	radius: number;
}

/**
 * R12.20's scroll container: vertical scrolling of one content child
 * (usually a stack), with the standalone Scrollbar (R12.37) drawn only while
 * the content overflows.
 *
 * Layout: the content child is given the viewport's inner width (less the
 * scrollbar's gutter when it overflows) and measures its own height; that
 * height, or `contentHeight` when given, plus the padding is the scrollable
 * extent. With `heightMode: 'hug'` it measures as that extent, so a column
 * gives it what its content needs and shrinks it, to its `minSize`, when
 * short of room. The scroll position is R4.9's `contentOffset`, so the walk, the
 * hit test, `screenMatrix`, and the snapshot all see the same thing, and a
 * resize re-clamps it. The padding scrolls with the content (R4.13).
 *
 * The clip sits inside the border and the corner radius, and otherwise as
 * far out into the padding as the content's ink reaches (R8.8), so a
 * focused row's ring is not cut at the edge.
 *
 * Input: the wheel per R9.32 (the dispatcher latches this container when
 * `canScroll` says yes, and it consumes what it receives while latched);
 * Page Up and Page Down from anywhere inside, and the arrows, Home, and End
 * while it is itself focused. It is focusable by press and by code but not
 * a Tab stop (`tabIndex: -1`), so a press on its background lets the keys
 * reach it. Keyboard focus landing on a descendant scrolls it into view
 * (the focus manager calls `scrollIntoView`), and a scroll closes a popup
 * anchored inside it (R3.6a).
 *
 * The scrollbar is this container's part. The content offset moves every
 * child, so the scrollbar is placed at the offset to stay put on screen.
 */
export class ScrollContainer extends Component {
	public onScroll: ((offset: number) => void) | null = null;
	private readonly scrollbar: Scrollbar;
	private scrollY = 0;
	/** `contentOffset`, rebuilt only when the scroll moves, so the walk allocates none per frame. */
	private offsetCache: Vec2 = Object.freeze({ x: 0, y: 0 });
	/** The largest ink a direct child reaches past its box, which the clip makes room for (R8.8). */
	private childInk = 0;
	/** `scrollToBottom` holds until the next layout, which may lengthen the content. */
	private endRequested = false;
	private measuredContentHeight = 0;
	private contentHeightOverride: number | null;
	private readonly padding: Sides;
	private readonly box: ScrollBox;

	constructor({ contentHeight, onScroll, style = {}, ...options }: ScrollContainerOptions = {}) {
		super({ focusable: true, tabIndex: -1, ...options });
		this.componentType = 'ScrollContainer';
		validateStyle(style, SCROLL_STYLE);
		this.padding = style.padding !== undefined ? resolvePadding(style.padding, NO_PADDING) : NO_PADDING;
		this.box = {
			fill: style.backgroundColor !== undefined ? resolveColor(style.backgroundColor) : null,
			border: style.borderColor !== undefined ? resolveColor(style.borderColor) : tokens.color.line_edge,
			borderWidth: style.borderWidth !== undefined ? resolveLength(style.borderWidth, 'borderWidth') : 0,
			radius: style.borderRadius !== undefined ? resolveLength(style.borderRadius, 'borderRadius') : 0,
		};
		this.contentHeightOverride = contentHeight ?? null;
		if (onScroll) this.onScroll = onScroll;
		// Hidden until a layout or a scroll places it over overflowing content.
		this.scrollbar = new Scrollbar({ id: options.id ? `${options.id}.scrollbar` : undefined, visible: false, onScroll: (offset) => this.scrollTo(offset) });
		// Above the content, which it sits beside but may meet at its gutter edge.
		this.scrollbar.zIndex = 1;
		this.addPart(this.scrollbar);
	}

	/** A target in its own right, gaps included, so a wheel anywhere over it finds it (R9.32). */
	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	// -- the scroll position ---------------------------------------------------

	public get scrollPosition(): number {
		return this.scrollY;
	}

	/** The furthest the content can scroll: the extent less the viewport, never below zero. */
	public get maxScroll(): number {
		return Math.max(0, this.scrollExtent - this.height);
	}

	/**
	 * R12.20's `contentHeight`, named as the DOM names it (the base class
	 * keeps `contentHeight` for its own box): the content's height before
	 * padding, the override or the content child's.
	 */
	public get scrollHeight(): number {
		return this.contentHeightOverride ?? this.measuredContentHeight;
	}

	/** Null goes back to the content child's own height. */
	public set scrollHeight(height: number | null) {
		this.contentHeightOverride = height;
		this.invalidateLayout();
		this.applyScroll(this.scrollY);
	}

	/** At the end already, or with nothing to scroll: where a log that follows its newest line stays put. */
	public get atBottom(): boolean {
		return this.scrollY >= this.maxScroll - 1;
	}

	/** Whether the content is taller than the viewport, so the scrollbar shows. */
	public get overflows(): boolean {
		return this.scrollExtent > this.height + 1e-6;
	}

	/** The one content child: the first child the caller added. */
	public get content(): Component | null {
		return this.getChildren().find((child) => !child.isPart) ?? null;
	}

	/** The standalone scrollbar this container drives (R12.37). */
	public get bar(): Scrollbar {
		return this.scrollbar;
	}

	public scrollTo(offset: number): void {
		this.endRequested = false;
		this.applyScroll(offset);
	}

	public scrollBy(delta: number): void {
		this.scrollTo(this.scrollY + delta);
	}

	public scrollToTop(): void {
		this.scrollTo(0);
	}

	/**
	 * To the end, and to the new end after the next layout too: content added
	 * just before this call is measured then (a log following its newest
	 * line). Any other scroll in between cancels that.
	 */
	public scrollToBottom(): void {
		this.applyScroll(Infinity);
		this.endRequested = true;
	}

	/** R4.9: children move by the scroll position; the padding moves with them (R4.13). */
	public get contentOffset(): Vec2 {
		return this.offsetCache;
	}

	/**
	 * R12.20: brings `descendant`'s box inside the clip. `nearest` moves the
	 * least, its top edge winning when it is taller than the clip; `center`
	 * centres it. Worked in this container's local space, where one unit of
	 * scroll moves the content one unit, so a scaled ancestor changes nothing.
	 */
	public scrollIntoView(descendant: Component, { block = 'nearest' }: ScrollIntoViewOptions = {}): void {
		if (descendant === this || descendant === this.scrollbar) return;
		const corners = descendant.screenQuad.map((point) => this.screenToLocal(point));
		if (corners.some((corner) => corner === null)) return;
		const ys = corners.map((corner) => (corner as Vec2).y);
		const top = Math.min(...ys);
		const bottom = Math.max(...ys);
		const clip = this.clipRect;
		let delta: number;
		if (block === 'center') {
			delta = (top + bottom) / 2 - (clip.y + clip.height / 2);
		} else if (top < clip.y) {
			delta = top - clip.y;
		} else if (bottom > clip.y + clip.height) {
			delta = Math.min(bottom - (clip.y + clip.height), top - clip.y);
		} else {
			delta = 0;
		}
		if (delta !== 0) this.scrollBy(delta);
	}

	/** R9.32: vertical only; true while there is room to move in the wheel's direction. */
	public canScroll(_deltaX: number, deltaY: number): boolean {
		return (deltaY > 0 && this.scrollY < this.maxScroll) || (deltaY < 0 && this.scrollY > 0);
	}

	// -- geometry --------------------------------------------------------------

	public get clipsChildren(): boolean {
		return this.width > 0 && this.height > 0;
	}

	/**
	 * Inside the border and the corner radius, and into the padding by as
	 * much as the direct children's ink reaches (R8.8), never past the edge.
	 * In unscrolled local space, so it stays put while the content moves.
	 */
	protected computeClipRect(): Rect {
		const edge = Math.max(this.box.borderWidth, this.box.radius);
		const ink = this.childInk;
		const inset = (pad: number): number => Math.max(edge, pad - ink);
		const { top, right, bottom, left } = this.padding;
		const x = inset(left);
		const y = inset(top);
		return {
			x,
			y,
			width: Math.max(this.width - x - inset(right), 0),
			height: Math.max(this.height - y - inset(bottom), 0),
		};
	}

	public get resolvedColors(): ResolvedColors | null {
		if (!this.box.fill) return null;
		return this.box.borderWidth > 0 ? { fill: this.box.fill, border: this.box.border } : { fill: this.box.fill };
	}

	public render(draw: DrawApi): void {
		const box = this.box;
		if (!box.fill && box.borderWidth <= 0) return;
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: box.fill ?? [0, 0, 0, 0],
			radius: box.radius > 0 ? box.radius : undefined,
			border: box.borderWidth > 0 ? { color: box.border, width: box.borderWidth } : undefined,
		});
	}

	// -- layout ----------------------------------------------------------------

	/** It gives its content child its size, as a stack does, so a stack or a text inside takes it. */
	public get sizesChildren(): boolean {
		return true;
	}

	/**
	 * A `hug` height is the content's height at the width it is measured at,
	 * plus the padding, so in a column it takes what its content needs and a
	 * column short of room shrinks it, down to its `minSize`, where it scrolls
	 * the rest (CSS `max-height` with `overflow: auto`). A fixed or fill
	 * height is the viewport it is given.
	 */
	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
		const given = super.measure(availableWidth, availableHeight, definite);
		if (this.heightMode !== 'hug' || definite === 'height') return given;
		return { width: given.width, height: this.hugHeight(given.width) };
	}

	/** A hug height gives way to its explicit minimum and no further: past it, the content scrolls. */
	public minContentSize(axis: Axis): number {
		if (axis === 'height' && this.heightMode === 'hug') return 0;
		return super.minContentSize(axis);
	}

	private hugHeight(width: number): number {
		const { top, right, bottom, left } = this.padding;
		const content = this.content;
		if (this.contentHeightOverride !== null) return this.contentHeightOverride + top + bottom;
		if (!content) return top + bottom;
		const margin = content.margin;
		const room = Math.max(width - left - right - margin.left - margin.right, 0);
		const measured = content.measure(room, Infinity, content.widthMode === 'fixed' ? null : 'width');
		return measured.height + margin.top + margin.bottom + top + bottom;
	}

	/**
	 * The content child gets the inner width and its measured height; if that
	 * overflows, the gutter comes off the width and it is measured again, once.
	 * Then the scroll position re-clamps to the new extent, and the scrollbar
	 * is placed. A hug height outside a stack sizes itself first, within its
	 * `minSize` and `maxSize`, as a stack would have clamped it.
	 */
	protected layoutChildren(): void {
		if (this.heightMode === 'hug' && !this.parent?.sizesChildren) this.resizeInLayout(this.width, this.clampToLimits('height', this.hugHeight(this.width)));
		let ink = 0;
		for (const child of this.getChildren()) if (!child.isPart) ink = Math.max(ink, child.inkExtent);
		if (ink !== this.childInk) {
			this.childInk = ink;
			this.invalidateClip();
		}
		const content = this.content;
		const { top, right, bottom, left } = this.padding;
		const innerWidth = Math.max(this.width - left - right, 0);
		const viewport = this.height - top - bottom;
		if (content) {
			content.setPosition(left, top);
			this.fit(content, innerWidth);
			if (this.scrollHeight > viewport + 1e-6) this.fit(content, Math.max(innerWidth - SCROLLBAR_GUTTER, 0));
		} else {
			this.measuredContentHeight = 0;
		}
		this.applyScroll(this.endRequested ? Infinity : this.scrollY);
		this.endRequested = false;
	}

	private fit(content: Component, width: number): void {
		const margin = content.margin;
		const room = Math.max(width - margin.left - margin.right, 0);
		const measured = content.measure(room, Infinity, content.widthMode === 'fixed' ? null : 'width');
		content.assignSize(content.widthMode === 'fixed' ? NaN : room, content.heightMode === 'fixed' ? NaN : measured.height);
		this.measuredContentHeight = content.height + margin.top + margin.bottom;
	}

	private get scrollExtent(): number {
		return this.scrollHeight + this.padding.top + this.padding.bottom;
	}

	// -- input -----------------------------------------------------------------

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (event.consumed) return;
		switch (event.type) {
			case 'wheel':
				// Latched to this container, it takes every event of the
				// gesture, even at its end (R9.32); a wheel only bubbling
				// through, with nothing latched, is left to go on.
				if (event.target !== this && !this.canScroll(event.deltaX, event.deltaY)) return;
				this.scrollBy(event.deltaY);
				event.consume();
				return;
			case 'keydown':
				if (this.handleKey(event)) event.consume();
				return;
		}
	}

	private handleKey(event: UiKeyEvent): boolean {
		const { ctrl, meta, alt, shift } = event.modifiers;
		if (ctrl || meta || alt || shift) return false;
		const page = Math.max(this.clipRect.height - tokens.space.scroll_step, tokens.space.scroll_step);
		switch (event.key) {
			case 'PageDown':
				this.scrollBy(page);
				return true;
			case 'PageUp':
				this.scrollBy(-page);
				return true;
		}
		// The rest only when the container itself is focused, so a list or a
		// field inside keeps its own arrows, Home, and End.
		if (event.target !== this) return false;
		switch (event.key) {
			case 'ArrowDown':
				this.scrollBy(tokens.space.scroll_step);
				return true;
			case 'ArrowUp':
				this.scrollBy(-tokens.space.scroll_step);
				return true;
			case 'Home':
				this.scrollToTop();
				return true;
			case 'End':
				this.scrollToBottom();
				return true;
			default:
				return false;
		}
	}

	/**
	 * Clamps and applies the scroll position, keeps the scrollbar in place
	 * and in step, and tells whoever listens when it moved (a resize that
	 * re-clamps it included).
	 */
	private applyScroll(offset: number): void {
		const clamped = Math.max(0, Math.min(this.maxScroll, Number.isFinite(offset) ? offset : this.maxScroll));
		const moved = clamped !== this.scrollY;
		this.scrollY = clamped;
		if (moved) {
			this.offsetCache = Object.freeze({ x: 0, y: clamped });
			this.invalidateInk();
		}
		this.placeScrollbar();
		if (!moved) return;
		// Content moved under a still pointer, and popups anchored in it are
		// no longer where they were placed (R9.9, R3.6a).
		this.context?.popups.scrolled(this);
		this.context?.dispatcher.contentMoved();
		this.onScroll?.(clamped);
	}

	private placeScrollbar(): void {
		const bar = this.scrollbar;
		const clip = this.clipRect;
		bar.visible = this.overflows;
		// In the gutter the content gave up, inside the right padding, and
		// moved by the offset so it stays fixed on screen.
		bar.setPosition(this.width - this.padding.right - SCROLLBAR_GUTTER, clip.y + this.scrollY);
		bar.setSize(SCROLLBAR_GUTTER, clip.height);
		bar.range = { offset: this.scrollY, extent: this.scrollExtent, viewport: this.height };
	}
}
