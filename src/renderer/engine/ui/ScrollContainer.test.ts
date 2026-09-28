/**
 * @jest-environment jsdom
 */
import { Clock } from '../animation/Clock';
import type { Component } from '../components/Component';
import { Layer } from '../components/Layer';
import type { MountContext } from '../components/MountContext';
import { Rectangle } from '../components/Rectangle';
import { renderTree } from '../components/renderTree';
import { Stack } from '../components/Stack';
import { createTestContext, injectNow } from '../components/testing';
import type { DrawCommand, RectCommand } from '../draw';
import { NO_MODIFIERS } from '../input/events';
import { PointerAdapter } from '../input/PointerAdapter';
import type { PopupCloseReason } from '../services/PopupService';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../text/testing';
import { tokens } from '../theme/tokens';
import { Input } from './Input';
import { SCROLLBAR_GUTTER, Scrollbar } from './Scrollbar';
import { ScrollContainer, ScrollContainerOptions } from './ScrollContainer';

/**
 * R12.20's scroll container and R12.37's scrollbar. The first block ports
 * worldsim's ScrollContainer suite (max scroll, clamping, a resized viewport
 * re-clamping); the rest drive it through injected input on a mounted root
 * (R9.25): wheel latching, keys, the scrollbar's drag and track press,
 * focus, scrollIntoView, the gutter, and closing a popup anchored inside.
 */

let canvas: HTMLCanvasElement;
let context: MountContext;
let adapter: PointerAdapter;
let root: Layer;
let backend: MeasuringRecordingBackend;

function inject(...commands: string[]): void {
	expect(injectNow({ canvas, dispatcher: context.dispatcher }, commands).ok).toBe(true);
}

function key(name: string): void {
	context.dispatcher.enqueue({ kind: 'key', phase: 'down', key: name, repeat: false, modifiers: NO_MODIFIERS });
	context.dispatcher.enqueue({ kind: 'key', phase: 'up', key: name, repeat: false, modifiers: NO_MODIFIERS });
	context.dispatcher.dispatchPending();
}

beforeEach(() => {
	canvas = document.createElement('canvas');
	document.body.appendChild(canvas);
	const measuring = createMeasuringDrawApi();
	backend = measuring.backend;
	context = createTestContext({ draw: measuring.api, clock: new Clock() });
	adapter = new PointerAdapter({ dispatcher: context.dispatcher });
	adapter.attach(canvas);
	root = new Layer({ id: 'root', width: 800, height: 600 });
	root.mount(context);
});

afterEach(() => {
	root.unmount();
	adapter.detach();
	document.body.removeChild(canvas);
});

/** A 200 by 300 scroller at (50, 50) over a content layer `contentHeight` tall. */
function mounted(contentHeight: number, options: ScrollContainerOptions = {}): { scroll: ScrollContainer; content: Layer } {
	const scroll = new ScrollContainer({ id: 'scroll', x: 50, y: 50, width: 200, height: 300, ...options });
	const content = new Layer({ id: 'content', width: 200, height: contentHeight });
	scroll.addChild(content);
	root.addChild(scroll);
	context.frame.layout();
	return { scroll, content };
}

/** A column of `count` rows `pitch` tall, as a hug stack. */
function rows(count: number, pitch = 40): { stack: Stack; items: Rectangle[] } {
	const stack = new Stack({ id: 'rows' });
	const items = Array.from({ length: count }, (_unused, index) => new Rectangle({ id: `row_${index}`, height: pitch, widthMode: 'fill' }));
	items.forEach((item) => stack.addChild(item));
	return { stack, items };
}

