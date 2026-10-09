import { Campaign } from '../../campaign/Campaign';
import { fixtureText, newCampaign } from '../../campaign/__fixtures__/storeFixtures';
import { campaignSummary, countOf, driversAtCompound, historyColumns } from './campaignText';

describe('campaignText', () => {
	it("summarises a campaign as Continue shows it, leaving out the dead and the missing", () => {
		const campaign = Campaign.fromJSON(JSON.parse(fixtureText()).campaign, { onWarning: () => undefined });
		expect(campaign.drivers).toHaveLength(5);
		expect(driversAtCompound(campaign)).toBe(3);
		expect(campaignSummary(campaign)).toBe('Day 9 - 3 drivers - 1 stronghold taken');
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
});
