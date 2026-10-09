import { NO_RESOURCES } from '../../campaign/Campaign';
import type { DayEnd } from '../../campaign/DayClock';
import { forecastNeeds } from '../../campaign/DayClock';
import type { DriverRecord } from '../../campaign/DriverRecord';
import { newCampaign } from '../../campaign/__fixtures__/storeFixtures';
import { BUILDINGS, dayEndReport, dayText, forecastLines, injuredLine, resourceText, restCaption } from './compoundText';

function dayEnd(changes: Partial<DayEnd> = {}): DayEnd {
	return {
		day: 9,
		upkeep: { food: 5, water: 5 },
		shortfall: { food: 0, water: 0 },
		peopleLost: 0,
		unrestGained: 0,
		healed: [],
		outcome: 'continues',
		...changes,
	};
}

describe('compoundText', () => {
	it('lists the six buildings in the wireframe order, each disabled with a reason for now', () => {
		expect(BUILDINGS.map((building) => building.name)).toEqual(['Bunkhouse', 'Radio mast', 'Infirmary', 'Garage', 'Map room', 'Stores']);
		for (const building of BUILDINGS) expect(building.reason).toMatch(/\.$/);
	});

	it('writes the day and the resources for the top bar', () => {
		expect(dayText(12)).toBe('Day 12 / dawn');
		expect(resourceText({ resource: 'people', amount: 23 })).toBe('People 23');
	});

	it('forecasts how long food and water last, and tonight as urgent when it falls short', () => {
		const forecast = forecastNeeds({ resources: { ...NO_RESOURCES, food: 18, water: 2, people: 12 } });
		expect(forecastLines(forecast)).toEqual([
			{ text: 'Food runs out in 6 days', urgent: false },
			{ text: 'Water runs out tonight, 1 short', urgent: true },
		]);
		const oneDay = forecastNeeds({ resources: { ...NO_RESOURCES, food: 3, water: 5, people: 12 } });
		expect(forecastLines(oneDay).map((line) => line.text)).toEqual(['Food runs out in 1 day', 'Water runs out in 1 day']);
	});

	it('forecasts nothing with nobody there to eat', () => {
		expect(forecastLines(forecastNeeds({ resources: NO_RESOURCES }))).toEqual([]);
	});

	it('says when an injured driver is fit again', () => {
		const [driver] = newCampaign().drivers;
		driver.set({ status: 'injured', injuredDays: 1, hitpoints: 10 });
		expect(injuredLine(driver)).toBe('Road Warrior 1 is injured, fit in 1 day');
		driver.set({ injuredDays: 3 });
		expect(injuredLine(driver)).toBe('Road Warrior 1 is injured, fit in 3 days');
	});

	it("puts what a day eats on Rest's line", () => {
		expect(restCaption({ day: 9, forecast: forecastNeeds({ resources: { ...NO_RESOURCES, food: 14, water: 11, people: 18 } }) }))
			.toBe('Ends day 9. The compound eats 5 food and 5 water.');
		expect(restCaption({ day: 3, forecast: forecastNeeds({ resources: NO_RESOURCES }) })).toBe('Ends day 3.');
	});

	it('reports the night: the day that ended, any shortfall and the people it cost, and who is fit again', () => {
		expect(dayEndReport(dayEnd())).toBe('Day 9 ended.');
		expect(dayEndReport(dayEnd({ shortfall: { food: 1, water: 2 }, peopleLost: 3 }))).toBe('Day 9 ended. Short of 1 food and 2 water; 3 people lost.');
		expect(dayEndReport(dayEnd({ shortfall: { food: 0, water: 1 }, peopleLost: 1 }))).toBe('Day 9 ended. Short of 1 water; 1 person lost.');
		expect(dayEndReport(dayEnd({ shortfall: { food: 1, water: 0 } }))).toBe('Day 9 ended. Short of 1 food.');
		const named = (name: string) => ({ name }) as DriverRecord;
		expect(dayEndReport(dayEnd({ healed: [named('Mechanic 1')] }))).toBe('Day 9 ended. Mechanic 1 is fit again.');
		expect(dayEndReport(dayEnd({ healed: ['A', 'B', 'C'].map(named) }))).toBe('Day 9 ended. A, B, and C are fit again.');
	});
});
