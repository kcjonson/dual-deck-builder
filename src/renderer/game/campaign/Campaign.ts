import type { JsonObject } from '../core/Json';
import { Model } from '../core/Model';
import { MapParams } from '../map/MapParams';
import { Convoy } from '../mechanics/Convoy';
import { DriverArchetype } from '../mechanics/Driver';
import { CardCounts, NO_CARDS, addCards, cardCount, readCardCounts, readCardType, removeCards } from './CardCounts';
import { EscortJson, convoyToJson, readConvoy } from './ConvoyJson';
import { DECK_RULES, DeckBlocker, deckAddBlocker, deckRemoveBlocker } from './DeckRules';
import { DRIVER_ARCHETYPES, DriverRecord, DriverRecordJson, placeholderName, readDriverRecord } from './DriverRecord';
import { ReaderRangeError, ReaderTypeError, describeValue, readArray, readFields, readInteger, readOneOf, readSeed, readText } from './JsonReader';
import { readMapParams, repairMapParams } from './MapParamsJson';
import { EMPTY_MAP, MapState, readMapState } from './MapState';

/**
 * The save format's version, which `CampaignStore` stamps on every save and
 * history list. Bump it by hand whenever the text `toSaveText` writes, or a
 * history entry, changes shape. There are no migrations: a save stamped
 * with another version isn't loaded, so a bump invalidates every existing
 * save of that build.
 */
export const CAMPAIGN_SCHEMA_VERSION = 1;

/** What the compound holds (Compound and Supply Runs, Resources): whole numbers, never below 0. */
export interface Resources {
	food: number;
	water: number;
	fuel: number;
	meds: number;
	scrap: number;
	people: number;
}

export const NO_RESOURCES: Readonly<Resources> = Object.freeze({ food: 0, water: 0, fuel: 0, meds: 0, scrap: 0, people: 0 });

/** A line of the campaign's history, dated with the day it happened. */
export interface CampaignLogEntry {
	day: number;
	message: string;
}

/** Where a card copy sits between runs: the compound's locker or a driver's default deck. */
export type CardPlace = 'locker' | DriverRecord;

/** Copies of a card going from one place to another. */
export interface CardMove {
	cardType: string;
	from: CardPlace;
	to: CardPlace;
	/** 1 when left out. */
	count?: number;
}

/**
 * Why the rules refuse a card move or a scrap, which the Crew screen shows
 * on the action it disables. `place` is the end that refuses: a driver
 * who's away (dead or missing, their status says which), a place holding
 * too few copies, or a deck whose rules say no (`DeckBlocker`).
 */
export type CardBlocker =
	| { reason: 'driver_away'; place: DriverRecord }
	| { reason: 'too_few'; place: CardPlace; held: number }
	| (DeckBlocker & { place: DriverRecord });

/** A card move or scrap the rules refuse, carrying the blocker its check gives. */
export class CardRuleError extends RangeError {
	public readonly blocker: CardBlocker;

	constructor({ message, blocker }: { message: string; blocker: CardBlocker }) {
		super(message);
		this.name = 'CardRuleError';
		this.blocker = blocker;
	}
}

export interface CampaignData {
	/** uint32. The map's seed, and the root every campaign stream forks from. */
	seed: number;
	/** The area map generator that made the map, which a save keeps rather than regenerating. */
	generatorVersion: number;
	/** The parameters the map was made with, as resolved and validated at founding. */
	mapParams: Readonly<MapParams>;
	/** The gameplay map and what's changed on it since. */
	map: MapState;
	/** Founding day is day 1. */
	day: number;
	resources: Readonly<Resources>;
	unrest: number;
	/** Every driver the compound has had, in the order they joined, the dead and missing included. */
	drivers: readonly DriverRecord[];
	/** The number in the next driver's id, `driver-<n>`. Saved, so no id is handed out twice. */
	nextDriverNumber: number;
	/** The compound's spare cards. */
	locker: CardCounts;
	convoy: Convoy;
	/** Ids of the strongholds taken, in the order they fell. */
	strongholdsTaken: readonly string[];
	log: readonly Readonly<CampaignLogEntry>[];
}

/** The seed, generator version, and map params it's founded on; anything else left out is a new campaign's. */
export type CampaignOptions = Pick<CampaignData, 'seed' | 'generatorVersion' | 'mapParams'> & Partial<CampaignData>;