describe('ScrollContainer bounds (worldsim suite)', () => {
	it('starts at zero with nothing to scroll', () => {
		const scroll = new ScrollContainer({ width: 200, height: 300 });
		expect(scroll.scrollPosition).toBe(0);
		expect(scroll.maxScroll).toBe(0);
		expect(scroll.scrollHeight).toBe(0);
	});

	it('has no max scroll when the content fits', () => {
		const { scroll } = mounted(100);
		expect(scroll.maxScroll).toBe(0);
		expect(scroll.scrollHeight).toBe(100);
		expect(scroll.overflows).toBe(false);
	});

	it('scrolls the content less the viewport when it overflows', () => {
		const { scroll } = mounted(500);
		expect(scroll.maxScroll).toBe(200);
		expect(scroll.overflows).toBe(true);
	});

	it('scrolls to a position, clamped at both ends', () => {
		const { scroll } = mounted(500);
		scroll.scrollTo(100);
		expect(scroll.scrollPosition).toBe(100);
		scroll.scrollTo(300);
		expect(scroll.scrollPosition).toBe(200);
		scroll.scrollTo(-50);
		expect(scroll.scrollPosition).toBe(0);
	});

	it('scrolls by a delta, and to the top and the bottom', () => {
		const { scroll } = mounted(500);
		scroll.scrollTo(50);
		scroll.scrollBy(25);
		expect(scroll.scrollPosition).toBe(75);
		scroll.scrollBy(-30);
		expect(scroll.scrollPosition).toBe(45);
		scroll.scrollToBottom();
		expect(scroll.scrollPosition).toBe(200);
		scroll.scrollToTop();
		expect(scroll.scrollPosition).toBe(0);
	});

	it('re-clamps when the viewport grows', () => {
		const { scroll } = mounted(500);
		scroll.scrollToBottom();
		scroll.setSize(200, 400);
		context.frame.layout();
		expect(scroll.maxScroll).toBe(100);
		expect(scroll.scrollPosition).toBe(100);
	});

	it('contains points in its viewport only, half-open', () => {
		const { scroll } = mounted(500);
		expect(scroll.containsScreenPoint(50, 50)).toBe(true);
		expect(scroll.containsScreenPoint(249, 349)).toBe(true);
		expect(scroll.containsScreenPoint(250, 150)).toBe(false);
		expect(scroll.containsScreenPoint(100, 350)).toBe(false);
	});

	it('takes the content height from the child after layout, or from an override', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 200, height: 100 });
		scroll.addChild(rows(10).stack);
		root.addChild(scroll);
		context.frame.layout();
		expect(scroll.scrollHeight).toBe(400);
		scroll.scrollHeight = 1000;
		context.frame.layout();
		expect(scroll.maxScroll).toBe(900);
		scroll.scrollHeight = null;
		context.frame.layout();
		expect(scroll.maxScroll).toBe(300);
	});

	it('scrolls the padding with the content: the extent is content plus both paddings (R4.13)', () => {
		const { scroll, content } = mounted(500, { style: { padding: 10 } });
		expect(scroll.maxScroll).toBe(500 + 20 - 300);
		scroll.scrollToBottom();
		expect(content.screenBounds.y + content.height).toBe(50 + 300 - 10);
	});
});

