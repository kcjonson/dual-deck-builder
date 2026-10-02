/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { Container } from '../../../engine/components/Container';
import type { MountContext } from '../../../engine/components/MountContext';
import { Text } from '../../../engine/components/Text';
import { createTestContext, injectNow } from '../../../engine/components/testing';
import { Button } from '../../../engine/ui/Button';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { PointerAdapter } from '../../../engine/input/PointerAdapter';
import { CombatLog } from '../../mechanics/CombatLog';
import { CombatLogLayer, LogLine } from './CombatLogLayer';

/**
 * DDB-32 and DDB-140: the log drawer scrolls, follows the newest entry,
 * keeps the lines it already has, wraps long lines under one turn tag, and
 * takes focus while open so the keyboard scrolls it.
 */

const LONG_LINE = 'Scrapyard Juggernaut rammed Apocalypse Rig for 24, 18 blocked by Armor, 3 to Structure, and 3 to The Road Warrior';

let context: MountContext;
let root: Container;
let adapter: PointerAdapter;
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

beforeEach(() => {
	context = createTestContext({ draw: createMeasuringDrawApi().api, clock: new Clock() });
	adapter = new PointerAdapter({ dispatcher: context.dispatcher });
	adapter.attach(canvas);
	root = new Container({ width: 800, height: 600 });
	root.mount(context);
});

afterEach(() => {
	root.unmount();
	adapter.detach();
});

/** A drawer, open unless `open` is false; it starts closed. */
function mounted({ maxEntries = 30, open = true }: { maxEntries?: number; open?: boolean } = {}): { log: CombatLog; layer: CombatLogLayer } {
	const log = new CombatLog({ maxEntries });
	const layer = new CombatLogLayer({ x: 0, y: 0, width: 320, height: 200, combatLog: log });
	root.addChild(layer);
	if (open) layer.openDrawer();
	context.frame.layout();
	return { log, layer };
}

function lines(layer: CombatLogLayer): LogLine[] {
	return (layer.scrollContainer.content?.children ?? []) as LogLine[];
}

function add(log: CombatLog, message: string, turn?: number): void {
	log.addEntry({ message, turn });
}

function press(...keys: string[]): void {
	const commands = keys.flatMap(key => [`keydown,${key}`, `keyup,${key}`]);
	expect(injectNow({ canvas, dispatcher: context.dispatcher }, commands).ok).toBe(true);
	context.frame.layout();
}

