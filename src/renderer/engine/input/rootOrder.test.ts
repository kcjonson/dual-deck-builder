import type { Component } from '../components/Component';
import { Layer } from '../components/Layer';
import type { MountContext } from '../components/MountContext';
import { Rectangle } from '../components/Rectangle';
import { createTestContext } from '../components/testing';
import { key, pointer, send } from '../services/testing';
import type { PointerPress } from './Dispatcher';

let context: MountContext;

function root(id: string, x = 0, y = 0): Rectangle {
	return new Rectangle({ id, x, y, width: 100, height: 100 });
}

beforeEach(() => {
	context = createTestContext();
});

describe('root order (R3.15, R3.28)', () => {
	it('orders roots by tier, then by mount order within a tier, whatever the mount order', () => {
		const diagnostic = root('diagnostic');
		const overlay = root('overlay');
		const screen = root('screen');
		diagnostic.mount(context, { tier: 'diagnostic' });
		overlay.mount(context, { tier: 'overlay' });
		screen.mount(context);

		expect(context.dispatcher.roots).toEqual([screen, overlay, diagnostic]);
		// The F5 overlay's case: mounted first, painted last, hit first.
		expect(context.dispatcher.hitTest({ x: 50, y: 50 })).toBe(diagnostic);
	});

	it('raises a root to the end of its own tier only', () => {
		const a = root('a');
		const b = root('b');
		const top = root('top');
		a.mount(context, { tier: 'overlay' });
		b.mount(context, { tier: 'overlay' });
		top.mount(context, { tier: 'diagnostic' });
		context.dispatcher.raiseRoot(a);
		expect(context.dispatcher.roots).toEqual([b, a, top]);
	});

	it('forgets a root on unmount, and a remount places it by the tier it is mounted with', () => {
		const screen = root('screen');
		const overlay = root('overlay');
		overlay.mount(context, { tier: 'overlay' });
		screen.mount(context);
		overlay.unmount();
		expect(context.dispatcher.roots).toEqual([screen]);
		overlay.mount(context);
		expect(context.dispatcher.roots).toEqual([screen, overlay]);
	});
});

describe('input observers', () => {
	let target: Rectangle;
	let heard: string[];

	beforeEach(() => {
		heard = [];
		const scene = new Layer({ id: 'scene', width: 400, height: 400 });
		target = root('target');
		target.onPointerDown = () => heard.push('down');
		target.onPointerUp = () => heard.push('up');
		target.onClick = () => heard.push('click');
		target.focusable = true;
		scene.addChild(target);
		scene.mount(context);
	});

	it('hears a press before delivery, and a swallowed press delivers neither itself, its release, a click nor a focus change', () => {
		const presses: (Component | null)[] = [];
		const other = root('other', 200, 200);
		other.focusable = true;
		target.parent?.addChild(other);
		context.focus.focus(other);
		context.dispatcher.addObserver({
			pointerDown: (press: PointerPress) => {
				presses.push(press.target);
				return true;
			},
		});
		send(context, [pointer('down', 50, 50), pointer('up', 50, 50)]);
		expect(presses).toEqual([target]);
		expect(heard).toEqual([]);
		expect(context.focus.focused).toBe(other);
	});

	it('tells later observers whether an earlier one swallowed the press', () => {
		const seen: boolean[] = [];
		context.dispatcher.addObserver({ pointerDown: () => true });
		context.dispatcher.addObserver({ pointerDown: (_press, swallowed) => {
			seen.push(swallowed);
		} });
		send(context, [pointer('down', 50, 50)]);
		expect(seen).toEqual([true]);
	});

	it('removes an observer with the function addObserver returns', () => {
		const remove = context.dispatcher.addObserver({ pointerDown: () => true });
		remove();
		send(context, [pointer('down', 50, 50), pointer('up', 50, 50)]);
		expect(heard).toEqual(['down', 'up', 'click']);
	});

	it('delivers the release of the next press after a swallowed one', () => {
		let swallow = true;
		context.dispatcher.addObserver({ pointerDown: () => swallow });
		send(context, [pointer('down', 50, 50), pointer('up', 50, 50)]);
		swallow = false;
		send(context, [pointer('down', 50, 50), pointer('up', 50, 50)]);
		expect(heard).toEqual(['down', 'up', 'click']);
	});

	it('offers a key the focused chain declined before the scene hotkeys, and a consumed one goes no further', () => {
		context.dispatcher.hotkeys.register('k', () => heard.push('hotkey'));
		const remove = context.dispatcher.addObserver({ keyDown: (stroke) => {
			heard.push(`observer:${stroke.key}`);
			return stroke.key === 'k';
		} });
		send(context, [key('k'), key('j')]);
		expect(heard).toEqual(['observer:k', 'observer:j']);
		remove();
		send(context, [key('k')]);
		expect(heard).toEqual(['observer:k', 'observer:j', 'hotkey']);
	});

	it('reports hover changes and moves', () => {
		const events: string[] = [];
		context.dispatcher.addObserver({
			hoverChange: (hovered) => events.push(`hover:${hovered?.id ?? 'none'}`),
			pointerMove: (position) => events.push(`move:${position.x}`),
		});
		send(context, [pointer('move', 50, 50), pointer('move', 60, 50), pointer('move', 300, 300)]);
		expect(events).toEqual(['hover:target', 'move:50', 'move:60', 'hover:none', 'move:300']);
		expect(context.dispatcher.hoverPoint).toEqual({ x: 300, y: 300 });
	});
});

describe('FocusManager.onFocusChange', () => {
	it('reports each change of the focused component and of its visibility once, including an unmount', () => {
		const heard: string[] = [];
		const scene = new Layer({ id: 'scene', width: 400, height: 400 });
		const a = root('a');
		const b = root('b', 200, 0);
		a.focusable = true;
		b.focusable = true;
		scene.addChild(a);
		scene.addChild(b);
		scene.mount(context);
		const stop = context.focus.onFocusChange((focused, visible) => heard.push(`${focused?.id ?? 'none'}:${visible}`));

		send(context, [pointer('down', 50, 50), pointer('up', 50, 50)]);
		context.focus.focus(a);
		send(context, [key('Tab')]);
		scene.removeChild(b);
		stop();
		context.focus.focus(a);
		expect(heard).toEqual(['a:false', 'b:true', 'none:false']);
	});
});

describe('UiFrame.requestTick', () => {
	it('ticks a service once on the next update, after the clock moved, and again only when asked', () => {
		const times: number[] = [];
		const ticker = {
			tick: () => {
				times.push(context.clock.now);
				if (times.length < 2) context.frame.requestTick(ticker);
			},
		};
		context.frame.requestTick(ticker);
		context.frame.update(0.016);
		context.frame.update(0.016);
		context.frame.update(0.016);
		expect(times).toEqual([16, 32]);
	});
});
