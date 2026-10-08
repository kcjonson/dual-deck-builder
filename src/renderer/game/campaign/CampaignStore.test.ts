import { Campaign } from './Campaign';
import { CampaignEnding, CampaignHistoryEntry, HISTORY_SCHEMA_VERSION, historyToJson } from './CampaignHistory';
import { CAMPAIGN_KEYS, CampaignStore, CampaignStoreError } from './CampaignStore';
import { cardCount } from './CardCounts';
import { CAMPAIGN_SCHEMA_VERSION } from './SaveMigrations';
import { LocalSaveStorage, MemorySaveStorage, WebStorage } from './SaveStorage';
import campaignV1 from './__fixtures__/campaign-v1.json';
import { stressCampaign } from './__fixtures__/stressCampaign';
import {
	FaultyStorage, HeldStorage, SEED, TwoTabs, failure, fixtureText, newCampaign, quotaError, securityError, settle, storageWith, storeOver
} from './__fixtures__/storeFixtures';

const KEYS = CAMPAIGN_KEYS;

/**
 * The most a save may hold. Local storage keeps about 5 MiB an origin; the
 * store can hold three copies of a save (two slots and a recovery copy),
 * which at two bytes a character fit in 873,813 characters, and the origin
 * keeps the settings and the history besides.
 */
const SAVE_BUDGET = 800000;

