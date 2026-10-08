import compoundRulesFile from '../data/compound-rules.json';
import { readFields, readInteger } from './JsonReader';

/** What the compound eats every day. */
export const UPKEEP_RESOURCES = ['food', 'water'] as const;

export type UpkeepResource = (typeof UPKEEP_RESOURCES)[number];

/**
 * The compound's standing rules (Compound and Supply Runs, Hours on the
 * road, days at home), kept in `data/compound-rules.json` so they tune
 * without a code change. Every value is a starting point for tuning.
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
}

/**
 * Rules checked: exactly these fields, a whole number of people from 1 that
 * each unit feeds, and whole-number shortfall costs from 0. Errors name the
 * path, as a save's do. Comes back frozen.
 */
export function readCompoundRules(value: unknown, path: string): CompoundRules {
	const fields = readFields(value, path, ['upkeep', 'shortfall']);
	const upkeep = readFields(fields.upkeep, `${path}.upkeep`, ['peoplePerUnit']);
	const perUnit = readFields(upkeep.peoplePerUnit, `${path}.upkeep.peoplePerUnit`, UPKEEP_RESOURCES);
	const feeds = (resource: UpkeepResource): number => readInteger(perUnit[resource], `${path}.upkeep.peoplePerUnit.${resource}`, { min: 1 });
	const shortfall = readFields(fields.shortfall, `${path}.shortfall`, ['peopleLostPerUnit', 'unrestPerUnit']);
	return Object.freeze({
		upkeep: Object.freeze({
			peoplePerUnit: Object.freeze({ food: feeds('food'), water: feeds('water') })
		}),
		shortfall: Object.freeze({
			peopleLostPerUnit: readInteger(shortfall.peopleLostPerUnit, `${path}.shortfall.peopleLostPerUnit`, { min: 0 }),
			unrestPerUnit: readInteger(shortfall.unrestPerUnit, `${path}.shortfall.unrestPerUnit`, { min: 0 })
		})
	});
}

/** The shipped rules, read as this module loads, so a bad edit to the file fails straight away. */
export const COMPOUND_RULES: CompoundRules = readCompoundRules(compoundRulesFile, 'CompoundRules');
