import { Clock } from '../animation/Clock';
import type { Component } from '../components/Component';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { createTestContext } from '../components/testing';
import { NO_MODIFIERS } from '../input/events';
import { click, key, send } from '../services/testing';
import { tokens } from '../theme/tokens';
import { ScrollContainer } from './ScrollContainer';
import { TreeNode, TreeView, TreeViewOptions } from './TreeView';
import { Stack } from '../components/Stack';

/** R12.25: flattening, the chevron column, selection, the keyboard, culling, and the wheel. */

const ROW = tokens.control.control_h_sm;

const NODES: readonly TreeNode[] = [
	{
		label: 'Convoy',
		count: 3,
		expanded: true,
		children: [
			{ label: 'Rammer', count: 2, children: [{ label: 'Plating' }, { label: 'Ram spike' }] },
			{ label: 'Outrider' },
		],
	},
	{ label: 'Raiders', count: 1, children: [{ label: 'Buzzard' }] },
	{ label: 'Salvage' },
];

let context: MountContext;
let root: Container;

beforeEach(() => {
	context = createTestContext({ viewport: { logical: { width: 800, height: 600 } }, clock: new Clock() });
	root = new Container({ id: 'root', width: 800, height: 600 });
	root.mount(context);
});

function tree(options: Partial<TreeViewOptions> = {}): TreeView {
	const view = new TreeView({ id: 'tree', nodes: NODES, x: 100, y: 100, width: 300, height: ROW * 10, ...options });
	root.addChild(view);
	context.frame.layout();
	return view;
}

function labels(view: TreeView): string[] {
	return view.rows.map((row) => `${'-'.repeat(row.depth)}${row.node.label}`);
}

/** The centre of row `index`, `x` in from the tree's left edge. */
function rowPoint(view: TreeView, index: number, x = 150): [number, number] {
	return [view.x + x, view.y + index * ROW - view.scrollOffset + ROW / 2];
}

function wheel(view: TreeView, deltaY: number): void {
	const [x, y] = rowPoint(view, 1);
	context.dispatcher.enqueue({ kind: 'wheel', x, y, deltaX: 0, deltaY, deltaMode: 0, modifiers: NO_MODIFIERS });
	context.dispatcher.dispatchPending();
	context.frame.layout();
}