/** A campaign as a save holds it: plain JSON, which `Campaign.fromJSON` reads back. */
export interface CampaignJson {
	seed: number;
	generatorVersion: number;
	day: number;
	resources: Resources;
	unrest: number;
	nextDriverNumber: number;
	drivers: DriverRecordJson[];
	locker: Record<string, number>;
	convoy: EscortJson[];
	strongholdsTaken: string[];
	log: CampaignLogEntry[];
	mapParams: MapParams;
	map: JsonObject;
}

export interface LoadOptions {
	/**
	 * Hears each repair a save's map params needed, after the save has
	 * loaded; a save that fails to load reports none. Logs them by default.
	 */
	onWarning?: (warning: string) => void;
}

const FIELDS: readonly (keyof CampaignData)[] = [
	'seed',
	'generatorVersion',
	'mapParams',
	'map',
	'day',
	'resources',
	'unrest',
	'drivers',
	'nextDriverNumber',
	'locker',
	'convoy',
	'strongholdsTaken',
	'log'
];

const JSON_FIELDS: readonly (keyof CampaignJson)[] = [
	'seed',
	'generatorVersion',
	'day',
	'resources',
	'unrest',
	'nextDriverNumber',
	'drivers',
	'locker',
	'convoy',
	'strongholdsTaken',
	'log',
	'mapParams',
	'map'
];

const RESOURCE_NAMES: readonly (keyof Resources)[] = ['food', 'water', 'fuel', 'meds', 'scrap', 'people'];

/** What the map was made from, set at founding. */
const FIXED_FIELDS = ['seed', 'generatorVersion', 'mapParams'] as const;

const DRIVER_ID = /^driver-([1-9][0-9]*)$/;

/** Campaigns partway through storing a card move. Campaign instances are frozen, so this can't be a field. */
const storingMoves = new WeakSet<object>();
/** Resources and stronghold lists the readers made: checked and frozen, so they can't have changed since. */
const checkedResources = new WeakSet<object>();
const checkedStrongholds = new WeakSet<object>();

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Campaign extends Readonly<CampaignData> {}

/**
 * One campaign, from founding the compound to its fall (Compound and Supply
 * Runs): the seed and map it was founded on, the day, the compound's stores
 * and unrest, the driver pool, the locker, the convoy, the strongholds
 * taken, and a log of what happened.
 *
 * Properties are read-only. A change goes through `set`, which checks the
 * whole campaign and throws, changing nothing, if the result would be
 * invalid, so whatever `toJSON` writes, `fromJSON` reads back. The seed,
 * generator version, and map params never change after founding, the
 * driver counter never goes back, and the pool only grows.
 *
 * The campaign's `change` event covers its own fields and finished card
 * moves. Records, escorts, and the convoy emit on their own models and not
 * here: a record's HP on the record, an escort's damage on its own Vehicle,
 * escorts joining or leaving on the convoy. So save at checkpoints, with
 * `CampaignStore.checkpoint` at the end of each step (a stop, arriving home,
 * a compound action), not on change events. A record changes partway
 * through a card move, before the locker is stored; a save asked for from a
 * listener captures the campaign before the next frame, once the code that
 * asked has run, so it's whole only when the step that set it off is
 * synchronous.
 *
 * Nothing here draws randomness, and the seed comes from whoever founds the
 * campaign. Anything that needs a random draw later forks a fresh stream for
 * that one event from the seed and a saved counter, as in
 * `new Rng({ seed }).fork('recruit', n)`; a stream carried across a save
 * would replay from its start after loading.
 */
export class Campaign extends Model<CampaignData> {
	static properties = new Set<keyof CampaignData>(FIELDS);

	constructor({
		seed,
		generatorVersion,
		mapParams,
		map = EMPTY_MAP,
		day = 1,
		resources = NO_RESOURCES,
		unrest = 0,
		drivers = [],
		nextDriverNumber,
		locker = NO_CARDS,
		convoy = new Convoy(),
		strongholdsTaken = [],
		log = []
	}: CampaignOptions) {
		super({
			seed,
			generatorVersion,
			mapParams,
			map,
			day,
			resources,
			unrest,
			drivers,
			nextDriverNumber: nextDriverNumber ?? firstFreeDriverNumber(drivers),
			locker,
			convoy,
			strongholdsTaken,
			log
		});
	}

