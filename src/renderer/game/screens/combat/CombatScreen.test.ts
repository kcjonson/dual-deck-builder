/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen } from './CombatScreen';
import { DriverSelectionScreen } from '../driver-selection/DriverSelectionScreen';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { Driver } from '../../mechanics/Driver';
import { Deck } from '../../mechanics/Deck';
import { Battle } from '../../mechanics/Battle';
import { computeCombatLayout } from './CombatLayout';
import { SnapshotNode, SnapshotRect, treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { injectInput } from '../../../engine/debug/inputInjection';
import { createTestContext } from '../../../engine/components/testing';

/**
 * DDB-157: START RUN used to hand DriverLoader's template drivers straight to
 * combat, which mutates them in place, so a second run in the same session
 * started with the first run's damage, hand, and discard.
 */

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));


/**
 * Mounted the way the page mounts screens. The viewport follows the window,
 * because these tests size the window and the screens still read it.
 */
const context = createTestContext({
	viewport: { get logical() { return { width: window.innerWidth, height: window.innerHeight }; } },
});
function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * A combat screen mounted the way ScreenManager mounts it, with its opening
 * hands dealt
 */
async function startCombat(drivers: Driver[]): Promise<CombatScreen> {
	const combat = new CombatScreen();
	combat.mount(context, { drivers });
	await flushPromises();
	await flushPromises();
	return combat;
}

/**
 * The drivers START RUN sends to combat from a freshly mounted selection screen
 */
async function selectDrivers(): Promise<Driver[]> {
	const selection = new DriverSelectionScreen();
	selection.mount(context);
	await flushPromises();
	const { driver1, driver2 } = selection.getSelectedDrivers();
	selection.unmount();
	if (!driver1 || !driver2) {
		throw new Error('driver selection should open with both slots filled');
	}
	return [driver1, driver2];
}

/**
 * Plays out a rough fight on the drivers combat holds: damage, a spent
 * adrenaline point, and cards moved into the hand and discard
 */
function fight(drivers: Driver[]): void {
	for (const driver of drivers) {
		driver.takeDamage(7);
		driver.spendAdrenaline(1);
		driver.discardHand();
		driver.drawCards(2);
	}
}

const loader = DriverLoader.getInstance();
const originalFetch = global.fetch;

beforeAll(async () => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
	global.fetch = jest.fn().mockResolvedValue({
		ok: true,
		statusText: 'OK',
		json: async () => cardsFile,
	}) as unknown as typeof fetch;
	await CardLoader.getInstance().loadCards();
	await loader.loadDrivers();
});

afterAll(() => {
	global.fetch = originalFetch;
	jest.restoreAllMocks();
});

describe('CombatScreen: each run starts from fresh drivers', () => {
	it('a second run with the same selection starts at full HP with a new deck and an empty discard', async () => {
		const firstRun = await selectDrivers();
		(await startCombat(firstRun)).unmount();
		const firstDecks = firstRun.map(driver => driver.deck);
		fight(firstRun);
		expect(firstRun.every(driver => driver.hitpoints < driver.maxHitpoints)).toBe(true);
		expect(firstRun.every(driver => driver.discard.length > 0)).toBe(true);

		const secondRun = await selectDrivers();
		expect(secondRun.map(driver => driver.archetype)).toEqual(firstRun.map(driver => driver.archetype));
		for (const driver of secondRun) {
			expect(firstRun).not.toContain(driver);
			expect(driver.hitpoints).toBe(driver.maxHitpoints);
			expect(driver.hand).toEqual([]);
			expect(driver.discard).toEqual([]);
			expect(driver.deck).toBeNull();
		}

		(await startCombat(secondRun)).unmount();
		secondRun.forEach((driver, index) => {
			expect(driver.hitpoints).toBe(driver.maxHitpoints);
			expect(driver.discard).toEqual([]);
			expect(driver.deck).toBeInstanceOf(Deck);
			expect(driver.deck).not.toBe(firstDecks[index]);
			// Only the opening draw, none of the first run's cards
			const firstRunCards = new Set([...firstRun[index].hand, ...firstRun[index].discard].map(card => card.id));
			expect(driver.hand.some(card => firstRunCards.has(card.id))).toBe(false);
		});
	});

	it('leaves the DriverLoader templates untouched after a fight', async () => {
		const drivers = await selectDrivers();
		(await startCombat(drivers)).unmount();
		fight(drivers);

		for (const driver of drivers) {
			const template = loader.getDriver(driver.archetype);
			expect(template).toBeDefined();
			expect(template).not.toBe(drivers.find(fought => fought.archetype === driver.archetype));
			expect(template?.hitpoints).toBe(template?.maxHitpoints);
			expect(template?.adrenaline).toBe(3);
			expect(template?.hand).toEqual([]);
			expect(template?.discard).toEqual([]);
			expect(template?.deck).toBeNull();
		}
	});

	it('the dev fallback (no drivers passed) never fights the templates either', async () => {
		const combat = new CombatScreen();
		combat.mount(context);
		await flushPromises();
		await flushPromises();

		const state = combat.getBattleState();
		expect(state).not.toBeNull();
		for (const template of loader.getUnlockedDrivers()) {
			expect(template.hitpoints).toBe(template.maxHitpoints);
			expect(template.hand).toEqual([]);
			expect(template.deck).toBeNull();
		}
		combat.unmount();
	});
});

