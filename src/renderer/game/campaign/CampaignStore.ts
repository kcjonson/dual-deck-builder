import { EventEmitter } from '../core/EventEmitter';
import { Campaign, LoadOptions, logWarning } from './Campaign';
import { CAMPAIGN_ENDINGS, CampaignEnding, CampaignHistoryEntry, historyEntry, historyToJson, readHistory, sameEntry } from './CampaignHistory';
import { describeValue, readOneOf } from './JsonReader';
import { NewerSaveError } from './SaveMigrations';
import { LocalSaveStorage, SaveStorage, isQuotaError, storageTrouble } from './SaveStorage';

/**
 * Storage keys. The save lives in one of two slots, and `active` names which;
 * a save that couldn't be read is copied to `recovery` before anything could
 * write over it.
 */
export const CAMPAIGN_KEYS = {
	active: 'dual-deckbuilder.campaign.active',
	slots: { a: 'dual-deckbuilder.campaign.a', b: 'dual-deckbuilder.campaign.b' },
	recovery: 'dual-deckbuilder.campaign.recovery',
	history: 'dual-deckbuilder.campaign.history',
	historyRecovery: 'dual-deckbuilder.campaign.history-recovery'
} as const;

type Slot = keyof typeof CAMPAIGN_KEYS.slots;

const SLOTS: readonly Slot[] = ['a', 'b'];

/**
 * Why a store call failed: storage threw (full, blocked); a save or the
 * history is damaged, or from a newer build; the campaign can't be written
 * (it holds something a save couldn't load back); or it's retired (it has
 * ended, its save was deleted, or a new campaign replaced it), so it isn't
 * saved again.
 */
export type CampaignStoreFailure = 'storage' | 'damaged' | 'newer' | 'unsavable' | 'retired';

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
	/**
	 * Hears map param repairs on load, a history the store couldn't read when
	 * a campaign ended, and a copy too big for full storage. Logs them by
	 * default. A callback that throws is logged and changes nothing.
	 */
	onWarning?: (warning: string) => void;
}

const LOADING = "The saved campaign couldn't be read";
const SAVING = "The campaign couldn't be saved";
const DELETING = "The saved campaign couldn't be deleted";
const READING_HISTORY = "Campaign history couldn't be read";
const ENDING = "The campaign couldn't be ended";

/** What the player reads when a save or the history can't be read, by subject and reason. */
const UNREADABLE = {
	campaign: {
		damaged: (): string => "The saved campaign is damaged and can't be loaded. It's been kept.",
		newer: ({ version, readable }: NewerSaveError): string =>
			`The saved campaign is from a newer version of the game (save version ${version}; this one reads up to ${readable}), so it can't be continued here. It's been kept.`
	},
	history: {
		damaged: (): string => "Campaign history is damaged and can't be shown. It's been kept.",
		newer: ({ version, readable }: NewerSaveError): string =>
			`Campaign history is from a newer version of the game (version ${version}; this one reads up to ${readable}), so it can't be shown here. It's been kept.`
	}
} as const;

/** A newer build's save that this build can't even find, under an `active` it doesn't know. */
const FOREIGN_SAVE = "The saved campaign is from a newer version of the game, so it can't be continued here. It's been left as it is.";

/** What storage holds, read at the start of a call. */
interface Survey {
	/** What `active` holds. */
	pointer: string | null;
	texts: Readonly<Record<Slot, string | null>>;
	/** The slot holding the save, by `resolveSave`; null when there's none, or storage is `foreign`. */
	save: Slot | null;
	/** `active` holds a value this build doesn't know: a newer build's format, which may keep its save where this build can't see. */
	foreign: boolean;
}

/**
 * The campaign in progress and the history of past ones, persisted through
 * a `SaveStorage`: local storage in both builds, a map in tests. One active
 * save, and a history list kept apart from it.
 *
 * Screens call `checkpoint` at the end of each step that changes the
 * campaign: a stop, arriving home, a compound action. A save or checkpoint
 * captures the campaign in the first microtask after it's asked for, once
 * the code that asked has run and before the next frame, and writes that
 * text when its turn comes behind every call made before it. So a save
 * asked for partway through a synchronous step, a card move from a record's
 * listener say, still captures the whole step; one asked for before an
 * `await` in an async step captures the step as it stood there.
 *
 * A write goes into the slot that isn't the save's, then `active` switches
 * to it, so a crash part way through leaves the save before. Every call
 * finds the save the same way (`resolveSave`). Before any slot is written
 * over or removed, its text is copied to the recovery key unless this store
 * wrote or read it there, or this build loads it, so a save this build
 * can't read isn't destroyed; the one exception is a delete the player asks
 * for when storage is too full to hold the copy. An `active` this build
 * doesn't know is a newer build's: storage is left alone until the player
 * deletes the save.
 *
 * Every campaign instance the store loads or saves is tagged with the
 * generation of the save it belongs to, and only the current generation's
 * instances are saved. Ending the save's campaign, deleting the save, and
 * saving a new campaign each start a new generation, so a screen still
 * holding an older instance can't write it back. The tags live in this
 * store's memory, so two tabs on one origin aren't supported until a
 * single-writer lock lands (DDB-415).
 */
