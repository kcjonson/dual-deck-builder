import type { Rect } from '../draw/geometry';
import type { Component, ResolvedColors } from './Component';
import type { DrawApi } from '../draw/DrawApi';
import { BoxStyle, BoxStyleObject, boxAcceptance, boxColors, boxInkExtent, drawBox, resolveBoxStyle } from './Rectangle';
import { MarginInput, Sides, ZERO_SIDES, normalizeSides } from './componentGeometry';
import { Container, ContainerOptions } from './Container';
import { validateStyle } from '../style/styleObject';
import { Axis, CrossAlign, Direction, Distribution, Size, SizeMode, authoredSizeMode } from './layoutTypes';

export interface StackOptions extends ContainerOptions {
	/**
	 * A box drawn behind the children, on R11.14's box properties. Absent
	 * draws nothing: a stack is a layout container first (R12.18).
	 */
	style?: BoxStyleObject;
	direction?: Direction;
	/** Space between flow children on the main axis. Negative overlaps them (R10.2). */
	gap?: number;
	/** Per side, inside the content box; a number is the uniform shorthand. */
	padding?: MarginInput;
	distribution?: Distribution;
	crossAlign?: CrossAlign;
}

/** One flow child's resolved content sizes during a pass; margins are kept apart. */
interface Slot {
	child: Component;
	main: number;
	cross: number;
	mainMargin: number;
	crossMargin: number;
	/** Its cross axis is assigned the content box (R10.7). */
	stretched: boolean;
	/** Its main axis takes a share of the leftover (R10.8). */
	fill: boolean;
	/** Clamped during distribution, and fixed at that size for the re-run (R10.4). */
	frozen: boolean;
	/** Its cross size as measured, before a stretch to a hug cross extent. */
	natural: number;
}

/** What `resolveFlow` knows about this pass's content box. */
interface FlowBox {
	/** The main axis is assigned (fixed, a share, a stretch): fill children share `mainLimit`. */
	exactMain: boolean;
	/** The most main-axis room there is, or null for none known; hug children shrink to fit it (R10.7). */
	mainLimit: number | null;
	/** The assigned cross size, or null for a hug cross axis. */
	contentCross: number | null;
	/** The room across that unstretched children shrink to fit. */
	crossAvailable: number;
}

/** A stack's box before its style: clear, no border. */
const NO_BOX: BoxStyle = { fill: [0, 0, 0, 0], borderColor: null, borderWidth: 0, cornerRadius: 0, shadow: null };

function validateBox(style: BoxStyleObject): void {
	validateStyle(style, boxAcceptance('Stack'));
}

/** Overflow below this is float noise, not a reason to shrink anything. */
const EPSILON = 1e-6;

/**
 * Chapter 10's stack container: children in a row or a column, sized by their
 * modes (fixed, hug, fill with weights) and placed by distribution and cross
 * alignment, with an optional box behind them (`style`) and no other visuals.
 *
 * One layout pass, run by the frame on a dirty stack (R8.16):
 *
 * - its own size: assigned by a parent stack, or, outside one, measured on
 *   every axis that is not `fixed` (a root's `fill` axes are the viewport's,
 *   R8.21);
 * - pass 1, cross axis: stretched and cross-`fill` children take the content
 *   box; the rest are measured against it, shrinking to fit (R10.7);
 * - pass 2, main axis: fixed and hug sizes, then the leftover shared by
 *   weight among `fill` children, clamped, with one frozen re-run (R10.8);
 * - pass 3, positions: distribution on the main axis, alignment on the cross
 *   axis, never at a negative offset (R10.9, R10.10);
 * - absolute children sized against the content box and placed by anchor
 *   (R10.15).
 *
 * Nested stacks need no separate pass 0 (R10.6): `measure` recurses, so a
 * hug measurement is always taken from the current tree, and a stack child
 * lays out its own children right after this one assigns its size. A hug
 * axis is never frozen by an earlier pass (R10.5). Measurements are cached
 * per constraint until the stack is next invalidated, so a pass costs one
 * measurement per stack and constraint rather than one per ancestor.
 *
 * Shrink-to-fit reaches nested stacks: when a row or column has less main
 * room than its children want, its non-fixed children shrink in proportion
 * to their size, none below its minimum content (CSS flex-shrink with
 * `min-width: auto`), and a shrunk child is measured again across, so a
 * text in a hug row inside a narrow column wraps.
 *
 * `width`, `height` and `setSize` author a size: a positive value fixes that
 * axis and zero makes it hug again, as for Text. Layout's own assignments go
 * through `assignSize` and never change a mode.
 */