/**
 * DDB-124: mount stacked the bands one way and resize another, and END TURN
 * never moved on resize, so a bar built while the viewport read 0 wide left
 * it at x=-130 for the rest of the fight.
 */
describe('CombatScreen: one layout for mount and resize', () => {
	const canvas = document.createElement('canvas');

	beforeAll(() => {
		document.body.appendChild(canvas);
		context.input.setup(canvas);
	});

	function setViewport(width: number, height: number): void {
		Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
		Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
	}

	/**
	 * What the application shell does on a resize (R7.11): the viewport owner
	 * calls the mounted screen through `ScreenManager.resize`. The window size
	 * moves too, because the screens still read it until phase 3.
	 */
	function resizeViewport(combat: CombatScreen, width: number, height: number): void {
		setViewport(width, height);
		combat.resize(width, height);
	}

	function snapshot(combat: CombatScreen): SnapshotNode {
		return treeSnapshot([combat.root], { width: window.innerWidth, height: window.innerHeight }).roots[0];
	}

	function allIds(node: SnapshotNode): string[] {
		const children = [...(node.parts ?? []), ...node.children];
		return [...(node.id ? [node.id] : []), ...children.flatMap(allIds)];
	}

	function findNode(node: SnapshotNode, id: string): SnapshotNode | null {
		if (node.id === id) return node;
		for (const child of [...(node.parts ?? []), ...node.children]) {
			const found = findNode(child, id);
			if (found) return found;
		}
		return null;
	}

	function endTurnBounds(combat: CombatScreen): SnapshotRect {
		const button = findNode(snapshot(combat), 'end_turn_button');
		if (!button) throw new Error('the combat screen should have an END TURN button');
		return button.screenBounds;
	}

	function expectInsideViewport({ x, y, w, h }: SnapshotRect): void {
		expect(w).toBeGreaterThan(0);
		expect(h).toBeGreaterThan(0);
		expect(x).toBeGreaterThanOrEqual(0);
		expect(y).toBeGreaterThanOrEqual(0);
		expect(x + w).toBeLessThanOrEqual(window.innerWidth);
		expect(y + h).toBeLessThanOrEqual(window.innerHeight);
	}

	/**
	 * Mounted without drivers, so the dev fallback loads a fight
	 * asynchronously; until it lands the screen is the same bare UI on every
	 * mount
	 */
	function mountBare(): CombatScreen {
		const combat = new CombatScreen();
		combat.mount(context);
		return combat;
	}

	async function settle(): Promise<void> {
		await flushPromises();
		await flushPromises();
	}

	beforeEach(() => setViewport(1024, 768));

	it.each([
		[1280, 720],
		[1440, 882],
	])('a screen resized to %ix%i matches one mounted at that size', async (width, height) => {
		const resized = mountBare();
		resizeViewport(resized, width, height);
		const afterResize = snapshot(resized);

		const mounted = mountBare();
		expect(afterResize).toEqual(snapshot(mounted));

		await settle();
		resized.unmount();
		mounted.unmount();
	});

	it('resizing away and back with a fight on returns every vehicle and card to where mount put them', async () => {
		const combat = mountBare();
		await settle();
		const atMount = snapshot(combat);
		expect(allIds(atMount).some(id => id.startsWith('hand_card_'))).toBe(true);
		expect(allIds(atMount).some(id => id.startsWith('enemy_vehicle_'))).toBe(true);

		resizeViewport(combat, 1280, 720);
		resizeViewport(combat, 1024, 768);
		expect(snapshot(combat)).toEqual(atMount);

		combat.unmount();
	});

	it('mount puts every band where the layout says', async () => {
		const combat = mountBare();
		const layout = computeCombatLayout({ width: 1024, height: 768 });
		const root = snapshot(combat);
		const bands: Array<[string, keyof typeof layout]> = [
			['combat_resource_bar', 'resourceBar'],
			['combat_enemy_battlefield', 'enemyBattlefield'],
			['combat_player_battlefield', 'playerBattlefield'],
			['combat_player_hand', 'hand'],
			['combat_turn_banner', 'turnBanner'],
			['combat_log', 'combatLog'],
		];
		for (const [id, key] of bands) {
			const { x, y, width, height } = layout[key];
			expect(findNode(root, id)?.screenBounds).toEqual({ x, y, w: width, h: height });
		}

		await settle();
		combat.unmount();
	});

	it('END TURN is on screen after mount and after a resize', async () => {
		const combat = mountBare();
		expectInsideViewport(endTurnBounds(combat));

		resizeViewport(combat, 1280, 720);
		const { x, w } = endTurnBounds(combat);
		expectInsideViewport(endTurnBounds(combat));
		expect(x + w).toBe(1280 - 10);

		await settle();
		combat.unmount();
	});

	it('END TURN comes on screen when a screen mounted at 0 wide gets its real size', async () => {
		setViewport(0, 0);
		const combat = mountBare();

		resizeViewport(combat, 1024, 768);
		expectInsideViewport(endTurnBounds(combat));

		await settle();
		combat.unmount();
	});

	it('clicking END TURN after a resize ends the turn', async () => {
		const combat = mountBare();
		await settle();
		expect(combat.getBattleState()?.isPlayerTurn).toBe(true);

		resizeViewport(combat, 1280, 720);
		const { x, y, w, h } = endTurnBounds(combat);
		const endPlayerTurn = jest.spyOn(Battle.prototype, 'endPlayerTurn');
		expect(injectInput({ canvas, input: context.input }, [`click,${Math.round(x + w / 2)},${Math.round(y + h / 2)}`]).ok).toBe(true);
		expect(endPlayerTurn).toHaveBeenCalledTimes(1);

		await settle();
		endPlayerTurn.mockRestore();
		combat.unmount();
	});
});

