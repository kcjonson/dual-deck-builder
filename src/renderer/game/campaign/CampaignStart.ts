import { readArray, readFields, readInteger, readOneOf } from '../core/JsonReader';
import campaignStartFile from '../data/campaign-start.json';
import { ESCORT_CONFIGS, EscortType } from '../mechanics/Escort';
import { MAX_CONVOY_ESCORTS } from '../mechanics/Team';
import { RESOURCE_NAMES, Resources } from './Campaign';

/**
 * A full run's seats: two drivers, no two alike (load out's pair rule). A
 * compound is founded able to send one, so its starting pool and its
 * unlocked archetypes hold at least this many. A run down to its last
 * driver seats fewer, but no campaign starts that way.
 */
export const FULL_RUN_SEATS = 2;

/**
 * What a new campaign starts with (Compound and Supply Runs, Founding the
 * compound), kept in `data/campaign-start.json` so it tunes without a code
 * change. Every value is a starting point for tuning.
 */
export interface CampaignStart {
	/**
	 * Drivers dealt into the starting pool, each a different archetype, and at
	 * least the two a run takes. Fewer are dealt when fewer archetypes are unlocked.
	 */
	poolSize: number;
	/** The compound's stores on day 1. */
	resources: Readonly<Resources>;
	/** Starter escorts by type, in roster order. Empty for an empty convoy. */
	escorts: readonly EscortType[];
}

const FIELDS: readonly (keyof CampaignStart)[] = ['poolSize', 'resources', 'escorts'];
const ESCORT_TYPES = Object.keys(ESCORT_CONFIGS) as readonly EscortType[];

/**
 * Starting values checked: exactly these fields, a pool big enough for a
 * run, every store a whole number from 0, and escorts of types the garage
 * hires, no more than the convoy holds. Errors name the path, as a save's
 * do. Comes back frozen.
 */
export function readCampaignStart(value: unknown, path: string): CampaignStart {
	const fields = readFields(value, path, FIELDS);
	const stores = readFields(fields.resources, `${path}.resources`, RESOURCE_NAMES);
	const resources = {} as Resources;
	for (const name of RESOURCE_NAMES) resources[name] = readInteger(stores[name], `${path}.resources.${name}`, { min: 0 });
	const escorts = readArray(fields.escorts, `${path}.escorts`);
	if (escorts.length > MAX_CONVOY_ESCORTS) {
		throw new RangeError(`${path}.escorts must hold at most ${MAX_CONVOY_ESCORTS}, as many as the convoy takes, got ${escorts.length}`);
	}
	return Object.freeze({
		poolSize: readInteger(fields.poolSize, `${path}.poolSize`, { min: FULL_RUN_SEATS }),
		resources: Object.freeze(resources),
		escorts: Object.freeze(escorts.map((type, index) => readOneOf(type, `${path}.escorts[${index}]`, ESCORT_TYPES)))
	});
}

/** The shipped starting values, read as this module loads, so a bad edit to the file fails straight away. */
export const CAMPAIGN_START: CampaignStart = readCampaignStart(campaignStartFile, 'CampaignStart');
