import type { Component } from '../../engine/components/Component';
import { Container, ContainerOptions } from '../../engine/components/Container';
import type { Axis, Size, SizeMode } from '../../engine/components/layoutTypes';

export type FlowWrapJustify = 'start' | 'center';

export interface FlowWrapOptions extends ContainerOptions {
	/** Between items in a row. */
	gap?: number;
	/** Between rows; defaults to `gap`. */
	rowGap?: number;
	/** Where each row's items sit across the width. */
	justify?: FlowWrapJustify;
}

/**
 * Items left to right, starting a new row whenever the next one would pass
 * the width, each at its own measured size. Chapter 10 leaves wrap out of
 * the engine (R10.4), and the driver selection screen has two places that
 * need it: a starting deck's mini cards and the synergy tags.
 *
 * It takes part in stack layout like a wrapping text: a stack or a scroll
 * container assigns its width, and its height is the rows' total at that
 * width, so a narrower parent gives more rows and a taller box (R10.13).
 * Outside a sizing parent it hugs its own rows.
 */
export class FlowWrap extends Container {
	private itemGap: number;
	private lineGap: number;
	private rowJustify: FlowWrapJustify;

	constructor({ gap = 0, rowGap, justify = 'start', ...options }: FlowWrapOptions = {}) {
		super(options);
		this.componentType = 'FlowWrap';
		this.itemGap = gap;
		this.lineGap = rowGap ?? gap;
		this.rowJustify = justify;
	}

	/** Hugs on an axis given no size, as a stack does (R10.1). */
	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'hug';
	}

	public get sizesChildren(): boolean {
		return true;
	}

	public get gap(): number {
		return this.itemGap;
	}

	public set gap(value: number) {
		if (this.itemGap === value) return;
		this.itemGap = value;
		this.invalidateLayout();
	}

	public get justify(): FlowWrapJustify {
		return this.rowJustify;
	}

	public set justify(value: FlowWrapJustify) {
		if (this.rowJustify === value) return;
		this.rowJustify = value;
		this.invalidateLayout();
	}

	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
		return this.cachedMeasure(`${availableWidth}|${availableHeight}|${definite}`, () => {
			const width = this.widthMode === 'fixed'
				? this.width
				: definite === 'width' ? availableWidth : Math.min(this.widestRow(Infinity), availableWidth);
			const height = this.heightMode === 'fixed'
				? this.height
				: definite === 'height' ? availableHeight : this.rowsHeight(width);
			return { width, height };
		});
	}

	/** Never narrower than its widest item; its height is its rows at the width it has. */
	public minContentSize(axis: Axis): number {
		if (this.sizeMode(axis) === 'fixed') return this.sizeOn(axis);
		if (axis === 'height') return this.rowsHeight(this.width);
		let widest = 0;
		for (const item of this.getChildren()) {
			if (item.visible) widest = Math.max(widest, item.measure(Infinity, Infinity).width + item.margin.left + item.margin.right);
		}
		return widest;
	}

	/**
	 * Each item takes its measured size, then each row is placed: its items'
	 * margin boxes from the left or centred, top-aligned in the row. Outside
	 * a sizing parent it hugs its rows, within `minSize` and `maxSize`.
	 */
	protected layoutChildren(): void {
		const parent = this.parent;
		if (!parent || !parent.sizesChildren) {
			// The rows reflow at the clamped width, so the height is taken there.
			const width = this.widthMode === 'fixed' ? this.width : this.clampToLimits('width', this.measure(Infinity, Infinity).width);
			const height = this.heightMode === 'fixed' ? this.height : this.clampToLimits('height', this.rowsHeight(width));
			this.resizeInLayout(width, height);
		}
		const items = this.getChildren();
		const width = this.width;
		let rowStart = 0;
		let y = 0;
		while (rowStart < items.length) {
			const { end, rowWidth, rowHeight } = this.scanRow(rowStart, width);
			let x = this.rowJustify === 'center' ? Math.max(0, Math.floor((width - rowWidth) / 2)) : 0;
			for (let index = rowStart; index < end; index++) {
				const item = items[index];
				if (!item.visible) continue;
				const size = item.measure(Infinity, Infinity);
				item.assignSize(item.widthMode === 'fixed' ? NaN : size.width, item.heightMode === 'fixed' ? NaN : size.height);
				// The position is the margin box's origin (R8.10).
				item.setPosition(x, y);
				x += size.width + item.margin.left + item.margin.right + this.itemGap;
			}
			if (rowHeight > 0) y += rowHeight + this.lineGap;
			rowStart = end;
		}
	}

	/** The rows' total height at `width`. */
	private rowsHeight(width: number): number {
		const items = this.getChildren();
		let rowStart = 0;
		let total = 0;
		let rows = 0;
		while (rowStart < items.length) {
			const { end, rowHeight } = this.scanRow(rowStart, width);
			if (rowHeight > 0) {
				total += rowHeight;
				rows += 1;
			}
			rowStart = end;
		}
		return rows > 0 ? total + (rows - 1) * this.lineGap : 0;
	}

	/** The widest row at `width`. */
	private widestRow(width: number): number {
		const items = this.getChildren();
		let rowStart = 0;
		let widest = 0;
		while (rowStart < items.length) {
			const { end, rowWidth } = this.scanRow(rowStart, width);
			widest = Math.max(widest, rowWidth);
			rowStart = end;
		}
		return widest;
	}

	/**
	 * The row starting at `start`: where it ends (exclusive), its width and
	 * its height, both of its items' margin boxes. A row always takes at
	 * least one item, so an item wider than the box gets a row of its own
	 * rather than looping forever.
	 */
	private scanRow(start: number, width: number): { end: number; rowWidth: number; rowHeight: number } {
		const items = this.getChildren();
		let rowWidth = 0;
		let rowHeight = 0;
		let count = 0;
		let index = start;
		for (; index < items.length; index++) {
			const item: Component = items[index];
			if (!item.visible) continue;
			const size = item.measure(Infinity, Infinity);
			const { top, right, bottom, left } = item.margin;
			const boxWidth = size.width + left + right;
			const next = count === 0 ? boxWidth : rowWidth + this.itemGap + boxWidth;
			if (count > 0 && next > width) break;
			rowWidth = next;
			rowHeight = Math.max(rowHeight, size.height + top + bottom);
			count += 1;
		}
		return { end: index, rowWidth, rowHeight };
	}
}
