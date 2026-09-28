import { DrawApi, RecordingBackend } from '../draw';
import { layoutLint } from '../debug/layoutLint';
import { treeSnapshot } from '../debug/treeSnapshot';
import { Circle } from './Circle';
import { Component, ComponentOptions } from './Component';
import { Layer } from './Layer';
import type { MountContext } from './MountContext';
import { Rectangle } from './Rectangle';
import { Panel } from '../ui/Panel';
import { Stack, StackOptions } from './Stack';
import { renderTree } from './renderTree';
import { createTestContext } from './testing';
import { NO_MODIFIERS } from '../input/events';
import type { Axis, Distribution, Size } from './layoutTypes';

/**
 * Chapter 10's conformance suite: worldsim's LayoutContainer suite
 * (libs/ui/layout/LayoutContainer.test.cpp), ported case for case, then the
 * cases spec 10.9 adds. Text-dependent cases are in Stack.text.test.ts, where
 * the committed font metrics are loaded.
 *
 * Worldsim reports absolute positions and margin-box sizes (`getWidth`); this
 * engine keeps positions in the parent's content box. `origin()` below turns
 * a component back into worldsim's absolute margin-box origin, so the
 * expected numbers are worldsim's own.
 */

/** Worldsim's MockComponent: a fixed box with a uniform margin. */
function box(width: number, height: number, margin = 0, options: ComponentOptions = {}): Rectangle {
	return new Rectangle({ width, height, margin, ...options });
}

/**
 * Worldsim's WrappingMockComponent: like wrapped text, its height is its
 * area over its width. Fill width, hug height. As in worldsim it reports a
 * height of 1 until its width is settled; here that is a `measure` with the
 * width `definite`, which the stack only makes after the cross pass assigned
 * it, so a stack that measured the main axis first would read 1.
 */
class Wrapping extends Component {
	private readonly area: number;
	public readonly measuredAt: (number | null)[] = [];

	constructor(area: number) {
		super({ width: area, height: 1, widthMode: 'fill', heightMode: 'hug' });
		this.area = area;
	}

	public measure(availableWidth: number, _availableHeight: number, definite: Axis | null = null): Size {
		if (definite !== 'width') {
			this.measuredAt.push(null);
			return { width: this.width, height: 1 };
		}
		this.measuredAt.push(availableWidth);
		return { width: availableWidth, height: this.heightAt(availableWidth) };
	}

	public assignSize(width: number, height: number): void {
		super.assignSize(width, Number.isNaN(width) ? height : this.heightAt(width));
	}

	private heightAt(width: number): number {
		return width === 0 ? 0 : this.area / width;
	}
}

/** Counts calls to the legacy `layout()`, which a parent must never make (R10.11). */
class LayoutCounting extends Rectangle {
	public layoutCalls = 0;

	public layout(): void {
		this.layoutCalls += 1;
		super.layout();
	}
}

/** Mounts `root` if needed and runs the frame's layout phase, as a frame would. */
function layOut(root: Component, context: MountContext = root.context ?? createTestContext()): MountContext {
	if (!root.isMounted) root.mount(context);
	context.frame.layout();
	return context;
}

/** Worldsim's `position`: the margin-box origin in root space. */
function origin(component: Component): { x: number; y: number } {
	const screen = component.screenBounds;
	return { x: screen.x - component.margin.left, y: screen.y - component.margin.top };
}

function stack(options: StackOptions = {}): Stack {
	return new Stack(options);
}

describe('Stack construction (worldsim)', () => {
	it('keeps an explicit size as fixed on both axes', () => {
		const layout = stack({ x: 100, y: 200, width: 300, height: 400 });

		expect(layout.bounds.width).toBe(300);
		expect(layout.bounds.height).toBe(400);
		expect(layout.widthMode).toBe('fixed');
		expect(layout.heightMode).toBe('fixed');
	});

	it('reports the margin box', () => {
		const layout = stack({ width: 100, height: 100, margin: 10 });

		expect(layout.bounds.width).toBe(120);
		expect(layout.bounds.height).toBe(120);
	});

	it('hugs an axis constructed with no size (R10.1)', () => {
		const layout = stack({ width: 0, height: 100 });

		expect(layout.widthMode).toBe('hug');
		expect(layout.heightMode).toBe('fixed');
	});
});

describe('Stack vertical flow (worldsim)', () => {
	it('stacks children top to bottom', () => {
		const layout = stack({ width: 200, height: 300, direction: 'vertical' });
		const children = [box(50, 30), box(50, 40), box(50, 25)];
		children.forEach((child) => layout.addChild(child));
		layOut(layout);

		expect(children.map((child) => child.y)).toEqual([0, 30, 70]);
	});

	it('includes child margins in the spacing', () => {
		const layout = stack({ width: 200, height: 300 });
		const first = box(50, 30, 5);
		const second = box(50, 40, 5);
		layout.addChild(first).addChild(second);
		layOut(layout);

		expect(first.y).toBe(0);
		expect(second.y).toBe(40);
	});

	it.each([
		['start', 0],
		['center', 75],
		['end', 150],
	] as const)('cross-aligns %s', (crossAlign, x) => {
		const layout = stack({ width: 200, height: 300, crossAlign });
		const child = box(50, 30);
		layout.addChild(child);
		layOut(layout);

		expect(child.x).toBe(x);
	});
});

describe('Stack horizontal flow (worldsim)', () => {
	it('stacks children left to right', () => {
		const layout = stack({ width: 300, height: 100, direction: 'horizontal' });
		const children = [box(50, 30), box(60, 30), box(40, 30)];
		children.forEach((child) => layout.addChild(child));
		layOut(layout);

		expect(children.map((child) => child.x)).toEqual([0, 50, 110]);
	});

	it.each([
		['start', 0],
		['center', 35],
		['end', 70],
	] as const)('cross-aligns %s', (crossAlign, y) => {
		const layout = stack({ width: 300, height: 100, direction: 'horizontal', crossAlign });
		const child = box(50, 30);
		layout.addChild(child);
		layOut(layout);

		expect(child.y).toBe(y);
	});
});

