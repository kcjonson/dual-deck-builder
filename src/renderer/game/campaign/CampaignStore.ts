import { EventEmitter } from '../core/EventEmitter';
import { describeValue } from '../core/Json';
import { AREA_MAP_GENERATOR_VERSION } from '../map/GeneratorVersion';
import { ReaderTypeError, isReaderError, readFields, readInteger, readObject } from '../core/JsonReader';
import { CAMPAIGN_SCHEMA_VERSION, Campaign, LoadOptions, logWarning } from './Campaign';
import { CampaignEnding, CampaignHistoryEntry, historyEntry, historyToJson, readHistory, sameEntry } from './CampaignHistory';
import { LocalSaveStorage, SaveStorage, isQuotaError, storageTrouble } from './SaveStorage';

type Slot = 'a' | 'b';

const SLOTS: readonly Slot[] = ['a', 'b'];

/** One build's storage keys. The save lives in one of two slots, and `active` names which. */
export interface CampaignKeys {
	readonly active: string;
	readonly slots: Readonly<Record<Slot, string>>;
	/** Where a damaged save is copied before anything could write over it. */
	readonly recovery: string;
	readonly history: string;
	readonly historyRecovery: string;
}

/** The keys for one build's saves: each namespace gets keys of its own. */
export function campaignKeys(namespace: string): CampaignKeys {
	const prefix = `dual-deckbuilder.campaign[${namespace}]`;
	return {
		active: `${prefix}.active`,
		slots: { a: `${prefix}.a`, b: `${prefix}.b` },
		recovery: `${prefix}.recovery`,
		history: `${prefix}.history`,
		historyRecovery: `${prefix}.history-recovery`
	};
}

const DEV_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]', '::1'];

/**
 * The namespace of the build a page belongs to. Main deploys to
 * /playtest/dual-deckbuilder/ and each PR's playtest build to
 * /playtest/dual-deckbuilder/<branch>/, all on one origin, so it's the
 * directory the page was served from; the desktop build's `file://` page
 * and a localhost dev server each get a fixed one.
 */
export function pageNamespace({ protocol, hostname, pathname }: Pick<Location, 'protocol' | 'hostname' | 'pathname'>): string {
	if (protocol === 'file:') return 'desktop';
	if (DEV_HOSTS.includes(hostname)) return 'dev';
	return `/${pathname.slice(0, pathname.lastIndexOf('/') + 1)}`.replace(/\/{2,}/g, '/');
}

/**
 * Whether there's a campaign to continue: none; one saved by this version
 * of the save format, which Continue opens (a damaged one fails to load,
 * saying so); or one saved by another version, or whose map another version
 * of the area map generator made, which this build can't continue.
 */
export type SaveStatus = 'none' | 'saved' | 'outdated';

/**
 * Why a store call failed: storage threw (full, blocked); a save or the
 * history is damaged; the campaign can't be written (it holds something a
 * save couldn't load back); or it's retired (it has ended, its save was
 * deleted, a new campaign replaced it, or another page saved over the save
 * or ended it), so it isn't saved again.
 */
export type CampaignStoreFailure = 'storage' | 'damaged' | 'unsavable' | 'retired';

/** A store call that failed. The message is for the player; `detail` and `cause` say what went wrong underneath. */
export class CampaignStoreError extends Error {
	public readonly reason: CampaignStoreFailure;
	/** The underlying error's message: a reader's path-named error, or storage's own. */
	public readonly detail: string;
	public readonly cause: unknown;

	constructor({ reason, message, cause }: { reason: CampaignStoreFailure; message: string; cause: unknown }) {
		super(message);
		this.name = 'CampaignStoreError';
		this.reason = reason;
		this.cause = cause;
		this.detail = describeError(cause);
	}
}

export type SaveFailedListener = (error: CampaignStoreError) => void;

/**
 * How a checkpoint went: the campaign is saved; its end is in the history
 * (a campaign that's over is ended, not saved, by this checkpoint or a call
 * before it); it failed, and `onSaveFailed` heard why; or the store has
 * moved on from this instance (the save was loaded again, deleted, or
 * replaced, here or in another page), so nothing was saved, and nobody is
 * told.
 */
export type CheckpointResult = 'saved' | 'ended' | 'failed' | 'retired';

export interface CampaignStoreOptions {
	storage: SaveStorage;
	/** The build whose saves these are. The page's (`pageNamespace`) when left out. */
	namespace?: string;
	/** The save format version stamped on every save and history list. `CAMPAIGN_SCHEMA_VERSION` when left out. */
	version?: number;
	/**
	 * The area map generator version a saved campaign's map has to be from:
	 * one recorded at another can't be made again here, so its save is
	 * outdated. `AREA_MAP_GENERATOR_VERSION` when left out.
	 */
	generatorVersion?: number;
	/**
	 * Hears map param repairs on load, a history set aside or started over,
	 * and a copy too big for full storage. Logs them by default. A callback
	 * that throws or rejects is logged and changes nothing.
	 */
	onWarning?: (warning: string) => void;
}

