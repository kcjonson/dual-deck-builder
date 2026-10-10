import { closeModels } from '../core/ClosedModels';
import { describeValue, type JsonObject } from '../core/Json';
import { ReaderRangeError, ReaderTypeError, readArray, readFields, readInteger, readNullable, readOneOf, readSeed, readText } from '../core/JsonReader';
import { Model } from '../core/Model';
import { MapParams } from '../map/MapParams';
import { Convoy } from '../mechanics/Convoy';
import { DriverArchetype } from '../mechanics/Driver';
import { PLAYER_DRIVEN_VEHICLES } from '../mechanics/Team';
import type { Vehicle } from '../mechanics/Vehicle';
import { CampaignEnd, CampaignOverError, CampaignTally, NO_TALLY, checkTallyGrows, fallOf, readCampaignEnd, readTally, refuseOver, refuseOverBlocker, stepLog } from './CampaignEnd';
import { CardCounts, NO_CARDS, addCards, addCounts, cardCount, readCardCounts, readCardType, removeCards, totalCards } from './CardCounts';
import type { FailedRun, RunParty } from './CombatBridge';
import { COMPOUND_RULES, CompoundRules, readCompoundRules } from './CompoundRules';
import { ConvoyJson, convoyToJson, readConvoy } from './ConvoyJson';
import { DECK_RULES, DeckBlocker, cardName, deckAddBlocker, deckRemoveBlocker, readNewCards } from './DeckRules';
import { DRIVER_ARCHETYPES, DriverRecord, DriverRecordData, DriverRecordJson, describeDriver, placeholderName, readDriverRecord, readDriverRecordData, readPoolDriver } from './DriverRecord';
import { injuryDays } from './Infirmary';
import { readMapParams, repairMapParams } from './MapParamsJson';
import { EMPTY_MAP, MapState, readMapState } from './MapState';
import { hasOpenFight } from './OpenFights';
import { EscortCard, RunDeck, RunDeckJson, readRunDeckJson } from './RunDeck';
import { SeatBlocker, getSeatBlocker } from './Seating';
import { SupplyRun, SupplyRunJson, readSupplyRun, readSupplyRunJson, readSupplyRunTies, supplyRunToJson } from './SupplyRunState';

/**
 * The save format's version, which `CampaignStore` stamps on every save and
 * history list. Bump it by hand whenever the text `toSaveText` writes, or a
 * history entry, changes shape. There are no migrations: a save stamped
 * with another version isn't loaded, so a bump invalidates every existing
 * save of that build.
 */
export const CAMPAIGN_SCHEMA_VERSION = 7;

/** Structure a missing driver's vehicle comes home with once they're found. A tuning value. */
export const RETURN_STRUCTURE = 1;

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

/** Copies of a card bought for the locker, 1 when `count` is left out, for `price` scrap in all, nothing when it's left out. */
export interface LockerDeposit {
	cardType: string;
	count?: number;
	price?: number;
}

/**
 * What a run that got home unloaded: the cargo's resources, now in the
 * stores, the cards won, now in the locker, and the missing drivers it
 * found, now back in the pool.
 */
export interface UnloadedCargo {
	readonly resources: Readonly<Resources>;
	readonly cards: CardCounts;
	readonly found: readonly DriverRecord[];
}

/**
 * Where a card copy sits: the compound's locker, a driver's default deck,
 * or, while a run is out, a seated driver's run deck. A run deck stands for
 * its driver's, whichever snapshot of it is passed.
 */
export type CardPlace = 'locker' | DriverRecord | RunDeck;

/** Copies of a card going from one place to another. */
export interface CardMove {
	cardType: string;
	from: CardPlace;
	to: CardPlace;
	/** 1 when left out. */
	count?: number;
	/**
	 * With a run deck at one end, which of its copies move: coming out, the
	 * driver's own (`own`, left at home) or borrowed ones (`borrowed`, back to
	 * the locker); going in, the driver's own from home (`home`) or new ones
	 * from the locker (`borrowed`). Left out, the rules pick: borrowed copies
	 * out first, the driver's own in first.
	 */
	copies?: RunDeckCopies;
}

/** Which of a run deck's copies a move can be for (`CardMove.copies`). */
export const RUN_DECK_COPIES = ['own', 'borrowed', 'home'] as const;
export type RunDeckCopies = (typeof RUN_DECK_COPIES)[number];

/**
 * Why the rules refuse a card move, a scrap, or a purchase, which the Crew
 * screen, Customize, and the garage show on the action they disable.
 * `place` is the end that refuses: a driver who's away (dead or missing,
 * their status says which), a driver out on a run, whose default deck is in
 * their run deck until it's unwound, a place holding too few copies, the
 * locker holding too few because the other seated driver borrowed the rest
 * (`by`), a run deck whose copies of the card are escort cards locked there
 * (`broughtBy`, the first of them), a run deck asked to borrow a card while
 * some of the driver's own are left at home, which come back first
 * (`own_at_home`), or to leave one of the driver's own at home while copies
 * of it are borrowed, which go back first (`borrowed_first`), `held` being
 * how many wait first, or a deck whose rules say no
 * (`DeckBlocker`). A purchase the stores can't pay for has no place: the
 * stores hold less scrap than it costs, and nor does anything once the
 * campaign is over (`campaign_over`), which its `end` says how.
 */
export type CardBlocker =
	| { reason: 'campaign_over'; end: Readonly<CampaignEnd> }
	| { reason: 'driver_away'; place: DriverRecord }
	| { reason: 'on_run'; place: DriverRecord }
	| { reason: 'too_few'; place: CardPlace; held: number }
	| { reason: 'already_borrowed'; place: 'locker'; held: number; by: RunDeck }
	| { reason: 'card_locked'; place: RunDeck; broughtBy: string }
	| { reason: 'own_at_home'; place: RunDeck; held: number }
	| { reason: 'borrowed_first'; place: RunDeck; held: number }
	| { reason: 'too_little_scrap'; needed: number; held: number }
	| (DeckBlocker & { place: DriverRecord | RunDeck });

/** A card move, scrap, or purchase the rules refuse, carrying the blocker its check gives. */
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
	/** The number in the next driver's id, `driver-<n>`. Saved, so no id is handed out twice. The convoy keeps its own for escorts. */
	nextDriverNumber: number;
	/** The compound's spare cards. */
	locker: CardCounts;
	/** The campaign's for good, since it hands out the escorts' ids. */
	convoy: Convoy;
	/**
	 * The number in the next run's id, `run-<n>`, which starting run decks
	 * hands out. Saved, so a run party left over from an earlier run never
	 * matches the run out (`currentRun`).
	 */
	nextRunNumber: number;
	/** While a run is out, each seated driver's run deck, Driver 1's first; empty at home. */
	runDecks: readonly RunDeck[];
	/**
	 * Missing drivers found on the run out, riding home with it: they're back
	 * in the pool when it gets home (`unloadRun`), and stay missing if it
	 * fails (`loseRun`). Empty at home.
	 */
	foundOnRun: readonly DriverRecord[];
	/**
	 * The supply run on the road (SupplyRun.ts): its route, the stop it's at,
	 * its escorts and cargo. Null at home, and from the moment load out
	 * starts the run decks until the run departs; the run's end, home or
	 * failed, clears it with the run decks.
	 */
	supplyRun: SupplyRun | null;
	/** Ids of the strongholds taken, in the order they fell. */
	strongholdsTaken: readonly string[];
	log: readonly Readonly<CampaignLogEntry>[];
	/** Runs and fights counted for the defeat screen, which nothing else here can tell. Counts only go up. */
	tally: Readonly<CampaignTally>;
	/** How the campaign was lost, once it's over, or null while it stands. Nothing changes a campaign that's over. */
	end: Readonly<CampaignEnd> | null;
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
	convoy: ConvoyJson;
	nextRunNumber: number;
	runDecks: RunDeckJson[];
	/** Their driver ids. */
	foundOnRun: string[];
	supplyRun: SupplyRunJson | null;
	strongholdsTaken: string[];
	log: CampaignLogEntry[];
	tally: CampaignTally;
	end: CampaignEnd | null;
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
	'nextRunNumber',
	'runDecks',
	'foundOnRun',
	'supplyRun',
	'strongholdsTaken',
	'log',
	'tally',
	'end'
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
	'nextRunNumber',
	'runDecks',
	'foundOnRun',
	'supplyRun',
	'strongholdsTaken',
	'log',
	'tally',
	'end',
	'mapParams',
	'map'
];

export const RESOURCE_NAMES: readonly (keyof Resources)[] = ['food', 'water', 'fuel', 'meds', 'scrap', 'people'];

/** The last day a campaign reaches: the day names each day's streams (`fork('scavenge', day)`), and `Rng.fork` takes attempts up to 2^32 - 1. */
export const MAX_DAY = 0xffffffff;

/**
 * What the map was made from, set at founding, and the convoy, whose
 * counter a replacement would start over, handing escort ids out again.
 */
const FIXED_FIELDS = ['seed', 'generatorVersion', 'mapParams', 'convoy'] as const;

/**
 * Counters that never go back: the two that hand out ids, so no id is
 * handed out twice, and the day, which names each day's draws (a scavenging
 * party's `fork('scavenge', day)`), so no day's roll comes round again.
 */
