import { describe, expect, it } from '@jest/globals';
import { CampaignStore, CampaignStoreError, campaignKeys, pageNamespace } from '../../../src/renderer/game/campaign/CampaignStore';
import { MemorySaveStorage } from '../../../src/renderer/game/campaign/SaveStorage';
import { CAMPAIGN_KEY_PREFIX, DAMAGED, ENDED, HARNESS_PAGE, IN_PROGRESS, OUTDATED } from './campaignSaves';

/** The harness's dev server's store, over the items a scenario writes. */
function storeOver(items: Record<string, string>): CampaignStore {
	return new CampaignStore({ storage: new MemorySaveStorage({ items }), namespace: pageNamespace(HARNESS_PAGE), onWarning: () => undefined });
}

describe('the screen scenarios\' campaign saves', () => {
	it("sit under the keys the harness clears before every capture", () => {
		const keys = campaignKeys(pageNamespace(HARNESS_PAGE));
		const every = [keys.active, keys.slots.a, keys.slots.b, keys.recovery, keys.history, keys.historyRecovery];
		expect(every.every((key) => key.startsWith(CAMPAIGN_KEY_PREFIX))).toBe(true);
		for (const items of [IN_PROGRESS, OUTDATED, DAMAGED, ENDED]) {
			expect(Object.keys(items).every((key) => every.includes(key))).toBe(true);
		}
	});

	it('hold a campaign in progress that loads', async () => {
		const store = storeOver(IN_PROGRESS);
		expect(await store.saveStatus()).toBe('saved');
		expect((await store.load())?.day).toBe(9);
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