const LOADING = "The saved campaign couldn't be read";
const SAVING = "The campaign couldn't be saved";
const DELETING = "The saved campaign couldn't be deleted";
const READING_HISTORY = "Campaign history couldn't be read";
const ENDING = "The campaign couldn't be ended";

/** What the player reads when a save or the history is damaged. */
const DAMAGED = {
	campaign: "The saved campaign is damaged and can't be loaded. It's been kept.",
	history: "Campaign history is damaged and can't be shown. It's been kept."
} as const;

/** What a slot's text is to this build: a save it loads, one stamped with another version, or damage. */
type Verdict = 'current' | 'outdated' | 'damaged';

/** Texts whose verdicts are kept, so storage that keeps failing doesn't parse the same save over and over. */
const REMEMBERED_VERDICTS = 4;

/** What storage holds, read at the start of a call. */
interface Survey {
	/** What `active` holds, whatever it is. */
	pointer: string | null;
	texts: Readonly<Record<Slot, string | null>>;
	/** The slot holding the save, by the rule in the class comment; null when there's none. */
	save: Slot | null;
	/** `active` names the save's slot, so the other slot holds only the save before it. */
	named: boolean;
}

/**
 * One run of the save: every instance loaded from it or saved as it shares
 * one, and `retired` says why once it's over.
 */
interface Lineage {
	retired?: string;
	/** The history entry the end that retired it recorded. */
	ended?: CampaignHistoryEntry;
}

/** A checkpoint waiting its turn, which later checkpoints of its campaign join. */
interface Waiting {
	readonly campaign: Campaign;
	/** Replaced by a checkpoint that joins after it was taken, so the write holds the latest step. */
	snapshot: Snapshot;
	readonly result: Promise<CheckpointResult>;
}

/**
 * The campaign in progress and the history of past ones, for one build,
 * persisted through a `SaveStorage`: local storage in both builds, a map in
 * tests. One active save, and a history list kept apart from it.
 *
 * A campaign that's over (`Campaign.end`) is never written as the save: a
 * save or checkpoint of one ends it in the store instead, as `end` does, so
 * the step that lost the campaign puts its line in the history and removes
 * its save.
 *
 * Saves are per build. Every key carries the build's namespace, and every
 * save and history list carries the save format version
 * (`CAMPAIGN_SCHEMA_VERSION`). A save stamped with another version, an
 * integer other than this one, isn't loaded: `saveStatus` calls it
 * outdated, `load` passes it by, and a new campaign or a delete replaces it
 * without a copy. A history stamped with another version starts over. There
 * are no migrations. Anything else that can't be read is damaged, whatever
 * threw while reading it, a bug included, so one bad save can't lock the
 * player out: only `load` fails on it.
 *
 * Screens call `checkpoint` at the end of each step that changes the
 * campaign: a stop, arriving home, a compound action. A save or checkpoint
 * captures the campaign in the first microtask after the call, so it holds
 * everything that runs synchronously after the call too, and writes that
 * text when its turn comes behind every call made before it. So start the
 * next step only after awaiting the checkpoint, or on a later frame, never
 * in the same synchronous run.
 *
 * A write goes into the slot that isn't the save's, then `active` switches
 * to it, so a crash part way leaves the save before. `active` naming a slot
 * with text in it decides the save, and the other slot then holds only the
 * save before it. Otherwise (no `active`, an empty one, one naming an empty
 * slot, or anything else) the save is the newest that loads, by the write
 * count each save carries, and with none there's no save. A damaged save is
 * copied to the recovery key before anything writes over it or removes it:
 * the save's own slot when `active` moves off it or it's removed, and any
 * slot no `active` vouches for. The one exception is a delete the player
 * asks for when storage is too full for the copy.
 *
 * Every campaign instance the store loads or saves is tagged with the
 * lineage of the save it belongs to, and only the current lineage's
 * instances are saved. Loading the save, ending its campaign, deleting it,
 * and saving a new campaign each start a new lineage, so the instance a
 * load hands out is the only one that saves, and a screen still holding an
 * older one can't write it back.
 *
 * The lineage lives in this store's memory, out of reach of another page of
 * the build (a second tab), so a write or an end first checks the save
 * hasn't changed under it. A campaign this store loaded or saved needs the
 * save as this store left it, the text it last wrote or loaded in that slot;
 * a new campaign replaces only the save this store last found, once it has
 * looked. Otherwise another page has saved over the save or ended it, and the
 * call is refused as `retired`; a removal this store owes is dropped once
 * another page has written a save. The check and the write aren't one step
 * across tabs, so two writes a few milliseconds apart can still both land,
 * until a single-writer lock (DDB-415).
 */
