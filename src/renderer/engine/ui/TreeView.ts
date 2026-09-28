import { Component, ComponentOptions, PointerEvents, ResolvedColors } from '../components/Component';
import { Icon } from '../components/Icon';
import { Text } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import type { AnyUiEvent, UiActionEvent, UiKeyEvent, UiPointerEvent } from '../input/events';
import { Look, LookLayers, resolveLook } from '../style/look';
import { LookTransition } from '../style/LookTransition';
import { rowLayers } from '../style/variants';
import { tokens } from '../theme/tokens';
import { Pressable } from './Pressable';
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
		this.label = new Text('', {
			style: { fontFamily: 'body', fontSize: tokens.fontSize.fs_base, verticalAlign: 'middle', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
		});
		this.countText = new Text('', {
			style: { fontFamily: 'mono', fontSize: tokens.fontSize.fs_xs, color: rgba(color.text_dim), verticalAlign: 'middle', whiteSpace: 'nowrap' },
		});
		this.addPart(this.chevron);
		this.addPart(this.label);
		this.addPart(this.countText);
		this.transition = new LookTransition({ owner: this, look: this.targetLook, onChange: (look) => this.label.setColor(rgba(look.text)) });
		this.show(item);
	}

	/** The keyboard cursor: drawn as an inside ring while the tree shows focus. */
	public get cursor(): boolean {
		return this.isCursor;
	}

	public set cursor(cursor: boolean) {
		this.isCursor = cursor;
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
		this.label.setText(item.node.label);
		const count = item.node.count;
		this.countText.setText(count === undefined ? '' : String(count));
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
			this.countText.setHeight(this.height);
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
 * R12.25's tree view: `nodes` flattened into rows (rebuilt lazily when the
 * expansion changes), each with a chevron column that toggles, a label, and
 * a trailing count. Only the rows inside the view's fixed height exist as
 * components, and the view clips them; the wheel scrolls it.
 *
 * It is one Tab stop and keeps a keyboard cursor over its rows (the
 * `aria-activedescendant` pattern rather than a focus per row, since culled
 * rows come and go): Up and Down move it, Home and End go to the ends,
 * Right expands a collapsed row or steps into an expanded one, Left
 * collapses an expanded row or steps out to the parent, Enter and Space
 * select (when `selectable`) or toggle. A press on the chevron column
 * toggles; one elsewhere selects, or toggles in a view-only tree.
 *
 * `expandAll`, `collapseAll`, `expand`, `collapse`, and `select` are
 * programmatic and fire nothing; user changes fire `onExpand`, `onCollapse`,
 * and `onSelect` once, after they are applied.
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
	private scrollTop = 0;

	constructor({ nodes, rowHeight = tokens.control.control_h_sm, indent = tokens.space.space_4, selectable = false, onExpand, onCollapse, onSelect, ...options }: TreeViewOptions) {
		super({ focusable: true, overflow: 'hidden', ...options });
		this.componentType = 'TreeView';
		this.nodeList = nodes;
		this.rowHeightValue = rowHeight;
		this.indentValue = indent;
		this.selectable = selectable;
		if (onExpand) this.onExpand = onExpand;
		if (onCollapse) this.onCollapse = onCollapse;
		if (onSelect) this.onSelect = onSelect;
		this.seedExpansion(nodes, '');
	}

	/** The view is the target between and below rows too: a wheel anywhere over it scrolls it. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	public get handlesPointer(): boolean {
		return true;
	}

	/** The rows draw the cursor ring inside the view's clip. */
	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	public get nodes(): readonly TreeNode[] {
		return this.nodeList;
	}

	/** New data: expansion is seeded again from the nodes, the selection kept when its key survives. */
	public set nodes(nodes: readonly TreeNode[]) {
		this.nodeList = nodes;
		this.expandedKeys.clear();
		this.seedExpansion(nodes, '');
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

	public get selectedNode(): TreeNode | null {
		return this.rows.find((row) => row.key === this.selectedRowKey)?.node ?? null;
	}

	/** The keyboard cursor's row. */
	public get cursor(): TreeRowItem | null {
		return this.rows[this.cursorIndex] ?? null;
	}

	/** The rows that exist as components now: the ones inside the view. */
	public get visibleRows(): readonly Component[] {
		return this.getChildren();
	}

	public get scrollOffset(): number {
		return this.scrollTop;
	}

	/** How far the rows scroll: their height less the view's. */
	public get maxScroll(): number {
		return Math.max(0, this.rows.length * this.rowHeightValue - this.height);
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
		const clamped = Math.max(0, Math.min(this.maxScroll, offset));
		if (clamped === this.scrollTop) return;
		this.scrollTop = clamped;
		this.invalidateLayout();
	}

	public canScroll(_deltaX: number, deltaY: number): boolean {
		return (deltaY > 0 && this.scrollTop < this.maxScroll) || (deltaY < 0 && this.scrollTop > 0);
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: color.bg_inset };
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (event.consumed) return;
		if (event.type === 'wheel') {
			if (!this.canScroll(event.deltaX, event.deltaY)) return;
			this.scrollTo(this.scrollTop + event.deltaY);
			event.consume();
			return;
		}
		if (event.type === 'keydown' && event.target === this) {
			if (this.keyPressed(event)) event.consume();
			return;
		}
		if (event.type === 'activate' && event.target === this) {
			const row = this.cursor;
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
		// The cursor ring follows focus and its visibility.
		this.refreshRows();
	}

	/** Culls to the rows inside the view and places them at the scroll. */
	protected layoutChildren(): void {
		this.scrollTop = Math.min(this.scrollTop, this.maxScroll);
		const rows = this.rows;
		const height = this.rowHeightValue;
		const first = Math.max(0, Math.floor(this.scrollTop / height));
		const last = Math.min(rows.length, Math.ceil((this.scrollTop + this.height) / height));
		const shown = rows.slice(first, last);
		this.reconcileChildren<TreeRowItem, TreeRow>(shown, {
			key: (item) => item.key,
			// Keys are paths joined by `/`, which a snapshot path would split.
			create: (item) => new TreeRow({ tree: this, item, id: `${this.id ?? 'tree'}_row_${item.key.replace(/\//g, '_')}` }),
			update: (child, item) => child.show(item),
		});
		(this.getChildren() as TreeRow[]).forEach((child, index) => {
			child.setPosition(0, (first + index) * height - this.scrollTop);
			child.setSize(this.width, height);
			child.cursor = first + index === this.cursorIndex;
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
		switch (event.key) {
			case 'ArrowUp':
				this.moveCursor(this.cursorIndex - 1);
				return true;
			case 'ArrowDown':
				this.moveCursor(this.cursorIndex + 1);
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

	/** Moves the cursor, scrolling it into view. */
	private moveCursor(index: number): void {
		const clamped = Math.max(0, Math.min(this.rows.length - 1, index));
		this.cursorIndex = clamped;
		const top = clamped * this.rowHeightValue;
		if (top < this.scrollTop) this.scrollTo(top);
		else if (top + this.rowHeightValue > this.scrollTop + this.height) this.scrollTo(top + this.rowHeightValue - this.height);
		this.refreshRows();
	}

	/** The expansion changed: flatten again, keep the cursor on its row where it can. */
	private rebuild(): void {
		const cursorKey = this.flat?.[this.cursorIndex]?.key ?? null;
		this.flat = null;
		if (cursorKey !== null) {
			const index = this.rows.findIndex((row) => row.key === cursorKey);
			if (index !== -1) this.cursorIndex = index;
		}
		this.invalidateLayout();
	}

	/** Rows re-read the selection, the cursor, and the chevrons without being rebuilt. */
	private refreshRows(): void {
		this.invalidateLayout();
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
