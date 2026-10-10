/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import type { Text } from '../../../engine/components/Text';
import { key, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { tokens } from '../../../engine/theme/tokens';
import { ScreenManager } from '../../core/ScreenManager';
import { Campaign } from '../../campaign/Campaign';
import type { CampaignData } from '../../campaign/Campaign';
import type { CampaignStore } from '../../campaign/CampaignStore';
import { scavenge } from '../../campaign/Scavenging';
import {
	CAMPAIGN_FIXTURE, FaultyStorage, KEYS, atHomeCampaign, atHomeText, damagedText, lostCampaign, quotaError, saveText, storageWith, storeOver
} from '../../campaign/__fixtures__/storeFixtures';
import { DefeatScreen } from './DefeatScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;
const TO_MENU = ['mainMenuScreen', undefined, { restoreFocus: true }];

type End = NonNullable<CampaignData['end']>;

const ENDS: End[] = [
	{ ending: 'starved', cause: 'no_people' },
	{ ending: 'rioted', cause: 'last_driver' },
	{ ending: 'disbanded', cause: 'no_people' },
	{ ending: 'disbanded', cause: 'last_driver' }
];

describe('DefeatScreen', () => {
	const viewport = { logical: { width: 1440, height: 882 } };
	let context: MountContext;
	let screen: DefeatScreen;
	let store: CampaignStore;
	let storage: FaultyStorage;

	/** Mounts the screen handed this campaign, as the compound does once its end is saved. */
	function handed(campaign: Campaign): void {
		storage = new FaultyStorage();
		store = storeOver(storage);
		screen = new DefeatScreen({ store });
		screen.mount(context, { campaign });
		context.frame.layout();
	}

	/** Mounts the screen with nothing handed over, over this save, storage failing as asked, and waits for it to load. */
	async function overSave(text: string | null, { fault = null }: { fault?: FaultyStorage['fault'] } = {}): Promise<void> {
		storage = text === null ? new FaultyStorage() : storageWith(text);
		storage.fault = fault;
		store = storeOver(storage);
		screen = new DefeatScreen({ store });
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

	/** The record's rows, label and value. */
	function record(): [string, string][] {
		return ['days', 'runs', 'fights', 'drivers', 'strongholds', 'stores'].map((row) => [text(`defeat_record_${row}_label`), text(`defeat_record_${row}_value`)]);
	}

	/** The last day's lines, in order. */
	function lastDay(): string[] {
		return find<{ children: readonly { id: string | null }[] }>('defeat_last_day').children
			.filter((child) => child.id?.startsWith('defeat_last_day_'))
			.map((child) => text(child.id as string));
	}

	/** The fixture lost the way play loses it: a scavenging party's day whose night takes the last person, the haul in first. */
	function scavengedFall(): Campaign {
		const campaign = atHomeCampaign((home) => home.set({ resources: { ...home.resources, people: 1, food: 0, water: 0 } }));
		scavenge({ campaign });
		return campaign;
	}

	/** A lost campaign changed as a hand-made save could change it, since one that's over refuses every change. */
	function changed(campaign: Campaign, change: (data: CampaignData) => void): Campaign {
		const data = JSON.parse(campaign.toSaveText()) as CampaignData;
		change(data);
		return Campaign.fromJSON(data, { onWarning: () => undefined });
	}

	/** The log with these lines dated the day it fell, ahead of the fall's own, the last. */
	function crowded(campaign: Campaign, lines: string[]): Campaign {
		return changed(campaign, (data) => {
			data.log = [...data.log.slice(0, -1), ...lines.map((message) => ({ day: data.day, message })), ...data.log.slice(-1)];
		});
	}

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1440, height: 882 };
		context = createTestContext({ viewport, clock: new Clock() });
	});

	afterEach(() => {
		screen?.unmount();
	});

	describe('handed a lost campaign', () => {
		it.each([
			[ENDS[0], 'The compound starved', 'No people were left at the compound. The stores had run out of food.'],
			[ENDS[1], 'The compound rioted', 'No drivers were left at the compound to send out. Unrest boiled over, and the last of them fought over what was left.'],
			[ENDS[2], 'The compound disbanded', 'No people were left at the compound. The gates were left open as the settlers walked away.'],
			[ENDS[3], 'The compound disbanded', 'No drivers were left at the compound to send out. The gates were left open as the settlers walked away.']
		])('says how it fell and why: %o', (end, title, story) => {
			handed(lostCampaign(end));

			expect(text('defeat_day')).toBe('Fell on day 9');
			expect(text('defeat_title')).toBe(title);
			expect(text('defeat_story')).toBe(story);
		});

		it('shows the campaign\'s record: days held, runs, fights, drivers lost, strongholds taken, and what it held at the end', () => {
			handed(lostCampaign(ENDS[1]));

			expect(record()).toEqual([
				['Days held', '9 days'],
				['Supply runs', '1 home, 2 failed'],
				['Fights', '3 won, 2 lost'],
				['Drivers lost', '2 killed, 3 missing'],
				['Strongholds taken', '1'],
				['At the end', '18 people, 14 food, 11 water, unrest 12']
			]);
		});

		it('words one person as the log does', () => {
			handed(changed(lostCampaign(ENDS[1]), (data) => { data.resources = { ...data.resources, people: 1 }; }));

			expect(text('defeat_record_stores_value')).toBe('1 person, 14 food, 11 water, unrest 12');
		});

		it('shows the last day\'s log beside the record, for the final moments: the haul, the shortfall, then the fall', () => {
			const campaign = scavengedFall();
			const haul = campaign.log[campaign.log.length - 3];
			handed(campaign);

			expect(text('defeat_title')).toBe('The compound starved');
			expect(haul).toEqual({ day: 9, message: expect.stringMatching(/^A scavenging party/) });
			expect(lastDay()).toEqual([haul.message, 'Ran short of 1 food and 1 water; 1 person lost.', 'No people are left, and the compound starved.']);
		});

		it('shows a failed run\'s fall as its one line, and the record alone when no line is dated the day it fell', () => {
			handed(lostCampaign(ENDS[1]));
			expect(lastDay()).toEqual(['No drivers are left, and the compound rioted over what was left.']);
			screen.unmount();

			handed(changed(lostCampaign(ENDS[0]), (data) => { data.log = data.log.filter((entry) => entry.day !== data.day); }));
			expect(screen.root.findById('defeat_last_day')).toBeNull();
			expect(text('defeat_record_days_value')).toBe('9 days');
		});

		it('keeps the latest four lines of a crowded last day, the fall among them', () => {
			handed(crowded(lostCampaign(ENDS[0]), ['First.', 'Second.', 'Third.', 'Fourth.']));

			expect(lastDay()).toEqual(['Second.', 'Third.', 'Fourth.', 'No people are left, and the compound starved.']);
		});

		it('shows what it was handed without reading or writing the store, which the compound has done already', async () => {
			const campaign = lostCampaign(ENDS[0]);
			handed(campaign);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(screen.shown).toBe(campaign);
			expect(storage.writes).toEqual([]);
		});
	});

	describe('opened with nothing handed over', () => {
		it('shows a save already over and ends it in the store, its history line in and the save removed', async () => {
			await overSave(saveText({ campaign: lostCampaign(ENDS[0]).toSaveText() }));

			expect(text('defeat_title')).toBe('The compound starved');
			expect(await storeOver(storage).load()).toBeNull();
			expect(await storeOver(storage).history()).toEqual([{ seed: CAMPAIGN_FIXTURE.seed, day: 9, strongholdsTaken: 1, ending: 'starved' }]);
			expect(storage.keys).toEqual([KEYS.history]);
		});

		it('still shows the fall when its end can\'t be saved, and says why under the record', async () => {
			await overSave(saveText({ campaign: lostCampaign(ENDS[2]).toSaveText() }), { fault: { method: 'setItem', error: quotaError() } });

			expect(text('defeat_title')).toBe('The compound disbanded');
			expect(find<Text>('defeat_save_error').visible).toBe(true);
			expect(text('defeat_save_error')).toBe("The campaign couldn't be ended: storage is full.");
			expect(await storeOver(storage).history()).toEqual([]);
		});

		it.each([
			['no save', null],
			['a campaign still standing', atHomeText()]
		])('says there\'s no fall to show with %s, and writes nothing', async (_label, text) => {
			await overSave(text);

			expect(find<Text>('defeat_none').text).toBe('No campaign has been lost here. Its record shows once a compound falls.');
			expect(find<{ color: unknown }>('defeat_none').color).toEqual(tokens.color.text_dim);
			expect(screen.root.findById('defeat_title')).toBeNull();
			expect(screen.shown).toBeNull();
			expect(storage.writes).toEqual([]);
		});

		it.each([
			['a damaged save', () => overSave(damagedText()), "The saved campaign is damaged and can't be loaded. It's been kept."],
			['storage that fails', () => overSave(null, { fault: { method: 'getItem', error: new Error('blocked') } }), /^The saved campaign couldn't be read: /]
		])('says why there is nothing to show with %s, as the compound does', async (_label, mount, message) => {
			await mount();

			expect(text('defeat_none')).toMatch(message);
			expect(find<{ color: unknown }>('defeat_none').color).toEqual(tokens.color.status_warn);
			expect(screen.root.findById('defeat_title')).toBeNull();
		});
	});

	describe('keys and focus', () => {
		beforeEach(() => handed(lostCampaign(ENDS[0])));

		it('starts focus on Back to menu, the only stop Tab finds', () => {
			expect(context.focus.focused?.id).toBe('defeat_back_button');
			send(context, [key('Tab')]);
			expect(context.focus.focused?.id).toBe('defeat_back_button');
		});

		it.each([['Enter'], ['Escape']])('goes back to the menu, focus restored, on %s', (pressed) => {
			send(context, [key(pressed)]);

			expect(navigate).toHaveBeenCalledTimes(1);
			expect(navigate).toHaveBeenLastCalledWith(...TO_MENU);
		});
	});

	const SIZES = [{ width: 1440, height: 882 }, { width: 1024, height: 600 }];
	const LAYOUTS: { name: string; mount: () => Promise<void> | void }[] = [
		...ENDS.map((end) => ({ name: `${end.ending} by ${end.cause}`, mount: () => handed(lostCampaign(end)) })),
		{ name: 'a scavenged fall', mount: () => handed(scavengedFall()) },
		{
			name: 'a crowded last day of long lines',
			mount: () => {
				const long = 'Cargo lost with the run: 9999 fuel, 9999 meds, 9999 scrap, and Repair Kit x4.';
				handed(crowded(scavengedFall(), [long, long, long]));
			}
		},
		{
			name: 'four-digit stores and a failed end save',
			mount: async () => {
				const campaign = lostCampaign(ENDS[1]);
				const text = saveText({ campaign: campaign.toSaveText() }).replace('"people":18', '"people":9999').replace('"food":14', '"food":9999').replace('"water":11', '"water":9999');
				await overSave(text, { fault: { method: 'setItem', error: quotaError() } });
			}
		},
		{ name: 'nothing to show', mount: () => overSave(null) }
	];

	it.each(SIZES.flatMap((size) => LAYOUTS.map(({ name, mount }) => ({ ...size, name, mount }))))(
		'lays out with no lint at $width x $height with $name, measured in the real faces',
		async ({ width, height, mount }) => {
			viewport.logical = { width, height };
			context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
			await mount();
			context.frame.layout();

			expect(layoutLint(treeSnapshot([screen.root], { width, height })).violations).toEqual([]);
			const back = find<{ screenBounds: { y: number; height: number } }>('defeat_back_button').screenBounds;
			expect(back.y + back.height).toBeLessThanOrEqual(height);
		}
	);
});
