import { Layer } from '../components/Layer';
import type { MountContext } from '../components/MountContext';
import { Rectangle } from '../components/Rectangle';
import { createTestContext } from '../components/testing';
import { DrawApi, RecordingBackend } from '../draw';
import { click, key, send, pointer } from './testing';

let context: MountContext;
let scene: Layer;
let sceneClicks: number;

function box(id: string, x: number, y: number, width = 100, height = 100): Rectangle {
	return new Rectangle({ id, x, y, width, height });
}

beforeEach(() => {
	context = createTestContext();
	scene = new Layer({ id: 'scene', width: 1440, height: 882 });
	const target = box('scene_target', 0, 0, 1440, 882);
	sceneClicks = 0;
	target.onClick = () => {
		sceneClicks += 1;
	};
	scene.addChild(target);
	scene.mount(context);
});

describe('OverlayService (R8.21)', () => {
	it('mounts content under a viewport-sized root in its layer, after the scene roots', () => {
		const content = box('dialog', 100, 100);
		const handle = context.overlays.open(content, { layer: 'modal' });

		expect(handle.root.isMounted).toBe(true);
		expect(content.isMounted).toBe(true);
		expect(handle.root.layer).toBe('modal');
		expect(handle.root.bounds).toEqual({ x: 0, y: 0, width: 1440, height: 882 });
		expect(context.overlays.roots).toEqual([handle.root]);
		expect(context.dispatcher.roots).toEqual([scene, handle.root]);
	});

	it('keeps overlay roots after scene roots mounted later (R3.15)', () => {
		const handle = context.overlays.open(box('popover', 10, 10), { layer: 'base' });
		const late = new Layer({ id: 'late', width: 10, height: 10 });
		late.mount(context);

		expect(context.dispatcher.roots).toEqual([scene, late, handle.root]);
	});

	it('hit-tests a later root over an earlier one in the same layer, and bringToFront reorders both', () => {
		const first = context.overlays.open(box('first', 100, 100), { layer: 'overlay' });
		const second = context.overlays.open(box('second', 150, 150), { layer: 'overlay' });
		expect(context.dispatcher.hitTest({ x: 175, y: 175 })?.id).toBe('second');

		first.bringToFront();
		expect(context.overlays.roots).toEqual([second.root, first.root]);
		expect(context.dispatcher.roots).toEqual([scene, second.root, first.root]);
		expect(context.dispatcher.hitTest({ x: 175, y: 175 })?.id).toBe('first');
	});

	it('hit-tests a higher layer first whatever the open order (R3.28)', () => {
		context.overlays.open(box('toast', 100, 100), { layer: 'toast' });
		context.overlays.open(box('dialog', 100, 100), { layer: 'modal' });
		expect(context.dispatcher.hitTest({ x: 150, y: 150 })?.id).toBe('toast');
	});

	it('paints roots in open order, in their layer', () => {
		const backend = new RecordingBackend({ maxFrames: 1 });
		const draw = new DrawApi({ backend, strict: true });
		context.overlays.open(box('first', 0, 0), { layer: 'overlay' });
		const second = context.overlays.open(box('second', 0, 0), { layer: 'overlay' });
		context.overlays.open(box('third', 0, 0), { layer: 'overlay' });
		second.bringToFront();
		draw.beginFrame({ viewport: { width: 1440, height: 882 }, ratio: 1 });
		context.overlays.render(draw);
		draw.endFrame();
		const drawn = [...backend.commands].sort((a, b) => a.sequence - b.sequence);
		expect(drawn.map((command) => command.id)).toEqual(['first', 'third', 'second']);
		expect(drawn.every((command) => command.layer === 'overlay')).toBe(true);
	});

	it('closes: unmounts the root and hands the content back unmounted and parentless', () => {
		const content = box('dialog', 100, 100);
		let closed = 0;
		const handle = context.overlays.open(content, { layer: 'modal', onClose: () => { closed += 1; } });
		handle.close();
		handle.close();

		expect(handle.isOpen).toBe(false);
		expect(closed).toBe(1);
		expect(content.isMounted).toBe(false);
		expect(content.parent).toBeNull();
		expect(context.dispatcher.roots).toEqual([scene]);
		expect(context.overlays.open(content, { layer: 'modal' }).isOpen).toBe(true);
	});

	it('resizes every root to the viewport', () => {
		const logical = { width: 800, height: 600 };
		const sized = createTestContext({ viewport: { logical } });
		const handle = sized.overlays.open(box('dialog', 0, 0), { layer: 'modal' });
		logical.width = 1024;
		sized.overlays.resize();
		expect(handle.root.bounds).toEqual({ x: 0, y: 0, width: 1024, height: 600 });
	});

	it('dismisses on an outside press without consuming it when non-modal (R9.13)', () => {
		const handle = context.overlays.open(box('popover', 100, 100), { layer: 'overlay', dismissOnOutsidePress: true });
		click(context, 600, 600);
		expect(handle.isOpen).toBe(false);
		expect(sceneClicks).toBe(1);
	});

	it('keeps an overlay open on a press inside it', () => {
		const handle = context.overlays.open(box('popover', 100, 100), { layer: 'overlay', dismissOnOutsidePress: true });
		click(context, 150, 150);
		expect(handle.isOpen).toBe(true);
	});

	it('consumes an outside press under a modal, dismissing or not (R12.21)', () => {
		const modal = context.overlays.open(box('dialog', 100, 100), { layer: 'modal' });
		click(context, 600, 600);
		expect(modal.isOpen).toBe(true);
		expect(sceneClicks).toBe(0);
	});

	it('counts a press on a scrim as outside when `inside` names the panel, and consumes it (R12.21)', () => {
		const dialog = new Layer({ id: 'dialog', width: 1440, height: 882 });
		const scrim = box('scrim', 0, 0, 1440, 882);
		const panel = box('panel', 500, 300, 400, 200);
		let panelClicks = 0;
		panel.onClick = () => {
			panelClicks += 1;
		};
		dialog.addChild(scrim);
		dialog.addChild(panel);
		const handle = context.overlays.open(dialog, { layer: 'modal', inside: panel, dismissOnOutsidePress: true });

		click(context, 600, 350);
		expect(handle.isOpen).toBe(true);
		expect(panelClicks).toBe(1);

		click(context, 50, 50);
		expect(handle.isOpen).toBe(false);
		expect(sceneClicks).toBe(0);
	});

	it('refuses an `inside` that is not part of the content', () => {
		expect(() => context.overlays.open(box('dialog', 0, 0), { layer: 'modal', inside: box('elsewhere', 0, 0) })).toThrow('`inside`');
	});

	it('asks onDismiss instead of closing, so a dialog can run its closing fade', () => {
		const reasons: string[] = [];
		const handle = context.overlays.open(box('dialog', 100, 100), {
			layer: 'modal',
			closeOnEscape: true,
			onDismiss: (reason) => reasons.push(reason),
		});
		send(context, [key('Escape')]);
		expect(reasons).toEqual(['escape']);
		expect(handle.isOpen).toBe(true);
	});

	it('sends Escape to the topmost root that closes on it', () => {
		const lower = context.overlays.open(box('lower', 100, 100), { layer: 'overlay', closeOnEscape: true });
		const upper = context.overlays.open(box('upper', 300, 300), { layer: 'overlay', closeOnEscape: true });
		send(context, [key('Escape')]);
		expect(upper.isOpen).toBe(false);
		expect(lower.isOpen).toBe(true);
	});

	it('searches per-root hotkeys topmost first and stops at a modal root (R9.15)', () => {
		const heard: string[] = [];
		context.dispatcher.hotkeys.register('h', () => heard.push('scene'));
		const popover = context.overlays.open(box('popover', 0, 0), { layer: 'overlay' });
		popover.hotkeys.register('p', () => heard.push('popover'));
		send(context, [key('p'), key('h')]);
		expect(heard).toEqual(['popover', 'scene']);

		const modal = context.overlays.open(box('dialog', 400, 400), { layer: 'modal' });
		modal.hotkeys.register('m', () => heard.push('modal'));
		send(context, [key('m'), key('p'), key('h')]);
		expect(heard).toEqual(['popover', 'scene', 'modal']);
	});

	it('marks a modal root modal and traps focus in it, restoring focus on close (R9.20)', () => {
		const behind = box('behind', 0, 0, 50, 50);
		behind.focusable = true;
		scene.addChild(behind);
		context.focus.focus(behind);

		const dialog = new Layer({ id: 'dialog', width: 400, height: 300 });
		const ok = box('ok', 10, 10, 80, 30);
		ok.focusable = true;
		dialog.addChild(ok);
		const handle = context.overlays.open(dialog, { layer: 'modal' });
		expect(handle.root.modal).toBe(true);
		expect(context.focus.activeScope).toBe(handle.root);
		expect(context.focus.focused).toBe(ok);

		send(context, [key('Tab')]);
		expect(context.focus.focused).toBe(ok);

		handle.close();
		expect(context.focus.activeScope).toBeNull();
		expect(context.focus.focused).toBe(behind);
	});

	it('leaves a non-modal root unmarked and focus where it was', () => {
		const handle = context.overlays.open(box('popover', 0, 0), { layer: 'overlay' });
		expect(handle.root.modal).toBe(false);
		expect(context.focus.activeScope).toBeNull();
	});

	it('searches hotkeys by layer before open order: a popup opened first beats a lower-layer overlay opened after it', () => {
		const heard: string[] = [];
		const popup = context.overlays.open(box('menu', 0, 0), { layer: 'popup' });
		popup.hotkeys.register('k', () => heard.push('popup'));
		const panel = context.overlays.open(box('panel', 200, 200), { layer: 'overlay' });
		panel.hotkeys.register('k', () => heard.push('panel'));
		panel.hotkeys.register('j', () => heard.push('panel'));
		send(context, [key('k'), key('j')]);
		expect(heard).toEqual(['popup', 'panel']);

		const later = context.overlays.open(box('later', 400, 400), { layer: 'overlay' });
		later.hotkeys.register('j', () => heard.push('later'));
		send(context, [key('j')]);
		expect(heard).toEqual(['popup', 'panel', 'later']);
	});

	it('closes everything with closeAll', () => {
		context.overlays.open(box('a', 0, 0), { layer: 'overlay' });
		context.overlays.open(box('b', 0, 0), { layer: 'modal' });
		context.overlays.closeAll();
		expect(context.overlays.roots).toEqual([]);
		expect(context.dispatcher.roots).toEqual([scene]);
	});

	it('refuses content that already has a parent', () => {
		const child = box('child', 0, 0);
		scene.addChild(child);
		expect(() => context.overlays.open(child, { layer: 'overlay' })).toThrow('already has a parent');
	});

	it('an outside press on a scene target with no overlay open reaches it', () => {
		send(context, [pointer('down', 10, 10), pointer('up', 10, 10)]);
		expect(sceneClicks).toBe(1);
	});
});
