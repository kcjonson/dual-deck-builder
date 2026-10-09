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

	it('feeds 4 people with each unit of food and water, a unit short costs a person and a point of unrest, an infirmary day is 10 HP or a med, and a lost compound starves with no food or riots at 10 unrest', () => {
		expect(COMPOUND_RULES).toEqual({
			upkeep: { peoplePerUnit: { food: 4, water: 4 } },
			shortfall: { peopleLostPerUnit: 1, unrestPerUnit: 1 },
			infirmary: { hitpointsPerDay: 10, medsPerDay: 1 },
			fall: { starveAtFood: 0, riotAtUnrest: 10 }
		});
	});

	it('comes back frozen all the way down', () => {
		expect(Object.isFrozen(COMPOUND_RULES)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.upkeep)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.upkeep.peoplePerUnit)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.shortfall)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.infirmary)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.fall)).toBe(true);
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
			'CompoundRules.shortfall.unrestPerUnit must be a number, got "1"'],
		['no infirmary', (json: RulesJson) => { delete json.infirmary; }, 'CompoundRules.infirmary is missing'],
		['an infirmary rule nothing reads', (json: RulesJson) => { json.infirmary.bedsPerLevel = 2; },
			'CompoundRules.infirmary has an unknown field "bedsPerLevel"'],
		['an infirmary day worth no HP, which would injure forever', (json: RulesJson) => { json.infirmary.hitpointsPerDay = 0; },
			'CompoundRules.infirmary.hitpointsPerDay must be an integer from 1 to 100, got 0'],
		['an infirmary day worth part of an HP', (json: RulesJson) => { json.infirmary.hitpointsPerDay = 7.5; },
			'CompoundRules.infirmary.hitpointsPerDay must be an integer from 1 to 100, got 7.5'],
		['an infirmary day worth more HP than any tuning', (json: RulesJson) => { json.infirmary.hitpointsPerDay = 101; },
			'CompoundRules.infirmary.hitpointsPerDay must be an integer from 1 to 100, got 101'],
		['free meds', (json: RulesJson) => { json.infirmary.medsPerDay = 0; },
			'CompoundRules.infirmary.medsPerDay must be an integer from 1 to 100, got 0'],
		['meds per day past any tuning', (json: RulesJson) => { json.infirmary.medsPerDay = 1000; },
			'CompoundRules.infirmary.medsPerDay must be an integer from 1 to 100, got 1000'],
		['no fall', (json: RulesJson) => { delete json.fall; }, 'CompoundRules.fall is missing'],
		['a fall that never starves', (json: RulesJson) => { json.fall.starveAtFood = -1; },
			'CompoundRules.fall.starveAtFood must be an integer from 0 to 1000, got -1'],
		['a fall that riots at no unrest at all', (json: RulesJson) => { json.fall.riotAtUnrest = 0; },
			'CompoundRules.fall.riotAtUnrest must be an integer from 1 to 1000, got 0'],
		['a riot threshold past any tuning', (json: RulesJson) => { json.fall.riotAtUnrest = 1001; },
			'CompoundRules.fall.riotAtUnrest must be an integer from 1 to 1000, got 1001'],
		['a fall rule nothing reads', (json: RulesJson) => { json.fall.disbandAtPeople = 0; },
			'CompoundRules.fall has an unknown field "disbandAtPeople"']
	])('rejects %s', (_label, change, message) => {
		expect(() => read(damaged(change))).toThrow(message);
	});

	it('rejects rules that aren\'t an object', () => {
		expect(() => read([])).toThrow('CompoundRules must be an object, got []');
	});
});
