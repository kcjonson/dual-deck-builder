import { Component, ComponentOptions, PointerEvents, ResolvedColors } from '../components/Component';
import { Icon } from '../components/Icon';
import type { Size } from '../components/layoutTypes';
import { Text } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import type { AnyUiEvent, UiActionEvent, UiKeyEvent, UiPointerEvent } from '../input/events';
import { Look, LookLayers, resolveLook } from '../style/look';
import { LookTransition } from '../style/LookTransition';
import { rowLayers } from '../style/variants';
import { tokens } from '../theme/tokens';
import { Pressable } from './Pressable';
import { ScrollContainer } from './ScrollContainer';
import { CLEAR, rgba } from './surfaces';

/** R12.25's node: a label, an optional count, children, and whether it starts expanded. */
export interface TreeNode {
	/** A stable key; the path of child indices when absent. */
	id?: string;
	label: string;
	count?: number | string;
	children?: readonly TreeNode[];
	expanded?: boolean;
}

/** One visible line of the flattened tree. */
export interface TreeRowItem {
	node: TreeNode;
	key: string;
	depth: number;
	/** Index of the parent's row in the flattened list, -1 at the top level. */
	parent: number;
}

export type TreeNodeCallback = (node: TreeNode) => void;

export interface TreeViewOptions extends Omit<ComponentOptions, 'style'> {
	nodes: readonly TreeNode[];
	/** Default `control_h_sm`. */
	rowHeight?: number;
	/** Per depth level. Default `space_4`. */
	indent?: number;
	/** Rows can be selected (one at a time), reported through `onSelect`. Default false: view-only. */
	selectable?: boolean;
	onExpand?: TreeNodeCallback;
	onCollapse?: TreeNodeCallback;
	onSelect?: TreeNodeCallback;
}

const { color } = tokens;
const CHEVRON = tokens.control.icon_sm;
const INSET = tokens.control.inset_row;

function hasChildren(node: TreeNode): boolean {
	return (node.children?.length ?? 0) > 0;
}

/**
 * One visible row: chevron, label, and count, pressed like a list row. Not
 * focusable: the tree is the one Tab stop, and rows come and go as the tree
 * culls them.
 */
class TreeRow extends Pressable {
	public item: TreeRowItem;
	private readonly tree: TreeView;
	private readonly chevron: Icon;
	private readonly label: Text;
	private readonly countText: Text;
	private layers: LookLayers = rowLayers({ dim: false });
	private readonly transition: LookTransition;
	private isCursor = false;

