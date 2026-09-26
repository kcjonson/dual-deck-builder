import cardsFile from '../data/cards.json';
import { DriverLoader } from './DriverLoader';
import { CardLoader } from './CardLoader';
import { DRIVER_CONFIGS } from '../mechanics/Driver';

describe('DriverLoader never hands out its templates', () => {
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

	it('returns a fresh driver on every call, so mutating one never reaches the next', () => {
		const first = loader.getDriver('road_warrior');
		if (!first) throw new Error('road_warrior should load');
		first.takeDamage(10);
		first.startingDeck.cards[0].quantity = 99;

		const second = loader.getDriver('road_warrior');
		expect(second).not.toBe(first);
		expect(second?.hitpoints).toBe(second?.maxHitpoints);
		expect(second?.startingDeck.cards[0].quantity).toBe(DRIVER_CONFIGS.road_warrior.startingDeck.cards[0].quantity);
		expect(loader.getAllDrivers()).not.toContain(first);
	});

	it('builds a starting deck on the returned driver, not the template', async () => {
		const driver = await loader.createDriverWithStartingDeck('interceptor');
		expect(driver?.deck?.cards.length).toBeGreaterThan(0);
		expect(loader.getDriver('interceptor')?.deck).toBeNull();
	});

	it('unlocks a driver for later getters without editing DRIVER_CONFIGS', () => {
		expect(loader.getDriver('raider')?.metadata.unlocked).toBe(false);

		loader.unlockDriver('raider');

		expect(loader.getDriver('raider')?.metadata.unlocked).toBe(true);
		expect(DRIVER_CONFIGS.raider.metadata.unlocked).toBe(false);

		loader.resetUnlockState();
		expect(loader.getDriver('raider')?.metadata.unlocked).toBe(false);
	});
});