describe('ScrollContainer layout and paint', () => {
	it('gives the content the full width when it fits and gives up the gutter when it overflows', () => {
		const short = new ScrollContainer({ x: 0, y: 0, width: 200, height: 300 });
		const fits = rows(3);
		short.addChild(fits.stack);
		const tall = new ScrollContainer({ x: 300, y: 0, width: 200, height: 300 });
		const overflows = rows(20);
		tall.addChild(overflows.stack);
		root.addChild(short);
		root.addChild(tall);
		context.frame.layout();
		expect(fits.stack.width).toBe(200);
		expect(overflows.stack.width).toBe(200 - SCROLLBAR_GUTTER);
		expect(short.bar.visible).toBe(false);
		expect(tall.bar.visible).toBe(true);
	});

	it('keeps the scrollbar fixed on screen while the content moves, its thumb following the offset', () => {
		const { scroll } = mounted(600);
		const before = scroll.bar.screenBounds;
		const thumbBefore = scroll.bar.thumb;
		scroll.scrollTo(150);
		expect(scroll.bar.screenBounds).toEqual(before);
		expect(scroll.bar.thumb.start).toBeGreaterThan(thumbBefore.start);
		expect(scroll.bar.thumb.length).toBeCloseTo((300 * 300) / 600);
		scroll.scrollToBottom();
		expect(scroll.bar.thumb.start + scroll.bar.thumb.length).toBeCloseTo(scroll.bar.height);
	});

	it('keeps the thumb at its minimum length over very long content', () => {
		const { scroll } = mounted(100000);
		expect(scroll.bar.thumb.length).toBe(tokens.space.space_6);
	});

	it('draws the scrollbar over the content, clipped with it, and nothing when the content fits', () => {
		const { scroll } = mounted(600);
		const api = context.draw;
		const draw = (): readonly DrawCommand[] => {
			api.beginFrame({ viewport: { width: 800, height: 600 }, ratio: 1 });
			renderTree(root, api);
			api.endFrame();
			return backend.commands;
		};
		const bar = draw().filter((command): command is RectCommand => command.kind === 'rect' && command.id === 'scroll.scrollbar');
		expect(bar).toHaveLength(1);
		scroll.scrollHeight = 100;
		context.frame.layout();
		expect(draw().some((command) => command.id === 'scroll.scrollbar')).toBe(false);
	});

	it('clips inside its border and radius, and into the padding as far as a child\'s ink reaches (R8.8)', () => {
		const boxed = new ScrollContainer({ width: 200, height: 100, style: { borderWidth: 1, borderRadius: 4 } });
		expect(boxed.clipRect).toEqual({ x: 4, y: 4, width: 192, height: 92 });
		const padded = new ScrollContainer({ x: 0, y: 0, width: 200, height: 100, style: { padding: 8 } });
		const inky = new Input('x', { width: 100, height: 30 });
		padded.addChild(inky);
		root.addChild(padded);
		context.frame.layout();
		const ink = inky.inkExtent;
		expect(ink).toBeGreaterThan(0);
		expect(padded.clipRect).toEqual({ x: 8 - ink, y: 8 - ink, width: 200 - 2 * (8 - ink), height: 100 - 2 * (8 - ink) });
	});
});

