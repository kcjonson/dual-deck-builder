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
import type { Campaign } from '../../campaign/Campaign';
import type { CampaignStore } from '../../campaign/CampaignStore';
import { routeId } from '../../campaign/MapRoutes';
import { FaultyStorage, atHomeText, storageWith, storeOver } from '../../campaign/__fixtures__/storeFixtures';
import type { EscortCard } from '../../ui/EscortCard';
import { lookup } from '../../ui/testing';
import { PlannedPoi, byDistance, plannedPois } from '../area-map/planningMap';
import { TestMaps, meshPlanningMap, testMaps } from '../area-map/testing';
import { LoadOutScreen, LoadOutScreenData } from './LoadOutScreen';
import { STRANDED_LOAD_OUT } from './loadOutText';
import { departRefusal } from '../run/runText';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

const MAP = meshPlanningMap({ daylightHours: 9 });
/** The nearest POI with a route, which the run route screen would hand over. */
const NEAR = byDistance(plannedPois(MAP)).find((poi) => !poi.stronghold && poi.routes.length > 0) as PlannedPoi;
const ROUTE = NEAR.routes[0];

describe('LoadOutScreen (DDB-320)', () => {
	const viewport = { logical: { width: 1440, height: 882 } };
	let context: MountContext;
	let screen: LoadOutScreen;
	let store: CampaignStore;
	let storage: FaultyStorage;
	let planning: TestMaps;

	/** Mounts load out on the near route over the fixture home from its run, changed first if asked, as the run route screen opens it. */
	async function open(change: (campaign: Campaign) => void = () => undefined): Promise<Campaign> {
		storage = storageWith(atHomeText(change));
		store = storeOver(storage);
		const campaign = await store.load() as Campaign;
		screen = new LoadOutScreen({ store, cards: async () => lookup, maps: planning.maps });
		const data: LoadOutScreenData = { campaign, poi: NEAR.poi, route: routeId(ROUTE.poi, ROUTE.route), heading: `${NEAR.name} by ${ROUTE.name}`, summary: 'test summary' };
		screen.mount(context, data);
		await screen.campaignLoaded;
		context.frame.layout();
		return campaign;
	}

	function find<T>(id: string): T {
		const found = screen.root.findById(id);
		if (!found) throw new Error(`no ${id}`);
		return found as unknown as T;
	}

	const text = (id: string): string => find<Text>(id).text;
	const press = (id: string): void => { find<Button>(id).onClick?.({} as never); };

	async function flush(): Promise<void> {
		for (let turn = 0; turn < 6; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
	}

	const withFuel = (fuel: number) => (campaign: Campaign) => campaign.set({ resources: { ...campaign.resources, fuel } });

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1440, height: 882 };
		context = createTestContext({ viewport, clock: new Clock() });
		planning = testMaps(MAP);
	});

	afterEach(() => {
		screen?.unmount();
	});

	it('seats the crew that can go, shows the pool with why each can\'t, and brings every escort, START RUN live', async () => {
		await open(withFuel(20));
		expect(text('load_out_destination')).toBe(`${NEAR.name} by ${ROUTE.name}`);
		expect(screen.plan?.seats.map((driver) => driver?.name)).toEqual(['Road Warrior 1', 'Interceptor 2']);
		expect(text('load_out_pool_driver-3_reason')).toBe('Injured, fit in 2 days');
		expect(text('load_out_pool_driver-1_reason')).toBe('In seat 1');
		expect(find<EscortCard>('load_out_escort_escort-1').staying).toBe(false);
		expect(text('load_out_summary_line')).toBe('Both drivers take their default decks. 2 escorts and their cards come along.');
		expect(find<Button>('load_out_start_button').enabled).toBe(true);
		expect(context.focus.focused?.id).toBe('load_out_start_button');
	});

	it('sets off on the route from START RUN: run decks out, fuel paid, the run saved, and the run screen open', async () => {
		const campaign = await open(withFuel(20));
		press('load_out_start_button');
		await flush();
		expect(campaign.runDecks.map(({ driver }) => driver.name)).toEqual(['Road Warrior 1', 'Interceptor 2']);
		expect(campaign.supplyRun?.route.id).toBe(routeId(ROUTE.poi, ROUTE.route));
		expect(campaign.resources.fuel).toBe(20 - ROUTE.fuel);
		expect(navigate).toHaveBeenLastCalledWith('runScreen', { campaign, saved: expect.any(Promise) });
		const saved = await storeOver(storage).load();
		expect([saved?.supplyRun?.route.id, saved?.resources.fuel]).toEqual([routeId(ROUTE.poi, ROUTE.route), 20 - ROUTE.fuel]);
	});

	it('sets off with an escort left at home, and its card stays home too', async () => {
		const campaign = await open(withFuel(20));
		const [hauler, outrider] = campaign.convoy.escorts;
		find<EscortCard>('load_out_escort_escort-1').onSelect?.({} as never);
		expect(find<EscortCard>('load_out_escort_escort-1').staying).toBe(true);
		press('load_out_start_button');
		await flush();
		expect(campaign.supplyRun?.escorts).toEqual([outrider]);
		expect(campaign.runDecks.flatMap((deck) => deck.escortCards.map(({ broughtBy }) => broughtBy))).not.toContain(hauler.convoyId);
	});

	it('says why a refused departure didn\'t set off, starting no run decks and leaving START RUN live', async () => {
		const campaign = await open(withFuel(0));
		press('load_out_start_button');
		await flush();
		expect(text('load_out_summary_line')).toBe(departRefusal({ reason: 'too_little_fuel', needed: ROUTE.fuel, held: 0 }));
		expect(campaign.supplyRun).toBeNull();
		expect(campaign.runDecks).toHaveLength(0);
		expect(find<Button>('load_out_start_button').enabled).toBe(true);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('gives up the run decks on Back and Escape, and goes back to the run route with the POI', async () => {
		const campaign = await open(withFuel(20));
		screen.plan?.start();
		send(context, [key('Escape')]);
		expect(campaign.runDecks).toHaveLength(0);
		expect(navigate).toHaveBeenLastCalledWith('runRouteScreen', { campaign, poi: NEAR.poi }, { restoreFocus: true });
		press('load_out_back_button');
		expect(navigate).toHaveBeenCalledTimes(2);
	});

	it('opens Customize on a seat\'s run deck, starting the decks, and hands Customize what to come back with', async () => {
		const campaign = await open(withFuel(20));
		press('load_out_seat_2_customize_button');
		expect(campaign.runDecks).toHaveLength(2);
		expect(navigate).toHaveBeenLastCalledWith('customizeScreen', {
			campaign,
			driver: campaign.runDecks[1].driver,
			returnTo: 'loadOutScreen',
			returnData: { poi: NEAR.poi, route: routeId(ROUTE.poi, ROUTE.route), heading: `${NEAR.name} by ${ROUTE.name}`, summary: 'test summary' },
		});
	});

	it('seats one driver alone when only one is ready', async () => {
		await open((campaign) => {
			withFuel(20)(campaign);
			campaign.drivers.find((driver) => driver.name === 'Interceptor 2')?.set({ status: 'injured', injuredDays: 1 });
		});
		expect(text('load_out_seat_2_empty')).toBe('Solo run: nobody else is fit to go.');
		expect(text('load_out_summary_line')).toBe('A solo run on the default deck. 2 escorts and their cards come along.');
		expect(find<Button>('load_out_start_button').enabled).toBe(true);
	});

	it('keeps START RUN off with a seat empty, saying why', async () => {
		await open(withFuel(20));
		press('load_out_seat_1_clear_button');
		expect(text('load_out_summary_line')).toBe('Seat two drivers to start the run.');
		expect(find<Button>('load_out_start_button').enabled).toBe(false);
	});

	it('says nothing more is saved when the store has moved on from this campaign, with Back to the menu', async () => {
		await open(withFuel(20));
		await store.load();
		press('load_out_start_button');
		await flush();
		expect(text('load_out_summary_line')).toBe(STRANDED_LOAD_OUT);
		expect(find<Button>('load_out_start_button').enabled).toBe(false);
		press('load_out_back_button');
		expect(navigate).toHaveBeenLastCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
	});

	it('loads the save and says there\'s no route when opened with nothing, as a capture opens it', async () => {
		storage = storageWith(atHomeText());
		store = storeOver(storage);
		screen = new LoadOutScreen({ store, cards: async () => lookup, maps: planning.maps });
		screen.mount(context);
		await screen.campaignLoaded;
		expect(screen.plan?.seats.map((driver) => driver?.name)).toEqual(['Road Warrior 1', 'Interceptor 2']);
		expect(text('load_out_summary_line')).toBe('Pick a route first: load out was opened without one.');
		press('load_out_back_button');
		expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign: screen.shown }, { restoreFocus: true });
	});

	it.each([{ width: 1440, height: 882 }, { width: 1024, height: 600 }])('lays out with no lint at $width x $height, measured in the real faces', async (size) => {
		viewport.logical = size;
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		await open(withFuel(20));
		context.frame.layout();
		expect(layoutLint(treeSnapshot([screen.root], size)).violations).toEqual([]);
	});
});
