import type { Rect } from '../draw/geometry';
import { Component } from './Component';
import { Container } from './Container';
import type { MountContext } from './MountContext';
import { Rectangle } from './Rectangle';
import { Text } from './Text';
import { createTestContext } from './testing';
import { createMeasuringDrawApi } from '../text/testing';

/** Records its lifecycle calls into a shared log, so order across a tree is visible. */
class Probe extends Container {
	public updates: number[] = [];
	public layouts = 0;

	constructor(private readonly log: string[], id: string) {
		super({ id, width: 10, height: 10 });
	}

	protected onMount(_context: MountContext): void {
		this.log.push(`mount ${this.id}`);
	}

	protected onUnmount(): void {
		this.log.push(`unmount ${this.id}`);
	}

	public update(dt: number): void {
		this.updates.push(dt);
	}

	protected layoutChildren(): void {
		this.layouts += 1;
	}
}

/** A mounted root is one the dispatcher hit-tests (R9.4). */
function registered(context: MountContext, component: Component): boolean {
	return context.dispatcher.roots.includes(component);
}

describe('mount and unmount (R8.14, R8.15)', () => {
	it('touches no service before mount, registers on mount, and releases on unmount', () => {
		const context = createTestContext();
		const register = jest.spyOn(context.dispatcher, 'addRoot');
		const log: string[] = [];
		const probe = new Probe(log, 'probe');

		expect(register).not.toHaveBeenCalled();
		expect(probe.isMounted).toBe(false);
		expect(probe.context).toBeNull();

		probe.mount(context);
		expect(register).toHaveBeenCalledTimes(1);
		expect(registered(context, probe)).toBe(true);
		expect(probe.context).toBe(context);

		probe.unmount();
		expect(registered(context, probe)).toBe(false);
		expect(probe.isMounted).toBe(false);
	});

	it('mounts top-down and unmounts bottom-up, once each', () => {
		const context = createTestContext();
		const log: string[] = [];
		const root = new Probe(log, 'root');
		const child = new Probe(log, 'child');
		const grandchild = new Probe(log, 'grandchild');
		root.addChild(child);
		child.addChild(grandchild);

		root.mount(context);
		root.mount(context);
		root.unmount();
		root.unmount();

		expect(log).toEqual([
			'mount root', 'mount child', 'mount grandchild',
			'unmount grandchild', 'unmount child', 'unmount root',
		]);
	});

	it('mounts a child added to a mounted parent at once, and unmounts one removed', () => {
		const context = createTestContext();
		const log: string[] = [];
		const root = new Probe(log, 'root');
		root.mount(context);

		const late = new Probe(log, 'late');
		root.addChild(late);
		expect(late.isMounted).toBe(true);

		root.removeChild(late);
		expect(late.isMounted).toBe(false);
		expect(log).toEqual(['mount root', 'mount late', 'unmount late']);
	});

	it('moves within a root without remounting, and unmounts first across roots (R8.5)', () => {
		const context = createTestContext();
		const log: string[] = [];
		const root = new Probe(log, 'root');
		const left = new Probe(log, 'left');
		const right = new Probe(log, 'right');
		const card = new Probe(log, 'card');
		root.addChild(left).addChild(right);
		left.addChild(card);
		root.mount(context);
		log.length = 0;

		right.addChild(card);
		expect(log).toEqual([]);
		expect(card.isMounted).toBe(true);

		const elsewhere = new Probe(log, 'elsewhere');
		elsewhere.addChild(card);
		expect(log).toEqual(['unmount card']);
		expect(card.isMounted).toBe(false);
	});
});

describe('update on request (R8.17)', () => {
	it('updates only what asked, once per request', () => {
		const context = createTestContext();
		const log: string[] = [];
		const root = new Probe(log, 'root');
		const asker = new Probe(log, 'asker');
		root.addChild(asker);
		root.mount(context);

		context.frame.update(0.016);
		expect(asker.updates).toEqual([]);

		asker.requestUpdate();
		context.frame.update(0.016);
		context.frame.update(0.02);
		expect(asker.updates).toEqual([0.016]);
		expect(root.updates).toEqual([]);
	});

	it('holds the request of an invisible component and drops an unmounted one', () => {
		const context = createTestContext();
		const log: string[] = [];
		const root = new Probe(log, 'root');
		const hidden = new Probe(log, 'hidden');
		const leaving = new Probe(log, 'leaving');
		root.addChild(hidden).addChild(leaving);
		root.mount(context);

		hidden.visible = false;
		hidden.requestUpdate();
		leaving.requestUpdate();
		root.removeChild(leaving);

		context.frame.update(0.016);
		expect(hidden.updates).toEqual([]);
		expect(leaving.updates).toEqual([]);

		hidden.visible = true;
		context.frame.update(0.02);
		expect(hidden.updates).toEqual([0.02]);
	});

	it('ignores a request made before mount', () => {
		const context = createTestContext();
		const probe = new Probe([], 'probe');
		probe.requestUpdate();
		probe.mount(context);

		context.frame.update(0.016);

		expect(probe.updates).toEqual([]);
	});
});

