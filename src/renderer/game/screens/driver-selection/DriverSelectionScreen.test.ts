/**
 * @jest-environment jsdom
 */
import { DriverSelectionScreen } from './DriverSelectionScreen';
import { DriverPanel } from './DriverPanel';
import { Layer } from '../../../engine/components/Layer';
import { Button } from '../../../engine/ui/Button';
import { DriverLoader } from '../../core/DriverLoader';
import { Driver } from '../../mechanics/Driver';
import { isSameDriver } from '../../mechanics/DriverPair';

/**
 * DDB-98: both panels used to default to the first driver, so a run could start
 * with one driver in both slots and a doubled hand. These drive the real
 * screen and panels; only the card data fetch and screen routing are stubbed.
 */

jest.mock('../../core/CardLoader', () => ({
	CardLoader: {
		getInstance: () => ({
			isLoaded: () => true,
			loadCards: async () => undefined,
			getAllCardsAsMap: () => new Map(),
		}),
	},
}));

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

function findById(layer: Layer, id: string): Layer | null {
	if (layer.id === id) return layer;
	for (const child of layer.getChildren()) {
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}

function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

async function mountScreen(): Promise<{ screen: DriverSelectionScreen; left: DriverPanel; right: DriverPanel; startRun: Button }> {
	const screen = new DriverSelectionScreen();
	screen.mount();
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
		screen.mount();
		await flushPromises();

		expectDifferentDrivers(screen);
		expect(left.getSelectedDriver()?.archetype).toBe(rosterDrivers[0].archetype);
	});
});
