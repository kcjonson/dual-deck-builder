import { readInteger } from '../core/JsonReader';
import { Campaign, CampaignData, Resources } from './Campaign';
import { CampaignEnd, fallMessage, fallOf, refuseOver } from './CampaignEnd';
import { COMPOUND_RULES, CompoundRules, UPKEEP_RESOURCES, UpkeepResource, readCompoundRules, upkeepRecord } from './CompoundRules';
import { DriverRecord } from './DriverRecord';
import { healingChanges } from './Infirmary';
import { MapState, readMapState } from './MapState';

/** An amount of each resource the compound eats. */
export type Upkeep = Readonly<Record<UpkeepResource, number>>;

/** The campaign's state as it stood at dusk, frozen, without the map, which a step takes as it stands so far. */
export type DuskState = Readonly<Omit<CampaignData, 'map'>>;

/**
 * Something the area map does overnight, given the campaign's state at dusk
 * and the map so far: it returns the map for the next dawn. It changes
 * nothing itself, so a day end that fails part way changes nothing.
 */
export type MapDayStep = (context: { readonly campaign: DuskState; readonly map: MapState }) => MapState;

/** The area map's part in the end of a day, in the order the steps run. */
export interface DayEndHooks {
	/** Cleared stops coming back once their cooldown is up, rerolled (Area Map Generation, What changes after generation). */
	readonly stopCooldowns: MapDayStep;
	/** Depleted POIs refilling over the days (Compound and Supply Runs, POIs). */
	readonly poiRefills: MapDayStep;
}

const keepMap: MapDayStep = ({ map }) => map;

/** Nothing changes on the map overnight until the map keeps stop and POI state. */
export const DAY_END_HOOKS: DayEndHooks = Object.freeze({ stopCooldowns: keepMap, poiRefills: keepMap });

/** The compound still stands, or People reached 0 and it's abandoned, which lost the campaign. */
export type DayEndOutcome = 'continues' | 'abandoned';

/** What happened overnight, for the debrief, the compound screen, and whatever ends the campaign. */
export interface DayEnd {
	/** The day that ended. The campaign is now at the dawn of the next, unless the night lost it. */
	readonly day: number;
	/** What the day's upkeep came to, for the People there at dusk. */
	readonly upkeep: Upkeep;
	/** How much of the upkeep the stores couldn't cover. */
	readonly shortfall: Upkeep;
	readonly peopleLost: number;
	readonly unrestGained: number;
	/** Injured drivers who are fit again at dawn. */
	readonly healed: readonly DriverRecord[];
	/**
	 * `abandoned` whenever People is 0 at dawn, and `continues` otherwise.
	 * With no run out the campaign is then over (`Campaign.end` says how it
	 * fell); with one out, it ends the first night after the run is home.
	 */
	readonly outcome: DayEndOutcome;
}

/** One resource's forecast for the needs panel. */
export interface NeedForecast {
	/** What the stores hold now. */
	readonly stock: number;
	/** What a day eats, for the People here now. */
	readonly perDay: number;
	/**
	 * How many more day ends the stock covers in full, if People stays as it
	 * is and nothing comes in: "Food runs out in 6 days". 0 when tonight is
	 * already short, and null when nobody's here to eat it.
	 */
	readonly days: number | null;
	/** How far short tonight's upkeep will fall. */
	readonly shortTonight: number;
}

export type NeedsForecast = Readonly<Record<UpkeepResource, NeedForecast>>;

export interface DayEndOptions {
	campaign: Campaign;
	/** The shipped `data/compound-rules.json` when left out. */
	rules?: CompoundRules;
	/** The shipped `DAY_END_HOOKS` when left out. */
	hooks?: DayEndHooks;
}

/**
 * Ends the campaign's day (Compound and Supply Runs, Hours on the road, days
 * at home). A run getting home ends it, and so does a day spent at the
 * compound without one, so the compound between runs is always at dawn. In
 * order:
 *
 * 1. Upkeep: the compound eats food and water for the People there at dusk.
 * 2. Shortfalls: whatever the stores couldn't cover costs people and raises unrest.
 * 3. Healing: each injured driver is a day closer to fit, and one who gets
 *    there is ready again at full HP, as meds would leave them (Infirmary).
 * 4. Stop cooldowns, then POI refills, on the map (`hooks`).
 * 5. The day turns, and a shortfall goes in the log, dated the day it happened.
 * 6. A night that leaves no People, with no run out, loses the campaign
 *    (`end`, cause `no_people`): the compound falls as `fallOf` reads its
 *    stores and unrest, the log says how, and the day doesn't turn, since
 *    the compound fell on the day that ended.
 *
 * Everything is worked out and checked before anything is stored, so a step
 * that throws (a hook, the map it returns, a day or unrest past what a save
 * holds) changes nothing. Then the healed records are stored, and the
 * campaign last, in one `set`: its `change` comes once the day end is whole.
 * Nothing here draws randomness. Throws, changing nothing, once the campaign
 * is over.
 */
