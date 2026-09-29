import { Component, ComponentOptions } from '../components/Component';
import { Layer } from '../components/Layer';
import { ScrollContainer } from '../ui/ScrollContainer';
import type { MountContext } from '../components/MountContext';
import { createTestContext } from '../components/testing';
import type { PlatformInput } from './Dispatcher';
import { AnyUiEvent, Modifiers, NO_MODIFIERS } from './events';
import { directionalScore } from './FocusManager';

/**
 * Chapter 9's focus tests (9.11), driven through the dispatcher's queue the
 * way platform input arrives (R9.25), with programmatic focus where the rule
 * is about programmatic focus.
 */

const log: string[] = [];

class Probe extends Component {
	public consumes: string | null = null;

	constructor(options: ComponentOptions) {
		super(options);
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		log.push(`${event.type}:${this.id}`);
		if (event.type === this.consumes) event.consume();
	}
}

class Container extends Probe {
	protected get defaultPointerEvents(): 'passthrough' {
		return 'passthrough';
	}
}

class Field extends Probe {
	public get acceptsText(): boolean {
		return true;
	}
}

let context: MountContext;

beforeEach(() => {
	log.length = 0;
	context = createTestContext();
});

function send(...inputs: PlatformInput[]): void {
	for (const input of inputs) {
		context.dispatcher.enqueue(input);
		context.dispatcher.dispatchPending();
		context.clock.advance(1);
	}
}

function key(name: string, { shift = false, repeat = false, modifiers }: { shift?: boolean; repeat?: boolean; modifiers?: Modifiers } = {}): void {
	send(
		{ kind: 'key', phase: 'down', key: name, repeat, modifiers: modifiers ?? { ...NO_MODIFIERS, shift } },
		{ kind: 'key', phase: 'up', key: name, repeat: false, modifiers: modifiers ?? { ...NO_MODIFIERS, shift } },
	);
}

function press(x: number, y: number): void {
	const fields = { x, y, pointerId: 1, pointerType: 'mouse' as const, isPrimary: true, pressure: 0.5, modifiers: NO_MODIFIERS };
	send(
		{ kind: 'pointer', phase: 'down', button: 0, buttons: 1, ...fields },
		{ kind: 'pointer', phase: 'up', button: 0, buttons: 0, ...fields },
	);
}

function focusedId(): string | null {
	return context.focus.focused?.id ?? null;
}

function tabIds(): (string | null)[] {
	return context.focus.tabOrder.map((component) => component.id);
}

/** A row of focusable probes 100 px wide, 20 px apart, in a root. */
function row(ids: string[], options: Partial<ComponentOptions> = {}): { root: Container; items: Probe[] } {
	const root = new Container({ id: 'root', width: 1000, height: 600 });
	const items = ids.map((id, index) => new Probe({ id, x: index * 120, y: 0, width: 100, height: 40, focusable: true, ...options }));
	for (const item of items) root.addChild(item);
	root.mount(context);
	return { root, items };
}

describe('tab order (R9.18, R9.19)', () => {
	it('follows tree order, not the order components were added', () => {
		const root = new Container({ id: 'root', width: 400, height: 400 });
		root.mount(context);
		root.addChild(new Probe({ id: 'c', focusable: true, width: 10, height: 10 }));
		root.insertChild(0, new Probe({ id: 'a', focusable: true, width: 10, height: 10 }));
		const middle = new Container({ id: 'middle', width: 10, height: 10 });
		root.insertChild(1, middle);
		middle.addChild(new Probe({ id: 'b', focusable: true, width: 10, height: 10 }));

		expect(tabIds()).toEqual(['a', 'b', 'c']);
	});

	it('puts tabIndex above 0 first, ascending, and leaves out tabIndex below 0', () => {
		const root = new Container({ id: 'root', width: 400, height: 400 });
		root.addChild(new Probe({ id: 'plain', focusable: true }));
		root.addChild(new Probe({ id: 'second', focusable: true, tabIndex: 2 }));
		root.addChild(new Probe({ id: 'skipped', focusable: true, tabIndex: -1 }));
		root.addChild(new Probe({ id: 'first', focusable: true, tabIndex: 1 }));
		root.mount(context);

		expect(tabIds()).toEqual(['first', 'second', 'plain']);
	});

	it('lands on the first with nothing focused, wraps both ways, and skips what cannot take focus', () => {
		const { items } = row(['a', 'b', 'c', 'd']);
		items[1].enabled = false;
		items[2].visible = false;

		key('Tab');
		expect(focusedId()).toBe('a');
		key('Tab');
		expect(focusedId()).toBe('d');
		key('Tab');
		expect(focusedId()).toBe('a');
		key('Tab', { shift: true });
		expect(focusedId()).toBe('d');
	});

	it('lands on the last for Shift+Tab with nothing focused', () => {
		row(['a', 'b']);
		key('Tab', { shift: true });
		expect(focusedId()).toBe('b');
	});

	it('picks up a focusable flag changed after the order was cached', () => {
		const { items } = row(['a', 'b']);
		expect(tabIds()).toEqual(['a', 'b']);
		items[0].focusable = false;
		expect(tabIds()).toEqual(['b']);
	});

	it('keeps Tab from a component that handles it (R9.16)', () => {
		const { items } = row(['a', 'b']);
		items[0].handlesTab = true;
		context.focus.focus(items[0]);
		log.length = 0;
		key('Tab');
		expect(focusedId()).toBe('a');
		expect(log).toContain('keydown:a');
	});
});

