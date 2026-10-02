/**
 * @jest-environment jsdom
 */
import { Clock } from '../animation/Clock';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { createTestContext, injectNow } from '../components/testing';
import { renderTree } from '../components/renderTree';
import type { DrawCommand, RectCommand, TextCommand } from '../draw';
import { Modifiers, NO_MODIFIERS } from '../input/events';
import { PointerAdapter } from '../input/PointerAdapter';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../text/testing';
import { tokens } from '../theme/tokens';
import { treeSnapshot } from '../debug/treeSnapshot';
import { Button } from './Button';
import { ContextMenu } from './ContextMenu';
import { Dialog } from './Dialog';
import { DropdownButton, DropdownButtonOptions } from './DropdownButton';
import { Menu, MenuItem } from './Menu';
import { Select, SelectOption } from './Select';
import { TextInput } from './TextInput';

/**
 * R12.11 to R12.14 on the dispatcher and the popup service: every
 * interaction is injected at a mounted root (R9.25), menus open as overlay
 * roots in the `popup` layer, and the release of an opening press never
 * selects. Worldsim's Menu, Select, DropdownButton, and ContextMenu suites
 * are the behaviour ported here; separators, shortcuts, and `maxHeight` are
 * the spec's additions.
 */

const { control, color, space } = tokens;
const ROW = control.control_h_sm;
const PAD = space.space_1;
const VIEWPORT = { width: 800, height: 600 };

let canvas: HTMLCanvasElement;
let context: MountContext;
let adapter: PointerAdapter;
let backend: MeasuringRecordingBackend;
let root: Container;

function inject(...commands: string[]): void {
	expect(injectNow({ canvas, dispatcher: context.dispatcher }, commands).ok).toBe(true);
}

function press(key: string, modifiers: Partial<Modifiers> = {}): void {
	const mods = { ...NO_MODIFIERS, ...modifiers };
	context.dispatcher.enqueue({ kind: 'key', phase: 'down', key, repeat: false, modifiers: mods });
	context.dispatcher.enqueue({ kind: 'key', phase: 'up', key, repeat: false, modifiers: mods });
	context.dispatcher.dispatchPending();
}

function layout(): void {
	context.frame.layout();
}

function centre(component: { screenBounds: { x: number; y: number; width: number; height: number } }): string {
	const box = component.screenBounds;
	return `${Math.round(box.x + box.width / 2)},${Math.round(box.y + box.height / 2)}`;
}

/** The screen centre of `menu`'s row `index`. */
function rowCentre(menu: Menu, index: number): string {
	const row = menu.rowRect(index);
	const box = menu.screenBounds;
	return `${Math.round(box.x + row.width / 2)},${Math.round(box.y + PAD + row.y + row.height / 2)}`;
}

function wheel(target: { screenBounds: { x: number; y: number; width: number; height: number } }, deltaY: number): void {
	const box = target.screenBounds;
	context.dispatcher.enqueue({ kind: 'wheel', x: box.x + box.width / 2, y: box.y + box.height / 2, deltaX: 0, deltaY, deltaMode: 0, modifiers: NO_MODIFIERS });
	context.dispatcher.dispatchPending();
	layout();
}

function draws(): readonly DrawCommand[] {
	const api = context.draw;
	api.beginFrame({ viewport: VIEWPORT });
	for (const mounted of context.dispatcher.roots) renderTree(mounted, api);
	api.endFrame();
	return backend.commands;
}

function items(...labels: string[]): { items: MenuItem[]; picked: string[] } {
	const picked: string[] = [];
	return {
		picked,
		items: labels.map((label) => ({ label, onSelect: () => picked.push(label) })),
	};
}

beforeEach(() => {
	canvas = document.createElement('canvas');
	document.body.appendChild(canvas);
	const measuring = createMeasuringDrawApi();
	backend = measuring.backend;
	context = createTestContext({ draw: measuring.api, clock: new Clock(), viewport: { logical: VIEWPORT } });
	adapter = new PointerAdapter({ dispatcher: context.dispatcher });
	adapter.attach(canvas);
	root = new Container({ id: 'root', width: VIEWPORT.width, height: VIEWPORT.height });
	root.mount(context);
});

afterEach(() => {
	context.popups.close();
	root.unmount();
	adapter.detach();
	document.body.removeChild(canvas);
});