/**
 * ScreenManager builds a new screen for every navigate, but the screen itself
 * shouldn't depend on that: a remount rebuilds cleanly, and a load that lands
 * after an unmount leaves nothing behind.
 */
describe('CombatScreen: mount and unmount', () => {
	const canvas = document.createElement('canvas');

	beforeAll(() => {
		document.body.appendChild(canvas);
		context.input.setup(canvas);
	});

	beforeEach(() => {
		Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
		Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 768 });
	});

	async function settle(): Promise<void> {
		await flushPromises();
		await flushPromises();
	}

	/** Every handler of every kind the InputSystem holds */
	function inputRegistrations(): number {
		const input = context.input as unknown as Record<string, Map<unknown, unknown>>;
		return ['mouseOverComponents', 'mouseOutComponents', 'mouseDownComponents', 'mouseUpComponents', 'wheelComponents', 'keyDownComponents', 'globalKeyDownHandlers']
			.reduce((total, key) => total + input[key].size, 0);
	}

	function modelListeners(combat: CombatScreen): number {
		const model = combat['combatModel'];
		return model.eventNames().reduce((total, event) => total + model.listenerCount(event), 0);
	}

	it('a remount builds the same layers and listeners as the first mount, and END TURN fires once', async () => {
		const combat = new CombatScreen();
		combat.mount(context);
		await settle();
		const firstMount = {
			layers: combat.root.getChildren().length,
			listeners: modelListeners(combat),
			input: inputRegistrations(),
		};

		combat.unmount();
		combat.mount(context);
		await settle();
		expect({
			layers: combat.root.getChildren().length,
			listeners: modelListeners(combat),
			input: inputRegistrations(),
		}).toEqual(firstMount);

		const endPlayerTurn = jest.spyOn(Battle.prototype, 'endPlayerTurn');
		expect(injectInput({ canvas, input: context.input }, ['click,954,26']).ok).toBe(true);
		expect(endPlayerTurn).toHaveBeenCalledTimes(1);

		await settle();
		endPlayerTurn.mockRestore();
		combat.unmount();
	});

	it.each([
		['with drivers', async () => ({ drivers: await selectDrivers() })],
		['on the dev fallback', async () => undefined],
	])('a load that lands after an early unmount starts no fight and leaves nothing registered (%s)', async (_label, makeData) => {
		const data = await makeData();
		const before = inputRegistrations();

		const combat = new CombatScreen();
		combat.mount(context, data);
		combat.unmount();
		await settle();

		expect(combat.getBattleState()).toBeNull();
		expect(inputRegistrations()).toBe(before);
		expect(modelListeners(combat)).toBe(0);
	});
});
