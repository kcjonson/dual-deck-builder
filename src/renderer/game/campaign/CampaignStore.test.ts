import { resolveMapParams } from '../map/MapParams';
import { Campaign } from './Campaign';
import { CampaignHistoryEntry, HISTORY_SCHEMA_VERSION, historyToJson } from './CampaignHistory';
import { CAMPAIGN_KEYS, CampaignStore, CampaignStoreError } from './CampaignStore';
import { cardCount } from './CardCounts';
import { CAMPAIGN_SCHEMA_VERSION } from './SaveMigrations';
import { LocalSaveStorage, MemorySaveStorage, WebStorage } from './SaveStorage';
import campaignV1 from './__fixtures__/campaign-v1.json';
import { stressCampaign } from './__fixtures__/stressCampaign';

const SEED = 20261006;

type Method = 'getItem' | 'setItem' | 'removeItem';

/** Memory storage that fails the call a test names, as a blocked or full local storage, or a crash part way through, would. */
class FaultyStorage extends MemorySaveStorage {
	/** The call to fail; a torn write stores the first half of its value before failing, as a write cut off by a crash might. */
	public fault: { method: Method; key?: string; error?: unknown; torn?: boolean } | null = null;
	/** Every key written, in order. */
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

const newCampaign = (seed = SEED): Campaign => {
	const campaign = new Campaign({ seed, generatorVersion: 1, mapParams: resolveMapParams({ seed, environment: 'mixed' }).params, locker: { headshot: 2 } });
	campaign.recruitDriver({ archetype: 'road_warrior' });
	campaign.recruitDriver({ archetype: 'mechanic' });
	return campaign;
};

const storeOver = (storage: MemorySaveStorage, onWarning = jest.fn()): CampaignStore => new CampaignStore({ storage, onWarning });

/** Storage holding a save in slot a, as a session before this one left it, and anything else a test adds. */
const storageWith = (saveText: string, extra: Record<string, string> = {}): FaultyStorage =>
	new FaultyStorage({ items: { [CAMPAIGN_KEYS.slots.a]: saveText, [CAMPAIGN_KEYS.active]: 'a', ...extra } });

const fixtureText = (change: (save: Record<string, unknown>) => void = () => undefined): string => {
	const save = JSON.parse(JSON.stringify(campaignV1));
	change(save);
	return JSON.stringify(save);
};

/** The store error a call rejected with. */
async function failure(promise: Promise<unknown>): Promise<CampaignStoreError> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof CampaignStoreError) return error;
		throw error;
	}
	throw new Error('Expected the call to fail');
}

const quotaError = (): DOMException => new DOMException('The quota has been exceeded.', 'QuotaExceededError');

