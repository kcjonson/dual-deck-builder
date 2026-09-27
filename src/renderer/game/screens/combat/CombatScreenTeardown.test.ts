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
import { Layer } from '../../../engine/components/Layer';
import { InputSystem } from '../../../engine/input/InputSystem';
import { injectInput } from '../../../engine/debug/inputInjection';

/**
 * The play that ends a fight navigates to the result screen, which unmounts
 * combat before the play returns. Whatever combat did after that used to
 * rebuild the hand on the detached layer, leaving live cards under the result
 * screen that played into the finished battle when clicked.
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
	expect(injectInput(canvas, [`click,${spot}`]).ok).toBe(true);
}

/** The global centre of a layer, as `x,y` for a click */
function centerOf(layer: Layer): string {
	const { x, y } = layer.localToGlobal(0, 0);
	return `${Math.round(x + layer.getWidth() / 2)},${Math.round(y + layer.getHeight() / 2)}`;
}

/** Combat hand cards the InputSystem still hit-tests */
function cardRegistrations(): number {
	const input = InputSystem.getInstance() as unknown as Record<string, Map<unknown, unknown>>;
	const components = new Set<unknown>();
	for (const key of ['mouseOverComponents', 'mouseOutComponents', 'mouseDownComponents', 'mouseUpComponents']) {
		for (const component of input[key].keys()) components.add(component);
	}
	return [...components].filter(component => component instanceof UICard).length;
}

async function openCombat(): Promise<CombatScreen> {
	ScreenManager.navigate('combatScreen');
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
function expectCardsGone(spots: string[]): void {
	expect(ScreenManager.getCurrentScreenName()).toBe('battleResultScreen');
	expect(cardRegistrations()).toBe(0);

	const onCardSelected = jest.spyOn(CombatScreen.prototype as unknown as { onCardSelected: () => void }, 'onCardSelected');
	const playCard = jest.spyOn(Battle.prototype, 'playCard');
	spots.forEach(click);
	expect(onCardSelected).not.toHaveBeenCalled();
	expect(playCard).not.toHaveBeenCalled();
	onCardSelected.mockRestore();
	playCard.mockRestore();
}

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
	InputSystem.getInstance().setup(canvas);
	ScreenManager.initialize();
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
			hand: [headshot, ...driver.hand],
			adrenaline: driver.maxAdrenaline,
			skills: { ...driver.skills, gunnery: 20 },
		});
		combat['updateUIFromBattle']();

		const spots = cardSpots(combat);
		const headshotElement = combat['handLayer'].getCardElementByCard(headshot);
		const raiderPlate = combat['enemyLayer']['vehicleCards'].get(raider.id);
		if (!headshotElement || !raiderPlate) throw new Error('the Headshot and the raider should be on screen');

		click(centerOf(headshotElement));
		expect(combat['combatModel'].targetableVehicleIds).toContain(raider.id);
		click(centerOf(raiderPlate));

		expect(combat.getBattleState()?.battleWon).toBe(true);
		expectCardsGone(spots);
	});

	it('after the enemy turn that loses the fight', async () => {
		const combat = await openCombat();
		const playerTeam = combat['playerTeam'];
		if (!playerTeam) throw new Error('the dev fight should field a player team');

		// One driver already dead, and every raider shot that lands kills the
		// other: the dev fight's raider plans its whole turn at the Rig
		const [rigDriver, bikeDriver] = combat['playerDrivers'];
		const bike = playerTeam.vehicles.find(vehicle => vehicle.driver === bikeDriver);
		if (!bike) throw new Error('the second driver should be driving');
		bikeDriver.set({ hitpoints: 0 });
		playerTeam.handleDriverDeath(bike);
		rigDriver.set({ hitpoints: 1, skills: { ...rigDriver.skills, evade: 0 } });
		combat['updateUIFromBattle']();
		const spots = cardSpots(combat);
		expect(spots.length).toBeGreaterThan(0);

		const endTurn = combat['resourceLayer']['endTurnButton'];
		click(centerOf(endTurn));
		await settle();

		expect(combat.getBattleState()?.battleWon).toBe(false);
		expectCardsGone(spots);
	});
});