describe('Menu (R12.11)', () => {
	function menu(options: ConstructorParameters<typeof Menu>[0] = {}): Menu {
		const made = new Menu({ id: 'menu', x: 100, y: 100, ...options });
		root.addChild(made);
		layout();
		return made;
	}

	it('constructs with a default width, no hover, and only its padding for height', () => {
		const made = new Menu();
		expect(made.width).toBe(200);
		expect(made.hoveredIndex).toBe(-1);
		expect(made.items).toEqual([]);
		expect(made.height).toBe(PAD * 2);
	});

	it('takes its height from its rows, separators included, capped by maxHeight', () => {
		const three = new Menu({ items: items('Repair', 'Refuel', 'Scrap').items });
		expect(three.height).toBe(ROW * 3 + PAD * 2);
		const separated = new Menu({ items: [{ label: 'Repair' }, { separator: true }, { label: 'Scrap' }] });
		expect(separated.height).toBe(ROW * 2 + space.space_2 + PAD * 2);
		const capped = new Menu({ items: items('a', 'b', 'c', 'd').items, maxHeight: 60 });
		expect(capped.height).toBe(60);
		expect(capped.naturalHeight).toBe(ROW * 4 + PAD * 2);
		capped.items = items('a').items;
		expect(capped.height).toBe(ROW + PAD * 2);
	});

	it('scrolls its rows inside a ScrollContainer when capped shorter than they are', () => {
		const labels = ['a', 'b', 'c', 'd', 'e', 'f'];
		const { items: list, picked } = items(...labels);
		const made = menu({ items: list, maxHeight: 80 });
		expect(made.scrolls).toBe(true);
		// A row past the viewport is clipped out and culled.
		const visible = () => draws().filter((command): command is TextCommand => command.kind === 'text').map((text) => text.text);
		expect(visible()).not.toContain('f');
		// The wheel over the rows scrolls them, and the row now under the pointer selects.
		wheel(made, 200);
		expect(made.scrollOffset).toBeGreaterThan(0);
		expect(visible()).toContain('f');
		const box = made.screenBounds;
		inject(`click,${Math.round(box.x + 40)},${Math.round(box.y + box.height - PAD - ROW / 2)}`);
		expect(picked).toEqual(['f']);
	});

	it('reports only the rows in view for the text record', () => {
		const made = menu({ items: items('a', 'b', 'c', 'd', 'e', 'f').items, maxHeight: 80 });
		const rows = made.children[0].children.find((child) => child.drawnText) as { drawnText: readonly string[] };
		expect(rows.drawnText).toEqual(['a', 'b', 'c']);
		wheel(made, 400);
		expect(rows.drawnText).toEqual(['d', 'e', 'f']);
	});

	it('brings a row highlighted by the keys into view, and the opening highlight too', () => {
		const labels = ['a', 'b', 'c', 'd', 'e', 'f'];
		const made = menu({ items: items(...labels).items, maxHeight: 80 });
		expect(made.scrollOffset).toBe(0);
		made.hoverEdge('last');
		expect(made.scrollOffset).toBe(ROW * 6 - (80 - PAD * 2));
		made.moveHover(1);
		expect(made.hoveredIndex).toBe(0);
		expect(made.scrollOffset).toBe(0);
		const opened = new Menu({ id: 'opened', x: 400, y: 100, items: items(...labels).items, maxHeight: 80, hoveredIndex: 4 });
		root.addChild(opened);
		layout();
		expect(opened.scrollOffset).toBe(ROW * 5 - (80 - PAD * 2));
	});

	it('finds rows by y and reports their bounds', () => {
		const made = menu({ width: 150, items: [{ label: 'a' }, { separator: true }, { label: 'b' }] });
		expect(made.indexAt(0)).toBe(0);
		expect(made.indexAt(ROW + 1)).toBe(1);
		expect(made.indexAt(ROW + space.space_2 + 1)).toBe(2);
		expect(made.indexAt(-1)).toBe(-1);
		expect(made.indexAt(ROW * 2 + space.space_2)).toBe(-1);
		expect(made.rowRect(2)).toEqual({ x: 0, y: ROW + space.space_2, width: 150 - tokens.borderWidth.bw * 2, height: ROW });
	});

	it('keeps a hovered row inside the border, clear of the rounded corners', () => {
		const made = menu({ width: 150, items: items('a', 'b').items });
		made.hoveredIndex = 0;
		const wash = draws().find((command): command is RectCommand => command.kind === 'rect' && String(command.fill) === String(color.bg_hover));
		const box = made.screenBounds;
		const border = tokens.borderWidth.bw;
		if (!wash) throw new Error('no hover wash drawn');
		const [, , , , tx, ty] = wash.transform;
		expect(wash.rect.x + tx).toBe(box.x + border);
		expect(wash.rect.width).toBe(150 - border * 2);
		// The padding above the first row is wider than the corner, so no row reaches it.
		expect(wash.rect.y + ty).toBe(box.y + PAD);
		expect(PAD).toBeGreaterThanOrEqual(tokens.radius.radius_ui);
	});

	it('highlights the row under a moving pointer without consuming the move', () => {
		const made = menu({ items: items('Repair', 'Refuel').items });
		const seen: string[] = [];
		root.onPointerMove = () => seen.push('root');
		inject(`move,${rowCentre(made, 1)}`);
		expect(made.hoveredIndex).toBe(1);
		expect(seen).toEqual(['root']);
		inject('move,700,500');
		expect(made.hoveredIndex).toBe(-1);
	});

	it('consumes a press inside, and selects on a release over an enabled item', () => {
		const { items: list, picked } = items('Repair', 'Refuel');
		const chosen: number[] = [];
		const made = menu({ items: list, onSelect: (_item, index) => chosen.push(index) });
		const pressed: string[] = [];
		root.onPointerDown = () => pressed.push('root');
		inject(`click,${rowCentre(made, 1)}`);
		expect(pressed).toEqual([]);
		expect(picked).toEqual(['Refuel']);
		expect(chosen).toEqual([1]);
	});

	it('does not select a disabled item, a separator, or a release whose press began outside', () => {
		const picked: string[] = [];
		const made = menu({
			items: [
				{ label: 'Locked', enabled: false, onSelect: () => picked.push('Locked') },
				{ separator: true },
				{ label: 'Scrap', onSelect: () => picked.push('Scrap') },
			],
		});
		inject(`click,${rowCentre(made, 0)}`, `click,${rowCentre(made, 1)}`);
		inject('down,700,500', `move,${rowCentre(made, 2)}`, `up,${rowCentre(made, 2)}`);
		expect(picked).toEqual([]);
		expect(made.select(5)).toBe(false);
		expect(made.select(2)).toBe(true);
		expect(picked).toEqual(['Scrap']);
	});

	it('moves the highlight with the keyboard helpers, wrapping and skipping what cannot be selected', () => {
		const made = new Menu({
			items: [{ label: 'a' }, { separator: true }, { label: 'b', enabled: false }, { label: 'c' }],
		});
		made.moveHover(1);
		expect(made.hoveredIndex).toBe(0);
		made.moveHover(1);
		expect(made.hoveredIndex).toBe(3);
		made.moveHover(1);
		expect(made.hoveredIndex).toBe(0);
		made.moveHover(-1);
		expect(made.hoveredIndex).toBe(3);
		made.moveHover(1, { wrap: false });
		expect(made.hoveredIndex).toBe(3);
		made.hoverEdge('first');
		expect(made.hoveredIndex).toBe(0);
		made.hoverEdge('last');
		expect(made.hoveredIndex).toBe(3);
		expect(new Menu({ items: [{ separator: true }] }).moveHover(1)).toBe(false);
	});

	it('draws a raised surface, a hover wash, a separator hairline, and a right-aligned shortcut', () => {
		const made = menu({ items: [{ label: 'Save', shortcut: 'CTRL+S' }, { separator: true }, { label: 'Quit' }] });
		made.hoveredIndex = 0;
		const commands = draws();
		const rects = commands.filter((command): command is RectCommand => command.kind === 'rect');
		const texts = commands.filter((command): command is TextCommand => command.kind === 'text');
		expect(rects[0]).toMatchObject({ id: 'menu', fill: color.bg_panel_raised, border: { color: color.line_edge } });
		expect(commands.some((command) => command.kind === 'shadow')).toBe(true);
		expect(rects.some((rect) => String(rect.fill) === String(color.bg_hover))).toBe(true);
		const hairline = rects.find((rect) => String(rect.fill) === String(color.line_hairline));
		expect(hairline?.rect.height).toBe(tokens.borderWidth.bw);
		const shortcut = texts.find((text) => text.text === 'CTRL+S');
		expect(shortcut).toMatchObject({ font: 'mono', align: 'right', color: color.text_dim });
		expect(texts.find((text) => text.text === 'Save')?.color).toEqual(color.text_bright);
	});
});