describe('CampaignStore', () => {
	describe('the save', () => {
		it('has nothing to continue until a campaign is saved', async () => {
			const store = storeOver(new MemorySaveStorage());

			expect(await store.hasSave()).toBe(false);
			expect(await store.load()).toBeNull();
		});

		it('saves a campaign and continues it in a new session', async () => {
			const storage = new MemorySaveStorage();
			const campaign = newCampaign();
			campaign.set({ day: 4, unrest: 2 });

			await storeOver(storage).save(campaign);
			const store = storeOver(storage);
			const loaded = await store.load();

			expect(await store.hasSave()).toBe(true);
			expect(loaded).not.toBe(campaign);
			expect(loaded?.toJSON()).toEqual(campaign.toJSON());
		});

		it('continues the version 1 fixture', async () => {
			const loaded = await storeOver(storageWith(fixtureText())).load();

			expect(loaded?.toJSON()).toEqual(campaignV1);
		});

		it('takes turns between two slots, switching `active` only once the new save is whole', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();

			await store.save(campaign);
			campaign.set({ day: 2 });
			await store.save(campaign);

			expect(storage.writes).toEqual([CAMPAIGN_KEYS.slots.a, CAMPAIGN_KEYS.active, CAMPAIGN_KEYS.slots.b, CAMPAIGN_KEYS.active]);
			expect(await storage.getItem(CAMPAIGN_KEYS.active)).toBe('b');
			expect(JSON.parse(await storage.getItem(CAMPAIGN_KEYS.slots.a) ?? '').day).toBe(1);
			expect(JSON.parse(await storage.getItem(CAMPAIGN_KEYS.slots.b) ?? '').day).toBe(2);
		});

		it.each([
			['the new save is cut off half written', { method: 'setItem', key: CAMPAIGN_KEYS.slots.b, torn: true }],
			['`active` never switches to it', { method: 'setItem', key: CAMPAIGN_KEYS.active }]
		] as const)('keeps the save before when %s, as after a crash', async (_label, fault) => {
			const storage = new FaultyStorage();
			const campaign = newCampaign();
			await storeOver(storage).save(campaign);
			campaign.set({ day: 2 });
			storage.fault = fault;

			const error = await failure(storeOver(storage).save(campaign));
			storage.fault = null;

			expect([error.reason, error.message]).toEqual(['storage', "The campaign couldn't be saved: storage failed."]);
			expect((await storeOver(storage).load())?.day).toBe(1);
		});

		it('says storage is full when the quota runs out, and keeps the save before', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			campaign.set({ day: 2 });
			storage.fault = { method: 'setItem', error: quotaError() };

			const error = await failure(store.save(campaign));
			storage.fault = null;

			expect([error.reason, error.message, error.detail]).toEqual(['storage', "The campaign couldn't be saved: storage is full.", 'The quota has been exceeded.']);
			expect((await storeOver(storage).load())?.day).toBe(1);
		});

		it('writes nothing for a campaign a save couldn\'t load back', async () => {
			const storage = new FaultyStorage();
			const campaign = Campaign.fromJSON(campaignV1);
			campaign.convoy.escorts[0].set({ structure: 41 });

			const error = await failure(storeOver(storage).save(campaign));

			expect([error.reason, error.message]).toEqual(['unsavable', "The campaign couldn't be saved: it holds something a save couldn't load back."]);
			expect(error.detail).toBe('Campaign.convoy[0].structure must be an integer from 1 to maxStructure (40), got 41');
			expect(storage.writes).toEqual([]);
		});

		it('writes the campaign as it stands when its turn comes, so a save asked for partway through a card move writes it whole', async () => {
			const storage = new MemorySaveStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			const [warrior] = campaign.drivers;
			const saves: Promise<void>[] = [];
			warrior.once('defaultDeck', () => saves.push(store.save(campaign)));

			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior });
			await Promise.all(saves);
			const loaded = await storeOver(storage).load();

			expect(saves).toHaveLength(1);
			expect([loaded?.locker, cardCount(loaded?.drivers[0].defaultDeck ?? {}, 'headshot')]).toEqual([{ headshot: 1 }, 1]);
		});

		it('takes calls in the order they come: a load right after a save reads it', async () => {
			const store = storeOver(new MemorySaveStorage());
			const campaign = newCampaign();

			void store.save(campaign);
			const loaded = await store.load();

			expect(loaded?.toJSON()).toEqual(campaign.toJSON());
		});

		it('hands map param repairs to the store\'s warnings, or the load\'s own', async () => {
			const text = fixtureText(save => { delete (save.mapParams as Record<string, unknown>).radius; });
			const storeWarning = jest.fn();
			const loadWarning = jest.fn();
			const store = new CampaignStore({ storage: storageWith(text), onWarning: storeWarning });

			await store.load();
			await store.load({ onWarning: loadWarning });

			const warning = 'Campaign.mapParams.radius was missing; took 1000, the mixed default';
			expect([storeWarning.mock.calls, loadWarning.mock.calls]).toEqual([[[warning]], [[warning]]]);
		});
	});

	describe('a save it can\'t read', () => {
		it.each([
			['text that isn\'t JSON', fixtureText().slice(0, 200), /JSON/],
			['a driver in a state that doesn\'t exist', fixtureText(save => { (save.drivers as { status: string }[])[1].status = 'sleeping'; }), 'Campaign.drivers[1].status must be one of ready, injured, dead, missing, got "sleeping"'],
			['a seed JSON reads as Infinity', fixtureText().replace('"seed":20261006', '"seed":1e999'), 'Campaign.seed must be an integer from 0 to 4294967295, got Infinity'],
			['a seed past uint32', fixtureText(save => { save.seed = 2 ** 32; }), 'Campaign.seed must be an integer from 0 to 4294967295, got 4294967296'],
			['no seed at all', fixtureText(save => { save.seed = null; }), 'Campaign.seed must be a number, got null']
		])('fails as damaged on %s, says so, and keeps it', async (_label, text, detail) => {
			const storage = storageWith(text);

			const error = await failure(storeOver(storage).load());

			expect([error.reason, error.message]).toEqual(['damaged', "The saved campaign is damaged and can't be loaded. It's been kept, in case it can be recovered."]);
			expect(error.detail).toMatch(detail);
			expect(await storage.getItem(CAMPAIGN_KEYS.slots.a)).toBe(text);
			expect(await storage.getItem(CAMPAIGN_KEYS.recovery)).toBe(text);
		});

		it('fails as newer on a save from a newer build, naming both versions, and keeps it', async () => {
			const text = fixtureText(save => { save.schemaVersion = CAMPAIGN_SCHEMA_VERSION + 1; });
			const storage = storageWith(text);

			const error = await failure(storeOver(storage).load());

			expect([error.reason, error.message]).toEqual([
				'newer',
				"The saved campaign is from a newer version of the game (save version 2; this one reads up to 1), so it can't be continued here. It's been kept."
			]);
			expect(await storage.getItem(CAMPAIGN_KEYS.recovery)).toBe(text);
		});

		it.each([
			['loaded first', true],
			['never loaded', false]
		])('isn\'t written over by a new campaign, %s', async (_label, loadFirst) => {
			const text = fixtureText(save => { save.schemaVersion = 9; });
			const storage = storageWith(text);
			const store = storeOver(storage);
			if (loadFirst) await failure(store.load());
			const founded = newCampaign(7);

			await store.save(founded);
			founded.set({ day: 2 });
			await store.save(founded);
			founded.set({ day: 3 });
			await store.save(founded);

			expect(await storage.getItem(CAMPAIGN_KEYS.recovery)).toBe(text);
			expect((await storeOver(storage).load())?.day).toBe(3);
		});

		it('is set aside before delete removes it', async () => {
			const text = fixtureText().slice(0, 200);
			const storage = storageWith(text);

			await storeOver(storage).delete();

			expect(await storage.getItem(CAMPAIGN_KEYS.recovery)).toBe(text);
			expect(await storage.getItem(CAMPAIGN_KEYS.active)).toBeNull();
		});

		it('fails as damaged when `active` names no save', async () => {
			const strange = storageWith(fixtureText(), { [CAMPAIGN_KEYS.active]: 'c' });
			const empty = storageWith(fixtureText(), { [CAMPAIGN_KEYS.active]: 'b' });

			expect((await failure(storeOver(strange).load())).detail).toBe(`${CAMPAIGN_KEYS.active} holds "c", which isn't a slot`);
			expect((await failure(storeOver(empty).load())).detail).toBe(`${CAMPAIGN_KEYS.active} names slot b, which is empty`);
			expect(await storeOver(strange).hasSave()).toBe(true);
		});

		it('still fails to load, and keeps the save, when storage won\'t take the copy', async () => {
			const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
			const text = fixtureText().slice(0, 200);
			const storage = storageWith(text);
			storage.fault = { method: 'setItem', key: CAMPAIGN_KEYS.recovery, error: quotaError() };

			try {
				expect((await failure(storeOver(storage).load())).reason).toBe('damaged');
				expect(warn).toHaveBeenCalledWith('CampaignStore: could not set an unreadable save aside', expect.any(CampaignStoreError));
				expect(await failure(storeOver(storage).save(newCampaign()))).toMatchObject({ reason: 'storage' });
				expect(await storage.getItem(CAMPAIGN_KEYS.slots.a)).toBe(text);
			} finally {
				warn.mockRestore();
			}
		});
	});

	it('fails a load with a message when storage throws, changing nothing', async () => {
		const storage = storageWith(fixtureText());
		storage.fault = { method: 'getItem', error: new DOMException('The operation is insecure.', 'SecurityError') };

		const error = await failure(storeOver(storage).load());

		expect([error.reason, error.message, error.detail]).toEqual(['storage', "The saved campaign couldn't be read: storage failed.", 'The operation is insecure.']);
		expect(storage.writes).toEqual([]);
	});

	describe('checkpoints', () => {
		it('wait for the step that asked for them to finish', async () => {
			const storage = new MemorySaveStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			const [warrior, mechanic] = campaign.drivers;
			const saved: Promise<boolean>[] = [];
			warrior.once('defaultDeck', () => saved.push(store.checkpoint(campaign)));

			campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: mechanic, count: 2 });

			expect(await Promise.all(saved)).toEqual([true]);
			const loaded = await storeOver(storage).load();
			expect(loaded?.drivers.map(driver => cardCount(driver.defaultDeck, 'ramming_speed'))).toEqual(campaign.drivers.map(driver => cardCount(driver.defaultDeck, 'ramming_speed')));
		});

		it('share one write while they wait their turn together, and write the latest state', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();

			const first = store.checkpoint(campaign);
			campaign.set({ day: 2 });
			const second = store.checkpoint(campaign);
			campaign.set({ day: 3 });

			expect(second).toBe(first);
			expect(await first).toBe(true);
			expect(storage.writes).toEqual([CAMPAIGN_KEYS.slots.a, CAMPAIGN_KEYS.active]);
			expect((await storeOver(storage).load())?.day).toBe(3);
		});

		it('make a new write once the one before has started', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();

			await store.checkpoint(campaign);
			campaign.set({ day: 2 });
			await store.checkpoint(campaign);

			expect(storage.writes).toHaveLength(4);
			expect((await storeOver(storage).load())?.day).toBe(2);
		});

		it('never reject: a failed one resolves false and tells onSaveFailed listeners why', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const heard: CampaignStoreError[] = [];
			const stop = store.onSaveFailed(error => heard.push(error));
			storage.fault = { method: 'setItem', error: quotaError() };

			expect(await store.checkpoint(newCampaign())).toBe(false);
			stop();
			const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
			try {
				expect(await store.checkpoint(newCampaign())).toBe(false);

				expect(heard.map(error => [error.reason, error.message])).toEqual([['storage', "The campaign couldn't be saved: storage is full."]]);
				expect(warn).toHaveBeenCalledWith("CampaignStore: The campaign couldn't be saved: storage is full.", 'The quota has been exceeded.');
			} finally {
				warn.mockRestore();
			}
		});
	});

	describe('ending a campaign', () => {
		it('puts it in the history as a few numbers, and removes the save', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			campaign.set({ day: 12, strongholdsTaken: ['stronghold-2'] });

			const entry = await store.end({ campaign, ending: 'starved' });

			expect(entry).toEqual({ seed: SEED, day: 12, strongholdsTaken: 1, ending: 'starved' });
			expect(await store.history()).toEqual([entry]);
			expect(await store.hasSave()).toBe(false);
			expect(storage.keys).toEqual([CAMPAIGN_KEYS.history]);
			expect(JSON.parse(await storage.getItem(CAMPAIGN_KEYS.history) ?? '')).toEqual({ schemaVersion: HISTORY_SCHEMA_VERSION, campaigns: [entry] });
		});

		it('lists past campaigns newest first', async () => {
			const store = storeOver(new MemorySaveStorage());

			await store.end({ campaign: newCampaign(1), ending: 'rioted' });
			await store.end({ campaign: newCampaign(2), ending: 'won' });

			expect((await store.history()).map(entry => [entry.seed, entry.ending])).toEqual([[2, 'won'], [1, 'rioted']]);
		});

		it('records a campaign ended twice once, so a crash between its two writes heals', async () => {
			const storage = new FaultyStorage();
			const campaign = newCampaign();
			const crashed = storeOver(storage);
			await crashed.save(campaign);
			storage.fault = { method: 'removeItem', key: CAMPAIGN_KEYS.active };

			expect((await failure(crashed.end({ campaign, ending: 'disbanded' }))).reason).toBe('storage');
			storage.fault = null;
			const store = storeOver(storage);
			const loaded = await store.load();
			await store.end({ campaign: loaded as Campaign, ending: 'disbanded' });

			expect(await store.history()).toHaveLength(1);
			expect(await store.hasSave()).toBe(false);
		});

		it('won\'t save it again, so it can\'t come back to Continue', async () => {
			const store = storeOver(new MemorySaveStorage());
			const campaign = newCampaign();
			await store.save(campaign);
			await store.end({ campaign, ending: 'abandoned' });

			const error = await failure(store.save(campaign));

			expect([error.reason, error.message]).toEqual(['unsavable', "The campaign couldn't be saved: it has ended."]);
			expect(await store.hasSave()).toBe(false);
		});

		it('leaves the save alone when it belongs to another campaign', async () => {
			const store = storeOver(new MemorySaveStorage());
			const saved = newCampaign(1);
			await store.save(saved);

			await store.end({ campaign: newCampaign(2), ending: 'disbanded' });

			expect((await store.load())?.seed).toBe(1);
		});

		it('sets a damaged history aside and starts a new one', async () => {
			const onWarning = jest.fn();
			const storage = storageWith(fixtureText(), { [CAMPAIGN_KEYS.history]: '{"schemaVersion":1,"campaigns":[{"seed":-4' });
			const store = storeOver(storage, onWarning);

			await store.end({ campaign: newCampaign(), ending: 'won' });

			expect(await store.history()).toHaveLength(1);
			expect(await storage.getItem(CAMPAIGN_KEYS.historyRecovery)).toBe('{"schemaVersion":1,"campaigns":[{"seed":-4');
			expect(onWarning).toHaveBeenCalledWith(expect.stringMatching(/^CampaignStore: set a damaged history aside and started a new one: /));
		});

		it('leaves a newer build\'s history as it is, without the campaign', async () => {
			const onWarning = jest.fn();
			const newer = JSON.stringify({ schemaVersion: HISTORY_SCHEMA_VERSION + 1, campaigns: [], unlocks: ['radio-mast'] });
			const storage = storageWith(fixtureText(), { [CAMPAIGN_KEYS.history]: newer });
			const store = storeOver(storage, onWarning);
			const campaign = (await store.load()) as Campaign;

			await store.end({ campaign, ending: 'starved' });

			expect(await storage.getItem(CAMPAIGN_KEYS.history)).toBe(newer);
			expect(await store.hasSave()).toBe(false);
			expect(onWarning).toHaveBeenCalledWith('CampaignStore: left the history as a newer build wrote it, without this campaign: CampaignHistory.schemaVersion is 2, newer than this build reads (1)');
		});

		it('refuses an ending that doesn\'t exist, changing nothing', async () => {
			const store = storeOver(new MemorySaveStorage());
			const campaign = newCampaign();
			await store.save(campaign);

			await expect(store.end({ campaign, ending: 'exploded' as 'won' })).rejects.toThrow('ending must be one of starved, rioted, disbanded, won, abandoned, got "exploded"');
			expect(await store.hasSave()).toBe(true);
			expect(await store.history()).toEqual([]);
		});
	});

	describe('the history', () => {
		it.each([
			['isn\'t JSON', '{"schemaVersion":1,'],
			['has a seed JSON reads as Infinity', '{"schemaVersion":1,"campaigns":[{"seed":1e999,"day":3,"strongholdsTaken":0,"ending":"won"}]}'],
			['has an ending that doesn\'t exist', JSON.stringify(historyToJson([{ seed: 1, day: 3, strongholdsTaken: 0, ending: 'exploded' as CampaignHistoryEntry['ending'] }]))]
		])('fails as damaged when it %s, and keeps it', async (_label, text) => {
			const storage = storageWith(fixtureText(), { [CAMPAIGN_KEYS.history]: text });

			const error = await failure(storeOver(storage).history());

			expect([error.reason, error.message]).toEqual(['damaged', "Campaign history is damaged and can't be shown. It's been kept, in case it can be recovered."]);
			expect(await storage.getItem(CAMPAIGN_KEYS.historyRecovery)).toBe(text);
		});

		it('fails as newer on a newer build\'s history', async () => {
			const storage = storageWith(fixtureText(), { [CAMPAIGN_KEYS.history]: JSON.stringify({ schemaVersion: 3, campaigns: [] }) });

			const error = await failure(storeOver(storage).history());

			expect([error.reason, error.message]).toEqual([
				'newer',
				"Campaign history is from a newer version of the game (version 3; this one reads up to 1), so it can't be shown here. It's been kept."
			]);
			expect(await storage.getItem(CAMPAIGN_KEYS.historyRecovery)).toBeNull();
		});
	});

	describe('delete', () => {
		it('removes the save from both slots, leaving the history', async () => {
			const storage = new MemorySaveStorage();
			const store = storeOver(storage);
			await store.end({ campaign: newCampaign(1), ending: 'won' });
			const campaign = newCampaign(2);
			await store.save(campaign);
			await store.save(campaign);

			await store.delete();

			expect(await store.hasSave()).toBe(false);
			expect(storage.keys).toEqual([CAMPAIGN_KEYS.history]);
		});

		it('does nothing without a save', async () => {
			const storage = new FaultyStorage();

			await storeOver(storage).delete();

			expect(storage.writes).toEqual([]);
		});

		it('won\'t let a late checkpoint write the deleted campaign back', async () => {
			const store = storeOver(new MemorySaveStorage());
			const failures = jest.fn();
			store.onSaveFailed(failures);
			const campaign = newCampaign();
			await store.save(campaign);

			await store.delete();

			expect(await store.checkpoint(campaign)).toBe(false);
			expect(failures).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unsavable', message: "The campaign couldn't be saved: its save was deleted." }));
			expect(await store.hasSave()).toBe(false);
			await store.save(newCampaign());
			expect(await store.hasSave()).toBe(true);
		});
	});

	it('keeps a long campaign well inside local storage, and loads it back as it was', async () => {
		const storage = new MemorySaveStorage();
		const campaign = stressCampaign();

		await storeOver(storage).save(campaign);
		const text = await storage.getItem(CAMPAIGN_KEYS.slots.a) ?? '';
		const loaded = await storeOver(storage).load();

		// Two slots and a recovery copy at this size fit local storage's 5 MiB an origin with room to spare;
		// a generated map that pushes a save past it is the cue to move saves to IndexedDB.
		expect(text.length).toBeLessThan(1024 * 1024);
		expect(loaded?.toJSON()).toEqual(campaign.toJSON());
	});
});