	constructor({ tree, item, id }: { tree: TreeView; item: TreeRowItem; id?: string }) {
		super({ id });
		this.componentType = 'TreeRow';
		this.tree = tree;
		this.item = item;
		this.chevron = new Icon({ glyph: 'chevron_right', size: CHEVRON, tint: color.text_dim });
		this.label = new Text({
			text: '',
			style: { fontRole: 'body', fontSize: tokens.fontSize.fs_base },
			verticalAlign: 'middle',
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		this.countText = new Text({
			text: '',
			style: { fontRole: 'mono', fontSize: tokens.fontSize.fs_xs, color: rgba(color.text_dim) },
			verticalAlign: 'middle',
			wrap: 'none',
		});
		this.addPart(this.chevron);
		this.addPart(this.label);
		this.addPart(this.countText);
		this.transition = new LookTransition({ owner: this, look: this.targetLook, onChange: (look) => { this.label.color = rgba(look.text); } });
		this.show(item);
	}

	/**
	 * The keyboard cursor: R11.11's `active` while the tree is focused, so
	 * the snapshot reports it, and an inside ring while focus is visible.
	 */
	public get keyboardCursor(): boolean {
		return this.isCursor;
	}

	public set keyboardCursor(cursor: boolean) {
		this.isCursor = cursor;
		this.active = cursor && this.tree.focused;
	}

	/** Where the chevron column ends, in the row's space: a press left of it toggles. */
	public get chevronEnd(): number {
		return INSET + this.item.depth * this.tree.indent + CHEVRON + tokens.space.space_1;
	}

	public show(item: TreeRowItem): void {
		this.item = item;
		const expandable = hasChildren(item.node);
		this.chevron.visible = expandable;
		if (expandable) this.chevron.glyph = this.tree.isExpanded(item.key) ? 'expand_more' : 'chevron_right';
		this.label.text = item.node.label;
		const count = item.node.count;
		this.countText.text = count === undefined ? '' : String(count);
		this.countText.visible = count !== undefined;
		this.selected = this.tree.selectedKey === item.key;
		// Placed here rather than invalidated: the tree calls this from its
		// own layout, and a row's invalidation would mark the tree again.
		this.placeParts();
	}

	public get resolvedColors(): ResolvedColors {
		const look = this.transition.look;
		return { fill: look.fill, text: look.text };
	}

	protected layoutChildren(): void {
		this.placeParts();
	}

	protected onResized(): void {
		super.onResized();
		if (this.countText) this.placeParts();
	}

	private placeParts(): void {
		const left = INSET + this.item.depth * this.tree.indent;
		this.chevron.setPosition(left, Math.round((this.height - CHEVRON) / 2));
		let right = this.width - INSET;
		if (this.countText.visible) {
			this.countText.height = this.height;
			this.countText.setPosition(right - this.countText.width, 0);
			right -= this.countText.width + INSET;
		}
		const labelX = left + CHEVRON + tokens.space.space_1_5;
		this.label.setPosition(labelX, 0);
		this.label.setSize(Math.max(0, right - labelX), this.height);
	}

	protected onMount(): void {
		this.transition.moveTo(this.targetLook, null);
	}

	protected onUnmount(): void {
		super.onUnmount();
		this.transition.moveTo(this.targetLook, null);
	}

	protected onStateChange(): void {
		super.onStateChange();
		if (this.transition) this.transition.moveTo(this.targetLook, this.context?.animator ?? null);
	}

	protected onPressed(event: UiPointerEvent | UiActionEvent): void {
		let onChevron = false;
		if ('screen' in event) {
			const local = this.screenToLocal(event.screen);
			onChevron = local !== null && local.x < this.chevronEnd;
		}
		this.tree.rowPressed(this, onChevron);
	}

	public render(draw: DrawApi): void {
		const look = this.transition.look;
		const { width, height } = this;
		if (look.fill[3] > 0) draw.drawRect({ id: this.id ?? undefined, rect: { x: 0, y: 0, width, height }, fill: look.fill });
		if (this.selected) draw.drawRect({ rect: { x: 0, y: 0, width: tokens.borderWidth.bw_thick, height }, fill: color.accent });
		if (this.isCursor && this.tree.focusVisible) {
			draw.drawRect({
				rect: { x: 0, y: 0, width, height },
				fill: CLEAR,
				border: { color: color.accent, width: tokens.control.focus_ring_width, position: 'inside' },
			});
		}
	}

	private get targetLook(): Look {
		return resolveLook(this.layers, this.stateFlags);
	}
}


/**
 * The scroll container's content: a column exactly as tall as every visible
 * row, holding only the rows inside the container's viewport. It lays out
 * after the container has measured it and clamped the scroll, so the window
 * it culls to is the current one.
 */
class TreeRows extends Component {
	private readonly tree: TreeView;
	/** Laying out: a scroll it causes itself (revealing the cursor) needs no second pass. */
	public laying = false;

	constructor({ tree, id }: { tree: TreeView; id: string }) {
		super({ id, widthMode: 'fill', heightMode: 'hug' });
		this.componentType = 'TreeRows';
		this.tree = tree;
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'passthrough';
	}

	public measure(availableWidth: number): Size {
		return { width: availableWidth, height: this.tree.rows.length * this.tree.rowHeight };
	}

	protected layoutChildren(): void {
		this.laying = true;
		try {
			this.tree.layoutRows(this);
		} finally {
			this.laying = false;
		}
	}
}

/**
 * R12.25's tree view: `nodes` flattened into rows (rebuilt lazily when the
 * expansion changes), each with a chevron column that toggles, a label, and
 * a trailing count.
 *
 * Scrolling is a ScrollContainer's (R12.20): the wheel with R9.32's latch,
 * the Scrollbar (R12.37) while the rows overflow, and the popup close on
 * scroll. The tree virtualises inside it: the content is a column as tall as
 * every row, and only the rows inside the viewport exist as components,
 * culled again whenever the container scrolls.
 *
 * It is one Tab stop and keeps a keyboard cursor over its rows (the
 * `aria-activedescendant` pattern rather than a focus per row, since culled
 * rows come and go); the cursor's row carries R11.11's `active` flag while
 * the tree is focused, so the snapshot shows it. Up and Down move it, Page
 * Up and Page Down by a viewport, Home and End to the ends, Right expands a
 * collapsed row or steps into an expanded one, Left collapses an expanded
 * row or steps out to the parent, Enter and Space select (when
 * `selectable`) or toggle; the cursor is kept in view. A press on the
 * chevron column toggles; one elsewhere selects, or toggles in a view-only
 * tree.
 *
 * `expandAll`, `collapseAll`, `expand`, `collapse`, and `select` are
 * programmatic and fire nothing; user changes fire `onExpand`, `onCollapse`,
 * and `onSelect` once, after they are applied. A collapse that hides the
 * cursor's row moves the cursor to its nearest visible ancestor; the
 * selection survives being folded away.
 */
export class TreeView extends Component {
	public onExpand: TreeNodeCallback | null = null;
	public onCollapse: TreeNodeCallback | null = null;
	public onSelect: TreeNodeCallback | null = null;

	private nodeList: readonly TreeNode[];
	private readonly rowHeightValue: number;
	private readonly indentValue: number;
	private readonly selectable: boolean;
	private readonly expandedKeys = new Set<string>();
	private flat: TreeRowItem[] | null = null;
	private selectedRowKey: string | null = null;
	private cursorIndex = 0;
	/** A row to bring into view at the next layout, once the container knows the new extent. */
	private revealIndex: number | null = null;
	private readonly scroller: ScrollContainer;
	private readonly rowLayer: TreeRows;

	constructor({ nodes, rowHeight = tokens.control.control_h_sm, indent = tokens.space.space_4, selectable = false, onExpand, onCollapse, onSelect, ...options }: TreeViewOptions) {
		super({ focusable: true, ...options });
		this.componentType = 'TreeView';
		this.nodeList = nodes;
		this.rowHeightValue = rowHeight;
		this.indentValue = indent;
		this.selectable = selectable;
		if (onExpand) this.onExpand = onExpand;
		if (onCollapse) this.onCollapse = onCollapse;
		if (onSelect) this.onSelect = onSelect;
		this.seedExpansion(nodes, '');

		const id = this.id ?? 'tree';
		// Not focusable: a press anywhere in the tree focuses the tree itself.
		this.scroller = new ScrollContainer({
			id: `${id}_scroll`,
			width: this.width,
			height: this.height,
			focusable: false,
			onScroll: () => {
				if (!this.rowLayer.laying) this.rowLayer.invalidateLayout();
			},
		});
		this.rowLayer = new TreeRows({ tree: this, id: `${id}_rows` });
		this.scroller.addChild(this.rowLayer);
		this.addPart(this.scroller);
	}

	/** The rows draw the cursor ring inside the view's clip. */
	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	public get nodes(): readonly TreeNode[] {
		return this.nodeList;
	}

	/** New data: expansion is seeded again from the nodes; the selection is kept only when its key survives. */
	public set nodes(nodes: readonly TreeNode[]) {
		this.nodeList = nodes;
		this.expandedKeys.clear();
		this.seedExpansion(nodes, '');
		if (this.selectedRowKey !== null && !this.findNode(this.selectedRowKey)) this.selectedRowKey = null;
		this.rebuild();
	}

	public get rowHeight(): number {
		return this.rowHeightValue;
	}

	public get indent(): number {
		return this.indentValue;
	}

	/** The flattened visible rows, in order, rebuilt when the expansion or the nodes changed. */
	public get rows(): readonly TreeRowItem[] {
		if (!this.flat) {
			const rows: TreeRowItem[] = [];
			this.flatten(this.nodeList, '', 0, -1, rows);
			this.flat = rows;
			this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, rows.length - 1));
		}
		return this.flat;
	}