export class Stack extends Container {
	private stackDirection: Direction = 'vertical';
	private stackGap = 0;
	private stackPadding: Sides = ZERO_SIDES;
	private stackDistribution: Distribution = 'start';
	private stackCrossAlign: CrossAlign = 'start';
	private box: BoxStyle | null = null;

	constructor(options?: StackOptions) {
		const { style, ...rest } = options ?? {};
		super(rest);
		this.componentType = 'Stack';
		if (style) {
			validateBox(style);
			this.box = resolveBoxStyle(style, NO_BOX);
			if (style.opacity !== undefined) this.opacity = style.opacity;
		}
		if (!options) return;
		if (options.direction !== undefined) this.stackDirection = options.direction;
		if (options.gap !== undefined) this.stackGap = options.gap;
		if (options.padding !== undefined) this.stackPadding = normalizeSides(options.padding);
		if (options.distribution !== undefined) this.stackDistribution = options.distribution;
		if (options.crossAlign !== undefined) this.stackCrossAlign = options.crossAlign;
	}

	/** R10.1: a stack constructed with no size on an axis hugs that axis. */
	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'hug';
	}

	// -- the box --------------------------------------------------------------

	public get resolvedColors(): ResolvedColors | null {
		return this.box && this.width > 0 && this.height > 0 ? boxColors(this.box) : null;
	}

	public get inkExtent(): number {
		return this.box ? boxInkExtent(this.box) : 0;
	}

	public render(draw: DrawApi): void {
		if (!this.box || this.width <= 0 || this.height <= 0) return;
		drawBox(draw, this.id, this.width, this.height, this.box);
	}

	// -- properties (R10.2); every one invalidates layout ----------------------

	public get direction(): Direction {
		return this.stackDirection;
	}

	public set direction(value: Direction) {
		if (this.stackDirection === value) return;
		this.stackDirection = value;
		this.invalidateLayout();
	}

	public get gap(): number {
		return this.stackGap;
	}

	public set gap(value: number) {
		if (this.stackGap === value) return;
		this.stackGap = value;
		this.invalidateLayout();
	}

	public get padding(): Sides {
		return this.stackPadding;
	}

	public set padding(value: MarginInput) {
		this.stackPadding = normalizeSides(value);
		this.invalidateLayout();
	}

	public get distribution(): Distribution {
		return this.stackDistribution;
	}

	public set distribution(value: Distribution) {
		if (this.stackDistribution === value) return;
		this.stackDistribution = value;
		this.invalidateLayout();
	}

	public get crossAlign(): CrossAlign {
		return this.stackCrossAlign;
	}

	public set crossAlign(value: CrossAlign) {
		if (this.stackCrossAlign === value) return;
		this.stackCrossAlign = value;
		this.invalidateLayout();
	}

	public get mainAxis(): Axis {
		return this.stackDirection === 'vertical' ? 'height' : 'width';
	}

	public get crossAxis(): Axis {
		return this.stackDirection === 'vertical' ? 'width' : 'height';
	}

	public get sizesChildren(): boolean {
		return true;
	}

	// -- the layout protocol ---------------------------------------------------

	/**
	 * R10.12's hug measurement on every axis that is not `fixed` or `definite`,
	 * with children measured against the space available (so wrapping text
	 * reflows before it is summed) and the main axis shrunk to fit a finite
	 * room (R10.7); padding included, margin not.
	 */
	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
		return this.cachedMeasure(`${availableWidth}|${availableHeight}|${definite}`,
			() => this.computeMeasure(availableWidth, availableHeight, definite));
	}

	private computeMeasure(availableWidth: number, availableHeight: number, definite: Axis | null): Size {
		const main = this.mainAxis;
		const cross = this.crossAxis;
		const available = (axis: Axis): number => (axis === 'width' ? availableWidth : availableHeight);
		const known = (axis: Axis): number | null => {
			if (this.sizeMode(axis) === 'fixed') return this.sizeOn(axis);
			return definite === axis ? available(axis) : null;
		};
		let mainSize = known(main);
		let crossSize = known(cross);
		if (mainSize === null || crossSize === null) {
			const padMain = this.paddingOn(main);
			const padCross = this.paddingOn(cross);
			const contentCross = crossSize === null ? null : Math.max(crossSize - padCross, 0);
			const roomMain = mainSize ?? available(main);
			const slots = this.flowSlots();
			const resolvedCross = this.resolveFlow(slots, {
				exactMain: mainSize !== null,
				mainLimit: Number.isFinite(roomMain) ? Math.max(roomMain - padMain, 0) : null,
				contentCross,
				crossAvailable: contentCross ?? Math.max(available(cross) - padCross, 0),
			});
			if (mainSize === null) mainSize = this.hugMain(slots) + padMain;
			if (crossSize === null) crossSize = resolvedCross + padCross;
		}
		return main === 'width' ? { width: mainSize, height: crossSize } : { width: crossSize, height: mainSize };
	}

	/**
	 * The narrowest this stack's content allows on `axis`: along the flow,
	 * every child at its minimum plus the gaps; across it, the widest
	 * minimum; padding on top. What a parent stack shrinks it to at most.
	 */
	public minContentSize(axis: Axis): number {
		if (this.sizeMode(axis) === 'fixed') return this.sizeOn(axis);
		const size = this.cachedMeasure(`min|${axis}`, () => {
			const along = axis === this.mainAxis;
			let total = 0;
			let count = 0;
			for (const child of this.getChildren()) {
				if (!child.visible || child.positioned === 'absolute') continue;
				const least = shrinkFloor(child, axis, Infinity) + marginOn(child, axis);
				total = along ? total + least : Math.max(total, least);
				count += 1;
			}
			if (along) total += this.gapTotal(count);
			const extent = Math.max(total, 0) + this.paddingOn(axis);
			return { width: extent, height: extent };
		});
		return size.width;
	}

	protected layoutChildren(): void {
		const parent = this.parent;
		if (!parent || !parent.sizesChildren) this.sizeSelf();

		const main = this.mainAxis;
		const cross = this.crossAxis;
		const contentMain = Math.max(this.sizeOn(main) - this.paddingOn(main), 0);
		const contentCross = Math.max(this.sizeOn(cross) - this.paddingOn(cross), 0);

		// On a hug main axis there is no leftover, and fill children keep their
		// intrinsic size (R10.8); an assigned size narrower than that shrinks
		// them to fit, as `measure` did.
		const slots = this.flowSlots();
		this.resolveFlow(slots, {
			exactMain: !this.isHugLike(main),
			mainLimit: contentMain,
			contentCross,
			crossAvailable: contentCross,
		});

		for (const slot of slots) {
			const child = slot.child;
			const mainValue = child.sizeMode(main) === 'fixed' ? NaN : slot.main;
			const crossValue = child.sizeMode(cross) === 'fixed' ? NaN : slot.cross;
			if (main === 'width') child.assignSize(mainValue, crossValue);
			else child.assignSize(crossValue, mainValue);
			// Positions follow the size the child took: a leaf that cannot
			// resize (Circle) keeps its own.
			slot.main = child.sizeOn(main);
			slot.cross = child.sizeOn(cross);
		}

		this.position(slots, contentMain, contentCross);
		this.sizeAbsoluteChildren();
	}

	// -- authored size ---------------------------------------------------------

	public get width(): number {
		return super.width;
	}

	/** Positive fixes the width; zero hugs again. */
	public set width(value: number) {
		this.widthMode = authoredSizeMode(value, this.widthMode);
		super.width = value;
	}

	public get height(): number {
		return super.height;
	}

	/** Positive fixes the height; zero hugs again. */
	public set height(value: number) {
		this.heightMode = authoredSizeMode(value, this.heightMode);
		super.height = value;
	}

	public setSize(width: number, height: number): this {
		this.widthMode = authoredSizeMode(width, this.widthMode);
		this.heightMode = authoredSizeMode(height, this.heightMode);
		return super.setSize(width, height);
	}

	/** R10.15: the content box, inside the padding. */
	protected get anchorBox(): Rect {
		const padding = this.stackPadding;
		return {
			x: padding.left,
			y: padding.top,
			width: Math.max(this.width - padding.left - padding.right, 0),
			height: Math.max(this.height - padding.top - padding.bottom, 0),
		};
	}

	protected anchorsChild(child: Component): boolean {
		return child.positioned === 'absolute';
	}

	// -- passes ----------------------------------------------------------------

	/**
	 * Outside a stack nothing assigns this stack's size, so it measures every
	 * axis nobody fixed, clamps it, and tells its parent, which may anchor it.
	 */
	private sizeSelf(): void {
		const widthExact = !this.isHugLike('width');
		const heightExact = !this.isHugLike('height');
		if (widthExact && heightExact) return;
		const definite: Axis | null = widthExact ? 'width' : heightExact ? 'height' : null;
		const measured = this.measure(
			widthExact ? this.width : Infinity,
			heightExact ? this.height : Infinity,
			definite,
		);
		this.resizeInLayout(
			widthExact ? this.width : clampTo(this, 'width', measured.width, false),
			heightExact ? this.height : clampTo(this, 'height', measured.height, false),
		);
	}

	/**
	 * Whether this stack's size on `axis` comes from measuring its children
	 * rather than from an assignment: not `fixed`, not a root's `fill`, not a
	 * parent stack's stretch or leftover share.
	 */
	private isHugLike(axis: Axis): boolean {
		const mode = this.sizeMode(axis);
		if (mode === 'fixed') return false;
		const parent = this.parent;
		if (!parent) return !(mode === 'fill' && this.isMounted);
		if (!(parent instanceof Stack)) return true;
		if (this.positioned === 'absolute') return mode !== 'fill';
		if (axis === parent.crossAxis) return !parent.stretches(this);
		return mode !== 'fill' || parent.isHugLike(parent.mainAxis);
	}

	/** R10.7: a cross-`fill` child, or a non-`fixed` one under `stretch`. */
	private stretches(child: Component): boolean {
		const mode = child.sizeMode(this.crossAxis);
		if (mode === 'fill') return true;
		return mode !== 'fixed' && (child.alignSelf ?? this.stackCrossAlign) === 'stretch';
	}

	private flowSlots(): Slot[] {
		const main = this.mainAxis;
		const cross = this.crossAxis;
		const slots: Slot[] = [];
		for (const child of this.getChildren()) {
			if (!child.visible || child.positioned === 'absolute') continue;
			slots.push({
				child,
				main: 0,
				cross: 0,
				mainMargin: marginOn(child, main),
				crossMargin: marginOn(child, cross),
				stretched: this.stretches(child),
				fill: false,
				frozen: false,
				natural: 0,
			});
		}
		return slots;
	}

	/**
	 * Passes 1 and 2 over the flow children, writing each slot's content
	 * sizes, then the shrink that fits them into `mainLimit`. Returns the
	 * content cross size: `contentCross` when assigned, else the widest child.
	 */
	private resolveFlow(slots: Slot[], box: FlowBox): number {
		const main = this.mainAxis;
		const cross = this.crossAxis;
		const { exactMain, mainLimit, contentCross, crossAvailable } = box;

		// Pass 1: cross sizes. Stretched children take the content box when it
		// is known; the rest measure against what is available and shrink to
		// fit it (R10.7).
		for (const slot of slots) {
			const child = slot.child;
			const crossMode = child.sizeMode(cross);
			if (crossMode === 'fixed') {
				slot.cross = child.sizeOn(cross);
			} else if (slot.stretched && contentCross !== null) {
				slot.cross = clampTo(child, cross, Math.max(contentCross - slot.crossMargin, 0), false);
			} else if (child.aspectRatio !== null && child.sizeMode(main) === 'fixed') {
				slot.cross = clampTo(child, cross, fromRatio(child.aspectRatio, cross, child.sizeOn(main)), false);
			} else {
				const room = Math.max(crossAvailable - slot.crossMargin, 0);
				slot.cross = clampTo(child, cross, measureOn(child, cross, room, Infinity, null)[cross], false);
			}
			slot.natural = slot.cross;
		}
		if (contentCross === null) this.stretchTo(slots, crossExtent(slots));

		// Pass 2: main sizes. Fill children on an assigned main axis share the
		// leftover; everything else is its own size or its measure at the
		// cross size pass 1 settled.
		let used = 0;
		let totalWeight = 0;
		for (const slot of slots) {
			const child = slot.child;
			const mainMode = child.sizeMode(main);
			slot.fill = mainMode === 'fill' && exactMain && mainLimit !== null;
			if (mainMode === 'fixed') {
				slot.main = child.sizeOn(main);
			} else if (slot.fill) {
				totalWeight += child.fillWeight;
			} else if (child.aspectRatio !== null && (slot.stretched || child.sizeMode(cross) === 'fixed')) {
				slot.main = clampTo(child, main, fromRatio(child.aspectRatio, main, slot.cross), true);
			} else {
				slot.main = clampTo(child, main, measureOn(child, cross, slot.cross, Infinity, cross)[main], true);
			}
			used += slot.fill ? slot.mainMargin : slot.main + slot.mainMargin;
		}
		const resized: Slot[] = [];
		if (mainLimit !== null && slots.some((slot) => slot.fill)) {
			const leftover = Math.max(mainLimit - used - this.gapTotal(slots.length), 0);
			distribute(slots, main, leftover, totalWeight);
			for (const slot of slots) if (slot.fill) resized.push(slot);
		}

		// Shrink to fit (R10.7): past the room there is, non-fixed children
		// give up space in proportion to their size, down to their minimum.
		if (mainLimit !== null && Number.isFinite(mainLimit)) {
			const overflow = this.flowLength(slots) - mainLimit;
			if (overflow > EPSILON) {
				for (const slot of shrink(slots, main, overflow)) {
					if (!resized.includes(slot)) resized.push(slot);
				}
			}
		}

		// A child whose main size changed from its measure (a leftover share,
		// a shrink) is measured again across at that size: a text wraps to it.
		for (const slot of resized) this.remeasureCross(slot, crossAvailable, contentCross !== null);
		if (contentCross !== null) return contentCross;
		const extent = crossExtent(slots);
		this.stretchTo(slots, extent);
		return extent;
	}

	private remeasureCross(slot: Slot, crossAvailable: number, crossAssigned: boolean): void {
		const child = slot.child;
		const main = this.mainAxis;
		const cross = this.crossAxis;
		if (child.sizeMode(cross) === 'fixed' || (slot.stretched && crossAssigned)) return;
		const measured = child.aspectRatio !== null
			? fromRatio(child.aspectRatio, cross, slot.main)
			: measureOn(child, main, slot.main, Math.max(crossAvailable - slot.crossMargin, 0), main)[cross];
		slot.natural = clampTo(child, cross, measured, false);
		if (!slot.stretched) slot.cross = slot.natural;
	}

	private stretchTo(slots: readonly Slot[], contentCross: number): void {
		for (const slot of slots) {
			if (!slot.stretched) continue;
			slot.cross = clampTo(slot.child, this.crossAxis, Math.max(contentCross - slot.crossMargin, 0), false);
		}
	}

	/** Pass 3 (R10.9, R10.10): margin-box origins through `position`. */
	private position(slots: readonly Slot[], contentMain: number, contentCross: number): void {
		const vertical = this.stackDirection === 'vertical';
		const padding = this.stackPadding;
		const count = slots.length;
		let total = 0;
		for (const slot of slots) total += slot.main + slot.mainMargin;
		const leftover = Math.max(contentMain - total - this.gapTotal(count), 0);

		let lead = 0;
		let between = 0;
		switch (this.stackDistribution) {
			case 'center':
				lead = leftover / 2;
				break;
			case 'end':
				lead = leftover;
				break;
			case 'spaceBetween':
				between = count > 1 ? leftover / (count - 1) : 0;
				break;
			case 'spaceAround':
				between = count > 0 ? leftover / count : 0;
				lead = between / 2;
				break;
			case 'spaceEvenly':
				between = leftover / (count + 1);
				lead = between;
				break;
			default:
				break;
		}

		let cursor = (vertical ? padding.top : padding.left) + lead;
		const crossStart = vertical ? padding.left : padding.top;
		for (const slot of slots) {
			const child = slot.child;
			const align = child.alignSelf ?? this.stackCrossAlign;
			const crossBox = slot.cross + slot.crossMargin;
			let offset = 0;
			if (align === 'center') offset = Math.max((contentCross - crossBox) / 2, 0);
			else if (align === 'end') offset = Math.max(contentCross - crossBox, 0);
			if (vertical) child.setPosition(crossStart + offset, cursor);
			else child.setPosition(cursor, crossStart + offset);
			cursor += slot.main + slot.mainMargin + this.stackGap + between;
		}
	}

	/**
	 * R10.15's absolute children: out of the flow, sized against the content
	 * box (a `fill` axis takes all of it), then placed by anchor and pivot in
	 * the base class's placement.
	 */
	private sizeAbsoluteChildren(): void {
		const box = this.anchorBox;
		for (const child of this.getChildren()) {
			if (!child.visible || child.positioned !== 'absolute') continue;
			const roomWidth = Math.max(box.width - marginOn(child, 'width'), 0);
			const roomHeight = Math.max(box.height - marginOn(child, 'height'), 0);
			const fillWidth = child.widthMode === 'fill';
			const fillHeight = child.heightMode === 'fill';
			const measured = child.measure(roomWidth, roomHeight, fillWidth ? 'width' : fillHeight ? 'height' : null);
			child.assignSize(
				child.widthMode === 'fixed' ? NaN : clampTo(child, 'width', fillWidth ? roomWidth : measured.width, false),
				child.heightMode === 'fixed' ? NaN : clampTo(child, 'height', fillHeight ? roomHeight : measured.height, false),
			);
		}
	}

	// -- helpers ---------------------------------------------------------------

	private paddingOn(axis: Axis): number {
		const padding = this.stackPadding;
		return axis === 'width' ? padding.left + padding.right : padding.top + padding.bottom;
	}

	private gapTotal(count: number): number {
		return count > 1 ? this.stackGap * (count - 1) : 0;
	}

	/** Main sizes, margins, and gaps: what the flow spans, before any floor. */
	private flowLength(slots: readonly Slot[]): number {
		let total = this.gapTotal(slots.length);
		for (const slot of slots) total += slot.main + slot.mainMargin;
		return total;
	}

	/** R10.12: the flow's length, never below zero. */
	private hugMain(slots: readonly Slot[]): number {
		return Math.max(this.flowLength(slots), 0);
	}
}

