/**
 * @jest-environment jsdom
 */
import { Component } from '../components/Component';
import type { MountContext } from '../components/MountContext';
import { createTestContext } from '../components/testing';
import { AnyUiEvent, UiPointerEvent } from '../input/events';
import { PointerAdapter } from '../input/PointerAdapter';
import { InjectionResult, injectInput } from './inputInjection';
import { installInputHooks } from './hooks';

/**
 * R13.35's dispatch half. Everything here goes through `injectInput`, which
 * dispatches DOM events at the canvas and the focused element, which the
 * pointer adapter queues and the dispatcher delivers to a mounted component
 * the ordinary way (R9.25). Nothing calls a component method directly: that
 * is the whole point of the rule, and a test that shortcut it would prove
 * nothing about the seam.
 */

/** A component occupying logical pixels 100,100 to 200,200 that records what reaches it. */
class Box extends Component {
	public readonly seen: string[] = [];
	public readonly keys: string[] = [];
	public readonly wheels: Array<[number, number]> = [];
	public readonly pointers: Array<{ type: string; pointerId: number; pointerType: string; isPrimary: boolean }> = [];

	constructor() {
		super({ id: 'box', x: 100, y: 100, width: 100, height: 100, focusable: true });
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		// Focus follows a press now (R9.23); the seam under test is input delivery.
		if (event.type === 'focus' || event.type === 'blur') return;
		this.seen.push(event.type);
		if (event.type === 'keydown') this.keys.push(event.key);
		if (event.type === 'wheel') this.wheels.push([event.deltaX, event.deltaY]);
		if (event instanceof UiPointerEvent) {
			const { type, pointerId, pointerType, isPrimary } = event;
			this.pointers.push({ type, pointerId, pointerType, isPrimary });
		}
	}

	public count(type: string): number {
		return this.seen.filter((seen) => seen === type).length;
	}
}

let canvas: HTMLCanvasElement;
let context: MountContext;
let adapter: PointerAdapter;
let box: Box;

/** Injects, then runs the next frame's input phase, which is when the events take effect. */
function inject(commands: string[]): InjectionResult {
	const result = injectInput({ canvas, dispatcher: context.dispatcher }, commands);
	context.dispatcher.dispatchPending();
	return result;
}

beforeAll(() => {
	canvas = document.createElement('canvas');
	document.body.appendChild(canvas);
});

beforeEach(() => {
	context = createTestContext();
	adapter = new PointerAdapter({ dispatcher: context.dispatcher });
	adapter.attach(canvas);
	box = new Box();
	box.mount(context);
	context.focus.focus(box);
});

afterEach(() => {
	adapter.detach();
	box.unmount();
});

describe('the seam', () => {
	it('drives a click all the way to the component under it', () => {
		const result = inject(['click,150,150']);

		expect(box.seen).toEqual(['pointerenter', 'pointermove', 'pointerdown', 'pointerup', 'click']);
		expect(result.ok).toBe(true);
		expect(result.commands[0].events.map((event) => event.type)).toEqual([
			'pointermove',
			'pointerdown',
			'pointerup',
		]);
	});

	it('queues until the next frame dispatches (R9.2)', () => {
		injectInput({ canvas, dispatcher: context.dispatcher }, ['click,150,150']);
		expect(box.seen).toEqual([]);
		expect(context.dispatcher.pendingCount).toBe(3);

		context.dispatcher.dispatchPending();
		expect(box.count('click')).toBe(1);
	});

	it('runs several commands in order in one call', () => {
		const result = inject(['move,150,150', 'down,150,150', 'up,150,150']);

		expect(box.count('pointerdown')).toBe(1);
		expect(box.count('click')).toBe(1);
		expect(result.commands.map((command) => command.events[0].type)).toEqual([
			'pointermove',
			'pointerdown',
			'pointerup',
		]);
	});

	it('leaves a component alone when the coordinates miss it', () => {
		inject(['click,10,10']);

		expect(box.seen).toEqual([]);
	});

	it('fires pointerleave when the pointer leaves', () => {
		inject(['move,150,150']);
		inject(['move,10,10']);

		expect(box.count('pointerenter')).toBe(1);
		expect(box.count('pointerleave')).toBe(1);
		expect(box.hovered).toBe(false);
	});

	// R9.2: consecutive moves of one pointer within a frame coalesce, so a
	// move that is only passed through never hovers anything.
	it('coalesces the moves of one frame to the last position', () => {
		inject(['move,150,150', 'move,10,10']);

		expect(box.seen).toEqual([]);
	});

	it('hit-tests every verb at its own coordinates', () => {
		inject(['move,10,10', 'down,150,150', 'up,150,150']);

		expect(box.count('click')).toBe(1);
	});
});

