import type { Campaign } from '../../campaign/Campaign';
import type { CampaignEnd, CampaignStats } from '../../campaign/CampaignEnd';
import type { CompoundFall } from '../../campaign/CampaignHistory';
import { countOf } from '../main-menu/campaignText';

/** The defeat screen's title, by how the compound fell. */
export const FALL_TITLES: Readonly<Record<CompoundFall, string>> = {
	starved: 'The compound starved',
	rioted: 'The compound rioted',
	disbanded: 'The compound disbanded',
};

/** Over the title: the day it fell on, which is the days it held out. */
export function fellOnText(day: number): string {
	return `Fell on day ${day}`;
}

/** Why it fell, then how (Game Flow 6.3, Cause of Defeat): what lost the campaign, and the state that chose the ending. */
export function fallStory(end: CampaignEnd): string {
	const cause = end.cause === 'last_driver'
		? 'No drivers were left at the compound to send out.'
		: 'No people were left at the compound.';
	const how: Record<CompoundFall, string> = {
		starved: 'The stores had run out of food.',
		rioted: 'Unrest boiled over, and the last of them fought over what was left.',
		disbanded: 'The gates were left open as the settlers walked away.',
	};
	return `${cause} ${how[end.ending]}`;
}

/** One line of the campaign's record: what's counted, and its count. */
export interface RecordRow {
	readonly id: string;
	readonly label: string;
	readonly value: string;
}

/**
 * The campaign's record, from `campaignStats` and the stores it fell on:
 * days held, runs, fights, drivers lost, strongholds taken, and what the
 * compound held at the end, which is what chose the ending.
 */
export function recordRows({ campaign, stats }: { campaign: Campaign; stats: CampaignStats }): readonly RecordRow[] {
	const { people, food, water } = campaign.resources;
	return [
		{ id: 'days', label: 'Days held', value: countOf(stats.daysHeld, 'day') },
		{ id: 'runs', label: 'Supply runs', value: `${stats.runsHome} home, ${stats.runsFailed} failed` },
		{ id: 'fights', label: 'Fights', value: `${stats.fightsWon} won, ${stats.fightsLost} lost` },
		{ id: 'drivers', label: 'Drivers lost', value: `${stats.driversDead} killed, ${stats.driversMissing} missing` },
		{ id: 'strongholds', label: 'Strongholds taken', value: `${stats.strongholdsTaken}` },
		{ id: 'stores', label: 'At the end', value: `${people} ${people === 1 ? 'person' : 'people'}, ${food} food, ${water} water, unrest ${campaign.unrest}` },
	];
}

/** What the screen says when it has no lost campaign to show, opened with none and no save that's over. */
export const NO_FALL = 'No campaign has been lost here. Its record shows once a compound falls.';
