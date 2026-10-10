import { ReaderRangeError, readFields, readInteger, readNullable, readOneOf } from '../core/JsonReader';
import type { Campaign, CampaignLogEntry, Resources } from './Campaign';
import { COMPOUND_FALLS, CompoundFall } from './CampaignHistory';
import { COMPOUND_RULES, CompoundRules } from './CompoundRules';

/**
 * The campaign's end (DDB-305): how a lost campaign's compound falls, the
 * end a campaign keeps once it's over, the tally of runs and fights it keeps
 * for the defeat screen, and the stats that screen reads. Decision record:
 * docs/AI_TECHNICAL_DECISIONS/campaign-end.md.
 */

/**
 * What lost the campaign: nobody left at the compound to drive (every
 * driver in the pool dead or missing), or no People left.
 */
export const LOSS_CAUSES = ['last_driver', 'no_people'] as const;

export type LossCause = (typeof LOSS_CAUSES)[number];

/** A campaign that's over: how its compound fell, and what lost it. Its day stops on the day it fell. */
export interface CampaignEnd {
	ending: CompoundFall;
	cause: LossCause;
}

/** Runs and fights the campaign counts, since nothing else it keeps can tell them. Each count only goes up. */
export interface CampaignTally {
	/** Runs that got home (`Campaign.unloadRun`). */
	runsHome: number;
	/** Runs that failed (`Campaign.loseRun`), each in the one fight it lost. */
	runsFailed: number;
	/** Fights won on runs (`writeBackFight`). */
	fightsWon: number;
}

export const TALLY_FIELDS: readonly (keyof CampaignTally)[] = ['runsHome', 'runsFailed', 'fightsWon'];

export const NO_TALLY: Readonly<CampaignTally> = Object.freeze({ runsHome: 0, runsFailed: 0, fightsWon: 0 });

/** What the defeat screen counts (Game Flow 6.3), all of it read off the campaign. */
export interface CampaignStats {
	/** Days the compound stood, founding day included: the day it fell on, or today while it stands. */
	readonly daysHeld: number;
	/** Supply runs that set off and ended, home or failed. A load out given up isn't one. */
	readonly runs: number;
	readonly runsHome: number;
	readonly runsFailed: number;
	readonly fightsWon: number;
	/** A run fails in the fight it loses, and only then, so these are the failed runs. */
	readonly fightsLost: number;
	/** Drivers killed on failed runs. */
	readonly driversDead: number;
	/** Drivers lost on failed runs and not found since. */
	readonly driversMissing: number;
	readonly strongholdsTaken: number;
}

/** A change refused because the campaign is over, carrying how it ended. */
export class CampaignOverError extends Error {
	public readonly end: Readonly<CampaignEnd>;

	constructor({ end, action }: { end: Readonly<CampaignEnd>; action: string }) {
		super(`Can't ${action}: the campaign is over, since the compound ${end.ending}`);
		this.name = 'CampaignOverError';
		this.end = end;
	}
}

/** Throws a `CampaignOverError` once the campaign is over, before `action` changes anything. */
export function refuseOver({ campaign, action }: { campaign: Campaign; action: string }): void {
	if (campaign.isOver) throw new CampaignOverError({ end: campaign.end as Readonly<CampaignEnd>, action });
}

/** A check's reason that the campaign is over, which every check over the campaign gives first. */
export interface CampaignOverBlocker {
	readonly reason: 'campaign_over';
	readonly end: Readonly<CampaignEnd>;
}

/**
 * Throws the `CampaignOverError` a check's `campaign_over` stands for, with
 * its clearer message, before `action` changes anything; any other reason,
 * or none, passes for the action's own refusal.
 */
export function refuseOverBlocker({ blocker, action }: { blocker: { readonly reason: string } | null; action: string }): void {
	if (blocker !== null && blocker.reason === 'campaign_over') throw new CampaignOverError({ end: (blocker as CampaignOverBlocker).end, action });
}

/**
 * How a lost campaign's compound falls, read off its stores and unrest at
 * the end, in this order: it starves with food at or below
 * `fall.starveAtFood`, riots over what's left at unrest at or above
 * `fall.riotAtUnrest`, and otherwise disbands. Hunger comes first, since an
 * empty larder is a fact and unrest is a mood. `rules` as
 * `readCompoundRules` checked them, which the steps that end a campaign do
 * before they store anything.
 */