describe('coordinates are logical pixels in the snapshot space (R7.1, R7.15)', () => {
	// The adapter computes clientX - rect.left, so the injector adds the rect
	// back. With the canvas away from the origin, a hook that skipped that
	// would land 30,40 off and still look like it worked.
	it('translates through the canvas bounding rect, not devicePixelRatio', () => {
		const originalRect = canvas.getBoundingClientRect;
		const seen: Array<[number, number]> = [];
		canvas.getBoundingClientRect = () => ({ left: 30, top: 40 }) as DOMRect;
		const listener = (event: Event): void => {
			seen.push([(event as MouseEvent).clientX, (event as MouseEvent).clientY]);
		};
		canvas.addEventListener('pointermove', listener);

		try {
			inject(['click,150,150']);
		} finally {
			canvas.getBoundingClientRect = originalRect;
			canvas.removeEventListener('pointermove', listener);
		}

		expect(seen).toEqual([[180, 190]]);
		// The hit test sees 150,150: the rect went on in the injector and came
		// back off in the adapter.
		expect(box.count('click')).toBe(1);
	});

	it('accepts fractional coordinates', () => {
		inject(['click,100.5,199.5']);

		expect(box.count('click')).toBe(1);
	});
});

describe('mouse buttons', () => {
	it('defaults to button 0 and carries an explicit one onto the event', () => {
		const buttons: Array<[number, number]> = [];
		const listener = (event: Event): void => {
			buttons.push([(event as MouseEvent).button, (event as MouseEvent).buttons]);
		};
		canvas.addEventListener('pointerdown', listener);

		inject(['move,150,150', 'down,150,150', 'down,150,150,2']);
		canvas.removeEventListener('pointerdown', listener);

		expect(buttons).toEqual([
			[0, 1],
			[2, 2],
		]);
	});

	it('delivers a secondary-button click as contextmenu, not click (R9.30)', () => {
		inject(['click,150,150,2']);

		expect(box.count('contextmenu')).toBe(1);
		expect(box.count('click')).toBe(0);
	});
});