describe('Stack invalidation (worldsim, R10.18)', () => {
	it('lays out children added after the first layout', () => {
		const layout = stack({ width: 200, height: 200 });
		const context = layOut(layout);

		const first = box(50, 30);
		const second = box(50, 40);
		layout.addChild(first).addChild(second);
		layOut(layout, context);

		expect(second.y).toBe(30);
	});

	it('re-lays out when a child resizes, with no manual invalidation', () => {
		const layout = stack({ width: 200, height: 200 });
		const first = box(50, 30);
		const second = box(50, 40);
		layout.addChild(first).addChild(second);
		const context = layOut(layout);

		// Worldsim needed invalidateLayout() here (no parent back-pointers);
		// the size setter now marks the stack itself (R8.18).
		first.height = 100;
		layOut(layout, context);

		expect(second.y).toBe(100);
	});

	it('offsets children by the container margin', () => {
		const layout = stack({ width: 200, height: 200, margin: 10 });
		const child = box(50, 30);
		layout.addChild(child);
		layOut(layout);

		expect(origin(child)).toEqual({ x: 10, y: 10 });
	});

	it('skips invisible children', () => {
		const layout = stack({ width: 200, height: 300 });
		const first = box(50, 30);
		const hidden = box(50, 40, 0, { visible: false });
		const third = box(50, 25);
		layout.addChild(first).addChild(hidden).addChild(third);
		layOut(layout);

		expect(first.y).toBe(0);
		expect(third.y).toBe(30);
	});
});

describe('Stack characterization (worldsim A2 fixes)', () => {
	it('adopts the rect its parent assigns, position and size', () => {
		const outer = stack({ x: 25, y: 35, width: 400, height: 300 });
		const inner = stack({ widthMode: 'fill', heightMode: 'fill' });
		outer.addChild(inner);
		layOut(outer);

		expect(origin(inner)).toEqual({ x: 25, y: 35 });
		expect(inner.width).toBe(400);
		expect(inner.height).toBe(300);
	});

	it('takes an assignment over its fixed size and keeps the mode (worldsim LayoutAdoptsBoundsPositionAndSize)', () => {
		const layout = stack({ width: 100, height: 50, crossAlign: 'center' });
		const child = box(50, 30);
		layout.addChild(child);
		const context = layOut(layout);

		layout.setPosition(25, 35);
		// A parent's pass assigns and then lays out; outside one, schedule it.
		layout.assignSize(400, 300);
		layout.invalidateLayout();
		layOut(layout, context);

		expect(layout.bounds).toEqual({ x: 25, y: 35, width: 400, height: 300 });
		expect(layout.widthMode).toBe('fixed');
		expect(layout.heightMode).toBe('fixed');
		expect(child.x).toBe(175);
	});

	it('aligns against the parent-assigned size, not the hug size', () => {
		const outer = stack({ width: 400, height: 300, crossAlign: 'stretch' });
		const inner = stack({ crossAlign: 'center' });
		const child = box(50, 30);
		inner.addChild(child);
		outer.addChild(inner);
		layOut(outer);

		expect(child.x).toBe(175);
	});

	it.each([
		['center', 'vertical'],
		['end', 'vertical'],
		['center', 'horizontal'],
	] as const)('keeps a %s-aligned child inside a %s hug container', (crossAlign, direction) => {
		const layout = stack({ x: direction === 'vertical' ? 100 : 0, y: direction === 'vertical' ? 0 : 100, direction, crossAlign });
		const child = box(50, 30);
		layout.addChild(child);
		layOut(layout);

		expect(origin(child)).toEqual({ x: layout.x, y: layout.y });
	});

	it('gives a nested container real bounds and lets it align its own children', () => {
		const outer = stack({ x: 10, y: 20, width: 300, height: 200, crossAlign: 'stretch' });
		const inner = stack({ crossAlign: 'center' });
		const child = box(50, 30);
		inner.addChild(child);
		outer.addChild(inner);
		layOut(outer);

		expect(origin(inner)).toEqual({ x: 10, y: 20 });
		expect(inner.bounds.width).toBe(300);
		expect(inner.bounds.height).toBe(30);
		expect(origin(child)).toEqual({ x: 135, y: 20 });
	});

	it('never calls a plain child\'s layout (R10.11)', () => {
		const layout = stack({ width: 200, height: 200 });
		const child = new LayoutCounting({ width: 50, height: 30 });
		layout.addChild(child);
		layOut(layout);

		expect(child.layoutCalls).toBe(0);
	});

	it('reports an explicit size plus margin', () => {
		const layout = stack({ width: 100, height: 50, margin: 10 });

		expect(layout.bounds.width).toBe(120);
		expect(layout.bounds.height).toBe(70);
	});
});

describe('Stack gap and padding (worldsim, R10.2, R10.12)', () => {
	it('spaces children by the gap', () => {
		const layout = stack({ width: 200, height: 300, gap: 10 });
		const children = [box(50, 30), box(50, 40), box(50, 25)];
		children.forEach((child) => layout.addChild(child));
		layOut(layout);

		expect(children.map((child) => child.y)).toEqual([0, 40, 90]);
	});

	it('grows a hug main axis by the gaps, and not the cross axis', () => {
		const layout = stack({ gap: 10 });
		layout.addChild(box(50, 30)).addChild(box(50, 40));
		layOut(layout);

		expect(layout.height).toBe(80);
		expect(layout.width).toBe(50);
	});

	it('leaves a leaf that cannot resize at its own size under fill and stretch', () => {
		const layout = stack({ width: 200, height: 300, crossAlign: 'stretch' });
		const circle = new Circle({ widthMode: 'fill' });
		circle.setRadius(20);
		layout.addChild(circle);
		layOut(layout);

		expect(circle.width).toBe(40);
		expect(circle.height).toBe(40);
	});

	it('offsets children by the padding and grows a hug size by it', () => {
		const layout = stack({ padding: { top: 5, right: 6, bottom: 7, left: 8 } });
		const child = box(50, 30);
		layout.addChild(child);
		layOut(layout);

		expect(child.x).toBe(8);
		expect(child.y).toBe(5);
		expect(layout.width).toBe(64);
		expect(layout.height).toBe(42);
	});

	it('combines padding, gap, and margins', () => {
		const layout = stack({ gap: 6, padding: 4, margin: 10 });
		const first = box(50, 30, 5);
		const second = box(50, 20, 5);
		layout.addChild(first).addChild(second);
		layOut(layout);

		expect(origin(first)).toEqual({ x: 14, y: 14 });
		expect(origin(second).y).toBe(60);
		expect(layout.bounds.width).toBe(88);
		expect(layout.bounds.height).toBe(104);
	});
});

