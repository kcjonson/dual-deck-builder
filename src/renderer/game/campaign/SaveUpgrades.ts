import { CAMPAIGN_SCHEMA_VERSION } from './Campaign';

/**
 * Older save formats this build still loads, each upgraded to the current
 * one (`CAMPAIGN_SCHEMA_VERSION`) as it's read, and written back in the
 * current one at the next save. Only what's needed to keep playtesters'
 * campaigns over a bump that adds state with an obvious starting value; a
 * bump that can't say what an old save meant leaves its version out.
 */

/**
 * Versions upgraded on load, oldest first. Version 8 has no POI stock: every
 * POI is full. Version 9 has no buildings: only the bunkhouse, which every
 * campaign was founded with, stands. Version 10's run out has no recruits:
 * nothing found anyone new before Find: driver stops.
 */
export const UPGRADABLE_SCHEMA_VERSIONS: readonly number[] = Object.freeze([8, 9, 10]);

/**
 * A campaign as a save of `version` held it, in the current format. Each
 * step upgrades one version to the next. Anything that isn't a campaign
 * object goes through as it is, for the campaign reader to refuse.
 */
export function upgradeCampaignJson({ campaign, version }: { campaign: unknown; version: number }): unknown {
	if (!UPGRADABLE_SCHEMA_VERSIONS.includes(version)) throw new RangeError(`Version ${version} saves can't be upgraded`);
	let upgraded = campaign;
	for (let from = version; from < CAMPAIGN_SCHEMA_VERSION; from += 1) {
		const step = UPGRADE_STEPS[from];
		if (!step) throw new RangeError(`No upgrade from version ${from} to ${from + 1}, so version ${version} saves can't be upgraded`);
		upgraded = step(upgraded);
	}
	return upgraded;
}

/** Version 8 to 9: its POIs are all full, which is a map state with no `pois`; nothing in version 8 wrote one. */
function fromVersion8(campaign: unknown): unknown {
	if (!isObject(campaign)) return campaign;
	const { map } = campaign;
	if (!isObject(map)) return campaign;
	return { ...campaign, map: Object.fromEntries(Object.entries(map).filter(([key]) => key !== 'pois')) };
}

/** Version 9 to 10: the bunkhouse stands, as it did in every version 9 campaign (its Crew screen was always open). */
function fromVersion9(campaign: unknown): unknown {
	if (!isObject(campaign)) return campaign;
	return { ...campaign, buildings: ['bunkhouse'] };
}

/** Version 10 to 11: a run out has found nobody new, since version 10 had no Find: driver stops. Recruits already there are left for the reader to refuse. */
function fromVersion10(campaign: unknown): unknown {
	if (!isObject(campaign) || !isObject(campaign.supplyRun)) return campaign;
	return { ...campaign, supplyRun: { recruits: [], ...campaign.supplyRun } };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Each version's step to the next, by the version it upgrades from. Every version from the oldest listed up to the current one needs one. */
export const UPGRADE_STEPS: Readonly<Record<number, (campaign: unknown) => unknown>> = Object.freeze({ 8: fromVersion8, 9: fromVersion9, 10: fromVersion10 });