describe('ScrollContainer input (R9.32, R12.20)', () => {
	it('scrolls by the wheel and consumes it', () => {
		const { scroll } = mounted(600);
		const beneath: number[] = [];
		root.onWheel = () => beneath.push(1);
		inject('scroll,100,100,60');
		expect(scroll.scrollPosition).toBe(60);
		expect(beneath).toEqual([]);
	});

	it('stays latched at its end within a gesture, then passes a new gesture to its parent scroller', () => {
		const outer = new ScrollContainer({ id: 'outer', x: 0, y: 0, width: 400, height: 400 });
		const outerContent = new Layer({ width: 400, height: 1200 });
		const inner = new ScrollContainer({ id: 'inner', x: 0, y: 0, width: 200, height: 200 });
		inner.addChild(new Layer({ width: 200, height: 240 }));
		outerContent.addChild(inner);
		outer.addChild(outerContent);
		root.addChild(outer);
		context.frame.layout();
		inject('scroll,50,50,30', 'scroll,50,50,30');
		expect(inner.scrollPosition).toBe(40);
		context.clock.advance(100);
		inject('scroll,50,50,30');
		expect(outer.scrollPosition).toBe(0);
		context.clock.advance(200);
		inject('scroll,50,50,30');
		expect(outer.scrollPosition).toBe(30);
	});

	it('updates hover under a still pointer when the content moves by code', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 200, height: 100 });
		const list = rows(10);
		scroll.addChild(list.stack);
		root.addChild(scroll);
		context.frame.layout();
		inject('move,50,10');
		expect(list.items[0].hovered).toBe(true);
		scroll.scrollTo(45);
		context.dispatcher.dispatchPending();
		expect(list.items[0].hovered).toBe(false);
		expect(list.items[1].hovered).toBe(true);
	});

	it('is focusable by a press but not a Tab stop (tabIndex -1)', () => {
		const { scroll } = mounted(600);
		expect(scroll.focusable).toBe(true);
		expect(scroll.tabIndex).toBe(-1);
		expect(context.focus.tabOrder).not.toContain(scroll);
		inject('click,100,100');
		expect(scroll.focused).toBe(true);
	});

	it('pages with Page Up and Page Down, and jumps with Home and End, when focused', () => {
		const { scroll } = mounted(2000);
		context.focus.focus(scroll);
		key('PageDown');
		const page = 300 - tokens.space.scroll_step;
		expect(scroll.scrollPosition).toBe(page);
		key('ArrowDown');
		expect(scroll.scrollPosition).toBe(page + tokens.space.scroll_step);
		key('PageUp');
		expect(scroll.scrollPosition).toBe(tokens.space.scroll_step);
		key('End');
		expect(scroll.scrollPosition).toBe(scroll.maxScroll);
		key('Home');
		expect(scroll.scrollPosition).toBe(0);
	});

	it('leaves Home and End to a focused field inside, but pages from it', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 300, height: 100 });
		const column = new Stack({ gap: 400 });
		const field = new Input('text', { width: 200, height: 30 });
		column.addChild(field);
		column.addChild(new Rectangle({ width: 10, height: 400 }));
		scroll.addChild(column);
		root.addChild(scroll);
		context.frame.layout();
		context.focus.focus(field);
		key('End');
		expect(scroll.scrollPosition).toBe(0);
		key('PageDown');
		expect(scroll.scrollPosition).toBeGreaterThan(0);
	});

	it('drags the thumb with the pointer captured, mapping its travel to the scroll range', () => {
		const { scroll } = mounted(600);
		const bar = scroll.bar.screenBounds;
		const x = Math.round(bar.x + bar.width / 2);
		const thumb = scroll.bar.thumb;
		const grab = Math.round(bar.y + thumb.start + thumb.length / 2);
		inject(`move,${x},${grab}`, `down,${x},${grab}`);
		expect(context.dispatcher.captorOf(1)).toBe(scroll.bar);
		expect(scroll.bar.dragging).toBe(true);
		const travel = bar.height - thumb.length;
		inject(`move,${x + 200},${grab + travel / 2}`);
		expect(scroll.scrollPosition).toBeCloseTo(scroll.maxScroll / 2, 0);
		inject(`move,${x},${grab + travel * 3}`, `up,${x},${grab + travel * 3}`);
		expect(scroll.scrollPosition).toBe(scroll.maxScroll);
		expect(context.dispatcher.captorOf(1)).toBeNull();
	});

	it('jumps the thumb to a track press, and neither press takes focus from a field inside (R9.23)', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 300, height: 300 });
		const column = new Stack();
		const field = new Input('text', { width: 200, height: 30 });
		column.addChild(field);
		column.addChild(new Rectangle({ width: 10, height: 900 }));
		scroll.addChild(column);
		root.addChild(scroll);
		context.frame.layout();
		context.focus.focus(field);
		const bar = scroll.bar.screenBounds;
		const x = Math.round(bar.x + bar.width / 2);
		inject(`click,${x},${Math.round(bar.y + bar.height - 2)}`);
		expect(scroll.scrollPosition).toBeGreaterThan(scroll.maxScroll * 0.8);
		expect(field.focused).toBe(true);
	});

	it('reports every change of position through onScroll', () => {
		const seen: number[] = [];
		const { scroll } = mounted(600, { onScroll: (offset) => seen.push(offset) });
		scroll.scrollTo(20);
		scroll.scrollTo(20);
		inject('scroll,100,100,10');
		expect(seen).toEqual([20, 30]);
	});
});

