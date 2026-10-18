/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import type { Text } from '../../../engine/components/Text';
import { click, key, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { ScreenManager } from '../../core/ScreenManager';
import { NO_RESOURCES } from '../../campaign/Campaign';
import { EVENTS, EventParty, EventResult, GameEvent, eventById, resolveChoice } from '../../campaign/Events';
import type { AtlasButton } from '../../ui/atlas/AtlasButton';
import type { CardLookup } from '../../ui/DriverDetailView';
import { sampleCard } from '../developer/CardDetailSection';
import { ChoiceCard } from './ChoiceCard';
import { EventScreen, EventScreenData, STAND_IN_PARTY } from './EventScreen';
import { fightText, lockText, needText } from './eventText';

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
		expect(emp.needText).toBe(lockText({ reason: 'card', cardType: 'emp_blast' }));
		const pay = card('pay_them_off');
		expect(pay.enabled).toBe(false);
		expect(pay.needText).toBe('Need 3 fuel, have 2');
		expect(pay.icons.risks).toEqual(['skull:cost', 'fuel:cost', 'clock:ink']);
		expect(card('drive_on').icons).toEqual({ risks: [], gains: [] });
		// A need the party meets still shows, so the player sees why it's there.
		await open({ event: event('jackknifed_tanker'), party: STAND_IN_PARTY });
		expect(card('crack_valve').enabled).toBe(true);
		expect(card('crack_valve').needText).toBe(needText({ archetype: 'mechanic', card: null, escort: null }));
	});

	it('opens on the first event with the stand-in party when handed nothing, as the dev hook and capture open it', async () => {
		await open();
		expect(screen.shownEvent).toBe(EVENTS[0]);
		expect(card('crack_valve').enabled).toBe(true);
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

	it('takes a choice by its number key, and hands off a fight on Fight them', async () => {
		const done: EventResult[] = [];
		await open({ event: FAMILY, party: CONVOY, onDone: (result) => done.push(result) });
		send(context, [key('1'), key('1', 'up')]);
		context.frame.layout();
		const fight = screen.result?.outcome.fight;
		if (!fight) throw new Error('charging should hand off a fight');
		expect(text('event_outcome_line_0_text')).toBe(fightText(fight));
		expect(find<AtlasButton>('event_go_button').label).toBe('Fight them');
		send(context, [key('2'), key('2', 'up')]);
		expect(screen.result?.choice).toBe('charge');
		clickOn('event_go_button');
		expect(done).toEqual([screen.result]);
	});

	it('reopens on a result a saved step holds, and with nothing hooked up Drive on goes to the menu', async () => {
		const result = resolveChoice({ event: event('armored_car'), choice: 'get_it_running', party: { ...CONVOY, archetypes: ['mechanic'], resources: { ...NO_RESOURCES, scrap: 8 } }, draw: 0 });
		await open({ event: event('armored_car'), party: CONVOY, result });
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
			const everything: EventParty = { archetypes: ['mechanic'], cards: {}, escorts: [], resources: { ...NO_RESOURCES, fuel: 1 } };
			await open({ event: shown, party: everything });
			expect(layoutLint(treeSnapshot([screen.root], size)).violations).toEqual([]);
			for (const choice of shown.choices) {
				for (let outcome = 0; outcome < choice.outcomes.length; outcome += 1) {
					const total = choice.outcomes.reduce((sum, { weight }) => sum + weight, 0);
					const before = choice.outcomes.slice(0, outcome).reduce((sum, { weight }) => sum + weight, 0);
					const party: EventParty = { archetypes: ['mechanic', 'interceptor'], cards: { emp_blast: 1 }, escorts: ['med_truck'], resources: { ...NO_RESOURCES, fuel: 9, scrap: 9 } };
					const result = resolveChoice({ event: shown, choice: choice.id, party, draw: before / total });
					screen.unmount();
					await open({ event: shown, party, result });
					expect({ choice: choice.id, outcome, violations: layoutLint(treeSnapshot([screen.root], size)).violations }).toEqual({ choice: choice.id, outcome, violations: [] });
				}
			}
		});
	});
});
