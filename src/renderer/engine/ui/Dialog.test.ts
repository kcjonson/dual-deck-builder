import { Clock } from '../animation/Clock';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { createTestContext } from '../components/testing';
import type { DrawApi } from '../draw/DrawApi';
import type { DrawRectOptions } from '../draw/commands';
import { NO_MODIFIERS } from '../input/events';
import { advance, click, key, pointer, send } from '../services/testing';
import { tokens } from '../theme/tokens';
import { Button } from './Button';
import { DIALOG_ENTRANCE_SCALE, DIALOG_WIDTHS, Dialog, DialogOptions } from './Dialog';
import { Panel } from './Panel';
import { Select } from './Select';
import { shadowExtent } from '../style/look';
import { resolveShadow } from '../style/styleObject';

/**
 * R12.21's dialog on the overlay service, driven through the dispatcher's
 * queue: lifecycle, dismissal defaults, first-frame blocking, and focus
 * trapping.
 */

const OPEN_MS = tokens.motion.dur + 32;
const CLOSE_MS = tokens.motion.dur_fast + 32;

let context: MountContext;
let scene: Container;
let sceneButton: Button;
let sceneClicks: number;

beforeEach(() => {
	context = createTestContext({ viewport: { logical: { width: 800, height: 600 } }, clock: new Clock() });
	scene = new Container({ id: 'scene', width: 800, height: 600 });
	sceneClicks = 0;
	// Top left, well clear of a centred panel.
	sceneButton = new Button('Scene', { id: 'scene_button', x: 20, y: 20, width: 100, height: 40, onClick: () => { sceneClicks += 1; } });
	scene.addChild(sceneButton);
	scene.mount(context);
	context.frame.layout();
});

interface Built {
	dialog: Dialog;
	confirm: Button;
	cancel: Button;
	field: Button;
	closes: number[];
}

function build(options: DialogOptions = {}): Built {
	const closes: number[] = [];
	const field = new Button('Field', { id: 'dialog_field', width: 120 });
	const cancel = new Button('Cancel', { id: 'dialog_cancel', width: 100 });
	const confirm = new Button('Abandon', { id: 'dialog_confirm', width: 100, tone: 'crit' });
	const dialog = new Dialog({
		title: 'Abandon run?',
		kicker: 'Confirm',
		content: field,
		footer: [cancel, confirm],
		onClose: () => closes.push(1),
		...options,
	});
	return { dialog, confirm, cancel, field, closes };
}

function openFully(dialog: Dialog): void {
	dialog.show(context);
	advance(context, OPEN_MS);
}

function centre(component: Button): [number, number] {
	const box = component.screenBounds;
	return [box.x + box.width / 2, box.y + box.height / 2];
}

describe('Dialog lifecycle (R12.21)', () => {
	it('opens through the overlay service as a modal root, fading in over dur', () => {
		const { dialog } = build();
		dialog.show(context);
		expect(dialog.state).toBe('opening');
		expect(dialog.open).toBe(true);
		expect(dialog.overlay?.layer).toBe('modal');
		expect(dialog.overlay?.modal).toBe(true);
		expect(context.overlays.roots).toContain(dialog.overlay?.root);

		advance(context, tokens.motion.dur / 2);
		expect(dialog.state).toBe('opening');
		expect(dialog.progress).toBeGreaterThan(0);
		expect(dialog.progress).toBeLessThan(1);
		const scale = dialog.surface.transform.scale as number;
		expect(scale).toBeGreaterThanOrEqual(DIALOG_ENTRANCE_SCALE);
		expect(scale).toBeLessThan(1);

		advance(context, OPEN_MS);
		expect(dialog.state).toBe('open');
		expect(dialog.progress).toBe(1);
		expect(dialog.surface.opacity).toBe(1);
		expect(dialog.surface.transform.scale).toBe(1);
	});

	it('ignores show unless closed, and close unless open or opening', () => {
		const { dialog, closes } = build();
		dialog.close();
		expect(dialog.state).toBe('closed');
		dialog.show(context);
		const overlay = dialog.overlay;
		dialog.show(context);
		expect(dialog.overlay).toBe(overlay);
		expect(context.overlays.roots).toHaveLength(1);
		advance(context, OPEN_MS);

		dialog.close();
		expect(dialog.state).toBe('closing');
		dialog.close();
		dialog.show(context);
		expect(dialog.state).toBe('closing');
		advance(context, CLOSE_MS);
		expect(dialog.state).toBe('closed');
		expect(dialog.open).toBe(false);
		expect(context.overlays.roots).toHaveLength(0);
		expect(closes).toHaveLength(1);
	});

	it('closes from opening, fading back from where the entrance was', () => {
		const { dialog, closes } = build();
		dialog.show(context);
		advance(context, tokens.motion.dur / 2);
		const reached = dialog.progress;
		dialog.close();
		expect(dialog.state).toBe('closing');
		advance(context, 16);
		expect(dialog.progress).toBeLessThan(reached);
		advance(context, CLOSE_MS);
		expect(dialog.state).toBe('closed');
		expect(closes).toHaveLength(1);
	});

	it('can be opened again after it closed', () => {
		const { dialog } = build();
		openFully(dialog);
		dialog.close();
		advance(context, CLOSE_MS);
		openFully(dialog);
		expect(dialog.state).toBe('open');
		expect(dialog.parent).toBe(dialog.overlay?.root);
	});

	it('completes the entrance on the first tick under reduced motion', () => {
		context.animator.reducedMotion = true;
		const { dialog } = build();
		dialog.show(context);
		advance(context, 16);
		expect(dialog.state).toBe('open');
	});

	it('hears a scene change\'s closeAll as a close', () => {
		const { dialog, closes } = build();
		openFully(dialog);
		context.overlays.closeAll();
		expect(dialog.state).toBe('closed');
		expect(dialog.parent).toBeNull();
		expect(closes).toHaveLength(1);
	});
});

