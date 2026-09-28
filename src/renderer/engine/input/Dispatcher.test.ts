import { Component, ComponentOptions } from '../components/Component';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { createTestContext } from '../components/testing';
import { ScrollContainer } from '../ui/ScrollContainer';
import { PlatformInput, TOUCH_HOLD_MS, WHEEL_LATCH_MS, WHEEL_LINE_PX } from './Dispatcher';
import { dragThreshold } from './DragService';
import type { AnyUiEvent, PointerType } from './events';
import { NO_MODIFIERS, UiPointerEvent } from './events';

/**
 * Chapter 9.11's required tests for the dispatcher, driven through its queue
 * the way the adapter and the injection hook feed it (R9.25): nothing here
 * calls a component's handler directly.
 */

const log: string[] = [];

/** Records every event that reaches it as `type:id`, and optionally consumes one type. */
class Probe extends Component {
	public consumes: string | null = null;
	public captureOnDown = false;

	constructor(options: ComponentOptions & { pointerEvents?: ComponentOptions['pointerEvents'] }) {
		super(options);
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		log.push(`${event.type}:${this.id}`);
		if (event.type === this.consumes) event.consume();
		if (this.captureOnDown && event.type === 'pointerdown') event.capturePointer();
	}
}

class Group extends Probe {
	protected get defaultPointerEvents(): 'passthrough' {
		return 'passthrough';
	}
}

let context: MountContext;

beforeEach(() => {
	log.length = 0;
	context = createTestContext();
});

function mount(...roots: Component[]): void {
	for (const root of roots) root.mount(context);
}

interface PointerOptions {
	button?: number;
	pointerId?: number;
	pointerType?: PointerType;
	isPrimary?: boolean;
}

function pointer(phase: 'down' | 'move' | 'up' | 'cancel', x: number, y: number, options: PointerOptions = {}): PlatformInput {
	const button = options.button ?? (phase === 'move' ? -1 : 0);
	return {
		kind: 'pointer',
		phase,
		x,
		y,
		pointerId: options.pointerId ?? 1,
		pointerType: options.pointerType ?? 'mouse',
		isPrimary: options.isPrimary ?? true,
		button,
		buttons: phase === 'down' ? 1 : 0,
		pressure: phase === 'down' ? 0.5 : 0,
		modifiers: NO_MODIFIERS,
	};
}

function send(...inputs: PlatformInput[]): void {
	for (const input of inputs) {
		context.dispatcher.enqueue(input);
		// One frame per input, so moves are not coalesced away: the input
		// phase, then the update phase's clock advance.
		context.dispatcher.dispatchPending();
		context.clock.advance(1);
	}
}

function click(x: number, y: number, options: PointerOptions = {}): void {
	send(pointer('move', x, y, options), pointer('down', x, y, options), pointer('up', x, y, options));
}

function wheel(x: number, y: number, deltaY: number, { deltaMode = 0, shift = false }: { deltaMode?: 0 | 1 | 2; shift?: boolean } = {}): void {
	send({
		kind: 'wheel',
		x,
		y,
		deltaX: 0,
		deltaY,
		deltaMode,
		modifiers: { ...NO_MODIFIERS, shift },
	});
}

function key(phase: 'down' | 'up', name: string): void {
	send({ kind: 'key', phase, key: name, repeat: false, modifiers: NO_MODIFIERS });
}

function hit(x: number, y: number): string | null {
	return context.dispatcher.hitTest({ x, y })?.id ?? null;
}

function only(type: string): string[] {
	return log.filter((entry) => entry.startsWith(`${type}:`));
}

