/**
 * @jest-environment jsdom
 */
import { InputSystem, Interactive } from '../input/InputSystem';
import { injectInput } from './inputInjection';
import { installInputHooks } from './hooks';

/**
 * R13.35's dispatch half. Everything here goes through `injectInput`, which
 * dispatches DOM events at the canvas and the focused element, and is observed
 * through handlers registered with the InputSystem the ordinary way. Nothing
 * calls a component method directly: that is the whole point of the rule, and
 * a test that shortcut it would prove nothing about the seam.
 *
 * setup() runs once for the file rather than per test. `InputSystem.unmount`
 * (InputSystem.ts:114-124) hands freshly bound handlers to removeEventListener,
 * so nothing is ever removed and a second setup() would leave two window
 * keydown listeners delivering every key twice. Pre-existing engine bug,
 * recorded in .claude/notes/ddb55-phase0-recon.md under Input, not this
 * feature's to fix here.
 */

interface Box extends Interactive {
	overs: number;
	outs: number;
	downs: number;
	ups: number;
	keys: string[];
	wheels: Array<[number, number]>;
}

/** A component occupying logical pixels 100,100 to 200,200. */
function makeBox(): Box {
	return {
		containsPoint: (x: number, y: number) => x >= 100 && x <= 200 && y >= 100 && y <= 200,
		overs: 0,
		outs: 0,
		downs: 0,
		ups: 0,
		keys: [],
		wheels: [],
	};
}

let canvas: HTMLCanvasElement;
let box: Box;

beforeAll(() => {
	canvas = document.createElement('canvas');
	document.body.appendChild(canvas);
	InputSystem.getInstance().setup(canvas);
});

beforeEach(() => {
	InputSystem.getInstance().paused = false;

	box = makeBox();
	InputSystem.registerMouseOver(box, () => box.overs++);
	InputSystem.registerMouseOut(box, () => box.outs++);
	InputSystem.registerMouseDown(box, () => box.downs++);
	InputSystem.registerMouseUp(box, () => box.ups++);
	InputSystem.registerWheel(box, (dx, dy) => box.wheels.push([dx, dy]));
	InputSystem.registerKeyDown(box, (key) => box.keys.push(key));
	InputSystem.setFocus(box);
});

afterEach(() => {
	InputSystem.unregisterComponent(box);
	InputSystem.setFocus(null);
	InputSystem.getInstance().paused = false;
	// Park the pointer outside the box so the next test starts unhovered.
	injectInput(canvas, ['move,0,0']);
});

describe('the seam', () => {
	it('drives a click all the way to a registered handler', () => {
		const result = injectInput(canvas, ['click,150,150']);

		expect(box.overs).toBe(1);
		expect(box.downs).toBe(1);
		expect(box.ups).toBe(1);
		expect(result.ok).toBe(true);
		expect(result.commands[0].events.map((event) => event.type)).toEqual([
			'mousemove',
			'mousedown',
			'mouseup',
		]);
	});

	it('runs several commands in order in one call', () => {
		const result = injectInput(canvas, ['move,150,150', 'down,150,150', 'up,150,150']);

		expect(box.overs).toBe(1);
		expect(box.downs).toBe(1);
		expect(box.ups).toBe(1);
		expect(result.commands.map((command) => command.events[0].type)).toEqual([
			'mousemove',
			'mousedown',
			'mouseup',
		]);
	});

	it('leaves a component alone when the coordinates miss it', () => {
		injectInput(canvas, ['click,10,10']);

		expect(box.overs).toBe(0);
		expect(box.downs).toBe(0);
	});

	it('fires mouseout when the pointer leaves', () => {
		injectInput(canvas, ['move,150,150', 'move,10,10']);

		expect(box.overs).toBe(1);
		expect(box.outs).toBe(1);
	});
});

describe('coordinates are logical pixels in the snapshot space (R7.1, R7.15)', () => {
	// handleMouseMove computes clientX - rect.left, so the injector adds the
	// rect back. With the canvas away from the origin, a hook that skipped that
	// would land 30,40 off and still look like it worked.
	it('translates through the canvas bounding rect, not devicePixelRatio', () => {
		const originalRect = canvas.getBoundingClientRect;
		const seen: Array<[number, number]> = [];
		canvas.getBoundingClientRect = () => ({ left: 30, top: 40 }) as DOMRect;
		canvas.addEventListener('mousemove', (event) => {
			seen.push([(event as MouseEvent).clientX, (event as MouseEvent).clientY]);
		});

		try {
			injectInput(canvas, ['click,150,150']);
		} finally {
			canvas.getBoundingClientRect = originalRect;
		}

		expect(seen).toEqual([[180, 190]]);
		// The component's containsPoint sees 150,150: the rect went on in the
		// injector and came back off in the handler.
		expect(box.downs).toBe(1);
	});

	it('accepts fractional coordinates', () => {
		injectInput(canvas, ['click,100.5,199.5']);

		expect(box.downs).toBe(1);
	});
});

describe('mouse buttons', () => {
	it('defaults to button 0 and carries an explicit one onto the event', () => {
		const buttons: Array<[number, number]> = [];
		const listener = (event: Event) => {
			buttons.push([(event as MouseEvent).button, (event as MouseEvent).buttons]);
		};
		canvas.addEventListener('mousedown', listener);

		injectInput(canvas, ['move,150,150', 'down,150,150', 'down,150,150,2']);
		canvas.removeEventListener('mousedown', listener);

		expect(buttons).toEqual([
			[0, 1],
			[2, 2],
		]);
	});
});

