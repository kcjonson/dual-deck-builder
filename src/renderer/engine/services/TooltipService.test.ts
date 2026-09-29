import { Clock } from '../animation/Clock';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { Rectangle } from '../components/Rectangle';
import { createTestContext } from '../components/testing';
import type { UiPointerEvent } from '../input/events';
import { tokens } from '../theme/tokens';
import { TOOLTIP_ANCHOR_OFFSET, TOOLTIP_POINTER_OFFSET } from './TooltipService';
import { Tooltip } from '../ui/Tooltip';
import { advance, key, pointer, send } from './testing';

const DELAY = tokens.control.tooltip_delay;
const TOLERANCE = tokens.control.hover_move_tolerance;

let context: MountContext;
let scene: Container;
let save: Rectangle;
let load: Rectangle;
let plain: Rectangle;

function box(id: string, x: number, y: number, width = 100, height = 40): Rectangle {
	return new Rectangle({ id, x, y, width, height });
}

beforeEach(() => {
	context = createTestContext({ viewport: { logical: { width: 800, height: 600 } }, clock: new Clock() });
	scene = new Container({ id: 'scene', width: 800, height: 600 });
	save = box('save', 100, 100);
	save.tooltip = { title: 'Save', description: 'Writes the run to disk', hotkey: 'S' };
	load = box('load', 300, 100);
	load.tooltip = 'Load';
	plain = box('plain', 500, 100);
	scene.addChild(save);
	scene.addChild(load);
	scene.addChild(plain);
	scene.mount(context);
});

function tooltipRoot(): Container | undefined {
	return context.overlays.roots.find((root) => root.layer === 'tooltip');
}