export function fallOf({ resources, unrest, rules = COMPOUND_RULES }: {
	resources: Readonly<Resources>;
	unrest: number;
	rules?: CompoundRules;
}): CompoundFall {
	if (resources.food <= rules.fall.starveAtFood) return 'starved';
	if (unrest >= rules.fall.riotAtUnrest) return 'rioted';
	return 'disbanded';
}

/** The log's line for the fall: "No drivers are left, and the compound starved." */
export function fallMessage(end: CampaignEnd): string {
	const left = end.cause === 'last_driver' ? 'No drivers are left' : 'No people are left';
	const fell = end.ending === 'rioted' ? 'rioted over what was left' : end.ending;
	return `${left}, and the compound ${fell}.`;
}

/**
 * The log after a step that can lose the campaign: its own lines, those
 * that aren't null, then the fall's line when it lost it, all dated `day`.
 * The same log when there's nothing to add.
 */
export function stepLog({ log, day, lines, end }: {
	log: readonly Readonly<CampaignLogEntry>[];
	day: number;
	lines: readonly (string | null)[];
	end: Readonly<CampaignEnd> | null;
}): readonly Readonly<CampaignLogEntry>[] {
	const added = [...lines, end === null ? null : fallMessage(end)].filter((line): line is string => line !== null);
	return added.length === 0 ? log : [...log, ...added.map(message => ({ day, message }))];
}

/** An end, or null while the campaign stands, frozen. */
export function readCampaignEnd(value: unknown, path: string): Readonly<CampaignEnd> | null {
	return readNullable(value, path, (end, at) => {
		const fields = readFields(end, at, ['ending', 'cause']);
		return Object.freeze({
			ending: readOneOf(fields.ending, `${at}.ending`, COMPOUND_FALLS),
			cause: readOneOf(fields.cause, `${at}.cause`, LOSS_CAUSES)
		});
	});
}

/** Tallies the reader made: checked and frozen, so they can't have changed since. */
const checkedTallies = new WeakSet<object>();

/** Whole counts from 0, frozen. */
export function readTally(value: unknown, path: string): Readonly<CampaignTally> {
	if (typeof value === 'object' && value !== null && checkedTallies.has(value)) return value as Readonly<CampaignTally>;
	const fields = readFields(value, path, TALLY_FIELDS);
	const count = (field: keyof CampaignTally): number => readInteger(fields[field], `${path}.${field}`, { min: 0 });
	const tally = Object.freeze({ runsHome: count('runsHome'), runsFailed: count('runsFailed'), fightsWon: count('fightsWon') });
	checkedTallies.add(tally);
	return tally;
}

/** Refuses a tally with a count below the one before it: counts only go up. */
export function checkTallyGrows({ from, to, path }: { from: Readonly<CampaignTally>; to: Readonly<CampaignTally>; path: string }): void {
	for (const field of TALLY_FIELDS) {
		if (to[field] < from[field]) throw new ReaderRangeError(`${path}.${field} can't go back, from ${from[field]} to ${to[field]}`);
	}
}

/**
 * The defeat screen's numbers (Game Flow 6.3), derived from what the
 * campaign keeps: its day, its tally, the pool, and the strongholds taken.
 * The rest of 6.3 isn't in the campaign: the last fight's own stats are the
 * fight's, ground covered waits for the map's fog, and unlocks don't exist.
 */
export function campaignStats({ campaign }: { campaign: Campaign }): CampaignStats {
	const { runsHome, runsFailed, fightsWon } = campaign.tally;
	const statusCount = (status: 'dead' | 'missing'): number => campaign.drivers.filter(driver => driver.status === status).length;
	return Object.freeze({
		daysHeld: campaign.day,
		runs: runsHome + runsFailed,
		runsHome,
		runsFailed,
		fightsWon,
		fightsLost: runsFailed,
		driversDead: statusCount('dead'),
		driversMissing: statusCount('missing'),
		strongholdsTaken: campaign.strongholdsTaken.length
	});
}
