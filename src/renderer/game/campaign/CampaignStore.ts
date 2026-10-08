import { EventEmitter } from '../core/EventEmitter';
import { CAMPAIGN_SCHEMA_VERSION, Campaign, LoadOptions, logWarning } from './Campaign';
import { CampaignEnding, CampaignHistoryEntry, historyEntry, historyToJson, readHistory, sameEntry } from './CampaignHistory';
import { describeValue, isReaderError, readFields, readObject } from './JsonReader';
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
 * saying so); or one saved by another version, which this build can't
 * continue.
 */
export type SaveStatus = 'none' | 'saved' | 'outdated';

/**
 * Why a store call failed: storage threw (full, blocked); a save or the
 * history is damaged; the campaign can't be written (it holds something a
 * save couldn't load back); or it's retired (it has ended, its save was
 * deleted, or a new campaign replaced it), so it isn't saved again.
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

export interface CampaignStoreOptions {
	storage: SaveStorage;
	/** The build whose saves these are. The page's (`pageNamespace`) when left out. */
	namespace?: string;
	/** The save format version stamped on every save and history list. `CAMPAIGN_SCHEMA_VERSION` when left out. */
	version?: number;
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
}

/** A checkpoint waiting its turn, which later checkpoints of its campaign join. */
interface Waiting {
	readonly campaign: Campaign;
	/** Replaced by a checkpoint that joins after it was taken, so the write holds the latest step. */
	snapshot: Snapshot;
	readonly saved: Promise<boolean>;
}

/**
 * The campaign in progress and the history of past ones, for one build,
 * persisted through a `SaveStorage`: local storage in both builds, a map in
 * tests. One active save, and a history list kept apart from it.
 *
 * Saves are per build. Every key carries the build's namespace, and every
 * save and history list carries the save format version
 * (`CAMPAIGN_SCHEMA_VERSION`). A save stamped with another version isn't
 * loaded: `saveStatus` calls it outdated, `load` passes it by, and a new
 * campaign or a delete replaces it without a copy. A history stamped with
 * another version starts over. There are no migrations.
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
 * slot, or anything else) the save is whichever slot holds a save this
 * build loads, and with none there's no save. A damaged save is copied to
 * the recovery key before anything writes over it or removes it: the save's
 * own slot when `active` moves off it or it's removed, and any slot no
 * `active` vouches for. The one exception is a delete the player asks for
 * when storage is too full for the copy.
 *
 * Every campaign instance the store loads or saves is tagged with the
 * lineage of the save it belongs to, and only the current lineage's
 * instances are saved. Ending the save's campaign, deleting the save, and
 * saving a new campaign each start a new one, so a screen still holding an
 * older instance can't write it back. The lineage lives in this store's
 * memory, so two tabs of one build can still overwrite each other's saves
 * until a single-writer lock lands (DDB-415).
 */
export class CampaignStore extends EventEmitter {
	private static sharedInstance: CampaignStore | null = null;

	private readonly storage: SaveStorage;
	private readonly keys: CampaignKeys;
	private readonly version: number;
	private readonly onWarning: (warning: string) => void;
	/** The save's lineage now. */
	private current: Lineage = {};
	private readonly lineages = new WeakMap<Campaign, Lineage>();
	/** A lineage that ended while removing its save failed part way; the next call that reads the save finishes the removal first. */
	private owed: Lineage | null = null;
	/** Text this store wrote to a slot, read there and loaded, or copied to recovery: safe to write over. */
	private readonly known = new Map<Slot, string>();
	private readonly verdicts = new Map<string, Verdict>();
	/** The tail of the calls waiting their turn. */
	private queue: Promise<void> = Promise.resolve();
	private waiting: Waiting | null = null;

