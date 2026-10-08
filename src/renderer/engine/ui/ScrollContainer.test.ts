/**
 * @jest-environment jsdom
 */
import { Clock } from '../animation/Clock';
import { Component, ComponentOptions, FOCUS_RING_EXTENT } from '../components/Component';
import type { Sides } from '../components/componentGeometry';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { Rectangle } from '../components/Rectangle';
import { renderTree } from '../components/renderTree';
import { Stack } from '../components/Stack';
import { clipOnScreen, createTestContext, expectWithin, injectNow, inkOnScreen, rectOnScreen } from '../components/testing';
import type { DrawCommand, RectCommand } from '../draw';
import type { ClipRect, Rect } from '../draw/geometry';
import { NO_MODIFIERS } from '../input/events';
import { PointerAdapter } from '../input/PointerAdapter';
import type { PopupCloseReason } from '../services/PopupService';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../text/testing';
import { tokens } from '../theme/tokens';
import { shadowExtent } from '../style/look';
import { resolveShadow } from '../style/styleObject';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { ListRow } from './ListRow';
import { SegmentedControl } from './SegmentedControl';
import { Select } from './Select';
import { TextInput } from './TextInput';
import { SCROLLBAR_BREADTH, SCROLLBAR_GUTTER, Scrollbar } from './Scrollbar';
import { ScrollBlock, ScrollContainer, ScrollContainerOptions, Span, revealDelta } from './ScrollContainer';

/**
 * R12.20's scroll container and R12.37's scrollbar. The first block ports
 * worldsim's ScrollContainer suite (max scroll, clamping, a resized viewport
 * re-clamping); the rest drive it through injected input on a mounted root
 * (R9.25): wheel latching, keys, the scrollbar's drag and track press,
 * focus, scrollIntoView and the ink it reveals, the gutter, and closing a
 * popup anchored inside.
 */

let canvas: HTMLCanvasElement;
let context: MountContext;
let adapter: PointerAdapter;
let root: Container;
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
	root = new Container({ id: 'root', width: 800, height: 600 });
	root.mount(context);
});

afterEach(() => {
	root.unmount();
	adapter.detach();
	document.body.removeChild(canvas);
});

