/**
 * @jest-environment jsdom
 */
import { DrawApi, RectCommand, TextCommand } from '../../engine/draw';
import { ICON_ATLAS_ROLE } from '../../engine/text/fontFaces';
import { ICON_CODE_POINTS } from '../../engine/text/icons';
import { installMeasuringDrawApi, MeasuringRecordingBackend } from '../../engine/text/testing';
import { ArmorBadge } from './ArmorBadge';
import { IntentMarker } from './IntentMarker';
import type { Component } from '../../engine/components/Component';
import { renderTree } from '../../engine/components/renderTree';

let backend: MeasuringRecordingBackend;
let api: DrawApi;

beforeEach(() => {
	({ api, backend } = installMeasuringDrawApi());
});

/** Walks one frame of each root, the way the page does. */
function frame(...roots: Component[]): void {
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
		expect(plain.getWidth()).toBe(35);
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
		expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(10 + subject.getWidth());
		expect(valueBox.width).toBeGreaterThanOrEqual(labelWidth);

		const [rect] = backend.commands.filter((command): command is RectCommand => command.kind === 'rect');
		expect(rect.rect.width).toBe(subject.getWidth());
	});

	it('measures once per value, not per frame', () => {
		const subject = badge(10, 12);
		frame(subject);
		frame(subject);
		expect(backend.measureCalls).toBe(1);
		subject.shield = 0;
		frame(subject);
		expect(backend.measureCalls).toBe(2);
		expect(subject.getWidth()).toBe(35);
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
		expect(marker.isVisible()).toBe(false);
		marker.intent = { type: 'defend', description: 'defend' };
		expect(marker.isVisible()).toBe(true);
		marker.intent = null;
		frame(marker);
		expect(backend.commands).toEqual([]);
	});
});
