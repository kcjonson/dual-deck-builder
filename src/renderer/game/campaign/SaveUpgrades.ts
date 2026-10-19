import { ReaderRangeError, readArray, readFields, readInteger } from '../core/JsonReader';
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
 * nothing found anyone new before Find: driver stops. Version 11 has POI
 * stock where clearing is now: a POI a run took from is cleared. Version
 * 12's run out has found no escorts and has no hand-off: nothing on a run
 * was an event.
 */
export const UPGRADABLE_SCHEMA_VERSIONS: readonly number[] = Object.freeze([8, 9, 10, 11, 12]);

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

/**
 * Version 11 to 12: a POI with stock taken (an entry in the map state's
 * `pois`) had a run reach it, which clears it now, so its index goes into
 * `clearedPois` and the stock goes. A POI that had refilled had no entry
 * left, so it reads as never reached. No stop was cleared, since nothing
 * kept stop state. The stock is held to version 11's own reader first, so
 * a damaged one is refused rather than guessed at.
 */
function fromVersion11(campaign: unknown): unknown {
	if (!isObject(campaign) || !isObject(campaign.map)) return campaign;
	const { pois, ...map } = campaign.map;
	if (pois === undefined) return campaign;
	const cleared = readVersion11Stock(pois, 'Campaign.map.pois');
	return { ...campaign, map: cleared.length === 0 ? map : { ...map, clearedPois: cleared } };
}

/** Version 12 to 13: a run out has found no escorts and waits on no hand-off, since no version 12 stop was an event. Fields already there are left for the reader to refuse. */
function fromVersion12(campaign: unknown): unknown {
	if (!isObject(campaign) || !isObject(campaign.supplyRun)) return campaign;
	return { ...campaign, supplyRun: { escortsFound: [], handOff: null, ...campaign.supplyRun } };
}

/** Version 11's POI stock as its reader took it, each POI once and in order with its shares short of full; the POIs in it. */
function readVersion11Stock(value: unknown, path: string): number[] {
	let previous = -1;
	return readArray(value, path).map((entry, index) => {
		const at = `${path}[${index}]`;
		const fields = readFields(entry, at, ['poi', 'left', 'nights']);
		const poi = readInteger(fields.poi, `${at}.poi`, { min: 0 });
		if (poi <= previous) throw new ReaderRangeError(`${at}.poi must come after the entry above it (${previous}), got ${poi}`);
		previous = poi;
		readInteger(fields.left, `${at}.left`, { min: 0, max: 2 });
		readInteger(fields.nights, `${at}.nights`, { min: 0 });
		return poi;
	});
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Each version's step to the next, by the version it upgrades from. Every version from the oldest listed up to the current one needs one. */
export const UPGRADE_STEPS: Readonly<Record<number, (campaign: unknown) => unknown>> = Object.freeze({ 8: fromVersion8, 9: fromVersion9, 10: fromVersion10, 11: fromVersion11, 12: fromVersion12 });