describe('Select (R12.12)', () => {
	const OPTIONS: SelectOption[] = [
		{ label: 'Scrap Hauler', value: 'hauler' },
		{ label: 'Rust Runner', value: 'runner' },
		{ label: 'Dust Devil', value: 'devil' },
	];

	function select(options: ConstructorParameters<typeof Select>[0] = {}): { made: Select; changes: string[] } {
		const changes: string[] = [];
		const made = new Select({ id: 'vehicle', x: 100, y: 100, options: OPTIONS, onChange: (value) => changes.push(value), ...options });
		root.addChild(made);
		layout();
		return { made, changes };
	}

	it('shows the placeholder without a value, and the chosen label with one', () => {
		const { made } = select({ placeholder: 'Pick a vehicle' });
		expect(made.selectedLabel).toBe('Pick a vehicle');
		made.value = 'runner';
		expect(made.selectedLabel).toBe('Rust Runner');
		made.value = 'missing';
		expect(made.selectedLabel).toBe('Pick a vehicle');
		expect(made.openMenu).toBeNull();
		expect(made.open).toBe(false);
	});

	it('opens below itself on a press, highlighting the current value, and the release picks nothing', () => {
		const { made, changes } = select({ value: 'runner' });
		inject(`down,${centre(made)}`);
		const menu = made.openMenu;
		expect(menu).not.toBeNull();
		expect(made.open).toBe(true);
		expect(menu?.effectiveLayer).toBe('popup');
		expect(menu?.hoveredIndex).toBe(1);
		expect(menu?.screenBounds.y).toBeGreaterThanOrEqual(made.screenBounds.y + made.height);
		expect(menu?.width).toBe(made.width);
		inject(`up,${centre(made)}`);
		expect(made.openMenu).toBe(menu);
		expect(changes).toEqual([]);
	});

	it('picks an option with a click, fires onChange, closes, and keeps focus', () => {
		const { made, changes } = select({ value: 'hauler' });
		inject(`click,${centre(made)}`);
		const menu = made.openMenu as Menu;
		inject(`click,${rowCentre(menu, 2)}`);
		expect(made.value).toBe('devil');
		expect(changes).toEqual(['devil']);
		expect(made.openMenu).toBeNull();
		expect(made.open).toBe(false);
		expect(made.focused).toBe(true);
	});

	it('does not fire onChange for the value it already has', () => {
		const { made, changes } = select({ value: 'hauler' });
		inject(`click,${centre(made)}`);
		inject(`click,${rowCentre(made.openMenu as Menu, 0)}`);
		expect(changes).toEqual([]);
		expect(made.openMenu).toBeNull();
	});

	it('toggles closed on a second press', () => {
		const { made } = select();
		inject(`click,${centre(made)}`);
		inject(`click,${centre(made)}`);
		expect(made.openMenu).toBeNull();
	});

	it('opens on Down, moves with Up and Down, picks on Enter, and closes on Escape keeping focus', () => {
		const { made, changes } = select({ value: 'hauler' });
		press('Tab');
		expect(made.focused).toBe(true);
		press('ArrowDown');
		expect(made.openMenu?.hoveredIndex).toBe(0);
		press('ArrowDown');
		press('ArrowDown');
		press('ArrowDown');
		expect(made.openMenu?.hoveredIndex).toBe(2);
		press('ArrowUp');
		press('Enter');
		expect(changes).toEqual(['runner']);
		expect(made.openMenu).toBeNull();
		press(' ');
		expect(made.openMenu).not.toBeNull();
		press('End');
		expect(made.openMenu?.hoveredIndex).toBe(2);
		const heard: string[] = [];
		context.dispatcher.hotkeys.register('Escape', () => heard.push('escape'));
		press('Escape');
		expect(made.openMenu).toBeNull();
		expect(made.focused).toBe(true);
		expect(heard).toEqual([]);
		press('Escape');
		expect(heard).toEqual(['escape']);
	});

	it('closes on a press outside, which is consumed', () => {
		const { made } = select();
		const clicks: number[] = [];
		root.addChild(new Button({ label: 'Go', id: 'go', x: 500, y: 400, width: 100, onClick: () => clicks.push(1) }));
		layout();
		inject(`click,${centre(made)}`);
		inject('click,550,417');
		expect(made.openMenu).toBeNull();
		expect(clicks).toEqual([]);
	});

	it('switches to another select in one press', () => {
		const { made: first } = select();
		const second = new Select({ id: 'driver', x: 400, y: 100, options: OPTIONS });
		root.addChild(second);
		layout();
		inject(`click,${centre(first)}`);
		inject(`click,${centre(second)}`);
		expect(first.openMenu).toBeNull();
		expect(second.openMenu).not.toBeNull();
		expect(second.focused).toBe(true);
	});

	it('keeps focus through a press in its menu, and closes when focus moves away', () => {
		const { made } = select();
		root.addChild(new Button({ label: 'Next', id: 'next', x: 500, y: 400, width: 100 }));
		layout();
		inject(`click,${centre(made)}`);
		const menu = made.openMenu as Menu;
		inject(`down,${rowCentre(menu, 1)}`);
		expect(made.focused).toBe(true);
		expect(made.openMenu).toBe(menu);
		inject(`up,${rowCentre(menu, 1)}`);
		inject(`click,${centre(made)}`);
		press('Tab');
		expect(made.focused).toBe(false);
		expect(made.openMenu).toBeNull();
	});

	it('closes when its options change, and stays shut while disabled or empty', () => {
		const { made } = select();
		inject(`click,${centre(made)}`);
		made.options = OPTIONS.slice(0, 1);
		expect(made.openMenu).toBeNull();
		made.enabled = false;
		inject(`click,${centre(made)}`);
		expect(made.openMenu).toBeNull();
		made.enabled = true;
		made.options = [];
		inject(`click,${centre(made)}`);
		expect(made.openMenu).toBeNull();
	});

	it('scrolls a list the placement cut short, with the current value in view', () => {
		const many = Array.from({ length: 30 }, (_, index) => ({ label: `Vehicle ${index}`, value: `v${index}` }));
		const { made } = select({ options: many, value: 'v25', maxMenuHeight: 2000 });
		inject(`click,${centre(made)}`);
		layout();
		const menu = made.openMenu as Menu;
		expect(menu.height).toBeLessThan(menu.naturalHeight);
		expect(menu.scrolls).toBe(true);
		const row = menu.rowRect(25);
		expect(row.y).toBeGreaterThanOrEqual(menu.scrollOffset);
		expect(row.y + row.height).toBeLessThanOrEqual(menu.scrollOffset + menu.height - PAD * 2);
	});

	it('reports the label it draws, and its menu the rows, for the text record', () => {
		const { made } = select({ value: 'runner' });
		inject(`click,${centre(made)}`);
		const find = (node: ReturnType<typeof treeSnapshot>['roots'][number], id: string): typeof node | null => {
			if (node.id === id) return node;
			for (const child of [...(node.parts ?? []), ...node.children]) {
				const found = find(child, id);
				if (found) return found;
			}
			return null;
		};
		const roots = treeSnapshot(context.dispatcher.roots, VIEWPORT).roots;
		expect(roots.map((node) => find(node, 'vehicle')).find(Boolean)?.labels).toEqual(['Rust Runner']);
		const menu = roots.map((node) => find(node, 'vehicle_menu')).find(Boolean);
		const rows = menu && [...(menu.parts ?? []), ...menu.children].flatMap((node) => [node, ...node.children]).find((node) => node.labels);
		expect(rows?.labels).toEqual(['Scrap Hauler', 'Rust Runner', 'Dust Devil']);
	});

	it('lifts its border to the accent while open', () => {
		const { made } = select();
		inject(`click,${centre(made)}`);
		context.frame.update(tokens.motion.dur_fast / 1000);
		expect(made.look.border).toEqual(color.accent);
	});

	it('draws its focus ring after Escape closes a list opened by a press and driven from the keys (DDB-229)', () => {
		const { made } = select({ value: 'hauler' });
		inject(`down,${centre(made)}`, `up,${centre(made)}`);
		expect(made.openMenu).not.toBeNull();
		expect(made.focusVisible).toBe(false);
		press('ArrowDown');
		press('Escape');
		context.frame.update(tokens.motion.dur_fast / 1000);
		expect(made.openMenu).toBeNull();
		expect(made.focused).toBe(true);
		expect(made.focusVisible).toBe(true);
		expect(made.look.focusRing).toEqual(color.accent);
		const ring = draws().find((command): command is RectCommand => command.kind === 'rect' && command.border?.position === 'outside');
		expect(ring?.border?.color).toEqual(color.accent);
	});

	it('draws its focus ring after Escape alone closes a list opened by a press (DDB-229)', () => {
		const { made } = select();
		inject(`down,${centre(made)}`, `up,${centre(made)}`);
		press('Escape');
		expect(made.openMenu).toBeNull();
		expect(made.focused).toBe(true);
		expect(made.focusVisible).toBe(true);
	});
});