	/**
	 * Reads a save's campaign, which `CampaignStore` has already matched to
	 * this build's save format version. Throws a reader error on anything
	 * malformed, naming where: a damaged save never loads as a different
	 * campaign. Map params are the exception, since the table is still
	 * settling: drift is repaired (`repairMapParams`), and once the save has
	 * loaded, each repair goes to `onWarning`.
	 */
	public static fromJSON(json: unknown, { onWarning = logWarning }: LoadOptions = {}): Campaign {
		const path = 'Campaign';
		const save = readFields(json, path, JSON_FIELDS);
		const mapParams = repairMapParams(save.mapParams, `${path}.mapParams`);
		const campaign = new Campaign(readCampaignData({
			seed: save.seed,
			generatorVersion: save.generatorVersion,
			mapParams: mapParams.params,
			map: save.map,
			day: save.day,
			resources: save.resources,
			unrest: save.unrest,
			drivers: readArray(save.drivers, `${path}.drivers`).map((driver, index) => readDriverRecord(driver, `${path}.drivers[${index}]`)),
			nextDriverNumber: save.nextDriverNumber,
			locker: save.locker,
			convoy: readConvoy(save.convoy, `${path}.convoy`),
			strongholdsTaken: save.strongholdsTaken,
			log: save.log
		}, path));
		mapParams.warnings.forEach(warning => onWarning(warning));
		return campaign;
	}

	/**
	 * Changes fields together, checked as a whole. Throws without changing
	 * anything if the campaign would be invalid, a field is unknown, the
	 * seed, generator version, or map params would change, the driver counter
	 * would go back (handing out an id again), a driver would leave the pool
	 * or change places in it, or a driver would join it with an id the counter
	 * had already passed. Nothing changes while a card move is being stored,
	 * so campaign listeners never hear half of one.
	 */
	public override set(changes: Partial<CampaignData>): void {
		if (storingMoves.has(this)) throw new Error("Campaign can't change while a card move is being stored");
		const current = this.getState();
		for (const field of FIXED_FIELDS) {
			if (current[field] !== undefined && field in changes && changes[field] !== current[field]) {
				throw new RangeError(`Campaign.${field} is fixed at founding`);
			}
		}
		const counter = { from: current.nextDriverNumber, to: changes.nextDriverNumber };
		if (counter.from !== undefined && counter.to !== undefined && counter.to < counter.from) {
			throw new RangeError(`Campaign.nextDriverNumber can't go back, from ${counter.from} to ${counter.to}`);
		}
		const valid = readCampaignData({ ...current, ...changes }, 'Campaign', current);
		super.set(Object.fromEntries(Object.keys(changes).map(key => [key, valid[key as keyof CampaignData]])));
	}

	/**
	 * A driver joins the pool: the next id, their archetype's starting HP,
	 * hand limit, and deck, and a name numbered after every driver of that
	 * archetype the compound has had. Founding (DDB-284) and Find: driver
	 * stops call this.
	 */
	public recruitDriver({ archetype }: { archetype: DriverArchetype }): DriverRecord {
		readOneOf(archetype, 'archetype', DRIVER_ARCHETYPES);
		const ordinal = this.drivers.filter(driver => driver.archetype === archetype).length + 1;
		const driver = new DriverRecord({
			id: `driver-${this.nextDriverNumber}`,
			archetype,
			name: placeholderName({ archetype, ordinal })
		});
		this.set({ drivers: [...this.drivers, driver], nextDriverNumber: this.nextDriverNumber + 1 });
		return driver;
	}

	/**
	 * Every copy the compound owns, by card type: the locker's and every
	 * default deck's. Each copy is in exactly one of those places, so moves
	 * never change this and scrapping takes from it. Run decks (DDB-315) are
	 * places too, and join this sum when they land. A record's listener can
	 * see half a move (a copy in two places, or none), so read this, as the
	 * Crew screen should, on the campaign's `change`, not a record's.
	 */
	public get cardsOwned(): CardCounts {
		const owned: Record<string, number> = { ...this.locker };
		for (const driver of this.drivers) {
			for (const [cardType, count] of Object.entries(driver.defaultDeck)) owned[cardType] = cardCount(owned, cardType) + count;
		}
		return readCardCounts(owned, 'cardsOwned');
	}

