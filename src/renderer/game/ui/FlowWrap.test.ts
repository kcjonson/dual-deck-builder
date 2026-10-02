import { Container } from '../../engine/components/Container';
import type { MountContext } from '../../engine/components/MountContext';
import { Stack } from '../../engine/components/Stack';
import { createTestContext } from '../../engine/components/testing';
import { FlowWrap } from './FlowWrap';

let context: MountContext;
let root: Container;

beforeEach(() => {
	context = createTestContext();
	root = new Container({ id: 'root', width: 800, height: 600 });
	root.mount(context);
});

afterEach(() => {
	root.unmount();
});

/** `count` 50 by 70 boxes, a mini card's size. */
function items(flow: FlowWrap, count: number, width = 50, height = 70): Container[] {
	const made = Array.from({ length: count }, () => new Container({ width, height }));
	made.forEach((item) => flow.addChild(item));
	return made;
}

/** A fixed-width column holding the flow, as a panel holds the deck. */
function column(width: number, flow: FlowWrap): Stack {
	const stack = new Stack({ width, crossAlign: 'stretch' });
	stack.addChild(flow);
	root.addChild(stack);
	context.frame.layout();
	return stack;
}

describe('FlowWrap', () => {
	it('places items left to right and wraps when the next would pass the width', () => {
		const flow = new FlowWrap({ gap: 10 });
		const boxes = items(flow, 5);
		column(200, flow);
		// 50 + 10 + 50 + 10 + 50 = 170 fits; a fourth would reach 230
		expect(boxes.map((box) => [box.x, box.y])).toEqual([[0, 0], [60, 0], [120, 0], [0, 80], [60, 80]]);
		expect(flow.height).toBe(150);
	});

	it('centres each row across the width when asked', () => {
		const flow = new FlowWrap({ gap: 10, justify: 'center' });
		const boxes = items(flow, 4);
		column(200, flow);
		expect(boxes.map((box) => box.x)).toEqual([15, 75, 135, 75]);
	});

	it('reflows to more rows, and a taller box, when its column narrows', () => {
		const flow = new FlowWrap({ gap: 10 });
		items(flow, 6);
		const stack = column(400, flow);
		expect(flow.height).toBe(70);
		stack.setSize(130, 0);
		context.frame.layout();
		expect(flow.height).toBe(3 * 70 + 2 * 10);
		expect(stack.height).toBe(flow.height);
	});

	it('gives an item wider than the box a row of its own', () => {
		const flow = new FlowWrap({ gap: 10, rowGap: 4 });
		items(flow, 1, 50, 20);
		items(flow, 1, 300, 20);
		items(flow, 1, 50, 20);
		column(200, flow);
		expect(flow.children.map((item) => item.y)).toEqual([0, 24, 48]);
	});

	it('takes the row of a newly added item on the next layout', () => {
		const flow = new FlowWrap({ gap: 10 });
		items(flow, 3);
		column(200, flow);
		expect(flow.height).toBe(70);
		items(flow, 1);
		context.frame.layout();
		expect(flow.height).toBe(150);
	});

	it('hugs its rows outside a stack', () => {
		const flow = new FlowWrap({ gap: 10 });
		items(flow, 3);
		root.addChild(flow);
		context.frame.layout();
		expect([flow.width, flow.height]).toEqual([170, 70]);
	});

	it('places and wraps items by their margin boxes', () => {
		const flow = new FlowWrap({ gap: 10 });
		const plain = items(flow, 1);
		const spaced = new Container({ width: 50, height: 70, margin: { left: 5, right: 15, top: 4, bottom: 6 } });
		flow.addChild(spaced);
		const after = items(flow, 2);
		column(200, flow);
		// 50 + 10 + (5 + 50 + 15) + 10 + 50 = 190 fits; the next would reach 250
		expect(plain[0].x).toBe(0);
		expect([spaced.x, spaced.y]).toEqual([60, 0]);
		expect([spaced.originX, spaced.originY]).toEqual([65, 4]);
		expect(after.map((box) => [box.x, box.y])).toEqual([[140, 0], [0, 90]]);
		expect(flow.height).toBe(80 + 10 + 70);
	});

	it('reflows at its maxSize width outside a stack, and the height follows the rows', () => {
		const flow = new FlowWrap({ gap: 10, maxSize: { width: 120 } });
		const boxes = items(flow, 3);
		root.addChild(flow);
		context.frame.layout();
		// Two fit in 120 (50 + 10 + 50); the third starts a row at 80
		expect([flow.width, flow.height]).toEqual([120, 150]);
		expect(boxes[2].y + boxes[2].height).toBe(150);
	});

	it('holds to its minSize outside a stack', () => {
		const flow = new FlowWrap({ gap: 10, minSize: { width: 200, height: 100 } });
		items(flow, 2);
		root.addChild(flow);
		context.frame.layout();
		expect([flow.width, flow.height]).toEqual([200, 100]);
	});
});
