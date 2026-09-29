import { Component, ComponentOptions, PointerEvents, ResolvedColors } from '../components/Component';
import type { DrawApi } from '../draw/DrawApi';
import type { Rect } from '../draw/geometry';
import type { AnyUiEvent, UiPointerEvent } from '../input/events';
import { shadowExtent } from '../style/look';
import { resolveShadow } from '../style/styleObject';
import { CONTROL_SIZES, ControlSize } from '../style/variants';
import { tokens } from '../theme/tokens';
import { ScrollContainer } from './ScrollContainer';

/**
 * R12.11's item: a label that selects, or a separator. `shortcut` is a hint
 * drawn at the right end (the key that does the same thing elsewhere); the
 * menu does not bind it.
 */
export interface MenuItem {
	label?: string;
	onSelect?: (() => void) | null;
	/** Default true. A disabled item is drawn dim and never hovered or selected. */
	enabled?: boolean;
	/** A hairline between groups; nothing else on it is read. */
	separator?: boolean;
	shortcut?: string;
}

export interface MenuOptions extends Omit<ComponentOptions, 'style' | 'height'> {
	items?: MenuItem[];
	/** Default 200. */
	width?: number;
	/** The highlighted item, -1 for none; an owner sets it for keyboard navigation. */
	hoveredIndex?: number;
	/** The tallest the menu grows; past it the items scroll. */
	maxHeight?: number;
	/** R11.10: item height and text size. Default `sm`. */
	size?: ControlSize;
	/** After the item's own `onSelect`, with the item and its index. */
	onSelect?: ((item: MenuItem, index: number) => void) | null;
}

const DEFAULT_WIDTH = 200;
/** Between the surface's edge and the first and last rows. */
const PAD = tokens.space.space_1;
const SEPARATOR_HEIGHT = tokens.space.space_2;
const INSET = tokens.control.inset_field;
const SHORTCUT_GAP = tokens.space.space_4;
const SURFACE_SHADOW = resolveShadow('shadow_pop');

/** Whether `item` can be hovered and selected. */
export function isSelectable(item: MenuItem | undefined): boolean {
	return item !== undefined && !item.separator && item.enabled !== false;
}

/**
 * The rows, drawn and hit-tested by one component. Rows are not components:
 * a menu's items are data its owner rebuilds whenever it opens, and a row
 * has no state of its own beyond the menu's hovered index.
 */
class MenuRows extends Component {
	private readonly menu: Menu;
	/** A press began inside the rows and is still down. */
	private armed = false;

	constructor({ menu }: { menu: Menu }) {
		// The scroll container gives it its width; its height is the rows'.
		super({ widthMode: 'fill', heightMode: 'fixed' });
		this.componentType = 'MenuRows';
		this.menu = menu;
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	public get handlesPointer(): boolean {
		return true;
	}

	/** R12.11: hover follows the pointer (not consumed); a press is taken; a release on an enabled item selects. */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'pointermove':
			case 'pointerenter':
				if (event.pointerType !== 'touch' || this.armed) this.menu.hoveredIndex = this.selectableAt(event);
				return;
			case 'pointerleave':
				if (!this.armed) this.menu.hoveredIndex = -1;
				return;
			case 'pointerdown':
				event.consume();
				// R9.23: the select or button that opened the menu keeps focus.
				event.preventFocus();
				if (event.button !== 0) return;
				this.armed = true;
				event.capturePointer();
				this.menu.hoveredIndex = this.selectableAt(event);
				return;
			case 'pointerup': {
				if (!this.armed || event.button !== 0) return;
				this.armed = false;
				event.consume();
				const index = this.selectableAt(event);
				if (index !== -1) this.menu.select(index);
				return;
			}
			case 'pointercancel':
			case 'lostpointercapture':
				this.armed = false;
				return;
		}
	}

	protected onUnmount(): void {
		this.armed = false;
	}

	public render(draw: DrawApi): void {
		const { items } = this.menu;
		const metrics = CONTROL_SIZES[this.menu.size];
		const { color } = tokens;
		for (let index = 0; index < items.length; index++) {
			const item = items[index];
			const row = this.menu.rowRect(index);
			if (item.separator) {
				draw.drawRect({
					rect: { x: row.x + INSET, y: row.y + Math.floor(row.height / 2), width: Math.max(0, row.width - INSET * 2), height: tokens.borderWidth.bw },
					fill: color.line_hairline,
				});
				continue;
			}
			const enabled = item.enabled !== false;
			const hovered = enabled && index === this.menu.hoveredIndex;
			if (hovered) draw.drawRect({ rect: row, fill: color.bg_hover });
			let labelWidth = row.width - INSET * 2;
			if (item.shortcut) {
				const shortcutWidth = this.menu.shortcutWidth(item.shortcut);
				draw.drawText({
					text: item.shortcut,
					box: { x: row.x + row.width - INSET - shortcutWidth, y: row.y, width: shortcutWidth, height: row.height },
					font: 'mono',
					size: tokens.fontSize.fs_xs,
					letterSpacing: tokens.letterSpacing.ls_wider,
					color: enabled ? color.text_dim : color.text_disabled,
					align: 'right',
					verticalAlign: 'middle',
					wrap: 'none',
				});
				labelWidth -= shortcutWidth + SHORTCUT_GAP;
			}
			draw.drawText({
				text: item.label ?? '',
				box: { x: row.x + INSET, y: row.y, width: Math.max(0, labelWidth), height: row.height },
				font: 'body',
				size: metrics.fontSize,
				color: !enabled ? color.text_disabled : hovered ? color.text_bright : color.text,
				align: 'left',
				verticalAlign: 'middle',
				wrap: 'none',
				overflow: 'ellipsis',
			});
		}
	}

	private selectableAt(event: UiPointerEvent): number {
		const local = event.local;
		if (!local || local.x < 0 || local.x >= this.width) return -1;
		const index = this.menu.indexAt(local.y);
		return isSelectable(this.menu.items[index]) ? index : -1;
	}
}