describe('Dialog dismissal (R12.21)', () => {
	it('closes on Escape only once fully open', () => {
		const { dialog } = build();
		dialog.show(context);
		send(context, [key('Escape')]);
		expect(dialog.state).toBe('opening');
		advance(context, OPEN_MS);
		send(context, [key('Escape')]);
		expect(dialog.state).toBe('closing');
	});

	it('keeps Escape when closeOnEscape is false, and no scene hotkey hears it', () => {
		const heard: string[] = [];
		context.dispatcher.hotkeys.register('Escape', () => {
			heard.push('scene');
			return true;
		});
		const { dialog } = build({ closeOnEscape: false });
		openFully(dialog);
		send(context, [key('Escape')]);
		expect(dialog.state).toBe('open');
		expect(heard).toEqual([]);
	});

	it('closes from the X whatever the other options say', () => {
		const { dialog } = build({ closeOnEscape: false });
		openFully(dialog);
		click(context, ...centre(dialog.closeControl));
		expect(dialog.state).toBe('closing');
	});

	it('does not close on a press outside the panel by default, and the modal consumes it', () => {
		const { dialog } = build();
		openFully(dialog);
		click(context, ...centre(sceneButton));
		expect(dialog.state).toBe('open');
		expect(sceneClicks).toBe(0);
	});

	it('closes on a press on the scrim when dismissOnOutsidePress, still consuming it', () => {
		const { dialog } = build({ dismissOnOutsidePress: true });
		openFully(dialog);
		click(context, ...centre(sceneButton));
		expect(dialog.state).toBe('closing');
		expect(sceneClicks).toBe(0);
	});

	it('does not close on a press inside the panel', () => {
		const { dialog } = build({ dismissOnOutsidePress: true });
		openFully(dialog);
		const panel = dialog.surface.screenBounds;
		click(context, panel.x + 4, panel.y + panel.height - 4);
		expect(dialog.state).toBe('open');
	});

	it('blocks the scene from its first frame, before the fade has shown anything', () => {
		const { dialog } = build();
		dialog.show(context);
		expect(dialog.progress).toBe(0);
		click(context, ...centre(sceneButton));
		expect(sceneClicks).toBe(0);
	});

	it('as a non-modal dialog, lives in overlay, draws no scrim, and never consumes an outside press', () => {
		const { dialog } = build({ modal: false, dismissOnOutsidePress: true });
		openFully(dialog);
		expect(dialog.overlay?.layer).toBe('overlay');
		expect(dialog.overlay?.modal).toBe(false);
		expect(dialog.resolvedColors).toBeNull();
		click(context, ...centre(sceneButton));
		expect(dialog.state).toBe('closing');
		expect(sceneClicks).toBe(1);
	});

	it('as a non-modal dialog that ignores outside presses, lets the scene take them', () => {
		const { dialog } = build({ modal: false });
		openFully(dialog);
		click(context, ...centre(sceneButton));
		expect(dialog.state).toBe('open');
		expect(sceneClicks).toBe(1);
	});
});