/** A 100 by 300 column of `count` children `childHeight` tall; their y positions. */
function distributionYs(distribution: Distribution, count: number, childHeight: number, gap = 0): number[] {
	const layout = stack({ width: 100, height: 300, gap, distribution });
	const children = Array.from({ length: count }, () => box(50, childHeight));
	children.forEach((child) => layout.addChild(child));
	layOut(layout);
	return children.map((child) => child.y);
}

describe('Stack distribution (worldsim, R10.9)', () => {
	it('start', () => {
		expect(distributionYs('start', 1, 30)).toEqual([0]);
		expect(distributionYs('start', 2, 30)).toEqual([0, 30]);
		expect(distributionYs('start', 5, 20)).toEqual([0, 20, 40, 60, 80]);
	});

	it('center', () => {
		expect(distributionYs('center', 1, 30)).toEqual([135]);
		expect(distributionYs('center', 2, 30)).toEqual([120, 150]);
		expect(distributionYs('center', 5, 20)).toEqual([100, 120, 140, 160, 180]);
	});

	it('end', () => {
		expect(distributionYs('end', 1, 30)).toEqual([270]);
		expect(distributionYs('end', 2, 30)).toEqual([240, 270]);
		expect(distributionYs('end', 5, 20)).toEqual([200, 220, 240, 260, 280]);
	});

	it('spaceBetween, with a single child left at the start', () => {
		expect(distributionYs('spaceBetween', 1, 30)).toEqual([0]);
		expect(distributionYs('spaceBetween', 2, 30)).toEqual([0, 270]);
		expect(distributionYs('spaceBetween', 5, 20)).toEqual([0, 70, 140, 210, 280]);
	});

	it('spaceAround, with a single child centred', () => {
		expect(distributionYs('spaceAround', 1, 30)).toEqual([135]);
		expect(distributionYs('spaceAround', 2, 30)).toEqual([60, 210]);
		expect(distributionYs('spaceAround', 5, 20)).toEqual([20, 80, 140, 200, 260]);
	});

	it('spaceEvenly', () => {
		expect(distributionYs('spaceEvenly', 1, 30)).toEqual([135]);
		expect(distributionYs('spaceEvenly', 2, 30)).toEqual([80, 190]);
		const step = 200 / 6;
		const ys = distributionYs('spaceEvenly', 5, 20);
		expect(ys).toHaveLength(5);
		ys.forEach((y, index) => {
			expect(y).toBeCloseTo(step * (index + 1) + 20 * index, 3);
		});
	});

	it('stacks distributed space on top of the gap', () => {
		// leftover = 300 - 100 - 10 = 190; second = 50 + 10 + 190
		expect(distributionYs('spaceBetween', 2, 50, 10)).toEqual([0, 250]);
	});

	it('is inert on a hug main axis', () => {
		const layout = stack({ width: 100, distribution: 'center' });
		const first = box(50, 30);
		const second = box(50, 30);
		layout.addChild(first).addChild(second);
		layOut(layout);

		expect(first.y).toBe(0);
		expect(second.y).toBe(30);
	});
});

describe('Stack fill sizing (worldsim, R10.8)', () => {
	it('gives a single fill child the leftover', () => {
		const layout = stack({ width: 100, height: 300 });
		const fixed = box(80, 100);
		const fill = box(80, 0, 0, { heightMode: 'fill' });
		layout.addChild(fixed).addChild(fill);
		layOut(layout);

		expect(fill.height).toBe(200);
		expect(fill.y).toBe(100);
		expect(fixed.y).toBe(0);
	});

	it('mixes fixed, hug, and fill', () => {
		const layout = stack({ width: 100, height: 300 });
		const fill = box(50, 0, 0, { heightMode: 'fill' });
		layout.addChild(box(50, 60)).addChild(box(50, 40, 0, { heightMode: 'hug' })).addChild(fill);
		layOut(layout);

		expect(fill.height).toBe(200);
		expect(fill.y).toBe(100);
	});

	it('splits the leftover by weight', () => {
		const layout = stack({ width: 100, height: 300 });
		const light = box(50, 0, 0, { heightMode: 'fill', fillWeight: 1 });
		const heavy = box(50, 0, 0, { heightMode: 'fill', fillWeight: 3 });
		layout.addChild(box(50, 100)).addChild(light).addChild(heavy);
		layOut(layout);

		expect(light.height).toBe(50);
		expect(heavy.height).toBe(150);
	});

	it('takes a fill child\'s margin out of the leftover', () => {
		const layout = stack({ width: 100, height: 200 });
		const fill = box(50, 0, 10, { heightMode: 'fill' });
		layout.addChild(box(50, 80)).addChild(fill);
		layOut(layout);

		expect(fill.height).toBe(100);
		expect(fill.bounds.height).toBe(120);
	});

	it('gives a fill child zero when there is no leftover', () => {
		const layout = stack({ width: 100, height: 100 });
		const fill = box(50, 0, 0, { heightMode: 'fill' });
		layout.addChild(box(50, 120)).addChild(fill);
		layOut(layout);

		expect(fill.height).toBe(0);
	});
});

describe('Stack stretch and cross fill (worldsim, R10.7)', () => {
	it('stretches a hug child to the content box minus its margin', () => {
		const layout = stack({ width: 200, height: 100, crossAlign: 'stretch' });
		const child = box(50, 30, 5, { widthMode: 'hug' });
		layout.addChild(child);
		layOut(layout);

		expect(child.width).toBe(190);
		expect(child.bounds.width).toBe(200);
		expect(child.x).toBe(0);
	});

	it('leaves a fixed child alone, at the start', () => {
		const layout = stack({ width: 200, height: 100, crossAlign: 'stretch' });
		const child = box(50, 30);
		layout.addChild(child);
		layOut(layout);

		expect(child.width).toBe(50);
		expect(child.x).toBe(0);
	});

	it('returns a stretched box to the size it was given once the stretch goes', () => {
		const layout = stack({ width: 200, height: 100, crossAlign: 'stretch' });
		const child = box(50, 30, 0, { widthMode: 'hug' });
		layout.addChild(child);
		const context = layOut(layout);
		expect(child.width).toBe(200);

		layout.crossAlign = 'start';
		layOut(layout, context);

		expect(child.width).toBe(50);
	});

	it('stretches a cross-axis fill child whatever crossAlign says', () => {
		const layout = stack({ width: 200, height: 100, crossAlign: 'start' });
		const child = box(50, 30, 0, { widthMode: 'fill' });
		layout.addChild(child);
		layOut(layout);

		expect(child.width).toBe(200);
	});
});

