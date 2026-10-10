import { describe, expect, it } from '@jest/globals';
import { CampaignStore, CampaignStoreError, campaignKeys, pageNamespace } from '../../../src/renderer/game/campaign/CampaignStore';
import { MemorySaveStorage } from '../../../src/renderer/game/campaign/SaveStorage';
import { AT_HOME, CAMPAIGN_KEY_PREFIX, DAMAGED, ENDED, FULL_LOCKER, HARNESS_PAGE, IN_PROGRESS, LOST, ON_THE_ROAD, OUTDATED } from './campaignSaves';

/** The harness's dev server's store, over the items a scenario writes. */
function storeOver(items: Record<string, string>): CampaignStore {
	return new CampaignStore({ storage: new MemorySaveStorage({ items }), namespace: pageNamespace(HARNESS_PAGE), onWarning: () => undefined });
}

describe('the screen scenarios\' campaign saves', () => {
	it("sit under the keys the harness clears before every capture", () => {
		const keys = campaignKeys(pageNamespace(HARNESS_PAGE));
		const every = [keys.active, keys.slots.a, keys.slots.b, keys.recovery, keys.history, keys.historyRecovery];
		expect(every.every((key) => key.startsWith(CAMPAIGN_KEY_PREFIX))).toBe(true);
		for (const items of [IN_PROGRESS, ON_THE_ROAD, AT_HOME, FULL_LOCKER, LOST, OUTDATED, DAMAGED, ENDED]) {
			expect(Object.keys(items).every((key) => every.includes(key))).toBe(true);
		}
	});

	it('hold a campaign in progress that loads', async () => {
		const store = storeOver(IN_PROGRESS);
		expect(await store.saveStatus()).toBe('saved');
		expect((await store.load())?.day).toBe(9);
	});

	it('hold a run on the road, at a reward and driving to a fight, that load', async () => {
		expect((await storeOver(IN_PROGRESS).load())?.supplyRun?.phase).toBe('reward');
		const driving = await storeOver(ON_THE_ROAD).load();
		expect([driving?.supplyRun?.stop, driving?.supplyRun?.phase]).toEqual([2, 'driving']);
	});

	it('hold the run brought home, and a full deck beside a full locker, that load', async () => {
		const home = await storeOver(AT_HOME).load();
		expect(home?.runDecks).toEqual([]);
		const full = await storeOver(FULL_LOCKER).load();
		expect(full?.drivers[0].deckSize).toBe(20);
		expect(Object.keys(full?.locker ?? {}).length).toBeGreaterThan(20);
	});

	it('hold a campaign already lost, that loads over', async () => {
		const lost = await storeOver(LOST).load();
		expect([lost?.isOver, lost?.end]).toEqual([true, { ending: 'rioted', cause: 'last_driver' }]);
	});

	it('hold an outdated save and a damaged one', async () => {
		expect(await storeOver(OUTDATED).saveStatus()).toBe('outdated');
		const damaged = await storeOver(DAMAGED).load().catch((error: unknown) => error);
		expect(damaged).toBeInstanceOf(CampaignStoreError);
		expect((damaged as CampaignStoreError).reason).toBe('damaged');
	});

	it('hold a history with every ending', async () => {
		const entries = await storeOver(ENDED).history();
		expect(entries.map((entry) => entry.ending)).toEqual(['abandoned', 'won', 'rioted', 'starved', 'disbanded']);
	});
});