/**
 * The menu's viewport onto its rows: a ScrollContainer (R12.20) that lets the
 * menu bring a highlighted row into view once it has measured them.
 */
class MenuScroll extends ScrollContainer {
	private readonly menu: Menu;

	constructor({ id, menu }: { id?: string; menu: Menu }) {
		super({ id });
		this.menu = menu;
	}

	protected layoutChildren(): void {
		super.layoutChildren();
		this.menu.scrollerLaidOut();
	}
}

/**
 * R12.11's menu, the building block Select, DropdownButton, and ContextMenu
 * open: a raised surface of rows, each an item or a separator, with an
 * optional shortcut hint. It has no positioning of its own; its owner opens
 * it through the popup service (R12.31), which places it (R12.30) and, when
 * the room there is shorter than the menu, sets it shorter.
 *
 * Hover follows the pointer and is not consumed; a press inside is consumed
 * and keeps focus where it was (on the owner); a release on an enabled item
 * selects it, but only when the press began inside the menu, so the release
 * of the press that opened it never selects. Owners drive the keyboard
 * through `moveHover`, `hoverEdge`, and `selectHovered`.
 */
export class Menu extends Component {
	public onSelect: ((item: MenuItem, index: number) => void) | null;

	protected readonly rows: MenuRows;
	/** R12.11: the rows scroll inside it when the menu is shorter than they are. */
	private readonly scroller: MenuScroll;
	/** A highlight moved by the keys before the scroller had laid out, to bring into view once it has. */
	private revealPending = false;
	private menuItems: MenuItem[];
	private highlighted: number;
	private cap: number;
	private readonly menuSize: ControlSize;
	/** Each row's top from the first row, and the rows' total, from `items`. */
	private tops: number[] = [];
	private rowsHeight = 0;

	constructor({ items = [], width = DEFAULT_WIDTH, hoveredIndex = -1, maxHeight = Number.POSITIVE_INFINITY, size = 'sm', onSelect = null, ...options }: MenuOptions = {}) {
		super({ ...options, width });
		this.componentType = 'Menu';
		this.menuItems = items;
		this.highlighted = hoveredIndex;
		this.cap = maxHeight;
		this.menuSize = size;
		this.onSelect = onSelect;
		this.rows = new MenuRows({ menu: this });
		this.scroller = new MenuScroll({ id: options.id ? `${options.id}.scroll` : undefined, menu: this });
		this.scroller.addChild(this.rows);
		this.addPart(this.scroller);
		this.revealPending = hoveredIndex !== -1;
		this.measureRows();
		this.fitHeight();
	}

	/** The surface occludes and takes presses between rows and in its padding. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	public get handlesPointer(): boolean {
		return true;
	}

	public get items(): MenuItem[] {
		return this.menuItems;
	}

	/** New items; the hover is cleared and the height follows. */
	public set items(items: MenuItem[]) {
		this.menuItems = items;
		this.highlighted = -1;
		this.measureRows();
		this.fitHeight();
	}

	public get hoveredIndex(): number {
		return this.highlighted;
	}

	public set hoveredIndex(index: number) {
		this.highlighted = index >= 0 && index < this.menuItems.length ? index : -1;
	}

	public get maxHeight(): number {
		return this.cap;
	}

	public set maxHeight(maxHeight: number) {
		this.cap = maxHeight;
		this.fitHeight();
	}

	public get size(): ControlSize {
		return this.menuSize;
	}

	/** Every row and the padding: the height the menu asks for before `maxHeight` or placement cut it. */
	public get naturalHeight(): number {
		return this.rowsHeight + PAD * 2;
	}

	/** Row `index` in the rows part's space. */
	public rowRect(index: number): Rect {
		const top = this.tops[index] ?? 0;
		const item = this.menuItems[index];
		const height = item?.separator ? SEPARATOR_HEIGHT : CONTROL_SIZES[this.menuSize].height;
		return { x: 0, y: top, width: this.rows.width, height };
	}