describe('focus and blur (R9.22)', () => {
	it('fires blur on the previous component, then focus on the next', () => {
		const { items } = row(['a', 'b']);
		context.focus.focus(items[0]);
		log.length = 0;
		context.focus.focus(items[1]);
		expect(log).toEqual(['blur:a', 'focus:b']);
		expect(items[0].focused).toBe(false);
		expect(items[1].focused).toBe(true);
	});

	it('refuses a component that cannot take focus', () => {
		const { items } = row(['a']);
		items[0].enabled = false;
		expect(context.focus.focus(items[0])).toBe(false);
		expect(focusedId()).toBeNull();
	});
});

describe('focus-visible (R9.23)', () => {
	it('is true after Tab, false after a press, and unchanged by programmatic focus', () => {
		const { items } = row(['a', 'b']);

		key('Tab');
		expect(items[0].focusVisible).toBe(true);
		context.focus.focus(items[1]);
		expect(items[1].focusVisible).toBe(true);

		press(50, 20);
		expect(focusedId()).toBe('a');
		expect(items[0].focusVisible).toBe(false);
		context.focus.focus(items[1]);
		expect(items[1].focusVisible).toBe(false);
	});

	it('turns on when a component a press focused is activated', () => {
		const { items } = row(['a']);
		press(50, 20);
		expect(items[0].focusVisible).toBe(false);
		key('Enter');
		expect(items[0].focusVisible).toBe(true);
	});
});

describe('pointer focus (R9.23)', () => {
	it('focuses the nearest focusable ancestor, so a press in a select\'s menu keeps the select focused', () => {
		const root = new Container({ id: 'root', width: 400, height: 400 });
		const select = new Container({ id: 'select', width: 200, height: 40, focusable: true });
		const menuItem = new Probe({ id: 'item', x: 0, y: 40, width: 200, height: 30 });
		select.addChild(menuItem);
		root.addChild(select);
		root.mount(context);

		context.focus.focus(select);
		press(50, 50);
		expect(focusedId()).toBe('select');
	});

	it('clears focus on a press on nothing focusable, unless the press prevented it', () => {
		const { root, items } = row(['a']);
		const scrollbar = new Probe({ id: 'scrollbar', x: 500, y: 0, width: 10, height: 100 });
		scrollbar.onPointerDown = (event) => event.preventFocus();
		root.addChild(scrollbar);
		context.focus.focus(items[0]);

		press(505, 50);
		expect(focusedId()).toBe('a');
		press(700, 300);
		expect(focusedId()).toBeNull();
	});
});

describe('scopes (R9.20)', () => {
	it('traps Tab in a pushed scope, focuses its first focusable, and restores focus on pop', () => {
		const { root, items } = row(['a', 'b']);
		const dialog = new Container({ id: 'dialog', x: 0, y: 100, width: 400, height: 200 });
		dialog.addChild(new Probe({ id: 'ok', width: 50, height: 20, focusable: true }));
		dialog.addChild(new Probe({ id: 'cancel', x: 60, width: 50, height: 20, focusable: true }));
		root.addChild(dialog);
		context.focus.focus(items[1]);

		context.focus.pushScope(dialog);
		expect(focusedId()).toBe('ok');
		key('Tab');
		expect(focusedId()).toBe('cancel');
		key('Tab');
		expect(focusedId()).toBe('ok');

		context.focus.popScope(dialog);
		expect(focusedId()).toBe('b');
	});

	it('pops itself when its root unmounts', () => {
		const { root, items } = row(['a']);
		const dialog = new Container({ id: 'dialog', x: 0, y: 100, width: 400, height: 200 });
		dialog.addChild(new Probe({ id: 'ok', width: 50, height: 20, focusable: true }));
		root.addChild(dialog);
		context.focus.focus(items[0]);
		context.focus.pushScope(dialog);

		root.removeChild(dialog);
		expect(context.focus.activeScope).toBeNull();
		expect(focusedId()).toBe('a');
	});
});

