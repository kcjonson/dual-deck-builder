/**
 * Reduced motion: follow the system's preference, or force it on or off
 * (R11.13). The only setting the game has a working effect for today.
 */
export type MotionSetting = 'system' | 'reduced' | 'full';

/** The reduced-motion override a setting asks for: null follows the system. */
export function motionOverride(motion: MotionSetting): boolean | null {
	return motion === 'system' ? null : motion === 'reduced';
}

/** The slice of `Storage` this reads and writes, so a test can pass a map. */
export interface SettingsStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface GameSettingsOptions {
	/** Where the settings persist; null keeps them for this session only. */
	storage?: SettingsStorage | null;
}

export type SettingsListener = (settings: GameSettings) => void;

interface SettingsValues {
	motion: MotionSetting;
}

const STORAGE_KEY = 'dual-deckbuilder.settings';
const MOTION_SETTINGS: readonly MotionSetting[] = ['system', 'reduced', 'full'];

/**
 * The player's settings, persisted to local storage as one JSON record. Both
 * builds have it: Electron's renderer keeps local storage for its `file://`
 * page. A record that is missing, unreadable, or holds an unknown value falls
 * back to the default for that value, and a storage that throws (private
 * browsing, a full quota) leaves the settings working for the session.
 *
 * `shared` is the game's one instance, which the Settings screen edits and
 * `Game` applies; tests build their own over a map.
 */
export class GameSettings {
	private static sharedInstance: GameSettings | null = null;

	private readonly storage: SettingsStorage | null;
	private readonly values: SettingsValues;
	private readonly listeners: SettingsListener[] = [];

	constructor({ storage = null }: GameSettingsOptions = {}) {
		this.storage = storage;
		this.values = load(storage);
	}

	/** The game's settings, over the browser's local storage. */
	public static get shared(): GameSettings {
		if (!this.sharedInstance) this.sharedInstance = new GameSettings({ storage: browserStorage() });
		return this.sharedInstance;
	}

	public get motion(): MotionSetting {
		return this.values.motion;
	}

	public set motion(motion: MotionSetting) {
		if (this.values.motion === motion) return;
		this.values.motion = motion;
		this.changed();
	}

	/** Called after every change; returns the function that removes the listener. */
	public onChange(listener: SettingsListener): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index >= 0) this.listeners.splice(index, 1);
		};
	}

	private changed(): void {
		save(this.storage, this.values);
		for (const listener of [...this.listeners]) listener(this);
	}
}

function load(storage: SettingsStorage | null): SettingsValues {
	const values: SettingsValues = { motion: 'system' };
	let stored: unknown = null;
	try {
		const raw = storage?.getItem(STORAGE_KEY);
		stored = raw ? JSON.parse(raw) : null;
	} catch {
		return values;
	}
	if (typeof stored !== 'object' || stored === null) return values;
	const motion = (stored as Record<string, unknown>).motion;
	if (MOTION_SETTINGS.includes(motion as MotionSetting)) values.motion = motion as MotionSetting;
	return values;
}

function save(storage: SettingsStorage | null, values: SettingsValues): void {
	try {
		storage?.setItem(STORAGE_KEY, JSON.stringify(values));
	} catch (error) {
		console.warn('GameSettings: could not save settings', error);
	}
}

/** Reading `localStorage` itself throws where storage is blocked. */
function browserStorage(): SettingsStorage | null {
	try {
		return typeof window !== 'undefined' ? window.localStorage : null;
	} catch {
		return null;
	}
}
