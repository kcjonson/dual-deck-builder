import type { SettingsStorage } from '../core/GameSettings';

/**
 * Where campaign saves persist: text under string keys. Async, though local
 * storage isn't, so IndexedDB can stand in if a generated map ever outgrows
 * local storage. `CampaignStore` needs every write to land whole or not at
 * all, `active` included, in the order made, and to stay written once it
 * resolves: local storage's writes do, and so do IndexedDB's transactions.
 */
export interface SaveStorage {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	removeItem(key: string): Promise<void>;
}

/** The slice of the Web Storage API that `LocalSaveStorage` uses: what `GameSettings` uses, and removing a key. */
export interface WebStorage extends SettingsStorage {
	removeItem(key: string): void;
}

/** Saves in a map, gone with the page: for tests. */
export class MemorySaveStorage implements SaveStorage {
	private readonly items: Map<string, string>;

	constructor({ items = {} }: { items?: Record<string, string> } = {}) {
		this.items = new Map(Object.entries(items));
	}

	/** Every key holding a value, in the order they were first set. */
	public get keys(): string[] {
		return [...this.items.keys()];
	}

	public async getItem(key: string): Promise<string | null> {
		return this.items.get(key) ?? null;
	}

	public async setItem(key: string, value: string): Promise<void> {
		this.items.set(key, value);
	}

	public async removeItem(key: string): Promise<void> {
		this.items.delete(key);
	}
}

export interface LocalSaveStorageOptions {
	/**
	 * The storage to use. Left out, it's the browser's local storage, which
	 * both builds have (Electron keeps it for its `file://` page), looked up
	 * on every call, since reading `window.localStorage` throws where storage
	 * is blocked.
	 */
	storage?: WebStorage;
}

/**
 * Saves in local storage. Where it's blocked or full, a call rejects with
 * local storage's own error (a SecurityError, a QuotaExceededError), and a
 * failed `setItem` leaves the old value, as the Web Storage spec requires.
 */
export class LocalSaveStorage implements SaveStorage {
	private readonly storage: WebStorage | null;

	constructor({ storage }: LocalSaveStorageOptions = {}) {
		this.storage = storage ?? null;
	}

	public async getItem(key: string): Promise<string | null> {
		return this.local.getItem(key);
	}

	public async setItem(key: string, value: string): Promise<void> {
		this.local.setItem(key, value);
	}

	public async removeItem(key: string): Promise<void> {
		this.local.removeItem(key);
	}

	private get local(): WebStorage {
		if (this.storage) return this.storage;
		if (typeof window === 'undefined') throw new Error('There is no local storage outside a browser window');
		// Some browsers with site data turned off hand back null rather than throwing.
		const local: WebStorage | null = window.localStorage;
		if (!local) throw new DOMException('Local storage is turned off', 'SecurityError');
		return local;
	}
}

/** Whether a storage error is the quota running out, under the names browsers have given it. */
export function isQuotaError(error: unknown): boolean {
	const name = errorName(error);
	return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/** What a storage error means for the player: storage is full, blocked (private browsing, site data turned off), or failed. */
export function storageTrouble(error: unknown): string {
	if (isQuotaError(error)) return 'storage is full';
	return errorName(error) === 'SecurityError' ? 'storage is blocked' : 'storage failed';
}

/** Read by shape, since a DOMException from another realm (a test's, a frame's) isn't `instanceof Error` here. */
function errorName(error: unknown): unknown {
	return typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
}
