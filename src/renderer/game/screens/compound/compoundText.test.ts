import { NO_RESOURCES } from '../../campaign/Campaign';
import type { DayEnd } from '../../campaign/DayClock';
import { forecastNeeds } from '../../campaign/DayClock';
import type { DriverRecord } from '../../campaign/DriverRecord';
import { newCampaign } from '../../campaign/__fixtures__/storeFixtures';
import { BUILDINGS, amountText, dayEndReport, dayText, forecastLines, injuredLine, resourceText, restCaption } from './compoundText';

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
	it('lists the six buildings in the wireframe order: the bunkhouse opens the Crew screen, the rest are disabled with a reason for now', () => {
		expect(BUILDINGS.map((building) => building.name)).toEqual(['Bunkhouse', 'Radio mast', 'Infirmary', 'Garage', 'Map room', 'Stores']);
		const [bunkhouse, ...rest] = BUILDINGS;
		expect(bunkhouse.reason).toBeNull();
		expect(bunkhouse.action).toEqual(expect.any(Function));
		for (const building of rest) {
			expect(building.reason).toMatch(/\.$/);
			expect(building.action).toBeUndefined();
		}
	});

	it('writes the day and the resources for the top bar', () => {
		expect(dayText(12)).toBe('Day 12 / dawn');
		expect(resourceText({ resource: 'people', amount: 23 })).toBe('People 23');
		expect(resourceText({ resource: 'scrap', amount: 12_345 })).toBe('Scrap 12k');
	});

	it('writes an amount in four characters at most, rounding down past four digits', () => {
		expect([0, 9999, 10_000, 999_999, 1_000_000, 1_999_999_999, 123_456_789_012].map(amountText))
			.toEqual(['0', '9999', '10k', '999k', '1M', '1B', '123B']);
		expect(amountText(Number.MAX_SAFE_INTEGER)).toBe('9Q');
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

	it('says when there is none left at all', () => {
		const none = forecastNeeds({ resources: { ...NO_RESOURCES, food: 0, water: 7, people: 18 } });
		expect(forecastLines(none)[0]).toEqual({ text: 'No food: 5 short tonight', urgent: true });
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
		expect(restCaption({ day: 3, forecast: forecastNeeds({ resources: { ...NO_RESOURCES, people: 100_000 } }) }))
			.toBe('Ends day 3. The compound eats 25k food and 25k water.');
	});

	it('reports the night: the day that ended, any shortfall as the log words it, and who is fit again', () => {
		expect(dayEndReport(dayEnd())).toEqual({ text: 'Day 9 ended.', urgent: false });
		expect(dayEndReport(dayEnd({ shortfall: { food: 1, water: 2 }, peopleLost: 3 })))
			.toEqual({ text: 'Day 9 ended. Ran short of 1 food and 2 water; 3 people lost.', urgent: true });
		expect(dayEndReport(dayEnd({ shortfall: { food: 0, water: 1 }, peopleLost: 1 })).text).toBe('Day 9 ended. Ran short of 1 water; 1 person lost.');
		expect(dayEndReport(dayEnd({ shortfall: { food: 1, water: 0 } })).text).toBe('Day 9 ended. Ran short of 1 food.');
		const named = (name: string) => ({ name }) as DriverRecord;
		expect(dayEndReport(dayEnd({ healed: [named('Mechanic 1')] })).text).toBe('Day 9 ended. Mechanic 1 is fit again.');
		expect(dayEndReport(dayEnd({ healed: ['A', 'B', 'C'].map(named) })).text).toBe('Day 9 ended. A, B, and C are fit again.');
	});
});
