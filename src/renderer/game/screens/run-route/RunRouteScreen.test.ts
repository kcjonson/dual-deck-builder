/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import type { Text } from '../../../engine/components/Text';
import type { Button } from '../../../engine/ui/Button';
import { click, key, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { tokens } from '../../../engine/theme/tokens';
import { ScreenManager } from '../../core/ScreenManager';
import type { Campaign } from '../../campaign/Campaign';
import type { CampaignStore } from '../../campaign/CampaignStore';
import { routeId } from '../../campaign/MapRoutes';
import { MemorySaveStorage } from '../../campaign/SaveStorage';
import { routesOnOffer } from '../../campaign/SupplyRun';
import { FaultyStorage, atHomeText, storageWith, storeOver } from '../../campaign/__fixtures__/storeFixtures';
import type { AreaMapView } from '../../ui/areaMap/AreaMapView';
import type { RouteCard } from '../../ui/RouteCard';
import { STRONGHOLD_NOT_YET, homeByText, routeDetail, stopTag, stopText } from '../area-map/areaMapText';
import { PlannedPoi, byDistance, plannedPois, routePoints } from '../area-map/planningMap';
import { TestMaps, meshPlanningMap, testMaps } from '../area-map/testing';
import { RunRouteScreen, STRANDED_RUN_ROUTE } from './RunRouteScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

/** The campaign's map: a mesh with POIs, strongholds, and routes, nine hours of daylight so some routes run past dark. */
const MAP = meshPlanningMap({ daylightHours: 9 });
const POIS = plannedPois(MAP);

function poiWhere(test: (poi: PlannedPoi) => boolean): PlannedPoi {
	const poi = byDistance(POIS).find((candidate) => !candidate.stronghold && test(candidate));
	if (!poi) throw new Error('the map should have such a POI');
	return poi;
}

/** A tier 1 POI with routes home by dark, and one with a route past dark and another home by it. */
const NEAR = poiWhere((poi) => poi.tier === 1 && poi.routes.length > 1 && poi.routes.every(({ spare }) => spare >= 0));
const MIXED = poiWhere((poi) => poi.routes.some(({ spare }) => spare < 0) && poi.routes.some(({ spare }) => spare >= 0));
/** A POI whose routes cost different fuel. */
const UNEVEN = poiWhere((poi) => new Set(poi.routes.map(({ fuel }) => fuel)).size > 1);

describe('RunRouteScreen (DDB-319)', () => {
	const viewport = { logical: { width: 1440, height: 882 } };
	let context: MountContext;
	let screen: RunRouteScreen;
	let store: CampaignStore;
	let storage: FaultyStorage;
	let planning: TestMaps;

	/** Mounts the screen for a POI over the fixture home from its run, changed first if asked, and waits for the save and the map. */
	async function open(poi: PlannedPoi | number, change: (campaign: Campaign) => void = () => undefined): Promise<void> {
		storage = storageWith(atHomeText(change));
		store = storeOver(storage);
		screen = new RunRouteScreen({ store, maps: planning.maps });
		screen.mount(context, { poi: typeof poi === 'number' ? poi : poi.poi });
		await screen.campaignLoaded;
		context.frame.layout();
	}

	function find<T>(id: string): T {
		const found = screen.root.findById(id);
		if (!found) throw new Error(`no ${id}`);
		return found as unknown as T;
	}

	const text = (id: string): string => find<Text>(id).text;
	const view = (): AreaMapView => find<AreaMapView>('run_route_view');
	const card = (route: number): RouteCard => find<RouteCard>(`run_route_card_${route}`);

	function clickOn(id: string): void {
		const { x, y, width, height } = find<{ screenBounds: { x: number; y: number; width: number; height: number } }>(id).screenBounds;
		click(context, x + width / 2, y + height / 2);
	}

	async function flush(): Promise<void> {
		for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
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

	it('frames the compound, the POI, and its routes, every route drawn and the quickest picked, with the POI marked', async () => {
		await open(NEAR);
		expect(screen.destination).toBe(NEAR);
		expect(screen.pickedRoute).toBe(0);
		const shown = view();
		expect(shown.markers).toEqual([expect.objectContaining({ id: NEAR.id, label: NEAR.name, badge: String(NEAR.tier) })]);
		expect(shown.selection).toEqual({ kind: 'marker', id: NEAR.id });
		expect(shown.routes.map(({ picked }) => picked)).toEqual(NEAR.routes.map((_route, index) => index === 0));
		expect(shown.routes[0].points).toEqual(routePoints({ map: MAP, route: NEAR.routes[0] }));
		const world = shown.camera.visibleWorld;
		const inside = (x: number, y: number) => x >= world.x && x <= world.x + world.width && y >= world.y && y <= world.y + world.height;
		expect(inside(0, 0)).toBe(true);
		expect(inside(NEAR.x, NEAR.y)).toBe(true);
		// Cropped to them, not the whole disc
		expect(Math.max(world.width, world.height)).toBeLessThan(1500);
		expect(text('run_route_name')).toBe(NEAR.name);
	});

	it('shows a card for each route from its descriptor, and the picked one\'s stops in order and when it\'d be home', async () => {
		await open(NEAR);
		NEAR.routes.forEach((route, index) => {
			expect(card(index).titleText).toBe(route.name);
			expect(card(index).detailText).toBe(routeDetail(route));
			expect(card(index).selected).toBe(index === 0);
		});
		const [quickest] = NEAR.routes;
		quickest.stops.forEach((stop, place) => {
			expect(text(`run_route_stop_${place}_tag_text`)).toBe(stopTag(stop));
			expect(text(`run_route_stop_${place}_text`)).toBe(stopText(stop));
		});
		expect(text('run_route_home_by')).toBe(homeByText(quickest));
	});

	it('picks a route from its card, by click or keyboard, highlighting it on the map with its stops', async () => {
		await open(NEAR);
		clickOn('run_route_card_1');
		expect(screen.pickedRoute).toBe(1);
		expect(card(1).selected).toBe(true);
		expect(card(0).selected).toBe(false);
		expect(view().routes.map(({ picked }) => picked)).toEqual(NEAR.routes.map((_route, index) => index === 1));
		expect(view().routes[1].stops).toHaveLength(NEAR.routes[1].stops.length);
		expect(text('run_route_home_by')).toBe(homeByText(NEAR.routes[1]));

		context.focus.focus(card(1));
		send(context, [key('ArrowUp'), key('Enter')]);
		expect(screen.pickedRoute).toBe(0);
	});

	it('warns of a route past dark, and lets it go', async () => {
		await open(MIXED, withFuel(99));
		const late = MIXED.routes.findIndex(({ spare }) => spare < 0);
		expect(card(late).noteText).toBe('Back after dark.');
		clickOn(`run_route_card_${late}`);
		expect(text('run_route_home_by')).toMatch(/^Home by \d\d:\d\d, [\d.]+ h after dark\.$/);
		expect(find<Text>('run_route_home_by').color).toEqual(tokens.color.status_warn);
		expect(find<Button>('run_route_load_out_button').enabled).toBe(true);
	});

	it('dims a route the stores can\'t fuel with the reason, picks one they can, and keeps Load out off while the other is picked', async () => {
		const fuels = UNEVEN.routes.map(({ fuel: cost }) => cost);
		const fuel = Math.min(...fuels);
		const dear = fuels.findIndex((cost) => cost > fuel);
		await open(UNEVEN, withFuel(fuel));
		expect(card(dear).dim).toBe(true);
		expect(card(dear).noteText).toBe(`Takes ${fuels[dear]} fuel, and the stores hold ${fuel}.`);
		expect(card(screen.pickedRoute).dim).toBe(false);
		expect(find<Button>('run_route_load_out_button').enabled).toBe(true);

		clickOn(`run_route_card_${dear}`);
		expect(find<Button>('run_route_load_out_button').enabled).toBe(false);
		expect(text('run_route_load_out_reason')).toBe(`Takes ${fuels[dear]} fuel, and the stores hold ${fuel}.`);
		find<Button>('run_route_load_out_button').onClick?.({} as never);
		await flush();
		expect(navigate).not.toHaveBeenCalled();
	});

	it('loads out the crew on the picked route: pays the fuel, saves the run, and opens the run screen', async () => {
		await open(NEAR, withFuel(20));
		const campaign = screen.shown as Campaign;
		clickOn('run_route_card_1');
		const route = routesOnOffer({ map: MAP }).find(({ id }) => id === routeId(NEAR.poi, 1));
		if (!route) throw new Error('the route should be on offer');
		find<Button>('run_route_load_out_button').onClick?.({} as never);
		await flush();

		expect(campaign.supplyRun?.route).toEqual(route);
		expect(campaign.resources.fuel).toBe(20 - route.fuel);
		expect(navigate).toHaveBeenLastCalledWith('runScreen', { campaign, saved: expect.any(Promise) });
		const saved = await storeOver(storage).load();
		expect([saved?.supplyRun?.route.id, saved?.supplyRun?.stop, saved?.resources.fuel]).toEqual([route.id, 0, 20 - route.fuel]);
	});

	it('keeps Load out off with nobody fit to go, saying why', async () => {
		await open(NEAR, (campaign) => [campaign.drivers[0], campaign.drivers[4]].forEach((driver) => driver.set({ status: 'injured', injuredDays: 1, hitpoints: 20 })));
		expect(find<Button>('run_route_load_out_button').enabled).toBe(false);
		expect(text('run_route_load_out_reason')).toBe('Nobody at the compound is fit to go out.');
	});

	it('says nothing more is saved when the store has moved on from this campaign, with Load out off and Back to the menu', async () => {
		await open(NEAR);
		await store.load();
		find<Button>('run_route_load_out_button').onClick?.({} as never);
		await flush();
		expect(text('run_route_status')).toBe(STRANDED_RUN_ROUTE);
		expect(navigate).not.toHaveBeenCalled();
		expect(find<Button>('run_route_load_out_button').enabled).toBe(false);
		expect(text('run_route_load_out_reason')).toBe(STRANDED_RUN_ROUTE);
		// Not stuck: Back and Escape go to the menu, where Continue picks up the save
		send(context, [key('Escape')]);
		expect(navigate).toHaveBeenLastCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
		find<Button>('run_route_back_button').onClick?.({} as never);
		expect(navigate).toHaveBeenCalledTimes(2);
	});

	it('picks the quickest route the stores can fuel, by hours out with its stops, or the quickest of all when none can be', async () => {
		const poi = POIS.find((candidate) => !candidate.stronghold && candidate.routes.length > 1 && candidate.quickest !== candidate.routes[0]) ?? UNEVEN;
		const quickest = poi.routes.indexOf(poi.quickest as (typeof poi.routes)[number]);
		await open(poi, withFuel(99));
		expect(screen.pickedRoute).toBe(quickest);
		screen.unmount();
		await open(poi, withFuel(0));
		expect(screen.pickedRoute).toBe(quickest);
		expect(find<Button>('run_route_load_out_button').enabled).toBe(false);
	});

	it.each([
		['a stronghold', () => POIS.findIndex(({ stronghold }) => stronghold), STRONGHOLD_NOT_YET],
		['a POI the map doesn\'t have', () => POIS.length, "That destination isn't on the area map."],
	])('offers only Back for %s, saying why', async (_name, poi, reason) => {
		await open(poi());
		expect(text('run_route_status')).toBe(reason);
		expect(find<Button>('run_route_load_out_button').enabled).toBe(false);
		expect(view().routes).toEqual([]);
	});

	it('goes back to the area map with the POI on Back and on Escape', async () => {
		await open(NEAR);
		send(context, [key('Escape')]);
		expect(navigate).toHaveBeenLastCalledWith('areaMapScreen', { campaign: screen.shown, poi: NEAR.poi }, { restoreFocus: true });
		find<Button>('run_route_back_button').onClick?.({} as never);
		expect(navigate).toHaveBeenCalledTimes(2);
	});

	it('says how far the map has got while it waits', async () => {
		planning = testMaps(MAP, { held: true });
		screen = new RunRouteScreen({ store: storeOver(storageWith(atHomeText())), maps: planning.maps });
		screen.mount(context, { poi: NEAR.poi });
		await flush();
		expect(text('run_route_status')).toBe('Making the area map: roads (3 of 6)');
		await planning.finish();
		expect(screen.destination).toBe(NEAR);
	});

	it('shows the nearest destination when opened with no POI, as a capture opens it', async () => {
		screen = new RunRouteScreen({ store: storeOver(storageWith(atHomeText())), maps: planning.maps });
		screen.mount(context);
		await screen.campaignLoaded;
		const nearest = byDistance(POIS).find(({ stronghold }) => !stronghold);
		expect(screen.destination).toBe(nearest);
		send(context, [key('Escape')]);
		expect(navigate).toHaveBeenLastCalledWith('areaMapScreen', { campaign: screen.shown, poi: nearest?.poi }, { restoreFocus: true });
	});

	it('says so with no campaign to show', async () => {
		screen = new RunRouteScreen({ store: storeOver(new MemorySaveStorage()), maps: planning.maps });
		screen.mount(context, { poi: NEAR.poi });
		await screen.campaignLoaded;
		expect(text('run_route_status')).toBe('No campaign in progress.');
	});

	it.each([{ width: 1440, height: 882 }, { width: 1024, height: 600 }])('lays out with no lint at $width x $height, measured in the real faces', async (size) => {
		viewport.logical = size;
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		const longest = byDistance(POIS).filter((poi) => !poi.stronghold).sort((a, b) => Math.max(...b.routes.map(({ stops }) => stops.length)) - Math.max(...a.routes.map(({ stops }) => stops.length)))[0];
		await open(longest, withFuel(1));
		context.frame.layout();
		expect(layoutLint(treeSnapshot([screen.root], size)).violations).toEqual([]);
	});
});
