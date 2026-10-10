import { isAtCompound } from '../../campaign/Campaign';
import type { Campaign } from '../../campaign/Campaign';
import type { FoundingProgress } from '../../campaign/CampaignFounding';
import type { CampaignEnding, CampaignHistoryEntry } from '../../campaign/CampaignHistory';
import type { AreaMapStageName } from '../../map/AreaMapPipeline';
import type { StageAttempt } from '../../map/MapPipeline';

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

/** The day a lost campaign fell on, which is the days it held out: over the defeat screen's title, and Continue's line. */
export function fellOnText(day: number): string {
	return `Fell on day ${day}`;
}

/** Continue's line (Game Flow 1.1): "Day 12 - 3 drivers - 1 stronghold taken", or "Fell on day 12" for a campaign that's over. */
export function campaignSummary(campaign: Campaign): string {
	if (campaign.isOver) return fellOnText(campaign.day);
	return [
		`Day ${campaign.day}`,
		countOf(driversAtCompound(campaign), 'driver'),
		strongholdsText(campaign.strongholdsTaken.length),
	].join(' - ');
}

/**
 * What the progress line calls each stage of the area map pipeline. Keyed
 * by every stage name, so a stage added without a label fails the typecheck.
 */
export const MAP_STAGE_LABELS: Readonly<Record<AreaMapStageName, string>> = {
	terrain: 'terrain',
	water: 'water',
	highways: 'highways',
	growth: 'roads',
	routeTree: 'route tree',
	pois: 'POIs',
};

/** A map generation's progress, for a line under whatever waits on it: "Making the area map: POIs (6 of 6)". */
export function mapProgressText({ stage, index, count }: Pick<StageAttempt<AreaMapStageName>, 'stage' | 'index' | 'count'>): string {
	return `Making the area map: ${MAP_STAGE_LABELS[stage]} (${index + 1} of ${count})`;
}

/** New Campaign's line while founding: the map's progress, with the try once generation has given up on a seed. */
export function foundingText(progress: FoundingProgress): string {
	const line = mapProgressText(progress);
	return progress.seedAttempt === 0 ? line : `${line}, try ${progress.seedAttempt + 1}`;
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