function marginOn(child: Component, axis: Axis): number {
	const margin = child.margin;
	return axis === 'width' ? margin.left + margin.right : margin.top + margin.bottom;
}

/**
 * The widest margin box across the flow: a hug cross axis (R10.12). A
 * stretched child counts at its measured size, not the stretch it was given.
 */
function crossExtent(slots: readonly Slot[]): number {
	let extent = 0;
	for (const slot of slots) extent = Math.max(extent, slot.natural + slot.crossMargin);
	return extent;
}

/**
 * The least a stack may shrink `child` to on `axis`: its size when fixed,
 * else its explicit minimum or its minimum content, and never more than
 * `basis`, the size it would otherwise take.
 */
function shrinkFloor(child: Component, axis: Axis, basis: number): number {
	if (child.sizeMode(axis) === 'fixed') return child.sizeOn(axis);
	const least = child.minSize[axis] ?? child.minContentSize(axis);
	return Math.min(basis, least);
}

/**
 * Takes `overflow` off the non-fixed children's main sizes in proportion to
 * those sizes (CSS flex-shrink at the default factor, weighted by basis),
 * freezing any that reach their floor and sharing the rest among the others
 * until the overflow is gone or nothing can give. Returns the slots it moved.
 */
function shrink(slots: Slot[], main: Axis, overflow: number): Slot[] {
	const active = slots.filter((slot) => slot.child.sizeMode(main) !== 'fixed' && slot.main > 0);
	const floors = active.map((slot) => shrinkFloor(slot.child, main, slot.main));
	const moved: Slot[] = [];
	let remaining = overflow;
	let open = active.map((_, index) => index);
	while (remaining > EPSILON && open.length > 0) {
		let basis = 0;
		for (const index of open) basis += active[index].main;
		if (basis <= 0) break;
		const stillOpen: number[] = [];
		let taken = 0;
		for (const index of open) {
			const slot = active[index];
			const wanted = slot.main - (remaining * slot.main) / basis;
			const next = Math.max(wanted, floors[index]);
			taken += slot.main - next;
			if (next !== slot.main && !moved.includes(slot)) moved.push(slot);
			slot.main = next;
			if (next > floors[index]) stillOpen.push(index);
		}
		remaining -= taken;
		// Everyone took their full share: done. Otherwise the floored ones
		// are out and the rest cover what they could not.
		if (stillOpen.length === open.length) break;
		open = stillOpen;
	}
	return moved;
}