/** Every order of `a` calls from tab A and `b` from tab B. */
function interleavings(a: number, b: number): ('A' | 'B')[][] {
	if (a === 0) return [new Array<'B'>(b).fill('B')];
	if (b === 0) return [new Array<'A'>(a).fill('A')];
	return [
		...interleavings(a - 1, b).map(rest => ['A' as const, ...rest]),
		...interleavings(a, b - 1).map(rest => ['B' as const, ...rest])
	];
}

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

			expect(storage.writes).toEqual([KEYS.slots.a, KEYS.active, KEYS.slots.b, KEYS.active]);
			expect(await storage.getItem(KEYS.active)).toBe('b');
			expect(JSON.parse(await storage.getItem(KEYS.slots.a) ?? '').day).toBe(1);
			expect(JSON.parse(await storage.getItem(KEYS.slots.b) ?? '').day).toBe(2);
		});

		it.each([
			['the new save is cut off half written', { method: 'setItem', key: KEYS.slots.b, torn: true }],
			['`active` never switches to it', { method: 'setItem', key: KEYS.active }]
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

		it('says storage is blocked where the browser blocks it, changing nothing', async () => {
			const storage = storageWith(fixtureText());
			storage.fault = { method: 'getItem', error: securityError() };

			const error = await failure(storeOver(storage).load());

			expect([error.reason, error.message, error.detail]).toEqual(['storage', "The saved campaign couldn't be read: storage is blocked.", 'The operation is insecure.']);
			expect(storage.writes).toEqual([]);
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

		it('writes nothing when the campaign hasn\'t changed since its save', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();

			await store.save(campaign);
			await store.checkpoint(campaign);
			await store.save(campaign);

			expect(storage.writes).toEqual([KEYS.slots.a, KEYS.active]);
		});

		it('captures the campaign once the code that asked has run, so a save asked for partway through a card move writes it whole', async () => {
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

		it('captures a step that awaits part way as it stood at the await: a listener\'s save is whole only for a synchronous step', async () => {
			const storage = new MemorySaveStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			const [warrior] = campaign.drivers;
			const saves: Promise<void>[] = [];
			warrior.once('hitpoints', () => saves.push(store.save(campaign)));

			warrior.set({ hitpoints: warrior.hitpoints - 5 });
			await Promise.resolve();
			campaign.set({ day: 2 });
			await Promise.all(saves);
			const loaded = await storeOver(storage).load();

			expect([loaded?.drivers[0].hitpoints, loaded?.day]).toEqual([warrior.hitpoints, 1]);
		});

		it('takes a queued checkpoint\'s text at the end of its step, not when slow storage gets to it', async () => {
			const storage = new HeldStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			storage.hold();

			campaign.set({ day: 2 });
			const first = store.checkpoint(campaign);
			await settle();
			campaign.set({ day: 3 });
			const second = store.checkpoint(campaign);
			await settle();
			campaign.set({ unrest: 3 });
			storage.release();

			expect(await Promise.all([first, second])).toEqual([true, true]);
			const loaded = await storeOver(storage).load();
			expect([loaded?.day, loaded?.unrest]).toEqual([3, 0]);
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

		it('loads a save whose warning callback throws, and logs the throw instead of calling the save damaged', async () => {
			const repaired = fixtureText(save => { delete (save.mapParams as Record<string, unknown>).radius; });
			const kept = fixtureText(save => { save.schemaVersion = CAMPAIGN_SCHEMA_VERSION + 1; });
			const storage = storageWith(repaired, { [KEYS.recovery]: kept });
			const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

			try {
				const loaded = await storeOver(storage).load({ onWarning: () => { throw new Error('toast bug'); } });

				expect(loaded?.mapParams.radius).toBe(1000);
				expect(await storage.getItem(KEYS.recovery)).toBe(kept);
				expect(errors).toHaveBeenCalledWith('CampaignStore: a warning callback threw', expect.any(Error));
			} finally {
				errors.mockRestore();
			}
		});

		it('checks the slot the next write lands in while loading, so the checkpoints after parse nothing', async () => {
			const storage = new MemorySaveStorage();
			const campaign = newCampaign();
			const before = storeOver(storage);
			await before.save(campaign);
			campaign.set({ day: 2 });
			await before.save(campaign);
			const store = storeOver(storage);
			const loaded = await store.load() as Campaign;
			const parse = jest.spyOn(Campaign, 'fromJSON');

			try {
				loaded.set({ day: 3 });
				expect(await store.checkpoint(loaded)).toBe(true);
				loaded.set({ day: 4 });
				expect(await store.checkpoint(loaded)).toBe(true);

				expect(parse).not.toHaveBeenCalled();
			} finally {
				parse.mockRestore();
			}
			expect((await storeOver(storage).load())?.day).toBe(4);
		});
	});

	describe('finding the save', () => {
		it('takes the save from the other slot when `active` names an empty one', async () => {
			const store = storeOver(storageWith(fixtureText(), { [KEYS.active]: 'b' }));

			expect(await store.hasSave()).toBe(true);
			expect((await store.load())?.toJSON()).toEqual(campaignV1);
		});

		it('finds no save when `active` names an empty slot and the other is empty too, and claims to keep nothing', async () => {
			const storage = new FaultyStorage({ items: { [KEYS.active]: 'b' } });
			const store = storeOver(storage);

			expect(await store.hasSave()).toBe(false);
			expect(await store.load()).toBeNull();
			expect(await storage.getItem(KEYS.recovery)).toBeNull();
			await store.save(newCampaign());
			expect((await storeOver(storage).load())?.seed).toBe(SEED);
		});

		it('takes a save no `active` names, as a first write cut off before its switch leaves', async () => {
			const store = storeOver(new MemorySaveStorage({ items: { [KEYS.slots.b]: fixtureText() } }));

			expect(await store.hasSave()).toBe(true);
			expect((await store.load())?.day).toBe(9);
		});

		it('prefers a slot that loads when nothing names one', async () => {
			const store = storeOver(new MemorySaveStorage({ items: { [KEYS.slots.a]: fixtureText().slice(0, 200), [KEYS.slots.b]: fixtureText() } }));

			expect((await store.load())?.day).toBe(9);
		});

		it('leaves a save under an `active` this build doesn\'t know alone until the player deletes it', async () => {
			const newer = fixtureText(save => { save.schemaVersion = CAMPAIGN_SCHEMA_VERSION + 1; });
			const storage = new FaultyStorage({ items: { [KEYS.slots.a]: newer, [KEYS.active]: 'c' } });
			const store = storeOver(storage);

			const error = await failure(store.load());
			const refused = await failure(store.save(newCampaign()));

			expect([error.reason, error.message, error.detail]).toEqual([
				'newer',
				"The saved campaign is from a newer version of the game, so it can't be continued here. It's been left as it is.",
				`${KEYS.active} holds "c", which this build doesn't know`
			]);
			expect([refused.reason, refused.message]).toEqual(['newer', "The campaign couldn't be saved: storage holds a save from a newer version of the game."]);
			expect(await store.hasSave()).toBe(true);
			expect(storage.writes).toEqual([]);

			await store.delete();

			expect(await storage.getItem(KEYS.recovery)).toBe(newer);
			expect(storage.keys).toEqual([KEYS.recovery]);
			await store.save(newCampaign());
			expect(await store.hasSave()).toBe(true);
		});

		it('copies a newer build\'s save aside before a checkpoint writes over the slot it took', async () => {
			const storage = new MemorySaveStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			const newer = fixtureText(save => { save.schemaVersion = CAMPAIGN_SCHEMA_VERSION + 1; });
			await storage.setItem(KEYS.slots.b, newer);
			await storage.setItem(KEYS.active, 'b');

			campaign.set({ day: 2 });
			expect(await store.checkpoint(campaign)).toBe(true);
			expect(await storage.getItem(KEYS.slots.b)).toBe(newer);
			campaign.set({ day: 3 });
			expect(await store.checkpoint(campaign)).toBe(true);

			expect(await storage.getItem(KEYS.recovery)).toBe(newer);
		});

		it.each([
			['a delete', 5],
			['an end', 7]
		] as const)('agrees with itself after %s in one tab races a checkpoint in another, whatever the order', async (finish, calls) => {
			const outcomes = new Set<string>();
			for (const order of interleavings(calls, 5)) {
				const tabs = new TwoTabs();
				await storeOver(tabs.shared).save(newCampaign(1));
				const tabA = storeOver(tabs.tab('A'));
				const loading = tabA.load();
				await tabs.drain();
				const original = await loading as Campaign;
				const tabB = storeOver(tabs.tab('B'));
				const finished = finish === 'a delete' ? tabA.delete() : tabA.end({ campaign: original, ending: 'abandoned' });
				const saved = tabB.checkpoint(newCampaign(2));

				for (const tab of order) await tabs.step(tab);
				await tabs.drain();
				await finished;

				expect(await saved).toBe(true);
				const fresh = storeOver(tabs.shared);
				const loaded = await fresh.load();
				expect(await fresh.hasSave()).toBe(loaded !== null);
				// Nothing, or the other tab's campaign; never the one tab A finished.
				expect([null, 2]).toContain(loaded?.seed ?? null);
				outcomes.add(loaded === null ? 'nothing' : 'the other tab\'s campaign');
			}
			expect([...outcomes].sort()).toEqual(['nothing', 'the other tab\'s campaign']);
		}, 60000);
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

			expect([error.reason, error.message]).toEqual(['damaged', "The saved campaign is damaged and can't be loaded. It's been kept."]);
			expect(error.detail).toMatch(detail);
			expect(await storage.getItem(KEYS.slots.a)).toBe(text);
			expect(await storage.getItem(KEYS.recovery)).toBe(text);
		});

		it('fails as newer on a save from a newer build, naming both versions, and keeps it', async () => {
			const text = fixtureText(save => { save.schemaVersion = CAMPAIGN_SCHEMA_VERSION + 1; });
			const storage = storageWith(text);

			const error = await failure(storeOver(storage).load());

			expect([error.reason, error.message]).toEqual([
				'newer',
				"The saved campaign is from a newer version of the game (save version 2; this one reads up to 1), so it can't be continued here. It's been kept."
			]);
			expect(await storage.getItem(KEYS.recovery)).toBe(text);
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

			expect(await storage.getItem(KEYS.recovery)).toBe(text);
			expect((await storeOver(storage).load())?.day).toBe(3);
		});

		it('is set aside before delete removes it', async () => {
			const text = fixtureText().slice(0, 200);
			const storage = storageWith(text);

			await storeOver(storage).delete();

			expect(await storage.getItem(KEYS.recovery)).toBe(text);
			expect(storage.keys).toEqual([KEYS.recovery]);
		});

		it('is set aside before delete removes it from a slot `active` doesn\'t name', async () => {
			const newer = fixtureText(save => { save.schemaVersion = CAMPAIGN_SCHEMA_VERSION + 1; });
			const storage = storageWith(newer, { [KEYS.active]: 'b' });

			await storeOver(storage).delete();

			expect(await storage.getItem(KEYS.recovery)).toBe(newer);
			expect(storage.keys).toEqual([KEYS.recovery]);
		});

		it('is copied aside while loading when it sits in the slot the next write takes', async () => {
			const damaged = fixtureText().slice(0, 300);
			const storage = new MemorySaveStorage({ items: { [KEYS.slots.a]: fixtureText(), [KEYS.slots.b]: damaged, [KEYS.active]: 'a' } });

			await storeOver(storage).load();

			expect(await storage.getItem(KEYS.recovery)).toBe(damaged);
		});

		it('still fails to load, and is never written over, when storage won\'t take the copy', async () => {
			const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
			const text = fixtureText().slice(0, 200);
			const storage = storageWith(text);
			storage.fault = { method: 'setItem', key: KEYS.recovery, error: quotaError() };
			const store = storeOver(storage);
			const founded = newCampaign();

			try {
				expect((await failure(store.load())).reason).toBe('damaged');
				expect(warn).toHaveBeenCalledWith('CampaignStore: could not set an unreadable save aside', expect.any(CampaignStoreError));
				await store.save(founded);
				founded.set({ day: 2 });
				expect((await failure(store.save(founded))).message).toBe("The campaign couldn't be saved: storage is full.");
				expect(await storage.getItem(KEYS.slots.a)).toBe(text);
			} finally {
				warn.mockRestore();
			}
		});

		it('goes when the player deletes it and storage is too full for the copy, since they asked', async () => {
			const storage = storageWith(fixtureText().slice(0, 300));
			storage.fault = { method: 'setItem', key: KEYS.recovery, error: quotaError() };
			const onWarning = jest.fn();

			await storeOver(storage, onWarning).delete();

			expect(storage.keys).toEqual([]);
			expect(onWarning).toHaveBeenCalledWith('CampaignStore: storage was too full to keep a copy of the save in slot a; deleted it anyway');
		});

		it('stays when the copy fails for any other reason, and so does the delete', async () => {
			const text = fixtureText().slice(0, 300);
			const storage = storageWith(text);
			storage.fault = { method: 'setItem', key: KEYS.recovery };

			expect((await failure(storeOver(storage).delete())).reason).toBe('storage');
			expect(await storage.getItem(KEYS.slots.a)).toBe(text);
		});
	});

	describe('which campaign the save belongs to', () => {
		it('won\'t let a screen\'s instance save over the campaign that replaced its own', async () => {
			const store = storeOver(new MemorySaveStorage());
			const inScreen = newCampaign(1);
			await store.save(inScreen);
			const inMenu = await store.load() as Campaign;
			await store.end({ campaign: inMenu, ending: 'abandoned' });
			await store.save(newCampaign(2));

			inScreen.set({ day: 5 });

			expect(await store.checkpoint(inScreen)).toBe(false);
			expect((await store.load())?.seed).toBe(2);
			expect((await store.history()).map(entry => [entry.seed, entry.ending])).toEqual([[1, 'abandoned']]);
			const error = await failure(store.save(inScreen));
			expect([error.reason, error.message]).toEqual(['retired', "The campaign couldn't be saved: it has ended."]);
		});

		it('won\'t let any instance of a deleted campaign save it back', async () => {
			const store = storeOver(new MemorySaveStorage());
			const campaign = newCampaign();
			await store.save(campaign);
			await store.load();

			await store.delete();

			expect(await store.checkpoint(campaign)).toBe(false);
			expect(await store.hasSave()).toBe(false);
			expect((await failure(store.save(campaign))).message).toBe("The campaign couldn't be saved: its save was deleted.");
		});

		it('removes the save when any instance of its campaign ends', async () => {
			const store = storeOver(new MemorySaveStorage());
			const campaign = newCampaign();
			await store.save(campaign);
			await store.load();

			await store.end({ campaign, ending: 'disbanded' });

			expect(await store.hasSave()).toBe(false);
			expect(await store.history()).toHaveLength(1);
		});

		it('retires a deleted campaign before removing anything, so a late checkpoint can\'t undo a delete that failed part way', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			storage.fault = { method: 'removeItem', key: KEYS.active };

			expect((await failure(store.delete())).reason).toBe('storage');
			storage.fault = null;
			campaign.set({ day: 4 });

			expect(await store.checkpoint(campaign)).toBe(false);
			// The save's slot went before `active` could, so there's nothing to continue.
			expect(await store.hasSave()).toBe(false);
		});

		it('retires the save\'s campaign even when its save has already gone', async () => {
			const storage = new MemorySaveStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			await storage.removeItem(KEYS.active);
			await storage.removeItem(KEYS.slots.a);

			await store.delete();

			expect(await store.checkpoint(campaign)).toBe(false);
			expect(await store.hasSave()).toBe(false);
		});

		it('treats a campaign it hasn\'t seen as a new one, which retires the campaign it replaces', async () => {
			const store = storeOver(new MemorySaveStorage());
			const first = newCampaign(1);
			await store.save(first);

			await store.save(newCampaign(2));

			expect(await store.checkpoint(first)).toBe(false);
			expect((await failure(store.save(first))).message).toBe("The campaign couldn't be saved: a new campaign replaced it.");
			expect((await store.load())?.seed).toBe(2);
		});
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
			expect(loaded?.toJSON()).toEqual(campaign.toJSON());
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
			expect(storage.writes).toEqual([KEYS.slots.a, KEYS.active]);
			expect((await storeOver(storage).load())?.day).toBe(3);
		});

		it('take the latest step\'s state when one joins after the first\'s snapshot, while the write still waits', async () => {
			const storage = new HeldStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			storage.hold();
			const busy = store.save(newCampaign(9));
			await settle();

			const first = store.checkpoint(campaign);
			await settle();
			campaign.set({ day: 2 });
			const second = store.checkpoint(campaign);
			storage.release();

			expect(second).toBe(first);
			await busy;
			expect(await first).toBe(true);
			expect((await storeOver(storage).load())?.day).toBe(2);
		});

		it('make a new write once the one before has started', async () => {
			const storage = new HeldStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			storage.hold();

			const first = store.checkpoint(campaign);
			await settle();
			expect(storage.waiting).toBe(1);
			campaign.set({ day: 2 });
			const second = store.checkpoint(campaign);
			storage.release();

			expect(second).not.toBe(first);
			expect(await Promise.all([first, second])).toEqual([true, true]);
			expect((await storeOver(storage).load())?.day).toBe(2);
		});

		it('never join one for a different campaign', async () => {
			const store = storeOver(new MemorySaveStorage());

			const first = store.checkpoint(newCampaign(1));
			const second = store.checkpoint(newCampaign(2));

			expect(second).not.toBe(first);
			expect(await Promise.all([first, second])).toEqual([true, true]);
			expect((await store.load())?.seed).toBe(2);
		});

		it.each(['delete', 'end', 'save'] as const)('don\'t join one asked for before a %s came between', async (between) => {
			const store = storeOver(new MemorySaveStorage());
			const campaign = newCampaign(1);
			await store.save(campaign);

			campaign.set({ day: 2 });
			const first = store.checkpoint(campaign);
			const middle = between === 'delete'
				? store.delete()
				: between === 'end' ? store.end({ campaign, ending: 'won' }) : store.save(newCampaign(2));
			const second = store.checkpoint(campaign);
			await middle;

			expect(second).not.toBe(first);
			expect([await first, await second]).toEqual([true, false]);
			expect(await store.hasSave()).toBe(between === 'save');
		});

		it('never reject: a failed one resolves false and tells onSaveFailed listeners why, or logs it', async () => {
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

		it('still resolve, and still reach every listener, when one listener throws', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const later = jest.fn();
			const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
			store.onSaveFailed(() => { throw new Error('listener bug'); });
			store.onSaveFailed(later);
			storage.fault = { method: 'setItem', error: quotaError() };

			try {
				expect(await store.checkpoint(newCampaign())).toBe(false);

				expect(later).toHaveBeenCalledTimes(1);
				expect(errors).toHaveBeenCalled();
				storage.fault = null;
				await store.save(newCampaign(3));
				expect(await store.hasSave()).toBe(true);
			} finally {
				errors.mockRestore();
			}
		});

		it('of a campaign that has ended resolve false without telling anyone, as a game over expects', async () => {
			const store = storeOver(new MemorySaveStorage());
			const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
			const campaign = newCampaign();
			await store.save(campaign);
			void store.end({ campaign, ending: 'starved' });

			try {
				expect(await store.checkpoint(campaign)).toBe(false);

				expect(warn).not.toHaveBeenCalled();
			} finally {
				warn.mockRestore();
			}
			const failures = jest.fn();
			store.onSaveFailed(failures);
			expect(await store.checkpoint(campaign)).toBe(false);
			expect(failures).not.toHaveBeenCalled();
			expect((await failure(store.save(campaign))).reason).toBe('retired');
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
			expect(storage.keys).toEqual([KEYS.history]);
			expect(JSON.parse(await storage.getItem(KEYS.history) ?? '')).toEqual({ schemaVersion: HISTORY_SCHEMA_VERSION, campaigns: [entry] });
		});

		it('lists past campaigns newest first', async () => {
			const store = storeOver(new MemorySaveStorage());

			await store.end({ campaign: newCampaign(1), ending: 'rioted' });
			await store.end({ campaign: newCampaign(2), ending: 'won' });

			expect((await store.history()).map(entry => [entry.seed, entry.ending])).toEqual([[2, 'won'], [1, 'rioted']]);
		});

		it.each([
			['the same way, records it once', 'disbanded', ['disbanded']],
			['another way, records it again: entries carry no campaign identity', 'abandoned', ['abandoned', 'disbanded']]
		] as const)('after a crash between its two writes, ending it again %s', async (_label, again, endings) => {
			const storage = new FaultyStorage();
			const crashed = storeOver(storage);
			const campaign = newCampaign();
			await crashed.save(campaign);
			storage.fault = { method: 'removeItem', key: KEYS.slots.a };

			expect((await failure(crashed.end({ campaign, ending: 'disbanded' }))).reason).toBe('storage');
			storage.fault = null;
			const store = storeOver(storage);
			const loaded = await store.load() as Campaign;
			await store.end({ campaign: loaded, ending: again });

			expect((await store.history()).map(entry => entry.ending)).toEqual(endings);
			expect(await store.hasSave()).toBe(false);
		});

		it('won\'t save it again, so it can\'t come back to Continue', async () => {
			const store = storeOver(new MemorySaveStorage());
			const campaign = newCampaign();
			await store.save(campaign);
			await store.end({ campaign, ending: 'abandoned' });

			const error = await failure(store.save(campaign));

			expect([error.reason, error.message]).toEqual(['retired', "The campaign couldn't be saved: it has ended."]);
			expect(await store.hasSave()).toBe(false);
		});

		it('leaves the save alone when it belongs to another campaign', async () => {
			const store = storeOver(new MemorySaveStorage());
			const saved = newCampaign(1);
			await store.save(saved);
			const other = newCampaign(2);

			await store.end({ campaign: other, ending: 'disbanded' });

			expect((await store.load())?.seed).toBe(1);
			expect((await failure(store.save(other))).reason).toBe('retired');
		});

		it('sets a damaged history aside and starts a new one', async () => {
			const onWarning = jest.fn();
			const storage = storageWith(fixtureText(), { [KEYS.history]: '{"schemaVersion":1,"campaigns":[{"seed":-4' });
			const store = storeOver(storage, onWarning);

			await store.end({ campaign: newCampaign(), ending: 'won' });

			expect(await store.history()).toHaveLength(1);
			expect(await storage.getItem(KEYS.historyRecovery)).toBe('{"schemaVersion":1,"campaigns":[{"seed":-4');
			expect(onWarning).toHaveBeenCalledWith(expect.stringMatching(/^CampaignStore: set a damaged history aside and started a new one: /));
		});

		it('leaves a newer build\'s history as it is, without the campaign', async () => {
			const onWarning = jest.fn();
			const newer = JSON.stringify({ schemaVersion: HISTORY_SCHEMA_VERSION + 1, campaigns: [], unlocks: ['radio-mast'] });
			const storage = storageWith(fixtureText(), { [KEYS.history]: newer });
			const store = storeOver(storage, onWarning);
			const campaign = await store.load() as Campaign;

			await store.end({ campaign, ending: 'starved' });

			expect(await storage.getItem(KEYS.history)).toBe(newer);
			expect(await store.hasSave()).toBe(false);
			expect(onWarning).toHaveBeenCalledWith('CampaignStore: left the history as a newer build wrote it, without this campaign: CampaignHistory.schemaVersion is 2, newer than this build reads (1)');
		});

		it('ends the campaign even when the warning callback throws', async () => {
			const damaged = '{"schemaVersion":1,"campaigns":[';
			const storage = storageWith(fixtureText(), { [KEYS.history]: damaged });
			const store = new CampaignStore({ storage, onWarning: () => { throw new Error('toast bug'); } });
			const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

			try {
				const campaign = await store.load() as Campaign;
				await store.end({ campaign, ending: 'won' });

				expect(await store.history()).toHaveLength(1);
				expect(await storage.getItem(KEYS.historyRecovery)).toBe(damaged);
				expect(await store.hasSave()).toBe(false);
				expect(errors).toHaveBeenCalledWith('CampaignStore: a warning callback threw', expect.any(Error));
			} finally {
				errors.mockRestore();
			}
		});

		it('refuses an ending that doesn\'t exist at once, before the calls ahead of it finish', async () => {
			const storage = new HeldStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			storage.hold();
			const saving = store.save(campaign);

			const error = await failure(store.end({ campaign, ending: 'exploded' as CampaignEnding }));

			expect([error.reason, error.message, error.detail]).toEqual([
				'unsavable',
				'The campaign couldn\'t be ended: "exploded" isn\'t a way a campaign ends.',
				'ending must be one of starved, rioted, disbanded, won, abandoned, got "exploded"'
			]);
			storage.release();
			await saving;
			expect(await store.history()).toEqual([]);
			expect(await store.hasSave()).toBe(true);
		});
	});

	describe('the history', () => {
		it.each([
			['isn\'t JSON', '{"schemaVersion":1,'],
			['has a seed JSON reads as Infinity', '{"schemaVersion":1,"campaigns":[{"seed":1e999,"day":3,"strongholdsTaken":0,"ending":"won"}]}'],
			['has an ending that doesn\'t exist', JSON.stringify(historyToJson([{ seed: 1, day: 3, strongholdsTaken: 0, ending: 'exploded' as CampaignHistoryEntry['ending'] }]))]
		])('fails as damaged when it %s, and keeps it', async (_label, text) => {
			const storage = storageWith(fixtureText(), { [KEYS.history]: text });

			const error = await failure(storeOver(storage).history());

			expect([error.reason, error.message]).toEqual(['damaged', "Campaign history is damaged and can't be shown. It's been kept."]);
			expect(await storage.getItem(KEYS.historyRecovery)).toBe(text);
		});

		it('fails as newer on a newer build\'s history', async () => {
			const storage = storageWith(fixtureText(), { [KEYS.history]: JSON.stringify({ schemaVersion: 3, campaigns: [] }) });

			const error = await failure(storeOver(storage).history());

			expect([error.reason, error.message]).toEqual([
				'newer',
				"Campaign history is from a newer version of the game (version 3; this one reads up to 1), so it can't be shown here. It's been kept."
			]);
			expect(await storage.getItem(KEYS.historyRecovery)).toBeNull();
		});
	});

	describe('delete', () => {
		it('removes the save from both slots, leaving the history', async () => {
			const storage = new MemorySaveStorage();
			const store = storeOver(storage);
			await store.end({ campaign: newCampaign(1), ending: 'won' });
			const campaign = newCampaign(2);
			await store.save(campaign);
			campaign.set({ day: 2 });
			await store.save(campaign);

			await store.delete();

			expect(await store.hasSave()).toBe(false);
			expect(storage.keys).toEqual([KEYS.history]);
		});

		it('removes the slot before the save\'s, and `active` last, so a crash part way never leaves the save before', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			campaign.set({ day: 2 });
			await store.save(campaign);
			storage.writes.length = 0;

			await store.delete();

			expect(storage.writes).toEqual([`remove ${KEYS.slots.a}`, `remove ${KEYS.slots.b}`, `remove ${KEYS.active}`]);
		});

		it('does nothing without a save', async () => {
			const storage = new FaultyStorage();

			await storeOver(storage).delete();

			expect(storage.writes).toEqual([]);
		});
	});

	it('keeps a long campaign inside its storage budget, and loads it back as it was', async () => {
		const storage = new MemorySaveStorage();
		const campaign = stressCampaign();

		await storeOver(storage).save(campaign);
		const text = await storage.getItem(KEYS.slots.a) ?? '';
		const loaded = await storeOver(storage).load();

		// A generated map that pushes a save past the budget is the cue to move saves to IndexedDB.
		expect(text.length).toBeLessThan(SAVE_BUDGET);
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