describe('hit order (R9.4, R3.28)', () => {
	it('picks the later of two overlapping siblings', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		root.addChild(new Probe({ id: 'a', x: 0, y: 0, width: 100, height: 100 }));
		root.addChild(new Probe({ id: 'b', x: 50, y: 50, width: 100, height: 100 }));
		mount(root);

		expect(hit(75, 75)).toBe('b');
		expect(hit(25, 25)).toBe('a');
	});

	it('follows zIndex, which is paint order, over insertion order', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		root.addChild(new Probe({ id: 'raised', x: 0, y: 0, width: 100, height: 100, zIndex: 1 }));
		root.addChild(new Probe({ id: 'later', x: 0, y: 0, width: 100, height: 100 }));
		mount(root);

		expect(hit(50, 50)).toBe('raised');
	});

	// 3.12: a popup promoted from early in the walk still paints, and so hits,
	// over base content submitted after it.
	it('sends a click in the overlap to a promoted popup over later base content', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const trigger = new Probe({ id: 'trigger', x: 0, y: 0, width: 50, height: 50 });
		trigger.addChild(new Probe({ id: 'popup', x: 0, y: 50, width: 150, height: 100, layer: 'popup' }));
		root.addChild(trigger);
		root.addChild(new Probe({ id: 'base', x: 0, y: 60, width: 300, height: 300 }));
		mount(root);

		expect(hit(20, 80)).toBe('popup');
		click(20, 80);
		expect(only('click')).toEqual(['click:popup', 'click:trigger', 'click:root']);
	});

	it('does not hit a child scrolled out of its clip', () => {
		const panel = new ScrollContainer({ id: 'panel', width: 100, height: 100, contentHeight: 200 });
		const content = new Container({ width: 100, height: 200 });
		const rows = [0, 1, 2, 3].map((index) => new Probe({ id: `row-${index}`, x: 0, y: index * 50, width: 100, height: 50 }));
		rows.forEach((row) => content.addChild(row));
		panel.addChild(content);
		panel.scrollBy(60);
		mount(panel);

		// Row 0 now sits at y -60 to -10, outside the panel.
		expect(hit(10, 5)).toBe('row-1');
		expect(context.dispatcher.hitTest({ x: 10, y: -20 })).toBeNull();
	});

	// 4.7, second half: R4.8's clip reset honoured by the hit walk.
	it('lets a promoted popup declared inside a clip receive a click outside that clip', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const clipper = new Probe({ id: 'clipper', x: 0, y: 0, width: 100, height: 100, overflow: 'hidden' });
		clipper.addChild(new Probe({ id: 'clipped', x: 50, y: 50, width: 100, height: 100 }));
		clipper.addChild(new Probe({ id: 'popup', x: 50, y: 150, width: 100, height: 100, layer: 'popup' }));
		root.addChild(clipper);
		mount(root);

		expect(hit(120, 120)).toBeNull();
		expect(hit(75, 75)).toBe('clipped');
		click(120, 200);
		expect(only('click')[0]).toBe('click:popup');
	});

	it('hits a disabled button, which occludes, but does not click it (R9.5)', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const under = new Probe({ id: 'under', x: 0, y: 0, width: 100, height: 100 });
		const button = new Probe({ id: 'button', x: 0, y: 0, width: 100, height: 100, enabled: false });
		root.addChild(under);
		root.addChild(button);
		mount(root);

		expect(hit(50, 50)).toBe('button');
		click(50, 50);
		expect(log.filter((entry) => entry.endsWith(':button') && !entry.startsWith('pointerenter'))).toEqual([]);
		expect(only('click')).toEqual([]);
		expect(log).not.toContain('pointerdown:under');
	});

	it('skips a disabled container\'s subtree for delivery but not for targeting (R8.3)', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const disabled = new Group({ id: 'disabled', width: 200, height: 200, enabled: false });
		disabled.addChild(new Probe({ id: 'inner', width: 100, height: 100 }));
		root.addChild(disabled);
		mount(root);

		expect(hit(50, 50)).toBe('inner');
		click(50, 50);
		expect(only('pointerdown')).toEqual(['pointerdown:root']);
		expect(only('click')).toEqual([]);
	});

	it('does not hit a passthrough container\'s own box, only its children', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const container = new Group({ id: 'container', x: 0, y: 0, width: 200, height: 200 });
		container.addChild(new Probe({ id: 'child', x: 20, y: 20, width: 50, height: 50 }));
		root.addChild(container);
		mount(root);

		expect(hit(5, 5)).toBeNull();
		expect(hit(30, 30)).toBe('child');
	});

	it('reports a unit widget, not its label, as the target', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const widget = new Probe({ id: 'widget', width: 100, height: 40, pointerEvents: 'unit' });
		widget.addChild(new Probe({ id: 'label', x: 10, y: 10, width: 80, height: 20 }));
		root.addChild(widget);
		mount(root);

		expect(hit(50, 20)).toBe('widget');
	});

	it('ignores a pointerEvents none ghost and everything under it', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		root.addChild(new Probe({ id: 'target', width: 100, height: 100 }));
		const ghost = new Probe({ id: 'ghost', width: 100, height: 100, pointerEvents: 'none' });
		ghost.addChild(new Probe({ id: 'ghost-part', width: 100, height: 100 }));
		root.addChild(ghost);
		mount(root);

		expect(hit(50, 50)).toBe('target');
	});

	it('hits a rotated card within its rotated quad only', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		// A 100x100 square about its centre (150, 150), turned 45 degrees: a
		// diamond reaching 150 +- 70.7 on each axis.
		root.addChild(new Probe({ id: 'card', x: 100, y: 100, width: 100, height: 100, transform: { rotate: Math.PI / 4 } }));
		mount(root);

		expect(hit(150, 85)).toBe('card');
		expect(hit(105, 105)).toBeNull();
	});

	it('skips invisible and zero-opacity components as if they were not there (R3.27)', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		root.addChild(new Probe({ id: 'under', width: 100, height: 100 }));
		root.addChild(new Probe({ id: 'hidden', width: 100, height: 100, visible: false }));
		root.addChild(new Probe({ id: 'faded', width: 100, height: 100, opacity: 0 }));
		mount(root);

		expect(hit(50, 50)).toBe('under');
	});

	it('excludes a subtree on request, as the drag service will for its ghost', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		root.addChild(new Probe({ id: 'under', width: 100, height: 100 }));
		const ghost = new Probe({ id: 'ghost', width: 100, height: 100 });
		root.addChild(ghost);
		mount(root);

		expect(context.dispatcher.hitTest({ x: 50, y: 50 }, { exclude: ghost })?.id).toBe('under');
	});

	it('walks roots in mount order, the later over the earlier', () => {
		const first = new Probe({ id: 'first', width: 100, height: 100 });
		const second = new Probe({ id: 'second', width: 100, height: 100 });
		mount(first, second);

		expect(hit(50, 50)).toBe('second');
		second.unmount();
		expect(hit(50, 50)).toBe('first');
	});
});

