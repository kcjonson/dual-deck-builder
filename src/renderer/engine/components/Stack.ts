import type { Rect } from '../draw/geometry';
import type { Component } from './Component';
import { MarginInput, Sides, ZERO_SIDES, normalizeSides } from './componentGeometry';
import { Layer, LayerOptions } from './Layer';
import { Axis, CrossAlign, Direction, Distribution, Size, SizeMode } from './layoutTypes';

export interface StackOptions extends LayerOptions {
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
}

/**
 * Chapter 10's stack container: children in a row or a column, sized by their
 * modes (fixed, hug, fill with weights) and placed by distribution and cross
 * alignment, with a background like any Layer and no other visuals.
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
 * axis is never frozen by an earlier pass (R10.5).
 */
export class Stack extends Layer {
	private stackDirection: Direction = 'vertical';
	private stackGap = 0;
	private stackPadding: Sides = ZERO_SIDES;
	private stackDistribution: Distribution = 'start';
	private stackCrossAlign: CrossAlign = 'start';

	constructor(options?: StackOptions) {
		super(options);
		this.componentType = 'Stack';
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
	 * reflows before it is summed); padding included, margin not.
	 */
	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
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
			const crossAvailable = contentCross ?? Math.max(available(cross) - padCross, 0);
			const contentMain = mainSize === null ? null : Math.max(mainSize - padMain, 0);
			const slots = this.flowSlots();
			const resolvedCross = this.resolveFlow(slots, contentMain, contentCross, crossAvailable);
			if (mainSize === null) mainSize = this.hugMain(slots) + padMain;
			if (crossSize === null) crossSize = resolvedCross + padCross;
		}
		return main === 'width' ? { width: mainSize, height: crossSize } : { width: crossSize, height: mainSize };
	}

	protected layoutChildren(): void {
		const parent = this.parent;
		if (!parent || !parent.sizesChildren) this.sizeSelf();

		const main = this.mainAxis;
		const cross = this.crossAxis;
		const contentMain = Math.max(this.sizeOn(main) - this.paddingOn(main), 0);
		const contentCross = Math.max(this.sizeOn(cross) - this.paddingOn(cross), 0);

		// On a hug main axis there is no leftover, and fill children keep their
		// intrinsic size (R10.8).
		const slots = this.flowSlots();
		this.resolveFlow(slots, this.isHugLike(main) ? null : contentMain, contentCross, contentCross);

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
			});
		}
		return slots;
	}

	/**
	 * Passes 1 and 2 over the flow children, writing each slot's content
	 * sizes. `contentMain` null is a hug main axis (no leftover, fill children
	 * intrinsic); `contentCross` null is a hug cross axis, resolved here as the
	 * widest child and returned.
	 */
	private resolveFlow(slots: Slot[], contentMain: number | null, contentCross: number | null, crossAvailable: number): number {
		const main = this.mainAxis;
		const cross = this.crossAxis;

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
		}
		let resolvedCross = contentCross ?? crossExtent(slots);
		if (contentCross === null) this.stretchTo(slots, resolvedCross);

		// Pass 2: main sizes. Fill children on a resolved main axis share the
		// leftover; everything else is its own size or its measure at the
		// cross size pass 1 settled.
		let used = 0;
		let totalWeight = 0;
		for (const slot of slots) {
			const child = slot.child;
			const mainMode = child.sizeMode(main);
			slot.fill = mainMode === 'fill' && contentMain !== null;
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
		if (contentMain !== null && slots.some((slot) => slot.fill)) {
			const leftover = Math.max(contentMain - used - this.gapTotal(slots.length), 0);
			distribute(slots, main, leftover, totalWeight);

			// A child whose main size came from the leftover has its cross size
			// measured again at that size: a fill text in a row wraps to it.
			for (const slot of slots) {
				const child = slot.child;
				if (!slot.fill || slot.stretched || child.sizeMode(cross) === 'fixed') continue;
				const measuredCross = child.aspectRatio !== null
					? fromRatio(child.aspectRatio, cross, slot.main)
					: measureOn(child, main, slot.main, Math.max(crossAvailable - slot.crossMargin, 0), main)[cross];
				slot.cross = clampTo(child, cross, measuredCross, false);
			}
			if (contentCross === null) {
				resolvedCross = crossExtent(slots);
				this.stretchTo(slots, resolvedCross);
			}
		}
		return resolvedCross;
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

	/** R10.12: main sizes, margins, and gaps, never below zero. */
	private hugMain(slots: readonly Slot[]): number {
		let total = this.gapTotal(slots.length);
		for (const slot of slots) total += slot.main + slot.mainMargin;
		return Math.max(total, 0);
	}
}

function marginOn(child: Component, axis: Axis): number {
	const margin = child.margin;
	return axis === 'width' ? margin.left + margin.right : margin.top + margin.bottom;
}

/** The widest margin box across the flow: a hug cross axis (R10.12). */
function crossExtent(slots: readonly Slot[]): number {
	let extent = 0;
	for (const slot of slots) extent = Math.max(extent, slot.cross + slot.crossMargin);
	return extent;
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