	constructor({ storage, namespace = pageNamespaceHere(), version = CAMPAIGN_SCHEMA_VERSION, onWarning = logWarning }: CampaignStoreOptions) {
		super();
		this.storage = storage;
		this.keys = campaignKeys(namespace);
		this.version = version;
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
			if (survey.save === null) return 'none';
			return this.verdict(survey.texts[survey.save] as string) === 'outdated' ? 'outdated' : 'saved';
		});
	}

	/** Whether there's a save this version of the game can continue. */
	public async hasSave(): Promise<boolean> {
		return (await this.saveStatus()) === 'saved';
	}

	/**
	 * The campaign in progress: what Continue opens. Null when there's none,
	 * or when another version saved it (`saveStatus` says which). Rejects
	 * with a `CampaignStoreError` when storage fails or the save is damaged;
	 * a damaged save is copied to the recovery key and left where it was.
	 */
	public load({ onWarning = this.onWarning }: LoadOptions = {}): Promise<Campaign | null> {
		return this.enqueue(async () => {
			const warnings: string[] = [];
			try {
				await this.settleOwed(LOADING);
				const survey = await this.survey(LOADING);
				if (survey.save === null) return null;
				const slot = survey.save;
				const text = survey.texts[slot] as string;
				let campaign: Campaign | null;
				try {
					campaign = this.readSave(text, warning => { warnings.push(warning); });
				} catch (error) {
					if (!isDamage(error)) throw error;
					await this.keepAside({ slot, text, action: LOADING }).catch(logKeepAsideFailure);
					throw new CampaignStoreError({ reason: 'damaged', message: DAMAGED.campaign, cause: error });
				}
				if (campaign === null) return null;
				this.known.set(slot, text);
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
	 * campaign is retired or can't be written. Founding (DDB-284) saves the
	 * new campaign with this; later saves go through `checkpoint`.
	 */
	public save(campaign: Campaign): Promise<void> {
		const snapshot = new Snapshot({ campaign });
		return this.enqueue(() => this.write({ campaign, snapshot }));
	}

	/**
	 * Saves the campaign at the end of a step, for screens to call after
	 * each one. Checkpoints of one campaign share a write while it waits its
	 * turn, and the write holds the latest of their steps; any other call in
	 * between ends the sharing. Never rejects: resolves true once saved, or
	 * false. A failure goes to `onSaveFailed` listeners (logged when none
	 * listen), except for a retired campaign, which the game has moved on from.
	 */
	public checkpoint(campaign: Campaign): Promise<boolean> {
		const joining = this.waiting;
		if (joining !== null && joining.campaign === campaign) {
			// Its snapshot has been taken, so this step came after it.
			if (joining.snapshot.taken) joining.snapshot = new Snapshot({ campaign });
			return joining.saved;
		}
		const waiting: Waiting = {
			campaign,
			snapshot: new Snapshot({ campaign }),
			saved: this.enqueue(() => {
				if (this.waiting === waiting) this.waiting = null;
				return this.write({ campaign, snapshot: waiting.snapshot });
			}).then(() => true, (error: unknown) => this.checkpointFailed(error))
		};
		this.waiting = waiting;
		return waiting.saved;
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
	 * never loaded or saved leaves the save alone. Rejects with 'retired',
	 * recording nothing, for a campaign that has already ended or been
	 * deleted or replaced, except to finish removing a save an earlier end
	 * couldn't. An entry equal to the newest isn't added twice. Resolves to
	 * the entry.
	 */
	public end({ campaign, ending }: { campaign: Campaign; ending: CampaignEnding }): Promise<CampaignHistoryEntry> {
		let entry: CampaignHistoryEntry;
		try {
			entry = historyEntry({ campaign, ending });
		} catch (error) {
			return Promise.reject(new CampaignStoreError({ reason: 'unsavable', message: `${ENDING}: ${describeValue(ending)} isn't a way a campaign ends.`, cause: error }));
		}
		return this.enqueue(async () => {
			const warnings: string[] = [];
			try {
				const lineage = this.lineages.get(campaign);
				if (lineage !== undefined && lineage === this.owed) {
					await this.settleOwed(ENDING);
					return entry;
				}
				this.refuseRetired(campaign);
				if (lineage !== this.current) {
					await this.record({ entry, warnings });
					this.lineages.set(campaign, { retired: 'it has ended' });
					return entry;
				}
				const survey = await this.survey(ENDING);
				for (const slot of this.slotsToKeep(survey)) await this.protect({ slot, text: survey.texts[slot], action: ENDING });
				await this.record({ entry, warnings });
				this.owed = this.retire('it has ended');
				await this.remove({ survey, action: ENDING });
				this.owed = null;
				return entry;
			} finally {
				deliver(warnings, this.onWarning);
			}
		});
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
		const save = SLOTS.find(slot => texts[slot] !== null && this.verdict(texts[slot] as string) === 'current') ?? null;
		return { pointer, texts, save, named: false };
	}

	/** The snapshot into the slot that isn't the save's, then `active` switched to it. */
	private async write({ campaign, snapshot }: { campaign: Campaign; snapshot: Snapshot }): Promise<void> {
		this.refuseRetired(campaign);
		const text = stamp({ version: this.version, campaign: snapshot.take() });
		const survey = await this.survey(SAVING);
		const save = survey.save;
		if (save !== null && survey.texts[save] === text) {
			// Nothing has changed since the save.
			this.known.set(save, text);
			if (survey.pointer !== save) await this.put(this.keys.active, save, SAVING);
			this.adopt(campaign);
			return;
		}
		const next: Slot = save === null ? 'a' : otherSlot(save);
		// The save's own slot stops being the save once `active` moves off it; with no `active` naming the save,
		// the slot about to be written could hold anything.
		if (save !== null) await this.protect({ slot: save, text: survey.texts[save], action: SAVING });
		if (!survey.named) await this.protect({ slot: next, text: survey.texts[next], action: SAVING });
		await this.put(this.keys.slots[next], text, SAVING);
		this.known.set(next, text);
		await this.put(this.keys.active, next, SAVING);
		this.adopt(campaign);
	}

	private refuseRetired(campaign: Campaign): void {
		const why = this.lineages.get(campaign)?.retired;
		if (why === undefined) return;
		throw new CampaignStoreError({ reason: 'retired', message: `${SAVING}: ${why}.`, cause: new Error(`The store doesn't save a campaign once ${why}`) });
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
		for (const slot of this.slotsToRemove(survey)) {
			await this.drop(this.keys.slots[slot], action);
			this.known.delete(slot);
		}
		if (survey.pointer !== null && survey.save !== null) await this.drop(this.keys.active, action);
	}

	/** Finishes removing the save of a lineage that ended while its removal failed part way. */
	private async settleOwed(action: string): Promise<void> {
		if (this.owed === null) return;
		const survey = await this.survey(action);
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
	 * A save's campaign: null when another version stamped it. The version is
	 * checked first, so only a save of this version has to be well formed;
	 * a damaged one throws a SyntaxError or a reader error.
	 */
	private readSave(text: string, onWarning: (warning: string) => void): Campaign | null {
		const save = JSON.parse(text);
		if (readObject(save, 'Save').version !== this.version) return null;
		return Campaign.fromJSON(readFields(save, 'Save', ['version', 'campaign']).campaign, { onWarning });
	}

	/** What a slot's text is to this build, remembered for the last few texts asked about. */
	private verdict(text: string): Verdict {
		const remembered = this.verdicts.get(text);
		if (remembered !== undefined) return remembered;
		let verdict: Verdict;
		try {
			verdict = this.readSave(text, () => undefined) === null ? 'outdated' : 'current';
		} catch (error) {
			if (!isDamage(error)) throw error;
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

	/** Tells listeners why a checkpoint failed, or logs it with none listening. Never throws, so a checkpoint never rejects. */
	private checkpointFailed(error: unknown): false {
		try {
			const failure = error instanceof CampaignStoreError
				? error
				: new CampaignStoreError({ reason: 'unsavable', message: `${SAVING}.`, cause: error });
			if (failure.reason === 'retired') return false;
			if (this.listenerCount('saveFailed') === 0) console.warn(`CampaignStore: ${failure.message}`, failure.detail);
			this.emit('saveFailed', failure);
		} catch (unexpected) {
			console.error('CampaignStore: could not report a failed checkpoint', unexpected);
		}
		return false;
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

/** A save's text: the save format version, then the campaign. */
function stamp({ version, campaign }: { version: number; campaign: string }): string {
	return `{"version":${JSON.stringify(version)},"campaign":${campaign}}`;
}

/** An error a save's damage throws, as against a bug in the code reading it. */
function isDamage(error: unknown): boolean {
	return error instanceof SyntaxError || isReaderError(error);
}

function pageNamespaceHere(): string {
	return typeof location === 'undefined' ? 'dev' : pageNamespace(location);
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
