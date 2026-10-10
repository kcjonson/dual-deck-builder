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
import { NOT_THE_SAVE } from '../compound/compoundText';
import { RunScreen, RunScreenData, STEP_NOT_SAVED, stopFightMount } from './RunScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

const CARDS: ReadonlyMap<string, GameCard> = new Map(cardData.map((data) => [data.type, new GameCard({ ...data })]));

/**
 * The fixture's run driving to `stop`, as save text: its last fight still
 * ahead at 2, or past it at 3, at the destination with its yield loaded, as
 * taking the reward would leave it.
 */
function drivingText(stop: number): string {
	return fixtureText((campaign) => {
		const run = campaign.supplyRun as { stop: number; phase: string; cargo: Record<string, number>; route: { destination: { yield: Record<string, number> } } };
		run.stop = stop;
		run.phase = 'driving';
		if (stop < 3) return;
		for (const [resource, amount] of Object.entries(run.route.destination.yield)) run.cargo[resource] += amount;
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
			// The last stop behind it, the run reaches its destination and loads its yield
			expect(text('run_action_title')).toBe('Red Mesa Silos reached');
			expect(text('run_action_line')).toBe('Loaded 6 food, 5 water, 3 fuel, and 15 scrap. The road home is clear, and getting home unloads the cargo and ends the day.');
			expect(text('run_report')).toBe('The card is in the cargo. Reached Red Mesa Silos.');
			expect(screen.campaignShown?.supplyRun?.cargo).toEqual({ food: 6, water: 5, fuel: 5, meds: 0, scrap: 15, people: 0 });
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
			expect([text('run_report'), find<Text>('run_report').visible]).toEqual(['Left the cards. Reached Red Mesa Silos.', true]);
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
			expect(prepared.battle.enemyTeam.vehicles.map((vehicle) => vehicle.name)).toEqual(['Spike Buggy']);
			expect([prepared.fuel, prepared.scrap]).toEqual([2, 0]);
			expect(typeof prepared.onEnded).toBe('function');
		});

		it('comes home with Head home: unloads the yield and the cards, ends the day, says so in a line, logs it, and saves', async () => {
			await open(drivingText(3));
			await press('run_home_button');
			expect(text('run_action_title')).toBe('Home');
			expect(text('run_summary')).toBe('Home from Red Mesa Silos. Unloaded 6 food, 5 water, 5 fuel, 15 scrap, and Caltrops. Road Warrior 2 is back with the run. Day 9 ended. Road Warrior 2 is fit again.');
			expect([text('run_stop_home_state'), text('run_subtitle')]).toEqual(['Reached', 'Day 10 / home / Back roads']);
			const load = await saved();
			expect([load?.day, load?.supplyRun, load?.locker.caltrops, load?.resources.scrap]).toEqual([10, null, 1, 35 + 15]);
			expect(load?.log.map((entry) => entry.message)).toContain('Home from Red Mesa Silos with 6 food, 5 water, 5 fuel, 15 scrap, and Caltrops.');
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
			return { campaign, failed: { result, route, stop: 2 }, saved: done };
		}

		it('says what the run lost and where, and goes back to the compound', async () => {
			const data = await failedData();
			await open(saveText({ campaign: data.campaign.toSaveText() }), data);
			expect(text('run_action_title')).toBe('The run failed');
			expect(text('run_summary')).toMatch(/^Road Warrior 1 is (dead|missing) and Interceptor 2 is (dead|missing)\. Lost with it: 2 fuel and Caltrops\. .*Day 9 ended\./);
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

			expect(result?.next).toEqual({ screen: 'runScreen', data: { campaign, saved: expect.any(Promise) } });
			expect(result?.victory).toBe(true);
			expect(await (result?.next?.data as RunScreenData).saved).toBe('saved');
			expect(campaign.supplyRun?.phase).toBe('reward');
			expect((await storeOver(storage).load())?.supplyRun?.phase).toBe('reward');
		});

		it('offers the combat menu\'s abandon, saying who flees', async () => {
			storage = storageWith(drivingText(2));
			store = storeOver(storage);
			const campaign = await store.load() as Campaign;
			const fight = startStopFight({ campaign, cards: CARDS });
			const prepared = await stopFightMount({ campaign, fight, store }).prepare();
			expect(prepared.abandonWarning).toBe("Road Warrior 1 and Interceptor 2 flee and go missing, the run's cargo and the escorts that came along are lost, and the day ends.");
		});

		it('warns that abandoning ends the campaign when the run\'s drivers are the last the compound has', async () => {
			storage = storageWith(drivingText(2));
			store = storeOver(storage);
			const campaign = await store.load() as Campaign;
			campaign.drivers.filter((driver) => !campaign.runDecks.some((deck) => deck.driver === driver) && driver.status !== 'dead').forEach((driver) => driver.set({ status: 'missing', injuredDays: 0 }));
			const fight = startStopFight({ campaign, cards: CARDS });
			const prepared = await stopFightMount({ campaign, fight, store }).prepare();
			expect(prepared.abandonWarning).toBe("Road Warrior 1 and Interceptor 2 flee and go missing, and the run's cargo and the escorts that came along are lost. Nobody is left to drive, so the campaign ends.");
		});
	});

	describe('a campaign the run lost', () => {
		it('goes to the defeat screen, not the menu, on Back to menu and Escape, once the end is saved', async () => {
			const lost = Campaign.fromJSON(JSON.parse(drivingText(2)).campaign);
			// Only the run's two drivers were left at the compound
			lost.drivers.filter((driver) => !lost.runDecks.some((deck) => deck.driver === driver) && driver.status !== 'dead').forEach((driver) => driver.set({ status: 'missing', injuredDays: 0 }));
			const route = lost.supplyRun?.route as RunRoute;
			const fight = startStopFight({ campaign: lost, cards: CARDS, raiders: snipers, enemyAI: null });
			fightOut(fight, { shoot: false });
			const result = finishStopFight({ campaign: lost, fight }) as Extract<StopFightResult, { outcome: 'run_failed' }>;
			expect(lost.isOver).toBe(true);
			storage = storageWith(drivingText(2));
			store = storeOver(storage);
			const saving = store.checkpoint(lost);
			screen = new RunScreen({ store, cards: async () => CARDS });
			screen.mount(context, { campaign: lost, failed: { result, route, stop: 2 }, saved: saving });
			await screen.campaignLoaded;

			send(context, [key('Escape')]);
			for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
			expect(navigate).toHaveBeenLastCalledWith('defeatScreen', { campaign: lost });
			expect(navigate).not.toHaveBeenCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
		});
	});

	describe('the save of the step that opened it', () => {
		it('says it failed, which the screen couldn\'t hear for itself', async () => {
			await open(fixtureText(), { campaign: Campaign.fromJSON(CAMPAIGN_FIXTURE), saved: Promise.resolve('failed') });
			expect([text('run_save_error'), find<Text>('run_save_error').visible]).toEqual([STEP_NOT_SAVED, true]);
		});

		it('strands the screen when the store has moved on', async () => {
			await open(fixtureText(), { campaign: Campaign.fromJSON(CAMPAIGN_FIXTURE), saved: Promise.resolve('retired') });
			expect(find<Button>('run_skip_button').enabled).toBe(false);
			expect(text('run_save_error')).toBe(NOT_THE_SAVE);
		});
	});

	describe('with the cards not loaded', () => {
		it('keeps the reward waiting, saved, and loads the cards again on asking', async () => {
			let calls = 0;
			storage = storageWith(fixtureText());
			store = storeOver(storage);
			screen = new RunScreen({ store, cards: async () => {
				calls += 1;
				if (calls === 1) throw new Error('offline');
				return CARDS;
			} });
			jest.spyOn(console, 'error').mockImplementation(() => undefined);
			screen.mount(context);
			await screen.campaignLoaded;
			expect(text('run_action_line')).toBe("The cards couldn't be loaded, so the reward waits for them.");
			expect(find<{ children: readonly unknown[] }>('run_action').children.some((child) => (child as { id?: string }).id === 'run_skip_button')).toBe(false);

			await press('run_cards_button');
			expect(find<CardPileView>('run_reward').cards).toHaveLength(3);
			expect(screen.campaignShown?.supplyRun?.phase).toBe('reward');
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