describe('Dialog layout and focus (R12.21, R9.20)', () => {
	it('centres the panel in the viewport at its size\'s width, and follows a resize', () => {
		const { dialog } = build({ size: 'sm' });
		openFully(dialog);
		const panel = dialog.surface;
		expect(panel.width).toBe(DIALOG_WIDTHS.sm);
		expect(panel.screenBounds.x + panel.width / 2).toBeCloseTo(400);
		expect(panel.screenBounds.y + panel.height / 2).toBeCloseTo(300);

		(context.viewport as { logical: { width: number; height: number } }).logical = { width: 1000, height: 700 };
		context.overlays.resize();
		context.frame.layout();
		expect(dialog.width).toBe(1000);
		expect(panel.screenBounds.x + panel.width / 2).toBeCloseTo(500);
		expect(panel.screenBounds.y + panel.height / 2).toBeCloseTo(350);
	});

	it('clips the content inside the panel\'s border, leaving a control on the body\'s edge room for its ring', () => {
		const { dialog, field } = build();
		openFully(dialog);
		const panel = dialog.surface;
		expect(panel.clipsChildren).toBe(true);
		const clip = panel.clipRect;
		const fieldLeft = field.screenBounds.x - panel.screenBounds.x;
		const ringReach = tokens.control.focus_ring_offset + tokens.control.focus_ring_width;
		expect(clip.x).toBeGreaterThan(0);
		expect(fieldLeft - ringReach).toBeGreaterThanOrEqual(clip.x);
		expect(clip.x + clip.width).toBeLessThan(panel.width);
	});

	it('focuses the first focusable in the content, or the one it was told to', () => {
		const first = build();
		openFully(first.dialog);
		expect(context.focus.focused).toBe(first.field);
		first.dialog.close();
		advance(context, CLOSE_MS);

		const told = build();
		told.dialog = new Dialog({ content: told.field, footer: [told.cancel, told.confirm], initialFocus: told.confirm });
		openFully(told.dialog);
		expect(context.focus.focused).toBe(told.confirm);
	});

	it('traps Tab inside the dialog and gives focus back when it closes', () => {
		sceneButton.focusable = true;
		context.focus.focus(sceneButton);
		const { dialog, field, cancel, confirm } = build();
		openFully(dialog);
		const visited = new Set<unknown>();
		for (let press = 0; press < 8; press += 1) {
			send(context, [key('Tab')]);
			visited.add(context.focus.focused);
		}
		expect(visited).toEqual(new Set([dialog.closeControl, field, cancel, confirm]));

		dialog.close();
		advance(context, CLOSE_MS);
		expect(context.focus.focused).toBe(sceneButton);
	});

	it('keeps scene hotkeys from firing while a modal is open', () => {
		const heard: string[] = [];
		context.dispatcher.hotkeys.register('h', () => {
			heard.push('scene');
			return true;
		});
		const { dialog } = build();
		openFully(dialog);
		send(context, [key('h')]);
		expect(heard).toEqual([]);
		dialog.close();
		advance(context, CLOSE_MS);
		send(context, [key('h')]);
		expect(heard).toEqual(['scene']);
	});

	it('presses a footer action like any button', () => {
		const { dialog, confirm } = build();
		let confirmed = 0;
		confirm.onClick = () => {
			confirmed += 1;
			dialog.close();
		};
		openFully(dialog);
		send(context, [pointer('move', ...centre(confirm))]);
		click(context, ...centre(confirm));
		expect(confirmed).toBe(1);
		expect(dialog.state).toBe('closing');
	});

	it('wraps Shift+Tab from the first control back through the X to the last action', () => {
		const { dialog, field, confirm } = build();
		openFully(dialog);
		expect(context.focus.focused).toBe(field);
		const shiftTab = { kind: 'key' as const, phase: 'down' as const, key: 'Tab', repeat: false, modifiers: { ...NO_MODIFIERS, shift: true } };
		send(context, [shiftTab]);
		expect(context.focus.focused).toBe(dialog.closeControl);
		send(context, [shiftTab]);
		expect(context.focus.focused).toBe(confirm);
	});

	it('nests: Tab and Escape stay with the inner dialog, and focus walks back out as each closes', () => {
		sceneButton.focusable = true;
		context.focus.focus(sceneButton);
		const outer = build();
		openFully(outer.dialog);
		const inner = build();
		inner.dialog = new Dialog({ id: 'inner', title: 'Sure?', content: inner.field, footer: [inner.cancel, inner.confirm] });
		openFully(inner.dialog);
		for (let press = 0; press < 5; press += 1) {
			send(context, [key('Tab')]);
			expect([inner.dialog.closeControl, inner.field, inner.cancel, inner.confirm]).toContain(context.focus.focused);
		}
		send(context, [key('Escape')]);
		advance(context, CLOSE_MS);
		expect(inner.dialog.state).toBe('closed');
		expect(outer.dialog.state).toBe('open');
		expect(context.focus.focused).toBe(outer.field);
		outer.dialog.close();
		advance(context, CLOSE_MS);
		expect(context.focus.focused).toBe(sceneButton);
	});

	it('closes cleanly when the control that opened it was unmounted meanwhile', () => {
		sceneButton.focusable = true;
		context.focus.focus(sceneButton);
		const { dialog } = build();
		openFully(dialog);
		scene.removeChild(sceneButton);
		dialog.close();
		advance(context, CLOSE_MS);
		expect(dialog.state).toBe('closed');
		expect(context.focus.focused).toBeNull();
	});

	it('counts a press on the panel as inside on the very frame it opens', () => {
		const { dialog } = build({ dismissOnOutsidePress: true });
		dialog.show(context);
		context.frame.layout();
		const panel = dialog.surface.screenBounds;
		click(context, panel.x + panel.width / 2, panel.y + panel.height / 2);
		expect(dialog.state).not.toBe('closing');
	});
});