describe('Stack edge cases (worldsim, R10.10)', () => {
	it('is safe with no children and hugs its padding', () => {
		const layout = stack({ padding: 4 });
		layOut(layout);

		expect(layout.width).toBe(8);
		expect(layout.height).toBe(8);
	});

	it('degrades every distribution to start on main-axis overflow', () => {
		const layout = stack({ width: 100, height: 50, distribution: 'center' });
		const first = box(50, 40);
		const second = box(50, 40);
		layout.addChild(first).addChild(second);
		layOut(layout);

		expect(first.y).toBe(0);
		expect(second.y).toBe(40);
	});

	it('degrades cross alignment to start on cross-axis overflow', () => {
		const layout = stack({ width: 100, height: 100, crossAlign: 'center' });
		const child = box(150, 30);
		layout.addChild(child);
		layOut(layout);

		expect(child.x).toBe(0);
	});

	it('propagates stretch three containers deep', () => {
		const outer = stack({ x: 10, y: 10, width: 300, height: 300, crossAlign: 'stretch' });
		const mid = stack({ crossAlign: 'stretch' });
		const inner = stack({ crossAlign: 'stretch' });
		const leaf = box(50, 30, 0, { widthMode: 'hug' });
		inner.addChild(leaf);
		mid.addChild(inner);
		outer.addChild(mid);
		layOut(outer);

		expect(mid.width).toBe(300);
		expect(inner.width).toBe(300);
		expect(leaf.width).toBe(300);
		expect(origin(leaf)).toEqual({ x: 10, y: 10 });
	});
});

