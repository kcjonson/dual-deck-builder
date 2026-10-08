import { CAMPAIGN_SCHEMA_VERSION, Campaign } from './Campaign';
import { CampaignEnding, CampaignHistoryEntry, historyToJson } from './CampaignHistory';
import { CampaignStore, CampaignStoreError, campaignKeys, pageNamespace } from './CampaignStore';
import { cardCount } from './CardCounts';
import { LocalSaveStorage, MemorySaveStorage, WebStorage } from './SaveStorage';
import campaignV1 from './__fixtures__/campaign-v1.json';
import { stressCampaign } from './__fixtures__/stressCampaign';
import {
	FaultyStorage, HeldStorage, KEYS, SEED, everyInterleaving, failure, fixtureText, damagedText, newCampaign, outdatedText, quotaError,
	saveText, securityError, settle, storageWith, storeOver
} from './__fixtures__/storeFixtures';

/**
 * The most a save may hold. Local storage keeps about 5 MiB an origin; the
 * store can hold three copies of a save (two slots and a recovery copy),
 * which at two bytes a character fit in 873,813 characters, and the origin
 * keeps the settings and the history besides.
 */
const SAVE_BUDGET = 800000;

const stampedHistory = (entries: CampaignHistoryEntry[], version = CAMPAIGN_SCHEMA_VERSION): string => JSON.stringify(historyToJson({ version, entries }));

afterEach(() => jest.restoreAllMocks());