const COUNTERS = ['day', 'nextDriverNumber', 'nextRunNumber'] as const;

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
 * and unrest, the driver pool, the locker, the convoy, the run decks while a
 * run is out, the strongholds taken, and a log of what happened.
 *
 * Properties are read-only. A change goes through `set`, which checks the
 * whole campaign and throws, changing nothing, if the result would be
 * invalid, so whatever `toJSON` writes, `fromJSON` reads back. The seed,
 * generator version, map params, and convoy never change after founding,
 * the day, the driver and run counters, and the tally never go back, and
 * the pool only grows. Once the campaign is over (`end`), nothing changes
 * it: `set` and every method that would change it throw a
 * `CampaignOverError`, and so do its driver records and its convoy, which
 * the end closes.
 * Drivers, escorts, and runs carry ids from saved counters (`driver-<n>`,
 * `escort-<n>`, `run-<n>`), which is what anything a save holds refers to
 * them by.
 *
 * The campaign's `change` event covers its own fields, run decks included,
 * and finished card moves. Records, escorts,
 * and the convoy emit on their own models and not here: a record's HP on
 * the record, an escort's damage on its own Vehicle, escorts joining or
 * leaving on the convoy. So save at
 * checkpoints, with `CampaignStore.checkpoint` at the end of each step (a
 * stop, arriving home, a compound action), not on change events. A record
 * changes partway through a card move, before the locker is stored, and
 * partway through starting or unwinding run decks; a save asked for from a
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
		nextRunNumber,
		runDecks = [],
		foundOnRun = [],
		supplyRun = null,
		strongholdsTaken = [],
		log = [],
		tally = NO_TALLY,
		end = null
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
			nextRunNumber: nextRunNumber ?? (runDecks.length > 0 ? 2 : 1),
			runDecks,
			foundOnRun,
			supplyRun,
			strongholdsTaken,
			log,
			tally,
			end
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
		const drivers = readArray(save.drivers, `${path}.drivers`).map((driver, index) => readDriverRecord(driver, `${path}.drivers[${index}]`));
		const convoy = readConvoy(save.convoy, `${path}.convoy`);
		const campaign = new Campaign(readCampaignData({
			seed: save.seed,
			generatorVersion: save.generatorVersion,
			mapParams: mapParams.params,
			map: save.map,
			day: save.day,
			resources: save.resources,
			unrest: save.unrest,
			drivers,
			nextDriverNumber: save.nextDriverNumber,
			locker: save.locker,
			convoy,
			nextRunNumber: save.nextRunNumber,
			runDecks: readArray(save.runDecks, `${path}.runDecks`).map((deck, index) => readRunDeckJson(deck, `${path}.runDecks[${index}]`, drivers)),
			foundOnRun: readArray(save.foundOnRun, `${path}.foundOnRun`).map((id, index) => readPoolDriver(id, `${path}.foundOnRun[${index}]`, drivers)),
			supplyRun: readNullable(save.supplyRun, `${path}.supplyRun`, (run, at) => readSupplyRunJson(run, at, { convoy, readCargo: readResources })),
			strongholdsTaken: save.strongholdsTaken,
			log: save.log,
			tally: save.tally,
			end: save.end
		}, path));
		mapParams.warnings.forEach(warning => onWarning(warning));
		return campaign;
	}

	/**
	 * Changes fields together, checked as a whole. Throws without changing
	 * anything if the campaign would be invalid, a field is unknown, the
	 * seed, generator version, or map params would change, another convoy
	 * would replace the campaign's (starting its escort ids over), the day
	 * would go back (rolling a day's draws again), the driver or run counter
	 * would go back (handing out an id again), a driver
	 * would leave the pool or change places in it, or a driver would join it
	 * with an id the counter had already passed. Nothing changes while a card
	 * move is being stored, so campaign listeners never hear half of one, and
	 * nothing changes once the campaign is over (`CampaignOverError`). The
	 * `set` that ends it, or builds it ended, closes its records and convoy.
	 */
	public override set(changes: Partial<CampaignData>): void {
		const current = this.getState();
		// Undefined only while the constructor sets the first state
		if (current.end) throw new CampaignOverError({ end: current.end, action: 'change the campaign' });
		if (storingMoves.has(this)) throw new Error("Campaign can't change while a card move is being stored");
		for (const field of FIXED_FIELDS) {
			if (current[field] !== undefined && field in changes && changes[field] !== current[field]) {
				throw new RangeError(`Campaign.${field} is fixed at founding`);
			}
		}
		const valid = readCampaignData({ ...current, ...changes }, 'Campaign', current);
		for (const field of COUNTERS) {
			const [from, to] = [current[field], valid[field]];
			if (from !== undefined && field in changes && to < from) throw new RangeError(`Campaign.${field} can't go back, from ${from} to ${to}`);
		}
		const end = valid.end;
		if (end !== null) {
			// Before the change is heard, so a listener can't change a record or the convoy after the end
			closeModels({ models: [...valid.drivers, valid.convoy], refusal: action => new CampaignOverError({ end, action }) });
		}
		super.set(Object.fromEntries(Object.keys(changes).map(key => [key, valid[key as keyof CampaignData]])));
	}

	/**
	 * A driver joins the pool: the next id, their archetype's starting HP,
	 * hand limit, and deck, and a name numbered after every driver of that
	 * archetype the compound has had. Founding (DDB-284) and Find: driver
	 * stops call this.
	 */
	public recruitDriver({ archetype }: { archetype: DriverArchetype }): DriverRecord {
		refuseOver({ campaign: this, action: 'recruit a driver' });
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

	/** Whether the campaign is over (`end`), lost and closed to every change. */
	public get isOver(): boolean {
		// Undefined only while the constructor sets the first state
		return Boolean(this.end);
	}

	/**
	 * Every copy the compound owns, by card type: the locker's, every default
	 * deck's, and every run deck's, going, left at home, or borrowed (escort
	 * cards are their escorts', not the compound's). Each copy is in exactly
	 * one of those places, so moves never change this, and nor do starting
	 * run decks or unwinding them; scrapping takes from it, and so does a
	 * driver who dies with their run deck, while cards won coming home
	 * (`unloadRun`) and cards bought at home (`addToLocker`) add to it, in
	 * the locker. A record's listener can see half a move (a copy in two
	 * places, or none), so read this, as the Crew screen should, on the
	 * campaign's `change`, not a record's.
	 */
	public get cardsOwned(): CardCounts {
		const owned: Record<string, number> = { ...this.locker };
		const places = [
			...this.drivers.map(driver => driver.defaultDeck),
			...this.runDecks.flatMap(deck => [deck.own, deck.leftHome, deck.borrowed])
		];
		for (const counts of places) {
			for (const [cardType, count] of Object.entries(counts)) owned[cardType] = cardCount(owned, cardType) + count;
		}
		return readCardCounts(owned, 'cardsOwned');
	}

	/**
	 * The id of the run out, `run-<n>`, from when load out starts its run
	 * decks until it ends, or null at home. The run party holds it as its
	 * `run`, and ending a run checks it.
	 */
	public get currentRun(): string | null {
		return this.runDecks.length > 0 ? `run-${this.nextRunNumber - 1}` : null;
	}

	/**
	 * Whether the campaign is partway through storing records, as it does in
	 * a card move and when run decks start or a run ends, refusing every
	 * change meanwhile. A fight can't start on records half stored.
	 */
	public get isStoring(): boolean {
		return storingMoves.has(this);
	}

	/** A seated driver's run deck while a run is out, or null. */
	public runDeckOf(driver: DriverRecord): RunDeck | null {
		return this.runDecks.find(deck => deck.driver === driver) ?? null;
	}

	/**
	 * Why the rules refuse this move, or null if `moveCards` would make it.
	 * First, the campaign is over (`campaign_over`). Then, between the locker
	 * and default decks, in this order: a driver at
	 * either end is away (dead, gone with their cards, or missing, not here
	 * to hand cards to or take them from) or out on a run (`on_run`), `from`
	 * holds fewer than `count`, the card is marked for another archetype than
	 * `to`'s driver, `to`'s deck would go past the most it holds, or `from`'s
	 * under the fewest (`DECK_RULES`). Between the locker and a run deck, the
	 * same order: its driver is away. Going in, borrowing while some of the
	 * driver's own wait at home (`own_at_home`), or for `home`, too few at
	 * home (`too_few`), then the locker holds too few (`already_borrowed`
	 * when the other run deck borrowed what's missing). Coming out, the run
	 * deck holds too few of the copies asked for (`card_locked` when, with no
	 * `copies` named, its copies are escort cards), then leaving the driver's
	 * own at home while copies are borrowed, which go back first
	 * (`borrowed_first`). Then the deck rules on the run deck's own and
	 * borrowed copies, which is what the limits count. It works out no
	 * stores, so a screen can ask it of every control on every change.
	 *
	 * Throws, as `moveCards` does, on a move no rule covers: a malformed card
	 * type or count, a place to itself, a driver outside this campaign's
	 * pool, a run deck it doesn't have, a run deck and anywhere but the
	 * locker, `copies` without a run deck, and `own` going into one or `home`
	 * coming out. A record's listener can see half a move, so the Crew screen
	 * asks again on the campaign's `change`, not a record's.
	 */
	public getCardMoveBlocker(move: CardMove): CardBlocker | null {
		return this.checkMove(move).blocker;
	}

	/**
	 * Moves copies of a card between the locker and the default decks of
	 * drivers at the compound, all in this campaign: the Crew screen's add
	 * and remove, and a move between two decks. Or between the locker and a
	 * run deck, Customize's borrow and leave at home, in one `set`: copies
	 * going into a run deck are the driver's own left at home first, then
	 * the locker's, borrowed; copies coming out go back to the locker if
	 * they were borrowed, first, and stay at home if they're the driver's
	 * own. `copies` names which move, and is refused when the others come
	 * first. A move never makes or loses a copy, so each copy stays in exactly
	 * one place. Throws a `CardRuleError`, moving nothing, when
	 * `getCardMoveBlocker` refuses it, and a `CampaignOverError` when it
	 * refuses because the campaign is over.
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
		const { cardType, count = 1 } = move;
		const plan = this.checkMove(move);
		if (plan.blocker !== null) {
			const verb = move.to instanceof RunDeck ? 'take' : 'move';
			throw cardRefusal({ blocker: plan.blocker, action: 'move cards', message: () => blockerMessage({ blocker: plan.blocker as CardBlocker, verb, cardType, count }) });
		}
		if (plan.kind === 'run_deck') {
			// Signed by direction: going in, copies leave home and the locker; coming out, they go back to them.
			const { deck, home, locker, sign } = plan;
			this.set({
				runDecks: this.withRunDeck(deck.with({
					own: shiftCards(deck.own, cardType, sign * home),
					leftHome: shiftCards(deck.leftHome, cardType, -sign * home),
					borrowed: shiftCards(deck.borrowed, cardType, sign * locker)
				})),
				locker: shiftCards(this.locker, cardType, -sign * locker)
			});
			return;
		}
		const { from, to, source, target } = plan;
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
	 * or null if `scrapCards` would: the campaign is over (`campaign_over`),
	 * or the locker holds fewer. Throws on a malformed card type or count.
	 */
	public getScrapBlocker({ cardType, count = 1 }: { cardType: string; count?: number }): CardBlocker | null {
		readCardType(cardType, 'cardType');
		readInteger(count, 'count', { min: 1 });
		if (this.end !== null) return { reason: 'campaign_over', end: this.end };
		const held = cardCount(this.locker, cardType);
		return held < count ? { reason: 'too_few', place: 'locker', held } : null;
	}

	/**
	 * Scraps copies of a card from the locker for `DECK_RULES.scrapPerCard`
	 * scrap each, in one `set`, and returns the scrap it made. Only locker
	 * copies are scrapped: a card in a deck goes back to the locker first.
	 * Throws a `CardRuleError`, changing nothing, when `getScrapBlocker`
	 * refuses (a `CampaignOverError` once the campaign is over), and as `set`
	 * does while a card move is being stored.
	 */
	public scrapCards({ cardType, count = 1 }: { cardType: string; count?: number }): number {
		const blocker = this.getScrapBlocker({ cardType, count });
		if (blocker !== null) throw cardRefusal({ blocker, action: 'scrap cards', message: () => blockerMessage({ blocker, verb: 'scrap', cardType, count }) });
		const scrap = count * DECK_RULES.scrapPerCard;
		this.set({
			locker: removeCards(this.locker, cardType, count),
			resources: { ...this.resources, scrap: this.resources.scrap + scrap }
		});
		return scrap;
	}

	/**
	 * Why the stores can't pay for these copies, or null if `addToLocker`
	 * would add them: the campaign is over (`campaign_over`), or they hold
	 * less scrap than the price (`too_little_scrap`). Throws, as `addToLocker` does, for a card
	 * cards.json doesn't list or an escort's signature card
	 * (`readNewCards`), and a malformed card type, count, or price.
	 */
	public getAddToLockerBlocker(deposit: LockerDeposit): CardBlocker | null {
		return this.checkDeposit(deposit).blocker;
	}

	/**
	 * New copies of a card into the locker, paid for with `price` scrap from
	 * the stores, in one `set`: what the garage sells at the compound, since
	 * cards bought at home go to the locker (Compound and Supply Runs,
	 * Buildings). Throws a `CardRuleError`, changing nothing, when
	 * `getAddToLockerBlocker` refuses (a `CampaignOverError` once the
	 * campaign is over), a plain error on what it throws on, and as `set`
	 * does while a card move is being stored.
	 */
	public addToLocker(deposit: LockerDeposit): void {
		const { cards, price, blocker } = this.checkDeposit(deposit);
		if (blocker !== null) {
			throw cardRefusal({
				blocker,
				action: 'add cards to the locker',
				message: () => blockerMessage({ blocker, verb: 'buy', cardType: deposit.cardType, count: deposit.count ?? 1 })
			});
		}
		this.set({ locker: addCounts(this.locker, cards), resources: { ...this.resources, scrap: this.resources.scrap - price } });
	}

	/** Adds a line to the log, dated today. */
	public addLogEntry({ message }: { message: string }): void {
		refuseOver({ campaign: this, action: 'add to the log' });
		this.set({ log: [...this.log, { day: this.day, message }] });
	}

	/**
	 * Load out (Compound and Supply Runs, At load out): each seated driver
	 * takes a run deck that's their whole default deck, all of it going, and
	 * each escort that came along brings its signature card into Driver 1's,
	 * the first seat's. The default decks are emptied into the run decks, so
	 * every copy stays in one place, until the run ends (`unloadRun`,
	 * `loseRun`) or the load out is given up (`unwindRunDecks`), which gives
	 * them back. The run gets the next id (`currentRun`), which the run party
	 * carries as its `run`.
	 *
	 * The records are stored first, in seat order, then the campaign, so
	 * campaign listeners hear it whole. A record's listener sees the copies in
	 * neither place, and while the records are stored the campaign refuses
	 * every change. If a listener leaves the run decks unstorable (dismisses
	 * an escort whose card they hold, say), the copies go back to the default
	 * decks and the error is thrown on.
	 *
	 * Throws, starting nothing, while a run's decks are out, unless load
	 * out's seat check (`getSeatBlocker`) seats the two drivers together,
	 * asked of each seat alone and then of the pair (a `CampaignOverError`
	 * once the campaign is over), and for an escort that isn't in the convoy
	 * or is listed twice.
	 */
	public startRunDecks({ seats, escorts = [] }: { seats: readonly DriverRecord[]; escorts?: readonly Vehicle[] }): readonly RunDeck[] {
		if (storingMoves.has(this)) throw new Error("Can't start run decks while a card move is being stored");
		if (this.runDecks.length > 0) throw new Error('A run is already out; unwind its run decks before starting new ones');
		if (seats.length !== 2) throw new RangeError(`A run seats two drivers, not ${seats.length}`);
		const [first, second] = seats;
		for (const { driver, partner } of [{ driver: first, partner: null }, { driver: second, partner: null }, { driver: first, partner: second }]) {
			const blocker = getSeatBlocker({ campaign: this, driver, partner });
			refuseOverBlocker({ blocker, action: 'start run decks' });
			if (blocker !== null) throw new RangeError(seatRefusal({ driver, blocker }));
		}
		const escortCards = this.escortCardsOf(escorts);
		const runDecks: RunDeck[] = [];
		try {
			storingMoves.add(this);
			try {
				seats.forEach((driver, seat) => {
					// Read as each one empties, since a listener on the first driver's record can change the second's deck
					const deck = new RunDeck({ driver, own: driver.defaultDeck, escortCards: seat === 0 ? escortCards : [] });
					driver.set({ defaultDeck: NO_CARDS });
					runDecks.push(deck);
				});
			} finally {
				storingMoves.delete(this);
			}
			this.set({ runDecks, nextRunNumber: this.nextRunNumber + 1 });
		} catch (error) {
			runDecks.forEach(({ driver, own }) => driver.set({ defaultDeck: addCounts(driver.defaultDeck, own) }));
			throw error;
		}
		return this.runDecks;
	}

	/**
	 * Why `resetRunDeck` would refuse this run deck, or null if it would
	 * reset it: the campaign is over (`campaign_over`), or its driver is dead
	 * or missing (`driver_away`), since folding what they left at home into
	 * what went would lose it when their run deck is unwound. Throws for a
	 * driver with no run deck here.
	 */
	public getResetRunDeckBlocker({ runDeck }: { runDeck: RunDeck }): CardBlocker | null {
		if (this.end !== null) return { reason: 'campaign_over', end: this.end };
		const deck = this.currentRunDeck(runDeck);
		return isAtCompound(deck.driver) ? null : { reason: 'driver_away', place: deck.driver };
	}

	/**
	 * Customize's "Reset to default": the run deck goes back to its driver's
	 * whole default deck, everything left at home going after all and
	 * everything borrowed back in the locker, in one `set`. Escort cards stay
	 * where they are. Throws, changing nothing, when `getResetRunDeckBlocker`
	 * refuses: a `CampaignOverError` once the campaign is over, else a
	 * `CardRuleError`.
	 */
	public resetRunDeck({ runDeck }: { runDeck: RunDeck }): void {
		const blocker = this.getResetRunDeckBlocker({ runDeck });
		if (blocker !== null) {
			throw cardRefusal({
				blocker,
				action: 'reset a run deck',
				// A campaign that's over throws its own error before this is asked for.
				message: () => (blocker.reason === 'driver_away'
					? `${describeDriver(blocker.place)} is ${blocker.place.status}, so their run deck can't be reset`
					: `${placeName(runDeck)} can't be reset`),
			});
		}
		const deck = this.currentRunDeck(runDeck);
		this.set({
			runDecks: this.withRunDeck(deck.with({ own: deck.defaultDeck, leftHome: NO_CARDS, borrowed: NO_CARDS })),
			locker: addCounts(this.locker, deck.borrowed)
		});
	}

	/**
	 * Why an escort card can't go to `to`, or null if `moveEscortCard` would
	 * move it: the campaign is over (`campaign_over`); anywhere but a run deck, it's locked in the one holding it
	 * (`card_locked`), and a driver who's away (dead or missing) at either
	 * end can't give or take it. Throws with no run out, for a card no run
	 * deck holds, for a run deck that holds it already, and for a place
	 * outside this campaign.
	 */
	public getEscortCardMoveBlocker({ broughtBy, to }: { broughtBy: string; to: CardPlace }): CardBlocker | null {
		return this.checkEscortCardMove({ broughtBy, to }).blocker;
	}

	/**
	 * Gives an escort card to the other seated driver, as load out's "give it
	 * to Driver 2" does, in one `set`. Escort cards sit outside the deck
	 * limits, so no deck rule refuses one. Throws a `CardRuleError`, moving
	 * nothing, when `getEscortCardMoveBlocker` refuses it (a
	 * `CampaignOverError` once the campaign is over).
	 */
	public moveEscortCard({ broughtBy, to }: { broughtBy: string; to: CardPlace }): void {
		const plan = this.checkEscortCardMove({ broughtBy, to });
		if (plan.blocker !== null) {
			const { blocker, card } = plan;
			throw cardRefusal({ blocker, action: 'move an escort card', message: () => blockerMessage({ blocker, verb: 'move', cardType: card?.cardType ?? '', count: 1 }) });
		}
		const { holder, card, target } = plan;
		this.set({
			runDecks: this.runDecks.map(deck => {
				if (deck.driver === holder.driver) return deck.with({ escortCards: deck.escortCards.filter(held => held.broughtBy !== broughtBy) });
				if (deck.driver === target.driver) return deck.with({ escortCards: [...deck.escortCards, card] });
				return deck;
			})
		});
	}

	/**
	 * Escorts joining the run, as load out picking one more does: each
	 * brings its signature card into Driver 1's run deck, in one `set`; one
	 * with none brings nothing. Throws, adding nothing, with no run out, for
	 * an escort that isn't in the convoy or is listed twice, and for one
	 * whose card is in a run deck already.
	 */
	public addEscortCards({ escorts }: { escorts: readonly Vehicle[] }): void {
		refuseOver({ campaign: this, action: 'add escort cards' });
		const [first] = this.requireRunDecks();
		const cards = this.escortCardsOf(escorts);
		cards.forEach(card => {
			const holder = this.holderOf(card.broughtBy);
			if (holder !== null) throw new RangeError(`The ${card.cardType} ${card.broughtBy} brought is in ${placeName(holder)} already`);
		});
		if (cards.length > 0) this.set({ runDecks: this.withRunDeck(first.with({ escortCards: [...first.escortCards, ...cards] })) });
	}

	/**
	 * Escorts leaving the run, lost in a fight, dismissed, or left at home
	 * after all: the cards they brought leave whichever run deck holds them,
	 * in one `set`. Changes nothing, and says nothing, when no run deck holds
	 * a card one of them brought.
	 */
	public removeEscortCards({ escorts }: { escorts: readonly Vehicle[] }): void {
		refuseOver({ campaign: this, action: 'remove escort cards' });
		const leaving = new Set(escorts.map(escort => escort.convoyId));
		const brought = (card: EscortCard): boolean => leaving.has(card.broughtBy);
		if (!this.runDecks.some(deck => deck.escortCards.some(brought))) return;
		this.set({ runDecks: this.runDecks.map(deck => deck.with({ escortCards: deck.escortCards.filter(card => !brought(card)) })) });
	}

	/**
	 * A load out given up (Compound and Supply Runs, After the run): each run
	 * deck is unwound, and the run's decks are gone. A driver who isn't dead,
	 * home or missing, gets their default deck back, the copies that went and
	 * the ones left at home, and what they borrowed goes back to the locker.
	 * A dead driver took the copies that went and the ones they borrowed with
	 * them, and the ones they left at home go to the locker. Escort cards
	 * leave, and anyone found on the road (`foundOnRun`) stays missing.
	 * Returns the run decks lost with their drivers. A run that set off ends
	 * with `unloadRun` or `loseRun`, which unwind it the same way.
	 *
	 * The records are stored first, in seat order, then the campaign: a
	 * record's listener sees copies in two places, and while the records are
	 * stored the campaign refuses every change. A driver a listener kills
	 * before their run deck is reached is unwound as dead. Throws with no run
	 * out, and while a fight is open or being written back, since its
	 * write-back has to find the run decks as the fight left them.
	 */
	public unwindRunDecks(): { lost: readonly RunDeck[] } {
		const decks = this.endingRun({ action: 'unwind run decks' });
		const { locker, lost } = this.unwindRecords({ decks });
		this.set({ runDecks: [], foundOnRun: [], supplyRun: null, locker });
		return { lost };
	}

	/**
	 * A run that got home (Compound and Supply Runs, Return; After the run):
	 * its run decks are unwound as `unwindRunDecks` unwinds them, then its
	 * cargo is unloaded, the resources into the stores and the cards won into
	 * the locker, where the debrief offers each one to a default deck
	 * (`getDebrief`). Every copy is then in exactly one place, and
	 * `cardsOwned` has grown by the cards won. Each missing driver found on
	 * the road (`foundOnRun`) is home and back in the pool: injured for the
	 * HP they're missing, as a seat coming home hurt is (`injuryDays`, by
	 * `rules`), or ready at full HP, with their default deck as their run deck
	 * left it and their vehicle at RETURN_STRUCTURE, its armor as the crash
	 * left it. The tally counts a run home. Returns what was unloaded, and
	 * who was found.
	 *
	 * Everything is checked first, the stores and the locker it all comes to
	 * included. Then the records are stored, the found first and then the
	 * seats in seat order, and the campaign last in one `set` of its run
	 * decks, the found, locker, stores, and tally, so its `change`
	 * comes once the run is home; save at the step's checkpoint after it. The
	 * run's decks go in that set, so a second unload of this run finds no run
	 * out, whatever party it's handed, and a party left over from an earlier
	 * run is refused by its `run`, which isn't the run out.
	 *
	 * Throws, changing nothing, while a card move is being stored or a fight
	 * is open or being written back, with no run out, for a party that set
	 * off on another run (`currentRun`) or whose seats aren't the run decks'
	 * drivers, for a seat who's dead or missing (only a failed run leaves
	 * one, and a failed run loses its cargo: `loseRun`), and for cargo that
	 * doesn't check out or more than the stores or the locker can count. Cards
	 * won are checked for shape only, as the locker's are, so a card
	 * cards.json has dropped since it was won still comes home.
	 */
	public unloadRun({ party, rules = COMPOUND_RULES }: { party: RunParty; rules?: CompoundRules }): UnloadedCargo {
		const decks = this.endingRun({ action: 'unload a run' });
		const checked = readCompoundRules(rules, 'CompoundRules');
		this.checkRunId({ run: party.run, holder: 'This party set off on' });
		const seated = decks.map(deck => deck.driver);
		if (party.seats.length !== seated.length || !seated.every(driver => party.seats.includes(driver))) {
			throw new RangeError(`This party seats ${driverList(party.seats)}, and the run out seats ${driverList(seated)}`);
		}
		party.seats.forEach(seat => {
			if (!isAtCompound(seat)) throw new RangeError(`${describeDriver(seat)} is ${seat.status}, so this run didn't come home, and its cargo is lost`);
		});
		const cargo = readResources(party.cargo, 'RunParty.cargo');
		const cards = readCardCounts(party.cargoCards, 'RunParty.cargoCards');
		const stores = Object.fromEntries(RESOURCE_NAMES.map(name => [name, this.resources[name] + cargo[name]]));
		const resources = readResources(stores, 'Campaign.resources');
		const found = this.foundOnRun;
		const homecomings = found.map(driver => ({ driver, changes: homecoming({ driver, rules: checked }) }));
		const { locker } = this.unwindRecords({ decks, cardsWon: cards, first: () => homecomings.forEach(({ driver, changes }) => driver.set(changes)) });
		this.set({ runDecks: [], foundOnRun: [], supplyRun: null, locker, resources, tally: { ...this.tally, runsHome: this.tally.runsHome + 1 } });
		return Object.freeze({ resources: cargo, cards, found });
	}

	/**
	 * A run that failed (Compound and Supply Runs, A failed run): its run
	 * decks are unwound as `unwindRunDecks` unwinds them, the dead losing what
	 * went with them, and its cargo is lost, the cards won with it, so none of
	 * it reaches the stores or the locker. The log says what was lost, dated
	 * today, unless the run carried nothing. Anyone found on the road
	 * (`foundOnRun`) is lost with it, and stays missing. The tally counts a
	 * failed run. Returns the run decks lost with their drivers.
	 *
	 * When nobody is left at the compound after it, every driver in the pool
	 * dead or missing, the campaign is lost (`end`, cause `last_driver`): a
	 * missing driver only comes back through a run, and there's nobody to
	 * drive one. The compound falls as `fallOf` reads its stores and unrest
	 * by `rules`, the log says how, and the day stops there.
	 *
	 * Stored as `unloadRun` stores a run: the records first, in seat order,
	 * then the campaign in one `set` of its run decks, the found, locker,
	 * log, tally, and end. Throws, changing nothing, while a card move is being stored or
	 * a fight is open or being written back, with no run out, for a result
	 * from another run (`currentRun`) or whose dead and missing aren't the run
	 * decks' drivers, and unless every one of them is dead or missing, as a
	 * failed run leaves them.
	 */
	public loseRun({ result, rules = COMPOUND_RULES }: { result: FailedRun; rules?: CompoundRules }): { lost: readonly RunDeck[] } {
		const decks = this.endingRun({ action: 'lose a run' });
		const checked = readCompoundRules(rules, 'CompoundRules');
		this.checkRunId({ run: result.run, holder: 'This failed run is' });
		const seated = decks.map(deck => deck.driver);
		const fallen = [...result.dead, ...result.missing];
		if (fallen.length !== seated.length || !seated.every(driver => fallen.includes(driver))) {
			throw new RangeError(`This failed run lost ${driverList(fallen)}, and the run out seats ${driverList(seated)}`);
		}
		seated.forEach(driver => {
			if (isAtCompound(driver)) throw new RangeError(`${describeDriver(driver)} is ${driver.status}, so this run hasn't failed`);
		});
		const message = cargoLostMessage({
			cargo: readResources(result.cargoLost, 'FailedRun.cargoLost'),
			cards: readCardCounts(result.cargoCardsLost, 'FailedRun.cargoCardsLost')
		});
		const { locker, lost } = this.unwindRecords({ decks });
		// Read once the records are stored, as the locker is
		const end: CampaignEnd | null = this.drivers.some(isAtCompound)
			? null
			: { ending: fallOf({ resources: this.resources, unrest: this.unrest, rules: checked }), cause: 'last_driver' };
		this.set({
			runDecks: [],
			foundOnRun: [],
			supplyRun: null,
			locker,
			log: stepLog({ log: this.log, day: this.day, lines: [message], end }),
			tally: { ...this.tally, runsFailed: this.tally.runsFailed + 1 },
			end
		});
		return { lost };
	}

	/**
	 * A missing driver turns up on the road, as a Find: driver stop finds
	 * them (Compound and Supply Runs, Stops), and rides home with the run out,
	 * in one `set` (`foundOnRun`). They're back in the pool when it gets home
	 * (`unloadRun`), and stay missing if it fails (`loseRun`); until then
	 * they're still missing, so nobody seats them or changes their deck.
	 *
	 * Throws, changing nothing, once the campaign is over, while a card move
	 * is being stored, with no run out to find them on, for a driver outside
	 * the pool, one who isn't missing (the dead stay dead), one found on this
	 * run already, and one whose own failed run hasn't been settled yet
	 * (`loseRun`), with their run deck still out.
	 */
	public findMissingDriver({ driver }: { driver: DriverRecord }): void {
		refuseOver({ campaign: this, action: 'find a missing driver' });
		if (storingMoves.has(this)) throw new Error("A missing driver can't be found while a card move is being stored");
		if (this.runDecks.length === 0) throw new Error('No run is out, so nobody is on the road to find them');
		this.countsAt(driver);
		if (driver.status !== 'missing') throw new RangeError(`${describeDriver(driver)} is ${driver.status}, not missing, so there's nobody to find`);
		if (this.foundOnRun.includes(driver)) throw new RangeError(`${describeDriver(driver)} has been found on this run already`);
		if (this.runDeckOf(driver) !== null) throw new RangeError(`${describeDriver(driver)}'s run deck is still out; the failed run is settled (loseRun) before they can be found`);
		this.set({ foundOnRun: [...this.foundOnRun, driver] });
	}

	/** The save as plain JSON: what `toSaveText` writes, parsed back, so it's a copy of the caller's own. */
	public toJSON(): CampaignJson {
		return JSON.parse(this.toSaveText()) as CampaignJson;
	}

	/**
	 * The save's text, which `JSON.stringify(campaign)` also writes. The
	 * frozen values go to `JSON.stringify` as they are, uncopied, which keeps
	 * a checkpoint cheap. Throws on a convoy that couldn't load back, on a run
	 * deck holding the card of an escort no longer in it, on a seated driver
	 * whose default deck holds cards, and on a driver found on the road who
	 * isn't missing any more, since the convoy and the records change outside
	 * the campaign's checks.
	 */
	public toSaveText(): string {
		const convoy = convoyToJson(this.convoy);
		readConvoy(convoy, 'Campaign.convoy');
		readRunDeckTies({ decks: this.runDecks, convoy: this.convoy, path: 'Campaign.runDecks' });
		readFoundTies({ found: this.foundOnRun, path: 'Campaign.foundOnRun' });
		if (this.supplyRun !== null) readSupplyRunTies({ run: this.supplyRun, convoy: this.convoy, path: 'Campaign.supplyRun' });
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
			nextRunNumber: this.nextRunNumber,
			runDecks: this.runDecks,
			foundOnRun: this.foundOnRun.map(driver => driver.id),
			supplyRun: this.supplyRun === null ? null : supplyRunToJson(this.supplyRun),
			strongholdsTaken: this.strongholdsTaken,
			log: this.log,
			tally: this.tally,
			end: this.end,
			mapParams: this.mapParams,
			map: this.map
		};
		return JSON.stringify(save);
	}

	/**
	 * A move checked against the rules, with what `moveCards` needs to store
	 * it: the counts each end holds now, for a move between the locker and
	 * default decks, or how many copies come from home and how many from the
	 * locker, for a run deck. Every deck rule reads a deck's counts and its
	 * driver's archetype.
	 */
	private checkMove({ cardType, from, to, count = 1, copies }: CardMove): MovePlan {
		readCardType(cardType, 'cardType');
		readInteger(count, 'count', { min: 1 });
		if (copies !== undefined) readOneOf(copies, 'copies', RUN_DECK_COPIES);
		if (this.end !== null) return { blocker: { reason: 'campaign_over', end: this.end } };
		if (from instanceof RunDeck || to instanceof RunDeck) return this.checkRunDeckMove({ cardType, from, to, count, copies });
		if (copies !== undefined) throw new RangeError(`copies names a run deck's copies, and neither ${placeName(from)} nor ${placeName(to)} is a run deck`);
		if (from === to) throw new RangeError(`Can't move ${cardType} from ${placeName(from)} to itself`);
		const source = this.countsAt(from);
		const target = this.countsAt(to);
		for (const place of [from, to]) {
			if (place !== 'locker' && !isAtCompound(place)) return { blocker: { reason: 'driver_away', place } };
		}
		for (const place of [from, to]) {
			if (place !== 'locker' && this.runDeckOf(place) !== null) return { blocker: { reason: 'on_run', place } };
		}
		const held = cardCount(source, cardType);
		if (held < count) return { blocker: { reason: 'too_few', place: from, held } };
		if (to !== 'locker') {
			const blocker = deckAddBlocker({ deck: target, archetype: to.archetype, cardType, count });
			if (blocker !== null) return { blocker: { ...blocker, place: to } };
		}
		if (from !== 'locker') {
			const blocker = deckRemoveBlocker({ deck: source, count });
			if (blocker !== null) return { blocker: { ...blocker, place: from } };
		}
		return { blocker: null, kind: 'decks', from, to, source, target };
	}

	/**
	 * A move between the locker and a run deck. Going in, the driver's own
	 * copies left at home go first, then the locker's, borrowed; coming out,
	 * borrowed copies go back to the locker first, then the driver's own stay
	 * home. `copies` asks for one kind, refused while the other comes first.
	 * Escort cards never move this way.
	 */
	private checkRunDeckMove({ cardType, from, to, count, copies }: Required<Omit<CardMove, 'copies'>> & Pick<CardMove, 'copies'>): MovePlan {
		const going = to instanceof RunDeck;
		const end = (going ? to : from) as RunDeck;
		const other = going ? from : to;
		if (other !== 'locker') {
			if (other instanceof RunDeck && other.driver === end.driver) throw new RangeError(`Can't move ${cardType} from ${placeName(from)} to itself`);
			throw new RangeError(`Cards move between a run deck and the locker, not from ${placeName(from)} to ${placeName(to)}; escort cards move with moveEscortCard`);
		}
		if (copies === (going ? 'own' : 'home')) {
			throw new RangeError(going ? "Copies going into a run deck come from home or the locker, not 'own'" : "Copies coming out of a run deck are the driver's own or borrowed, not 'home'");
		}
		const deck = this.currentRunDeck(end);
		if (!isAtCompound(deck.driver)) return { blocker: { reason: 'driver_away', place: deck.driver } };
		const home = cardCount(deck.leftHome, cardType);
		if (going) {
			if (copies === 'borrowed' && home > 0) return { blocker: { reason: 'own_at_home', place: deck, held: home } };
			if (copies === 'home' && home < count) return { blocker: { reason: 'too_few', place: deck, held: home } };
			const fromHome = copies === 'borrowed' ? 0 : Math.min(count, home);
			const fromLocker = count - fromHome;
			const inLocker = cardCount(this.locker, cardType);
			if (inLocker < fromLocker) {
				const held = fromHome + inLocker;
				const by = this.runDecks.find(partner => partner !== deck && inLocker + cardCount(partner.borrowed, cardType) >= fromLocker);
				return { blocker: by ? { reason: 'already_borrowed', place: 'locker', held, by } : { reason: 'too_few', place: 'locker', held } };
			}
			const blocker = deckAddBlocker({ deck: deck.cards, archetype: deck.driver.archetype, cardType, count });
			if (blocker !== null) return { blocker: { ...blocker, place: deck } };
			return { blocker: null, kind: 'run_deck', deck, home: fromHome, locker: fromLocker, sign: 1 };
		}
		const borrowed = cardCount(deck.borrowed, cardType);
		const held = copies === 'own' ? cardCount(deck.own, cardType) : copies === 'borrowed' ? borrowed : cardCount(deck.cards, cardType);
		if (held < count) {
			// Escort cards are neither the driver's own nor borrowed, so only a move that names no copies is after one.
			const locked = copies === undefined ? deck.escortCards.find(card => card.cardType === cardType) : undefined;
			return { blocker: locked ? { reason: 'card_locked', place: deck, broughtBy: locked.broughtBy } : { reason: 'too_few', place: deck, held } };
		}
		if (copies === 'own' && borrowed > 0) return { blocker: { reason: 'borrowed_first', place: deck, held: borrowed } };
		const blocker = deckRemoveBlocker({ deck: deck.cards, count });
		if (blocker !== null) return { blocker: { ...blocker, place: deck } };
		const toLocker = copies === 'own' ? 0 : Math.min(count, borrowed);
		return { blocker: null, kind: 'run_deck', deck, home: count - toLocker, locker: toLocker, sign: -1 };
	}

	/** An escort card's move checked, with the run decks at each end. */
	private checkEscortCardMove({ broughtBy, to }: { broughtBy: string; to: CardPlace }): EscortCardPlan {
		if (this.end !== null) return { blocker: { reason: 'campaign_over', end: this.end }, card: null };
		this.requireRunDecks();
		const holder = this.holderOf(broughtBy);
		if (holder === null) throw new RangeError(`No run deck holds a card ${describeValue(broughtBy)} brought`);
		const card = holder.escortCards.find(held => held.broughtBy === broughtBy) as EscortCard;
		if (!(to instanceof RunDeck)) {
			this.countsAt(to);
			return { blocker: { reason: 'card_locked', place: holder, broughtBy }, card };
		}
		const target = this.currentRunDeck(to);
		if (target === holder) throw new RangeError(`${placeName(holder)} holds the ${card.cardType} ${broughtBy} brought already`);
		for (const driver of [holder.driver, target.driver]) {
			if (!isAtCompound(driver)) return { blocker: { reason: 'driver_away', place: driver }, card };
		}
		return { blocker: null, holder, card, target };
	}

	/** The signature cards these escorts bring, each from the convoy and listed once; an escort with none brings nothing. */
	private escortCardsOf(escorts: readonly Vehicle[]): EscortCard[] {
		return escorts.flatMap((escort, index) => {
			if (!this.convoy.escorts.includes(escort)) throw new RangeError(`${escort.name} isn't in the campaign's convoy`);
			if (escorts.indexOf(escort) !== index) throw new RangeError(`${escort.name} (${escort.convoyId}) is listed twice`);
			const cardType = escort.escort?.signatureCard ?? null;
			return cardType === null ? [] : [{ cardType, broughtBy: escort.convoyId as string }];
		});
	}

	/** The run deck holding the card an escort brought, or null. */
	private holderOf(broughtBy: string): RunDeck | null {
		return this.runDecks.find(deck => deck.escortCards.some(card => card.broughtBy === broughtBy)) ?? null;
	}

	/** The campaign's run deck for the driver this one is, as it is now. */
	private currentRunDeck(place: RunDeck): RunDeck {
		const deck = this.runDeckOf(place.driver);
		if (deck === null) throw new RangeError(`${describeDriver(place.driver)} has no run deck in this campaign`);
		return deck;
	}

	/** The run decks with this one in its driver's place. */
	private withRunDeck(next: RunDeck): readonly RunDeck[] {
		return this.runDecks.map(deck => (deck.driver === next.driver ? next : deck));
	}

	private requireRunDecks(): readonly RunDeck[] {
		if (this.runDecks.length === 0) throw new Error('No run is out, so there are no run decks');
		return this.runDecks;
	}

	/** A deposit checked: the copies it adds, what they cost, and whether the stores can pay. */
	private checkDeposit({ cardType, count = 1, price = 0 }: LockerDeposit): { cards: CardCounts; price: number; blocker: CardBlocker | null } {
		readCardType(cardType, 'cardType');
		readInteger(count, 'count', { min: 1 });
		readInteger(price, 'price', { min: 0 });
		const cards = readNewCards({ [cardType]: count }, 'cards');
		if (this.end !== null) return { cards, price, blocker: { reason: 'campaign_over', end: this.end } };
		const held = this.resources.scrap;
		return { cards, price, blocker: held < price ? { reason: 'too_little_scrap', needed: price, held } : null };
	}

	/** The run decks of a run that's ending, refusing once the campaign is over, while a card move is stored, a fight is open, or no run is out. */
	private endingRun({ action }: { action: string }): readonly RunDeck[] {
		refuseOver({ campaign: this, action });
		if (storingMoves.has(this)) throw new Error(`Can't ${action} while a card move is being stored`);
		if (hasOpenFight(this)) throw new Error(`Can't ${action} while the campaign's last fight hasn't been written back`);
		return this.requireRunDecks();
	}

	/** Refuses a run party or result from another run than the one out. */
	private checkRunId({ run, holder }: { run: string; holder: string }): void {
		if (run !== this.currentRun) throw new RangeError(`${holder} ${describeValue(run)}, and the run out is ${this.currentRun}`);
	}

	/**
	 * Gives each run deck's driver their default deck back, in seat order,
	 * unless they're dead, and works out the locker after it: what the living
	 * borrowed, what the dead left at home, and the cards won coming home.
	 * Each driver's status is read as their deck's turn comes, so what the
	 * locker gets isn't known until the end; it's checked first against the
	 * most it could come to, every borrowed and left-at-home copy back beside
	 * the cards won, so a locker that can't count that high stores nothing.
	 * The campaign refuses every change while the records are stored; the
	 * caller stores the locker, and empties the run decks, in one `set`.
	 * `first` stores other records the step changes (the found coming home)
	 * once the checks have passed, ahead of the seats.
	 */
	private unwindRecords({ decks, cardsWon = NO_CARDS, first = () => undefined }: {
		decks: readonly RunDeck[];
		cardsWon?: CardCounts;
		first?: () => void;
	}): { locker: CardCounts; lost: readonly RunDeck[] } {
		sumCounts([this.locker, cardsWon, ...decks.flatMap(deck => [deck.borrowed, deck.leftHome])], 'Campaign.locker');
		decks.forEach(deck => addCounts(deck.driver.defaultDeck, deck.defaultDeck));
		const lost: RunDeck[] = [];
		let locker = addCounts(this.locker, cardsWon);
		storingMoves.add(this);
		try {
			first();
			for (const deck of decks) {
				if (deck.driver.status === 'dead') {
					lost.push(deck);
					locker = addCounts(locker, deck.leftHome);
				} else {
					locker = addCounts(locker, deck.borrowed);
					deck.driver.set({ defaultDeck: addCounts(deck.driver.defaultDeck, deck.defaultDeck) });
				}
			}
		} finally {
			storingMoves.delete(this);
		}
		return { locker, lost: Object.freeze(lost) };
	}

	private countsAt(place: 'locker' | DriverRecord): CardCounts {
		if (place === 'locker') return this.locker;
		if (!this.drivers.includes(place)) throw new RangeError(`${describeDriver(place)} isn't in this campaign's pool`);
		return place.defaultDeck;
	}
}