	/**
	 * Why the rules refuse this move, or null if `moveCards` would make it,
	 * checked in this order: a driver at either end is away (dead, gone with
	 * their cards, or missing, not here to hand cards to or take them from),
	 * `from` holds fewer than `count`, the card is marked for another
	 * archetype than `to`'s driver, `to`'s deck would go past the most it
	 * holds, or `from`'s under the fewest (`DECK_RULES`). Throws, as
	 * `moveCards` does, on a move no rule covers: a malformed card type or
	 * count, a place to itself, or a driver outside this campaign's pool.
	 * A record's listener can see half a move, so the Crew screen asks again
	 * on the campaign's `change`, not a record's.
	 */
	public getCardMoveBlocker(move: CardMove): CardBlocker | null {
		return this.checkMove(move).blocker;
	}

	/**
	 * Moves copies of a card between the locker and the default decks of
	 * drivers at the compound, all in this campaign: the Crew screen's add
	 * and remove, and a move between two decks. A move never makes or loses
	 * a copy, so each copy stays in exactly one place. Throws a
	 * `CardRuleError`, moving nothing, when `getCardMoveBlocker` refuses it.
	 *
	 * Campaign listeners hear a move once it's whole: decks are stored before
	 * the locker, and a move between two drivers ends with a campaign
	 * `change`. While a move is being stored, the campaign refuses another
	 * move and every `set`. Records aren't held, so a listener on `from` can
	 * still change `to` before the copies land: they go on the deck `to` holds
	 * then, or back on `from` if `to` has left the compound or the rules no
	 * longer let its deck take them, or into the locker if `from` can't take
	 * them either. A listener's own `set` of a deck still steps outside the
	 * rules, as any `set` of a deck does.
	 */
	public moveCards(move: CardMove): void {
		if (storingMoves.has(this)) throw new Error("Can't move cards while another move is being stored");
		const { cardType, from, to, count = 1 } = move;
		const { blocker, source, target } = this.checkMove(move);
		if (blocker !== null) throw new CardRuleError({ message: blockerMessage({ blocker, verb: 'move', cardType, count }), blocker });
		const taken = removeCards(source, cardType, count);
		// These throw, storing nothing, when the far end, or the locker the copies fall back to, can't hold that many more.
		const given = addCards(target, cardType, count);
		if (from !== 'locker' && to !== 'locker') addCards(this.locker, cardType, count);
		storingMoves.add(this);
		let landing: CardPlace = to;
		try {
			if (from !== 'locker') {
				from.set({ defaultDeck: taken });
				// Listeners on `from` have just run, and may have sent `to` away or changed its deck.
				if (to !== 'locker') landing = landCopies({ decks: [to, from], cardType, count });
			} else if (to !== 'locker') {
				to.set({ defaultDeck: given });
			}
		} finally {
			storingMoves.delete(this);
		}
		if (from === 'locker') this.set({ locker: taken });
		else if (landing === 'locker') this.set({ locker: addCards(this.locker, cardType, count) });
		else this.emit('change', this.getState());
	}

	/**
	 * Why the rules refuse to scrap `count` copies of a card from the locker,
	 * or null if `scrapCards` would: the locker holds fewer. Throws on a
	 * malformed card type or count.
	 */
	public getScrapBlocker({ cardType, count = 1 }: { cardType: string; count?: number }): CardBlocker | null {
		readCardType(cardType, 'cardType');
		readInteger(count, 'count', { min: 1 });
		const held = cardCount(this.locker, cardType);
		return held < count ? { reason: 'too_few', place: 'locker', held } : null;
	}

	/**
	 * Scraps copies of a card from the locker for `DECK_RULES.scrapPerCard`
	 * scrap each, in one `set`, and returns the scrap it made. Only locker
	 * copies are scrapped: a card in a deck goes back to the locker first.
	 * Throws a `CardRuleError`, changing nothing, when `getScrapBlocker`
	 * refuses, and as `set` does while a card move is being stored.
	 */
	public scrapCards({ cardType, count = 1 }: { cardType: string; count?: number }): number {
		const blocker = this.getScrapBlocker({ cardType, count });
		if (blocker !== null) throw new CardRuleError({ message: blockerMessage({ blocker, verb: 'scrap', cardType, count }), blocker });
		const scrap = count * DECK_RULES.scrapPerCard;
		this.set({
			locker: removeCards(this.locker, cardType, count),
			resources: { ...this.resources, scrap: this.resources.scrap + scrap }
		});
		return scrap;
	}

	/** Adds a line to the log, dated today. */
	public addLogEntry({ message }: { message: string }): void {
		this.set({ log: [...this.log, { day: this.day, message }] });
	}

