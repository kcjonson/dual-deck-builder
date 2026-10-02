/**
 * @jest-environment jsdom
 */
import { DrawApi, RectCommand, TextCommand } from '../../engine/draw';
import { ICON_ATLAS_ROLE } from '../../engine/text/fontFaces';
import { ICON_CODE_POINTS } from '../../engine/text/icons';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../../engine/text/testing';
import type { Component } from '../../engine/components/Component';
import type { MountContext } from '../../engine/components/MountContext';
import { renderTree } from '../../engine/components/renderTree';
import { createTestContext } from '../../engine/components/testing';
import { ArmorBadge } from './ArmorBadge';
import { EnemyIntent, IntentMarker, IntentRow } from './IntentMarker';

let backend: MeasuringRecordingBackend;
let api: DrawApi;
let context: MountContext;

beforeEach(() => {
	({ api, backend } = createMeasuringDrawApi());
	context = createTestContext({ draw: api });
});

/** Lays out whatever changed, then walks one frame of each root, the way the page does. */
function frame(...roots: Component[]): void {
	for (const root of roots) root.mount(context);
	context.frame.layout();
	api.beginFrame({ viewport: { width: 400, height: 200 } });
	for (const root of roots) renderTree(root, api);
	api.endFrame();
}

/** A command's box in screen space: its local box through the walk's translation. */
function screenBox(command: TextCommand): { x: number; y: number; width: number; height: number } {
	const box = command.box ?? { x: NaN, y: NaN, width: NaN, height: NaN };
	return { x: box.x + command.transform[4], y: box.y + command.transform[5], width: box.width, height: box.height };
}

function texts(): TextCommand[] {
	return backend.commands.filter((command): command is TextCommand => command.kind === 'text');
}

describe('ArmorBadge', () => {
	function badge(armor: number, shield: number): ArmorBadge {
		const result = new ArmorBadge({ x: 10, y: 20, minWidth: 35, height: 16 });
		result.armor = armor;
		result.shield = shield;
		return result;
	}

	it('keeps its minimum width when the value fits, and reads "SH" only with shield', () => {
		const plain = badge(5, 0);
		frame(plain);
		expect(plain.text).toBe('5');
		expect(plain.width).toBe(35);
		expect(badge(5, 3).text).toBe('5 SH3');
	});

	it.each([[5, 3], [30, 8], [10, 12]])('grows to fit %i SH%i: the value sits between the icon and the right edge', (armor, shield) => {
		const subject = badge(armor, shield);
		frame(subject);

		const [icon, value] = texts();
		expect(icon.font).toBe(ICON_ATLAS_ROLE);
		expect(icon.text).toBe(String.fromCodePoint(ICON_CODE_POINTS.shield));
		const labelWidth = api.measureText({ text: subject.text, font: 'body', size: 8 }).width;
		const valueBox = screenBox(value);
		const iconBox = screenBox(icon);
		const iconRight = iconBox.x + iconBox.width;
		// The value's box starts past the icon and ends inside the badge, and the label fits it.
		expect(valueBox.x).toBeGreaterThanOrEqual(iconRight);
		expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(10 + subject.width);
		expect(valueBox.width).toBeGreaterThanOrEqual(labelWidth);

		const [rect] = backend.commands.filter((command): command is RectCommand => command.kind === 'rect');
		expect(rect.rect.width).toBe(subject.width);
	});

	it('measures once per value, not per frame', () => {
		const subject = badge(10, 12);
		frame(subject);
		frame(subject);
		expect(backend.measureCalls).toBe(1);
		subject.shield = 0;
		frame(subject);
		expect(backend.measureCalls).toBe(2);
		expect(subject.width).toBe(35);
	});

	it('greys out with neither armor nor shield', () => {
		const active = badge(0, 2);
		const empty = badge(0, 0);
		frame(active, empty);
		const [activeRect, emptyRect] = backend.commands.filter((command): command is RectCommand => command.kind === 'rect');
		expect(activeRect.fill).not.toEqual(emptyRect.fill);
	});
});