describe('pointer fields and cancel (R9.25)', () => {
	/** `type pointerId pointerType isPrimary` for each pointer event the box hears. */
	function pointerLog(): string[] {
		return box.pointers.map(({ type, pointerId, pointerType, isPrimary }) =>
			[type, pointerId, pointerType, isPrimary ? 'primary' : 'secondary'].join(' '),
		);
	}

	it('defaults to pointer 1, a primary mouse', () => {
		inject(['click,150,150']);

		expect(pointerLog()).toContain('pointerdown 1 mouse primary');
	});

	it('carries the pointerId and pointerType through the adapter to the component', () => {
		inject(['click,150,150,0,7,pen']);

		// Only the events a platform event carries: the dispatcher synthesises
		// boundary events' fields itself (DDB-212).
		expect(pointerLog().filter((line) => !line.startsWith('pointerenter'))).toEqual([
			'pointermove 7 pen primary',
			'pointerdown 7 pen primary',
			'pointerup 7 pen primary',
			'click 7 pen primary',
		]);
	});

	// A second finger down while the first is still down is not primary, and
	// R9.1 lets only the primary pointer click.
	it('makes a second touch non-primary, so its tap does not click', () => {
		inject(['down,150,150,0,1,touch', 'down,160,160,0,2,touch']);
		inject(['up,160,160,0,2,touch']);

		expect(pointerLog()).toContain('pointerdown 2 touch secondary');
		expect(box.count('click')).toBe(0);

		inject(['up,150,150,0,1,touch']);
		expect(box.count('click')).toBe(1);
	});

	it('hands primary to the next touch only once every touch has lifted', () => {
		inject(['down,150,150,0,1,touch', 'down,160,160,0,2,touch']);
		inject(['up,150,150,0,1,touch']);
		inject(['down,170,170,0,3,touch']);
		inject(['up,160,160,0,2,touch', 'up,170,170,0,3,touch']);
		inject(['down,150,150,0,4,touch']);

		expect(pointerLog()).toContain('pointerdown 3 touch secondary');
		expect(pointerLog()).toContain('pointerdown 4 touch primary');
	});

	it('keeps a mouse primary while a touch is down', () => {
		inject(['down,150,150,0,2,touch', 'click,150,150']);

		expect(pointerLog()).toContain('pointerdown 1 mouse primary');
	});

	it('cancels a press so no click follows the release', () => {
		inject(['move,150,150', 'down,150,150', 'cancel']);
		inject(['up,150,150']);

		expect(box.count('pointercancel')).toBe(1);
		expect(box.count('click')).toBe(0);
	});

	it('cancels only the named pointer', () => {
		inject(['down,150,150,0,1,touch', 'down,160,160,0,2,touch', 'cancel,2']);
		inject(['up,150,150,0,1,touch']);

		expect(box.pointers.filter((pointer) => pointer.type === 'pointercancel').map((pointer) => pointer.pointerId)).toEqual([2]);
		expect(box.count('click')).toBe(1);
	});

	it('sends cancel from where the pointer last was, as its own type', () => {
		const seen: string[] = [];
		const listener = (event: Event): void => {
			const pointer = event as MouseEvent & { pointerType: string };
			seen.push(`${pointer.clientX},${pointer.clientY} ${pointer.pointerType}`);
		};
		canvas.addEventListener('pointercancel', listener);

		const result = inject(['down,150,160,0,4,touch', 'cancel,4']);
		canvas.removeEventListener('pointercancel', listener);

		expect(seen).toEqual(['150,160 touch']);
		expect(result.commands[1].events).toEqual([{ type: 'pointercancel', dispatched: true, swallowed: false }]);
	});

	// A real pointer never changes type mid-gesture, so an up or a move that
	// names no type is sent as the type its pointer went down as.
	it('sends an up that names no type as its pointer\'s type', () => {
		const types: string[] = [];
		const listener = (event: Event): void => {
			types.push(`${event.type} ${(event as MouseEvent & { pointerType: string }).pointerType}`);
		};
		canvas.addEventListener('pointerup', listener);
		canvas.addEventListener('pointermove', listener);

		inject(['down,150,150,0,2,touch', 'move,155,150,2', 'up,155,150,0,2']);
		canvas.removeEventListener('pointerup', listener);
		canvas.removeEventListener('pointermove', listener);

		expect(types).toEqual(['pointermove touch', 'pointerup touch']);
		// A pointer never seen is a mouse.
		inject(['click,150,150,0,9']);
		expect(pointerLog()).toContain('pointerdown 9 mouse primary');
	});

	it('refuses a cancel for a pointer it has never seen', () => {
		const result = inject(['cancel,42']);

		expect(result.ok).toBe(false);
		expect(result.commands[0]).toEqual({
			command: 'cancel,42',
			ok: false,
			error: 'cancel: no pointer 42 has moved or pressed yet',
			events: [],
		});
		expect(box.count('pointercancel')).toBe(0);
	});

	// R9.10: a touch pointer is implicitly captured by its pointerdown
	// target, so dragging off the box still releases on it.
	it('gets the dispatcher to capture a touch implicitly', () => {
		inject(['down,150,150,0,3,touch']);
		inject(['move,10,10,3,touch']);
		inject(['up,10,10,0,3,touch']);

		expect(pointerLog()).toContain('pointerup 3 touch primary');
	});
});

describe('scroll', () => {
	// R9.3: the delta is logical pixels, dispatched as deltaY in DOM_DELTA_PIXEL
	// mode, and pixel deltas pass through normalisation unchanged.
	it('delivers the delta as vertical pixels to the component under the pointer', () => {
		inject(['move,150,150', 'scroll,150,150,100']);

		expect(box.wheels).toEqual([[0, 100]]);
	});

	it('dispatches DOM_DELTA_PIXEL so no per-notch constant is implied', () => {
		const modes: number[] = [];
		const listener = (event: Event): void => {
			modes.push((event as WheelEvent).deltaMode);
		};
		canvas.addEventListener('wheel', listener);

		inject(['scroll,150,150,-40']);
		canvas.removeEventListener('wheel', listener);

		expect(modes).toEqual([WheelEvent.DOM_DELTA_PIXEL]);
		expect(box.wheels).toEqual([[0, -40]]);
	});

	it('routes by the scroll position, not the last move', () => {
		inject(['move,10,10', 'scroll,150,150,100']);

		expect(box.wheels).toEqual([[0, 100]]);
	});
});

