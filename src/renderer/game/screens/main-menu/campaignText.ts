import { isAtCompound } from '../../campaign/Campaign';
import type { Campaign } from '../../campaign/Campaign';
import type { CampaignEnding, CampaignHistoryEntry } from '../../campaign/CampaignHistory';

/** How each ending reads in Campaign History: how the compound fell, or that it didn't. */
export const ENDING_LABELS: Readonly<Record<CampaignEnding, string>> = {
	starved: 'Starved',
	rioted: 'Rioted',
	disbanded: 'Disbanded',
	won: 'Won',
	abandoned: 'Abandoned',
};

/** `1 driver`, `3 drivers`. */
export function countOf(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The pool at the compound now: the ready and the injured. The dead and the missing stay in the record but aren't there. */
export function driversAtCompound(campaign: Campaign): number {
	return campaign.drivers.filter((driver) => isAtCompound(driver)).length;
}

export function strongholdsText(count: number): string {
	return `${countOf(count, 'stronghold')} taken`;
}

/** Continue's line (Game Flow 1.1): "Day 12 - 3 drivers - 1 stronghold taken". */
export function campaignSummary(campaign: Campaign): string {
	return [
		`Day ${campaign.day}`,
		countOf(driversAtCompound(campaign), 'driver'),
		strongholdsText(campaign.strongholdsTaken.length),
	].join(' - ');
}

/** A past campaign's columns in Campaign History. Day 1 is founding day, so a campaign that ended on day 12 held out 12 days. */
export function historyColumns(entry: CampaignHistoryEntry): { ending: string; days: string; strongholds: string; seed: string } {
	return {
		ending: ENDING_LABELS[entry.ending],
		days: countOf(entry.day, 'day'),
		strongholds: strongholdsText(entry.strongholdsTaken),
		seed: `Seed ${entry.seed}`,
	};
}
