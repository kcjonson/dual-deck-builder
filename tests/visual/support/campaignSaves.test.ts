import { describe, expect, it } from '@jest/globals';
import { CAMPAIGN_SCHEMA_VERSION } from '../../../src/renderer/game/campaign/Campaign';
import { CampaignStore, CampaignStoreError, campaignKeys, pageNamespace } from '../../../src/renderer/game/campaign/CampaignStore';
import { MemorySaveStorage } from '../../../src/renderer/game/campaign/SaveStorage';
import { CAMPAIGN_KEY_PREFIX, DAMAGED, ENDED, IN_PROGRESS, OUTDATED, SAVE_FORMAT_VERSION, SAVE_KEYS } from './campaignSaves';

/** The harness's dev server is served from 127.0.0.1 (`BASE_URL` in playwright.config.ts). */
const HARNESS_PAGE = { protocol: 'http:', hostname: '127.0.0.1', pathname: '/' };

/** The harness's dev server's store, over the items a scenario writes. */
function storeOver(items: Record<string, string>): CampaignStore {
	return new CampaignStore({ storage: new MemorySaveStorage({ items }), namespace: pageNamespace(HARNESS_PAGE), onWarning: () => undefined });
}

describe('the screen scenarios\' campaign saves', () => {
	it("use the keys and save format version the game's store does on the harness's dev server", () => {
		const keys = campaignKeys(pageNamespace(HARNESS_PAGE));
		expect(SAVE_KEYS).toEqual({ active: keys.active, slotA: keys.slots.a, history: keys.history });
		const every = [keys.active, keys.slots.a, keys.slots.b, keys.recovery, keys.history, keys.historyRecovery];
		expect(every.every((key) => key.startsWith(CAMPAIGN_KEY_PREFIX))).toBe(true);
		expect(SAVE_FORMAT_VERSION).toBe(CAMPAIGN_SCHEMA_VERSION);
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
