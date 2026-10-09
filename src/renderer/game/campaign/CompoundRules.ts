import { readFields, readInteger } from '../core/JsonReader';
import compoundRulesFile from '../data/compound-rules.json';

/** What the compound eats every day. */
export const UPKEEP_RESOURCES = ['food', 'water'] as const;

export type UpkeepResource = (typeof UPKEEP_RESOURCES)[number];

/**
 * The compound's standing rules (Compound and Supply Runs, Hours on the
 * road, days at home; Buildings, the infirmary), kept in
 * `data/compound-rules.json` so they tune without a code change. Every value
 * is a starting point for tuning.
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
}

/** Ceilings far past any tuning, so a slip in the file fails as it loads instead of overflowing a day's sums. */
const MAX_PEOPLE_PER_UNIT = 100;
const MAX_SHORTFALL_COST = 100;
const MAX_HITPOINTS_PER_DAY = 100;
const MAX_MEDS_PER_DAY = 100;

/** A frozen record holding a value for each resource the compound eats. */
export function upkeepRecord<Value>(valueOf: (resource: UpkeepResource) => Value): Readonly<Record<UpkeepResource, Value>> {
	return Object.freeze(Object.fromEntries(UPKEEP_RESOURCES.map(resource => [resource, valueOf(resource)])) as Record<UpkeepResource, Value>);
}

/**
 * Rules checked: exactly these fields, a whole number of people from 1 to
 * 100 that each unit feeds, whole-number shortfall costs from 0 to 100, and
 * an infirmary day worth 1 to 100 HP and costing 1 to 100 meds. Errors name
 * the path, as a save's do. Comes back frozen.
 */
export function readCompoundRules(value: unknown, path: string): CompoundRules {
	const fields = readFields(value, path, ['upkeep', 'shortfall', 'infirmary']);
	const upkeep = readFields(fields.upkeep, `${path}.upkeep`, ['peoplePerUnit']);
	const perUnit = readFields(upkeep.peoplePerUnit, `${path}.upkeep.peoplePerUnit`, UPKEEP_RESOURCES);
	const shortfall = readFields(fields.shortfall, `${path}.shortfall`, ['peopleLostPerUnit', 'unrestPerUnit']);
	const cost = (name: 'peopleLostPerUnit' | 'unrestPerUnit'): number =>
		readInteger(shortfall[name], `${path}.shortfall.${name}`, { min: 0, max: MAX_SHORTFALL_COST });
	const infirmary = readFields(fields.infirmary, `${path}.infirmary`, ['hitpointsPerDay', 'medsPerDay']);
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
		})
	});
}

/** The shipped rules, read as this module loads, so a bad edit to the file fails straight away. */
export const COMPOUND_RULES: CompoundRules = readCompoundRules(compoundRulesFile, 'CompoundRules');
