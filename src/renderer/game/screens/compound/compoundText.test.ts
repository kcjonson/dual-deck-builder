import { NO_RESOURCES } from '../../campaign/Campaign';
import type { DayEnd } from '../../campaign/DayClock';
import { forecastNeeds } from '../../campaign/DayClock';
import type { DriverRecord } from '../../campaign/DriverRecord';
import { newCampaign } from '../../campaign/__fixtures__/storeFixtures';
import {
	BUILDINGS, REST_RUN_OUT, SHORT_WITHIN_DAYS, amountText, buildingNumber, buildingState, crewLine, dayEndReport, dayText, forecastLines, injuredLine, restCaption, scavengeCaption, scavengeRefusal,
	scavengeReport, unbuiltReason,
} from './compoundText';

function dayEnd(changes: Partial<DayEnd> = {}): DayEnd {
	return {
		day: 9,
		upkeep: { food: 5, water: 5 },
		shortfall: { food: 0, water: 0 },
		peopleLost: 0,
		unrestGained: 0,
		healed: [],
		...changes,
	};
}

describe('compoundText', () => {
	it('names the six buildings in the order the campaign numbers them: the bunkhouse opens the Crew screen, the rest say why they have no action for now', () => {
		expect(BUILDINGS.map((building) => building.name)).toEqual(['Bunkhouse', 'Radio mast', 'Infirmary', 'Map room', 'Garage', 'Stores']);
		expect(BUILDINGS.map((building) => buildingNumber(building.id))).toEqual(['1', '2', '3', '4', '5', '6']);
		const [bunkhouse, ...rest] = BUILDINGS;
		expect([bunkhouse.reason, bunkhouse.screen, bunkhouse.action]).toEqual([null, 'crewScreen', 'Open the bunkhouse']);
		for (const building of rest) {
			expect(building.reason).toMatch(/\.$/);
			expect(building.screen).toBeUndefined();
			expect(building.action).toBeUndefined();
		}
		expect(unbuiltReason(rest[0])).toBe("The radio mast isn't built yet.");
		expect([buildingState(true), buildingState(false)]).toEqual(['BUILT', 'not built']);
	});

	it('writes the day as the atlas subtitles it', () => {
		expect(dayText(12)).toBe('day 12, dawn');
	});

	it('counts the drivers at the compound and the default decks with cards in them for the bunkhouse', () => {
		const campaign = newCampaign();
		expect(crewLine(campaign)).toBe('2 drivers · 2 default decks');
		campaign.drivers[0].set({ defaultDeck: {} });
		expect(crewLine(campaign)).toBe('2 drivers · 1 default deck');
	});

	it('writes an amount in four characters at most, rounding down past four digits', () => {
		expect([0, 9999, 10_000, 999_999, 1_000_000, 1_999_999_999, 123_456_789_012].map(amountText))
			.toEqual(['0', '9999', '10k', '999k', '1M', '1B', '123B']);
		expect(amountText(Number.MAX_SAFE_INTEGER)).toBe('9Q');
	});

	it('forecasts how long food and water last, and tonight as urgent when it falls short', () => {
		const forecast = forecastNeeds({ resources: { ...NO_RESOURCES, food: 18, water: 2, people: 12 } });
		expect(forecastLines(forecast)).toEqual([
			{ text: 'Food runs out in 6 days', urgent: false, short: false },
			{ text: 'Water runs out tonight, 1 short', urgent: true, short: true },
		]);
		const oneDay = forecastNeeds({ resources: { ...NO_RESOURCES, food: 3, water: 5, people: 12 } });
		expect(forecastLines(oneDay).map((line) => line.text)).toEqual(['Food runs out in 1 day', 'Water runs out in 1 day']);
	});

	it('says when there is none left at all', () => {
		const none = forecastNeeds({ resources: { ...NO_RESOURCES, food: 0, water: 7, people: 18 } });
		expect(forecastLines(none)[0]).toEqual({ text: 'No food: 5 short tonight', urgent: true, short: true });
	});

	it('flags a store as short when it runs out within two day ends', () => {
		expect(SHORT_WITHIN_DAYS).toBe(2);
		const lines = (food: number) => forecastLines(forecastNeeds({ resources: { ...NO_RESOURCES, food, water: 99, people: 12 } }))[0];
		expect([lines(9), lines(6)].map((line) => [line.text, line.short])).toEqual([['Food runs out in 3 days', false], ['Food runs out in 2 days', true]]);
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
		// A campaign that's over ends no day: Rest only saves its end again
		expect(restCaption({ day: 3, forecast: forecastNeeds({ resources: NO_RESOURCES }), over: true })).toBe('The compound has fallen. Rest saves its end again.');
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

	it("previews a party's haul under Rest's line, leaving out scrap tuned to 0", () => {
		expect(scavengeCaption({ fuel: 2, scrap: 15 })).toBe('Scavenging ends it too, with 2 fuel and 15 scrap.');
		expect(scavengeCaption({ fuel: 1, scrap: 0 })).toBe('Scavenging ends it too, with 1 fuel.');
	});

	it('says why no party can go, and why Rest waits while a run is out', () => {
		expect(scavengeRefusal({ reason: 'run_out', run: 'run-3' })).toBe("A run is out, so no party goes until it's home.");
		expect(scavengeRefusal({ reason: 'abandoned' })).toBe('Nobody is left to send out.');
		expect(scavengeRefusal({ reason: 'campaign_over', end: { ending: 'starved', cause: 'no_people' } })).toBe('The campaign is over, so no party goes out.');
		expect(REST_RUN_OUT).toBe('A run is out, and its return ends the day.');
	});

	it("reports a scavenged day with the party's haul ahead of the night, urgent as the night was", () => {
		expect(scavengeReport({ haul: { fuel: 2, scrap: 15 }, dayEnd: dayEnd() }))
			.toEqual({ text: 'A scavenging party brought back 2 fuel and 15 scrap. Day 9 ended.', urgent: false });
		expect(scavengeReport({ haul: { fuel: 1, scrap: 5 }, dayEnd: dayEnd({ shortfall: { food: 1, water: 0 }, peopleLost: 1 }) }))
			.toEqual({ text: 'A scavenging party brought back 1 fuel and 5 scrap. Day 9 ended. Ran short of 1 food; 1 person lost.', urgent: true });
	});
});
