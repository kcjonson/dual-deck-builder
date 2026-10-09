import type { Campaign } from './Campaign';
import type { CampaignFight } from './CombatBridge';

/**
 * Which campaigns have a fight out, kept apart from the combat bridge so
 * the campaign can ask without importing the bridge, which imports it.
 * Only the bridge (`startCampaignFight`, `writeBackFight`) changes them.
 */

/**
 * Each campaign's fight from its start until it's written back. One at a
 * time, so a fight can't start beside one that hasn't been written back,
 * and none is written back twice.
 */
const openFights = new WeakMap<Campaign, CampaignFight>();

/**
 * Campaigns partway through storing a write-back. The fight stops being
 * open before anything is stored, so this is what keeps a listener from
 * starting the next fight on records and a convoy that are half written.
 */
const storingWriteBacks = new WeakSet<Campaign>();

/**
 * Whether the campaign has a fight started and not yet written back, or
 * being written back. Nobody comes home while one is open, and no run ends
 * (`injureOnArrival`, `Campaign.unloadRun`, `Campaign.loseRun`,
 * `Campaign.unwindRunDecks`), since the write-back has to fit the records
 * and run decks as the fight left them, and a listener partway through it
 * sees them half stored.
 */
export function hasOpenFight(campaign: Campaign): boolean {
	return openFights.has(campaign) || storingWriteBacks.has(campaign);
}

/** The campaign's fight started and not yet written back, or null. */
export function openFightOf(campaign: Campaign): CampaignFight | null {
	return openFights.get(campaign) ?? null;
}

/** Opens the campaign's fight, or closes it with null. */
export function setOpenFight({ campaign, fight }: { campaign: Campaign; fight: CampaignFight | null }): void {
	if (fight === null) openFights.delete(campaign);
	else openFights.set(campaign, fight);
}

/** Whether the campaign is partway through storing a write-back. */
export function isStoringWriteBack(campaign: Campaign): boolean {
	return storingWriteBacks.has(campaign);
}

export function setStoringWriteBack({ campaign, storing }: { campaign: Campaign; storing: boolean }): void {
	if (storing) storingWriteBacks.add(campaign);
	else storingWriteBacks.delete(campaign);
}
