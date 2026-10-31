import { readFields, readInteger } from '../core/JsonReader';
import compoundRulesFile from '../data/compound-rules.json';

/** What the compound eats every day. */
export const UPKEEP_RESOURCES = ['food', 'water'] as const;

export type UpkeepResource = (typeof UPKEEP_RESOURCES)[number];

/** What a scavenging party brings back. */
export const SCAVENGED_RESOURCES = ['fuel', 'scrap'] as const;

export type ScavengedResource = (typeof SCAVENGED_RESOURCES)[number];

/** Whole numbers from `min` to `max`, both included. */
export interface AmountRange {
	readonly min: number;
	readonly max: number;
}

/**
 * The compound's standing rules (Compound and Supply Runs, Hours on the
 * road, days at home; Buildings, the infirmary; Never stuck; The driver
 * pool), kept in `data/compound-rules.json` so they tune without a code
 * change. Every value is a starting point for tuning.
 */
export interface CompoundRules {
	readonly upkeep: {
		/** How many people one unit of each feeds for a day. A day's upkeep is People over this, rounded up. */
		readonly peoplePerUnit: Readonly<Record<UpkeepResource, number>>;
	};
	readonly shortfall: {
		/** People lost, settlers leaving or dying, for each unit of upkeep the stores can't cover. */
		readonly peopleLostPerUnit: number;
		/** Unrest gained for each unit short. */
		readonly unrestPerUnit: number;
	};
	readonly infirmary: {
		/**
		 * HP a day in the infirmary is worth. A driver who comes home this many
		 * HP down, or any part of it, is injured for a day; twice as many, two.
		 */
		readonly hitpointsPerDay: number;
		/** Meds that take a day off an injury. */
		readonly medsPerDay: number;
	};
	/** What a scavenging party on foot brings back, each amount rolled from its range. */
	readonly scavenging: Readonly<Record<ScavengedResource, AmountRange>>;
	/**
	 * How a compound that has lost its campaign falls (Compound and Supply
	 * Runs, The driver pool), read off its stores and unrest in this order:
	 * it starves, then riots, and otherwise disbands (`fallOf`).
	 */
	readonly fall: {
		/** Food in the stores at or below which it starves. */
		readonly starveAtFood: number;
		/** Unrest at or above which it riots over what's left. */
		readonly riotAtUnrest: number;
	};
}

/** Ceilings far past any tuning, so a slip in the file fails as it loads instead of overflowing a day's sums. */
const MAX_PEOPLE_PER_UNIT = 100;
const MAX_SHORTFALL_COST = 100;
const MAX_HITPOINTS_PER_DAY = 100;
const MAX_MEDS_PER_DAY = 100;
const MAX_FALL_THRESHOLD = 1000;

/**
 * What a party's haul can be tuned to. Fuel never goes below 1, so every
 * day spent scavenging brings a run closer and the file can't be tuned into
 * a soft-lock.
 */
const SCAVENGING_LIMITS: Readonly<Record<ScavengedResource, AmountRange>> = { fuel: { min: 1, max: 100 }, scrap: { min: 0, max: 1000 } };

/** A frozen record holding a value for each resource the compound eats. */
export function upkeepRecord<Value>(valueOf: (resource: UpkeepResource) => Value): Readonly<Record<UpkeepResource, Value>> {
	return Object.freeze(Object.fromEntries(UPKEEP_RESOURCES.map(resource => [resource, valueOf(resource)])) as Record<UpkeepResource, Value>);
}

/**
 * Rules checked: exactly these fields, a whole number of people from 1 to
 * 100 that each unit feeds, whole-number shortfall costs from 0 to 100, an
 * infirmary day worth 1 to 100 HP and costing 1 to 100 meds, a scavenging
 * haul of 1 to 100 fuel and 0 to 1,000 scrap, each range's min no more than
 * its max, and a fall that starves at 0 to 1,000 food and riots at 1 to
 * 1,000 unrest. Errors name the path, as a save's do. Comes back frozen.
 */
export function readCompoundRules(value: unknown, path: string): CompoundRules {
	const fields = readFields(value, path, ['upkeep', 'shortfall', 'infirmary', 'scavenging', 'fall']);
	const upkeep = readFields(fields.upkeep, `${path}.upkeep`, ['peoplePerUnit']);
	const perUnit = readFields(upkeep.peoplePerUnit, `${path}.upkeep.peoplePerUnit`, UPKEEP_RESOURCES);
	const shortfall = readFields(fields.shortfall, `${path}.shortfall`, ['peopleLostPerUnit', 'unrestPerUnit']);
	const cost = (name: 'peopleLostPerUnit' | 'unrestPerUnit'): number =>
		readInteger(shortfall[name], `${path}.shortfall.${name}`, { min: 0, max: MAX_SHORTFALL_COST });
	const infirmary = readFields(fields.infirmary, `${path}.infirmary`, ['hitpointsPerDay', 'medsPerDay']);
	const scavenging = readFields(fields.scavenging, `${path}.scavenging`, SCAVENGED_RESOURCES);
	const fall = readFields(fields.fall, `${path}.fall`, ['starveAtFood', 'riotAtUnrest']);
	return Object.freeze({
		upkeep: Object.freeze({
			peoplePerUnit: upkeepRecord(resource =>
				readInteger(perUnit[resource], `${path}.upkeep.peoplePerUnit.${resource}`, { min: 1, max: MAX_PEOPLE_PER_UNIT }))
		}),
		shortfall: Object.freeze({
			peopleLostPerUnit: cost('peopleLostPerUnit'),
			unrestPerUnit: cost('unrestPerUnit')
		}),
		infirmary: Object.freeze({
			hitpointsPerDay: readInteger(infirmary.hitpointsPerDay, `${path}.infirmary.hitpointsPerDay`, { min: 1, max: MAX_HITPOINTS_PER_DAY }),
			medsPerDay: readInteger(infirmary.medsPerDay, `${path}.infirmary.medsPerDay`, { min: 1, max: MAX_MEDS_PER_DAY })
		}),
		scavenging: Object.freeze({
			fuel: readRange(scavenging.fuel, `${path}.scavenging.fuel`, SCAVENGING_LIMITS.fuel),
			scrap: readRange(scavenging.scrap, `${path}.scavenging.scrap`, SCAVENGING_LIMITS.scrap)
		}),
		fall: Object.freeze({
			starveAtFood: readInteger(fall.starveAtFood, `${path}.fall.starveAtFood`, { min: 0, max: MAX_FALL_THRESHOLD }),
			riotAtUnrest: readInteger(fall.riotAtUnrest, `${path}.fall.riotAtUnrest`, { min: 1, max: MAX_FALL_THRESHOLD })
		})
	});
}

/** A range inside `limits`, its min no more than its max, frozen. */
function readRange(value: unknown, path: string, limits: AmountRange): AmountRange {
	const range = readFields(value, path, ['min', 'max']);
	const min = readInteger(range.min, `${path}.min`, limits);
	const max = readInteger(range.max, `${path}.max`, { min, max: limits.max });
	return Object.freeze({ min, max });
}

/** The shipped rules, read as this module loads, so a bad edit to the file fails straight away. */
export const COMPOUND_RULES: CompoundRules = readCompoundRules(compoundRulesFile, 'CompoundRules');
