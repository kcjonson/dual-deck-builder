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
import { EnemyIntent, IntentPill, IntentRow } from './IntentPill';
import { resolveColor } from '../../engine/style/styleObject';

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

describe('IntentPill', () => {
	const pill = (intent: EnemyIntent): IntentPill => {
		const shown = new IntentPill({ x: 0, y: 0 });
		shown.intent = intent;
		frame(shown);
		return shown;
	};
	const rects = (): RectCommand[] => backend.commands.filter((command): command is RectCommand => command.kind === 'rect');

	it.each([['attack', 'gps_fixed'], ['defend', 'shield'], ['repair', 'build'], ['debuff', 'expand_more'], ['buff', 'expand_less']] as const)('leads %s with the %s icon', (type, glyph) => {
		pill({ type, value: 4, description: type });
		const [icon] = texts();
		expect(icon.font).toBe(ICON_ATLAS_ROLE);
		expect(icon.text).toBe(String.fromCodePoint(ICON_CODE_POINTS[glyph]));
		expect(icon.box).toEqual({ x: 6, y: 0, width: 16, height: 24 });
	});

	it('prints an attack\'s value, a multi-hit as "6x3", and "?" for a value the tier hides', () => {
		expect(pill({ type: 'attack', value: 8, description: 'Ram' }).label).toBe('8');
		expect(texts()[1]).toMatchObject({ text: '8', font: 'display', size: 15 });
		expect(pill({ type: 'attack', value: 6, hits: 3, valueText: '6x3', description: 'Burst' }).label).toBe('6x3');
		expect(pill({ type: 'attack', valueText: '?', description: '???' }).label).toBe('?');
		expect(pill({ type: 'debuff', description: 'Oil' }).label).toBeNull();
	});

	it('takes the heavy tier\'s colour at 12 and up, every hit counted, and not for a hidden value', () => {
		expect(pill({ type: 'attack', value: 11, description: 'Ram' }).heavy).toBe(false);
		expect(pill({ type: 'attack', value: 12, description: 'Ram' }).heavy).toBe(true);
		expect(rects()[0].fill).toEqual(resolveColor('#3a120d'));
		expect(pill({ type: 'attack', value: 6, hits: 3, valueText: '6x3', description: 'Burst' }).heavy).toBe(true);
		expect(pill({ type: 'attack', valueText: '?', description: '???' }).heavy).toBe(false);
		expect(pill({ type: 'defend', value: 20, description: 'Brace' }).heavy).toBe(false);
	});

	it.each([['driver1', 1], ['driver2', 1], ['both', 2]] as const)('marks whom it lands on (%s) at its right end, inside the pill', (target, polygons) => {
		const shown = pill({ type: 'attack', value: 8, description: 'Ram', target });
		const drawn = backend.commands.filter((command): command is PolygonCommand => command.kind === 'polygon');
		expect(drawn).toHaveLength(polygons);
		for (const polygon of drawn) {
			for (const point of polygon.points) {
				expect(point.x).toBeLessThanOrEqual(shown.width - 7);
				expect(point.y).toBeGreaterThanOrEqual(6);
				expect(point.y).toBeLessThanOrEqual(18);
			}
		}
	});

	it('marks an escort target with a square', () => {
		pill({ type: 'attack', value: 5, description: 'Sideswipe', target: 'escort' });
		// The pill and the square
		expect(rects()).toHaveLength(2);
		expect(backend.commands.some((command) => command.kind === 'polygon')).toBe(false);
	});

	it('is as wide as what it shows, 24 tall', () => {
		const plain = pill({ type: 'attack', value: 8, description: 'Ram' });
		const marked = pill({ type: 'attack', value: 8, description: 'Ram', target: 'both' });
		const multi = pill({ type: 'attack', value: 6, hits: 3, valueText: '6x3', description: 'Burst', target: 'both' });
		expect(plain.height).toBe(24);
		expect(marked.width - plain.width).toBe(4 + 24);
		expect(multi.width).toBeGreaterThan(marked.width);
		expect(rects()[0].rect).toEqual({ x: 0, y: 0, width: multi.width, height: 24 });
	});

	it('is hidden without an intent', () => {
		const shown = new IntentPill({ x: 0, y: 0 });
		expect(shown.visible).toBe(false);
		shown.intent = { type: 'defend', description: 'defend' };
		expect(shown.visible).toBe(true);
		shown.intent = null;
		frame(shown);
		expect(backend.commands).toEqual([]);
	});
});

