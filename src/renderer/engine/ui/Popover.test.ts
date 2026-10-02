import { Clock } from '../animation/Clock';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { Rectangle } from '../components/Rectangle';
import { createTestContext } from '../components/testing';
import { advance, click, key, send } from '../services/testing';
import { tokens } from '../theme/tokens';
import { Button } from './Button';
import { Popover, PopoverOptions } from './Popover';

/** R12.33: anchored, non-modal, dismissed by a press it never consumes. */

let context: MountContext;
let scene: Container;
let anchor: Button;
let other: Button;
let otherClicks: number;

beforeEach(() => {
	context = createTestContext({ viewport: { logical: { width: 800, height: 600 } }, clock: new Clock() });
	scene = new Container({ id: 'scene', width: 800, height: 600 });
	anchor = new Button({ label: 'Inspect', id: 'anchor', x: 100, y: 100, width: 100, height: 34 });
	otherClicks = 0;
	other = new Button({ label: 'Other', id: 'other', x: 500, y: 400, width: 100, height: 34, onClick: () => { otherClicks += 1; } });
	scene.addChild(anchor);
	scene.addChild(other);
	scene.mount(context);
	context.frame.layout();
});

function popover(options: Partial<PopoverOptions> = {}): Popover {
	return new Popover({ content: new Rectangle({ id: 'breakdown', width: 160, height: 90 }), anchor, ...options });
}

describe('Popover (R12.33)', () => {
	it('opens in overlay below its anchor, sized from its content, and fades in', () => {
		const made = popover();
		made.show(context);
		expect(made.overlay?.layer).toBe('overlay');
		expect(made.overlay?.modal).toBe(false);
		const padding = tokens.space.space_3 * 2;
		expect({ width: made.width, height: made.height }).toEqual({ width: 160 + padding, height: 90 + padding });
		expect({ x: made.x, y: made.y }).toEqual({ x: 100, y: 134 + tokens.space.space_1_5 });
		expect(made.opacity).toBe(0);
		advance(context, tokens.motion.dur_fast + 16);
		expect(made.opacity).toBe(1);
	});

	it('flips above an anchor near the bottom of the viewport', () => {
		anchor.setPosition(100, 540);
		const made = popover();
		made.show(context);
		expect(made.placement).toBe('top');
		expect(made.y + made.height).toBe(540 - tokens.space.space_1_5);
	});

	it('places against a screen point', () => {
		const made = popover({ anchor: { x: 300, y: 200 } });
		made.show(context);
		expect({ x: made.x, y: made.y }).toEqual({ x: 300, y: 200 + tokens.space.space_1_5 });
	});

	it('closes on an outside press and lets the press through to its target', () => {
		const closes: number[] = [];
		const made = popover({ onClose: () => closes.push(1) });
		made.show(context);
		click(context, 550, 417);
		expect(made.isOpen).toBe(false);
		expect(otherClicks).toBe(1);
		expect(closes).toHaveLength(1);
		expect(context.overlays.roots).toHaveLength(0);
	});

	it('stays open on a press inside it, and on an outside press when told to', () => {
		const made = popover({ dismissOnOutsidePress: false });
		made.show(context);
		click(context, made.x + 20, made.y + 20);
		expect(made.isOpen).toBe(true);
		click(context, 550, 417);
		expect(made.isOpen).toBe(true);
		expect(otherClicks).toBe(1);
	});

	it('closes on Escape unless told not to', () => {
		const made = popover();
		made.show(context);
		send(context, [key('Escape')]);
		expect(made.isOpen).toBe(false);

		const kept = popover({ closeOnEscape: false });
		kept.show(context);
		send(context, [key('Escape')]);
		expect(kept.isOpen).toBe(true);
	});

	it('beats menus in the popup layer when asked', () => {
		const made = popover({ layer: 'popup' });
		made.show(context);
		expect(made.overlay?.layer).toBe('popup');
	});

	it('takes no focus without focusables and pushes no scope with them', () => {
		anchor.focusable = true;
		context.focus.focus(anchor);
		const plain = popover();
		plain.show(context);
		expect(context.focus.focused).toBe(anchor);
		plain.close();

		const action = new Button({ label: 'Pin', id: 'pin', width: 80 });
		const interactive = new Popover({ content: action, anchor });
		interactive.show(context);
		expect(context.focus.focused).toBe(action);
		expect(context.focus.activeScope).toBeNull();
	});

	it('follows a new anchor, and can be shown again after closing', () => {
		const made = popover();
		made.show(context);
		made.anchoredTo = other;
		expect({ x: made.x, y: made.y }).toEqual({ x: 500, y: 434 + tokens.space.space_1_5 });
		made.close();
		made.show(context);
		expect(made.isOpen).toBe(true);
		expect(made.parent).toBe(made.overlay?.root);
	});

	it('shrinks to the room and clips when neither side fits', () => {
		const made = new Popover({ content: new Rectangle({ width: 160, height: 700 }), anchor });
		made.show(context);
		expect(made.clipsChildren).toBe(true);
		expect(made.height).toBeLessThan(600);
	});

	it('clips a shrunk surface at the border\'s inner edge, the corner concentric with the background\'s (R4.14)', () => {
		const made = new Popover({ content: new Rectangle({ width: 160, height: 700 }), anchor });
		made.show(context);
		const border = tokens.borderWidth.bw;
		expect(made.clipRect).toEqual({ x: border, y: border, width: made.width - border * 2, height: made.height - border * 2 });
		expect(made.clipRadius).toBe(tokens.radius.radius_panel - border);
	});
});
