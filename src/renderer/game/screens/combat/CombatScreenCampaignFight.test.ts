/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen, PreparedCombatMount } from './CombatScreen';
import { CardLoader } from '../../core/CardLoader';
import { Rng } from '../../core/Rng';
import { createTestContext } from '../../../engine/components/testing';
import { Text } from '../../../engine/components/Text';
import { Team, TeamType } from '../../mechanics/Team';
import { Driver, DriverArchetype, DriverRole } from '../../mechanics/Driver';
import { Deck } from '../../mechanics/Deck';
import { createDrivenVehicle } from '../../mechanics/Vehicle';
import { NO_RESOURCES } from '../../campaign/Campaign';
import { CAMPAIGN_START } from '../../campaign/CampaignStart';
import { NO_CARDS } from '../../campaign/CardCounts';
import { startCampaignFight } from '../../campaign/CombatBridge';
import { DriverRecord } from '../../campaign/DriverRecord';
import { foundCampaign } from '../../campaign/Founding';

/**
 * DDB-286: a fight the combat bridge builds from the campaign is the
 * screen's PreparedCombat, so it mounts through `prepare` like the gallery's
 * scenes, with the records' names on the dock and the run's cargo on the top
 * bar.
 */

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const SEED = 20261008;
const originalFetch = global.fetch;

function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
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

function raiderTeam(): Team {
	const driver = new Driver({
		archetype: 'raider',
		metadata: { name: 'Scrapper', vehicleName: 'Scrap Buggy', specialty: 'TEST RAIDER', flavorText: 'Built to lose.', unlocked: true },
		skills: { ramming: 0, gunnery: 0, evade: 0, speed: 1 },
		vehicleStats: { maxStructure: 1, weight: 1, armor: 0, speed: 1, gunnery: 0, evade: 0 },
		startingDeck: { cards: [] },
		hitpoints: 1,
		maxHitpoints: 1,
		adrenaline: 1,
		maxAdrenaline: 1,
		handLimit: 7,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck('scrapper', "Scrapper's deck", [])
	});
	return new Team({ type: TeamType.ENEMY, vehicles: [createDrivenVehicle({ driver })] });
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

describe('CombatScreen: a campaign fight (DDB-286)', () => {
	it('mounts through prepare, showing the records\' names, the run\'s escorts, and the run\'s cargo rather than the stores', async () => {
		const campaign = foundCampaign({
			seed: SEED,
			unlockedArchetypes: ['road_warrior', 'interceptor'],
			start: { ...CAMPAIGN_START, resources: { ...CAMPAIGN_START.resources, scrap: 150, fuel: 10 }, escorts: ['outrider'] }
		});
		const seat = (archetype: DriverArchetype): DriverRecord => {
			const record = campaign.drivers.find(driver => driver.archetype === archetype);
			if (!record) throw new Error(`founding should have dealt a ${archetype}`);
			return record;
		};
		const [outrider] = campaign.convoy.escorts;
		const seats = [seat('road_warrior'), seat('interceptor')];
		campaign.startRunDecks({ seats, escorts: [outrider] });
		const fight = startCampaignFight({
			campaign,
			party: { seats, escorts: [outrider], cargo: { ...NO_RESOURCES, scrap: 73, fuel: 9 }, cargoCards: NO_CARDS },
			enemyTeam: raiderTeam(),
			rng: new Rng({ seed: SEED }),
			cards: CardLoader.getInstance().getAllCardsAsMap()
		});
		const mount: PreparedCombatMount = { prepare: async () => fight };

		const combat = new CombatScreen();
		combat.mount(createTestContext(), mount);
		await flushPromises();
		await flushPromises();

		expect(combat.battleState?.playerTeam).toBe(fight.battle.playerTeam);
		expect(combat['playerDrivers']).toEqual(fight.drivers);
		const dock = combat['handLayer'];
		expect(texts(dock.tabOf(1))).toContain('Road Warrior 1');
		expect(texts(dock.tabOf(2))).toContain('Interceptor 1');
		expect(combat['playerTeam']?.escorts).toEqual([outrider]);
		const topBar = texts(combat['topBar']);
		expect(topBar).toContain('73');
		expect(topBar).toContain('9');
		expect(topBar).not.toContain('150');
		combat.unmount();
	});
});
