import eventsFile from '../data/events.json';
import { ReaderRangeError, freezeJson, readArray, readFields, readInteger, readNumber, readOneOf, readText } from '../core/JsonReader';
import { STOP_TYPES, StopType, isFight } from '../map/StopData';
import type { DriverArchetype } from '../mechanics/Driver';
import { ESCORT_CONFIGS, EscortType } from '../mechanics/Escort';
import type { Campaign, Resources } from './Campaign';
import { NO_RESOURCES } from './Campaign';
import { CardCounts, NO_CARDS, addCounts, cardCount } from './CardCounts';
import { readNewCards } from './DeckRules';
import { DRIVER_ARCHETYPES } from './DriverRecord';
import type { Skulls } from './Encounters';

/**
 * Events (Game Flow and UI Specification, 5; DDB-45): the stops that aren't
 * fights, each a short scene with two to four choices, kept in
 * `data/events.json` so content is written without a code change. This
 * module is pure: it reads the content, says which choices a party can take
 * and why not, and turns a choice into an `EventResult`, plain data the run
 * applies (cargo, cards, an escort, drivers, settlers, hours, damage, or a
 * fight to hand off). It never touches a campaign; the run does that.
 *
 * The reader is strict, as the stop tables' are: an unknown field, a missing
 * one, or a value out of range throws, naming its path, so a bad edit fails
 * as the module loads.
 */

/** The stop types an event can resolve: every one that isn't a fight. A checkpoint is one, though it can hand off to a fight. */
export const EVENT_STOP_TYPES: readonly StopType[] = STOP_TYPES.filter((type) => !isFight(type));

/** Resources an event can give, take, or cost, by name: the compound's stores less people, which an event gives as settlers. */
export const EVENT_RESOURCES = ['food', 'water', 'fuel', 'meds', 'scrap'] as const;
export type EventResource = (typeof EVENT_RESOURCES)[number];

const ESCORT_TYPES = Object.keys(ESCORT_CONFIGS) as readonly EscortType[];
const EVENT_ID = /^[a-z][a-z0-9_]*$/;

/** Bounds the reader holds content to. The text caps are what the event screen's journal and choice cards have room for at 1024x600. */
export const EVENT_LIMITS = {
	choices: { min: 2, max: 4 },
	outcomes: { min: 1, max: 4 },
	titleLength: 40,
	setupLength: 240,
	situationLength: 240,
	choiceTitleLength: 30,
	previewLength: 90,
	outcomeLength: 200,
	/** Most of one resource an outcome moves either way, or a choice costs. */
	resource: 30,
	settlers: 8,
	drivers: 2,
	/** Most structure or HP an outcome takes or restores, per vehicle or driver. */
	damage: 20,
	hours: 6,
	danger: 3,
} as const;

/** What a choice needs of the party. Every field given must hold; a choice with none needs nothing. */
export interface EventRequirement {
	/** A seated driver of this archetype: "(Mechanic only)". */
	readonly archetype: DriverArchetype | null;
	/** A copy of this card in a seated driver's run deck: "(Requires: EMP Blast)". */
	readonly card: string | null;
	/** An escort of this type with the run: "(Med Truck)". */
	readonly escort: EscortType | null;
}

const NO_REQUIREMENT: EventRequirement = Object.freeze({ archetype: null, card: null, escort: null });

/**
 * What an outcome gives or takes, every field present. `resources` are
 * signed, gains positive, its `people` the settlers who join; the run puts
 * gains in the cargo and takes losses from the cargo, then the stores.
 * `structure` and `hp` are signed too, applied to every seated driver's
 * vehicle and every seated driver alike.
 */
export interface EventGains {
	readonly resources: Readonly<Resources>;
	/** Cards for the locker, through the cargo as cards won are. */
	readonly cards: CardCounts;
	/** The reward picker a fight uses, offered once the event's done. */
	readonly cardPick: boolean;
	/** An escort that joins the convoy; with four already, the player dismisses one to take it (Game Flow 5). */
	readonly escort: EscortType | null;
	/** Drivers who join the pool when the run gets home, rolled by the run as a Find: driver is. */
	readonly drivers: number;
	readonly structure: number;
	readonly hp: number;
}

/** A fight an outcome hands off to, and what winning it gives. Losing it is the run's to settle, as any stop fight's is. */
export interface EventFight extends EventGains {
	readonly skulls: Skulls;
	/** What the debrief says once the fight's won. */
	readonly text: string;
}