export class CampaignStore extends EventEmitter {
	private static sharedInstance: CampaignStore | null = null;

	private readonly storage: SaveStorage;
	private readonly keys: CampaignKeys;
	private readonly version: number;
	private readonly generatorVersion: number;
	private readonly onWarning: (warning: string) => void;
	/** The save's lineage now. */
	private current: Lineage = {};
	private readonly lineages = new WeakMap<Campaign, Lineage>();
	/** A lineage that ended while removing its save failed part way; the next call that reads the save finishes the removal first. */
	private owed: Lineage | null = null;
	/** Text this store wrote to a slot, read there and loaded, or copied to recovery: safe to write over. */
	private readonly known = new Map<Slot, string>();
	/**
	 * The save's text as this store last found or left it, null for no save.
	 * Undefined before it has looked, and while a write or removal is under
	 * way, since one that fails part way leaves it unsure.
	 */
	private seen: string | null | undefined = undefined;
	private readonly verdicts = new Map<string, Verdict>();
	/** The tail of the calls waiting their turn. */
	private queue: Promise<void> = Promise.resolve();
	private waiting: Waiting | null = null;

	constructor({ storage, namespace = pageNamespaceHere(), version = CAMPAIGN_SCHEMA_VERSION, generatorVersion = AREA_MAP_GENERATOR_VERSION, onWarning = logWarning }: CampaignStoreOptions) {
		super();
		this.storage = storage;
		this.keys = campaignKeys(namespace);
		this.version = version;
		this.generatorVersion = generatorVersion;
		this.onWarning = onWarning;
	}

	/** The game's store, over local storage, in the page's namespace. */
	public static get shared(): CampaignStore {
		if (!this.sharedInstance) this.sharedInstance = new CampaignStore({ storage: new LocalSaveStorage() });
		return this.sharedInstance;
	}

	/** What the main menu shows Continue on, without loading the save. */
	public saveStatus(): Promise<SaveStatus> {
		return this.enqueue(async () => {
			await this.settleOwed(LOADING);
			const survey = await this.survey(LOADING);
			this.seen = saveTextOf(survey);
			if (survey.save === null) return 'none';
			return this.isOutdated(survey.texts[survey.save] as string) ? 'outdated' : 'saved';
		});
	}

	/** Whether there's a save this version of the game can continue. */
	public async hasSave(): Promise<boolean> {
		return (await this.saveStatus()) === 'saved';
	}

	/**
	 * The campaign in progress: what Continue opens. It's the only instance
	 * of the campaign that saves from then on; any loaded or saved before it
	 * is retired. Null when there's none, or when another version saved it
	 * (`saveStatus` says which). Rejects with a `CampaignStoreError` when
	 * storage fails or the save is damaged; a damaged save is copied to the
	 * recovery key and left where it was. A throw that isn't a reader's is
	 * taken as damage too, and logged as an error, since it's likely a bug.
	 */
	public load({ onWarning = this.onWarning }: LoadOptions = {}): Promise<Campaign | null> {
		return this.enqueue(async () => {
			const warnings: string[] = [];
			try {
				await this.settleOwed(LOADING);
				const survey = await this.survey(LOADING);
				this.seen = saveTextOf(survey);
				if (survey.save === null) return null;
				const slot = survey.save;
				const text = survey.texts[slot] as string;
				let campaign: Campaign | null;
				try {
					campaign = this.readSave(text, warning => { warnings.push(warning); });
				} catch (error) {
					// Anything that throws on a save of this version is damage, so one bad save can't lock the player out.
					if (!isDamage(error)) console.error('CampaignStore: reading the save threw something other than a reader error; kept it as damaged', error);
					await this.keepAside({ slot, text, action: LOADING }).catch(logKeepAsideFailure);
					throw new CampaignStoreError({ reason: 'damaged', message: DAMAGED.campaign, cause: error });
				}
				if (campaign === null) return null;
				this.known.set(slot, text);
				// The instance handed out now is the one that saves; any from before, a screen left running, is retired.
				this.retire('the save was loaded again');
				this.lineages.set(campaign, this.current);
				return campaign;
			} finally {
				deliver(warnings, onWarning);
			}
		});
	}

	/**
	 * Writes the campaign as the save. One the store hasn't loaded or saved
	 * before is a new campaign, which replaces the save. Rejects with a
	 * `CampaignStoreError`, keeping the save before, when storage fails or the
	 * campaign is retired or can't be written; as `retired`, too, when another
	 * page has changed the save since this store last saw it (the class
	 * comment says how that's told). Founding (DDB-284) saves the
	 * new campaign with this; later saves go through `checkpoint`. A campaign
	 * that's over is ended instead, as `end` ends it.
	 */
	public save(campaign: Campaign): Promise<void> {
		const snapshot = new Snapshot({ campaign });
		return this.enqueue(async () => {
			await this.write({ campaign, snapshot });
		});
	}