describe('bubble (R9.6)', () => {
	function dialog(): { dialog: Probe; content: Probe } {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const shell = new Probe({ id: 'dialog', width: 200, height: 200 });
		const content = new Probe({ id: 'content', x: 10, y: 10, width: 100, height: 100 });
		shell.addChild(content);
		root.addChild(shell);
		mount(root);
		return { dialog: shell, content };
	}

	it('carries an unconsumed pointerdown from the content to the dialog', () => {
		dialog();
		send(pointer('down', 50, 50));
		expect(only('pointerdown')).toEqual(['pointerdown:content', 'pointerdown:dialog', 'pointerdown:root']);
	});

	it('stops at the component that consumed it', () => {
		const { content } = dialog();
		content.consumes = 'pointerdown';
		send(pointer('down', 50, 50));
		expect(only('pointerdown')).toEqual(['pointerdown:content']);
	});

	it('blocks with a scrim at opacity 0.01 from its first frame (R9.7)', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		root.addChild(new Probe({ id: 'button', width: 100, height: 100 }));
		const scrim = new Probe({ id: 'scrim', width: 400, height: 400, opacity: 0.01, layer: 'modal' });
		scrim.consumes = 'pointerdown';
		root.addChild(scrim);
		mount(root);

		send(pointer('down', 50, 50));
		expect(only('pointerdown')).toEqual(['pointerdown:scrim']);
	});
});

