/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import type { Text } from '../../../engine/components/Text';
import { click, key, send } from '../../../engine/services/testing';
import { NO_MODIFIERS } from '../../../engine/input/events';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { ScreenManager } from '../../core/ScreenManager';
import { NO_RESOURCES } from '../../campaign/Campaign';
import { EVENTS, EventParty, EventResult, GameEvent, eventById, landOutcome, resolveChoice } from '../../campaign/Events';
import type { AtlasButton } from '../../ui/atlas/AtlasButton';
import type { CardLookup } from '../../ui/DriverDetailView';
import { sampleCard } from '../developer/CardDetailSection';
import { ChoiceCard } from './ChoiceCard';
import { EventScreen, EventScreenData, STAND_IN_PARTY } from './EventScreen';
import type { JournalPage } from './JournalPage';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;
const cards = async (): Promise<CardLookup> => (type) => sampleCard(type);

function event(id: string): GameEvent {
	const found = eventById(id);
	if (!found) throw new Error(`no event ${id}`);
	return found;
}

const FAMILY = event('family_under_fire');
const BUS = event('burned_bus');
/** Meets every need the content has and pays any cost, so every choice can be taken. */
const EVERYTHING: EventParty = {
	archetypes: ['road_warrior', 'interceptor', 'mechanic', 'raider'],
	cards: { emp_blast: 1 },
	escorts: ['outrider', 'pilot_car', 'fuel_hauler', 'med_truck'],
	resources: { food: 30, water: 30, fuel: 30, meds: 30, scrap: 30, people: 30 },
};
/** Enough fuel to pay them off; no EMP Blast. */
const CONVOY: EventParty = { archetypes: ['road_warrior', 'interceptor'], cards: { ram: 1 }, escorts: ['med_truck'], resources: { ...NO_RESOURCES, fuel: 3 } };