export class CampaignStore extends EventEmitter {
	private static sharedInstance: CampaignStore | null = null;

	private readonly storage: SaveStorage;
	private readonly onWarning: (warning: string) => void;
	/** The save's generation. Instances tagged with an older one are retired. */
	private generation = 0;
	/** The generation each instance was loaded or saved under. */
	private readonly lineage = new WeakMap<Campaign, number>();
	/** Why each past generation ended, for the message a retired instance's save gets. */
	private readonly endedGenerations = new Map<number, string>();
	/** Instances the store never tagged that `end` put in the history, and so retired one by one. */
	private readonly endedCampaigns = new WeakMap<Campaign, string>();
	/** Text this store wrote to a slot, or read there and found safe to write over. */
	private readonly known = new Map<Slot, string>();
	/** The tail of the calls waiting their turn. */
	private queue: Promise<void> = Promise.resolve();
	/** A checkpoint still waiting its turn, which later checkpoints of its campaign join until another call comes between. */
	private waiting: { campaign: Campaign; latest: { snapshot: Snapshot }; saved: Promise<boolean> } | null = null;

	constructor({ storage, onWarning = logWarning }: CampaignStoreOptions) {
		super();
		this.storage = storage;
		this.onWarning = onWarning;
	}

	/** The game's store, over local storage. */
	public static get shared(): CampaignStore {
		if (!this.sharedInstance) this.sharedInstance = new CampaignStore({ storage: new LocalSaveStorage() });
		return this.sharedInstance;
	}

	/** Whether there's a campaign to continue, without loading it; `load` says if it can't be read. */
	public hasSave(): Promise<boolean> {
		return this.enqueue({
			task: async () => {
				const survey = await this.survey(LOADING);
				return survey.foreign || survey.save !== null;
			}
		});
	}

	/**
	 * The campaign in progress, or null when there's none: what Continue
	 * opens. Rejects with a `CampaignStoreError` when storage fails, or the
	 * save is damaged or from a newer build; a save it can't read is copied to
	 * the recovery key and left where it was. Also checks the slot the next
	 * write will land in, here at the menu rather than in a checkpoint's frame.
	 */
	public load({ onWarning = this.onWarning }: LoadOptions = {}): Promise<Campaign | null> {
		return this.enqueue({
			task: async () => {
				const survey = await this.survey(LOADING);
				if (survey.foreign) throw new CampaignStoreError({ reason: 'newer', message: FOREIGN_SAVE, cause: foreignPointer(survey.pointer) });
				if (survey.save === null) return null;
				const slot = survey.save;
				const text = survey.texts[slot] as string;
				const warnings: string[] = [];
				let campaign: Campaign;
				try {
					campaign = Campaign.fromJSON(JSON.parse(text), { onWarning: warning => { warnings.push(warning); } });
				} catch (error) {
					await this.setAside({ key: CAMPAIGN_KEYS.recovery, text, action: LOADING }).catch(logSetAsideFailure);
					throw unreadable('campaign', error);
				}
				this.known.set(slot, text);
				const other = otherSlot(slot);
				await this.protect({ slot: other, text: survey.texts[other], action: LOADING }).catch(logSetAsideFailure);
				this.lineage.set(campaign, this.generation);
				deliver(warnings, onWarning);
				return campaign;
			}
		});
	}

	/**
	 * Writes the campaign as the save. A campaign the store hasn't loaded or
	 * saved before is a new one, replacing the save. Rejects with a
	 * `CampaignStoreError`, keeping the save before, when storage fails, the
	 * campaign is retired or can't be written, or storage holds a newer
	 * build's save it can't see. Founding (DDB-284) saves the new campaign
	 * with this; later saves go through `checkpoint`.
	 */
	public save(campaign: Campaign): Promise<void> {
		const snapshot = new Snapshot({ campaign });
		return this.enqueue({ task: () => this.write({ campaign, snapshot }) });
	}