describe('enter, leave, and hovered (R9.8, R9.9)', () => {
	it('moving from A to B leaves A, then enters B', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const a = new Probe({ id: 'a', x: 0, y: 0, width: 100, height: 100 });
		const b = new Probe({ id: 'b', x: 100, y: 0, width: 100, height: 100 });
		root.addChild(a);
		root.addChild(b);
		mount(root);

		send(pointer('move', 50, 50));
		log.length = 0;
		send(pointer('move', 150, 50));

		expect(log.filter((entry) => entry.startsWith('pointerenter') || entry.startsWith('pointerleave'))).toEqual([
			'pointerleave:a',
			'pointerenter:b',
		]);
		expect(a.hovered).toBe(false);
		expect(b.hovered).toBe(true);
		expect(root.hovered).toBe(true);
	});

	it('leaves innermost first and enters outermost first, without bubbling', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const outer = new Probe({ id: 'outer', width: 200, height: 200 });
		const inner = new Probe({ id: 'inner', width: 100, height: 100 });
		outer.addChild(inner);
		root.addChild(outer);
		mount(root);

		send(pointer('move', 50, 50));
		expect(log).toEqual(['pointerenter:root', 'pointerenter:outer', 'pointerenter:inner', 'pointermove:inner', 'pointermove:outer', 'pointermove:root']);
		log.length = 0;
		// Nothing is hit there: the passthrough root is hovered only through a descendant.
		send(pointer('move', 300, 300));
		expect(log).toEqual(['pointerleave:inner', 'pointerleave:outer', 'pointerleave:root']);
	});

	it('keeps a button hovered while the pointer is over its label', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const button = new Probe({ id: 'button', width: 100, height: 40 });
		const label = new Probe({ id: 'label', x: 10, y: 10, width: 80, height: 20 });
		button.addChild(label);
		root.addChild(button);
		mount(root);

		send(pointer('move', 5, 5));
		send(pointer('move', 50, 20));
		expect(button.hovered).toBe(true);
		expect(label.hovered).toBe(true);
		expect(only('pointerleave')).toEqual([]);
	});

	it('updates hover when a scroll moves content under a still pointer', () => {
		const panel = new ScrollContainer({ id: 'panel', width: 100, height: 100 });
		const content = new Container({ width: 100, height: 200 });
		const rows = [0, 1, 2, 3].map((index) => new Probe({ id: `row-${index}`, x: 0, y: index * 50, width: 100, height: 50 }));
		rows.forEach((row) => content.addChild(row));
		panel.addChild(content);
		mount(panel);

		send(pointer('move', 10, 10));
		expect(rows[0].hovered).toBe(true);
		wheel(10, 10, 50);
		expect(rows[0].hovered).toBe(false);
		expect(rows[1].hovered).toBe(true);
	});

	it('updates hover when layout moves content under a still pointer', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const box = new Probe({ id: 'box', width: 100, height: 100 });
		root.addChild(box);
		mount(root);

		send(pointer('move', 150, 50));
		expect(box.hovered).toBe(false);
		box.setSize(200, 100);
		context.frame.layout();
		context.dispatcher.dispatchPending();
		expect(box.hovered).toBe(true);
	});

	it('clears hover when the pointer leaves the surface', () => {
		const box = new Probe({ id: 'box', width: 100, height: 100 });
		mount(box);
		send(pointer('move', 50, 50));
		send({ kind: 'leave', pointerId: 1 });
		expect(box.hovered).toBe(false);
		expect(only('pointerleave')).toEqual(['pointerleave:box']);
	});

	it('drops a hovered component that unmounts without a leave, and hovers what is now there', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const under = new Probe({ id: 'under', width: 100, height: 100 });
		const over = new Probe({ id: 'over', width: 100, height: 100 });
		root.addChild(under);
		root.addChild(over);
		mount(root);

		send(pointer('move', 50, 50));
		root.removeChild(over);
		context.dispatcher.dispatchPending();

		expect(over.hovered).toBe(false);
		expect(only('pointerleave')).toEqual([]);
		expect(under.hovered).toBe(true);
	});
});

