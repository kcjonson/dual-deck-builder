import eventsFile from '../data/events.json';
import { ReaderRangeError, ReaderTypeError } from '../core/JsonReader';
import { Campaign, NO_RESOURCES } from './Campaign';
import { addCounts } from './CardCounts';
import { cardName } from './DeckRules';
import {
	ChoiceLockedError,
	EVENTS,
	EVENT_LIMITS,
	EVENT_STOP_TYPES,
	EventChoice,
	EventParty,
	GameEvent,
	choiceLock,
	choicePreview,
	eventById,
	eventParty,
	eventsFor,
	isFreeChoice,
	pickEvent,
	readEvents,
	resolveChoice,
} from './Events';
import { CAMPAIGN_FIXTURE, atHomeCampaign } from './__fixtures__/storeFixtures';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A party that meets nothing and holds nothing. */
const BARE: EventParty = { archetypes: ['road_warrior'], cards: {}, escorts: [], resources: NO_RESOURCES };
/** A party that meets every requirement the content has and can pay any cost. */
const EVERYTHING: EventParty = {
	archetypes: ['road_warrior', 'interceptor', 'mechanic', 'raider'],
	cards: { emp_blast: 1 },
	escorts: ['outrider', 'pilot_car', 'fuel_hauler', 'med_truck'],
	resources: { food: 99, water: 99, fuel: 99, meds: 99, scrap: 99, people: 99 },
};

function event(id: string): GameEvent {
	const found = eventById(id);
	if (!found) throw new Error(`no event ${id}`);
	return found;
}

function choiceOf(eventId: string, id: string): EventChoice {
	const found = event(eventId).choices.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`no choice ${id} in ${eventId}`);
	return found;
}

/** Throws on null, so a test reads on without an assertion operator. */
function present<T>(value: T | null | undefined): T {
	if (value === null || value === undefined) throw new Error('expected a value');
	return value;
}

/** The file loosely typed, so a test can break it. */
interface LooseChoice {
	id: string;
	outcomes: Record<string, unknown>[];
	[field: string]: unknown;
}
interface LooseFile {
	events: { id: string; choices: LooseChoice[]; [field: string]: unknown }[];
}

/** The file with one change, read whole. */
function readChanged(change: (file: LooseFile) => void): () => void {
	const file = copy(eventsFile) as unknown as LooseFile;
	change(file);
	return () => readEvents(file, 'events');
}