describe('TreeView (R12.25)', () => {
	it('flattens the expanded nodes, seeding expansion from the data', () => {
		const view = tree();
		expect(labels(view)).toEqual(['Convoy', '-Rammer', '-Outrider', 'Raiders', 'Salvage']);
		expect(view.rows[1].parent).toBe(0);
	});

	it('toggles from the chevron column, firing onExpand and onCollapse once each', () => {
		const heard: string[] = [];
		const view = tree({ onExpand: (node) => heard.push(`+${node.label}`), onCollapse: (node) => heard.push(`-${node.label}`) });
		click(context, ...rowPoint(view, 1, 30));
		expect(labels(view)).toEqual(['Convoy', '-Rammer', '--Plating', '--Ram spike', '-Outrider', 'Raiders', 'Salvage']);
		click(context, ...rowPoint(view, 0, 12));
		expect(labels(view)).toEqual(['Convoy', 'Raiders', 'Salvage']);
		expect(heard).toEqual(['+Rammer', '-Convoy']);
	});

	it('toggles on a click anywhere in a view-only tree, and selects in a selectable one', () => {
		const viewOnly = tree();
		click(context, ...rowPoint(viewOnly, 3));
		expect(labels(viewOnly)).toContain('-Buzzard');
		expect(viewOnly.selectedKey).toBeNull();
		root.removeChild(viewOnly);

		const picked: string[] = [];
		const selectable = tree({ selectable: true, onSelect: (node) => picked.push(node.label) });
		click(context, ...rowPoint(selectable, 2));
		expect(selectable.selectedNode?.label).toBe('Outrider');
		click(context, ...rowPoint(selectable, 2));
		expect(picked).toEqual(['Outrider']);
		expect(labels(selectable)).not.toContain('-Buzzard');
		expect(selectable.visibleRows[2].selected).toBe(true);
	});

	it('is one Tab stop driven by the arrows: Down, Right to expand and enter, Left to collapse and leave', () => {
		const view = tree({ selectable: true });
		context.focus.focus(view, 'keyboard');
		send(context, [key('ArrowDown')]);
		expect(view.cursor?.node.label).toBe('Rammer');
		send(context, [key('ArrowRight')]);
		expect(view.isExpanded(view.cursor?.key ?? '')).toBe(true);
		send(context, [key('ArrowRight')]);
		expect(view.cursor?.node.label).toBe('Plating');
		send(context, [key('ArrowLeft')]);
		expect(view.cursor?.node.label).toBe('Rammer');
		send(context, [key('ArrowLeft')]);
		expect(labels(view)).not.toContain('--Plating');
		send(context, [key('End')]);
		expect(view.cursor?.node.label).toBe('Salvage');
		send(context, [key('Home')]);
		expect(view.cursor?.node.label).toBe('Convoy');
		send(context, [key('ArrowDown'), key('ArrowDown'), key('Enter')]);
		expect(view.selectedNode?.label).toBe('Outrider');
		expect(context.focus.focused).toBe(view);
	});

	it('expands and collapses everything programmatically without firing', () => {
		const heard: string[] = [];
		const view = tree({ onExpand: (node) => heard.push(node.label), onCollapse: (node) => heard.push(node.label) });
		view.expandAll();
		expect(labels(view)).toEqual(['Convoy', '-Rammer', '--Plating', '--Ram spike', '-Outrider', 'Raiders', '-Buzzard', 'Salvage']);
		view.collapseAll();
		expect(labels(view)).toEqual(['Convoy', 'Raiders', 'Salvage']);
		expect(heard).toEqual([]);
	});

	it('culls rows outside its height and clips the rest', () => {
		const many: TreeNode[] = Array.from({ length: 40 }, (_, index) => ({ label: `Part ${index}` }));
		const view = tree({ nodes: many, height: ROW * 5 });
		expect(view.scrollContainer.clipsChildren).toBe(true);
		expect(view.scrollContainer.bar.visible).toBe(true);
		expect(view.visibleRows).toHaveLength(5);
		view.scrollTo(ROW * 2.5);
		context.frame.layout();
		expect(view.visibleRows).toHaveLength(6);
		expect((view.visibleRows[0] as Component & { item: { node: TreeNode } }).item.node.label).toBe('Part 2');
	});

	it('scrolls on the wheel within its range and follows the cursor', () => {
		const many: TreeNode[] = Array.from({ length: 40 }, (_, index) => ({ label: `Part ${index}` }));
		const view = tree({ nodes: many, height: ROW * 5 });
		wheel(view, 60);
		expect(view.scrollOffset).toBe(60);
		wheel(view, 100000);
		expect(view.scrollOffset).toBe(view.maxScroll);
		context.focus.focus(view, 'keyboard');
		send(context, [key('Home')]);
		expect(view.scrollOffset).toBe(0);
		send(context, [key('End')]);
		expect(view.scrollOffset).toBe(view.maxScroll);
	});

	it('keeps a latched wheel gesture at its end instead of scrolling the page around it (R9.32)', () => {
		const many: TreeNode[] = Array.from({ length: 40 }, (_, index) => ({ label: `Part ${index}` }));
		const page = new ScrollContainer({ id: 'page', x: 0, y: 0, width: 800, height: 300 });
		const column = new Stack({ direction: 'vertical', width: 780 });
		const view = new TreeView({ id: 'tree', nodes: many, width: 300, height: ROW * 5 });
		column.addChild(view);
		column.addChild(new Stack({ width: 700, height: 900 }));
		page.addChild(column);
		root.addChild(page);
		context.frame.layout();
		const x = 150;
		const y = ROW * 2;
		const wheelAt = (deltaY: number): void => {
			context.dispatcher.enqueue({ kind: 'wheel', x, y, deltaX: 0, deltaY, deltaMode: 0, modifiers: NO_MODIFIERS });
			context.dispatcher.dispatchPending();
			context.frame.layout();
		};
		wheelAt(100000);
		expect(view.scrollOffset).toBe(view.maxScroll);
		wheelAt(100);
		expect(page.scrollPosition).toBe(0);
	});

	it('pages the cursor by a viewport with Page Up and Page Down', () => {
		const many: TreeNode[] = Array.from({ length: 40 }, (_, index) => ({ label: `Part ${index}` }));
		const view = tree({ nodes: many, height: ROW * 5 });
		context.focus.focus(view, 'keyboard');
		send(context, [key('PageDown')]);
		expect(view.cursor?.node.label).toBe('Part 4');
		send(context, [key('PageDown')]);
		expect(view.cursor?.node.label).toBe('Part 8');
		expect(view.scrollOffset).toBe(ROW * 9 - ROW * 5);
		send(context, [key('PageUp')]);
		expect(view.cursor?.node.label).toBe('Part 4');
	});

	it('moves the cursor to the nearest visible ancestor when a collapse hides its row', () => {
		const view = tree();
		view.expandAll();
		context.focus.focus(view, 'keyboard');
		send(context, [key('ArrowDown'), key('ArrowDown'), key('ArrowDown')]);
		expect(view.cursor?.node.label).toBe('Ram spike');
		view.collapse(view.rows[1].key);
		expect(view.cursor?.node.label).toBe('Rammer');
		view.collapseAll();
		expect(view.cursor?.node.label).toBe('Convoy');
	});

	it('keeps the selection when its row is folded away, and drops it when new nodes lack it', () => {
		const view = tree({ selectable: true });
		view.expandAll();
		const key2 = view.rows.find((row) => row.node.label === 'Plating')?.key ?? '';
		view.select(key2);
		view.collapseAll();
		expect(view.selectedNode?.label).toBe('Plating');
		view.nodes = [{ label: 'Salvage' }];
		expect(view.selectedKey).toBeNull();
		expect(view.selectedNode).toBeNull();
	});

	it('marks the cursor\'s row active while the tree is focused, for the snapshot', () => {
		const view = tree();
		context.frame.layout();
		expect(view.visibleRows.some((row) => row.active)).toBe(false);
		context.focus.focus(view, 'keyboard');
		send(context, [key('ArrowDown')]);
		const active = view.visibleRows.filter((row) => row.active);
		expect(active).toHaveLength(1);
		expect(active[0].stateFlags.active).toBe(true);
		expect((active[0] as Component & { item: { node: TreeNode } }).item.node.label).toBe('Rammer');
		context.focus.blur();
		context.frame.layout();
		expect(view.visibleRows.some((row) => row.active)).toBe(false);
	});

	it('is focused by a press on a row, not its scroll container', () => {
		const view = tree();
		click(context, ...rowPoint(view, 2));
		expect(context.focus.focused).toBe(view);
	});
});