describe('click (R9.31)', () => {
	function button(): Probe {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const shell = new Probe({ id: 'button', width: 100, height: 40 });
		shell.addChild(new Probe({ id: 'label', x: 0, y: 0, width: 50, height: 40 }));
		shell.addChild(new Probe({ id: 'icon', x: 50, y: 0, width: 50, height: 40 }));
		root.addChild(shell);
		mount(root);
		return shell;
	}

	it('down on the label and up on the icon is one click on the button', () => {
		button();
		send(pointer('down', 10, 20), pointer('move', 13, 20), pointer('up', 53, 20));
		expect(only('click')).toEqual(['click:button', 'click:root']);
	});

	/** Makes `shell` a drag source: each press on it starts a candidate drag (R9.12a). */
	function draggable(shell: Probe): void {
		shell.onPointerDown = (event) => {
			context.drag.start({ event, source: shell, data: null });
		};
	}

	it('synthesises no click once a press on a drag source moved past the threshold', () => {
		const shell = button();
		draggable(shell);
		send(pointer('down', 10, 20), pointer('move', 10 + dragThreshold('mouse') + 1, 20), pointer('up', 10, 20));
		expect(only('click')).toEqual([]);
	});

	it('still clicks a drag source moved within the threshold', () => {
		const shell = button();
		draggable(shell);
		send(pointer('down', 10, 20), pointer('move', 10 + dragThreshold('mouse'), 20), pointer('up', 10 + dragThreshold('mouse'), 20));
		expect(only('click')).toEqual(['click:label', 'click:button', 'click:root']);
	});

	// Departure from R9.31: a player's click that wanders never goes missing
	// on something that cannot be dragged, matching browser click semantics.
	it('clicks a non-draggable component however far the pointer wandered before release on it', () => {
		button();
		send(pointer('down', 10, 20), pointer('move', 300, 300), pointer('move', 90, 20), pointer('up', 90, 20));
		expect(only('click')).toEqual(['click:button', 'click:root']);
	});

	it('still clicks after a consumed press: consumption stops the bubble, not the gesture', () => {
		const shell = button();
		shell.consumes = 'pointerdown';
		click(10, 20);
		expect(only('click')[0]).toBe('click:label');
	});

	it('does not click when released outside what was pressed', () => {
		button();
		send(pointer('down', 10, 20), pointer('up', 300, 300));
		expect(only('click')).toEqual([]);
	});

	it('synthesises contextmenu, not click, for a secondary button (R9.30)', () => {
		button();
		click(10, 20, { button: 2 });
		expect(only('click')).toEqual([]);
		expect(only('contextmenu')[0]).toBe('contextmenu:label');
	});

	it('clicks only for the primary pointer', () => {
		button();
		click(10, 20, { pointerId: 2, isPrimary: false, pointerType: 'touch' });
		expect(only('click')).toEqual([]);
		expect(only('pointerdown')).toEqual(['pointerdown:label', 'pointerdown:button', 'pointerdown:root']);
	});
});

describe('capture (R9.10)', () => {
	function slider(): { track: Probe; thumb: Probe } {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const track = new Probe({ id: 'track', width: 200, height: 20 });
		const thumb = new Probe({ id: 'thumb', width: 20, height: 20 });
		thumb.captureOnDown = true;
		track.addChild(thumb);
		root.addChild(track);
		root.addChild(new Probe({ id: 'elsewhere', x: 0, y: 100, width: 400, height: 300 }));
		mount(root);
		return { track, thumb };
	}

	it('keeps routing a drag to the captor outside its bounds and ends on release anywhere', () => {
		slider();
		send(pointer('down', 10, 10), pointer('move', 300, 200), pointer('up', 300, 200));

		expect(only('pointermove')).toContain('pointermove:thumb');
		expect(log).not.toContain('pointermove:elsewhere');
		expect(only('pointerup')[0]).toBe('pointerup:thumb');
		expect(only('lostpointercapture')).toEqual(['lostpointercapture:thumb']);
		expect(context.dispatcher.captorOf(1)).toBeNull();
	});

	it('computes the captor\'s boundary events against the captor only', () => {
		const { thumb } = slider();
		send(pointer('down', 10, 10), pointer('move', 300, 200));
		expect(thumb.hovered).toBe(false);
		expect(log).not.toContain('pointerenter:elsewhere');
		send(pointer('up', 300, 200));
		// Release re-derives hover from the current position.
		expect(log).toContain('pointerenter:elsewhere');
	});

	it('delivers pointercancel to a captor that unmounts, and no click', () => {
		const { track, thumb } = slider();
		send(pointer('down', 10, 10));
		track.removeChild(thumb);
		send(pointer('up', 10, 10));

		expect(only('pointercancel')).toEqual(['pointercancel:thumb']);
		expect(only('click')).toEqual([]);
		expect(context.dispatcher.captorOf(1)).toBeNull();
	});

	it('cancels the capture of a captor that is hidden, bubbling from it (R9.10)', () => {
		const { thumb } = slider();
		send(pointer('down', 10, 10));
		thumb.visible = false;
		context.dispatcher.dispatchPending();

		expect(only('pointercancel')).toEqual(['pointercancel:thumb', 'pointercancel:track', 'pointercancel:root']);
		expect(context.dispatcher.captorOf(1)).toBeNull();
	});

	it('cancels every gesture on window blur, the captor first and then its ancestors', () => {
		slider();
		send(pointer('down', 10, 10), { kind: 'blur' }, pointer('up', 10, 10));
		expect(only('pointercancel')).toEqual(['pointercancel:thumb', 'pointercancel:track', 'pointercancel:root']);
		expect(only('click')).toEqual([]);
	});

	it('captures a touch implicitly at its press target, which is never hovered', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const pad = new Probe({ id: 'pad', width: 100, height: 100 });
		root.addChild(pad);
		root.addChild(new Probe({ id: 'elsewhere', x: 200, y: 0, width: 100, height: 100 }));
		mount(root);

		const touch = { pointerType: 'touch' as const, pointerId: 7 };
		send(pointer('down', 50, 50, touch), pointer('move', 250, 50, touch));
		expect(context.dispatcher.captorOf(7)).toBe(pad);
		expect(only('pointermove')[0]).toBe('pointermove:pad');
		expect(pad.hovered).toBe(false);
		send(pointer('up', 250, 50, touch));
		expect(context.dispatcher.captorOf(7)).toBeNull();
	});
});

