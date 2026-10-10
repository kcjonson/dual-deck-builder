/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import type { Text } from '../../../engine/components/Text';
import type { Button } from '../../../engine/ui/Button';
import { advance, click, key, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { tokens } from '../../../engine/theme/tokens';
import { ScreenManager } from '../../core/ScreenManager';
import { Campaign } from '../../campaign/Campaign';
import type { CardBlocker } from '../../campaign/Campaign';
import { cardBlockerReason } from '../../campaign/cardBlockerText';
import type { CampaignStore } from '../../campaign/CampaignStore';
import { DRIVER_ARCHETYPES, DriverRecord } from '../../campaign/DriverRecord';
import type { RunDeck } from '../../campaign/RunDeck';
import { MemorySaveStorage } from '../../campaign/SaveStorage';
import {
	FaultyStorage,
	atHomeCampaign,
	atHomeText,
	damagedText,
	fixtureText,
	fullLockerCampaign,
	newCampaign,
	quotaError,
	saveText,
	storageWith,
	storeOver,
} from '../../campaign/__fixtures__/storeFixtures';
import { Card as GameCard } from '../../mechanics/Card';
import { CardSize } from '../../ui/Card';
import type { DriverCard } from '../../ui/DriverCard';
import { CardLookup, deckOrder } from '../../ui/DriverDetailView';
import { cardData, lookup } from '../../ui/testing';
import { CARD_ENTRY } from '../../ui/deckBuilder/CardEntryGrid';
import type { CardEntryGrid } from '../../ui/deckBuilder/CardEntryGrid';
import { NO_DRIVER } from './crewSources';
import { CrewScreen, ROSTER_WIDTH } from './CrewScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

type Bounds = { x: number; y: number; width: number; height: number };

describe('CrewScreen', () => {
	const viewport = { logical: { width: 1440, height: 882 } };
	let context: MountContext;
	let screen: CrewScreen;
	let store: CampaignStore;
	let storage: FaultyStorage;

	/** Mounts the screen over save text, with these cards, and waits for both to load. */
	async function open({ text = atHomeText(), cards = lookup }: { text?: string; cards?: CardLookup } = {}): Promise<void> {
		storage = storageWith(text);
		store = storeOver(storage);
		screen = new CrewScreen({ store, cards: async () => cards });
		screen.mount(context);
		await screen.campaignLoaded;
		context.frame.layout();
	}

	/** The same, measured in the real faces at a size. */
	async function openMeasured(size: { width: number; height: number }, options: { text?: string; cards?: CardLookup } = {}): Promise<void> {
		viewport.logical = size;
		context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		await open(options);
	}

	function find<T>(id: string): T {
		const found = screen.root.findById(id);
		if (!found) throw new Error(`no ${id}`);
		return found as unknown as T;
	}

	function text(id: string): string {
		return find<Text>(id).text;
	}

	function bounds(id: string): Bounds {
		return find<{ screenBounds: Bounds }>(id).screenBounds;
	}

	function grid(side: 'deck' | 'pool'): CardEntryGrid {
		return find<CardEntryGrid>(`crew_${side}_grid`);
	}

	/** Each entry as card type and copies, in order. */
	function entries(side: 'deck' | 'pool'): [string, number][] {
		return grid(side).views.map((view) => [view.shown.cardType, view.card.copies]);
	}

	function control(side: 'deck' | 'pool', cardType: string, name: string): Button {
		const button = grid(side).entryFor(cardType)?.control(name);
		if (!button) throw new Error(`no ${name} on ${cardType}`);
		return button;
	}

	function reason(side: 'deck' | 'pool', cardType: string): string {
		return grid(side).entryFor(cardType)?.reason ?? '';
	}

	function press(button: Button): void {
		context.focus.focus(button);
		send(context, [key('Enter')]);
		context.frame.layout();
	}

	function rosterCard(driverId: string): DriverCard {
		return find<DriverCard>(`crew_driver_card_${driverId}`);
	}

	/** Lets the store's calls run: a few macrotask turns. */
	async function flush(): Promise<void> {
		for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
	}

	async function saved(): Promise<Campaign> {
		await flush();
		const campaign = await storeOver(storage).load();
		if (!campaign) throw new Error('nothing saved');
		return campaign;
	}

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1440, height: 882 };
		context = createTestContext({ viewport, clock: new Clock() });
	});

	afterEach(() => {
		screen?.unmount();
	});

	describe('over a campaign at home', () => {
		beforeEach(() => open());

		it('rings the first driver at the compound, and lists the lost below the rest, faded, with how they went', () => {
			const pool = find<{ children: readonly DriverCard[] }>('crew_roster_pool').children;
			const lost = find<{ children: readonly DriverCard[] }>('crew_roster_lost').children;
			expect(pool.map((card) => card.data.name)).toEqual(['Road Warrior 1', 'Mechanic 1', 'Interceptor 2']);
			expect(lost.map((card) => card.data.name)).toEqual(['Interceptor 1', 'Road Warrior 2']);
			expect(pool.map((card) => card.selected)).toEqual([true, false, false]);
			expect(pool.map((card) => card.status)).toEqual([null, 'injured', null]);
			expect(lost.every((card) => card.status === 'lost' && card.faded)).toBe(true);
			expect(lost.map((card) => card.data.note)).toEqual(['Killed on a run', 'Missing on a run']);
			expect(find<Text>('crew_roster_lost_caption').visible).toBe(true);
			expect(find<{ title: string }>('crew_roster_panel').title).toBe('Driver pool (3)');
		});

		it("heads the deck with the driver's name, vehicle, specialty, HP, hand limit, size against the limits, and standing", () => {
			expect(text('crew_driver_name')).toBe('Road Warrior 1');
			expect(text('crew_driver_identity')).toBe('Apocalypse Rig / DEFENSIVE TANK');
			expect(['hp', 'hand', 'deck', 'standing'].map((chip) => text(`crew_driver_${chip}_text`))).toEqual(['HP 40/40', 'HAND LIMIT 7', 'DECK 12/20', 'Ready']);
			expect(text('crew_deck_limits')).toBe('Decks stay between 8 and 20 cards.');
		});

		it('shows the deck as mini stacks, cheapest first and then by name, each with a Remove, and the cost curve under it', () => {
			expect(entries('deck')).toEqual([['armor_plating', 3], ['covering_fire', 1], ['nitro_boost', 2], ['repair_kit', 2], ['ramming_speed', 4]]);
			expect(grid('deck').views.every((view) => view.card.size === CardSize.MINI && view.control('remove')?.enabled)).toBe(true);
			expect(find<{ counts: readonly number[] }>('crew_curve').counts).toEqual([0, 8, 4, 0]);
		});

		it('shows the locker with Add and Scrap on every card, and what scrapping pays against the scrap there is', () => {
			expect(entries('pool')).toEqual([['emp_blast', 1], ['headshot', 2], ['medical_kit', 1], ['ramming_speed', 1]].sort((a, b) => order(a[0] as string, b[0] as string)));
			for (const [cardType] of entries('pool')) {
				expect(control('pool', cardType, 'add').enabled).toBe(true);
				expect(control('pool', cardType, 'scrap').enabled).toBe(true);
				expect(reason('pool', cardType)).toBe('');
			}
			expect(text('crew_pool_note')).toBe('Rewards and finds land here. Scrap destroys a copy for 5 scrap; the compound has 35.');
		});

		it('adds a copy from the locker to the deck, free, and saves it', async () => {
			press(control('pool', 'headshot', 'add'));
			expect(entries('pool')).toContainEqual(['headshot', 1]);
			expect(grid('deck').entryFor('headshot')?.card.copies).toBe(1);
			expect(text('crew_driver_deck_text')).toBe('DECK 13/20');
			expect(find<{ counts: readonly number[] }>('crew_curve').counts).toEqual([0, 8, 5, 0]);
			expect(rosterCard('driver-1').data.deck.headshot).toBe(1);
			const campaign = await saved();
			expect(campaign.drivers[0].defaultDeck.headshot).toBe(1);
			expect(campaign.locker.headshot).toBe(1);
			expect(campaign.resources.scrap).toBe(35);
		});

		it('removes a copy from the deck back to the locker, and saves it', async () => {
			press(control('deck', 'covering_fire', 'remove'));
			expect(grid('deck').entryFor('covering_fire')).toBeNull();
			expect(entries('pool')).toContainEqual(['covering_fire', 1]);
			expect(text('crew_driver_deck_text')).toBe('DECK 11/20');
			const campaign = await saved();
			expect(campaign.drivers[0].defaultDeck.covering_fire).toBeUndefined();
			expect(campaign.locker.covering_fire).toBe(1);
		});

		it('scraps a locker copy for 5 scrap on a second press, and saves it', async () => {
			press(control('pool', 'headshot', 'scrap'));
			expect(entries('pool')).toContainEqual(['headshot', 2]);
			advance(context, CARD_ENTRY.confirmAfterMs);
			press(control('pool', 'headshot', 'scrap'));
			expect(entries('pool')).toContainEqual(['headshot', 1]);
			expect(text('crew_pool_note')).toContain('the compound has 40.');
			const campaign = await saved();
			expect(campaign.locker.headshot).toBe(1);
			expect(campaign.resources.scrap).toBe(40);
		});

		it("shows another driver's deck when their card is picked, by click or by Enter, and not a lost driver's", () => {
			const { x, y, width, height } = rosterCard('driver-5').screenBounds;
			click(context, x + width / 2, y + height / 2);
			context.frame.layout();
			expect(screen.selected?.id).toBe('driver-5');
			expect(text('crew_driver_name')).toBe('Interceptor 2');
			expect(rosterCard('driver-5').selected).toBe(true);
			expect(rosterCard('driver-1').selected).toBe(false);
			expect(entries('deck').map(([cardType]) => cardType)).toContain('precision_shot');

			context.focus.focus(rosterCard('driver-3'));
			send(context, [key('Enter')]);
			context.frame.layout();
			expect(screen.selected?.id).toBe('driver-3');
			expect(text('crew_driver_standing_text')).toBe('Injured, fit in 2 days');

			context.focus.focus(rosterCard('driver-2'));
			send(context, [key('Enter')]);
			expect(screen.selected?.id).toBe('driver-3');
		});

		it('disables every Remove at the deck minimum, saying why', () => {
			screen.select(screen.shown?.drivers[2] as never);
			context.frame.layout();
			expect(text('crew_driver_deck_text')).toBe('DECK 8/20');
			for (const [cardType] of entries('deck')) {
				expect(control('deck', cardType, 'remove').enabled).toBe(false);
				expect(reason('deck', cardType)).toBe('Deck at minimum');
			}
		});

		it("disables Add on a card for another archetype, faded, saying whose it is, and Scrap stays live", () => {
			screen.select(screen.shown?.drivers[4] as never);
			context.frame.layout();
			press(control('deck', 'precision_shot', 'remove'));
			screen.select(screen.shown?.drivers[0] as never);
			context.frame.layout();
			expect(control('pool', 'precision_shot', 'add').enabled).toBe(false);
			expect(reason('pool', 'precision_shot')).toBe('Interceptor only');
			expect(grid('pool').entryFor('precision_shot')?.card.miniState).toBe('unavailable');
			expect(control('pool', 'precision_shot', 'scrap').enabled).toBe(true);
		});

		it('filters the locker by kind, and says when a kind has nothing', () => {
			const builder = screen.deckBuilder;
			if (!builder) throw new Error('no deck builder');
			builder.filter = 'attack';
			expect(entries('pool').map(([cardType]) => cardType).sort()).toEqual(['headshot', 'ramming_speed']);
			builder.filter = 'utility';
			expect(entries('pool').map(([cardType]) => cardType).sort()).toEqual(['emp_blast', 'medical_kit']);
			builder.filter = 'order';
			expect(entries('pool')).toEqual([]);
			expect(find<Text>('crew_pool_empty').visible).toBe(true);
			expect(text('crew_pool_empty')).toBe('No order cards here.');
			expect(find<{ value: string }>('crew_pool_filter').value).toBe('order');
			builder.filter = 'all';
			expect(entries('pool')).toHaveLength(4);
			expect(find<Text>('crew_pool_empty').visible).toBe(false);
		});

		it('starts focus on Back, and Tabs through the roster, the deck, the filter, and the locker', () => {
			expect(context.focus.focused?.id).toBe('crew_back_button');
			// A segment has no id of its own; its control does.
			const stops = Array.from({ length: 5 }, () => {
				send(context, [key('Tab')]);
				const focused = context.focus.focused;
				return focused?.id ?? focused?.parent?.id;
			});
			expect(stops).toEqual([
				'crew_driver_card_driver-1',
				'crew_deck_grid_armor_plating_card',
				'crew_pool_filter',
				`crew_pool_grid_${entries('pool')[0][0]}_card`,
				'crew_back_button',
			]);
		});

		it('walks the roster in reading order with Left and Right, from row to row, into the lost', () => {
			context.focus.focus(rosterCard('driver-1'));
			const walk = Array.from({ length: 4 }, () => {
				send(context, [key('ArrowRight')]);
				return context.focus.focused?.id;
			});
			expect(walk).toEqual(['crew_driver_card_driver-3', 'crew_driver_card_driver-5', 'crew_driver_card_driver-2', 'crew_driver_card_driver-4']);
		});

		it('keeps focus in the locker when the focused card goes: on the same control of the card now in its place', () => {
			const order = entries('pool').map(([cardType]) => cardType);
			const index = order.indexOf('medical_kit');
			press(control('pool', 'medical_kit', 'add'));
			expect(grid('pool').entryFor('medical_kit')).toBeNull();
			context.frame.layout();
			expect(context.focus.focused?.id).toBe(`crew_pool_grid_${order[index + 1] ?? order[index - 1]}_add`);
		});

		it('moves focus from an Add that a full deck disables to its card, with the reason under it', () => {
			const campaign = screen.shown as Campaign;
			campaign.drivers[0].set({ defaultDeck: { ...campaign.drivers[0].defaultDeck, ram: 7 } });
			campaign.set({ locker: { ...campaign.locker, ram: 3 } });
			context.frame.layout();
			press(control('pool', 'ram', 'add'));
			expect(text('crew_driver_deck_text')).toBe('DECK 20/20');
			expect(context.focus.focused?.id).toBe('crew_pool_grid_ram_card');
			expect(control('pool', 'ram', 'add').enabled).toBe(false);
			expect(reason('pool', 'ram')).toBe('Deck full');
			expect(control('pool', 'ram', 'scrap').enabled).toBe(true);
			expect(grid('pool').entryFor('ram')?.card.miniState).toBeNull();
		});

		it('arms Scrap on the first press, reading Confirm in the danger tone, and disarms it on blur, on leaving, after 3 s, on a filter change, or on another change', () => {
			const scrap = control('pool', 'headshot', 'scrap');
			const entry = grid('pool').entryFor('headshot');
			press(scrap);
			expect([scrap.label, scrap.tone, entry?.armedControl]).toEqual(['Confirm', 'crit', 'scrap']);
			context.focus.focus(control('pool', 'headshot', 'add'));
			expect([scrap.label, scrap.tone, entry?.armedControl]).toEqual(['Scrap', 'default', null]);

			press(scrap);
			scrap.onPointerLeave?.({} as never);
			expect(entry?.armedControl).toBeNull();

			press(scrap);
			advance(context, CARD_ENTRY.armedMs - 100);
			expect(entry?.armedControl).toBe('scrap');
			advance(context, 200);
			expect(entry?.armedControl).toBeNull();

			press(scrap);
			const builder = screen.deckBuilder;
			if (!builder) throw new Error('no deck builder');
			builder.filter = 'attack';
			expect(entry?.armedControl).toBeNull();
			builder.filter = 'all';

			press(scrap);
			const campaign = screen.shown as Campaign;
			campaign.moveCards({ cardType: 'emp_blast', from: 'locker', to: campaign.drivers[0] });
			expect(context.focus.focused).toBe(scrap);
			expect(entry?.armedControl).toBeNull();
			press(scrap);
			expect(entry?.armedControl).toBe('scrap');
			expect(entries('pool')).toContainEqual(['headshot', 2]);
		});

		it('ignores a confirm that comes as fast as a double-click, and takes one after it', () => {
			const scrap = control('pool', 'headshot', 'scrap');
			press(scrap);
			send(context, [key('Enter')]);
			expect(entries('pool')).toContainEqual(['headshot', 2]);
			expect(grid('pool').entryFor('headshot')?.armedControl).toBe('scrap');
			advance(context, CARD_ENTRY.confirmAfterMs);
			send(context, [key('Enter')]);
			expect(entries('pool')).toContainEqual(['headshot', 1]);
		});

		it('takes Escape on an armed Scrap to disarm it, and stays on the screen; the next Escape is Back', () => {
			const scrap = control('pool', 'headshot', 'scrap');
			press(scrap);
			send(context, [key('Escape')]);
			expect(grid('pool').entryFor('headshot')?.armedControl).toBeNull();
			expect(scrap.label).toBe('Scrap');
			expect(navigate).not.toHaveBeenCalled();
			send(context, [key('Escape')]);
			expect(navigate).toHaveBeenCalledTimes(1);
		});

		it('scraps only the card pressed twice by keyboard: focus goes to the next card itself when a scrapped card goes', () => {
			const order = entries('pool').map(([cardType]) => cardType);
			const next = order[order.indexOf('medical_kit') + 1];
			press(control('pool', 'medical_kit', 'scrap'));
			advance(context, CARD_ENTRY.confirmAfterMs);
			send(context, [key('Enter')]);
			context.frame.layout();
			expect(grid('pool').entryFor('medical_kit')).toBeNull();
			expect(context.focus.focused?.id).toBe(`crew_pool_grid_${next}_card`);
			const copies = grid('pool').entryFor(next)?.card.copies;
			send(context, [key('Enter'), key('Enter')]);
			expect(grid('pool').entryFor(next)?.card.copies).toBe(copies);
			expect(screen.shown?.resources.scrap).toBe(40);
		});

		it('goes back to the compound with the campaign, focus restored on the Bunkhouse, on Back or Escape', () => {
			const campaign = screen.shown;
			find<Button>('crew_back_button').onClick?.({} as never);
			expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign }, { restoreFocus: true });
			navigate.mockClear();
			send(context, [key('Escape')]);
			expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign }, { restoreFocus: true });
		});
	});

	it('says under the top bar when a change could not be saved, and clears it once a save lands', async () => {
		await open();
		storage.fault = { method: 'setItem', error: quotaError() };
		press(control('pool', 'headshot', 'add'));
		await flush();
		expect(find<Text>('crew_save_error').visible).toBe(true);
		expect(text('crew_save_error')).toBe("The campaign couldn't be saved: storage is full.");
		expect(find<{ color: unknown }>('crew_save_error').color).toEqual(tokens.color.status_crit);
		storage.fault = null;
		press(control('pool', 'emp_blast', 'add'));
		await flush();
		expect(find<Text>('crew_save_error').visible).toBe(false);
		const campaign = await saved();
		expect(campaign.drivers[0].defaultDeck).toMatchObject({ headshot: 1, emp_blast: 1 });
	});

	it("shows a driver out on a run with their seat, their default deck from the run deck, and Remove and Add disabled", async () => {
		await open({ text: fixtureText() });
		expect(rosterCard('driver-1').status).toBe('seat1');
		expect(rosterCard('driver-5').status).toBe('seat2');
		expect(text('crew_driver_standing_text')).toBe('Out on a run');
		expect(text('crew_driver_deck_text')).toBe('DECK 12/20');
		expect(entries('deck')).toContainEqual(['nitro_boost', 2]);
		for (const [cardType] of entries('deck')) expect(reason('deck', cardType)).toBe('Out on a run');
		for (const [cardType] of entries('pool')) expect(reason('pool', cardType)).toBe('Out on a run');
	});

	it("shows the roster and says so in place of the deck and the locker when the cards can't be loaded", async () => {
		const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		storage = storageWith(atHomeText());
		screen = new CrewScreen({ store: storeOver(storage), cards: () => Promise.reject(new Error('offline')) });
		screen.mount(context);
		await screen.campaignLoaded;
		quiet.mockRestore();
		expect(rosterCard('driver-1').selected).toBe(true);
		expect(rosterCard('driver-1').tooltip).toBeNull();
		expect(entries('deck')).toEqual([]);
		expect(text('crew_deck_empty')).toBe("The cards couldn't be loaded.");
		expect(text('crew_pool_empty')).toBe("The cards couldn't be loaded.");
	});

	it('shows the campaign it is handed at once, without reading the save, and Back hands it back before the cards are in', async () => {
		const campaign = atHomeCampaign();
		store = storeOver(new MemorySaveStorage());
		let release: (cards: CardLookup) => void = () => undefined;
		screen = new CrewScreen({ store, cards: () => new Promise((resolve) => { release = resolve; }) });
		screen.mount(context, { campaign });
		expect(screen.shown).toBe(campaign);
		expect(screen.selected?.id).toBe('driver-1');
		// A roster card's detail view lays its deck out as minis, so it opens once the cards are in.
		expect(rosterCard('driver-1').tooltip).toBeNull();
		expect([text('crew_deck_empty'), text('crew_pool_empty')]).toEqual(['Loading the cards.', 'Loading the cards.']);
		find<Button>('crew_back_button').onClick?.({} as never);
		expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign }, { restoreFocus: true });
		release(lookup);
		await screen.campaignLoaded;
		expect(entries('deck')).toHaveLength(5);
		expect(rosterCard('driver-1').tooltip).not.toBeNull();
	});

	it('says why there is no deck when there is no save, or it is damaged', async () => {
		store = storeOver(new MemorySaveStorage());
		screen = new CrewScreen({ store, cards: async () => lookup });
		screen.mount(context);
		await screen.campaignLoaded;
		expect(text('crew_deck_empty')).toBe('No campaign in progress.');
		expect(find<{ visible: boolean }>('crew_driver_header').visible).toBe(false);
		screen.unmount();

		store = storeOver(storageWith(damagedText()));
		screen = new CrewScreen({ store, cards: async () => lookup });
		screen.mount(context);
		await screen.campaignLoaded;
		expect(text('crew_deck_empty')).toBe("The saved campaign is damaged and can't be loaded. It's been kept.");
		find<Button>('crew_back_button').onClick?.({} as never);
		expect(navigate).toHaveBeenLastCalledWith('compoundScreen', undefined, { restoreFocus: true });
	});

	describe('laid out in the real faces', () => {
		it.each([
			{ width: 1440, height: 882 },
			{ width: 1024, height: 600 },
		])('lays out with no lint at $width x $height', async (size) => {
			await openMeasured(size);
			expect(layoutLint(treeSnapshot([screen.root], size)).violations).toEqual([]);
			// The header's figures sit on one row for a driver who's ready.
			expect(bounds('crew_driver_standing').y).toBe(bounds('crew_driver_hp').y);
		});

		/** 44 kinds of card for the locker, past what cards.json holds, each named as a shipped card is. */
		const manyCards = (() => {
			const made = new Map<string, GameCard>();
			for (let index = 0; index < 44; index += 1) {
				const base = cardData[index % cardData.length];
				made.set(`${base.type}_${index}`, new GameCard({ ...base, type: `${base.type}_${index}` }));
			}
			return made;
		})();
		const manyLookup: CardLookup = (type) => manyCards.get(type) ?? lookup(type);

		/** The full locker campaign, its locker swapped for 44 kinds of card. */
		function crowdedText(): string {
			const campaign = fullLockerCampaign();
			campaign.set({ locker: Object.fromEntries([...manyCards.keys()].map((type, index) => [type, (index % 3) + 1])) });
			return saveText({ campaign: campaign.toSaveText() });
		}

		it.each([
			{ width: 1440, height: 882, columns: 5 },
			{ width: 1024, height: 600, columns: 3 },
		])('holds a deck at the most and a locker of 44 kinds at $width x $height, scrolling, with no lint', async ({ width, height, columns }) => {
			await openMeasured({ width, height }, { text: crowdedText(), cards: manyLookup });
			expect(text('crew_driver_deck_text')).toBe('DECK 20/20');
			expect(grid('pool').views).toHaveLength(44);
			expect(layoutLint(treeSnapshot([screen.root], { width, height })).violations).toEqual([]);
			for (const side of ['deck', 'pool'] as const) {
				const rowOne = grid(side).views.filter((view) => view.screenBounds.y === grid(side).views[0].screenBounds.y);
				expect([side, rowOne.length]).toEqual([side, side === 'deck' ? Math.min(columns, 10) : columns]);
			}
			expect(find<{ overflows: boolean }>('crew_pool_scroll').overflows).toBe(true);
			const roster = bounds('crew_roster_panel');
			expect(roster.width).toBe(ROSTER_WIDTH);
			const [first, second] = find<{ children: readonly DriverCard[] }>('crew_roster_pool').children;
			expect(second.screenBounds.y).toBe(first.screenBounds.y);
			for (const id of ['crew_top_bar', 'crew_pool_panel', 'crew_deck_panel']) {
				const box = bounds(id);
				expect(box.x + box.width).toBeLessThanOrEqual(width);
				expect(box.y + box.height).toBeLessThanOrEqual(height);
			}
		});

		it('walks a grid in reading order with Left and Right, and from a card to its controls and the next row with Down', async () => {
			await openMeasured({ width: 1024, height: 600 });
			context.focus.focus(grid('pool').views[0].card);
			const across = ['ArrowRight', 'ArrowRight', 'ArrowRight'].map((arrow) => {
				send(context, [key(arrow)]);
				return context.focus.focused?.id;
			});
			const [first, second, , fourth] = grid('pool').views.map((view) => view.shown.cardType);
			expect(across).toEqual([`crew_pool_grid_${first}_add`, `crew_pool_grid_${first}_scrap`, `crew_pool_grid_${second}_card`]);
			const down = ['ArrowDown', 'ArrowDown'].map((arrow) => {
				send(context, [key(arrow)]);
				return context.focus.focused?.id;
			});
			expect(down).toEqual([`crew_pool_grid_${second}_add`, `crew_pool_grid_${fourth}_card`]);
		});

		it('goes from a card down to its first live control and back up, in the deck and the locker (R9.26)', async () => {
			await openMeasured({ width: 1440, height: 882 });
			const [locker] = grid('pool').views;
			context.focus.focus(locker.card);
			send(context, [key('ArrowDown')]);
			expect(context.focus.focused).toBe(locker.control('add'));
			context.focus.focus(locker.control('scrap'));
			send(context, [key('ArrowUp')]);
			expect(context.focus.focused).toBe(locker.card);
			const [deck] = grid('deck').views;
			context.focus.focus(deck.card);
			send(context, [key('ArrowDown')]);
			expect(context.focus.focused).toBe(deck.control('remove'));
			send(context, [key('ArrowUp')]);
			expect(context.focus.focused).toBe(deck.card);
		});

		it('goes from a card down to Scrap when Add is disabled', async () => {
			await openMeasured({ width: 1440, height: 882 }, { text: saveText({ campaign: fullLockerCampaign().toSaveText() }) });
			const [locker] = grid('pool').views;
			expect(locker.control('add')?.enabled).toBe(false);
			context.focus.focus(locker.card);
			send(context, [key('ArrowDown')]);
			expect(context.focus.focused).toBe(locker.control('scrap'));
		});

		it('scraps only the card under two clicks: the card that slides in under the pointer is only armed by a third', async () => {
			await openMeasured({ width: 1440, height: 882 });
			const centre = (button: Button): { x: number; y: number } => {
				const { x, y, width, height } = button.screenBounds;
				return { x: x + width / 2, y: y + height / 2 };
			};
			const order = entries('pool').map(([cardType]) => cardType);
			const next = order[order.indexOf('medical_kit') + 1];
			const at = centre(control('pool', 'medical_kit', 'scrap'));
			click(context, at.x, at.y);
			context.frame.layout();
			expect(grid('pool').entryFor('medical_kit')?.armedControl).toBe('scrap');
			// A click as fast as a double-click's second doesn't confirm.
			click(context, at.x, at.y);
			context.frame.layout();
			expect(grid('pool').entryFor('medical_kit')?.armedControl).toBe('scrap');
			advance(context, CARD_ENTRY.confirmAfterMs);
			click(context, at.x, at.y);
			context.frame.layout();
			expect(grid('pool').entryFor('medical_kit')).toBeNull();
			expect(centre(control('pool', next, 'scrap'))).toEqual(at);
			const copies = grid('pool').entryFor(next)?.card.copies;
			click(context, at.x, at.y);
			context.frame.layout();
			expect(grid('pool').entryFor(next)?.armedControl).toBe('scrap');
			expect(grid('pool').entryFor(next)?.card.copies).toBe(copies);
			expect(screen.shown?.resources.scrap).toBe(40);
		});

		it('hands focus to the filter when the locker empties under it, and from an emptied deck to the locker', async () => {
			await openMeasured({ width: 1440, height: 882 }, {
				text: atHomeText((campaign) => {
					campaign.set({ locker: { ...campaign.locker, armor_plating: 1 } });
				}),
			});
			const builder = screen.deckBuilder;
			if (!builder) throw new Error('no deck builder');
			builder.filter = 'defense';
			context.frame.layout();
			expect(entries('pool')).toEqual([['armor_plating', 1]]);
			press(control('pool', 'armor_plating', 'add'));
			expect(grid('pool').visible).toBe(false);
			const focused = context.focus.focused;
			expect([focused?.parent?.id, (focused as { value?: unknown } | null)?.value]).toEqual(['crew_pool_filter', 'defense']);

			// A deck can't empty past its minimum through Remove, so the fallback is asked of the grid directly.
			builder.filter = 'all';
			const campaign = screen.shown as Campaign;
			context.focus.focus(grid('deck').views[0].card);
			campaign.drivers[0].set({ defaultDeck: {} });
			builder.refresh();
			expect(context.focus.focused).toBe(grid('pool').views[0].card);
		});

		it('fits every reason the rules can give on one line under its card', async () => {
			await openMeasured({ width: 1024, height: 600 });
			const driver = new DriverRecord({ id: 'driver-9', archetype: 'road_warrior', name: 'Road Warrior 9' });
			const runDeck = { driver } as unknown as RunDeck;
			const blockers: Record<CardBlocker['reason'], CardBlocker[]> = {
				campaign_over: [{ reason: 'campaign_over', end: { ending: 'disbanded', cause: 'last_driver' } }],
				driver_away: (['dead', 'missing'] as const).map((status) => ({ reason: 'driver_away', place: new DriverRecord({ id: 'driver-8', archetype: 'raider', name: 'Raider 8', status, hitpoints: status === 'dead' ? 0 : 10, defaultDeck: {} }) })),
				on_run: [{ reason: 'on_run', place: driver }],
				too_few: [{ reason: 'too_few', place: 'locker', held: 0 }],
				already_borrowed: [{ reason: 'already_borrowed', place: 'locker', held: 0, by: runDeck }],
				card_locked: [{ reason: 'card_locked', place: runDeck, broughtBy: 'escort-12' }],
				too_little_scrap: [{ reason: 'too_little_scrap', needed: 9999, held: 0 }],
				other_archetype: DRIVER_ARCHETYPES.map((archetype) => ({ reason: 'other_archetype', archetype, place: driver })),
				deck_full: [{ reason: 'deck_full', max: 20, place: driver }],
				deck_at_minimum: [{ reason: 'deck_at_minimum', min: 8, place: driver }],
			};
			const reasons = [...Object.values(blockers).flat().map(cardBlockerReason), NO_DRIVER];
			for (const words of reasons) {
				const measured = context.draw.measureText({ text: words, font: 'body', size: CARD_ENTRY.reason.size });
				expect([words, measured.width <= CARD_ENTRY.width]).toEqual([words, true]);
			}
			const confirm = context.draw.measureText({ text: CARD_ENTRY.confirm, font: 'display', size: tokens.control.control_fs_sm });
			const scrap = grid('pool').views[0].control('scrap') as Button;
			expect(confirm.width).toBeLessThanOrEqual(scrap.width - CARD_ENTRY.controls.inset * 2);
		});
	});

	describe('on a first visit, and with nothing to show', () => {
		const sizes = [{ width: 1440, height: 882 }, { width: 1024, height: 600 }];

		/** A campaign as New Campaign founds it: two drivers, both home, and an empty locker. */
		function founded(): Campaign {
			const campaign = newCampaign();
			campaign.set({ locker: {} });
			return campaign;
		}

		/** The campaign at home as save text, its save changed first: a pool only grows, so fewer drivers is a save's. */
		function saveWith(change: (json: { drivers: { status: string }[] }) => void): string {
			const json = JSON.parse(atHomeCampaign().toSaveText());
			change(json);
			return saveText({ campaign: JSON.stringify(json) });
		}

		function lintAt(size: { width: number; height: number }): unknown[] {
			context.frame.layout();
			return layoutLint(treeSnapshot([screen.root], size)).violations;
		}

		it.each(sizes)('lays out a new campaign with no lint at $width x $height', async (size) => {
			await openMeasured(size, { text: saveText({ campaign: founded().toSaveText() }) });
			expect(entries('pool')).toEqual([]);
			expect(text('crew_pool_empty')).toBe('The locker is empty.');
			expect(find<{ visible: boolean }>('crew_roster_lost').visible).toBe(false);
			expect(lintAt(size)).toEqual([]);
		});

		it.each(sizes)('lays out a single driver with no lint at $width x $height', async (size) => {
			await openMeasured(size, { text: saveWith((json) => { json.drivers = json.drivers.slice(0, 1); }) });
			expect(find<{ children: readonly unknown[] }>('crew_roster_pool').children).toHaveLength(1);
			expect(lintAt(size)).toEqual([]);
		});

		it.each(sizes)('lays out with nobody at the compound with no lint at $width x $height', async (size) => {
			await openMeasured(size, { text: saveWith((json) => { json.drivers = json.drivers.filter((driver) => driver.status === 'dead' || driver.status === 'missing'); }) });
			expect(screen.selected).toBeNull();
			expect(text('crew_deck_empty')).toBe('Nobody is at the compound.');
			expect(reason('pool', 'headshot')).toBe(NO_DRIVER);
			expect(find<{ visible: boolean }>('crew_roster_pool').visible).toBe(false);
			expect(lintAt(size)).toEqual([]);
		});

		it.each(sizes)('lays out with no save with no lint at $width x $height', async (size) => {
			viewport.logical = size;
			context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
			screen = new CrewScreen({ store: storeOver(new MemorySaveStorage()), cards: async () => lookup });
			screen.mount(context);
			await screen.campaignLoaded;
			expect([text('crew_deck_empty'), text('crew_pool_empty')]).toEqual(['No campaign in progress.', 'No campaign in progress.']);
			expect(find<{ visible: boolean }>('crew_deck_foot').visible).toBe(false);
			expect(lintAt(size)).toEqual([]);
		});

		it.each(sizes)("lays out with the cards failing to load with no lint at $width x $height", async (size) => {
			const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
			viewport.logical = size;
			context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
			screen = new CrewScreen({ store: storeOver(storageWith(atHomeText())), cards: () => Promise.reject(new Error('offline')) });
			screen.mount(context);
			await screen.campaignLoaded;
			quiet.mockRestore();
			expect(find<{ visible: boolean }>('crew_deck_foot').visible).toBe(false);
			expect(lintAt(size)).toEqual([]);
		});
	});
});

/** Cheapest first, then by name, as the screen orders cards. */
function order(a: string, b: string): number {
	return deckOrder(lookup(a) as GameCard, lookup(b) as GameCard);
}
