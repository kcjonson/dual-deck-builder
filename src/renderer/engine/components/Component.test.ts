import { Component } from './Component';
import { Container } from './Container';
import { Rectangle } from './Rectangle';

/** A leaf that counts unmounts, so a test can see removeChild release it. */
class Probe extends Rectangle {
	public unmounts = 0;

	public unmount(): void {
		this.unmounts += 1;
		super.unmount();
	}
}

function ids(components: readonly Component[]): (string | null)[] {
	return components.map((component) => component.id);
}

describe('Component properties (R8.2)', () => {
	it('defaults every property the spec lists', () => {
		const component = new Rectangle();

		expect(component.id).toBeNull();
		expect(component.visible).toBe(true);
		expect(component.enabled).toBe(true);
		expect(component.opacity).toBe(1);
		expect(component.layer).toBeNull();
		expect(component.zIndex).toBe(0);
		expect(component.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
		expect(component.transformMatrix).toBeNull();
		expect(component.pointerEvents).toBe('auto');
	});

	it('defaults pointerEvents by kind: leaves auto, containers passthrough (R8.29)', () => {
		expect(new Rectangle().pointerEvents).toBe('auto');
		expect(new Container().pointerEvents).toBe('passthrough');
		expect(new Container({ pointerEvents: 'none' }).pointerEvents).toBe('none');
	});

	it('expands a number margin to all four sides and keeps per-side values', () => {
		expect(new Container({ margin: 4 }).margin).toEqual({ top: 4, right: 4, bottom: 4, left: 4 });
		expect(new Container({ margin: { left: 3, top: 1 } }).margin).toEqual({ top: 1, right: 0, bottom: 0, left: 3 });
	});

	it('reports the margin box as bounds and hit-tests the content box (R8.10 to R8.12)', () => {
		const root = new Container({ width: 400, height: 400 });
		const box = new Rectangle({ x: 10, y: 20, width: 50, height: 30, margin: { top: 5, left: 7, right: 2, bottom: 1 } });
		root.addChild(box);

		expect(box.bounds).toEqual({ x: 10, y: 20, width: 59, height: 36 });
		expect(box.screenBounds).toEqual({ x: 17, y: 25, width: 50, height: 30 });
		expect(box.containsScreenPoint(17, 25)).toBe(true);
		// Half-open: the right and bottom edges belong to the next box.
		expect(box.containsScreenPoint(67, 40)).toBe(false);
		expect(box.containsScreenPoint(40, 55)).toBe(false);
		// Inside the margin, outside the content box.
		expect(box.containsScreenPoint(12, 22)).toBe(false);
	});
});

describe('effective values (R8.3)', () => {
	it('derives visibility, enabled, opacity and layer from the ancestors', () => {
		const root = new Container({ opacity: 0.5 });
		const middle = new Container({ opacity: 0.5, layer: 'raised' });
		const leaf = new Rectangle({ opacity: 0.5 });
		root.addChild(middle);
		middle.addChild(leaf);

		expect(leaf.effectiveOpacity).toBe(0.125);
		expect(leaf.effectiveLayer).toBe('raised');
		expect(leaf.effectivelyVisible).toBe(true);
		expect(leaf.effectivelyEnabled).toBe(true);

		middle.visible = false;
		root.setEnabled(false);
		expect(leaf.effectivelyVisible).toBe(false);
		expect(leaf.effectivelyEnabled).toBe(false);
		expect(leaf.visible).toBe(true);
	});

	it('keeps the higher of own and inherited layer, so a subtree never paints beneath its ancestor (R3.6)', () => {
		const parent = new Container({ layer: 'overlay' });
		const child = new Container({ layer: 'raised' });
		parent.addChild(child);

		expect(child.effectiveLayer).toBe('overlay');
		expect(child.promoted).toBe(false);
	});

	it('does not hit an invisible subtree, a faded one, or one under pointerEvents none (R3.27, R8.29)', () => {
		const root = new Container({ width: 100, height: 100 });
		const leaf = new Rectangle({ width: 10, height: 10 });
		root.addChild(leaf);
		expect(leaf.containsScreenPoint(5, 5)).toBe(true);

		root.visible = false;
		expect(leaf.containsScreenPoint(5, 5)).toBe(false);
		root.visible = true;

		root.opacity = 0;
		expect(leaf.containsScreenPoint(5, 5)).toBe(false);
		root.opacity = 1;

		root.pointerEvents = 'none';
		expect(leaf.containsScreenPoint(5, 5)).toBe(false);
	});

	it('lets a promoted child escape its ancestor clip for hit testing, as it does for paint (R4.8)', () => {
		const clipper = new Container({ width: 50, height: 50, overflow: 'hidden' });
		const popup = new Rectangle({ x: 60, y: 0, width: 20, height: 20, layer: 'popup' });
		clipper.addChild(popup);

		expect(popup.promoted).toBe(true);
		expect(popup.containsScreenPoint(65, 5)).toBe(true);

		popup.layer = null;
		expect(popup.containsScreenPoint(65, 5)).toBe(false);
	});

	it('takes overflow before it has a size and clips once it gets one', () => {
		const clipper = new Container({ overflow: 'hidden' });
		const child = new Rectangle({ x: 60, y: 0, width: 20, height: 20 });
		clipper.addChild(child);

		expect(clipper.overflow).toBe('hidden');
		expect(clipper.clipsChildren).toBe(false);

		clipper.setSize(50, 50);
		expect(clipper.clipsChildren).toBe(true);
		expect(child.containsScreenPoint(65, 5)).toBe(false);
	});
});

describe('children (R8.5 to R8.7)', () => {
	it('keeps one parent per child and re-parents on add', () => {
		const first = new Container();
		const second = new Container();
		const child = new Container({ id: 'child' });

		first.addChild(child);
		second.addChild(child);

		expect(child.parent).toBe(second);
		expect(first.getChildren()).toEqual([]);
		expect(second.getChildren()).toEqual([child]);
		expect(child.root).toBe(second);
	});

	it('refuses to add a component under itself or its own descendant', () => {
		const root = new Container({ id: 'root' });
		const branch = new Container({ id: 'branch' });
		const leaf = new Container({ id: 'leaf' });
		root.addChild(branch);
		branch.addChild(leaf);

		expect(() => root.addChild(root)).toThrow('under itself or its own descendant');
		expect(() => leaf.addChild(root)).toThrow('under itself or its own descendant');
		expect(() => branch.insertChild(0, root)).toThrow('under itself or its own descendant');
		expect(root.parent).toBeNull();
		expect(ids(leaf.getChildren())).toEqual([]);
	});

	it('inserts at an index and moves a child it already holds without detaching it', () => {
		const parent = new Container();
		const a = new Container({ id: 'a' });
		const b = new Container({ id: 'b' });
		const c = new Container({ id: 'c' });
		parent.addChild(a).addChild(b);
		parent.insertChild(0, c);
		expect(ids(parent.getChildren())).toEqual(['c', 'a', 'b']);

		b.setHovered(true);
		parent.moveChild(b, 0);
		expect(ids(parent.getChildren())).toEqual(['b', 'c', 'a']);
		expect(b.hovered).toBe(true);
		expect(b.parent).toBe(parent);

		parent.insertChild(99, b);
		expect(ids(parent.getChildren())).toEqual(['c', 'a', 'b']);
	});

	it('unmounts on removeChild and clearChildren', () => {
		const parent = new Container();
		const kept = new Probe({ id: 'kept' });
		const removed = new Probe({ id: 'removed' });
		parent.addChild(kept).addChild(removed);

		expect(parent.removeChild(removed)).toBe(true);
		expect(removed.unmounts).toBe(1);
		expect(removed.parent).toBeNull();
		expect(parent.removeChild(removed)).toBe(false);

		parent.clearChildren();
		expect(kept.unmounts).toBe(1);
		expect(kept.parent).toBeNull();
		expect(parent.getChildren()).toEqual([]);
	});

	it('orders the render view by zIndex, stably, without touching the children list (R3.12, R3.13)', () => {
		const parent = new Container();
		const background = new Container({ id: 'background' });
		const raised = new Container({ id: 'raised', zIndex: 1 });
		const content = new Container({ id: 'content' });
		const under = new Container({ id: 'under', zIndex: -1 });
		parent.addChild(background).addChild(raised).addChild(content).addChild(under);

		expect(ids(parent.renderOrder)).toEqual(['under', 'background', 'content', 'raised']);
		expect(ids(parent.getChildren())).toEqual(['background', 'raised', 'content', 'under']);

		raised.zIndex = 0;
		expect(ids(parent.renderOrder)).toEqual(['under', 'background', 'raised', 'content']);
	});

	it('finds a descendant by id (R8.4)', () => {
		const root = new Container({ id: 'root' });
		const branch = new Container({ id: 'branch' });
		const leaf = new Rectangle({ id: 'leaf' });
		root.addChild(branch);
		branch.addChild(leaf);

		expect(root.findById('leaf')).toBe(leaf);
		expect(root.findById('missing')).toBeNull();
	});
});

describe('reconcileChildren (R8.27)', () => {
	interface Row {
		key: string;
		label: string;
	}

	function reconcile(parent: Container, rows: Row[], remove?: (child: Probe) => void | Promise<void>): { created: string[]; updated: string[] } {
		const created: string[] = [];
		const updated: string[] = [];
		parent.reconcileChildren(rows, {
			key: (row) => row.key,
			create: (row) => {
				created.push(row.key);
				return new Probe({ id: row.key });
			},
			update: (_child, row) => updated.push(row.key),
			remove,
		});
		return { created, updated };
	}

	it('keeps matching keys in place, creates new ones, and follows the item order', () => {
		const parent = new Container();
		reconcile(parent, [{ key: 'a', label: '' }, { key: 'b', label: '' }]);
		const [a, b] = parent.getChildren();
		a.setHovered(true);

		const { created, updated } = reconcile(parent, [{ key: 'c', label: '' }, { key: 'b', label: '' }, { key: 'a', label: '' }]);

		expect(created).toEqual(['c']);
		expect(updated).toEqual(['b', 'a']);
		expect(ids(parent.getChildren())).toEqual(['c', 'b', 'a']);
		expect(parent.getChildren()[1]).toBe(b);
		expect(parent.getChildren()[2]).toBe(a);
		expect(a.hovered).toBe(true);
		expect((a as Probe).unmounts).toBe(0);
	});

	/** A `remove` whose exit animation finishes when the test says so. */
	function deferredExit(): { remove: () => Promise<void>; finish: () => Promise<void> } {
		let resolve: () => void = () => undefined;
		const exit = new Promise<void>((done) => {
			resolve = done;
		});
		return {
			remove: () => exit,
			finish: async () => {
				resolve();
				await exit;
				await Promise.resolve();
			},
		};
	}

	it('keeps a removed key drawn after the others until its exit settles, then unmounts it', async () => {
		const parent = new Container();
		reconcile(parent, [{ key: 'a', label: '' }, { key: 'b', label: '' }]);
		const b = parent.getChildren()[1] as Probe;
		const exit = deferredExit();

		reconcile(parent, [{ key: 'c', label: '' }, { key: 'a', label: '' }], exit.remove);

		// Still in the list, and so still rendered, for the exit animation (R8.27).
		expect(ids(parent.getChildren())).toEqual(['c', 'a', 'b']);
		expect(b.unmounts).toBe(0);

		// Out of key matching: the same key returning is a new child.
		const { created } = reconcile(parent, [{ key: 'c', label: '' }, { key: 'a', label: '' }, { key: 'b', label: '' }]);
		expect(created).toEqual(['b']);
		expect(parent.getChildren().filter((child) => child.id === 'b')).toHaveLength(2);

		await exit.finish();
		expect(b.unmounts).toBe(1);
		expect(b.parent).toBeNull();
		expect(ids(parent.getChildren())).toEqual(['c', 'a', 'b']);
	});

	it('does not unmount an exiting child that was re-added elsewhere before its exit settled', async () => {
		// One root, so the move is a same-root move that keeps the child (R8.5).
		const root = new Container();
		const parent = new Container();
		const elsewhere = new Container();
		root.addChild(parent).addChild(elsewhere);
		reconcile(parent, [{ key: 'a', label: '' }]);
		const a = parent.getChildren()[0] as Probe;
		const exit = deferredExit();

		reconcile(parent, [], exit.remove);
		elsewhere.addChild(a);
		await exit.finish();

		expect(a.parent).toBe(elsewhere);
		expect(a.unmounts).toBe(0);
	});

	it('forgets a moved child\'s key, so the new parent does not treat it as its own stale key', () => {
		const root = new Container();
		const first = new Container();
		const second = new Container();
		root.addChild(first).addChild(second);
		reconcile(first, [{ key: 'a', label: '' }]);
		const a = first.getChildren()[0] as Probe;
		second.addChild(a);

		reconcile(second, [{ key: 'z', label: '' }]);

		expect(a.parent).toBe(second);
		expect(a.unmounts).toBe(0);
		expect(ids(second.getChildren())).toEqual(['z', 'a']);
	});

	it('leaves children it did not create alone and refuses duplicate keys', () => {
		const parent = new Container();
		const header = new Container({ id: 'header' });
		parent.addChild(header);

		reconcile(parent, [{ key: 'a', label: '' }]);
		expect(ids(parent.getChildren())).toEqual(['a', 'header']);

		reconcile(parent, []);
		expect(ids(parent.getChildren())).toEqual(['header']);

		expect(() => reconcile(parent, [{ key: 'x', label: '' }, { key: 'x', label: '' }])).toThrow('duplicate key');
	});
});

describe('screen geometry (R8.13, R8.26)', () => {
	it('accumulates origins and content offsets, and round-trips a point', () => {
		const root = new Container({ x: 10, y: 10, width: 500, height: 500 });
		const middle = new Container({ x: 20, y: 30, width: 200, height: 200 });
		const leaf = new Rectangle({ x: 5, y: 5, width: 10, height: 10 });
		root.addChild(middle);
		middle.addChild(leaf);

		expect(leaf.localToScreen({ x: 0, y: 0 })).toEqual({ x: 35, y: 45 });
		expect(leaf.screenToLocal({ x: 36, y: 47 })).toEqual({ x: 1, y: 2 });
		expect(leaf.screenBounds).toEqual({ x: 35, y: 45, width: 10, height: 10 });
	});

	it('rotates about the content box centre, reports the axis-aligned bounds, and hit-tests through the inverse', () => {
		const root = new Container({ width: 400, height: 400 });
		const card = new Rectangle({ x: 100, y: 100, width: 100, height: 20, transform: { rotate: Math.PI / 2 } });
		root.addChild(card);

		const bounds = card.screenBounds;
		expect(bounds.x).toBeCloseTo(140);
		expect(bounds.y).toBeCloseTo(60);
		expect(bounds.width).toBeCloseTo(20);
		expect(bounds.height).toBeCloseTo(100);

		// Above the unrotated box, inside the rotated one.
		expect(card.containsScreenPoint(150, 70)).toBe(true);
		// Inside the unrotated box, outside the rotated one.
		expect(card.containsScreenPoint(105, 110)).toBe(false);

		const local = card.screenToLocal(card.localToScreen({ x: 12, y: 7 }));
		expect(local?.x).toBeCloseTo(12);
		expect(local?.y).toBeCloseTo(7);
	});

	it('carries a point up to an ancestor the way screenMatrix does, into a caller-owned point', () => {
		const root = new Container({ x: 7, y: 3, width: 800, height: 600, transform: { scale: 1.5, origin: [0, 0] } });
		const middle = new Container({ x: 20, y: 30, width: 300, height: 300, transform: { rotate: 0.3 } });
		const card = new Rectangle({ x: 40, y: 50, width: 100, height: 140, transform: { rotate: -0.2, translate: [0, -12], scale: 1.1 } });
		root.addChild(middle);
		middle.addChild(card);
		const point = { x: 50, y: 0 };
		const out = { x: 0, y: 0 };

		expect(card.localToAncestorInto(point, root, out)).toBe(true);
		const viaScreen = root.screenToLocal(card.localToScreen(point));
		expect(out.x).toBeCloseTo(viaScreen?.x ?? NaN, 9);
		expect(out.y).toBeCloseTo(viaScreen?.y ?? NaN, 9);

		expect(card.localToAncestorInto(point, card, out)).toBe(true);
		expect(out).toEqual(point);

		const stranger = new Container({ width: 10, height: 10 });
		out.x = -1;
		expect(card.localToAncestorInto(point, stranger, out)).toBe(false);
		expect(out.x).toBe(-1);
	});

	it('ignores the transform in bounds, which is layout (R8.26)', () => {
		const card = new Rectangle({ x: 10, y: 10, width: 40, height: 60, transform: { scale: 2, translate: [5, 0] } });

		expect(card.bounds).toEqual({ x: 10, y: 10, width: 40, height: 60 });
		expect(card.screenBounds).toEqual({ x: -5, y: -20, width: 80, height: 120 });
	});

	it('has no local point under a zero scale', () => {
		const flat = new Rectangle({ width: 10, height: 10, transform: { scale: [0, 1] } });

		expect(flat.screenToLocal({ x: 5, y: 5 })).toBeNull();
		expect(flat.containsScreenPoint(5, 5)).toBe(false);
	});
});

/** Counts state notifications, as a styled component would re-resolve on each. */
class StateProbe extends Container {
	public changes = 0;

	protected onStateChange(): void {
		this.changes += 1;
	}
}

describe('state flags (R11.11)', () => {
	it('carries every flag, composing rather than ranked', () => {
		const probe = new StateProbe();
		probe.setHovered(true);
		probe.pressed = true;
		probe.setFocusState(true, true);
		probe.selected = true;
		probe.open = true;
		probe.active = true;
		probe.dropActive = true;

		expect(probe.stateFlags).toEqual({
			hovered: true,
			pressed: true,
			focused: true,
			focusVisible: true,
			enabled: true,
			selected: true,
			open: true,
			active: true,
			dropActive: true,
		});
		expect(probe.changes).toBe(7);
	});

	it('notifies only on a change', () => {
		const probe = new StateProbe();
		probe.selected = false;
		probe.pressed = false;
		probe.setHovered(false);
		expect(probe.changes).toBe(0);
	});

	it('holds focus-visible only while focused, and drops it with focus', () => {
		const probe = new StateProbe();
		probe.setFocusState(false, true);
		expect(probe.focusVisible).toBe(false);
		probe.setFocusState(true, true);
		expect(probe.focusVisible).toBe(true);
		probe.setFocusState(false, true);
		expect(probe.focusVisible).toBe(false);
	});

	it('reports the effective enabled state and tells descendants when an ancestor changes it', () => {
		const parent = new StateProbe();
		const child = new StateProbe();
		parent.addChild(child);

		parent.setEnabled(false);

		expect(child.enabled).toBe(true);
		expect(child.stateFlags.enabled).toBe(false);
		expect(child.changes).toBe(1);
	});

	it('clears pressed when disabled', () => {
		const probe = new StateProbe();
		probe.pressed = true;
		probe.setEnabled(false);
		expect(probe.pressed).toBe(false);
	});
});
