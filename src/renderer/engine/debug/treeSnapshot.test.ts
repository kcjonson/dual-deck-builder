import { Layer } from '../components/Layer';
import type { Component } from '../components/Component';
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import { Panel } from '../ui/Panel';
import { ScrollContainer } from '../ui/ScrollContainer';
import { Button } from '../ui/Button';
import { tokens } from '../theme/tokens';
import { TextInput } from '../ui/TextInput';
import { Circle } from '../components/Circle';
import { SnapshotNode, SnapshotRect, treeSnapshot } from './treeSnapshot';
import { layoutLint } from './layoutLint';
import { createMeasuringDrawApi } from '../text/testing';
import { createTestContext } from '../components/testing';

const VIEWPORT = { width: 1440, height: 882 };

/** Both groups, so a walk cannot miss what a composite drew for itself. */
function descendants(node: SnapshotNode): SnapshotNode[] {
	return [...(node.parts ?? []), ...node.children];
}

function findById(node: SnapshotNode, id: string): SnapshotNode | null {
	if (node.id === id) return node;
	for (const child of descendants(node)) {
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}

function countNodes(node: SnapshotNode): number {
	return descendants(node).reduce((total, child) => total + countNodes(child), 1);
}

/** A mounted text, sized by the committed metrics the way a page sizes it. */
function measuredText(content: string, options?: ConstructorParameters<typeof Text>[1]): Text {
	const text = new Text(content, options);
	text.mount(createTestContext({ draw: createMeasuringDrawApi().api }));
	return text;
}

function rectOf(bounds: { x: number; y: number; width: number; height: number }): SnapshotRect {
	return { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
}

/** Every component beside its serialized node, parts and children both, in the snapshot's order. */
function pairs(component: Component, node: SnapshotNode): [Component, SnapshotNode][] {
	const kids = component.debugChildren;
	const serialized = [...(node.parts ?? []), ...node.children];
	const parts = kids.filter((child) => child.isPart);
	const children = kids.filter((child) => !child.isPart);
	return [[component, node] as [Component, SnapshotNode]].concat(
		[...parts, ...children].flatMap((child, index) => pairs(child, serialized[index])),
	);
}

function countLayers(layer: Component): number {
	return layer.debugChildren.reduce((total, child) => total + countLayers(child), 1);
}

describe('treeSnapshot', () => {
	describe('document root (R13.23)', () => {
		it('carries the logical viewport and the roots, and nothing else', () => {
			const document = treeSnapshot([new Layer({ id: 'root' })], VIEWPORT);

			expect(Object.keys(document).sort()).toEqual(['roots', 'viewport']);
			expect(document.viewport).toEqual({ width: 1440, height: 882 });
			expect(document.roots).toHaveLength(1);
		});

		it('reports the viewport as width/height while every node rect is x/y/w/h', () => {
			const document = treeSnapshot([new Layer({ width: 100, height: 50 })], VIEWPORT);

			expect(Object.keys(document.viewport).sort()).toEqual(['height', 'width']);
			expect(Object.keys(document.roots[0].bounds).sort()).toEqual(['h', 'w', 'x', 'y']);
			expect(Object.keys(document.roots[0].screenBounds).sort()).toEqual(['h', 'w', 'x', 'y']);
		});

		it('serializes every supplied root, so an overlay sits beside the screen', () => {
			const screen = new Layer({ id: 'mainMenuScreen' });
			const overlay = new Layer({ id: 'developer_overlay' });

			const document = treeSnapshot([screen, overlay], VIEWPORT);

			expect(document.roots.map((root) => root.id)).toEqual(['mainMenuScreen', 'developer_overlay']);
		});
	});

	describe('ids (R13.22)', () => {
		it('is null, not absent, when the layer was never given one', () => {
			const node = treeSnapshot([new Layer()], VIEWPORT).roots[0];

			expect('id' in node).toBe(true);
			expect(node.id).toBeNull();
		});

		it('carries the assigned id', () => {
			expect(treeSnapshot([new Layer({ id: 'end_turn_button' })], VIEWPORT).roots[0].id).toBe('end_turn_button');
		});
	});

	describe('geometry', () => {
		it('reports bounds parent-relative and screenBounds viewport-absolute', () => {
			const root = new Layer({ id: 'root', width: 1440, height: 882 });
			const bar = new Layer({ id: 'bar', x: 100, y: 40, width: 400, height: 60 });
			const label = new Layer({ id: 'label', x: 8, y: 12, width: 80, height: 20 });

			bar.addChild(label);
			root.addChild(bar);

			const labelNode = findById(treeSnapshot([root], VIEWPORT).roots[0], 'label');

			expect(labelNode?.bounds).toEqual({ x: 8, y: 12, w: 80, h: 20 });
			expect(labelNode?.screenBounds).toEqual({ x: 108, y: 52, w: 80, h: 20 });
			expect(labelNode?.bounds).not.toEqual(labelNode?.screenBounds);
		});

		it('accumulates through three levels the way Layer.render does', () => {
			const a = new Layer({ id: 'a', x: 5, y: 7 });
			const b = new Layer({ id: 'b', x: 5, y: 7 });
			const c = new Layer({ id: 'c', x: 5, y: 7, width: 1, height: 1 });

			b.addChild(c);
			a.addChild(b);

			expect(findById(treeSnapshot([a], VIEWPORT).roots[0], 'c')?.screenBounds).toEqual({
				x: 15,
				y: 21,
				w: 1,
				h: 1,
			});
		});
	});

	describe('the omission rule (R13.22)', () => {
		it('leaves out every field nothing in the engine backs yet', () => {
			const node = treeSnapshot([new Layer({ id: 'plain', width: 10, height: 10 })], VIEWPORT).roots[0];

			for (const absent of ['transform', 'text', 'value', 'style', 'clip', 'contentOffset']) {
				expect(absent in node).toBe(false);
			}
		});

		// DDB-208: the lint's rules 6 and 7 read these three to find the
		// controls, so they are on every node, false included.
		it('reports focusable, pointerEvents and handlesPointer on every node', () => {
			const node = treeSnapshot([new Layer({ id: 'plain', width: 10, height: 10 })], VIEWPORT).roots[0];

			expect(node.focusable).toBe(false);
			expect(node.pointerEvents).toBe('passthrough');
			expect(node.handlesPointer).toBe(false);
		});

		it('tells a label that takes hits from a control that answers them', () => {
			const label = new Text('Deck', { width: 40, height: 12 });
			const swatch = new Rectangle({ width: 10, height: 10 });
			swatch.onClick = () => undefined;
			const button = new Button('Go', { width: 80, height: 32 });

			const [labelNode, swatchNode, buttonNode] = treeSnapshot([label, swatch, button], VIEWPORT).roots;

			expect(labelNode).toMatchObject({ pointerEvents: 'auto', handlesPointer: false, focusable: false });
			expect(swatchNode).toMatchObject({ pointerEvents: 'auto', handlesPointer: true, focusable: false });
			expect(buttonNode).toMatchObject({ pointerEvents: 'unit', handlesPointer: true, focusable: true });
		});

		it('reports a component\'s own pointerEvents, not an inherited block', () => {
			const parent = new Layer({ width: 100, height: 100, pointerEvents: 'none' });
			const child = new Rectangle({ width: 10, height: 10 });
			parent.addChild(child);

			const node = treeSnapshot([parent], VIEWPORT).roots[0];

			expect(node.pointerEvents).toBe('none');
			expect(node.children[0].pointerEvents).toBe('auto');
		});

		it('reports the base-backed fields on every node, a plain Layer included', () => {
			const node = treeSnapshot([new Layer({ id: 'plain', width: 10, height: 10 })], VIEWPORT).roots[0];

			expect(node.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
			expect(node.zIndex).toBe(0);
			expect(node.layer).toBe('base');
			expect(node.enabled).toBe(true);
			expect(node.opacity).toBe(1);
			expect(node.state).toEqual({ hovered: false, pressed: false, focused: false, focusVisible: false, selected: false, open: false, active: false, dropActive: false });
			expect(node.inkBounds).toEqual(node.screenBounds);
		});

		it('reports enabled on its own and every other R11.11 flag in state', () => {
			const rectangle = new Rectangle({ id: 'swatch', width: 10, height: 10 });
			rectangle.setEnabled(false);

			const node = treeSnapshot([rectangle], VIEWPORT).roots[0];

			expect(node.enabled).toBe(false);
			expect(node.state).toEqual({ hovered: false, pressed: false, focused: false, focusVisible: false, selected: false, open: false, active: false, dropActive: false });
			expect('enabled' in (node.state ?? {})).toBe(false);
		});

		it('reports value on a TextInput only, masked for a password', () => {
			const input = new TextInput({ placeholder: 'type here', id: 'name_field', width: 120, height: 30 });
			const password = new TextInput({ value: 'hunter2', password: true, width: 120, height: 30 });

			const inputNode = treeSnapshot([input], VIEWPORT).roots[0];
			const textNode = treeSnapshot([new Text('hello', { width: 40, height: 12 })], VIEWPORT).roots[0];

			// An empty controlled value is a real value, so the key is present.
			expect('value' in inputNode).toBe(true);
			expect(inputNode.value).toBe('');
			expect('value' in textNode).toBe(false);
			expect(treeSnapshot([password], VIEWPORT).roots[0].value).toBe('\u2022'.repeat(7));
			expect(inputNode.placeholder).toBe('type here');
			expect('placeholder' in treeSnapshot([password], VIEWPORT).roots[0]).toBe(false);
		});
	});

	describe('clip derived from overflow (R7.1)', () => {
		it('applies a clipping layer to its children, not to itself', () => {
			const clipper = new Layer({ id: 'clipper', x: 20, y: 30, width: 200, height: 100, overflow: 'hidden' });
			const child = new Layer({ id: 'child', x: 5, y: 5, width: 10, height: 10 });
			clipper.addChild(child);

			const root = treeSnapshot([clipper], VIEWPORT).roots[0];

			expect('clip' in root).toBe(false);
			expect(findById(root, 'child')?.clip).toEqual({ x: 20, y: 30, w: 200, h: 100 });
		});

		it('intersects nested clips in logical space', () => {
			const outer = new Layer({ id: 'outer', x: 0, y: 0, width: 100, height: 100, overflow: 'hidden' });
			const inner = new Layer({ id: 'inner', x: 50, y: 50, width: 100, height: 100, overflow: 'hidden' });
			const leaf = new Layer({ id: 'leaf', width: 5, height: 5 });

			inner.addChild(leaf);
			outer.addChild(inner);

			expect(findById(treeSnapshot([outer], VIEWPORT).roots[0], 'leaf')?.clip).toEqual({
				x: 50,
				y: 50,
				w: 50,
				h: 50,
			});
		});

		it('reports the clip snapped to the device grid at the viewport ratio, as pushClip snaps it (R7.8a)', () => {
			const clipper = new Layer({ id: 'clipper', x: 10.3, y: 5.1, width: 20.3, height: 20, overflow: 'hidden' });
			clipper.addChild(new Layer({ id: 'child', width: 5, height: 5 }));

			const atOne = findById(treeSnapshot([clipper], VIEWPORT).roots[0], 'child')?.clip;
			expect(atOne).toEqual({ x: 10, y: 5, w: 21, h: 20 });
			const atTwo = findById(treeSnapshot([clipper], { ...VIEWPORT, ratio: 2 }).roots[0], 'child')?.clip;
			expect(atTwo).toEqual({ x: 10.5, y: 5, w: 20, h: 20 });
		});

		it('ignores overflow on a zero-sized layer, matching Layer.render', () => {
			const layer = new Layer({ id: 'sized', width: 10, height: 10, overflow: 'hidden' });
			layer.setSize(0, 0);
			const child = new Layer({ id: 'kid' });
			layer.addChild(child);

			expect('clip' in (findById(treeSnapshot([layer], VIEWPORT).roots[0], 'kid') ?? {})).toBe(false);
		});
	});

	describe('Panel', () => {
		it('reports exactly the children the caller added, with no background or content layer (R8.6)', () => {
			const panel = new Panel({ id: 'showcase_scroll', x: 0, y: 0, width: 300, height: 200 });
			const card = new Layer({ id: 'showcase_card_1', x: 10, y: 10, width: 50, height: 70 });
			panel.addChild(card);

			const node = treeSnapshot([panel], VIEWPORT).roots[0];

			expect('parts' in node).toBe(false);
			expect(node.children.map((child) => child.id)).toEqual(['showcase_card_1']);
			expect(panel.getChildren()).toEqual([card]);
		});

		it('subtracts the scroll from screenBounds but never from bounds', () => {
			const panel = new ScrollContainer({ id: 'scroller', x: 10, y: 20, width: 100, height: 50, contentHeight: 500 });
			panel.scrollBy(30);

			const row = new Layer({ id: 'row', x: 5, y: 100, width: 20, height: 10 });
			panel.addChild(row);

			const node = treeSnapshot([panel], VIEWPORT).roots[0];
			const rowNode = findById(node, 'row');

			expect(node.contentOffset).toEqual({ x: 0, y: 30 });
			expect(rowNode?.bounds).toEqual({ x: 5, y: 100, w: 20, h: 10 });
			expect(rowNode?.screenBounds).toEqual({ x: 15, y: 90, w: 20, h: 10 });
			// The component's own accessor agrees with the walk.
			expect(row.localToScreen({ x: 0, y: 0 }).y).toBe(90);
		});

		it('clips its children but not itself, matching the render walk', () => {
			const panel = new ScrollContainer({ id: 'scroller', x: 10, y: 20, width: 100, height: 50 });
			panel.addChild(new Layer({ id: 'row', width: 20, height: 10 }));

			const node = treeSnapshot([panel], VIEWPORT).roots[0];

			expect('clip' in node).toBe(false);
			expect(node.children[0].clip).toEqual({ x: 10, y: 20, w: 100, h: 50 });
		});

		it('omits contentOffset on a panel, which does not scroll', () => {
			const panel = new Panel({ id: 'static', width: 100, height: 50 });

			expect('contentOffset' in treeSnapshot([panel], VIEWPORT).roots[0]).toBe(false);
		});

		it('places a padded panel\'s children inside the inset, and clips inside the border and radius', () => {
			const panel = new Panel({ id: 'padded', x: 20, y: 30, width: 200, height: 100, layout: 'free', overflow: 'hidden', style: { padding: 10, borderRadius: 5 } });
			panel.addChild(new Layer({ id: 'row', width: 50, height: 10 }));
			panel.layoutSubtree();

			const node = treeSnapshot([panel], VIEWPORT).roots[0];
			const row = findById(node, 'row');

			// The inset is layout's anchor placement now, not a content offset.
			expect('contentOffset' in node).toBe(false);
			expect(row?.screenBounds).toEqual({ x: 30, y: 40, w: 50, h: 10 });
			// The 5 px radius is the larger inset.
			expect(row?.clip).toEqual({ x: 25, y: 35, w: 190, h: 90 });
		});
	});

	// DDB-208 review: the lint's scroll exemptions key on `scroll`, which only
	// a real scroller emits. A padded panel must not read as one.
	describe('scroll signal, through to the lint', () => {
		const hiddenButton = (panel: Panel) => {
			const clipper = new Layer({ id: 'clipper', width: 200, height: 100, overflow: 'hidden' });
			clipper.addChild(new Button('Hidden', { id: 'hidden', x: 20, y: 300, width: 100, height: 32 }));
			panel.addChild(clipper);
			return layoutLint(treeSnapshot([panel], VIEWPORT));
		};

		it('emits scroll on a ScrollContainer only', () => {
			const scroller = new ScrollContainer({ width: 200, height: 100, contentHeight: 500 });
			scroller.scrollBy(40);
			const padded = new Panel({ width: 200, height: 100, style: { padding: 12 } });

			const [scrollerNode, paddedNode] = treeSnapshot([scroller, padded], VIEWPORT).roots;

			expect(scrollerNode.scroll).toEqual({ x: 0, y: 40, maxX: 0, maxY: 400 });
			expect('scroll' in paddedNode).toBe(false);
			expect('contentOffset' in paddedNode).toBe(false);
		});

		it('reports a button a non-scrolling clip hides inside a padded panel', () => {
			const result = hiddenButton(new Panel({ id: 'padded', width: 400, height: 400, layout: 'free', style: { padding: 12 } }));

			expect(result.violations.filter((violation) => violation.rule === 'unreachable-interactive').map((violation) => violation.path))
				.toEqual(['padded/clipper/hidden']);
		});

		it('lets off a button a scroller can bring into view', () => {
			const scroller = new ScrollContainer({ id: 'list', width: 200, height: 100, contentHeight: 600 });
			const content = new Layer({ width: 200, height: 600 });
			content.addChild(new Button('Row', { id: 'row', x: 20, y: 400, width: 100, height: 32 }));
			scroller.addChild(content);

			const result = layoutLint(treeSnapshot([scroller], VIEWPORT));

			expect(result.violations.filter((violation) => violation.rule === 'unreachable-interactive')).toEqual([]);
			expect(result.rules.find((rule) => rule.rule === 'unreachable-interactive')?.exempt).toBe(1);
		});
	});

	describe("parts, a composite's own drawings (R8.1)", () => {
		it('omits parts on a node that has none, so an absent group is never read as an empty one', () => {
			const leaf = treeSnapshot([new Layer({ id: 'plain', width: 10, height: 10 })], VIEWPORT).roots[0];

			const holder = new Layer({ id: 'holder', width: 10, height: 10 });
			holder.addChild(new Layer({ id: 'kid', width: 4, height: 4 }));
			const parent = treeSnapshot([holder], VIEWPORT).roots[0];

			expect('parts' in leaf).toBe(false);
			expect('parts' in parent).toBe(false);
			expect(parent.children).toHaveLength(1);
		});

		it("leaves a Panel's children as exactly what the caller added", () => {
			const panel = new Panel({ id: 'inventory', width: 300, height: 200 });
			const first = new Layer({ id: 'inventory_slot_1', x: 10, y: 10, width: 50, height: 70 });
			const second = new Layer({ id: 'inventory_slot_2', x: 70, y: 10, width: 50, height: 70 });
			panel.addChild(first);
			panel.addChild(second);

			const node = treeSnapshot([panel], VIEWPORT).roots[0];

			// R8.6: no implicit child in any children list.
			expect(node.children.map((child) => child.id)).toEqual(
				panel.getChildren().map((child) => child.id),
			);
			expect('parts' in node).toBe(false);
		});

		it("reports a Button's label as a part and leaves it childless", () => {
			const button = new Button('End turn', { id: 'end_turn_button', width: 100, height: 40 });

			const node = treeSnapshot([button], VIEWPORT).roots[0];

			expect(node.parts?.map((part) => part.type)).toEqual(['Text']);
			expect(node.children).toEqual([]);
		});

		it('relabels nodes rather than dropping them: parts plus children still cover the live tree', () => {
			const panel = new Panel({ id: 'toolbar', width: 300, height: 200 });
			const button = new Button('Fire', { id: 'fire_button', x: 10, y: 10, width: 80, height: 30 });
			panel.addChild(button);

			const node = treeSnapshot([panel], VIEWPORT).roots[0];

			expect(countNodes(node)).toBe(countLayers(panel));
			expect(node.children.length + (node.parts?.length ?? 0)).toBe(panel.debugChildren.length);
			expect(findById(node, 'fire_button')).not.toBeNull();
		});

		it('gives a scrolled child the geometry the render walk gives it, scroll subtraction and clip included', () => {
			const panel = new ScrollContainer({ id: 'scroller', x: 10, y: 20, width: 100, height: 50, contentHeight: 500 });
			panel.scrollBy(30);
			panel.addChild(new Layer({ id: 'row', x: 5, y: 100, width: 20, height: 10 }));

			const node = treeSnapshot([panel], VIEWPORT).roots[0];
			const row = findById(node, 'row');

			expect(node.contentOffset).toEqual({ x: 0, y: 30 });
			expect('clip' in node).toBe(false);
			expect(node.screenBounds).toEqual({ x: 10, y: 20, w: 100, h: 50 });
			expect(row?.clip).toEqual({ x: 10, y: 20, w: 100, h: 50 });
			// Bounds are parent-relative and know nothing about scroll.
			expect(row?.bounds).toEqual({ x: 5, y: 100, w: 20, h: 10 });
			expect(row?.screenBounds).toEqual({ x: 15, y: 90, w: 20, h: 10 });
		});
	});

	describe('visibility', () => {
		it('reports an invisible subtree rather than dropping it, so the lint can skip it', () => {
			const root = new Layer({ id: 'root', width: 100, height: 100 });
			const hidden = new Layer({ id: 'hidden', x: 10, y: 10, width: 20, height: 20 });
			const inside = new Layer({ id: 'inside', x: 1, y: 1, width: 5, height: 5 });

			hidden.setVisible(false);
			hidden.addChild(inside);
			root.addChild(hidden);

			const node = findById(treeSnapshot([root], VIEWPORT).roots[0], 'hidden');

			expect(node?.visible).toBe(false);
			expect(findById(node as SnapshotNode, 'inside')?.screenBounds).toEqual({ x: 11, y: 11, w: 5, h: 5 });
		});
	});

	describe('never throws on bad input (R13.24)', () => {
		it('survives a cycle in the child graph', () => {
			const a = new Layer({ id: 'a', width: 10, height: 10 });
			const b = new Layer({ id: 'b', width: 10, height: 10 });
			a.addChild(b);
			// addChild refuses a loop, so only a direct push can make one.
			b.getChildren().push(a);

			const root = treeSnapshot([a], VIEWPORT).roots[0];

			expect(root.children[0].id).toBe('b');
			expect(root.children[0].children[0].id).toBe('a');
			expect(root.children[0].children[0].children).toEqual([]);
		});

		it('emits a node reachable by two paths once more as a stub instead of re-expanding it', () => {
			// addChild re-parents, but a caller writing to getChildren()
			// directly can put one instance in two children arrays. The ancestor set is
			// per-path and would let this diamond expand to 2 ** 19 - 1 nodes.
			const depth = 18;
			const root = new Layer({ id: 'root', width: 10, height: 10 });
			let parents: Layer[] = [root];

			for (let level = 0; level < depth; level++) {
				const pair = [
					new Layer({ id: `left_${level}`, width: 10, height: 10 }),
					new Layer({ id: `right_${level}`, width: 10, height: 10 }),
				];
				// Pushed into the raw arrays: addChild re-parents, so a diamond
				// can only come from a caller writing to getChildren() directly.
				for (const parent of parents) {
					parent.getChildren().push(pair[0], pair[1]);
				}
				parents = pair;
			}

			const node = treeSnapshot([root], VIEWPORT).roots[0];

			expect(countNodes(node)).toBeLessThan(4 * depth + 16);
			// Every distinct layer still appears, so nothing is dropped.
			expect(findById(node, `left_${depth - 1}`)).not.toBeNull();
			// The second path to a node reports it, childless.
			expect(node.children[0].children[0].id).toBe('left_1');
			expect(node.children[1].children[0].id).toBe('left_1');
			expect(node.children[1].children[0].children).toEqual([]);
		});

		it('reports a node shared between two roots once, then as a stub', () => {
			const shared = new Layer({ id: 'shared', width: 4, height: 4 });
			shared.addChild(new Layer({ id: 'shared_child' }));
			const first = new Layer({ id: 'first', width: 10, height: 10 });
			const second = new Layer({ id: 'second', width: 10, height: 10 });
			first.addChild(shared);
			second.getChildren().push(shared);

			const roots = treeSnapshot([first, second], VIEWPORT).roots;

			expect(roots[0].children[0].children[0].id).toBe('shared_child');
			expect(roots[1].children[0].id).toBe('shared');
			expect(roots[1].children[0].children).toEqual([]);
		});

		it('reports a degraded node as visible and keeps what it had already computed', () => {
			// R13.27 lets the lint skip an invisible subtree whole, so a node
			// the serializer knows is broken must not hide itself.
			class HalfSerializable extends Layer {
				public get debugChildren(): readonly Layer[] {
					const children = [new Layer({ id: 'kept_child', width: 4, height: 4 })];
					Object.defineProperty(children, 1, {
						enumerable: true,
						configurable: true,
						get(): Layer {
							throw new Error('child list went bad');
						},
					});
					return children;
				}
			}

			const broken = new HalfSerializable({ id: 'broken', x: 2, y: 3, width: 8, height: 9 });
			broken.setVisible(false);
			const root = new Layer({ id: 'root', width: 20, height: 20 });
			root.addChild(broken);

			const node = treeSnapshot([root], VIEWPORT).roots[0].children[0];

			expect(node.type).toBe('Unserializable');
			expect(node.visible).toBe(true);
			expect(node.id).toBe('broken');
			expect(node.bounds).toEqual({ x: 2, y: 3, w: 8, h: 9 });
			expect(node.screenBounds).toEqual({ x: 2, y: 3, w: 8, h: 9 });
			expect(node.children.map((child) => child.id)).toEqual(['kept_child']);
		});

		it('reports a non-string id as null', () => {
			const layer = new Layer({ id: 42 as unknown as string });

			expect(treeSnapshot([layer], VIEWPORT).roots[0].id).toBeNull();
		});

		it('replaces an unpaired surrogate in an id instead of failing', () => {
			const layer = new Layer({ id: `card_${String.fromCharCode(0xd800)}_1` });

			const id = treeSnapshot([layer], VIEWPORT).roots[0].id as string;

			expect(id).toBe(`card_${String.fromCharCode(0xfffd)}_1`);
			expect(JSON.parse(JSON.stringify({ id })).id).toBe(id);
		});

		it('keeps a well-formed surrogate pair intact', () => {
			const layer = new Layer({ id: 'card_\u{1F697}' });

			expect(treeSnapshot([layer], VIEWPORT).roots[0].id).toBe('card_\u{1F697}');
		});

		it('reports non-finite coordinates as zero so they survive JSON', () => {
			const layer = new Layer({ id: 'broken' });
			layer.x = NaN;
			layer.y = Infinity;
			layer.width = NaN;
			layer.height = 20;

			const node = treeSnapshot([layer], VIEWPORT).roots[0];

			expect(node.bounds).toEqual({ x: 0, y: 0, w: 0, h: 20 });
			expect(node.screenBounds).toEqual({ x: 0, y: 0, w: 0, h: 20 });
		});

		it('skips holes left in a children array by an unmounted child', () => {
			const root = new Layer({ id: 'root', width: 10, height: 10 });
			const kept = new Layer({ id: 'kept', width: 10, height: 10 });
			root.addChild(kept);
			root.getChildren().push(null as unknown as Layer);

			expect(treeSnapshot([root], VIEWPORT).roots[0].children.map((child) => child.id)).toEqual(['kept']);
		});

		it('still serializes a detached child that was unmounted in place', () => {
			const root = new Layer({ id: 'root', width: 10, height: 10 });
			const orphan = new Rectangle({ id: 'orphan', x: 2, y: 3, width: 4, height: 5 });
			root.addChild(orphan);
			orphan.unmount();

			expect(findById(treeSnapshot([root], VIEWPORT).roots[0], 'orphan')?.screenBounds).toEqual({
				x: 2,
				y: 3,
				w: 4,
				h: 5,
			});
		});

		it('degrades one bad node instead of failing the whole document', () => {
			class Exploding extends Layer {
				public getComponentType(): string {
					throw new Error('no type for you');
				}
			}

			const root = new Layer({ id: 'root', width: 10, height: 10 });
			root.addChild(new Exploding());
			root.addChild(new Layer({ id: 'sibling' }));

			const node = treeSnapshot([root], VIEWPORT).roots[0];

			expect(node.children[0].type).toBe('Unserializable');
			expect(node.children[1].id).toBe('sibling');
		});

		it('tolerates a missing roots array and a missing viewport', () => {
			const document = treeSnapshot(
				undefined as unknown as Layer[],
				undefined as unknown as { width: number; height: number },
			);

			expect(document).toEqual({ viewport: { width: 0, height: 0 }, roots: [] });
		});

		it('round-trips a mixed tree through JSON.stringify', () => {
			const panel = new ScrollContainer({ id: 'dev_scroll', width: 300, height: 200, contentHeight: 900 });
			panel.scrollBy(40);
			panel.addChild(new Text('Developer Tools', { id: 'dev_title', width: 200, height: 24 }));
			panel.addChild(new TextInput({ placeholder: 'search', id: 'dev_filter', width: 120, height: 30 }));

			const document = treeSnapshot([panel], VIEWPORT);
			const serialized = JSON.stringify(document);

			expect(JSON.parse(serialized)).toEqual(document);
			expect(serialized).not.toContain('NaN');
		});
	});

	describe('Text sizing (R12.4, R13.21)', () => {
		it('reports zero-sized text until it is mounted where it can measure', () => {
			const text = new Text('End turn');

			expect(treeSnapshot([text], VIEWPORT).roots[0].bounds).toEqual({ x: 0, y: 0, w: 0, h: 0 });

			text.mount(createTestContext({ draw: createMeasuringDrawApi().api }));
			const bounds = treeSnapshot([text], VIEWPORT).roots[0].bounds;
			expect(bounds.w).toBeGreaterThan(0);
			expect(bounds.h).toBeGreaterThan(0);
		});
	});

	describe('margin and transform (R8.10, R8.13, R8.26)', () => {
		it('reports bounds as the margin box and screenBounds as the content box', () => {
			const root = new Layer({ id: 'root', x: 5, y: 5, width: 400, height: 400 });
			const boxed = new Layer({
				id: 'boxed',
				x: 10,
				y: 20,
				width: 100,
				height: 50,
				margin: { top: 4, right: 6, bottom: 8, left: 2 },
			});
			root.addChild(boxed);

			const node = findById(treeSnapshot([root], VIEWPORT).roots[0], 'boxed');

			expect(node?.margin).toEqual({ top: 4, right: 6, bottom: 8, left: 2 });
			expect(node?.bounds).toEqual({ x: 10, y: 20, w: 108, h: 62 });
			expect(node?.screenBounds).toEqual({ x: 17, y: 29, w: 100, h: 50 });
		});

		it('reports a non-identity transform and the axis-aligned bounds it puts on screen', () => {
			const card = new Layer({ id: 'card', x: 100, y: 100, width: 100, height: 50, transform: { rotate: Math.PI / 2 } });

			const node = treeSnapshot([card], VIEWPORT).roots[0];

			expect(node.transform).toEqual({ rotate: Math.PI / 2, scale: 1, translate: [0, 0], origin: [0.5, 0.5] });
			// A quarter turn about its centre, (150, 125).
			expect(node.screenBounds.x).toBeCloseTo(125);
			expect(node.screenBounds.y).toBeCloseTo(75);
			expect(node.screenBounds.w).toBeCloseTo(50);
			expect(node.screenBounds.h).toBeCloseTo(100);
			// Layout ignores the transform (R8.26), and so does bounds.
			expect(node.bounds).toEqual({ x: 100, y: 100, w: 100, h: 50 });
		});

		it("agrees with every component's own screenBounds through margins, transforms, scroll and parts", () => {
			const root = new Layer({ id: 'root', width: 1440, height: 882 });
			const tilted = new Layer({
				id: 'tilted',
				x: 40,
				y: 60,
				width: 300,
				height: 200,
				margin: 7,
				transform: { rotate: 0.3, scale: 1.5 },
			});
			const scroller = new ScrollContainer({ id: 'scroller', x: 20, y: 10, width: 200, height: 100, contentHeight: 400 });
			scroller.scrollBy(25);
			scroller.addChild(new Button('Fire', { id: 'fire', x: 10, y: 60, width: 80, height: 30, margin: { left: 3 } }));
			tilted.addChild(scroller);
			root.addChild(tilted);

			const document = treeSnapshot([root], VIEWPORT);
			const all = pairs(root, document.roots[0]);

			expect(all).toHaveLength(countLayers(root));
			for (const [component, node] of all) {
				const expected = rectOf(component.screenBounds);
				expect(node.screenBounds.x).toBeCloseTo(expected.x, 9);
				expect(node.screenBounds.y).toBeCloseTo(expected.y, 9);
				expect(node.screenBounds.w).toBeCloseTo(expected.w, 9);
				expect(node.screenBounds.h).toBeCloseTo(expected.h, 9);
			}
		});

		it('clips children to the transformed box, as the draw API pushes it (R4.7)', () => {
			const scaled = new Layer({
				id: 'scaled',
				x: 10,
				y: 10,
				width: 50,
				height: 20,
				overflow: 'hidden',
				transform: { scale: 2, origin: [0, 0] },
			});
			scaled.addChild(new Layer({ id: 'inside', width: 5, height: 5 }));

			expect(findById(treeSnapshot([scaled], VIEWPORT).roots[0], 'inside')?.clip).toEqual({ x: 10, y: 10, w: 100, h: 40 });
		});
	});

	describe('stacking: zIndex and the effective layer (R3.6, R3.8, R3.12)', () => {
		it("reports own zIndex and the effective layer, which never drops below the parent's", () => {
			const root = new Layer({ id: 'root', width: 100, height: 100 });
			const raised = new Layer({ id: 'raised', zIndex: 2, layer: 'overlay', width: 50, height: 50 });
			const lower = new Layer({ id: 'lower', layer: 'raised', width: 10, height: 10 });
			raised.addChild(lower);
			root.addChild(raised);

			const node = treeSnapshot([root], VIEWPORT).roots[0];

			expect(findById(node, 'raised')).toMatchObject({ zIndex: 2, layer: 'overlay' });
			expect(findById(node, 'lower')).toMatchObject({ zIndex: 0, layer: 'overlay' });
		});

		it('resets the inherited clip at a promotion, for the promoted node and its subtree', () => {
			const clipper = new Layer({ id: 'clipper', width: 100, height: 100, overflow: 'hidden' });
			const popup = new Layer({ id: 'popup', layer: 'popup', x: 80, y: 80, width: 60, height: 60 });
			const row = new Layer({ id: 'row', width: 10, height: 10 });
			const sibling = new Layer({ id: 'sibling', width: 10, height: 10 });
			popup.addChild(row);
			clipper.addChild(popup);
			clipper.addChild(sibling);

			const node = treeSnapshot([clipper], VIEWPORT).roots[0];

			expect('clip' in (findById(node, 'popup') ?? {})).toBe(false);
			expect('clip' in (findById(node, 'row') ?? {})).toBe(false);
			expect(findById(node, 'sibling')?.clip).toEqual({ x: 0, y: 0, w: 100, h: 100 });
		});

		it('gives R13.25.1 what it needs: siblings on differing zIndex or layer are exempt, equal ones are not', () => {
			type Stacking = { zIndex?: number; layer?: 'base' | 'overlay' };
			const lint = (a: Stacking, b: Stacking) => {
				const root = new Layer({ id: 'root', width: 400, height: 400 });
				root.addChild(new Layer({ id: 'a', width: 100, height: 100, ...a }));
				root.addChild(new Layer({ id: 'b', x: 50, y: 50, width: 100, height: 100, ...b }));
				return layoutLint(treeSnapshot([root], VIEWPORT));
			};
			const overlaps = (result: ReturnType<typeof layoutLint>) =>
				result.violations.filter((violation) => violation.rule === 'sibling-overlap');

			expect(overlaps(lint({}, {}))).toHaveLength(1);
			expect(overlaps(lint({ zIndex: 1 }, {}))).toHaveLength(0);
			expect(overlaps(lint({ layer: 'overlay' }, {}))).toHaveLength(0);
			expect(lint({ layer: 'overlay' }, {}).rules.find((rule) => rule.rule === 'sibling-overlap')?.exempt).toBe(1);
		});
	});

	describe('opacity (R3.25)', () => {
		it('reports the product down the tree', () => {
			const outer = new Layer({ id: 'outer', opacity: 0.5, width: 10, height: 10 });
			outer.addChild(new Layer({ id: 'inner', opacity: 0.5, width: 5, height: 5 }));

			const node = treeSnapshot([outer], VIEWPORT).roots[0];

			expect(node.opacity).toBe(0.5);
			expect(findById(node, 'inner')?.opacity).toBe(0.25);
		});
	});

	describe('text (R13.22, R6.14)', () => {
		it('reports content and wrap before anything has measured, and no measure or outcome', () => {
			const node = treeSnapshot([new Text('End turn')], VIEWPORT).roots[0];

			expect(node.text).toEqual({ content: 'End turn', wrap: 'none' });
		});

		it('reports the measured extent and a fitting outcome for a hugging text', () => {
			const node = treeSnapshot([measuredText('End turn')], VIEWPORT).roots[0];

			expect(node.text?.content).toBe('End turn');
			expect(node.text?.measured).toEqual({ w: node.screenBounds.w, h: node.screenBounds.h, lines: 1 });
			expect(node.text?.overflow).toBe('none');
		});

		it('says what happened to a nowrap text wider than its box, by overflow mode', () => {
			const text = (textOverflow?: 'visible' | 'hidden' | 'ellipsis') => treeSnapshot(
				[measuredText('A label far too long for its box', { width: 40, height: 30, style: { whiteSpace: 'nowrap', textOverflow } })],
				VIEWPORT,
			).roots[0].text;

			expect(text()?.overflow).toBe('visible');
			expect(text()?.measured?.w).toBeGreaterThan(40);
			expect(text('hidden')?.overflow).toBe('clip');
			expect(text('ellipsis')?.overflow).toBe('ellipsis');
		});

		it('reports word wrap at an assigned width', () => {
			const node = treeSnapshot([measuredText('one two three four five six', { width: 60 })], VIEWPORT).roots[0];

			expect(node.text?.wrap).toBe('word');
			expect(node.text?.measured?.lines).toBeGreaterThan(1);
		});

		it('never measures from the reader: an unmeasurable text stays unmeasured', () => {
			const text = new Text('Pending');
			text.mount(createTestContext());

			const node = treeSnapshot([text], VIEWPORT).roots[0];

			expect(node.text).toEqual({ content: 'Pending', wrap: 'none' });
			expect(text.currentMetrics).toBeNull();
			expect(text.width).toBe(0);
		});

		it("wakes the lint's text-overflow rule, which reports only the unhandled case", () => {
			const root = new Layer({ id: 'root', width: 400, height: 400 });
			root.addChild(measuredText('A label far too long for its box', {
				id: 'spill',
				width: 40,
				height: 30,
				style: { whiteSpace: 'nowrap' },
			}));
			root.addChild(measuredText('A label far too long for its box', {
				id: 'cut',
				y: 40,
				width: 40,
				height: 30,
				style: { whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
			}));

			const result = layoutLint(treeSnapshot([root], VIEWPORT));

			expect(result.violations.filter((violation) => violation.rule === 'text-overflow').map((violation) => violation.path))
				.toEqual(['root/spill']);
			expect(result.rules.find((entry) => entry.rule === 'text-overflow')).toMatchObject({ evaluated: 1, exempt: 1, dormant: false });
		});
	});

	describe('style (R13.22)', () => {
		it("reports a rectangle's fill, and its border only when one is drawn", () => {
			const plain = treeSnapshot(
				[new Rectangle({ width: 10, height: 10, style: { backgroundColor: '#ff0000' } })],
				VIEWPORT,
			).roots[0];
			const bordered = treeSnapshot(
				[new Rectangle({ width: 10, height: 10, style: { backgroundColor: '#ff0000', border: '2px solid #00ff00' } })],
				VIEWPORT,
			).roots[0];

			expect(plain.style).toEqual({ fill: [1, 0, 0, 1] });
			expect(bordered.style).toEqual({ fill: [1, 0, 0, 1], border: [0, 1, 0, 1] });
		});

		it("reports a text's colour as text, and a button's fill, label and border together", () => {
			const text = treeSnapshot([new Text('hi', { style: { color: '#0000ff' } })], VIEWPORT).roots[0];
			const button = treeSnapshot([new Button('Go', { width: 80, height: 30 })], VIEWPORT).roots[0];

			expect(text.style).toEqual({ text: [0, 0, 1, 1] });
			expect(Object.keys(button.style ?? {}).sort()).toEqual(['border', 'fill', 'text']);
		});

		it('omits style on a component that draws nothing', () => {
			const bare = treeSnapshot([new Layer({ width: 10, height: 10 })], VIEWPORT).roots[0];
			const filled = treeSnapshot(
				[new Layer({ width: 10, height: 10 }).setBackgroundColor([0, 0, 0, 1])],
				VIEWPORT,
			).roots[0];

			expect('style' in bare).toBe(false);
			expect(filled.style).toEqual({ fill: [0, 0, 0, 1] });
		});
	});

	describe('state and ink (R11.11, R8.8)', () => {
		it('reports the flags as set, composed rather than ranked', () => {
			const component = new Button('Go', { width: 80, height: 30 });
			component.pressed = true;
			component.selected = true;
			component.setFocusState(true, true);

			const button = treeSnapshot([component], VIEWPORT).roots[0];

			expect(button.state).toMatchObject({ pressed: true, selected: true, focused: true, focusVisible: true, hovered: false, open: false });
		});

		it('grows a focus-visible button\'s inkBounds past its bounds by the ring and the nudge (R8.8)', () => {
			const component = new Button('Go', { x: 20, y: 20, width: 80, height: 30 });
			component.setFocusState(true, true);

			const node = treeSnapshot([component], VIEWPORT).roots[0];
			const extent = tokens.control.focus_ring_offset + tokens.control.focus_ring_width + tokens.control.press_offset;

			expect(node.screenBounds).toEqual({ x: 20, y: 20, w: 80, h: 30 });
			expect(node.inkBounds).toEqual({ x: 20 - extent, y: 20 - extent, w: 80 + extent * 2, h: 30 + extent * 2 });
		});

		it("grows inkBounds past screenBounds by a centred stroke's outer half", () => {
			const ring = new Circle({ x: 10, y: 10, style: { borderWidth: 4 } });
			ring.setRadius(20);

			const node = treeSnapshot([ring], VIEWPORT).roots[0];

			expect(node.screenBounds).toEqual({ x: 10, y: 10, w: 40, h: 40 });
			expect(node.inkBounds).toEqual({ x: 8, y: 8, w: 44, h: 44 });
		});

		it('grows a text\'s inkBounds over a run that overruns its box, on the side it runs to (DDB-214)', () => {
			const text = measuredText('A label far too long for its box', {
				x: 200,
				y: 20,
				width: 40,
				height: 20,
				style: { whiteSpace: 'nowrap', textAlign: 'right' },
			});
			const run = text.measured?.width ?? 0;
			expect(run).toBeGreaterThan(100);

			const right = treeSnapshot([text], VIEWPORT).roots[0].inkBounds;
			expect(right?.x).toBeLessThan(240 - run);
			expect((right?.x ?? 0) + (right?.w ?? 0)).toBeLessThan(244);

			// Alignment moves the run without resizing anything, and the bound follows it.
			text.setAlign('left');
			const left = treeSnapshot([text], VIEWPORT).roots[0].inkBounds;
			expect(left?.x).toBeGreaterThan(197);
			expect((left?.x ?? 0) + (left?.w ?? 0)).toBeGreaterThan(200 + run);
		});
	});
});
