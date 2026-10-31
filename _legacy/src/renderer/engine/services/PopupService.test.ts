import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { Rectangle } from '../components/Rectangle';
import { createTestContext } from '../components/testing';
import type { PopupCloseReason } from './PopupService';
import { click, key, send } from './testing';

let context: MountContext;
let scene: Container;
let trigger: Rectangle;
let otherTrigger: Rectangle;
let background: Rectangle;
let log: string[];

function box(id: string, x: number, y: number, width = 100, height = 40): Rectangle {
	return new Rectangle({ id, x, y, width, height });
}

beforeEach(() => {
	context = createTestContext({ viewport: { logical: { width: 800, height: 600 } } });
	log = [];
	scene = new Container({ id: 'scene', width: 800, height: 600 });
	background = box('background', 0, 0, 800, 600);
	background.onClick = () => log.push('background:click');
	background.onPointerDown = () => log.push('background:down');
	trigger = box('trigger', 100, 100);
	trigger.popupTrigger = true;
	trigger.onClick = () => log.push('trigger:click');
	otherTrigger = box('other', 300, 100);
	otherTrigger.popupTrigger = true;
	otherTrigger.onClick = () => log.push('other:click');
	scene.addChild(background);
	scene.addChild(trigger);
	scene.addChild(otherTrigger);
	scene.mount(context);
});

function openMenu(options: { anchor?: Rectangle } = {}): { menu: Rectangle; reasons: PopupCloseReason[] } {
	const menu = box('menu', 0, 0, 150, 90);
	const reasons: PopupCloseReason[] = [];
	context.popups.show({ popup: menu, trigger, anchor: options.anchor ?? trigger, onClose: (reason) => reasons.push(reason) });
	return { menu, reasons };
}

describe('PopupService (R12.31)', () => {
	it('opens an unmounted popup as an overlay root in the popup layer, placed below its anchor', () => {
		const { menu } = openMenu();
		const handle = context.popups.open;

		expect(handle?.popup).toBe(menu);
		expect(handle?.overlay?.root.layer).toBe('popup');
		expect(menu.isMounted).toBe(true);
		expect({ x: menu.x, y: menu.y }).toEqual({ x: 100, y: 144 });
		expect(handle?.placement?.side).toBe('bottom');
	});

	it('flips above an anchor near the bottom of the viewport', () => {
		const low = box('low', 100, 540);
		scene.addChild(low);
		const { menu } = openMenu({ anchor: low });
		expect(menu.y).toBe(540 - 4 - 90);
		expect(context.popups.open?.placement?.flipped).toBe(true);
	});

	it('shrinks a popup to a constrained placement, and places again from the size it asked for', () => {
		const menu = box('tall', 0, 0, 150, 500);
		const handle = context.popups.show({ popup: menu, trigger, anchor: trigger });
		// Below the trigger: 600 - 8 - 144 = 448; above: 100 - 4 - 8 = 88.
		expect(handle.placement?.constrained).toBe(true);
		expect({ y: menu.y, height: menu.height }).toEqual({ y: 144, height: 448 });

		context.popups.reposition(handle, { anchor: { x: 100, y: 40, width: 100, height: 40 } });
		expect(handle.naturalSize).toEqual({ width: 150, height: 500 });
		expect({ y: menu.y, height: menu.height }).toEqual({ y: 84, height: 500 });
	});

	it('closes the open popup when another opens: only one exclusive popup at a time', () => {
		const first = openMenu();
		const second = openMenu();
		expect(first.reasons).toEqual(['replaced']);
		expect(first.menu.isMounted).toBe(false);
		expect(second.menu.isMounted).toBe(true);
		expect(context.popups.open?.popup).toBe(second.menu);
	});

	it('closes on an outside press and consumes it: no press, no click beneath (R9.13)', () => {
		const { reasons } = openMenu();
		click(context, 600, 500);
		expect(reasons).toEqual(['outside-press']);
		expect(log).toEqual([]);
		expect(context.popups.open).toBeNull();

		click(context, 600, 500);
		expect(log).toEqual(['background:down', 'background:click']);
	});

	it('does not consume an outside press on another popup trigger, so one press switches selects', () => {
		const { reasons } = openMenu();
		click(context, 350, 120);
		expect(reasons).toEqual(['outside-press']);
		expect(log).toEqual(['other:click']);
	});

	it('does not consume a secondary press outside, so a context menu can open where it landed', () => {
		const { reasons } = openMenu();
		background.onContextMenu = () => log.push('background:contextmenu');
		click(context, 600, 500, { button: 2 });
		expect(reasons).toEqual(['outside-press']);
		expect(log).toEqual(['background:down', 'background:contextmenu']);
	});

	it('stays open on a press inside the popup or on its own trigger, which toggles itself', () => {
		const { menu, reasons } = openMenu();
		let menuClicks = 0;
		menu.onClick = () => {
			menuClicks += 1;
		};
		click(context, 120, 160);
		click(context, 120, 120);
		expect(menuClicks).toBe(1);
		expect(log).toEqual(['trigger:click']);
		expect(reasons).toEqual([]);
	});

	it('closes on Escape and consumes it', () => {
		const heard: string[] = [];
		context.dispatcher.hotkeys.register('Escape', () => heard.push('scene'));
		const { reasons } = openMenu();
		send(context, [key('Escape')]);
		expect(reasons).toEqual(['escape']);
		expect(heard).toEqual([]);
		send(context, [key('Escape')]);
		expect(heard).toEqual(['scene']);
	});

	it('closes when focus moves outside the popup and its trigger (R9.14)', () => {
		const { reasons } = openMenu();
		trigger.focusable = true;
		otherTrigger.focusable = true;
		context.focus.focus(trigger);
		expect(reasons).toEqual([]);
		context.focus.focus(otherTrigger);
		expect(reasons).toEqual(['focus-loss']);
	});

	it('closes when a modal root opens, so no popup paints above a scrim (R3.6a)', () => {
		const { reasons } = openMenu();
		context.overlays.open(box('dialog', 200, 200), { layer: 'modal' });
		expect(reasons).toEqual(['modal']);
	});

	it('only tracks a popup that is already mounted, leaving it where its owner put it', () => {
		const inline = box('inline', 0, 40, 150, 90);
		inline.layer = 'popup';
		trigger.addChild(inline);
		const reasons: PopupCloseReason[] = [];
		const handle = context.popups.show({ popup: inline, trigger, anchor: trigger, onClose: (reason) => reasons.push(reason) });

		expect(handle.overlay).toBeNull();
		expect(inline.parent).toBe(trigger);
		expect(inline.y).toBe(40);

		click(context, 600, 500);
		expect(reasons).toEqual(['outside-press']);
		expect(inline.isMounted).toBe(true);
	});

	it('closes when its overlay root is closed from outside', () => {
		const { reasons } = openMenu();
		context.overlays.closeAll();
		expect(reasons).toEqual(['closed']);
		expect(context.popups.open).toBeNull();
	});

	it('fires onClose once for the owner\'s own close', () => {
		const { reasons } = openMenu();
		const handle = context.popups.open;
		handle?.close();
		handle?.close();
		context.popups.close();
		expect(reasons).toEqual(['closed']);
	});
});
