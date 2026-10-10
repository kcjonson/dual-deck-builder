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
import { startingDeckCounts } from '../../campaign/CardCounts';
import { MemorySaveStorage } from '../../campaign/SaveStorage';
import {
	FaultyStorage,
	atHomeText,
	damagedText,
	fixtureText,
	fullRunCampaign,
	quotaError,
	saveText,
	storageWith,
	storeOver,
} from '../../campaign/__fixtures__/storeFixtures';
import { Card as GameCard } from '../../mechanics/Card';
import type { DriverCard } from '../../ui/DriverCard';
import { CardLookup, deckOrder } from '../../ui/DriverDetailView';
import { cardData, lookup } from '../../ui/testing';
import { CARD_ENTRY } from '../../ui/deckBuilder/CardEntryGrid';
import type { CardEntryGrid } from '../../ui/deckBuilder/CardEntryGrid';
import { DECK_BUILDER } from '../../ui/deckBuilder/DeckBuilder';
import { CustomizeScreen } from './CustomizeScreen';
import { LOCKER_KICKERS, giveLabel } from './customizeText';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

type Bounds = { x: number; y: number; width: number; height: number };
type Side = 'deck' | 'pool' | 'escort';

describe('CustomizeScreen', () => {
	const viewport = { logical: { width: 1440, height: 882 } };
	let context: MountContext;
	let screen: CustomizeScreen;
	let store: CampaignStore;
	let storage: FaultyStorage;

	/** Mounts the screen over save text with nothing handed over, as the screen captures open it, and waits for the save and the cards. */
	async function open({ text = fixtureText(), cards = lookup }: { text?: string; cards?: CardLookup } = {}): Promise<void> {
		storage = storageWith(text);
		store = storeOver(storage);
		screen = new CustomizeScreen({ store, cards: async () => cards });
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

	function grid(side: Side): CardEntryGrid {
		return find<CardEntryGrid>(`customize_${side}_grid`);
	}

	/** Each entry as its key, copies, and state, in order. */
	function entries(side: Side): [string, number, string | null][] {
		return grid(side).views.map((view) => [view.shown.key ?? view.shown.cardType, view.card.copies, view.card.miniState]);
	}

	function keys(side: Side): string[] {
		return entries(side).map(([entryKey]) => entryKey);
	}

	function control(side: Side, entryKey: string, name: string): Button {
		const button = grid(side).entryFor(entryKey)?.control(name);
		if (!button) throw new Error(`no ${name} on ${entryKey}`);
		return button;
	}

	function reason(side: Side, entryKey: string): string {
		return grid(side).entryFor(entryKey)?.reason ?? '';
	}

	/** Whether each of an entry's controls is live, in order. */
	function live(side: Side, entryKey: string): boolean[] {
		const view = grid(side).entryFor(entryKey);
		if (!view) throw new Error(`no ${entryKey}`);
		return view.shown.controls.map((entry) => (view.control(entry.key) as Button).enabled);
	}

	function press(button: Button): void {
		context.focus.focus(button);
		send(context, [key('Enter')]);
		context.frame.layout();
	}

	function campaign(): Campaign {
		const shown = screen.shown;
		if (!shown) throw new Error('no campaign');
		return shown;
	}

	/** Changes seat 1's run deck outside the rules, as a test's setting. */
	function setSeatOne(changes: Parameters<Campaign['runDecks'][number]['with']>[0]): void {
		const shown = campaign();
		shown.set({ runDecks: shown.runDecks.map((deck, seat) => (seat === 0 ? deck.with(changes) : deck)) });
		context.frame.layout();
	}

	/** Lets the store's calls run: a few macrotask turns. */
	async function flush(): Promise<void> {
		for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
	}

	async function saved(): Promise<Campaign> {
		await flush();
		const loaded = await storeOver(storage).load();
		if (!loaded) throw new Error('nothing saved');
		return loaded;
	}

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1440, height: 882 };
		context = createTestContext({ viewport, clock: new Clock() });
	});

	afterEach(() => {
		screen?.unmount();
	});

	describe("over the fixture's run, seat 1", () => {
		beforeEach(() => open());

		it("shows the first seat's driver on the left, with their run deck's size, whether it's changed, and Reset", () => {
			expect(screen.driver?.id).toBe('driver-1');
			expect(find<{ title: string }>('customize_side_panel').title).toBe('Driver 1 of 2');
			const card = find<DriverCard>('customize_driver_card');
			expect([card.data.name, card.data.hitpoints, card.data.handLimit]).toEqual(['Road Warrior 1', 40, 7]);
			expect(Object.values(card.data.deck).reduce((sum, copies) => sum + copies, 0)).toBe(11);
			expect(card.customDeck).toBe(true);
			expect(text('customize_vehicle')).toBe('Apocalypse Rig');
			expect(text('customize_note')).toBe('For this run only: 2 cards left at home, 1 borrowed. The default deck stays as it is.');
			expect(find<Button>('customize_reset_button').enabled).toBe(true);
		});

		it('heads the run deck with its size against the most it holds, what it borrowed, and what it left at home, and says what borrowing risks under it', () => {
			expect(['size', 'borrowed', 'home'].map((chip) => text(`customize_deck_${chip}_text`))).toEqual(['RUN DECK 11/20', 'BORROWED 1', 'LEFT HOME 2']);
			expect(text('customize_deck_note')).toBe("Borrowed cards come back with the driver. If the driver dies, they're lost with the deck.");
			expect(find<{ visible: boolean }>('customize_deck_foot').visible).toBe(true);
		});

		it("shows a card's own copies, its borrowed ones, and its ones left at home as stacks of their own, cheapest first", () => {
			expect(entries('deck').sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
				['armor_plating', 3, null],
				['covering_fire', 1, null],
				['medical_kit-borrowed', 1, 'borrowed'],
				['nitro_boost-home', 2, 'home'],
				['ramming_speed', 4, null],
				['repair_kit', 2, null],
			]);
			const order = grid('deck').views.map((view) => view.shown.cardType);
			expect(order).toEqual([...order].sort(byCost));
			expect(grid('deck').entryFor('medical_kit-borrowed')?.card.miniState).toBe('borrowed');
		});

		it('gives each stack one-fewer and one-more for its own copies, saying nothing where the run deck has no such copy to move', () => {
			// Nothing at home: the own stack's one-more is off with no line, as under a full stack on the wireframe.
			expect(live('deck', 'armor_plating')).toEqual([true, false]);
			expect(reason('deck', 'armor_plating')).toBe('');
			// The fixture borrowed the locker's only Medical Kit.
			expect(live('deck', 'medical_kit-borrowed')).toEqual([true, false]);
			expect(reason('deck', 'medical_kit-borrowed')).toBe('None left');
			// Both Nitro Boosts are at home, so there's none of the driver's own left to leave there.
			expect(live('deck', 'nitro_boost-home')).toEqual([false, true]);
			expect(reason('deck', 'nitro_boost-home')).toBe('');
			expect(grid('deck').entryFor('armor_plating')?.control('fewer')?.label).toBe('-');
			expect(grid('deck').entryFor('armor_plating')?.control('more')?.label).toBe('+');
		});

		it("shows the locker after the other seat's borrowing, each card with Borrow", () => {
			expect(keys('pool').sort()).toEqual(['emp_blast', 'headshot', 'ramming_speed']);
			for (const cardType of keys('pool')) expect(live('pool', cardType)).toEqual([true]);
			expect(find<{ kicker: string }>('customize_pool_panel').kicker).toBe(LOCKER_KICKERS.pair);
		});

		it('shows the escort card in this run deck, locked, with a control that gives it to the other seat', () => {
			expect(entries('escort')).toEqual([['escort-1', 1, 'locked']]);
			expect(grid('escort').views[0].shown.cardType).toBe('top_off');
			expect(control('escort', 'escort-1', 'give').label).toBe('Give to driver 2');
			expect(live('escort', 'escort-1')).toEqual([true]);
			expect(text('customize_escort_note')).toBe('Locked, and outside the size limit.');
			expect(find<Text>('customize_escort_empty').visible).toBe(false);
		});

		it("leaves one of the driver's own at home with one-fewer, in a HOME stack beside it, and saves it", async () => {
			press(control('deck', 'armor_plating', 'fewer'));
			expect(grid('deck').entryFor('armor_plating')?.card.copies).toBe(2);
			expect(entries('deck')).toContainEqual(['armor_plating-home', 1, 'home']);
			expect(text('customize_deck_home_text')).toBe('LEFT HOME 3');
			expect(keys('pool')).not.toContain('armor_plating');
			const loaded = await saved();
			expect(loaded.runDecks[0].own.armor_plating).toBe(2);
			expect(loaded.runDecks[0].leftHome.armor_plating).toBe(1);
			expect(loaded.drivers[0].defaultDeck).toEqual({});
		});

		it('brings a copy back from home with one-more, on the HOME stack or the own stack beside it, and saves it', async () => {
			press(control('deck', 'nitro_boost-home', 'more'));
			expect(entries('deck')).toContainEqual(['nitro_boost-home', 1, 'home']);
			expect(entries('deck')).toContainEqual(['nitro_boost', 1, null]);
			expect(live('deck', 'nitro_boost')).toEqual([true, true]);
			press(control('deck', 'nitro_boost', 'more'));
			expect(grid('deck').entryFor('nitro_boost-home')).toBeNull();
			expect(grid('deck').entryFor('nitro_boost')?.card.copies).toBe(2);
			expect(text('customize_deck_size_text')).toBe('RUN DECK 13/20');
			const loaded = await saved();
			expect(loaded.runDecks[0].own.nitro_boost).toBe(2);
			expect(loaded.runDecks[0].leftHome).toEqual({});
		});

		it('borrows from the locker into a +N stack, and takes another with its one-more, and saves it', async () => {
			campaign().set({ locker: { ...campaign().locker, ramming_speed: 2 } });
			context.frame.layout();
			press(control('pool', 'ramming_speed', 'borrow'));
			expect(entries('deck')).toContainEqual(['ramming_speed-borrowed', 1, 'borrowed']);
			expect(grid('deck').entryFor('ramming_speed')?.card.copies).toBe(4);
			expect(entries('pool')).toContainEqual(['ramming_speed', 1, null]);
			press(control('deck', 'ramming_speed-borrowed', 'more'));
			expect(grid('deck').entryFor('ramming_speed-borrowed')?.card.copies).toBe(2);
			expect(keys('pool')).not.toContain('ramming_speed');
			expect(text('customize_deck_borrowed_text')).toBe('BORROWED 3');
			const loaded = await saved();
			expect(loaded.runDecks[0].borrowed).toEqual({ medical_kit: 1, ramming_speed: 2 });
			expect(loaded.locker.ramming_speed).toBeUndefined();
		});

		it("puts a borrowed copy back with one-fewer, and the own stack's one-fewer says borrowed copies go first", async () => {
			press(control('pool', 'ramming_speed', 'borrow'));
			expect(live('deck', 'ramming_speed')).toEqual([false, false]);
			expect(reason('deck', 'ramming_speed')).toBe('Borrowed go first');
			press(control('deck', 'ramming_speed-borrowed', 'fewer'));
			expect(grid('deck').entryFor('ramming_speed-borrowed')).toBeNull();
			expect(live('deck', 'ramming_speed')).toEqual([true, false]);
			press(control('deck', 'medical_kit-borrowed', 'fewer'));
			expect(entries('pool')).toContainEqual(['medical_kit', 1, null]);
			const loaded = await saved();
			expect(loaded.runDecks[0].borrowed).toEqual({});
			expect(loaded.locker).toMatchObject({ medical_kit: 1, ramming_speed: 1 });
		});

		it('says a +N stack can take no more when the locker has none left, or the other seat borrowed the rest', () => {
			press(control('pool', 'emp_blast', 'borrow'));
			expect(live('deck', 'emp_blast-borrowed')).toEqual([true, false]);
			expect(reason('deck', 'emp_blast-borrowed')).toBe('None left');
			press(control('pool', 'headshot', 'borrow'));
			expect(reason('deck', 'headshot-borrowed')).toBe('Other seat has it');
		});

		it('says Deck full on every live one-more and Borrow at the most a run deck holds', () => {
			setSeatOne({ own: { ...campaign().runDecks[0].own, ram: 9 } });
			expect(text('customize_deck_size_text')).toBe('RUN DECK 20/20');
			expect([live('deck', 'nitro_boost-home')[1], reason('deck', 'nitro_boost-home')]).toEqual([false, 'Deck full']);
			// The locker is asked first, and holds no Medical Kit to take.
			expect(reason('deck', 'medical_kit-borrowed')).toBe('None left');
			for (const cardType of keys('pool')) expect([cardType, reason('pool', cardType)]).toEqual([cardType, 'Deck full']);
			expect(reason('deck', 'armor_plating')).toBe('');
		});

		it('says Deck at minimum on every one-fewer at the fewest a run deck holds', () => {
			setSeatOne({ own: { armor_plating: 3, covering_fire: 1, repair_kit: 2, ramming_speed: 1 } });
			expect(text('customize_deck_size_text')).toBe('RUN DECK 8/20');
			for (const entryKey of ['armor_plating', 'covering_fire', 'repair_kit', 'ramming_speed', 'medical_kit-borrowed']) {
				expect([entryKey, live('deck', entryKey)[0], reason('deck', entryKey)]).toEqual([entryKey, false, 'Deck at minimum']);
			}
		});

		it("fades a locker card for another archetype and says whose it is, and turns Borrow off for a card with the driver's own at home", () => {
			campaign().set({ locker: { ...campaign().locker, precision_shot: 1, nitro_boost: 1 } });
			context.frame.layout();
			expect(live('pool', 'precision_shot')).toEqual([false]);
			expect(reason('pool', 'precision_shot')).toBe('Interceptor only');
			expect(grid('pool').entryFor('precision_shot')?.card.miniState).toBe('unavailable');
			expect(live('pool', 'nitro_boost')).toEqual([false]);
			expect(reason('pool', 'nitro_boost')).toBe('Yours at home');
			expect(grid('pool').entryFor('nitro_boost')?.card.miniState).toBeNull();
		});

		it('gives the escort card to the other seat, and says so where it was, and saves it', async () => {
			press(control('escort', 'escort-1', 'give'));
			expect(grid('escort').visible).toBe(false);
			expect(find<Text>('customize_escort_empty').visible).toBe(true);
			expect(find<Text>('customize_escort_note').visible).toBe(false);
			expect(context.focus.focused?.id).toBe('customize_driver_card');
			const loaded = await saved();
			expect(loaded.runDecks[0].escortCards).toEqual([]);
			expect(loaded.runDecks[1].escortCards.map((card) => card.broughtBy)).toEqual(['escort-1', 'escort-3']);
		});

		it("turns the escort card's control off with the reason when the other seat's driver is away", () => {
			campaign().drivers[4].set({ status: 'missing' });
			// The screen reads the campaign again on its change, not a record's.
			campaign().set({ locker: { ...campaign().locker, ram: 1 } });
			context.frame.layout();
			expect(live('escort', 'escort-1')).toEqual([false]);
			expect(reason('escort', 'escort-1')).toBe('Missing on a run');
		});

		it('resets the run deck to the default deck, borrowed copies back in the locker and escort cards kept, and saves it', async () => {
			press(find<Button>('customize_reset_button'));
			expect(entries('deck').every(([, , state]) => state === null)).toBe(true);
			expect(grid('deck').entryFor('nitro_boost')?.card.copies).toBe(2);
			expect(keys('pool')).toContain('medical_kit');
			expect(text('customize_note')).toBe('Same as the default deck. Change anything here and it applies to this run only.');
			expect(find<DriverCard>('customize_driver_card').customDeck).toBe(false);
			expect(find<Button>('customize_reset_button').enabled).toBe(false);
			// Disabled under focus, Reset hands it to the card above it.
			expect(context.focus.focused?.id).toBe('customize_driver_card');
			expect(keys('escort')).toEqual(['escort-1']);
			const loaded = await saved();
			expect(loaded.runDecks[0].leftHome).toEqual({});
			expect(loaded.runDecks[0].borrowed).toEqual({});
			expect(loaded.locker.medical_kit).toBe(1);
		});

		it('starts focus on Done, and Tabs through the driver, Reset, the escort cards, the run deck, the filter, and the locker', () => {
			expect(context.focus.focused?.id).toBe('customize_done_button');
			const stops = Array.from({ length: 7 }, () => {
				send(context, [key('Tab')]);
				const focused = context.focus.focused;
				return focused?.id ?? focused?.parent?.id;
			});
			expect(stops).toEqual([
				'customize_driver_card',
				'customize_reset_button',
				'customize_escort_grid_escort-1_card',
				`customize_deck_grid_${keys('deck')[0]}_card`,
				'customize_pool_filter',
				`customize_pool_grid_${keys('pool')[0]}_card`,
				'customize_done_button',
			]);
		});

		it("goes from a card down to its first live control and back up, so a HOME stack's lands on one-more (R9.26)", () => {
			const own = grid('deck').entryFor('armor_plating');
			const home = grid('deck').entryFor('nitro_boost-home');
			if (!own || !home) throw new Error('no stacks');
			context.focus.focus(own.card);
			send(context, [key('ArrowDown')]);
			expect(context.focus.focused).toBe(own.control('fewer'));
			send(context, [key('ArrowUp')]);
			expect(context.focus.focused).toBe(own.card);
			context.focus.focus(home.card);
			send(context, [key('ArrowDown')]);
			expect(context.focus.focused).toBe(home.control('more'));
		});

		it("keeps focus on the card's HOME stack when one-fewer takes its last own copy", () => {
			press(control('deck', 'covering_fire', 'fewer'));
			expect(grid('deck').entryFor('covering_fire')).toBeNull();
			context.frame.layout();
			expect(context.focus.focused?.id).toBe('customize_deck_grid_covering_fire-home_card');
		});

		it("moves focus from a one-more that bringing the last copy home turns off to its card", () => {
			press(control('deck', 'armor_plating', 'fewer'));
			press(control('deck', 'armor_plating', 'more'));
			expect(live('deck', 'armor_plating')).toEqual([true, false]);
			expect(context.focus.focused?.id).toBe('customize_deck_grid_armor_plating_card');
		});

		it("leaves another of the driver's own at home from the HOME stack's one-fewer", () => {
			press(control('deck', 'armor_plating', 'fewer'));
			press(control('deck', 'armor_plating-home', 'fewer'));
			expect(entries('deck')).toContainEqual(['armor_plating', 1, null]);
			expect(entries('deck')).toContainEqual(['armor_plating-home', 2, 'home']);
		});

		it("keeps focus on the card's own stack when HOME's one-more brings its last copy back", () => {
			press(control('deck', 'nitro_boost-home', 'more'));
			send(context, [key('Enter')]);
			context.frame.layout();
			expect(grid('deck').entryFor('nitro_boost-home')).toBeNull();
			expect(context.focus.focused?.id).toBe('customize_deck_grid_nitro_boost_card');
		});

		it("keeps focus on the card's own stack when +N's one-fewer puts its last borrowed copy back", () => {
			press(control('pool', 'ramming_speed', 'borrow'));
			press(control('deck', 'ramming_speed-borrowed', 'fewer'));
			expect(grid('deck').entryFor('ramming_speed-borrowed')).toBeNull();
			expect(context.focus.focused?.id).toBe('customize_deck_grid_ramming_speed_card');
		});

		it('lands on the mini, not a control, of the card in its place when a +N stack with no own copies empties, so the next press moves nothing', () => {
			const order = keys('deck');
			const next = order[order.indexOf('medical_kit-borrowed') + 1];
			press(control('deck', 'medical_kit-borrowed', 'fewer'));
			expect(context.focus.focused?.id).toBe(`customize_deck_grid_${next}_card`);
			const before = entries('deck');
			send(context, [key('Enter')]);
			context.frame.layout();
			expect(entries('deck')).toEqual(before);
		});

		it("turns Reset off when the rules refuse it, the driver being away", () => {
			campaign().drivers[0].set({ status: 'missing' });
			// The screen reads the campaign again on its change, not a record's.
			campaign().set({ locker: { ...campaign().locker, ram: 1 } });
			context.frame.layout();
			expect(campaign().runDecks[0].isCustomized).toBe(true);
			expect(find<Button>('customize_reset_button').enabled).toBe(false);
		});

		it("pins the driver card's detail view on a secondary click, as the Crew screen's roster does", () => {
			const card = find<DriverCard>('customize_driver_card');
			const { x, y, width, height } = card.screenBounds;
			click(context, x + width / 2, y + height / 2, { button: 2 });
			expect(context.tooltips.pinned).toBe(card);
		});

		it("keeps focus in the locker when Borrow takes a card's last copy: on the Borrow of the card now in its place", () => {
			const order = keys('pool');
			const index = order.indexOf('emp_blast');
			press(control('pool', 'emp_blast', 'borrow'));
			context.frame.layout();
			expect(context.focus.focused?.id).toBe(`customize_pool_grid_${order[index + 1] ?? order[index - 1]}_borrow`);
		});

		it('goes back to the compound with the campaign by default, focus restored, on Done or Escape', () => {
			const shown = screen.shown;
			find<Button>('customize_done_button').onClick?.({} as never);
			expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign: shown }, { restoreFocus: true });
			navigate.mockClear();
			send(context, [key('Escape')]);
			expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign: shown }, { restoreFocus: true });
		});
	});

	it('shows the driver it is handed, and Done goes to the screen it is told, with the campaign', async () => {
		const handed = fullRunCampaign();
		storage = new FaultyStorage();
		store = storeOver(storage);
		screen = new CustomizeScreen({ store, cards: async () => lookup });
		screen.mount(context, { campaign: handed, driver: handed.drivers[4], returnTo: 'developerScreen' });
		await screen.campaignLoaded;
		context.frame.layout();
		expect(screen.shown).toBe(handed);
		expect(screen.driver?.id).toBe('driver-5');
		expect(find<{ title: string }>('customize_side_panel').title).toBe('Driver 2 of 2');
		expect(entries('escort')).toEqual([]);
		expect(find<Text>('customize_escort_empty').visible).toBe(true);
		expect(find<Button>('customize_reset_button').enabled).toBe(false);
		send(context, [key('Escape')]);
		expect(navigate).toHaveBeenLastCalledWith('developerScreen', { campaign: handed }, { restoreFocus: true });
	});

	it('hands back what it was handed to hand back, with the campaign', async () => {
		const handed = fullRunCampaign();
		screen = new CustomizeScreen({ store: storeOver(new FaultyStorage()), cards: async () => lookup });
		screen.mount(context, { campaign: handed, returnTo: 'developerScreen', returnData: { route: 'route-2', campaign: 'stale' } });
		await screen.campaignLoaded;
		find<Button>('customize_done_button').onClick?.({} as never);
		expect(navigate).toHaveBeenLastCalledWith('developerScreen', { route: 'route-2', campaign: handed }, { restoreFocus: true });
	});

	it('on a run with one seat, offers no escort card control and says the locker is all free to borrow', async () => {
		await open({ text: soloText() });
		expect(find<{ title: string }>('customize_side_panel').title).toBe('Driver 1 of 1');
		expect(keys('escort')).toEqual(['escort-1']);
		expect(grid('escort').views[0].control('give')).toBeNull();
		expect(reason('escort', 'escort-1')).toBe('');
		expect(find<{ kicker: string }>('customize_pool_panel').kicker).toBe(LOCKER_KICKERS.solo);
	});

	it('says the cards are loading, or failed to, in place of the escort cards too', async () => {
		storage = storageWith(fixtureText());
		screen = new CustomizeScreen({ store: storeOver(storage), cards: () => new Promise<CardLookup>(() => undefined) });
		screen.mount(context);
		await flush();
		context.frame.layout();
		expect(screen.driver?.id).toBe('driver-1');
		expect([find<Text>('customize_escort_empty').visible, text('customize_escort_empty')]).toEqual([true, 'Loading the cards.']);
	});

	it('saves into the store it is handed in place of its own, which the developer launcher uses to leave the save alone', async () => {
		const handed = fullRunCampaign();
		const own = new FaultyStorage();
		const scratch = new MemorySaveStorage();
		screen = new CustomizeScreen({ store: storeOver(own), cards: async () => lookup });
		screen.mount(context, { campaign: handed, store: storeOver(scratch) });
		await screen.campaignLoaded;
		context.frame.layout();
		press(control('deck', 'headshot-borrowed', 'fewer'));
		await flush();
		expect(own.writes).toEqual([]);
		expect((await storeOver(scratch).load())?.runDecks[0].borrowed).toEqual({});
	});

	it('says under the top bar when a change could not be saved, and clears it once a save lands', async () => {
		await open();
		storage.fault = { method: 'setItem', error: quotaError() };
		press(control('pool', 'headshot', 'borrow'));
		await flush();
		expect(find<Text>('customize_save_error').visible).toBe(true);
		expect(text('customize_save_error')).toBe("The campaign couldn't be saved: storage is full.");
		expect(find<{ color: unknown }>('customize_save_error').color).toEqual(tokens.color.status_crit);
		// A failed checkpoint has settled by now, and a failure is no landing: the line stays through another one.
		press(control('deck', 'armor_plating', 'fewer'));
		await flush();
		expect(find<Text>('customize_save_error').visible).toBe(true);
		storage.fault = null;
		press(control('pool', 'emp_blast', 'borrow'));
		await flush();
		expect(find<Text>('customize_save_error').visible).toBe(false);
		const loaded = await saved();
		expect(loaded.runDecks[0].borrowed).toMatchObject({ headshot: 1, emp_blast: 1 });
		expect(loaded.runDecks[0].leftHome).toMatchObject({ armor_plating: 1 });
	});

	it('says there is no run deck when no run is out, and hides the driver', async () => {
		await open({ text: atHomeText() });
		expect(screen.driver).toBeNull();
		expect([text('customize_deck_empty'), text('customize_pool_empty')]).toEqual([
			'No run is out, so there is no run deck to change.',
			'No run is out, so there is no run deck to change.',
		]);
		expect(find<{ visible: boolean }>('customize_side_body').visible).toBe(false);
		expect(find<{ visible: boolean }>('customize_deck_chips').visible).toBe(false);
		expect(find<{ visible: boolean }>('customize_deck_foot').visible).toBe(false);
		// No run is no run of one: the locker says nothing of being all free to borrow.
		expect(find<{ kicker: string }>('customize_pool_panel').kicker).toBe(LOCKER_KICKERS.pair);
	});

	it('says the campaign is over, and how it fell, in place of the run deck and the locker', async () => {
		await open({ text: fallenText() });
		expect(screen.shown?.isOver).toBe(true);
		expect([text('customize_deck_empty'), text('customize_pool_empty')]).toEqual([
			'Campaign over. No drivers are left, and the compound disbanded.',
			'Campaign over. No drivers are left, and the compound disbanded.',
		]);
		expect(find<{ visible: boolean }>('customize_side_body').visible).toBe(false);
		find<Button>('customize_done_button').onClick?.({} as never);
		expect(navigate).toHaveBeenLastCalledWith('compoundScreen', { campaign: screen.shown }, { restoreFocus: true });
	});

	it("says why there is no run deck when there is no save, or it is damaged, and Done still goes back", async () => {
		store = storeOver(new MemorySaveStorage());
		screen = new CustomizeScreen({ store, cards: async () => lookup });
		screen.mount(context);
		await screen.campaignLoaded;
		expect(text('customize_deck_empty')).toBe('No campaign in progress.');
		screen.unmount();

		store = storeOver(storageWith(damagedText()));
		screen = new CustomizeScreen({ store, cards: async () => lookup });
		screen.mount(context);
		await screen.campaignLoaded;
		expect(text('customize_deck_empty')).toBe("The saved campaign is damaged and can't be loaded. It's been kept.");
		find<Button>('customize_done_button').onClick?.({} as never);
		expect(navigate).toHaveBeenLastCalledWith('compoundScreen', undefined, { restoreFocus: true });
	});

	it("shows the driver and says so in place of the run deck and the locker when the cards can't be loaded", async () => {
		const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		storage = storageWith(fixtureText());
		screen = new CustomizeScreen({ store: storeOver(storage), cards: () => Promise.reject(new Error('offline')) });
		screen.mount(context);
		await screen.campaignLoaded;
		quiet.mockRestore();
		expect(find<DriverCard>('customize_driver_card').tooltip).toBeNull();
		expect(entries('deck')).toEqual([]);
		expect(text('customize_deck_empty')).toBe("The cards couldn't be loaded.");
		expect(text('customize_pool_empty')).toBe("The cards couldn't be loaded.");
		expect([find<Text>('customize_escort_empty').visible, text('customize_escort_empty')]).toEqual([true, "The cards couldn't be loaded."]);
	});

	describe('laid out in the real faces', () => {
		const sizes = [{ width: 1440, height: 882 }, { width: 1024, height: 600 }];

		function lintAt(size: { width: number; height: number }): unknown[] {
			context.frame.layout();
			return layoutLint(treeSnapshot([screen.root], size)).violations;
		}

		it.each(sizes)("lays out the fixture's run with no lint at $width x $height, the chips on one row", async (size) => {
			await openMeasured(size);
			expect(lintAt(size)).toEqual([]);
			expect(bounds('customize_deck_home').y).toBe(bounds('customize_deck_size').y);
			expect(bounds('customize_side_panel').width).toBe(DECK_BUILDER.sideWidth);
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

		/** The full run, its locker swapped for 44 kinds of card. */
		function crowdedText(): string {
			const crowded = fullRunCampaign();
			crowded.set({ locker: Object.fromEntries([...manyCards.keys()].map((type, index) => [type, (index % 3) + 1])) });
			return saveText({ campaign: crowded.toSaveText() });
		}

		it.each([
			{ width: 1440, height: 882, columns: 5 },
			{ width: 1024, height: 600, columns: 3 },
		])('holds a 20-card run deck, two escort cards, and a locker of 44 kinds at $width x $height, scrolling, with no lint', async ({ width, height, columns }) => {
			await openMeasured({ width, height }, { text: crowdedText(), cards: manyLookup });
			expect(text('customize_deck_size_text')).toBe('RUN DECK 20/20');
			expect(grid('pool').views).toHaveLength(44);
			expect(keys('escort')).toEqual(['escort-1', 'escort-3']);
			expect(lintAt({ width, height })).toEqual([]);
			for (const side of ['deck', 'pool'] as const) {
				const rowOne = grid(side).views.filter((view) => view.screenBounds.y === grid(side).views[0].screenBounds.y);
				expect([side, rowOne.length]).toEqual([side, columns]);
			}
			const [first, second] = grid('escort').views;
			expect(second.screenBounds.y).toBe(first.screenBounds.y);
			expect(find<{ overflows: boolean }>('customize_pool_scroll').overflows).toBe(true);
			for (const id of ['customize_top_bar', 'customize_side_panel', 'customize_pool_panel', 'customize_deck_panel']) {
				const box = bounds(id);
				expect(box.x + box.width).toBeLessThanOrEqual(width);
				expect(box.y + box.height).toBeLessThanOrEqual(height);
			}
		});

		it.each(sizes)('lays out with no run out with no lint at $width x $height', async (size) => {
			await openMeasured(size, { text: atHomeText() });
			expect(lintAt(size)).toEqual([]);
		});

		it.each(sizes)('lays out a run with one seat, its escort card with no control, with no lint at $width x $height', async (size) => {
			await openMeasured(size, { text: soloText() });
			expect(lintAt(size)).toEqual([]);
		});

		it.each(sizes)('lays out a campaign that is over with no lint at $width x $height', async (size) => {
			await openMeasured(size, { text: fallenText() });
			expect(lintAt(size)).toEqual([]);
		});

		it.each(sizes)('lays out with no save with no lint at $width x $height', async (size) => {
			viewport.logical = size;
			context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
			screen = new CustomizeScreen({ store: storeOver(new MemorySaveStorage()), cards: async () => lookup });
			screen.mount(context);
			await screen.campaignLoaded;
			expect(lintAt(size)).toEqual([]);
		});

		// Every reason under a card, the run deck's own included, is measured by the Crew screen's test.
		it('fits the escort control on one line under its card', async () => {
			await openMeasured({ width: 1024, height: 600 });
			const give = control('escort', 'escort-1', 'give');
			for (const label of [giveLabel(1), giveLabel(2)]) {
				const measured = context.draw.measureText({ text: label, font: 'display', size: tokens.control.control_fs_sm });
				expect([label, measured.width <= give.width - CARD_ENTRY.controls.inset * 2]).toEqual([label, true]);
			}
		});
	});
});

/** The fixture's run with its first seat alone, as a run of one saves: the second seat home with their run deck back as their default deck. */
function soloText(): string {
	return fixtureText((json) => {
		const drivers = json.drivers as Record<string, unknown>[];
		const [first, second] = json.runDecks as { own: Record<string, number> }[];
		json.runDecks = [first];
		drivers[4] = { ...drivers[4], defaultDeck: second.own };
	});
}

/** The fixture home from its run with nobody left at the compound, the campaign over, as a save holds it. */
function fallenText(): string {
	return fixtureText((json) => {
		const drivers = json.drivers as Record<string, unknown>[];
		json.runDecks = [];
		json.foundOnRun = [];
		json.supplyRun = null;
		drivers[0] = { ...drivers[0], status: 'dead', hitpoints: 0 };
		drivers[2] = { ...drivers[2], status: 'missing', injuredDays: 0 };
		drivers[4] = { ...drivers[4], status: 'missing', defaultDeck: startingDeckCounts('interceptor') };
		json.end = { ending: 'disbanded', cause: 'last_driver' };
	});
}

/** Cheapest first, then by name, as the deck builder orders cards. */
function byCost(a: string, b: string): number {
	return deckOrder(lookup(a) as GameCard, lookup(b) as GameCard);
}