	/** The save as plain JSON: what `toSaveText` writes, parsed back, so it's a copy of the caller's own. */
	public toJSON(): CampaignJson {
		return JSON.parse(this.toSaveText()) as CampaignJson;
	}

	/**
	 * The save's text, which `JSON.stringify(campaign)` also writes. The
	 * frozen values go to `JSON.stringify` as they are, uncopied, which keeps
	 * a checkpoint cheap. Throws on a convoy that couldn't load back, since
	 * the convoy changes outside the campaign's checks.
	 */
	public toSaveText(): string {
		const convoy = convoyToJson(this.convoy);
		readConvoy(convoy, 'Campaign.convoy');
		const save: Record<keyof CampaignJson, unknown> = {
			seed: this.seed,
			generatorVersion: this.generatorVersion,
			day: this.day,
			resources: this.resources,
			unrest: this.unrest,
			nextDriverNumber: this.nextDriverNumber,
			drivers: this.drivers,
			locker: this.locker,
			convoy,
			strongholdsTaken: this.strongholdsTaken,
			log: this.log,
			mapParams: this.mapParams,
			map: this.map
		};
		return JSON.stringify(save);
	}

	/**
	 * A move checked against the rules, with the counts each end holds now,
	 * which `moveCards` stores from. Every deck rule reads those counts and
	 * `archetypeAt`, so a new kind of place only has to answer those two.
	 */
	private checkMove({ cardType, from, to, count = 1 }: CardMove): { blocker: CardBlocker | null; source: CardCounts; target: CardCounts } {
		readCardType(cardType, 'cardType');
		readInteger(count, 'count', { min: 1 });
		if (from === to) throw new RangeError(`Can't move ${cardType} from ${placeName(from)} to itself`);
		const source = this.countsAt(from);
		const target = this.countsAt(to);
		const refused = (blocker: CardBlocker) => ({ blocker, source, target });
		for (const place of [from, to]) {
			if (place !== 'locker' && !isAtCompound(place)) return refused({ reason: 'driver_away', place });
		}
		const held = cardCount(source, cardType);
		if (held < count) return refused({ reason: 'too_few', place: from, held });
		if (to !== 'locker') {
			const blocker = deckAddBlocker({ deck: target, archetype: archetypeAt(to), cardType, count });
			if (blocker !== null) return refused({ ...blocker, place: to });
		}
		if (from !== 'locker') {
			const blocker = deckRemoveBlocker({ deck: source, count });
			if (blocker !== null) return refused({ ...blocker, place: from });
		}
		return { blocker: null, source, target };
	}

	private countsAt(place: CardPlace): CardCounts {
		if (place === 'locker') return this.locker;
		if (!this.drivers.includes(place)) throw new RangeError(`${place.name} (${place.id}) isn't in this campaign's pool`);
		return place.defaultDeck;
	}
}

/** What a refused move or scrap throws, worded for the log and the console; the Crew screen words its own from the blocker. */
function blockerMessage({ blocker, verb, cardType, count }: { blocker: CardBlocker; verb: 'move' | 'scrap'; cardType: string; count: number }): string {
	switch (blocker.reason) {
		case 'driver_away':
			return `${blocker.place.name} (${blocker.place.id}) is ${blocker.place.status}, so no cards move to or from their deck`;
		case 'too_few':
			return `Can't ${verb} ${count} ${cardType} from ${placeName(blocker.place)}, which holds ${blocker.held}`;
		case 'other_archetype':
			return `${cardType} is for ${blocker.archetype} drivers only, so it can't go in ${placeName(blocker.place)}`;
		case 'deck_full':
			return `Can't add ${count} ${cardType} to ${placeName(blocker.place)}, which holds ${blocker.place.deckSize} of at most ${blocker.max}`;
		case 'deck_at_minimum':
			return `Can't take ${count} ${cardType} from ${placeName(blocker.place)}, which holds ${blocker.place.deckSize} of at least ${blocker.min}`;
	}
}

/** Where load warnings go when nobody asks to hear them. */
export function logWarning(warning: string): void {
	console.warn(warning);
}

function placeName(place: CardPlace): string {
	return place === 'locker' ? 'the locker' : `${place.name}'s deck`;
}

/** The locker, or a driver who's here to hand cards to: not dead, and not missing. */
export function isAtCompound(place: CardPlace): boolean {
	return place === 'locker' || (place.status !== 'dead' && place.status !== 'missing');
}

