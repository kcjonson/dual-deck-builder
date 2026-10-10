/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { createTestContext } from '../../../engine/components/testing';
import type { Component } from '../../../engine/components/Component';
import type { MountContext } from '../../../engine/components/MountContext';
import type { Text } from '../../../engine/components/Text';
import type { Button } from '../../../engine/ui/Button';
import { advance, click, key, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { tokens } from '../../../engine/theme/tokens';
import { ScreenManager } from '../../core/ScreenManager';
import { Campaign, CampaignData, Resources } from '../../campaign/Campaign';
import type { CampaignStore } from '../../campaign/CampaignStore';
import { MemorySaveStorage } from '../../campaign/SaveStorage';
import { rollScavengeHaul, scavengeMessage } from '../../campaign/Scavenging';
import {
	CAMPAIGN_FIXTURE, FaultyStorage, KEYS, damagedText, fixtureText, newCampaign, quotaError, saveText, storageWith, storeOver
} from '../../campaign/__fixtures__/storeFixtures';
import { BUILDINGS, RESOURCE_ORDER } from './compoundText';
import { CompoundScreen } from './CompoundScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;
const OPEN_MS = tokens.motion.dur + 32;
const CLOSE_MS = tokens.motion.dur_fast + 32;
const TO_MENU = ['mainMenuScreen', undefined, { restoreFocus: true }];
/** Past the window in which a press right after a day ended counts as the same click (the screen's 300 ms). */
const NEXT_PRESS_MS = 320;

type Fixture = Record<string, unknown> & { resources: Record<string, number>; drivers: { status: string; injuredDays: number }[] };

describe('CompoundScreen', () => {
	const viewport = { logical: { width: 1440, height: 882 } };
	let context: MountContext;
	let screen: CompoundScreen;
	let store: CampaignStore;
	let storage: FaultyStorage;

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
		screen = new CompoundScreen({ store });
		screen.mount(context);
		await screen.campaignLoaded;
		context.frame.layout();
	}

	/**
	 * The fixture home from its run, so a night can end the campaign (an end
	 * waits for a run out), its stores changed and its end set if asked, as
	 * save text.
	 */
	function homeText(resources: Partial<Resources>, end: CampaignData['end'] = null): string {
		const campaign = Campaign.fromJSON(JSON.parse(JSON.stringify(CAMPAIGN_FIXTURE)));
		campaign.unwindRunDecks();
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
		return find<{ children: readonly { id: string | null }[] }>('compound_needs').children.map((row) => text(`${row.id}_text`));
	}

	function fallen(): boolean {
		return context.overlays.roots.some((root) => root.findById('compound_fallen_dialog'));
	}

	/** The kicker over the notice's title: the first panel kicker in the overlays. */
	function noticeKicker(): string | null {
		const walk = (component: Component): string | null => {
			const kicker = (component as { kicker?: unknown }).kicker;
			if (typeof kicker === 'string') return kicker;
			for (const child of component.children) {
				const found = walk(child);
				if (found !== null) return found;
			}
			return null;
		};
		return context.overlays.roots.map(walk).find((kicker) => kicker !== null) ?? null;
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
	});

	afterEach(() => {
		screen?.unmount();
	});

	describe('over the fixture save, home from its run', () => {
		beforeEach(() => open());

		it('shows the day and the stores along the top', () => {
			expect(text('compound_title')).toBe('The Compound');
			expect(text('compound_day')).toBe('Day 9 / dawn');
			const chips = ['food', 'water', 'fuel', 'scrap', 'meds', 'people']
				.map((resource) => find<{ children: readonly Text[] }>(`compound_resource_${resource}`).children[0].text);
			expect(chips).toEqual(['Food 14', 'Water 11', 'Fuel 6', 'Scrap 35', 'Meds 2', 'People 18']);
		});

		it('names each building at the top of its tile, and disables those with nothing behind them, the Area map, and Plan a supply run, each with its reason on screen', () => {
			for (const building of BUILDINGS) {
				expect(text(`compound_building_${building.id}_name`)).toBe(building.name);
				expect(find<{ color: unknown }>(`compound_building_${building.id}_name`).color).toEqual(tokens.color.text_bright);
				if (building.reason === null) continue;
				expect(find<Button>(`compound_building_${building.id}_button`).enabled).toBe(false);
				expect(find<Text>(`compound_building_${building.id}_reason`).visible).toBe(true);
				expect(text(`compound_building_${building.id}_reason`)).toBe(building.reason);
			}
			expect(find<Button>('compound_building_bunkhouse_button').enabled).toBe(true);
			expect(find<Text>('compound_building_bunkhouse_reason').visible).toBe(false);
			// The Map room's tile carries the Area map's reason.
			expect(find<Button>('compound_area_map_button').enabled).toBe(false);
			expect(text('compound_building_map_room_reason')).toBe("The area map isn't built yet.");
			expect(find<Button>('compound_plan_button').enabled).toBe(false);
			expect(text('compound_plan_reason')).toBe("Load out and the run route aren't built yet.");
			expect(find<Button>('compound_rest_button').enabled).toBe(true);
			expect(find<Button>('compound_scavenge_button').enabled).toBe(true);
		});

		it('lists the food and water forecasts, the injured, and an empty rumors line', () => {
			expect(needs()).toEqual([
				'Food runs out in 2 days',
				'Water runs out in 2 days',
				'Mechanic 1 is injured, fit in 2 days',
				'Radio: no new rumors',
			]);
			expect(text('compound_rest_line')).toBe('Ends day 9. The compound eats 5 food and 5 water.');
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

		it('starts focus on Back to menu, and Tab reaches only the live controls: Back, the Bunkhouse, and the actions at Rest', () => {
			expect(context.focus.focused?.id).toBe('compound_back_button');
			const stops = ['Tab', 'Tab', 'Tab'].map((tab) => {
				send(context, [key(tab)]);
				return context.focus.focused?.id;
			});
			expect(stops).toEqual(['compound_building_bunkhouse_button', 'compound_rest_button', 'compound_back_button']);
			context.focus.focus(find('compound_building_garage_button'));
			expect(context.focus.focused?.id).toBe('compound_back_button');
		});

		it('opens the Crew screen from the Bunkhouse, handing it the campaign', () => {
			context.focus.focus(find('compound_building_bunkhouse_button'));
			send(context, [key('Enter')]);
			expect(navigate).toHaveBeenLastCalledWith('crewScreen', { campaign: screen.shown });
		});

		it('keeps the Bunkhouse shut while a Rest is being saved', async () => {
			find<Button>('compound_rest_button').onClick?.({} as never);
			find<Button>('compound_building_bunkhouse_button').onClick?.({} as never);
			expect(navigate).not.toHaveBeenCalled();
			await flush();
			find<Button>('compound_building_bunkhouse_button').onClick?.({} as never);
			expect(navigate).toHaveBeenLastCalledWith('crewScreen', { campaign: screen.shown });
		});

		it('goes back to the menu with focus restored on Back, Enter on Back, or Escape', () => {
			find<Button>('compound_back_button').onClick?.({} as never);
			expect(navigate).toHaveBeenLastCalledWith(...TO_MENU);
			navigate.mockClear();
			send(context, [key('Enter')]);
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
			expect(text('compound_day')).toBe('Day 10 / dawn');
			expect(find<{ children: readonly Text[] }>('compound_resource_food').children[0].text).toBe('Food 9');
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
			expect(find<{ children: readonly Text[] }>('compound_resource_fuel').children[0].text).toBe(`Fuel ${6 + haul.fuel}`);
			expect(text('compound_report')).toBe(`${scavengeMessage(haul)} Day 9 ended.`);
			expect(find<{ color: unknown }>('compound_report').color).toEqual(tokens.color.text_dim);
			expect(text('compound_rest_line')).toBe('Ends day 10. The compound eats 5 food and 5 water.');
			expect(text('compound_scavenge_line')).toBe(scavengeLine(10));
			expect(context.focus.focused?.id).toBe('compound_scavenge_button');
		});

		it('ignores a second press of either until the first day end has been saved, and keeps the Bunkhouse shut meanwhile', async () => {
			context.focus.focus(find('compound_scavenge_button'));
			send(context, [key('Enter'), key('Enter'), key('ArrowUp'), key('Enter')]);
			expect(context.focus.focused?.id).toBe('compound_rest_button');
			context.focus.focus(find('compound_building_bunkhouse_button'));
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

		it('moves through the buildings with Left and Right, and between the rows with Up and Down, once they are live', () => {
			for (const building of BUILDINGS) find<Button>(`compound_building_${building.id}_button`).enabled = true;
			context.frame.layout();
			context.focus.focus(find('compound_building_bunkhouse_button'));
			const moves = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].map((arrow) => {
				send(context, [key(arrow)]);
				return context.focus.focused?.id;
			});
			expect(moves).toEqual([
				'compound_building_radio_mast_button',
				'compound_building_map_room_button',
				'compound_building_garage_button',
				'compound_building_bunkhouse_button',
			]);
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
		expect(find<{ color: unknown }>('compound_need_0_text').color).toEqual(tokens.color.status_crit);
		await rest();
		expect(text('compound_report')).toBe('Day 9 ended. Ran short of 2 food; 2 people lost.');
		expect(find<{ color: unknown }>('compound_report').color).toEqual(tokens.color.status_warn);
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
		expect(find<{ color: unknown }>('compound_save_error').color).toEqual(tokens.color.status_crit);
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

	it('disables Rest and Scavenge while a run is out, each saying why, since the run\'s return ends the day', async () => {
		await openRunOut();
		expect(find<Button>('compound_rest_button').enabled).toBe(false);
		expect(find<Button>('compound_scavenge_button').enabled).toBe(false);
		expect(text('compound_rest_line')).toBe('A run is out, and its return ends the day.');
		expect(text('compound_scavenge_line')).toBe("A run is out, so no party goes until it's home.");
		const stops = ['Tab', 'Tab'].map((tab) => {
			send(context, [key(tab)]);
			return context.focus.focused?.id;
		});
		expect(stops).toEqual(['compound_building_bunkhouse_button', 'compound_back_button']);
		find<Button>('compound_rest_button').onClick?.({} as never);
		find<Button>('compound_scavenge_button').onClick?.({} as never);
		await flush();
		expect(screen.shown?.day).toBe(9);
		expect((await storeOver(storage).load())?.day).toBe(9);
	});

	describe('when the last people leave', () => {
		beforeEach(() => openText(homeText({ people: 1, food: 0, water: 0 })));

		it('ends the campaign, whose checkpoint writes its line and removes the save, then says the compound has fallen, and its button goes to the menu (DDB-305)', async () => {
			expect(fallen()).toBe(false);
			await rest();
			advance(context, OPEN_MS);
			expect(screen.shown?.end).toEqual({ ending: 'starved', cause: 'no_people' });
			expect(fallen()).toBe(true);
			expect(text('compound_fallen_body')).toBe('Nobody is left at the compound. The campaign is lost.');
			// The day stops on the day the compound fell
			expect(noticeKicker()).toBe('Day 9 / dawn');
			expect(await storeOver(storage).load()).toBeNull();
			expect(await storeOver(storage).history()).toEqual([{ seed: CAMPAIGN_FIXTURE.seed, day: 9, strongholdsTaken: 1, ending: 'starved' }]);
			expect(storage.keys).toEqual([KEYS.history]);
			expect(context.focus.focused?.id).toBe('compound_fallen_back');
			expect(navigate).not.toHaveBeenCalled();
			send(context, [key('Enter')]);
			advance(context, CLOSE_MS);
			expect(navigate).toHaveBeenCalledTimes(1);
			expect(navigate).toHaveBeenLastCalledWith(...TO_MENU);
		});

		it('holds the notice back while the end is unsaved, showing why, and opens it once a Rest ends it, without another night', async () => {
			storage.fault = { method: 'setItem', error: quotaError() };
			await rest();
			advance(context, OPEN_MS);
			expect(fallen()).toBe(false);
			expect(text('compound_save_error')).toBe("The campaign couldn't be ended: storage is full.");
			// The save still holds the day before, and the history has nothing yet
			expect((await storeOver(storage).load())?.resources.people).toBe(1);
			expect(await storeOver(storage).history()).toEqual([]);
			// Retrying while storage still fails ends no day either.
			await rest();
			expect(screen.shown?.day).toBe(9);
			storage.fault = null;
			await rest();
			advance(context, OPEN_MS);
			expect(fallen()).toBe(true);
			expect(noticeKicker()).toBe('Day 9 / dawn');
			expect(await storeOver(storage).load()).toBeNull();
			expect(await storeOver(storage).history()).toHaveLength(1);
			// The injured driver healed one night only.
			expect(screen.shown?.drivers[2]).toMatchObject({ status: 'injured', injuredDays: 1 });
		});

		it('ends the campaign from a scavenged day the same way, the haul in the report and the log, then says the compound has fallen', async () => {
			const haul = haulOn(9);
			await scavenge();
			advance(context, OPEN_MS);
			expect(screen.shown?.end).toEqual({ ending: 'starved', cause: 'no_people' });
			expect(screen.shown?.resources.fuel).toBe(6 + haul.fuel);
			expect(screen.shown?.log.map((entry) => entry.message)).toContain(scavengeMessage(haul));
			expect(text('compound_report')).toBe(`${scavengeMessage(haul)} Day 9 ended. Ran short of 1 food and 1 water; 1 person lost.`);
			expect(fallen()).toBe(true);
			expect(await storeOver(storage).load()).toBeNull();
			expect(await storeOver(storage).history()).toEqual([{ seed: CAMPAIGN_FIXTURE.seed, day: 9, strongholdsTaken: 1, ending: 'starved' }]);
		});

		it('holds the notice back when a scavenged fall can\'t be saved, disables Scavenge as over, and lets Rest save the end without another night', async () => {
			storage.fault = { method: 'setItem', error: quotaError() };
			await scavenge();
			advance(context, OPEN_MS);
			expect(fallen()).toBe(false);
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
			advance(context, OPEN_MS);
			expect(fallen()).toBe(true);
			expect(screen.shown?.day).toBe(9);
			expect(screen.shown?.resources.fuel).toBe(6 + haulOn(9).fuel);
			expect(await storeOver(storage).history()).toHaveLength(1);
		});

		it('goes to the menu on Escape, with no hotkey beneath the notice firing twice', async () => {
			await rest();
			advance(context, OPEN_MS);
			send(context, [key('Escape')]);
			advance(context, CLOSE_MS);
			expect(navigate).toHaveBeenCalledTimes(1);
			expect(navigate).toHaveBeenLastCalledWith(...TO_MENU);
		});
	});

	it('ends a save that holds a campaign already over, as another tab or a hand-made save could leave one, then says the compound has fallen', async () => {
		await openText(homeText({ people: 0 }, { ending: 'disbanded', cause: 'no_people' }));
		await flush();
		advance(context, OPEN_MS);
		expect(fallen()).toBe(true);
		expect(await storeOver(storage).load()).toBeNull();
		expect(await storeOver(storage).history()).toEqual([{ seed: CAMPAIGN_FIXTURE.seed, day: 9, strongholdsTaken: 1, ending: 'disbanded' }]);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('retries the end of a save already over with Rest when its checkpoint failed as the screen opened, ending no day', async () => {
		await openText(homeText({ people: 0 }, { ending: 'disbanded', cause: 'no_people' }), { fault: { method: 'setItem', error: quotaError() } });
		await flush();
		advance(context, OPEN_MS);
		expect(fallen()).toBe(false);
		expect(text('compound_save_error')).toBe("The campaign couldn't be ended: storage is full.");
		expect(text('compound_rest_line')).toBe('The compound has fallen. Rest saves its end again.');
		expect(find<Button>('compound_scavenge_button').enabled).toBe(false);
		expect(text('compound_scavenge_line')).toBe('The campaign is over, so no party goes out.');
		expect(await storeOver(storage).history()).toEqual([]);
		storage.fault = null;

		await rest();
		advance(context, OPEN_MS);

		expect(fallen()).toBe(true);
		expect(screen.shown?.day).toBe(9);
		expect(await storeOver(storage).load()).toBeNull();
		expect(await storeOver(storage).history()).toEqual([{ seed: CAMPAIGN_FIXTURE.seed, day: 9, strongholdsTaken: 1, ending: 'disbanded' }]);
	});

	it('says nothing has fallen while a run is out at 0 People, since the end waits for the run to come home, and sends nobody out', async () => {
		await openRunOut((campaign) => { campaign.resources.people = 0; });
		await flush();
		advance(context, OPEN_MS);
		expect(fallen()).toBe(false);
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
			screen = new CompoundScreen({ store });
			screen.mount(context, { campaign });
			expect(screen.shown).toBe(campaign);
			expect(text('compound_day')).toBe('Day 1 / dawn');
			expect(fallen()).toBe(false);
		});

		it('says why Rest is disabled when there is no save, or it is damaged', async () => {
			store = storeOver(new MemorySaveStorage());
			screen = new CompoundScreen({ store });
			screen.mount(context);
			await screen.campaignLoaded;
			expect(find<Button>('compound_rest_button').enabled).toBe(false);
			expect(find<Button>('compound_scavenge_button').enabled).toBe(false);
			expect(text('compound_scavenge_line')).toBe('');
			expect(find<Button>('compound_building_bunkhouse_button').enabled).toBe(false);
			expect(find<Text>('compound_building_bunkhouse_reason').visible).toBe(true);
			expect(text('compound_building_bunkhouse_reason')).toBe('Opens with a campaign in progress.');
			expect(text('compound_rest_line')).toBe('No campaign in progress.');
			expect(find<{ visible: boolean }>('compound_resources').visible).toBe(false);
			expect(find<{ visible: boolean }>('compound_day').visible).toBe(false);
			screen.unmount();

			store = storeOver(storageWith(damagedText()));
			screen = new CompoundScreen({ store });
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

	/** The chips stay inside the bar, and nothing lints (R13.29). */
	function chipsInsideTheBar(): void {
		expect(layoutLint(treeSnapshot([screen.root], viewport.logical)).violations).toEqual([]);
		const bar = find<{ screenBounds: { x: number; width: number } }>('compound_top_bar').screenBounds;
		const people = find<{ screenBounds: { x: number; width: number } }>('compound_resource_people').screenBounds;
		expect(people.x + people.width).toBeLessThanOrEqual(bar.x + bar.width);
	}

	it.each([
		{ name: 'mid-campaign stores', amount: { food: 180, water: 160, fuel: 40, scrap: 2400, meds: 25, people: 36 } },
		{ name: 'three digits everywhere', amount: 999 },
		{ name: 'four digits everywhere', amount: 9999 },
	])('keeps the stores inside the top bar at 1024x600 with $name', async ({ amount }) => {
		await stores(amount);
		chipsInsideTheBar();
	});

	it('abbreviates the stores past four digits, so even a runaway number fits at 1024x600', async () => {
		await stores(Number.MAX_SAFE_INTEGER);
		expect(find<{ children: readonly Text[] }>('compound_resource_scrap').children[0].text).toBe('Scrap 9Q');
		chipsInsideTheBar();
	});

	it('lays out with no lint at 1024x600 with no campaign to show', async () => {
		viewport.logical = { width: 1024, height: 600 };
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		screen = new CompoundScreen({ store: storeOver(new MemorySaveStorage()) });
		screen.mount(context);
		await screen.campaignLoaded;
		context.frame.layout();
		expect(layoutLint(treeSnapshot([screen.root], viewport.logical)).violations).toEqual([]);
	});

	it.each([
		{ width: 1440, height: 882 },
		{ width: 1024, height: 600 },
	])('lays the fallen notice out with no lint at $width x $height', async (size) => {
		viewport.logical = size;
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		await openText(homeText({ people: 1, food: 0 }));
		await rest();
		advance(context, OPEN_MS);
		expect(fallen()).toBe(true);
		const lint = layoutLint(treeSnapshot([screen.root, ...context.overlays.roots], size));
		expect(lint.violations).toEqual([]);
	});

	describe('pressed with the pointer, laid out in the real faces', () => {
		beforeEach(async () => {
			context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
			await open();
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