/** What happened, and what it does: its own gains, the extra hours it took, and a fight when it turns into one. */
export interface EventOutcome extends EventGains {
	readonly text: string;
	/** Hours spent past the stop's own, in half hours. */
	readonly hours: number;
	readonly fight: EventFight | null;
}

export interface WeightedOutcome {
	/** Its chance against the choice's other outcomes. */
	readonly weight: number;
	readonly outcome: EventOutcome;
}

export interface EventChoice {
	readonly id: string;
	/** The action, short: "Charge the raiders". */
	readonly title: string;
	/** A hint at what happens, never which outcome: "They'll fight for it". */
	readonly preview: string;
	readonly requires: EventRequirement;
	/** Paid on choosing it; locked when the party holds less. */
	readonly cost: Readonly<Resources>;
	/** The skulls on its card, 0 to 3: how bad it can go. */
	readonly danger: number;
	readonly outcomes: readonly WeightedOutcome[];
}

export interface EventIllustration {
	/** The plate's art in the UI art atlas, once it's painted; a stand-in draws until then. */
	readonly art: string;
	/** The plate's mono caption: "A tanker across both lanes". */
	readonly caption: string;
}

export interface GameEvent {
	readonly id: string;
	readonly stopType: StopType;
	readonly title: string;
	readonly illustration: EventIllustration;
	/** Two or three sentences: what the crew comes on. */
	readonly setup: string;
	/** Why there's a choice to make. */
	readonly situation: string;
	readonly choices: readonly EventChoice[];
}

/** What a choice needs of the party, as the run puts it together (`eventParty`). */
export interface EventParty {
	readonly archetypes: readonly DriverArchetype[];
	/** Every card in the seated drivers' run decks, escort cards included. */
	readonly cards: CardCounts;
	readonly escorts: readonly EscortType[];
	/** What the convoy can pay a cost from. */
	readonly resources: Readonly<Resources>;
}

/** Why a choice can't be taken. The first unmet need, in the order archetype, card, escort, cost. */
export type ChoiceLock =
	| { reason: 'archetype'; archetype: DriverArchetype }
	| { reason: 'card'; cardType: string }
	| { reason: 'escort'; escort: EscortType }
	| { reason: 'cost'; resource: EventResource; needed: number; held: number };

/** A choice made, resolved: plain data the run applies, then saves with the step. */
export interface EventResult {
	readonly event: string;
	readonly choice: string;
	readonly cost: Readonly<Resources>;
	readonly outcome: EventOutcome;
}

/** What a choice's card shows before it's taken: the risk and reward icons (Game Flow 5.2), never which outcome lands. */
export interface ChoicePreview {
	/** Crossed swords: some outcome hands off to a fight. */
	readonly combat: boolean;
	readonly danger: number;
	readonly costs: readonly { readonly resource: EventResource; readonly amount: number }[];
	/** The most hours any outcome takes past the stop's own; 0 for none. */
	readonly hours: number;
	/** What some outcome can give, a fight's win included, in a fixed order. */
	readonly rewards: readonly EventReward[];
}

export const EVENT_REWARDS = [...EVENT_RESOURCES, 'settlers', 'cards', 'escort', 'drivers', 'repair', 'heal'] as const;
export type EventReward = (typeof EVENT_REWARDS)[number];

const GAIN_FIELDS = ['resources', 'settlers', 'cards', 'cardPick', 'escort', 'drivers', 'structure', 'hp'] as const;

function readResources(value: unknown, path: string, { signed }: { signed: boolean }): Readonly<Resources> {
	const fields = readFields(value, path, [], EVENT_RESOURCES);
	const resources: Resources = { ...NO_RESOURCES };
	const max = EVENT_LIMITS.resource;
	for (const resource of EVENT_RESOURCES) {
		if (fields[resource] === undefined) continue;
		const amount = readInteger(fields[resource], `${path}.${resource}`, { min: signed ? -max : 1, max });
		if (amount === 0) throw new ReaderRangeError(`${path}.${resource} must not be 0; leave it out`);
		resources[resource] = amount;
	}
	return resources;
}

function readCapped(value: unknown, path: string, cap: number): string {
	const text = readText(value, path);
	if (text.length > cap) throw new ReaderRangeError(`${path} must be at most ${cap} characters, got ${text.length}`);
	return text;
}

function readId(value: unknown, path: string): string {
	const id = readText(value, path);
	if (!EVENT_ID.test(id)) throw new ReaderRangeError(`${path} must be lower snake case, got "${id}"`);
	return id;
}

