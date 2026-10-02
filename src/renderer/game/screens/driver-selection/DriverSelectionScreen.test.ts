/**
 * @jest-environment jsdom
 */
import { DriverSelectionScreen } from './DriverSelectionScreen';
import { DriverPanel } from './DriverPanel';
import type { Component } from '../../../engine/components/Component';
import type { MountContext } from '../../../engine/components/MountContext';
import { Button } from '../../../engine/ui/Button';
import { Badge } from '../../../engine/ui/Badge';
import { Clock } from '../../../engine/animation/Clock';
import { createTestContext } from '../../../engine/components/testing';
import { NO_MODIFIERS } from '../../../engine/input/events';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { DriverLoader } from '../../core/DriverLoader';
import { Driver } from '../../mechanics/Driver';
import { isSameDriver } from '../../mechanics/DriverPair';
import { Card as UICard, CardSize } from '../../ui/Card';

/**
 * DDB-98: both panels used to default to the first driver, so a run could start
 * with one driver in both slots and a doubled hand. DDB-89: the panels are
 * stacks with a Select for the driver and a scroll container for the deck.
 * These drive the real screen and panels; only the card data fetch and screen
 * routing are stubbed.
 */

/** The card data loads at once unless a test says it is still in flight; the cards are the shipped ones, without the fetch. */
const mockCards = { loaded: true };
jest.mock('../../core/CardLoader', () => {
	const { Card } = jest.requireActual('../../mechanics/Card');
	const { cards } = jest.requireActual('../../data/cards.json');
	return {
		CardLoader: {
			getInstance: () => ({
				isLoaded: () => mockCards.loaded,
				loadCards: async () => {
					await Promise.resolve();
					mockCards.loaded = true;
				},
				getAllCardsAsMap: () => new Map(cards.map((data: { type: string }) => [data.type, new Card(data)])),
			}),
		},
	};
});

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