describe('IntentRow', () => {
	const attack = (value: number): EnemyIntent => ({ type: 'attack', value, description: 'Ram', detail: `${value} damage on the Rig` });
	const pills = (row: IntentRow): IntentPill[] => row.children.filter((child): child is IntentPill => child instanceof IntentPill);
	const settle = async (): Promise<void> => {
		context.animator.settle();
		await Promise.resolve();
		await Promise.resolve();
	};

	it('shows two intents, then "+N" for the rest, each with its line as a tooltip', () => {
		const row = new IntentRow({ id: 'row', width: 196, height: 24 });
		const plan: EnemyIntent[] = [attack(8), { type: 'defend', value: 6, description: 'Brace' }, attack(4), { type: 'debuff', description: 'Jam', detail: 'Jam on the Rig' }];
		row.intents = plan;
		frame(row);
		const shown = pills(row);
		expect(shown.map((pill) => pill.label)).toEqual(['8', '6', '+2']);
		expect(shown[0].tooltip).toEqual({ title: 'Ram', description: '8 damage on the Rig' });
		expect(shown[2].represents).toEqual(plan.slice(2));
		expect(shown[2].tooltip).toEqual({ title: '2 more', description: 'Ram: 4 damage on the Rig. Jam: Jam on the Rig' });
		expect(row.planned).toBe(plan);
	});

	it('shows one and "+N" when two wide pills and the "+N" would run past its width, keeping every pill inside it', () => {
		const row = new IntentRow({ id: 'row', width: 196, height: 24, distribution: 'end' });
		row.intents = [
			{ type: 'attack', value: 8, hits: 3, valueText: '8x3', description: 'Sweep', target: 'both' },
			{ type: 'attack', value: 12, hits: 2, valueText: '12x2', description: 'Twin Ram', target: 'both' },
			{ type: 'debuff', description: 'Jam', target: 'driver1' },
		];
		frame(row);
		expect(pills(row).map((pill) => pill.label)).toEqual(['8x3', '+2']);
		for (const pill of pills(row)) {
			expect(pill.bounds.x).toBeGreaterThanOrEqual(0);
			expect(pill.bounds.x + pill.bounds.width).toBeLessThanOrEqual(196);
		}
	});

	it('grows a changed plan\'s new pills in and shrinks the old ones out, and leaves a plan that holds alone', async () => {
		const row = new IntentRow({ id: 'row', width: 196, height: 24 });
		row.mount(context);
		row.intents = [attack(8)];
		const [first] = pills(row);
		expect(first.transform.scale).toBe(0.4);
		await settle();
		expect(first.transform.scale).toBe(1);

		row.intents = [attack(8)];
		expect(pills(row)).toEqual([first]);

		row.intents = [attack(12)];
		// An exit is drawn after the rest, so the new pill comes first
		const [replacement, leaving] = pills(row);
		expect(leaving).toBe(first);
		expect(first['exiting']).toBe(true);
		expect(row.pills).toEqual([replacement]);
		expect(replacement.label).toBe('12');
		await settle();
		expect(pills(row)).toEqual([replacement]);
		expect(first.isMounted).toBe(false);
	});

	it('neither grows nor shrinks under reduced motion', async () => {
		context.animator.reducedMotion = true;
		const row = new IntentRow({ id: 'row', width: 196, height: 24 });
		row.mount(context);
		row.intents = [attack(8)];
		const [first] = pills(row);
		expect(first.transform.scale).toBe(1);
		row.intents = [attack(12)];
		await Promise.resolve();
		expect(pills(row).map((pill) => pill.label)).toEqual(['12']);
	});
});
