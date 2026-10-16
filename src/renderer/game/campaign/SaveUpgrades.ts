import { CAMPAIGN_SCHEMA_VERSION } from './Campaign';

/**
 * Older save formats this build still loads, each upgraded to the current
 * one (`CAMPAIGN_SCHEMA_VERSION`) as it's read, and written back in the
 * current one at the next save. Only what's needed to keep playtesters'
 * campaigns over a bump that adds state with an obvious starting value; a
 * bump that can't say what an old save meant leaves its version out.
 */

/** Versions upgraded on load, oldest first. Version 8 has no POI stock: every POI is full. */
export const UPGRADABLE_SCHEMA_VERSIONS: readonly number[] = Object.freeze([8]);

/**
 * A campaign as a save of `version` held it, in the current format. Each
 * step upgrades one version to the next. Anything that isn't a campaign
 * object goes through as it is, for the campaign reader to refuse.
 */
export function upgradeCampaignJson({ campaign, version }: { campaign: unknown; version: number }): unknown {
	if (!UPGRADABLE_SCHEMA_VERSIONS.includes(version)) throw new RangeError(`Version ${version} saves can't be upgraded`);
	let upgraded = campaign;
	for (let from = version; from < CAMPAIGN_SCHEMA_VERSION; from += 1) upgraded = STEPS[from](upgraded);
	return upgraded;
}

/** Version 8 to 9: the map state held nothing yet, and its POIs are all full, which is a map state with no `pois`. */
function fromVersion8(campaign: unknown): unknown {
	if (typeof campaign !== 'object' || campaign === null || Array.isArray(campaign)) return campaign;
	const { map } = campaign as { map?: unknown };
	if (typeof map !== 'object' || map === null || Array.isArray(map)) return campaign;
	return { ...campaign, map: {} };
}

const STEPS: Readonly<Record<number, (campaign: unknown) => unknown>> = { 8: fromVersion8 };