describe('CombatLogLayer', () => {
	it('shows one line per entry and scrolls to the newest once they overflow', () => {
		const { log, layer } = mounted();
		for (let index = 0; index < 20; index++) add(log, `Event ${index}`);
		context.frame.layout();
		const scroll = layer.scrollContainer;
		expect(lines(layer).map((line) => line.text)).toEqual(Array.from({ length: 20 }, (_unused, index) => `Event ${index}`));
		expect(scroll.overflows).toBe(true);
		expect(scroll.scrollPosition).toBe(scroll.maxScroll);
	});

	it('leaves a reader who scrolled up where they are, and follows again once they are back at the bottom', () => {
		const { log, layer } = mounted();
		for (let index = 0; index < 30; index++) add(log, `Event ${index}`);
		context.frame.layout();
		const scroll = layer.scrollContainer;
		scroll.scrollTo(0);
		add(log, 'new while reading');
		context.frame.layout();
		expect(scroll.scrollPosition).toBe(0);
		scroll.scrollToBottom();
		context.frame.layout();
		add(log, 'newest');
		context.frame.layout();
		expect(scroll.scrollPosition).toBe(scroll.maxScroll);
		expect(scroll.atBottom).toBe(true);
	});

	it('keeps the lines it has when an entry is added, and drops the ones the log let go', () => {
		const { log, layer } = mounted({ maxEntries: 3 });
		add(log, 'one');
		add(log, 'two');
		const [, second] = lines(layer);
		add(log, 'three');
		add(log, 'four');
		expect(lines(layer).map((line) => line.text)).toEqual(['two', 'three', 'four']);
		expect(lines(layer)[0]).toBe(second);
	});

	it('wraps a long line inside the drawer under its one prefix, the turn', () => {
		const { log, layer } = mounted();
		add(log, 'Short', 3);
		add(log, LONG_LINE, 3);
		context.frame.layout();
		const [short, long] = lines(layer);
		const [tag, message] = long.children as Text[];
		expect(tag.text).toBe('T3');
		expect(message.text).toBe(LONG_LINE);
		expect(message.wrap).toBe('word');
		expect(long.height).toBeGreaterThan(short.height * 2);
		// Inside the scroll container's viewport, never past the drawer's edge
		expect(long.width).toBeLessThanOrEqual(layer.scrollContainer.width);
		expect(message.x + message.width).toBeLessThanOrEqual(long.width);
	});

	it('takes focus when opened, scrolls from the keyboard, and gives focus back when Escape closes it', () => {
		const { log, layer } = mounted({ open: false });
		expect(layer.isOpen).toBe(false);
		const before = new Button({ label: 'Before', x: 400, y: 0, width: 80 });
		root.addChild(before);
		for (let index = 0; index < 30; index++) add(log, `Event ${index}`);
		context.frame.layout();
		context.focus.focus(before);

		layer.openDrawer();
		context.frame.layout();
		const scroll = layer.scrollContainer;
		expect(layer.isOpen).toBe(true);
		expect(context.focus.focused).toBe(scroll);
		expect(scroll.scrollPosition).toBe(scroll.maxScroll);

		press('Home');
		expect(scroll.scrollPosition).toBe(0);
		press('PageDown');
		expect(scroll.scrollPosition).toBeGreaterThan(0);
		press('End');
		expect(scroll.scrollPosition).toBe(scroll.maxScroll);

		press('Escape');
		expect(layer.isOpen).toBe(false);
		expect(layer.visible).toBe(false);
		expect(context.focus.focused).toBe(before);
	});

	it('leaves focus alone on close when it had already moved out of the drawer', () => {
		const { layer } = mounted({ open: false });
		const elsewhere = new Button({ label: 'Elsewhere', x: 400, y: 0, width: 80 });
		root.addChild(elsewhere);
		context.frame.layout();
		layer.toggle();
		context.focus.focus(elsewhere);
		layer.toggle();
		expect(layer.isOpen).toBe(false);
		expect(context.focus.focused).toBe(elsewhere);
	});

	it('keeps a reader who scrolled up on the same line when the full log drops one off the top', () => {
		const { log, layer } = mounted({ maxEntries: 30 });
		for (let index = 0; index < 30; index++) add(log, `Event ${index}`);
		context.frame.layout();
		const scroll = layer.scrollContainer;
		scroll.scrollTo(200);
		context.frame.layout();
		const reading = lines(layer).find((line) => line.y + line.height > scroll.scrollPosition);
		const offsetInLine = scroll.scrollPosition - (reading?.y ?? 0);
		add(log, 'newest');
		context.frame.layout();
		expect(lines(layer)[0].text).toBe('Event 1');
		expect(reading?.isMounted).toBe(true);
		expect(scroll.scrollPosition - (reading?.y ?? 0)).toBeCloseTo(offsetInLine, 5);
	});

	it('leaves no focus on the hidden drawer when there was none to give back', () => {
		const { layer } = mounted({ open: false });
		expect(context.focus.focused).toBeNull();
		layer.openDrawer();
		expect(context.focus.focused).toBe(layer.scrollContainer);
		layer.closeDrawer();
		expect(context.focus.focused).toBeNull();
	});

	it('asks for a new place when the focus it would restore has gone', () => {
		const log = new CombatLog();
		const onFocusLost = jest.fn();
		const layer = new CombatLogLayer({ width: 320, height: 200, combatLog: log, onFocusLost });
		root.addChild(layer);
		const gone = new Button({ label: 'Gone', x: 400, y: 0, width: 80 });
		root.addChild(gone);
		context.frame.layout();
		context.focus.focus(gone);
		layer.openDrawer();
		root.removeChild(gone);
		layer.closeDrawer();
		expect(onFocusLost).toHaveBeenCalledTimes(1);
	});
});