describe('DropdownButton (R12.13)', () => {
	function dropdown(options: DropdownButtonOptions = {}): { made: DropdownButton; picked: string[] } {
		const { items: list, picked } = items('Repair', 'Refuel', 'Scrap');
		const made = new DropdownButton({ label: 'Actions', id: 'actions', x: 100, y: 300, width: 140, items: list, ...options });
		root.addChild(made);
		layout();
		return { made, picked };
	}

	it('toggles on release, so the release opens it and selects nothing', () => {
		const { made, picked } = dropdown();
		inject(`down,${centre(made)}`);
		expect(made.openMenu).toBeNull();
		inject(`up,${centre(made)}`);
		expect(made.openMenu).not.toBeNull();
		expect(made.openMenu?.hoveredIndex).toBe(-1);
		expect(made.open).toBe(true);
		expect(picked).toEqual([]);
		inject(`click,${centre(made)}`);
		expect(made.openMenu).toBeNull();
	});

	it('selects with a click, fires onSelect, and closes', () => {
		const chosen: number[] = [];
		const { made, picked } = dropdown({ onSelect: (_item, index) => chosen.push(index) });
		inject(`click,${centre(made)}`);
		inject(`click,${rowCentre(made.openMenu as Menu, 1)}`);
		expect(picked).toEqual(['Refuel']);
		expect(chosen).toEqual([1]);
		expect(made.openMenu).toBeNull();
	});

	it('opens on Down with the first item highlighted and picks on Enter', () => {
		const { made, picked } = dropdown();
		press('Tab');
		press('ArrowDown');
		expect(made.openMenu?.hoveredIndex).toBe(0);
		press('ArrowDown');
		press('Enter');
		expect(picked).toEqual(['Refuel']);
		expect(made.openMenu).toBeNull();
		press('Enter');
		expect(made.openMenu?.hoveredIndex).toBe(0);
	});

	it('closes on Escape, on a press outside (consumed), and on focus loss', () => {
		const { made } = dropdown();
		inject(`click,${centre(made)}`);
		press('Escape');
		expect(made.openMenu).toBeNull();

		const clicks: number[] = [];
		root.addChild(new Button({ label: 'Go', x: 500, y: 500, width: 100, onClick: () => clicks.push(1) }));
		layout();
		inject(`click,${centre(made)}`, 'click,550,517');
		expect(made.openMenu).toBeNull();
		expect(clicks).toEqual([]);

		inject(`click,${centre(made)}`);
		press('Tab');
		expect(made.openMenu).toBeNull();
	});

	it('draws its focus ring after Escape closes a menu opened by a click and driven from the keys (DDB-229)', () => {
		const { made } = dropdown();
		inject(`click,${centre(made)}`);
		expect(made.focusVisible).toBe(false);
		press('ArrowDown');
		press('Escape');
		expect(made.openMenu).toBeNull();
		expect(made.focused).toBe(true);
		expect(made.focusVisible).toBe(true);
	});

	it('opens upward when asked, and not at all with no items', () => {
		const { made } = dropdown({ openUpward: true });
		inject(`click,${centre(made)}`);
		const menu = made.openMenu as Menu;
		expect(menu.screenBounds.y + menu.height).toBeLessThanOrEqual(made.screenBounds.y);
		made.items = [];
		expect(made.openMenu).toBeNull();
		inject(`click,${centre(made)}`);
		expect(made.openMenu).toBeNull();
	});
});