/** A 200 by 300 scroller at (50, 50) over a content layer `contentHeight` tall. */
function mounted(contentHeight: number, options: ScrollContainerOptions = {}): { scroll: ScrollContainer; content: Container } {
	const scroll = new ScrollContainer({ id: 'scroll', x: 50, y: 50, width: 200, height: 300, ...options });
	const content = new Container({ id: 'content', width: 200, height: contentHeight });
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

/**
 * Draws `reach` past its box whatever its state, as a card's cost hex or a
 * mini's stack edges, count, and tag do: that is its cull ink, and so what
 * scrolling it into view shows. `unbounded` makes one that cannot bound its
 * draws.
 */
class Inky extends Component {
	private readonly reach: Sides;
	private readonly unbounded: boolean;

	constructor({ reach = {}, unbounded = false, ...options }: ComponentOptions & { reach?: Partial<Sides>; unbounded?: boolean }) {
		super(options);
		this.reach = { top: 0, right: 0, bottom: 0, left: 0, ...reach };
		this.unbounded = unbounded;
	}

	/** R8.8: the furthest side. */
	public get inkExtent(): number {
		const { top, right, bottom, left } = this.reach;
		return Math.max(top, right, bottom, left);
	}

	protected get cullInk(): Rect | null {
		if (this.unbounded) return null;
		const { top, right, bottom, left } = this.reach;
		return { x: -left, y: -top, width: this.width + left + right, height: this.height + top + bottom };
	}
}

/**
 * `count` inky rows `height` tall and `pitch` apart, over content `count`
 * pitches tall, in a 200 wide scroller `viewport` tall at the origin.
 */
function inkyList({ count = 10, pitch = 60, height = 40, viewport = 100, reach = {}, focusable = false }: {
	count?: number;
	pitch?: number;
	height?: number;
	viewport?: number;
	reach?: Partial<Sides>;
	focusable?: boolean;
} = {}): { scroll: ScrollContainer; items: Inky[] } {
	const scroll = new ScrollContainer({ id: 'scroll', x: 0, y: 0, width: 200, height: viewport });
	const content = new Container({ id: 'content', width: 200, height: count * pitch });
	const items = Array.from({ length: count }, (_unused, index) => new Inky({ id: `inky_${index}`, y: index * pitch, width: 160, height, reach, focusable }));
	items.forEach((item) => content.addChild(item));
	scroll.addChild(content);
	root.addChild(scroll);
	context.frame.layout();
	return { scroll, items };
}

/** A component's content box on screen. */
function boxOnScreen(component: Component): ClipRect {
	return rectOnScreen(component, { x: 0, y: 0, width: component.width, height: component.height });
}

/** `control` at content y `y` in a 300 wide scroller `viewport` tall at the origin, over 2000 px of content. */
function controlIn(control: Component, y: number, viewport = 100): ScrollContainer {
	const scroll = new ScrollContainer({ id: 'scroll', x: 0, y: 0, width: 300, height: viewport });
	const content = new Container({ id: 'content', width: 300, height: 2000 });
	control.setPosition(10, y);
	content.addChild(control);
	scroll.addChild(content);
	root.addChild(scroll);
	context.frame.layout();
	return scroll;
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

describe('ScrollContainer hug height (DDB-89)', () => {
	/** A 300 tall column of a 40 px header, the scroller, and a 40 px footer. */
	function column(height: number, scroll: ScrollContainer): Stack {
		const stack = new Stack({ id: 'column', width: 200, height, crossAlign: 'stretch' });
		stack.addChild(new Rectangle({ height: 40, widthMode: 'fill' }));
		stack.addChild(scroll);
		stack.addChild(new Rectangle({ height: 40, widthMode: 'fill' }));
		root.addChild(stack);
		context.frame.layout();
		return stack;
	}

	it('takes its content height plus padding in a column with room, and does not scroll', () => {
		const scroll = new ScrollContainer({ heightMode: 'hug', style: { padding: 5 } });
		scroll.addChild(rows(3).stack);
		column(400, scroll);
		expect(scroll.height).toBe(3 * 40 + 10);
		expect(scroll.overflows).toBe(false);
		expect(scroll.screenBounds.y).toBe(40);
	});

	it('shrinks to the room a short column has, down to its minimum, and scrolls the rest', () => {
		const scroll = new ScrollContainer({ heightMode: 'hug', minSize: { height: 60 } });
		scroll.addChild(rows(10).stack);
		const stack = column(300, scroll);
		expect(scroll.height).toBe(300 - 80);
		expect(scroll.overflows).toBe(true);
		expect(scroll.maxScroll).toBe(400 - 220);

		stack.setSize(200, 100);
		context.frame.layout();
		expect(scroll.height).toBe(60);
	});

	it('follows its content as it grows', () => {
		const scroll = new ScrollContainer({ heightMode: 'hug' });
		const { stack } = rows(2);
		scroll.addChild(stack);
		column(400, scroll);
		expect(scroll.height).toBe(80);
		stack.addChild(new Rectangle({ height: 40, widthMode: 'fill' }));
		context.frame.layout();
		expect(scroll.height).toBe(120);
	});

	it('sizes itself to its content outside a stack', () => {
		const scroll = new ScrollContainer({ width: 200, heightMode: 'hug' });
		scroll.addChild(rows(4).stack);
		root.addChild(scroll);
		context.frame.layout();
		expect(scroll.height).toBe(160);
	});

	it('holds to its minSize and maxSize outside a stack, scrolling past the maximum', () => {
		const capped = new ScrollContainer({ width: 200, heightMode: 'hug', maxSize: { height: 100 } });
		capped.addChild(rows(4).stack);
		const floored = new ScrollContainer({ x: 300, width: 200, heightMode: 'hug', minSize: { height: 100 } });
		floored.addChild(rows(1).stack);
		root.addChild(capped);
		root.addChild(floored);
		context.frame.layout();
		expect(capped.height).toBe(100);
		expect(capped.overflows).toBe(true);
		expect(capped.maxScroll).toBe(60);
		expect(floored.height).toBe(100);
		expect(floored.overflows).toBe(false);
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

	it('shows none of its content, and lets none of it be hit, at zero width or zero height (DDB-234)', () => {
		const api = context.draw;
		const drawnRows = (): number => {
			api.beginFrame({ viewport: { width: 800, height: 600 }, ratio: 1 });
			renderTree(root, api);
			api.endFrame();
			return backend.commands.filter((command) => command.id?.startsWith('row_')).length;
		};
		const scroll = new ScrollContainer({ id: 'scroll', x: 50, y: 50, width: 0, height: 300 });
		const { stack, items } = rows(12);
		scroll.addChild(stack);
		root.addChild(scroll);
		context.frame.layout();
		expect(scroll.clipsChildren).toBe(true);
		expect(drawnRows()).toBe(0);
		expect(items[0].containsScreenPoint(50, 60)).toBe(false);

		scroll.setSize(200, 0);
		context.frame.layout();
		expect(drawnRows()).toBe(0);
		expect(items[0].containsScreenPoint(60, 50)).toBe(false);

		scroll.setSize(200, 300);
		context.frame.layout();
		expect(drawnRows()).toBeGreaterThan(0);
		expect(items[0].containsScreenPoint(60, 60)).toBe(true);
	});

	it('clips inside its border with a concentric rounded corner, and into the padding as far as a child\'s ink reaches (R8.8, R4.14)', () => {
		const boxed = new ScrollContainer({ width: 200, height: 100, style: { borderWidth: 1, borderRadius: 4 } });
		expect(boxed.clipRect).toEqual({ x: 1, y: 1, width: 198, height: 98 });
		expect(boxed.clipRadius).toBe(3);
		const roomy = new ScrollContainer({ width: 200, height: 100, style: { borderWidth: 1, borderRadius: 4, padding: 10 } });
		expect(roomy.clipRect).toEqual({ x: 10, y: 10, width: 180, height: 80 });
		expect(roomy.clipRadius).toBe(0);
		expect(new ScrollContainer({ width: 200, height: 100 }).clipRadius).toBe(0);
		const padded = new ScrollContainer({ x: 0, y: 0, width: 200, height: 100, style: { padding: 8 } });
		const inky = new TextInput({ value: 'x', width: 100, height: 30 });
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
		const outerContent = new Container({ width: 400, height: 1200 });
		const inner = new ScrollContainer({ id: 'inner', x: 0, y: 0, width: 200, height: 200 });
		inner.addChild(new Container({ width: 200, height: 240 }));
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
		const field = new TextInput({ placeholder: 'text', width: 200, height: 30 });
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

	it('keeps the scrollbar inside the clip of a padded, bordered container, and draggable there', () => {
		const { scroll } = mounted(600, { style: { padding: 8, borderWidth: 1 } });
		const bar = scroll.bar.screenBounds;
		const clip = scroll.clipRect;
		expect(scroll.bar.x).toBeGreaterThanOrEqual(clip.x);
		expect(scroll.bar.x + scroll.bar.width).toBeLessThanOrEqual(clip.x + clip.width);
		const x = Math.round(bar.x + bar.width / 2);
		const thumb = scroll.bar.thumb;
		const grab = Math.round(bar.y + thumb.start + thumb.length / 2);
		expect(scroll.bar.containsScreenPoint(x, grab)).toBe(true);
		inject(`move,${x},${grab}`, `down,${x},${grab}`, `move,${x},${grab + 60}`, `up,${x},${grab + 60}`);
		expect(scroll.scrollPosition).toBeGreaterThan(0);
	});

	it('gives the scrollbar a 24 px lane beside the content, never over it (R13.25.7)', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 200, height: 100 });
		const list = rows(10);
		scroll.addChild(list.stack);
		root.addChild(scroll);
		context.frame.layout();
		expect(scroll.bar.width).toBe(SCROLLBAR_BREADTH);
		const rowRight = list.items[0].screenBounds.x + list.items[0].width;
		expect(rowRight).toBeLessThanOrEqual(scroll.bar.screenBounds.x);
		expect(context.dispatcher.hitTest({ x: rowRight - 1, y: 10 })).toBe(list.items[0]);
		expect(context.dispatcher.hitTest({ x: rowRight + 1, y: 10 })).toBe(scroll.bar);
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
		const field = new TextInput({ placeholder: 'text', width: 200, height: 30 });
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

describe('ScrollContainer scrollIntoView shows what a component draws (R12.20, DDB-406)', () => {
	it('shows ink drawn past the box on the side it reaches, going down and going up', () => {
		// A 12 px pill under each 40 px row, nothing above
		const { scroll, items } = inkyList({ reach: { bottom: 12 } });
		// Row 1's box, 60 to 100, is in view; its pill, to 112, is not
		scroll.scrollIntoView(items[1]);
		expect(scroll.scrollPosition).toBe(12);
		expectWithin(inkOnScreen(items[1]), clipOnScreen(scroll), 'y');
		scroll.scrollIntoView(items[3]);
		expect(scroll.scrollPosition).toBe(3 * 60 + 40 + 12 - 100);
		// Nothing reaches above the box, so going up its top meets the clip's
		scroll.scrollIntoView(items[1]);
		expect(scroll.scrollPosition).toBe(60);
	});

	it('shows ink drawn past both sides, its top meeting the clip going up', () => {
		const { scroll, items } = inkyList({ reach: { top: 6, bottom: 6 } });
		scroll.scrollTo(200);
		scroll.scrollIntoView(items[2]);
		expect(scroll.scrollPosition).toBe(2 * 60 - 6);
	});

	it("counts the walk's focus ring while the walk draws it, as one union with the ink", () => {
		const bare = inkyList({ focusable: true });
		// Row 1 sits on the clip's bottom edge, and keyboard focus draws the ring past it
		context.focus.focus(bare.items[1], 'keyboard');
		expect(bare.scroll.scrollPosition).toBe(FOCUS_RING_EXTENT);
		root.removeChild(bare.scroll);
		// 6 px of ink already holds the 3 px ring: 6, not 9
		const inky = inkyList({ focusable: true, reach: { top: 6, bottom: 6 } });
		context.focus.focus(inky.items[1], 'keyboard');
		expect(inky.scroll.scrollPosition).toBe(6);
	});

	it('shows no ring under the pointer modality, where none is drawn', () => {
		const { scroll, items } = inkyList({ focusable: true });
		context.focus.focusFromPointer(items[0]);
		context.focus.focus(items[1]);
		expect(items[1].focusVisible).toBe(false);
		expect(scroll.scrollPosition).toBe(0);
	});

	it('counts no ring for a focused component since disabled, which the walk no longer draws', () => {
		const { scroll, items } = inkyList({ focusable: true });
		context.focus.focus(items[5], 'keyboard');
		items[5].enabled = false;
		expect(items[5].focusVisible).toBe(true);
		scroll.scrollTo(0);
		scroll.scrollIntoView(items[5]);
		// Its box ends at 340, and nothing is drawn past it
		expect(scroll.scrollPosition).toBe(5 * 60 + 40 - 100);
	});

	it("measures against its clip, inset by its padding: a ring scrolled in ends on the clip's edge", () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 300, height: 100, style: { padding: 8 } });
		const content = new Container({ width: 280, height: 2000 });
		const item = new Inky({ y: 200, width: 100, height: 40, focusable: true });
		content.addChild(item);
		scroll.addChild(content);
		root.addChild(scroll);
		context.frame.layout();
		expect(scroll.clipRect.y).toBeGreaterThan(0);
		context.focus.focus(item, 'keyboard');
		expect(inkOnScreen(item).maxY).toBeCloseTo(clipOnScreen(scroll).maxY, 9);
	});

	it('stays put for a component whose ink shows already', () => {
		const seen: number[] = [];
		const { scroll, items } = inkyList({ reach: { top: 6, bottom: 6 } });
		scroll.onScroll = (offset) => seen.push(offset);
		scroll.scrollTo(30);
		// Row 1's ink spans 24 to 76 of the clip
		scroll.scrollIntoView(items[1]);
		scroll.scrollIntoView(items[1], { block: 'nearest' });
		expect(seen).toEqual([30]);
	});

	it("stops at the content's ends for ink past them, and a pending scrollToBottom keeps following", () => {
		const { scroll, items } = inkyList({ reach: { top: 30, bottom: 30 } });
		// The last row's ink ends at 610, past the content's 600
		scroll.scrollIntoView(items[9]);
		expect(scroll.scrollPosition).toBe(scroll.maxScroll);
		scroll.scrollIntoView(items[0]);
		expect(scroll.scrollPosition).toBe(0);
		// At the end already, the reveal asks for nothing the range allows, so it doesn't cancel following the end
		scroll.scrollToBottom();
		scroll.scrollIntoView(items[9]);
		(scroll.content as Container).height = 660;
		context.frame.layout();
		expect(scroll.scrollPosition).toBe(660 - 100);
	});

	it('leaves the scroll alone for ink it cannot measure', () => {
		const seen: number[] = [];
		const { scroll, items } = inkyList({ reach: { bottom: Number.NaN } });
		scroll.scrollTo(50);
		scroll.onScroll = (offset) => seen.push(offset);
		scroll.scrollIntoView(items[5]);
		expect(scroll.scrollPosition).toBe(50);
		expect(seen).toEqual([]);
	});

	it('reveals the box alone for a component that cannot bound its draws', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 200, height: 100 });
		const content = new Container({ width: 200, height: 400 });
		const blind = new Inky({ y: 70, width: 160, height: 40, unbounded: true, focusable: true });
		content.addChild(blind);
		scroll.addChild(content);
		root.addChild(scroll);
		context.frame.layout();
		context.focus.focus(blind, 'keyboard');
		expect(blind.revealInk).toBeNull();
		expect(scroll.scrollPosition).toBe(10);
	});

	it('settles on fractional geometry: a box as tall as the clip shows whole, and a second reveal never moves', () => {
		const seen: number[] = [];
		const scroll = new ScrollContainer({ x: 0, y: 13.37, width: 200, height: 97.3 });
		const content = new Container({ width: 200, height: 40 * 113.71 + 97.3 });
		// Boxes exactly the clip's height, at fractional places, with ink either side that can't fit
		const items = Array.from({ length: 40 }, (_unused, index) => new Inky({ y: index * 113.71 + 0.13, width: 160, height: 97.3, reach: { top: 9, bottom: 9 } }));
		items.forEach((item) => content.addChild(item));
		scroll.addChild(content);
		root.addChild(scroll);
		context.frame.layout();
		scroll.onScroll = (offset) => seen.push(offset);
		for (const item of [...items, ...[...items].reverse()]) {
			scroll.scrollIntoView(item);
			expectWithin(boxOnScreen(item), clipOnScreen(scroll), 'y');
			const settled = seen.length;
			scroll.scrollIntoView(item);
			expect(seen.length).toBe(settled);
		}
	});

	it('counts a turned component at its turned extent, and works in its own units under a scaled ancestor', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 200, height: 100 });
		const content = new Container({ width: 200, height: 400 });
		// A 100 by 20 bar at y 60, turned a quarter about its centre: 20 to 120
		const bar = new Rectangle({ x: 50, y: 60, width: 100, height: 20, transform: { rotate: Math.PI / 2 } });
		content.addChild(bar);
		scroll.addChild(content);
		const holder = new Container({ x: 300, y: 0, width: 400, height: 400, transform: { scale: 2, origin: [0, 0] } });
		const scaled = new ScrollContainer({ x: 0, y: 0, width: 200, height: 100 });
		const list = rows(10, 40);
		scaled.addChild(list.stack);
		holder.addChild(scaled);
		root.addChild(scroll);
		root.addChild(holder);
		context.frame.layout();
		scroll.scrollIntoView(bar);
		expect(scroll.scrollPosition).toBeCloseTo(20, 6);
		scaled.scrollIntoView(list.items[4]);
		expect(scaled.scrollPosition).toBe(100);
	});

	it('leaves a component it does not hold alone', () => {
		const { scroll } = inkyList();
		const outsider = new Rectangle({ x: 300, y: 500, width: 40, height: 40 });
		root.addChild(outsider);
		context.frame.layout();
		scroll.scrollIntoView(outsider);
		expect(scroll.scrollPosition).toBe(0);
	});

	it('shows a component inside nested scrollers in both, inner first, when it takes keyboard focus', () => {
		const outer = new ScrollContainer({ id: 'outer', x: 0, y: 0, width: 300, height: 200 });
		const column = new Stack({ id: 'column', crossAlign: 'stretch' });
		column.addChild(new Rectangle({ height: 150, widthMode: 'fill' }));
		// The inner scroller sits 150 down the outer's content
		const inner = new ScrollContainer({ id: 'inner', height: 100, widthMode: 'fill' });
		const innerContent = new Container({ width: 200, height: 340 });
		const cards = Array.from({ length: 6 }, (_unused, index) => new Inky({ id: `card_${index}`, y: index * 60, width: 160, height: 40, reach: { top: 6, bottom: 6 }, focusable: true }));
		cards.forEach((card) => innerContent.addChild(card));
		inner.addChild(innerContent);
		column.addChild(inner);
		column.addChild(new Rectangle({ height: 300, widthMode: 'fill' }));
		outer.addChild(column);
		root.addChild(outer);
		context.frame.layout();

		context.focus.focus(cards[3], 'keyboard');
		// Card 3 spans 180 to 220, and its ink, holding the ring, to 226
		expect(inner.scrollPosition).toBe(226 - 100);
		// So it reaches 150 + 100 = 250 down the outer's content
		expect(outer.scrollPosition).toBe(250 - 200);
		const ink = inkOnScreen(cards[3]);
		expectWithin(ink, clipOnScreen(inner), 'y');
		expectWithin(ink, clipOnScreen(outer), 'y');
	});

	it("doesn't scroll an outer scroller for ink an inner clip hides", () => {
		const outer = new ScrollContainer({ id: 'outer', x: 0, y: 0, width: 300, height: 200 });
		const column = new Stack({ id: 'column', crossAlign: 'stretch' });
		column.addChild(new Rectangle({ height: 100, widthMode: 'fill' }));
		// The inner scroller ends on the outer's clip bottom, and its content on the last card's box
		const inner = new ScrollContainer({ id: 'inner', height: 100, widthMode: 'fill' });
		const innerContent = new Container({ width: 200, height: 220 });
		const cards = [0, 1, 2].map((index) => new Inky({ id: `card_${index}`, y: index * 90, width: 160, height: 40, reach: { bottom: 12 }, focusable: true }));
		cards.forEach((card) => innerContent.addChild(card));
		inner.addChild(innerContent);
		column.addChild(inner);
		column.addChild(new Rectangle({ height: 300, widthMode: 'fill' }));
		outer.addChild(column);
		root.addChild(outer);
		context.frame.layout();

		// Its pill can't come out from under the inner clip, so the outer has nothing to scroll for
		context.focus.focus(cards[2]);
		expect(inner.scrollPosition).toBe(inner.maxScroll);
		expect(outer.scrollPosition).toBe(0);
	});

	it('ends the walk at a promoted layer, which no clip beneath it cuts', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 300, height: 100 });
		const content = new Container({ width: 300, height: 2000 });
		const raised = new Container({ y: 500, width: 300, height: 100, layer: 'raised' });
		const item = new Inky({ y: 10, width: 100, height: 40, focusable: true });
		raised.addChild(item);
		content.addChild(raised);
		scroll.addChild(content);
		root.addChild(scroll);
		context.frame.layout();
		expect(raised.promoted).toBe(true);
		context.focus.focus(item, 'keyboard');
		expect(scroll.scrollPosition).toBe(0);
	});

	it('ends the walk once a clip has cut the box away, since nothing further up can bring it back', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 300, height: 100 });
		const content = new Container({ width: 300, height: 2000 });
		// A 50 px window that clips, 300 down the content, holding a child below its clip
		const window = new Container({ y: 300, width: 300, height: 50, overflow: 'hidden' });
		const hidden = new Inky({ y: 200, width: 100, height: 40, focusable: true });
		window.addChild(hidden);
		content.addChild(window);
		scroll.addChild(content);
		root.addChild(scroll);
		context.frame.layout();
		context.focus.focus(hidden, 'keyboard');
		expect(scroll.scrollPosition).toBe(0);
	});

	it('walks a grid with the arrows: along a row in view nothing moves, a row up or down shows whole', () => {
		const scroll = new ScrollContainer({ id: 'grid_scroll', x: 0, y: 0, width: 300, height: 100 });
		const grid = new Stack({ id: 'grid', gap: 20 });
		const cells: Inky[][] = [];
		for (let row = 0; row < 4; row++) {
			const line = new Stack({ direction: 'horizontal', gap: 20 });
			cells.push(Array.from({ length: 3 }, (_unused, column) => new Inky({ id: `cell_${row}_${column}`, width: 60, height: 40, reach: { top: 6, bottom: 6 }, focusable: true })));
			cells[row].forEach((cell) => line.addChild(cell));
			grid.addChild(line);
		}
		scroll.addChild(grid);
		root.addChild(scroll);
		context.frame.layout();
		// Rows 60 apart, each cell's ink 6 px past its box above and below, its ring inside that
		const ink = 6;

		context.focus.focus(cells[0][0], 'keyboard');
		expect(scroll.scrollPosition).toBe(0);
		key('ArrowRight');
		expect(context.focus.focused).toBe(cells[0][1]);
		expect(scroll.scrollPosition).toBe(0);
		key('ArrowDown');
		expect(context.focus.focused).toBe(cells[1][1]);
		expect(scroll.scrollPosition).toBe(60 + 40 + ink - 100);
		key('ArrowRight');
		expect(context.focus.focused).toBe(cells[1][2]);
		expect(scroll.scrollPosition).toBe(60 + 40 + ink - 100);
		key('ArrowDown');
		expect(context.focus.focused).toBe(cells[2][2]);
		expect(scroll.scrollPosition).toBe(120 + 40 + ink - 100);
		key('ArrowLeft');
		expect(context.focus.focused).toBe(cells[2][1]);
		expect(scroll.scrollPosition).toBe(120 + 40 + ink - 100);
		key('ArrowUp');
		expect(context.focus.focused).toBe(cells[1][1]);
		expect(scroll.scrollPosition).toBe(60 - ink);
	});

	it('walks a list on its row pitch: a row draws its ring inside its box', () => {
		const scroll = new ScrollContainer({ x: 0, y: 0, width: 200, height: 120 });
		const list = new Stack({ crossAlign: 'stretch' });
		const items = Array.from({ length: 8 }, (_unused, index) => new ListRow({ id: `row_${index}`, label: `Row ${index}`, height: 40 }));
		items.forEach((item) => list.addChild(item));
		scroll.addChild(list);
		root.addChild(scroll);
		context.frame.layout();

		context.focus.focus(items[0], 'keyboard');
		const positions: number[] = [];
		for (let index = 1; index < items.length; index++) {
			key('ArrowDown');
			expect(context.focus.focused).toBe(items[index]);
			positions.push(scroll.scrollPosition);
		}
		for (let index = items.length - 2; index >= 0; index--) {
			key('ArrowUp');
			expect(context.focus.focused).toBe(items[index]);
			positions.push(scroll.scrollPosition);
		}
		expect(positions).toEqual([0, 0, 40, 80, 120, 160, 200, 200, 200, 160, 120, 80, 40, 0]);
	});

	it("leaves a button that shows whole where it is, hovered or not: its ring counts, a glow it isn't drawing doesn't", () => {
		// An accent button glows when hovered, which its ink bound counts; here a glow would have room to scroll
		const button = new Button({ label: 'Save', tone: 'accent', width: 100 });
		const scroll = controlIn(button, 223, 90);
		scroll.scrollTo(200);
		expect(button.inkExtent).toBeGreaterThan(20);

		context.focus.focus(button, 'keyboard');
		expect(scroll.scrollPosition).toBe(200);
		inject('move,40,40');
		expect(button.hovered).toBe(true);
		context.focus.blur();
		context.focus.focus(button, 'keyboard');
		expect(scroll.scrollPosition).toBe(200);
	});

	const ringed: [string, () => Component][] = [
		['Button', () => new Button({ label: 'Go', width: 100, height: 30 })],
		['Select', () => new Select({ width: 160, height: 30, options: [{ value: 'a', label: 'A' }] })],
		['TextInput', () => new TextInput({ width: 160, height: 30 })],
	];

	it.each(ringed)("scrolls in the ring a %s draws itself when keyboard focus lands on it at the clip's bottom", (_name, make) => {
		const control = make();
		// Box 70 to 100 in a 100 px clip
		const scroll = controlIn(control, 70);
		context.focus.focus(control, 'keyboard');
		expect(control.drawsOwnFocusRing).toBe(true);
		expect(scroll.scrollPosition).toBe(FOCUS_RING_EXTENT);
	});

	it.each(ringed)('shows no ring for a %s focused by code under the pointer modality, so its box on the edge stays put', (_name, make) => {
		const control = make();
		const scroll = controlIn(control, 70);
		context.focus.focusFromPointer(control);
		context.focus.blur();
		context.focus.focus(control);
		expect(control.focusVisible).toBe(false);
		expect(scroll.scrollPosition).toBe(0);
	});

	it("scrolls in a raised button's shadow, which it draws in every state", () => {
		const button = new Button({ label: 'Raised', width: 120, height: 30, style: { shadow: 'shadow_raised' } });
		const shadow = shadowExtent(resolveShadow('shadow_raised'));
		expect(shadow).toBeGreaterThan(FOCUS_RING_EXTENT);
		// Box 60 to 90 in a 100 px clip
		const scroll = controlIn(button, 60);
		context.focus.focus(button, 'keyboard');
		expect(scroll.scrollPosition).toBe(90 + shadow - 100);
	});

	it("scrolls in a checked checkbox's ring, which the walk draws round the row, and not the glow its mark raises on hover", () => {
		const check = new Checkbox({ label: 'Check', width: 160, checked: true });
		expect(check.inkExtent).toBeGreaterThan(FOCUS_RING_EXTENT);
		// Its box's bottom on the clip's bottom
		const scroll = controlIn(check, 100 - check.height);
		context.focus.focus(check, 'keyboard');
		expect(check.drawsOwnFocusRing).toBe(false);
		expect(scroll.scrollPosition).toBe(FOCUS_RING_EXTENT);
	});

	it("leaves a selected segment on the clip's edge where it is: its ring is inside and its chip glow isn't counted", () => {
		const segments = new SegmentedControl({ options: [{ label: 'One', value: 1 }, { label: 'Two', value: 2 }], selected: 1 });
		const scroll = controlIn(segments, 600);
		const chip = segments.children.find((child) => child.focusable) as Component;
		expect(chip.selected).toBe(true);
		expect(chip.inkExtent).toBeGreaterThan(0);
		// Its box's bottom on the clip's bottom
		scroll.scrollTo(scroll.scrollPosition + boxOnScreen(chip).maxY - clipOnScreen(scroll).maxY);
		const resting = scroll.scrollPosition;
		context.focus.focus(chip, 'keyboard');
		expect(scroll.scrollPosition).toBe(resting);
	});
});

