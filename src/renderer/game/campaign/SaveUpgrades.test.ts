import { CAMPAIGN_SCHEMA_VERSION } from './Campaign';
import { UPGRADABLE_SCHEMA_VERSIONS, UPGRADE_STEPS, upgradeCampaignJson } from './SaveUpgrades';

describe('save upgrades', () => {
	it('has a step from every version it lists up to the current one, so a bump can\'t leave a listed version stranded', () => {
		for (const version of UPGRADABLE_SCHEMA_VERSIONS) {
			expect(version).toBeLessThan(CAMPAIGN_SCHEMA_VERSION);
			for (let from = version; from < CAMPAIGN_SCHEMA_VERSION; from += 1) expect(typeof UPGRADE_STEPS[from]).toBe('function');
		}
	});

	it('refuses a version it doesn\'t list', () => {
		expect(() => upgradeCampaignJson({ campaign: {}, version: 7 })).toThrow("Version 7 saves can't be upgraded");
		expect(() => upgradeCampaignJson({ campaign: {}, version: CAMPAIGN_SCHEMA_VERSION })).toThrow(`Version ${CAMPAIGN_SCHEMA_VERSION} saves can't be upgraded`);
	});

	it('reads version 8\'s map state with every POI full, keeping anything else in it', () => {
		expect(upgradeCampaignJson({ campaign: { day: 3, map: {} }, version: 8 })).toEqual({ day: 3, map: {}, buildings: ['bunkhouse'] });
		expect(upgradeCampaignJson({ campaign: { day: 3, map: { pois: 'anything', fog: [1] } }, version: 8 })).toEqual({ day: 3, map: { fog: [1] }, buildings: ['bunkhouse'] });
	});

	it('stands the bunkhouse in a version 9 campaign, which every one was founded with', () => {
		expect(upgradeCampaignJson({ campaign: { day: 3, map: {}, supplyRun: null }, version: 9 })).toEqual({ day: 3, map: {}, supplyRun: null, buildings: ['bunkhouse'] });
	});

	it('gives a version 10 run out no recruits, since nothing found anyone new then', () => {
		expect(upgradeCampaignJson({ campaign: { day: 3, supplyRun: { stop: 1 } }, version: 10 })).toEqual({ day: 3, supplyRun: { stop: 1, recruits: [] } });
		expect(upgradeCampaignJson({ campaign: { day: 3, supplyRun: null }, version: 10 })).toEqual({ day: 3, supplyRun: null });
	});

	it.each([
		['not an object', 'campaign'],
		['a list', [1]],
		['null', null],
	])('passes %s through for the campaign reader to refuse', (_label, campaign) => {
		expect(upgradeCampaignJson({ campaign, version: 8 })).toEqual(campaign);
		expect(upgradeCampaignJson({ campaign, version: 9 })).toEqual(campaign);
		expect(upgradeCampaignJson({ campaign, version: 10 })).toEqual(campaign);
	});

	it.each([
		['a campaign whose map isn\'t an object', { day: 3, map: [] }],
		['a campaign with no map', { day: 3 }],
	])('passes %s through version 8\'s step for the campaign reader to refuse', (_label, campaign) => {
		expect(upgradeCampaignJson({ campaign, version: 8 })).toEqual({ ...campaign, buildings: ['bunkhouse'] });
	});
});
