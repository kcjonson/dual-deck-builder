import compoundRulesFile from '../data/compound-rules.json';
import { COMPOUND_RULES, readCompoundRules } from './CompoundRules';

type RulesJson = Record<string, Record<string, unknown>>;

/** The shipped file as a fresh object to damage. */
const shipped = (): RulesJson => JSON.parse(JSON.stringify(compoundRulesFile));

const read = (json: unknown) => readCompoundRules(json, 'CompoundRules');

/** The shipped file with one change made to it. */
const damaged = (change: (json: RulesJson) => void): RulesJson => {
	const json = shipped();
	change(json);
	return json;
};

const perUnit = (json: RulesJson): Record<string, unknown> => json.upkeep.peoplePerUnit as Record<string, unknown>;

describe('compound-rules.json', () => {
	it('reads as the compound\'s rules, which the day end uses when given none', () => {
		expect(read(shipped())).toEqual(COMPOUND_RULES);
	});

	it('feeds 4 people with each unit of food and water, and a unit short costs a person and a point of unrest', () => {
		expect(COMPOUND_RULES).toEqual({
			upkeep: { peoplePerUnit: { food: 4, water: 4 } },
			shortfall: { peopleLostPerUnit: 1, unrestPerUnit: 1 }
		});
	});

	it('comes back frozen all the way down', () => {
		expect(Object.isFrozen(COMPOUND_RULES)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.upkeep)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.upkeep.peoplePerUnit)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.shortfall)).toBe(true);
	});

	it('takes shortfalls that cost nothing', () => {
		const free = read(damaged(json => { json.shortfall = { peopleLostPerUnit: 0, unrestPerUnit: 0 }; }));

		expect(free.shortfall).toEqual({ peopleLostPerUnit: 0, unrestPerUnit: 0 });
	});

	it.each([
		['an unknown field', (json: RulesJson) => { json.weather = {}; }, 'CompoundRules has an unknown field "weather"'],
		['no upkeep', (json: RulesJson) => { delete json.upkeep; }, 'CompoundRules.upkeep is missing'],
		['upkeep for a resource the compound doesn\'t eat', (json: RulesJson) => { perUnit(json).fuel = 4; },
			'CompoundRules.upkeep.peoplePerUnit has an unknown field "fuel"'],
		['no water upkeep', (json: RulesJson) => { delete perUnit(json).water; }, 'CompoundRules.upkeep.peoplePerUnit.water is missing'],
		['a unit that feeds nobody', (json: RulesJson) => { perUnit(json).food = 0; },
			'CompoundRules.upkeep.peoplePerUnit.food must be an integer from 1 to 100, got 0'],
		['a unit that feeds part of a person', (json: RulesJson) => { perUnit(json).water = 2.5; },
			'CompoundRules.upkeep.peoplePerUnit.water must be an integer from 1 to 100, got 2.5'],
		['a unit that feeds a town', (json: RulesJson) => { perUnit(json).food = 101; },
			'CompoundRules.upkeep.peoplePerUnit.food must be an integer from 1 to 100, got 101'],
		['no shortfall costs', (json: RulesJson) => { delete json.shortfall; }, 'CompoundRules.shortfall is missing'],
		['a shortfall that brings people back', (json: RulesJson) => { json.shortfall.peopleLostPerUnit = -1; },
			'CompoundRules.shortfall.peopleLostPerUnit must be an integer from 0 to 100, got -1'],
		['unrest past any tuning, which would overflow a day end', (json: RulesJson) => { json.shortfall.unrestPerUnit = 2 ** 52; },
			'CompoundRules.shortfall.unrestPerUnit must be an integer from 0 to 100, got 4503599627370496'],
		['unrest in a string', (json: RulesJson) => { json.shortfall.unrestPerUnit = '1'; },
			'CompoundRules.shortfall.unrestPerUnit must be a number, got "1"']
	])('rejects %s', (_label, change, message) => {
		expect(() => read(damaged(change))).toThrow(message);
	});

	it('rejects rules that aren\'t an object', () => {
		expect(() => read([])).toThrow('CompoundRules must be an object, got []');
	});
});
