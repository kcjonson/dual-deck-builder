import { Clock } from '../animation/Clock';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { renderTree } from '../components/renderTree';
import { Stack } from '../components/Stack';
import { createTestContext } from '../components/testing';
import type { CircleCommand, RectCommand, TextCommand } from '../draw';
import { advance } from '../services/testing';
import { MeasuringRecordingBackend, createMeasuringDrawApi } from '../text/testing';
import { tokens } from '../theme/tokens';
import { Avatar, fnv1a, initialsOf, moodColor } from './Avatar';
import { BADGE_HEIGHT, Badge } from './Badge';
import { Counter } from './Counter';
import { Divider } from './Divider';
import { ProgressBar } from './ProgressBar';
import { Stat } from './Stat';

/**
 * R12.24 to R12.29 and R12.39: sizes from the committed font metrics, the
 * draws from a recording backend, and animation on the frame clock.
 */

const { color } = tokens;

let context: MountContext;
let backend: MeasuringRecordingBackend;
let root: Container;

beforeEach(() => {
	const measuring = createMeasuringDrawApi();
	backend = measuring.backend;
	context = createTestContext({ draw: measuring.api, viewport: { logical: { width: 800, height: 600 } }, clock: new Clock() });
	root = new Container({ id: 'root', width: 800, height: 600 });
	root.mount(context);
});

function draws(): readonly (RectCommand | CircleCommand | TextCommand)[] {
	const api = context.draw;
	api.beginFrame({ viewport: { width: 800, height: 600 } });
	renderTree(root, api);
	api.endFrame();
	return backend.commands as readonly (RectCommand | CircleCommand | TextCommand)[];
}

function mount<T extends Container | import('../components/Component').Component>(component: T): T {
	root.addChild(component);
	context.frame.layout();
	return component;
}

describe('ProgressBar (R12.24)', () => {
	it('fills its track to the value, banding the tone when auto', () => {
		const bar = mount(new ProgressBar({ id: 'hp', value: 0.2, width: 200 }));
		expect(bar.fillColor).toEqual(color.status_crit);
		bar.value = 0.4;
		expect(bar.fillColor).toEqual(color.status_warn);
		bar.value = 0.9;
		expect(bar.fillColor).toEqual(color.status_ok);
		bar.tone = 'data';
		expect(bar.fillColor).toEqual(color.data);
	});

	it('animates the fill over dur_slow, and shows a value set while unmounted at once', () => {
		const loose = new ProgressBar({ value: 0.2 });
		loose.value = 0.8;
		expect(loose.displayedValue).toBe(0.8);

		const bar = mount(new ProgressBar({ value: 0.2 }));
		bar.value = 0.8;
		expect(bar.value).toBe(0.8);
		advance(context, tokens.motion.dur_slow / 2);
		expect(bar.displayedValue).toBeGreaterThan(0.2);
		expect(bar.displayedValue).toBeLessThan(0.8);
		advance(context, tokens.motion.dur_slow);
		expect(bar.displayedValue).toBe(0.8);
	});

	it('shows the target after being unmounted mid-fill and mounted again', () => {
		const bar = mount(new ProgressBar({ value: 0 }));
		bar.value = 1;
		advance(context, tokens.motion.dur_slow / 2);
		root.removeChild(bar);
		mount(bar);
		advance(context, tokens.motion.dur_slow * 4);
		expect(bar.displayedValue).toBe(1);
	});

	it('gains a value line when given one after construction', () => {
		const bar = mount(new ProgressBar({ value: 0.25 }));
		const bare = bar.height;
		bar.valueText = (value) => `${Math.round(value * 8)} / 8`;
		context.frame.layout();
		expect(bar.height).toBeGreaterThan(bare);
		expect(bar.children.map((child) => (child as unknown as { text: string }).text)).toEqual(['2 / 8']);
		bar.valueText = null;
		context.frame.layout();
		expect(bar.height).toBe(bare);
	});

	it('clamps the value to 0..1', () => {
		const bar = mount(new ProgressBar({ value: 3 }));
		expect(bar.value).toBe(1);
		bar.value = -1;
		expect(bar.value).toBe(0);
	});

	it('puts the label and value line above the track, and grows to hold it', () => {
		const plain = mount(new ProgressBar({ size: 'md' }));
		expect(plain.height).toBe(8);
		const labelled = mount(new ProgressBar({ label: 'Hull', valueText: (value) => `${Math.round(value * 12)} / 12`, value: 0.5 }));
		expect(labelled.height).toBeGreaterThan(8 + tokens.fontSize.fs_sm);
		const texts = labelled.children.map((child) => (child as unknown as { text: string }).text);
		expect(texts).toEqual(['Hull', '6 / 12']);
	});

	it('draws the texts inside a taller track with a shadow when inline', () => {
		const bar = mount(new ProgressBar({ id: 'fuel', label: 'Fuel', valueText: '4', inline: true, size: 'md', value: 0.5 }));
		expect(bar.height).toBe(22);
		const texts = draws().filter((command): command is TextCommand => command.kind === 'text');
		expect(texts.length).toBeGreaterThan(0);
		expect(bar.children.every((child) => (child as unknown as { shadow: unknown }).shadow !== null)).toBe(true);
	});

	it('cuts a segmented track into cells, filling them in turn', () => {
		mount(new ProgressBar({ id: 'pips', segmented: 4, value: 0.5, width: 100, tone: 'accent' }));
		const rects = draws().filter((command): command is RectCommand => command.kind === 'rect');
		const filled = rects.filter((rect) => rect.fill?.[0] === color.accent[0] && rect.fill?.[1] === color.accent[1]);
		expect(rects.length).toBe(4 + 2);
		expect(filled).toHaveLength(2);
	});
});

