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

/**
 * DDB-157: START RUN used to hand DriverLoader's template drivers straight to
 * combat, which mutates them in place, so a second run in the same session
 * started with the first run's damage, hand, and discard.
 */

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * The drivers START RUN sends to combat from a freshly mounted selection screen
 */
async function selectDrivers(): Promise<Driver[]> {
	const selection = new DriverSelectionScreen();
	selection.mount();
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

describe('CombatScreen: each run starts from fresh drivers', () => {
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

	it('a second run with the same selection starts at full HP with a new deck and an empty discard', async () => {
		const firstRun = await selectDrivers();
		await new CombatScreen().initializeCombat(firstRun);
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

		await new CombatScreen().initializeCombat(secondRun);
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
		await new CombatScreen().initializeCombat(drivers);
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
		combat.mount();
		await flushPromises();
		await flushPromises();

		const state = combat.getBattleState();
		expect(state).not.toBeNull();
		for (const template of loader.getUnlockedDrivers()) {
			expect(template.hitpoints).toBe(template.maxHitpoints);
			expect(template.hand).toEqual([]);
			expect(template.deck).toBeNull();
		}
	});
});
