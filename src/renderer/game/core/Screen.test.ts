/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../engine/components/testing';
import type { MountContext } from '../../engine/components/MountContext';
import { Button } from '../../engine/ui/Button';
import type { Rect } from '../../engine/draw/geometry';
import { Screen } from './Screen';

/** A screen that builds one button in onMount, the way CLAUDE.md asks screens to. */
class ButtonScreen extends Screen {
	public button: Button | null = null;
	public layouts: Rect[] = [];

	constructor(id: string) {
		super(id);
		this.rootLayer.onLayout = (bounds) => this.layouts.push(bounds);
	}

	protected onMount(): void {
		this.button = new Button('Go', { id: `${this.id}_go`, x: 10, y: 10, width: 80, height: 30 });
		this.rootLayer.addChild(this.button);
	}
}

/** What a press on the button's spot reaches. */
function hitAtButton(context: MountContext): unknown {
	return context.dispatcher.hitTest({ x: 20, y: 20 });
}

describe('Screen lifecycle (R8.21, R8.22)', () => {
	it('sizes its root from the context viewport and mounts what onMount builds', () => {
		const context = createTestContext({ viewport: { logical: { width: 800, height: 600 } } });
		const screen = new ButtonScreen('first');
		// Nothing reads the window: the root has no size until it mounts
		expect(screen.root.getWidth()).toBe(0);

		screen.mount(context);

		expect(screen.root.getWidth()).toBe(800);
		expect(screen.root.getHeight()).toBe(600);
		expect(screen.button?.isMounted).toBe(true);
		expect(context.dispatcher.roots).toEqual([screen.root]);
		expect(hitAtButton(context)).toBe(screen.button);
	});

	it('leaves nothing of the old screen registered when the next one mounts', () => {
		const context = createTestContext();
		const first = new ButtonScreen('first');
		const second = new ButtonScreen('second');

		first.mount(context);
		first.unmount();
		second.mount(context);

		expect(first.button?.isMounted).toBe(false);
		expect(context.dispatcher.roots).toEqual([second.root]);
		expect(hitAtButton(context)).toBe(second.button);
	});

	it('reports the new root through onLayout in the first layout phase, before any render', () => {
		const context = createTestContext({ viewport: { logical: { width: 640, height: 480 } } });
		const screen = new ButtonScreen('first');

		screen.mount(context);
		expect(screen.layouts).toEqual([]);

		context.frame.layout();
		expect(screen.layouts).toEqual([{ x: 0, y: 0, width: 640, height: 480 }]);
	});
});