function readGains(fields: Partial<Record<(typeof GAIN_FIELDS)[number], unknown>>, path: string): EventGains {
	const resources = fields.resources === undefined ? { ...NO_RESOURCES } : { ...readResources(fields.resources, `${path}.resources`, { signed: true }) };
	if (fields.settlers !== undefined) resources.people = readInteger(fields.settlers, `${path}.settlers`, { min: 1, max: EVENT_LIMITS.settlers });
	const damage = (field: 'structure' | 'hp'): number => {
		if (fields[field] === undefined) return 0;
		const amount = readInteger(fields[field], `${path}.${field}`, { min: -EVENT_LIMITS.damage, max: EVENT_LIMITS.damage });
		if (amount === 0) throw new ReaderRangeError(`${path}.${field} must not be 0; leave it out`);
		return amount;
	};
	if (fields.cardPick !== undefined && fields.cardPick !== true) throw new ReaderRangeError(`${path}.cardPick must be true when given; leave it out otherwise`);
	return {
		resources,
		cards: fields.cards === undefined ? NO_CARDS : readNewCards(fields.cards, `${path}.cards`),
		cardPick: fields.cardPick === true,
		escort: fields.escort === undefined ? null : readOneOf(fields.escort, `${path}.escort`, ESCORT_TYPES),
		drivers: fields.drivers === undefined ? 0 : readInteger(fields.drivers, `${path}.drivers`, { min: 1, max: EVENT_LIMITS.drivers }),
		structure: damage('structure'),
		hp: damage('hp'),
	};
}

function readFight(value: unknown, path: string): EventFight {
	const fields = readFields(value, path, ['skulls', 'text'], GAIN_FIELDS);
	return {
		skulls: readInteger(fields.skulls, `${path}.skulls`, { min: 1, max: 3 }) as Skulls,
		text: readCapped(fields.text, `${path}.text`, EVENT_LIMITS.outcomeLength),
		...readGains(fields, path),
	};
}

function readOutcome(value: unknown, path: string): WeightedOutcome {
	const fields = readFields(value, path, ['text'], ['weight', 'hours', 'fight', ...GAIN_FIELDS]);
	const weight = fields.weight === undefined ? 1 : readNumber(fields.weight, `${path}.weight`);
	if (!(weight > 0)) throw new ReaderRangeError(`${path}.weight must be above 0, got ${weight}`);
	let hours = 0;
	if (fields.hours !== undefined) {
		hours = readNumber(fields.hours, `${path}.hours`);
		if (!(hours > 0 && hours <= EVENT_LIMITS.hours && Number.isInteger(hours * 2))) {
			throw new ReaderRangeError(`${path}.hours must be a whole number of half hours from 0.5 to ${EVENT_LIMITS.hours}, got ${hours}`);
		}
	}
	return {
		weight,
		outcome: {
			text: readCapped(fields.text, `${path}.text`, EVENT_LIMITS.outcomeLength),
			hours,
			fight: fields.fight === undefined ? null : readFight(fields.fight, `${path}.fight`),
			...readGains(fields, path),
		},
	};
}

function readRequirement(value: unknown, path: string): EventRequirement {
	const fields = readFields(value, path, [], ['archetype', 'card', 'escort']);
	if (fields.archetype === undefined && fields.card === undefined && fields.escort === undefined) {
		throw new ReaderRangeError(`${path} must need something: an archetype, a card, or an escort; leave it out otherwise`);
	}
	const card = fields.card === undefined ? null : Object.keys(readNewCards({ [readId(fields.card, `${path}.card`)]: 1 }, path))[0];
	return {
		archetype: fields.archetype === undefined ? null : readOneOf(fields.archetype, `${path}.archetype`, DRIVER_ARCHETYPES),
		card,
		escort: fields.escort === undefined ? null : readOneOf(fields.escort, `${path}.escort`, ESCORT_TYPES),
	};
}