describe('fixup (R9.21, R9.28)', () => {
	it('drops focus on an unmounted component without calling it', () => {
		const { root, items } = row(['a', 'b']);
		context.focus.focus(items[0]);
		log.length = 0;
		root.removeChild(items[0]);
		context.frame.layout();
		expect(focusedId()).toBeNull();
		expect(log).not.toContain('blur:a');
	});

	it('blurs a component hidden or disabled since, at the end of layout', () => {
		const { items } = row(['a', 'b']);
		context.focus.focus(items[0]);
		items[0].visible = false;
		log.length = 0;
		context.frame.layout();
		expect(focusedId()).toBeNull();
		expect(log).toEqual(['blur:a']);

		context.focus.focus(items[1]);
		items[1].enabled = false;
		context.frame.layout();
		expect(focusedId()).toBeNull();
	});

	it('moves focus to the active scope\'s first focusable', () => {
		const { root } = row([]);
		const dialog = new Container({ id: 'dialog', width: 400, height: 200 });
		const ok = new Probe({ id: 'ok', width: 50, height: 20, focusable: true });
		const cancel = new Probe({ id: 'cancel', x: 60, width: 50, height: 20, focusable: true });
		dialog.addChild(ok);
		dialog.addChild(cancel);
		root.addChild(dialog);
		context.focus.pushScope(dialog);
		context.focus.focus(cancel);

		cancel.visible = false;
		context.frame.layout();
		expect(focusedId()).toBe('ok');

		dialog.removeChild(ok);
		context.frame.layout();
		expect(focusedId()).toBeNull();
		cancel.visible = true;
		dialog.addChild(ok);
		context.focus.focus(ok);
		dialog.removeChild(ok);
		context.frame.layout();
		expect(focusedId()).toBe('cancel');
	});
});

describe('focus groups (R9.29)', () => {
	function hand(): { root: Container; group: Container; cards: Probe[] } {
		const root = new Container({ id: 'root', width: 1000, height: 600 });
		root.addChild(new Probe({ id: 'before', x: 0, y: 300, width: 100, height: 40, focusable: true }));
		const group = new Container({ id: 'group', x: 0, y: 100, width: 800, height: 100, focusGroup: { orientation: 'horizontal' } });
		const cards = ['one', 'two', 'three'].map((id, index) => new Probe({ id, x: index * 120, width: 100, height: 100, focusable: true }));
		for (const card of cards) group.addChild(card);
		root.addChild(group);
		root.addChild(new Probe({ id: 'after', x: 240, y: 300, width: 100, height: 40, focusable: true }));
		root.mount(context);
		return { root, group, cards };
	}

	it('is one Tab stop, entered at its last active child, with arrows inside', () => {
		const { cards } = hand();
		expect(tabIds()).toEqual(['before', 'one', 'after']);

		key('Tab');
		key('Tab');
		expect(focusedId()).toBe('one');
		key('ArrowRight');
		key('ArrowRight');
		expect(focusedId()).toBe('three');
		key('Tab');
		expect(focusedId()).toBe('after');
		key('Tab', { shift: true });
		expect(focusedId()).toBe('three');

		key('Home');
		expect(focusedId()).toBe('one');
		key('End');
		expect(focusedId()).toBe('three');

		cards[0].enabled = false;
		key('Home');
		expect(focusedId()).toBe('two');
	});

	it('stops at its ends without wrap and falls back to directional focus off the axis', () => {
		const { group } = hand();
		context.focus.focus(group.getChildren()[2]);
		key('ArrowRight');
		expect(focusedId()).toBe('three');
		key('ArrowDown');
		expect(focusedId()).toBe('after');
	});

	it('lets go of an active child that is removed, and enters at the first member', () => {
		const { group, cards } = hand();
		context.focus.focus(cards[2]);
		expect(group.activeChild).toBe(cards[2]);
		group.removeChild(cards[2]);
		expect(group.activeChild).toBeNull();

		context.focus.focus(cards[1]);
		group.clearChildren();
		expect(group.activeChild).toBeNull();
	});

	it('wraps when asked', () => {
		const { group } = hand();
		group.focusGroup = { orientation: 'horizontal', wrap: true };
		context.focus.focus(group.getChildren()[2]);
		key('ArrowRight');
		expect(focusedId()).toBe('one');
	});
});