/**
 * A checked move: refused, or what `moveCards` stores, the counts at each
 * end of a move between the locker and default decks, or the run decks and
 * locker after a move to or from a run deck.
 */
type MovePlan =
	| { blocker: CardBlocker }
	| { blocker: null; kind: 'decks'; from: 'locker' | DriverRecord; to: 'locker' | DriverRecord; source: CardCounts; target: CardCounts }
	/** `home` copies to or from home and `locker` to or from the locker; `sign` is 1 going into the run deck and -1 coming out. */
	| { blocker: null; kind: 'run_deck'; deck: RunDeck; home: number; locker: number; sign: 1 | -1 };

type EscortCardPlan =
	| { blocker: CardBlocker; card: EscortCard | null }
	| { blocker: null; holder: RunDeck; card: EscortCard; target: RunDeck };

/** These counts with `delta` more copies of a card, or fewer when it's negative. */
function shiftCards(counts: CardCounts, cardType: string, delta: number): CardCounts {
	if (delta === 0) return counts;
	return delta > 0 ? addCards(counts, cardType, delta) : removeCards(counts, cardType, -delta);
}

/**
 * What a refused move, scrap, or purchase throws, worded for the log and the
 * console; the screens word their own from the blocker. `take` is a move into a
 * run deck, whose copies available count the driver's own left at home as
 * well as the locker's.
 */
