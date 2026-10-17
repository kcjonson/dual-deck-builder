/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import type { Text } from '../../../engine/components/Text';
import type { AtlasButton } from '../../ui/atlas/AtlasButton';
import { ContentsRow } from '../../ui/atlas/ContentsRow';
import type { HandMarkLayer } from '../../ui/atlas/HandMarkLayer';
import type { SectionTabs } from '../../ui/atlas/SectionTabs';
import { click, key, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { ScreenManager } from '../../core/ScreenManager';
import type { Campaign } from '../../campaign/Campaign';
import { routesOnOffer } from '../../campaign/SupplyRun';
import type { CampaignStore } from '../../campaign/CampaignStore';
import { MemorySaveStorage } from '../../campaign/SaveStorage';
import { atHomeCampaign, atHomeText, storageWith, storeOver } from '../../campaign/__fixtures__/storeFixtures';
import type { AreaMapView } from '../../ui/areaMap/AreaMapView';
import { STRONGHOLD_NOT_YET, darkText, poiKindText, poiYieldText, routesText } from './areaMapText';
import { AreaMapScreen } from './AreaMapScreen';
import { PlannedPoi, byDistance, plannedPois } from './planningMap';
import { TestMaps, meshPlanningMap, testMaps } from './testing';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

/** The campaign's map: a mesh with POIs, strongholds, and routes, eight hours of daylight so some POIs are past dark. */
const MAP = meshPlanningMap({ daylightHours: 8 });
const POIS = plannedPois(MAP);

describe('AreaMapScreen (DDB-43)', () => {
	const viewport = { logical: { width: 1440, height: 882 } };
	let context: MountContext;
	let screen: AreaMapScreen;
	let store: CampaignStore;
	let planning: TestMaps;

	/** Mounts the screen over the fixture home from its run, changed first if asked, and waits for the save and the map. */
	async function open({ change = () => undefined, data }: { change?: (campaign: Campaign) => void; data?: unknown } = {}): Promise<void> {
		store = storeOver(storageWith(atHomeText(change)));
		screen = new AreaMapScreen({ store, maps: planning.maps });
		screen.mount(context, data);
		await screen.campaignLoaded;
		context.frame.layout();
	}

	function find<T>(id: string): T {
		const found = screen.root.findById(id);
		if (!found) throw new Error(`no ${id}`);
		return found as unknown as T;
	}

	const text = (id: string): string => find<Text>(id).text;
	const view = (): AreaMapView => find<AreaMapView>('area_map_view');
	const firstWhere = (test: (poi: PlannedPoi) => boolean): PlannedPoi => {
		const poi = byDistance(POIS).find(test);
		if (!poi) throw new Error('the map should have such a POI');
		return poi;
	};

	/** A click in the middle of a component on the page. */
	function clickOn(id: string): void {
		const { x, y, width, height } = find<{ screenBounds: { x: number; y: number; width: number; height: number } }>(id).screenBounds;
		click(context, x + width / 2, y + height / 2);
	}

	/** A click on a POI's marker, where the view's camera puts it on the page. */
	function clickMarker(poi: PlannedPoi): void {
		const shown = view();
		const at = shown.camera.worldToScreen(poi.x, poi.y);
		const { x, y } = shown.screenBounds;
		click(context, x + at.x, y + at.y);
	}

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1440, height: 882 };
		context = createTestContext({ viewport, clock: new Clock() });
		planning = testMaps(MAP);
	});

	afterEach(() => {
		screen?.unmount();
	});

	it('marks every POI and stronghold on the map, each POI with its type, and lists the destinations nearest first', async () => {
		await open();
		const markers = view().markers;
		expect(markers.map(({ id }) => id)).toEqual(POIS.map(({ id }) => id));
		POIS.forEach((poi, index) => {
			expect(markers[index]).toMatchObject({ kind: poi.stronghold ? 'stronghold' : 'poi', x: poi.x, y: poi.y, label: poi.name });
			if (!poi.stronghold) expect(markers[index].type).toBe(poi.type);
		});
		const rows = find<{ children: readonly ContentsRow[] }>('area_map_destinations').children;
		expect(rows.map(({ id }) => id)).toEqual(byDistance(POIS).map(({ poi }) => `area_map_poi_${poi}`));
		expect(rows.every((row) => row instanceof ContentsRow)).toBe(true);
		expect(rows[0].value).toBe(`tier ${byDistance(POIS)[0].tier}`);
		expect(rows[rows.length - 1].value).toBe('stronghold');
		expect(rows[rows.length - 1].dim).toBe(true);
		const strongholds = POIS.filter(({ stronghold }) => stronghold).length;
		expect(strongholds).toBeGreaterThan(0);
		expect(text('area_map_status')).toBe(`${POIS.length - strongholds} destinations and ${strongholds} strongholds. Pick one on the map or in the list.`);
		expect(text('area_map_day')).toBe('Day 9 / Fuel 6');
		expect(text('area_map_selected_name')).toBe('No destination chosen');
		expect(find<AtlasButton>('area_map_plan_button').enabled).toBe(false);
	});

	it('marks the POIs no route gets home from by dark, on the map and in the list', async () => {
		await open();
		const late = POIS.filter((poi) => !poi.stronghold && poi.pastDark);
		expect(late.length).toBeGreaterThan(0);
		for (const poi of POIS) {
			expect(poi.pastDark).toBe(poi.routes.every(({ spare }) => spare < 0));
			expect(view().markers[poi.poi].pastDark).toBe(!poi.stronghold && poi.pastDark);
		}
		expect(find<ContentsRow>(`area_map_poi_${late[0].poi}`).value).toBe(`tier ${late[0].tier}, past dark`);
	});

	it('chooses a POI clicked on the map: its details, Plan a run here, and its row picked and highlighted by hand', async () => {
		await open();
		const poi = firstWhere((candidate) => !candidate.stronghold && candidate.tier === 1);
		clickMarker(poi);
		expect(screen.selected).toBe(poi);
		expect(view().selection).toEqual({ kind: 'marker', id: poi.id });
		const row = find<ContentsRow>(`area_map_poi_${poi.poi}`);
		expect(row.selected).toBe(true);
		const marks = find<HandMarkLayer>('area_map_destinations_marks').marks;
		expect(marks.map(({ kind, target }) => [kind, target])).toEqual([['highlight', row]]);
		expect(text('area_map_selected_name')).toBe(poi.name);
		expect(text('area_map_selected_kind')).toBe(poiKindText(poi));
		expect(text('area_map_selected_yield')).toMatch(/^Yields .+\.$/);
		expect(text('area_map_selected_routes')).toBe(routesText(poi));
		expect(text('area_map_selected_dark')).toBe(darkText(poi));
		expect(find<AtlasButton>('area_map_plan_button').enabled).toBe(true);
		expect(text('area_map_plan_reason')).toBe('');

		find<AtlasButton>('area_map_plan_button').onClick?.({} as never);
		expect(navigate).toHaveBeenLastCalledWith('runRouteScreen', { campaign: screen.shown, poi: poi.poi });
	});

	it('shows what runs have left at each POI: on its marker, in its row, and in its details (DDB-483)', async () => {
		const [looted, depleted] = byDistance(POIS).filter((poi) => !poi.stronghold && !poi.pastDark);
		const pois = [{ poi: looted.poi, left: 2, nights: 3 }, { poi: depleted.poi, left: 0, nights: 5 }].sort((a, b) => a.poi - b.poi);
		await open({ change: (campaign) => campaign.set({ map: { pois } }) });

		expect(view().markers[looted.poi].state).toBe('looted');
		expect(view().markers[depleted.poi].state).toBe('depleted');
		expect(view().markers.filter(({ state }) => state !== undefined)).toHaveLength(2);
		expect([find<ContentsRow>(`area_map_poi_${looted.poi}`).value, find<ContentsRow>(`area_map_poi_${looted.poi}`).dim]).toEqual([`tier ${looted.tier}`, false]);
		expect([find<ContentsRow>(`area_map_poi_${depleted.poi}`).value, find<ContentsRow>(`area_map_poi_${depleted.poi}`).dim]).toEqual([`tier ${depleted.tier}`, true]);

		clickMarker(looted);
		expect(text('area_map_selected_kind')).toBe(poiKindText({ ...looted, state: 'looted' }));
		expect(text('area_map_selected_stock')).toBe('2 of 3 shares left, the next back in 4 days.');
		const full = routesOnOffer({ map: MAP, campaign: atHomeCampaign((campaign) => campaign.set({ map: {} })) }).find((route) => route.destination.id === looted.id);
		const scaled = Object.fromEntries(Object.entries(full?.destination.yield ?? {}).map(([resource, amount]) => [resource, Math.ceil((amount * 2) / 3)]));
		expect(text('area_map_selected_yield')).toBe(poiYieldText({ stronghold: false, yields: scaled as never }));

		clickMarker(depleted);
		expect(text('area_map_selected_kind')).toBe(`${poiKindText(depleted)}, depleted`);
		expect(text('area_map_selected_yield')).toBe('Nothing left to take until it refills.');
		expect(text('area_map_selected_stock')).toBe('No shares left, the next back in 2 days.');
		// A depleted POI can still be planned: its stops' fights still pay in cards
		expect(find<AtlasButton>('area_map_plan_button').enabled).toBe(true);

		const untouched = byDistance(POIS).find((poi) => !poi.stronghold && poi !== looted && poi !== depleted) as PlannedPoi;
		clickMarker(untouched);
		expect(text('area_map_selected_stock')).toBe('3 of 3 shares left.');
	});

	it('clears the choice on a click off every marker', async () => {
		await open();
		const poi = firstWhere((candidate) => !candidate.stronghold);
		clickMarker(poi);
		const { x, y, width } = view().screenBounds;
		// The corner of the view, past the disc
		click(context, x + width - 4, y + 4);
		expect(screen.selected).toBeNull();
		expect(view().selection).toBeNull();
		expect(find<ContentsRow>(`area_map_poi_${poi.poi}`).selected).toBe(false);
		expect(find<HandMarkLayer>('area_map_destinations_marks').marks).toEqual([]);
		expect(text('area_map_selected_name')).toBe('No destination chosen');
		expect(find<AtlasButton>('area_map_plan_button').enabled).toBe(false);
	});

	it('chooses from the list by keyboard, the tabs, the map, the list, then Plan in the focus order, and brings the POI into view', async () => {
		await open();
		expect(context.focus.focused?.id).toBe('area_map_tabs.area_map');
		send(context, [key('Tab')]);
		expect(context.focus.focused?.id).toBe('area_map_view');
		send(context, [key('Tab')]);
		const [first, second] = byDistance(POIS);
		expect(context.focus.focused?.id).toBe(`area_map_poi_${first.poi}`);
		const shown = view();
		shown.camera.zoom = shown.camera.maxZoom;
		shown.camera.center = { x: -second.x, y: -second.y };
		// Focus on a row chooses it, and the arrows choose as they move
		expect(screen.selected).toBe(first);
		expect(text('area_map_selected_name')).toBe(first.name);
		send(context, [key('ArrowDown')]);
		expect(screen.selected).toBe(second);
		expect(find<ContentsRow>(`area_map_poi_${second.poi}`).selected).toBe(true);
		const world = shown.camera.visibleWorld;
		expect(second.x).toBeGreaterThanOrEqual(world.x);
		expect(second.x).toBeLessThanOrEqual(world.x + world.width);
		expect(second.y).toBeGreaterThanOrEqual(world.y);
		expect(second.y).toBeLessThanOrEqual(world.y + world.height);
		send(context, [key('Tab')]);
		expect(context.focus.focused?.id).toBe('area_map_plan_button');
		send(context, [key('Tab')]);
		expect(context.focus.focused?.id).toBe('area_map_tabs.area_map');
	});

	it('shows a stronghold, with Plan a run here off until assaults exist', async () => {
		await open();
		const listHeight = find<{ height: number }>('area_map_destinations_scroll').height;
		const stronghold = firstWhere(({ stronghold: held }) => held);
		clickMarker(stronghold);
		expect(screen.selected).toBe(stronghold);
		// The reason fits the room kept for it: the list above doesn't move
		context.frame.layout();
		expect(find<{ height: number }>('area_map_destinations_scroll').height).toBe(listHeight);
		expect(text('area_map_selected_kind')).toBe(`Stronghold, tier ${stronghold.tier}`);
		expect(find<AtlasButton>('area_map_plan_button').enabled).toBe(false);
		expect(text('area_map_plan_reason')).toBe(STRONGHOLD_NOT_YET);
		find<AtlasButton>('area_map_plan_button').onClick?.({} as never);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('keeps Plan a run here open with too little fuel, since the run route says which routes can go, and shuts it while a run is out', async () => {
		await open({ change: (campaign) => campaign.set({ resources: { ...campaign.resources, fuel: 0 } }) });
		const poi = firstWhere((candidate) => !candidate.stronghold);
		clickMarker(poi);
		expect(find<AtlasButton>('area_map_plan_button').enabled).toBe(true);
		screen.unmount();

		await open({ change: (campaign) => campaign.startRunDecks({ seats: [campaign.drivers[0], campaign.drivers[4]] }) });
		clickMarker(poi);
		expect(find<AtlasButton>('area_map_plan_button').enabled).toBe(false);
		expect(text('area_map_plan_reason')).toBe('A run is out. Continue from the menu drives it on.');
	});

	it('says how far the map has got while it waits, and drops a map that arrives after it has gone', async () => {
		planning = testMaps(MAP, { held: true });
		screen = new AreaMapScreen({ store: storeOver(storageWith(atHomeText())), maps: planning.maps });
		screen.mount(context);
		for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
		expect(text('area_map_status')).toBe('Making the area map: roads (3 of 6)');
		expect(view().map).toBeNull();
		screen.unmount();
		expect(planning.aborted()).toBe(1);
		await planning.finish();
		expect(planning.asked()).toBe(1);
	});

	it('says so when the map couldn\'t be made', async () => {
		jest.spyOn(console, 'error').mockImplementation(() => undefined);
		planning = testMaps(MAP, { error: new Error('this save\'s map is from an older build') });
		await open();
		expect(text('area_map_status')).toBe("The area map couldn't be made. this save's map is from an older build");
		expect(view().map).toBeNull();
		jest.restoreAllMocks();
	});

	it('goes back to the compound with the campaign on Escape, and to its siblings from the tabs', async () => {
		// Measured in the real faces, so the tabs have their widths to click.
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		await open();
		send(context, [key('Escape')]);
		expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign: screen.shown }, { restoreFocus: true });
		expect(find<SectionTabs>('area_map_tabs').selectedId).toBe('area_map');
		clickOn('area_map_tabs.area_map');
		expect(navigate).toHaveBeenCalledTimes(1);
		clickOn('area_map_tabs.compound');
		expect(navigate).toHaveBeenCalledTimes(2);
		expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign: screen.shown }, { restoreFocus: true });
		clickOn('area_map_tabs.crew');
		expect(navigate).toHaveBeenLastCalledWith('crewScreen', { campaign: screen.shown }, { restoreFocus: true });
		clickOn('area_map_tabs.menu');
		expect(navigate).toHaveBeenLastCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
	});

	it('comes back from a run route with its POI chosen and Plan a run here focused, the map at once', async () => {
		await open();
		const campaign = screen.shown as Campaign;
		const poi = firstWhere((candidate) => !candidate.stronghold && candidate.tier > 1);
		screen.unmount();

		screen = new AreaMapScreen({ store, maps: planning.maps });
		screen.mount(context, { campaign, poi: poi.poi });
		expect(screen.selected).toBe(poi);
		expect(context.focus.focused?.id).toBe('area_map_plan_button');
		// Fitted to the whole disc once laid out, not centred on the POI before it had a size
		context.frame.layout();
		expect(view().camera.isFitted).toBe(true);
		expect(planning.asked()).toBe(1);
	});

	it('says so with no campaign to show', async () => {
		screen = new AreaMapScreen({ store: storeOver(new MemorySaveStorage()), maps: planning.maps });
		screen.mount(context);
		await screen.campaignLoaded;
		expect(text('area_map_status')).toBe('No campaign in progress.');
	});

	it.each([{ width: 1440, height: 882 }, { width: 1024, height: 600 }])('lays out with no lint at $width x $height, measured in the real faces, a POI chosen', async (size) => {
		viewport.logical = size;
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		await open();
		clickMarker(firstWhere((candidate) => !candidate.stronghold));
		context.frame.layout();
		expect(layoutLint(treeSnapshot([screen.root], size)).violations).toEqual([]);
	});
});
