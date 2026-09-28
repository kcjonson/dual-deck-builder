import {
	EPSILON,
	LintDocument,
	LintEdges,
	LintNode,
	LintRect,
	LintResult,
	LintRuleName,
	layoutLint,
	ZERO_SIZE_BUCKETS,
} from './layoutLint';

const VIEWPORT = { width: 2000, height: 2000 };

function box(x: number, y: number, w: number, h: number): LintRect {
	return { x, y, w, h };
}

/**
 * Hand-built nodes only: no GL, no DOM, no engine class (R13.4). `bounds` and
 * `screenBounds` default to the same rect, which is what a root-relative tree
 * looks like, and either can be overridden on its own.
 */
function node(overrides: Partial<LintNode> = {}): LintNode {
	const rect = overrides.screenBounds ?? overrides.bounds ?? box(0, 0, 10, 10);
	return {
		id: null,
		type: 'Rectangle',
		bounds: rect,
		screenBounds: rect,
		visible: true,
		children: [],
		...overrides,
	};
}

function doc(roots: LintNode[], viewport = VIEWPORT): LintDocument {
	return { viewport, roots };
}

function forRule(result: LintResult, rule: LintRuleName) {
	return result.violations.filter((violation) => violation.rule === rule);
}

function reportFor(result: LintResult, rule: LintRuleName) {
	const found = result.rules.find((entry) => entry.rule === rule);
	if (!found) throw new Error(`no report for ${rule}`);
	return found;
}

