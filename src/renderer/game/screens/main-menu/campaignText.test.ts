import { Campaign } from '../../campaign/Campaign';
import { fixtureText, lostCampaign, newCampaign } from '../../campaign/__fixtures__/storeFixtures';
import { campaignSummary, countOf, driversAtCompound, foundingText, historyColumns, mapProgressText } from './campaignText';

describe('campaignText', () => {
	it("summarises a campaign as Continue shows it, leaving out the dead and the missing", () => {
		const campaign = Campaign.fromJSON(JSON.parse(fixtureText()).campaign, { onWarning: () => undefined });
		expect(campaign.drivers).toHaveLength(5);
		expect(driversAtCompound(campaign)).toBe(3);
		expect(campaignSummary(campaign)).toBe('Day 9 - 3 drivers - 1 stronghold taken');
	});

	it('says the day a campaign that is over fell on, in place of its state', () => {
		expect(campaignSummary(lostCampaign({ ending: 'starved', cause: 'no_people' }))).toBe('Fell on day 9');
	});

	it('counts in the singular and the plural', () => {
		expect(countOf(1, 'driver')).toBe('1 driver');
		expect(countOf(0, 'stronghold')).toBe('0 strongholds');
		expect(campaignSummary(newCampaign())).toBe('Day 1 - 2 drivers - 0 strongholds taken');
	});

	it('lays out a past campaign: how it ended, the days it held out, the strongholds, and the seed', () => {
		expect(historyColumns({ seed: 20261006, day: 1, strongholdsTaken: 2, ending: 'starved' })).toEqual({
			ending: 'Starved',
			days: '1 day',
			strongholds: '2 strongholds taken',
			seed: 'Seed 20261006',
		});
		expect(historyColumns({ seed: 7, day: 40, strongholdsTaken: 1, ending: 'abandoned' }).days).toBe('40 days');
	});

	it('says how far a map has got, by stage, with the try once founding has moved past a seed', () => {
		const at = { stage: 'routeTree', index: 4, count: 6, attempt: 2, mapAttempt: 1, seed: 9 };
		expect(mapProgressText(at)).toBe('Making the area map: route tree (5 of 6)');
		expect(mapProgressText({ ...at, stage: 'terrain', index: 0 })).toBe('Making the area map: terrain (1 of 6)');
		expect(foundingText({ ...at, stage: 'water', index: 1, seedAttempt: 0 } as Parameters<typeof foundingText>[0])).toBe('Making the area map: water (2 of 6)');
		expect(foundingText({ ...at, stage: 'water', index: 1, seedAttempt: 2 } as Parameters<typeof foundingText>[0])).toBe('Making the area map: water (2 of 6), try 3');
	});
});