describe('TooltipService (R12.22)', () => {
	it('waits tooltip_delay on the frame clock, then fades in over dur_fast', () => {
		send(context, [pointer('move', 120, 110)]);
		expect(context.tooltips.state).toBe('waiting');
		expect(context.tooltips.owner).toBe(save);

		advance(context, DELAY - 40);
		expect(context.tooltips.state).toBe('waiting');
		expect(tooltipRoot()).toBeUndefined();

		advance(context, 40);
		expect(context.tooltips.state).toBe('showing');
		const surface = context.tooltips.surface;
		expect(surface).toBeInstanceOf(Tooltip);
		expect(surface?.opacity).toBeGreaterThanOrEqual(0);
		expect(surface?.opacity).toBeLessThan(1);

		advance(context, tokens.motion.dur_fast + 16);
		expect(context.tooltips.state).toBe('visible');
		expect(surface?.opacity).toBe(1);
	});

	it('mounts the surface as the tooltip layer\'s root, never a target', () => {
		send(context, [pointer('move', 120, 110)]);
		advance(context, DELAY + 16);
		const root = tooltipRoot();
		expect(root?.getChildren()).toEqual([context.tooltips.surface]);
		expect(context.tooltips.surface?.pointerEvents).toBe('none');
		// The pointer is still on the owner, not on the tooltip beneath it.
		const surface = context.tooltips.surface as Rectangle;
		expect(context.dispatcher.hitTest({ x: surface.x + 2, y: surface.y + 2 })).not.toBe(surface);
	});

	it('places below-right of the pointer', () => {
		send(context, [pointer('move', 120, 110)]);
		advance(context, DELAY + 16);
		const surface = context.tooltips.surface as Tooltip;
		expect({ x: surface.x, y: surface.y }).toEqual({ x: 120, y: 110 + TOOLTIP_POINTER_OFFSET });
	});

	it('flips above the pointer and shifts left near the viewport\'s corner', () => {
		const corner = box('corner', 700, 560, 100, 40);
		corner.tooltip = { title: 'Corner', factory: () => box('preview', 0, 0, 200, 120) };
		scene.addChild(corner);
		send(context, [pointer('move', 790, 590)]);
		advance(context, DELAY + 16);
		const surface = context.tooltips.surface as Rectangle;
		expect(surface.id).toBe('preview');
		expect(surface.y).toBe(590 - TOOLTIP_POINTER_OFFSET - 120);
		expect(surface.x).toBe(800 - 8 - 200);
	});

	it('shrinks and clips a tooltip too tall for either side of the pointer', () => {
		const tall = box('tall_owner', 100, 280, 100, 40);
		tall.tooltip = { factory: () => box('tall_preview', 0, 0, 120, 400) };
		scene.addChild(tall);
		send(context, [pointer('move', 120, 290)]);
		advance(context, DELAY + 16);
		const surface = context.tooltips.surface as Rectangle;
		// Below: 600 - 8 - 306 = 286; above: 290 - 16 - 8 = 266.
		expect({ y: surface.y, height: surface.height }).toEqual({ y: 306, height: 286 });
		expect(surface.clipsChildren).toBe(true);
	});

	it('ignores movement within hover_move_tolerance while waiting, and restarts the delay past it', () => {
		send(context, [pointer('move', 120, 110)]);
		advance(context, DELAY / 2);
		send(context, [pointer('move', 120 + TOLERANCE - 1, 110)]);
		advance(context, DELAY / 2);
		expect(context.tooltips.state).not.toBe('waiting');

		send(context, [pointer('move', 400, 400), pointer('move', 120, 110)]);
		advance(context, DELAY / 2);
		send(context, [pointer('move', 120 + TOLERANCE + 10, 110)]);
		advance(context, DELAY / 2);
		expect(context.tooltips.state).toBe('waiting');
	});

	it('swaps content without the delay when the pointer moves between owners while visible', () => {
		send(context, [pointer('move', 120, 110)]);
		advance(context, DELAY + 200);
		expect(context.tooltips.state).toBe('visible');

		send(context, [pointer('move', 320, 110)]);
		expect(context.tooltips.owner).toBe(load);
		expect(context.tooltips.state).toBe('visible');
		expect(context.tooltips.surface?.opacity).toBe(1);
	});

	it('fades out over dur_tooltip_hide when the pointer leaves, then removes the root', () => {
		send(context, [pointer('move', 120, 110)]);
		advance(context, DELAY + 200);
		send(context, [pointer('move', 520, 110)]);
		expect(context.tooltips.state).toBe('hiding');
		advance(context, tokens.motion.dur_tooltip_hide + 16);
		expect(context.tooltips.state).toBe('idle');
		expect(tooltipRoot()).toBeUndefined();
	});

	it('forgets a waiting tooltip when the pointer leaves before the delay', () => {
		send(context, [pointer('move', 120, 110)]);
		advance(context, DELAY / 2);
		send(context, [pointer('move', 520, 110)]);
		advance(context, DELAY);
		expect(context.tooltips.state).toBe('idle');
		expect(tooltipRoot()).toBeUndefined();
	});

	it('never consumes: the owner and what is beneath still get their events', () => {
		const heard: string[] = [];
		save.onPointerDown = () => heard.push('down');
		save.onClick = () => heard.push('click');
		send(context, [pointer('move', 120, 110)]);
		advance(context, DELAY + 200);
		send(context, [pointer('down', 120, 110), pointer('up', 120, 110)]);
		expect(heard).toEqual(['down', 'click']);
	});

	it('hides on a press on its owner and stays hidden until the pointer leaves it', () => {
		send(context, [pointer('move', 120, 110)]);
		advance(context, DELAY + 200);
		send(context, [pointer('down', 120, 110), pointer('up', 120, 110)]);
		expect(context.tooltips.state).toBe('suppressed');
		expect(tooltipRoot()).toBeUndefined();
		advance(context, DELAY * 2);
		expect(context.tooltips.state).toBe('suppressed');

		send(context, [pointer('move', 520, 110), pointer('move', 120, 110)]);
		expect(context.tooltips.state).toBe('waiting');
	});

	it('stays hidden while a pointer is captured', () => {
		save.onPointerDown = (event: UiPointerEvent) => event.capturePointer();
		send(context, [pointer('move', 120, 110), pointer('down', 120, 110)]);
		send(context, [pointer('move', 320, 110)]);
		advance(context, DELAY * 2);
		expect(tooltipRoot()).toBeUndefined();
	});

	it('stays hidden while a drag is active (R9.12e)', () => {
		let dragging = true;
		context.tooltips.dragActive = () => dragging;
		send(context, [pointer('move', 120, 110)]);
		advance(context, DELAY * 2);
		expect(tooltipRoot()).toBeUndefined();

		dragging = false;
		send(context, [pointer('move', 320, 110)]);
		advance(context, DELAY + 16);
		expect(context.tooltips.owner).toBe(load);
		expect(tooltipRoot()).toBeDefined();
	});

	it('shows from keyboard focus, anchored below the owner, and hides when focus leaves', () => {
		context.tooltips.focusVisibleChange(save);
		advance(context, DELAY + 16);
		const surface = context.tooltips.surface as Tooltip;
		expect(context.tooltips.trigger).toBe('focus');
		expect({ x: surface.x, y: surface.y }).toEqual({ x: 100, y: 140 + TOOLTIP_ANCHOR_OFFSET });

		context.tooltips.focusVisibleChange(plain);
		expect(context.tooltips.state).toBe('hiding');
	});

	it('shows from Tab through the focus manager, and not from focus a press gave', () => {
		save.focusable = true;
		load.focusable = true;
		send(context, [pointer('move', 700, 500), pointer('down', 120, 110), pointer('up', 120, 110), pointer('move', 700, 500)]);
		expect(context.focus.focused).toBe(save);
		advance(context, DELAY * 2);
		expect(tooltipRoot()).toBeUndefined();

		send(context, [key('Tab')]);
		expect(context.focus.focused).toBe(load);
		expect(context.tooltips.trigger).toBe('focus');
		advance(context, DELAY + 16);
		expect(context.tooltips.owner).toBe(load);
		expect(tooltipRoot()).toBeDefined();
	});

	it('forgets a shown tooltip on a press elsewhere, so keyboard focus can show it again', () => {
		save.focusable = true;
		context.tooltips.show(save, { fade: false });
		send(context, [pointer('down', 700, 500), pointer('up', 700, 500)]);
		expect(context.tooltips.state).toBe('idle');
		send(context, [key('Tab')]);
		expect(context.focus.focused).toBe(save);
		advance(context, DELAY + 16);
		expect(tooltipRoot()).toBeDefined();
	});

	it('reads the drag service for R9.12e', () => {
		expect(context.tooltips.dragActive()).toBe(context.drag.isDragging);
	});

	it('shows at once through show(), and hides on Escape without consuming it', () => {
		const heard: string[] = [];
		context.dispatcher.hotkeys.register('Escape', () => heard.push('scene'));
		context.tooltips.show(save, { fade: false });
		expect(context.tooltips.state).toBe('visible');
		expect(tooltipRoot()).toBeDefined();

		send(context, [key('Escape')]);
		expect(tooltipRoot()).toBeUndefined();
		expect(heard).toEqual(['scene']);
	});

	it('uses the descendant\'s owner: the nearest ancestor with a tooltip', () => {
		const icon = box('icon', 10, 10, 20, 20);
		save.addChild(icon);
		send(context, [pointer('move', 115, 115)]);
		expect(context.tooltips.owner).toBe(save);
	});

	it('resets when a scene change closes its root from outside', () => {
		context.tooltips.show(save, { fade: false });
		context.overlays.closeAll();
		expect(context.tooltips.state).toBe('idle');
		expect(context.tooltips.surface).toBeNull();
	});

	it('mounts a factory tree on show and unmounts it on hide', () => {
		const preview = box('preview', 0, 0, 120, 160);
		load.tooltip = { factory: () => preview };
		context.tooltips.show(load, { fade: false });
		expect(preview.isMounted).toBe(true);
		context.overlays.closeAll();
		expect(preview.isMounted).toBe(false);
	});

	it('sizes a factory tree with no size of its own from its children', () => {
		const tree = new Container({ id: 'tree' });
		tree.addChild(box('a', 0, 0, 50, 20));
		tree.addChild(box('b', 10, 30, 90, 20));
		load.tooltip = { factory: () => tree };
		context.tooltips.show(load, { fade: false });
		expect({ width: tree.width, height: tree.height }).toEqual({ width: 100, height: 50 });
	});
});
