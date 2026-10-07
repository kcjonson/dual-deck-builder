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
import { CardInspectSurface } from '../../ui/cardInspect';
import { advance, pointer, send } from '../../../engine/services/testing';
import { tokens } from '../../../engine/theme/tokens';

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
let viewportSize = { width: 1440, height: 882 };
beforeEach(() => {
	viewportSize = { width: 1440, height: 882 };
	context = createTestContext({
		draw: createMeasuringDrawApi().api,
		viewport: { get logical() { return viewportSize; } },
		clock: new Clock(),
	});
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

	it("tabs in reading order: Back, each panel's deck then its Select, START RUN (R9.18, R9.29)", async () => {
		const { screen, left } = await mountScreen();
		context.focus.pushScope(screen.root);
		// A deck is one stop, landing on its first card
		expect(context.focus.tabOrder[1]).toBe(findAll(left.deckPreview, UICard)[0]);
		const stops = context.focus.tabOrder.map(component => (component instanceof UICard ? component.parent?.id : component.id));
		expect(stops).toEqual([
			'driver_select_back_button',
			'driver_panel_left_deck_cards',
			'driver_panel_left_driver_select',
			'driver_panel_right_deck_cards',
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

	it('shows each card once, as a mini stacked to its quantity (Game Flow 7.0)', async () => {
		const { left } = await mountScreen();
		const deck = left.selectedDriver?.startingDeck.cards ?? [];
		const cards = findAll(left.deckPreview, UICard);
		expect(cards.map(card => [card.data.type, card.copies])).toEqual(deck.map(entry => [entry.type, entry.quantity]));
		expect(cards.every(card => card.size === CardSize.MINI)).toBe(true);
		expect(findAll(left.deckPreview, Badge)).toEqual([]);
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
	describe('starting deck card preview (DDB-226)', () => {
		function miniCards(panel: DriverPanel): UICard[] {
			return findAll(panel.deckPreview, UICard);
		}

		function centre(card: UICard): { x: number; y: number } {
			const bounds = card.screenBounds;
			return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
		}

		it('gives every mini card the shared detail view, for its own card', async () => {
			const { left } = await mountScreen();
			const cards = miniCards(left);
			expect(cards.length).toBeGreaterThan(0);
			for (const card of cards) {
				expect(card.tooltip?.factory).toBeDefined();
				expect(card.tooltip?.immediateOnFocus).toBe(true);
				context.tooltips.show(card, { fade: false });
				const surface = context.tooltips.surface;
				expect(surface).toBeInstanceOf(CardInspectSurface);
				if (surface instanceof CardInspectSurface) expect(surface.view.detail.data).toBe(card.data);
				context.tooltips.hide();
				context.animator.settle();
			}
		});

		it('shows on hover after the tooltip delay and hides when the pointer leaves', async () => {
			const { left } = await mountScreen();
			const card = miniCards(left)[0];
			const over = centre(card);
			send(context, [pointer('move', over.x, over.y)]);
			expect(context.tooltips.surface).toBeNull();
			advance(context, tokens.control.tooltip_delay + tokens.motion.dur_fast + 100);
			expect(context.tooltips.owner).toBe(card);
			expect(context.tooltips.surface).toBeInstanceOf(CardInspectSurface);

			send(context, [pointer('move', 2, 2)]);
			advance(context, tokens.motion.dur_tooltip_hide + 100);
			expect(context.tooltips.surface).toBeNull();
			expect(context.tooltips.owner).toBeNull();
		});

		it('shows at once on keyboard focus and hides on blur', async () => {
			const { screen, left } = await mountScreen();
			context.focus.pushScope(screen.root);
			const card = miniCards(left)[0];
			context.focus.focus(card, 'keyboard');
			context.frame.layout();
			expect(context.tooltips.owner).toBe(card);
			expect(context.tooltips.surface).toBeInstanceOf(CardInspectSurface);

			context.focus.focus(left.select, 'keyboard');
			advance(context, tokens.motion.dur_tooltip_hide + 100);
			expect(context.tooltips.surface).toBeNull();
			context.focus.popScope(screen.root);
		});

		it('moves between cards with the arrows, each showing its preview', async () => {
			const { screen, left } = await mountScreen();
			context.focus.pushScope(screen.root);
			const [first, second] = miniCards(left);
			context.focus.focus(first, 'keyboard');
			press('ArrowRight');
			expect(context.focus.focused).toBe(second);
			expect(context.tooltips.owner).toBe(second);
			context.tooltips.hide();
			context.focus.popScope(screen.root);
		});

		it.each([[1280, 720], [1024, 600], [800, 450], [640, 400]])('keeps the preview on screen at %ix%i for every card in both panels', async (width, height) => {
			viewportSize = { width, height };
			const { screen, left, right } = await mountScreen();
			screen.resize(width, height);
			context.frame.layout();
			for (const card of [...miniCards(left), ...miniCards(right)]) {
				context.tooltips.show(card, { fade: false });
				const surface = context.tooltips.surface;
				if (!(surface instanceof CardInspectSurface)) throw new Error('a mini card shows the detail view');
				context.frame.layout();
				const parts = [surface.screenBounds, surface.view.screenBounds, surface.view.detail.screenBounds];
				if (!surface.view.keywords.empty) parts.push(surface.view.keywords.screenBounds);
				for (const bounds of parts) {
					expect(bounds.x).toBeGreaterThanOrEqual(-1e-6);
					expect(bounds.y).toBeGreaterThanOrEqual(-1e-6);
					expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1e-6);
					expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1e-6);
				}
				// Placed whole, not shrunk and clipped to the room there
				expect(surface.view.height).toBeLessThanOrEqual(surface.height + 1e-6);
				expect(surface.overflow).not.toBe('hidden');
				context.tooltips.hide();
				context.animator.settle();
			}
		});

		it('takes the preview down when the deck is rebuilt under it', async () => {
			const { left } = await mountScreen();
			const card = miniCards(left)[0];
			context.tooltips.show(card, { fade: false });
			expect(context.tooltips.surface).not.toBeNull();

			pickNextOpen(left);
			await flushPromises();
			context.frame.layout();

			advance(context, tokens.motion.dur_tooltip_hide + 100);
			expect(context.tooltips.surface).toBeNull();
			expect(context.tooltips.owner).toBeNull();
			expect(context.tooltips.state).toBe('idle');
			expect(card.isMounted).toBe(false);
		});

		it('takes a pinned preview down when the driver changes', async () => {
			const { left } = await mountScreen();
			const card = miniCards(left)[0];
			context.tooltips.pin(card, { fade: false });
			expect(context.tooltips.pinned).toBe(card);

			pickNextOpen(left);
			await flushPromises();
			// Before any layout, which would drop an unmounted pin by itself
			expect(context.tooltips.pinned).toBeNull();
			expect(context.tooltips.owner).toBeNull();

			advance(context, tokens.motion.dur_tooltip_hide + 100);
			expect(context.tooltips.surface).toBeNull();
		});

		it('leaves a preview on the other panel alone when this one rebuilds', async () => {
			const { left, right } = await mountScreen();
			const card = miniCards(right)[0];
			context.tooltips.show(card, { fade: false });

			pickNextOpen(left);
			await flushPromises();
			context.frame.layout();

			expect(context.tooltips.owner).toBe(card);
			context.tooltips.hide();
		});

		it('rebuilds with one set of previewable cards after overlapping selections', async () => {
			const { left } = await mountScreen();
			mockCards.loaded = false;
			pickNextOpen(left);
			pickNextOpen(left);
			await flushPromises();
			context.frame.layout();

			const cards = miniCards(left);
			expect(cards.length).toBe(left.selectedDriver?.startingDeck.cards.length);
			expect(cards.every(card => card.tooltip !== null && card.isMounted)).toBe(true);
		});

		it('pins on I and lets go on the next I, as the preview footer says', async () => {
			const { screen, left } = await mountScreen();
			context.focus.pushScope(screen.root);
			const card = miniCards(left)[0];
			context.focus.focus(card, 'keyboard');
			press('i');
			expect(context.tooltips.pinned).toBe(card);
			press('i');
			expect(context.tooltips.pinned).toBeNull();
			context.tooltips.hide();
			context.focus.popScope(screen.root);
		});

		it('pins on a capital I too, and an I with nothing focused or shown does nothing', async () => {
			const { screen, left } = await mountScreen();
			context.focus.pushScope(screen.root);
			context.focus.focus(null, 'keyboard');
			press('i');
			expect(context.tooltips.pinned).toBeNull();

			const card = miniCards(left)[0];
			context.focus.focus(card, 'keyboard');
			press('I');
			expect(context.tooltips.pinned).toBe(card);
			press('I');
			expect(context.tooltips.pinned).toBeNull();
			context.tooltips.hide();
			context.focus.popScope(screen.root);
		});

		it('an I after the screen unmounts does nothing, and after a remount pins once', async () => {
			const { screen, left } = await mountScreen();
			context.focus.pushScope(screen.root);
			context.focus.focus(miniCards(left)[0], 'keyboard');
			screen.unmount();
			context.focus.popScope(screen.root);
			expect(() => press('i')).not.toThrow();
			expect(context.tooltips.pinned).toBeNull();

			const remounted = await mountScreen(screen);
			context.focus.pushScope(screen.root);
			const card = miniCards(remounted.left)[0];
			context.focus.focus(card, 'keyboard');
			press('i');
			expect(context.tooltips.pinned).toBe(card);
			context.tooltips.hide();
			context.focus.popScope(screen.root);
		});

		it('a wheel over a mini card still scrolls the deck', async () => {
			const { screen, left } = await mountScreen();
			screen.resize(1024, 600);
			context.frame.layout();
			expect(left.deckPreview.overflows).toBe(true);
			const over = centre(miniCards(left)[0]);
			context.dispatcher.enqueue({ kind: 'wheel', x: over.x, y: over.y, deltaX: 0, deltaY: 60, deltaMode: 0, modifiers: NO_MODIFIERS });
			context.dispatcher.dispatchPending();
			context.frame.layout();
			expect(left.deckPreview.scrollPosition).toBeGreaterThan(0);
		});

		it('Enter on a focused mini card does nothing', async () => {
			const { screen, left } = await mountScreen();
			const navigate = jest.requireMock('../../core/ScreenManager').ScreenManager.navigate as jest.Mock;
			navigate.mockClear();
			context.focus.pushScope(screen.root);
			const card = miniCards(left)[0];
			const driver = left.selectedDriver;
			context.focus.focus(card, 'keyboard');
			expect(() => press('Enter')).not.toThrow();
			expect(navigate).not.toHaveBeenCalled();
			expect(left.selectedDriver).toBe(driver);
			expect(card.selected).toBe(false);
			expect(context.tooltips.owner).toBe(card);
			context.tooltips.hide();
			context.focus.popScope(screen.root);
		});

		it('Escape dismisses a keyboard preview first and leaves the screen on the second press', async () => {
			const { screen, left } = await mountScreen();
			const navigate = jest.requireMock('../../core/ScreenManager').ScreenManager.navigate as jest.Mock;
			navigate.mockClear();
			context.focus.pushScope(screen.root);
			context.focus.focus(miniCards(left)[0], 'keyboard');
			expect(context.tooltips.surface).not.toBeNull();
			screen.update(0);

			press('Escape');
			expect(context.tooltips.surface).toBeNull();
			expect(navigate).not.toHaveBeenCalled();
			screen.update(0);

			press('Escape');
			expect(navigate).toHaveBeenCalledTimes(1);
			expect(navigate).toHaveBeenCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
			context.focus.popScope(screen.root);
		});

		it('Escape dismisses a hover preview first and leaves the screen on the second press', async () => {
			const { screen, left } = await mountScreen();
			const navigate = jest.requireMock('../../core/ScreenManager').ScreenManager.navigate as jest.Mock;
			navigate.mockClear();
			const over = centre(miniCards(left)[0]);
			send(context, [pointer('move', over.x, over.y)]);
			advance(context, tokens.control.tooltip_delay + tokens.motion.dur_fast + 100);
			expect(context.tooltips.surface).not.toBeNull();
			screen.update(0);

			press('Escape');
			expect(context.tooltips.surface).toBeNull();
			expect(navigate).not.toHaveBeenCalled();
			screen.update(0);

			press('Escape');
			expect(navigate).toHaveBeenCalledTimes(1);
		});

		it('Escape with no preview up leaves at once', async () => {
			const { screen } = await mountScreen();
			const navigate = jest.requireMock('../../core/ScreenManager').ScreenManager.navigate as jest.Mock;
			navigate.mockClear();
			screen.update(0);
			press('Escape');
			expect(navigate).toHaveBeenCalledTimes(1);
		});

		it('overlapping picks while a preview is up leave the tooltip idle and one set of cards', async () => {
			const { left } = await mountScreen();
			context.tooltips.show(miniCards(left)[0], { fade: false });
			mockCards.loaded = false;
			pickNextOpen(left);
			pickNextOpen(left);
			await flushPromises();
			context.frame.layout();
			advance(context, tokens.motion.dur_tooltip_hide + 100);

			expect(context.tooltips.state).toBe('idle');
			expect(context.tooltips.surface).toBeNull();
			const cards = miniCards(left);
			expect(cards.length).toBe(left.selectedDriver?.startingDeck.cards.length);
			expect(cards.every(card => card.isMounted)).toBe(true);
		});

		it('takes the preview down on reset', async () => {
			const { left } = await mountScreen();
			context.tooltips.show(miniCards(left)[0], { fade: false });
			left.reset();
			advance(context, tokens.motion.dur_tooltip_hide + 100);
			expect(context.tooltips.surface).toBeNull();
		});
	});
});
