import campaignStartFile from '../data/campaign-start.json';
import { ESCORT_CONFIGS, EscortType } from '../mechanics/Escort';
import { MAX_CONVOY_ESCORTS } from '../mechanics/Team';
import { NO_RESOURCES, Resources } from './Campaign';
import { readArray, readFields, readInteger, readOneOf } from './JsonReader';

/**
 * What a new campaign starts with (Compound and Supply Runs, Founding the
 * compound), kept in `data/campaign-start.json` so it tunes without a code
 * change. Every value is a starting point for tuning.
 */
export interface CampaignStart {
	/** Drivers dealt into the starting pool, each a different archetype. Fewer are dealt when fewer archetypes are unlocked. */
	poolSize: number;
	/** The compound's stores on day 1. */
	resources: Readonly<Resources>;
	/** Starter escorts by type, in roster order. Empty for an empty convoy. */
	escorts: readonly EscortType[];
}

const FIELDS: readonly (keyof CampaignStart)[] = ['poolSize', 'resources', 'escorts'];
const RESOURCE_NAMES = Object.keys(NO_RESOURCES) as readonly (keyof Resources)[];
const ESCORT_TYPES = Object.keys(ESCORT_CONFIGS) as readonly EscortType[];

/**
 * Starting values checked: exactly these fields, a pool of at least one,
 * every store a whole number from 0, and escorts of types the garage hires,
 * no more than the convoy holds. Errors name the path, as a save's do. Comes
 * back frozen.
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
		poolSize: readInteger(fields.poolSize, `${path}.poolSize`, { min: 1 }),
		resources: Object.freeze(resources),
		escorts: Object.freeze(escorts.map((type, index) => readOneOf(type, `${path}.escorts[${index}]`, ESCORT_TYPES)))
	});
}

/** The shipped starting values, read as this module loads, so a bad edit to the file fails straight away. */
export const CAMPAIGN_START: CampaignStart = readCampaignStart(campaignStartFile, 'CampaignStart');