	/**
	 * Saves the campaign at the end of a step, for screens to call after
	 * each one. Checkpoints of one campaign share a write while it waits its
	 * turn, and the write holds the latest of their steps; any other call in
	 * between ends the sharing. Never rejects: resolves to how it went
	 * (`CheckpointResult`). A failure goes to `onSaveFailed` listeners
	 * (logged when none listen); a retired campaign, which the game has moved
	 * on from, tells nobody. A campaign that's over is ended instead, as `end`
	 * ends it, so the checkpoint after the step that lost it writes its
	 * history line, once: it resolves 'ended' when the end is recorded and
	 * the save removed, and so does every checkpoint of it after that, which
	 * records nothing more.
	 */
	public checkpoint(campaign: Campaign): Promise<CheckpointResult> {
		const joining = this.waiting;
		if (joining !== null && joining.campaign === campaign) {
			// Its snapshot has been taken, so this step came after it.
			if (joining.snapshot.taken) joining.snapshot = new Snapshot({ campaign });
			return joining.result;
		}
		const waiting: Waiting = {
			campaign,
			snapshot: new Snapshot({ campaign }),
			result: this.enqueue(() => {
				if (this.waiting === waiting) this.waiting = null;
				return this.write({ campaign, snapshot: waiting.snapshot });
			}).catch((error: unknown) => this.checkpointFailed({ campaign, error }))
		};
		this.waiting = waiting;
		return waiting.result;
	}

	/** Hears every checkpoint that failed to save. Returns the function that removes the listener. */
	public onSaveFailed(listener: SaveFailedListener): () => void {
		return this.on('saveFailed', (failure: CampaignStoreError) => catchRejection(listener(failure), 'a save-failed listener'));
	}

	/**
	 * Removes the save, as when the player abandons it without a line in the
	 * history, and retires its campaign. A damaged save is copied to the
	 * recovery key first, unless storage is too full to hold the copy: the
	 * player asked, so that doesn't stop them. With no save there's nothing to
	 * remove, but any instance of the save's campaign is retired all the same.
	 */
	public delete(): Promise<void> {
		return this.enqueue(async () => {
			const warnings: string[] = [];
			try {
				const survey = await this.survey(DELETING);
				for (const slot of this.slotsToKeep(survey)) {
					try {
						await this.protect({ slot, text: survey.texts[slot], action: DELETING });
					} catch (error) {
						if (!(error instanceof CampaignStoreError) || !isQuotaError(error.cause)) throw error;
						warnings.push(`CampaignStore: storage was too full to keep a copy of the damaged save in slot ${slot}; deleted it anyway`);
						// The player has given it up, so it's this store's to remove, should the removal fail part way and be owed.
						this.known.set(slot, survey.texts[slot] as string);
					}
				}
				this.owed = this.retire('its save was deleted');
				await this.remove({ survey, action: DELETING });
				this.owed = null;
			} finally {
				deliver(warnings, this.onWarning);
			}
		});
	}

	/**
	 * The campaign is over: its line goes into the history, as it stood when
	 * this was called, and it can't be saved again. If it's the save's
	 * campaign (whichever instance of it), the save goes too; one the store
	 * never loaded or saved leaves the save alone. A campaign that's over
	 * (`Campaign.end`) goes in with its own ending, whatever `ending` says;
	 * one still going needs `ending`, abandoned or won. Rejects with
	 * 'retired', recording nothing, for a campaign that has already ended or
	 * been deleted or replaced, here or in another page, except to finish
	 * removing a save an earlier end couldn't. An entry equal to the newest
	 * isn't added twice. Resolves to the entry.
	 */
	public end({ campaign, ending }: { campaign: Campaign; ending?: CampaignEnding }): Promise<CampaignHistoryEntry> {
		let entry: CampaignHistoryEntry;
		try {
			entry = historyEntry({ campaign, ending });
		} catch (error) {
			return Promise.reject(new CampaignStoreError({ reason: 'unsavable', message: `${ENDING}: a campaign still standing is won or abandoned, not ${describeValue(ending)}.`, cause: error }));
		}
		return this.enqueue(() => this.close({ campaign, entry }));
	}

	/**
	 * Past campaigns, newest first; none when another version stamped the
	 * list, which the next ending starts over. Rejects with a
	 * `CampaignStoreError` when storage fails, or the history is damaged (and
	 * copied to its recovery key).
	 */
	public history(): Promise<CampaignHistoryEntry[]> {
		return this.enqueue(async () => {
			const text = await this.read(this.keys.history, READING_HISTORY);
			if (text === null) return [];
			try {
				return readHistory(JSON.parse(text), { version: this.version }) ?? [];
			} catch (error) {
				if (!isDamage(error)) throw error;
				await this.setAside({ key: this.keys.historyRecovery, text, action: READING_HISTORY }).catch(logKeepAsideFailure);
				throw new CampaignStoreError({ reason: 'damaged', message: DAMAGED.history, cause: error });
			}
		});
	}

