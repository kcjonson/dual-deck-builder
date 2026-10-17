/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../engine/components/testing';
import type { MountContext } from '../../engine/components/MountContext';
import { Button } from '../../engine/ui/Button';
import type { Rect } from '../../engine/draw/geometry';
import { Rectangle } from '../../engine/components/Rectangle';
import { Stack } from '../../engine/components/Stack';
import { ThemeName, themes } from '../../engine/theme/tokens';
import { Screen, ScreenOptions } from './Screen';

/** A screen that builds one button in onMount, the way CLAUDE.md asks screens to. */
class ButtonScreen extends Screen {
	public button: Button | null = null;
	public layouts: Rect[] = [];

	constructor(id: string) {
		super(id);
		this.rootLayer.onLayout = (bounds) => this.layouts.push(bounds);
	}

	protected onMount(): void {
		this.button = new Button({ label: 'Go', id: `${this.id}_go`, x: 10, y: 10, width: 80, height: 30 });
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
		expect(screen.root.width).toBe(0);

		screen.mount(context);

		expect(screen.root.width).toBe(800);
		expect(screen.root.height).toBe(600);
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

/** A screen that builds a panel and a primary button in onMount, as a meta screen would. */
class PanelScreen extends Screen {
	public panel: Rectangle | null = null;
	public button: Button | null = null;

	constructor(id: string, options: ScreenOptions = {}) {
		super(id, options);
	}

	protected onMount(): void {
		this.panel = new Rectangle({ width: 200, height: 100, style: { backgroundColor: 'bg_panel', borderRadius: 'radius_panel' } });
		this.button = new Button({ label: 'Go', tone: 'accent' });
		this.rootLayer.addChild(this.panel).addChild(this.button);
	}
}

describe('Screen theme (UI Art Direction, open question 1)', () => {
	function mounted(theme?: ThemeName, root?: Stack): PanelScreen {
		const screen = new PanelScreen('meta', { theme, root });
		screen.mount(createTestContext());
		return screen;
	}

	it('builds a screen that opts into atlas from the atlas tokens', () => {
		const screen = mounted('atlas');
		expect(screen.theme).toBe('atlas');
		expect(screen.panel?.fillColor).toEqual(themes.atlas.color.bg_panel);
		expect(screen.panel?.cornerRadius).toBe(0);
		expect(screen.button?.look.fill).toEqual(themes.atlas.color.accent);
	});

	it('keeps a screen that does not opt in, combat among them, on the dark tokens', () => {
		const screen = mounted();
		expect(screen.theme).toBe('dark');
		expect(screen.panel?.fillColor).toEqual(themes.dark.color.bg_panel);
		expect(screen.panel?.cornerRadius).toBe(themes.dark.radius.r_sm);
		expect(screen.button?.look.fill).toEqual(themes.dark.color.accent);
	});

	it('themes a screen that brings its own root', () => {
		const screen = mounted('atlas', new Stack({ widthMode: 'fill', heightMode: 'fill' }));
		expect(screen.root.theme).toBe('atlas');
		expect(screen.panel?.fillColor).toEqual(themes.atlas.color.bg_panel);
	});

	it('gives each screen on one context its own theme', () => {
		const context = createTestContext();
		const meta = new PanelScreen('meta', { theme: 'atlas' });
		const combat = new PanelScreen('combat');
		meta.mount(context);
		meta.unmount();
		combat.mount(context);
		expect(combat.button?.look.fill).toEqual(themes.dark.color.accent);
		expect(meta.button?.look.fill).toEqual(themes.atlas.color.accent);
	});
});