describe('Stack resolved sizes (worldsim, R10.5)', () => {
	it('reports zero for a fill container squeezed to zero, and its siblings do not move', () => {
		const parent = stack({ width: 100, height: 100 });
		const top = box(50, 60);
		const fill = stack({ width: 50, heightMode: 'fill' });
		fill.addChild(box(40, 30));
		const bottom = box(50, 40);
		parent.addChild(top).addChild(fill).addChild(bottom);
		layOut(parent);

		expect(fill.height).toBe(0);
		expect(top.y).toBe(0);
		expect(fill.y).toBe(60);
		expect(bottom.y).toBe(60);
	});

	it('adopts a zero cross size when stretched into a collapsed content box', () => {
		const outer = stack({ width: 20, height: 100, padding: { left: 10, right: 10 }, crossAlign: 'stretch' });
		const inner = stack();
		inner.addChild(box(50, 30));
		outer.addChild(inner);
		layOut(outer);

		expect(inner.width).toBe(0);
		expect(inner.height).toBe(30);
	});

	it('takes an assignment of zero over its hug measurement, for the pass', () => {
		const layout = stack();
		layout.addChild(box(50, 30));
		const context = layOut(layout);

		// Unassigned, it reports what it hugs.
		expect(layout.bounds).toEqual({ x: 0, y: 0, width: 50, height: 30 });
		layout.assignSize(0, 0);
		expect(layout.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
		expect(layout.width).toBe(0);
		expect(layout.height).toBe(0);

		// R10.5, and where worldsim went wrong: the assignment is for one pass.
		// Laid out on its own, the axis hugs again rather than staying frozen.
		layout.invalidateLayout();
		layOut(layout, context);
		expect(layout.width).toBe(50);
		expect(layout.height).toBe(30);
		expect(layout.widthMode).toBe('hug');
	});

	it('hugs its children while nothing assigns it', () => {
		const layout = stack();
		layout.addChild(box(50, 30)).addChild(box(70, 40));
		layOut(layout);

		expect(layout.width).toBe(70);
		expect(layout.height).toBe(70);
	});

	it('keeps an explicit size whatever its children measure', () => {
		const layout = stack({ width: 100, height: 50 });
		layout.addChild(box(200, 200));
		layOut(layout);

		expect(layout.width).toBe(100);
		expect(layout.height).toBe(50);
	});
});

describe('Stack wrap-aware sizing (worldsim, R10.7, R10.13)', () => {
	it('assigns a wrapping child its width before measuring its height, so the hug column grows', () => {
		const wide = stack({ width: 100 });
		const wideChild = new Wrapping(3000);
		wide.addChild(wideChild);
		layOut(wide);

		expect(wideChild.height).toBe(30);
		expect(wide.height).toBe(30);

		const narrow = stack({ width: 50 });
		const narrowChild = new Wrapping(3000);
		narrow.addChild(narrowChild);
		layOut(narrow);

		expect(narrowChild.height).toBe(60);
		expect(narrow.height).toBe(60);
		// Its height was only ever read with its width settled at the column's.
		expect(narrowChild.measuredAt.length).toBeGreaterThan(0);
		expect(narrowChild.measuredAt.every((width) => width === 50)).toBe(true);
	});

	it('collapses a wrapping child assigned zero width instead of dividing by it', () => {
		const layout = stack({ width: 20, padding: { left: 10, right: 10 } });
		const child = new Wrapping(3000);
		layout.addChild(child);
		layOut(layout);

		expect(child.width).toBe(0);
		expect(child.height).toBe(0);
		expect(layout.height).toBe(0);
	});
});

describe('Stack additions (spec 10.9)', () => {
	it('centres one fixed child in a stretch row with alignSelf', () => {
		const row = stack({ width: 300, height: 100, direction: 'horizontal', crossAlign: 'stretch' });
		const stretched = box(50, 20, 0, { heightMode: 'hug' });
		const centred = box(50, 20, 0, { alignSelf: 'center' });
		row.addChild(stretched).addChild(centred);
		layOut(row);

		expect(stretched.height).toBe(100);
		expect(stretched.y).toBe(0);
		expect(centred.height).toBe(20);
		expect(centred.y).toBe(40);
	});

	it('returns what maxSize cuts from a fill child to its siblings', () => {
		const row = stack({ width: 300, height: 50, direction: 'horizontal' });
		const capped = box(0, 50, 0, { widthMode: 'fill', maxSize: { width: 60 } });
		const free = box(0, 50, 0, { widthMode: 'fill' });
		row.addChild(capped).addChild(free);
		layOut(row);

		expect(capped.width).toBe(60);
		expect(free.width).toBe(240);
		expect(free.x).toBe(60);
	});

	it('holds a fill child at its minSize and takes the difference from its siblings', () => {
		const row = stack({ width: 100, height: 50, direction: 'horizontal' });
		const floored = box(0, 50, 0, { widthMode: 'fill', minSize: { width: 70 } });
		const free = box(0, 50, 0, { widthMode: 'fill' });
		row.addChild(floored).addChild(free);
		layOut(row);

		expect(floored.width).toBe(70);
		expect(free.width).toBe(30);
	});

	it('divides the leftover by weights 25/40/35, after padding and gaps', () => {
		const row = stack({ width: 440, height: 50, direction: 'horizontal', padding: 10, gap: 10 });
		const weights = [25, 40, 35];
		const bands = weights.map((fillWeight) => box(0, 30, 0, { widthMode: 'fill', fillWeight }));
		bands.forEach((band) => row.addChild(band));
		layOut(row);

		// 440 - 20 padding - 20 gaps = 400 to share.
		expect(bands.map((band) => band.width)).toEqual([100, 160, 140]);
		expect(bands.map((band) => band.x)).toEqual([10, 120, 290]);
	});

	it('splits an otherwise empty container exactly by weight', () => {
		const column = stack({ width: 100, height: 1000 });
		const bands = [25, 40, 35].map((fillWeight) => box(100, 0, 0, { heightMode: 'fill', fillWeight }));
		bands.forEach((band) => column.addChild(band));
		layOut(column);

		expect(bands.map((band) => band.height)).toEqual([250, 400, 350]);
	});

	it('gives fill children zero when their weights sum to zero (a change from worldsim)', () => {
		const row = stack({ width: 300, height: 50, direction: 'horizontal' });
		const first = box(40, 50, 0, { widthMode: 'fill', fillWeight: 0 });
		const second = box(40, 50, 0, { widthMode: 'fill', fillWeight: 0 });
		row.addChild(first).addChild(second);
		layOut(row);

		expect(first.width).toBe(0);
		expect(second.width).toBe(0);
	});

	it('overlaps siblings with a negative gap and shrinks the hug size by it', () => {
		const hand = stack({ direction: 'horizontal', gap: -20 });
		const cards = [box(60, 90), box(60, 90), box(60, 90)];
		cards.forEach((card) => hand.addChild(card));
		layOut(hand);

		expect(cards.map((card) => card.x)).toEqual([0, 40, 80]);
		expect(hand.width).toBe(140);
	});

	it('lets the lint accept the overlap a negative gap asks for, and no more (R13.25.1)', () => {
		const lintHand = (gap: number, nudge: number): string[] => {
			const root = new Layer({ width: 800, height: 600 });
			const hand = stack({ x: 100, y: 100, direction: 'horizontal', gap });
			const cards = [box(60, 90), box(60, 90), box(60, 90)];
			cards.forEach((card) => hand.addChild(card));
			root.addChild(hand);
			layOut(root);
			cards[2].x += nudge;
			const result = layoutLint(treeSnapshot([root], { width: 800, height: 600 }));
			return result.violations.map((violation) => violation.rule);
		};

		expect(lintHand(-20, 0)).toEqual([]);
		// Deeper than the gap allows: a finding.
		expect(lintHand(-20, -15)).toContain('sibling-overlap');
		// Touching is not overlap; overlap with no negative gap is.
		expect(lintHand(0, 0)).toEqual([]);
		expect(lintHand(0, -1)).toContain('sibling-overlap');
	});

	it('resolves the unassigned axis from aspectRatio', () => {
		const column = stack({ width: 120, height: 400, crossAlign: 'stretch' });
		const square = box(0, 0, 0, { widthMode: 'hug', heightMode: 'hug', aspectRatio: 1 });
		const wide = box(0, 0, 0, { widthMode: 'hug', heightMode: 'hug', aspectRatio: 2 });
		column.addChild(square).addChild(wide);
		layOut(column);

		expect(square.width).toBe(120);
		expect(square.height).toBe(120);
		expect(wide.height).toBe(60);
		expect(wide.y).toBe(120);
	});

	it('never changes a sizing mode', () => {
		const outer = stack({ width: 300, height: 200, crossAlign: 'stretch' });
		const inner = stack({ heightMode: 'fill' });
		inner.addChild(box(50, 30));
		outer.addChild(inner);
		layOut(outer);

		expect(inner.widthMode).toBe('hug');
		expect(inner.heightMode).toBe('fill');
	});

	it('grows a nested hug container when its content grows after the first layout (the freeze regression)', () => {
		const outer = stack({ width: 300, height: 300 });
		const inner = stack();
		const grower = box(50, 30, 0, { heightMode: 'hug' });
		inner.addChild(grower);
		outer.addChild(inner);
		const after = box(50, 10);
		outer.addChild(after);
		const context = layOut(outer);
		expect(inner.height).toBe(30);
		expect(after.y).toBe(30);

		grower.height = 80;
		layOut(outer, context);

		expect(inner.height).toBe(80);
		expect(after.y).toBe(80);
	});

	it('excludes absolute children from flow and hug measurement', () => {
		const layout = stack({ gap: 10 });
		const flow = box(50, 30);
		const badge = box(10, 10, 0, { positioned: 'absolute' });
		layout.addChild(flow).addChild(badge).addChild(box(50, 30));
		layOut(layout);

		expect(layout.height).toBe(70);
		expect(layout.width).toBe(50);
	});

	it('pins an absolute child to the top-right corner whatever the parent size (R10.15)', () => {
		const card = stack({ width: 200, height: 100, padding: 4 });
		const badge = box(16, 16, 0, { positioned: 'absolute', anchor: 'topRight' });
		card.addChild(box(50, 30)).addChild(badge);
		const context = layOut(card);

		expect(badge.bounds).toEqual({ x: 180, y: 4, width: 16, height: 16 });

		card.width = 320;
		card.height = 140;
		layOut(card, context);

		expect(badge.bounds).toEqual({ x: 300, y: 4, width: 16, height: 16 });
		// The position is the offset from the anchor, and is left as authored.
		expect(badge.x).toBe(0);
	});

	it('draws an anchored child where layout placed it, as the hit test sees it', () => {
		const card = stack({ x: 10, y: 20, width: 200, height: 100 });
		const badge = box(16, 16, 0, { id: 'badge', positioned: 'absolute', anchor: 'bottomRight' });
		card.addChild(badge);
		layOut(card);

		const backend = new RecordingBackend({ maxFrames: 1 });
		const api = new DrawApi({ backend, strict: true });
		api.beginFrame({ viewport: { width: 800, height: 600 }, ratio: 1 });
		renderTree(card, api);
		api.endFrame();
		const drawn = backend.commands.find((command) => command.id === 'badge');

		expect(drawn?.transform).toEqual([1, 0, 0, 1, 194, 104]);
		expect(drawn?.transform).toEqual(badge.screenMatrix);
		expect(badge.containsScreenPoint(200, 110)).toBe(true);
	});

	it('routes a click on an anchored child to it, through the dispatcher', () => {
		const context = createTestContext();
		const card = stack({ x: 10, y: 20, width: 200, height: 100 });
		const badge = box(16, 16, 0, { id: 'badge', positioned: 'absolute', anchor: 'bottomRight', margin: 2 });
		card.addChild(badge);
		layOut(card, context);

		const clicks: string[] = [];
		badge.onClick = () => clicks.push('badge');
		const press = (phase: 'down' | 'up', x: number, y: number) => context.dispatcher.enqueue({
			kind: 'pointer', phase, x, y, pointerId: 1, pointerType: 'mouse', isPrimary: true,
			button: 0, buttons: phase === 'down' ? 1 : 0, pressure: phase === 'down' ? 0.5 : 0, modifiers: NO_MODIFIERS,
		});

		// Content box: card origin (10, 20) + (200 - 20, 100 - 20) + margin 2.
		expect(context.dispatcher.hitTest({ x: 200, y: 110 })).toBe(badge);
		// Where `position` alone would put it, at the card's top-left, is
		// nothing: the card is a passthrough container.
		expect(context.dispatcher.hitTest({ x: 14, y: 24 })).toBeNull();
		press('down', 200, 110);
		press('up', 200, 110);
		context.dispatcher.dispatchPending();

		expect(clicks).toEqual(['badge']);
		expect(badge.screenBounds).toEqual({ x: 192, y: 102, width: 16, height: 16 });

		// The snapshot places it from the same origin.
		const node = treeSnapshot([card], { width: 800, height: 600 }).roots[0].children[0];
		expect(node.screenBounds).toEqual({ x: 192, y: 102, w: 16, h: 16 });
		expect(node.bounds).toEqual({ x: 180, y: 80, w: 20, h: 20 });
		expect(treeSnapshot([card], { width: 800, height: 600 }).roots[0].stack).toEqual({ direction: 'vertical', gap: 0 });
	});

	it('places by anchor and a separate pivot, plus the offset', () => {
		const panel = stack({ width: 400, height: 200 });
		const button = box(80, 30, 0, { positioned: 'absolute', anchor: 'right', pivot: 'right', x: -10 });
		const centred = box(100, 40, 0, { positioned: 'absolute', anchor: 'center' });
		const hanging = box(20, 20, 0, { positioned: 'absolute', anchor: 'bottomLeft', pivot: 'topLeft' });
		panel.addChild(button).addChild(centred).addChild(hanging);
		layOut(panel);

		expect(button.bounds.x).toBe(310);
		expect(button.bounds.y).toBe(85);
		expect(centred.bounds).toEqual({ x: 150, y: 80, width: 100, height: 40 });
		expect(hanging.bounds.y).toBe(200);
		// Offset changes do not invalidate layout (R8.18) and still move it.
		button.x = -20;
		expect(button.bounds.x).toBe(300);
	});

	it('anchors the children of a plain container too, at the default top-left with no shift', () => {
		const root = new Layer({ width: 300, height: 200 });
		const plain = box(40, 40, 0, { x: 12, y: 8 });
		const corner = box(40, 40, 0, { anchor: 'bottomRight' });
		root.addChild(plain).addChild(corner);
		layOut(root);

		expect(plain.bounds).toEqual({ x: 12, y: 8, width: 40, height: 40 });
		expect(corner.bounds).toEqual({ x: 260, y: 160, width: 40, height: 40 });
	});

	it('anchors inside a padded panel\'s padding', () => {
		const panel = new Panel({ width: 300, height: 200, padding: 10 });
		const corner = box(20, 20, 0, { anchor: 'bottomRight' });
		panel.addChild(corner);
		layOut(panel);

		expect(corner.bounds).toEqual({ x: 260, y: 160, width: 20, height: 20 });
		expect(corner.screenBounds).toEqual({ x: 270, y: 170, width: 20, height: 20 });
	});

	it('sizes absolute fill children to the content box', () => {
		const layout = stack({ width: 200, height: 100, padding: 10 });
		const scrim = box(0, 0, 0, { positioned: 'absolute', widthMode: 'fill', heightMode: 'fill' });
		layout.addChild(scrim);
		layOut(layout);

		expect(scrim.bounds).toEqual({ x: 10, y: 10, width: 180, height: 80 });
	});

	it('invalidates up to a hug ancestor and stops at a fixed boundary (R10.18, R8.18)', () => {
		const screen = new Layer({ width: 800, height: 600 });
		const panel = stack({ width: 400, height: 300 });
		const inner = stack();
		const leaf = box(50, 30, 0, { heightMode: 'hug' });
		inner.addChild(leaf);
		panel.addChild(inner);
		screen.addChild(panel);
		const context = layOut(screen);

		const panelLayouts: number[] = [];
		const screenLayouts: number[] = [];
		const panelChildren = jest.spyOn(panel as unknown as { layoutChildren(): void }, 'layoutChildren');
		const screenChildren = jest.spyOn(screen as unknown as { layoutChildren(): void }, 'layoutChildren');

		leaf.height = 60;
		layOut(screen, context);
		panelLayouts.push(panelChildren.mock.calls.length);
		screenLayouts.push(screenChildren.mock.calls.length);

		expect(inner.height).toBe(60);
		// The fixed panel is the boundary: it lays out, the screen above it does not.
		expect(panelLayouts).toEqual([1]);
		expect(screenLayouts).toEqual([0]);
	});

	it('lets a hug stack in a plain container size itself and be anchored at its new size', () => {
		const root = new Layer({ width: 300, height: 200 });
		const toolbar = stack({ direction: 'horizontal', gap: 4, anchor: 'bottomRight' });
		toolbar.addChild(box(40, 20)).addChild(box(40, 20));
		root.addChild(toolbar);
		layOut(root);

		expect(toolbar.bounds).toEqual({ x: 216, y: 180, width: 84, height: 20 });
	});
});

describe('Stack roots sized from the viewport (R8.21, R10.16)', () => {
	it('fills the viewport and re-lays out through the same path on a resize', () => {
		const viewport = { logical: { width: 1280, height: 720 } };
		const context = createTestContext({ viewport });
		const root = stack({ widthMode: 'fill', heightMode: 'fill' });
		const bands = [25, 40, 20, 5].map((fillWeight) => box(0, 0, 0, { widthMode: 'fill', heightMode: 'fill', fillWeight }));
		bands.forEach((band) => root.addChild(band));
		const log = jest.fn();
		root.onLayout = log;
		layOut(root, context);

		expect(root.width).toBe(1280);
		expect(root.height).toBe(720);
		expect(bands.map((band) => band.height)).toEqual([200, 320, 160, 40]);
		expect(bands[3].width).toBe(1280);

		viewport.logical = { width: 1440, height: 900 };
		context.frame.viewportChanged();
		expect(context.frame.layoutPending).toBe(true);
		context.frame.layout();

		expect(root.width).toBe(1440);
		expect(bands.map((band) => band.height)).toEqual([250, 400, 200, 50]);
		expect(bands[0].width).toBe(1440);
		expect(log).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1440, height: 900 });
	});

	it('leaves fixed roots alone on a viewport change', () => {
		const context = createTestContext();
		const root = new Layer({ width: 300, height: 200 });
		layOut(root, context);

		context.frame.viewportChanged();

		expect(context.frame.layoutPending).toBe(false);
		expect(root.width).toBe(300);
	});
});