/** The archetype whose cards a deck at this place takes: its driver's. */
function archetypeAt(place: Exclude<CardPlace, 'locker'>): DriverArchetype {
	return place.archetype;
}

/**
 * Stores moved copies on the first of these decks whose driver is at the
 * compound and can hold them, by the deck rules and by what a count holds,
 * and says where they went: the locker, when none can. A listener can have
 * sent a driver away, or filled their deck, while the move was being stored.
 */
function landCopies({ decks, cardType, count }: { decks: readonly DriverRecord[]; cardType: string; count: number }): CardPlace {
	for (const driver of decks) {
		if (!isAtCompound(driver)) continue;
		if (deckAddBlocker({ deck: driver.defaultDeck, archetype: archetypeAt(driver), cardType, count }) !== null) continue;
		let deck: CardCounts;
		try {
			deck = addCards(driver.defaultDeck, cardType, count);
		} catch (error) {
			if (error instanceof RangeError) continue;
			throw error;
		}
		driver.set({ defaultDeck: deck });
		return driver;
	}
	return 'locker';
}

/**
 * The campaign's fields checked together. Drivers and the convoy are
 * models here; `fromJSON` reads a save's into models first. `previous` is
 * the state being changed, if any: what was checked when it was stored isn't
 * checked again, the pool only grows from it, and a log that grows from it
 * has just its new entries checked.
 */
function readCampaignData(value: unknown, path: string, previous: Partial<CampaignData> = {}): CampaignData {
	const fields = readFields(value, path, FIELDS);
	const seed = readSeed(fields.seed, `${path}.seed`);
	const mapParams = readMapParams(fields.mapParams, `${path}.mapParams`);
	if (mapParams.seed !== seed) {
		throw new ReaderRangeError(`${path}.mapParams.seed must be the campaign's seed, ${seed}, got ${describeValue(mapParams.seed)}`);
	}
	const day = readInteger(fields.day, `${path}.day`, { min: 1 });
	const nextDriverNumber = readInteger(fields.nextDriverNumber, `${path}.nextDriverNumber`, { min: 1 });
	if (!(fields.convoy instanceof Convoy)) throw new ReaderTypeError(`${path}.convoy must be a Convoy, got ${describeValue(fields.convoy)}`);
	return {
		seed,
		generatorVersion: readInteger(fields.generatorVersion, `${path}.generatorVersion`, { min: 1 }),
		mapParams,
		map: readMapState(fields.map, `${path}.map`),
		day,
		resources: readResources(fields.resources, `${path}.resources`),
		unrest: readInteger(fields.unrest, `${path}.unrest`, { min: 0 }),
		drivers: readDrivers(fields.drivers, `${path}.drivers`, nextDriverNumber, previous),
		nextDriverNumber,
		locker: readCardCounts(fields.locker, `${path}.locker`),
		convoy: fields.convoy,
		strongholdsTaken: readStrongholds(fields.strongholdsTaken, `${path}.strongholdsTaken`),
		log: readLog(fields.log, `${path}.log`, day, previous.log)
	};
}

/**
 * The pool: driver records with distinct `driver-<n>` ids, each below the
 * next one to hand out. Against the pool held before, it only grows: the
 * same records in the same places, any new ones after them with ids at or
 * past the counter as it stood, so none reuses an id it had passed.
 */
function readDrivers(
	value: unknown,
	path: string,
	nextDriverNumber: number,
	previous: Partial<Pick<CampaignData, 'drivers' | 'nextDriverNumber'>>
): readonly DriverRecord[] {
	// A new campaign has no pool before it and a counter that starts at 1, so every driver is new and any id passes.
	const { drivers: held, nextDriverNumber: counterBefore = 1 } = previous;
	// Checked when it was stored, and the counter has only gone up since.
	if (held !== undefined && value === held) return held;
	const drivers = readArray(value, path);
	held?.forEach((driver, index) => {
		if (drivers[index] === driver) return;
		throw new ReaderRangeError(index < drivers.length
			? `${path}[${index}] must still be ${driver.id} (${driver.name}): drivers keep their places in the pool`
			: `${path} is missing ${driver.id} (${driver.name}): drivers stay in the pool, the dead and missing too`);
	});
	const firstNew = held?.length ?? 0;
	const ids = new Set<string>();
	drivers.forEach((driver, index) => {
		if (!(driver instanceof DriverRecord)) throw new ReaderTypeError(`${path}[${index}] must be a DriverRecord, got ${describeValue(driver)}`);
		const number = driverNumber(driver.id);
		if (number === null) throw new ReaderRangeError(`${path}[${index}].id must look like driver-1, got ${describeValue(driver.id)}`);
		if (number >= nextDriverNumber) {
			throw new ReaderRangeError(`${path}[${index}].id must come before driver-${nextDriverNumber}, the next id to hand out, got ${driver.id}`);
		}
		if (ids.has(driver.id)) throw new ReaderRangeError(`${path}[${index}].id ${driver.id} belongs to an earlier driver`);
		if (index >= firstNew && number < counterBefore) {
			throw new ReaderRangeError(`${path}[${index}].id must be driver-${counterBefore} or later, an id the counter hasn't passed, got ${driver.id}`);
		}
		ids.add(driver.id);
	});
	return Object.freeze([...drivers] as DriverRecord[]);
}