describe('CampaignStore', () => {
	describe('the save', () => {
		it('has nothing to continue until a campaign is saved', async () => {
			const store = storeOver(new MemorySaveStorage());

			expect(await store.saveStatus()).toBe('none');
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

			expect(await store.saveStatus()).toBe('saved');
			expect(loaded).not.toBe(campaign);
			expect(loaded?.toJSON()).toEqual(campaign.toJSON());
		});

		it('continues the version 1 fixture', async () => {
			const loaded = await storeOver(storageWith(fixtureText())).load();

			expect(loaded?.toJSON()).toEqual(campaignV1);
		});

		it('takes turns between two slots, switching `active` only once the new save is in', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();

			await store.save(campaign);
			campaign.set({ day: 2 });
			await store.save(campaign);

			expect(storage.writes).toEqual([KEYS.slots.a, KEYS.active, KEYS.slots.b, KEYS.active]);
			expect(await storage.getItem(KEYS.active)).toBe('b');
			expect(JSON.parse(await storage.getItem(KEYS.slots.a) ?? '').campaign.day).toBe(1);
			expect(JSON.parse(await storage.getItem(KEYS.slots.b) ?? '').campaign.day).toBe(2);
		});

		it('keeps the save before when `active` never switches to the new one, as after a crash', async () => {
			const storage = new FaultyStorage();
			const campaign = newCampaign();
			await storeOver(storage).save(campaign);
			campaign.set({ day: 2 });
			storage.fault = { method: 'setItem', key: KEYS.active };

			const error = await failure(storeOver(storage).save(campaign));
			storage.fault = null;

			expect([error.reason, error.message]).toEqual(['storage', "The campaign couldn't be saved: storage failed."]);
			expect((await storeOver(storage).load())?.day).toBe(1);
		});

		it.each([
			['full', quotaError(), "The campaign couldn't be saved: storage is full.", 'The quota has been exceeded.'],
			['blocked', securityError(), "The campaign couldn't be saved: storage is blocked.", 'The operation is insecure.']
		])('says when storage is %s, and keeps the save before', async (_label, error, message, detail) => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			campaign.set({ day: 2 });
			storage.fault = { method: 'setItem', error };

			const refused = await failure(store.save(campaign));
			storage.fault = null;

			expect([refused.reason, refused.message, refused.detail]).toEqual(['storage', message, detail]);
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
			const text = fixtureText(campaign => { delete (campaign.mapParams as Record<string, unknown>).radius; });
			const storeWarning = jest.fn();
			const loadWarning = jest.fn();
			const store = storeOver(storageWith(text), { onWarning: storeWarning });

			await store.load();
			await store.load({ onWarning: loadWarning });

			const warning = 'Campaign.mapParams.radius was missing; took 1000, the mixed default';
			expect([storeWarning.mock.calls, loadWarning.mock.calls]).toEqual([[[warning]], [[warning]]]);
		});

		it.each([
			['throws', (): void => { throw new Error('toast bug'); }, 'CampaignStore: a warning callback threw'],
			['rejects', async (): Promise<void> => { throw new Error('toast bug'); }, 'CampaignStore: a warning callback rejected']
		])('loads a save whose warning callback %s, logging it instead of calling the save damaged', async (_label, onWarning, logged) => {
			const repaired = fixtureText(campaign => { delete (campaign.mapParams as Record<string, unknown>).radius; });
			const storage = storageWith(repaired, { [KEYS.recovery]: 'an earlier copy' });
			const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

			const loaded = await storeOver(storage).load({ onWarning });
			await settle();

			expect(loaded?.mapParams.radius).toBe(1000);
			expect(await storage.getItem(KEYS.recovery)).toBe('an earlier copy');
			expect(errors).toHaveBeenCalledWith(logged, expect.any(Error));
		});

		it.each([
			['loaded', async (store: CampaignStore): Promise<Campaign> => await store.load() as Campaign],
			['founded over a save it never loaded', async (store: CampaignStore): Promise<Campaign> => {
				const founded = newCampaign(7);
				await store.save(founded);
				return founded;
			}],
			['founded over a damaged save it refused', async (store: CampaignStore): Promise<Campaign> => {
				await failure(store.load());
				const founded = newCampaign(7);
				await store.save(founded);
				return founded;
			}]
		])('parses nothing on a checkpoint after a campaign is %s, since the menu already did', async (label, start) => {
			const storage = new MemorySaveStorage();
			const before = storeOver(storage);
			const earlier = newCampaign();
			await before.save(earlier);
			earlier.set({ day: 2 });
			await before.save(earlier);
			if (label.includes('damaged')) await storage.setItem(KEYS.slots.b, damagedText());
			const store = storeOver(storage);
			const campaign = await start(store);
			const parse = jest.spyOn(Campaign, 'fromJSON');

			campaign.set({ day: 3 });
			expect(await store.checkpoint(campaign)).toBe(true);
			campaign.set({ day: 4 });
			expect(await store.checkpoint(campaign)).toBe(true);

			expect(parse).not.toHaveBeenCalled();
			parse.mockRestore();
			expect((await storeOver(storage).load())?.day).toBe(4);
		});
	});

	describe('saves per build and version', () => {
		it('stamps each save and the history with the save format version, and each save with its place in the run of writes', async () => {
			const storage = new MemorySaveStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			campaign.set({ day: 2 });
			await store.save(campaign);
			await store.end({ campaign: newCampaign(2), ending: 'won' });

			const stamps = await Promise.all([KEYS.slots.a, KEYS.slots.b, KEYS.history].map(async key => JSON.parse(await storage.getItem(key) ?? '')));
			expect(stamps.map(stamp => [stamp.version, stamp.sequence])).toEqual([
				[CAMPAIGN_SCHEMA_VERSION, 1],
				[CAMPAIGN_SCHEMA_VERSION, 2],
				[CAMPAIGN_SCHEMA_VERSION, undefined]
			]);
		});

		it('keeps each build\'s saves apart, though they share one origin\'s storage', async () => {
			const storage = new MemorySaveStorage();
			const main = new CampaignStore({ storage, namespace: '/playtest/dual-deckbuilder/', onWarning: () => undefined });
			const branch = new CampaignStore({ storage, namespace: '/playtest/dual-deckbuilder/feat/x/', onWarning: () => undefined });

			await main.save(newCampaign(1));
			await branch.save(newCampaign(2));

			expect([(await main.load())?.seed, (await branch.load())?.seed]).toEqual([1, 2]);
			expect(storage.keys).toContain(campaignKeys('/playtest/dual-deckbuilder/feat/x/').slots.a);
		});

		it('doesn\'t load a save from another version of the save format, older or newer, and leaves it be', async () => {
			for (const version of [CAMPAIGN_SCHEMA_VERSION - 1, CAMPAIGN_SCHEMA_VERSION + 1]) {
				const text = saveText({ campaign: JSON.stringify(campaignV1), version });
				const storage = storageWith(text);
				const store = storeOver(storage);

				expect(await store.saveStatus()).toBe('outdated');
				expect(await store.hasSave()).toBe(false);
				expect(await store.load()).toBeNull();
				expect(storage.writes).toEqual([]);
			}
		});

		it('reads today\'s saves as outdated in a build with the next version', async () => {
			const storage = new MemorySaveStorage();
			await storeOver(storage).save(newCampaign());

			const next = storeOver(storage, { version: CAMPAIGN_SCHEMA_VERSION + 1 });

			expect(await next.saveStatus()).toBe('outdated');
			const campaign = newCampaign(5);
			await next.save(campaign);
			expect((await next.load())?.seed).toBe(5);
		});

		it.each([
			['a new campaign', (store: CampaignStore): Promise<unknown> => store.save(newCampaign(7))],
			['a delete', (store: CampaignStore): Promise<unknown> => store.delete()]
		])('lets %s replace an outdated save without keeping a copy', async (_label, replace) => {
			const storage = storageWith(outdatedText());
			const store = storeOver(storage);

			await replace(store);

			expect(await storage.getItem(KEYS.recovery)).toBeNull();
			expect(await store.saveStatus()).toBe(storage.keys.includes(KEYS.active) ? 'saved' : 'none');
		});

		it('starts the history over when another version saved it', async () => {
			const onWarning = jest.fn();
			const older = stampedHistory([{ seed: 1, day: 3, strongholdsTaken: 0, ending: 'won' }], CAMPAIGN_SCHEMA_VERSION + 1);
			const storage = storageWith(fixtureText(), { [KEYS.history]: older });
			const store = storeOver(storage, { onWarning });

			expect(await store.history()).toEqual([]);
			await store.end({ campaign: newCampaign(2), ending: 'rioted' });

			expect((await store.history()).map(entry => entry.seed)).toEqual([2]);
			expect(await storage.getItem(KEYS.historyRecovery)).toBeNull();
			expect(onWarning).toHaveBeenCalledWith('CampaignStore: started a new history over one another version of the game saved');
		});
	});

	describe('finding the save', () => {
		it('takes the slot `active` names, whatever is in it', async () => {
			const storage = new MemorySaveStorage({ items: { [KEYS.slots.a]: fixtureText(), [KEYS.slots.b]: damagedText(), [KEYS.active]: 'b' } });

			expect((await failure(storeOver(storage).load())).reason).toBe('damaged');
		});

		it.each([
			['no `active`', {}],
			['an empty `active`', { [KEYS.active]: '' }],
			['an `active` naming an empty slot', { [KEYS.active]: 'b' }],
			['an `active` that names no slot at all', { [KEYS.active]: 'c' }]
		])('with %s, takes the slot that loads', async (_label, extra) => {
			const storage = new MemorySaveStorage({ items: { [KEYS.slots.a]: fixtureText(), ...extra } });
			const store = storeOver(storage);

			expect(await store.saveStatus()).toBe('saved');
			expect((await store.load())?.day).toBe(9);
		});

		it('prefers the slot that loads when nothing names one', async () => {
			const store = storeOver(new MemorySaveStorage({ items: { [KEYS.slots.a]: damagedText(), [KEYS.slots.b]: fixtureText() } }));

			expect((await store.load())?.day).toBe(9);
		});

		it.each([
			['a', 'b'],
			['b', 'a']
		] as const)('takes the newest of two saves that load when nothing names either, here in slot %s', async (newest, older) => {
			const write = (day: number, sequence: number): string => saveText({ campaign: JSON.stringify({ ...campaignV1, day }), sequence });
			const store = storeOver(new MemorySaveStorage({ items: { [KEYS.slots[newest]]: write(9, 6), [KEYS.slots[older]]: write(8, 5) } }));

			expect((await store.load())?.day).toBe(9);
		});

		it('finds no save in a slot that doesn\'t load when nothing names it, and keeps it before writing over it', async () => {
			const damaged = damagedText();
			const storage = new MemorySaveStorage({ items: { [KEYS.slots.a]: damaged, [KEYS.active]: 'b' } });
			const store = storeOver(storage);

			expect(await store.saveStatus()).toBe('none');
			expect(await store.load()).toBeNull();
			expect(await storage.getItem(KEYS.recovery)).toBeNull();

			await store.save(newCampaign());

			expect(await storage.getItem(KEYS.recovery)).toBe(damaged);
		});

		it('never keeps the slot `active` doesn\'t name, which holds only the save before', async () => {
			const storage = new MemorySaveStorage({ items: { [KEYS.slots.a]: fixtureText(), [KEYS.slots.b]: damagedText(), [KEYS.active]: 'a' } });
			const store = storeOver(storage);
			const campaign = await store.load() as Campaign;

			campaign.set({ day: 10 });
			await store.save(campaign);

			expect(await storage.getItem(KEYS.recovery)).toBeNull();
			expect((await storeOver(storage).load())?.day).toBe(10);
		});

		it.each([
			['a delete', 'delete'],
			['an end', 'end']
		] as const)('agrees with itself after %s in one tab races a checkpoint in another, in every order', async (_label, finish) => {
			const outcomes = new Set<string>();
			const orders = await everyInterleaving(async (tabs) => {
				await storeOver(tabs.shared).save(newCampaign(1));
				const tabA = storeOver(tabs.tab('A'));
				const loading = tabA.load();
				await tabs.drain();
				const original = await loading as Campaign;
				const tabB = storeOver(tabs.tab('B'));
				const finished = finish === 'delete' ? tabA.delete() : tabA.end({ campaign: original, ending: 'abandoned' });
				const saved = tabB.checkpoint(newCampaign(2));

				await tabs.drain();
				await finished;

				expect(await saved).toBe(true);
				const fresh = storeOver(tabs.shared);
				const loaded = await fresh.load();
				expect(await fresh.hasSave()).toBe(loaded !== null);
				// Nothing, or the other tab's campaign; never the one tab A finished.
				expect([null, 2]).toContain(loaded?.seed ?? null);
				outcomes.add(loaded === null ? 'nothing' : 'the other tab\'s campaign');
			});

			expect(orders).toBeGreaterThan(100);
			expect([...outcomes].sort()).toEqual(['nothing', 'the other tab\'s campaign']);
		}, 120000);
	});

	describe('a damaged save', () => {
		it.each([
			['text that isn\'t JSON', fixtureText().slice(0, 200), /JSON/],
			['a driver in a state that doesn\'t exist', damagedText(), 'Campaign.drivers[1].status must be one of ready, injured, dead, missing, got "sleeping"'],
			['a seed JSON reads as Infinity', fixtureText().replace('"seed":20261006', '"seed":1e999'), 'Campaign.seed must be an integer from 0 to 4294967295, got Infinity'],
			['a seed past uint32', fixtureText(campaign => { campaign.seed = 2 ** 32; }), 'Campaign.seed must be an integer from 0 to 4294967295, got 4294967296'],
			['no seed at all', fixtureText(campaign => { campaign.seed = null; }), 'Campaign.seed must be a number, got null'],
			['something besides the version and the campaign', saveText({ campaign: '{}' }).replace('{"version"', '{"extra":1,"version"'), 'Save has an unknown field "extra"']
		])('fails to load on %s, says so, and keeps it', async (_label, text, detail) => {
			const storage = storageWith(text);

			const error = await failure(storeOver(storage).load());

			expect([error.reason, error.message]).toEqual(['damaged', "The saved campaign is damaged and can't be loaded. It's been kept."]);
			expect(error.detail).toMatch(detail);
			expect(await storage.getItem(KEYS.slots.a)).toBe(text);
			expect(await storage.getItem(KEYS.recovery)).toBe(text);
		});

		it('takes a bug in the code reading a save for a bug, not damage', async () => {
			const storage = storageWith(fixtureText());
			jest.spyOn(Campaign, 'fromJSON').mockImplementation(() => { throw new TypeError("Cannot read properties of undefined (reading 'day')"); });

			await expect(storeOver(storage).load()).rejects.toThrow("Cannot read properties of undefined (reading 'day')");
			expect(await storage.getItem(KEYS.recovery)).toBeNull();
		});

		it.each([
			['loaded first', true],
			['never loaded', false]
		])('is kept before a new campaign moves `active` off it, %s', async (_label, loadFirst) => {
			const damaged = damagedText();
			const storage = storageWith(damaged);
			const store = storeOver(storage);
			if (loadFirst) await failure(store.load());
			const founded = newCampaign(7);

			await store.save(founded);
			founded.set({ day: 2 });
			await store.save(founded);

			expect(await storage.getItem(KEYS.recovery)).toBe(damaged);
			expect((await storeOver(storage).load())?.day).toBe(2);
		});

		it.each([
			['`active` names', { [KEYS.active]: 'a' }],
			['nothing names', {}]
		])('is kept before delete removes it from a slot %s', async (_label, extra) => {
			const damaged = damagedText();
			const storage = new FaultyStorage({ items: { [KEYS.slots.a]: damaged, [KEYS.slots.b]: fixtureText(), ...extra } });

			await storeOver(storage).delete();

			expect(await storage.getItem(KEYS.recovery)).toBe(damaged);
			expect(storage.keys).toEqual([KEYS.recovery]);
		});

		it('is the one kept when both slots are damaged, since the other held only the save before it', async () => {
			const latest = damagedText().replace('"day":9', '"day":12');
			const before = damagedText().replace('"day":9', '"day":11');
			const storage = new MemorySaveStorage({ items: { [KEYS.slots.a]: latest, [KEYS.slots.b]: before, [KEYS.active]: 'a' } });
			const store = storeOver(storage);

			await failure(store.load());
			await store.delete();

			expect(await storage.getItem(KEYS.recovery)).toBe(latest);
		});

		it('is never written over when storage won\'t take the copy', async () => {
			const damaged = damagedText();
			const storage = storageWith(damaged);
			storage.fault = { method: 'setItem', key: KEYS.recovery, error: quotaError() };
			const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
			const store = storeOver(storage);

			expect((await failure(store.load())).reason).toBe('damaged');
			expect(warn).toHaveBeenCalledWith('CampaignStore: could not set damaged text aside', expect.any(CampaignStoreError));
			expect((await failure(store.save(newCampaign()))).message).toBe("The campaign couldn't be saved: storage is full.");
			expect([await storage.getItem(KEYS.slots.a), await storage.getItem(KEYS.active)]).toEqual([damaged, 'a']);
		});

		it('goes when the player deletes it and storage is too full for the copy, since they asked', async () => {
			const storage = storageWith(damagedText());
			storage.fault = { method: 'setItem', key: KEYS.recovery, error: quotaError() };
			const onWarning = jest.fn();

			await storeOver(storage, { onWarning }).delete();

			expect(storage.keys).toEqual([]);
			expect(onWarning).toHaveBeenCalledWith('CampaignStore: storage was too full to keep a copy of the damaged save in slot a; deleted it anyway');
		});

		it('stays when the copy fails for any other reason, and so does the delete', async () => {
			const damaged = damagedText();
			const storage = storageWith(damaged);
			storage.fault = { method: 'setItem', key: KEYS.recovery };

			expect((await failure(storeOver(storage).delete())).reason).toBe('storage');
			expect(await storage.getItem(KEYS.slots.a)).toBe(damaged);
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
			expect(await store.checkpoint(inMenu)).toBe(false);
			expect((await store.load())?.seed).toBe(2);
			expect((await store.history()).map(entry => [entry.seed, entry.ending])).toEqual([[1, 'abandoned']]);
			const error = await failure(store.save(inMenu));
			expect([error.reason, error.message]).toEqual(['retired', "The campaign couldn't be saved: it has ended."]);
		});

		it('won\'t let a screen left running roll the save back after a plain Continue', async () => {
			const storage = new MemorySaveStorage();
			const store = storeOver(storage);
			const oldScreen = newCampaign();
			oldScreen.set({ day: 3 });
			await store.save(oldScreen);
			const continued = await store.load() as Campaign;
			continued.set({ day: 7 });
			expect(await store.checkpoint(continued)).toBe(true);

			oldScreen.set({ unrest: 2 });

			expect(await store.checkpoint(oldScreen)).toBe(false);
			expect((await failure(store.save(oldScreen))).message).toBe("The campaign couldn't be saved: the save was loaded again.");
			expect((await storeOver(storage).load())?.day).toBe(7);
		});

		it('won\'t let the deleted campaign save itself back', async () => {
			const store = storeOver(new MemorySaveStorage());
			await store.save(newCampaign());
			const campaign = await store.load() as Campaign;

			await store.delete();

			expect(await store.checkpoint(campaign)).toBe(false);
			expect(await store.hasSave()).toBe(false);
			expect((await failure(store.save(campaign))).message).toBe("The campaign couldn't be saved: its save was deleted.");
		});

		it('ends through the instance the last load handed out, refusing an older one and recording nothing for it', async () => {
			const store = storeOver(new MemorySaveStorage());
			const campaign = newCampaign();
			await store.save(campaign);
			const loaded = await store.load() as Campaign;

			expect((await failure(store.end({ campaign, ending: 'disbanded' }))).reason).toBe('retired');
			expect([await store.hasSave(), await store.history()]).toEqual([true, []]);
			await store.end({ campaign: loaded, ending: 'disbanded' });

			expect(await store.hasSave()).toBe(false);
			expect(await store.history()).toHaveLength(1);
		});

		it('retires the save\'s campaign on a delete even when the save has already gone', async () => {
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

		it.each([
			['a delete whose copy fails', (storage: FaultyStorage, store: CampaignStore): Promise<unknown> => {
				storage.fault = { method: 'setItem', key: KEYS.recovery };
				return store.delete();
			}],
			['a delete that can\'t read storage', (storage: FaultyStorage, store: CampaignStore): Promise<unknown> => {
				storage.fault = { method: 'getItem', key: KEYS.slots.b };
				return store.delete();
			}],
			['an end whose history write fails', (storage: FaultyStorage, store: CampaignStore, campaign: Campaign): Promise<unknown> => {
				storage.fault = { method: 'setItem', key: KEYS.history };
				return store.end({ campaign, ending: 'starved' });
			}],
			['an end whose copy fails', (storage: FaultyStorage, store: CampaignStore, campaign: Campaign): Promise<unknown> => {
				storage.fault = { method: 'setItem', key: KEYS.recovery };
				return store.end({ campaign, ending: 'starved' });
			}]
		])('leaves the campaign saving after %s, which removed nothing', async (_label, fail) => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			// No `active`, and a damaged save in the other slot that nothing vouches for, which a removal has to keep first.
			await storage.removeItem(KEYS.active);
			await storage.setItem(KEYS.slots.b, damagedText());

			expect((await failure(fail(storage, store, campaign))).reason).toBe('storage');
			storage.fault = null;
			campaign.set({ day: 3 });

			expect(await store.checkpoint(campaign)).toBe(true);
			expect((await storeOver(storage).load())?.day).toBe(3);
		});

		it('finishes removing an ended campaign\'s save when the same end is tried again', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			storage.fault = { method: 'removeItem', key: KEYS.slots.a, times: 1 };

			expect((await failure(store.end({ campaign, ending: 'starved' }))).reason).toBe('storage');
			const retried = await store.end({ campaign, ending: 'starved' });

			expect(retried.ending).toBe('starved');
			expect(await store.hasSave()).toBe(false);
			expect(await store.history()).toHaveLength(1);
		});

		it.each([
			['hasSave', (store: CampaignStore): Promise<unknown> => store.hasSave()],
			['load', (store: CampaignStore): Promise<unknown> => store.load()],
			['delete', (store: CampaignStore): Promise<unknown> => store.delete()]
		])('finishes removing an ended campaign\'s save before %s reads it, so Continue never offers it', async (_label, next) => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			storage.fault = { method: 'removeItem', key: KEYS.slots.a, times: 1 };
			await failure(store.end({ campaign, ending: 'starved' }));

			await next(store);

			expect(storage.keys).toEqual([KEYS.history]);
		});

		it('drops a removal it owes once a new campaign takes the save\'s place', async () => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const ended = newCampaign(1);
			await store.save(ended);
			storage.fault = { method: 'removeItem', key: KEYS.slots.a, times: 1 };
			await failure(store.end({ campaign: ended, ending: 'starved' }));

			await store.save(newCampaign(2));

			expect((await store.load())?.seed).toBe(2);
		});

		it('records nothing for a campaign that was already deleted or replaced', async () => {
			const store = storeOver(new MemorySaveStorage());
			const inScreen = newCampaign(1);
			await store.save(inScreen);
			const inMenu = await store.load() as Campaign;
			await store.end({ campaign: inMenu, ending: 'abandoned' });

			const error = await failure(store.end({ campaign: inScreen, ending: 'starved' }));

			expect([error.reason, error.message]).toEqual(['retired', "The campaign couldn't be saved: the save was loaded again."]);
			expect((await failure(store.end({ campaign: inMenu, ending: 'starved' }))).message).toBe("The campaign couldn't be saved: it has ended.");
			expect((await store.history()).map(entry => entry.ending)).toEqual(['abandoned']);
			const deleted = newCampaign(3);
			await store.save(deleted);
			await store.delete();
			expect((await failure(store.end({ campaign: deleted, ending: 'starved' }))).reason).toBe('retired');
			expect(await store.history()).toHaveLength(1);
		});

		it('records the campaign as it stood when end was called', async () => {
			const storage = new HeldStorage();
			const store = storeOver(storage);
			const campaign = newCampaign();
			await store.save(campaign);
			storage.hold();
			campaign.set({ day: 6 });

			const ended = store.end({ campaign, ending: 'won' });
			campaign.set({ day: 7 });
			storage.release();

			expect((await ended).day).toBe(6);
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
			expect((await storeOver(storage).load())?.toJSON()).toEqual(campaign.toJSON());
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
			expect(await store.checkpoint(newCampaign())).toBe(false);

			expect(heard.map(error => [error.reason, error.message])).toEqual([['storage', "The campaign couldn't be saved: storage is full."]]);
			expect(warn).toHaveBeenCalledWith("CampaignStore: The campaign couldn't be saved: storage is full.", 'The quota has been exceeded.');
		});

		it.each([
			['throws', (): void => { throw new Error('listener bug'); }],
			['rejects', async (): Promise<void> => { throw new Error('listener bug'); }]
		])('still resolve, and still reach every listener, when one listener %s', async (_label, faulty) => {
			const storage = new FaultyStorage();
			const store = storeOver(storage);
			const later = jest.fn();
			const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
			store.onSaveFailed(faulty);
			store.onSaveFailed(later);
			storage.fault = { method: 'setItem', error: quotaError() };

			expect(await store.checkpoint(newCampaign())).toBe(false);
			await settle();

			expect(later).toHaveBeenCalledTimes(1);
			expect(errors).toHaveBeenCalled();
			storage.fault = null;
			await store.save(newCampaign(3));
			expect(await store.hasSave()).toBe(true);
		});

		it('of a campaign that has ended resolve false without telling anyone, as a game over expects', async () => {
			const store = storeOver(new MemorySaveStorage());
			const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
			const campaign = newCampaign();
			await store.save(campaign);
			void store.end({ campaign, ending: 'starved' });

			expect(await store.checkpoint(campaign)).toBe(false);
			expect(warn).not.toHaveBeenCalled();
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
		] as const)('in a new session after a crash between its two writes, ending it again %s', async (_label, again, endings) => {
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
			await store.save(newCampaign(1));
			const other = newCampaign(2);

			await store.end({ campaign: other, ending: 'disbanded' });

			expect((await store.load())?.seed).toBe(1);
			expect((await failure(store.save(other))).reason).toBe('retired');
		});

		it('sets a damaged history aside and starts a new one', async () => {
			const onWarning = jest.fn();
			const damaged = '{"version":1,"campaigns":[{"seed":-4';
			const storage = storageWith(fixtureText(), { [KEYS.history]: damaged });
			const store = storeOver(storage, { onWarning });

			await store.end({ campaign: newCampaign(), ending: 'won' });

			expect(await store.history()).toHaveLength(1);
			expect(await storage.getItem(KEYS.historyRecovery)).toBe(damaged);
			expect(onWarning).toHaveBeenCalledWith(expect.stringMatching(/^CampaignStore: set a damaged history aside and started a new one: /));
		});

		it('ends the campaign even when the warning callback throws', async () => {
			const damaged = '{"version":1,"campaigns":[';
			const storage = storageWith(fixtureText(), { [KEYS.history]: damaged });
			const store = storeOver(storage, { onWarning: () => { throw new Error('toast bug'); } });
			const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
			const campaign = await store.load() as Campaign;

			await store.end({ campaign, ending: 'won' });

			expect(await store.history()).toHaveLength(1);
			expect(await storage.getItem(KEYS.historyRecovery)).toBe(damaged);
			expect(await store.hasSave()).toBe(false);
			expect(errors).toHaveBeenCalledWith('CampaignStore: a warning callback threw', expect.any(Error));
		});

		it('still delivers its warnings when a later step fails', async () => {
			const onWarning = jest.fn();
			const storage = storageWith(fixtureText(), { [KEYS.history]: '{"version":1,"campaigns":[' });
			const store = storeOver(storage, { onWarning });
			const campaign = await store.load() as Campaign;
			storage.fault = { method: 'removeItem', key: KEYS.slots.a };

			await failure(store.end({ campaign, ending: 'won' }));

			expect(onWarning).toHaveBeenCalledWith(expect.stringMatching(/^CampaignStore: set a damaged history aside/));
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
			['isn\'t JSON', '{"version":1,'],
			['has a seed JSON reads as Infinity', '{"version":1,"campaigns":[{"seed":1e999,"day":3,"strongholdsTaken":0,"ending":"won"}]}'],
			['has an ending that doesn\'t exist', stampedHistory([{ seed: 1, day: 3, strongholdsTaken: 0, ending: 'exploded' as CampaignHistoryEntry['ending'] }])]
		])('fails as damaged when it %s, and keeps it', async (_label, text) => {
			const storage = storageWith(fixtureText(), { [KEYS.history]: text });

			const error = await failure(storeOver(storage).history());

			expect([error.reason, error.message]).toEqual(['damaged', "Campaign history is damaged and can't be shown. It's been kept."]);
			expect(await storage.getItem(KEYS.historyRecovery)).toBe(text);
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

		it('removes the other slot first, the save\'s next, and `active` last, so a crash part way never leaves the save before', async () => {
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

		it('does nothing to storage without a save', async () => {
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

describe('pageNamespace', () => {
	it.each([
		['main\'s playtest build', { protocol: 'https:', hostname: 'bearcavinteractive.com', pathname: '/playtest/dual-deckbuilder/' }, '/playtest/dual-deckbuilder/'],
		['main, by its page', { protocol: 'https:', hostname: 'bearcavinteractive.com', pathname: '/playtest/dual-deckbuilder/index.html' }, '/playtest/dual-deckbuilder/'],
		['a branch\'s playtest build', { protocol: 'https:', hostname: 'bearcavinteractive.com', pathname: '/playtest/dual-deckbuilder/feat/DDB-49/' }, '/playtest/dual-deckbuilder/feat/DDB-49/'],
		['a path with doubled slashes', { protocol: 'https:', hostname: 'bearcavinteractive.com', pathname: '//playtest//dual-deckbuilder/' }, '/playtest/dual-deckbuilder/'],
		['the desktop build', { protocol: 'file:', hostname: '', pathname: '/C:/Program Files/Wasteland Wheels/renderer/index.html' }, 'desktop'],
		['a dev server', { protocol: 'http:', hostname: 'localhost', pathname: '/' }, 'dev'],
		['a dev server by address', { protocol: 'http:', hostname: '127.0.0.1', pathname: '/index.html' }, 'dev']
	])('gives %s a namespace of its own', (_label, location, namespace) => {
		expect(pageNamespace(location)).toBe(namespace);
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

	it('reads a browser that hands back no local storage as storage being blocked', async () => {
		const global = globalThis as { window?: unknown };
		global.window = { localStorage: null };
		try {
			const store = new CampaignStore({ storage: new LocalSaveStorage(), namespace: 'test' });

			const error = await failure(store.load());

			expect([error.reason, error.message]).toEqual(['storage', "The saved campaign couldn't be read: storage is blocked."]);
		} finally {
			delete global.window;
		}
	});

	it('is what the shared store saves through', async () => {
		await expect(CampaignStore.shared.hasSave()).rejects.toMatchObject({ reason: 'storage', detail: 'There is no local storage outside a browser window' });
	});
});
