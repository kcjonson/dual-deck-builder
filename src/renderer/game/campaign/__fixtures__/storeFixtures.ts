import { resolveMapParams } from '../../map/MapParams';
import { CAMPAIGN_SCHEMA_VERSION, Campaign, CampaignData } from '../Campaign';
import { stepLog } from '../CampaignEnd';
import { CampaignStore, CampaignStoreError, campaignKeys } from '../CampaignStore';
import { MemorySaveStorage, SaveStorage } from '../SaveStorage';
import cardsFile from '../../data/cards.json';
import campaignFixture from './campaign-v6.json';

export const SEED = 20261006;

/**
 * A campaign at the current save format (`CAMPAIGN_SCHEMA_VERSION`), which
 * loads and writes back the same. Tests take it from here, so a format bump
 * renames the file in one place.
 */
export const CAMPAIGN_FIXTURE = campaignFixture;

/** The namespace the store tests save under, and its keys. */
export const NAMESPACE = 'test';
export const KEYS = campaignKeys(NAMESPACE);

/** A small campaign, founded on `seed` with two drivers and two headshots in the locker. */
export function newCampaign(seed = SEED): Campaign {
	const campaign = new Campaign({ seed, generatorVersion: 1, mapParams: resolveMapParams({ seed, environment: 'mixed' }).params, locker: { headshot: 2 } });
	campaign.recruitDriver({ archetype: 'road_warrior' });
	campaign.recruitDriver({ archetype: 'mechanic' });
	return campaign;
}

/** A store over the storage in the test namespace, whose warnings go to `onWarning`, or nowhere. */
export function storeOver(storage: SaveStorage, { onWarning = () => undefined, version }: { onWarning?: (warning: string) => void; version?: number } = {}): CampaignStore {
	return new CampaignStore({ storage, namespace: NAMESPACE, version, onWarning });
}

/** Save text as the store writes it: the version, the write count, then the campaign's text. */
export function saveText({ campaign, version = CAMPAIGN_SCHEMA_VERSION, sequence = 1 }: { campaign: string; version?: number; sequence?: number }): string {
	return `{"version":${version},"sequence":${sequence},"campaign":${campaign}}`;
}

/** The fixture as save text, its campaign changed first if asked. */
export function fixtureText(change: (campaign: Record<string, unknown>) => void = () => undefined): string {
	const campaign = JSON.parse(JSON.stringify(CAMPAIGN_FIXTURE));
	change(campaign);
	return saveText({ campaign: JSON.stringify(campaign) });
}

/**
 * The fixture's campaign with its run home and unwound, as the compound
 * holds it between runs: every driver's cards back in their default deck,
 * what they borrowed back in the locker. Changed first if asked.
 */
export function atHomeCampaign(change: (campaign: Campaign) => void = () => undefined): Campaign {
	const campaign = Campaign.fromJSON(JSON.parse(JSON.stringify(CAMPAIGN_FIXTURE)), { onWarning: () => undefined });
	campaign.unwindRunDecks();
	change(campaign);
	return campaign;
}

/** `atHomeCampaign` as save text. */
export function atHomeText(change: (campaign: Campaign) => void = () => undefined): string {
	return saveText({ campaign: atHomeCampaign(change).toSaveText() });
}

/**
 * The fixture home from its run, then lost as `end` says, on its day 9:
 * with no People left, or with nobody left at the compound, its last
 * drivers killed or missing on a third run that failed carrying nothing.
 * No food when it starved, and unrest 12 when it rioted. The log ends with
 * the fall's line, as play writes it.
 */
export function lostCampaign(end: NonNullable<CampaignData['end']>): Campaign {
	return atHomeCampaign((campaign) => {
		const { resources, tally } = campaign;
		if (end.cause === 'last_driver') {
			const [warrior, , mechanic, , interceptor] = campaign.drivers;
			warrior.set({ status: 'dead', hitpoints: 0, defaultDeck: {} });
			mechanic.set({ status: 'missing', injuredDays: 0 });
			interceptor.set({ status: 'missing' });
		}
		campaign.set({
			resources: { ...resources, people: end.cause === 'no_people' ? 0 : resources.people, food: end.ending === 'starved' ? 0 : resources.food },
			unrest: end.ending === 'rioted' ? 12 : campaign.unrest,
			tally: end.cause === 'last_driver' ? { ...tally, runsFailed: tally.runsFailed + 1 } : tally,
			log: stepLog({ log: campaign.log, day: campaign.day, lines: [], end }),
			end
		});
	});
}

/**
 * The longest lists the Crew screen shows from the shipped cards: the
 * fixture at home, its first driver's deck at the most a deck holds, and
 * the locker holding one to four copies of every card that isn't an
 * escort's signature card, the Interceptor's Precision Shot among them.
 */