export function endDay({ campaign, rules = COMPOUND_RULES, hooks = DAY_END_HOOKS }: DayEndOptions): DayEnd {
	refuseOver({ campaign, action: 'end the day' });
	const checked = readCompoundRules(rules, 'CompoundRules');
	const { map: duskMap, ...state } = campaign.getState();
	const dusk: DuskState = Object.freeze(state);
	const { day, resources, unrest } = dusk;
	const upkeep = dailyUpkeep({ people: resources.people, rules: checked });
	const shortfall = upkeepRecord(resource => Math.max(0, upkeep[resource] - resources[resource]));
	const unitsShort = UPKEEP_RESOURCES.reduce((total, resource) => total + shortfall[resource], 0);
	const peopleLost = Math.min(resources.people, unitsShort * checked.shortfall.peopleLostPerUnit);
	const unrestGained = unitsShort * checked.shortfall.unrestPerUnit;
	const people = resources.people - peopleLost;
	// An end needs the run home first, and a run out is the next day end's to settle
	const lost = people === 0 && dusk.runDecks.length === 0;
	const nextDay = lost ? day : readInteger(day + 1, 'Campaign.day', { min: 1 });
	const nextUnrest = readInteger(unrest + unrestGained, 'Campaign.unrest', { min: 0 });
	const healing = dusk.drivers
		.filter(driver => driver.status === 'injured')
		.map(driver => ({ driver, changes: healingChanges({ driver, days: 1 }) }));
	const afterCooldowns = readMapState(hooks.stopCooldowns({ campaign: dusk, map: duskMap }), 'DayEndHooks.stopCooldowns');
	const map = readMapState(hooks.poiRefills({ campaign: dusk, map: afterCooldowns }), 'DayEndHooks.poiRefills');
	const stores: Resources = { ...resources, people };
	for (const resource of UPKEEP_RESOURCES) stores[resource] = Math.max(0, resources[resource] - upkeep[resource]);
	const end: CampaignEnd | null = lost ? { ending: fallOf({ resources: stores, unrest: nextUnrest, rules: checked }), cause: 'no_people' } : null;

	healing.forEach(({ driver, changes }) => driver.set(changes));
	// Read after the records are stored, so a line a record's listener logged stays in.
	const lines = [unitsShort > 0 ? shortfallMessage({ shortfall, peopleLost }) : null, end === null ? null : fallMessage(end)]
		.filter((line): line is string => line !== null);
	const log = lines.length === 0 ? campaign.log : [...campaign.log, ...lines.map(message => ({ day, message }))];
	campaign.set({ day: nextDay, resources: stores, unrest: nextUnrest, map, log, end });

	return Object.freeze({
		day,
		upkeep,
		shortfall,
		peopleLost,
		unrestGained,
		healed: Object.freeze(healing.filter(({ changes }) => changes.status === 'ready').map(({ driver }) => driver)),
		outcome: people === 0 ? 'abandoned' : 'continues'
	});
}

/**
 * The needs panel's forecast for food and water: what's in the stores, what
 * a day eats, and how many days that lasts if People stays as it is and
 * nothing comes in. It matches what `endDay` will do: the first short day
 * end is the one after `days` of them.
 */
export function forecastNeeds({ resources, rules = COMPOUND_RULES }: { resources: Readonly<Resources>; rules?: CompoundRules }): NeedsForecast {
	const upkeep = dailyUpkeep({ people: readInteger(resources.people, 'resources.people', { min: 0 }), rules: readCompoundRules(rules, 'CompoundRules') });
	return upkeepRecord(resource => {
		const stock = readInteger(resources[resource], `resources.${resource}`, { min: 0 });
		const perDay = upkeep[resource];
		return Object.freeze({
			stock,
			perDay,
			days: perDay === 0 ? null : Math.floor(stock / perDay),
			shortTonight: Math.max(0, perDay - stock)
		});
	});
}

/** A day's food and water: People over the people each unit feeds, rounded up. */
function dailyUpkeep({ people, rules }: { people: number; rules: CompoundRules }): Upkeep {
	return upkeepRecord(resource => Math.ceil(people / rules.upkeep.peoplePerUnit[resource]));
}

/** "Ran short of 2 food and 1 water; 3 people lost." */
export function shortfallMessage({ shortfall, peopleLost }: { shortfall: Upkeep; peopleLost: number }): string {
	const short = UPKEEP_RESOURCES.filter(resource => shortfall[resource] > 0).map(resource => `${shortfall[resource]} ${resource}`).join(' and ');
	if (peopleLost === 0) return `Ran short of ${short}.`;
	return `Ran short of ${short}; ${peopleLost} ${peopleLost === 1 ? 'person' : 'people'} lost.`;
}