describe('Counter (R12.39)', () => {
	it('counts toward a new value over dur_slow, formatting every step', () => {
		const counter = mount(new Counter({ value: 10, format: (value) => `${Math.round(value)} HP` }));
		expect(counter.text).toBe('10 HP');
		counter.value = 20;
		advance(context, tokens.motion.dur_slow / 2);
		const middle = counter.displayedValue;
		expect(middle).toBeGreaterThan(10);
		expect(middle).toBeLessThan(20);
		expect(counter.text).toBe(`${Math.round(middle)} HP`);
		advance(context, tokens.motion.dur_slow);
		expect(counter.text).toBe('20 HP');
	});

	it('heads for a value changed mid-count from where it is', () => {
		const counter = mount(new Counter({ value: 0 }));
		counter.value = 100;
		advance(context, tokens.motion.dur_slow / 2);
		const reached = counter.displayedValue;
		counter.value = 50;
		advance(context, 16);
		expect(Math.abs(counter.displayedValue - reached)).toBeLessThan(50);
		advance(context, tokens.motion.dur_slow * 2);
		expect(counter.text).toBe('50');
	});

	it('shows the target after being unmounted mid-count and mounted again', () => {
		const counter = mount(new Counter({ value: 0 }));
		counter.value = 100;
		advance(context, tokens.motion.dur_slow / 2);
		root.removeChild(counter);
		mount(counter);
		advance(context, tokens.motion.dur_slow * 4);
		expect(counter.text).toBe('100');
	});

	it('jumps when unmounted or under reduced motion', () => {
		const loose = new Counter({ value: 1 });
		loose.value = 9;
		expect(loose.text).toBe('9');
		context.animator.reducedMotion = true;
		const counter = mount(new Counter({ value: 1 }));
		counter.value = 9;
		advance(context, 16);
		expect(counter.text).toBe('9');
	});
});

describe('Badge (R12.26)', () => {
	it('is a pill sized from its measured label, exposing that width', () => {
		const short = mount(new Badge({ label: 'New' }));
		const long = mount(new Badge({ label: 'Overheated' }));
		expect(short.height).toBe(BADGE_HEIGHT);
		expect(long.width).toBeGreaterThan(short.width);
		expect(long.measureWidth()).toBe(long.width);
	});

	it('fills with its tone or outlines in it', () => {
		const filled = mount(new Badge({ label: 'Crit', tone: 'crit' }));
		const outlined = mount(new Badge({ label: 'Crit', tone: 'crit', outline: true }));
		expect(filled.resolvedColors.fill).toEqual(color.status_crit);
		expect(outlined.resolvedColors.fill?.[3]).toBe(0);
		expect(outlined.resolvedColors.border).toEqual(color.status_crit);
	});

	it('makes room for a dot, and is a round dot alone without a label', () => {
		const plain = mount(new Badge({ label: 'Live' }));
		const dotted = mount(new Badge({ label: 'Live', dot: true }));
		const alone = mount(new Badge({ label: '', dot: true, tone: 'ok' }));
		expect(dotted.width).toBeGreaterThan(plain.width);
		expect(alone.width).toBe(alone.height);
		expect(draws().some((command) => command.kind === 'circle')).toBe(true);
	});

	it('refuses the auto tone', () => {
		expect(() => new Badge({ label: 'x', tone: 'auto' })).toThrow(/auto/);
	});
});

