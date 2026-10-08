import { Campaign, LoadOptions } from './Campaign';
import { CampaignEnding, CampaignHistoryEntry, historyEntry, historyToJson, readHistory, sameEntry } from './CampaignHistory';
import { NewerSaveError } from './SaveMigrations';
import { LocalSaveStorage, SaveStorage, isQuotaError } from './SaveStorage';

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
 * Why a store call failed: storage threw (blocked, full), a save or the
 * history is damaged, one is from a newer build, or the campaign can't be
 * saved (it has ended, its save was deleted, or it holds something a save
 * couldn't load back).
 */
export type CampaignStoreFailure = 'storage' | 'damaged' | 'newer' | 'unsavable';

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
	/** Hears map param repairs on load, and a history the store couldn't read when a campaign ended. Logs them by default. */
	onWarning?: (warning: string) => void;
}

const LOADING = "The saved campaign couldn't be read";
const SAVING = "The campaign couldn't be saved";
const DELETING = "The saved campaign couldn't be deleted";
const READING_HISTORY = "Campaign history couldn't be read";
const ENDING = "The campaign couldn't be ended";

/**
 * The campaign in progress and the history of past ones, persisted through
 * a `SaveStorage`: local storage in both builds, a map in tests. One active
 * save, and a history list kept apart from it.
 *
 * Every call waits its turn, so calls take effect in the order they're made,
 * and a save writes the campaign as it stands when its turn comes. That's
 * never before the code that asked for it has run to its end, so a save
 * asked for partway through a card move, or from a record's or an escort's
 * listener, writes the finished step.
 *
 * A save is written whole or not at all: into the slot that doesn't hold
 * the current save, then `active` is switched to it, so a crash partway
 * through leaves the save before. A save this build can't read, damaged or
 * from a newer build, fails to load with a message, and is copied to the
 * recovery key before a new campaign could write over it; a newer build's
 * history is never written over either.
 *
 * Saving is the caller's to time: screens call `checkpoint` after every
 * step that changes the campaign (each stop, arriving home, a compound
 * action), not on every `change` event, which a record or an escort doesn't
 * raise on the campaign anyway.
 */
export class CampaignStore {
	private static sharedInstance: CampaignStore | null = null;

	private readonly storage: SaveStorage;
	private readonly onWarning: (warning: string) => void;
	/** The campaign this store last loaded or saved, so the one the save in storage belongs to. */
	private current: Campaign | null = null;
	/** Campaigns ended, or whose save was deleted, and why: they never become the save again. */
	private readonly retired = new WeakMap<Campaign, string>();
	/** The tail of the calls waiting their turn. */
	private queue: Promise<void> = Promise.resolve();
	/** A checkpoint still waiting its turn, which later checkpoints of its campaign join. */
	private waiting: { campaign: Campaign; saved: Promise<boolean> } | null = null;
	private readonly failureListeners: SaveFailedListener[] = [];

	constructor({ storage, onWarning = logWarning }: CampaignStoreOptions) {
		this.storage = storage;
		this.onWarning = onWarning;
	}

	/** The game's store, over local storage. */
	public static get shared(): CampaignStore {
		if (!this.sharedInstance) this.sharedInstance = new CampaignStore({ storage: new LocalSaveStorage() });
		return this.sharedInstance;
	}

	/** Whether there's a campaign to continue, without reading it; `load` says if it can't be read. */
	public hasSave(): Promise<boolean> {
		return this.enqueue(async () => (await this.read(CAMPAIGN_KEYS.active, LOADING)) !== null);
	}

	/**
	 * The campaign in progress, or null when there's none: what Continue
	 * opens. Rejects with a `CampaignStoreError` when storage fails, or the
	 * save is damaged or from a newer build; a save it can't read is copied to
	 * the recovery key and left where it was.
	 */
	public load({ onWarning = this.onWarning }: LoadOptions = {}): Promise<Campaign | null> {
		return this.enqueue(async () => {
			// Until this load succeeds, nothing says whose save is in storage.
			this.current = null;
			const pointer = await this.read(CAMPAIGN_KEYS.active, LOADING);
			if (pointer === null) return null;
			if (!isSlot(pointer)) throw damaged('campaign', new Error(`${CAMPAIGN_KEYS.active} holds ${JSON.stringify(pointer)}, which isn't a slot`));
			const text = await this.read(CAMPAIGN_KEYS.slots[pointer], LOADING);
			if (text === null) throw damaged('campaign', new Error(`${CAMPAIGN_KEYS.active} names slot ${pointer}, which is empty`));
			let campaign: Campaign;
			try {
				campaign = Campaign.fromJSON(JSON.parse(text), { onWarning });
			} catch (error) {
				await this.setAside(CAMPAIGN_KEYS.recovery, text, LOADING).catch(logSetAsideFailure);
				throw unreadable('campaign', error);
			}
			this.current = campaign;
			return campaign;
		});
	}