describe('Stack relayout boundaries (R8.18)', () => {
	it('is a boundary only when both axes are fixed', () => {
		const probe = (layout: Stack): boolean => (layout as unknown as { isRelayoutBoundary: boolean }).isRelayoutBoundary;

		expect(probe(stack({ width: 10, height: 10 }))).toBe(true);
		expect(probe(stack({ width: 10 }))).toBe(false);
		expect(probe(stack({ width: 10, height: 10, widthMode: 'fill' }))).toBe(false);
	});

	it('invalidates on every layout property it has', () => {
		const layout = stack({ width: 100, height: 100 });
		const context = layOut(layout);
		const changes: ((target: Stack) => void)[] = [
			(target) => { target.gap = 3; },
			(target) => { target.padding = 2; },
			(target) => { target.direction = 'horizontal'; },
			(target) => { target.distribution = 'end'; },
			(target) => { target.crossAlign = 'center'; },
		];
		for (const change of changes) {
			change(layout);
			expect(context.frame.layoutPending).toBe(true);
			context.frame.layout();
		}
	});
});

describe('Stack shrink-to-fit reaches nested stacks (R10.7)', () => {
	/** A leaf that reflows like text: min content 10, height area / width. */
	class Reflowing extends Component {
		constructor(private readonly area: number, private readonly intrinsic: number, options: ComponentOptions = {}) {
			super({ width: intrinsic, height: area / intrinsic, widthMode: 'hug', heightMode: 'hug', ...options });
		}

		public measure(availableWidth: number, _availableHeight: number, definite: Axis | null = null): Size {
			const width = definite === 'width' ? availableWidth : Math.max(10, Math.min(this.intrinsic, availableWidth));
			return { width, height: this.area / Math.max(width, 1e-9) };
		}

		public minContentSize(axis: Axis): number {
			return axis === 'width' ? 10 : super.minContentSize(axis);
		}

		public assignSize(width: number, height: number): void {
			super.assignSize(width, Number.isNaN(width) ? height : this.area / Math.max(width, 1e-9));
		}
	}

	it.each(['start', 'center', 'end'] as const)('narrows a hug row in a %s-aligned 100 px column, and its content reflows', (crossAlign) => {
		const column = stack({ width: 100, crossAlign });
		const row = stack({ direction: 'horizontal' });
		const icon = box(20, 20);
		const label = new Reflowing(3000, 300);
		row.addChild(icon).addChild(label);
		column.addChild(row);
		layOut(column);

		expect(row.width).toBe(100);
		expect(label.width).toBe(80);
		expect(label.height).toBe(3000 / 80);
		expect(row.height).toBe(3000 / 80);
		expect(column.height).toBe(3000 / 80);
		expect(label.x).toBe(20);
	});

	it('narrows a fill child of a hug row the same way', () => {
		const column = stack({ width: 100 });
		const row = stack({ direction: 'horizontal' });
		const label = new Reflowing(3000, 300, { widthMode: 'fill' });
		row.addChild(box(20, 20)).addChild(label);
		column.addChild(row);
		layOut(column);

		expect(row.width).toBe(100);
		expect(label.width).toBe(80);
	});

	it('shrinks siblings in proportion to their size, and stops each at its minimum content', () => {
		const row = stack({ width: 100, height: 40, direction: 'horizontal' });
		const wide = new Reflowing(600, 150);
		const narrow = new Reflowing(600, 50);
		row.addChild(wide).addChild(narrow);
		layOut(row);
		// 200 wanted, 100 there: each gives half.
		expect(wide.width).toBe(75);
		expect(narrow.width).toBe(25);

		const tight = stack({ width: 40, height: 40, direction: 'horizontal' });
		const first = new Reflowing(600, 150);
		const second = new Reflowing(600, 50);
		tight.addChild(first).addChild(second);
		layOut(tight);
		// Floors of 10 each: the row overflows rather than going below them.
		expect(first.width).toBe(30);
		expect(second.width).toBe(10);
	});

	it('leaves a row that fits alone, and fixed children are never shrunk', () => {
		const column = stack({ width: 400 });
		const row = stack({ direction: 'horizontal' });
		const label = new Reflowing(3000, 300);
		row.addChild(box(20, 20)).addChild(label);
		column.addChild(row);
		layOut(column);
		expect(row.width).toBe(320);
		expect(label.width).toBe(300);

		const cramped = stack({ width: 30, direction: 'horizontal' });
		const fixed = box(50, 20);
		cramped.addChild(fixed);
		layOut(cramped);
		expect(fixed.width).toBe(50);
	});

	it('reports the minimum content of nested stacks', () => {
		const row = stack({ direction: 'horizontal', gap: 4, padding: 2 });
		row.addChild(box(20, 20)).addChild(new Reflowing(3000, 300));
		const column = stack({ padding: 1 });
		column.addChild(row).addChild(box(50, 10));

		expect(row.minContentSize('width')).toBe(20 + 4 + 10 + 4);
		expect(column.minContentSize('width')).toBe(50 + 2);
	});
});