describe('revealDelta, the rule along the scroll axis (R12.20)', () => {
	const view: Span = { start: 0, end: 100 };

	function reveal(box: Span, ink: Span, block: ScrollBlock = 'nearest'): number {
		return revealDelta({ box, ink, view, block });
	}

	/** Where a span sits once the content has scrolled by `delta`. */
	function moved(span: Span, delta: number): Span {
		return { start: span.start - delta, end: span.end - delta };
	}

	it('moves the least that shows all of the ink while it fits, and exactly nothing while it shows', () => {
		expect(Object.is(reveal({ start: 20, end: 60 }, { start: 10, end: 70 }), 0)).toBe(true);
		expect(Object.is(reveal({ start: 0, end: 100 }, { start: 0, end: 100 }), 0)).toBe(true);
		expect(reveal({ start: 55, end: 95 }, { start: 52, end: 107 })).toBe(7);
		expect(reveal({ start: -10, end: 30 }, { start: -13, end: 33 })).toBe(-13);
		// Ink below only: going up, the box's top is what meets the view's
		expect(reveal({ start: -10, end: 30 }, { start: -10, end: 45 })).toBe(-10);
		// Ink that sits inside the box counts as the box, at either end
		expect(reveal({ start: -50, end: -10 }, { start: -40, end: -20 })).toBe(-50);
		expect(reveal({ start: 70, end: 130 }, { start: 80, end: 120 })).toBe(30);
	});

	it('centres the box with block center, then moves the least that keeps all of the ink in view', () => {
		expect(moved({ start: 200, end: 240 }, reveal({ start: 200, end: 240 }, { start: 197, end: 243 }, 'center'))).toEqual({ start: 30, end: 70 });
		// Centred, the box's 40 px pill would end at 110; it ends at the view's end instead
		expect(moved({ start: 200, end: 240 }, reveal({ start: 200, end: 240 }, { start: 200, end: 280 }, 'center'))).toEqual({ start: 20, end: 60 });
	});

	it('keeps a box that fits whole under ink that does not, splitting the room half each, from either side', () => {
		const box = { start: 300, end: 380 };
		const ink = { start: 280, end: 400 };
		const over = moved(box, 600);
		expect(moved(box, reveal(box, ink))).toEqual({ start: 10, end: 90 });
		expect(moved(over, reveal(over, moved(ink, 600)))).toEqual({ start: 10, end: 90 });
		// Settled, it stays
		expect(reveal({ start: 10, end: 90 }, { start: -10, end: 110 })).toBe(0);
	});

	it('gives a side whose ink needs less than half the room all of it, the rest to the other, with either block', () => {
		// The box leaves 20 px: a ring's 3 px above takes 3, a pill's 30 below gets 17
		const box = { start: 300, end: 380 };
		const lopsided = { start: 297, end: 410 };
		expect(moved(box, reveal(box, lopsided))).toEqual({ start: 3, end: 83 });
		expect(moved(box, reveal(box, lopsided, 'center'))).toEqual({ start: 3, end: 83 });
		// And the other way up
		expect(moved(box, reveal(box, { start: 270, end: 383 }))).toEqual({ start: 17, end: 97 });
	});

	it('puts the top of a box taller than the view at the top, under the ink above it while that leaves the top in view', () => {
		const box = { start: 300, end: 450 };
		const over = moved(box, 600);
		expect(moved(box, reveal(box, { start: 291, end: 452 }))).toEqual({ start: 9, end: 159 });
		expect(moved(over, reveal(over, { start: -309, end: -148 }))).toEqual({ start: 9, end: 159 });
		expect(reveal({ start: 9, end: 159 }, { start: 0, end: 161 })).toBe(0);
		// Ink above it as tall as the view would hide its top: the top goes to the top
		expect(moved(box, reveal(box, { start: 200, end: 450 }))).toEqual({ start: 0, end: 150 });
		// No ink, the old rule
		expect(moved(box, reveal(box, box))).toEqual({ start: 0, end: 150 });
	});

	it('centres a box taller than the view with block center, whatever its ink', () => {
		const box = { start: 300, end: 450 };
		expect(moved(box, reveal(box, { start: 280, end: 452 }, 'center'))).toEqual({ start: -25, end: 125 });
	});

	it('counts a box as tall as the view as fitting, to a rounding error', () => {
		const start = 0.1 + 0.2;
		const box = { start, end: start + 100 + 1e-12 };
		expect(moved(box, reveal(box, { start: start - 9, end: box.end + 9 })).start).toBeCloseTo(0, 9);
		expect(reveal({ start: 1e-9, end: 100 + 1e-9 }, { start: 1e-9, end: 100 + 1e-9 })).toBe(0);
	});

	it('answers 0 rather than a non-finite number', () => {
		expect(reveal({ start: 20, end: 60 }, { start: 10, end: Number.NaN })).toBe(0);
		expect(reveal({ start: 20, end: Number.NaN }, { start: 10, end: 70 })).toBe(0);
		expect(reveal({ start: 20, end: 60 }, { start: -Infinity, end: 70 })).toBe(0);
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
		menu.addChild(new Container({ width: 100, height: 300 }));
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
		expect(bar.height).toBe(SCROLLBAR_BREADTH);
		expect(bar.thumb).toEqual({ start: 0, length: 200 });
		inject('move,100,512', 'down,100,512', 'move,200,512', 'up,200,512');
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