describe('touch hold (R9.30)', () => {
	function pad(): Probe {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const target = new Probe({ id: 'pad', width: 100, height: 100 });
		root.addChild(target);
		mount(root);
		return target;
	}
	const touch = { pointerType: 'touch' as const, pointerId: 3 };

	it('fires contextmenu after a 500 ms hold, and the release is not a click', () => {
		pad();
		send(pointer('down', 50, 50, touch));
		context.clock.advance(TOUCH_HOLD_MS - 10);
		context.dispatcher.dispatchPending();
		expect(only('contextmenu')).toEqual([]);

		context.clock.advance(10);
		context.dispatcher.dispatchPending();
		context.dispatcher.dispatchPending();
		expect(only('contextmenu')).toEqual(['contextmenu:pad', 'contextmenu:root']);

		send(pointer('up', 50, 50, touch));
		expect(only('click')).toEqual([]);
	});

	it('does not fire for a touch that moved past the threshold, or for a mouse', () => {
		pad();
		send(pointer('down', 50, 50, touch), pointer('move', 70, 50, touch));
		context.clock.advance(TOUCH_HOLD_MS);
		context.dispatcher.dispatchPending();
		send(pointer('up', 70, 50, touch));

		send(pointer('down', 50, 50));
		context.clock.advance(TOUCH_HOLD_MS);
		context.dispatcher.dispatchPending();
		send(pointer('up', 50, 50));

		expect(only('contextmenu')).toEqual([]);
		// Neither press is on a drag source, so both still click.
		expect(only('click')).toEqual(['click:pad', 'click:root', 'click:pad', 'click:root']);
	});

	it('stamps events with the frame clock, not a platform timer (R8.28)', () => {
		const target = pad();
		const stamps: number[] = [];
		target.onPointerDown = (event) => stamps.push(event.timestamp);
		context.clock.advance(1234);
		send(pointer('down', 50, 50));
		expect(stamps).toEqual([context.clock.now - 1]);
	});
});

describe('wheel (R9.3, R9.32)', () => {
	function nested(): { outer: ScrollContainer; inner: ScrollContainer } {
		const outer = new ScrollContainer({ id: 'outer', width: 200, height: 200 });
		const outerContent = new Container({ width: 200, height: 1000 });
		const inner = new ScrollContainer({ id: 'inner', x: 0, y: 0, width: 100, height: 100 });
		inner.addChild(new Container({ width: 100, height: 132 }));
		outerContent.addChild(inner);
		outer.addChild(outerContent);
		mount(outer);
		return { outer, inner };
	}

	it('scrolls 16 logical pixels for one line-mode event', () => {
		const { inner } = nested();
		wheel(50, 50, 1, { deltaMode: 1 });
		expect(inner.scrollPosition).toBe(WHEEL_LINE_PX);
	});

	it('scrolls a page as the scroller\'s own viewport', () => {
		const { outer } = nested();
		wheel(150, 150, 1, { deltaMode: 2 });
		expect(outer.scrollPosition).toBe(200);
	});

	it('keeps a latched inner scroller for 150 ms at its end, then passes a new gesture on', () => {
		const { outer, inner } = nested();
		wheel(50, 50, 30);
		expect(inner.scrollPosition).toBe(30);
		// At its end (32), still latched: the outer panel does not move.
		context.clock.advance(WHEEL_LATCH_MS - 10);
		wheel(50, 50, 30);
		context.clock.advance(WHEEL_LATCH_MS - 10);
		wheel(50, 50, 30);
		expect(inner.scrollPosition).toBe(32);
		expect(outer.scrollPosition).toBe(0);
		// A new gesture: the inner panel cannot move down, so the outer takes it.
		context.clock.advance(WHEEL_LATCH_MS + 1);
		wheel(50, 50, 30);
		expect(outer.scrollPosition).toBe(30);
	});

	it('scrolls horizontally with Shift and a vertical-only delta', () => {
		// A horizontal scroller of the test's own: ScrollContainer is vertical only (R12.20).
		const deltas: Array<[number, number]> = [];
		class Wide extends Probe {
			public canScroll(deltaX: number): boolean {
				return deltaX !== 0;
			}

			public handleEvent(event: AnyUiEvent): void {
				super.handleEvent(event);
				if (event.type === 'wheel') deltas.push([event.deltaX, event.deltaY]);
			}
		}
		mount(new Wide({ id: 'wide', width: 100, height: 100 }));
		wheel(50, 50, 40, { shift: true });
		expect(deltas).toEqual([[40, 0]]);
	});
});