function blockerMessage({ blocker, verb, cardType, count }: { blocker: CardBlocker; verb: 'move' | 'take' | 'scrap' | 'buy'; cardType: string; count: number }): string {
	const available = (held: number): string => `${held} available, from the locker and the driver's own left at home`;
	switch (blocker.reason) {
		case 'campaign_over':
			return `The campaign is over, since the compound ${blocker.end.ending}, so no cards ${verb === 'take' ? 'move' : verb}`;
		case 'driver_away':
			return `${describeDriver(blocker.place)} is ${blocker.place.status}, so no cards move to or from their deck`;
		case 'on_run':
			return `${describeDriver(blocker.place)} is out on a run, so their default deck is in their run deck until it's unwound`;
		case 'already_borrowed':
			return `Can't take ${count} ${cardType} into a run deck, with ${available(blocker.held)}: ${describeDriver(blocker.by.driver)} has borrowed the rest`;
		case 'card_locked':
			return `The ${cardType} ${blocker.broughtBy} brought is locked in ${placeName(blocker.place)}`;
		case 'own_at_home':
			return `Can't borrow ${count} ${cardType} into ${placeName(blocker.place)}: the ${blocker.held} of the driver's own left at home come back first`;
		case 'borrowed_first':
			return `Can't leave ${count} of the driver's own ${cardType} at home while ${blocker.held} borrowed are in ${placeName(blocker.place)}: borrowed copies go back first`;
		case 'too_few':
			if (verb === 'take' && blocker.place instanceof RunDeck) return `Can't bring ${count} ${cardType} back into ${placeName(blocker.place)}, which left ${blocker.held} at home`;
			if (verb === 'take') return `Can't take ${count} ${cardType} into a run deck, with ${available(blocker.held)}`;
			return `Can't ${verb} ${count} ${cardType} from ${placeName(blocker.place)}, which holds ${blocker.held}`;
		case 'other_archetype':
			return `${cardType} is for ${blocker.archetype} drivers only, so it can't go in ${placeName(blocker.place)}`;
		case 'deck_full':
			return `Can't add ${count} ${cardType} to ${placeName(blocker.place)}, which holds ${blocker.place.deckSize} of at most ${blocker.max}`;
		case 'deck_at_minimum':
			return `Can't take ${count} ${cardType} from ${placeName(blocker.place)}, which holds ${blocker.place.deckSize} of at least ${blocker.min}`;
		case 'too_little_scrap':
			return `Buying ${count} ${cardType} costs ${blocker.needed} scrap, and the stores hold ${blocker.held}`;
	}
}