describe('ScrollContainer scrollIntoView (R12.20)', () => {
	function list(): { scroll: ScrollContainer; items: Rectangle[] } {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 200, height: 100 });
		const { stack, items } = rows(10, 40);
		scroll.addChild(stack);
		root.addChild(scroll);
		context.frame.layout();
		return { scroll, items };
	}

	it('moves the least, down and up, and not at all for a row in view', () => {
		const { scroll, items } = list();
		scroll.scrollIntoView(items[1]);
		expect(scroll.scrollPosition).toBe(0);
		scroll.scrollIntoView(items[4]);
		expect(scroll.scrollPosition).toBe(100);
		scroll.scrollIntoView(items[0]);
		expect(scroll.scrollPosition).toBe(0);
	});

	it('centres the row with block center, clamped at the ends', () => {
		const { scroll, items } = list();
		scroll.scrollIntoView(items[5], { block: 'center' });
		expect(scroll.scrollPosition).toBe(5 * 40 + 20 - 50);
		scroll.scrollIntoView(items[9], { block: 'center' });
		expect(scroll.scrollPosition).toBe(scroll.maxScroll);
	});

	it('follows the new end after the next layout when asked for the bottom', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 200, height: 100 });
		const { stack } = rows(5);
		scroll.addChild(stack);
		root.addChild(scroll);
		context.frame.layout();
		stack.addChild(new Rectangle({ height: 40, widthMode: 'fill' }));
		scroll.scrollToBottom();
		context.frame.layout();
		expect(scroll.scrollPosition).toBe(6 * 40 - 100);
		scroll.scrollBy(-10);
		stack.addChild(new Rectangle({ height: 40, widthMode: 'fill' }));
		context.frame.layout();
		expect(scroll.scrollPosition).toBe(6 * 40 - 110);
	});
});

describe('popups anchored in a scroller (R3.6a, DDB-210)', () => {
	function open(anchorIn: Component, popupHost: 'overlay' | 'inside'): { reasons: PopupCloseReason[] } {
		const reasons: PopupCloseReason[] = [];
		const popup = new Rectangle({ id: 'menu', width: 80, height: 60 });
		if (popupHost === 'inside') anchorIn.addChild(popup);
		context.popups.show({ popup, trigger: anchorIn, anchor: anchorIn, onClose: (reason) => reasons.push(reason) });
		return { reasons };
	}

	it('closes a popup whose trigger scrolls, on the wheel and by code', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 200, height: 100 });
		const { stack, items } = rows(10);
		scroll.addChild(stack);
		root.addChild(scroll);
		context.frame.layout();
		const first = open(items[1], 'overlay');
		inject('scroll,50,50,20');
		expect(first.reasons).toEqual(['scroll']);
		const second = open(items[2], 'overlay');
		scroll.scrollTo(0);
		expect(second.reasons).toEqual(['scroll']);
	});

	it('leaves a popup alone when a scroller that does not hold its trigger scrolls, or one inside it does', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 200, height: 100 });
		scroll.addChild(rows(10).stack);
		const trigger = new Rectangle({ id: 'trigger', x: 400, y: 0, width: 60, height: 30 });
		root.addChild(scroll);
		root.addChild(trigger);
		context.frame.layout();
		const reasons: PopupCloseReason[] = [];
		const menu = new ScrollContainer({ id: 'long_menu', width: 100, height: 60 });
		menu.addChild(new Layer({ width: 100, height: 300 }));
		context.popups.show({ popup: menu, trigger, anchor: trigger, onClose: (reason) => reasons.push(reason) });
		scroll.scrollTo(50);
		context.frame.layout();
		menu.scrollTo(40);
		expect(reasons).toEqual([]);
		expect(context.popups.open).not.toBeNull();
	});
});

describe('Scrollbar (R12.37)', () => {
	it('reports the offset a drag asks for and leaves applying it to its owner', () => {
		const asked: number[] = [];
		const bar = new Scrollbar({ id: 'bar', orientation: 'horizontal', x: 0, y: 500, width: 400, range: { offset: 0, extent: 800, viewport: 400 }, onScroll: (offset) => asked.push(offset) });
		root.addChild(bar);
		context.frame.layout();
		expect(bar.height).toBe(tokens.space.space_1_5);
		expect(bar.thumb).toEqual({ start: 0, length: 200 });
		inject('move,100,503', 'down,100,503', 'move,200,503', 'up,200,503');
		expect(asked).toEqual([200]);
		expect(bar.range.offset).toBe(200);
	});

	it('draws and hits nothing with nothing to scroll', () => {
		const bar = new Scrollbar({ x: 0, y: 0, height: 100, range: { offset: 0, extent: 50, viewport: 100 } });
		root.addChild(bar);
		context.frame.layout();
		expect(bar.active).toBe(false);
		expect(bar.containsScreenPoint(2, 50)).toBe(false);
	});
});