function findById(layer: Component, id: string): Component | null {
	if (layer.id === id) return layer;
	for (const child of layer.children) {
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}

function findAll<T extends Component>(layer: Component, type: new (...args: never[]) => T): T[] {
	const found: T[] = layer instanceof type ? [layer] : [];
	for (const child of layer.children) found.push(...findAll(child, type));
	return found;
}

/** Mounted the way the page mounts screens, at the harness's fixed viewport, with measured text. */
let context: MountContext;
beforeEach(() => {
	context = createTestContext({ draw: createMeasuringDrawApi().api, clock: new Clock() });
});

function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

async function mountScreen(screen = new DriverSelectionScreen()): Promise<{ screen: DriverSelectionScreen; left: DriverPanel; right: DriverPanel; startRun: Button }> {
	screen.mount(context);
	await flushPromises();
	context.frame.layout();

	const left = findById(screen.root, 'driver_select_panel_left');
	const right = findById(screen.root, 'driver_select_panel_right');
	const startRun = findById(screen.root, 'driver_select_start_run_button');
	if (!(left instanceof DriverPanel) || !(right instanceof DriverPanel) || !(startRun instanceof Button)) {
		throw new Error('driver selection layout changed; update the test lookups');
	}
	return { screen, left, right, startRun };
}

function press(key: string): void {
	context.dispatcher.enqueue({ kind: 'key', phase: 'down', key, repeat: false, modifiers: NO_MODIFIERS });
	context.dispatcher.enqueue({ kind: 'key', phase: 'up', key, repeat: false, modifiers: NO_MODIFIERS });
	context.dispatcher.dispatchPending();
	context.frame.layout();
}

/** The next driver after the panel's own that its Select offers enabled, picked as a user would. */
function pickNextOpen(panel: DriverPanel): void {
	const options = panel.select.options;
	const current = options.findIndex(option => option.value === panel.select.value);
	for (let step = 1; step <= options.length; step++) {
		const option = options[(current + step) % options.length];
		if (option.enabled !== false) {
			panel.selectDriver(option.value);
			return;
		}
	}
}

function expectDifferentDrivers(screen: DriverSelectionScreen): void {
	const { driver1, driver2 } = screen.selectedDrivers;
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

	afterEach(() => {
		context.popups.close();
	});

	it('opens with a different driver in each panel and START RUN enabled', async () => {
		const { screen, left, right, startRun } = await mountScreen();

		expect(rosterSize).toBeGreaterThanOrEqual(2);
		expectDifferentDrivers(screen);
		expect(left.selectedDriver).toBe(screen.selectedDrivers.driver1);
		expect(right.selectedDriver).toBe(screen.selectedDrivers.driver2);
		expect(left.select.value).toBe(left.selectedDriver?.archetype);
		expect(right.select.value).toBe(right.selectedDriver?.archetype);
		expect(startRun.enabled).toBe(true);
	});

	it("offers every driver in each Select, the other panel's disabled", async () => {
		const { screen, left, right } = await mountScreen();
		const { driver1, driver2 } = screen.selectedDrivers;

		expect(left.select.options.map(option => option.value)).toEqual(rosterDrivers.map(driver => driver.archetype));
		const disabled = (panel: DriverPanel): string[] => panel.select.options.filter(option => option.enabled === false).map(option => option.value);
		expect(disabled(left)).toEqual([driver2?.archetype]);
		expect(disabled(right)).toEqual([driver1?.archetype]);
	});

	it('picking through the right Select never lands on the left driver', async () => {
		const { screen, right } = await mountScreen();
		const seen = new Set<string>();

		for (let i = 0; i < rosterSize * 2; i++) {
			pickNextOpen(right);
			expectDifferentDrivers(screen);
			const driver2 = screen.selectedDrivers.driver2;
			if (driver2) seen.add(driver2.archetype);
		}
		// Every driver but the left one is reachable
		expect(seen.size).toBe(rosterSize - 1);
	});

	it('a pick of the partner driver, were one to arrive, moves on rather than sharing it', async () => {
		const { screen, left } = await mountScreen();
		const rightDriver = screen.selectedDrivers.driver2;
		left.selectDriver(rightDriver?.archetype ?? '');
		expectDifferentDrivers(screen);
		expect(screen.selectedDrivers.driver2).toBe(rightDriver);
	});

	it('picks a driver with the keyboard: focus the Select, Down opens it, Down and Enter pick', async () => {
		const { screen, left } = await mountScreen();
		const before = left.select.options.findIndex(option => option.value === left.select.value);
		context.focus.focus(left.select, 'keyboard');

		press('ArrowDown');
		expect(left.select.openMenu).not.toBeNull();
		press('ArrowDown');
		press('Enter');

		expect(left.select.openMenu).toBeNull();
		const after = left.select.options.findIndex(option => option.value === left.select.value);
		expect(after).not.toBe(before);
		expect(left.selectedDriver?.archetype).toBe(left.select.value);
		expectDifferentDrivers(screen);
	});

	it('Escape closes an open driver Select and stays on the screen; a second Escape goes back', async () => {
		const { left } = await mountScreen();
		const navigate = jest.requireMock('../../core/ScreenManager').ScreenManager.navigate as jest.Mock;
		navigate.mockClear();
		context.focus.focus(left.select, 'keyboard');
		press('ArrowDown');
		expect(left.select.openMenu).not.toBeNull();

		press('Escape');
		expect(left.select.openMenu).toBeNull();
		expect(navigate).not.toHaveBeenCalled();

		press('Escape');
		expect(navigate).toHaveBeenCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
	});

	it('tabs in reading order: Back, the two driver Selects, START RUN (R9.18)', async () => {
		const { screen } = await mountScreen();
		context.focus.pushScope(screen.root);
		expect(context.focus.tabOrder.map(component => component.id)).toEqual([
			'driver_select_back_button',
			'driver_panel_left_driver_select',
			'driver_panel_right_driver_select',
			'driver_select_start_run_button',
		]);
		context.focus.popScope(screen.root);
		screen.unmount();
	});

	it('a remount after unmount starts clean with two different drivers', async () => {
		const { screen, left, right } = await mountScreen();
		// Leaves the right panel on the first driver, which a stale partner
		// would make the left panel skip after the remount
		left.selectDriver(rosterDrivers[1].archetype);
		right.selectDriver(rosterDrivers[0].archetype);
		expect(screen.selectedDrivers.driver2?.archetype).toBe(rosterDrivers[0].archetype);

		screen.unmount();
		const remounted = await mountScreen(screen);

		expect(remounted.left).not.toBe(left);
		expectDifferentDrivers(screen);
		expect(remounted.left.selectedDriver?.archetype).toBe(rosterDrivers[0].archetype);
	});

	it('drops a roster load that finishes after the screen left', async () => {
		const screen = new DriverSelectionScreen();
		screen.mount(context);
		screen.unmount();
		await flushPromises();

		expect(screen.selectedDrivers.driver1).toBeNull();
		expect(screen.root.children).toHaveLength(0);
	});

	it('fills only the new mount when the screen comes back before the first load lands', async () => {
		const screen = new DriverSelectionScreen();
		screen.mount(context);
		screen.unmount();
		const { left, right } = await mountScreen(screen);

		expect(left.selectedDriver).toBe(screen.selectedDrivers.driver1);
		expect(right.selectedDriver).toBe(screen.selectedDrivers.driver2);
		expectDifferentDrivers(screen);
	});

	it('builds nothing until it mounts, and takes its Escape with it when it unmounts', async () => {
		const screen = new DriverSelectionScreen();
		expect(screen.root.children).toHaveLength(0);

		await mountScreen(screen);
		expect(screen.root.ownHotkeys?.has('Escape')).toBe(true);

		screen.unmount();
		expect(screen.root.ownHotkeys?.has('Escape') ?? false).toBe(false);
		expect(screen.root.children).toHaveLength(0);
	});

	it('a resize lays the same panels out again and keeps both drivers, never rebuilding', async () => {
		const { screen, left, right, startRun } = await mountScreen();
		pickNextOpen(left);
		const before = screen.selectedDrivers;
		const children = [...screen.root.children];
		const leftChildren = [...left.children];

		for (const [width, height] of [[1024, 600], [1280, 720], [1920, 1080]]) {
			screen.resize(width, height);
			context.frame.layout();

			expect(screen.root.children).toEqual(children);
			expect(left.children).toEqual(leftChildren);
			expect(screen.selectedDrivers).toEqual(before);
			expect(left.selectedDriver).toBe(before.driver1);
			expect(right.selectedDriver).toBe(before.driver2);
			expect(startRun.enabled).toBe(true);

			// The panels mirror each other and START RUN is centred at the foot
			expect(left.width).toBe(right.width);
			expect(left.screenBounds.x - 0).toBeCloseTo(width - (right.screenBounds.x + right.width), 5);
			const button = startRun.screenBounds;
			expect(button.x + button.width / 2).toBeCloseTo(width / 2, 5);
			expect(button.y + button.height).toBeLessThanOrEqual(height);
		}
	});

	it.each([[1024, 600], [1280, 720], [1920, 1080]])('at %ix%i the flavour and deck scroller keeps a card height above the Select', async (width, height) => {
		const { screen, left } = await mountScreen();
		screen.resize(width, height);
		context.frame.layout();

		const preview = left.deckPreview.screenBounds;
		const select = left.select.screenBounds;
		expect(preview.height).toBeGreaterThanOrEqual(UICard.getDimensions(CardSize.MINI).height);
		expect(preview.y + preview.height).toBeLessThanOrEqual(select.y);
		expect(left.screenBounds.y + left.height).toBeLessThanOrEqual(height);
	});

	it('scrolls the flavour and deck at 1024x600 rather than clipping them away', async () => {
		const { screen, left } = await mountScreen();
		screen.resize(1024, 600);
		context.frame.layout();

		const preview = left.deckPreview;
		const cards = findAll(preview, UICard);
		expect(cards.length).toBe(left.selectedDriver?.startingDeck.cards.length);
		expect(preview.overflows).toBe(true);
		preview.scrollBy(1000);
		context.frame.layout();
		expect(preview.scrollPosition).toBe(preview.maxScroll);
		expect(preview.scrollPosition).toBeGreaterThan(0);
	});

	it('puts each quantity on a badge under its card, clear of the cost corner', async () => {
		const { left } = await mountScreen();
		const driver = left.selectedDriver;
		const multiples = driver?.startingDeck.cards.filter(card => card.quantity > 1) ?? [];
		const badges = findAll(left.deckPreview, Badge);
		expect(badges.map(badge => badge.labelText)).toEqual(multiples.map(card => `x${card.quantity}`));
		for (const badge of badges) {
			const card = badge.parent?.children[0];
			if (!(card instanceof UICard)) throw new Error('a quantity badge sits with its card');
			expect(badge.screenBounds.y).toBeGreaterThanOrEqual(card.screenBounds.y + card.height);
		}
	});

	it('builds one starting deck preview when selections overlap a card load', async () => {
		const { screen, left } = await mountScreen();
		mockCards.loaded = false;
		pickNextOpen(left);
		pickNextOpen(left);
		await flushPromises();
		context.frame.layout();

		const cards = findAll(left.deckPreview, UICard);
		expect(cards.length).toBe(left.selectedDriver?.startingDeck.cards.length);
		expect(left.selectedDriver).toBe(screen.selectedDrivers.driver1);
	});
});