/**
 * What a refused card action throws: a `CampaignOverError`, with its clearer
 * message, once the campaign is over, or a `CardRuleError` carrying the
 * blocker its check gave.
 */
function cardRefusal({ blocker, action, message }: { blocker: CardBlocker; action: string; message: () => string }): Error {
	refuseOverBlocker({ blocker, action });
	return new CardRuleError({ message: message(), blocker });
}

/**
 * A found driver home from the run that found them: injured for the HP
 * they're missing (`injuryDays`), or ready at full HP, and their vehicle at
 * RETURN_STRUCTURE, its armor as the crash left it. Checked as the record
 * would check it, so a run's arrival stores nothing it can't.
 */
function homecoming({ driver, rules }: { driver: DriverRecord; rules: CompoundRules }): Partial<DriverRecordData> {
	const injuredDays = injuryDays({ hitpoints: driver.hitpoints, maxHitpoints: driver.maxHitpoints, rules });
	const changes: Partial<DriverRecordData> = {
		status: injuredDays > 0 ? 'injured' : 'ready',
		injuredDays,
		vehicle: { structure: RETURN_STRUCTURE, armor: driver.vehicle.armor }
	};
	readDriverRecordData({ ...driver.getState(), ...changes }, describeDriver(driver));
	return changes;
}

