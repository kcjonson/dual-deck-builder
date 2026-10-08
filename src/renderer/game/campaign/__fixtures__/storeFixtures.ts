import { resolveMapParams } from '../../map/MapParams';
import { Campaign } from '../Campaign';
import { CAMPAIGN_KEYS, CampaignStore, CampaignStoreError } from '../CampaignStore';
import { MemorySaveStorage, SaveStorage } from '../SaveStorage';
import campaignV1 from './campaign-v1.json';

export const SEED = 20261006;

/** A small campaign, founded on `seed` with two drivers and two headshots in the locker. */
export function newCampaign(seed = SEED): Campaign {
	const campaign = new Campaign({ seed, generatorVersion: 1, mapParams: resolveMapParams({ seed, environment: 'mixed' }).params, locker: { headshot: 2 } });
	campaign.recruitDriver({ archetype: 'road_warrior' });
	campaign.recruitDriver({ archetype: 'mechanic' });
	return campaign;
}

/** A store over the storage, whose warnings go to `onWarning`, or nowhere. */
export function storeOver(storage: SaveStorage, onWarning: (warning: string) => void = () => undefined): CampaignStore {
	return new CampaignStore({ storage, onWarning });
}

/** The version 1 fixture as save text, changed first if asked. */
export function fixtureText(change: (save: Record<string, unknown>) => void = () => undefined): string {
	const save = JSON.parse(JSON.stringify(campaignV1));
	change(save);
	return JSON.stringify(save);
}

/** The store error a call rejected with. */
export async function failure(promise: Promise<unknown>): Promise<CampaignStoreError> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof CampaignStoreError) return error;
		throw error;
	}
	throw new Error('Expected the call to fail');
}

export const quotaError = (): DOMException => new DOMException('The quota has been exceeded.', 'QuotaExceededError');

export const securityError = (): DOMException => new DOMException('The operation is insecure.', 'SecurityError');

/** Lets every waiting promise run: one macrotask turn. */
export const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

type Method = 'getItem' | 'setItem' | 'removeItem';

/** Memory storage that fails the call a test names, as a blocked or full local storage, or a crash part way through, would. */
export class FaultyStorage extends MemorySaveStorage {
	/** The call to fail; a torn write stores the first half of its value before failing, as a write cut off by a crash might. */
	public fault: { method: Method; key?: string; error?: unknown; torn?: boolean } | null = null;
	/** Every key written or removed, in order, removals marked. */
	public readonly writes: string[] = [];

	public override async getItem(key: string): Promise<string | null> {
		this.check('getItem', key);
		return super.getItem(key);
	}

	public override async setItem(key: string, value: string): Promise<void> {
		this.writes.push(key);
		if (this.matches('setItem', key) && this.fault?.torn) await super.setItem(key, value.slice(0, Math.floor(value.length / 2)));
		this.check('setItem', key);
		await super.setItem(key, value);
	}

	public override async removeItem(key: string): Promise<void> {
		this.writes.push(`remove ${key}`);
		this.check('removeItem', key);
		await super.removeItem(key);
	}

	private matches(method: Method, key: string): boolean {
		return this.fault !== null && this.fault.method === method && (this.fault.key === undefined || this.fault.key === key);
	}

	private check(method: Method, key: string): void {
		if (this.matches(method, key)) throw this.fault?.error ?? new Error(`${method} ${key} failed`);
	}
}

/** Storage holding a save in slot a, as a session before this one left it, and anything else a test adds. */
export function storageWith(saveText: string, extra: Record<string, string> = {}): FaultyStorage {
	return new FaultyStorage({ items: { [CAMPAIGN_KEYS.slots.a]: saveText, [CAMPAIGN_KEYS.active]: 'a', ...extra } });
}

/** Memory storage whose calls wait while it's held, as a slow storage's would, so a test can act while a write is in flight. */
export class HeldStorage extends MemorySaveStorage {
	private held: (() => void)[] | null = null;

	/** Every call from now on waits until `release`. */
	public hold(): void {
		if (this.held === null) this.held = [];
	}

	public release(): void {
		const held = this.held ?? [];
		this.held = null;
		held.forEach(resume => resume());
	}

	/** Calls waiting for `release`. */
	public get waiting(): number {
		return this.held?.length ?? 0;
	}

	public override async getItem(key: string): Promise<string | null> {
		await this.wait();
		return super.getItem(key);
	}

	public override async setItem(key: string, value: string): Promise<void> {
		await this.wait();
		await super.setItem(key, value);
	}

	public override async removeItem(key: string): Promise<void> {
		await this.wait();
		await super.removeItem(key);
	}

	private async wait(): Promise<void> {
		const held = this.held;
		if (held) await new Promise<void>(resume => held.push(resume));
	}
}

/** Two tabs' storage over one shared map, each call held until `step` lets it through, as two tabs on one origin interleave. */
export class TwoTabs {
	public readonly shared = new MemorySaveStorage();
	private readonly waiting = new Map<'A' | 'B', () => void>();

	public tab(name: 'A' | 'B'): SaveStorage {
		const held = async <T>(call: () => Promise<T>): Promise<T> => {
			await new Promise<void>(resume => this.waiting.set(name, resume));
			return call();
		};
		return {
			getItem: key => held(() => this.shared.getItem(key)),
			setItem: (key, value) => held(() => this.shared.setItem(key, value)),
			removeItem: key => held(() => this.shared.removeItem(key))
		};
	}

	/** Lets one waiting call through, the named tab's when it has one; false when neither tab is waiting. */
	public async step(prefer: 'A' | 'B'): Promise<boolean> {
		await settle();
		const name = this.waiting.has(prefer) ? prefer : prefer === 'A' ? 'B' : 'A';
		const resume = this.waiting.get(name);
		if (!resume) return false;
		this.waiting.delete(name);
		resume();
		await settle();
		return true;
	}

	/** Lets every call through until both tabs are done. */
	public async drain(): Promise<void> {
		let stepped = true;
		while (stepped) stepped = await this.step('A');
	}
}