	public get selectedKey(): string | null {
		return this.selectedRowKey;
	}

	/** The selected node, whether or not its row is showing. */
	public get selectedNode(): TreeNode | null {
		return this.selectedRowKey === null ? null : this.findNode(this.selectedRowKey);
	}

	/** The keyboard cursor's row. */
	public get cursorRow(): TreeRowItem | null {
		return this.rows[this.cursorIndex] ?? null;
	}

	/** The rows that exist as components now: the ones inside the view. */
	public get visibleRows(): readonly Component[] {
		return this.rowLayer.children;
	}

	/** The scroll container the rows live in (R12.20). */
	public get scrollContainer(): ScrollContainer {
		return this.scroller;
	}

	public get scrollOffset(): number {
		return this.scroller.scrollPosition;
	}

	public get maxScroll(): number {
		return this.scroller.maxScroll;
	}

	public isExpanded(key: string): boolean {
		return this.expandedKeys.has(key);
	}

	public expand(key: string): void {
		if (this.expandedKeys.has(key)) return;
		this.expandedKeys.add(key);
		this.rebuild();
	}

	public collapse(key: string): void {
		if (!this.expandedKeys.delete(key)) return;
		this.rebuild();
	}

	public expandAll(): void {
		this.walk(this.nodeList, '', (node, key) => {
			if (hasChildren(node)) this.expandedKeys.add(key);
		});
		this.rebuild();
	}