	/** Runs the task once every call before it has settled. Any call ends checkpoint sharing; a checkpoint then starts its own. */
	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		this.waiting = null;
		const result = this.queue.then(task);
		this.queue = result.then(settled, settled);
		return result;
	}

	private async survey(action: string): Promise<Survey> {
		const pointer = await this.read(this.keys.active, action);
		const texts = { a: await this.read(this.keys.slots.a, action), b: await this.read(this.keys.slots.b, action) };
		if (isSlot(pointer) && texts[pointer] !== null) return { pointer, texts, save: pointer, named: true };
		// With nothing naming the save, the newest that loads.
		const loading = SLOTS.filter(slot => texts[slot] !== null && this.verdict(texts[slot] as string) === 'current');
		const save = loading.reduce<Slot | null>((newest, slot) => newest === null || sequenceOf(texts[slot]) > sequenceOf(texts[newest]) ? slot : newest, null);
		return { pointer, texts, save, named: false };
	}

	/**
	 * Ends the campaign in the store: its history line, then its save
	 * removed, as `end` describes.
	 */
	private async close({ campaign, entry }: { campaign: Campaign; entry: CampaignHistoryEntry }): Promise<CampaignHistoryEntry> {
		const warnings: string[] = [];
		try {
			const lineage = this.lineages.get(campaign);
			if (lineage !== undefined && lineage === this.owed) {
				// Its save's removal failed part way: finish it, and answer with what the end that retired it recorded.
				await this.settleOwed(ENDING);
				if (lineage.ended !== undefined) return lineage.ended;
			}
			this.refuseRetired(campaign, ENDING);
			if (lineage === undefined) {
				await this.record({ entry, warnings });
				this.lineages.set(campaign, { retired: 'it has ended', ended: entry });
				return entry;
			}
			const survey = await this.survey(ENDING);
			this.refuseChanged({ campaign, survey, action: ENDING });
			for (const slot of this.slotsToKeep(survey)) await this.protect({ slot, text: survey.texts[slot], action: ENDING });
			await this.record({ entry, warnings });
			const ended = this.retire('it has ended');
			ended.ended = entry;
			this.owed = ended;
			await this.remove({ survey, action: ENDING });
			this.owed = null;
			return entry;
		} finally {
			deliver(warnings, this.onWarning);
		}
	}

	/**
	 * The snapshot into the slot that isn't the save's, then `active`
	 * switched to it; or, for a campaign that's over, its end. A campaign
	 * that's over can't change, so it's read as it is when its turn comes.
	 */
	private async write({ campaign, snapshot }: { campaign: Campaign; snapshot: Snapshot }): Promise<'saved' | 'ended'> {
		if (campaign.isOver) {
			await this.close({ campaign, entry: historyEntry({ campaign }) });
			return 'ended';
		}
		this.refuseRetired(campaign, SAVING);
		const body = snapshot.take();
		const survey = await this.survey(SAVING);
		this.refuseChanged({ campaign, survey, action: SAVING });
		const save = survey.save;
		const text = stamp({ version: this.version, sequence: Math.max(sequenceOf(survey.texts.a), sequenceOf(survey.texts.b)) + 1, campaign: body });
		if (save !== null && survey.texts[save] === stamp({ version: this.version, sequence: sequenceOf(survey.texts[save]), campaign: body })) {
			// Nothing has changed since the save. Naming it in `active` makes the other slot the save before, which
			// nothing protects again, so that slot is kept first when nothing vouched for it.
			this.known.set(save, survey.texts[save] as string);
			if (!survey.named) await this.protect({ slot: otherSlot(save), text: survey.texts[otherSlot(save)], action: SAVING });
			if (survey.pointer !== save) await this.put(this.keys.active, save, SAVING);
			this.seen = survey.texts[save];
			this.adopt(campaign);
			return 'saved';
		}
		const next: Slot = save === null ? 'a' : otherSlot(save);
		// The save's own slot stops being the save once `active` moves off it; with no `active` naming the save,
		// the slot about to be written could hold anything.
		if (save !== null) await this.protect({ slot: save, text: survey.texts[save], action: SAVING });
		if (!survey.named) await this.protect({ slot: next, text: survey.texts[next], action: SAVING });
		this.seen = undefined;
		await this.put(this.keys.slots[next], text, SAVING);
		this.known.set(next, text);
		await this.put(this.keys.active, next, SAVING);
		this.seen = text;
		this.adopt(campaign);
		return 'saved';
	}

	/**
	 * Refuses a write or an end as `retired`, and retires the campaign so it
	 * isn't tried again, when another page has changed the save since this
	 * store last saw it. A campaign this store loaded or saved needs the save
	 * as this store left it (`isOwnSave`). A new campaign replaces only the
	 * save this store last found (`seen`), or anything while it hasn't looked
	 * or can't be sure, and where there's no save it loses nothing.
	 */
	private refuseChanged({ campaign, survey, action }: { campaign: Campaign; survey: Survey; action: string }): void {
		const tagged = this.lineages.has(campaign);
		const text = saveTextOf(survey);
		let why: string | null;
		if (tagged) why = text === null ? 'another tab ended it' : this.isOwnSave(survey) ? null : 'another tab saved over it';
		else why = this.seen === undefined || text === null || text === this.seen ? null : 'another tab started a campaign in the meantime';
		if (why === null) return;
		if (tagged) this.retire(why);
		else this.lineages.set(campaign, { retired: why });
		this.refuseRetired(campaign, action);
	}

	/**
	 * Whether the save is as this store left it: the text it last wrote or
	 * loaded in that slot. A write of its own that failed part way still is,
	 * whichever slot it left as the save; another page's write never is, since
	 * each write carries one more in the build's run of writes.
	 */
	private isOwnSave(survey: Survey): boolean {
		return survey.save !== null && survey.texts[survey.save] === this.known.get(survey.save);
	}

	private refuseRetired(campaign: Campaign, action: string): void {
		const why = this.lineages.get(campaign)?.retired;
		if (why === undefined) return;
		throw new CampaignStoreError({ reason: 'retired', message: `${action}: ${why}.`, cause: new Error(`The store doesn't save or end a campaign once ${why}`) });
	}

	/** Makes a just-written campaign the save's. One the store hadn't tagged is a new campaign, which starts a lineage. */
	private adopt(campaign: Campaign): void {
		if (this.lineages.has(campaign)) return;
		this.retire('a new campaign replaced it');
		this.lineages.set(campaign, this.current);
		this.owed = null;
	}

	/** Retires every instance of the current lineage, starts the next, and returns the one retired. */
	private retire(why: string): Lineage {
		const ended = this.current;
		ended.retired = why;
		this.current = {};
		return ended;
	}

	/** The slots a removal takes, the other slot first and the save's last, so a crash part way leaves the save or nothing. */
	private slotsToRemove(survey: Survey): Slot[] {
		if (survey.save === null) return [];
		const other = otherSlot(survey.save);
		return survey.texts[other] === null ? [survey.save] : [other, survey.save];
	}

	/** Of the slots a removal takes, those whose text might need keeping: the save's, and the other unless `active` vouches for it. */
	private slotsToKeep(survey: Survey): Slot[] {
		return this.slotsToRemove(survey).filter(slot => slot === survey.save || !survey.named);
	}

	/** Removes the save's slots, then `active`. */
	private async remove({ survey, action }: { survey: Survey; action: string }): Promise<void> {
		this.seen = undefined;
		for (const slot of this.slotsToRemove(survey)) {
			await this.drop(this.keys.slots[slot], action);
			this.known.delete(slot);
		}
		if (survey.pointer !== null) await this.drop(this.keys.active, action);
		this.seen = null;
	}

	/**
	 * Finishes removing the save of a lineage that ended while its removal
	 * failed part way, unless another page has written a save since: that
	 * one's campaign has taken its place, so nothing is owed.
	 */
	private async settleOwed(action: string): Promise<void> {
		if (this.owed === null) return;
		const survey = await this.survey(action);
		if (survey.save !== null && !this.isOwnSave(survey)) {
			this.owed = null;
			return;
		}
		for (const slot of this.slotsToKeep(survey)) await this.protect({ slot, text: survey.texts[slot], action });
		await this.remove({ survey, action });
		this.owed = null;
	}

	/**
	 * Before a slot is written over or removed: copies a damaged save in it to
	 * the recovery key, unless it's text this store wrote, read, or copied
	 * there before. Throws, leaving the slot as it is, when the copy fails.
	 */
	private async protect({ slot, text, action }: { slot: Slot; text: string | null; action: string }): Promise<void> {
		if (text === null || text === this.known.get(slot)) return;
		if (this.verdict(text) === 'damaged') await this.keepAside({ slot, text, action });
		else this.known.set(slot, text);
	}

	private async keepAside({ slot, text, action }: { slot: Slot; text: string; action: string }): Promise<void> {
		await this.setAside({ key: this.keys.recovery, text, action });
		this.known.set(slot, text);
	}

	/**
	 * Puts the entry at the top of the history, unless it's there already. A
	 * history another version stamped starts over; a damaged one is copied to
	 * its recovery key first.
	 */
	private async record({ entry, warnings }: { entry: CampaignHistoryEntry; warnings: string[] }): Promise<void> {
		const text = await this.read(this.keys.history, ENDING);
		let entries: CampaignHistoryEntry[] = [];
		if (text !== null) {
			try {
				const stored = readHistory(JSON.parse(text), { version: this.version });
				if (stored === null) warnings.push('CampaignStore: started a new history over one another version of the game saved');
				entries = stored ?? [];
			} catch (error) {
				if (!isDamage(error)) throw error;
				await this.setAside({ key: this.keys.historyRecovery, text, action: ENDING });
				warnings.push(`CampaignStore: set a damaged history aside and started a new one: ${describeError(error)}`);
			}
		}
		if (entries.length > 0 && sameEntry(entries[0], entry)) return;
		await this.put(this.keys.history, JSON.stringify(historyToJson({ version: this.version, entries: [entry, ...entries] })), ENDING);
	}

	/**
	 * A save's campaign: null when another version stamped it, an integer
	 * other than this one, or when its campaign's map is from another
	 * generator version, an integer other than this build's, since the map
	 * can't be made again. The versions are checked first, so only a save of
	 * this version has to be well formed. Anything else, a stamp with no
	 * version or one that isn't an integer included, is damaged, and throws a
	 * SyntaxError or a reader error (or, from a bug, anything at all).
	 */
	private readSave(text: string, onWarning: (warning: string) => void): Campaign | null {
		const save = readObject(JSON.parse(text), 'Save');
		if (isOtherVersion(save.version, this.version)) return null;
		const fields = readFields(save, 'Save', ['version', 'sequence', 'campaign']);
		if (fields.version !== this.version) throw new ReaderTypeError(`Save.version must be an integer, got ${describeValue(fields.version)}`);
		readInteger(fields.sequence, 'Save.sequence', { min: 1 });
		if (isOtherGenerator(fields.campaign, this.generatorVersion)) return null;
		return Campaign.fromJSON(fields.campaign, { onWarning });
	}

	/**
	 * Whether another version stamped a save, or another generator version
	 * made its campaign's map, read off the stamp and that one field, so the
	 * menu never reads a campaign it won't open.
	 */
	private isOutdated(text: string): boolean {
		let save: unknown;
		try {
			save = JSON.parse(text);
		} catch {
			return false;
		}
		if (typeof save !== 'object' || save === null) return false;
		const { version, campaign } = save as { version?: unknown; campaign?: unknown };
		return isOtherVersion(version, this.version) || (version === this.version && isOtherGenerator(campaign, this.generatorVersion));
	}

	/**
	 * What a slot's text is to this build, remembered for the last few texts
	 * asked about. Anything that throws is damage, a bug in the reading code
	 * included, so a bad slot is kept before it's replaced and never counts as
	 * a save that loads; only `load` reports what threw.
	 */
	private verdict(text: string): Verdict {
		const remembered = this.verdicts.get(text);
		if (remembered !== undefined) return remembered;
		let verdict: Verdict;
		try {
			verdict = this.readSave(text, () => undefined) === null ? 'outdated' : 'current';
		} catch {
			verdict = 'damaged';
		}
		this.verdicts.set(text, verdict);
		if (this.verdicts.size > REMEMBERED_VERDICTS) this.verdicts.delete(this.verdicts.keys().next().value as string);
		return verdict;
	}

	private async setAside({ key, text, action }: { key: string; text: string; action: string }): Promise<void> {
		if ((await this.read(key, action)) === text) return;
		await this.put(key, text, action);
	}

	private read(key: string, action: string): Promise<string | null> {
		return this.stored(() => this.storage.getItem(key), action);
	}

	private put(key: string, value: string, action: string): Promise<void> {
		return this.stored(() => this.storage.setItem(key, value), action);
	}

	private drop(key: string, action: string): Promise<void> {
		return this.stored(() => this.storage.removeItem(key), action);
	}

	/** A storage call, failing as a `CampaignStoreError` that says what couldn't be done and why. */
	private async stored<T>(call: () => Promise<T>, action: string): Promise<T> {
		try {
			return await call();
		} catch (error) {
			throw new CampaignStoreError({ reason: 'storage', message: `${action}: ${storageTrouble(error)}.`, cause: error });
		}
	}

	/**
	 * A checkpoint that didn't save: a retired campaign's, told to nobody,
	 * ended when its lineage's end is in the history; or a failure, told to
	 * listeners, or logged with none listening. Never throws, so a checkpoint
	 * never rejects.
	 */
	private checkpointFailed({ campaign, error }: { campaign: Campaign; error: unknown }): CheckpointResult {
		try {
			const failure = error instanceof CampaignStoreError
				? error
				: new CampaignStoreError({ reason: 'unsavable', message: `${SAVING}.`, cause: error });
			if (failure.reason === 'retired') return this.lineages.get(campaign)?.ended === undefined ? 'retired' : 'ended';
			if (this.listenerCount('saveFailed') === 0) console.warn(`CampaignStore: ${failure.message}`, failure.detail);
			this.emit('saveFailed', failure);
		} catch (unexpected) {
			console.error('CampaignStore: could not report a failed checkpoint', unexpected);
		}
		return 'failed';
	}
}