describe('LocalSaveStorage', () => {
	/** A Web Storage over a map, which can be set to throw as a blocked or full local storage does. */
	function webStorage(error?: unknown): WebStorage & { data: Map<string, string> } {
		const data = new Map<string, string>();
		const fail = (): void => {
			if (error) throw error;
		};
		return {
			data,
			getItem: (key) => {
				fail();
				return data.get(key) ?? null;
			},
			setItem: (key, value) => {
				fail();
				data.set(key, value);
			},
			removeItem: (key) => {
				fail();
				data.delete(key);
			}
		};
	}

	it('reads and writes the Web Storage it\'s given', async () => {
		const web = webStorage();
		const storage = new LocalSaveStorage({ storage: web });

		await storage.setItem('key', 'value');
		const read = await storage.getItem('key');
		await storage.removeItem('key');

		expect(read).toBe('value');
		expect(web.data.size).toBe(0);
		expect(await storage.getItem('missing')).toBeNull();
	});

	it('rejects with local storage\'s own error where it\'s blocked or full', async () => {
		const quota = quotaError();
		const storage = new LocalSaveStorage({ storage: webStorage(quota) });

		await expect(storage.setItem('key', 'value')).rejects.toBe(quota);
		await expect(storage.getItem('key')).rejects.toBe(quota);
	});

	it('rejects outside a browser window, where there is no local storage', async () => {
		await expect(new LocalSaveStorage().getItem('key')).rejects.toThrow('There is no local storage outside a browser window');
	});

	it('is what the shared store saves through', async () => {
		await expect(CampaignStore.shared.hasSave()).rejects.toMatchObject({ reason: 'storage', detail: 'There is no local storage outside a browser window' });
	});
});