/**
 * `measure` with one axis's space named and the other's: `given` on `axis`,
 * `other` on the one across it, and `definite` marking which is exact.
 */
function measureOn(child: Component, axis: Axis, given: number, other: number, definite: Axis | null): Size {
	return axis === 'width'
		? child.measure(given, other, definite)
		: child.measure(other, given, definite);
}

/**
 * R10.4's clamps. `minSize` wins over `maxSize`, as in CSS; on the main axis
 * an unset minimum is the child's automatic one (text's longest word).
 * `fixed` is authoritative and never clamped.
 */
function clampTo(child: Component, axis: Axis, value: number, onMain: boolean): number {
	if (child.sizeMode(axis) === 'fixed') return child.sizeOn(axis);
	const explicitMin = child.minSize[axis];
	const min = explicitMin ?? (onMain ? child.automaticMinSize(axis) : 0);
	const max = child.maxSize[axis] ?? Infinity;
	return Math.max(min, Math.min(max, value));
}

/** `aspectRatio` is width over height: the size on `axis` from the size across it. */
function fromRatio(ratio: number, axis: Axis, across: number): number {
	if (ratio <= 0) return 0;
	return axis === 'width' ? across * ratio : across / ratio;
}

/**
 * R10.8's share of the leftover by weight as exact floats, then R10.4's
 * clamps; if a clamp moved any child, the clamped ones are frozen at their
 * clamped size and the rest share what remains, once (the flexbox "frozen
 * items" step). Zero total weight gives every fill child zero before clamps.
 */
function distribute(slots: Slot[], main: Axis, leftover: number, totalWeight: number): void {
	let anyClamped = false;
	for (const slot of slots) {
		if (!slot.fill) continue;
		const share = totalWeight > 0 ? (leftover * slot.child.fillWeight) / totalWeight : 0;
		slot.main = clampTo(slot.child, main, share, true);
		slot.frozen = slot.main !== share;
		if (slot.frozen) anyClamped = true;
	}
	if (!anyClamped) return;

	let remaining = leftover;
	let weight = 0;
	for (const slot of slots) {
		if (!slot.fill) continue;
		if (slot.frozen) remaining -= slot.main;
		else weight += slot.child.fillWeight;
	}
	remaining = Math.max(remaining, 0);
	for (const slot of slots) {
		if (!slot.fill || slot.frozen) continue;
		const share = weight > 0 ? (remaining * slot.child.fillWeight) / weight : 0;
		slot.main = clampTo(slot.child, main, share, true);
	}
}