export function fullLockerCampaign(): Campaign {
	return atHomeCampaign((campaign) => {
		const types = cardsFile.cards.filter((card) => card.rarity !== 'signature').map((card) => card.type);
		campaign.drivers[0].set({
			defaultDeck: { armor_plating: 3, covering_fire: 1, far_shoot: 2, flank: 1, nitro_boost: 2, oil_slick: 1, point_blank: 2, ram: 2, ramming_speed: 4, repair_kit: 2 },
		});
		campaign.set({ locker: Object.fromEntries(types.map((type, index) => [type, (index % 4) + 1])) });
	});
}

/** A save of this version that won't load: a driver in a state that doesn't exist. */
export function damagedText(): string {
	return fixtureText(campaign => { (campaign.drivers as { status: string }[])[1].status = 'sleeping'; });
}

/** The fixture saved by the next version of the save format. */
export function outdatedText(): string {
	return saveText({ campaign: JSON.stringify(CAMPAIGN_FIXTURE), version: CAMPAIGN_SCHEMA_VERSION + 1 });
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

/** Memory storage that fails the calls a test names, as a blocked or full local storage, or a crash part way through, would. */
export class FaultyStorage extends MemorySaveStorage {
	/** The call to fail, every time or only the next `times`. */
	public fault: { method: Method; key?: string; error?: unknown; times?: number } | null = null;
	/** Every key written or removed, in order, removals marked. */
	public readonly writes: string[] = [];

	public override async getItem(key: string): Promise<string | null> {
		this.check('getItem', key);
		return super.getItem(key);
	}

	public override async setItem(key: string, value: string): Promise<void> {
		this.writes.push(key);
		this.check('setItem', key);
		await super.setItem(key, value);
	}

	public override async removeItem(key: string): Promise<void> {
		this.writes.push(`remove ${key}`);
		this.check('removeItem', key);
		await super.removeItem(key);
	}

	private check(method: Method, key: string): void {
		const fault = this.fault;
		if (fault === null || fault.method !== method || (fault.key !== undefined && fault.key !== key)) return;
		if (fault.times !== undefined && --fault.times <= 0) this.fault = null;
		throw fault.error ?? new Error(`${method} ${key} failed`);
	}
}

/** Storage holding a save in slot a, as a session before this one left it, and anything else a test adds. */
export function storageWith(text: string, extra: Record<string, string> = {}): FaultyStorage {
	return new FaultyStorage({ items: { [KEYS.slots.a]: text, [KEYS.active]: 'a', ...extra } });
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

type Tab = 'A' | 'B';

/**
 * Two tabs' storage over one shared map, each call held until `step` lets it
 * through, as two tabs on one origin interleave. When both tabs have a call
 * waiting, `choose` picks which goes first.
 */
export class TwoTabs {
	public readonly shared = new MemorySaveStorage();
	private readonly waiting: Record<Tab, (() => void)[]> = { A: [], B: [] };
	private readonly choose: () => Tab;

	constructor({ choose = () => 'A' }: { choose?: () => Tab } = {}) {
		this.choose = choose;
	}

	public tab(name: Tab): SaveStorage {
		const held = async <T>(call: () => Promise<T>): Promise<T> => {
			await new Promise<void>(resume => this.waiting[name].push(resume));
			return call();
		};
		return {
			getItem: key => held(() => this.shared.getItem(key)),
			setItem: (key, value) => held(() => this.shared.setItem(key, value)),
			removeItem: key => held(() => this.shared.removeItem(key))
		};
	}

	/** Lets one waiting call through; false when neither tab is waiting. */
	public async step(): Promise<boolean> {
		await settle();
		const ready = (['A', 'B'] as const).filter(name => this.waiting[name].length > 0);
		if (ready.length === 0) return false;
		const name = ready.length === 2 ? this.choose() : ready[0];
		this.waiting[name].shift()?.();
		await settle();
		return true;
	}

	/** Lets every call through until both tabs are done. */
	public async drain(): Promise<void> {
		let stepped = true;
		while (stepped) stepped = await this.step();
	}
}

/**
 * Runs a race once for every order two tabs' storage calls can take, and
 * says how many orders there were. Each run replays the choices of the run
 * before up to its last 'A', and takes 'B' there instead: a depth-first walk
 * that branches only where both tabs have a call waiting.
 */
export async function everyInterleaving(race: (tabs: TwoTabs) => Promise<void>): Promise<number> {
	const path: Tab[] = [];
	let runs = 0;
	for (;;) {
		let depth = 0;
		await race(new TwoTabs({
			choose: () => {
				if (depth === path.length) path.push('A');
				return path[depth++];
			}
		}));
		runs += 1;
		while (path.length > 0 && path[path.length - 1] === 'B') path.pop();
		if (path.length === 0) return runs;
		path[path.length - 1] = 'B';
	}
}