/**
 * A campaign's save text, taken in the first microtask after it's asked
 * for, so it holds everything that runs synchronously after the call too.
 */
class Snapshot {
	private readonly campaign: Campaign;
	private text: string | null = null;
	private failure: unknown = null;
	private done = false;

	constructor({ campaign }: { campaign: Campaign }) {
		this.campaign = campaign;
		queueMicrotask(() => this.capture());
	}

	public get taken(): boolean {
		return this.done;
	}

	/** The text, taken now if its microtask hasn't run yet. Throws `unsavable` when the campaign couldn't be written. */
	public take(): string {
		this.capture();
		if (this.text === null) {
			throw new CampaignStoreError({ reason: 'unsavable', message: `${SAVING}: it holds something a save couldn't load back.`, cause: this.failure });
		}
		return this.text;
	}

	private capture(): void {
		if (this.done) return;
		this.done = true;
		try {
			this.text = this.campaign.toSaveText();
		} catch (error) {
			this.failure = error;
		}
	}
}

/**
 * A save's text: the save format version, the save's place in the build's
 * run of writes (one past the newest in either slot), then the campaign.
 */
function stamp({ version, sequence, campaign }: { version: number; sequence: number; campaign: string }): string {
	return `{"version":${JSON.stringify(version)},"sequence":${sequence},"campaign":${campaign}}`;
}