describe('ContextMenu (R12.14)', () => {
	function contextMenu(extra: MenuItem[] = []): { menu: ContextMenu; picked: string[]; closes: string[] } {
		const { items: list, picked } = items('Inspect', 'Repair');
		const closes: string[] = [];
		const menu = new ContextMenu({ id: 'context', items: [...list, ...extra], onClose: (reason) => closes.push(reason) });
		// The scene's backdrop: something under the pointer to receive `contextmenu`.
		const scene = new Container({ id: 'scene', width: VIEWPORT.width, height: VIEWPORT.height, pointerEvents: 'auto' });
		scene.onContextMenu = (event) => menu.openAt(event.screen, { from: scene });
		root.addChild(scene);
		layout();
		return { menu, picked, closes };
	}

	it('starts closed, and opens at the pointer on a secondary release', () => {
		const { menu } = contextMenu();
		expect(menu.isOpen).toBe(false);
		expect(menu.isMounted).toBe(false);
		inject('click,200,150,2');
		expect(menu.isOpen).toBe(true);
		expect(menu.effectiveLayer).toBe('popup');
		expect(menu.screenBounds.x).toBe(200);
		expect(menu.screenBounds.y).toBe(150);
		expect(menu.focused).toBe(true);
		expect(menu.focusVisible).toBe(false);
	});

	it('clamps inside the right and bottom edges', () => {
		const { menu } = contextMenu();
		inject('click,790,590,2');
		const box = menu.screenBounds;
		expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width);
		expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height);
	});

	it('selects with a click, closes, fires onClose, and gives focus back', () => {
		const { menu, picked, closes } = contextMenu();
		const field = new Button({ label: 'Field', id: 'field', x: 200, y: 150, width: 100 });
		root.findById('scene')?.addChild(field);
		layout();
		// A secondary press focuses what it lands on (R9.23), and the menu hands focus back to it.
		inject(`click,${centre(field)},2`);
		expect(menu.isOpen).toBe(true);
		expect(menu.focused).toBe(true);
		inject(`click,${rowCentre(menu, 1)}`);
		expect(picked).toEqual(['Repair']);
		expect(menu.isOpen).toBe(false);
		expect(closes).toEqual(['closed']);
		expect(context.focus.focused).toBe(field);
	});

	it('leaves focus where an item moved it: a field to rename into', () => {
		const field = new TextInput({ id: 'rename', x: 500, y: 500, width: 200 });
		const owner = new Button({ label: 'Rig', id: 'rig', x: 200, y: 150, width: 100 });
		const menu = new ContextMenu({ items: [{ label: 'Rename', onSelect: () => context.focus.focus(field, 'programmatic') }] });
		root.addChild(field);
		root.addChild(owner);
		owner.onContextMenu = (event) => menu.openAt(event.screen, { from: owner });
		layout();
		inject(`click,${centre(owner)},2`);
		expect(menu.focused).toBe(true);
		inject(`click,${rowCentre(menu, 0)}`);
		expect(menu.isOpen).toBe(false);
		expect(context.focus.focused).toBe(field);
	});

	it('leaves focus where an item moved it: a modal dialog it opens', () => {
		const owner = new Button({ label: 'Rig', id: 'rig', x: 200, y: 150, width: 100 });
		const confirm = new TextInput({ id: 'confirm_name', width: 200 });
		const dialog = new Dialog({ id: 'scrap_dialog', title: 'Scrap vehicle?', content: confirm, initialFocus: confirm });
		const menu = new ContextMenu({ items: [{ label: 'Scrap', onSelect: () => dialog.show(context) }] });
		root.addChild(owner);
		owner.onContextMenu = (event) => menu.openAt(event.screen, { from: owner });
		layout();
		inject(`click,${centre(owner)},2`);
		press('ArrowDown');
		press('Enter');
		layout();
		expect(menu.isOpen).toBe(false);
		expect(context.focus.focused).toBe(confirm);
		expect(owner.focused).toBe(false);
		dialog.close();
	});

	it('returns focus to the original owner when one context menu replaces another', () => {
		const owner = new Button({ label: 'Rig', id: 'rig', x: 500, y: 500, width: 100 });
		root.addChild(owner);
		layout();
		context.focus.focus(owner);
		const first = new ContextMenu({ id: 'first', items: items('Inspect').items });
		const second = new ContextMenu({ id: 'second', items: items('Repair').items });
		first.openAt({ x: 100, y: 100 }, { from: owner });
		expect(first.focused).toBe(true);
		second.openAt({ x: 300, y: 100 }, { from: owner });
		expect(first.isOpen).toBe(false);
		expect(second.focused).toBe(true);
		press('Escape');
		expect(second.isOpen).toBe(false);
		expect(context.focus.focused).toBe(owner);
	});

	it('does not select a disabled item', () => {
		const picked: string[] = [];
		const { menu } = contextMenu([{ label: 'Locked', enabled: false, onSelect: () => picked.push('Locked') }]);
		inject('click,200,150,2');
		inject(`click,${rowCentre(menu, 2)}`);
		expect(picked).toEqual([]);
		expect(menu.isOpen).toBe(true);
	});

	it('captures the opening press, so its release selects nothing', () => {
		const { items: list, picked } = items('Inspect', 'Repair');
		const menu = new ContextMenu({ items: list });
		const scene = new Container({ id: 'scene', width: VIEWPORT.width, height: VIEWPORT.height, pointerEvents: 'auto' });
		scene.onPointerDown = (event) => {
			if (event.button === 0) menu.openAt(event.screen, { press: event });
		};
		root.addChild(scene);
		layout();
		inject('down,200,150');
		expect(menu.isOpen).toBe(true);
		inject(`move,${rowCentre(menu, 0)}`, `up,${rowCentre(menu, 0)}`);
		expect(picked).toEqual([]);
		expect(menu.isOpen).toBe(true);
	});

	it('hands focus back with its ring after a menu opened by a press is driven from the keys and closed on Escape (DDB-229)', () => {
		const { menu } = contextMenu();
		const field = new Button({ label: 'Field', id: 'field', x: 200, y: 150, width: 100 });
		root.findById('scene')?.addChild(field);
		layout();
		inject(`click,${centre(field)},2`);
		expect(menu.focusVisible).toBe(false);
		press('ArrowDown');
		expect(menu.focusVisible).toBe(true);
		press('Escape');
		expect(menu.isOpen).toBe(false);
		expect(context.focus.focused).toBe(field);
		expect(field.focusVisible).toBe(true);
	});

	it('moves with Up and Down, wrapping and skipping disabled items, selects on Enter, and closes on Escape', () => {
		const { menu, picked, closes } = contextMenu([{ separator: true }, { label: 'Locked', enabled: false }, { label: 'Scrap' }]);
		inject('click,200,150,2');
		press('ArrowDown');
		expect(menu.hoveredIndex).toBe(0);
		press('ArrowUp');
		expect(menu.hoveredIndex).toBe(4);
		press('ArrowDown');
		press('ArrowDown');
		expect(menu.hoveredIndex).toBe(1);
		press('Enter');
		expect(picked).toEqual(['Repair']);
		expect(menu.isOpen).toBe(false);

		inject('click,200,150,2');
		const heard: string[] = [];
		context.dispatcher.hotkeys.register('Escape', () => heard.push('escape'));
		press('Escape');
		expect(menu.isOpen).toBe(false);
		expect(heard).toEqual([]);
		expect(closes).toEqual(['closed', 'closed']);
	});

	it('closes on a primary press outside, which is consumed', () => {
		const { menu, closes } = contextMenu();
		const clicks: number[] = [];
		root.addChild(new Button({ label: 'Go', x: 500, y: 500, width: 100, onClick: () => clicks.push(1) }));
		layout();
		inject('click,200,150,2');
		inject('click,550,517');
		expect(menu.isOpen).toBe(false);
		expect(clicks).toEqual([]);
		expect(closes).toEqual(['outside-press']);
	});

	it('reopens at a secondary press outside, which is not consumed', () => {
		const { menu, closes } = contextMenu();
		inject('click,200,150,2');
		inject('click,400,300,2');
		expect(menu.isOpen).toBe(true);
		expect(menu.screenBounds.x).toBe(400);
		expect(menu.screenBounds.y).toBe(300);
		expect(closes).toEqual(['outside-press']);
	});
});