describe('Dialog surface on Panel (R12.19, R12.21)', () => {
	function rectsOf(panel: Panel): DrawRectOptions[] {
		const rects: DrawRectOptions[] = [];
		panel.render({ drawRect: (rect: DrawRectOptions) => rects.push(rect) } as unknown as DrawApi);
		return rects;
	}

	it('is a raised panel with the pop shadow, the kicker and title in its header, and the X in its actions', () => {
		const { dialog } = build();
		openFully(dialog);
		const panel = dialog.surface as Panel;
		expect(panel).toBeInstanceOf(Panel);
		expect(panel.variant).toBe('raised');
		expect(panel.title).toBe('Abandon run?');
		expect(panel.kicker).toBe('Confirm');
		expect(panel.actions).toEqual([dialog.closeControl]);
		const close = dialog.closeControl;
		expect(close.y + close.height).toBeLessThanOrEqual(panel.header);
		expect(close.x + close.width).toBeLessThanOrEqual(panel.width);
		const box = rectsOf(panel)[0];
		expect(box.shadow).toEqual(resolveShadow('shadow_pop'));
		expect(panel.inkExtent).toBe(shadowExtent(resolveShadow('shadow_pop')));

		dialog.title = 'Scrap it?';
		expect(dialog.title).toBe('Scrap it?');
		expect(panel.title).toBe('Scrap it?');
	});

	it('insets the body by the edge below the header, and draws a hairline over the footer only when it has actions', () => {
		const { dialog, field, cancel, confirm } = build();
		openFully(dialog);
		const panel = dialog.surface as Panel;
		const edge = tokens.space.space_4;
		expect(field.screenBounds.x - panel.screenBounds.x).toBe(edge);
		expect(field.screenBounds.y - panel.screenBounds.y).toBe(panel.header + edge);
		expect(panel.screenBounds.x + panel.width - confirm.screenBounds.x - confirm.width).toBe(edge);
		const hairlines = rectsOf(panel).filter((rect) => rect.fill === tokens.color.line_hairline);
		expect(hairlines.map((rect) => rect.rect.y)).toEqual([panel.header - tokens.borderWidth.bw_hair, cancel.parent?.y]);

		const bare = new Dialog({ id: 'bare', title: 'Notice', content: new Button('Ok', { id: 'ok', width: 80 }) });
		bare.show(context);
		advance(context, OPEN_MS);
		expect(rectsOf(bare.surface as Panel).filter((rect) => rect.fill === tokens.color.line_hairline)).toHaveLength(1);
	});
});

describe('Dialog with a Select inside (R9.20, R12.12)', () => {
	it('closes the Select first on Escape, keeping focus and its ring there, then the dialog, then gives focus back', () => {
		sceneButton.focusable = true;
		context.focus.focus(sceneButton, 'keyboard');
		const select = new Select({ id: 'dialog_select', options: [{ label: 'Hauler', value: 'hauler' }, { label: 'Runner', value: 'runner' }] });
		const dialog = new Dialog({ title: 'Pick a vehicle', content: select, initialFocus: select });
		openFully(dialog);
		expect(context.focus.focused).toBe(select);

		send(context, [key('ArrowDown')]);
		expect(select.openMenu).not.toBeNull();
		send(context, [key('Escape')]);
		expect(select.openMenu).toBeNull();
		expect(dialog.state).toBe('open');
		expect(context.focus.focused).toBe(select);
		expect(select.focusVisible).toBe(true);

		const pressedOpen = select.screenBounds;
		click(context, pressedOpen.x + 10, pressedOpen.y + pressedOpen.height / 2);
		expect(select.openMenu).not.toBeNull();
		expect(select.focusVisible).toBe(false);
		send(context, [key('Escape')]);
		expect(select.openMenu).toBeNull();
		expect(select.focusVisible).toBe(true);

		send(context, [key('Tab')]);
		expect([dialog.closeControl, select]).toContain(context.focus.focused);
		send(context, [key('Escape')]);
		advance(context, CLOSE_MS);
		expect(dialog.state).toBe('closed');
		expect(context.focus.focused).toBe(sceneButton);
		expect(sceneButton.focusVisible).toBe(true);
	});
});
