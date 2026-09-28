import { Clock } from '../animation/Clock';
import { linear } from '../animation/easing';
import { Component } from './Component';
import { Container } from './Container';
import { Rectangle } from './Rectangle';
import { createTestContext } from './testing';

/** Records the clock and a tween's value as its own update sees them. */
class Watcher extends Rectangle {
	public seen: string[] = [];
	public value = 0;

	public update(dt: number): void {
		this.seen.push(`${dt}:${this.context?.clock.now}:${this.value}`);
	}
}

describe('clock and animator in the mount context (R8.28)', () => {
	it('advances the clock and ticks tweens before component updates', () => {
		const context = createTestContext();
		const watcher = new Watcher();
		watcher.mount(context);
		context.animator.tween({ from: 0, to: 10, duration: 100, ease: linear, owner: watcher, onUpdate: (value) => { watcher.value = value; } });

		watcher.requestUpdate();
		context.frame.update(0.05);

		expect(context.clock.now).toBe(50);
		expect(context.clock.dt).toBe(50);
		expect(watcher.seen).toEqual(['0.05:50:5']);
	});

	it('moves nothing while the shell skips update, as a paused page does (R13.32)', () => {
		const context = createTestContext();
		let value = 0;
		context.animator.tween({ from: 0, to: 10, duration: 100, ease: linear, onUpdate: (next) => { value = next; } });

		context.frame.layout();
		context.frame.layout();

		expect(context.clock.now).toBe(0);
		expect(value).toBe(0);
	});

	it('takes an injected clock, which a test can freeze (R13.37)', () => {
		const clock = new Clock();
		const context = createTestContext({ clock });
		let value = 0;
		context.animator.tween({ from: 0, to: 10, duration: 100, ease: linear, onUpdate: (next) => { value = next; } });

		clock.frozen = true;
		context.frame.update(0.05);

		expect(context.clock).toBe(clock);
		expect(value).toBe(0);
	});

	it('cancels the tweens of every component in a subtree that unmounts (R8.15)', () => {
		const context = createTestContext();
		const root = new Container();
		const panel = new Container();
		const leaf = new Rectangle();
		root.addChild(panel);
		panel.addChild(leaf);
		root.mount(context);
		const onComplete = jest.fn();
		const lift = context.animator.tween({ from: 0, to: 1, owner: leaf, onUpdate: () => undefined, onComplete });
		const stays = context.animator.tween({ from: 0, to: 1, owner: root, onUpdate: () => undefined });

		root.removeChild(panel);
		context.frame.update(1);

		expect(lift.running).toBe(false);
		expect(onComplete).not.toHaveBeenCalled();
		expect(stays.running).toBe(false);
		expect(context.animator.active).toBe(0);
	});

	it('drives a reconciled exit: the child stays until its tween is done (R8.27)', async () => {
		const context = createTestContext();
		const list = new Container();
		list.mount(context);
		const reconcile = (items: string[]): void => list.reconcileChildren(items, {
			key: (item) => item,
			create: (item) => new Rectangle({ id: item }),
			remove: (child: Component) => context.animator.tween({
				from: child.opacity,
				to: 0,
				duration: 100,
				owner: child,
				onUpdate: (value) => { child.opacity = value; },
			}).done,
		});
		reconcile(['a', 'b']);
		const leaving = list.findById('b') as Component;

		reconcile(['a']);
		context.frame.update(0.05);
		await Promise.resolve();
		expect(leaving.parent).toBe(list);
		expect(leaving.opacity).toBeGreaterThan(0);

		context.frame.update(0.05);
		await Promise.resolve();
		expect(leaving.opacity).toBe(0);
		expect(leaving.parent).toBeNull();
		expect(leaving.isMounted).toBe(false);
	});

	it('still detaches an exiting child whose tween was cancelled', async () => {
		const context = createTestContext();
		const list = new Container();
		list.mount(context);
		const reconcile = (items: string[]): void => list.reconcileChildren(items, {
			key: (item) => item,
			create: (item) => new Rectangle({ id: item }),
			remove: (child: Component) => context.animator.tween({ from: 1, to: 0, owner: child, onUpdate: () => undefined }).done,
		});
		reconcile(['a']);
		const leaving = list.findById('a') as Component;
		reconcile([]);

		context.animator.cancelOwnedBy(leaving);
		await Promise.resolve();

		expect(leaving.parent).toBeNull();
	});
});