describe('scroll into view (R12.20)', () => {
	function scroller(): { panel: ScrollContainer; rows: Probe[] } {
		const panel = new ScrollContainer({ id: 'panel', width: 200, height: 100, contentHeight: 280 });
		const content = new Layer({ width: 200, height: 280 });
		const rows = [0, 1, 2, 3, 4].map((index) => new Probe({ id: `row${index}`, y: index * 60, width: 200, height: 40, focusable: true }));
		for (const row of rows) content.addChild(row);
		panel.addChild(content);
		panel.mount(context);
		return { panel, rows };
	}

	it('scrolls the least that shows a component focused by keyboard, both ways', () => {
		const { panel } = scroller();
		key('Tab');
		key('Tab');
		expect(panel.scrollPosition).toBe(0);
		key('Tab');
		// row2 spans 120 to 160; the clip is 100 tall
		expect(focusedId()).toBe('row2');
		expect(panel.scrollPosition).toBe(60);
		key('Tab', { shift: true });
		key('Tab', { shift: true });
		expect(panel.scrollPosition).toBe(0);
	});

	it('reads the placed origin, margin included, not the raw position', () => {
		const panel = new ScrollContainer({ id: 'panel', width: 200, height: 100, contentHeight: 300 });
		const content = new Layer({ width: 200, height: 300 });
		const row = new Probe({ id: 'row', y: 50, margin: { top: 70 }, width: 200, height: 40, focusable: true });
		content.addChild(row);
		panel.addChild(content);
		panel.mount(context);
		// The content box spans originY 120 to 160, though y is 50
		expect(row.originY).toBe(120);
		context.focus.focus(row);
		expect(panel.scrollPosition).toBe(60);
	});

	it('scrolls for programmatic focus, but not for a press', () => {
		const { panel, rows } = scroller();
		context.focus.focus(rows[4]);
		expect(panel.scrollPosition).toBe(180);
		panel.scrollToTop();
		context.focus.focusFromPointer(rows[3]);
		expect(panel.scrollPosition).toBe(0);
	});
});

describe('directional focus (R9.26)', () => {
	function grid(): { root: Container; cells: Record<string, Probe> } {
		// a b c
		// d   e
		const root = new Container({ id: 'root', width: 1000, height: 600 });
		const cells: Record<string, Probe> = {};
		const place = (id: string, x: number, y: number): void => {
			cells[id] = new Probe({ id, x, y, width: 100, height: 40, focusable: true });
			root.addChild(cells[id]);
		};
		place('a', 0, 0);
		place('b', 150, 0);
		place('c', 300, 0);
		place('d', 0, 100);
		place('e', 300, 100);
		root.mount(context);
		return { root, cells };
	}

	it('picks the nearest candidate in the pressed direction', () => {
		const { cells } = grid();
		context.focus.focus(cells.a);
		key('ArrowRight');
		expect(focusedId()).toBe('b');
		key('ArrowDown');
		// d and e score the same from b; a tie keeps tree order
		expect(focusedId()).toBe('d');
		context.focus.focus(cells.c);
		key('ArrowDown');
		expect(focusedId()).toBe('e');
		key('ArrowLeft');
		expect(focusedId()).toBe('d');
		key('ArrowUp');
		expect(focusedId()).toBe('a');
		key('ArrowUp');
		expect(focusedId()).toBe('a');
	});

	it('respects explicit neighbours', () => {
		const { cells } = grid();
		cells.a.focusRight = cells.e;
		context.focus.focus(cells.a);
		key('ArrowRight');
		expect(focusedId()).toBe('e');
	});

	it('lands on the first focusable with nothing focused', () => {
		grid();
		key('ArrowDown');
		expect(focusedId()).toBe('a');
		expect(context.focus.focused?.focusVisible).toBe(true);
	});

	it('scores along plus twice across, less the overlap across', () => {
		const from = { x: 0, y: 0, width: 100, height: 40 };
		expect(directionalScore(from, { x: 150, y: 0, width: 100, height: 40 }, 'right')).toBe(50 - 40);
		expect(directionalScore(from, { x: 150, y: 100, width: 100, height: 40 }, 'right')).toBe(50 + 200);
		expect(directionalScore(from, { x: -150, y: 0, width: 100, height: 40 }, 'right')).toBe(Infinity);
	});
});