	/**
	 * Writes the campaign as the save, replacing the one before. Rejects with
	 * a `CampaignStoreError`, keeping the save before, when storage fails, or
	 * the campaign has ended, its save was deleted, or it can't be written.
	 * Founding (DDB-284) saves the new campaign with this; later saves go
	 * through `checkpoint`.
	 */
	public save(campaign: Campaign): Promise<void> {
		return this.enqueue(() => this.write(campaign));
	}

	/**
	 * Saves the campaign once the step that changed it has finished, for
	 * screens to call after every step. Checkpoints of one campaign waiting
	 * their turn share a single write. Never rejects: resolves true once
	 * saved, or false after telling `onSaveFailed` listeners why (or logging
	 * it, with none listening).
	 */
	public checkpoint(campaign: Campaign): Promise<boolean> {
		if (this.waiting?.campaign === campaign) return this.waiting.saved;
		const waiting = { campaign, saved: Promise.resolve(false) };
		waiting.saved = this.enqueue(() => {
			if (this.waiting === waiting) this.waiting = null;
			return this.write(campaign);
		}).then(() => true, (error: unknown) => {
			this.saveFailed(error);
			return false;
		});
		this.waiting = waiting;
		return waiting.saved;
	}

	/** Hears every checkpoint that failed to save. Returns the function that removes the listener. */
	public onSaveFailed(listener: SaveFailedListener): () => void {
		this.failureListeners.push(listener);
		return () => {
			const index = this.failureListeners.indexOf(listener);
			if (index >= 0) this.failureListeners.splice(index, 1);
		};
	}

	/**
	 * Removes the campaign in progress, as when it's abandoned without a
	 * line in the history; the campaign the store held can't be saved again.
	 * A save this build can't read is copied to the recovery key first.
	 */
	public delete(): Promise<void> {
		return this.enqueue(async () => {
			const pointer = await this.read(CAMPAIGN_KEYS.active, DELETING);
			if (pointer === null) return;
			for (const slot of isSlot(pointer) ? [pointer] : SLOTS) await this.keepIfUnreadable(slot, DELETING);
			const held = this.current;
			await this.removeSave(DELETING);
			if (held) this.retired.set(held, 'its save was deleted');
		});
	}

	/**
	 * The campaign is over: it goes into the history as it stands, and if
	 * it's the save, the save goes. Either way it can't be saved again, so it
	 * can't come back to Continue. Ending the same campaign twice records it
	 * once, so a crash between the two writes heals on the next end. Resolves
	 * to its history entry.
	 */
	public end({ campaign, ending }: { campaign: Campaign; ending: CampaignEnding }): Promise<CampaignHistoryEntry> {
		return this.enqueue(async () => {
			const entry = historyEntry({ campaign, ending });
			await this.record(entry);
			this.retired.set(campaign, 'it has ended');
			if (campaign === this.current) await this.removeSave(ENDING);
			return entry;
		});
	}

	/**
	 * Past campaigns, newest first. Rejects with a `CampaignStoreError` when
	 * storage fails, or the history is damaged (and copied to its recovery
	 * key) or from a newer build.
	 */
	public history(): Promise<CampaignHistoryEntry[]> {
		return this.enqueue(async () => {
			const text = await this.read(CAMPAIGN_KEYS.history, READING_HISTORY);
			if (text === null) return [];
			try {
				return readHistory(JSON.parse(text));
			} catch (error) {
				if (!(error instanceof NewerSaveError)) await this.setAside(CAMPAIGN_KEYS.historyRecovery, text, READING_HISTORY).catch(logSetAsideFailure);
				throw unreadable('history', error);
			}
		});
	}

