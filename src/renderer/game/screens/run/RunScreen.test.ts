/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import type { Text } from '../../../engine/components/Text';
import type { Button } from '../../../engine/ui/Button';
import { key, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { ScreenManager } from '../../core/ScreenManager';
import { Campaign } from '../../campaign/Campaign';
import type { CampaignStore, CheckpointResult } from '../../campaign/CampaignStore';
import { RunRoute, routeStops } from '../../campaign/SupplyRoutes';
import { StopFightResult, finishStopFight, rewardOffer, startStopFight } from '../../campaign/SupplyRun';
import { fightOut, pushovers, snipers } from '../../campaign/__fixtures__/runFixtures';
import { Card as GameCard } from '../../mechanics/Card';
import { CardPileView } from '../../ui/CardPileView';
import { cardData } from '../../ui/testing';
import { CAMPAIGN_FIXTURE, FaultyStorage, fixtureText, saveText, storageWith, storeOver } from '../../campaign/__fixtures__/storeFixtures';
import type { PreparedCombatMount } from '../combat/CombatScreen';
import { RunScreen, RunScreenData, stopFightMount } from './RunScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

const CARDS: ReadonlyMap<string, GameCard> = new Map(cardData.map((data) => [data.type, new GameCard({ ...data })]));

/** The fixture's run, its reward picked, then driving on to `stop` with nothing else changed, as save text. */
function drivingText(stop: number): string {
	return fixtureText((campaign) => {
		const run = campaign.supplyRun as { stop: number; phase: string };
		run.stop = stop;
		run.phase = 'driving';
	});
}

describe('RunScreen', () => {
	const viewport = { logical: { width: 1440, height: 882 } };
	let context: MountContext;
	let screen: RunScreen;
	let store: CampaignStore;
	let storage: FaultyStorage;

	/** Mounts the screen over this save text, loading it as Continue would, and waits for it and the cards. */
	async function open(text = fixtureText(), data?: RunScreenData): Promise<void> {
		storage = storageWith(text);
		store = storeOver(storage);
		screen = new RunScreen({ store, cards: async () => CARDS });
		screen.mount(context, data);
		await screen.campaignLoaded;
		context.frame.layout();
	}

	function find<T>(id: string): T {
		const found = screen.root.findById(id) ?? context.overlays.roots.map((root) => root.findById(id)).find(Boolean);
		if (!found) throw new Error(`no ${id}`);
		return found as unknown as T;
	}

	function text(id: string): string {
		return find<Text>(id).text;
	}

	async function press(id: string): Promise<void> {
		find<Button>(id).onClick?.({} as never);
		for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
	}

	/** The saved campaign, read back. */
	async function saved(): Promise<Campaign | null> {
		return storeOver(storage).load();
	}

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1440, height: 882 };
		context = createTestContext({ viewport, clock: new Clock() });
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
	});

	afterEach(() => {
		screen?.unmount();
		jest.restoreAllMocks();
	});

	describe('Continue on the fixture, at the last fight\'s reward', () => {
		beforeEach(() => open());

		it('names the destination and the route, lists the stops with the cleared ones marked, and shows the cargo and the seats', () => {
			expect(text('run_title')).toBe('Run to Red Mesa Silos');
			expect(text('run_subtitle')).toBe('Day 9 / on the road / Back roads');
			expect(text('run_cargo')).toBe('Cargo: 2 fuel and Caltrops');
			expect([0, 1, 2].map((index) => [text(`run_stop_${index}_label`), text(`run_stop_${index}_state`)])).toEqual([
				['1. Raider ambush, 1 skull', 'Cleared'],
				['2. Quiet stretch', 'Cleared'],
				['3. Raider ambush, 2 skulls', 'Here'],
			]);
			expect(text('run_stop_home_label')).toBe('Home, from Red Mesa Silos');
			expect(text('run_seats')).toBe('Road Warrior 1, 40 of 40 HP; Interceptor 2, 25 of 25 HP');
		});

		it('offers the stop\'s reward as card faces, the save\'s own offer, with Skip focused', () => {
			const pile = find<CardPileView>('run_reward');
			expect(pile.cards.map((face) => face.data.type)).toEqual(rewardOffer({ campaign: screen.campaignShown as Campaign }));
			expect(context.focus.focused?.id).toBe('run_skip_button');
		});

		it('takes a picked card into the cargo, saves, and drives on to the road home', async () => {
			const pile = find<CardPileView>('run_reward');
			const picked = pile.cards[1].data.type;
			pile.cards[1].onSelect?.(pile.cards[1].data);
			for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));

			expect(screen.campaignShown?.supplyRun?.cargoCards[picked]).toBeGreaterThanOrEqual(1);
			expect(text('run_action_title')).toBe('The road home is clear');
			expect(text('run_stop_home_state')).toBe('Next');
			const load = await saved();
			expect([load?.supplyRun?.stop, load?.supplyRun?.phase]).toEqual([3, 'driving']);
			expect(context.focus.focused?.id).toBe('run_home_button');
		});

		it('skips the card, and Back to menu leaves the run where it stands, saved', async () => {
			await press('run_skip_button');
			expect(screen.campaignShown?.supplyRun?.cargoCards).toEqual({ caltrops: 1 });
			await press('run_back_button');
			expect(navigate).toHaveBeenLastCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
			expect((await saved())?.supplyRun?.stop).toBe(3);
		});

		it('drops a step\'s report once the next step is taken', async () => {
			await press('run_skip_button');
			expect([text('run_report'), find<Text>('run_report').visible]).toEqual(['Left the cards.', true]);
			await press('run_home_button');
			expect(find<Text>('run_report').visible).toBe(false);
		});

		it('goes to the menu on Escape', () => {
			send(context, [key('Escape')]);
			expect(navigate).toHaveBeenLastCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
		});
	});

	describe('on the road', () => {
		it('passes a quiet stretch with Drive on, and saves', async () => {
			await open(drivingText(1));
			expect(text('run_action_title')).toBe('Next: Quiet stretch');
			await press('run_drive_button');
			expect(text('run_report')).toBe('The road was quiet.');
			expect(text('run_action_title')).toBe('Next: Raider ambush, 2 skulls');
			expect((await saved())?.supplyRun?.stop).toBe(2);
		});

		it('opens a fight on the combat screen with Drive on, whose end comes back here', async () => {
			await open(drivingText(2));
			expect(text('run_action_line')).toBe('Raiders hold the road ahead, 2 skulls of danger. Driving on starts the fight.');
			await press('run_drive_button');
			const [name, mount] = navigate.mock.calls[navigate.mock.calls.length - 1] as [string, PreparedCombatMount];
			expect(name).toBe('combatScreen');
			const prepared = await mount.prepare();
			expect(prepared.battle.enemyTeam.vehicles.map((vehicle) => vehicle.name)).toEqual(['Rust Buggy', 'Rust Buggy']);
			expect([prepared.fuel, prepared.scrap]).toEqual([2, 0]);
			expect(typeof prepared.onEnded).toBe('function');
		});

		it('comes home with Head home: unloads, ends the day, says so in a line, and saves', async () => {
			await open(drivingText(3));
			await press('run_home_button');
			expect(text('run_action_title')).toBe('Home');
			expect(text('run_summary')).toBe('Home from Red Mesa Silos. Unloaded 2 fuel and Caltrops. Day 9 ended.');
			expect([text('run_stop_home_state'), text('run_subtitle')]).toEqual(['Reached', 'Day 10 / home / Back roads']);
			const load = await saved();
			expect([load?.day, load?.supplyRun, load?.locker.caltrops]).toEqual([10, null, 1]);
			await press('run_compound_button');
			expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign: screen.campaignShown });
		});
	});

	describe('a run its last fight failed', () => {
		/** The fixture's run driving to its last fight, lost to snipers, as the combat screen's end hook hands it over. */
		async function failedData(): Promise<RunScreenData> {
			const campaign = Campaign.fromJSON(JSON.parse(drivingText(2)).campaign);
			const route = campaign.supplyRun?.route as RunRoute;
			const fight = startStopFight({ campaign, cards: CARDS, raiders: snipers, enemyAI: null });
			fightOut(fight, { shoot: false });
			const result = finishStopFight({ campaign, fight }) as Extract<StopFightResult, { outcome: 'run_failed' }>;
			const done: Promise<CheckpointResult> = Promise.resolve('saved');
			return { campaign, failed: { result, route, stop: 2, saved: done } };
		}

		it('says what the run lost and where, and goes back to the compound', async () => {
			const data = await failedData();
			await open(saveText({ campaign: data.campaign.toSaveText() }), data);
			expect(text('run_action_title')).toBe('The run failed');
			expect(text('run_summary')).toMatch(/^The run failed\. Road Warrior 1 is (dead|missing) and Interceptor 2 is (dead|missing)\. Lost with it: 2 fuel and Caltrops\./);
			expect(routeStops(data.failed?.route as RunRoute).map((_stop, index) => text(`run_stop_${index}_state`))).toEqual(['Cleared', 'Cleared', 'Lost']);
			expect(text('run_subtitle')).toBe('Day 10 / failed / Back roads');
			await press('run_compound_button');
			expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign: data.campaign });
		});
	});

	describe('stopFightMount', () => {
		it('writes a won fight back as it ends, saves, and sends Continue back to the run', async () => {
			storage = storageWith(drivingText(2));
			store = storeOver(storage);
			const campaign = await store.load() as Campaign;
			const fight = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });
			const prepared = await stopFightMount({ campaign, fight, store }).prepare();
			fightOut(fight);

			const result = prepared.onEnded?.({ won: true });

			expect(result).toEqual({ victory: true, next: { screen: 'runScreen', data: { campaign } } });
			expect(campaign.supplyRun?.phase).toBe('reward');
			for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
			expect((await storeOver(storage).load())?.supplyRun?.phase).toBe('reward');
		});
	});

	describe('with nothing on the road', () => {
		it('says so, and offers the compound', async () => {
			await open(saveText({ campaign: (() => { const campaign = Campaign.fromJSON(CAMPAIGN_FIXTURE); campaign.unwindRunDecks(); return campaign.toSaveText(); })() }));
			expect(text('run_action_title')).toBe('No run is on the road');
			await press('run_compound_button');
			expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign: screen.campaignShown });
		});
	});

	const LAYOUTS: { name: string; mount: () => Promise<void> }[] = [
		{ name: 'a reward', mount: () => open() },
		{ name: 'a fight ahead', mount: () => open(drivingText(2)) },
		{
			name: 'home',
			mount: async () => {
				await open(drivingText(3));
				await press('run_home_button');
			},
		},
	];

	it.each([{ width: 1440, height: 882 }, { width: 1024, height: 600 }].flatMap((size) => LAYOUTS.map((layout) => ({ ...size, ...layout }))))(
		'lays out with no lint at $width x $height with $name, measured in the real faces',
		async ({ width, height, mount }) => {
			viewport.logical = { width, height };
			context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
			await mount();
			context.frame.layout();
			expect(layoutLint(treeSnapshot([screen.root], { width, height })).violations).toEqual([]);
		},
	);
});
