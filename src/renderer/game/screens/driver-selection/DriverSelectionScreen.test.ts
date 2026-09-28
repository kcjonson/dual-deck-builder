/**
 * @jest-environment jsdom
 */
import { DriverSelectionScreen } from './DriverSelectionScreen';
import { DriverPanel } from './DriverPanel';
import type { Component } from '../../../engine/components/Component';
import { Button } from '../../../engine/ui/Button';
import { Text } from '../../../engine/components/Text';
import { createTestContext } from '../../../engine/components/testing';
import { DriverLoader } from '../../core/DriverLoader';
import { Driver } from '../../mechanics/Driver';
import { isSameDriver } from '../../mechanics/DriverPair';

/**
 * DDB-98: both panels used to default to the first driver, so a run could start
 * with one driver in both slots and a doubled hand. These drive the real
 * screen and panels; only the card data fetch and screen routing are stubbed.
 */

/** The card data loads at once unless a test says it is still in flight. */
const mockCards = { loaded: true };
jest.mock('../../core/CardLoader', () => ({
	CardLoader: {
		getInstance: () => ({
			isLoaded: () => mockCards.loaded,
			loadCards: async () => {
				await Promise.resolve();
				mockCards.loaded = true;
			},
			getAllCardsAsMap: () => new Map(),
		}),
	},
}));

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

function findById(layer: Component, id: string): Component | null {
	if (layer.id === id) return layer;
	for (const child of layer.getChildren()) {
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}


/** Mounted the way the page mounts screens, at the harness's fixed viewport. */
const context = createTestContext();
function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

async function mountScreen(): Promise<{ screen: DriverSelectionScreen; left: DriverPanel; right: DriverPanel; startRun: Button }> {
	const screen = new DriverSelectionScreen();
	screen.mount(context);
	await flushPromises();

	const left = findById(screen.root, 'driver_select_panel_left');
	const right = findById(screen.root, 'driver_select_panel_right');
	const startRun = findById(screen.root, 'driver_select_start_run_button');
	if (!(left instanceof DriverPanel) || !(right instanceof DriverPanel) || !(startRun instanceof Button)) {
		throw new Error('driver selection layout changed; update the test lookups');
	}
	return { screen, left, right, startRun };
}

function expectDifferentDrivers(screen: DriverSelectionScreen): void {
	const { driver1, driver2 } = screen.getSelectedDrivers();
	expect(driver1).not.toBeNull();
	expect(driver2).not.toBeNull();
	if (driver1 && driver2) {
		expect(isSameDriver(driver1, driver2)).toBe(false);
	}
}

describe('DriverSelectionScreen: one driver per slot', () => {
	let rosterDrivers: Driver[];
	let rosterSize: number;

	beforeAll(async () => {
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
		const loader = DriverLoader.getInstance();
		await loader.loadDrivers();
		rosterDrivers = loader.getUnlockedDrivers();
		rosterSize = rosterDrivers.length;
	});

	afterAll(() => {
		jest.restoreAllMocks();
	});

	it('opens with a different driver in each panel and START RUN enabled', async () => {
		const { screen, left, right, startRun } = await mountScreen();

		expect(rosterSize).toBeGreaterThanOrEqual(2);
		expectDifferentDrivers(screen);
		expect(left.getSelectedDriver()).toBe(screen.getSelectedDrivers().driver1);
		expect(right.getSelectedDriver()).toBe(screen.getSelectedDrivers().driver2);
		expect(startRun.isEnabled()).toBe(true);
	});

	it('cycling the right panel never lands on the left driver', async () => {
		const { screen, right } = await mountScreen();
		const seen = new Set<string>();

		for (let i = 0; i < rosterSize * 2; i++) {
			right.cycleDriver();
			expectDifferentDrivers(screen);
			const driver2 = screen.getSelectedDrivers().driver2;
			if (driver2) seen.add(driver2.archetype);
		}
		// Every driver but the left one is reachable
		expect(seen.size).toBe(rosterSize - 1);
	});

	it('cycling the left panel never lands on the right driver', async () => {
		const { screen, left } = await mountScreen();
		const rightDriver = screen.getSelectedDrivers().driver2;

		for (let i = 0; i < rosterSize * 2; i++) {
			left.cycleDriver();
			expectDifferentDrivers(screen);
			expect(screen.getSelectedDrivers().driver2).toBe(rightDriver);
		}
	});

	it('a remount after unmount starts clean with two different drivers', async () => {
		const { screen, left, right } = await mountScreen();
		// Leaves the right panel on the first driver, which a stale partner
		// would make the left panel skip after the remount
		left.cycleDriver();
		right.cycleDriver();
		expect(screen.getSelectedDrivers().driver2?.archetype).toBe(rosterDrivers[0].archetype);

		screen.unmount();
		screen.mount(context);
		await flushPromises();

		expectDifferentDrivers(screen);
		expect(left.getSelectedDriver()?.archetype).toBe(rosterDrivers[0].archetype);
	});

	it('a resize moves the same panels and keeps both drivers, never rebuilding', async () => {
		const { screen, left, right, startRun } = await mountScreen();
		left.cycleDriver();
		const before = screen.getSelectedDrivers();
		const children = [...screen.root.getChildren()];

		for (const [width, height] of [[1024, 700], [1920, 1080], [800, 600]]) {
			screen.resize(width, height);
			context.frame.layout();

			expect(screen.root.getChildren()).toEqual(children);
			expect(screen.getSelectedDrivers()).toEqual(before);
			expect(left.getSelectedDriver()).toBe(before.driver1);
			expect(right.getSelectedDriver()).toBe(before.driver2);
			expect(startRun.isEnabled()).toBe(true);
			expect(left.getWidth()).toBe(Math.floor(width * 0.35));
			expect(right.getX()).toBe(Math.floor(width * 0.6));
			expect(startRun.getY()).toBe(Math.floor(height * 0.85));
		}
	});

	it('builds one starting deck preview when selections overlap a card load', async () => {
		const { screen, left } = await mountScreen();
		mockCards.loaded = false;
		left.cycleDriver();
		left.cycleDriver();
		await flushPromises();

		const preview = findById(left, 'driver_panel_left_deck_preview');
		const titles = preview?.getChildren().filter(child => child instanceof Text && child.getText() === 'Starting Deck:');
		expect(titles).toHaveLength(1);
		expect(left.getSelectedDriver()).toBe(screen.getSelectedDrivers().driver1);
	});
});