describe('activate and cancel (R9.27)', () => {
	it('synthesises activate from Enter and Space at the focused component, once per press', () => {
		const { items } = row(['a']);
		context.focus.focus(items[0]);
		log.length = 0;

		key('Enter');
		key(' ');
		send({ kind: 'key', phase: 'down', key: 'Enter', repeat: false, modifiers: NO_MODIFIERS });
		send({ kind: 'key', phase: 'down', key: 'Enter', repeat: true, modifiers: NO_MODIFIERS });
		send({ kind: 'key', phase: 'down', key: 'Enter', repeat: true, modifiers: NO_MODIFIERS });
		expect(log.filter((entry) => entry.startsWith('activate'))).toEqual(['activate:a', 'activate:root', 'activate:a', 'activate:root', 'activate:a', 'activate:root']);
	});

	it('delivers cancel from Escape, bubbling, and gives an unconsumed one to the hotkey tables', () => {
		const { root, items } = row(['a']);
		const fired: string[] = [];
		root.hotkeys.register('Escape', () => fired.push('root'));
		context.focus.focus(items[0]);
		log.length = 0;

		key('Escape');
		expect(log.filter((entry) => !entry.startsWith('key'))).toEqual(['cancel:a', 'cancel:root']);
		expect(fired).toEqual(['root']);

		root.consumes = 'cancel';
		key('Escape');
		expect(fired).toEqual(['root']);
	});
});

describe('scoped hotkeys (R9.15)', () => {
	it('searches the focused root, then the other roots topmost first, then the scene', () => {
		const lower = new Container({ id: 'lower', width: 100, height: 100 });
		const field = new Probe({ id: 'field', width: 10, height: 10, focusable: true });
		lower.addChild(field);
		const upper = new Container({ id: 'upper', width: 100, height: 100 });
		lower.mount(context);
		upper.mount(context);
		const fired: string[] = [];
		lower.hotkeys.register('x', () => fired.push('lower'));
		upper.hotkeys.register('x', () => fired.push('upper'));
		upper.hotkeys.register('y', () => fired.push('upper'));
		context.dispatcher.hotkeys.register('z', () => fired.push('scene'));

		context.focus.focus(field);
		key('x');
		key('y');
		key('z');
		expect(fired).toEqual(['lower', 'upper', 'scene']);

		context.focus.blur();
		key('x');
		expect(fired).toEqual(['lower', 'upper', 'scene', 'upper']);
	});

	it('never fires a hotkey of a root beneath a modal root, nor the scene\'s', () => {
		const screen = new Container({ id: 'screen', width: 100, height: 100 });
		const dialog = new Container({ id: 'dialog', width: 100, height: 100 });
		dialog.modal = true;
		screen.mount(context);
		dialog.mount(context);
		const fired: string[] = [];
		screen.hotkeys.register('Escape', () => fired.push('screen'));
		context.dispatcher.hotkeys.register('F6', () => fired.push('scene'));
		dialog.hotkeys.register('Enter', () => fired.push('dialog'));

		key('Escape');
		key('F6');
		key('Enter');
		expect(fired).toEqual(['dialog']);
		expect(context.dispatcher.claimsKey('F6')).toBe(false);
	});

	it('keeps a printable hotkey from firing while a text field is focused, and lets Escape and named keys through', () => {
		const root = new Container({ id: 'root', width: 100, height: 100 });
		const field = new Field({ id: 'field', width: 10, height: 10, focusable: true });
		root.addChild(field);
		root.mount(context);
		const fired: string[] = [];
		root.hotkeys.register('q', () => fired.push('q'));
		root.hotkeys.register('ArrowLeft', () => fired.push('left'));
		root.hotkeys.register('Escape', () => fired.push('escape'));
		root.hotkeys.register('F6', () => fired.push('F6'));
		context.focus.focus(field);
		log.length = 0;

		key('q');
		key('ArrowLeft');
		key('Enter');
		key('F6');
		key('Escape');
		expect(fired).toEqual(['F6', 'escape']);
		expect(log).not.toContain('activate:field');
		expect(focusedId()).toBe('field');
		expect(context.dispatcher.claimsKey('q')).toBe(true);
		expect(context.dispatcher.claimsKey('c', { ...NO_MODIFIERS, meta: true })).toBe(false);
	});
});

describe('inputMode (R9.27)', () => {
	it('follows the last input source', () => {
		row(['a']);
		press(50, 20);
		expect(context.dispatcher.inputMode).toBe('pointer');
		key('Tab');
		expect(context.dispatcher.inputMode).toBe('keyboard');
	});
});
