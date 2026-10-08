import type { Campaign } from './Campaign';
import { readArray, readFields, readInteger, readObject, readOneOf } from './JsonReader';
import { SaveMigration, migrateSave } from './SaveMigrations';

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

/** The history as stored, newest campaign first. */
export interface CampaignHistoryJson {
	schemaVersion: number;
	campaigns: CampaignHistoryEntry[];
}

/** The history's schema version. Bump it whenever its JSON changes shape, and add the step that upgrades the version before. */
export const HISTORY_SCHEMA_VERSION = 1;

/** The steps, keyed by the version each one upgrades from. Empty while 1 is the only version. */
export const HISTORY_MIGRATIONS: Readonly<Record<number, SaveMigration>> = {};

const ENTRY_FIELDS: readonly (keyof CampaignHistoryEntry)[] = ['seed', 'day', 'strongholdsTaken', 'ending'];
const UINT32_MAX = 0xffffffff;

/** A campaign's line in the history, as it stands now. */
export function historyEntry({ campaign, ending }: { campaign: Campaign; ending: CampaignEnding }): CampaignHistoryEntry {
	return {
		seed: campaign.seed,
		day: campaign.day,
		strongholdsTaken: campaign.strongholdsTaken.length,
		ending: readOneOf(ending, 'ending', CAMPAIGN_ENDINGS)
	};
}

/** Whether two entries say the same thing, as a campaign ended twice would. */
export function sameEntry(first: CampaignHistoryEntry, second: CampaignHistoryEntry): boolean {
	return ENTRY_FIELDS.every(field => first[field] === second[field]);
}

export function historyToJson(entries: readonly CampaignHistoryEntry[]): CampaignHistoryJson {
	return { schemaVersion: HISTORY_SCHEMA_VERSION, campaigns: entries.map(entry => ({ ...entry })) };
}

/**
 * Reads a stored history, upgrading it from an older schema version first.
 * Throws on anything malformed, naming where, and a `NewerSaveError` for a
 * history a newer build wrote.
 */
export function readHistory(value: unknown): CampaignHistoryEntry[] {
	const path = 'CampaignHistory';
	const upgraded = migrateSave({ save: readObject(value, path), path, to: HISTORY_SCHEMA_VERSION, migrations: HISTORY_MIGRATIONS });
	const record = readFields(upgraded, path, ['schemaVersion', 'campaigns']);
	return readArray(record.campaigns, `${path}.campaigns`).map((entry, index) => readEntry(entry, `${path}.campaigns[${index}]`));
}

function readEntry(value: unknown, path: string): CampaignHistoryEntry {
	const fields = readFields(value, path, ENTRY_FIELDS);
	return {
		seed: readInteger(fields.seed, `${path}.seed`, { min: 0, max: UINT32_MAX }),
		day: readInteger(fields.day, `${path}.day`, { min: 1 }),
		strongholdsTaken: readInteger(fields.strongholdsTaken, `${path}.strongholdsTaken`, { min: 0 }),
		ending: readOneOf(fields.ending, `${path}.ending`, CAMPAIGN_ENDINGS)
	};
}