/** Where load warnings go when nobody asks to hear them. */
export function logWarning(warning: string): void {
	console.warn(warning);
}

/** Why load out won't seat a driver, from its own check. */
function seatRefusal({ driver, blocker }: { driver: DriverRecord; blocker: SeatBlocker }): string {
	switch (blocker.reason) {
		case 'already_seated':
			return `${describeDriver(driver)} can't take both seats`;
		case 'same_archetype':
			return `${describeDriver(driver)} and ${describeDriver(blocker.partner)} are both ${blocker.archetype}; a run seats two different archetypes`;
		default:
			return `${describeDriver(driver)} is ${driver.status}, so they can't go on a run`;
	}
}

function placeName(place: CardPlace): string {
	if (place === 'locker') return 'the locker';
	return place instanceof RunDeck ? `${place.driver.name}'s run deck` : `${place.name}'s deck`;
}

/** These counts summed and read as the counts at `path`, so a sum past what a count holds throws, naming the card there. */
function sumCounts(all: readonly CardCounts[], path: string): CardCounts {
	const sum: Record<string, number> = {};
	for (const counts of all) {
		for (const [cardType, count] of Object.entries(counts)) sum[cardType] = cardCount(sum, cardType) + count;
	}
	return readCardCounts(sum, path);
}

