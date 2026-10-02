/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
// ScreenManager first, as the game loads it: it and the screens import each
// other, and loading a screen first leaves it undefined in the registry
import { ScreenManager } from '../../core/ScreenManager';
import { CombatScreen } from './CombatScreen';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { Battle } from '../../mechanics/Battle';
import { Card as UICard } from '../../ui/Card';
import type { Component } from '../../../engine/components/Component';
import { createTestContext, injectNow } from '../../../engine/components/testing';
import { PointerAdapter } from '../../../engine/input/PointerAdapter';

/**
 * The play that ends a fight navigates to the result screen through the
 * screen transition, so combat stays mounted under the fade out and unmounts
 * at the swap. Whatever combat did after unmounting used to rebuild the hand
 * on the detached layer, leaving live cards under the result screen that
 * played into the finished battle when clicked. Neither window may let a
 * card play: under the fade the transition takes every press, after the
 * swap the cards are gone.
 */

const originalFetch = global.fetch;
const canvas = document.createElement('canvas');

function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

async function settle(): Promise<void> {
	await flushPromises();
	await flushPromises();
}

function click(spot: string): void {
	expect(injectNow({ canvas, dispatcher: context.dispatcher }, [`click,${spot}`]).ok).toBe(true);
}

/** The centre of a component on screen, after the frame's layout, as `x,y` for a click */
function centerOf(component: Component): string {
	context.frame.layout();
	const { x, y, width, height } = component.screenBounds;
	return `${Math.round(x + width / 2)},${Math.round(y + height / 2)}`;
}

/** Hand cards still reachable by a click at any of the spots */
function cardsHitAt(spots: string[]): number {
	return spots
		.map(spot => {
			const [x, y] = spot.split(',').map(Number);
			return context.dispatcher.hitTest({ x, y });
		})
		.filter(component => component instanceof UICard).length;
}

async function openCombat(): Promise<CombatScreen> {
	ScreenManager.navigate('combatScreen', undefined, { immediate: true });
	await settle();
	const combat = ScreenManager.activeScreen;
	if (!(combat instanceof CombatScreen)) throw new Error('combat should be the active screen');
	return combat;
}

/** Where every card in the hand sits right now */
function cardSpots(combat: CombatScreen): string[] {
	return combat['playerDrivers']
		.flatMap(driver => driver.hand)
		.map(card => combat['handLayer'].getCardElementByCard(card))
		.filter((element): element is UICard => element !== null)
		.map(centerOf);
}

/** No click where a card was reaches combat or the finished battle */
function expectNoCardPlays(spots: string[]): void {
	expect(cardsHitAt(spots)).toBe(0);
	const chooseCard = jest.spyOn(CombatScreen.prototype as unknown as { chooseCard: () => boolean }, 'chooseCard');
	const playCard = jest.spyOn(Battle.prototype, 'playCard');
	spots.forEach(click);
	expect(chooseCard).not.toHaveBeenCalled();
	expect(playCard).not.toHaveBeenCalled();
	chooseCard.mockRestore();
	playCard.mockRestore();
}

/** Under the fade out with combat still mounted, then on the result screen */
function expectCardsGone(spots: string[]): void {
	expect(ScreenManager.transitioning).toBe(true);
	expect(ScreenManager.getCurrentScreenName()).toBe('combatScreen');
	expectNoCardPlays(spots);

	context.animator.settle();
	expect(ScreenManager.getCurrentScreenName()).toBe('battleResultScreen');
	expectNoCardPlays(spots);
}


/**
 * Mounted the way the page mounts screens. The viewport follows the window,
 * because these tests size the window and the screens still read it.
 */
const context = createTestContext({
	viewport: { get logical() { return { width: window.innerWidth, height: window.innerHeight }; } },
});
beforeAll(async () => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
	global.fetch = jest.fn().mockResolvedValue({
		ok: true,
		statusText: 'OK',
		json: async () => cardsFile,
	}) as unknown as typeof fetch;
	await CardLoader.getInstance().loadCards();
	await DriverLoader.getInstance().loadDrivers();

	Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
	Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 768 });
	document.body.appendChild(canvas);
	new PointerAdapter({ dispatcher: context.dispatcher }).attach(canvas);
	ScreenManager.initialize(context);
});

afterAll(() => {
	global.fetch = originalFetch;
	jest.restoreAllMocks();
});

describe('CombatScreen: the fight ending leaves no combat cards behind', () => {
	it('after the winning card play', async () => {
		const combat = await openCombat();
		const [driver] = combat['playerDrivers'];
		const raider = combat['enemyTeam']?.vehicles[0];
		if (!raider?.driver) throw new Error('the dev fight should field a driven raider');

		// A Headshot that can't miss on a raider one hit from dead
		const headshot = CardLoader.getInstance().createCard('headshot');
		if (!headshot) throw new Error('headshot should load');
		raider.driver.set({ hitpoints: 1 });
		driver.set({
			hand: [...driver.hand, headshot],
			adrenaline: driver.maxAdrenaline,
			skills: { ...driver.skills, gunnery: 20 },
		});
		combat['updateUIFromBattle']();

		const spots = cardSpots(combat);
		const headshotElement = combat['handLayer'].getCardElementByCard(headshot);
		const raiderPlate = combat['road'].vehicleView(raider.id);
		if (!headshotElement || !raiderPlate) throw new Error('the Headshot and the raider should be on screen');

		click(centerOf(headshotElement));
		expect(combat['combatModel'].targetableVehicleIds).toContain(raider.id);
		click(centerOf(raiderPlate));

		expect(combat.battleState?.battleWon).toBe(true);
		expectCardsGone(spots);
	});

	it('after the enemy turn that loses the fight', async () => {
		// Seeded, so the shuffles and the raider's plan are the same every run
		let seed = 20260927;
		const random = jest.spyOn(Math, 'random').mockImplementation(() => {
			seed = (seed + 0x6d2b79f5) >>> 0;
			let t = seed;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		});
		const combat = await openCombat();
		random.mockRestore();
		const playerTeam = combat['playerTeam'];
		const raider = combat['enemyTeam']?.vehicles[0];
		if (!playerTeam || !raider?.driver) throw new Error('the dev fight should field both teams');

		// One driver already dead, and the raider's first shot kills the
		// other: it plans its whole turn at the Rig, and can't miss
		raider.driver.set({ skills: { ...raider.driver.skills, gunnery: 20, ramming: 20 } });
		const [rigDriver, bikeDriver] = combat['playerDrivers'];
		const bike = playerTeam.vehicles.find(vehicle => vehicle.driver === bikeDriver);
		if (!bike) throw new Error('the second driver should be driving');
		bikeDriver.set({ hitpoints: 0 });
		playerTeam.handleDriverDeath(bike);
		rigDriver.set({ hitpoints: 1, skills: { ...rigDriver.skills, evade: 0 } });
		combat['updateUIFromBattle']();
		const spots = cardSpots(combat);
		expect(spots.length).toBeGreaterThan(0);

		const endTurn = combat['endTurnColumn'].endTurn;
		click(centerOf(endTurn));
		await settle();

		expect(combat.battleState?.battleWon).toBe(false);
		expectCardsGone(spots);
	});
});