function readChoice(value: unknown, path: string): EventChoice {
	const fields = readFields(value, path, ['id', 'title', 'preview', 'danger', 'outcomes'], ['requires', 'cost']);
	const outcomes = readArray(fields.outcomes, `${path}.outcomes`);
	const { min, max } = EVENT_LIMITS.outcomes;
	if (outcomes.length < min || outcomes.length > max) throw new ReaderRangeError(`${path}.outcomes must hold ${min} to ${max} outcomes, got ${outcomes.length}`);
	return {
		id: readId(fields.id, `${path}.id`),
		title: readCapped(fields.title, `${path}.title`, EVENT_LIMITS.choiceTitleLength),
		preview: readCapped(fields.preview, `${path}.preview`, EVENT_LIMITS.previewLength),
		requires: fields.requires === undefined ? NO_REQUIREMENT : readRequirement(fields.requires, `${path}.requires`),
		cost: fields.cost === undefined ? NO_RESOURCES : readResources(fields.cost, `${path}.cost`, { signed: false }),
		danger: readInteger(fields.danger, `${path}.danger`, { min: 0, max: EVENT_LIMITS.danger }),
		outcomes: Array.from(outcomes, (outcome, index) => readOutcome(outcome, `${path}.outcomes[${index}]`)),
	};
}

/** Whether a choice needs nothing and costs nothing, so any party can take it. */
export function isFreeChoice(choice: EventChoice): boolean {
	const { archetype, card, escort } = choice.requires;
	return archetype === null && card === null && escort === null && EVENT_RESOURCES.every((resource) => choice.cost[resource] === 0);
}

export function readEvent(value: unknown, path: string): GameEvent {
	const fields = readFields(value, path, ['id', 'stopType', 'title', 'illustration', 'setup', 'situation', 'choices']);
	const illustration = readFields(fields.illustration, `${path}.illustration`, ['art', 'caption']);
	const choiceValues = readArray(fields.choices, `${path}.choices`);
	const { min, max } = EVENT_LIMITS.choices;
	if (choiceValues.length < min || choiceValues.length > max) throw new ReaderRangeError(`${path}.choices must hold ${min} to ${max} choices, got ${choiceValues.length}`);
	const choices = Array.from(choiceValues, (choice, index) => readChoice(choice, `${path}.choices[${index}]`));
	const seen = new Set<string>();
	choices.forEach(({ id }, index) => {
		if (seen.has(id)) throw new ReaderRangeError(`${path}.choices[${index}].id "${id}" is used twice in the event`);
		seen.add(id);
	});
	// A party that meets nothing and holds nothing still has a way on.
	if (!choices.some(isFreeChoice)) throw new ReaderRangeError(`${path}.choices must hold a choice that needs nothing and costs nothing, so no party is stuck`);
	return {
		id: readId(fields.id, `${path}.id`),
		stopType: readOneOf(fields.stopType, `${path}.stopType`, EVENT_STOP_TYPES),
		title: readCapped(fields.title, `${path}.title`, EVENT_LIMITS.titleLength),
		illustration: {
			art: readId(illustration.art, `${path}.illustration.art`),
			caption: readCapped(illustration.caption, `${path}.illustration.caption`, EVENT_LIMITS.titleLength * 2),
		},
		setup: readCapped(fields.setup, `${path}.setup`, EVENT_LIMITS.setupLength),
		situation: readCapped(fields.situation, `${path}.situation`, EVENT_LIMITS.situationLength),
		choices,
	};
}

/** The events file whole: every event, ids unique across it. */
export function readEvents(value: unknown, path: string): readonly GameEvent[] {
	const fields = readFields(value, path, ['events']);
	const events = Array.from(readArray(fields.events, `${path}.events`), (event, index) => readEvent(event, `${path}.events[${index}]`));
	const seen = new Set<string>();
	events.forEach(({ id }, index) => {
		if (seen.has(id)) throw new ReaderRangeError(`${path}.events[${index}].id "${id}" is used twice`);
		seen.add(id);
	});
	return freezeJson(events, path) as unknown as readonly GameEvent[];
}

/** The shipped content, read as this module loads, so a bad edit to the file fails straight away. */
export const EVENTS: readonly GameEvent[] = readEvents(eventsFile, 'events.json');

export function eventById(id: string, events: readonly GameEvent[] = EVENTS): GameEvent | null {
	return events.find((event) => event.id === id) ?? null;
}

/** The events a stop of this type can open, in file order. */
export function eventsFor(stopType: StopType, events: readonly GameEvent[] = EVENTS): readonly GameEvent[] {
	return events.filter((event) => event.stopType === stopType);
}

/** One of a stop type's events, evenly, for a draw in [0, 1) from the run's stream; null for a type with none. */
export function pickEvent({ stopType, draw, events = EVENTS }: { stopType: StopType; draw: number; events?: readonly GameEvent[] }): GameEvent | null {
	const offered = eventsFor(stopType, events);
	if (offered.length === 0) return null;
	return offered[Math.min(offered.length - 1, Math.floor(draw * offered.length))];
}

