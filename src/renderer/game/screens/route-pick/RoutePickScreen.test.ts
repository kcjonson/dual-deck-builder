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
import { MemorySaveStorage } from '../../campaign/SaveStorage';
import { routeStops } from '../../campaign/SupplyRoutes';
import { routesOnOffer } from '../../campaign/SupplyRun';
import { FaultyStorage, atHomeText, storageWith, storeOver } from '../../campaign/__fixtures__/storeFixtures';
import { NOT_THE_SAVE } from '../compound/compoundText';
import { RoutePickScreen } from './RoutePickScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

describe('RoutePickScreen', () => {
	const viewport = { logical: { width: 1440, height: 882 } };
	let context: MountContext;
	let screen: RoutePickScreen;
	let store: CampaignStore;
	let storage: FaultyStorage;

	/** Mounts the screen over the fixture home from its run, changed first if asked, and waits for the save to load. */
	async function open(change: (campaign: Campaign) => void = () => undefined): Promise<void> {
		storage = storageWith(atHomeText(change));
		store = storeOver(storage);
		screen = new RoutePickScreen({ store });
		screen.mount(context);
		await screen.campaignLoaded;
		context.frame.layout();
	}

	function find<T>(id: string): T {
		const found = screen.root.findById(id);
		if (!found) throw new Error(`no ${id}`);
		return found as unknown as T;
	}

	function text(id: string): string {
		return find<Text>(id).text;
	}

	async function flush(): Promise<void> {
		for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
	}

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1440, height: 882 };
		context = createTestContext({ viewport, clock: new Clock() });
	});

	afterEach(() => {
		screen?.unmount();
	});

	it('shows today\'s destinations side by side, each with its routes: cost, risk, and stops in order', async () => {
		await open();
		const campaign = screen.shown as Campaign;
		const routes = routesOnOffer({ campaign });
		expect(text('route_pick_day')).toBe('Day 9 / dawn / Fuel 6');
		const columns = find<{ children: readonly { id: string | null }[] }>('route_pick_destinations').children.map((column) => column.id);
		expect(columns).toEqual([...new Set(routes.map((route) => `route_pick_${route.destination.id}`))]);
		for (const route of routes) {
			expect(text(`route_pick_${route.id}_name`)).toBe(route.name);
			expect(text(`route_pick_${route.id}_cost`)).toBe(`${route.fuel} fuel, ${route.hours.out} h out, ${route.hours.home} h home`);
			expect(text(`route_pick_${route.id}_risk`)).toMatch(/^Risk: \d skulls?$/);
			routeStops(route).forEach((_stop, index) => expect(text(`route_pick_${route.id}_stop_${index}`)).toMatch(new RegExp(`^${index + 1}\\. `)));
		}
	});

	it('takes a route: loads out, pays the fuel, saves the run, and opens the run screen with it', async () => {
		await open();
		const campaign = screen.shown as Campaign;
		const [route] = routesOnOffer({ campaign });
		find<Button>(`route_pick_${route.id}_take`).onClick?.({} as never);
		await flush();

		expect(campaign.supplyRun?.route).toEqual(route);
		expect(campaign.resources.fuel).toBe(6 - route.fuel);
		expect(navigate).toHaveBeenLastCalledWith('runScreen', { campaign, saved: expect.any(Promise) });
		const saved = await storeOver(storage).load();
		expect([saved?.supplyRun?.route.id, saved?.supplyRun?.stop, saved?.resources.fuel]).toEqual([route.id, 0, 6 - route.fuel]);
	});

	it('turns off a route the stores can\'t fuel, saying why', async () => {
		await open((campaign) => campaign.set({ resources: { ...campaign.resources, fuel: 2 } }));
		const routes = routesOnOffer({ campaign: screen.shown as Campaign });
		for (const route of routes) {
			const take = find<Button>(`route_pick_${route.id}_take`);
			expect(take.enabled).toBe(route.fuel <= 2);
			if (route.fuel > 2) expect(text(`route_pick_${route.id}_reason`)).toBe(`Takes ${route.fuel} fuel, and the stores hold 2.`);
		}
	});

	it('says what each destination yields', async () => {
		await open();
		for (const { destination } of routesOnOffer({ campaign: screen.shown as Campaign })) {
			const { food, water, fuel, scrap } = destination.yield;
			expect(text(`route_pick_${destination.id}_yield`)).toBe(`Yields ${food} food, ${water} water, ${fuel} fuel, and ${scrap} scrap`);
		}
	});

	it('stays put, saying nothing more is saved, when the store has moved on from this campaign', async () => {
		await open();
		const campaign = screen.shown as Campaign;
		await store.load();
		const [route] = routesOnOffer({ campaign });
		find<Button>(`route_pick_${route.id}_take`).onClick?.({} as never);
		await flush();
		expect(text('route_pick_status')).toBe(NOT_THE_SAVE);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('says why when nobody can go, and leaves the campaign as it was, saving nothing', async () => {
		await open((campaign) => [campaign.drivers[0], campaign.drivers[4]].forEach((driver) => driver.set({ status: 'injured', injuredDays: 1, hitpoints: 20 })));
		const campaign = screen.shown as Campaign;
		const [route] = routesOnOffer({ campaign });
		const before = campaign.toSaveText();
		jest.spyOn(console, 'error').mockImplementation(() => undefined);
		find<Button>(`route_pick_${route.id}_take`).onClick?.({} as never);
		await flush();

		expect(text('route_pick_status')).toBe('Nobody at the compound can go out on a run');
		expect(campaign.toSaveText()).toBe(before);
		expect(navigate).not.toHaveBeenCalled();
		jest.restoreAllMocks();
	});

	it('goes back to the compound with the campaign on Back and on Escape', async () => {
		await open();
		send(context, [key('Escape')]);
		expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign: screen.shown }, { restoreFocus: true });
		find<Button>('route_pick_back_button').onClick?.({} as never);
		expect(navigate).toHaveBeenCalledTimes(2);
	});

	it('says so with no campaign to show', async () => {
		screen = new RoutePickScreen({ store: storeOver(new MemorySaveStorage()) });
		screen.mount(context);
		await screen.campaignLoaded;
		expect(text('route_pick_status')).toBe('No campaign in progress.');
	});

	it.each([{ width: 1440, height: 882 }, { width: 1024, height: 600 }])('lays out with no lint at $width x $height, measured in the real faces', async (size) => {
		viewport.logical = size;
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		await open();
		context.frame.layout();
		expect(layoutLint(treeSnapshot([screen.root], size)).violations).toEqual([]);
	});
});