describe('Stack measurement cost', () => {
	/** A binary tree of hug stacks, alternating direction, with hug leaves. */
	function tree(depth: number, leaves: Rectangle[], vertical = true): Stack {
		const node = stack({ direction: vertical ? 'vertical' : 'horizontal', gap: 1 });
		for (let index = 0; index < 2; index++) {
			if (depth <= 1) {
				const leaf = box(10, 10, 0, { widthMode: 'hug', heightMode: 'hug' });
				leaves.push(leaf);
				node.addChild(leaf);
			} else {
				node.addChild(tree(depth - 1, leaves, !vertical));
			}
		}
		return node;
	}

	it('lays out eight levels of nested hug stacks in linear measurements', () => {
		const leaves: Rectangle[] = [];
		const root = tree(8, leaves);
		const measures = jest.spyOn(Stack.prototype as unknown as { computeMeasure(): Size }, 'computeMeasure');

		const context = layOut(root);

		// 255 stacks. Uncached this was N squared (65,025 at this size). The
		// call count is the bound, not wall-clock time, which flakes on a
		// loaded runner (DDB-213).
		expect(measures.mock.calls.length).toBeLessThan(255 * 8);

		measures.mockClear();
		leaves[0].height = 12;
		layOut(root, context);
		// One leaf changed: only its ancestors measure again.
		expect(measures.mock.calls.length).toBeLessThan(8 * 8);
		expect(root.height).toBeGreaterThan(0);
		measures.mockRestore();
	});
});

