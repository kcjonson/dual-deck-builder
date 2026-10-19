/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import type { Text } from '../../../engine/components/Text';
import type { AtlasButton as Button } from '../../ui/atlas/AtlasButton';
import type { ResourceItem } from '../../ui/atlas/ResourceStrip';
import type { SectionTabs } from '../../ui/atlas/SectionTabs';
import { NO_MODIFIERS } from '../../../engine/input/events';
import { advance, click, key, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { themes } from '../../../engine/theme/tokens';
import { ScreenManager } from '../../core/ScreenManager';
import { Campaign, CampaignData, Resources } from '../../campaign/Campaign';
import type { CampaignStore } from '../../campaign/CampaignStore';
import { MemorySaveStorage } from '../../campaign/SaveStorage';
import { rollScavengeHaul, scavengeMessage } from '../../campaign/Scavenging';
import { routesOnOffer } from '../../campaign/SupplyRun';
import { TestMaps, meshPlanningMap, testMaps } from '../area-map/testing';
import {
	CAMPAIGN_FIXTURE, FaultyStorage, KEYS, damagedText, fixtureText, newCampaign, quotaError, saveText, storageWith, storeOver
} from '../../campaign/__fixtures__/storeFixtures';
import { BUILDINGS, RESOURCE_ORDER } from './compoundText';
import { CompoundScreen } from './CompoundScreen';
import type { BuildingSpot, CompoundYard } from './CompoundYard';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;
/** The compound draws in the atlas theme. */
const { color } = themes.atlas;
const TO_MENU = ['mainMenuScreen', undefined, { restoreFocus: true }];
/** A tab goes with the focus it left restored when it comes back (metaSections). */
const BACK_AGAIN = { restoreFocus: true };
/** Past the window in which a press right after a day ended counts as the same click (the screen's 300 ms). */
const NEXT_PRESS_MS = 320;

/** The campaign's area map in these tests, made once: a mesh with POIs and routes. */
const MAP = meshPlanningMap();

type Fixture = Record<string, unknown> & { resources: Record<string, number>; drivers: { status: string; injuredDays: number }[] };

describe('CompoundScreen', () => {
	const viewport = { logical: { width: 1440, height: 882 } };
	let context: MountContext;
	let screen: CompoundScreen;
	let store: CampaignStore;
	let storage: FaultyStorage;
	/** The campaign's area map, which Plan a supply run reads: a mesh with routes, handed over a task later. */
	let planning: TestMaps;

	/** Mounts the screen over the fixture home from its run, its stores changed if asked, and waits for it to load. */
	async function open(resources: Partial<Resources> = {}): Promise<void> {
		await openText(homeText(resources));
	}

	/** Mounts the screen over the fixture as saved, with its run out, changed first if asked. */
	async function openRunOut(change: (campaign: Fixture) => void = () => undefined): Promise<void> {
		await openText(fixtureText((campaign) => change(campaign as Fixture)));
	}

	/** Mounts the screen over this save text, storage failing as asked from the start, and waits for it to load. */
	async function openText(text: string, { fault = null }: { fault?: FaultyStorage['fault'] } = {}): Promise<void> {
		storage = storageWith(text);
		storage.fault = fault;
		store = storeOver(storage);
		screen = new CompoundScreen({ store, maps: planning.maps });
		screen.mount(context);
		await screen.campaignLoaded;
		context.frame.layout();
	}

	/**
	 * The fixture home from its run, so a night can end the campaign (an end
	 * waits for a run out), its stores changed and its end set if asked, as
	 * save text.
	 */
	function homeText(resources: Partial<Resources>, end: CampaignData['end'] = null, change: (campaign: Campaign) => void = () => undefined): string {
		const campaign = Campaign.fromJSON(JSON.parse(JSON.stringify(CAMPAIGN_FIXTURE)));
		campaign.unwindRunDecks();
		change(campaign);
		campaign.set({ resources: { ...campaign.resources, ...resources }, end });
		return saveText({ campaign: campaign.toSaveText() });
	}

	function find<T>(id: string): T {
		const found = screen.root.findById(id) ?? context.overlays.roots.map((root) => root.findById(id)).find(Boolean);
		if (!found) throw new Error(`no ${id}`);
		return found as unknown as T;
	}

	function text(id: string): string {
		return find<Text>(id).text;
	}

	function needs(): string[] {
		return find<{ children: readonly { id: string | null }[] }>('compound_needs').children
			.filter((row) => row.id?.startsWith('compound_need_') || row.id === 'compound_rumors')
			.map((row) => text(`${row.id}_text`));
	}

	/** A store's value as the strip prints it. */
	function storeValue(kind: string): string {
		return text(`compound_resources_${kind}_value`);
	}

	function tabs(): SectionTabs {
		return find<SectionTabs>('compound_tabs');
	}

	/** How often the screen has gone to the defeat screen, handed the campaign on show. */
	function defeats(): number {
		return navigate.mock.calls.filter(([name, data]) => name === 'defeatScreen' && (data as { campaign?: unknown }).campaign === screen.shown).length;
	}

	/** Lets the store's calls run: a few macrotask turns. */
	async function flush(): Promise<void> {
		for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
	}

	/** A deliberate press of Rest, well after any day before it ended: focus on it, and Enter. */
	async function rest(): Promise<void> {
		advance(context, NEXT_PRESS_MS);
		context.focus.focus(find('compound_rest_button'));
		send(context, [key('Enter')]);
		await flush();
	}

	/** A deliberate press of Scavenge, as `rest` presses Rest. */
	async function scavenge(): Promise<void> {
		advance(context, NEXT_PRESS_MS);
		context.focus.focus(find('compound_scavenge_button'));
		send(context, [key('Enter')]);
		await flush();
	}

	/** A component's box, laid out in the real faces. */
	function bounds(id: string): { x: number; y: number; width: number; height: number } {
		return find<{ screenBounds: { x: number; y: number; width: number; height: number } }>(id).screenBounds;
	}

	/** A pointer click at the middle of a component. */
	function clickOn(id: string): void {
		const { x, y, width, height } = bounds(id);
		click(context, x + width / 2, y + height / 2);
	}

	/** What a party sent out from the fixture's compound on `day` brings back. */
	const haulOn = (day: number) => rollScavengeHaul({ seed: CAMPAIGN_FIXTURE.seed, day });

	/** Scavenge's line for that haul. */
	const scavengeLine = (day: number): string => {
		const { fuel, scrap } = haulOn(day);
		return `Scavenging ends it too, with ${fuel} fuel and ${scrap} scrap.`;
	};

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1440, height: 882 };
		context = createTestContext({ viewport, clock: new Clock() });
		planning = testMaps(MAP);
	});

	afterEach(() => {
		screen?.unmount();
	});

	describe('over the fixture save, home from its run', () => {
		beforeEach(() => open());

		it('shows the title, the day, and the stores above the plate, the stores running short in stronghold red', () => {
			expect(text('compound_title')).toBe('The Compound');
			expect(text('compound_day')).toBe('day 9, dawn');
			expect(RESOURCE_ORDER.map(storeValue)).toEqual(['14', '11', '06', '35', '02', '18']);
			// Food and water run out in 2 days; nothing else runs short.
			expect(RESOURCE_ORDER.map((kind) => find<ResourceItem>(`compound_resources_${kind}`).shortfall)).toEqual([true, true, false, false, false, false]);
			expect(find<ResourceItem>('compound_resources_water').ink).toEqual(color.status_crit);
		});

		it('draws each building on the plate as the campaign has it: the bunkhouse standing, the rest staked out, each numbered with its state', () => {
			const yard = find<CompoundYard>('compound_yard');
			BUILDINGS.forEach((building, index) => {
				const spot = find<BuildingSpot>(`compound_building_${building.id}`);
				expect([spot.number, spot.name, spot.state]).toEqual([String(index + 1), building.name, building.id === 'bunkhouse' ? 'BUILT' : 'not built']);
				expect(yard.isBuilt(building.id)).toBe(building.id === 'bunkhouse');
			});
			expect(find<{ caption: string }>('compound_plate').caption).toBe('Plate 1 · the compound from above, at dawn');
		});

		it('shows the bunkhouse in its box to start: its state, the crew line from the campaign, and its action, circled on the plate', () => {
			expect(screen.selectedBuilding).toBe('bunkhouse');
			expect(text('compound_building_name')).toBe('Bunkhouse');
			expect(text('compound_building_state')).toBe('BUILT');
			expect(text('compound_building_crew_text')).toBe('3 drivers · 3 default decks');
			expect(find<Text>('compound_building_reason').visible).toBe(false);
			const action = find<Button>('compound_building_action');
			expect([action.visible, action.enabled, action.label]).toEqual([true, true, 'Open the bunkhouse']);
			expect(find<CompoundYard>('compound_yard').chosenBuilding).toBe('bunkhouse');
			expect(find<CompoundYard>('compound_yard').loop).not.toBeNull();
			expect(find<Button>('compound_rest_button').enabled).toBe(true);
			expect(find<Button>('compound_scavenge_button').enabled).toBe(true);
			expect(['area_map', 'crew'].map((id) => tabs().tabs.find((tab) => tab.tabId === id)?.enabled)).toEqual([true, true]);
		});

		it('chooses a building pressed on the plate: the box shows it, with why it has no action, and the loop goes round it', () => {
			context.frame.layout();
			clickOn('compound_building_infirmary');
			expect(screen.selectedBuilding).toBe('infirmary');
			expect([text('compound_building_name'), text('compound_building_state')]).toEqual(['Infirmary', 'not built']);
			expect(find<Text>('compound_building_crew').visible).toBe(false);
			expect(find<Button>('compound_building_action').visible).toBe(false);
			expect(find<Text>('compound_building_reason').visible).toBe(true);
			expect(text('compound_building_reason')).toBe("The infirmary isn't built yet.");
			expect(find<CompoundYard>('compound_yard').chosenBuilding).toBe('infirmary');
		});

		it('lists the food and water forecasts, the injured, and an empty rumors line', () => {
			expect(needs()).toEqual([
				'Food runs out in 2 days',
				'Water runs out in 2 days',
				'Mechanic 1 is injured, fit in 2 days',
				'Radio: no new rumors',
			]);
			expect(text('compound_rest_line')).toBe('Ends day 9. The compound eats 5 food and 5 water.');
			// Diamonds for the stores running short, a ring for the injured, the dash for nothing to report
			const symbols = ['compound_need_0', 'compound_need_1', 'compound_need_2', 'compound_rumors']
				.map((id) => find<{ children: readonly { kind?: string }[] }>(id).children[0].kind);
			expect(symbols).toEqual(['diamond', 'diamond', 'ring', 'dash']);
		});

		it('previews under Rest\'s line what a party on foot would bring back today, as the press will bring it', () => {
			expect(text('compound_scavenge_line')).toBe(scavengeLine(9));
			expect(find<Text>('compound_scavenge_line').visible).toBe(true);
		});

		it('moves between Rest and Scavenge with the arrows, the actions being one stop: Down and Right go to Scavenge, Up and Left back', () => {
			context.frame.layout();
			context.focus.focus(find('compound_rest_button'));
			const moves = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].map((arrow) => {
				send(context, [key(arrow)]);
				return context.focus.focused?.id;
			});
			expect(moves).toEqual(['compound_scavenge_button', 'compound_rest_button', 'compound_scavenge_button', 'compound_rest_button']);
		});

		it('starts focus on the Compound tab, and Tab reaches only the live controls: the tabs, the plate, the bunkhouse, the day, and Plan', () => {
			expect(context.focus.focused?.id).toBe('compound_tabs.compound');
			const stops = ['Tab', 'Tab', 'Tab', 'Tab', 'Tab'].map((tab) => {
				send(context, [key(tab)]);
				return context.focus.focused?.id;
			});
			expect(stops).toEqual(['compound_building_bunkhouse', 'compound_building_action', 'compound_rest_button', 'compound_plan_button', 'compound_tabs.compound']);
		});

		it('does nothing on Enter at the Compound tab, the section already open', () => {
			send(context, [key('Enter')]);
			expect(navigate).not.toHaveBeenCalled();
			expect(screen.shown?.day).toBe(9);
		});

		it('opens the Crew screen from the bunkhouse\'s action, or the Crew tab, handing it the campaign', () => {
			context.focus.focus(find('compound_building_action'));
			send(context, [key('Enter')]);
			expect(navigate).toHaveBeenLastCalledWith('crewScreen', { campaign: screen.shown });
			navigate.mockClear();
			tabs().onSelect?.('crew', {} as never);
			expect(navigate).toHaveBeenLastCalledWith('crewScreen', { campaign: screen.shown }, BACK_AGAIN);
		});

		it('opens the area map from its tab, handing it the campaign, and keeps the Compound the open section', () => {
			context.focus.focus(find('compound_tabs.compound'));
			send(context, [key('ArrowRight')]);
			expect(navigate).toHaveBeenLastCalledWith('areaMapScreen', { campaign: screen.shown }, BACK_AGAIN);
			expect(tabs().selectedId).toBe('compound');
		});

		it('keeps the bunkhouse shut while a Rest is being saved', async () => {
			find<Button>('compound_rest_button').onClick?.({} as never);
			find<Button>('compound_building_action').onClick?.({} as never);
			tabs().onSelect?.('area_map', {} as never);
			expect(navigate).not.toHaveBeenCalled();
			await flush();
			find<Button>('compound_building_action').onClick?.({} as never);
			expect(navigate).toHaveBeenLastCalledWith('crewScreen', { campaign: screen.shown });
		});

		it('goes back to the menu with focus restored from the Menu tab, by arrow or press, or on Escape', () => {
			send(context, [key('ArrowLeft')]);
			expect(navigate).toHaveBeenLastCalledWith(...TO_MENU);
			expect(tabs().selectedId).toBe('compound');
			navigate.mockClear();
			tabs().onSelect?.('menu', {} as never);
			expect(navigate).toHaveBeenLastCalledWith(...TO_MENU);
			navigate.mockClear();
			send(context, [key('Escape')]);
			expect(navigate).toHaveBeenLastCalledWith(...TO_MENU);
		});

		it('ends the day on Rest and checkpoints it, then shows the new day, stores, and needs', async () => {
			await rest();
			const campaign = screen.shown;
			expect(campaign?.day).toBe(10);
			expect(campaign?.resources).toMatchObject({ food: 9, water: 6, people: 18 });
			expect((await storeOver(storage).load())?.day).toBe(10);
			expect(text('compound_day')).toBe('day 10, dawn');
			expect(storeValue('food')).toBe('09');
			expect(needs()).toEqual([
				'Food runs out in 1 day',
				'Water runs out in 1 day',
				'Mechanic 1 is injured, fit in 1 day',
				'Radio: no new rumors',
			]);
			expect(text('compound_report')).toBe('Day 9 ended.');
			expect(find<Text>('compound_report').visible).toBe(true);
			expect(text('compound_rest_line')).toBe('Ends day 10. The compound eats 5 food and 5 water.');
			expect(context.focus.focused?.id).toBe('compound_rest_button');
		});

		it('sends a scavenging party on Scavenge: the day ends, the haul comes home, it\'s checkpointed, and the haul leads the report', async () => {
			const haul = haulOn(9);
			await scavenge();
			const campaign = screen.shown;
			expect(campaign?.day).toBe(10);
			expect(campaign?.resources).toMatchObject({ food: 9, water: 6, fuel: 6 + haul.fuel, scrap: 35 + haul.scrap, people: 18 });
			const saved = await storeOver(storage).load();
			expect([saved?.day, saved?.resources.fuel, saved?.resources.scrap]).toEqual([10, 6 + haul.fuel, 35 + haul.scrap]);
			expect(saved?.log.at(-1)).toEqual({ day: 9, message: scavengeMessage(haul) });
			expect(storeValue('fuel')).toBe(String(6 + haul.fuel).padStart(2, '0'));
			expect(text('compound_report')).toBe(`${scavengeMessage(haul)} Day 9 ended.`);
			expect(find<{ color: unknown }>('compound_report').color).toEqual(color.text_dim);
			expect(text('compound_rest_line')).toBe('Ends day 10. The compound eats 5 food and 5 water.');
			expect(text('compound_scavenge_line')).toBe(scavengeLine(10));
			expect(context.focus.focused?.id).toBe('compound_scavenge_button');
		});

		it('ignores a second press of either until the first day end has been saved, and keeps the bunkhouse shut meanwhile', async () => {
			context.focus.focus(find('compound_scavenge_button'));
			send(context, [key('Enter'), key('Enter'), key('ArrowUp'), key('Enter')]);
			expect(context.focus.focused?.id).toBe('compound_rest_button');
			context.focus.focus(find('compound_building_action'));
			send(context, [key('Enter')]);
			expect(navigate).not.toHaveBeenCalled();
			await flush();
			expect(screen.shown?.day).toBe(10);
			expect(screen.shown?.resources.fuel).toBe(6 + haulOn(9).fuel);
			await scavenge();
			expect(screen.shown?.day).toBe(11);
		});

		it('takes the healed off the needs, and reports them', async () => {
			await rest();
			await rest();
			expect(needs()).not.toContainEqual(expect.stringContaining('Mechanic 1'));
			expect(text('compound_report')).toBe('Day 10 ended. Mechanic 1 is fit again.');
			expect(screen.shown?.drivers[2].status).toBe('ready');
		});

		it('chooses buildings from the keyboard: Left and Right step through them by number, wrapping, and Up and Down go across the plate', () => {
			context.frame.layout();
			context.focus.focus(find('compound_building_bunkhouse'), 'keyboard');
			const moves = ['ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowLeft'].map((arrow) => {
				send(context, [key(arrow)]);
				return [context.focus.focused?.id, screen.selectedBuilding];
			});
			expect(moves).toEqual([
				['compound_building_radio_mast', 'radio_mast'],
				['compound_building_infirmary', 'infirmary'],
				['compound_building_radio_mast', 'radio_mast'],
				['compound_building_bunkhouse', 'bunkhouse'],
			]);
			send(context, [key('ArrowLeft')]);
			expect(screen.selectedBuilding).toBe('stores');
			expect(text('compound_building_name')).toBe('Stores');
		});

		it('ignores a second Rest until the first has been saved', async () => {
			const button = find<Button>('compound_rest_button');
			button.onClick?.({} as never);
			button.onClick?.({} as never);
			await flush();
			expect(screen.shown?.day).toBe(10);
		});
	});

	it('marks tonight\'s shortfall as urgent, and reports what a short night cost in the warning colour', async () => {
		await open({ food: 3 });
		expect(needs()[0]).toBe('Food runs out tonight, 2 short');
		expect(find<{ color: unknown }>('compound_need_0_text').color).toEqual(color.status_crit);
		expect(find<{ color: unknown }>('compound_need_1_text').color).toEqual(color.text);
		await rest();
		expect(text('compound_report')).toBe('Day 9 ended. Ran short of 2 food; 2 people lost.');
		expect(find<{ color: unknown }>('compound_report').color).toEqual(color.status_crit);
		expect(screen.shown?.resources.people).toBe(16);
		expect(needs()[0]).toBe('No food: 4 short tonight');
	});

	it('says under Rest when the day could not be saved, keeping the night\'s report, and clears it once a save lands', async () => {
		await open();
		storage.fault = { method: 'setItem', error: quotaError() };
		await rest();
		expect(screen.shown?.day).toBe(10);
		expect(text('compound_report')).toBe('Day 9 ended.');
		expect(text('compound_save_error')).toBe("The campaign couldn't be saved: storage is full.");
		expect(find<{ color: unknown }>('compound_save_error').color).toEqual(color.status_crit);
		storage.fault = null;
		await rest();
		expect(find<Text>('compound_save_error').visible).toBe(false);
		expect((await storeOver(storage).load())?.day).toBe(11);
	});

	it('says under the buttons when a scavenged day could not be saved, keeping the report with its haul, and the next day end saves both', async () => {
		await open();
		const [first, second] = [haulOn(9), haulOn(10)];
		storage.fault = { method: 'setItem', error: quotaError() };
		await scavenge();
		expect(screen.shown?.resources.fuel).toBe(6 + first.fuel);
		expect(text('compound_report')).toBe(`${scavengeMessage(first)} Day 9 ended.`);
		expect(text('compound_save_error')).toBe("The campaign couldn't be saved: storage is full.");
		expect((await storeOver(storage).load())?.day).toBe(9);
		storage.fault = null;
		await scavenge();
		expect(find<Text>('compound_save_error').visible).toBe(false);
		const saved = await storeOver(storage).load();
		expect([saved?.day, saved?.resources.fuel]).toEqual([11, 6 + first.fuel + second.fuel]);
	});

	describe('Plan a supply run (DDB-454, DDB-43)', () => {
		it('opens the area map with the campaign, saying how many destinations it has', async () => {
			await open();
			const campaign = screen.shown as Campaign;
			const destinations = new Set(routesOnOffer({ map: MAP, campaign }).map((route) => route.destination.id)).size;
			expect(find<Button>('compound_plan_button').enabled).toBe(true);
			expect(text('compound_plan_reason')).toBe(`${destinations} destinations on the area map`);
			find<Button>('compound_plan_button').onClick?.({} as never);
			expect(navigate).toHaveBeenLastCalledWith('areaMapScreen', { campaign });
		});

		it('waits for the campaign\'s map with Plan off, saying how far it\'s got, and asks once', async () => {
			planning = testMaps(MAP, { held: true });
			storage = storageWith(homeText({}));
			store = storeOver(storage);
			screen = new CompoundScreen({ store, maps: planning.maps });
			screen.mount(context);
			await flush();
			expect(find<Button>('compound_plan_button').enabled).toBe(false);
			expect(text('compound_plan_reason')).toBe('Making the area map: roads (3 of 6)');
			find<Button>('compound_plan_button').onClick?.({} as never);
			expect(navigate).not.toHaveBeenCalledWith('areaMapScreen', expect.anything());

			const row = find('compound_need_0');
			await planning.finish();
			expect(find<Button>('compound_plan_button').enabled).toBe(true);
			// The map's arrival refreshed the screen, and the Needs, unchanged, kept their rows.
			expect(find('compound_need_0')).toBe(row);
			expect(planning.asked()).toBe(1);

			// Back again with the same campaign, the map is there at once
			const campaign = screen.shown as Campaign;
			screen.unmount();
			screen = new CompoundScreen({ store, maps: planning.maps });
			screen.mount(context, { campaign });
			expect(find<Button>('compound_plan_button').enabled).toBe(true);
			expect(planning.asked()).toBe(1);
		});

		it('says so, with Plan off, when the map couldn\'t be made', async () => {
			jest.spyOn(console, 'error').mockImplementation(() => undefined);
			planning = testMaps(MAP, { error: new Error('no attempts') });
			await open();
			expect(find<Button>('compound_plan_button').enabled).toBe(false);
			expect(text('compound_plan_reason')).toBe("The area map couldn't be made, so no run can be planned.");
		});

		it.each([
			['a run out', () => openRunOut(), 'A run is out. Continue from the menu drives it on.'],
			['too little fuel for any route', () => open({ fuel: 0 }), /^The cheapest route on the area map takes \d fuel, and the stores hold 0\.$/],
			['nobody to send', () => openText(homeText({}, null, (campaign) => [campaign.drivers[0], campaign.drivers[4]].forEach((driver) => driver.set({ status: 'injured', injuredDays: 1, hitpoints: 20 })))),
				'Nobody at the compound is fit to go out.'],
		])('is off with its reason with %s, and does nothing', async (_name, mount, reason) => {
			await mount();
			expect(find<Button>('compound_plan_button').enabled).toBe(false);
			expect(text('compound_plan_reason')).toMatch(reason);
			find<Button>('compound_plan_button').onClick?.({} as never);
			expect(navigate).not.toHaveBeenCalledWith('areaMapScreen', expect.anything());
		});
	});

	it('disables Rest and Scavenge while a run is out, each saying why, since the run\'s return ends the day', async () => {
		await openRunOut();
		expect(find<Button>('compound_rest_button').enabled).toBe(false);
		expect(find<Button>('compound_scavenge_button').enabled).toBe(false);
		expect(text('compound_rest_line')).toBe('A run is out, and its return ends the day.');
		expect(text('compound_scavenge_line')).toBe("A run is out, so no party goes until it's home.");
		const stops = ['Tab', 'Tab', 'Tab'].map((tab) => {
			send(context, [key(tab)]);
			return context.focus.focused?.id;
		});
		expect(stops).toEqual(['compound_building_bunkhouse', 'compound_building_action', 'compound_tabs.compound']);
		expect(find<CompoundYard>('compound_yard').parked).toBe(false);
		// The bunkhouse counts the decks out on the run
		expect(text('compound_building_crew_text')).toBe('3 drivers · 3 default decks');
		find<Button>('compound_rest_button').onClick?.({} as never);
		find<Button>('compound_scavenge_button').onClick?.({} as never);
		await flush();
		expect(screen.shown?.day).toBe(9);
		expect((await storeOver(storage).load())?.day).toBe(9);
	});

	describe('when the last people leave', () => {
		beforeEach(() => openText(homeText({ people: 1, food: 0, water: 0 })));

		it('ends the campaign, whose checkpoint writes its line and removes the save, then goes to the defeat screen with it (DDB-305)', async () => {
			await rest();
			expect(screen.shown?.end).toEqual({ ending: 'starved', cause: 'no_people' });
			// The day stops on the day the compound fell
			expect(text('compound_day')).toBe('day 9, dawn');
			expect(await storeOver(storage).load()).toBeNull();
			expect(await storeOver(storage).history()).toEqual([{ seed: CAMPAIGN_FIXTURE.seed, day: 9, strongholdsTaken: 1, ending: 'starved' }]);
			expect(storage.keys).toEqual([KEYS.history]);
			expect(navigate).toHaveBeenCalledTimes(1);
			expect(navigate).toHaveBeenLastCalledWith('defeatScreen', { campaign: screen.shown });
		});

		it('goes to the defeat screen once, whatever is pressed after the fall', async () => {
			await rest();
			await rest();
			find<Button>('compound_building_action').onClick?.({} as never);
			expect(navigate).toHaveBeenCalledTimes(1);
			expect(defeats()).toBe(1);
		});

		it('stays while the end is unsaved, showing why, and goes to the defeat screen once a Rest ends it, without another night', async () => {
			storage.fault = { method: 'setItem', error: quotaError() };
			await rest();
			expect(defeats()).toBe(0);
			expect(text('compound_save_error')).toBe("The campaign couldn't be ended: storage is full.");
			// The save still holds the day before, and the history has nothing yet
			expect((await storeOver(storage).load())?.resources.people).toBe(1);
			expect(await storeOver(storage).history()).toEqual([]);
			// Retrying while storage still fails ends no day either.
			await rest();
			expect(screen.shown?.day).toBe(9);
			storage.fault = null;
			await rest();
			expect(defeats()).toBe(1);
			expect(await storeOver(storage).load()).toBeNull();
			expect(await storeOver(storage).history()).toHaveLength(1);
			// The injured driver healed one night only.
			expect(screen.shown?.drivers[2]).toMatchObject({ status: 'injured', injuredDays: 1 });
		});

		it('ends the campaign from a scavenged day the same way, the haul in the report and the log, then goes to the defeat screen', async () => {
			const haul = haulOn(9);
			await scavenge();
			expect(screen.shown?.end).toEqual({ ending: 'starved', cause: 'no_people' });
			expect(screen.shown?.resources.fuel).toBe(6 + haul.fuel);
			expect(screen.shown?.log.map((entry) => entry.message)).toContain(scavengeMessage(haul));
			expect(text('compound_report')).toBe(`${scavengeMessage(haul)} Day 9 ended. Ran short of 1 food and 1 water; 1 person lost.`);
			expect(defeats()).toBe(1);
			expect(await storeOver(storage).load()).toBeNull();
			expect(await storeOver(storage).history()).toEqual([{ seed: CAMPAIGN_FIXTURE.seed, day: 9, strongholdsTaken: 1, ending: 'starved' }]);
		});

		it('stays when a scavenged fall can\'t be saved, disables Scavenge as over, and lets Rest save the end without another night', async () => {
			storage.fault = { method: 'setItem', error: quotaError() };
			await scavenge();
			expect(defeats()).toBe(0);
			expect(text('compound_save_error')).toBe("The campaign couldn't be ended: storage is full.");
			expect(find<Button>('compound_scavenge_button').enabled).toBe(false);
			expect(text('compound_scavenge_line')).toBe('The campaign is over, so no party goes out.');
			expect(find<Button>('compound_rest_button').enabled).toBe(true);
			// Focus was on Scavenge, which disabled itself; it moves to Rest, which saves the end, not to nothing.
			expect(context.focus.focused?.id).toBe('compound_rest_button');
			expect(text('compound_rest_line')).toBe('The compound has fallen. Rest saves its end again.');
			find<Button>('compound_scavenge_button').onClick?.({} as never);
			await flush();
			expect(await storeOver(storage).history()).toEqual([]);
			storage.fault = null;
			await rest();
			expect(defeats()).toBe(1);
			expect(screen.shown?.day).toBe(9);
			expect(screen.shown?.resources.fuel).toBe(6 + haulOn(9).fuel);
			expect(await storeOver(storage).history()).toHaveLength(1);
		});

		it('goes to the defeat screen with a lost campaign whose end an earlier checkpoint saved, recording nothing more', async () => {
			await rest();
			const lost = screen.shown as Campaign;
			screen.unmount();
			navigate.mockClear();

			// Handed back the campaign whose end is already in the history, as a screen left open could hand it
			screen = new CompoundScreen({ store, maps: planning.maps });
			screen.mount(context, { campaign: lost });
			await flush();

			expect(defeats()).toBe(1);
			expect(find<Text>('compound_save_error').visible).toBe(false);
			expect(await storeOver(storage).history()).toHaveLength(1);
		});

		it('strands a lost campaign the store has moved on from: no defeat screen, nothing more saved, and only the menu left', async () => {
			// Loading the save again moves the store on from the instance on show, which ends nothing in the history
			await store.load();
			await rest();
			expect(screen.shown?.isOver).toBe(true);
			expect(defeats()).toBe(0);
			expectStranded();
			// The save still holds the day before the fall, for Back to menu to pick up
			expect((await storeOver(storage).load())?.resources.people).toBe(1);
			expect(await storeOver(storage).history()).toEqual([]);
			send(context, [key('Escape')]);
			expect(navigate).toHaveBeenLastCalledWith(...TO_MENU);
			expect(navigate).toHaveBeenCalledTimes(1);
		});
	});

	/** Over the buttons, that nothing more is saved here; Rest, Scavenge, Plan, the bunkhouse, and the tabs but Menu off, each saying why; focus on the Compound tab. */
	function expectStranded(): void {
		expect(text('compound_save_error')).toBe("This campaign isn't the save any more, so nothing more is saved here. Back to menu to pick up the save.");
		expect(find<{ color: unknown }>('compound_save_error').color).toEqual(color.status_crit);
		expect(find<Button>('compound_rest_button').enabled).toBe(false);
		expect(find<Button>('compound_scavenge_button').enabled).toBe(false);
		expect(find<Button>('compound_plan_button').enabled).toBe(false);
		expect(text('compound_rest_line')).toBe('Nothing more is saved here, so no day ends.');
		expect(text('compound_scavenge_line')).toBe('');
		expect(find<Button>('compound_building_action').enabled).toBe(false);
		expect(text('compound_building_reason')).toBe('Shut, since nothing more is saved here.');
		expect(find<Text>('compound_building_reason').visible).toBe(true);
		expect(['menu', 'area_map', 'crew'].map((id) => tabs().tabs.find((tab) => tab.tabId === id)?.enabled)).toEqual([true, false, false]);
		expect(context.focus.focused?.id).toBe('compound_tabs.compound');
	}

	it('strands a standing campaign the store has moved on from, its day ended but nothing more saved, and the menu still open', async () => {
		await open();
		await store.load();
		await rest();
		expect(screen.shown?.day).toBe(10);
		expectStranded();
		// Even pressed past their disabled state, nothing starts
		advance(context, NEXT_PRESS_MS);
		for (const id of ['compound_rest_button', 'compound_scavenge_button', 'compound_building_action', 'compound_plan_button']) find<Button>(id).onClick?.({} as never);
		tabs().onSelect?.('crew', {} as never);
		await flush();
		expect(screen.shown?.day).toBe(10);
		expect(navigate).not.toHaveBeenCalled();
		send(context, [key('Escape')]);
		expect(navigate).toHaveBeenLastCalledWith(...TO_MENU);
	});

	it('strands a standing campaign that was ended elsewhere, as abandoned', async () => {
		await open();
		await store.end({ campaign: screen.shown as Campaign, ending: 'abandoned' });
		await rest();
		expect(defeats()).toBe(0);
		expectStranded();
	});

	it('ends a save that holds a campaign already over, as another tab or a hand-made save could leave one, then goes to the defeat screen', async () => {
		await openText(homeText({ people: 0 }, { ending: 'disbanded', cause: 'no_people' }));
		await flush();
		expect(await storeOver(storage).load()).toBeNull();
		expect(await storeOver(storage).history()).toEqual([{ seed: CAMPAIGN_FIXTURE.seed, day: 9, strongholdsTaken: 1, ending: 'disbanded' }]);
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(defeats()).toBe(1);
	});

	it('retries the end of a save already over with Rest when its checkpoint failed as the screen opened, ending no day', async () => {
		await openText(homeText({ people: 0 }, { ending: 'disbanded', cause: 'no_people' }), { fault: { method: 'setItem', error: quotaError() } });
		await flush();
		expect(defeats()).toBe(0);
		expect(text('compound_save_error')).toBe("The campaign couldn't be ended: storage is full.");
		expect(text('compound_rest_line')).toBe('The compound has fallen. Rest saves its end again.');
		expect(find<Button>('compound_scavenge_button').enabled).toBe(false);
		expect(text('compound_scavenge_line')).toBe('The campaign is over, so no party goes out.');
		expect(await storeOver(storage).history()).toEqual([]);
		storage.fault = null;

		await rest();

		expect(defeats()).toBe(1);
		expect(screen.shown?.day).toBe(9);
		expect(await storeOver(storage).load()).toBeNull();
		expect(await storeOver(storage).history()).toEqual([{ seed: CAMPAIGN_FIXTURE.seed, day: 9, strongholdsTaken: 1, ending: 'disbanded' }]);
	});

	it('says nothing has fallen while a run is out at 0 People, since the end waits for the run to come home, and sends nobody out', async () => {
		await openRunOut((campaign) => { campaign.resources.people = 0; });
		await flush();
		expect(defeats()).toBe(0);
		expect(screen.shown?.isOver).toBe(false);
		expect(find<Button>('compound_scavenge_button').enabled).toBe(false);
		expect(text('compound_scavenge_line')).toBe('Nobody is left to send out.');
		expect(find<Button>('compound_rest_button').enabled).toBe(false);
	});

	describe('opened with or without a campaign handed over', () => {
		it('shows the campaign it is handed without reading the save', async () => {
			store = storeOver(new MemorySaveStorage());
			const campaign = newCampaign();
			campaign.set({ resources: { ...campaign.resources, people: 12, food: 21, water: 21 } });
			screen = new CompoundScreen({ store, maps: planning.maps });
			screen.mount(context, { campaign });
			expect(screen.shown).toBe(campaign);
			expect(text('compound_day')).toBe('day 1, dawn');
			expect(navigate).not.toHaveBeenCalled();
		});

		it('draws what the campaign has built, and stakes out the bunkhouse in one that hasn\'t, its action gone and the Crew tab off', () => {
			store = storeOver(new MemorySaveStorage());
			const campaign = newCampaign();
			campaign.set({ buildings: ['infirmary', 'garage'] });
			screen = new CompoundScreen({ store, maps: planning.maps });
			screen.mount(context, { campaign });
			const yard = find<CompoundYard>('compound_yard');
			expect(BUILDINGS.map((building) => yard.isBuilt(building.id))).toEqual([false, false, true, false, true, false]);
			expect(find<BuildingSpot>('compound_building_garage').state).toBe('BUILT');
			expect(find<Button>('compound_building_action').visible).toBe(false);
			expect(text('compound_building_reason')).toBe("The bunkhouse isn't built yet.");
			expect(tabs().tabs.find((tab) => tab.tabId === 'crew')?.enabled).toBe(false);
			find<Button>('compound_building_action').onClick?.({} as never);
			expect(navigate).not.toHaveBeenCalled();
		});

		it('says why Rest is disabled when there is no save, or it is damaged', async () => {
			store = storeOver(new MemorySaveStorage());
			screen = new CompoundScreen({ store, maps: planning.maps });
			screen.mount(context);
			await screen.campaignLoaded;
			expect(find<Button>('compound_rest_button').enabled).toBe(false);
			expect(find<Button>('compound_scavenge_button').enabled).toBe(false);
			expect(text('compound_scavenge_line')).toBe('');
			expect(find<Button>('compound_building_action').enabled).toBe(false);
			expect(find<Text>('compound_building_reason').visible).toBe(true);
			expect(text('compound_building_reason')).toBe('Opens with a campaign in progress.');
			expect(text('compound_rest_line')).toBe('No campaign in progress.');
			expect(find<{ visible: boolean }>('compound_resources').visible).toBe(false);
			expect(find<{ visible: boolean }>('compound_day').visible).toBe(false);
			expect(find<{ visible: boolean }>('compound_needs').visible).toBe(false);
			expect(['area_map', 'crew'].map((id) => tabs().tabs.find((tab) => tab.tabId === id)?.enabled)).toEqual([false, false]);
			screen.unmount();

			store = storeOver(storageWith(damagedText()));
			screen = new CompoundScreen({ store, maps: planning.maps });
			screen.mount(context);
			await screen.campaignLoaded;
			expect(text('compound_rest_line')).toBe("The saved campaign is damaged and can't be loaded. It's been kept.");
		});
	});

	/** States the side column has to hold: the buttons live, refused with their reasons, and a scavenged night's longest report. */
	const LAYOUTS: { name: string; mount: () => Promise<void> }[] = [
		{ name: 'at home', mount: () => open() },
		{ name: 'a run out', mount: () => openRunOut() },
		{
			name: 'a scavenged night that ran short and healed someone',
			mount: async () => {
				await open({ food: 3 });
				screen.shown?.drivers[2].set({ injuredDays: 1 });
				await scavenge();
			},
		},
		{
			name: 'four-digit stores after a scavenged night',
			mount: async () => {
				await open({ food: 9999, water: 9999, fuel: 9990, scrap: 9900, meds: 9999, people: 9999 });
				await scavenge();
			},
		},
	];

	const LAYOUT_CASES = [{ width: 1440, height: 882 }, { width: 1024, height: 600 }]
		.flatMap((size) => LAYOUTS.map(({ name, mount }) => ({ ...size, name, mount })));

	it.each(LAYOUT_CASES)('lays out with no lint at $width x $height with $name, measured in the real faces', async ({ width, height, mount }) => {
		const size = { width, height };
		viewport.logical = size;
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		await mount();
		context.frame.layout();
		const lint = layoutLint(treeSnapshot([screen.root], size));
		expect(lint.violations).toEqual([]);
		const side = find<{ screenBounds: { x: number; y: number; width: number; height: number } }>('compound_side').screenBounds;
		expect(side.x + side.width).toBeLessThanOrEqual(size.width);
		expect(side.y + side.height).toBeLessThanOrEqual(size.height);
		const plan = find<{ screenBounds: { y: number; height: number } }>('compound_plan_reason').screenBounds;
		expect(plan.y + plan.height).toBeLessThanOrEqual(size.height);
	});

	/** Every resource at an amount, at 1024x600 and measured in the real faces. */
	async function stores(amount: number | Record<string, number>): Promise<void> {
		viewport.logical = { width: 1024, height: 600 };
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		await open(Object.fromEntries(RESOURCE_ORDER.map((resource) => [resource, typeof amount === 'number' ? amount : amount[resource]])));
	}

	/** The stores stay inside the plate's column, and nothing lints (R13.29). */
	function storesInsideTheColumn(): void {
		expect(layoutLint(treeSnapshot([screen.root], viewport.logical)).violations).toEqual([]);
		const column = bounds('compound_plate_column');
		for (const kind of RESOURCE_ORDER) {
			const item = bounds(`compound_resources_${kind}`);
			expect(item.x + item.width).toBeLessThanOrEqual(column.x + column.width);
		}
	}

	it.each([
		{ name: 'mid-campaign stores', amount: { food: 180, water: 160, fuel: 40, scrap: 2400, meds: 25, people: 36 } },
		{ name: 'three digits everywhere', amount: 999 },
		{ name: 'four digits everywhere', amount: 9999 },
	])('keeps the stores inside the plate column at 1024x600 with $name', async ({ amount }) => {
		await stores(amount);
		storesInsideTheColumn();
	});

	it('abbreviates the stores past four digits, so even a runaway number fits at 1024x600', async () => {
		await stores(Number.MAX_SAFE_INTEGER);
		expect(storeValue('scrap')).toBe('9Q');
		storesInsideTheColumn();
	});

	it.each([{ width: 1440, height: 882 }, { width: 1024, height: 600 }])('fits the plate to the room at $width x $height, its buildings at least 44 px across, and widens the column on a short window', async (size) => {
		viewport.logical = size;
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		await open();
		context.frame.layout();
		const plate = bounds('compound_yard');
		for (const building of BUILDINGS) {
			const spot = bounds(`compound_building_${building.id}`);
			expect(Math.min(spot.width, spot.height)).toBeGreaterThanOrEqual(44);
			expect(spot.x).toBeGreaterThanOrEqual(plate.x);
			expect(spot.y + spot.height).toBeLessThanOrEqual(plate.y + plate.height);
		}
		expect(bounds('compound_side').width).toBe(452);
	});

	it('lays out with no lint at 1024x600 with no campaign to show', async () => {
		viewport.logical = { width: 1024, height: 600 };
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		screen = new CompoundScreen({ store: storeOver(new MemorySaveStorage()), maps: planning.maps });
		screen.mount(context);
		await screen.campaignLoaded;
		context.frame.layout();
		expect(layoutLint(treeSnapshot([screen.root], viewport.logical)).violations).toEqual([]);
	});

	it.each([{ width: 1024, height: 600 }, { width: 1440, height: 882 }])('lays out with no lint at $width x $height once stranded', async (size) => {
		viewport.logical = size;
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		await open();
		await store.load();
		await rest();
		context.frame.layout();
		expectStranded();
		expect(layoutLint(treeSnapshot([screen.root], viewport.logical)).violations).toEqual([]);
	});

	describe('pressed with the pointer, laid out in the real faces', () => {
		beforeEach(async () => {
			context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
			await open();
		});

		it('goes round the column from Rest with Tab and Shift+Tab, past the scrolling boxes, which are no stop', () => {
			context.frame.layout();
			context.focus.focus(find('compound_rest_button'));
			send(context, [{ kind: 'key', phase: 'down', key: 'Tab', repeat: false, modifiers: { ...NO_MODIFIERS, shift: true } }]);
			expect(context.focus.focused?.id).toBe('compound_building_action');
			const stops = ['Tab', 'Tab'].map((tab) => {
				send(context, [key(tab)]);
				return context.focus.focused?.id;
			});
			expect(stops).toEqual(['compound_rest_button', 'compound_plan_button']);
		});

		it('chooses a building with the pointer and opens the bunkhouse from its box', () => {
			context.frame.layout();
			clickOn('compound_building_stores');
			expect(screen.selectedBuilding).toBe('stores');
			clickOn('compound_building_bunkhouse');
			expect(screen.selectedBuilding).toBe('bunkhouse');
			context.frame.layout();
			clickOn('compound_building_action');
			expect(navigate).toHaveBeenLastCalledWith('crewScreen', { campaign: screen.shown });
		});

		it('clicks Rest and Scavenge like any button', async () => {
			clickOn('compound_rest_button');
			await flush();
			expect(screen.shown?.day).toBe(10);
			advance(context, NEXT_PRESS_MS);
			clickOn('compound_scavenge_button');
			await flush();
			expect(screen.shown?.day).toBe(11);
		});

		it.each([
			{ button: 'compound_scavenge_button', gap: 100, days: 1 },
			{ button: 'compound_scavenge_button', gap: 400, days: 2 },
			{ button: 'compound_rest_button', gap: 100, days: 1 },
			{ button: 'compound_rest_button', gap: 400, days: 2 },
		])('ends $days day(s) from two clicks on $button $gap ms apart, a double-click being one press', async ({ button, gap, days }) => {
			clickOn(button);
			await flush();
			advance(context, gap);
			clickOn(button);
			await flush();
			expect(screen.shown?.day).toBe(9 + days);
			expect((await storeOver(storage).load())?.day).toBe(9 + days);
		});

		it('keeps Rest and Scavenge where they are as the report, the lines, and a save failure come and go', async () => {
			// The injured mechanic stays injured, so the Needs above hold their rows across the nights.
			screen.shown?.drivers[2].set({ injuredDays: 5 });
			context.frame.layout();
			const where = () => [bounds('compound_rest_button').y, bounds('compound_scavenge_button').y];
			const start = where();
			clickOn('compound_scavenge_button');
			await flush();
			context.frame.layout();
			expect(find<Text>('compound_report').visible).toBe(true);
			expect(where()).toEqual(start);
			storage.fault = { method: 'setItem', error: quotaError() };
			advance(context, NEXT_PRESS_MS);
			clickOn('compound_scavenge_button');
			await flush();
			context.frame.layout();
			expect(find<Text>('compound_save_error').visible).toBe(true);
			expect(where()).toEqual(start);
		});
	});
});