describe('upward invalidation and the layout phase (R8.16, R8.18)', () => {
	function mounted(): { context: MountContext; root: Probe; panel: Probe; label: Text } {
		const context = createTestContext();
		const root = new Probe([], 'root');
		const panel = new Probe([], 'panel');
		const label = new Text('score', { width: 40, height: 12 });
		root.addChild(panel);
		panel.addChild(label);
		root.mount(context);
		context.frame.layout();
		root.layouts = 0;
		panel.layouts = 0;
		return { context, root, panel, label };
	}

	it('marks the relayout boundary when text changes and lays it out once', () => {
		const { context, root, panel, label } = mounted();

		label.text = 'score: 12';
		label.text = 'score: 13';
		expect(context.frame.layoutPending).toBe(true);

		context.frame.layout();
		expect(panel.layouts).toBe(1);
		expect(root.layouts).toBe(0);
		expect(context.frame.layoutPending).toBe(false);
	});

	it('does not run layout for a transform, a zIndex, an opacity, or a colour', () => {
		const { context, label } = mounted();
		const box = new Rectangle({ width: 5, height: 5 });
		label.parent?.addChild(box);
		context.frame.layout();

		box.transform = { rotate: 0.3 };
		box.zIndex = 2;
		box.opacity = 0.5;
		box.fillColor = '#ff0000';
		label.color = '#00ff00';

		expect(context.frame.layoutPending).toBe(false);
	});

	it('invalidates on size, margin and visibility', () => {
		const { context, label } = mounted();

		for (const change of [
			() => label.setSize(50, 12),
			() => { label.margin = 2; },
			() => { label.visible = false; },
		]) {
			change();
			expect(context.frame.layoutPending).toBe(true);
			context.frame.layout();
		}
	});

	it('fires onLayout once on the first layout after mount, then only when bounds change (R8.21)', () => {
		const context = createTestContext();
		const seen: Rect[] = [];
		const root = new Container({ width: 100, height: 100 });
		const child = new Rectangle({ x: 5, y: 6, width: 10, height: 10, onLayout: (bounds) => seen.push(bounds) });
		root.addChild(child);
		root.mount(context);

		context.frame.layout();
		context.frame.layout();
		expect(seen).toEqual([{ x: 5, y: 6, width: 10, height: 10 }]);

		child.setSize(20, 10);
		context.frame.layout();
		expect(seen).toHaveLength(2);
		expect(seen[1].width).toBe(20);
	});

	it('lays out before a hit test, so the pointer sees the latest geometry', () => {
		const context = createTestContext();
		const root = new Probe([], 'root');
		root.mount(context);
		context.frame.layout();
		root.layouts = 0;

		root.setSize(20, 20);
		context.dispatcher.hitTest({ x: 15, y: 15 });

		expect(root.layouts).toBe(1);
		expect(context.frame.layoutPending).toBe(false);
	});
});

describe('hugging containers and the layout passes (R8.18)', () => {
	/** Hugs its label: not a relayout boundary, and sizes itself from the label in the layout phase. */
	class Chip extends Container {
		public readonly label: Text;

		constructor(text: string) {
			super({ height: 20 });
			this.label = new Text(text, { style: { fontSize: 14 } });
			this.addChild(this.label);
		}

		protected get isRelayoutBoundary(): boolean {
			return false;
		}

		protected layoutChildren(): void {
			this.setSize(this.label.width + 8, 20);
		}
	}

	/** Places its chips in a row from their widths, as a hand-placed row reads its measured children. */
	class Row extends Container {
		public passes = 0;

		constructor(public readonly chips: Chip[]) {
			super({ width: 800, height: 20 });
			for (const chip of chips) this.addChild(chip);
		}

		protected layoutChildren(): void {
			this.passes += 1;
			let x = 0;
			for (const chip of this.chips) {
				chip.setPosition(x, 0);
				x += chip.width + 4;
			}
		}
	}

	it('propagates a change through a hugging child to the row, and settles in one layout call', () => {
		const context = createTestContext({ draw: createMeasuringDrawApi().api });
		const row = new Row([new Chip('Fuel'), new Chip('Scrap')]);
		const root = new Container({ width: 800, height: 600 });
		root.addChild(row);
		root.mount(context);
		context.frame.layout();

		const [first, second] = row.chips;
		expect(first.width).toBe(first.label.width + 8);
		expect(second.x).toBe(first.width + 4);

		const before = second.x;
		first.label.text = 'Fuel reserves';
		context.frame.layout();

		expect(context.frame.layoutPending).toBe(false);
		expect(first.width).toBe(first.label.width + 8);
		expect(second.x).toBe(first.width + 4);
		expect(second.x).toBeGreaterThan(before);
		// The row laid out from the chip's old width, the chip's new width
		// re-marked it, and a second pass placed the chips again.
		expect(row.passes).toBeGreaterThanOrEqual(2);
	});

	it('throws rather than hangs when layout keeps invalidating itself', () => {
		const context = createTestContext();
		const restless = new Container({ width: 10, height: 10 });
		restless.onLayout = () => restless.setSize(restless.width + 1, 10);
		restless.mount(context);

		expect(() => context.frame.layout()).toThrow('still invalid after 8 passes');
		expect(context.frame.layoutPending).toBe(false);
	});
});
