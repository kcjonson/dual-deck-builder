/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen } from './CombatScreen';
import { DOCK_HAND_CAP } from './CombatLayout';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { Rng } from '../../core/Rng';
import { createTestContext } from '../../../engine/components/testing';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { Card } from '../../mechanics/Card';
import { Driver, DriverRole } from '../../mechanics/Driver';
import type { VehicleMod } from '../../mechanics/Vehicle';
import { Card as UICard } from '../../ui/Card';
import { Text } from '../../../engine/components/Text';

/**
 * DDB-136, Battle Screen Design section 4: the split dock at its worst
 * cases, both hands at the cap of seven, six mods, adrenaline past six,
 * a passenger, and a driver who crashed out (DDB-167).
 */

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const viewport = { width: 1440, height: 882 };
const originalFetch = global.fetch;

const SIX_MODS: VehicleMod[] = [
	{ name: 'Reactive Armor', kind: 'defense' },
	{ name: 'Auto-Repair', kind: 'defense' },
	{ name: 'Expanded Tank', kind: 'utility' },
	{ name: 'Spiked Bumper', kind: 'offense' },
	{ name: 'Nitrous System', kind: 'utility' },
	{ name: 'Card Printer', kind: 'utility' },
];

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

/** The screen on its default fight, or seating `drivers` when given. */
async function startCombat(context: ReturnType<typeof createTestContext>, drivers?: Driver[]): Promise<CombatScreen> {
	const combat = new CombatScreen();
	combat.mount(context, drivers ? { drivers } : undefined);
	await flushPromises();
	await flushPromises();
	context.frame.layout();
	return combat;
}

/** `count` fresh cards from the catalogue, cheapest first so some are affordable. */
function cards(count: number): Card[] {
	const ids = [...CardLoader.getInstance().getAllCardsAsMap().keys()];
	return Array.from({ length: count }, (_unused, index) => CardLoader.getInstance().createCard(ids[index % ids.length]) as Card);
}