function readResources(value: unknown, path: string): Readonly<Resources> {
	if (typeof value === 'object' && value !== null && checkedResources.has(value)) return value as Readonly<Resources>;
	const fields = readFields(value, path, RESOURCE_NAMES);
	const amount = (name: keyof Resources): number => readInteger(fields[name], `${path}.${name}`, { min: 0 });
	const resources = Object.freeze({
		food: amount('food'),
		water: amount('water'),
		fuel: amount('fuel'),
		meds: amount('meds'),
		scrap: amount('scrap'),
		people: amount('people')
	});
	checkedResources.add(resources);
	return resources;
}

function readStrongholds(value: unknown, path: string): readonly string[] {
	if (typeof value === 'object' && value !== null && checkedStrongholds.has(value)) return value as readonly string[];
	const ids = readArray(value, path).map((id, index) => readText(id, `${path}[${index}]`));
	ids.forEach((id, index) => {
		if (ids.indexOf(id) !== index) throw new ReaderRangeError(`${path}[${index}] ${describeValue(id)} is already in the list`);
	});
	const strongholds = Object.freeze(ids);
	checkedStrongholds.add(strongholds);
	return strongholds;
}

/**
 * Log entries dated from day 1 to today, in order. A log that only adds to
 * the one held before checks just the new entries, and the newest old one
 * against today, since the rest were checked when they were added.
 */
function readLog(value: unknown, path: string, today: number, previous?: readonly Readonly<CampaignLogEntry>[]): readonly Readonly<CampaignLogEntry>[] {
	if (previous !== undefined) {
		const entries = value === previous ? previous : readArray(value, path);
		if (entries === previous || (entries.length >= previous.length && previous.every((entry, index) => entries[index] === entry))) {
			const newest = previous.length - 1;
			if (newest >= 0) readInteger(previous[newest].day, `${path}[${newest}].day`, { min: 1, max: today, maxLabel: `today (${today})` });
			if (entries.length === previous.length) return previous;
			const added = readLogEntries(entries.slice(previous.length), path, today, previous.length, previous[newest]?.day ?? 1);
			return Object.freeze([...previous, ...added]);
		}
	}
	return Object.freeze(readLogEntries(readArray(value, path), path, today, 0, 1));
}

/** Entries checked in order from `start`, none before `after`'s day or after today. */
function readLogEntries(entries: readonly unknown[], path: string, today: number, start: number, after: number): Readonly<CampaignLogEntry>[] {
	let previousDay = after;
	return entries.map((entry, offset) => {
		const at = `${path}[${start + offset}]`;
		const fields = readFields(entry, at, ['day', 'message']);
		const day = readInteger(fields.day, `${at}.day`, { min: 1, max: today, maxLabel: `today (${today})` });
		if (day < previousDay) throw new ReaderRangeError(`${at}.day must not come before the entry above it (day ${previousDay}), got ${day}`);
		previousDay = day;
		return Object.freeze({ day, message: readText(fields.message, `${at}.message`) });
	});
}

function driverNumber(id: string): number | null {
	const match = DRIVER_ID.exec(id);
	return match ? Number(match[1]) : null;
}

/** One past the highest `driver-<n>` among these, for a campaign built without a counter. */
function firstFreeDriverNumber(drivers: readonly DriverRecord[]): number {
	return drivers.reduce((highest, driver) => Math.max(highest, driverNumber(driver.id) ?? 0), 0) + 1;
}