describe('keys (R9.15)', () => {
	it('delivers to the focused component, bubbles, and falls through to the hotkey table', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const field = new Probe({ id: 'field', width: 100, height: 40, focusable: true });
		root.addChild(field);
		mount(root);
		const hotkeys: string[] = [];
		context.dispatcher.hotkeys.register('F6', (stroke) => hotkeys.push(stroke.key));
		context.focus.focus(field);
		log.length = 0;

		key('down', 'F6');
		expect(log).toEqual(['keydown:field', 'keydown:root']);
		expect(hotkeys).toEqual(['F6']);

		field.consumes = 'keydown';
		key('down', 'F6');
		expect(hotkeys).toEqual(['F6']);
	});

	it('reaches the hotkey table on keydown only, with nothing focused', () => {
		const hotkeys: string[] = [];
		context.dispatcher.hotkeys.register('F6', (stroke) => hotkeys.push(stroke.key));
		key('down', 'F6');
		key('up', 'F6');
		expect(hotkeys).toEqual(['F6']);
		expect(context.dispatcher.claimsKey('F6')).toBe(true);
		expect(context.dispatcher.claimsKey('F7')).toBe(false);

		const button = new Probe({ id: 'button', width: 10, height: 10, focusable: true });
		mount(button);
		context.focus.focus(button);
		// A focused component that takes no text claims navigation, not letters.
		expect(context.dispatcher.claimsKey('Enter')).toBe(true);
		expect(context.dispatcher.claimsKey('c')).toBe(false);
		expect(context.dispatcher.claimsKey('Tab')).toBe(true);
	});

	it('clears focus on a press outside the focused component, with onBlur', () => {
		const root = new Group({ id: 'root', width: 400, height: 400 });
		const field = new Probe({ id: 'field', width: 100, height: 40, focusable: true });
		root.addChild(field);
		root.addChild(new Probe({ id: 'other', x: 200, y: 0, width: 100, height: 40 }));
		mount(root);
		context.focus.focus(field);
		expect(field.focused).toBe(true);

		click(50, 20);
		expect(context.focus.focused).toBe(field);
		log.length = 0;
		click(250, 20);
		expect(context.focus.focused).toBeNull();
		expect(field.focused).toBe(false);
		expect(only('blur')).toEqual(['blur:field']);
	});
});

