/**
 * @jest-environment jsdom
 */
import { DrawApi, PolygonCommand, RectCommand, TextCommand } from '../../engine/draw';
import { ICON_ATLAS_ROLE } from '../../engine/text/fontFaces';
import { ICON_CODE_POINTS } from '../../engine/text/icons';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../../engine/text/testing';
import type { Component } from '../../engine/components/Component';
import type { MountContext } from '../../engine/components/MountContext';
import { renderTree } from '../../engine/components/renderTree';
import { createTestContext } from '../../engine/components/testing';
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

function texts(): TextCommand[] {
	return backend.commands.filter((command): command is TextCommand => command.kind === 'text');
}

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

	it.each([['driver1', 1], ['driver2', 1], ['both', 2]] as const)('marks whom it lands on (%s) in the lower right, inside the disc', (target, polygons) => {
		const marker = new IntentMarker({ x: 0, y: 0, size: 24 });
		marker.intent = { type: 'attack', value: 8, description: 'Ram', target };
		frame(marker);
		const drawn = backend.commands.filter((command): command is PolygonCommand => command.kind === 'polygon');
		expect(drawn).toHaveLength(polygons);
		for (const polygon of drawn) {
			for (const point of polygon.points) {
				expect(point.x).toBeGreaterThanOrEqual(24 - 9 * polygons);
				expect(point.x).toBeLessThanOrEqual(24);
				expect(point.y).toBeGreaterThanOrEqual(24 - 9);
			}
		}
	});

	it('marks an escort target with a square', () => {
		const marker = new IntentMarker({ x: 0, y: 0, size: 24 });
		marker.intent = { type: 'attack', value: 5, description: 'Sideswipe', target: 'escort' };
		frame(marker);
		const rects = backend.commands.filter((command): command is RectCommand => command.kind === 'rect');
		// The disc, the mark's backing, and the square
		expect(rects).toHaveLength(3);
		expect(backend.commands.some((command) => command.kind === 'polygon')).toBe(false);
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