/** "Road Warrior 1 (driver-1) and Interceptor 1 (driver-2)", or "nobody". */
export function driverList(drivers: readonly DriverRecord[]): string {
	return drivers.length === 0 ? 'nobody' : drivers.map(describeDriver).join(' and ');
}

/** What one of each resource is called in the log: "1 med", "1 person". */
const SINGULAR: Readonly<Record<keyof Resources, string>> = { food: 'food', water: 'water', fuel: 'fuel', meds: 'med', scrap: 'scrap', people: 'person' };

/** An amount of a resource as the log words it: "1 med", "2 meds", "1 person", "3 people". */
export function resourceAmount({ resource, amount }: { resource: keyof Resources; amount: number }): string {
	return `${amount} ${amount === 1 ? SINGULAR[resource] : resource}`;
}

/** "Cargo lost with the run: 2 fuel, 30 scrap, and Repair Kit x2.", or null when the run carried nothing. */
function cargoLostMessage({ cargo, cards }: { cargo: Readonly<Resources>; cards: CardCounts }): string | null {
	const items = [
		...RESOURCE_NAMES.filter(name => cargo[name] > 0).map(name => resourceAmount({ resource: name, amount: cargo[name] })),
		...Object.entries(cards).map(([cardType, count]) => (count === 1 ? cardName(cardType) : `${cardName(cardType)} x${count}`))
	];
	if (items.length === 0) return null;
	const listed = items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
	return `Cargo lost with the run: ${listed}.`;
}