describe('EventScreen (DDB-45)', () => {
	const viewport = { logical: { width: 1440, height: 882 } };
	let context: MountContext;
	let screen: EventScreen;

	async function open(data?: Partial<EventScreenData>): Promise<void> {
		screen = new EventScreen({ cards });
		screen.mount(context, data);
		await screen.cardsLoaded;
		context.frame.layout();
	}

	function find<T>(id: string): T {
		const found = screen.root.findById(id);
		if (!found) throw new Error(`no ${id}`);
		return found as unknown as T;
	}

	const text = (id: string): string => find<Text>(id).text;
	const card = (choice: string): ChoiceCard => find<ChoiceCard>(`event_choice_${choice}`);

	function clickOn(id: string): void {
		const { x, y, width, height } = find<{ screenBounds: { x: number; y: number; width: number; height: number } }>(id).screenBounds;
		click(context, x + width / 2, y + height / 2);
	}

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1440, height: 882 };
		context = createTestContext({ viewport, clock: new Clock() });
	});

	afterEach(() => {
		screen?.unmount();
	});

	it('shows the event: title, kicker, the journal, and a card for each choice in the file\'s order', async () => {
		await open({ event: FAMILY, party: CONVOY, where: 'stop 2 of 5' });
		expect(text('event_title')).toBe(FAMILY.title);
		expect(text('event_kicker')).toBe('Distress signal / stop 2 of 5');
		expect(text('event_setup')).toBe(FAMILY.setup);
		expect(text('event_situation')).toBe(FAMILY.situation);
		const shown = find<{ children: readonly unknown[] }>('event_choices').children.filter((child): child is ChoiceCard => child instanceof ChoiceCard);
		expect(shown.map(({ choice }) => choice.id)).toEqual(FAMILY.choices.map(({ id }) => id));
		expect(card('charge').titleText).toBe('Charge the raiders');
	});

	it('marks risks and rewards, and says what a choice needs or why it\'s locked', async () => {
		await open({ event: FAMILY, party: { ...CONVOY, resources: { ...NO_RESOURCES, fuel: 2 } } });
		expect(card('charge').icons).toEqual({ risks: ['swords:cost', 'skull:cost', 'skull:cost'], gains: ['food:gain', 'people:gain'] });
		expect(card('charge').enabled).toBe(true);
		const emp = card('kill_engines');
		expect(emp.enabled).toBe(false);
		expect(emp.needText).toBe('Requires: EMP Blast');
		// Locked for a need: the label stays clean, not struck through.
		expect(emp.style.title.textDecoration).toBeUndefined();
		const pay = card('pay_them_off');
		expect(pay.enabled).toBe(false);
		expect(pay.needText).toBe('Need 3 fuel, have 2');
		// Short of stores: struck through, as Game Flow 5.2 has it.
		expect(pay.style.title.textDecoration).toBe('strike');
		expect(pay.icons.risks).toEqual(['skull:cost', 'fuel:cost', 'clock:ink']);
		expect(card('drive_on').icons).toEqual({ risks: [], gains: [] });
		// A need the party meets still shows, so the player sees why it's there, and stays beside a shortfall.
		screen.unmount();
		await open({ event: event('armored_car'), party: { ...CONVOY, archetypes: ['mechanic'], resources: { ...NO_RESOURCES, scrap: 5 } } });
		expect(card('get_it_running').needText).toBe('Mechanic / Need 8 scrap, have 5');
		screen.unmount();
		await open({ event: event('jackknifed_tanker'), party: { ...CONVOY, archetypes: ['mechanic'] } });
		expect(card('crack_valve').enabled).toBe(true);
		expect(card('crack_valve').needText).toBe('Mechanic only');
	});

	it('opens on the first event with the stand-in party when handed nothing, as the dev hook and capture open it', async () => {
		await open();
		expect(screen.shownEvent).toBe(EVENTS[0]);
		// The stand-in has no Mechanic, so the capture shows an archetype lock.
		expect(card('crack_valve').enabled).toBe(false);
		expect(card('crack_valve').needText).toBe('Mechanic only');
		expect(STAND_IN_PARTY.archetypes).not.toContain('mechanic');
		expect(context.focus.focused?.id).toBe(`event_choice_${EVENTS[0].choices[0].id}`);
	});

	it('takes a choice on a click, tells the run, and shows what happened with the cards it gave as cards', async () => {
		const chosen: EventResult[] = [];
		await open({ event: BUS, party: CONVOY, draw: 0, onChoose: (result) => chosen.push(result) });
		clickOn('event_choice_search_bus');
		await screen.cardsLoaded;
		context.frame.layout();
		const expected = resolveChoice({ event: BUS, choice: 'search_bus', party: CONVOY, draw: 0 });
		expect(chosen).toEqual([expected]);
		expect(screen.result).toEqual(expected);
		expect(screen.root.findById('event_choices')).toBeNull();
		expect(text('event_outcome_text')).toBe(expected.outcome.text);
		expect(text('event_outcome_line_0_text')).toBe('+3 scrap');
		expect(find<{ tone: string }>('event_outcome_line_0_icon').tone).toBe('gain');
		expect(text('event_outcome_line_1_text')).toBe('+0.5 h at the stop');
		expect(screen.root.findById('event_reward_medical_kit')).not.toBeNull();
		expect(find<AtlasButton>('event_go_button').label).toBe('Drive on');
		expect(context.focus.focused?.id).toBe('event_go_button');
	});

	it('ignores a click on a locked choice', async () => {
		const chosen: EventResult[] = [];
		await open({ event: FAMILY, party: CONVOY, onChoose: (result) => chosen.push(result) });
		clickOn('event_choice_kill_engines');
		expect(chosen).toEqual([]);
		expect(screen.result).toBeNull();
	});

	it('takes a choice by its number key once, and hands off a fight on Fight them', async () => {
		const chosen: EventResult[] = [];
		const done: EventResult[] = [];
		await open({ event: FAMILY, party: EVERYTHING, onChoose: (result) => chosen.push(result), onDone: (result) => done.push(result) });
		send(context, [key('1'), key('1', 'up')]);
		context.frame.layout();
		expect(screen.result?.outcome.fight).not.toBeNull();
		expect(text('event_outcome_line_0_text')).toBe('Raiders, 2 skulls. Win, and: +2 food; 3 settlers join you.');
		expect(find<AtlasButton>('event_go_button').label).toBe('Fight them');
		// Every choice is open to this party, so only the guard stops a second one.
		send(context, [key('4'), key('4', 'up')]);
		expect(chosen.map(({ choice }) => choice)).toEqual(['charge']);
		clickOn('event_go_button');
		expect(done).toEqual([screen.result]);
	});

	it('ignores a held number key and a chord', async () => {
		await open({ event: FAMILY, party: EVERYTHING });
		const held = { kind: 'key', phase: 'down', key: '4', repeat: true, modifiers: NO_MODIFIERS } as const;
		const chord = { kind: 'key', phase: 'down', key: '4', repeat: false, modifiers: { ...NO_MODIFIERS, ctrl: true } } as const;
		send(context, [held, chord]);
		expect(screen.result).toBeNull();
	});

	it('moves between the cards it can take with the arrows, and takes the focused one with Enter', async () => {
		await open({ event: FAMILY, party: { ...CONVOY, cards: { emp_blast: 1 } } });
		expect(context.focus.focused?.id).toBe('event_choice_charge');
		send(context, [key('ArrowRight'), key('ArrowRight', 'up')]);
		expect(context.focus.focused?.id).toBe('event_choice_kill_engines');
		send(context, [key('Enter'), key('Enter', 'up')]);
		expect(screen.result?.choice).toBe('kill_engines');
	});

	it('sets the journal in larger type on a tall window, its rules following', async () => {
		await open({ event: FAMILY, party: CONVOY });
		expect(find<Text>('event_setup').fontSize).toBe(17);
		expect(find<JournalPage>('event_page').pitch).toBeCloseTo(17 * 1.45);
		viewport.logical = { width: 1024, height: 600 };
		screen.resize(1024, 600);
		expect(find<Text>('event_setup').fontSize).toBe(14);
		expect(find<JournalPage>('event_page').pitch).toBeCloseTo(14 * 1.45);
	});

	it('drops cards that load after the screen has gone, and fills the next mount from its own load', async () => {
		const pending: ((lookup: CardLookup) => void)[] = [];
		screen = new EventScreen({ cards: () => new Promise((resolve) => pending.push(resolve)) });
		const result = landOutcome({ event: BUS, choice: 'search_bus', draw: 0 });
		screen.mount(context, { event: BUS, result });
		const first = screen.cardsLoaded;
		expect(find<{ visible: boolean }>('event_rewards').visible).toBe(false);
		screen.unmount();
		screen.mount(context, { event: BUS, result });
		const second = screen.cardsLoaded;
		pending[0]((type) => sampleCard(type));
		await first;
		expect(screen.root.findById('event_reward_medical_kit')).toBeNull();
		pending[1]((type) => sampleCard(type));
		await second;
		expect(screen.root.findById('event_reward_medical_kit')).not.toBeNull();
		expect(find<{ visible: boolean }>('event_rewards').visible).toBe(true);
	});

	it('shows no rewards, and no gap for them, when the cards fail to load', async () => {
		const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		screen = new EventScreen({ cards: () => Promise.reject(new Error('offline')) });
		screen.mount(context, { event: BUS, result: landOutcome({ event: BUS, choice: 'search_bus', draw: 0 }) });
		await screen.cardsLoaded;
		expect(find<{ visible: boolean }>('event_rewards').visible).toBe(false);
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	it('labels the highway Pick a card for an outcome with the reward picker', async () => {
		await open({ event: BUS, result: landOutcome({ event: BUS, choice: 'follow_tracks', draw: 0 }) });
		expect(find<AtlasButton>('event_go_button').label).toBe('Pick a card');
	});

	it('reopens on a result a saved step holds, and with nothing hooked up Drive on goes to the menu', async () => {
		// Rebuilt with no lock check: the scrap is already paid.
		const result = landOutcome({ event: event('armored_car'), choice: 'get_it_running', draw: 0 });
		await open({ event: event('armored_car'), result });
		expect(screen.root.findById('event_choices')).toBeNull();
		expect(text('event_outcome_line_0_text')).toBe('Paid 8 scrap');
		expect(screen.root.findById('event_reward_outrider')).not.toBeNull();
		clickOn('event_go_button');
		expect(navigate).toHaveBeenCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
	});

	describe.each([{ width: 1440, height: 882 }, { width: 1024, height: 600 }])('at $width x $height, measured in the real faces', (size) => {
		beforeEach(() => {
			viewport.logical = size;
			context = createTestContext({ viewport, clock: new Clock(), draw: createMeasuringDrawApi().api });
		});

		it.each(EVENTS.map((shown) => [shown.id, shown] as const))('lays out %s with no lint, before and after every choice', async (_id, shown) => {
			await open({ event: shown, party: { ...CONVOY, resources: { ...NO_RESOURCES, fuel: 1 } } });
			expect(layoutLint(treeSnapshot([screen.root], size)).violations).toEqual([]);
			for (const choice of shown.choices) {
				for (let outcome = 0; outcome < choice.outcomes.length; outcome += 1) {
					const total = choice.outcomes.reduce((sum, { weight }) => sum + weight, 0);
					const before = choice.outcomes.slice(0, outcome).reduce((sum, { weight }) => sum + weight, 0);
					const result = landOutcome({ event: shown, choice: choice.id, draw: before / total });
					screen.unmount();
					await open({ event: shown, result });
					expect({ choice: choice.id, outcome, violations: layoutLint(treeSnapshot([screen.root], size)).violations }).toEqual({ choice: choice.id, outcome, violations: [] });
				}
			}
		});
	});
});
