/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen, PreparedCombatMount } from './CombatScreen';
import { PlayerHandLayer } from './PlayerHandLayer';
import { CardLoader } from '../../core/CardLoader';
import { Rng } from '../../core/Rng';
import { createTestContext } from '../../../engine/components/testing';
import type { Component } from '../../../engine/components/Component';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { Text } from '../../../engine/components/Text';
import { Battle } from '../../mechanics/Battle';
import { Deck } from '../../mechanics/Deck';
import { DRIVER_CONFIGS, Driver, DriverRole } from '../../mechanics/Driver';
import { createEscort } from '../../mechanics/Escort';
import { Team, TeamType } from '../../mechanics/Team';
import { createDrivenVehicle } from '../../mechanics/Vehicle';

/**
 * DDB-166: a fight with one driver, a run down to its last. The dock keeps
 * its two halves: the driver's tab and hand in the first, and the second an
 * empty seat with no tab and no hand.
 */

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const viewport = { width: 1440, height: 882 };
const originalFetch = global.fetch;

function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

function newContext(width: number, height: number): ReturnType<typeof createTestContext> {
	viewport.width = width;
	viewport.height = height;
	return createTestContext({
		draw: createMeasuringDrawApi().api,
		viewport: { get logical() { return { ...viewport }; } },
	});
}

function texts(component: { children: readonly unknown[] }): string[] {
	const found: string[] = [];
	for (const child of component.children) {
		const node = child as { text?: unknown; children: readonly unknown[]; visible?: boolean };
		if (node.visible === false) continue;
		if (node instanceof Text) found.push(node.text);
		found.push(...texts(node));
	}
	return found;
}

function findById(component: Component, id: string): Component | null {
	if (component.id === id) return component;
	for (const child of component.children) {
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}

/** Visible all the way up to `top`. */
function shown(component: Component | null, top: Component): boolean {
	for (let node: Component | null = component; node; node = node.parent) {
		if (!node.visible) return false;
		if (node === top) return true;
	}
	return false;
}

/** The Interceptor alone with an Outrider and a Med Truck, against a raider with nothing to play. */
function soloFight(): PreparedCombatMount {
	const config = DRIVER_CONFIGS.interceptor;
	const interceptor = new Driver({
		archetype: config.id,
		metadata: { ...config.metadata, name: 'Interceptor 2' },
		skills: { ...config.skills },
		vehicleStats: { ...config.vehicleStats },
		startingDeck: config.startingDeck,
		hitpoints: config.maxHitpoints,
		maxHitpoints: config.maxHitpoints,
		adrenaline: config.maxAdrenaline,
		maxAdrenaline: config.maxAdrenaline,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: null,
	});
	interceptor.createStartingDeck(CardLoader.getInstance().getAllCardsAsMap());
	const raider = new Driver({
		archetype: 'raider',
		metadata: { name: 'Scrapper', vehicleName: 'Rust Buggy', specialty: 'TEST RAIDER', flavorText: '', unlocked: true },
		skills: { ramming: 0, gunnery: 0, evade: 0, speed: 1 },
		vehicleStats: { maxStructure: 30, weight: 1, armor: 0, speed: 1, gunnery: 0, evade: 0 },
		startingDeck: { cards: [] },
		hitpoints: 30,
		maxHitpoints: 30,
		adrenaline: 1,
		maxAdrenaline: 1,
		handLimit: 7,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck('scrapper', "Scrapper's deck", []),
	});
	const battle = new Battle({
		playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [createDrivenVehicle({ driver: interceptor }), createEscort({ type: 'outrider' }), createEscort({ type: 'med_truck' })] }),
		enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [createDrivenVehicle({ driver: raider })] }),
		rng: new Rng({ seed: 166 }),
	});
	battle.start();
	return { prepare: async () => ({ battle, drivers: [interceptor] }) };
}

async function mountSolo(context: ReturnType<typeof createTestContext>): Promise<CombatScreen> {
	const combat = new CombatScreen();
	combat.mount(context, soloFight());
	await flushPromises();
	await flushPromises();
	context.frame.layout();
	return combat;
}

beforeAll(async () => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
	global.fetch = jest.fn().mockResolvedValue({ ok: true, statusText: 'OK', json: async () => cardsFile }) as unknown as typeof fetch;
	await CardLoader.getInstance().loadCards();
});

afterAll(() => {
	global.fetch = originalFetch;
	jest.restoreAllMocks();
});

describe('CombatScreen with one driver (DDB-166)', () => {
	it.each([[1024, 600], [1440, 882]])('shows one tab and one hand, and the second seat empty, at %ix%i at lint zero', async (width, height) => {
		const context = newContext(width, height);
		const combat = await mountSolo(context);
		const layer: PlayerHandLayer = combat['handLayer'];
		const [driver] = combat['playerDrivers'];

		expect(combat['playerDrivers']).toHaveLength(1);
		expect(layer.driverCount).toBe(1);
		expect(shown(layer.tabOf(1), layer)).toBe(true);
		expect(texts(layer.tabOf(1))).toContain('Interceptor 2');
		expect(shown(layer.tabOf(2), layer)).toBe(false);
		expect(shown(findById(layer, 'driver2_hand'), layer)).toBe(false);
		const emptySeat = findById(layer, 'driver2_empty_seat');
		expect(shown(emptySeat, layer)).toBe(true);
		expect(emptySeat && texts(emptySeat)).toEqual(['Empty seat: one driver on this run']);
		expect(layer.handCards).toEqual(driver.hand);
		expect(layer.handCards.every(card => layer.seatOf(card) === 1)).toBe(true);

		expect(layoutLint(treeSnapshot([combat.root], { ...viewport })).violations).toEqual([]);
		combat.unmount();
	});

	it('opens the log on the lone driver against the raiders', async () => {
		const combat = await mountSolo(newContext(1440, 882));

		expect(combat['combatLog'].entries[0].message).toBe('Interceptor 2 vs Rust Buggy');
		combat.unmount();
	});

	it('plays a turn through, the raiders\' included, and deals the lone driver a new hand', async () => {
		const context = newContext(1440, 882);
		const combat = await mountSolo(context);
		const battle = combat['battle'];
		if (!battle) throw new Error('the fight should have mounted');

		battle.endPlayerTurn();
		combat['updateUIFromBattle']();
		context.frame.layout();

		expect([battle.turn, battle.isPlayerTurn]).toEqual([2, true]);
		expect(combat['handLayer'].handCards).toEqual(combat['playerDrivers'][0].hand);
		combat.unmount();
	});
});

describe('PlayerHandLayer seats', () => {
	it('brings the second tab and hand back with a second driver, and keeps a crash-out note out of an empty seat', () => {
		const layer = new PlayerHandLayer();
		const note = (id: string): Component | null => findById(layer, id);

		layer.driverCount = 1;
		layer.setDriverData(2, { crashedOut: true });
		expect([shown(layer.tabOf(2), layer), shown(note('driver2_crashed_out'), layer), shown(note('driver2_empty_seat'), layer)]).toEqual([false, false, true]);

		layer.driverCount = 2;
		expect(layer.driverCount).toBe(2);
		expect([shown(layer.tabOf(2), layer), shown(note('driver2_crashed_out'), layer), shown(note('driver2_empty_seat'), layer)]).toEqual([true, true, false]);
		expect(shown(note('driver2_hand'), layer)).toBe(false);

		layer.setDriverData(2, { crashedOut: false });
		expect(shown(note('driver2_hand'), layer)).toBe(true);
	});
});