/** The locker, or a driver who's here to hand cards to: not dead, and not missing. */
export function isAtCompound(place: 'locker' | DriverRecord): boolean {
	return place === 'locker' || (place.status !== 'dead' && place.status !== 'missing');
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
		if (deckAddBlocker({ deck: driver.defaultDeck, archetype: driver.archetype, cardType, count }) !== null) continue;
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
 * checked again, the pool only grows from it, a log that grows from it has
 * just its new entries checked, and the tally doesn't go back from it. A
 * campaign that's over has no run out, and its end's cause holds: no People,
 * or a pool with nobody left at the compound.
 */
function readCampaignData(value: unknown, path: string, previous: Partial<CampaignData> = {}): CampaignData {
	const fields = readFields(value, path, FIELDS);
	const seed = readSeed(fields.seed, `${path}.seed`);
	const mapParams = readMapParams(fields.mapParams, `${path}.mapParams`);
	if (mapParams.seed !== seed) {
		throw new ReaderRangeError(`${path}.mapParams.seed must be the campaign's seed, ${seed}, got ${describeValue(mapParams.seed)}`);
	}
	const day = readInteger(fields.day, `${path}.day`, { min: 1, max: MAX_DAY });
	const nextDriverNumber = readInteger(fields.nextDriverNumber, `${path}.nextDriverNumber`, { min: 1 });
	if (!(fields.convoy instanceof Convoy)) throw new ReaderTypeError(`${path}.convoy must be a Convoy, got ${describeValue(fields.convoy)}`);
	const drivers = readDrivers(fields.drivers, `${path}.drivers`, nextDriverNumber, previous);
	const runDecks = readRunDecks(fields.runDecks, `${path}.runDecks`, { drivers, convoy: fields.convoy, held: previous.runDecks });
	const foundOnRun = readFound(fields.foundOnRun, `${path}.foundOnRun`, { drivers, runDecks, held: previous.foundOnRun });
	const supplyRun = readSupplyRunField(fields.supplyRun, `${path}.supplyRun`, { convoy: fields.convoy, runDecks, held: previous.supplyRun });
	// A run out has its id handed out already, so the counter has passed it
	const nextRunNumber = readInteger(fields.nextRunNumber, `${path}.nextRunNumber`, { min: runDecks.length > 0 ? 2 : 1 });
	const resources = readResources(fields.resources, `${path}.resources`);
	const tally = readTally(fields.tally, `${path}.tally`);
	if (previous.tally !== undefined) checkTallyGrows({ from: previous.tally, to: tally, path: `${path}.tally` });
	// Every run that ended had an id handed out, and the run out has one too; a load out given up used one and ended nothing
	const runsSetOff = nextRunNumber - 1 - (runDecks.length > 0 ? 1 : 0);
	if (tally.runsHome + tally.runsFailed > runsSetOff) {
		const handedOut = `${nextRunNumber - 1} run ids handed out${runDecks.length > 0 ? ', one of them the run out' : ''}`;
		throw new ReaderRangeError(`${path}.tally counts ${tally.runsHome + tally.runsFailed} runs home or failed, and only ${runsSetOff} could have ended, with ${handedOut}`);
	}
	const end = readCampaignEnd(fields.end, `${path}.end`);
	if (end !== null) readEndHolds({ end, drivers, people: resources.people, runDecks, path: `${path}.end` });
	return {
		seed,
		generatorVersion: readInteger(fields.generatorVersion, `${path}.generatorVersion`, { min: 1 }),
		mapParams,
		map: readMapState(fields.map, `${path}.map`),
		day,
		resources,
		unrest: readInteger(fields.unrest, `${path}.unrest`, { min: 0 }),
		drivers,
		nextDriverNumber,
		locker: readCardCounts(fields.locker, `${path}.locker`),
		convoy: fields.convoy,
		nextRunNumber,
		runDecks,
		foundOnRun,
		supplyRun,
		strongholdsTaken: readStrongholds(fields.strongholdsTaken, `${path}.strongholdsTaken`),
		log: readLog(fields.log, `${path}.log`, day, previous.log),
		tally,
		end
	};
}

/**
 * The supply run: none, or one on the road with its run decks out. One held
 * before was checked when it was stored, and its escorts leave the convoy
 * outside the campaign's checks, so `toSaveText` checks that tie; the run
 * decks can go without it, so they're checked every time.
 */
function readSupplyRunField(
	value: unknown,
	path: string,
	{ convoy, runDecks, held }: { convoy: Convoy; runDecks: readonly RunDeck[]; held?: SupplyRun | null }
): SupplyRun | null {
	const run = held !== undefined && value === held ? held : readNullable(value, path, (given, at) => readSupplyRun(given, at, { convoy, readCargo: readResources }));
	if (run !== null && runDecks.length === 0) throw new ReaderRangeError(`${path} is on the road with no run out; the run's end clears it with the run decks`);
	return run;
}

/**
 * Drivers found on the run out: none at home, and while a run is out,
 * drivers from the pool, each listed once, missing, and not seated (a seat
 * whose run failed is settled first). Found drivers held before had their
 * one-by-one checks when they were stored, but the run decks can change
 * without them, so the run out and the seats are checked every time; their
 * records change outside the campaign's checks, so `toSaveText` checks
 * they're still missing.
 */
function readFound(
	value: unknown,
	path: string,
	{ drivers, runDecks, held }: { drivers: readonly DriverRecord[]; runDecks: readonly RunDeck[]; held?: readonly DriverRecord[] }
): readonly DriverRecord[] {
	const wasHeld = held !== undefined && value === held;
	const found = wasHeld ? held : readFoundDrivers(value, path, drivers);
	// Checked whatever was held, since the run decks can change without the found
	if (found.length > 0 && runDecks.length === 0) throw new ReaderRangeError(`${path} holds ${found.length} found with no run out; they come home with the run, or stay missing`);
	found.forEach((driver, index) => {
		if (runDecks.some(deck => deck.driver === driver)) throw new ReaderRangeError(`${path}[${index}] ${driver.id} is seated on the run`);
	});
	if (!wasHeld) readFoundTies({ found, path });
	return found;
}

/** Found drivers checked one by one: records from the pool, each listed once. */
function readFoundDrivers(value: unknown, path: string, drivers: readonly DriverRecord[]): readonly DriverRecord[] {
	const found = Array.from(readArray(value, path), (driver, index) => {
		if (!(driver instanceof DriverRecord)) throw new ReaderTypeError(`${path}[${index}] must be a DriverRecord, got ${describeValue(driver)}`);
		if (!drivers.includes(driver)) throw new ReaderRangeError(`${path}[${index}] ${driver.id} isn't in the pool`);
		return driver;
	});
	found.forEach((driver, index) => {
		if (found.indexOf(driver) !== index) throw new ReaderRangeError(`${path}[${index}] ${driver.id} is listed twice`);
	});
	return Object.freeze(found);
}

/** Each found driver still missing, which records changing outside the campaign could undo. */
function readFoundTies({ found, path }: { found: readonly DriverRecord[]; path: string }): void {
	found.forEach((driver, index) => {
		if (driver.status !== 'missing') throw new ReaderRangeError(`${path}[${index}] ${driver.id} must be missing until the run brings them home, got ${describeValue(driver.status)}`);
	});
}

/** Refuses an end with a run still out, or a cause the campaign doesn't show. */
function readEndHolds({ end, drivers, people, runDecks, path }: {
	end: CampaignEnd;
	drivers: readonly DriverRecord[];
	people: number;
	runDecks: readonly RunDeck[];
	path: string;
}): void {
	if (runDecks.length > 0) throw new ReaderRangeError(`${path} can't be set with a run out; the run ends first`);
	if (end.cause === 'no_people' && people > 0) throw new ReaderRangeError(`${path}.cause is no_people, and the compound has ${people} People`);
	if (end.cause === 'last_driver') {
		if (drivers.length === 0) throw new ReaderRangeError(`${path}.cause is last_driver, and the pool has never had a driver`);
		const here = drivers.find(driver => isAtCompound(driver));
		if (here !== undefined) throw new ReaderRangeError(`${path}.cause is last_driver, and ${describeDriver(here)} is ${here.status}`);
	}
}

/**
 * The run decks: none at home, or one for each seated driver from the
 * pool, two at most (a run down to one driver seats one), whose default
 * decks are empty while they're out, with escort cards the convoy's
 * escorts brought. Run decks held before were checked when they were
 * stored, and their drivers stay in the pool; records and the convoy
 * change outside the campaign's checks, so `toSaveText` checks those ties
 * again.
 */
function readRunDecks(
	value: unknown,
	path: string,
	{ drivers, convoy, held }: { drivers: readonly DriverRecord[]; convoy: Convoy; held?: readonly RunDeck[] }
): readonly RunDeck[] {
	if (held !== undefined && value === held) return held;
	const decks = Array.from(readArray(value, path), (deck, index) => {
		if (!(deck instanceof RunDeck)) throw new ReaderTypeError(`${path}[${index}] must be a RunDeck, got ${describeValue(deck)}`);
		if (!drivers.includes(deck.driver)) throw new ReaderRangeError(`${path}[${index}].driver ${deck.driver.id} isn't in the pool`);
		return deck;
	});
	if (decks.length > PLAYER_DRIVEN_VEHICLES) {
		throw new ReaderRangeError(`${path} holds ${decks.length} run decks: a run out has one for each of its seats, two at most, and none are kept at home`);
	}
	if (decks.length === 2 && decks[0].driver === decks[1].driver) {
		throw new ReaderRangeError(`${path}[1].driver ${decks[1].driver.id} has the run deck before it; each seat is a different driver`);
	}
	readRunDeckTies({ decks, convoy, path });
	return Object.freeze(decks);
}

/**
 * What run decks rely on that changes outside the campaign's checks: each
 * seated driver's default deck, empty while it's in their run deck, and
 * each escort card's escort, still in the convoy, the card its signature
 * card, and held by one run deck only.
 */
function readRunDeckTies({ decks, convoy, path }: { decks: readonly RunDeck[]; convoy: Convoy; path: string }): void {
	decks.forEach(({ driver }, index) => {
		if (totalCards(driver.defaultDeck) > 0) {
			throw new ReaderRangeError(`${path}[${index}].driver ${driver.id} holds cards in their default deck, ${describeValue(driver.defaultDeck)}, which is in their run deck while a run is out`);
		}
	});
	const seen = new Set<string>();
	decks.forEach((deck, index) => deck.escortCards.forEach((card, cardIndex) => {
		const at = `${path}[${index}].escortCards[${cardIndex}]`;
		const escort = convoy.escorts.find(owned => owned.convoyId === card.broughtBy);
		if (escort === undefined) throw new ReaderRangeError(`${at}.broughtBy ${card.broughtBy} isn't an escort in the convoy`);
		const signature = escort.escort?.signatureCard ?? null;
		if (card.cardType !== signature) {
			throw new ReaderRangeError(`${at}.cardType must be ${describeValue(signature)}, the card ${escort.name} (${card.broughtBy}) brings, got ${describeValue(card.cardType)}`);
		}
		if (seen.has(card.broughtBy)) throw new ReaderRangeError(`${at}.broughtBy ${card.broughtBy} brought a card into the run deck before it; an escort brings one`);
		seen.add(card.broughtBy);
	}));
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

export function readResources(value: unknown, path: string): Readonly<Resources> {
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
	const ids = Array.from(readArray(value, path), (id, index) => readText(id, `${path}[${index}]`));
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
	return Array.from(entries, (entry, offset) => {
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