	/** The row at `y` in the rows part's space, or -1. */
	public indexAt(y: number): number {
		if (y < 0 || y >= this.rowsHeight) return -1;
		for (let index = this.tops.length - 1; index >= 0; index--) {
			if (y >= this.tops[index]) return index;
		}
		return -1;
	}

	/**
	 * Moves the highlight `step` rows, skipping separators and disabled items,
	 * wrapping at the ends when `wrap`; from no highlight, Down lands on the
	 * first selectable item and Up on the last. False when nothing is
	 * selectable.
	 */
	public moveHover(step: 1 | -1, { wrap = true }: { wrap?: boolean } = {}): boolean {
		const count = this.menuItems.length;
		if (!this.menuItems.some(isSelectable)) return false;
		let index = this.highlighted;
		if (index === -1) index = step === 1 ? -1 : count;
		for (let tries = 0; tries < count; tries++) {
			index += step;
			if (index < 0 || index >= count) {
				if (!wrap) return true;
				index = index < 0 ? count - 1 : 0;
			}
			if (isSelectable(this.menuItems[index])) {
				this.highlighted = index;
				this.revealHovered();
				return true;
			}
		}
		return true;
	}

	/** Highlights the first or last selectable item. */
	public hoverEdge(edge: 'first' | 'last'): void {
		this.highlighted = -1;
		this.moveHover(edge === 'first' ? 1 : -1);
	}

	/** How far the rows are scrolled, in logical pixels. */
	public get scrollOffset(): number {
		return this.scroller.scrollPosition;
	}

	/** Whether the rows are taller than the menu, so they scroll. */
	public get scrolls(): boolean {
		return this.scroller.overflows;
	}

	/**
	 * Scrolls the highlighted row into view, the least distance; before the
	 * scroller has laid out, once it has. Keyboard moves call it; a pointer
	 * hover is over its row already.
	 */
	public revealHovered(): void {
		if (this.highlighted === -1) return;
		if (this.scroller.scrollHeight <= 0) {
			this.revealPending = true;
			return;
		}
		this.revealPending = false;
		const row = this.rowRect(this.highlighted);
		const top = this.scroller.scrollPosition;
		const viewport = this.scroller.height;
		if (row.y < top) this.scroller.scrollTo(row.y);
		else if (row.y + row.height > top + viewport) this.scroller.scrollTo(row.y + row.height - viewport);
	}

	/** Called by the scroller after each layout. */
	public scrollerLaidOut(): void {
		if (this.revealPending) this.revealHovered();
	}

	/** Selects the highlighted item; false when there is none. */
	public selectHovered(): boolean {
		return this.select(this.highlighted);
	}

	/** Selects `index` as a user choice: its `onSelect`, then the menu's. False for a separator, a disabled item, or no item. */
	public select(index: number): boolean {
		const item = this.menuItems[index];
		if (!isSelectable(item)) return false;
		item.onSelect?.();
		this.onSelect?.(item, index);
		return true;
	}

	/** The width a shortcut hint is drawn in, measured when the menu can measure. */
	public shortcutWidth(shortcut: string): number {
		const draw = this.context?.draw;
		if (!draw || !draw.canMeasureText('mono')) return 0;
		return draw.measureText({ text: shortcut, font: 'mono', size: tokens.fontSize.fs_xs, letterSpacing: tokens.letterSpacing.ls_wider, wrap: 'none' }).width;
	}

	/** R8.8: the drop shadow reaches past the surface. */
	public get inkExtent(): number {
		return shadowExtent(SURFACE_SHADOW);
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: tokens.color.bg_panel_raised, border: tokens.color.line_edge, text: tokens.color.text };
	}

	/** A press on the surface between rows is still inside the menu (R12.11). */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (event.type === 'pointerdown') {
			event.consume();
			event.preventFocus();
		}
	}

	public render(draw: DrawApi): void {
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: tokens.color.bg_panel_raised,
			radius: tokens.radius.radius_ui,
			border: { color: tokens.color.line_edge, width: tokens.borderWidth.bw },
			shadow: SURFACE_SHADOW,
		});
	}

	protected onResized(): void {
		this.placeRows();
	}

	private measureRows(): void {
		const rowHeight = CONTROL_SIZES[this.menuSize].height;
		let top = 0;
		this.tops = this.menuItems.map((item) => {
			const at = top;
			top += item.separator ? SEPARATOR_HEIGHT : rowHeight;
			return at;
		});
		this.rowsHeight = top;
	}

	private fitHeight(): void {
		super.setSize(this.width, Math.min(this.naturalHeight, this.cap));
		this.placeRows();
	}

	/** The scroller fills the menu inside the padding; the rows are as tall as they are. */
	private placeRows(): void {
		this.scroller.setPosition(0, PAD);
		this.scroller.setSize(this.width, Math.max(0, this.height - PAD * 2));
		this.rows.height = this.rowsHeight;
	}
}