/** Where a save falls in the build's run of writes, read off the front of the text the store wrote; 0 for anything else. */
function sequenceOf(text: string | null): number {
	const match = text === null ? null : /^\{"version":-?\d+,"sequence":(\d+),"campaign":/.exec(text);
	return match ? Number(match[1]) : 0;
}

/**
 * Whether a saved campaign's map is from another generator version: it has
 * map attempts to make the map again from, and its generator version is an
 * integer other than this build's. A campaign without map attempts (built
 * without a map, as tests build them) has no map to be from anywhere, and
 * anything malformed in either field is the campaign reader's to refuse as
 * damage.
 */
function isOtherGenerator(campaign: unknown, current: number): boolean {
	if (typeof campaign !== 'object' || campaign === null) return false;
	const { generatorVersion, mapAttempts } = campaign as { generatorVersion?: unknown; mapAttempts?: unknown };
	return typeof mapAttempts === 'object' && mapAttempts !== null && isOtherVersion(generatorVersion, current);
}

/** Whether a save's version is another version's: an integer other than this build's. Anything else in its place is damage. */
function isOtherVersion(version: unknown, current: number): boolean {
	return Number.isInteger(version) && version !== current;
}

/** An error a save's damage throws, as against a bug in the code reading it. */
function isDamage(error: unknown): boolean {
	return error instanceof SyntaxError || isReaderError(error);
}

function pageNamespaceHere(): string {
	return typeof location === 'undefined' ? 'dev' : pageNamespace(location);
}

/** The save's text, or null when there's no save. */
function saveTextOf(survey: Survey): string | null {
	return survey.save === null ? null : survey.texts[survey.save];
}

function isSlot(value: string | null): value is Slot {
	return value === 'a' || value === 'b';
}

function otherSlot(slot: Slot): Slot {
	return slot === 'a' ? 'b' : 'a';
}

/** Hands warnings over once the store has decided what to do, so a callback that throws or rejects is logged and changes nothing. */
function deliver(warnings: readonly string[], onWarning: (warning: string) => void): void {
	for (const warning of warnings) {
		try {
			catchRejection(onWarning(warning), 'a warning callback');
		} catch (error) {
			console.error('CampaignStore: a warning callback threw', error);
		}
	}
}

/** Logs a callback's rejection, when it returned a promise; an async callback can't reject unheard. */
function catchRejection(result: unknown, who: string): void {
	if (typeof result !== 'object' || result === null || typeof (result as PromiseLike<unknown>).then !== 'function') return;
	(result as PromiseLike<unknown>).then(undefined, error => console.error(`CampaignStore: ${who} rejected`, error));
}

/** An error's message. Read by shape, since a DOMException from another realm (a test's, a frame's) isn't `instanceof Error` here. */
function describeError(error: unknown): string {
	const message = typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined;
	return typeof message === 'string' ? message : String(error);
}

/** A failed copy to recovery doesn't stop a read reporting the damage; the text stays where it was, and a write tries the copy again before replacing it. */
function logKeepAsideFailure(error: unknown): void {
	console.warn('CampaignStore: could not set damaged text aside', error);
}

function settled(): void {
	// The queue carries on whatever the call before did.
}