describe('keys', () => {
	it('reaches the focused component through the window listener', () => {
		inject(['keydown,Enter']);

		expect(box.keys).toEqual(['Enter']);
	});

	// Real key events start at the focused element and bubble through document
	// to window. Dispatching straight at window would miss the game's F5/F12
	// handler, which is registered on document.
	it('bubbles through document as a real key event does', () => {
		const seen: string[] = [];
		const listener = (event: Event): void => {
			seen.push((event as KeyboardEvent).key);
		};
		document.addEventListener('keydown', listener);

		inject(['keydown,F5']);
		document.removeEventListener('keydown', listener);

		expect(seen).toEqual(['F5']);
	});

	// R13.36's collapse is a polled-key-state hazard. The adapter queues each
	// key event and the dispatcher delivers each, so a down and an up in one
	// frame both arrive, in order.
	it('delivers a down and an up in the same frame without collapsing them', () => {
		inject(['keydown,a', 'keyup,a']);

		expect(box.seen).toEqual(['keydown', 'keyup']);
		expect(box.keys).toEqual(['a']);
	});

	it('sends the key verbatim, so case and punctuation survive', () => {
		inject(['keydown,A', 'keydown,,', 'keydown, ']);

		expect(box.keys).toEqual(['A', ',', ' ']);
	});
});

describe('pause (R13.35)', () => {
	it('ignores injected input while paused and says so', () => {
		context.dispatcher.paused = true;

		const result = inject(['click,150,150', 'keydown,Enter']);

		expect(box.seen).toEqual([]);
		expect(result.paused).toBe(true);
		expect(result.commands.every((command) => command.events.every((event) => event.swallowed))).toBe(true);
		// Swallowed is not the same as undelivered: the events were dispatched,
		// the dispatcher's gate dropped them.
		expect(result.ok).toBe(true);
	});

	it('delivers again after resuming, with no backlog from the pause', () => {
		context.dispatcher.paused = true;
		inject(['click,150,150']);

		context.dispatcher.paused = false;
		const result = inject(['click,150,150']);

		expect(box.count('click')).toBe(1);
		expect(result.paused).toBe(false);
		expect(result.commands[0].events.every((event) => event.swallowed)).toBe(false);
	});
});

describe('bad input', () => {
	it('reports a parse failure without throwing or dispatching', () => {
		const result = inject(['clik,150,150']);

		expect(box.seen).toEqual([]);
		expect(result.ok).toBe(false);
		expect(result.commands[0]).toEqual({
			command: 'clik,150,150',
			ok: false,
			error: 'unknown command "clik" (expected move, down, up, click, cancel, scroll, keydown, keyup)',
			events: [],
		});
	});

	it('runs the good commands either side of a bad one', () => {
		const result = inject(['move,150,150', 'down,nope,150', 'down,150,150']);

		expect(box.count('pointerdown')).toBe(1);
		expect(result.ok).toBe(false);
		expect(result.commands.map((command) => command.ok)).toEqual([true, false, true]);
	});

	it('returns an empty, successful result for no commands', () => {
		expect(inject([])).toEqual({ ok: true, paused: false, commands: [] });
	});
});

describe('installInputHooks', () => {
	interface DevWindow extends Window {
		__dev?: { input(...commands: string[]): unknown; state?: () => string };
	}

	it('installs window.__dev.input and merges with what is already there', () => {
		const devWindow = window as DevWindow;
		devWindow.__dev = { input: () => undefined, state: () => 'kept' };

		installInputHooks({ canvas, dispatcher: context.dispatcher });

		expect(typeof devWindow.__dev?.input).toBe('function');
		expect(devWindow.__dev?.state?.()).toBe('kept');

		devWindow.__dev?.input('click,150,150');
		context.dispatcher.dispatchPending();
		expect(box.count('click')).toBe(1);

		delete devWindow.__dev;
	});
});