describe('IntentMarker', () => {
	it.each([['defend', 'shield'], ['repair', 'build']] as const)('draws %s as the %s icon, centred', (type, glyph) => {
		const marker = new IntentMarker({ x: 0, y: 0, size: 30 });
		marker.intent = { type, value: 4, description: type };
		frame(marker);
		const [icon] = texts();
		expect(icon.font).toBe(ICON_ATLAS_ROLE);
		expect(icon.text).toBe(String.fromCodePoint(ICON_CODE_POINTS[glyph]));
		expect(icon.box).toEqual({ x: 6, y: 6, width: 18, height: 18 });
	});

	it('draws an attack\'s value and a special\'s "!" centred in the disc', () => {
		const marker = new IntentMarker({ x: 0, y: 0, size: 30 });
		marker.intent = { type: 'attack', value: 15, description: 'attack' };
		frame(marker);
		expect(texts()[0]).toMatchObject({ text: '15', font: 'display', box: { x: 0, y: 0, width: 30, height: 30 }, align: 'center', verticalAlign: 'middle' });

		marker.intent = { type: 'special', description: 'special' };
		frame(marker);
		expect(texts()[0].text).toBe('!');
	});

	it('is hidden without an intent', () => {
		const marker = new IntentMarker({ x: 0, y: 0, size: 30 });
		expect(marker.visible).toBe(false);
		marker.intent = { type: 'defend', description: 'defend' };
		expect(marker.visible).toBe(true);
		marker.intent = null;
		frame(marker);
		expect(backend.commands).toEqual([]);
	});
});

describe('IntentRow', () => {
	const attack = (value: number): EnemyIntent => ({ type: 'attack', value, description: 'Ram', detail: `${value} damage on the Rig` });
	const markers = (row: IntentRow): IntentMarker[] => row.children.filter((child): child is IntentMarker => child instanceof IntentMarker);
	const settle = async (): Promise<void> => {
		context.animator.settle();
		await Promise.resolve();
		await Promise.resolve();
	};

	it('shows two intents, then "+N" for the rest, each with its line as a tooltip', () => {
		const row = new IntentRow({ id: 'row', markerSize: 30 });
		row.intents = [attack(8), { type: 'defend', value: 6, description: 'Brace' }, attack(4), { type: 'debuff', description: 'Jam' }];
		frame(row);
		const shown = markers(row);
		expect(shown.map(marker => marker.label)).toEqual(['8', null, '+2']);
		expect(shown[0].tooltip).toEqual({ title: 'Ram', description: '8 damage on the Rig' });
		expect(shown[2].tooltip).toBeNull();
	});

	it('grows a changed plan\'s new markers in and shrinks the old ones out, and leaves a plan that holds alone', async () => {
		const row = new IntentRow({ id: 'row', markerSize: 30 });
		row.mount(context);
		row.intents = [attack(8)];
		const [first] = markers(row);
		expect(first.transform.scale).toBe(0.4);
		await settle();
		expect(first.transform.scale).toBe(1);

		row.intents = [attack(8)];
		expect(markers(row)).toEqual([first]);

		row.intents = [attack(12)];
		// An exit is drawn after the rest, so the new marker comes first
		const [replacement, leaving] = markers(row);
		expect(leaving).toBe(first);
		expect(first['exiting']).toBe(true);
		expect(replacement.label).toBe('12');
		await settle();
		expect(markers(row)).toEqual([replacement]);
		expect(first.isMounted).toBe(false);
	});

	it('neither grows nor shrinks under reduced motion', async () => {
		context.animator.reducedMotion = true;
		const row = new IntentRow({ id: 'row', markerSize: 30 });
		row.mount(context);
		row.intents = [attack(8)];
		const [first] = markers(row);
		expect(first.transform.scale).toBe(1);
		row.intents = [attack(12)];
		await Promise.resolve();
		expect(markers(row).map(marker => marker.label)).toEqual(['12']);
	});
});