	/**
	 * Saves the campaign at the end of a step, for screens to call after each
	 * one. Checkpoints of one campaign share a write while it waits its turn,
	 * and the write takes the latest of their steps; any other call in between
	 * ends the sharing. Never rejects: resolves true once saved, or false. A
	 * failure goes to `onSaveFailed` listeners (logged when none listen),
	 * except for a retired campaign, which the game has moved on from.
	 */
	public checkpoint(campaign: Campaign): Promise<boolean> {
		const waiting = this.waiting;
		if (waiting !== null && waiting.campaign === campaign) {
			// Its snapshot has been taken, so this step came after it.
			if (waiting.latest.snapshot.taken) waiting.latest.snapshot = new Snapshot({ campaign });
			return waiting.saved;
		}
		const latest = { snapshot: new Snapshot({ campaign }) };
		const saved: Promise<boolean> = this.enqueue({
			coalescing: true,
			task: () => {
				if (this.waiting?.saved === saved) this.waiting = null;
				return this.write({ campaign, snapshot: latest.snapshot });
			}
		}).then(() => true, (error: unknown) => this.checkpointFailed(error));
		this.waiting = { campaign, latest, saved };
		return saved;
	}

	/** Hears every checkpoint that failed to save. Returns the function that removes the listener. */
	public onSaveFailed(listener: SaveFailedListener): () => void {
		return this.on('saveFailed', listener);
	}

	/**
	 * Removes the save, as when the player abandons it without a line in the
	 * history, and retires its campaign. A save this build can't read is
	 * copied to the recovery key first, unless storage is too full to hold the
	 * copy: the player asked, so that doesn't stop them.
	 */
	public delete(): Promise<void> {
		return this.enqueue({
			task: async () => {
				this.endGeneration('its save was deleted');
				const survey = await this.survey(DELETING);
				const warnings: string[] = [];
				for (const slot of SLOTS) {
					try {
						await this.protect({ slot, text: survey.texts[slot], action: DELETING });
					} catch (error) {
						if (!(error instanceof CampaignStoreError) || !isQuotaError(error.cause)) throw error;
						warnings.push(`CampaignStore: storage was too full to keep a copy of the save in slot ${slot}; deleted it anyway`);
					}
				}
				await this.remove({ survey, action: DELETING });
				deliver(warnings, this.onWarning);
			}
		});
	}

	/**
	 * The campaign is over: it goes into the history as it stands, and can't
	 * be saved again. If it's the save's campaign (whichever instance of it),
	 * the save goes too; one the store never loaded or saved leaves the save
	 * alone. An entry equal to the newest one isn't added twice, so ending a
	 * campaign again the same way after a crash between the two writes
	 * records it once. Resolves to its history entry.
	 */
	public end({ campaign, ending }: { campaign: Campaign; ending: CampaignEnding }): Promise<CampaignHistoryEntry> {
		try {
			readOneOf(ending, 'ending', CAMPAIGN_ENDINGS);
		} catch (error) {
			return Promise.reject(new CampaignStoreError({ reason: 'unsavable', message: `${ENDING}: ${describeValue(ending)} isn't a way a campaign ends.`, cause: error }));
		}
		return this.enqueue({
			task: async () => {
				const entry = historyEntry({ campaign, ending });
				const warnings: string[] = [];
				await this.record({ entry, warnings });
				const tag = this.lineage.get(campaign);
				if (tag === undefined) {
					this.endedCampaigns.set(campaign, 'it has ended');
				} else if (tag === this.generation) {
					this.endGeneration('it has ended');
					const survey = await this.survey(ENDING);
					if (!survey.foreign) {
						for (const slot of SLOTS) await this.protect({ slot, text: survey.texts[slot], action: ENDING });
						await this.remove({ survey, action: ENDING });
					}
				}
				deliver(warnings, this.onWarning);
				return entry;
			}
		});
	}

	/**
	 * Past campaigns, newest first. Rejects with a `CampaignStoreError` when
	 * storage fails, or the history is damaged (and copied to its recovery
	 * key) or from a newer build.
	 */
	public history(): Promise<CampaignHistoryEntry[]> {
		return this.enqueue({
			task: async () => {
				const text = await this.read({ key: CAMPAIGN_KEYS.history, action: READING_HISTORY });
				if (text === null) return [];
				try {
					return readHistory(JSON.parse(text));
				} catch (error) {
					if (!(error instanceof NewerSaveError)) {
						await this.setAside({ key: CAMPAIGN_KEYS.historyRecovery, text, action: READING_HISTORY }).catch(logSetAsideFailure);
					}
					throw unreadable('history', error);
				}
			}
		});
	}