describe('Avatar (R12.27)', () => {
	it('hashes the seed with 32-bit FNV-1a', () => {
		expect(fnv1a('')).toBe(0x811c9dc5);
		expect(fnv1a('a')).toBe(0xe40c292c);
		expect(fnv1a('foobar')).toBe(0xbf9cf968);
	});

	it('is deterministic per seed and takes initials from the first two words', () => {
		const one = new Avatar({ seed: 'Rook Valdez' });
		const two = new Avatar({ seed: 'Rook Valdez' });
		const other = new Avatar({ seed: 'Mara Quill' });
		expect(one.discColor).toEqual(two.discColor);
		expect(one.discColor).not.toEqual(other.discColor);
		expect(one.initialsText).toBe('RV');
		expect(initialsOf('  scrap   king of the wastes ')).toBe('SK');
		expect(initialsOf('Solo')).toBe('S');
	});

	it('bands the mood ring at 0.30 and 0.55', () => {
		expect(moodColor(0.29)).toEqual(color.status_crit);
		expect(moodColor(0.3)).toEqual(color.status_warn);
		expect(moodColor(0.54)).toEqual(color.status_warn);
		expect(moodColor(0.55)).toEqual(color.status_ok);
	});

	it('draws its rings outside the disc, as ink rather than size', () => {
		const avatar = mount(new Avatar({ id: 'rook', seed: 'Rook', size: 40, mood: 0.2, selected: true }));
		expect(avatar.width).toBe(40);
		expect(avatar.inkExtent).toBeGreaterThan(0);
		expect(avatar.selected).toBe(true);
		const circles = draws().filter((command): command is CircleCommand => command.kind === 'circle');
		expect(circles.map((circle) => circle.radius).sort((a, b) => a - b)).toEqual([20, 23, 26]);
	});
});

describe('Stat (R12.28)', () => {
	it('puts the label above the value and the unit on the value\'s baseline at 0.62 of its size', () => {
		const stat = mount(new Stat({ label: 'Speed', value: 88, unit: 'km/h', size: 'lg' }));
		const [label, value, unit] = stat.children as unknown as import('../components/Text').Text[];
		expect(value.y).toBeGreaterThanOrEqual(label.height);
		expect(unit.fontSize).toBe(Math.round(tokens.fontSize.fs_3xl * 0.62));
		expect(unit.x).toBeGreaterThan(value.x + value.width);
		const valueBaseline = value.y + (value.measured?.baseline ?? 0);
		const unitBaseline = unit.y + (unit.measured?.baseline ?? 0);
		expect(unitBaseline).toBeCloseTo(valueBaseline, 5);
		expect(stat.width).toBeGreaterThanOrEqual(unit.x + unit.width - 0.5);
	});

	it('colours the value by tone, banding auto', () => {
		expect(mount(new Stat({ label: 'Hull', value: 0.2, tone: 'auto' })).resolvedColors.text).toEqual(color.status_crit);
		expect(mount(new Stat({ label: 'Hull', value: 3 })).resolvedColors.text).toEqual(color.text_bright);
	});

	it('aligns its lines across a wider box', () => {
		const stat = mount(new Stat({ label: 'Scrap', value: 12, align: 'right', width: 200 }));
		const [label, value] = stat.children;
		expect(label.x + label.width).toBeCloseTo(200, 0);
		expect(value.x + value.width).toBeCloseTo(200, 0);
	});
});

describe('Divider (R12.29)', () => {
	it('fills a column\'s width as a hairline', () => {
		const column = new Stack({ width: 300, direction: 'vertical', crossAlign: 'start' });
		const divider = new Divider();
		column.addChild(divider);
		mount(column);
		expect(divider.width).toBe(300);
		expect(divider.height).toBe(1);
	});

	it('breaks around a centred caption', () => {
		const divider = mount(new Divider({ id: 'rule', caption: 'Escorts', width: 300 }));
		const caption = divider.children[0];
		expect(caption.x + caption.width / 2).toBeCloseTo(150, 0);
		expect(divider.height).toBe(caption.height);
		const rules = draws().filter((command): command is RectCommand => command.kind === 'rect');
		expect(rules).toHaveLength(2);
		expect(rules[0].rect.x + rules[0].rect.width).toBeLessThan(caption.x);
	});

	it('stands up the height it is given when vertical, and refuses a caption there', () => {
		const divider = mount(new Divider({ orientation: 'vertical', height: 40 }));
		expect({ width: divider.width, height: divider.height }).toEqual({ width: 1, height: 40 });
		expect(() => new Divider({ orientation: 'vertical', caption: 'x' })).toThrow();
	});
});