describe('the queue (R9.2)', () => {
	it('coalesces consecutive moves of one pointer, keeping the skipped positions', () => {
		const box = new Probe({ id: 'box', width: 400, height: 400 });
		const moves: number[] = [];
		box.onPointerMove = (event) => moves.push(event.coalesced.length);
		mount(box);

		context.dispatcher.enqueue(pointer('move', 10, 10));
		context.dispatcher.enqueue(pointer('move', 20, 20));
		context.dispatcher.enqueue(pointer('move', 30, 30));
		expect(context.dispatcher.pendingCount).toBe(1);
		context.dispatcher.dispatchPending();
		expect(moves).toEqual([2]);
	});

	it('abandons a press held across a pause, so the release after resume does not click', () => {
		const box = new Probe({ id: 'box', width: 100, height: 100 });
		box.captureOnDown = true;
		mount(box);
		send(pointer('down', 10, 10));
		expect(context.dispatcher.captorOf(1)).toBe(box);

		context.dispatcher.paused = true;
		expect(only('pointercancel')).toEqual(['pointercancel:box']);
		expect(context.dispatcher.captorOf(1)).toBeNull();
		context.dispatcher.paused = false;

		send(pointer('up', 10, 10));
		expect(only('click')).toEqual([]);
	});

	it('drops input offered while paused and discards what was queued (R13.35)', () => {
		const box = new Probe({ id: 'box', width: 100, height: 100 });
		mount(box);
		context.dispatcher.enqueue(pointer('down', 10, 10));
		context.dispatcher.paused = true;
		context.dispatcher.enqueue(pointer('up', 10, 10));
		context.dispatcher.paused = false;
		context.dispatcher.dispatchPending();
		expect(log).toEqual([]);
	});

	it('keeps dispatching the batch after a handler throws', () => {
		const box = new Probe({ id: 'box', width: 100, height: 100 });
		box.onPointerDown = () => {
			throw new Error('handler failed');
		};
		mount(box);
		const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

		context.dispatcher.enqueue(pointer('down', 10, 10));
		context.dispatcher.enqueue(pointer('up', 10, 10));
		context.dispatcher.dispatchPending();

		expect(error).toHaveBeenCalledTimes(1);
		expect(only('click')).toEqual(['click:box']);
		error.mockRestore();
	});

	it('runs the callback properties before the component\'s own handling (R8.2)', () => {
		const layer = new Container({ id: 'layer', width: 100, height: 100, pointerEvents: 'auto' });
		const seen: string[] = [];
		layer.onPointerDown = () => seen.push('down');
		layer.onClick = (event) => {
			if (event.type === 'click') seen.push(`click at ${event.local?.x},${event.local?.y}`);
		};
		mount(layer);
		click(10, 20);
		expect(seen).toEqual(['down', 'click at 10,20']);
	});
});

describe('synthesised pointer fields (R9.1)', () => {
	/** Records each pointer event as `type id pointerType primary|secondary`. */
	class IdentityProbe extends Component {
		public readonly seen: string[] = [];

		public handleEvent(event: AnyUiEvent): void {
			super.handleEvent(event);
			if (!(event instanceof UiPointerEvent)) return;
			this.seen.push(`${event.type} ${event.pointerId} ${event.pointerType} ${event.isPrimary ? 'primary' : 'secondary'}`);
		}
	}

	function pad(): IdentityProbe {
		const probe = new IdentityProbe({ id: 'pad', width: 200, height: 200 });
		mount(probe);
		return probe;
	}

	it('gives a pen\'s boundary events the pen\'s id and type', () => {
		const probe = pad();
		const pen = { pointerId: 7, pointerType: 'pen' as const };
		click(50, 50, pen);
		send({ kind: 'leave', pointerId: 7 });

		expect(probe.seen).toContain('pointerenter 7 pen primary');
		expect(probe.seen).toContain('pointerleave 7 pen primary');
		expect(probe.seen.every((line) => line.includes(' 7 pen primary'))).toBe(true);
	});

	it('cancels a second touch as a non-primary touch', () => {
		const probe = pad();
		send(
			pointer('down', 50, 50, { pointerId: 1, pointerType: 'touch' }),
			pointer('down', 60, 60, { pointerId: 2, pointerType: 'touch', isPrimary: false }),
			pointer('cancel', 60, 60, { pointerId: 2, pointerType: 'touch', isPrimary: false }),
		);

		expect(probe.seen).toContain('pointercancel 2 touch secondary');
		expect(probe.seen).toContain('lostpointercapture 2 touch secondary');
	});

	it('reports a touch\'s capture loss after its release as a touch', () => {
		const probe = pad();
		const touch = { pointerId: 3, pointerType: 'touch' as const };
		send(pointer('down', 50, 50, touch), pointer('up', 50, 50, touch));

		expect(probe.seen).toContain('lostpointercapture 3 touch primary');
	});

	it('keeps a mouse\'s identity for its leave after the press ends', () => {
		const probe = pad();
		click(50, 50, { pointerId: 4 });
		send({ kind: 'leave', pointerId: 4 });
		send(pointer('move', 50, 50, { pointerId: 5, pointerType: 'pen' }));

		expect(probe.seen).toContain('pointerleave 4 mouse primary');
		expect(probe.seen).toContain('pointerenter 5 pen primary');
	});
});