	public collapseAll(): void {
		this.expandedKeys.clear();
		this.rebuild();
	}

	/** Programmatic selection by key (null clears); fires nothing. */
	public select(key: string | null): void {
		this.selectedRowKey = key;
		this.refreshRows();
	}

	public scrollTo(offset: number): void {
		this.scroller.scrollTo(offset);
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: color.bg_inset, border: color.line_edge };
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (event.consumed || event.target !== this) return;
		if (event.type === 'keydown') {
			if (this.keyPressed(event)) event.consume();
			return;
		}
		if (event.type === 'activate') {
			const row = this.cursorRow;
			if (!row) return;
			event.consume();
			this.useRow(row, false);
		}
	}

	/** @internal A row was clicked: the chevron column toggles; elsewhere selects, or toggles when view-only. */
	public rowPressed(row: TreeRow, onChevron: boolean): void {
		const index = this.rows.findIndex((item) => item.key === row.item.key);
		if (index === -1) return;
		this.cursorIndex = index;
		this.useRow(this.rows[index], onChevron);
	}

	protected onStateChange(): void {
		super.onStateChange();
		// The cursor's `active` flag and ring follow focus and its visibility.
		this.refreshRows();
	}

	protected onResized(): void {
		super.onResized();
		if (this.scroller) this.scroller.setSize(this.width, this.height);
	}

	/**
	 * @internal Called from the row column's layout, after the container has
	 * measured it and clamped the scroll: reveals the cursor if asked, then
	 * keeps only the rows inside the viewport, placed in the column.
	 */
	public layoutRows(column: TreeRows): void {
		const height = this.rowHeightValue;
		const viewport = this.scroller.height;
		if (this.revealIndex !== null) {
			const top = this.revealIndex * height;
			const position = this.scroller.scrollPosition;
			if (top < position) this.scroller.scrollTo(top);
			else if (top + height > position + viewport) this.scroller.scrollTo(top + height - viewport);
			this.revealIndex = null;
		}
		const rows = this.rows;
		const scrollTop = this.scroller.scrollPosition;
		const first = Math.max(0, Math.floor(scrollTop / height));
		const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / height));
		const id = this.id ?? 'tree';
		column.reconcileChildren<TreeRowItem, TreeRow>(rows.slice(first, last), {
			key: (item) => item.key,
			// Keys are paths joined by `/`, which a snapshot path would split.
			create: (item) => new TreeRow({ tree: this, item, id: `${id}_row_${item.key.replace(/\//g, '_')}` }),
			update: (child, item) => child.show(item),
		});
		(column.children as TreeRow[]).forEach((child, index) => {
			child.setPosition(0, (first + index) * height);
			child.setSize(column.width, height);
			child.keyboardCursor = first + index === this.cursorIndex;
		});
	}

	public render(draw: DrawApi): void {
		if (this.width <= 0 || this.height <= 0) return;
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: color.bg_inset,
			border: { color: color.line_edge, width: tokens.borderWidth.bw_hair },
		});
	}

	private useRow(row: TreeRowItem, toggle: boolean): void {
		if (toggle || !this.selectable) {
			if (hasChildren(row.node)) this.toggle(row);
			this.refreshRows();
			return;
		}
		const changed = this.selectedRowKey !== row.key;
		this.selectedRowKey = row.key;
		this.refreshRows();
		if (changed) this.onSelect?.(row.node);
	}

	private toggle(row: TreeRowItem): void {
		if (this.expandedKeys.has(row.key)) {
			this.collapse(row.key);
			this.onCollapse?.(row.node);
		} else {
			this.expand(row.key);
			this.onExpand?.(row.node);
		}
	}

	private keyPressed(event: UiKeyEvent): boolean {
		const { ctrl, meta, alt, shift } = event.modifiers;
		if (ctrl || meta || alt || shift) return false;
		const rows = this.rows;
		const row = rows[this.cursorIndex];
		if (!row) return false;
		const page = Math.max(1, Math.floor(this.scroller.height / this.rowHeightValue) - 1);
		switch (event.key) {
			case 'ArrowUp':
				this.moveCursor(this.cursorIndex - 1);
				return true;
			case 'ArrowDown':
				this.moveCursor(this.cursorIndex + 1);
				return true;
			case 'PageUp':
				this.moveCursor(this.cursorIndex - page);
				return true;
			case 'PageDown':
				this.moveCursor(this.cursorIndex + page);
				return true;
			case 'Home':
				this.moveCursor(0);
				return true;
			case 'End':
				this.moveCursor(rows.length - 1);
				return true;
			case 'ArrowRight':
				if (!hasChildren(row.node)) return true;
				if (this.isExpanded(row.key)) this.moveCursor(this.cursorIndex + 1);
				else this.toggle(row);
				return true;
			case 'ArrowLeft':
				if (hasChildren(row.node) && this.isExpanded(row.key)) this.toggle(row);
				else if (row.parent >= 0) this.moveCursor(row.parent);
				return true;
			default:
				return false;
		}
	}

	/** Moves the cursor and brings its row into view at the next layout. */
	private moveCursor(index: number): void {
		this.cursorIndex = Math.max(0, Math.min(this.rows.length - 1, index));
		this.revealIndex = this.cursorIndex;
		this.refreshRows();
	}

	/**
	 * The expansion changed: flatten again, and keep the cursor on its row,
	 * or on the nearest ancestor still showing when a collapse hid it.
	 */
	private rebuild(): void {
		const previous = this.flat;
		this.flat = null;
		if (previous) {
			const rows = this.rows;
			for (let index = this.cursorIndex; index >= 0 && index < previous.length; index = previous[index].parent) {
				const survivor = rows.findIndex((row) => row.key === previous[index].key);
				if (survivor !== -1) {
					this.cursorIndex = survivor;
					break;
				}
				if (previous[index].parent < 0) {
					this.cursorIndex = 0;
					break;
				}
			}
		}
		this.rowLayer.invalidateLayout();
	}

	/** Rows re-read the selection, the cursor, and the chevrons without being rebuilt. */
	private refreshRows(): void {
		this.rowLayer?.invalidateLayout();
	}

	private findNode(key: string): TreeNode | null {
		let found: TreeNode | null = null;
		this.walk(this.nodeList, '', (node, nodeKey) => {
			if (!found && nodeKey === key) found = node;
		});
		return found;
	}

	private seedExpansion(nodes: readonly TreeNode[], prefix: string): void {
		this.walk(nodes, prefix, (node, key) => {
			if (node.expanded && hasChildren(node)) this.expandedKeys.add(key);
		});
	}

	private walk(nodes: readonly TreeNode[], prefix: string, visit: (node: TreeNode, key: string) => void): void {
		nodes.forEach((node, index) => {
			const key = node.id ?? `${prefix}${index}`;
			visit(node, key);
			if (node.children) this.walk(node.children, `${key}/`, visit);
		});
	}

	private flatten(nodes: readonly TreeNode[], prefix: string, depth: number, parent: number, out: TreeRowItem[]): void {
		nodes.forEach((node, index) => {
			const key = node.id ?? `${prefix}${index}`;
			const at = out.length;
			out.push({ node, key, depth, parent });
			if (node.children && this.expandedKeys.has(key)) this.flatten(node.children, `${key}/`, depth + 1, at, out);
		});
	}
}
