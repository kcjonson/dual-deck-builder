/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen } from './CombatScreen';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { createTestContext } from '../../../engine/components/testing';
import type { Component } from '../../../engine/components/Component';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { createMeasuringDrawApi } from '../../../engine/text/testing';

/**
 * DDB-140, Battle Screen Design section 6: the log drawer opens over the
 * right of the road and never over the dock or End Turn, at either gate size.
 */

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const viewport = { width: 1440, height: 882 };
const originalFetch = global.fetch;

function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

function bounds(screen: CombatScreen, id: string): { x: number; y: number; width: number; height: number } {
	const component: Component | null = screen.root.findById(id);
	if (!component) throw new Error(`${id} should be mounted`);
	return component.screenBounds;
}

function overlaps(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

beforeAll(async () => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
	global.fetch = jest.fn().mockResolvedValue({ ok: true, statusText: 'OK', json: async () => cardsFile }) as unknown as typeof fetch;
	await CardLoader.getInstance().loadCards();
	await DriverLoader.getInstance().loadDrivers();
});

afterAll(() => {
	global.fetch = originalFetch;
	jest.restoreAllMocks();
});

describe('CombatScreen log drawer', () => {
	it.each([[1024, 600], [1440, 882]])('opens at %ix%i over the road, clear of the dock and End Turn, at lint zero', async (width, height) => {
		viewport.width = width;
		viewport.height = height;
		const context = createTestContext({
			draw: createMeasuringDrawApi().api,
			viewport: { get logical() { return { ...viewport }; } },
		});
		const combat = new CombatScreen();
		combat.mount(context, { openLog: true });
		await flushPromises();
		await flushPromises();
		context.frame.layout();

		const drawer = combat['combatLogLayer'];
		expect(drawer.isOpen).toBe(true);
		const log = bounds(combat, 'combat_log');
		const road = bounds(combat, 'combat_road');
		expect(log.width).toBeGreaterThan(0);
		expect(log.height).toBeGreaterThan(0);
		expect(overlaps(log, bounds(combat, 'combat_dock'))).toBe(false);
		expect(overlaps(log, bounds(combat, 'combat_end_turn'))).toBe(false);
		expect(overlaps(log, bounds(combat, 'end_turn_button'))).toBe(false);
		// Inside the road band, flush with its right edge
		expect(log.y).toBeGreaterThanOrEqual(road.y);
		expect(log.y + log.height).toBeLessThanOrEqual(road.y + road.height + 0.01);
		expect(log.x + log.width).toBeCloseTo(road.x + road.width, 1);

		expect(layoutLint(treeSnapshot([combat.root], { ...viewport })).violations).toEqual([]);

		combat.unmount();
	});
});