describe('layoutLint', () => {
	describe('rule 1: sibling-overlap (R13.25.1)', () => {
		it('reports two visible siblings that intersect on both axes', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						children: [node({ id: 'a', bounds: box(0, 0, 100, 100) }), node({ id: 'b', bounds: box(50, 50, 100, 100) })],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toEqual([
				{ rule: 'sibling-overlap', path: 'root/a', bounds: box(0, 0, 100, 100), otherPath: 'root/b', otherBounds: box(50, 50, 100, 100) },
			]);
		});

		it('does not report siblings that are merely adjacent', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						children: [node({ id: 'a', bounds: box(0, 0, 100, 100) }), node({ id: 'b', bounds: box(200, 0, 100, 100) })],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toHaveLength(0);
			expect(reportFor(result, 'sibling-overlap').evaluated).toBe(1);
		});

		it('treats an exact abutment at a shared edge as not overlapping', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						children: [node({ id: 'a', bounds: box(0, 0, 100, 50) }), node({ id: 'b', bounds: box(100, 0, 100, 50) })],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toHaveLength(0);
		});

		it('tolerates an overlap of exactly epsilon and reports epsilon plus a hair (R13.27)', () => {
			const at = (overlap: number) =>
				layoutLint(
					doc([
						node({
							id: 'root',
							children: [
								node({ id: 'a', bounds: box(0, 0, 100, 100) }),
								node({ id: 'b', bounds: box(100 - overlap, 100 - overlap, 100, 100) }),
							],
						}),
					]),
				);

			expect(forRule(at(EPSILON), 'sibling-overlap')).toHaveLength(0);
			expect(forRule(at(EPSILON + 0.01), 'sibling-overlap')).toHaveLength(1);
		});

		it('does not report an overlap on one axis only', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						children: [node({ id: 'a', bounds: box(0, 0, 100, 100) }), node({ id: 'b', bounds: box(50, 300, 100, 100) })],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toHaveLength(0);
		});

		it('exempts a pair with differing zIndex', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						children: [
							node({ id: 'a', bounds: box(0, 0, 100, 100), zIndex: 0 }),
							node({ id: 'b', bounds: box(50, 50, 100, 100), zIndex: 1 }),
						],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toHaveLength(0);
			expect(reportFor(result, 'sibling-overlap').exempt).toBe(1);
		});

		it('exempts a pair on differing effective layer', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						children: [
							node({ id: 'a', bounds: box(0, 0, 100, 100), layer: 'base' }),
							node({ id: 'b', bounds: box(50, 50, 100, 100), layer: 'popup' }),
						],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toHaveLength(0);
		});

		it('does not read an absent zIndex on both siblings as the same zIndex', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						children: [node({ id: 'a', bounds: box(0, 0, 100, 100) }), node({ id: 'b', bounds: box(50, 50, 100, 100) })],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toHaveLength(1);
			expect(reportFor(result, 'sibling-overlap').exempt).toBe(0);
		});

		it('does not let one declared zIndex exempt a pair on its own', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						children: [
							node({ id: 'a', bounds: box(0, 0, 100, 100), zIndex: 3 }),
							node({ id: 'b', bounds: box(50, 50, 100, 100) }),
						],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toHaveLength(1);
		});

		it('treats roots as siblings of each other (R13.27)', () => {
			const result = layoutLint(
				doc([node({ id: 'screen', bounds: box(0, 0, 500, 500) }), node({ id: 'overlay', bounds: box(100, 100, 500, 500) })]),
			);

			expect(forRule(result, 'sibling-overlap')).toEqual([
				{
					rule: 'sibling-overlap',
					path: 'screen',
					bounds: box(0, 0, 500, 500),
					otherPath: 'overlay',
					otherBounds: box(100, 100, 500, 500),
				},
			]);
		});

		it('compares siblings in screen space, so a scrolled group is judged where it draws', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						children: [
							node({ id: 'a', bounds: box(0, 0, 100, 100), screenBounds: box(0, 0, 100, 100) }),
							node({ id: 'b', bounds: box(0, 0, 100, 100), screenBounds: box(400, 400, 100, 100) }),
						],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toHaveLength(0);
		});

		it('reports a sibling whose box wholly contains another, not merely one that clips its corner', () => {
			// Containment was the bulk of the live findings, and it is exactly
			// what a geometric shortcut would pardon: by box alone, a
			// background enclosing what sits on it cannot be told apart from a
			// panel swallowing the row laid out beside it.
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						children: [node({ id: 'a', bounds: box(0, 0, 100, 100) }), node({ id: 'b', bounds: box(10, 10, 50, 50) })],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toEqual([
				{ rule: 'sibling-overlap', path: 'root/a', bounds: box(0, 0, 100, 100), otherPath: 'root/b', otherBounds: box(10, 10, 50, 50) },
			]);
			expect(reportFor(result, 'sibling-overlap').exempt).toBe(0);
		});

		it('reports two siblings whose boxes are exactly coincident', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						children: [node({ id: 'a', bounds: box(0, 0, 100, 100) }), node({ id: 'b', bounds: box(0, 0, 100, 100) })],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toEqual([
				{ rule: 'sibling-overlap', path: 'root/a', bounds: box(0, 0, 100, 100), otherPath: 'root/b', otherBounds: box(0, 0, 100, 100) },
			]);
			expect(reportFor(result, 'sibling-overlap').exempt).toBe(0);
		});
	});

	describe('rule 2: child-outside-parent (R13.25.2)', () => {
		it('reports a child whose bounds exceed its parent', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'panel',
						bounds: box(0, 0, 100, 100),
						children: [node({ id: 'label', bounds: box(10, 10, 200, 20) })],
					}),
				]),
			);

			expect(forRule(result, 'child-outside-parent')).toEqual([
				{
					rule: 'child-outside-parent',
					path: 'panel/label',
					bounds: box(10, 10, 200, 20),
					otherPath: 'panel',
					otherBounds: box(0, 0, 100, 100),
				},
			]);
		});

		// R3.8: a raise resets the clip, so an open menu hangs past its select
		// by design; R13.31's z-order fixture needs one and still lints clean.
		it('lets off a child raised into another layer that touches its parent, and only that', () => {
			const menu = (layer: string, y = 30) => layoutLint(
				doc([
					node({
						id: 'select',
						bounds: box(0, 0, 200, 30),
						layer: 'base',
						children: [node({ id: 'menu', bounds: box(0, y, 200, 150), layer })],
					}),
				]),
			);

			expect(forRule(menu('popup'), 'child-outside-parent')).toHaveLength(0);
			expect(reportFor(menu('popup'), 'child-outside-parent').exempt).toBe(1);
			expect(forRule(menu('base'), 'child-outside-parent')).toHaveLength(1);
			// Overlapping counts as touching too.
			expect(forRule(menu('popup', 20), 'child-outside-parent')).toHaveLength(0);
		});

		// The popup built in the wrong coordinate space: raised, on screen,
		// and nowhere near the component that opened it.
		it('reports a raised child that has come away from its parent', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'host',
						bounds: box(0, 0, 100, 100),
						children: [node({ id: 'menu', bounds: box(600, 600, 200, 150), layer: 'popup' })],
					}),
				]),
			);

			expect(forRule(result, 'child-outside-parent').map((violation) => violation.path)).toEqual(['host/menu']);
			// Two pixels clear is already apart.
			const gap = layoutLint(
				doc([
					node({
						id: 'select',
						bounds: box(0, 0, 200, 30),
						children: [node({ id: 'menu', bounds: box(0, 32, 200, 150), layer: 'popup' })],
					}),
				]),
			);
			expect(forRule(gap, 'child-outside-parent')).toHaveLength(1);
		});

		it('does not report a child inside its parent, nor one over by less than epsilon', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'panel',
						bounds: box(0, 0, 100, 100),
						children: [node({ id: 'inside', bounds: box(10, 10, 50, 50) }), node({ id: 'hair', bounds: box(0, 60, 100.4, 20) })],
					}),
				]),
			);

			expect(forRule(result, 'child-outside-parent')).toHaveLength(0);
		});

		it('lets a scroll container\'s content overflow it, and still judges what overflows the content', () => {
			// The shape treeSnapshot emits for a ScrollContainer (R12.20): it
			// carries scroll and contentOffset, and its one content child is as
			// tall as the content, which the container clips.
			const result = layoutLint(
				doc([
					node({
						id: 'scroller',
						type: 'ScrollContainer',
						bounds: box(0, 0, 100, 100),
						contentOffset: { x: 0, y: 40 },
						scroll: { x: 0, y: 40, maxX: 0, maxY: 300 },
						children: [
							node({
								id: 'content',
								type: 'Stack',
								bounds: box(0, 0, 100, 400),
								screenBounds: box(0, -40, 100, 400),
								children: [node({ id: 'row', bounds: box(0, 390, 120, 20), screenBounds: box(0, 350, 120, 20) })],
							}),
						],
					}),
				]),
			);

			expect(forRule(result, 'child-outside-parent').map((violation) => violation.path)).toEqual(['scroller/content/row']);
			expect(reportFor(result, 'child-outside-parent').exempt).toBe(1);
			expect(reportFor(result, 'child-outside-parent').evaluated).toBe(2);
		});

		it('still reports a scroll container\'s child that escapes across, and a part of its own', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'scroller',
						type: 'ScrollContainer',
						bounds: box(0, 0, 100, 100),
						contentOffset: { x: 0, y: 0 },
						scroll: { x: 0, y: 0, maxX: 0, maxY: 300 },
						parts: [node({ id: 'bar', type: 'Scrollbar', bounds: box(90, 0, 24, 100) })],
						children: [node({ id: 'content', type: 'Stack', bounds: box(0, 0, 108, 400) })],
					}),
				]),
			);

			expect(forRule(result, 'child-outside-parent').map((violation) => violation.path)).toEqual(['scroller/bar', 'scroller/content']);
			expect(reportFor(result, 'child-outside-parent').exempt).toBe(0);
		});

		it('compares in screen space, so an offset parent does not make a contained child escape', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'panel',
						bounds: box(500, 400, 200, 200),
						children: [node({ id: 'label', bounds: box(10, 10, 50, 50), screenBounds: box(510, 410, 50, 50) })],
					}),
				]),
			);

			// A bounds-against-bounds compare reads the child's parent-relative
			// (10,10) against the parent's absolute (500,400) and reports an
			// escape of 490. Every other rule-2 case here puts the parent at
			// the origin, where the two spaces coincide and the error hides.
			expect(forRule(result, 'child-outside-parent')).toHaveLength(0);
			expect(reportFor(result, 'child-outside-parent').evaluated).toBe(1);
		});

		it('still reports a child of an offset parent that genuinely escapes', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'panel',
						bounds: box(500, 400, 200, 200),
						children: [node({ id: 'label', bounds: box(190, 10, 50, 50), screenBounds: box(690, 410, 50, 50) })],
					}),
				]),
			);

			expect(forRule(result, 'child-outside-parent')).toEqual([
				{
					rule: 'child-outside-parent',
					path: 'panel/label',
					bounds: box(190, 10, 50, 50),
					otherPath: 'panel',
					otherBounds: box(500, 400, 200, 200),
				},
			]);
		});

		it('measures the child as its margin box, which R13.22 makes its bounds', () => {
			const child = (margin?: LintEdges) =>
				layoutLint(
					doc([
						node({
							id: 'panel',
							bounds: box(0, 0, 60, 60),
							children: [node({ id: 'label', bounds: box(10, 10, 50, 50), margin })],
						}),
					]),
				);

			// Content box 50x50 at (10,10) fits inside 60x60; the same box with
			// 10 px of margin on every side is a 70x70 margin box at the origin
			// and overflows right and bottom by 10.
			expect(forRule(child(), 'child-outside-parent')).toHaveLength(0);
			expect(forRule(child({ top: 10, right: 10, bottom: 10, left: 10 }), 'child-outside-parent')).toHaveLength(1);
		});
	});

	describe('rule 3: outside-viewport (R13.25.3)', () => {
		// R13.25.3 as amended by DDB-208: scrolled away is not off screen.
		// R3.8: a raised child leaves every clip behind but still moves with
		// the scrollers around it, including ones further out than its own.
		it('lets off raised content an outer scroller can bring into the viewport', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'page',
						bounds: box(0, 0, 800, 400),
						layer: 'base',
						scroll: { x: 0, y: 0, maxX: 0, maxY: 2000 },
						children: [
							node({
								id: 'inner',
								bounds: box(0, 1000, 400, 100),
								layer: 'base',
								clip: box(0, 0, 800, 400),
								scroll: { x: 0, y: 0, maxX: 0, maxY: 0 },
								children: [node({ id: 'menu', bounds: box(0, 1100, 200, 150), layer: 'popup' })],
							}),
						],
					}),
				], { width: 800, height: 400 }),
			);

			expect(forRule(result, 'outside-viewport').map((violation) => violation.path)).toEqual([]);
		});

		it('lets off content a scroll container can bring wholly into view, and nothing else', () => {
			const list = (rows: LintNode[], scroll = { x: 0, y: 0, maxX: 0, maxY: 1200 }) => layoutLint(
				doc([node({ id: 'list', bounds: box(0, 0, 400, 400), scroll, children: rows })], { width: 800, height: 400 }),
			);

			const below = list([node({ id: 'row', bounds: box(0, 900, 400, 40) })]);
			expect(forRule(below, 'outside-viewport')).toHaveLength(0);
			expect(reportFor(below, 'outside-viewport').exempt).toBe(1);
			// Past the end of the range.
			expect(forRule(list([node({ id: 'row', bounds: box(0, 1700, 400, 40) })]), 'outside-viewport')).toHaveLength(1);
			// Wider than the window on the axis it does not scroll.
			expect(forRule(list([node({ id: 'row', bounds: box(0, 900, 900, 40) })]), 'outside-viewport')).toHaveLength(1);
			// Taller than the window on the axis it scrolls: exempt where it can span the window.
			expect(forRule(list([node({ id: 'section', bounds: box(0, 900, 400, 700) })]), 'outside-viewport')).toHaveLength(0);
			expect(forRule(list([node({ id: 'section', bounds: box(0, 1700, 400, 700) })]), 'outside-viewport')).toHaveLength(1);
						// No scroll signal, no exemption.
			const plain = layoutLint(doc([node({ id: 'list', bounds: box(0, 0, 400, 400), contentOffset: { x: -8, y: -8 }, children: [node({ id: 'row', bounds: box(0, 900, 400, 40) })] })], { width: 800, height: 400 }));
			expect(forRule(plain, 'outside-viewport')).toHaveLength(1);
		});

		it('reports a visible node past the viewport edge', () => {
			const result = layoutLint(doc([node({ id: 'banner', bounds: box(1900, 10, 300, 40) })], { width: 1440, height: 882 }));

			expect(forRule(result, 'outside-viewport')).toEqual([
				{ rule: 'outside-viewport', path: 'banner', bounds: box(1900, 10, 300, 40) },
			]);
		});

		it('does not report a node inside the viewport, nor one over by less than epsilon', () => {
			const result = layoutLint(
				doc([node({ id: 'inside', bounds: box(0, 0, 1440, 882) }), node({ id: 'hair', bounds: box(0, 882, 1440.4, 0.4) })], {
					width: 1440,
					height: 882,
				}),
			);

			expect(forRule(result, 'outside-viewport')).toHaveLength(0);
		});
	});

	describe('rule 4: zero-or-negative-size (R13.25.4)', () => {
		it('reports a node with zero width', () => {
			const result = layoutLint(doc([node({ id: 'divider', type: 'Rectangle', bounds: box(10, 10, 0, 40) })]));

			expect(forRule(result, 'zero-or-negative-size')).toEqual([
				{ rule: 'zero-or-negative-size', path: 'divider', bounds: box(10, 10, 0, 40), bucket: ZERO_SIZE_BUCKETS.zeroBox },
			]);
		});

		it('reports a node with a real width and zero height, which an AND would miss', () => {
			const result = layoutLint(doc([node({ id: 'title', type: 'Text', bounds: box(17, 553, 90, 0) })]));

			expect(forRule(result, 'zero-or-negative-size')).toHaveLength(1);
		});

		it('reports negative extent', () => {
			const result = layoutLint(doc([node({ id: 'inverted', bounds: box(10, 10, -5, 20) })]));

			expect(forRule(result, 'zero-or-negative-size')).toHaveLength(1);
		});

		it('does not report a node with real extent on both axes', () => {
			const result = layoutLint(doc([node({ id: 'card', bounds: box(0, 0, 90, 130) })]));

			expect(forRule(result, 'zero-or-negative-size')).toHaveLength(0);
			expect(reportFor(result, 'zero-or-negative-size').evaluated).toBe(1);
		});

		it('buckets an unmeasured Text apart from a collapsed box without hiding either', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 500, 500),
						children: [
							node({ id: 'title', type: 'Text', bounds: box(0, 0, 90, 0) }),
							node({ id: 'subtitle', type: 'Text', bounds: box(0, 20, 0, 0) }),
							node({ id: 'rule', type: 'Rectangle', bounds: box(0, 40, 100, 0) }),
						],
					}),
				]),
			);

			const violations = forRule(result, 'zero-or-negative-size');
			expect(violations).toHaveLength(3);
			expect(violations.map((violation) => violation.bucket)).toEqual([
				ZERO_SIZE_BUCKETS.unmeasuredText,
				ZERO_SIZE_BUCKETS.unmeasuredText,
				ZERO_SIZE_BUCKETS.zeroBox,
			]);
			expect(reportFor(result, 'zero-or-negative-size').buckets).toEqual({
				[ZERO_SIZE_BUCKETS.unmeasuredText]: 2,
				[ZERO_SIZE_BUCKETS.zeroBox]: 1,
			});
			expect(violations.filter((violation) => violation.bucket !== ZERO_SIZE_BUCKETS.unmeasuredText)).toHaveLength(1);
		});

		it('buckets a Text that has been measured and still collapsed as a real zero box', () => {
			// The phase-2 case. Type alone would keep calling this unmeasured
			// text, and the filter this module prescribes would drop it.
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 500, 500),
						children: [
							node({ id: 'unmeasured', type: 'Text', bounds: box(0, 0, 90, 0) }),
							node({
								id: 'measured',
								type: 'Text',
								bounds: box(0, 20, 90, 0),
								text: { content: 'End turn', measured: { w: 74, h: 15, lines: 1 } },
							}),
						],
					}),
				]),
			);

			const violations = forRule(result, 'zero-or-negative-size');
			expect(violations.map((violation) => violation.bucket)).toEqual([
				ZERO_SIZE_BUCKETS.unmeasuredText,
				ZERO_SIZE_BUCKETS.zeroBox,
			]);
			expect(
				violations.filter((violation) => violation.bucket !== ZERO_SIZE_BUCKETS.unmeasuredText).map((violation) => violation.path),
			).toEqual(['root/measured']);
		});
	});

	describe('rule 5: text-overflow (R13.25.5)', () => {
		it('reports a measured extent wider than the box', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'label',
						type: 'Text',
						bounds: box(0, 0, 100, 20),
						text: { content: 'End turn immediately', measured: { w: 174, h: 15, lines: 1 }, overflow: 'visible' },
					}),
				]),
			);

			expect(forRule(result, 'text-overflow')).toEqual([{ rule: 'text-overflow', path: 'label', bounds: box(0, 0, 100, 20) }]);
		});

		it('reports a measured extent taller than the box', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'label',
						type: 'Text',
						bounds: box(0, 0, 100, 20),
						text: { content: 'two lines', measured: { w: 80, h: 30, lines: 2 } },
					}),
				]),
			);

			expect(forRule(result, 'text-overflow')).toHaveLength(1);
		});

		it('does not report a measured extent that fits', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'label',
						type: 'Text',
						bounds: box(0, 0, 100, 20),
						text: { content: 'End turn', measured: { w: 74, h: 15, lines: 1 } },
					}),
				]),
			);

			expect(forRule(result, 'text-overflow')).toHaveLength(0);
			expect(reportFor(result, 'text-overflow').evaluated).toBe(1);
		});

		it('exempts clip, ellipsis, and a declared wrap mode', () => {
			const measured = { w: 174, h: 15, lines: 1 };
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 500, 500),
						children: [
							node({ id: 'clipped', type: 'Text', bounds: box(0, 0, 100, 20), text: { measured, overflow: 'clip' } }),
							node({ id: 'ellipsised', type: 'Text', bounds: box(0, 40, 100, 20), text: { measured, overflow: 'ellipsis' } }),
							node({ id: 'wrapped', type: 'Text', bounds: box(0, 80, 100, 20), text: { measured, wrap: 'word' } }),
						],
					}),
				]),
			);

			expect(forRule(result, 'text-overflow')).toHaveLength(0);
			expect(reportFor(result, 'text-overflow').exempt).toBe(3);
		});

		it("trusts the document's overflow outcome over a size rebuilt from bounds and margin", () => {
			// 62.84 wide with margins 1.24 and 0.84: bounds.w less the margins
			// comes back a last-bit short of the measure.
			const measured = { w: 62.84, h: 15, lines: 1 };
			const margin = { top: 0, right: 0.84, bottom: 0, left: 1.24 };
			const bounds = box(0, 0, 62.84 + 1.24 + 0.84, 15);
			const lint = (overflow?: string) => layoutLint(
				doc([node({ id: 'label', type: 'Text', bounds, margin, text: { measured, overflow } })]),
			);

			expect(bounds.w - 1.24 - 0.84).toBeLessThan(62.84);
			expect(forRule(lint('none'), 'text-overflow')).toHaveLength(0);
			expect(reportFor(lint('none'), 'text-overflow').evaluated).toBe(1);
			expect(forRule(lint('visible'), 'text-overflow')).toHaveLength(1);
			// Without the outcome the rule falls back to the size comparison.
			expect(forRule(lint(), 'text-overflow')).toHaveLength(1);
		});

		it('compares in the local content box, so a turned or margined label is judged by its own size', () => {
			const measured = { w: 74, h: 15, lines: 1 };
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 500, 500),
						children: [
							// A quarter turn swaps the screen axes; the measure did not turn.
							node({
								id: 'turned',
								type: 'Text',
								bounds: box(0, 0, 74, 15),
								screenBounds: box(30, -30, 15, 74),
								text: { measured },
							}),
							// The margin box is wider than the content box the text lays out in.
							node({
								id: 'margined',
								type: 'Text',
								bounds: box(0, 100, 84, 15),
								screenBounds: box(5, 100, 70, 15),
								margin: { top: 0, right: 7, bottom: 0, left: 7 },
								text: { measured },
							}),
						],
					}),
				]),
			);

			expect(forRule(result, 'text-overflow').map((violation) => violation.path)).toEqual(['root/margined']);
		});
	});

	describe('rule 6: unreachable-interactive (R13.25.6)', () => {
		it('reports a focusable node whose screenBounds miss every ancestor clip', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'button',
						type: 'Button',
						bounds: box(0, 900, 180, 44),
						focusable: true,
						clip: box(0, 0, 1440, 400),
					}),
				]),
			);

			expect(forRule(result, 'unreachable-interactive')).toEqual([
				{ rule: 'unreachable-interactive', path: 'button', bounds: box(0, 900, 180, 44) },
			]);
		});

		it('reports a pointer-handling node entirely covered by a sibling above it', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 800, 800),
						children: [
							node({ id: 'button', type: 'Button', bounds: box(100, 100, 180, 44), pointerEvents: 'auto', handlesPointer: true }),
							node({ id: 'preview', bounds: box(50, 50, 400, 400) }),
						],
					}),
				]),
			);

			expect(forRule(result, 'unreachable-interactive')).toEqual([
				{
					rule: 'unreachable-interactive',
					path: 'root/button',
					bounds: box(100, 100, 180, 44),
					otherPath: 'root/preview',
					otherBounds: box(50, 50, 400, 400),
				},
			]);
		});

		it('does not report a node covered by a sibling below it', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 800, 800),
						children: [
							node({ id: 'backdrop', bounds: box(50, 50, 400, 400) }),
							node({ id: 'button', type: 'Button', bounds: box(100, 100, 180, 44), pointerEvents: 'auto', handlesPointer: true }),
						],
					}),
				]),
			);

			expect(forRule(result, 'unreachable-interactive')).toHaveLength(0);
		});

		it('does not report a visible, partly covered, unclipped target', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 800, 800),
						children: [
							node({ id: 'button', type: 'Button', bounds: box(100, 100, 180, 44), pointerEvents: 'auto', handlesPointer: true, clip: box(0, 0, 800, 800) }),
							node({ id: 'edge', bounds: box(260, 100, 400, 44) }),
						],
					}),
				]),
			);

			expect(forRule(result, 'unreachable-interactive')).toHaveLength(0);
			expect(reportFor(result, 'unreachable-interactive').evaluated).toBe(1);
		});

		it('ignores a coverer that is transparent to hits, and one in another layer', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 800, 800),
						children: [
							node({ id: 'button', type: 'Button', bounds: box(100, 100, 180, 44), pointerEvents: 'auto', handlesPointer: true, layer: 'base' }),
							node({ id: 'ghost', bounds: box(0, 0, 800, 800), pointerEvents: 'none' }),
							node({ id: 'veil', bounds: box(0, 0, 800, 800), pointerEvents: 'passthrough' }),
							node({ id: 'elsewhere', bounds: box(0, 0, 800, 800), layer: 'popup' }),
						],
					}),
				]),
			);

			expect(forRule(result, 'unreachable-interactive')).toHaveLength(0);
		});

		it('does not let a passthrough sibling occlude a target on its own (R8.29)', () => {
			// R8.29 makes a passthrough node's own box transparent to hits, so
			// it cannot be what makes a target unreachable; only its children
			// could, and this rule never looks at them.
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 800, 800),
						children: [
							node({ id: 'button', type: 'Button', bounds: box(100, 100, 180, 44), focusable: true }),
							node({ id: 'veil', bounds: box(0, 0, 800, 800), pointerEvents: 'passthrough' }),
						],
					}),
				]),
			);

			expect(forRule(result, 'unreachable-interactive')).toHaveLength(0);
			expect(reportFor(result, 'unreachable-interactive').evaluated).toBe(1);
		});

		it('does not let a sibling at zero opacity occlude, since the walk skips it (R3.27)', () => {
			const covered = (opacity: number) => forRule(layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 800, 800),
						children: [
							node({ id: 'button', type: 'Button', bounds: box(100, 100, 180, 44), focusable: true }),
							node({ id: 'scrim', bounds: box(0, 0, 800, 800), opacity }),
						],
					}),
				]),
			), 'unreachable-interactive');

			expect(covered(0)).toHaveLength(0);
			expect(covered(0.5)).toHaveLength(1);
		});

		it('does not treat a passthrough or none component as interactive, handlers or not', () => {
			// A passthrough container with an onClick hears its children's
			// bubbled clicks, but its own box is never a target.
			const result = layoutLint(
				doc([
					node({ id: 'decor', bounds: box(0, 900, 10, 10), pointerEvents: 'none', handlesPointer: true, clip: box(0, 0, 100, 100) }),
					node({ id: 'row', bounds: box(0, 900, 10, 10), pointerEvents: 'passthrough', handlesPointer: true, clip: box(0, 0, 100, 100) }),
				]),
			);

			expect(forRule(result, 'unreachable-interactive')).toHaveLength(0);
			expect(reportFor(result, 'unreachable-interactive').evaluated).toBe(0);
			expect(reportFor(result, 'unreachable-interactive').skippedMissingInput).toBe(0);
		});

		// DDB-208: R8.29 makes auto every leaf's default, so taken alone it
		// made every label a control and the gallery read 106.
		it('does not treat a leaf that takes hits but handles nothing as interactive', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'label',
						type: 'Text',
						bounds: box(0, 900, 10, 10),
						pointerEvents: 'auto',
						handlesPointer: false,
						focusable: false,
						clip: box(0, 0, 100, 100),
					}),
				]),
			);

			expect(forRule(result, 'unreachable-interactive')).toHaveLength(0);
			expect(forRule(result, 'target-size')).toHaveLength(0);
			expect(reportFor(result, 'target-size').evaluated).toBe(0);
			expect(reportFor(result, 'target-size').skippedMissingInput).toBe(0);
		});

		it('skips rather than guesses when a document carries pointerEvents and nothing else', () => {
			const result = layoutLint(doc([node({ id: 'close', type: 'Button', bounds: box(0, 0, 16, 16), pointerEvents: 'unit' })]));

			expect(forRule(result, 'target-size')).toHaveLength(0);
			expect(reportFor(result, 'target-size').dormant).toBe(true);
			expect(reportFor(result, 'target-size').missingInput).toEqual(['focusable', 'handlesPointer']);
		});

		it('takes a pointer handler with no declared pointerEvents as a target', () => {
			const result = layoutLint(doc([node({ id: 'close', type: 'Button', bounds: box(0, 0, 16, 16), handlesPointer: true })]));

			expect(forRule(result, 'target-size')).toHaveLength(1);
		});

		// A scroller's content outside its clip is scrolled away, not lost:
		// the wheel brings it back and focus scrolls it in (R12.20).
		it('lets off a control a scroll container has scrolled out of view', () => {
			const scroller = (scroll?: { x: number; y: number; maxX: number; maxY: number }) => layoutLint(
				doc([
					node({
						id: 'list',
						bounds: box(0, 0, 400, 400),
						contentOffset: { x: 0, y: 0 },
						scroll,
						children: [
							node({
								id: 'rows',
								bounds: box(0, 0, 400, 2000),
								children: [
									node({ id: 'row', type: 'Button', bounds: box(0, 900, 180, 44), focusable: true, clip: box(0, 0, 400, 400) }),
								],
							}),
						],
					}),
				]),
			);

			const reach = { x: 0, y: 0, maxX: 0, maxY: 1600 };
			expect(forRule(scroller(reach), 'unreachable-interactive')).toHaveLength(0);
			expect(reportFor(scroller(reach), 'unreachable-interactive').exempt).toBe(1);
			// contentOffset alone is not a scroller: a padded panel reports one.
			expect(forRule(scroller(), 'unreachable-interactive')).toHaveLength(1);
			// A range that stops short of the row does not reach it.
			expect(forRule(scroller({ x: 0, y: 0, maxX: 0, maxY: 400 }), 'unreachable-interactive')).toHaveLength(1);
		});

		// A scroller an outer, non-scrolling clip hides entirely has nowhere
		// to scroll anything into.
		it('does not let off a control inside a scroller that is itself clipped away', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'frame',
						bounds: box(0, 0, 400, 400),
						children: [
							node({
								id: 'list',
								bounds: box(0, 600, 400, 400),
								clip: box(0, 0, 400, 400),
								scroll: { x: 0, y: 0, maxX: 0, maxY: 1600 },
								children: [
									node({ id: 'row', type: 'Button', bounds: box(0, 1200, 180, 44), focusable: true, clip: box(0, 0, 400, 400) }),
								],
							}),
						],
					}),
				]),
			);

			expect(forRule(result, 'unreachable-interactive').map((violation) => violation.path)).toEqual(['frame/list/row']);
		});

		it('still checks a scrolled-out control for cover', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'list',
						bounds: box(0, 0, 400, 400),
						scroll: { x: 0, y: 0, maxX: 0, maxY: 1600 },
						children: [
							node({ id: 'row', type: 'Button', bounds: box(0, 900, 180, 44), focusable: true, clip: box(0, 0, 400, 400) }),
							node({ id: 'cover', bounds: box(0, 880, 400, 100) }),
						],
					}),
				]),
			);

			expect(forRule(result, 'unreachable-interactive').map((violation) => violation.otherPath)).toEqual(['list/cover']);
		});

		it('does not let off a scroller\'s own drawings, which do not scroll', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'list',
						bounds: box(0, 0, 400, 400),
						scroll: { x: 0, y: 0, maxX: 0, maxY: 1600 },
						parts: [node({ id: 'grip', type: 'Button', bounds: box(0, 900, 30, 30), focusable: true, clip: box(0, 0, 400, 400) })],
					}),
				]),
			);

			expect(forRule(result, 'unreachable-interactive')).toHaveLength(1);
		});

		// Rule 1 keeps parts and children apart (R3.18); cover is a paint and
		// hit question, so rule 6 compares across the two groups.
		it('compares parts and children for cover, in submission order', () => {
			const owner = (partZ: number) => layoutLint(
				doc([
					node({
						id: 'owner',
						bounds: box(0, 0, 400, 400),
						parts: [node({ id: 'face', bounds: box(0, 0, 400, 400), zIndex: partZ })],
						children: [node({ id: 'button', type: 'Button', bounds: box(100, 100, 180, 44), focusable: true, zIndex: 0 })],
					}),
				]),
			);

			// A part submits before the children, so at equal zIndex it is below.
			expect(forRule(owner(0), 'unreachable-interactive')).toHaveLength(0);
			expect(forRule(owner(1), 'unreachable-interactive')).toEqual([
				{
					rule: 'unreachable-interactive',
					path: 'owner/button',
					bounds: box(100, 100, 180, 44),
					otherPath: 'owner/face',
					otherBounds: box(0, 0, 400, 400),
				},
			]);
		});

		it('reports a child that covers an interactive part', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'owner',
						bounds: box(0, 0, 400, 400),
						parts: [node({ id: 'close', type: 'Button', bounds: box(360, 0, 40, 40), focusable: true })],
						children: [node({ id: 'content', bounds: box(0, 0, 400, 400) })],
					}),
				]),
			);

			expect(forRule(result, 'unreachable-interactive').map((violation) => violation.path)).toEqual(['owner/close']);
		});
	});

	describe('rule 7: target-size (R13.25.7)', () => {
		it('reports an interactive component under 24 by 24', () => {
			const result = layoutLint(doc([node({ id: 'close', type: 'Button', bounds: box(0, 0, 16, 16), pointerEvents: 'unit', handlesPointer: true })]));

			expect(forRule(result, 'target-size')).toEqual([{ rule: 'target-size', path: 'close', bounds: box(0, 0, 16, 16) }]);
		});

		it('does not report an interactive component at or over the minimum', () => {
			const result = layoutLint(doc([node({ id: 'ok', type: 'Button', bounds: box(0, 0, 24, 24), focusable: true })]));

			expect(forRule(result, 'target-size')).toHaveLength(0);
			expect(reportFor(result, 'target-size').evaluated).toBe(1);
		});

		it('exempts a small target whose margin box compensates on both axes', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'chip',
						type: 'Button',
						bounds: box(0, 0, 32, 32),
						screenBounds: box(8, 8, 16, 16),
						margin: { top: 8, right: 8, bottom: 8, left: 8 },
						focusable: true,
					}),
				]),
			);

			expect(forRule(result, 'target-size')).toHaveLength(0);
			expect(reportFor(result, 'target-size').exempt).toBe(1);
		});

		it('does not accept spacing on one axis as compensation for the other', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'chip',
						type: 'Button',
						bounds: box(0, 0, 32, 16),
						screenBounds: box(8, 0, 16, 16),
						margin: { top: 0, right: 8, bottom: 0, left: 8 },
						focusable: true,
					}),
				]),
			);

			expect(forRule(result, 'target-size')).toHaveLength(1);
		});

		it('raises the minimum to 44 under a touch profile', () => {
			const document = doc([node({ id: 'tap', type: 'Button', bounds: box(0, 0, 30, 30), focusable: true })]);

			expect(forRule(layoutLint(document), 'target-size')).toHaveLength(0);
			expect(forRule(layoutLint(document, { touchProfile: true }), 'target-size')).toHaveLength(1);
		});
	});

	describe('parts: the drawings a component makes for itself', () => {
		it('does not pair a part with a child at the same bounds', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'panel',
						type: 'Panel',
						bounds: box(0, 0, 200, 100),
						parts: [node({ id: 'background', type: 'Rectangle', bounds: box(0, 0, 200, 100) })],
						children: [node({ id: 'content', type: 'Container', bounds: box(0, 0, 200, 100) })],
					}),
				]),
			);

			// Never paired, rather than paired and let off: an exemption here
			// would mean the two groups had been concatenated after all, and
			// the pass would then depend on whatever geometry the exemption
			// happened to test.
			expect(forRule(result, 'sibling-overlap')).toHaveLength(0);
			expect(reportFor(result, 'sibling-overlap').evaluated).toBe(0);
			expect(reportFor(result, 'sibling-overlap').exempt).toBe(0);
		});

		it('does not pair two coincident parts with each other', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'button',
						type: 'Button',
						bounds: box(0, 0, 180, 44),
						parts: [
							node({ id: 'background', type: 'Rectangle', bounds: box(0, 0, 180, 44) }),
							node({ id: 'label', type: 'Text', bounds: box(0, 0, 180, 44) }),
						],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toHaveLength(0);
			expect(reportFor(result, 'sibling-overlap').evaluated).toBe(0);
			expect(reportFor(result, 'sibling-overlap').exempt).toBe(0);
		});

		it('reports a part that escapes its owner', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'panel',
						type: 'Panel',
						bounds: box(0, 0, 100, 100),
						parts: [node({ id: 'background', type: 'Rectangle', bounds: box(10, 10, 200, 20) })],
					}),
				]),
			);

			expect(forRule(result, 'child-outside-parent')).toEqual([
				{
					rule: 'child-outside-parent',
					path: 'panel/background',
					bounds: box(10, 10, 200, 20),
					otherPath: 'panel',
					otherBounds: box(0, 0, 100, 100),
				},
			]);
		});

		it('reports a collapsed part', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'panel',
						type: 'Panel',
						bounds: box(0, 0, 100, 100),
						parts: [node({ id: 'divider', type: 'Rectangle', bounds: box(0, 0, 0, 40) })],
					}),
				]),
			);

			expect(forRule(result, 'zero-or-negative-size')).toEqual([
				{ rule: 'zero-or-negative-size', path: 'panel/divider', bounds: box(0, 0, 0, 40), bucket: ZERO_SIZE_BUCKETS.zeroBox },
			]);
		});

		it('reports a part that leaves the viewport', () => {
			const result = layoutLint(
				doc(
					[
						node({
							id: 'panel',
							type: 'Panel',
							bounds: box(0, 0, 1440, 882),
							parts: [node({ id: 'background', type: 'Rectangle', bounds: box(1400, 10, 300, 40) })],
						}),
					],
					{ width: 1440, height: 882 },
				),
			);

			expect(forRule(result, 'outside-viewport')).toEqual([
				{ rule: 'outside-viewport', path: 'panel/background', bounds: box(1400, 10, 300, 40) },
			]);
		});

		it('still reports two overlapping children of a part', () => {
			// A part is a subtree, not a leaf: a Panel's content layer is one,
			// and everything a caller puts in it is a sibling group like any
			// other.
			const result = layoutLint(
				doc([
					node({
						id: 'panel',
						type: 'Panel',
						bounds: box(0, 0, 200, 200),
						parts: [
							node({
								id: 'content',
								type: 'Container',
								bounds: box(0, 0, 200, 200),
								children: [node({ id: 'a', bounds: box(0, 0, 100, 100) }), node({ id: 'b', bounds: box(50, 50, 100, 100) })],
							}),
						],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toEqual([
				{
					rule: 'sibling-overlap',
					path: 'panel/content/a',
					bounds: box(0, 0, 100, 100),
					otherPath: 'panel/content/b',
					otherBounds: box(50, 50, 100, 100),
				},
			]);
		});

		it('leaves a document that declares no parts anywhere exactly as it was', () => {
			// Every fixture minted before `parts` existed emits a Panel's
			// background and content layer as plain children, and an absent
			// field must not be read as an empty group that changes how the
			// rest of the array pairs up.
			const result = layoutLint(
				doc([
					node({
						id: 'panel',
						type: 'Panel',
						bounds: box(0, 0, 200, 100),
						children: [
							node({ id: 'background', type: 'Rectangle', bounds: box(0, 0, 200, 100) }),
							node({ id: 'content', type: 'Container', bounds: box(0, 0, 200, 100) }),
							node({ id: 'label', type: 'Text', bounds: box(10, 10, 90, 20) }),
						],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap').map((violation) => [violation.path, violation.otherPath])).toEqual([
				['panel/background', 'panel/content'],
				['panel/background', 'panel/label'],
				['panel/content', 'panel/label'],
			]);
			expect(reportFor(result, 'sibling-overlap').evaluated).toBe(3);
		});

		it('numbers a part and a child of the same type apart, so their paths cannot collide', () => {
			// The path is the only identity R13.28 gives a violation and the
			// only key a baseline diff can match on, and `pathSegment` counts
			// position within the array it was handed. Numbering the two groups
			// separately would print `owner/Rectangle[0]` for both the part and
			// the first child.
			const result = layoutLint(
				doc([
					node({
						id: 'owner',
						type: 'Button',
						bounds: box(0, 0, 200, 100),
						parts: [node({ type: 'Rectangle', bounds: box(0, 0, 200, 100) })],
						children: [
							node({ type: 'Rectangle', bounds: box(0, 0, 60, 40) }),
							node({ type: 'Rectangle', bounds: box(20, 10, 60, 40) }),
						],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap').map((violation) => [violation.path, violation.otherPath])).toEqual([
				['owner/Rectangle[1]', 'owner/Rectangle[2]'],
			]);
		});
	});

	describe('visibility (R13.27)', () => {
		it('skips an invisible node', () => {
			const result = layoutLint(doc([node({ id: 'hidden', bounds: box(0, 0, 0, 0), visible: false })]));

			expect(result.count).toBe(0);
		});

		it('skips the whole subtree of an invisible parent, including visible children', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'dialog',
						bounds: box(0, 0, 100, 100),
						visible: false,
						children: [
							node({ id: 'a', bounds: box(0, 0, 100, 100) }),
							node({ id: 'b', bounds: box(50, 50, 100, 100) }),
							node({ id: 'broken', bounds: box(0, 0, 0, 0) }),
						],
					}),
				]),
			);

			expect(result).toEqual({ count: 0, violations: [], rules: result.rules });
			expect(reportFor(result, 'zero-or-negative-size').evaluated).toBe(0);
		});

		it('still lints the visible siblings of an invisible node', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 500, 500),
						children: [
							node({ id: 'ghost', bounds: box(0, 0, 100, 100), visible: false }),
							node({ id: 'a', bounds: box(0, 0, 100, 100) }),
							node({ id: 'b', bounds: box(50, 50, 100, 100) }),
						],
					}),
				]),
			);

			expect(forRule(result, 'sibling-overlap')).toHaveLength(1);
		});
	});

	describe('paths (R13.28)', () => {
		it('uses ids where present and Type[index] elsewhere, joined with /', () => {
			const result = layoutLint(
				doc([
					node({
						type: 'Container',
						bounds: box(0, 0, 500, 500),
						children: [
							node({
								id: 'hud',
								type: 'Panel',
								bounds: box(0, 0, 200, 200),
								children: [node({ type: 'Rectangle', bounds: box(0, 0, 10, 10) }), node({ type: 'Text', bounds: box(0, 20, 90, 0) })],
							}),
						],
					}),
				]),
			);

			expect(forRule(result, 'zero-or-negative-size')[0].path).toBe('Container[0]/hud/Text[1]');
		});

		it('indexes by position in the parent, counting invisible siblings', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 500, 500),
						children: [node({ type: 'Text', bounds: box(0, 0, 10, 10), visible: false }), node({ type: 'Text', bounds: box(0, 20, 90, 0) })],
					}),
				]),
			);

			expect(forRule(result, 'zero-or-negative-size')[0].path).toBe('root/Text[1]');
		});

		it('falls back to Type[index] for an empty id', () => {
			const result = layoutLint(doc([node({ id: '', type: 'Text', bounds: box(0, 0, 90, 0) })]));

			expect(forRule(result, 'zero-or-negative-size')[0].path).toBe('Text[0]');
		});

		it('disambiguates a repeated sibling id instead of collapsing the two rows onto one path', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 500, 500),
						children: [
							node({ id: 'row', type: 'Text', bounds: box(0, 0, 90, 0) }),
							node({ id: 'row', type: 'Text', bounds: box(0, 20, 90, 0) }),
						],
					}),
				]),
			);

			expect(forRule(result, 'zero-or-negative-size').map((violation) => violation.path)).toEqual(['root/row[0]', 'root/row[1]']);
		});

		it('leaves a unique id bare and counts invisible siblings when deciding a repeat', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 500, 500),
						children: [
							node({ id: 'row', type: 'Text', bounds: box(0, 0, 90, 0), visible: false }),
							node({ id: 'row', type: 'Text', bounds: box(0, 20, 90, 0) }),
							node({ id: 'only', type: 'Text', bounds: box(0, 40, 90, 0) }),
						],
					}),
				]),
			);

			// Hiding one of a colliding pair must not rename the other, for the
			// same reason the index counts invisible siblings.
			expect(forRule(result, 'zero-or-negative-size').map((violation) => violation.path)).toEqual(['root/row[1]', 'root/only']);
		});

		it('does not treat the same id under two different parents as a repeat', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'left',
						bounds: box(0, 0, 400, 400),
						children: [node({ id: 'title', type: 'Text', bounds: box(0, 0, 90, 0) })],
					}),
					node({
						id: 'right',
						bounds: box(600, 0, 400, 400),
						children: [node({ id: 'title', type: 'Text', bounds: box(600, 0, 90, 0) })],
					}),
				]),
			);

			expect(forRule(result, 'zero-or-negative-size').map((violation) => violation.path)).toEqual(['left/title', 'right/title']);
		});
	});

	describe('output shape (R13.28)', () => {
		it('omits otherPath and otherBounds on a single-node violation rather than nulling them', () => {
			const result = layoutLint(doc([node({ id: 'divider', bounds: box(0, 0, 100, 0) })]));

			const violation = result.violations[0];
			expect(Object.keys(violation).sort()).toEqual(['bounds', 'bucket', 'path', 'rule']);
			expect('otherPath' in violation).toBe(false);
			expect('otherBounds' in violation).toBe(false);
		});

		it('carries otherPath and otherBounds on a pair violation', () => {
			const result = layoutLint(
				doc([node({ id: 'a', bounds: box(0, 0, 100, 100) }), node({ id: 'b', bounds: box(10, 10, 100, 100) })]),
			);

			expect(Object.keys(result.violations[0]).sort()).toEqual(['bounds', 'otherBounds', 'otherPath', 'path', 'rule']);
		});

		it('reports count as the length of the violations array', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 100, 100),
						children: [
							node({ id: 'a', bounds: box(0, 0, 100, 100) }),
							node({ id: 'b', bounds: box(50, 50, 100, 100) }),
							node({ id: 'c', bounds: box(0, 0, 0, 0) }),
						],
					}),
				]),
			);

			expect(result.count).toBe(result.violations.length);
			expect(result.count).toBeGreaterThan(1);
		});

		it('returns an empty result for an empty document', () => {
			const result = layoutLint(doc([]));

			expect(result.count).toBe(0);
			expect(result.violations).toEqual([]);
			expect(result.rules).toHaveLength(7);
		});
	});

	describe('dormancy: a rule that cannot fire must not read as a pass', () => {
		it('marks the three phase-0 dormant rules dormant and names the field they wanted', () => {
			// A snapshot shaped like phase 0's: no text.measured, no focusable,
			// no handlesPointer anywhere.
			const result = layoutLint(
				doc([
					node({
						id: 'screen',
						type: 'Container',
						bounds: box(0, 0, 500, 500),
						children: [node({ id: 'title', type: 'Text', bounds: box(10, 10, 90, 0) }), node({ type: 'Button', bounds: box(10, 40, 180, 44) })],
					}),
				]),
			);

			const text = reportFor(result, 'text-overflow');
			expect(text.dormant).toBe(true);
			expect(text.evaluated).toBe(0);
			expect(text.skippedMissingInput).toBe(1);
			expect(text.missingInput).toEqual(['text']);

			for (const rule of ['unreachable-interactive', 'target-size'] as LintRuleName[]) {
				const report = reportFor(result, rule);
				expect(report.dormant).toBe(true);
				expect(report.evaluated).toBe(0);
				expect(report.skippedMissingInput).toBe(3);
				expect(report.missingInput).toEqual(['focusable', 'handlesPointer']);
			}
		});

		it('names text.measured when the text object is there but the measurement is not', () => {
			const result = layoutLint(doc([node({ id: 'label', type: 'Text', bounds: box(0, 0, 100, 20), text: { content: 'End turn' } })]));

			expect(reportFor(result, 'text-overflow').missingInput).toEqual(['text.measured']);
			expect(reportFor(result, 'text-overflow').dormant).toBe(true);
		});

		it('does not mark a rule dormant when it ran and found nothing', () => {
			const result = layoutLint(
				doc([
					node({
						id: 'root',
						bounds: box(0, 0, 500, 500),
						children: [node({ id: 'a', bounds: box(0, 0, 100, 100) }), node({ id: 'b', bounds: box(200, 0, 100, 100) })],
					}),
				]),
			);

			for (const rule of ['sibling-overlap', 'child-outside-parent', 'outside-viewport', 'zero-or-negative-size'] as LintRuleName[]) {
				const report = reportFor(result, rule);
				expect(report.dormant).toBe(false);
				expect(report.violations).toBe(0);
				expect(report.evaluated).toBeGreaterThan(0);
			}
		});
	});

	describe('robustness', () => {
		it('does not throw on missing geometry, and treats non-finite numbers as zero', () => {
			const broken = {
				id: 'broken',
				type: 'Unserializable',
				bounds: { x: NaN, y: 0, w: Number.POSITIVE_INFINITY, h: 10 },
				screenBounds: { x: NaN, y: 0, w: Number.POSITIVE_INFINITY, h: 10 },
				visible: true,
			} as unknown as LintNode;

			const result = layoutLint(doc([broken]));

			expect(forRule(result, 'zero-or-negative-size')).toHaveLength(1);
		});

		it('accepts an explicit null for options, which a default parameter does not cover', () => {
			// `options: LintOptions = {}` only fires on undefined, and a caller
			// crossing a page.evaluate or a JSON round trip produces null.
			const document = doc([node({ id: 'tap', type: 'Button', bounds: box(0, 0, 30, 30), focusable: true })]);

			expect(() => layoutLint(document, null)).not.toThrow();
			expect(forRule(layoutLint(document, null), 'target-size')).toHaveLength(0);
		});

		it('terminates on a node held in its own children array', () => {
			const self = node({ id: 'loop', bounds: box(0, 0, 100, 100) });
			(self as { children: readonly LintNode[] }).children = [self];

			const result = layoutLint(doc([self]));

			expect(result.count).toBe(0);
		});

		it('expands a node that appears in two places once, and still lints it in both', () => {
			// Container.addChild never detaches from a previous parent, so one
			// instance can sit in two children arrays; without a walk-wide
			// guard a deep diamond expands exponentially.
			const shared = node({
				id: 'shared',
				bounds: box(0, 0, 100, 0),
				children: [node({ id: 'inner', type: 'Text', bounds: box(0, 0, 100, 0) })],
			});
			const result = layoutLint(
				doc([
					node({ id: 'left', bounds: box(0, 0, 500, 500), children: [shared] }),
					node({ id: 'right', bounds: box(600, 0, 500, 500), children: [shared] }),
				]),
			);

			expect(forRule(result, 'zero-or-negative-size').map((violation) => violation.path)).toEqual([
				'left/shared',
				'left/shared/inner',
				'right/shared',
			]);
		});
	});
});