/**
 * The party an event checks on the road: the seated drivers' archetypes and
 * run decks, the escorts with the run, and, to pay from, the stores and the
 * cargo together. Null at home, with no run out.
 */
export function eventParty({ campaign }: { campaign: Campaign }): EventParty | null {
	const run = campaign.supplyRun;
	if (!run) return null;
	let cards = NO_CARDS;
	for (const deck of campaign.runDecks) {
		cards = addCounts(cards, deck.cards);
		for (const { cardType } of deck.escortCards) cards = addCounts(cards, { [cardType]: 1 });
	}
	const resources = { ...campaign.resources };
	for (const resource of EVENT_RESOURCES) resources[resource] += run.cargo[resource];
	return {
		archetypes: campaign.runDecks.map(({ driver }) => driver.archetype),
		cards,
		escorts: run.escorts.flatMap(({ escort }) => (escort?.type ? [escort.type] : [])),
		resources,
	};
}

/** Why the party can't take a choice, or null when it can. */
export function choiceLock({ choice, party }: { choice: EventChoice; party: EventParty }): ChoiceLock | null {
	const { archetype, card, escort } = choice.requires;
	if (archetype !== null && !party.archetypes.includes(archetype)) return { reason: 'archetype', archetype };
	if (card !== null && cardCount(party.cards, card) === 0) return { reason: 'card', cardType: card };
	if (escort !== null && !party.escorts.includes(escort)) return { reason: 'escort', escort };
	for (const resource of EVENT_RESOURCES) {
		const needed = choice.cost[resource];
		if (needed > party.resources[resource]) return { reason: 'cost', resource, needed, held: party.resources[resource] };
	}
	return null;
}

/** A choice the party can't take, as `resolveChoice` refuses it. */
export class ChoiceLockedError extends RangeError {
	public readonly lock: ChoiceLock;

	constructor({ message, lock }: { message: string; lock: ChoiceLock }) {
		super(message);
		this.name = 'ChoiceLockedError';
		this.lock = lock;
	}
}

/**
 * The choice taken: its cost, and the outcome a draw in [0, 1) from the
 * run's stream lands on, by weight. Throws on a choice the event doesn't
 * have, or one the party can't take.
 */
export function resolveChoice({ event, choice, party, draw }: { event: GameEvent; choice: string; party: EventParty; draw: number }): EventResult {
	const taken = event.choices.find(({ id }) => id === choice);
	if (!taken) throw new RangeError(`event ${event.id} has no choice "${choice}"`);
	const lock = choiceLock({ choice: taken, party });
	if (lock) throw new ChoiceLockedError({ message: `event ${event.id}: the party can't take "${choice}" (${lock.reason})`, lock });
	if (!(draw >= 0 && draw < 1)) throw new RangeError(`resolveChoice: draw must be in [0, 1), got ${draw}`);
	const total = taken.outcomes.reduce((sum, { weight }) => sum + weight, 0);
	let target = draw * total;
	let landed = taken.outcomes[taken.outcomes.length - 1].outcome;
	for (const { weight, outcome } of taken.outcomes) {
		if (target < weight) {
			landed = outcome;
			break;
		}
		target -= weight;
	}
	return { event: event.id, choice: taken.id, cost: taken.cost, outcome: landed };
}

function rewardsOf(gains: EventGains, into: Set<EventReward>): void {
	for (const resource of EVENT_RESOURCES) if (gains.resources[resource] > 0) into.add(resource);
	if (gains.resources.people > 0) into.add('settlers');
	if (gains.cardPick || Object.keys(gains.cards).length > 0) into.add('cards');
	if (gains.escort !== null) into.add('escort');
	if (gains.drivers > 0) into.add('drivers');
	if (gains.structure > 0) into.add('repair');
	if (gains.hp > 0) into.add('heal');
}

export function choicePreview(choice: EventChoice): ChoicePreview {
	const rewards = new Set<EventReward>();
	let hours = 0;
	let combat = false;
	for (const { outcome } of choice.outcomes) {
		rewardsOf(outcome, rewards);
		if (outcome.fight) {
			combat = true;
			rewardsOf(outcome.fight, rewards);
		}
		hours = Math.max(hours, outcome.hours);
	}
	return {
		combat,
		danger: choice.danger,
		costs: EVENT_RESOURCES.filter((resource) => choice.cost[resource] > 0).map((resource) => ({ resource, amount: choice.cost[resource] })),
		hours,
		rewards: EVENT_REWARDS.filter((reward) => rewards.has(reward)),
	};
}