function handElements(combat: CombatScreen): UICard[] {
	const layer = combat['handLayer'];
	return layer.handCards.map(card => layer.getCardElementByCard(card)).filter((card): card is UICard => card !== null);
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

describe('CombatScreen dock (DDB-136)', () => {
	it.each([[1024, 600], [1440, 882]])('holds two hands at the cap, six mods, and adrenaline past six at %ix%i at lint zero', async (width, height) => {
		const context = newContext(width, height);
		const combat = await startCombat(context);
		const [first, second] = combat['playerDrivers'];
		first.set({ hand: cards(DOCK_HAND_CAP), maxAdrenaline: 8, adrenaline: 7 });
		second.set({ hand: cards(DOCK_HAND_CAP) });
		combat['playerTeam']?.vehicles.forEach(vehicle => vehicle.set({ mods: SIX_MODS }));
		combat['updateUIFromBattle']();
		context.frame.layout();

		const layer = combat['handLayer'];
		expect(handElements(combat)).toHaveLength(DOCK_HAND_CAP * 2);
		// Three mod icons, then "+3" naming the rest
		const mods = layer.tabOf(1).modChips;
		expect(mods).toHaveLength(4);
		expect(texts(mods[3] as unknown as { children: readonly unknown[] })).toEqual(['+3']);
		expect(mods[3].tooltip?.description).toBe('Spiked Bumper, Nitrous System, Card Printer');
		// One bolt and the count past six
		expect(texts(layer.tabOf(1))).toContain('7/8');

		// At the cap about 68 px of each card shows (section 4), every card inside its half
		const half = layer.tabOf(1).parent;
		const elements = handElements(combat).slice(0, DOCK_HAND_CAP);
		const scale = Math.max(0.8, Math.min(width / 1280, height / 720));
		const step = (elements[1].screenBounds.x - elements[0].screenBounds.x) / scale;
		expect(step).toBeGreaterThan(60);
		expect(step).toBeLessThan(72);
		const halfBounds = half?.screenBounds;
		for (const element of elements) {
			expect(element.screenBounds.x).toBeGreaterThanOrEqual((halfBounds?.x ?? 0) - 1e-6);
		}

		expect(layoutLint(treeSnapshot([combat.root], { ...viewport })).violations).toEqual([]);
		combat.unmount();
	});

	// A driver's own hand limit can pass the dock's cap. Nothing clamps the
	// rule to the dock: a draw fills the hand to the driver's limit, and the
	// fan overlaps tighter, so every card stays in the half and keeps a strip
	// of itself showing, though past the cap is undesigned and the fit suite
	// flags it. The limit is raised before the screen seats the driver, so a
	// clamp at the seat fails this too.
	it.each([[1024, 600], [1440, 882]])('fans a hand drawn past the dock\'s cap inside its half at %ix%i at lint zero', async (width, height) => {
		const context = newContext(width, height);
		const pastCap = DOCK_HAND_CAP + 3;
		const seated = DriverLoader.getInstance().getUnlockedDrivers().slice(0, 2);
		seated[0].handLimit = pastCap;
		const combat = await startCombat(context, seated);
		const [first, second] = combat['playerDrivers'];
		first.deck?.addCards(cards(pastCap));
		expect(first.drawCards(pastCap - first.hand.length, new Rng({ seed: 1 })).burned).toEqual([]);
		expect(first.hand).toHaveLength(pastCap);
		second.set({ hand: cards(DOCK_HAND_CAP) });
		combat['updateUIFromBattle']();
		context.frame.layout();

		const half = combat['handLayer'].tabOf(1).parent?.screenBounds;
		if (!half) throw new Error('driver 1 should have a half of the dock');
		const elements = handElements(combat).slice(0, pastCap);
		expect(elements.map(element => element.data)).toEqual(first.hand);
		const scale = Math.max(0.8, Math.min(width / 1280, height / 720));
		elements.forEach((element, index) => {
			const { x, width: cardWidth } = element.screenBounds;
			expect(x).toBeGreaterThanOrEqual(half.x - 1e-6);
			expect(x + cardWidth).toBeLessThanOrEqual(half.x + half.width + 1e-6);
			if (index > 0) expect((x - elements[index - 1].screenBounds.x) / scale).toBeGreaterThan(30);
		});

		expect(layoutLint(treeSnapshot([combat.root], { ...viewport })).violations).toEqual([]);
		combat.unmount();
	});

	it('shows no mods while a driver rides as a passenger', async () => {
		const context = newContext(1440, 882);
		const combat = await startCombat(context);
		const [first] = combat['playerDrivers'];
		combat['playerTeam']?.vehicles.forEach(vehicle => vehicle.set({ mods: SIX_MODS }));
		first.set({ role: DriverRole.PASSENGER });
		combat['updateUIFromBattle']();
		context.frame.layout();

		const layer = combat['handLayer'];
		expect(texts(layer.tabOf(1))).toContain('PASSENGER');
		expect(layer.tabOf(1).modChips.every(chip => !chip.parent?.visible)).toBe(true);
		expect(layer.tabOf(2).modChips).toHaveLength(4);
		combat.unmount();
	});

	it.each([[1024, 600], [1440, 882]])('hides the hand of a driver who crashed out and says so, at %ix%i at lint zero (DDB-167)', async (width, height) => {
		const context = newContext(width, height);
		const combat = await startCombat(context);
		const [first, second] = combat['playerDrivers'];
		// Wrecked with no free seat: alive, and aboard nothing
		const wreck = combat['playerTeam']?.vehicles.find(vehicle => vehicle.driver === second);
		wreck?.set({ driver: null });
		combat['updateUIFromBattle']();
		context.frame.layout();

		const layer = combat['handLayer'];
		expect(second.isAlive()).toBe(true);
		expect(second.hand.length).toBeGreaterThan(0);
		expect(layer.handCards.every(card => first.hand.includes(card))).toBe(true);
		expect(texts(layer.tabOf(2))).toContain('CRASHED OUT');
		expect(texts(layer.tabOf(2)).some(text => text.includes('/'))).toBe(false);
		expect(combat.root.findById('driver2_crashed_out')?.visible).toBe(true);
		expect(combat.root.findById('driver2_hand')?.visible).toBe(false);
		// Their adrenaline isn't counted as unspent
		const warning = combat.root.findById('end_turn_warning') as Text | null;
		expect(warning?.text).toBe(first.adrenaline > 0 ? `${first.adrenaline} adrenaline unspent` : '');

		expect(layoutLint(treeSnapshot([combat.root], { ...viewport })).violations).toEqual([]);
		combat.unmount();
	});

	it('keeps a card\'s element, and the detail view pinned on it, when the hand deals again', async () => {
		const context = newContext(1440, 882);
		const combat = await startCombat(context);
		const [first] = combat['playerDrivers'];
		const pinned = handElements(combat)[1];
		context.tooltips.pin(pinned, { fade: false });
		expect(context.tooltips.pinned).toBe(pinned);

		// A card drawn and one played away: the hand deals again around the pinned one
		const [drawn] = cards(1);
		first.set({ hand: [...first.hand.filter(card => card !== first.hand[0]), drawn] });
		combat['updateUIFromBattle']();
		context.frame.layout();

		const layer = combat['handLayer'];
		expect(layer.getCardElementByCard(pinned.data)).toBe(pinned);
		expect(pinned.isMounted).toBe(true);
		expect(context.tooltips.pinned).toBe(pinned);
		const ids = handElements(combat).map(element => element.id);
		expect(new Set(ids).size).toBe(ids.length);
		combat.unmount();
	});
});
