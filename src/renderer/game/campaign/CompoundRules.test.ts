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

const scavenged = (json: RulesJson, resource: string): Record<string, unknown> => json.scavenging[resource] as Record<string, unknown>;

describe('compound-rules.json', () => {
	it('reads as the compound\'s rules, which the day end uses when given none', () => {
		expect(read(shipped())).toEqual(COMPOUND_RULES);
	});

	it('feeds 4 people with each unit of food and water, a unit short costs a person and a point of unrest, an infirmary day is 10 HP or a med, and a scavenging party brings back 1 to 2 fuel and 5 to 15 scrap', () => {
		expect(COMPOUND_RULES).toEqual({
			upkeep: { peoplePerUnit: { food: 4, water: 4 } },
			shortfall: { peopleLostPerUnit: 1, unrestPerUnit: 1 },
			infirmary: { hitpointsPerDay: 10, medsPerDay: 1 },
			scavenging: { fuel: { min: 1, max: 2 }, scrap: { min: 5, max: 15 } }
		});
	});

	it('comes back frozen all the way down', () => {
		expect(Object.isFrozen(COMPOUND_RULES)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.upkeep)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.upkeep.peoplePerUnit)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.shortfall)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.infirmary)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.scavenging)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.scavenging.fuel)).toBe(true);
		expect(Object.isFrozen(COMPOUND_RULES.scavenging.scrap)).toBe(true);
	});

	it('takes a scavenging haul pinned to one amount, and one with no scrap', () => {
		const pinned = read(damaged(json => { json.scavenging = { fuel: { min: 3, max: 3 }, scrap: { min: 0, max: 0 } }; }));

		expect(pinned.scavenging).toEqual({ fuel: { min: 3, max: 3 }, scrap: { min: 0, max: 0 } });
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
		['no scavenging', (json: RulesJson) => { delete json.scavenging; }, 'CompoundRules.scavenging is missing'],
		['a party that brings back food', (json: RulesJson) => { json.scavenging.food = { min: 1, max: 2 }; },
			'CompoundRules.scavenging has an unknown field "food"'],
		['a party that can come back with no fuel, which could leave a compound stuck', (json: RulesJson) => { scavenged(json, 'fuel').min = 0; },
			'CompoundRules.scavenging.fuel.min must be an integer from 1 to 100, got 0'],
		['a fuel range that runs backwards', (json: RulesJson) => { json.scavenging.fuel = { min: 3, max: 2 }; },
			'CompoundRules.scavenging.fuel.max must be an integer from 3 to 100, got 2'],
		['more fuel than any tuning', (json: RulesJson) => { scavenged(json, 'fuel').max = 101; },
			'CompoundRules.scavenging.fuel.max must be an integer from 1 to 100, got 101'],
		['scrap a party takes away', (json: RulesJson) => { scavenged(json, 'scrap').min = -5; },
			'CompoundRules.scavenging.scrap.min must be an integer from 0 to 1000, got -5'],
		['part of a scrap', (json: RulesJson) => { scavenged(json, 'scrap').max = 7.5; },
			'CompoundRules.scavenging.scrap.max must be an integer from 5 to 1000, got 7.5'],
		['a range with no max', (json: RulesJson) => { delete scavenged(json, 'scrap').max; }, 'CompoundRules.scavenging.scrap.max is missing']
	])('rejects %s', (_label, change, message) => {
		expect(() => read(damaged(change))).toThrow(message);
	});

	it('rejects rules that aren\'t an object', () => {
		expect(() => read([])).toThrow('CompoundRules must be an object, got []');
	});
});