describe('scroll', () => {
	// R9.3: the delta is logical pixels, dispatched as deltaY in DOM_DELTA_PIXEL
	// mode. The InputSystem hands the raw deltas to the component, so what the
	// handler sees is what was injected.
	it('delivers the delta as vertical pixels to the component under the pointer', () => {
		injectInput(canvas, ['move,150,150', 'scroll,150,150,100']);

		expect(box.wheels).toEqual([[0, 100]]);
	});

	it('dispatches DOM_DELTA_PIXEL so no per-notch constant is implied', () => {
		const modes: number[] = [];
		const listener = (event: Event) => modes.push((event as WheelEvent).deltaMode);
		canvas.addEventListener('wheel', listener);

		injectInput(canvas, ['move,150,150', 'scroll,150,150,-40']);
		canvas.removeEventListener('wheel', listener);

		expect(modes).toEqual([WheelEvent.DOM_DELTA_PIXEL]);
		expect(box.wheels).toEqual([[0, -40]]);
	});

	// R13.35 expands click and nothing else, and handleWheel routes by the
	// tracked pointer rather than by the event, so a scroll with no preceding
	// move lands wherever the pointer already was. Documented, not papered over.
	it('does not move the pointer, so it needs a move first', () => {
		injectInput(canvas, ['move,10,10', 'scroll,150,150,100']);

		expect(box.wheels).toEqual([]);
	});
});

describe('keys', () => {
	it('reaches the focused component through the window listener', () => {
		injectInput(canvas, ['keydown,Enter']);

		expect(box.keys).toEqual(['Enter']);
	});

	// Real key events start at the focused element and bubble through document
	// to window. Dispatching straight at window would miss the game's F5/F12
	// handler, which is registered on document.
	it('bubbles through document as a real key event does', () => {
		const seen: string[] = [];
		const listener = (event: Event) => seen.push((event as KeyboardEvent).key);
		document.addEventListener('keydown', listener);

		injectInput(canvas, ['keydown,F5']);
		document.removeEventListener('keydown', listener);

		expect(seen).toEqual(['F5']);
	});

	// R13.36's collapse is a polled-key-state hazard. This engine is
	// event-driven: handleKeyDown runs synchronously from the DOM listener, so
	// a down and an up in one call are both delivered, in order, and no test
	// needs to split them across frames.
	it('delivers a down and an up in the same call without collapsing them', () => {
		const seen: string[] = [];
		const down = (event: Event) => seen.push(`down:${(event as KeyboardEvent).key}`);
		const up = (event: Event) => seen.push(`up:${(event as KeyboardEvent).key}`);
		window.addEventListener('keydown', down);
		window.addEventListener('keyup', up);

		injectInput(canvas, ['keydown,a', 'keyup,a']);
		window.removeEventListener('keydown', down);
		window.removeEventListener('keyup', up);

		expect(seen).toEqual(['down:a', 'up:a']);
		expect(box.keys).toEqual(['a']);
	});

	it('sends the key verbatim, so case and punctuation survive', () => {
		injectInput(canvas, ['keydown,A', 'keydown,,', 'keydown, ']);

		expect(box.keys).toEqual(['A', ',', ' ']);
	});
});

describe('pause (R13.35)', () => {
	it('ignores injected input while paused and says so', () => {
		InputSystem.getInstance().paused = true;

		const result = injectInput(canvas, ['click,150,150', 'keydown,Enter']);

		expect(box.downs).toBe(0);
		expect(box.keys).toEqual([]);
		expect(result.paused).toBe(true);
		expect(result.commands.every((command) => command.events.every((event) => event.swallowed))).toBe(true);
		// Swallowed is not the same as undelivered: the events were dispatched,
		// the InputSystem's gate dropped them.
		expect(result.ok).toBe(true);
	});

	it('delivers again after resuming, with no backlog from the pause', () => {
		InputSystem.getInstance().paused = true;
		injectInput(canvas, ['click,150,150']);

		InputSystem.getInstance().paused = false;
		const result = injectInput(canvas, ['click,150,150']);

		expect(box.downs).toBe(1);
		expect(result.paused).toBe(false);
		expect(result.commands[0].events.every((event) => event.swallowed)).toBe(false);
	});
});

describe('bad input', () => {
	it('reports a parse failure without throwing or dispatching', () => {
		const result = injectInput(canvas, ['clik,150,150']);

		expect(box.downs).toBe(0);
		expect(result.ok).toBe(false);
		expect(result.commands[0]).toEqual({
			command: 'clik,150,150',
			ok: false,
			error: 'unknown command "clik" (expected move, down, up, click, scroll, keydown, keyup)',
			events: [],
		});
	});

	it('runs the good commands either side of a bad one', () => {
		const result = injectInput(canvas, ['move,150,150', 'down,nope,150', 'down,150,150']);

		expect(box.downs).toBe(1);
		expect(result.ok).toBe(false);
		expect(result.commands.map((command) => command.ok)).toEqual([true, false, true]);
	});

	it('returns an empty, successful result for no commands', () => {
		expect(injectInput(canvas, [])).toEqual({ ok: true, paused: false, commands: [] });
	});
});

describe('installInputHooks', () => {
	interface DevWindow extends Window {
		__dev?: { input(...commands: string[]): unknown; state?: () => string };
	}

	it('installs window.__dev.input and merges with what is already there', () => {
		const devWindow = window as DevWindow;
		devWindow.__dev = { input: () => undefined, state: () => 'kept' };

		installInputHooks(canvas);

		expect(typeof devWindow.__dev?.input).toBe('function');
		expect(devWindow.__dev?.state?.()).toBe('kept');

		devWindow.__dev?.input('click,150,150');
		expect(box.downs).toBe(1);

		delete devWindow.__dev;
	});
});
