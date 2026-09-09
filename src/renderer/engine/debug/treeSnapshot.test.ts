import { Layer } from '../components/Layer';
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import { Panel } from '../ui/Panel';
import { Input } from '../ui/Input';
import { SnapshotNode, treeSnapshot } from './treeSnapshot';

const VIEWPORT = { width: 1440, height: 882 };

function findById(node: SnapshotNode, id: string): SnapshotNode | null {
	if (node.id === id) return node;
	for (const child of node.children) {
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}

function countNodes(node: SnapshotNode): number {
	return node.children.reduce((total, child) => total + countNodes(child), 1);
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
		it('leaves out every field the engine cannot back', () => {
			const node = treeSnapshot([new Layer({ id: 'plain', width: 10, height: 10 })], VIEWPORT).roots[0];

			for (const absent of [
				'margin',
				'zIndex',
				'layer',
				'opacity',
				'transform',
				'focusable',
				'inkBounds',
				'style',
				'text',
			]) {
				expect(absent in node).toBe(false);
			}
		});

		it('omits clip, contentOffset, enabled, state and value on a plain Layer', () => {
			const node = treeSnapshot([new Layer({ width: 10, height: 10 })], VIEWPORT).roots[0];

			expect('clip' in node).toBe(false);
			expect('contentOffset' in node).toBe(false);
			expect('enabled' in node).toBe(false);
			expect('state' in node).toBe(false);
			expect('value' in node).toBe(false);
		});

		it('reports enabled and only the two derivable state flags on a Component', () => {
			const rectangle = new Rectangle({ id: 'swatch', width: 10, height: 10 });
			rectangle.setEnabled(false);

			const node = treeSnapshot([rectangle], VIEWPORT).roots[0];

			expect(node.enabled).toBe(false);
			expect(node.state).toEqual({ hovered: false, focused: false });
			for (const absent of ['pressed', 'focusVisible', 'selected', 'open', 'active', 'dropActive']) {
				expect(absent in (node.state ?? {})).toBe(false);
			}
		});

		it('reports value on an Input only', () => {
			const input = new Input('type here', { id: 'name_field', width: 120, height: 30 });

			const inputNode = treeSnapshot([input], VIEWPORT).roots[0];
			const textNode = treeSnapshot([new Text('hello', { width: 40, height: 12 })], VIEWPORT).roots[0];

			// An empty controlled value is a real value, so the key is present.
			expect('value' in inputNode).toBe(true);
			expect(inputNode.value).toBe('');
			expect('value' in textNode).toBe(false);
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

		it('ignores overflow on a zero-sized layer, matching Layer.render', () => {
			const layer = new Layer({ id: 'sized', width: 10, height: 10, overflow: 'hidden' });
			layer.setSize(0, 0);
			const child = new Layer({ id: 'kid' });
			layer.addChild(child);

			expect('clip' in (findById(treeSnapshot([layer], VIEWPORT).roots[0], 'kid') ?? {})).toBe(false);
		});
	});

	describe('the Panel structure trap', () => {
		it('reports the background and the content layer, not the content children one level up', () => {
			const panel = new Panel({ id: 'showcase_scroll', x: 0, y: 0, width: 300, height: 200 });
			const card = new Layer({ id: 'showcase_card_1', x: 10, y: 10, width: 50, height: 70 });
			panel.addChild(card);

			const node = treeSnapshot([panel], VIEWPORT).roots[0];

			expect(node.children).toHaveLength(2);
			expect(node.children[0].type).toBe('Rectangle');
			expect(node.children[1].type).toBe('Layer');
			expect(node.children[1].children.map((child) => child.id)).toEqual(['showcase_card_1']);
			// getChildren() would have put the card directly under the panel.
			expect(panel.getChildren()).toEqual([card]);
		});

		it('subtracts panel scroll from screenBounds but never from bounds', () => {
			const panel = new Panel({
				id: 'scroller',
				x: 10,
				y: 20,
				width: 100,
				height: 50,
				scrollable: true,
				scrollDirection: 'vertical',
			});
			panel.setContentSize(100, 500);
			panel.scroll(0, 30);

			const row = new Layer({ id: 'row', x: 5, y: 100, width: 20, height: 10 });
			panel.addChild(row);

			const node = treeSnapshot([panel], VIEWPORT).roots[0];
			const rowNode = findById(node, 'row');

			expect(node.contentOffset).toEqual({ x: 0, y: 30 });
			expect(rowNode?.bounds).toEqual({ x: 5, y: 100, w: 20, h: 10 });
			expect(rowNode?.screenBounds).toEqual({ x: 15, y: 90, w: 20, h: 10 });
			// localToGlobal does not know about scroll and would answer 120.
			expect(row.localToGlobal(0, 0).y).toBe(120);
		});

		it('clips the content layer but not the background, matching Panel.render', () => {
			const panel = new Panel({
				id: 'scroller',
				x: 10,
				y: 20,
				width: 100,
				height: 50,
				scrollable: true,
			});

			const node = treeSnapshot([panel], VIEWPORT).roots[0];

			expect('clip' in node.children[0]).toBe(false);
			expect(node.children[1].clip).toEqual({ x: 10, y: 20, w: 100, h: 50 });
		});

		it('omits contentOffset on a non-scrollable panel', () => {
			const panel = new Panel({ id: 'static', width: 100, height: 50 });

			expect('contentOffset' in treeSnapshot([panel], VIEWPORT).roots[0]).toBe(false);
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
			b.addChild(a);

			const root = treeSnapshot([a], VIEWPORT).roots[0];

			expect(root.children[0].id).toBe('b');
			expect(root.children[0].children[0].id).toBe('a');
			expect(root.children[0].children[0].children).toEqual([]);
		});

		it('emits a node reachable by two paths once more as a stub instead of re-expanding it', () => {
			// Layer.addChild never detaches from a previous parent, so one
			// instance can sit in two children arrays. The ancestor set is
			// per-path and would let this diamond expand to 2 ** 19 - 1 nodes.
			const depth = 18;
			const root = new Layer({ id: 'root', width: 10, height: 10 });
			let parents: Layer[] = [root];

			for (let level = 0; level < depth; level++) {
				const pair = [
					new Layer({ id: `left_${level}`, width: 10, height: 10 }),
					new Layer({ id: `right_${level}`, width: 10, height: 10 }),
				];
				for (const parent of parents) {
					parent.addChild(pair[0]);
					parent.addChild(pair[1]);
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
			second.addChild(shared);

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
			const panel = new Panel({ id: 'dev_scroll', width: 300, height: 200, scrollable: true });
			panel.setContentSize(300, 900);
			panel.scroll(0, 40);
			panel.addChild(new Text('Developer Tools', { id: 'dev_title', width: 200, height: 24 }));
			panel.addChild(new Input('search', { id: 'dev_filter', width: 120, height: 30 }));

			const document = treeSnapshot([panel], VIEWPORT);
			const serialized = JSON.stringify(document);

			expect(JSON.parse(serialized)).toEqual(document);
			expect(serialized).not.toContain('NaN');
		});
	});

	describe('Text sizing after render (R13.21)', () => {
		it('reports zero-sized text until layout runs, which is why a rendered frame is not enough', () => {
			const text = new Text('End turn');

			expect(treeSnapshot([text], VIEWPORT).roots[0].bounds).toEqual({ x: 0, y: 0, w: 0, h: 0 });

			text.layout();

			expect(treeSnapshot([text], VIEWPORT).roots[0].bounds.w).toBeGreaterThan(0);
		});
	});
});
