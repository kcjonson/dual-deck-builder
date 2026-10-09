import { readArray, readFields, readInteger, readObject, readOneOf, readSeed } from '../core/JsonReader';
import type { Campaign } from './Campaign';

/**
 * How a campaign ended. The compound falls when its last driver dies, and
 * starves, riots, or disbands by its state at the end (Compound and Supply
 * Runs, The driver pool); a campaign can also be won, or abandoned for a new
 * one.
 */
export const CAMPAIGN_ENDINGS = ['starved', 'rioted', 'disbanded', 'won', 'abandoned'] as const;

export type CampaignEnding = (typeof CAMPAIGN_ENDINGS)[number];

/** A past campaign, as the main menu's history lists it: a few numbers, since the list only grows. */
export interface CampaignHistoryEntry {
	/** The seed its map was made from, which the history shows. */
	seed: number;
	/** The day it ended on, counting founding day as day 1. */
	day: number;
	/** How many strongholds it took. */
	strongholdsTaken: number;
	ending: CampaignEnding;
}

/** The history as stored, newest campaign first, stamped with the save format version that wrote it. */
export interface CampaignHistoryJson {
	version: number;
	campaigns: CampaignHistoryEntry[];
}

const ENTRY_FIELDS: readonly (keyof CampaignHistoryEntry)[] = ['seed', 'day', 'strongholdsTaken', 'ending'];

/** A campaign's line in the history, as it stands now. Throws a reader error on an ending that doesn't exist. */
export function historyEntry({ campaign, ending }: { campaign: Campaign; ending: CampaignEnding }): CampaignHistoryEntry {
	return {
		seed: campaign.seed,
		day: campaign.day,
		strongholdsTaken: campaign.strongholdsTaken.length,
		ending: readOneOf(ending, 'ending', CAMPAIGN_ENDINGS)
	};
}

/**
 * Whether two entries say the same thing, as a campaign ended twice the
 * same way would. Entries carry no campaign identity, so two campaigns on
 * one seed that end the same way on the same day read as one too.
 */
export function sameEntry(first: CampaignHistoryEntry, second: CampaignHistoryEntry): boolean {
	return ENTRY_FIELDS.every(field => first[field] === second[field]);
}

export function historyToJson({ version, entries }: { version: number; entries: readonly CampaignHistoryEntry[] }): CampaignHistoryJson {
	return { version, campaigns: entries.map(entry => ({ ...entry })) };
}

/**
 * A stored history's entries, or null when another version of the save
 * format stamped it, which this build doesn't read. The version is checked
 * first, so only a history of this version has to be well formed; anything
 * malformed then throws a reader error, naming where.
 */
export function readHistory(value: unknown, { version }: { version: number }): CampaignHistoryEntry[] | null {
	const path = 'CampaignHistory';
	if (readObject(value, path).version !== version) return null;
	const record = readFields(value, path, ['version', 'campaigns']);
	return readArray(record.campaigns, `${path}.campaigns`).map((entry, index) => readEntry(entry, `${path}.campaigns[${index}]`));
}

function readEntry(value: unknown, path: string): CampaignHistoryEntry {
	const fields = readFields(value, path, ENTRY_FIELDS);
	return {
		seed: readSeed(fields.seed, `${path}.seed`),
		day: readInteger(fields.day, `${path}.day`, { min: 1 }),
		strongholdsTaken: readInteger(fields.strongholdsTaken, `${path}.strongholdsTaken`, { min: 0 }),
		ending: readOneOf(fields.ending, `${path}.ending`, CAMPAIGN_ENDINGS)
	};
}