describe('Stack sizes it assigns and authors (review)', () => {
	it('fires onResized when layout assigns a new size, and not when it assigns the same one', () => {
		class Resizing extends Layer {
			public resizes = 0;

			protected onResized(): void {
				this.resizes += 1;
			}
		}
		const row = stack({ width: 300, height: 40, direction: 'horizontal' });
		const band = new Resizing({ widthMode: 'fill', height: 40 });
		row.addChild(band);
		const context = layOut(row);
		expect(band.width).toBe(300);
		expect(band.resizes).toBe(1);

		row.gap = 0;
		row.invalidateLayout();
		layOut(row, context);
		expect(band.resizes).toBe(1);

		row.width = 200;
		layOut(row, context);
		expect(band.resizes).toBe(2);
	});

	it('fixes an axis given a size through setSize or the accessors, and hugs again at zero', () => {
		const layout = stack();
		layout.addChild(box(10, 10));
		layout.setSize(300, 200);
		expect(layout.widthMode).toBe('fixed');
		expect(layout.heightMode).toBe('fixed');
		const context = layOut(layout);
		expect(layout.bounds).toEqual({ x: 0, y: 0, width: 300, height: 200 });

		layout.width = 0;
		layOut(layout, context);
		expect(layout.widthMode).toBe('hug');
		expect(layout.width).toBe(10);
		expect(layout.height).toBe(200);

		const fill = stack({ widthMode: 'fill' });
		fill.width = 0;
		expect(fill.widthMode).toBe('fill');
	});

	it('invalidates when a given size changes even if an assignment already matches it', () => {
		const column = stack({ width: 200, height: 100, crossAlign: 'stretch' });
		const child = box(50, 30, 0, { widthMode: 'hug' });
		column.addChild(child);
		const context = layOut(column);
		expect(child.width).toBe(200);

		// The given width becomes 200, the stretched width it already has.
		child.width = 200;
		column.crossAlign = 'start';
		layOut(column, context);
		expect(child.width).toBe(200);
	});
});

describe('Stack reorders (R10.18)', () => {
	it('re-lays out when a child moves', () => {
		const column = stack({ width: 100, height: 200 });
		const first = box(50, 30);
		const second = box(50, 40);
		column.addChild(first).addChild(second);
		const context = layOut(column);
		expect([first.y, second.y]).toEqual([0, 30]);

		column.moveChild(second, 0);
		expect(context.frame.layoutPending).toBe(true);
		layOut(column, context);
		expect([second.y, first.y]).toEqual([0, 40]);

		// A move to where it already is changes nothing and schedules nothing.
		column.moveChild(second, 0);
		expect(context.frame.layoutPending).toBe(false);
	});

	it('re-lays out after a keyed reorder, a, b to b, a', () => {
		const column = stack({ width: 100, height: 200 });
		const heights: Record<string, number> = { a: 30, b: 40 };
		const reconcile = (keys: string[]) => column.reconcileChildren(keys, {
			key: (key) => key,
			create: (key) => box(50, heights[key], 0, { id: key }),
		});
		reconcile(['a', 'b']);
		const context = layOut(column);
		const a = column.findById('a') as Component;
		const b = column.findById('b') as Component;
		expect([a.y, b.y]).toEqual([0, 30]);

		reconcile(['b', 'a']);
		layOut(column, context);

		expect(column.findById('a')).toBe(a);
		expect([b.y, a.y]).toEqual([0, 40]);
	});
});
