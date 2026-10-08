/**
 * Where campaign saves persist: text under string keys. Async, though local
 * storage isn't, so IndexedDB can stand in if a generated map ever outgrows
 * local storage. `CampaignStore` asks little of it: writes land in the order
 * they're made, and one that resolved stays written. A write cut off part
 * way, by a crash or a full disk, is never read as the save, since the store
 * switches to a new save only once it's written whole.
 */
export interface SaveStorage {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	removeItem(key: string): Promise<void>;
}

/** The slice of the Web Storage API that `LocalSaveStorage` uses. */
export interface WebStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
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
		return window.localStorage;
	}
}

/** Whether a storage error is the quota running out, under the names browsers have given it. */
export function isQuotaError(error: unknown): boolean {
	const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
	return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}