	/** Runs the task once every call before it has settled. A call that isn't a checkpoint ends checkpoint sharing. */
	private enqueue<T>({ task, coalescing = false }: { task: () => Promise<T>; coalescing?: boolean }): Promise<T> {
		if (!coalescing) this.waiting = null;
		const result = this.queue.then(task);
		this.queue = result.then(settled, settled);
		return result;
	}

	private async survey(action: string): Promise<Survey> {
		const pointer = await this.read({ key: CAMPAIGN_KEYS.active, action });
		const texts = {
			a: await this.read({ key: CAMPAIGN_KEYS.slots.a, action }),
			b: await this.read({ key: CAMPAIGN_KEYS.slots.b, action })
		};
		if (pointer !== null && !isSlot(pointer)) return { pointer, texts, save: null, foreign: true };
		return { pointer, texts, save: resolveSave({ pointer, texts }), foreign: false };
	}

	/** The snapshot into the slot that isn't the save's, then `active` switched to it. */
	private async write({ campaign, snapshot }: { campaign: Campaign; snapshot: Snapshot }): Promise<void> {
		this.refuseRetired(campaign);
		const text = snapshot.take();
		const survey = await this.survey(SAVING);
		if (survey.foreign) {
			throw new CampaignStoreError({ reason: 'newer', message: `${SAVING}: storage holds a save from a newer version of the game.`, cause: foreignPointer(survey.pointer) });
		}
		const save = survey.save;
		if (save !== null && survey.texts[save] === text) {
			// Nothing has changed since the save.
			this.known.set(save, text);
			if (survey.pointer !== save) await this.stored({ call: () => this.storage.setItem(CAMPAIGN_KEYS.active, save), action: SAVING });
			this.adopt(campaign);
			return;
		}
		const next: Slot = save === 'a' ? 'b' : 'a';
		await this.protect({ slot: next, text: survey.texts[next], action: SAVING });
		await this.stored({ call: () => this.storage.setItem(CAMPAIGN_KEYS.slots[next], text), action: SAVING });
		this.known.set(next, text);
		await this.stored({ call: () => this.storage.setItem(CAMPAIGN_KEYS.active, next), action: SAVING });
		this.adopt(campaign);
	}

	private refuseRetired(campaign: Campaign): void {
		const tag = this.lineage.get(campaign);
		const why = this.endedCampaigns.get(campaign) ?? (tag !== undefined && tag < this.generation ? this.endedGenerations.get(tag) : undefined);
		if (why === undefined) return;
		throw new CampaignStoreError({ reason: 'retired', message: `${SAVING}: ${why}.`, cause: new Error(`The store doesn't save a campaign once ${why}`) });
	}

	/** Makes a just-written campaign the save's. One the store hadn't tagged is a new campaign, which starts a generation. */
	private adopt(campaign: Campaign): void {
		if (this.lineage.has(campaign)) return;
		this.endGeneration('a new campaign replaced it');
		this.lineage.set(campaign, this.generation);
	}

	/** Retires every instance tagged with the current generation. */
	private endGeneration(why: string): void {
		this.endedGenerations.set(this.generation, why);
		this.generation += 1;
	}

	/**
	 * Before a slot is written over or removed: copies its text to the
	 * recovery key unless this store wrote or read it there, or this build
	 * loads it. Throws, leaving the slot as it is, when the copy fails.
	 */
	private async protect({ slot, text, action }: { slot: Slot; text: string | null; action: string }): Promise<void> {
		if (text === null || text === this.known.get(slot)) return;
		if (!loads(text)) await this.setAside({ key: CAMPAIGN_KEYS.recovery, text, action });
		this.known.set(slot, text);
	}

	/** The other slot, then the save's, then `active`, so a crash part way leaves the save or nothing, never the save before it. */
	private async remove({ survey, action }: { survey: Survey; action: string }): Promise<void> {
		const order: readonly Slot[] = survey.save === 'b' ? ['a', 'b'] : ['b', 'a'];
		for (const slot of order) {
			if (survey.texts[slot] === null) continue;
			await this.stored({ call: () => this.storage.removeItem(CAMPAIGN_KEYS.slots[slot]), action });
			this.known.delete(slot);
		}
		if (survey.pointer !== null) await this.stored({ call: () => this.storage.removeItem(CAMPAIGN_KEYS.active), action });
	}