	/** Runs the task once every call before it has settled. */
	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const result = this.queue.then(task);
		this.queue = result.then(settled, settled);
		return result;
	}

	/**
	 * The campaign as it stands, into the slot that isn't active, then made
	 * active. Replacing a campaign other than the one this store holds (a new
	 * one, after founding) sets the save it replaces aside first if this build
	 * can't read it, since the next write lands in its slot.
	 */
	private async write(campaign: Campaign): Promise<void> {
		const retired = this.retired.get(campaign);
		if (retired) {
			throw new CampaignStoreError({ reason: 'unsavable', message: `${SAVING}: ${retired}.`, cause: new Error('A campaign that has ended, or whose save was deleted, is never saved again') });
		}
		let text: string;
		try {
			text = JSON.stringify(campaign);
		} catch (error) {
			throw new CampaignStoreError({ reason: 'unsavable', message: `${SAVING}: it holds something a save couldn't load back.`, cause: error });
		}
		const pointer = await this.read(CAMPAIGN_KEYS.active, SAVING);
		const active = isSlot(pointer) ? pointer : null;
		if (campaign !== this.current && active !== null) await this.keepIfUnreadable(active, SAVING);
		const next: Slot = active === 'a' ? 'b' : 'a';
		await this.stored(() => this.storage.setItem(CAMPAIGN_KEYS.slots[next], text), SAVING);
		await this.stored(() => this.storage.setItem(CAMPAIGN_KEYS.active, next), SAVING);
		this.current = campaign;
	}

	/** Copies the save in a slot to the recovery key unless this build can read it. */
	private async keepIfUnreadable(slot: Slot, action: string): Promise<void> {
		const text = await this.read(CAMPAIGN_KEYS.slots[slot], action);
		if (text === null || loads(text)) return;
		await this.setAside(CAMPAIGN_KEYS.recovery, text, action);
	}

	/** `active` first, so there's no save from the moment it goes, then both slots. */
	private async removeSave(action: string): Promise<void> {
		await this.stored(() => this.storage.removeItem(CAMPAIGN_KEYS.active), action);
		this.current = null;
		for (const slot of SLOTS) await this.stored(() => this.storage.removeItem(CAMPAIGN_KEYS.slots[slot]), action);
	}

	/**
	 * Puts the entry at the top of the history, unless it's there already. A
	 * newer build's history is left as it is, without the entry; a damaged
	 * one is copied to its recovery key and a new list started.
	 */
	private async record(entry: CampaignHistoryEntry): Promise<void> {
		const text = await this.read(CAMPAIGN_KEYS.history, ENDING);
		let entries: CampaignHistoryEntry[] = [];
		if (text !== null) {
			try {
				entries = readHistory(JSON.parse(text));
			} catch (error) {
				if (error instanceof NewerSaveError) {
					this.onWarning(`CampaignStore: left the history as a newer build wrote it, without this campaign: ${error.message}`);
					return;
				}
				await this.setAside(CAMPAIGN_KEYS.historyRecovery, text, ENDING);
				this.onWarning(`CampaignStore: set a damaged history aside and started a new one: ${describeError(error)}`);
			}
		}
		if (entries.length > 0 && sameEntry(entries[0], entry)) return;
		await this.stored(() => this.storage.setItem(CAMPAIGN_KEYS.history, JSON.stringify(historyToJson([entry, ...entries]))), ENDING);
	}

	private async setAside(key: string, text: string, action: string): Promise<void> {
		if ((await this.read(key, action)) === text) return;
		await this.stored(() => this.storage.setItem(key, text), action);
	}

	private read(key: string, action: string): Promise<string | null> {
		return this.stored(() => this.storage.getItem(key), action);
	}

	/** A storage call, failing as a `CampaignStoreError` that says what couldn't be done. */
	private async stored<T>(call: () => Promise<T>, action: string): Promise<T> {
		try {
			return await call();
		} catch (error) {
			throw new CampaignStoreError({ reason: 'storage', message: `${action}: ${isQuotaError(error) ? 'storage is full' : 'storage failed'}.`, cause: error });
		}
	}

	private saveFailed(error: unknown): void {
		const failure = error instanceof CampaignStoreError
			? error
			: new CampaignStoreError({ reason: 'unsavable', message: `${SAVING}.`, cause: error });
		if (this.failureListeners.length === 0) console.warn(`CampaignStore: ${failure.message}`, failure.detail);
		for (const listener of [...this.failureListeners]) listener(failure);
	}
}

const SUBJECTS = {
	campaign: { name: 'The saved campaign', damaged: "is damaged and can't be loaded", newer: "so it can't be continued here", version: 'save version' },
	history: { name: 'Campaign history', damaged: "is damaged and can't be shown", newer: "so it can't be shown here", version: 'version' }
} as const;

/** A save or history this build couldn't read: damaged, or from a newer build. */
function unreadable(subject: keyof typeof SUBJECTS, error: unknown): CampaignStoreError {
	if (!(error instanceof NewerSaveError)) return damaged(subject, error);
	const { name, newer, version } = SUBJECTS[subject];
	return new CampaignStoreError({
		reason: 'newer',
		message: `${name} is from a newer version of the game (${version} ${error.version}; this one reads up to ${error.readable}), ${newer}. It's been kept.`,
		cause: error
	});
}

function damaged(subject: keyof typeof SUBJECTS, cause: unknown): CampaignStoreError {
	const { name, damaged: what } = SUBJECTS[subject];
	return new CampaignStoreError({ reason: 'damaged', message: `${name} ${what}. It's been kept, in case it can be recovered.`, cause });
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

/** An error's message. Read by shape, since a DOMException from another realm (a test's, a frame's) isn't `instanceof Error` here. */
function describeError(error: unknown): string {
	const message = typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined;
	return typeof message === 'string' ? message : String(error);
}

function logWarning(warning: string): void {
	console.warn(warning);
}

/** A failed copy to recovery doesn't stop a failed read reporting itself; a later write tries the copy again before replacing the save. */
function logSetAsideFailure(error: unknown): void {
	console.warn('CampaignStore: could not set an unreadable save aside', error);
}

function settled(): void {
	// The queue carries on whatever the call before did.
}