describe('events.json, the schema over the content (DDB-45)', () => {
	it('reads whole: ids unique, every event a non-fight stop type, 2 to 4 choices, each with outcomes', () => {
		expect(EVENTS.length).toBe(eventsFile.events.length);
		expect(new Set(EVENTS.map(({ id }) => id)).size).toBe(EVENTS.length);
		for (const { stopType, choices } of EVENTS) {
			expect(EVENT_STOP_TYPES).toContain(stopType);
			expect(choices.length).toBeGreaterThanOrEqual(EVENT_LIMITS.choices.min);
			expect(choices.length).toBeLessThanOrEqual(EVENT_LIMITS.choices.max);
			for (const choice of choices) expect(choice.outcomes.length).toBeGreaterThan(0);
		}
	});

	it('holds the first content set: at least two wrecks and two distress signals', () => {
		expect(eventsFor('wreck').length).toBeGreaterThanOrEqual(2);
		expect(eventsFor('distress').length).toBeGreaterThanOrEqual(2);
	});

	it('gives every event a choice any party can take, and resolves every free choice for a bare party', () => {
		for (const shipped of EVENTS) {
			const free = shipped.choices.filter(isFreeChoice);
			expect(free.length).toBeGreaterThan(0);
			for (const choice of free) expect(choiceLock({ choice, party: BARE })).toBeNull();
		}
	});

	it('resolves every choice for a party that meets everything, at every outcome, to plain JSON', () => {
		for (const shipped of EVENTS) {
			for (const choice of shipped.choices) {
				expect(choiceLock({ choice, party: EVERYTHING })).toBeNull();
				const total = choice.outcomes.reduce((sum, { weight }) => sum + weight, 0);
				let before = 0;
				for (const { weight, outcome } of choice.outcomes) {
					const result = resolveChoice({ event: shipped, choice: choice.id, party: EVERYTHING, draw: before / total });
					expect(result.outcome).toEqual(outcome);
					expect(JSON.parse(JSON.stringify(result))).toEqual(result);
					before += weight;
				}
			}
		}
	});

	it('names only cards cards.json has, and never an escort signature card', () => {
		for (const shipped of EVENTS) {
			for (const choice of shipped.choices) {
				if (choice.requires.card) expect(cardName(choice.requires.card)).not.toBe(choice.requires.card);
				for (const { outcome } of choice.outcomes) {
					const won = addCounts(outcome.cards, outcome.fight?.cards ?? {});
					for (const cardType of Object.keys(won)) expect(cardName(cardType)).not.toBe(cardType);
				}
			}
		}
		expect(readChanged((file) => {
			file.events[1].choices[0].outcomes[0].cards = { triage: 1 };
		})).toThrow(/signature card of the med_truck escort/);
		expect(readChanged((file) => {
			file.events[3].choices[1].requires = { card: 'emp_blasts' };
		})).toThrow(/isn't a card in cards.json/);
	});

	it('refuses an unknown field, a missing one, or a value out of range, naming its path', () => {
		expect(readChanged((file) => {
			file.events[0].mood = 'grim';
		})).toThrow(new ReaderTypeError('events.events[0] has an unknown field "mood"'));
		expect(readChanged((file) => {
			delete file.events[0].setup;
		})).toThrow(new ReaderTypeError('events.events[0].setup is missing'));
		expect(readChanged((file) => {
			file.events[0].stopType = 'ambush';
		})).toThrow(ReaderRangeError);
		expect(readChanged((file) => {
			file.events[0].choices[0].danger = 4;
		})).toThrow(/events.events\[0\].choices\[0\].danger/);
		expect(readChanged((file) => {
			file.events[0].choices[0].outcomes[0].hours = 0.75;
		})).toThrow(/whole number of half hours/);
		expect(readChanged((file) => {
			file.events[0].choices[0].outcomes[0].resources = { fuel: 0 };
		})).toThrow(/must not be 0/);
		expect(readChanged((file) => {
			file.events[0].choices[0].title = 'A title far too long to fit on a choice card';
		})).toThrow(/at most 30 characters/);
		expect(readChanged((file) => {
			file.events[1].id = file.events[0].id;
		})).toThrow(/used twice/);
		expect(readChanged((file) => {
			file.events[0].choices[1].id = file.events[0].choices[0].id;
		})).toThrow(/used twice in the event/);
	});

	it('refuses an event with no free choice, so no party is ever stuck at a stop', () => {
		expect(readChanged((file) => {
			file.events[2].choices = file.events[2].choices.filter(({ id }) => id !== 'drive_on' && id !== 'pry_doors');
			file.events[2].choices.push({ ...copy(file.events[2].choices[0]), id: 'twin' });
		})).toThrow(/needs nothing and costs nothing/);
	});
});

describe('choiceLock', () => {
	const choice = (id: string) => choiceOf('family_under_fire', id);

	it('says what the party lacks: the archetype, the card, the escort, or enough to pay', () => {
		expect(choiceLock({ choice: event('jackknifed_tanker').choices[1], party: BARE })).toEqual({ reason: 'archetype', archetype: 'mechanic' });
		expect(choiceLock({ choice: choice('kill_engines'), party: BARE })).toEqual({ reason: 'card', cardType: 'emp_blast' });
		expect(choiceLock({ choice: event('mayday_channel_nine').choices[1], party: BARE })).toEqual({ reason: 'escort', escort: 'med_truck' });
		expect(choiceLock({ choice: choice('pay_them_off'), party: { ...BARE, resources: { ...NO_RESOURCES, fuel: 2 } } }))
			.toEqual({ reason: 'cost', resource: 'fuel', needed: 3, held: 2 });
		expect(choiceLock({ choice: choice('pay_them_off'), party: { ...BARE, resources: { ...NO_RESOURCES, fuel: 3 } } })).toBeNull();
	});

	it('checks a need before a cost', () => {
		const armored = choiceOf('armored_car', 'get_it_running');
		expect(choiceLock({ choice: armored, party: BARE })).toEqual({ reason: 'archetype', archetype: 'mechanic' });
		expect(choiceLock({ choice: armored, party: { ...BARE, archetypes: ['mechanic'] } })).toEqual({ reason: 'cost', resource: 'scrap', needed: 8, held: 0 });
	});
});

describe('resolveChoice', () => {
	const tanker = event('jackknifed_tanker');

	it('lands on an outcome by weight, and carries the cost', () => {
		// strip_cab: 3 to 1.
		const strip = (draw: number) => resolveChoice({ event: tanker, choice: 'strip_cab', party: BARE, draw }).outcome;
		expect(strip(0).structure).toBe(0);
		expect(strip(0.749).structure).toBe(0);
		expect(strip(0.75).structure).toBe(-3);
		expect(strip(0.9999).hp).toBe(-2);
		const paid = resolveChoice({ event: event('family_under_fire'), choice: 'pay_them_off', party: EVERYTHING, draw: 0 });
		expect(paid).toMatchObject({ event: 'family_under_fire', choice: 'pay_them_off', cost: { fuel: 3 } });
		expect(paid.outcome.resources.people).toBe(3);
	});

	it('hands off a fight with what winning it gives', () => {
		const charged = resolveChoice({ event: event('family_under_fire'), choice: 'charge', party: BARE, draw: 0.5 }).outcome;
		expect(charged.fight).toMatchObject({ skulls: 2, resources: { food: 2, people: 3 } });
	});

	it('refuses a locked choice, one the event lacks, or a draw out of range', () => {
		expect(() => resolveChoice({ event: tanker, choice: 'crack_valve', party: BARE, draw: 0 })).toThrow(ChoiceLockedError);
		expect(() => resolveChoice({ event: tanker, choice: 'fly_over', party: BARE, draw: 0 })).toThrow(/no choice "fly_over"/);
		expect(() => resolveChoice({ event: tanker, choice: 'siphon', party: BARE, draw: 1 })).toThrow(/draw/);
	});
});

describe('choicePreview', () => {
	it('shows swords for a fight anywhere in the outcomes, the danger, costs, the most hours, and every reward', () => {
		const search = event('burned_bus').choices[0];
		expect(choicePreview(search)).toEqual({ combat: true, danger: 1, costs: [], hours: 0.5, rewards: ['scrap', 'cards'] });
		const pay = choiceOf('family_under_fire', 'pay_them_off');
		expect(choicePreview(pay)).toEqual({ combat: false, danger: 1, costs: [{ resource: 'fuel', amount: 3 }], hours: 0.5, rewards: ['settlers'] });
		const treat = event('mayday_channel_nine').choices[1];
		expect(choicePreview(treat).rewards).toEqual(['drivers', 'heal']);
		// A loss is a risk the skulls carry, never a reward.
		expect(choicePreview(event('jackknifed_tanker').choices[2]).rewards).toEqual(['scrap']);
	});
});

describe('pickEvent and eventParty', () => {
	it('picks evenly among a stop type\'s events, and none for a type with none', () => {
		const wrecks = eventsFor('wreck');
		expect(pickEvent({ stopType: 'wreck', draw: 0 })).toBe(wrecks[0]);
		expect(pickEvent({ stopType: 'wreck', draw: 0.9999 })).toBe(wrecks[wrecks.length - 1]);
		expect(pickEvent({ stopType: 'garage', draw: 0.5 })).toBeNull();
	});

	it('puts the party together from the run out: seats, run decks with escort cards, escorts, and stores plus cargo', () => {
		const campaign = Campaign.fromJSON(copy(CAMPAIGN_FIXTURE), { onWarning: () => undefined });
		const run = present(campaign.supplyRun);
		const party = present(eventParty({ campaign }));
		expect(party.archetypes).toEqual(campaign.runDecks.map(({ driver }) => driver.archetype));
		for (const deck of campaign.runDecks) {
			for (const [cardType, count] of Object.entries(deck.cards)) expect(party.cards[cardType]).toBeGreaterThanOrEqual(count);
			for (const { cardType } of deck.escortCards) expect(party.cards[cardType]).toBeGreaterThan(0);
		}
		expect(party.escorts).toEqual(run.escorts.map(({ escort }) => escort?.type));
		expect(party.resources.fuel).toBe(campaign.resources.fuel + run.cargo.fuel);
		expect(eventParty({ campaign: atHomeCampaign((home) => home.set({ supplyRun: null })) })).toBeNull();
	});
});