	/**
	 * Puts the entry at the top of the history, unless it's there already. A
	 * newer build's history is left as it is, without the entry; a damaged
	 * one is copied to its recovery key and a new list started.
	 */
	private async record({ entry, warnings }: { entry: CampaignHistoryEntry; warnings: string[] }): Promise<void> {
		const text = await this.read({ key: CAMPAIGN_KEYS.history, action: ENDING });
		let entries: CampaignHistoryEntry[] = [];
		if (text !== null) {
			try {
				entries = readHistory(JSON.parse(text));
			} catch (error) {
				if (error instanceof NewerSaveError) {
					warnings.push(`CampaignStore: left the history as a newer build wrote it, without this campaign: ${error.message}`);
					return;
				}
				await this.setAside({ key: CAMPAIGN_KEYS.historyRecovery, text, action: ENDING });
				warnings.push(`CampaignStore: set a damaged history aside and started a new one: ${describeError(error)}`);
			}
		}
		if (entries.length > 0 && sameEntry(entries[0], entry)) return;
		const history = JSON.stringify(historyToJson([entry, ...entries]));
		await this.stored({ call: () => this.storage.setItem(CAMPAIGN_KEYS.history, history), action: ENDING });
	}

	private async setAside({ key, text, action }: { key: string; text: string; action: string }): Promise<void> {
		if ((await this.read({ key, action })) === text) return;
		await this.stored({ call: () => this.storage.setItem(key, text), action });
	}

	private read({ key, action }: { key: string; action: string }): Promise<string | null> {
		return this.stored({ call: () => this.storage.getItem(key), action });
	}

	/** A storage call, failing as a `CampaignStoreError` that says what couldn't be done and why. */
	private async stored<T>({ call, action }: { call: () => Promise<T>; action: string }): Promise<T> {
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
 * for: once the code that asked has run, and before the next frame.
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
 * The slot holding the save. `active` naming a slot with text in it
 * decides. Otherwise (no `active`, or one naming an empty slot, as an
 * interrupted write or two tabs can leave) it's whichever slot holds text,
 * preferring one that loads; with text in neither, there's no save.
 */
function resolveSave({ pointer, texts }: { pointer: Slot | null; texts: Readonly<Record<Slot, string | null>> }): Slot | null {
	if (pointer !== null && texts[pointer] !== null) return pointer;
	const held = SLOTS.filter(slot => texts[slot] !== null);
	return held.find(slot => loads(texts[slot] as string)) ?? held[0] ?? null;
}

/** A save or history this build couldn't read: damaged, or from a newer build. */
function unreadable(subject: keyof typeof UNREADABLE, error: unknown): CampaignStoreError {
	const sentences = UNREADABLE[subject];
	return error instanceof NewerSaveError
		? new CampaignStoreError({ reason: 'newer', message: sentences.newer(error), cause: error })
		: new CampaignStoreError({ reason: 'damaged', message: sentences.damaged(), cause: error });
}

function foreignPointer(pointer: string | null): Error {
	return new Error(`${CAMPAIGN_KEYS.active} holds ${JSON.stringify(pointer)}, which this build doesn't know`);
}

/** Whether a save loads in this build. */
function loads(text: string): boolean {
	try {
		Campaign.fromJSON(JSON.parse(text), { onWarning: () => undefined });
		return true;
	} catch {
		return false;
	}
}

function isSlot(value: string | null): value is Slot {
	return value === 'a' || value === 'b';
}

function otherSlot(slot: Slot): Slot {
	return slot === 'a' ? 'b' : 'a';
}

/** Hands warnings over once the store has decided what to do, so a callback that throws is logged and changes nothing. */
function deliver(warnings: readonly string[], onWarning: (warning: string) => void): void {
	for (const warning of warnings) {
		try {
			onWarning(warning);
		} catch (error) {
			console.error('CampaignStore: a warning callback threw', error);
		}
	}
}

/** An error's message. Read by shape, since a DOMException from another realm (a test's, a frame's) isn't `instanceof Error` here. */
function describeError(error: unknown): string {
	const message = typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined;
	return typeof message === 'string' ? message : String(error);
}

/** A failed copy to recovery doesn't stop a load reporting why it failed; the save stays in its slot, and a write tries the copy again before replacing it. */
function logSetAsideFailure(error: unknown): void {
	console.warn('CampaignStore: could not set an unreadable save aside', error);
}

function settled(): void {
	// The queue carries on whatever the call before did.
}
